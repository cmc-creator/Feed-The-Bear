// Daily check-in streak (finding 2).
// - Day 1 pays +5, day 2 +5, day 3 +10, day 4 +10, day 5 +15, day 6 +15,
//   day 7 +25 plus a bonus decor piece you don't own yet.
// - Missing a day resets the streak to day 1; same-day repeats pay nothing.
// - The streak lives in the profile (caveStreak / caveStreakDate) and the
//   rewards are daily bonuses, so lifetime and the Fireplace / Shelf /
//   Bar Cart unlocks are untouched by spending.
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

const spot = i => ({
  id: `s${i}`, name: `Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [],
});

(async () => {
  const browser = await launch();
  const seed = Array.from({ length: 10 }, (_, i) => spot(i)); // 10 spots = 100 points
  const p = await newPage(browser, { seed, settings: {} });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'streaky', public: true, views: 5, joins: 2, votes: 3 } });
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
  await p.evaluate(() => { window._ftbUid = 'streakUid12345'; });

  const bonus = () => p.evaluate(() => (loadUserProfile()?.caveBonus || 0));
  const streak = () => p.evaluate(() => (loadUserProfile()?.caveStreak || 0));
  const setDates = (streakN, daysAgo) => p.evaluate(([n, d]) => {
    const prof = loadUserProfile() || {};
    const date = new Date(Date.now() - d * 86400000).toDateString();
    saveUserProfile({ ...prof, caveStreak: n, caveStreakDate: date, caveBonusDate: date });
  }, [streakN, daysAgo]);

  // Day 1: +5, streak 1. Same day again: nothing.
  let r = await p.evaluate(() => grantDailyBonus());
  check(r === true, 'the first daily bonus lands');
  check((await bonus()) === 5 && (await streak()) === 1, 'day 1 pays +5, streak 1');
  r = await p.evaluate(() => grantDailyBonus());
  check(r === false && (await bonus()) === 5, 'the same day pays nothing twice');

  // Day 2 (yesterday was the last bonus): +5, streak 2.
  await setDates(1, 1);
  r = await p.evaluate(() => grantDailyBonus());
  check(r === true && (await bonus()) === 10 && (await streak()) === 2, 'day 2 pays +5, streak 2');

  // Day 3: +10, streak 3.
  await setDates(2, 1);
  r = await p.evaluate(() => grantDailyBonus());
  check(r === true && (await bonus()) === 20 && (await streak()) === 3, 'day 3 pays +10, streak 3');

  // A missed day resets the streak to 1 (last bonus 3 days ago).
  await setDates(3, 3);
  r = await p.evaluate(() => grantDailyBonus());
  check(r === true && (await bonus()) === 25 && (await streak()) === 1, 'a missed day resets the streak to 1 and pays +5');

  // Day 7: +25 plus a bonus decor piece you don't own yet.
  await setDates(6, 1);
  const ownedBefore = await p.evaluate(() => [...(loadUserProfile()?.caveOwnedDecor || [])]);
  r = await p.evaluate(() => grantDailyBonus());
  const ownedAfter = await p.evaluate(() => [...(loadUserProfile()?.caveOwnedDecor || [])]);
  check(r === true && (await bonus()) === 50 && (await streak()) === 7, 'day 7 pays +25, streak 7');
  check(ownedAfter.length === ownedBefore.length + 1, `day 7 also drops a bonus decor piece (${ownedBefore.length} -> ${ownedAfter.length})`);
  check(ownedAfter.some(id => !ownedBefore.includes(id)), 'the bonus piece is one you did not own yet');

  // Day 7 again when you already own every base decor: just the points.
  await p.evaluate(() => {
    const prof = loadUserProfile() || {};
    saveUserProfile({ ...prof, caveOwnedDecor: ['lantern', 'honeypot', 'picnic', 'mushroom', 'campfire', 'crystal'] });
  });
  await setDates(13, 1);
  const ownedFull = await p.evaluate(() => [...(loadUserProfile()?.caveOwnedDecor || [])]);
  r = await p.evaluate(() => grantDailyBonus());
  check(r === true && (await streak()) === 14, 'day 14 (second week) still pays');
  check((await p.evaluate(() => [...(loadUserProfile()?.caveOwnedDecor || [])])).length === ownedFull.length,
    'with every base decor owned, day 7 adds no piece (just the points)');

  // The streak never breaks the lifetime model: the fireplace stays
  // unlocked and the balance is lifetime minus spent.
  check(await p.evaluate(() => caveUnlockedIds().has('fireplace')) === true, 'the fireplace stays unlocked through the streak');
  check(await p.evaluate(() => { const pts = cavePoints(); return pts.balance === pts.lifetime - pts.spent; }),
    'the balance is still lifetime minus spent');

  check(p.errors.length === 0, `no page errors in the streak test (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-streak');
})();
