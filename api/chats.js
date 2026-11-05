/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Byte Cub chat history
   ════════════════════════════════════════════════════════════
   Your chats with Byte Cub, kept on your account so you can pick one up
   again on any device. Private: only you, signed in, can read yours.
   X-FTB-Token: <Firebase ID token> on every call.
     GET                              -> { chats: [{ id, title, updatedAt, count }] }  (newest 30)
     GET  ?id=<chat id>               -> { chat: { id, title, updatedAt, messages: [{ r, t, at }] } }
     POST { id, title, messages }     -> { ok }   (saves the whole chat; r = 'u' you, 'b' Byte Cub)
     POST { action: 'delete', id }    -> { ok }
   Stored at users/{uid}/chats/{id}, so deleting the account deletes them.
   Needs FIREBASE_SERVICE_ACCOUNT, like the other functions.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const ID_RE = /^[a-z0-9]{8,32}$/;
const KEEP = 30;          // chats kept per person
const MAX_MESSAGES = 80;  // per chat (the newest)
const MAX_TEXT = 1500;    // characters per message

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

function cleanMessages (list) {
  return (Array.isArray(list) ? list : []).slice(-MAX_MESSAGES)
    .map(m => ({ r: m?.r === 'u' ? 'u' : 'b', t: String(m?.t ?? '').slice(0, MAX_TEXT), at: Number(m?.at) || 0 }))
    .filter(m => m.t.trim());
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let uid;
  try {
    uid = (await getAdmin().auth().verifyIdToken(String(req.headers?.['x-ftb-token'] || ''))).uid;
  } catch {
    return res.status(401).json({ error: 'Sign in to keep your chats.' });
  }
  if (await overLimit(`chats:${uid}`, 240, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
  const db = getAdmin().firestore();
  const col = db.collection(`users/${uid}/chats`);

  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '');
      if (id) {
        if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad chat.' });
        const d = (await col.doc(id).get()).data();
        if (!d) return res.status(404).json({ error: "That chat isn't here anymore." });
        return res.status(200).json({ chat: { id, title: d.title || '', updatedAt: d.updatedAt || 0, messages: cleanMessages(d.messages) } });
      }
      const snap = await col.orderBy('updatedAt', 'desc').limit(KEEP).get();
      const chats = snap.docs.map(d => ({ id: d.id, title: String(d.data().title || '').slice(0, 80), updatedAt: Number(d.data().updatedAt) || 0, count: Number(d.data().count) || 0 }));
      return res.status(200).json({ chats });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
    const id = String(body.id || '');
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad chat.' });

    if (body.action === 'delete') {
      await col.doc(id).delete();
      return res.status(200).json({ ok: true });
    }

    const messages = cleanMessages(body.messages);
    if (!messages.some(m => m.r === 'u')) return res.status(400).json({ error: 'Nothing to save yet.' });
    const updatedAt = Date.now();
    await col.doc(id).set({ title: String(body.title || '').slice(0, 80), updatedAt, count: messages.length, messages });
    // Keep the newest 30: drop the oldest past that.
    const old = await col.orderBy('updatedAt', 'desc').offset(KEEP).limit(20).get();
    await Promise.all(old.docs.map(d => d.ref.delete()));
    return res.status(200).json({ ok: true, updatedAt });
  } catch (err) {
    console.error('[FTB] chats error:', err.message);
    return res.status(500).json({ error: 'Could not reach your chats. Try again soon.' });
  }
};
