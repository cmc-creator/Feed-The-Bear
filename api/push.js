/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Friend notifications (Android app)
   ════════════════════════════════════════════════════════════
   POST, Authorization: Bearer <Firebase ID token>, JSON body:
     { action: 'register', token }        this phone can get notifications
     { action: 'unregister', token }      signed out / turned them off
     { action: 'follows', ids: [shareId] } the live profiles you follow
     { action: 'notify', id: shareId }    you just posted: ping your followers
     { action: 'joined' }                 a brand-new account: tell the owner

   Server-only data (written with the Admin SDK, so firestore.rules need
   no changes; clients can't read or write these):
     pushTokens/{uid}     { tokens: [fcm token, ...] }    newest last, max 5
     pushFollows/{uid}    { ids: [shareId, ...] }
     followers/{shareId}  { uids: [...], seen: [activity keys], lastAt }

   Sends through Firebase Cloud Messaging with the same
   FIREBASE_SERVICE_ACCOUNT as the other functions.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { sendEmail, emailHtml, emailReady, esc } = require('./_email');
const { bump } = require('./_count');
const { sendMulticast } = require('./_push');

const MAX_TOKENS = 5;
const MAX_FOLLOWS = 50;
const QUIET_MS = 20 * 60 * 1000; // one ping per friend per 20 minutes at most
const ID_RE = /^[a-z0-9]{8,40}$/;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const activityKey = x => [x?.k, x?.n, x?.d, x?.at].join('|');

// What the notification says about one new activity.
function messageFor (who, x, more) {
  const stars = x.r ? ` ${'★'.repeat(Math.min(5, x.r))}` : '';
  const line = x.k === 'dish' && x.d ? `would get the ${x.d} again at ${x.n}`
    : x.k === 'save' ? `wants to try ${x.n}`
    : `ate at ${x.n}${stars}`;
  return { title: `${who} ${line}`.slice(0, 120), body: more ? `And ${more} more. Tap to see what your friends are eating.` : 'Tap to see what your friends are eating.' };
}

// Today or yesterday (in any US time zone), so old history never pings anyone.
function recent (day) {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t) && Date.now() - t < 2.5 * 86400000;
}

async function notify (db, fb, uid, id) {
  const profile = (await db.doc(`profiles/${id}`).get()).data();
  if (!profile || profile.uid !== uid) return { sent: 0, reason: 'not yours' };
  const ref = db.doc(`followers/${id}`);
  const state = (await ref.get()).data() || {};
  const items = (Array.isArray(profile.recent) ? profile.recent : []).filter(x => x && x.k && x.n);
  const keys = items.map(activityKey);
  // The first time, just remember what's there: none of it is news.
  if (!Array.isArray(state.seen)) {
    await ref.set({ seen: keys }, { merge: true });
    return { sent: 0, reason: 'first look' };
  }
  const fresh = items.filter(x => !state.seen.includes(activityKey(x)) && recent(x.at));
  const followers = (state.uids || []).filter(u => u !== uid).slice(0, 200);
  if (!fresh.length || !followers.length || Date.now() - (state.lastAt || 0) < QUIET_MS) {
    // Still remember them, so they don't ping later as if new.
    if (fresh.length) await ref.set({ seen: [...new Set([...keys, ...state.seen])].slice(0, 60) }, { merge: true });
    return { sent: 0, reason: !fresh.length ? 'nothing new' : !followers.length ? 'no followers' : 'quiet' };
  }

  const snaps = await db.getAll(...followers.map(u => db.doc(`pushTokens/${u}`)));
  const owners = [];
  const tokens = [];
  snaps.forEach((s, i) => (s.data()?.tokens || []).forEach(t => { tokens.push(t); owners.push(followers[i]); }));
  await ref.set({ seen: [...new Set([...keys, ...state.seen])].slice(0, 60), lastAt: Date.now() }, { merge: true });
  if (!tokens.length) return { sent: 0, reason: 'no phones' };

  const who = String(profile.u || 'A friend').slice(0, 30);
  const { title, body } = messageFor(who, fresh[0], fresh.length - 1);
  const res = await sendMulticast(fb, {
    tokens,
    notification: { title, body },
    data: { open: 'friends' },
    android: { priority: 'high', notification: { tag: `friend-${id}` } },
  });
  // Phones that uninstalled or reset: forget their tokens.
  const dead = {};
  res.responses.forEach((r, i) => {
    const code = r.error?.code || '';
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) (dead[owners[i]] ||= []).push(tokens[i]);
  });
  await Promise.all(Object.entries(dead).map(([u, list]) =>
    db.doc(`pushTokens/${u}`).set({ tokens: fb.firestore.FieldValue.arrayRemove(...list) }, { merge: true })));
  return { sent: res.successCount };
}

// A brand-new account (made in the last 30 minutes) tells the owner once:
// a push to the owner's phones and/or an email, as set in the owner portal
// (config/ownerAlerts). signups/{uid} is the record, and stops repeats.
const OWNER_EMAILS = () => [...new Set(['cmc@conniemichelleconsulting.com',
  ...(process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)])];
async function joined (db, fb, uid) {
  const u = await fb.auth().getUser(uid);
  const born = Date.parse(u.metadata?.creationTime || '');
  if (!born || Date.now() - born > 30 * 60 * 1000) return { told: false, reason: 'not new' };
  if (OWNER_EMAILS().includes(String(u.email || '').toLowerCase())) return { told: false, reason: 'owner' };
  const ref = db.doc(`signups/${uid}`);
  const via = (u.providerData || []).some(p => p.providerId === 'google.com') ? 'Google' : 'email';
  const fresh = await db.runTransaction(async t => {
    if ((await t.get(ref)).exists) return false;
    t.set(ref, { email: u.email || '', name: u.displayName || '', via, at: new Date(born).toISOString() });
    return true;
  });
  if (!fresh) return { told: false, reason: 'already told' };

  const prefs = (await db.doc('config/ownerAlerts').get()).data() || {};
  const who = u.displayName ? `${u.displayName} (${u.email || 'no email'})` : (u.email || 'Someone');
  const title = 'New sign-up 🐻';
  const body = `${who} just joined Feed The Bear with ${via}.`;
  let pushed = 0;
  if (prefs.push !== false) {
    const uids = (await Promise.all(OWNER_EMAILS().map(e => fb.auth().getUserByEmail(e).then(x => x.uid).catch(() => null)))).filter(Boolean);
    const tokens = uids.length ? (await db.getAll(...uids.map(x => db.doc(`pushTokens/${x}`)))).flatMap(s => s.data()?.tokens || []) : [];
    if (tokens.length) {
      const r = await sendMulticast(fb, {
        tokens, notification: { title, body }, data: { open: 'owner' },
        android: { priority: 'high', notification: { tag: `signup-${uid}` } },
      });
      pushed = r.successCount;
    }
  }
  // Their welcome email: three easy first things to do.
  if (u.email && emailReady()) {
    const first = String(u.displayName || '').trim().split(/\s+/)[0];
    await sendEmail({
      to: u.email, name: u.displayName || '', tag: 'welcome', subject: 'Welcome to the den 🐻',
      html: emailHtml([
        `<b>Welcome${first ? `, ${esc(first)}` : ''}!</b> Feed The Bear is your food diary: where you've eaten, what to order again, and where to go next.`,
        'Three things to do first (about a minute):<br>1. <b>Save 3 spots</b> you love or want to try. Tap the big + button.<br>2. <b>Play Bear Swipe</b> on Home so the bear learns what you like.<br>3. <b>Turn on location</b> to see the best food near you right now.',
        '<a href="https://www.feed-the-bear.com/app.html" style="display:inline-block;background:#ff8a3d;color:#1b130b;font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none">Open Feed The Bear</a>',
      ]),
    }).then(ok => ok && Promise.all([ref.set({ welcomedAt: new Date().toISOString() }, { merge: true }), bump(db, fb, 'welcome_email_sent')]))
      .catch(err => console.warn('[FTB] welcome email failed:', err.message));
  }

  let emailed = false;
  if (prefs.email !== false && emailReady()) {
    emailed = await sendEmail({
      to: process.env.OWNER_EMAIL || 'cmc@conniemichelleconsulting.com', tag: 'owner-signup', subject: `New sign-up: ${u.email || u.displayName || 'someone'}`,
      html: emailHtml([`<b>${esc(who)}</b> just joined Feed The Bear with ${esc(via)}.`,
        '<a href="https://www.feed-the-bear.com/owner.html" style="color:#b3541e;font-weight:700">See all sign-ups in the owner portal</a>']),
    }).catch(err => { console.warn('[FTB] signup email failed:', err.message); return false; });
  }
  return { told: true, pushed, emailed };
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let fb, uid;
  try {
    fb = getAdmin();
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    uid = (await fb.auth().verifyIdToken(token)).uid;
  } catch {
    return res.status(401).json({ error: 'Sign in first' });
  }
  const db = fb.firestore();
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const FieldValue = fb.firestore.FieldValue;

  try {
    if (body.action === 'register' || body.action === 'unregister') {
      const t = String(body.token || '');
      if (t.length < 20 || t.length > 4096) return res.status(400).json({ error: 'Bad token' });
      const ref = db.doc(`pushTokens/${uid}`);
      const list = ((await ref.get()).data()?.tokens || []).filter(x => x !== t);
      if (body.action === 'register') list.push(t);
      await ref.set({ tokens: list.slice(-MAX_TOKENS), at: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'follows') {
      const plan = (await db.doc(`users/${uid}/meta/profile`).get()).data()?.plan === 'grizzly' ? 'grizzly' : 'free';
      // Free accounts follow one friend (Grizzly: everyone), so they get one friend's pings.
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter(x => ID_RE.test(x)))].slice(0, plan === 'grizzly' ? MAX_FOLLOWS : 1);
      const ref = db.doc(`pushFollows/${uid}`);
      const before = (await ref.get()).data()?.ids || [];
      const added = ids.filter(x => !before.includes(x));
      const removed = before.filter(x => !ids.includes(x));
      await Promise.all([
        ...added.map(x => db.doc(`followers/${x}`).set({ uids: FieldValue.arrayUnion(uid) }, { merge: true })),
        ...removed.map(x => db.doc(`followers/${x}`).set({ uids: FieldValue.arrayRemove(uid) }, { merge: true })),
      ]);
      await ref.set({ ids });
      return res.status(200).json({ ok: true, added: added.length, removed: removed.length });
    }

    // Roughly where this phone is (2 decimals, ~1 km), its state, alert distance
    // and Want to Try pins: api/nudges.js uses them for the weekly "near you"
    // nudge and contests in your state. Sent at most once a day by the app.
    if (body.action === 'area') {
      const num = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Math.round(Number(v) * 100) / 100 : null);
      const lat = num(body.lat, -90, 90);
      const lng = num(body.lng, -180, 180);
      if (lat === null || lng === null) return res.status(400).json({ error: 'Bad place' });
      const st = /^[A-Z]{2}$/.test(String(body.state || '')) ? String(body.state) : '';
      const miles = [1, 5, 10, 25, 50].includes(Number(body.miles)) ? Number(body.miles) : 10;
      const want = (Array.isArray(body.want) ? body.want : []).slice(0, 100).map(w => ({
        n: String(w?.n || '').slice(0, 60), lat: num(w?.lat, -90, 90), lng: num(w?.lng, -180, 180),
      })).filter(w => w.n && w.lat !== null && w.lng !== null);
      await db.doc(`pushArea/${uid}`).set({ lat, lng, state: st, miles, want, at: new Date().toISOString() }, { merge: true });
      return res.status(200).json({ ok: true });
    }

    if (body.action === 'joined') return res.status(200).json(await joined(db, fb, uid));

    if (body.action === 'notify') {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad id' });
      return res.status(200).json(await notify(db, fb, uid, id));
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[FTB] push error:', err.message);
    return res.status(500).json({ error: 'Could not do that' });
  }
};

module.exports.messageFor = messageFor;
