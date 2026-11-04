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
     POST { action: 'followed', id, me }    -> { ok }   (you follow profile `id`; `me` is your own profile)
     POST { action: 'unfollowed', id, me }  -> { ok }
     GET  ?followers=1                      -> { followers: [{ id, u, at }] }  (who follows you)
   Server-only data (Admin SDK): handles/{handle} = { uid, id, u },
   handleOf/{uid} = { handle }, followedBy/{uid} = { list: [{ id, u, at }] }.
   Following is one-way; the followers list is what lets an inviter see who
   joined from their link and follow them back.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const ID_RE = /^[a-z0-9]{8,40}$/;
const MAX_FOLLOWERS = 200;
const RESERVED = new Set(['admin', 'support', 'help', 'feedthebear', 'feed_the_bear', 'grizzly', 'cub', 'bytecub', 'byte_cub', 'official', 'team', 'staff', 'moderator', 'root', 'null', 'undefined']);

// Rate limits live in the database, so they hold across server restarts (_limit.js).

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
      if (req.query?.followers) {
        const list = (await db.doc(`followedBy/${uid}`).get()).data()?.list;
        const recent = (Array.isArray(list) ? list : []).slice(0, 100);
        // Only followers whose profile is still live (deleted accounts drop off).
        const live = await Promise.all(recent.map(f => db.doc(`profiles/${f.id}`).get().then(s => s.data()).catch(() => null)));
        const followers = recent.filter((f, i) => live[i]).map((f, i) => ({ id: f.id, u: String(f.u || 'Friend').slice(0, 30), at: f.at || '' }));
        return res.status(200).json({ followers });
      }
      if (await overLimit(`handle:q:${uid}`, 30, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const handle = cleanHandle(req.query?.q);
      if (!HANDLE_RE.test(handle)) return res.status(200).json({ found: false });
      const doc = (await db.doc(`handles/${handle}`).get()).data();
      if (!doc || doc.uid === uid) return res.status(200).json({ found: false, self: doc?.uid === uid });
      // Only a live profile that really belongs to the username's owner, and
      // with that profile's own name (not whatever was sent when claiming).
      const profile = (await db.doc(`profiles/${doc.id}`).get()).data();
      if (!profile || profile.uid !== doc.uid) return res.status(200).json({ found: false });
      return res.status(200).json({ found: true, u: String(profile.u || doc.u || handle).slice(0, 30), id: doc.id });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});

    if (body.action === 'release') {
      const mine = (await db.doc(`handleOf/${uid}`).get()).data()?.handle;
      if (mine) await db.doc(`handles/${mine}`).delete();
      await db.doc(`handleOf/${uid}`).delete();
      return res.status(200).json({ ok: true });
    }

    // You followed (or unfollowed) someone: note it on their followers list.
    // `me` must be your own live profile, so nobody can follow in someone
    // else's name, and the name shown is that profile's own.
    if (body.action === 'followed' || body.action === 'unfollowed') {
      if (await overLimit(`handle:f:${uid}`, 60, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const id = String(body.id || '');
      const me = String(body.me || '');
      if (!ID_RE.test(id) || !ID_RE.test(me) || id === me) return res.status(400).json({ error: 'Bad profile.' });
      const [theirs, mine] = await Promise.all([db.doc(`profiles/${id}`).get(), db.doc(`profiles/${me}`).get()]);
      const owner = theirs.data()?.uid;
      if (!mine.data() || mine.data().uid !== uid) return res.status(403).json({ error: 'Share your profile first.' });
      if (!owner || owner === uid) return res.status(200).json({ ok: true });
      const name = String(mine.data().u || 'Friend').slice(0, 30);
      await db.runTransaction(async tx => {
        const ref = db.doc(`followedBy/${owner}`);
        const cur = (await tx.get(ref)).data()?.list;
        const list = (Array.isArray(cur) ? cur : []).filter(f => f && f.id !== me);
        if (body.action === 'followed') list.unshift({ id: me, u: name, at: new Date().toISOString() });
        tx.set(ref, { list: list.slice(0, MAX_FOLLOWERS) });
      });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'claim') {
      if (await overLimit(`handle:c:${uid}`, 10, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
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
