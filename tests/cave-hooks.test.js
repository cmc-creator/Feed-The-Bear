// Hooks from the audit (findings 1, 5, 6, 7, 10).
// - The Daily Challenge is reachable: a home card and a hub tile both
//   open it, and finishing it is +10 cave points once a day.
// - The Mystery Box is the recurring sink: 100 points for a random
//   decor piece you don't own yet; all owned means no sale.
// - Fun points: food-fight win +5, score 50+ +10, sharing your cave +10,
//   all once a day and all counting toward lifetime.
// - The upgrade modal defaults to monthly ($4.99), not yearly.
// - Home shows your cave: scene thumbnail, points, streak, next unlock,
//   tapping it opens the Cave Shop.
// - A server reward notice (a friend joined: +50) shows once, then clears.
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

const spot = i => ({
  id: `s${i}`, name: `Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [],
});

(async () => {
  const browser = await launch();
  const seed = Array.from({ length: 50 }, (_, i) => spot(i)); // 50 spots = 500 points
  const p = await newPage(browser, { seed, settings: {} });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'hooky', public: true, views: 5, joins: 2, votes: 3 } });
    return rt.fulfill({ json: { followers: [], invites: [] } });
  });
  await p.addInitScript(() => {
    const auth = {
      currentUser: null,
      setPersistence: async () => {},
      onAuthStateChanged (fn) { queueMicrotask(() => fn(null)); return () => {}; },
      signOut: async () => {},
    };
    window.firebase = {
      initializeApp () {},
      auth: Object.assign(() => auth, { GoogleAuthProvider: class {}, Auth: { Persistence: { LOCAL: 'local' } } }),
      firestore: () => ({
        doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), set: async () => {}, delete: async () => {} }),
        collection: () => ({ get: async () => ({ docs: [] }) }),
        batch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
      }),
    };
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  await p.evaluate(() => { window._ftbUid = 'hookUid1234567'; });

  const fun = () => p.evaluate(() => (loadUserProfile()?.caveFun || 0));

  // ── 1. The Daily Challenge is reachable from home and from the hub ──
  check(await p.evaluate(() => { const c = document.getElementById('daily-challenge-home'); return c && !c.classList.contains('hidden'); }),
    'home shows a Daily Challenge card');
  check(await p.evaluate(() => (document.getElementById('daily-challenge-home-text')?.textContent || '').length > 3),
    'the home card names today\'s challenge');
  await p.locator('#daily-challenge-home-btn').click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.getElementById('dailychallenge-overlay')?.classList.contains('hidden')),
    'the home card button opens the Daily Challenge');
  await p.evaluate(() => closeDailyChallenge());
  check(await p.evaluate(() => HUB_SECTIONS.flatMap(s => s.items.map(i => i[0])).includes('dailychallenge')),
    'the hub has a Daily Challenge tile');
  await p.evaluate(() => TOOL_ACTIONS.dailychallenge());
  await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.getElementById('dailychallenge-overlay')?.classList.contains('hidden')),
    'the hub tile opens the Daily Challenge too');
  await p.evaluate(() => closeDailyChallenge());

  // Finishing the challenge is +10 cave points, once a day.
  let r = await p.evaluate(() => { completeDailyChallenge(); return (loadUserProfile()?.caveFun || 0); });
  check(r === 10, `finishing the daily challenge pays +10 cave points (${r})`);
  r = await p.evaluate(() => { completeDailyChallenge(); return (loadUserProfile()?.caveFun || 0); });
  check(r === 10, 'a completed challenge pays nothing twice');

  // ── 5. The Mystery Box ──
  const spent = () => p.evaluate(() => (loadUserProfile()?.caveSpent || 0));
  const owned = () => p.evaluate(() => [...(loadUserProfile()?.caveOwnedDecor || [])]);
  r = await p.evaluate(() => buyMysteryBox());
  check(r.ok === true && r.id && r.label, `the Mystery Box sells and names the prize (${r.label})`);
  check((await spent()) === 100 && (await owned()).includes(r.id), 'the box costs 100 points and the prize is recorded as owned');
  const first = r.id;
  r = await p.evaluate(() => buyMysteryBox());
  check(r.ok === true && r.id !== first, 'a second box is a different piece you did not own yet');
  // Broke? The box says so.
  await p.evaluate(() => {
    const prof = loadUserProfile() || {};
    saveUserProfile({ ...prof, caveSpent: 100000 });
  });
  r = await p.evaluate(() => buyMysteryBox());
  check(r.ok === false && r.reason === 'points' && r.need > 0, 'the box is blocked without enough points');
  await p.evaluate(() => {
    const prof = loadUserProfile() || {};
    saveUserProfile({ ...prof, caveSpent: 200, caveOwnedDecor: ['lantern', 'honeypot', 'picnic', 'mushroom', 'campfire', 'crystal', 'goldenbear', 'marblehearth', 'candelabra', 'jeweledrug'] });
  });
  r = await p.evaluate(() => buyMysteryBox());
  check(r.ok === false && r.reason === 'allowned', 'owning every decor piece means no sale');
  // The shop shows the Mystery Box section.
  await p.evaluate(() => openCaveShop());
  await p.waitForFunction(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden'));
  check(await p.locator('#cave-shop-mystery').innerText().then(t => /Mystery Box/.test(t)),
    'the shop has a Mystery Box section');
  await p.evaluate(() => closeCaveShop());

  // ── 6. Fun points: food fight, cave share, and the once-a-day guard ──
  const funBefore = await fun();
  r = await p.evaluate(() => {
    gameOver(document.body, { game: 'fight', score: 55, headline: 'Food Fight Champion!', line: 'You fed the bears.', again: () => {}, share: 'test' });
    return (loadUserProfile()?.caveFun || 0);
  });
  check(r === funBefore + 15, `a 55-point food fight pays +5 for the win and +10 for the daily 50 (${funBefore} -> ${r})`);
  r = await p.evaluate(() => {
    gameOver(document.body, { game: 'fight', score: 60, headline: 'Again!', line: 'You fed the bears.', again: () => {}, share: 'test' });
    return (loadUserProfile()?.caveFun || 0);
  });
  check(r === funBefore + 15, 'a second food fight the same day pays nothing more');
  // Sharing your cave is +10, once a day.
  r = await p.evaluate(() => awardCaveFun(10, 'caveShare'));
  check(r.ok === true, 'sharing your cave pays +10');
  r = await p.evaluate(() => awardCaveFun(10, 'caveShare'));
  check(r.ok === false && r.reason === 'done', 'sharing your cave twice the same day pays nothing more');
  // Fun points count toward lifetime (and the unlocks).
  check(await p.evaluate(() => { const pts = cavePoints(); return pts.lifetime >= pts.total + pts.bonus + pts.fun; }),
    'fun points count toward lifetime');
  check(await p.evaluate(() => caveUnlockedIds().has('fireplace')) === true, 'the fireplace stays unlocked with fun points in the mix');

  // ── 7. The upgrade modal defaults to monthly ──
  await p.evaluate(() => openUpgradeModal());
  await p.waitForTimeout(200);
  check(await p.evaluate(() => document.getElementById('upgrade-monthly-btn')?.classList.contains('active') === true),
    'the upgrade modal opens on monthly');
  check(await p.evaluate(() => document.getElementById('upgrade-price-main')?.textContent === '$4.99'),
    'the upgrade modal shows $4.99, not $53.89');
  check(await p.evaluate(() => document.getElementById('upgrade-yearly-btn') !== null),
    'yearly is still on the screen as the best-value option');
  await p.evaluate(() => closeUpgradeModal());

  // ── 10. Home shows your cave ──
  // Drop to a low-points state first, so there is a next unlock to show.
  await p.evaluate(() => {
    state.restaurants = state.restaurants.slice(0, 5);
    const prof = loadUserProfile() || {};
    saveUserProfile({ ...prof, caveLifetime: 0, caveSpent: 0 });
  });
  await p.evaluate(() => renderMyCaveHome());
  check(await p.evaluate(() => { const c = document.getElementById('my-cave-home'); return c && !c.classList.contains('hidden'); }),
    'home shows a My Bear Cave card');
  check(await p.evaluate(() => (document.getElementById('my-cave-home-meta')?.textContent || '').includes('points to spend')),
    'the cave card shows the points balance');
  check(await p.evaluate(() => (document.getElementById('my-cave-home-meta')?.textContent || '').includes('more to')),
    'the cave card shows how far the next unlock is');
  check(await p.evaluate(() => (document.getElementById('my-cave-home-img')?.getAttribute('src') || '').includes('scene-')),
    'the cave card uses your theme scene as its thumbnail');
  await p.locator('#my-cave-home-card').click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden')),
    'tapping your cave card opens the Cave Shop');
  await p.evaluate(() => closeCaveShop());

  // ── 8 (client half). A server reward notice shows once, then clears ──
  await p.evaluate(() => {
    const prof = loadUserProfile() || {};
    saveUserProfile({ ...prof, caveRewardNotice: { text: 'Your friend joined — +50 cave points', at: new Date().toISOString() } });
  });
  await p.evaluate(() => drainCaveRewardNotice());
  check(await p.evaluate(() => loadUserProfile()?.caveRewardNotice == null),
    'the reward notice clears after it is shown once');
  await p.evaluate(() => drainCaveRewardNotice());
  check(await p.evaluate(() => loadUserProfile()?.caveRewardNotice == null),
    'draining again with no notice is a no-op');

  check(p.errors.length === 0, `no page errors in the hooks test (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-hooks');
})();
