/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Food fight between friends
   ════════════════════════════════════════════════════════════
   POST, signed in (X-FTB-Token or Authorization: Bearer <ID token>):
     { action: 'throw', to: shareId, food, name }   throw at a friend you follow
     { action: 'throw', pair, food, name }          throw back at whoever hit you
     { action: 'inbox' }                            food thrown at you (marks it seen)
     { action: 'scores', ids: [shareId, ...] }      your score with each friend

   Server-only data (Admin SDK; clients can't read or write it):
     foodfights/{uidA_uidB}   { uids: [a, b], score: { uid: n }, last: { by, food, at } }
     foodfightInbox/{uid}     { hits: [{ pair, name, food, at, seen }] }   newest last, max 20
     foodfightDaily/{uid}     { day, n, per: { pair: n } }
   A few throws a day keeps it cute instead of spammy.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { bump } = require('./_count');
const { sendMulticast } = require('./_push');

const FOODS = {
  pie: ['🥧', 'a pie'], taco: ['🌮', 'a taco'], spaghetti: ['🍝', 'spaghetti'],
  donut: ['🍩', 'a donut'], pizza: ['🍕', 'a slice of pizza'], cake: ['🎂', 'cake'],
};
const PER_DAY = 10;      // throws a day, in all
const PER_FRIEND = 3;    // throws a day at the same friend
const ID_RE = /^[a-z0-9]{8,40}$/;
const UID_RE = /^[A-Za-z0-9]{6,128}$/;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const pairKey = (a, b) => [a, b].sort().join('_');
const today = () => new Date(Date.now() - 7 * 3600e3).toISOString().slice(0, 10); // US-ish day
const cleanName = s => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30) || 'A friend';

async function pushTo (db, fb, uid, title, body) {
  const tokens = (await db.doc(`pushTokens/${uid}`).get()).data()?.tokens || [];
  if (!tokens.length) return 0;
  try {
    const r = await sendMulticast(fb, { tokens, notification: { title, body }, data: { open: 'foodfight' } });
    return r.successCount || 0;
  } catch (err) { console.warn('[FTB] food fight push failed:', err.message); return 0; }
}

async function throwFood (db, fb, uid, body) {
  const food = FOODS[body.food] ? body.food : 'pie';
  let target = '';
  if (body.pair) {
    const pair = String(body.pair);
    const doc = (await db.doc(`foodfights/${pair}`).get()).data();
    if (!doc || !Array.isArray(doc.uids) || !doc.uids.includes(uid)) return { status: 404, error: 'No food fight there yet' };
    target = doc.uids.find(x => x !== uid) || '';
  } else {
    const to = String(body.to || '');
    if (!ID_RE.test(to)) return { status: 400, error: 'Bad friend' };
    target = (await db.doc(`profiles/${to}`).get()).data()?.uid || '';
    if (!target) return { status: 404, error: 'Their profile is not live yet' };
  }
  if (!UID_RE.test(target) || target === uid) return { status: 400, error: "You can't throw food at yourself" };
  const pair = pairKey(uid, target);
  const name = cleanName(body.name);
  const at = new Date().toISOString();
  const result = await db.runTransaction(async tx => {
    const dailyRef = db.doc(`foodfightDaily/${uid}`);
    const fightRef = db.doc(`foodfights/${pair}`);
    const inboxRef = db.doc(`foodfightInbox/${target}`);
    const [d0, f0, i0] = await Promise.all([tx.get(dailyRef), tx.get(fightRef), tx.get(inboxRef)]);
    let daily = d0.data() || {};
    if (daily.day !== today()) daily = { day: today(), n: 0, per: {} };
    if (daily.n >= PER_DAY) return { limited: 'day' };
    if ((daily.per?.[pair] || 0) >= PER_FRIEND) return { limited: 'friend' };
    daily = { day: daily.day, n: daily.n + 1, per: { ...daily.per, [pair]: (daily.per?.[pair] || 0) + 1 } };
    const fight = f0.data() || { uids: [uid, target].sort(), score: {} };
    const score = { ...fight.score, [uid]: (fight.score?.[uid] || 0) + 1 };
    const hits = [...(i0.data()?.hits || []), { pair, name, food, at, seen: false }].slice(-20);
    tx.set(dailyRef, daily);
    tx.set(fightRef, { uids: fight.uids, score, last: { by: uid, food, at } });
    tx.set(inboxRef, { hits });
    return { score, left: Math.min(PER_DAY - daily.n, PER_FRIEND - daily.per[pair]) };
  });
  if (result.limited) {
    return { status: 429, error: result.limited === 'day' ? 'Out of food for today! More tomorrow.' : 'That is plenty of food for one friend today. More tomorrow!' };
  }
  const [emoji, what] = FOODS[food];
  const pushed = await pushTo(db, fb, target, `${name} threw ${what} at you! ${emoji}`, 'Splat! Tap to throw one back.');
  if (pushed) await bump(db, fb, 'food_fight_push_sent');
  return { status: 200, ok: true, pair, food, me: result.score[uid] || 0, them: result.score[target] || 0, left: result.left, pushed };
}

async function inbox (db, uid) {
  const ref = db.doc(`foodfightInbox/${uid}`);
  const hits = (await ref.get()).data()?.hits || [];
  const fresh = hits.filter(h => !h.seen);
  if (!fresh.length) return { hits: [] };
  await ref.set({ hits: hits.map(h => ({ ...h, seen: true })) });
  const pairs = [...new Set(fresh.map(h => h.pair))];
  const fights = await Promise.all(pairs.map(p => db.doc(`foodfights/${p}`).get().then(s => [p, s.data()])));
  const scoreOf = Object.fromEntries(fights.map(([p, f]) => {
    const other = (f?.uids || []).find(x => x !== uid);
    return [p, { me: f?.score?.[uid] || 0, them: f?.score?.[other] || 0 }];
  }));
  return { hits: fresh.slice(-5).map(h => ({ pair: h.pair, name: h.name, food: h.food, emoji: FOODS[h.food]?.[0] || '🥧', at: h.at, ...scoreOf[h.pair] })) };
}

async function scores (db, uid, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(x => ID_RE.test(x)))].slice(0, 50);
  const out = {};
  const live = [];
  await Promise.all(list.map(async id => {
    const other = (await db.doc(`profiles/${id}`).get()).data()?.uid;
    if (!other || other === uid) return;
    live.push(id);
    const pair = pairKey(uid, other);
    const f = (await db.doc(`foodfights/${pair}`).get()).data();
    if (f) out[id] = { pair, me: f.score?.[uid] || 0, them: f.score?.[other] || 0 };
  }));
  return { scores: out, live };
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let fb, uid;
  try {
    fb = getAdmin();
    const token = String(req.headers['x-ftb-token'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    uid = (await fb.auth().verifyIdToken(token)).uid;
  } catch {
    return res.status(401).json({ error: 'Sign in to start a food fight' });
  }
  const db = fb.firestore();
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  try {
    if (body.action === 'throw') { const { status, ...rest } = await throwFood(db, fb, uid, body); return res.status(status).json(rest); }
    if (body.action === 'inbox') return res.status(200).json(await inbox(db, uid));
    if (body.action === 'scores') return res.status(200).json(await scores(db, uid, body.ids));
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[FTB] food fight error:', err.message);
    return res.status(500).json({ error: 'Could not do that' });
  }
};

module.exports.FOODS = FOODS;
