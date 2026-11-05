// api/chats.js: your Byte Cub chats, private to you, newest 30 kept.
const path = require('path');
const Module = require('module');
const { ROOT, check, finish } = require('./lib');

(async () => {
  const docs = {};
  const docRef = p => ({ get: async () => ({ data: () => docs[p] }), set: async d => { docs[p] = d; }, delete: async () => { delete docs[p]; } });
  const query = (col, off = 0, lim = 1000) => ({
    offset: n => query(col, n, lim),
    limit: n => query(col, off, n),
    get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(col + '/') && !k.slice(col.length + 1).includes('/'))
      .sort((a, b) => docs[b].updatedAt - docs[a].updatedAt).slice(off, off + lim)
      .map(k => ({ id: k.slice(col.length + 1), data: () => docs[k], ref: docRef(k) })) }),
  });
  const fake = {
    apps: [1],
    auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
    firestore: () => ({ doc: docRef, collection: c => ({ doc: id => docRef(`${c}/${id}`), orderBy: () => query(c) }) }),
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'firebase-admin') return fake;
    if (/_limit$/.test(req)) return { overLimit: async () => false };
    return orig.call(this, req, ...rest);
  };
  const api = require(path.join(ROOT, 'api', 'chats.js'));
  Module._load = orig;
  const call = (uid, { method = 'GET', query: q = {}, body } = {}) => new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
    api({ method, query: q, body, headers: uid ? { 'x-ftb-token': `token-${uid}` } : {} }, res);
  });

  check((await call(null)).status === 401, 'chats need sign-in');
  const msgs = [{ r: 'u', t: 'where should I eat?', at: 1 }, { r: 'b', t: 'Try Pizzeria Bianco.', at: 2 }];
  let r = await call('connie', { method: 'POST', body: { id: 'chat0000001', title: 'where should I eat?', messages: msgs } });
  check(r.status === 200 && docs['users/connie/chats/chat0000001']?.messages.length === 2, 'a chat saves to your account');
  check((await call('connie', { method: 'POST', body: { id: 'chat0000002', messages: [{ r: 'b', t: 'hi' }] } })).status === 400, "a chat where you haven't said anything isn't saved");
  check((await call('connie', { method: 'POST', body: { id: '../x', messages: msgs } })).status === 400, 'odd chat ids are refused');
  r = await call('connie');
  check(r.data.chats.length === 1 && r.data.chats[0].title === 'where should I eat?' && r.data.chats[0].count === 2, 'listing shows the chat');
  r = await call('connie', { query: { id: 'chat0000001' } });
  check(r.data.chat.messages[1].t === 'Try Pizzeria Bianco.', 'opening one returns its messages');
  check((await call('sam', { query: { id: 'chat0000001' } })).status === 404 && (await call('sam')).data.chats.length === 0, "someone else can't see your chats");
  for (let i = 0; i < 32; i++) {
    await call('connie', { method: 'POST', body: { id: `bulk${String(i).padStart(6, '0')}`, title: `chat ${i}`, messages: msgs } });
    await new Promise(res => setTimeout(res, 2));
  }
  check(Object.keys(docs).filter(k => k.startsWith('users/connie/chats/')).length === 30, 'only the newest 30 are kept');
  await call('connie', { method: 'POST', body: { action: 'delete', id: 'bulk000031' } });
  check(!docs['users/connie/chats/bulk000031'], 'deleting a chat removes it');
  finish('chatsapi');
})();
