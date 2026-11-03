// Rate limits hold across server restarts (api/_limit.js keeps the count in
// the database), and plan checks happen on the server: review dish tips and
// friend notifications follow the plan, not the app's word.
const path = require('path');
const Module = require('module');
const { ROOT, check, finish } = require('./lib');

const docs = {};
let dbDown = false;
const ref = p => ({ p, get: async () => ({ exists: !!docs[p], data: () => docs[p] }), set: async (d, o) => { docs[p] = o?.merge ? { ...(docs[p] || {}), ...d } : d; } });
const fake = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
  firestore: Object.assign(() => ({
    doc: ref,
    getAll: async (...refs) => Promise.all(refs.map(r => r.get())),
    runTransaction: async fn => { if (dbDown) throw new Error('db down'); return fn({ get: r => r.get(), set: (r, d) => { docs[r.p] = d; } }); },
  }), { FieldValue: { arrayUnion: (...v) => ({ u: v }), arrayRemove: (...v) => ({ r: v }) } }),
};
// A fresh copy of a module, as a new server instance would load it.
function fresh (file) {
  const full = path.join(ROOT, 'api', file);
  Object.keys(require.cache).filter(k => k.includes(`${path.sep}api${path.sep}`)).forEach(k => delete require.cache[k]);
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  try { return require(full); } finally { Module._load = orig; }
}

(async () => {
  // ── Limits survive a restart ──
  let lim = fresh('_limit.js');
  for (let i = 0; i < 5; i++) await lim.overLimit('test:1.2.3.4', 5, 600);
  lim = fresh('_limit.js'); // a new server instance: its memory is empty
  check(await lim.overLimit('test:1.2.3.4', 5, 600) === true, 'the 6th request is refused even by a freshly started server');
  check(await fresh('_limit.js').overLimit('test:5.6.7.8', 5, 600) === false, 'someone else is not affected');
  dbDown = true;
  check(await fresh('_limit.js').overLimit('test:9.9.9.9', 5, 600) === false, 'if the database is down, requests are let through (no outage)');
  dbDown = false;

  // ── Review dish tips are Grizzly, checked on the server ──
  docs['users/cub1/meta/profile'] = { plan: 'free' };
  docs['users/griz1/meta/profile'] = { plan: 'grizzly' };
  process.env.GOOGLE_PLACES_API_KEY = 'k';
  const realFetch = global.fetch;
  let google = 0;
  global.fetch = async () => { google++; return new Response(JSON.stringify({ reviews: [{ rating: 5, text: { text: 'Get the birria' } }] }), { status: 200 }); };
  const placeInfo = fresh('place-info.js');
  const hit = (h, uid, query) => new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
    h({ method: 'GET', headers: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}`, 'x-ftb-token': `token-${uid}` }, query }, res);
  });
  let r = await hit(placeInfo, 'cub1', { mode: 'reviews', id: 'ChIJabcdefghijkl' });
  check(r.status === 402 && google === 0, 'a free account can\'t pull review dish tips (Google is never called)');
  r = await hit(placeInfo, 'griz1', { mode: 'reviews', id: 'ChIJabcdefghijkl' });
  check(r.status === 200 && google === 1, 'a Grizzly member can');
  global.fetch = realFetch;

  // ── Friend notifications follow the plan ──
  const push = fresh('push.js');
  const follow = (uid, ids) => new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
    push({ method: 'POST', headers: { authorization: `Bearer token-${uid}` }, body: { action: 'follows', ids } }, res);
  });
  await follow('cub1', ['aaaaaaaa1', 'bbbbbbbb2', 'cccccccc3']);
  check(docs['pushFollows/cub1'].ids.length === 1, 'a free account gets notifications from one friend');
  await follow('griz1', ['aaaaaaaa1', 'bbbbbbbb2', 'cccccccc3']);
  check(docs['pushFollows/griz1'].ids.length === 3, 'Grizzly gets them from everyone');

  finish('limits');
})();
