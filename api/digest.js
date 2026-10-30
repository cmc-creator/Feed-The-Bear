/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Weekly picks email (opt-in)
   ════════════════════════════════════════════════════════════
   GET  (Vercel cron, Thursdays; Authorization: Bearer CRON_SECRET)
        → emails everyone in digestSubscribers a few spots from their own
          Want to Try list and Crave List, through Brevo.
   POST { on: true|false } (Authorization: Bearer <Firebase ID token>)
        → turn the email on or off for the signed-in member
   GET  ?unsub=<uid>&sig=<hmac> → one-click unsubscribe link from the email

   Environment (nothing is sent until all are set):
     BREVO_API_KEY            - Brevo → SMTP & API → API keys
     DIGEST_FROM_EMAIL        - a sender on a domain verified in Brevo, e.g. picks@feed-the-bear.com
     DIGEST_ADDRESS           - postal address for the email footer (required by anti-spam law)
     CRON_SECRET              - any long random string; Vercel sends it to the cron
     FIREBASE_SERVICE_ACCOUNT - same as verify-session.js
   ════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const admin = require('firebase-admin');

const APP_URL = 'https://www.feed-the-bear.com';

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function unsubSig (uid) {
  return crypto.createHmac('sha256', process.env.CRON_SECRET || 'unset').update(`unsub:${uid}`).digest('hex').slice(0, 32);
}
function unsubLink (uid) {
  return `${APP_URL}/api/digest?unsub=${encodeURIComponent(uid)}&sig=${unsubSig(uid)}`;
}

// What this week's email says, from the member's own saved spots. null = nothing worth sending.
function buildDigest (spots, name) {
  const want = spots.filter(r => r && r.status === 'want-to-try' && r.name);
  const craves = [];
  spots.forEach(r => (r?.dishes || []).forEach(d => { if (d?.verdict === 'want' && d.name) craves.push({ dish: d.name, at: r.name }); }));
  if (!want.length && !craves.length) return null;
  // Longest-waiting first: the point is to finally go.
  const picks = want.slice().sort((a, b) => String(a.dateAdded || '').localeCompare(String(b.dateAdded || ''))).slice(0, 3);
  const crave = craves[0] || null;
  const hi = name ? `Hi ${esc(name)},` : 'Hi there,';
  const subject = picks.length
    ? `This weekend: ${picks[0].name}${picks.length > 1 ? ` or ${picks.length - 1} more from your list` : ''}`
    : `Still craving the ${crave.dish}?`;
  const rows = picks.map(r => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #eadfce">
      <strong style="font-size:16px;color:#2a1d16">${esc(r.name)}</strong><br>
      <span style="color:#6b5a4c;font-size:14px">${esc([r.cuisine, (r.address || '').split(',').slice(0, 2).join(',')].filter(Boolean).join(' · '))}</span>
    </td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f7f3ec;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:520px;background:#fffaf2;border-radius:16px;padding:24px" cellpadding="0" cellspacing="0">
    <tr><td style="font-size:18px;font-weight:800;color:#2a1d16">🐻 Feed The Bear</td></tr>
    <tr><td style="padding-top:16px;font-size:16px;color:#2a1d16">${hi}</td></tr>
    ${picks.length ? `<tr><td style="padding-top:8px;font-size:16px;color:#2a1d16">You saved ${want.length === 1 ? 'a spot' : `${want.length} spots`} you want to try. Here are the ones that have waited longest:</td></tr>
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` : ''}
    ${crave ? `<tr><td style="padding-top:16px;font-size:16px;color:#2a1d16">On your Crave List: <strong>${esc(crave.dish)}</strong> at ${esc(crave.at)}.</td></tr>` : ''}
    <tr><td style="padding-top:20px"><a href="${APP_URL}/app.html" style="display:inline-block;background:#c8803a;color:#fff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:999px">Open my list</a></td></tr>
    <tr><td style="padding-top:16px;font-size:14px;color:#6b5a4c">Can't decide with friends? Start a Dinner Vote from the cub menu in the app.</td></tr>
  </table>
  <p style="max-width:520px;font-size:12px;color:#8a7a6c;line-height:1.5">You get this because you turned on weekly picks in Feed The Bear. <a href="{{UNSUB}}" style="color:#8a7a6c">Unsubscribe</a> · NyxCollective LLC · ${esc(process.env.DIGEST_ADDRESS || '')}</p>
  </td></tr></table></body></html>`;
  return { subject, html };
}

async function sendEmail ({ to, name, subject, html, uid }) {
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: 'Feed The Bear', email: process.env.DIGEST_FROM_EMAIL },
      to: [{ email: to, ...(name ? { name } : {}) }],
      subject,
      htmlContent: html.replace('{{UNSUB}}', unsubLink(uid)),
      headers: { 'List-Unsubscribe': `<${unsubLink(uid)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      tags: ['weekly-picks'],
    }),
  });
  if (!resp.ok) throw new Error(`Brevo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
}

const ready = () => !!(process.env.BREVO_API_KEY && process.env.DIGEST_FROM_EMAIL && process.env.DIGEST_ADDRESS && process.env.CRON_SECRET);

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let a;
  try { a = getAdmin(); } catch { return res.status(503).json({ error: 'Not set up' }); }
  const db = a.firestore();

  // One-click unsubscribe from the email.
  if (req.query?.unsub) {
    const uid = String(req.query.unsub);
    const sig = String(req.query.sig || '');
    if (!/^[0-9a-f]{32}$/.test(sig) || !crypto.timingSafeEqual(Buffer.from(unsubSig(uid)), Buffer.from(sig))) {
      return res.status(400).send('This unsubscribe link is not valid.');
    }
    await db.doc(`digestSubscribers/${uid}`).set({ on: false, at: new Date().toISOString() }, { merge: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send('<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:32px;text-align:center"><h1>You are unsubscribed</h1><p>No more weekly picks. You can turn them back on in the app under My Account.</p><p><a href="/app.html">Open Feed The Bear</a></p></body>');
  }

  // Signed-in member turning it on or off.
  if (req.method === 'POST') {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let user;
    try { user = await a.auth().verifyIdToken(token); } catch { return res.status(401).json({ error: 'Sign in first' }); }
    if (!user.email) return res.status(400).json({ error: 'This account has no email address.' });
    const on = req.body?.on === true;
    await db.doc(`digestSubscribers/${user.uid}`).set({ on, email: user.email, at: new Date().toISOString() }, { merge: true });
    return res.status(200).json({ on, sending: ready() });
  }

  if (req.method === 'GET' && req.query?.status === '1') {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let user;
    try { user = await a.auth().verifyIdToken(token); } catch { return res.status(401).json({ error: 'Sign in first' }); }
    const sub = (await db.doc(`digestSubscribers/${user.uid}`).get()).data() || {};
    return res.status(200).json({ on: !!sub.on, sending: ready() });
  }

  // The weekly send (Vercel cron).
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Not allowed' });
  if (!ready()) return res.status(200).json({ sent: 0, skipped: 'Email is not set up yet (BREVO_API_KEY, DIGEST_FROM_EMAIL, DIGEST_ADDRESS).' });

  const subs = await db.collection('digestSubscribers').where('on', '==', true).get();
  let sent = 0, empty = 0, failed = 0;
  for (const doc of subs.docs) {
    const uid = doc.id;
    try {
      const [spotsSnap, profileSnap, authUser] = await Promise.all([
        db.collection(`users/${uid}/restaurants`).get(),
        db.doc(`users/${uid}/meta/profile`).get(),
        a.auth().getUser(uid),
      ]);
      const name = String(profileSnap.data()?.name || '').slice(0, 30);
      const digest = buildDigest(spotsSnap.docs.map(d => d.data()), name === 'Foodie' ? '' : name);
      if (!digest || !authUser.email) { empty++; continue; }
      await sendEmail({ to: authUser.email, name, uid, ...digest });
      await doc.ref.set({ lastSentAt: new Date().toISOString() }, { merge: true });
      sent++;
    } catch (err) {
      failed++;
      console.error('[FTB] digest failed for a member:', err.message);
    }
  }
  return res.status(200).json({ sent, empty, failed });
};

module.exports.buildDigest = buildDigest;
