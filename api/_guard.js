/* Paid lookups (Google Places, Foursquare, Yelp) are only for signed-in
   members, with a daily cap per account, so nobody who finds these URLs can
   run up the bill. The app sends its Firebase ID token in X-FTB-Token, not
   Authorization, so the CDN still caches answers by URL: a cached answer
   never reaches the function (or Google) at all.
   Needs FIREBASE_SERVICE_ACCOUNT, like the other functions. */

const admin = require('firebase-admin');

const DAILY_LOOKUPS = 400;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

// The member's uid, or null after answering 401/429 for them.
async function guard (req, res) {
  const token = String(req.headers?.['x-ftb-token'] || '');
  let uid = null;
  try {
    if (token) uid = (await getAdmin().auth().verifyIdToken(token)).uid;
  } catch { uid = null; }
  if (!uid) {
    res.status(401).json({ error: 'Sign in to look places up.' });
    return null;
  }
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = getAdmin().firestore().doc(`apiQuota/${uid}`);
    const q = (await ref.get()).data() || {};
    const used = q.day === day ? Number(q.n) || 0 : 0;
    if (used >= DAILY_LOOKUPS) {
      res.status(429).json({ error: "That's a lot of lookups today. Try again tomorrow." });
      return null;
    }
    await ref.set({ day, n: used + 1 });
  } catch (err) {
    // A database hiccup shouldn't break the app for a signed-in member.
    console.warn('[FTB] lookup quota check failed:', err.message);
  }
  return uid;
}

module.exports = { guard, DAILY_LOOKUPS };
