// Byte Cub AI on the server (api/ai-gemini.js): signed-in Grizzly members
// only, the plan checked on the server, and a daily cap per member.
const path = require('path');
const Module = require('module');
const { ROOT, check, finish } = require('./lib');

(async () => {
  const docs = { 'users/griz1/meta/profile': { plan: 'grizzly' }, 'users/cub1/meta/profile': { plan: 'free' } };
  const fake = {
    apps: [1],
    auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
    firestore: () => ({
      doc: p => ({ get: async () => ({ exists: !!docs[p], data: () => docs[p] }), set: async d => { docs[p] = d; } }),
      // The real Admin SDK has runTransaction; the AI quota counter uses it.
      runTransaction: async fn => fn({ get: ref => ref.get(), set: (ref, d) => ref.set(d) }),
    }),
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  const ai = require(path.join(ROOT, 'api', 'ai-gemini.js'));
  Module._load = orig;
  process.env.GEMINI_API_KEY = 'test';
  let gemini = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { gemini++; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Try the birria.' }] } }] }) }; };
  const call = uid => new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
    ai({ method: 'POST', headers: uid ? { authorization: `Bearer token-${uid}` } : {}, body: { body: { contents: [{ role: 'user', parts: [{ text: 'What should I eat?' }] }] } } }, res);
  });

  check((await call(null)).status === 401 && gemini === 0, 'not signed in: refused, and Gemini is never called');
  check((await call('cub1')).status === 402 && gemini === 0, 'a free account is refused by the server, not just the app');
  const ok = await call('griz1');
  check(ok.status === 200 && gemini === 1 && docs['aiQuota/griz1'].n === 1, 'a Grizzly member gets an answer, counted toward the day');
  docs['aiQuota/griz1'] = { day: new Date().toISOString().slice(0, 10), n: 300 };
  const capped = await call('griz1');
  check(capped.status === 429 && gemini === 1, 'after 300 requests in a day, it waits until tomorrow');
  docs['aiQuota/griz1'] = { day: '2020-01-01', n: 300 };
  check((await call('griz1')).status === 200, 'a new day starts fresh');

  global.fetch = realFetch;
  finish('aiproxy');
})();
