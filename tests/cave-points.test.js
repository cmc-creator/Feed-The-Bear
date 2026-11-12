// Cave points + hyper-realistic caves.
// - Points are earned by using the app (spot +10, dish rated +5, visit +5,
//   list shared +10) and unlock new cave decor at 50 / 100 / 250 points.
//   Unlocks are sticky; a locked decoration can never be saved.
// - The public cave page is one 3D-rendered scene per theme (light pools,
//   wall grain, vignette); a 3D-scene theme shows no pasted decorations,
//   while the graded shop themes still place decor in the scene. It
//   shows the creator's points.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/connieshare01': { uid: 'connieUid12345', u: 'Connie', profile: { picks: [
    { n: 'Tacos Chiwas', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos'], s: ['Horchata'] },
  ], cave: { t: 'forest', d: ['lights', 'fireplace', 'barcart'] }, pts: 265 } },
  'profiles/samshare0001': { uid: 'samUid1234567', u: 'Sam', profile: { picks: [] } },
  'profiles/bogusshare01': { uid: 'bogusUid12345', u: 'Bogus', profile: { picks: [], cave: { t: 'midnight', d: ['bogus', 'rug'] } } },
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
  // ── 1. The public page: new decor, points, and the realistic scene ──
  await callHandle('connieUid12345', { method: 'POST', body: { action: 'claim', handle: 'connie_eats', id: 'connieshare01', name: 'Connie' } });
  await callHandle('connieUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  let pg = await view('connie_eats');
  check(pg.status === 200, 'the cave page opens');
  check(/scene-forest-3d\.jpg/.test(pg.html), 'the page shows the Forest 3D scene');
  check(!/cave-decor-item decor-/.test(pg.html), 'a 3D-scene theme shows no pasted decorations — the scene is the whole room');
  check(/265 cave points/.test(pg.html), 'the page shows the creator’s points');
  check(/class="cave-scene"/.test(pg.html), 'the cave renders as a scene, not a flat row');
  check(/radial-gradient/.test(pg.html), 'the scene has warm light pools');
  check(/feTurbulence/.test(pg.html), 'the scene has a grainy wall texture');

  // Unknown decor is still dropped; a cave with no points shows no badge.
  await callHandle('bogusUid12345', { method: 'POST', body: { action: 'claim', handle: 'bogus_eats', id: 'bogusshare01', name: 'Bogus' } });
  await callHandle('bogusUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  pg = await view('bogus_eats');
  check(pg.status === 200 && /decor-rug\.jpg/.test(pg.html) && !/decor-fireplace\.jpg/.test(pg.html), 'an unknown decoration is dropped, the rug stays');
  check(!/class="cave-points"/.test(pg.html), 'a cave with no points shows no points badge');
  await callHandle('samUid1234567', { method: 'POST', body: { action: 'claim', handle: 'sam_eats', id: 'samshare0001', name: 'Sam' } });
  await callHandle('samUid1234567', { method: 'POST', body: { action: 'publicPage', on: true } });
  pg = await view('sam_eats');
  check(pg.status === 200 && !/class="cave-points"/.test(pg.html), 'a cave with no setup and no points stays clean');

  // ── 2. App: points math, locks, and unlocks ──
  const browser = await launch();
  const spotA = (visits, dishes) => ({
    id: 'sA', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits, dateAdded: '2026-11-01', updatedAt: 1,
    dishes: dishes ?? [{ id: 'd1', name: 'Green Chile Burrito', verdict: 'again', rating: 5, note: '', date: '2026-11-10' }],
  });
  const spotB = { id: 'sB', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 4, tags: [], visits: [], dateAdded: '2026-11-03', updatedAt: 1, dishes: [] };
  const sharedList = { col1: { token: 'tok12345678', cloudId: null, ownerName: 'Connie', collaborators: [], activity: [], updatedAt: 1, createdBy: 'connieUid12345' } };

  const openApp = async (seed, settings) => {
    const p = await newPage(browser, { seed, settings });
    await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
    await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
    await p.route('**/api/handle**', async rt => {
      const req = rt.request();
      if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
      if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'connie', public: true, views: 5, joins: 2, votes: 3 } });
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
    await p.evaluate(() => { window._ftbUid = 'connieUid12345'; });
    return p;
  };

  // Seed A: 2 spots (20) + 1 rated dish (5) = 25 points. Below the first tier.
  let p = await openApp([spotA([], undefined), spotB], {});
  let pts = await p.evaluate(() => cavePoints());
  check(pts.total === 25 && pts.spots === 2 && pts.dishes === 1 && pts.visits === 0 && pts.lists === 0,
    `points add up from what you did (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => JSON.stringify(nextCaveUnlock())) === JSON.stringify({ id: 'fireplace', label: 'Stone fireplace', emoji: '🔥', points: 50 }),
    'below 50 points the next unlock is the fireplace at 50');
  check(await p.evaluate(() => caveUnlockedIds().has('fireplace')) === false, 'the fireplace is locked below 50 points');
  // A locked decoration can never be saved, even if it is handed to saveCave.
  await p.evaluate(() => saveCave({ theme: 'cozy', decor: ['lights', 'fireplace'] }));
  check(await p.evaluate(() => JSON.stringify(loadUserProfile()?.cave?.decor)) === JSON.stringify(['lights']),
    'saving a locked decoration drops it');
  check(await p.evaluate(() => buildProfileData().pts) === 25, 'the share link data carries the points');
  // Sticky unlocks: a stored unlock survives even when the points total is low.
  check(await p.evaluate(() => {
    const prof = loadUserProfile() || { name: 'Connie', avatar: '🧸', joinDate: new Date().toISOString() };
    saveUserProfile({ ...prof, caveUnlocked: ['barcart'] });
    return caveUnlockedIds().has('barcart');
  }) === true, 'a stored unlock stays unlocked below its tier');
  await p.evaluate(() => saveCave({ theme: 'cozy', decor: ['lights', 'barcart'] }));
  check(await p.evaluate(() => (loadUserProfile()?.cave?.decor || []).includes('barcart')),
    'a sticky unlocked decoration can be saved');
  check(p.errors.length === 0, `no page errors on the 25-point cave (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  // Seed B: 2 spots (20) + 1 rated dish (5) + 3 visits (15) + 1 shared list (10) = 50 points exactly.
  const v = { date: '2026-11-09', note: '', rating: 5 };
  p = await openApp([spotA([{ ...v }, { ...v, date: '2026-11-10' }, { ...v, date: '2026-11-10', rating: 4 }], undefined), spotB],
    { sharedLists: sharedList });
  pts = await p.evaluate(() => cavePoints());
  check(pts.total === 50 && pts.visits === 3 && pts.lists === 1,
    `50 points at the tier boundary (${JSON.stringify(pts)})`);
  check(await p.evaluate(() => JSON.stringify(refreshCaveUnlocks())) === JSON.stringify(['fireplace']),
    'crossing 50 points unlocks the fireplace');
  check(await p.evaluate(() => JSON.stringify(refreshCaveUnlocks())) === JSON.stringify([]),
    'the unlock is stored, so it is not reported twice');
  check(await p.evaluate(() => (loadUserProfile()?.caveUnlocked || []).includes('fireplace')),
    'the unlock is saved in the profile');
  check(await p.evaluate(() => JSON.stringify(nextCaveUnlock())) === JSON.stringify({ id: 'shelf', label: 'Cookbook shelf', emoji: '📚', points: 100 }),
    'at 50 points the next unlock is the cookbook shelf at 100');

  // The setup flow shows the points, the next unlock, and the unlocked chip.
  await p.evaluate(() => openHandleSettings());
  await p.waitForFunction(() => !document.getElementById('handle-overlay')?.classList.contains('hidden'));
  await p.waitForFunction(() => /50 points/.test(document.getElementById('cave-points')?.innerText || ''));
  const pointsText = await p.locator('#cave-points').innerText();
  check(/Next unlock: Cookbook shelf at 100 points/.test(pointsText), `the setup names the next unlock ("${pointsText.replace(/\s+/g, ' ')}")`);
  check(/Save a spot \+10 · Rate a dish \+5 · Log a visit \+5 · Share a list \+10/.test(pointsText), 'the setup shows how points are earned');
  check(await p.locator('#cave-decor-picks [data-decor="fireplace"]').isVisible(), 'the unlocked fireplace chip shows in setup');
  check(await p.locator('#cave-decor-picks [data-decor="fireplace"]').evaluate(el => !el.classList.contains('locked')),
    'the fireplace chip is no longer locked at 50 points');
  check(await p.locator('#cave-decor-picks [data-decor="shelf"]').evaluate(el => el.classList.contains('locked') && /100 pts/.test(el.innerText)),
    'the cookbook shelf stays locked and shows its price below 100 points');
  await p.locator('#cave-decor-picks [data-decor="fireplace"]').click();
  await p.click('#cave-save-btn');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => (loadUserProfile()?.cave?.decor || []).includes('fireplace')),
    'the fireplace saves once unlocked');
  const myPage = await p.locator('#settings-handle .my-page').innerText();
  check(/50 cave points/.test(myPage), `my page shows the points ("${myPage.replace(/\s+/g, ' ')}")`);
  check(p.errors.length === 0, `no page errors on the 50-point cave (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-points');
})();
