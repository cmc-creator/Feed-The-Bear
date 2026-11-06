/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: daily nudges (Android app)
   ════════════════════════════════════════════════════════════
   GET (Vercel cron, every morning; Authorization: Bearer CRON_SECRET)

   1. Refreshes the nationwide contest list (api/food-events.js), so Play
      opens with it ready.
   2. For each phone that shared its area (api/push.js 'area') and can get
      notifications (pushTokens), at most one notification a day:
      - a contest in your state starting within 4 days (once per contest), or
      - Fridays/Saturdays, once a week: how many Want to Try spots are within
        your alert distance, to plan the weekend.
   Kept per member in pushArea/{uid}.sent.

   GET ?dry=1 (with the cron's Authorization) says what it would send, sends nothing.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { nationalList } = require('./food-events');
const { refreshGuides } = require('./guide');
const { expireVips } = require('./owner');

const DAY = 86400000;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

function miles (aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const h = Math.sin((bLat - aLat) * r / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin((bLng - aLng) * r / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const dayName = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });

// The one notification (or null) for this member today.
function pick (area, events, now = Date.now()) {
  const sent = area.sent || {};
  if (now - (sent.lastAt || 0) < 20 * 3600000) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  const soon = new Date(now + 4 * DAY).toISOString().slice(0, 10);
  const done = new Set(sent.contests || []);
  const contest = area.state && events.find(e => e.state === area.state && e.date && e.date >= today && e.date <= soon && !done.has(`${e.name}|${e.date}`));
  if (contest) {
    return {
      kind: 'contest', key: `${contest.name}|${contest.date}`,
      title: `🏆 ${contest.name}`.slice(0, 110),
      body: `${dayName(contest.date)} in ${contest.city || area.state}. ${contest.blurb || 'An eating contest near you.'}`.slice(0, 220),
      data: { open: 'contests' },
    };
  }
  const weekday = new Date(now).getUTCDay(); // 5 Friday, 6 Saturday
  if ((weekday === 5 || weekday === 6) && now - (sent.weeklyAt || 0) > 6 * DAY) {
    const near = (area.want || [])
      .map(w => ({ ...w, d: miles(area.lat, area.lng, w.lat, w.lng) }))
      .filter(w => w.d <= (area.miles || 10))
      .sort((a, b) => a.d - b.d);
    if (near.length) {
      const names = near.slice(0, 2).map(w => w.n);
      return {
        kind: 'weekly',
        title: near.length === 1 ? `${near[0].n} is near you` : `${near.length} spots on your Want to Try list are near you`,
        body: `${near.length === 1 ? 'It\'s on your Want to Try list.' : `Like ${names.join(' and ')}.`} This weekend's the weekend. Tap to pick one.`,
        data: { open: 'want' },
      };
    }
  }
  return null;
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Not allowed' });
  const dry = !!req.query?.dry;
  const fb = getAdmin();
  const db = fb.firestore();
  let events = [];
  try { events = (await nationalList(db, { force: !dry })).events; } catch (err) { console.error('[FTB] nudges contests failed:', err.message); }

  const areas = await db.collection('pushArea').limit(2000).get();
  const out = { members: areas.size, contests: events.length, sent: 0, would: [], guides: 0 };
  for (const doc of areas.docs) {
    const area = doc.data();
    // The member's state list too, if someone there has opened Play.
    let mine = events;
    if (area.state) {
      const st = (await db.doc(`foodEvents/st_${area.state}`).get()).data();
      if (Array.isArray(st?.events)) mine = [...st.events, ...events];
    }
    const msg = pick(area, mine);
    if (!msg) continue;
    if (dry) { out.would.push({ uid: doc.id.slice(0, 6), kind: msg.kind, title: msg.title }); continue; }
    const tokens = (await db.doc(`pushTokens/${doc.id}`).get()).data()?.tokens || [];
    if (!tokens.length) continue;
    try {
      const r = await fb.messaging().sendEachForMulticast({
        tokens, notification: { title: msg.title, body: msg.body }, data: msg.data,
        android: { notification: { tag: `nudge-${msg.kind}` } },
      });
      const dead = tokens.filter((t, i) => /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.responses[i].error?.code || ''));
      if (dead.length) await db.doc(`pushTokens/${doc.id}`).set({ tokens: fb.firestore.FieldValue.arrayRemove(...dead) }, { merge: true });
      if (!r.successCount) continue;
      out.sent++;
      const sent = { ...(area.sent || {}), lastAt: Date.now() };
      if (msg.kind === 'contest') sent.contests = [...(sent.contests || []), msg.key].slice(-50);
      else sent.weeklyAt = Date.now();
      await doc.ref.set({ sent }, { merge: true });
    } catch (err) {
      console.error('[FTB] nudge send failed:', err.message);
    }
  }
  // VIP Grizzly (owner.js) that has run out.
  if (!dry) { try { out.vipsEnded = await expireVips(db); } catch (err) { console.error('[FTB] nudges vips failed:', err.message); } }
  // City guides (api/guide.js): the oldest few, searched again.
  if (!dry) { try { out.guides = await refreshGuides(db, 4); } catch (err) { console.error('[FTB] nudges guides failed:', err.message); } }
  return res.status(200).json(out);
};

module.exports.pick = pick;
