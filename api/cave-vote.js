/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Bear Cave votes
   ════════════════════════════════════════════════════════════
   Friends tap "Love this cave" on a public Bear Cave page
   (feed-the-bear.com/@you). One vote per browser per cave; tapping
   again takes it back. No account needed — the voter id is a random
   id kept in the browser (like Dinner Vote). Stored server-side in
   caveVotes/{shareId}/votes/{voterId} (Admin SDK, so no client
   Firestore rules are needed).
     GET  ?share=<id>&voter=<vid>                 -> { count, voted }
     POST { action: 'vote' | 'unvote', share, voter } -> { count, voted }

   Environment: FIREBASE_SERVICE_ACCOUNT (same as verify-session.js)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const ID_RE = /^[a-z0-9]{8,40}$/;
const VOTER_RE = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_VOTERS = 500;

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
  let db;
  try { db = getAdmin().firestore(); } catch (err) {
    console.error('[FTB] cave vote init failed:', err.message);
    return res.status(503).json({ error: 'Voting is not available right now.' });
  }

  try {
    const body = (req.method === 'POST' && req.body && typeof req.body === 'object') ? req.body : {};
    const share = String(req.method === 'GET' ? (req.query?.share || '') : (body.share || '')).trim();
    const voter = String(req.method === 'GET' ? (req.query?.voter || '') : (body.voter || '')).trim();
    // The signed-in uid, when the voter is also signed into the app on
    // this device (the public page sends it). Only ever used to reject
    // an owner's vote for their own cave — never to grant anything.
    const uid = String(body.uid || '').trim();
    if (!ID_RE.test(share)) return res.status(400).json({ error: 'That cave link does not look right.' });
    if (!VOTER_RE.test(voter)) return res.status(400).json({ error: 'Something is off with that vote.' });
    if (uid && !/^[A-Za-z0-9]{10,64}$/.test(uid)) return res.status(400).json({ error: 'Something is off with that vote.' });

    // The cave must exist: a live profile with this share id.
    const profile = await db.doc(`profiles/${share}`).get();
    if (!profile.exists) return res.status(404).json({ error: 'That cave was not found.' });
    const ownerUid = profile.data()?.uid;

    const votesRef = db.collection(`caveVotes/${share}/votes`);
    const countVotes = async () => (await votesRef.get()).size;

    if (req.method === 'GET') {
      const voted = (await db.doc(`caveVotes/${share}/votes/${voter}`).get()).exists;
      return res.status(200).json({ count: await countVotes(), voted });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }

    if (body.action !== 'vote' && body.action !== 'unvote') return res.status(400).json({ error: 'Unknown action' });
    if (await overLimit(`cavevote:${ip}`, 60, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });

    // You can't vote for your own cave — that would inflate Cave of the Day.
    if (body.action === 'vote' && uid && ownerUid && uid === ownerUid) {
      return res.status(403).json({ error: 'You can\'t vote for your own cave.', reason: 'own-cave' });
    }

    const ref = db.doc(`caveVotes/${share}/votes/${voter}`);
    if (body.action === 'vote') {
      const snap = await votesRef.get();
      if (!snap.docs.some(d => d.id === voter) && snap.size >= MAX_VOTERS) {
        return res.status(409).json({ error: 'This cave has enough love for now.' });
      }
      // The uid is stored when the voter is signed in, so Cave of the
      // Day can exclude an owner's vote even if one slips through.
      await ref.set({ at: new Date().toISOString(), ...(uid ? { uid } : {}) });
    } else {
      await ref.delete();
    }
    return res.status(200).json({ count: await countVotes(), voted: body.action === 'vote' });
  } catch (err) {
    console.error('[FTB] cave vote error:', err.message);
    return res.status(500).json({ error: 'That did not work. Please try again.' });
  }
};
