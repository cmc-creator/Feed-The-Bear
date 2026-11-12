// Seasonal caves: limited-time 3D scenes in the Cave Shop.
// - Halloween is on sale until Nov 15, 2026; Christmas Dec 1–31, 2026.
//   Both cost 500 points so anyone can earn them.
// - The shop hides a seasonal cave outside its window (owners still see
//   theirs, so they can keep using it after it closes).
// - Buying outside the window is rejected, even from a crafted call,
//   and a seasonal theme you do not own can never be saved.
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const spot = i => ({
    id: `s${i}`, name: `Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [],
  });
  // 105 spots = 1050 points: enough for both seasonal caves (500 each).
  const seed = Array.from({ length: 105 }, (_, i) => spot(i));
  const p = await newPage(browser, { seed, settings: {} });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'seasonal', public: true, views: 5, joins: 2, votes: 3 } });
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
  await p.evaluate(() => { window._ftbUid = 'seasonalUid1'; });

  // ── 1. The window: Halloween ends Nov 15, Christmas is Dec 1–31 ──
  const windows = await p.evaluate(() => ({
    halloweenNow: caveSeasonalAvailable(CAVE_SHOP_THEMES.halloween, new Date('2026-11-11')),
    halloweenLastDay: caveSeasonalAvailable(CAVE_SHOP_THEMES.halloween, new Date('2026-11-15')),
    halloweenAfter: caveSeasonalAvailable(CAVE_SHOP_THEMES.halloween, new Date('2026-11-16')),
    christmasEarly: caveSeasonalAvailable(CAVE_SHOP_THEMES.christmas, new Date('2026-11-11')),
    christmasFirst: caveSeasonalAvailable(CAVE_SHOP_THEMES.christmas, new Date('2026-12-01')),
    christmasLast: caveSeasonalAvailable(CAVE_SHOP_THEMES.christmas, new Date('2026-12-31')),
    christmasAfter: caveSeasonalAvailable(CAVE_SHOP_THEMES.christmas, new Date('2027-01-01')),
    halloweenLabel: caveSeasonalWindowLabel(CAVE_SHOP_THEMES.halloween),
    christmasLabel: caveSeasonalWindowLabel(CAVE_SHOP_THEMES.christmas),
  }));
  check(windows.halloweenNow === true && windows.halloweenLastDay === true, 'Halloween is on sale through Nov 15');
  check(windows.halloweenAfter === false, 'Halloween is gone on Nov 16');
  check(windows.christmasEarly === false && windows.christmasFirst === true, 'Christmas opens Dec 1, not before');
  check(windows.christmasLast === true && windows.christmasAfter === false, 'Christmas ends Dec 31');
  check(windows.halloweenLabel === 'Until Nov 15', `Halloween shows its end date ("${windows.halloweenLabel}")`);
  check(windows.christmasLabel === 'Dec 1 – Dec 31', `Christmas shows its window ("${windows.christmasLabel}")`);

  // ── 1b. The shop UI before buying: visibility matches the window ──
  const uiBefore = await p.evaluate(() => {
    openCaveShop();
    const grid = document.getElementById('cave-shop-themes');
    const out = {
      text: grid.innerText,
      halloween: grid.innerText.includes('Halloween Cave'),
      christmas: grid.innerText.includes('Christmas Cave'),
      halloweenAvailable: caveSeasonalAvailable(CAVE_SHOP_THEMES.halloween),
      christmasAvailable: caveSeasonalAvailable(CAVE_SHOP_THEMES.christmas),
    };
    closeCaveShop();
    return out;
  });
  check(uiBefore.halloween === uiBefore.halloweenAvailable, 'the shop shows Halloween exactly when it is on sale');
  check(uiBefore.christmas === uiBefore.christmasAvailable, 'the shop shows Christmas exactly when it is on sale');
  if (uiBefore.halloween) check(/Limited time/.test(uiBefore.text) && /Until Nov 15/.test(uiBefore.text), 'Halloween carries its Limited-time badge');
  if (uiBefore.christmas) check(/Limited time/.test(uiBefore.text) && /Dec 1/.test(uiBefore.text), 'Christmas carries its Limited-time badge');

  // ── 2. Buying: out of window is rejected, in window costs 500 ──
  let res = await p.evaluate(() => buyCaveShopItem('theme', 'halloween', new Date('2026-11-16')));
  check(res.ok === false && res.reason === 'seasonal', 'buying Halloween on Nov 16 is rejected');
  res = await p.evaluate(() => buyCaveShopItem('theme', 'christmas', new Date('2026-11-11')));
  check(res.ok === false && res.reason === 'seasonal', 'buying Christmas in November is rejected');
  // A seasonal theme you do not own can never be saved, even handed to saveCave.
  await p.evaluate(() => saveCave({ theme: 'christmas', decor: [] }));
  check(await p.evaluate(() => loadUserProfile()?.cave?.theme) === 'cozy', 'saving the unowned Christmas Cave falls back to cozy');

  let pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 1050, `105 spots is 1050 points to spend (${JSON.stringify(pts)})`);
  res = await p.evaluate(() => buyCaveShopItem('theme', 'halloween', new Date('2026-11-11')));
  check(res.ok === true, 'buying Halloween in window works');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 550 && pts.spent === 500, `Halloween costs 500, leaving 550 (${JSON.stringify(pts)})`);
  res = await p.evaluate(() => buyCaveShopItem('theme', 'christmas', new Date('2026-12-15')));
  check(res.ok === true, 'buying Christmas in window works');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 50 && pts.spent === 1000, `Christmas costs 500, leaving 50 (${JSON.stringify(pts)})`);
  res = await p.evaluate(() => buyCaveShopItem('theme', 'halloween', new Date('2026-11-11')));
  check(res.ok === false && res.reason === 'owned', 'buying Halloween twice is blocked');
  // Owned seasonal themes equip and stay equipped.
  check(await p.evaluate(() => equipCaveShopItem('theme', 'halloween')) === true, 'the owned Halloween Cave equips');
  check(await p.evaluate(() => loadUserProfile()?.cave?.theme) === 'halloween', 'Halloween is the live cave theme');
  await p.evaluate(() => saveCave({ theme: 'christmas', decor: [] }));
  check(await p.evaluate(() => loadUserProfile()?.cave?.theme) === 'christmas', 'the owned Christmas Cave saves');

  // ── 3. The shop UI: in-window caves show with a Limited-time badge;
  // out-of-window ones hide — unless you already own them. ──
  const ui = await p.evaluate(() => {
    openCaveShop();
    const grid = document.getElementById('cave-shop-themes');
    return {
      text: grid.innerText,
      halloween: grid.innerText.includes('Halloween Cave'),
      christmas: grid.innerText.includes('Christmas Cave'),
      halloweenAvailable: caveSeasonalAvailable(CAVE_SHOP_THEMES.halloween),
      christmasAvailable: caveSeasonalAvailable(CAVE_SHOP_THEMES.christmas),
    };
  });
  check(ui.halloween === true && ui.christmas === true, 'owned seasonal caves stay in the shop after their window');
  check(/Limited time/.test(ui.text) && /Until Nov 15/.test(ui.text) && /Dec 1 – Dec 31/.test(ui.text),
    'seasonal cards carry the Limited-time badge and their dates');
  check(/In your cave/.test(ui.text), 'the equipped Christmas Cave shows as in your cave');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-seasonal');
})();
