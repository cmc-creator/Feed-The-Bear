// Bear Cave: the existing public page (feed-the-bear.com/@you), decorated.
// - Setup (theme + decorations) saves into the profile and rides the live
//   profile / share link, so the page renders with them.
// - The creator page shows the theme, the decorations, and a vote box.
// - Voting (api/cave-vote.js): one vote per browser per cave, tapping again
//   takes it back; the count is visible to the creator via ?mine=1.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/connieshare01': { uid: 'connieUid12345', u: 'Connie', profile: { picks: [
    { n: 'Tacos Chiwas', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos'], s: ['Horchata'] },
  ], cave: { t: 'forest', d: ['lights', 'plant'] } } },
  'profiles/samshare0001': { uid: 'samUid1234567', u: 'Sam', profile: { picks: [] } },
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
const caveVoteApi = require(path.join(__dirname, '..', 'api', 'cave-vote.js'));
Module._load = orig;

const callHandle = (uid, { method = 'GET', query = {}, body } = {}) => new Promise(resolve => {
  const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
  handleApi({ method, query, body, headers: uid ? { 'x-ftb-token': `token-${uid}` } : {} }, res);
});
const view = h => new Promise(resolve => {
  const res = { h: {}, setHeader (k, v) { this.h[k] = v; }, status (c) { this.c = c; return this; }, send (d) { resolve({ status: this.c, html: String(d) }); return this; } };
  creatorApi({ method: 'GET', query: { h }, headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
});
const voteCall = (method, { query = {}, body = {} } = {}) => new Promise(resolve => {
  let status = 200;
  const res = { setHeader () {}, status (c) { status = c; return this; }, json (d) { resolve({ status, ...d }); return this; } };
  caveVoteApi({ method, query, body, headers: { 'x-forwarded-for': '9.9.9.9' } }, res);
});

(async () => {
  // ── 1. The creator page renders the cave ──
  await callHandle('connieUid12345', { method: 'POST', body: { action: 'claim', handle: 'connie_eats', id: 'connieshare01', name: 'Connie' } });
  await callHandle('connieUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  let pg = await view('connie_eats');
  check(pg.status === 200, 'the cave page opens');
  check(/data-cave-theme="forest"/.test(pg.html), 'the page carries the forest theme');
  check(/decor-lights\.jpg/.test(pg.html) && /decor-plant\.jpg/.test(pg.html), 'the page shows the fairy lights and plant photos');
  check(/Forest Cave/.test(pg.html), 'the page names the theme');
  check(/class="cave-scene"/.test(pg.html), 'the cave renders as a scene, not a flat row');
  check(/cave-decor-item decor-lights/.test(pg.html) && /cave-decor-item decor-plant/.test(pg.html),
    'each decoration is placed in the scene with its own position');
  check(/class="cave-scene"[\s\S]*?class="cave-caption"/.test(pg.html), 'the theme and points caption sits below the scene');
  check(!/🐻|⭐|❤️/.test(pg.html), 'the cave page has no emoji in the scene, caption, or vote button');
  check(/id="cave-vote-btn" data-share="connieshare01"/.test(pg.html), 'the page has a vote button for this cave');
  check(/Love this cave\?/.test(pg.html), 'the vote button asks nicely');
  check(/\/api\/cave-vote/.test(pg.html), 'the page talks to the vote endpoint');

  // No cave set at all: the cozy default, never a blank page.
  pg = await view('samshare0001'.replace('samshare0001', 'sam_eats'));
  check(pg.status === 404, 'an unclaimed handle is still not found');
  await callHandle('samUid1234567', { method: 'POST', body: { action: 'claim', handle: 'sam_eats', id: 'samshare0001', name: 'Sam' } });
  await callHandle('samUid1234567', { method: 'POST', body: { action: 'publicPage', on: true } });
  pg = await view('sam_eats');
  check(pg.status === 200 && /data-cave-theme="cozy"/.test(pg.html), 'a cave with no setup falls back to the cozy default');

  // ── 2. Voting: one vote per browser per cave ──
  let r = await voteCall('GET', { query: { share: 'connieshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.status === 200 && r.count === 0 && r.voted === false, 'a fresh cave has no votes');
  r = await voteCall('GET', { query: { share: 'nope12345678', voter: 'aaaa1111bbbb2222' } });
  check(r.status === 404, 'an unknown cave says it was not found');
  r = await voteCall('GET', { query: { share: 'connieshare01', voter: 'x' } });
  check(r.status === 400, 'a bad voter id is rejected');
  r = await voteCall('POST', { body: { action: 'vote', share: 'connieshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.status === 200 && r.count === 1 && r.voted === true, 'a vote counts once');
  r = await voteCall('POST', { body: { action: 'vote', share: 'connieshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.count === 1, 'voting again does not double-count');
  r = await voteCall('POST', { body: { action: 'vote', share: 'connieshare01', voter: 'cccc3333dddd4444' } });
  check(r.count === 2, 'a second friend adds a second vote');
  r = await voteCall('POST', { body: { action: 'unvote', share: 'connieshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.count === 1 && r.voted === false, 'tapping again takes the vote back');
  r = await voteCall('POST', { body: { action: 'unvote', share: 'connieshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.count === 1, 'unvoting twice does not go below the real count');
  r = await voteCall('POST', { body: { action: 'dance', share: 'connieshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.status === 400, 'an unknown vote action is rejected');

  // The creator sees the count on their own page settings.
  r = await callHandle('connieUid12345', { query: { mine: '1' } });
  check(r.data.votes === 1, `?mine=1 reports the cave votes (${r.data.votes})`);

  // ── 3. App: setup, share data, my-page votes ──
  const browser = await launch();
  const seed = () => ([
    { id: 'sA', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1,
      dishes: [{ id: 'd1', name: 'Green Chile Burrito', verdict: 'again', rating: 5, note: 'extra spicy', date: '2026-11-10' }] },
    { id: 'sB', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 4, tags: [], visits: [], dateAdded: '2026-11-03', updatedAt: 1, dishes: [] },
  ]);
  const p = await newPage(browser, { seed: seed() });
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

  // Defaults: no cave set yet, so the cozy default with fairy lights + plant.
  check(await p.evaluate(() => JSON.stringify(getCave())) === JSON.stringify({ theme: 'cozy', decor: ['lights', 'plant'], furniture: [] }),
    'a user who skipped setup gets the cozy default cave');
  check(await p.evaluate(() => JSON.stringify(normalizeCave({ theme: 'nope', decor: ['bogus', 'plant', 'plant', 'rug', 'lights', 'trophy', 'candle'] })))
    === JSON.stringify({ theme: 'cozy', decor: ['plant', 'rug', 'lights', 'trophy'], furniture: [] }),
    'unknown themes and decorations are dropped, duplicates removed, capped at four');
  check(await p.evaluate(() => JSON.stringify(normalizeCave({ t: 'neon', d: ['candle'] }))) === JSON.stringify({ theme: 'neon', decor: ['candle'], furniture: [] }),
    'the short link form reads back the same cave');
  check(await p.evaluate(() => JSON.stringify(normalizeCave({ theme: 'forest', decor: [], furniture: ['couch', 'bed', 'lamp', 'table', 'bogus'] })))
    === JSON.stringify({ theme: 'forest', decor: [], furniture: ['couch', 'bed', 'lamp'] }),
    'furniture is validated against the catalog and capped at three');

  // The public-page section shows the votes and a Decorate button.
  await p.evaluate(() => { window._ftbUid = 'connieUid12345'; });
  await p.evaluate(() => openHandleSettings());
  await p.waitForFunction(() => !document.getElementById('handle-overlay')?.classList.contains('hidden'));
  await p.waitForFunction(() => /love your cave/.test(document.getElementById('settings-handle')?.innerText || ''));
  const myPage = await p.locator('#settings-handle .my-page').innerText();
  check(/3 people love your cave/.test(myPage), `my page shows the cave votes ("${myPage.replace(/\s+/g, ' ')}")`);
  check(await p.locator('#settings-handle .my-page-decorate').isVisible(), 'my page has a Decorate my cave button');

  // Setup: pick the Neon theme and three decorations, save.
  check(await p.locator('#cave-theme-picks [data-theme="neon"]').isVisible(), 'the cave setup offers the Neon theme');
  await p.locator('#cave-theme-picks [data-theme="neon"]').click();
  await p.locator('#cave-decor-picks [data-decor="trophy"]').click();
  await p.locator('#cave-decor-picks [data-decor="candle"]').click();
  await p.click('#cave-save-btn');
  await p.waitForTimeout(400);
  const saved = await p.evaluate(() => loadUserProfile()?.cave);
  check(saved?.theme === 'neon' && saved?.decor?.join() === 'lights,plant,trophy,candle',
    `setup saves the theme and decorations (${JSON.stringify(saved)})`);
  const preview = await p.evaluate(() => document.getElementById('cave-setup-preview')?.innerText || '');
  check(/Neon/.test(preview), 'the setup preview shows the chosen theme');
  check(/cave-preview-scene/.test(await p.evaluate(() => document.getElementById('cave-setup-preview')?.innerHTML || '')),
    'the setup preview is a scene, not a row of thumbnails');
  check(/Buy furniture in the Cave Shop/.test(await p.evaluate(() => document.getElementById('cave-furniture-picks')?.innerText || '')),
    'with no furniture owned the setup points at the Cave Shop');

  // Sharing: the cave rides the profile link data and the live profile.
  const shared = await p.evaluate(() => buildProfileData().cave);
  check(shared?.t === 'neon' && shared?.d?.join() === 'lights,plant,trophy,candle' && Array.isArray(shared?.f),
    'the share link data carries the cave (theme, decor, furniture)');
  await p.evaluate(() => { state.settings.shareLive = true; });
  const live = await p.evaluate(() => buildLiveProfile()?.profile?.cave);
  check(live?.t === 'neon' && live?.d?.length === 4, 'the live profile carries the cave for the page');
  check(await p.evaluate(() => JSON.stringify(caveOf({ profile: { cave: { t: 'pastel', d: ['rug'] } } }))) === JSON.stringify({ theme: 'pastel', decor: ['rug'], furniture: [] }),
    'a friend’s live profile reads back their cave');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('bear-cave');
})();
