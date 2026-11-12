// Earnable add-on rooms for the Bear Cave.
// - Six rooms, all bought with points (Kitchen 300, Bedroom 400, Pantry
//   250, Game Room 350, Bathroom 300, Library 450). Buying is validated
//   (unknown item, already owned, not enough points) and the purchase is
//   recorded in the profile (caveRooms), so it follows the owner to every
//   device and to their public cave page.
// - The cave shows room tabs (Living Room + owned rooms). Tapping a tab
//   swaps the full scene to that room's 3D picture — nothing is pasted
//   on top of a room scene, the same one-image rule as the themes.
// - The public cave page shows the owner's rooms as tabs too (union of
//   the saved profile and the live publish); a cave with no rooms shows
//   no tabs at all.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/roomshare01': { uid: 'roomUid1234567', u: 'Roomy', profile: { picks: [
    { n: 'Tacos Chiwas', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos'], s: ['Horchata'] },
  ], cave: { t: 'forest', d: ['lights', 'plant'] }, rooms: ['kitchen', 'bedroom'], pts: 560 } },
  'users/roomUid1234567/meta/profile': { caveRooms: ['pantry'], cave: { theme: 'forest', decor: ['lights', 'plant'], furniture: [] }, pts: 560 },
  'profiles/noroomshare1': { uid: 'noroomUid12345', u: 'Noroom', profile: { picks: [], cave: { t: 'cozy', d: ['lights', 'plant'] }, pts: 40 } },
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
  // ── 1. The public page shows the owner's rooms as tabs ──
  await callHandle('roomUid1234567', { method: 'POST', body: { action: 'claim', handle: 'roomy_eats', id: 'roomshare01', name: 'Roomy' } });
  await callHandle('roomUid1234567', { method: 'POST', body: { action: 'publicPage', on: true } });
  let pg = await view('roomy_eats');
  check(pg.status === 200, 'the room cave page opens');
  check(/Living Room/.test(pg.html), 'the page shows a Living Room tab');
  check(/Kitchen/.test(pg.html) && /Bedroom/.test(pg.html), 'the page shows the live-published Kitchen and Bedroom rooms');
  check(/Pantry/.test(pg.html), 'the page also shows the Pantry room from the saved profile');
  check(/scene-room-kitchen-3d\.jpg/.test(pg.html), 'the page carries the Kitchen room scene');
  check(/data-cave-room/.test(pg.html), 'the page has the room-tab switcher');
  check(/DOMContentLoaded/.test(pg.html), 'the room-tab script waits for the page (the caption sits below the tabs)');
  check(/Forest Cave/.test(pg.html), 'the page still shows the Forest theme as the living room');
  // A cave with no rooms shows no tabs at all.
  await callHandle('noroomUid12345', { method: 'POST', body: { action: 'claim', handle: 'noroom_eats', id: 'noroomshare1', name: 'Noroom' } });
  await callHandle('noroomUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  pg = await view('noroom_eats');
  check(pg.status === 200 && !/data-room=/.test(pg.html), 'a cave with no rooms shows no room tabs');

  // ── 2. App: buying rooms with points ──
  const browser = await launch();
  const spot = i => ({
    id: `s${i}`, name: `Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [],
  });
  const seed = Array.from({ length: 50 }, (_, i) => spot(i)); // 50 spots = 500 points
  const p = await newPage(browser, { seed, settings: {} });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'roomy', public: true, views: 5, joins: 2, votes: 3 } });
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
  await p.evaluate(() => { window._ftbUid = 'roomUid1234567'; });

  let pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 500 && pts.lifetime === 500, `fifty spots is 500 points to spend (${JSON.stringify(pts)})`);

  // Kitchen 300: balance drops to 200, the purchase is recorded.
  let res = await p.evaluate(() => buyCaveShopItem('room', 'kitchen'));
  check(res.ok === true, 'buying the Kitchen with 500 points works');
  pts = await p.evaluate(() => cavePoints());
  check(pts.balance === 200 && pts.spent === 300 && pts.lifetime === 500,
    `the Kitchen costs 300, leaving 200 to spend (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => (loadUserProfile()?.caveRooms || []).includes('kitchen')),
    'the Kitchen purchase is saved in the profile (caveRooms)');
  // Buying it again is blocked; an unknown room is rejected; the 450-point
  // Library is out of reach with 200 points.
  res = await p.evaluate(() => buyCaveShopItem('room', 'kitchen'));
  check(res.ok === false && res.reason === 'owned', 'buying the Kitchen twice is blocked');
  res = await p.evaluate(() => buyCaveShopItem('room', 'nope'));
  check(res.ok === false && res.reason === 'unknown', 'an unknown room is rejected');
  res = await p.evaluate(() => buyCaveShopItem('room', 'library'));
  check(res.ok === false && res.reason === 'points' && res.need === 250,
    'the 450-point Library is blocked with 200 points (need 250 more)');
  // Earn 300 more points, then the Bedroom (400) fits.
  await p.evaluate(() => {
    for (let i = 0; i < 30; i++) state.restaurants.push({ id: `rx${i}`, name: `Room Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [] });
  });
  res = await p.evaluate(() => buyCaveShopItem('room', 'bedroom'));
  check(res.ok === true, 'buying the Bedroom after earning more points works');
  check(await p.evaluate(() => caveOwnedRooms().join() === 'kitchen,bedroom'),
    'owned rooms come back in catalog order');
  check(await p.evaluate(() => buildProfileData().rooms.join() === 'kitchen,bedroom'),
    'the live profile publishes the owned rooms');
  // Spending on rooms never un-unlocks the fireplace: lifetime is intact.
  check(await p.evaluate(() => caveUnlockedIds().has('fireplace')) === true,
    'the fireplace stays unlocked after spending 700 points on rooms');

  // ── 3. The shop UI: Rooms section, Buy and View buttons ──
  await p.evaluate(() => openCaveShop());
  await p.waitForFunction(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden'));
  check(await p.locator('#cave-shop-rooms').innerText().then(t => /Kitchen/.test(t) && /Library/.test(t)),
    'the shop has a Rooms section with the Kitchen and Library');
  check(await p.locator('#cave-shop-rooms [data-shop-view="room:kitchen"]').isVisible(),
    'the owned Kitchen shows a View button, not a price');
  check(await p.locator('#cave-shop-rooms [data-shop-buy="room:library"]').count() === 0,
    'the 450-point Library shows no Buy button with 100 points');
  check(await p.locator('#cave-shop-rooms [data-shop-buy="room:pantry"]').count() === 0,
    'the 250-point Pantry shows no Buy button with 100 points either');

  // ── 4. Room tabs in the cave setup: switch the preview scene ──
  await p.evaluate(() => { closeCaveShop(); openHandleSettings(); });
  await p.waitForFunction(() => !!document.querySelector('#cave-room-tabs .cave-room-tab'));
  const tabsText = await p.locator('#cave-room-tabs').innerText();
  check(/Living Room/.test(tabsText) && /Kitchen/.test(tabsText) && /Bedroom/.test(tabsText),
    `the setup shows Living Room, Kitchen and Bedroom tabs ("${tabsText.replace(/\s+/g, ' ')}")`);
  // Tap the Kitchen tab: the preview becomes the Kitchen scene.
  await p.locator('#cave-room-tabs [data-room="kitchen"]').click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-scene')?.className.includes('cave-room-kitchen')),
    'tapping the Kitchen tab switches the preview to the Kitchen scene');
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-caption')?.innerText.includes('Kitchen')),
    'the preview caption reads Kitchen while the room is showing');
  // Back to the living room: the theme scene returns.
  await p.locator('#cave-room-tabs [data-room=""]').click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-scene')?.className.includes('cave-theme-cozy')),
    'tapping Living Room brings back the theme scene');
  // The View button in the shop walks straight into the room (the shop
  // opens over the cave setup, so closing it reveals the room preview).
  await p.evaluate(() => { openCaveShop(); });
  await p.waitForFunction(() => !document.getElementById('cave-shop-overlay')?.classList.contains('hidden'));
  await p.locator('#cave-shop-rooms [data-shop-view="room:kitchen"]').click();
  await p.waitForTimeout(400);
  check(await p.evaluate(() => document.getElementById('cave-shop-overlay')?.classList.contains('hidden')),
    'View closes the shop');
  check(await p.evaluate(() => document.querySelector('#cave-setup-preview .cave-preview-scene')?.className.includes('cave-room-kitchen')),
    'View walks into the Kitchen scene');
  // Viewing a room never changes the saved cave (nothing was ever saved
  // here, so the profile simply has no cave yet — still the cozy default).
  check(await p.evaluate(() => { const c = loadUserProfile()?.cave; return !c || c.theme === 'cozy'; }),
    'browsing rooms leaves the saved cave theme untouched');

  check(p.errors.length === 0, `no page errors in the rooms test (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-rooms');
})();
