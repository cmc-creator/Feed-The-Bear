// Cave Shop: spend the points you earn on new caves and decor.
// - Points items are bought with the spendable balance (lifetime - spent).
//   Buying is validated (unknown item, already owned, not enough points)
//   and spending never un-unlocks the Fireplace / Shelf / Bar Cart,
//   which are based on lifetime points.
// - Grizzly items are never sold for points; they are a Grizzly perk.
// - A shop theme or decor you do not own can never be saved, even from
//   a crafted cave.
// - Daily check-in: +5 points the first time the app opens each day.
// - The public cave page renders purchased shop themes and decor.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/shopshare01': { uid: 'shopUid1234567', u: 'Shopper', profile: { picks: [
    { n: 'Tacos Chiwas', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos'], s: ['Horchata'] },
  ], cave: { t: 'midnight', d: ['lantern', 'crystal'] }, pts: 300 } },
  'profiles/aurorashare1': { uid: 'auroraUid12345', u: 'Aurora', profile: { picks: [], cave: { t: 'aurora', d: ['throne', 'chandelier'] }, pts: 120 } },
};
const ref = p => ({
  p,
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  set: async (d, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...d } : d; },
  delete: async () => { delete docs[p]; },
});
const collection = prefix => ({
  get: async () => {
    const list = Object.keys(docs).filter(k => k.startsWith(prefix + '/'))
      .map(k => ({ id: k.slice(prefix.length + 1), data: () => docs[k] }));
    return { size: list.length, docs: list };
  },
});
const fake = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
  firestore: () => ({
    doc: ref,
    collection,
    runTransaction: async fn => fn({ get: r => r.get(), set: (r, d) => { docs[r.p] = d; }, delete: r => { delete docs[r.p]; } }),
  }),
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
const handleApi = require(path.join(__dirname, '..', 'api', 'handle.js'));
const creatorApi = require(path.join(__dirname, '..', 'api', 'creator.js'));
Module._load = orig;

const callHandle = (uid, { method = 'GET', query = {}, body } = {}) => new Promise(resolve => {
  const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
  handleApi({ method, query, body, headers: uid ? { 'x-ftb-token': `token-${uid}` } : {} }, res);
});
const view = h => new Promise(resolve => {
  const res = { h: {}, setHeader (k, v) { this.h[k] = v; }, status (c) { this.c = c; return this; }, send (d) { resolve({ status: this.c, html: String(d) }); return this; } };
  creatorApi({ method: 'GET', query: { h }, headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
});

(async () => {
  // ── 1. The public page renders purchased shop themes and decor ──
  await callHandle('shopUid1234567', { method: 'POST', body: { action: 'claim', handle: 'shopper_eats', id: 'shopshare01', name: 'Shopper' } });
  await callHandle('shopUid1234567', { method: 'POST', body: { action: 'publicPage', on: true } });
  let pg = await view('shopper_eats');
  check(pg.status === 200, 'the shop cave page opens');
  check(/Midnight Den/.test(pg.html), 'the page shows the purchased Midnight Den theme');
  check(/decor-lantern\.jpg/.test(pg.html), 'the page shows the purchased lantern decor photo');
  check(/decor-crystal\.jpg/.test(pg.html), 'the page shows the purchased crystal decor photo');
  check(/theme-forest\.jpg/.test(pg.html), 'the Midnight Den scene uses its graded forest photo');
  await callHandle('auroraUid12345', { method: 'POST', body: { action: 'claim', handle: 'aurora_eats', id: 'aurorashare1', name: 'Aurora' } });
  await callHandle('auroraUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  pg = await view('aurora_eats');
  check(pg.status === 200 && /Aurora Cave/.test(pg.html), 'the page shows the Grizzly Aurora Cave theme');
  check(/decor-throne\.jpg/.test(pg.html) && /decor-chandelier\.jpg/.test(pg.html),
    'the page shows the Grizzly throne and chandelier decor photos');

  // ── 2. App: buying, balance, equipping, and the daily bonus ──
  const browser = await launch();
  const spot = i => ({
    id: `s${i}`, name: `Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [],
  });
  const seed = [0, 1, 2, 3, 4, 5].map(spot); // 6 spots = 60 points
  const p = await newPage(browser, { seed, settings: {} });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'shopper', public: true, views: 5, joins: 2, votes: 3 } });
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
  await p.evaluate(() => { window._ftbUid = 'shopUid1234567'; });

  let pts = await p.evaluate(() => cavePoints());
  check(pts.total === 60 && pts.balance === 60 && pts.lifetime === 60 && pts.spent === 0,
    `six spots is 60 points to spend (${JSON.stringify(pts)})`);

  // Buy the lantern (50): balance drops to 10, the purchase is recorded.
  let res = await p.evaluate(() => buyCaveShopItem('decor', 'lantern'));
  check(res.ok === true, 'buying the lantern with 60 points works');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 10 && pts.spent === 50 && pts.lifetime === 60,
    `the lantern costs 50, leaving 10 to spend (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => (loadUserProfile()?.caveOwnedDecor || []).includes('lantern')),
    'the lantern purchase is saved in the profile');
  // Buying it again is blocked, and a 150-point crystal is out of reach.
  res = await p.evaluate(() => buyCaveShopItem('decor', 'lantern'));
  check(res.ok === false && res.reason === 'owned', 'buying the lantern twice is blocked');
  res = await p.evaluate(() => buyCaveShopItem('decor', 'crystal'));
  check(res.ok === false && res.reason === 'points' && res.need === 140,
    'the 150-point crystal is blocked with 10 points (need 140 more)');
  // Grizzly items are never sold for points.
  res = await p.evaluate(() => buyCaveShopItem('theme', 'aurora'));
  check(res.ok === false && res.reason === 'grizzly', 'the Grizzly Aurora Cave cannot be bought with points');
  res = await p.evaluate(() => buyCaveShopItem('decor', 'nope'));
  check(res.ok === false && res.reason === 'unknown', 'an unknown shop item is rejected');
  // Equipping the lantern puts it in the cave.
  check(await p.evaluate(() => equipCaveShopItem('decor', 'lantern')) === true,
    'the owned lantern equips into the cave');
  check(await p.evaluate(() => (loadUserProfile()?.cave?.decor || []).includes('lantern')),
    'the lantern is in the saved cave');
  // Spending never un-unlocks the fireplace: lifetime is still 60.
  check(await p.evaluate(() => caveUnlockedIds().has('fireplace')) === true,
    'the fireplace stays unlocked after spending 50 points');
  // A shop theme you do not own can never be saved, even handed to saveCave.
  await p.evaluate(() => saveCave({ theme: 'midnight', decor: ['lantern'] }));
  check(await p.evaluate(() => loadUserProfile()?.cave?.theme) === 'cozy',
    'saving the unowned Midnight Den falls back to cozy');
  check(await p.evaluate(() => (loadUserProfile()?.cave?.decor || []).includes('lantern')),
    'the owned lantern still saves alongside the fallback theme');
  // Unequip it again so the shop UI can show its Use button below.
  await p.evaluate(() => saveCave({ theme: 'cozy', decor: [] }));
  check(await p.evaluate(() => !(loadUserProfile()?.cave?.decor || []).includes('lantern')),
    'the lantern can be taken back out of the cave (still owned)');

  // Daily bonus: +5 once, then nothing more today.
  await p.evaluate(() => {
    const prof = loadUserProfile() || { name: 'Shopper', avatar: '🧸', joinDate: new Date().toISOString() };
    saveUserProfile(prof);
  });
  check(await p.evaluate(() => grantDailyBonus()) === true, 'the first daily bonus lands');
  pts = await p.evaluate(() => cavePoints());
  check(pts.bonus === 5 && pts.balance === 15 && pts.lifetime === 65,
    `the daily bonus adds 5 (balance 15, lifetime 65) (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => grantDailyBonus()) === false, 'the daily bonus does not fire twice in one day');

  // ── 3. The shop UI: balance, Owned, and the Grizzly badge ──
  await p.evaluate(() => openCaveShop());
  await p.waitForFunction(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden'));
  const balanceText = await p.locator('#cave-shop-balance').innerText();
  check(/15 points to spend/.test(balanceText), `the shop shows the 15-point balance ("${balanceText.replace(/\s+/g, ' ')}")`);
  check(await p.locator('#cave-shop-themes [data-shop-grizzly="theme:aurora"]').isVisible(),
    'the Grizzly Aurora Cave shows a Grizzly button, not a price');
  check(await p.locator('#cave-shop-decor [data-shop-use="decor:lantern"]').isVisible(),
    'the owned lantern shows a Use button');
  check(await p.locator('#cave-shop-themes [data-shop-buy="theme:golden"]').count() === 0,
    'the 150-point Golden Hour Cave shows no Buy button with 15 points');
  // Use the lantern from the shop UI and confirm it stays equipped.
  await p.locator('#cave-shop-decor [data-shop-use="decor:lantern"]').click();
  await p.waitForTimeout(400);
  check(await p.evaluate(() => (loadUserProfile()?.cave?.decor || []).includes('lantern')),
    'using the lantern from the shop keeps it in the cave');
  // The cave setup shows the spendable balance too.
  await p.evaluate(() => { closeCaveShop(); openHandleSettings(); });
  await p.waitForFunction(() => /to spend in the/.test(document.getElementById('cave-points')?.innerText || ''));
  check(/15 to spend/.test(await p.locator('#cave-points').innerText()),
    'the cave setup shows the 15-point spendable balance');
  // ── 4. Furniture: buy, equip, max three, Grizzly bed, and the pantry ──
  // Earn more points first: 70 more spots is 700 points.
  await p.evaluate(() => {
    for (let i = 0; i < 70; i++) state.restaurants.push({ id: `fx${i}`, name: `Furn Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [] });
  });
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 715 && pts.lifetime === 765, `seventy more spots is 715 to spend (${JSON.stringify(pts)})`);
  // Furniture: lamp 100, table 150, sink 175, couch 200.
  res = await p.evaluate(() => buyCaveShopItem('furniture', 'lamp'));
  check(res.ok === true, 'buying the lamp with 715 points works');
  res = await p.evaluate(() => buyCaveShopItem('furniture', 'table'));
  check(res.ok === true, 'buying the table works');
  res = await p.evaluate(() => buyCaveShopItem('furniture', 'sink'));
  check(res.ok === true, 'buying the sink works');
  res = await p.evaluate(() => buyCaveShopItem('furniture', 'couch'));
  check(res.ok === true, 'buying the couch works');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 90 && pts.spent === 675, `four furniture pieces cost 625, leaving 90 (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => (loadUserProfile()?.caveOwnedFurniture || []).join() === 'lamp,table,sink,couch'),
    'the furniture purchases are saved in the profile');
  // The bed is the Grizzly piece: never sold for points, never equipped.
  res = await p.evaluate(() => buyCaveShopItem('furniture', 'bed'));
  check(res.ok === false && res.reason === 'grizzly', 'the Grizzly bed cannot be bought with points');
  check(await p.evaluate(() => equipCaveShopItem('furniture', 'bed')) === false,
    'the Grizzly bed cannot be equipped without Grizzly');
  // Equip three, then the cave is full for furniture.
  check(await p.evaluate(() => equipCaveShopItem('furniture', 'lamp')) === true, 'the lamp equips into the cave');
  check(await p.evaluate(() => equipCaveShopItem('furniture', 'table')) === true, 'the table equips into the cave');
  check(await p.evaluate(() => equipCaveShopItem('furniture', 'sink')) === true, 'the sink equips into the cave');
  check(await p.evaluate(() => (loadUserProfile()?.cave?.furniture || []).join() === 'lamp,table,sink'),
    'three furniture pieces sit in the saved cave');
  check(await p.evaluate(() => equipCaveShopItem('furniture', 'couch')) === false,
    'a fourth furniture piece does not fit (max three)');
  // Take the sink out, the couch fits.
  await p.evaluate(() => saveCave({ theme: 'cozy', decor: ['lantern'], furniture: ['lamp', 'table'] }));
  check(await p.evaluate(() => equipCaveShopItem('furniture', 'couch')) === true,
    'after removing a piece the couch fits');
  // A furniture piece you do not own can never be saved, even handed to saveCave.
  await p.evaluate(() => saveCave({ theme: 'cozy', decor: ['lantern'], furniture: ['couch', 'bed'] }));
  check(await p.evaluate(() => (loadUserProfile()?.cave?.furniture || []).join() === 'couch'),
    'saving the unowned bed drops it, the owned couch stays');

  // Pantry: 5 points a food, counts stack, throws use one up.
  check(await p.evaluate(() => pantryCount('pie')) === 0, 'the pantry starts empty');
  res = await p.evaluate(() => buyPantryItem('pie'));
  check(res.ok === true && res.count === 1, 'buying a pie adds one to the pantry');
  res = await p.evaluate(() => buyPantryItem('pie'));
  check(res.ok === true && res.count === 2, 'buying a second pie stacks');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 80, `two pies cost 10, leaving 80 (${JSON.stringify(pts)})`);
  res = await p.evaluate(() => buyPantryItem('nope'));
  check(res.ok === false && res.reason === 'unknown', 'an unknown pantry food is rejected');
  check(await p.evaluate(() => usePantryFood('pie')) === true, 'using a pantry pie works');
  check(await p.evaluate(() => pantryCount('pie')) === 1, 'one pie is left after a throw');
  check(await p.evaluate(() => usePantryFood('pie')) === true, 'the last pie is used');
  check(await p.evaluate(() => pantryCount('pie')) === 0, 'the pantry is empty again');
  check(await p.evaluate(() => usePantryFood('pie')) === false, 'an empty pantry changes nothing (throws still work as today)');

  // The shop UI shows the Furniture and Pantry sections.
  await p.evaluate(() => { closeHandleSettings(); openCaveShop(); });
  await p.waitForFunction(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden'));
  check(await p.locator('#cave-shop-furniture [data-shop-use="furniture:lamp"]').isVisible(),
    'the owned lamp shows a Use button in the Furniture section');
  check(await p.locator('#cave-shop-furniture [data-shop-grizzly="furniture:bed"]').isVisible(),
    'the Grizzly bed shows a Grizzly button, not a price');
  check(await p.locator('#cave-shop-pantry [data-pantry-buy="pie"]').isVisible(),
    'the Pantry section sells pie');
  // Buy a pie from the shop UI and see the pantry count in a food fight.
  await p.locator('#cave-shop-pantry [data-pantry-buy="pie"]').click();
  await p.waitForTimeout(400);
  check(await p.evaluate(() => pantryCount('pie')) === 1, 'buying a pie from the shop UI adds it to the pantry');
  await p.evaluate(() => { closeCaveShop(); openFriendThrow({ to: 'friend1234567', name: 'Friend' }); });
  await p.waitForFunction(() => !!document.querySelector('.fft-food[data-food="pie"] .fft-pantry-count'));
  const badge = await p.locator('.fft-food[data-food="pie"] .fft-pantry-count').innerText();
  check(badge === '×1', `the food fight picker shows the pantry count on the pie ("${badge}")`);
  await p.locator('.fft-close').click();
  await p.waitForTimeout(300);

  check(p.errors.length === 0, `no page errors in the shop (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-shop');
})();
