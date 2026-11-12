// Bear Cave themes: all 12 themes are selectable in setup, each renders a
// distinct look on the public page and in the in-app preview, and switching
// themes persists across reload. Existing themes keep working.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

const THEMES = {
  cozy: 'Cozy Cave', forest: 'Forest Cave', neon: 'Neon Cave', pastel: 'Pastel Cave',
  witchy: 'Witchy Cave', elf: 'Elf Cave', cute: 'Cute Cave', mancave: 'Man Cave',
  beach: 'Beach Cave', winter: 'Winter Cave', cosmic: 'Cosmic Cave', jungle: 'Jungle Cave',
};
const THEME_IDS = Object.keys(THEMES);

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/themeuser01': { uid: 'themeUid12345', u: 'Themer', profile: { picks: [], cave: { t: 'cozy', d: ['lights'] } } },
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
  // ── 1. The public page renders every theme with its own look ──
  await callHandle('themeUid12345', { method: 'POST', body: { action: 'claim', handle: 'themer_eats', id: 'themeuser01', name: 'Themer' } });
  await callHandle('themeUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  const accents = new Set();
  for (const id of THEME_IDS) {
    docs['profiles/themeuser01'].profile.cave = { t: id, d: ['lights'] };
    const pg = await view('themer_eats');
    check(pg.status === 200, `the cave page opens for ${THEMES[id]}`);
    check(new RegExp(`data-cave-theme="${id}"`).test(pg.html), `the page carries the ${THEMES[id]} theme`);
    check(pg.html.includes(THEMES[id]), `the page names the ${THEMES[id]} theme`);
    const m = pg.html.match(new RegExp(`body\\[data-cave-theme="${id}"\\][^}]*--accent: ([^;]+);`));
    check(!!m, `the page defines scene colours for ${THEMES[id]}`);
    if (m) accents.add(m[1].trim());
  }
  check(accents.size === THEME_IDS.length, `every theme has a distinct accent colour (${accents.size} of ${THEME_IDS.length})`);
  docs['profiles/themeuser01'].profile.cave = { t: 'nope', d: ['lights'] };
  const fallback = await view('themer_eats');
  check(/data-cave-theme="cozy"/.test(fallback.html), 'an unknown theme falls back to Cozy Cave');

  // ── 2. App: setup offers all 12, switching persists ──
  const browser = await launch();
  const seed = () => ([
    { id: 'sA', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [] },
  ]);
  const p = await newPage(browser, { seed: seed() });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'themer', public: true, views: 5, joins: 2, votes: 3 } });
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

  await p.evaluate(() => { window._ftbUid = 'themeUid12345'; });
  await p.evaluate(() => openHandleSettings());
  await p.waitForFunction(() => !document.getElementById('handle-overlay')?.classList.contains('hidden'));
  await p.waitForFunction(() => document.querySelectorAll('#cave-theme-picks [data-theme]').length > 0);

  // Every theme is offered, and the preview banner looks different per theme.
  const offered = await p.evaluate(() => [...document.querySelectorAll('#cave-theme-picks [data-theme]')].map(b => b.dataset.theme));
  check(THEME_IDS.every(id => offered.includes(id)), `setup offers all 12 themes (${offered.length} offered)`);
  const bannerLooks = new Set();
  for (const id of THEME_IDS) {
    await p.locator(`#cave-theme-picks [data-theme="${id}"]`).click();
    await p.waitForTimeout(120);
    bannerLooks.add(await p.evaluate(() => getComputedStyle(document.querySelector('.cave-preview-scene')).backgroundImage));
  }
  check(bannerLooks.size === THEME_IDS.length, `every theme preview looks distinct (${bannerLooks.size} of ${THEME_IDS.length})`);

  // Pick Witchy Cave, save, reload — it sticks.
  await p.locator('#cave-theme-picks [data-theme="witchy"]').click();
  await p.click('#cave-save-btn');
  await p.waitForTimeout(400);
  check((await p.evaluate(() => loadUserProfile()?.cave?.theme)) === 'witchy', 'setup saves the Witchy Cave theme');
  check(/Witchy Cave/.test(await p.evaluate(() => document.getElementById('cave-setup-preview')?.innerText || '')), 'the preview names Witchy Cave');
  await p.reload();
  await p.waitForTimeout(1200);
  check((await p.evaluate(() => getCave().theme)) === 'witchy', 'the Witchy Cave theme persists across reload');

  // Switch to Jungle Cave and save — the old theme is replaced, not stacked.
  await p.evaluate(() => openHandleSettings());
  await p.waitForFunction(() => !document.getElementById('handle-overlay')?.classList.contains('hidden'));
  await p.waitForFunction(() => document.querySelectorAll('#cave-theme-picks [data-theme]').length > 0);
  await p.locator('#cave-theme-picks [data-theme="jungle"]').click();
  await p.click('#cave-save-btn');
  await p.waitForTimeout(400);
  check((await p.evaluate(() => loadUserProfile()?.cave?.theme)) === 'jungle', 'switching to Jungle Cave saves over Witchy Cave');
  check((await p.evaluate(() => getCave().theme)) === 'jungle', 'the Jungle Cave theme is the live cave');
  check(await p.evaluate(() => JSON.stringify(normalizeCave({ theme: 'witchy', decor: ['lights'] }))) === JSON.stringify({ theme: 'witchy', decor: ['lights'], furniture: [] }), 'a saved Witchy Cave reads back cleanly');
  check(await p.evaluate(() => JSON.stringify(normalizeCave({ theme: 'cozy', decor: ['lights', 'plant'] }))) === JSON.stringify({ theme: 'cozy', decor: ['lights', 'plant'], furniture: [] }), 'the old Cozy theme still works');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-themes');
})();
