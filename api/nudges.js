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

   3. Welcome nudges: new accounts from 18-72 hours ago that still have
      nothing saved get one friendly nudge (push, else email).
   4. Win-back: members who saved spots, then went quiet for 7 or 14 days,
      get one nudge each (personalized: a gift waiting, else the nearest
      cave unlock). Markers live on the signup doc (winback7At/14At).

   GET ?dinner=1 (Vercel cron, 00:30 UTC / 5:30pm Phoenix): only the dinner
   nudge — "Tonight's Pick is ready" — for members with saved spots, one
   a day (tracked separately as sent.dinnerAt, so the morning send never
   blocks it). The morning work does not run on the dinner run.

   GET ?dry=1 (with the cron's Authorization) says what it would send, sends nothing.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { bump } = require('./_count');
const { sendMulticast } = require('./_push');
const { nationalList } = require('./food-events');
const { refreshGuides } = require('./guide');
const { expireVips } = require('./owner');
const { sendEmail, emailHtml, emailReady } = require('./_email');

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

// Dinner nudge: 5:30pm Phoenix, for members with saved spots — the
// highest-intent moment of the day, when people are actually deciding
// dinner, and exactly when Tonight's Pick would convert an open. One a
// day, tracked separately from the morning nudge (dinnerAt), so the
// morning send never blocks it. `hasSpots` is checked by the caller
// (one cheap read per member).
function pickDinner (area, hasSpots, now = Date.now()) {
  const sent = area.sent || {};
  const today = new Date(now).toISOString().slice(0, 10);
  if (sent.dinnerAt === today) return null;
  if (!hasSpots) return null;
  return {
    kind: 'dinner',
    title: "Tonight's Pick is ready",
    body: 'The bear has an idea for dinner — tap to see it.',
    data: { open: 'tonight' },
  };
}

async function dinnerNudges (db, fb, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const areas = await db.collection('pushArea').limit(2000).get();
  let sent = 0;
  for (const doc of areas.docs) {
    const area = doc.data();
    if ((area.sent || {}).dinnerAt === today) continue;
    const tokens = (await db.doc(`pushTokens/${doc.id}`).get()).data()?.tokens || [];
    if (!tokens.length) continue;
    const spots = (await db.collection(`users/${doc.id}/restaurants`).limit(1).get()).size;
    if (!spots) continue;
    const msg = pickDinner(area, true, now);
    if (!msg) continue;
    try {
      const r = await sendMulticast(fb, {
        tokens, notification: { title: msg.title, body: msg.body }, data: msg.data,
        android: { notification: { tag: 'nudge-dinner' } },
      });
      const dead = tokens.filter((t, i) => /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.responses[i].error?.code || ''));
      if (dead.length) await db.doc(`pushTokens/${doc.id}`).set({ tokens: fb.firestore.FieldValue.arrayRemove(...dead) }, { merge: true });
      if (!r.successCount) continue;
      sent++;
      await doc.ref.set({ sent: { ...(area.sent || {}), dinnerAt: today } }, { merge: true });
      await bump(db, fb, 'dinner_nudge_push');
    } catch (err) {
      console.error('[FTB] dinner nudge failed:', err.message);
    }
  }
  return sent;
}

async function welcomeNudges (db, fb) {
  const now = Date.now();
  const snap = await db.collection('signups').where('at', '>=', new Date(now - 3 * DAY).toISOString()).limit(300).get();
  let sent = 0;
  for (const d of snap.docs) {
    const s = d.data();
    if (s.nudgedAt || now - Date.parse(s.at) < 18 * 3600000) continue;
    const spots = (await db.collection(`users/${d.id}/restaurants`).limit(1).get()).size;
    await d.ref.set({ nudgedAt: new Date().toISOString(), hadSpots: spots > 0 }, { merge: true });
    if (spots) continue;
    const title = 'Your den is empty 🐻';
    const body = 'Save one spot you love. It takes ten seconds, and the bear starts learning your taste.';
    const tokens = (await db.doc(`pushTokens/${d.id}`).get()).data()?.tokens || [];
    if (tokens.length) {
      const r = await sendMulticast(fb, { tokens, notification: { title, body }, data: { open: 'add' }, android: { notification: { tag: 'welcome-nudge' } } });
      if (r.successCount) { sent++; await bump(db, fb, 'welcome_nudge_push'); continue; }
    }
    if (s.email && emailReady()) {
      const ok = await sendEmail({ to: s.email, name: s.name || '', tag: 'welcome-nudge', subject: title,
        html: emailHtml([body, '<a href="https://www.feed-the-bear.com/app.html?action=add" style="display:inline-block;background:#ff8a3d;color:#1b130b;font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none">Save my first spot</a>']) }).catch(() => false);
      if (ok) { sent++; await bump(db, fb, 'welcome_nudge_email'); }
    }
  }
  return sent;
}

// Win-back: members who signed up 7–21 days ago, saved spots, and have
// been quiet since (no area update in 7+ days — the app sends its area
// at most once a day, so a stale pushArea.at means the app hasn't
// opened in a while). The welcome nudge only chases brand-new empty
// accounts; this one chases the warmest lapsed users. One nudge at
// day 7, one at day 14, personalized with their own data: a gift
// waiting in their cave beats a generic "we miss you", and the nearest
// decor unlock is next. Markers live on the signup doc (winback7At /
// winback14At), set before sending so a failed send doesn't retry forever.
const CAVE_UNLOCK_TIERS = [50, 100, 250];
async function winbackNudges (db, fb) {
  const now = Date.now();
  const snap = await db.collection('signups').where('at', '>=', new Date(now - 21 * DAY).toISOString()).limit(300).get();
  let sent = 0;
  for (const d of snap.docs) {
    const s = d.data();
    const age = now - Date.parse(s.at || '');
    if (!Number.isFinite(age) || age < 7 * DAY) continue;
    if (s.winback14At) continue;
    const stage = age >= 14 * DAY ? 14 : 7;
    if (stage === 7 && s.winback7At) continue;
    const area = (await db.doc(`pushArea/${d.id}`).get()).data();
    const lastActive = Date.parse(area?.at || s.at || '') || 0;
    if (now - lastActive < 7 * DAY) continue;
    const spots = (await db.collection(`users/${d.id}/restaurants`).limit(1).get()).size;
    if (!spots) continue;
    const profile = (await db.doc(`users/${d.id}/meta/profile`).get()).data() || {};
    const unseen = (Array.isArray(profile.caveGifts) ? profile.caveGifts : []).filter(g => g && !g.seen).length;
    let title, body;
    if (unseen > 0) {
      title = 'Someone left you a gift';
      body = unseen === 1 ? 'A gift is waiting in your Bear Cave. Come claim it.' : `${unseen} gifts are waiting in your Bear Cave. Come claim them.`;
    } else {
      const lifetime = Math.max(0, Math.floor(Number(profile.caveLifetime) || 0));
      const next = CAVE_UNLOCK_TIERS.find(t => t > lifetime);
      title = stage === 14 ? 'Your cave misses you' : 'Your Bear Cave misses you';
      body = next ? `You're ${next - lifetime} points from your next cave unlock. Save a spot or come back for your daily bonus.` : 'Your cave is waiting — come see what\'s new in the shop.';
    }
    const marker = stage === 14 ? 'winback14At' : 'winback7At';
    await d.ref.set({ [marker]: new Date().toISOString() }, { merge: true });
    const tokens = (await db.doc(`pushTokens/${d.id}`).get()).data()?.tokens || [];
    if (tokens.length) {
      const r = await sendMulticast(fb, { tokens, notification: { title, body }, data: { open: 'cave' }, android: { notification: { tag: `winback-${stage}` } } });
      if (r.successCount) { sent++; await bump(db, fb, `winback${stage}_push`); continue; }
    }
    if (s.email && emailReady()) {
      const ok = await sendEmail({ to: s.email, name: s.name || '', tag: `winback-${stage}`, subject: title,
        html: emailHtml([body, '<a href="https://www.feed-the-bear.com/app.html" style="display:inline-block;background:#ff8a3d;color:#1b130b;font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none">Open Feed The Bear</a>']) }).catch(() => false);
      if (ok) { sent++; await bump(db, fb, `winback${stage}_email`); }
    }
  }
  return sent;
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Not allowed' });
  const dry = !!req.query?.dry;
  const fb = getAdmin();
  const db = fb.firestore();

  // Dinner run (Vercel cron 00:30 UTC / 5:30pm Phoenix, ?dinner=1): only
  // the dinner nudge. The morning work (contests, welcome, win-back,
  // VIPs, guides) stays on the morning run.
  if (req.query?.dinner) {
    const out = { dinner: 0 };
    if (!dry) { try { out.dinner = await dinnerNudges(db, fb); } catch (err) { console.error('[FTB] nudges dinner failed:', err.message); } }
    return res.status(200).json(out);
  }

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
      const r = await sendMulticast(fb, {
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
  // New accounts from 18-72 hours ago that still have nothing saved: one
  // friendly nudge (push if they have the app, else email). signups/{uid}.nudgedAt.
  if (!dry) { try { out.welcomeNudges = await welcomeNudges(db, fb); } catch (err) { console.error('[FTB] nudges welcome failed:', err.message); } }
  // Members who used the app, then went quiet for 7 or 14 days.
  if (!dry) { try { out.winback = await winbackNudges(db, fb); } catch (err) { console.error('[FTB] nudges winback failed:', err.message); } }
  // VIP Grizzly (owner.js) that has run out.
  if (!dry) { try { out.vipsEnded = await expireVips(db); } catch (err) { console.error('[FTB] nudges vips failed:', err.message); } }
  // City guides (api/guide.js): the oldest few, searched again.
  if (!dry) { try { out.guides = await refreshGuides(db, 4); } catch (err) { console.error('[FTB] nudges guides failed:', err.message); } }
  return res.status(200).json(out);
};

module.exports.pick = pick;
module.exports.pickDinner = pickDinner;
module.exports.dinnerNudges = dinnerNudges;
module.exports.welcomeNudges = welcomeNudges;
module.exports.winbackNudges = winbackNudges;
