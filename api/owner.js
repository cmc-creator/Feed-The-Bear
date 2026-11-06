/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: owner portal (/owner.html)
   ════════════════════════════════════════════════════════════
   Owner only: a Firebase ID token whose verified email is an owner
   (ADMIN_EMAILS plus OWNERS below).

   GET                                   → { vips, codes }
   POST { action: 'grant', email, months, note }   free Grizzly (months 0 = for good)
   POST { action: 'revoke', email }                 end it
   POST { action: 'code', code, percent, duration, months, maxUses, expiresDays }
        a Stripe discount code (duration: once | repeating | forever)
   POST { action: 'codeOff', id }                   switch a code off

   VIPs are kept in vips/{email}. Someone without an account yet gets it the
   first time they sign in with that email (verify-session.js 'restore', via
   applyPendingVip). nudges.js ends expired ones each morning (expireVips).
   A VIP who also pays keeps Grizzly through the subscription when it ends.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const Stripe = require('stripe');

const OWNERS = ['cmc@conniemichelleconsulting.com'];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;
const APP = 'https://www.feed-the-bear.com';

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

function owners () {
  const extra = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return new Set([...OWNERS, ...extra]);
}

const stripeOrNull = () => (process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null);
const vipRef = (db, email) => db.doc(`vips/${email.toLowerCase()}`);
const isLive = (v, now = Date.now()) => !!v && v.active !== false && (!v.until || Date.parse(v.until) > now);

// Has a Stripe subscription that is still running (so Grizzly stays when a VIP ends).
async function paying (stripe, profile) {
  if (!stripe || !profile?.stripeCustomerId) return false;
  try {
    const subs = await stripe.subscriptions.list({ customer: profile.stripeCustomerId, status: 'all', limit: 10 });
    return subs.data.some(s => ['active', 'trialing', 'past_due'].includes(s.status));
  } catch { return false; }
}

async function applyVip (db, uid, vip) {
  await db.doc(`users/${uid}/meta/profile`).set({
    plan: 'grizzly', compedBy: 'owner', vipUntil: vip.until || null, upgradedAt: new Date().toISOString(),
  }, { merge: true });
}

async function endVip (db, stripe, email) {
  const ref = vipRef(db, email);
  const v = (await ref.get()).data();
  if (!v) return false;
  await ref.set({ active: false, endedAt: new Date().toISOString() }, { merge: true });
  if (v.uid) {
    const pref = db.doc(`users/${v.uid}/meta/profile`);
    const profile = (await pref.get()).data() || {};
    if (profile.compedBy === 'owner' && !(await paying(stripe, profile))) {
      await pref.set({ plan: 'free', compedBy: admin.firestore.FieldValue.delete(), vipUntil: admin.firestore.FieldValue.delete() }, { merge: true });
    }
  }
  return true;
}

// Grizzly for this email: now if they have an account, else at first sign-in.
// Months add on to time they already have (a second gift extends the first).
async function grantVip (db, fb, { email, months = 0, note = '', by = '' }) {
  email = String(email).trim().toLowerCase();
  months = Math.max(0, Math.min(60, Math.floor(Number(months) || 0)));
  const cur = (await vipRef(db, email).get()).data();
  const from = isLive(cur) && cur.until ? Math.max(Date.now(), Date.parse(cur.until)) : Date.now();
  const forGood = isLive(cur) && !cur.until;
  const until = forGood || !months ? null : new Date(from + months * 30.44 * 86400000).toISOString();
  let uid = null;
  try { uid = (await fb.auth().getUserByEmail(email)).uid; } catch { /* no account yet */ }
  const vip = { email, until, note: String(note || '').slice(0, 120), at: new Date().toISOString(), by, active: true, uid, pending: !uid };
  await vipRef(db, email).set(vip);
  if (uid) await applyVip(db, uid, vip);
  return { pending: !uid, until };
}

// Signed in for the first time with an email the owner made a VIP: Grizzly now.
async function applyPendingVip (db, uid, email) {
  if (!email) return false;
  const ref = vipRef(db, email);
  const v = (await ref.get()).data();
  if (!isLive(v) || (v.uid && v.uid !== uid)) return false;
  await applyVip(db, uid, v);
  await ref.set({ uid, pending: false, claimedAt: new Date().toISOString() }, { merge: true });
  return true;
}

// Is this account a live VIP (so a cancelled subscription doesn't end Grizzly)?
async function vipFor (db, uid) {
  const snap = await db.collection('vips').where('uid', '==', uid).limit(5).get();
  return snap.docs.some(d => isLive(d.data()));
}

// Each morning (nudges.js): VIPs whose time is up go back to free.
async function expireVips (db) {
  const snap = await db.collection('vips').where('active', '==', true).limit(500).get();
  const now = Date.now();
  const stripe = stripeOrNull();
  let ended = 0;
  for (const d of snap.docs) {
    const v = d.data();
    if (v.until && Date.parse(v.until) <= now) { await endVip(db, stripe, d.id); ended++; }
  }
  return ended;
}

async function listCodes (stripe) {
  if (!stripe) return { codes: [], error: 'Stripe is not set up.' };
  const list = await stripe.promotionCodes.list({ limit: 50 });
  return {
    codes: list.data.map(p => ({
      id: p.id, code: p.code, active: p.active, used: p.times_redeemed || 0, maxUses: p.max_redemptions || null,
      expires: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null,
      percent: p.coupon?.percent_off || null, amountOff: p.coupon?.amount_off || null,
      duration: p.coupon?.duration || '', months: p.coupon?.duration_in_months || null,
      link: `${APP}/app.html?promo=${encodeURIComponent(p.code)}`,
    })),
  };
}

const PARTNER_KEYS = ['opentable', 'resy', 'yelp', 'doordash', 'ubereats', 'grubhub'];
// Affiliate codes for Book a table / Order delivery (app.js partnerUrl): a
// tracking link with {url}, or extra query text. Public: they end up in links.
async function partnerCodes (db) {
  const d = (await db.doc('config/partners').get()).data() || {};
  return Object.fromEntries(PARTNER_KEYS.map(k => [k, String(d[k] || '').slice(0, 300)]));
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.query?.partners) {
    try {
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
      return res.status(200).json({ partners: await partnerCodes(getAdmin().firestore()) });
    } catch { return res.status(200).json({ partners: {} }); }
  }
  let fb, me;
  try {
    fb = getAdmin();
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in first.' });
    const decoded = await fb.auth().verifyIdToken(token);
    me = String(decoded.email || '').toLowerCase();
    if (!decoded.email_verified || !owners().has(me)) return res.status(403).json({ error: 'This account is not an owner.' });
  } catch {
    return res.status(401).json({ error: 'Your sign-in expired. Sign in again.' });
  }
  const db = fb.firestore();
  const stripe = stripeOrNull();
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});

  try {
    if (req.method === 'GET') {
      const snap = await db.collection('vips').orderBy('at', 'desc').limit(200).get();
      const vips = snap.docs.map(d => {
        const v = d.data();
        return { email: d.id, note: v.note || '', until: v.until || null, at: v.at || '', live: isLive(v), pending: !v.uid, endedAt: v.endedAt || null };
      });
      const codes = await listCodes(stripe).catch(err => ({ codes: [], error: err.message }));
      return res.status(200).json({ vips, codes: codes.codes, codesError: codes.error || null, me, partners: await partnerCodes(db) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (body.action === 'grant') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email does not look right.' });
      const r = await grantVip(db, fb, { email, months: body.months, note: body.note, by: me });
      return res.status(200).json({ ok: true, pending: r.pending, until: r.until,
        message: !r.pending ? `${email} has Grizzly now${r.until ? ` until ${r.until.slice(0, 10)}` : ''}.` : `${email} gets Grizzly the first time they sign in with that email.` });
    }

    if (body.action === 'revoke') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!(await endVip(db, stripe, email))) return res.status(404).json({ error: 'No VIP with that email.' });
      return res.status(200).json({ ok: true, message: `${email} is no longer a VIP.` });
    }

    if (body.action === 'code') {
      if (!stripe) return res.status(503).json({ error: 'Stripe is not set up.' });
      const code = String(body.code || '').trim().toUpperCase();
      if (!CODE_RE.test(code)) return res.status(400).json({ error: 'Codes are 3 to 30 letters, numbers, - or _.' });
      const percent = Math.floor(Number(body.percent));
      if (!(percent >= 1 && percent <= 100)) return res.status(400).json({ error: 'Pick a discount from 1% to 100%.' });
      const duration = ['once', 'repeating', 'forever'].includes(body.duration) ? body.duration : 'once';
      const months = Math.max(1, Math.min(36, Math.floor(Number(body.months) || 1)));
      const maxUses = Math.floor(Number(body.maxUses) || 0);
      const expiresDays = Math.floor(Number(body.expiresDays) || 0);
      const existing = await stripe.promotionCodes.list({ code, limit: 1 });
      if (existing.data.length) return res.status(409).json({ error: `The code ${code} already exists. Pick another.` });
      const coupon = await stripe.coupons.create({
        percent_off: percent, duration, ...(duration === 'repeating' ? { duration_in_months: months } : {}),
        name: `VIP ${code} (${percent}% off)`.slice(0, 40), metadata: { by: me },
      });
      const promo = await stripe.promotionCodes.create({
        coupon: coupon.id, code,
        ...(maxUses > 0 ? { max_redemptions: maxUses } : {}),
        ...(expiresDays > 0 ? { expires_at: Math.floor(Date.now() / 1000) + expiresDays * 86400 } : {}),
        metadata: { by: me },
      });
      return res.status(200).json({ ok: true, code: promo.code, link: `${APP}/app.html?promo=${encodeURIComponent(promo.code)}`, message: `${promo.code} is ready.` });
    }

    if (body.action === 'partners') {
      const next = {};
      for (const k of PARTNER_KEYS) {
        const v = String(body.partners?.[k] || '').trim().slice(0, 300);
        if (v && /^https?:\/\//i.test(v) && !v.includes('{url}')) return res.status(400).json({ error: `The ${k} link needs {url} where the restaurant's page goes.` });
        if (/[<>"\s]/.test(v)) return res.status(400).json({ error: `The ${k} code has spaces or symbols that can't go in a link.` });
        next[k] = v;
      }
      await db.doc('config/partners').set(next);
      return res.status(200).json({ ok: true, message: 'Affiliate codes saved. Book and Order links use them within the hour.' });
    }

    if (body.action === 'codeOff') {
      if (!stripe) return res.status(503).json({ error: 'Stripe is not set up.' });
      const id = String(body.id || '');
      if (!/^promo_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'Bad code.' });
      await stripe.promotionCodes.update(id, { active: false });
      return res.status(200).json({ ok: true, message: 'That code is switched off.' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[FTB] owner error:', err.message);
    return res.status(500).json({ error: err.message || 'That did not work.' });
  }
};

module.exports.applyPendingVip = applyPendingVip;
module.exports.grantVip = grantVip;
module.exports.expireVips = expireVips;
module.exports.vipFor = vipFor;
module.exports.isLive = isLive;
