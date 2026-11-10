/* Paid lookups (Google Places, Foursquare, Yelp) are only for signed-in
   members, with a daily cap per account, so nobody who finds these URLs can
   run up the bill. The app sends its Firebase ID token in X-FTB-Token, not
   Authorization, so the CDN still caches answers by URL: a cached answer
   never reaches the function (or Google) at all.
   Needs FIREBASE_SERVICE_ACCOUNT, like the other functions. */

const admin = require('firebase-admin');

const DAILY_LOOKUPS = 400;

// Email verification (2026-11-10): accounts created after this must confirm
// their inbox before paid lookups. Same date as firebase.js EMAIL_VERIFY_CUTOFF;
// accounts created before it never had verification, so they keep working.
const EMAIL_VERIFY_CUTOFF = Date.parse('2026-11-10T21:00:00Z');

// True when the account was created before email verification was added.
async function _createdBeforeCutoff (uid) {
  try {
    const rec = await getAdmin().auth().getUser(uid);
    const created = Date.parse(rec.metadata.creationTime || '') || 0;
    return created < EMAIL_VERIFY_CUTOFF;
  } catch {
    // Can't tell: don't break the app for a signed-in member.
    return true;
  }
}

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

// The member's uid, or null after answering 401/403/429 for them.
async function guard (req, res) {
  const token = String(req.headers?.['x-ftb-token'] || '');
  let decoded = null;
  try {
    if (token) decoded = await getAdmin().auth().verifyIdToken(token);
  } catch { decoded = null; }
  if (!decoded) {
    res.status(401).json({ error: 'Sign in to look places up.' });
    return null;
  }
  const uid = decoded.uid;
  // Unverified email accounts created after verification was added can't use
  // paid lookups. Google accounts and confirmed emails carry email_verified;
  // older accounts are grandfathered by creation date.
  if (decoded.email_verified === false && !(await _createdBeforeCutoff(uid))) {
    res.status(403).json({ error: 'Verify your email to look places up. Check your inbox for the link.' });
    return null;
  }
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = getAdmin().firestore().doc(`apiQuota/${uid}`);
    // Counted in a transaction: parallel requests serialize, so one
    // account can't blow past the cap by firing many at once.
    const over = await getAdmin().firestore().runTransaction(async tx => {
      const q = (await tx.get(ref)).data() || {};
      const used = q.day === day ? Number(q.n) || 0 : 0;
      if (used >= DAILY_LOOKUPS) return true;
      tx.set(ref, { day, n: used + 1 });
      return false;
    });
    if (over) {
      res.status(429).json({ error: "That's a lot of lookups today. Try again tomorrow." });
      return null;
    }
  } catch (err) {
    // A database hiccup shouldn't break the app for a signed-in member.
    console.warn('[FTB] lookup quota check failed:', err.message);
  }
  return uid;
}

// 'grizzly' or 'free', from the server-written profile.
async function planOf (uid) {
  try {
    return (await getAdmin().firestore().doc(`users/${uid}/meta/profile`).get()).data()?.plan === 'grizzly' ? 'grizzly' : 'free';
  } catch { return 'free'; }
}

// The signed-in member ({ uid, plan }) from X-FTB-Token, or null.
async function member (req) {
  try {
    const token = String(req.headers?.['x-ftb-token'] || '');
    if (!token) return null;
    const uid = (await getAdmin().auth().verifyIdToken(token)).uid;
    return { uid, plan: await planOf(uid) };
  } catch { return null; }
}

module.exports = { guard, planOf, member, DAILY_LOOKUPS };
