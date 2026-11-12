// Luxury rooms and objects for the Bear Cave.
// - Four luxury rooms, all bought with LOTS of points (Royal Suite 1500,
//   Spa Retreat 1200, Wine Cellar 1000, Observatory 2000) — never
//   Grizzly, so a bear who has saved up can earn them. Buying is
//   validated (unknown item, already owned, not enough points) and the
//   purchase is recorded in the profile (caveRooms), like the other rooms.
// - Four luxury decorations (Golden Bear Statue 800, Marble Hearth 1000,
//   Golden Candelabra 750, Jeweled Rug 700), also points-priced, never
//   Grizzly, recorded in caveOwnedDecor and placed like any other decor
//   on the graded themes — never pasted on top of a 3D scene.
// - The shop has its own Luxury Rooms and Luxury Decorations sections
//   with a Luxury badge, so the big prices read as aspirational.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/luxshare01': { uid: 'luxUid12345678', u: 'Lux', profile: { picks: [
    { n: 'Tacos Chiwas', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos'], s: ['Horchata'] },
  ], cave: { t: 'midnight', d: ['goldenbear', 'marblehearth'] }, rooms: ['royal'], pts: 2500 } },
  'users/luxUid12345678/meta/profile': { caveRooms: ['observatory'], cave: { theme: 'midnight', decor: ['goldenbear', 'marblehearth'], furniture: [] }, pts: 2500 },
  // A 3D-theme cave with luxury decor: the decor must NOT render on top.
  'profiles/lux3dshare1': { uid: 'lux3dUid12345', u: 'Lux3d', profile: { picks: [], cave: { t: 'forest', d: ['goldenbear', 'marblehearth'] }, pts: 100 } },
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
  // ── 1. The public page: luxury room tabs and luxury decor ──
  await callHandle('luxUid12345678', { method: 'POST', body: { action: 'claim', handle: 'lux_eats', id: 'luxshare01', name: 'Lux' } });
  await callHandle('luxUid12345678', { method: 'POST', body: { action: 'publicPage', on: true } });
  let pg = await view('lux_eats');
  check(pg.status === 200, 'the luxury cave page opens');
  check(/Royal Suite/.test(pg.html), 'the page shows the live-published Royal Suite room');
  check(/Observatory/.test(pg.html), 'the page also shows the Observatory room from the saved profile');
  check(/scene-room-royal-3d\.jpg/.test(pg.html), 'the page carries the Royal Suite room scene');
  check(/decor-lux-goldenbear\.jpg/.test(pg.html), 'the page renders the Golden Bear Statue on the graded Midnight theme');
  check(/decor-lux-marblehearth\.jpg/.test(pg.html), 'the page renders the Marble Hearth on the graded Midnight theme');
  // A 3D-theme cave never shows placed decor — not even luxury pieces.
  await callHandle('lux3dUid12345', { method: 'POST', body: { action: 'claim', handle: 'lux3d_eats', id: 'lux3dshare1', name: 'Lux3d' } });
  await callHandle('lux3dUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  pg = await view('lux3d_eats');
  check(pg.status === 200 && !/decor-lux-goldenbear\.jpg/.test(pg.html) && !/decor-lux-marblehearth\.jpg/.test(pg.html),
    'a 3D-theme cave hides the luxury decor instead of pasting it on the scene');

  // ── 2. App: buying luxury rooms and objects with points ──
  const browser = await launch();
  const spot = i => ({
    id: `s${i}`, name: `Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [],
  });
  const seed = Array.from({ length: 210 }, (_, i) => spot(i)); // 210 spots = 2100 points
  const p = await newPage(browser, { seed, settings: {} });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'lux', public: true, views: 5, joins: 2, votes: 3 } });
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
  await p.evaluate(() => { window._ftbUid = 'luxUid12345678'; });

  let pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 2100 && pts.lifetime === 2100, `210 spots is 2100 points to spend (${JSON.stringify(pts)})`);

  // Luxury is points-priced, never Grizzly: the catalog says so, and a
  // too-poor buyer gets "points", not "grizzly".
  check(await p.evaluate(() => CAVE_SHOP_ROOMS.observatory.grizzly === false && CAVE_SHOP_ROOMS.observatory.price === 2000),
    'the Observatory is points-priced at 2000, not Grizzly');
  check(await p.evaluate(() => CAVE_SHOP_DECOR.marblehearth.grizzly === false && CAVE_SHOP_DECOR.marblehearth.price === 1000),
    'the Marble Hearth is points-priced at 1000, not Grizzly');
  check(await p.evaluate(() => CAVE_SHOP_ROOMS.royal.luxury === true && CAVE_SHOP_DECOR.goldenbear.luxury === true),
    'luxury rooms and objects are flagged luxury');

  // Wine Cellar 1000: balance drops to 1100, the purchase is recorded.
  let res = await p.evaluate(() => buyCaveShopItem('room', 'wine'));
  check(res.ok === true, 'buying the Wine Cellar with 2100 points works');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 1100 && pts.spent === 1000 && pts.lifetime === 2100,
    `the Wine Cellar costs 1000, leaving 1100 to spend (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => (loadUserProfile()?.caveRooms || []).includes('wine')),
    'the Wine Cellar purchase is saved in the profile (caveRooms)');
  // Golden Bear Statue 800: balance drops to 300.
  res = await p.evaluate(() => buyCaveShopItem('decor', 'goldenbear'));
  check(res.ok === true, 'buying the Golden Bear Statue with 1100 points works');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 300 && pts.spent === 1800, `the statue costs 800, leaving 300 (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => (loadUserProfile()?.caveOwnedDecor || []).includes('goldenbear')),
    'the statue purchase is saved in the profile (caveOwnedDecor)');
  // The Observatory (2000) and Royal Suite (1500) are out of reach with
  // 300 points; buying twice is blocked; unknown items are rejected.
  res = await p.evaluate(() => buyCaveShopItem('room', 'observatory'));
  check(res.ok === false && res.reason === 'points' && res.need === 1700,
    'the 2000-point Observatory is blocked with 300 points (need 1700 more)');
  res = await p.evaluate(() => buyCaveShopItem('room', 'royal'));
  check(res.ok === false && res.reason === 'points' && res.need === 1200,
    'the 1500-point Royal Suite is blocked with 300 points (need 1200 more)');
  res = await p.evaluate(() => buyCaveShopItem('decor', 'marblehearth'));
  check(res.ok === false && res.reason === 'points' && res.need === 700,
    'the 1000-point Marble Hearth is blocked with 300 points (need 700 more)');
  res = await p.evaluate(() => buyCaveShopItem('room', 'wine'));
  check(res.ok === false && res.reason === 'owned', 'buying the Wine Cellar twice is blocked');
  res = await p.evaluate(() => buyCaveShopItem('decor', 'goldenbear'));
  check(res.ok === false && res.reason === 'owned', 'buying the statue twice is blocked');
  res = await p.evaluate(() => buyCaveShopItem('room', 'penthouse'));
  check(res.ok === false && res.reason === 'unknown', 'an unknown luxury room is rejected');
  // Earn 2000 more points, then the Observatory (2000) fits.
  await p.evaluate(() => {
    for (let i = 0; i < 200; i++) state.restaurants.push({ id: `rx${i}`, name: `Lux Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [] });
  });
  res = await p.evaluate(() => buyCaveShopItem('room', 'observatory'));
  check(res.ok === true, 'buying the Observatory after earning more points works');
  check(await p.evaluate(() => caveOwnedRooms().join() === 'wine,observatory'),
    'owned luxury rooms come back in catalog order');
  check(await p.evaluate(() => buildProfileData().rooms.join() === 'wine,observatory'),
    'the live profile publishes the owned luxury rooms');
  // Spending on luxury never un-unlocks the fireplace: lifetime is intact.
  check(await p.evaluate(() => caveUnlockedIds().has('fireplace')) === true,
    'the fireplace stays unlocked after spending 3800 points on luxury');

  // ── 3. The shop UI: Luxury sections, badge, Buy and View buttons ──
  await p.evaluate(() => openCaveShop());
  await p.waitForFunction(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden'));
  check(await p.locator('#cave-shop-luxury-rooms').innerText().then(t => /Royal Suite/.test(t) && /Observatory/.test(t) && /2000 pts/.test(t)),
    'the shop has a Luxury Rooms section with the Royal Suite and the 2000-point Observatory');
  check(await p.locator('#cave-shop-luxury-decor').innerText().then(t => /Golden Bear Statue/.test(t) && /Marble Hearth/.test(t)),
    'the shop has a Luxury Decorations section with the statue and the hearth');
  check(await p.locator('.cave-shop-luxury').first().isVisible(),
    'luxury cards carry a Luxury badge');
  check(await p.locator('#cave-shop-luxury-rooms [data-shop-view="room:observatory"]').isVisible(),
    'the owned Observatory shows a View button, not a price');
  check(await p.locator('#cave-shop-luxury-rooms [data-shop-buy="room:royal"]').count() === 0,
    'the 1500-point Royal Suite shows no Buy button with 300 points');
  check(await p.locator('#cave-shop-luxury-decor [data-shop-buy="decor:marblehearth"]').count() === 0,
    'the 1000-point Marble Hearth shows no Buy button with 300 points');
  check(await p.locator('#cave-shop-rooms').innerText().then(t => !/Royal Suite/.test(t) && !/Observatory/.test(t)),
    'the plain Rooms section does not repeat the luxury rooms');

  // ── 4. Luxury decor places on a graded theme, never on a 3D scene ──
  // Buy the Midnight Den theme (200) and put it in the cave, then place
  // the Golden Bear Statue in it.
  res = await p.evaluate(() => buyCaveShopItem('theme', 'midnight'));
  check(res.ok === true, 'buying the Midnight Den theme works');
  // The purchase happened outside the shop UI, so re-render it before
  // clicking the Use button the card now shows.
  await p.evaluate(() => renderCaveShop());
  await p.locator('#cave-shop-themes [data-shop-use="theme:midnight"]').click();
  await p.waitForTimeout(300);
  await p.locator('#cave-shop-luxury-decor [data-shop-use="decor:goldenbear"]').click();
  await p.waitForTimeout(300);
  await p.evaluate(() => { closeCaveShop(); openHandleSettings(); });
  await p.waitForFunction(() => !!document.querySelector('#cave-room-tabs .cave-room-tab'));
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview')?.innerHTML.includes('decor-lux-goldenbear.jpg')),
    'the statue shows in the preview on the graded Midnight theme');
  // Luxury room tabs: switch the preview to the Observatory.
  const tabsText = await p.locator('#cave-room-tabs').innerText();
  check(/Wine Cellar/.test(tabsText) && /Observatory/.test(tabsText),
    `the setup shows Wine Cellar and Observatory tabs ("${tabsText.replace(/\s+/g, ' ')}")`);
  await p.locator('#cave-room-tabs [data-room="observatory"]').click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-scene')?.className.includes('cave-room-observatory')),
    'tapping the Observatory tab switches the preview to the Observatory scene');
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-caption')?.innerText.includes('Observatory')),
    'the preview caption reads Observatory while the room is showing');
  // Back to the living room: the Midnight theme scene returns.
  await p.locator('#cave-room-tabs [data-room=""]').click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-scene')?.className.includes('cave-theme-midnight')),
    'tapping Living Room brings back the Midnight theme scene');
  // Switch the cave to the Forest 3D scene: the placed statue disappears.
  await p.evaluate(() => { saveCave({ theme: 'forest', decor: ['goldenbear'], furniture: [] }); renderCaveSetup(); });
  await p.waitForTimeout(300);
  check(await p.evaluate(() => !document.querySelector('#cave-setup-preview')?.innerHTML.includes('decor-lux-goldenbear.jpg')),
    'the statue is hidden in the preview on the Forest 3D scene');
  // The View button in the shop walks straight into the Observatory.
  await p.evaluate(() => { openCaveShop(); });
  await p.waitForFunction(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden'));
  await p.locator('#cave-shop-luxury-rooms [data-shop-view="room:observatory"]').click();
  await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('cave-shop-overlay')?.classList.contains('hidden')),
    'View closes the shop');
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-scene')?.className.includes('cave-room-observatory')),
    'View walks into the Observatory scene');

  check(p.errors.length === 0, `no page errors in the luxury test (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-luxury');
})();
