/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Dinner Vote
   ════════════════════════════════════════════════════════════
   One person picks 2-6 spots and shares a link (vote.html?v=CODE).
   Friends say yes or no to each spot; no app or account needed.
     POST { action: 'create', host, options: [{ name, cuisine, address, lat, lng, rating }] } → { code }
     GET  ?code=CODE                                         → the room with its tally and winner
     POST { action: 'vote', code, voter: { id, name }, yes: [optionIndex, …] } → the room
   Stored server-side in dinnerVotes/{code} (no client Firestore rules
   needed); rooms close after 3 days.

   Environment: FIREBASE_SERVICE_ACCOUNT (same as verify-session.js)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const ROOM_DAYS = 3;
const MAX_OPTIONS = 6;
const MAX_VOTERS = 30;
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const hits = new Map();
function limited (ip, max) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

function newCode () {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHA[Math.floor(Math.random() * CODE_ALPHA.length)];
  return out;
}

// What everyone sees: the spots, yes-counts, who voted, and the leader.
function publicRoom (code, room) {
  const voters = Object.values(room.votes || {});
  const yes = room.options.map((_, i) => voters.filter(v => (v.yes || []).includes(i)).length);
  let winner = null;
  if (voters.length) {
    const best = Math.max(...yes);
    if (best > 0) {
      // A tie goes to the better-rated spot.
      winner = yes.map((n, i) => ({ n, i, r: room.options[i].rating || 0 })).filter(x => x.n === best).sort((a, b) => b.r - a.r)[0].i;
    }
  }
  return {
    code,
    host: room.host || '',
    options: room.options,
    yes,
    voters: voters.map(v => v.name || 'A friend'),
    winner,
    closed: Date.parse(room.expiresAt) < Date.now(),
    expiresAt: room.expiresAt,
  };
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  let db;
  try { db = getAdmin().firestore(); } catch (err) {
    console.error('[FTB] vote init failed:', err.message);
    return res.status(503).json({ error: 'Voting is not available right now.' });
  }

  try {
    if (req.method === 'GET') {
      const code = text(req.query.code, 8).toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return res.status(400).json({ error: 'That vote code does not look right.' });
      const snap = await db.doc(`dinnerVotes/${code}`).get();
      if (!snap.exists) return res.status(404).json({ error: 'That vote was not found. It may have ended.' });
      return res.status(200).json(publicRoom(code, snap.data()));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = req.body || {};
    if (body.action === 'create') {
      if (limited(ip, 20)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const options = (Array.isArray(body.options) ? body.options : []).slice(0, MAX_OPTIONS).map(o => ({
        name: text(o?.name, 80), cuisine: text(o?.cuisine, 40), address: text(o?.address, 160),
        lat: num(o?.lat), lng: num(o?.lng), rating: Math.min(5, Math.max(0, Number(o?.rating) || 0)),
      })).filter(o => o.name);
      if (options.length < 2) return res.status(400).json({ error: 'Pick at least 2 spots to vote on.' });
      let code = newCode();
      for (let i = 0; i < 5 && (await db.doc(`dinnerVotes/${code}`).get()).exists; i++) code = newCode();
      const now = Date.now();
      await db.doc(`dinnerVotes/${code}`).set({
        host: text(body.host, 30), options, votes: {},
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ROOM_DAYS * 864e5).toISOString(),
      });
      return res.status(200).json({ code });
    }

    if (body.action === 'vote') {
      if (limited(ip, 120)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
      const code = text(body.code, 8).toUpperCase();
      const voterId = text(body.voter?.id, 40).replace(/[^\w-]/g, '');
      if (!/^[A-Z0-9]{6}$/.test(code) || voterId.length < 8) return res.status(400).json({ error: 'Something is off with that vote.' });
      const ref = db.doc(`dinnerVotes/${code}`);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'That vote was not found. It may have ended.' });
      const room = snap.data();
      if (Date.parse(room.expiresAt) < Date.now()) return res.status(410).json({ error: 'This vote has ended.', ...publicRoom(code, room) });
      if (!room.votes?.[voterId] && Object.keys(room.votes || {}).length >= MAX_VOTERS) return res.status(409).json({ error: 'This vote is full.' });
      const yes = [...new Set((Array.isArray(body.yes) ? body.yes : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < room.options.length))];
      const votes = { ...(room.votes || {}), [voterId]: { name: text(body.voter?.name, 24) || 'A friend', yes, at: new Date().toISOString() } };
      await ref.set({ votes }, { merge: true });
      return res.status(200).json(publicRoom(code, { ...room, votes }));
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[FTB] vote error:', err.message);
    return res.status(500).json({ error: 'That did not work. Please try again.' });
  }
};
