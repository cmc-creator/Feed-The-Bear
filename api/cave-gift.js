/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Bear Cave gifts
   ════════════════════════════════════════════════════════════
   A visitor on a public Bear Cave page (feed-the-bear.com/@you) can
   leave the cave owner one small gift a day — a food for their pantry
   or a decor piece for their cave. Free, no account needed — the
   visitor id is the same random id kept in the browser as the cave
   vote (ftb_voter_id). The gift lands on the owner's saved profile
   (users/{uid}/meta/profile): caveGifts (newest first, capped at 20)
   and, for food, one more of that food in their pantry. The owner
   sees "You got a gift" in cave setup and claims decor gifts there.
   One gift per visitor per day, tracked in
   caveGiftLog/{shareId}/days/{voterId} ({ date: 'YYYY-MM-DD' }).
     GET  ?share=<id>&voter=<vid>                 -> { giftedToday }
     POST { share, voter, gift: { kind, id } }    -> { ok, gift }

   Environment: FIREBASE_SERVICE_ACCOUNT (same as verify-session.js)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const ID_RE = /^[a-z0-9]{8,40}$/;
const VOTER_RE = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_GIFTS = 20;

// The gift menu (mirrors the public cave page, api/creator.js): the 25
// food-fight foods go to the pantry, small decor pieces are claimed
// from the owner's cave setup.
const GIFT_FOODS = {
  pie: 'Pie', taco: 'Taco', spaghetti: 'Spaghetti', donut: 'Donut', pizza: 'Pizza',
  cake: 'Cake', burger: 'Burger', hotdog: 'Hot Dog', sushi: 'Sushi', ramen: 'Ramen',
  icecream: 'Ice Cream', cupcake: 'Cupcake', cookie: 'Cookie', popcorn: 'Popcorn',
  fries: 'Fries', sandwich: 'Sandwich', burrito: 'Burrito', pancake: 'Pancake',
  waffle: 'Waffle', cheese: 'Cheese', egg: 'Egg', bacon: 'Bacon', corn: 'Corn',
  apple: 'Apple', pretzel: 'Pretzel',
};
const GIFT_DECOR = {
  lantern: 'Lantern glow', honeypot: 'Honey pot', picnic: 'Picnic basket',
  mushroom: 'Mushroom patch', campfire: 'Campfire', crystal: 'Crystal cluster',
};
function giftLabel (gift) {
  if (!gift || typeof gift !== 'object') return null;
  if (gift.kind === 'food') return GIFT_FOODS[gift.id] || null;
  if (gift.kind === 'decor') return GIFT_DECOR[gift.id] || null;
  return null;
}

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
    console.error('[FTB] cave gift init failed:', err.message);
    return res.status(503).json({ error: 'Gifts are not available right now.' });
  }

  try {
    const body = (req.method === 'POST' && req.body && typeof req.body === 'object') ? req.body : {};
    const share = String(req.method === 'GET' ? (req.query?.share || '') : (body.share || '')).trim();
    const voter = String(req.method === 'GET' ? (req.query?.voter || '') : (body.voter || '')).trim();
    if (!ID_RE.test(share)) return res.status(400).json({ error: 'That cave link does not look right.' });
    if (!VOTER_RE.test(voter)) return res.status(400).json({ error: 'Something is off with that gift.' });

    // The cave must exist: a live profile with this share id.
    const profile = await db.doc(`profiles/${share}`).get();
    if (!profile.exists) return res.status(404).json({ error: 'That cave was not found.' });
    const ownerUid = profile.data()?.uid;
    if (typeof ownerUid !== 'string' || !ownerUid) return res.status(404).json({ error: 'That cave was not found.' });

    const today = new Date().toISOString().slice(0, 10);
    const logRef = db.doc(`caveGiftLog/${share}/days/${voter}`);
    const giftedToday = async () => {
      const snap = await logRef.get();
      return snap.exists && snap.data()?.date === today;
    };

    if (req.method === 'GET') {
      return res.status(200).json({ giftedToday: await giftedToday() });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }

    const label = giftLabel(body.gift);
    if (!label) return res.status(400).json({ error: 'Pick a gift from the list.' });
    if (await overLimit(`cavegift:${ip}`, 60, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
    if (await giftedToday()) return res.status(409).json({ error: 'You already left a gift today — come back tomorrow.' });

    const gift = { kind: body.gift.kind, id: body.gift.id, label, at: new Date().toISOString() };
    const profileRef = db.doc(`users/${ownerUid}/meta/profile`);
    await db.runTransaction(async tx => {
      const snap = await tx.get(profileRef);
      const data = snap.exists ? (snap.data() || {}) : {};
      const gifts = Array.isArray(data.caveGifts) ? data.caveGifts : [];
      const next = [gift, ...gifts].slice(0, MAX_GIFTS);
      const update = { caveGifts: next };
      if (gift.kind === 'food') {
        const pantry = { ...(data.pantry || {}) };
        pantry[gift.id] = Math.max(0, Math.floor(Number(pantry[gift.id]) || 0)) + 1;
        update.pantry = pantry;
      }
      tx.set(profileRef, update, { merge: true });
      tx.set(logRef, { date: today, kind: gift.kind, id: gift.id });
    });
    return res.status(200).json({ ok: true, gift });
  } catch (err) {
    console.error('[FTB] cave gift error:', err.message);
    return res.status(500).json({ error: 'That did not work. Please try again.' });
  }
};
