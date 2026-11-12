/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Usernames for finding friends
   ════════════════════════════════════════════════════════════
   Opt-in: nobody is findable until they pick a username. Lookups are exact
   matches only (no browsing or partial search), need a signed-in member, and
   are rate-limited, so the list can't be scraped.
   X-FTB-Token: <Firebase ID token> on every call.
     GET  ?q=connie                         -> { found, u, id }   (id = live profile share id)
     GET  ?mine=1                           -> { handle }   (plus public, views, joins, votes, earnings)
     POST { action: 'claim', handle, id }   -> { handle }   (409 if taken)
     POST { action: 'release' }             -> { ok }
     POST { action: 'followed', id, me }    -> { ok }   (you follow profile `id`; `me` is your own profile)
     POST { action: 'unfollowed', id, me }  -> { ok }
     GET  ?followers=1                      -> { followers: [{ id, u, at }] }  (who follows you)
     GET  ?following=1                      -> { following: [{ id, u }] }  (who you follow, from their followers lists)
   Invites: each one you send has its own random code, so you can see which
   were opened and who joined. Who you sent it to stays on your phone.
     POST { action: 'invite', code }        -> { ok }   (you're sending an invite)
     POST { action: 'inviteOpened', code }  -> { ok }   (no sign-in: the friend tapped the link)
     POST { action: 'inviteJoined', code, me } -> { ok } (the friend signed in; `me` is their profile)
     GET  ?invites=1                        -> { invites: [{ code, opened, joined, id, u }] }
   Server-only data (Admin SDK): handles/{handle} = { uid, id, u },
   handleOf/{uid} = { handle }, followedBy/{uid} = { list: [{ id, u, at }] },
   invites/{code} = { owner, at, openedAt?, joinedAt?, joinedUid?, joinedId?, joinedName? }.
   Following is one-way; the followers list is what lets an inviter see who
   joined from their link and follow them back.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const ID_RE = /^[a-z0-9]{8,40}$/;
const MAX_FOLLOWERS = 200;
const CODE_RE = /^[a-z0-9]{16,32}$/;
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

const bodyOf = req => (typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {}));

// The invited friend tapped the link: they may not have an account yet.
async function inviteOpened (req, res) {
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const code = String(bodyOf(req).code || '');
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Bad invite.' });
  try {
    if (await overLimit(`handle:o:${ip}`, 30, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
    const ref = getAdmin().firestore().doc(`invites/${code}`);
    const cur = (await ref.get()).data();
    if (cur && !cur.openedAt) await ref.set({ ...cur, openedAt: new Date().toISOString() });
    return res.status(200).json({ ok: !!cur });
  } catch (err) {
    console.error('[FTB] invite opened error:', err.message);
    return res.status(500).json({ error: 'Could not do that.' });
  }
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && bodyOf(req).action === 'inviteOpened') return inviteOpened(req, res);
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
      if (req.query?.mine) {
        const handle = (await db.doc(`handleOf/${uid}`).get()).data()?.handle || '';
        const h = handle ? (await db.doc(`handles/${handle}`).get()).data() || {} : {};
        const earn = (await db.doc(`creatorEarnings/${uid}`).get()).data() || {};
        // How many people love your Bear Cave page (cave-vote.js).
        let votes = 0;
        if (h.id && typeof db.collection === 'function') {
          try { votes = (await db.collection(`caveVotes/${h.id}/votes`).get()).size; } catch { votes = 0; }
        }
        return res.status(200).json({ handle, public: !!h.public, views: Number(h.views) || 0, joins: Number(h.joins) || 0, votes,
          earnedCents: Number(earn.earnedCents) || 0, owedCents: Number(earn.owedCents) || 0 });
      }
      // The public Bear Cave pages of people you follow (?pagesOf=id1,id2):
      // { pages: { id: handle } }, public pages only (they're open to anyone anyway).
      if (req.query?.pagesOf) {
        const ids = [...new Set(String(req.query.pagesOf).split(','))].filter(x => ID_RE.test(x)).slice(0, 50);
        const pages = {};
        await Promise.all(ids.map(async id => {
          const owner = (await db.doc(`profiles/${id}`).get()).data()?.uid;
          const handle = owner ? (await db.doc(`handleOf/${owner}`).get()).data()?.handle : '';
          const h = handle ? (await db.doc(`handles/${handle}`).get()).data() : null;
          if (h?.public && h.id === id) pages[id] = handle;
        }).map(p => p.catch(() => {})));
        return res.status(200).json({ pages });
      }
      if (req.query?.followers) {
        const list = (await db.doc(`followedBy/${uid}`).get()).data()?.list;
        const recent = (Array.isArray(list) ? list : []).slice(0, 100);
        // Only followers whose profile is still live (deleted accounts drop off).
        const live = await Promise.all(recent.map(f => db.doc(`profiles/${f.id}`).get().then(s => s.data()).catch(() => null)));
        const followers = recent.filter((f, i) => live[i]).map((f, i) => ({ id: f.id, u: String(f.u || 'Friend').slice(0, 30), at: f.at || '' }));
        return res.status(200).json({ followers });
      }
      // Who you follow, rebuilt from everyone's followers lists. The list on
      // your account can be lost (a phone that synced before it loaded); this
      // record can't, so the app uses it to put missing follows back.
      if (req.query?.following) {
        if (await overLimit(`handle:fw:${uid}`, 20, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
        const mine = await db.collection('profiles').where('uid', '==', uid).limit(20).get();
        const myIds = new Set(mine.docs.map(d => d.id));
        if (!myIds.size) return res.status(200).json({ following: [] });
        const all = await db.collection('followedBy').limit(5000).get();
        const owners = all.docs
          .filter(d => d.id !== uid && (d.data()?.list || []).some(f => f && myIds.has(f.id)))
          .map(d => d.id)
          .slice(0, 100);
        // Each person's current live profile (the newest, if they have several).
        const following = (await Promise.all(owners.map(async owner => {
          const snap = await db.collection('profiles').where('uid', '==', owner).limit(20).get().catch(() => null);
          const best = (snap?.docs || []).map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
          return best && ID_RE.test(best.id) ? { id: best.id, u: String(best.u || 'Friend').slice(0, 30) } : null;
        }))).filter(Boolean);
        return res.status(200).json({ following });
      }
      if (req.query?.invites) {
        const snap = await db.collection('invites').where('owner', '==', uid).limit(100).get();
        const rows = snap.docs.map(d => ({ code: d.id, ...d.data() }));
        // A friend who joined shows by their profile's name, while it's still live.
        const live = await Promise.all(rows.map(r => (r.joinedId ? db.doc(`profiles/${r.joinedId}`).get().then(s => s.data()).catch(() => null) : null)));
        const invites = rows.map((r, i) => {
          const joined = !!(r.joinedAt && live[i]);
          return { code: r.code, at: r.at || '', name: String(r.name || '').slice(0, 40), opened: !!(r.openedAt || r.joinedAt), joined, id: joined ? r.joinedId : '', u: joined ? String(live[i].u || r.joinedName || 'Friend').slice(0, 30) : '' };
        });
        return res.status(200).json({ invites });
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
    const body = bodyOf(req);

    if (body.action === 'invite') {
      if (await overLimit(`handle:i:${uid}`, 30, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const code = String(body.code || '');
      if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Bad invite.' });
      const ref = db.doc(`invites/${code}`);
      if ((await ref.get()).data()) return res.status(409).json({ error: 'Try again.' });
      // The name the inviter gave it ("Mom") so the invite shows who it was
      // for on any phone they sign in on; only the inviter sees it.
      await ref.set({ owner: uid, at: new Date().toISOString(), name: String(body.name || '').slice(0, 40) });
      return res.status(200).json({ ok: true });
    }

    // The invited friend signed in: mark the invite joined, once, with their profile.
    if (body.action === 'inviteJoined') {
      if (await overLimit(`handle:j:${uid}`, 20, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const code = String(body.code || '');
      const me = String(body.me || '');
      if (!CODE_RE.test(code) || !ID_RE.test(me)) return res.status(400).json({ error: 'Bad invite.' });
      const mine = (await db.doc(`profiles/${me}`).get()).data();
      if (!mine || mine.uid !== uid) return res.status(403).json({ error: 'Share your profile first.' });
      const ref = db.doc(`invites/${code}`);
      const cur = (await ref.get()).data();
      if (!cur || cur.owner === uid || (cur.joinedUid && cur.joinedUid !== uid)) return res.status(200).json({ ok: false });
      const now = new Date().toISOString();
      await ref.set({ ...cur, openedAt: cur.openedAt || now, joinedAt: cur.joinedAt || now, joinedUid: uid, joinedId: me, joinedName: String(mine.u || 'Friend').slice(0, 30) });
      return res.status(200).json({ ok: true });
    }

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
        // A public page and its counts move with you to a new username.
        const prev = old ? (old === handle ? cur : (await tx.get(db.doc(`handles/${old}`))).data()) || {} : {};
        if (old && old !== handle) tx.delete(db.doc(`handles/${old}`));
        tx.set(ref, { uid, id, u: name || handle, at: new Date().toISOString(),
          ...(prev.public ? { public: true } : {}), views: Number(prev.views) || 0, joins: Number(prev.joins) || 0 });
        tx.set(oldRef, { handle });
        return false;
      });
      if (taken) return res.status(409).json({ error: 'That username is taken.' });
      return res.status(200).json({ handle });
    }

    // Public page (feed-the-bear.com/@handle, api/creator.js): opt-in, off by default.
    if (body.action === 'publicPage') {
      const handle = (await db.doc(`handleOf/${uid}`).get()).data()?.handle;
      if (!handle) return res.status(400).json({ error: 'Pick a username first.' });
      const ref = db.doc(`handles/${handle}`);
      const cur = (await ref.get()).data();
      if (!cur || cur.uid !== uid) return res.status(400).json({ error: 'Pick a username first.' });
      const on = body.on === true;
      const next = { ...cur };
      if (on) next.public = true; else delete next.public;
      await ref.set(next);
      return res.status(200).json({ public: on, handle });
    }

    // Joined from someone's public page: counted once per new member.
    if (body.action === 'pageJoined') {
      if (await overLimit(`handle:p:${uid}`, 10, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const handle = cleanHandle(body.handle);
      if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Bad page.' });
      const ref = db.doc(`handles/${handle}`);
      const cur = (await ref.get()).data();
      if (!cur?.public || cur.uid === uid) return res.status(200).json({ ok: false });
      const mark = db.doc(`pageJoins/${uid}`);
      if ((await mark.get()).data()) return res.status(200).json({ ok: false });
      await mark.set({ handle, at: new Date().toISOString() });
      await ref.set({ ...cur, joins: (Number(cur.joins) || 0) + 1 });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[FTB] handle error:', err.message);
    return res.status(500).json({ error: 'Could not do that. Please try again.' });
  }
};
