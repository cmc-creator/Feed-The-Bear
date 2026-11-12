/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: cave fun-point awards from the
   public cave page (vote +2, gift given +5).

   The public cave page has no app auth — the visitor id is a random
   browser id — so an award is only given when the visitor is also
   signed into the app on this device (the uid lives in localStorage)
   AND the action is verified server-side: the vote (or gift) must
   actually exist for this voter. One award per cave per day, tracked
   in the profile (caveFunDays). Awards land in caveFun, which the app
   counts toward lifetime exactly like activity points.
     POST { action: 'vote' | 'giftGiven', share, voter, uid }
       -> { ok, awarded } | { ok: false, reason }

   Environment: FIREBASE_SERVICE_ACCOUNT (same as verify-session.js)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const ID_RE = /^[a-z0-9]{8,40}$/;
const VOTER_RE = /^[A-Za-z0-9_-]{8,40}$/;
const UID_RE = /^[A-Za-z0-9]{10,64}$/;
const AWARDS = { vote: 2, giftGiven: 5 };

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  let fb;
  try { fb = getAdmin(); } catch (err) {
    console.error('[FTB] cave points init failed:', err.message);
    return res.status(503).json({ error: 'Points are not available right now.' });
  }
  const db = fb.firestore();

  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const action = String(body.action || '');
    const amount = AWARDS[action];
    if (!amount) return res.status(400).json({ error: 'Unknown award.' });
    const share = String(body.share || '').trim();
    const voter = String(body.voter || '').trim();
    const uid = String(body.uid || '').trim();
    if (!ID_RE.test(share) || !VOTER_RE.test(voter) || !UID_RE.test(uid)) return res.status(400).json({ error: 'Bad request.' });
    if (await overLimit(`cavepoints:${ip}`, 30, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });

    // The uid must be a real account.
    try { await fb.auth().getUser(uid); } catch { return res.status(400).json({ error: 'Bad request.' }); }
    // The action must have actually happened for this voter.
    const today = new Date().toISOString().slice(0, 10);
    if (action === 'vote') {
      const v = await db.doc(`caveVotes/${share}/votes/${voter}`).get();
      if (!v.exists) return res.status(200).json({ ok: false, reason: 'novote' });
    } else {
      const g = await db.doc(`caveGiftLog/${share}/days/${voter}`).get();
      if (!g.exists || g.data()?.date !== today) return res.status(200).json({ ok: false, reason: 'nogift' });
    }

    const key = `${action}:${share}`;
    const profileRef = db.doc(`users/${uid}/meta/profile`);
    const awarded = await db.runTransaction(async tx => {
      const snap = await tx.get(profileRef);
      const p = snap.exists ? (snap.data() || {}) : {};
      const days = { ...(p.caveFunDays || {}) };
      if (days[key] === today) return false;
      days[key] = today;
      const fun = Math.max(0, Math.floor(Number(p.caveFun) || 0)) + amount;
      // The stored lifetime is only a high-water floor — the client
      // derives the true lifetime from activity + bonus + fun — so
      // keep the floor at least at the new fun total plus the bonus.
      const lifetime = Math.max(Math.floor(Number(p.caveLifetime) || 0), fun + Math.floor(Number(p.caveBonus) || 0));
      tx.set(profileRef, { caveFun: fun, caveFunDays: days, caveLifetime: lifetime }, { merge: true });
      return true;
    });
    return res.status(200).json({ ok: true, awarded });
  } catch (err) {
    console.error('[FTB] cave points error:', err.message);
    return res.status(500).json({ error: 'That did not work. Please try again.' });
  }
};
