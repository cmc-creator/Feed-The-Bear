// Public cave page: the saved cave always renders, even when the live
// profile publish went stale.
//   The page used to render the cave ONLY from profiles/{shareId}, a doc
// the app publishes with a full overwrite from whatever the phone had
// at the time — so one publish from a device that hadn't loaded the
// saved cave yet wiped it back to the cozy default (and the points with
// it), and the page showed the default until a good publish landed.
//   The fix: the page also reads users/{uid}/meta/profile — the source
// of truth, merge-written and keyed by the stable uid — and lets its
// saved cave win whenever the live profile fell back to the default.
// It also falls back to that doc for the points total and the photo.
//   - A stale live profile + a saved Forest cave in the canonical doc
//     renders Forest, its decorations, its points, and the photo.
//   - A good live profile is never overridden by an empty canonical doc.
//   - A live profile clobbered back to cozy still shows the saved cave.
//   - No cave anywhere: the cozy default, no points badge, bear image.
//   - A junk photo value never lands in the page; the bear is used.
const path = require('path');
const Module = require('module');
const { check, finish } = require('./lib');

const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';
const docs = {
  'profiles/connieshare01': { uid: 'connieUid12345', u: 'Connie', profile: { picks: [
    { n: 'Tacos Chiwas', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos'] },
  ] } },
  'users/connieUid12345/meta/profile': { cave: { t: 'forest', d: ['fireplace', 'shelf', 'barcart'] }, pts: 265, photo: PHOTO },
  'profiles/witchshare01': { uid: 'witchUid123456', u: 'Witch', profile: { picks: [
    { n: 'Pizzeria Bianco', c: 'Pizza', r: 4 },
  ], cave: { t: 'witchy', d: ['candle', 'plant'] }, pts: 40 } },
  'profiles/clobshare01': { uid: 'clobUid1234567', u: 'Clob', profile: { picks: [
    { n: 'Taqueria Uno', c: 'Mexican', r: 5 },
  ], cave: { t: 'cozy', d: ['lights', 'plant'] }, pts: 0 } },
  'users/clobUid1234567/meta/profile': { cave: { t: 'forest', d: ['lights', 'plant'] }, pts: 120 },
  'profiles/samshare0001': { uid: 'samUid1234567', u: 'Sam', profile: { picks: [] } },
  'profiles/junkshare01': { uid: 'junkUid1234567', u: 'Junk', profile: { picks: [
    { n: 'Beach Cafe', c: 'Cafe', r: 4 },
  ], cave: { t: 'beach', d: ['plant'] } } },
  'users/junkUid1234567/meta/profile': { cave: { t: 'beach', d: ['plant'] }, photo: 'javascript:alert(1)' },
};
const ref = p => ({
  p,
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  set: async (d, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...d } : d; },
  delete: async () => { delete docs[p]; },
});
const fake = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
  firestore: () => ({
    doc: ref,
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
const setupPage = async (uid, handle, id) => {
  await callHandle(uid, { method: 'POST', body: { action: 'claim', handle, id, name: handle } });
  await callHandle(uid, { method: 'POST', body: { action: 'publicPage', on: true } });
};

(async () => {
  // 1. Stale live profile (no cave, no points) + a saved cave in the
  // canonical profile: the saved cave renders, with points and photo.
  await setupPage('connieUid12345', 'connie_eats', 'connieshare01');
  let pg = await view('connie_eats');
  check(pg.status === 200, 'the stale-live cave page opens');
  check(/data-cave-theme="forest"/.test(pg.html), 'a stale live profile still renders the saved forest theme');
  check(/Forest Cave/.test(pg.html), 'the page names the saved theme');
  check(/scene-forest-3d\.jpg/.test(pg.html), 'the page shows the saved Forest 3D scene');
  check(!/cave-decor-item decor-/.test(pg.html), 'a 3D-scene theme shows no pasted decorations');
  check(/265 cave points/.test(pg.html), 'the page shows the saved points total');
  check(pg.html.includes(`src="${PHOTO}"`), 'the header shows her own photo from the saved profile');

  // 2. A good live profile is not overridden by an empty canonical doc.
  await setupPage('witchUid123456', 'witch_eats', 'witchshare01');
  pg = await view('witch_eats');
  check(pg.status === 200 && /data-cave-theme="witchy"/.test(pg.html), 'a live witchy cave still renders when the canonical doc has no cave');
  check(/scene-witchy-3d\.jpg/.test(pg.html), 'the live Witchy 3D scene renders');
  check(!/cave-decor-item decor-/.test(pg.html), 'a 3D-scene theme shows no pasted decorations');
  check(/40 cave points/.test(pg.html), 'the live points render');
  check(/src="\/feedbear-sm\.jpg"/.test(pg.html), 'no saved photo means the bear image');

  // 3. A live profile clobbered back to the cozy default still shows the
  // saved cave and points from the canonical doc.
  await setupPage('clobUid1234567', 'clob_eats', 'clobshare01');
  pg = await view('clob_eats');
  check(pg.status === 200 && /data-cave-theme="forest"/.test(pg.html), 'a clobbered live profile still renders the saved forest theme');
  check(/120 cave points/.test(pg.html), 'the saved points show when the live total is zero');

  // 4. No cave anywhere: the cozy default, no points badge, bear image.
  await setupPage('samUid1234567', 'sam_eats', 'samshare0001');
  pg = await view('sam_eats');
  check(pg.status === 200 && /data-cave-theme="cozy"/.test(pg.html), 'no saved cave anywhere falls back to the cozy default');
  check(!/class="cave-points"/.test(pg.html), 'no points anywhere shows no points badge');
  check(/src="\/feedbear-sm\.jpg"/.test(pg.html), 'no photo anywhere shows the bear image');

  // 5. A junk photo value never lands in the page.
  await setupPage('junkUid1234567', 'junk_eats', 'junkshare01');
  pg = await view('junk_eats');
  check(pg.status === 200 && /data-cave-theme="beach"/.test(pg.html), 'a junk photo does not break the cave render');
  check(!/javascript:/.test(pg.html), 'a junk photo URL is dropped, not rendered');
  check(/src="\/feedbear-sm\.jpg"/.test(pg.html), 'a junk photo falls back to the bear image');

  finish('cave-page-fallback');
})();
