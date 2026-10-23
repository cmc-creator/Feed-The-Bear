/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Usage Counters
   ════════════════════════════════════════════════════════════
   The app's product events (just_ate_logged, craving_alert_shown, ...)
   used to stay in each phone's localStorage, so nobody could see them.
   This adds up event COUNTS per UTC day in Firestore at analytics/{date}:
     { counts: { just_ate_logged: 42, ... }, updatedAt }
   Only event names and counts are accepted: no user ids, no payloads.

   Environment variables required (same as verify-session.js):
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON service account key
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const NAME_RE = /^[a-z][a-z0-9_]{2,47}$/;
const MAX_NAMES = 40;
const MAX_COUNT = 50;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

// navigator.sendBeacon posts text/plain, so the body may arrive as a string.
function readCounts (body) {
  let data = body;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  const counts = data && typeof data.counts === 'object' ? data.counts : null;
  if (!counts) return null;
  const clean = {};
  for (const [name, value] of Object.entries(counts).slice(0, MAX_NAMES)) {
    const n = Math.floor(Number(value));
    if (NAME_RE.test(name) && n > 0) clean[name] = Math.min(n, MAX_COUNT);
  }
  return Object.keys(clean).length ? clean : null;
}

module.exports = async function handler (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const counts = readCounts(req.body);
  if (!counts) {
    res.status(400).json({ error: 'Expected { counts: { event_name: n } }' });
    return;
  }

  try {
    const fb = getAdmin();
    const inc = fb.firestore.FieldValue.increment;
    const day = new Date().toISOString().slice(0, 10);
    const update = { counts: {}, updatedAt: fb.firestore.FieldValue.serverTimestamp() };
    Object.entries(counts).forEach(([name, n]) => { update.counts[name] = inc(n); });
    await fb.firestore().doc(`analytics/${day}`).set(update, { merge: true });
    res.status(204).end();
  } catch (err) {
    console.error('[FTB] track error:', err.message);
    res.status(500).json({ error: 'Could not record usage' });
  }
};
