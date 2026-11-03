/* Rate limits that hold across server restarts.
   Each function instance used to keep its own count in memory, which reset
   whenever Vercel started a fresh one. Now the count lives in Firestore
   (rateLimits/{hash of the key}: { w: window start, n }), checked in a
   transaction. A quick in-memory count still answers obvious floods without
   a database round trip. If the database can't be reached, the request is
   allowed: a hiccup shouldn't break the app for everyone. */

const crypto = require('crypto');
const admin = require('firebase-admin');

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const local = new Map();

// The caller's address (first hop Vercel saw).
function clientIp (req) {
  return String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

// True when `key` has made more than `max` requests in the last `windowSec` seconds.
async function overLimit (key, max, windowSec) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const recent = (local.get(key) || []).filter(t => now - t < windowMs);
  recent.push(now);
  local.set(key, recent);
  if (recent.length > max) return true;
  try {
    const db = getAdmin().firestore();
    const ref = db.doc(`rateLimits/${crypto.createHash('sha1').update(key).digest('hex').slice(0, 24)}`);
    return await db.runTransaction(async tx => {
      const cur = (await tx.get(ref)).data() || {};
      const start = Math.floor(now / windowMs) * windowMs;
      const n = cur.w === start ? (Number(cur.n) || 0) + 1 : 1;
      tx.set(ref, { w: start, n });
      return n > max;
    });
  } catch (err) {
    console.warn('[FTB] rate limit check failed:', err.message);
    return false;
  }
}

module.exports = { overLimit, clientIp };
