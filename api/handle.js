/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Usernames for finding friends
   ════════════════════════════════════════════════════════════
   Opt-in: nobody is findable until they pick a username. Lookups are exact
   matches only (no browsing or partial search), need a signed-in member, and
   are rate-limited, so the list can't be scraped.
   X-FTB-Token: <Firebase ID token> on every call.
     GET  ?q=connie                         -> { found, u, id }   (id = live profile share id)
     GET  ?mine=1                           -> { handle }
     POST { action: 'claim', handle, id }   -> { handle }   (409 if taken)
     POST { action: 'release' }             -> { ok }
   Server-only data (Admin SDK): handles/{handle} = { uid, id, u },
   handleOf/{uid} = { handle }.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const ID_RE = /^[a-z0-9]{8,40}$/;
const RESERVED = new Set(['admin', 'support', 'help', 'feedthebear', 'feed_the_bear', 'grizzly', 'cub', 'bytecub', 'byte_cub', 'official', 'team', 'staff', 'moderator', 'root', 'null', 'undefined']);

const hits = new Map();
function limited (key, max) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const cleanHandle = v => String(v || '').trim().replace(/^@/, '').toLowerCase();

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let fb, user;
  try {
    fb = getAdmin();
    user = await fb.auth().verifyIdToken(String(req.headers['x-ftb-token'] || ''));
  } catch {
    return res.status(401).json({ error: 'Sign in to find friends.' });
  }
  const db = fb.firestore();
  const uid = user.uid;

  try {
    if (req.method === 'GET') {
      if (req.query?.mine) return res.status(200).json({ handle: (await db.doc(`handleOf/${uid}`).get()).data()?.handle || '' });
      if (limited(`q:${uid}`, 30)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const handle = cleanHandle(req.query?.q);
      if (!HANDLE_RE.test(handle)) return res.status(200).json({ found: false });
      const doc = (await db.doc(`handles/${handle}`).get()).data();
      if (!doc || doc.uid === uid) return res.status(200).json({ found: false, self: doc?.uid === uid });
      return res.status(200).json({ found: true, u: String(doc.u || handle).slice(0, 30), id: doc.id });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});

    if (body.action === 'release') {
      const mine = (await db.doc(`handleOf/${uid}`).get()).data()?.handle;
      if (mine) await db.doc(`handles/${mine}`).delete();
      await db.doc(`handleOf/${uid}`).delete();
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'claim') {
      if (limited(`c:${uid}`, 10)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const handle = cleanHandle(body.handle);
      const id = String(body.id || '');
      const name = String(body.name || '').slice(0, 30);
      if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Use 3 to 20 letters, numbers or _.' });
      if (RESERVED.has(handle)) return res.status(409).json({ error: 'That username is taken.' });
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'Start sharing your profile first.' });
      // Only your own live profile can be linked to your username.
      const profile = (await db.doc(`profiles/${id}`).get()).data();
      if (profile && profile.uid !== uid) return res.status(403).json({ error: 'That profile is not yours.' });
      const taken = await db.runTransaction(async tx => {
        const ref = db.doc(`handles/${handle}`);
        const cur = (await tx.get(ref)).data();
        if (cur && cur.uid !== uid) return true;
        const oldRef = db.doc(`handleOf/${uid}`);
        const old = (await tx.get(oldRef)).data()?.handle;
        if (old && old !== handle) tx.delete(db.doc(`handles/${old}`));
        tx.set(ref, { uid, id, u: name || handle, at: new Date().toISOString() });
        tx.set(oldRef, { handle });
        return false;
      });
      if (taken) return res.status(409).json({ error: 'That username is taken.' });
      return res.status(200).json({ handle });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[FTB] handle error:', err.message);
    return res.status(500).json({ error: 'Could not do that. Please try again.' });
  }
};
