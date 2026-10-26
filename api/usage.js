/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Usage Dashboard Data
   ════════════════════════════════════════════════════════════
   Reads the daily counters written by track.js (analytics/{date}) for
   the private dashboard at /usage.html. Owner only: the caller sends a
   Firebase ID token, and its verified email must be in ADMIN_EMAILS.

   GET /api/usage?days=30   ->   { days: [{ date, counts }] }  (oldest first)

   Environment variables required:
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON service account key
     ADMIN_EMAILS             - Comma-separated emails allowed to view usage
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const MAX_DAYS = 90;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

function adminEmails () {
  return (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

// UTC day keys, oldest first, ending today.
function dayKeys (n) {
  const keys = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) keys.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  return keys;
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const allowed = adminEmails();
  if (!allowed.length) {
    res.status(503).json({ error: 'ADMIN_EMAILS is not set in Vercel yet.' });
    return;
  }
  const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!idToken) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }

  let fb;
  try {
    fb = getAdmin();
    const decoded = await fb.auth().verifyIdToken(idToken);
    const email = (decoded.email || '').toLowerCase();
    if (!decoded.email_verified || !allowed.includes(email)) {
      res.status(403).json({ error: 'This account cannot view usage.' });
      return;
    }
  } catch (err) {
    console.error('[FTB] usage token verify failed:', err.message);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  try {
    const n = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(req.query?.days)) || 30));
    const keys = dayKeys(n);
    const db = fb.firestore();
    const snaps = await db.getAll(...keys.map(k => db.doc(`analytics/${k}`)));
    const days = snaps.map((s, i) => ({ date: keys[i], counts: (s.exists && s.data().counts) || {} }));
    res.status(200).json({ days });
  } catch (err) {
    console.error('[FTB] usage read error:', err.message);
    res.status(500).json({ error: 'Could not read usage' });
  }
};
