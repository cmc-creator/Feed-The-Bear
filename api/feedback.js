/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Private feedback
   ════════════════════════════════════════════════════════════
   POST { text, mood } (optional X-FTB-Token to say which member it is)
   Saved at feedback/{auto id} and emailed to the first ADMIN_EMAILS address
   through Brevo (api/_email.js), so an unhappy member tells the owner, not
   a public review. Needs FIREBASE_SERVICE_ACCOUNT; the email needs Brevo.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { sendEmail, emailHtml, esc } = require('./_email');

const hits = new Map();
function limited (ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'Thanks! We got your notes already.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const text = String(body.text || '').trim().slice(0, 2000);
  const mood = ['love', 'meh'].includes(body.mood) ? body.mood : 'meh';
  if (text.length < 3) return res.status(400).json({ error: 'Tell us a little more.' });

  try {
    const fb = getAdmin();
    let uid = '', email = '';
    const token = String(req.headers['x-ftb-token'] || '');
    if (token) {
      try {
        const user = await fb.auth().verifyIdToken(token);
        uid = user.uid; email = user.email || '';
      } catch { /* sent anonymously */ }
    }
    await fb.firestore().collection('feedback').add({ text, mood, uid, email, at: new Date().toISOString(), ua: String(req.headers['user-agent'] || '').slice(0, 200) });
    const owner = String(process.env.ADMIN_EMAILS || '').split(',')[0].trim();
    if (owner) {
      await sendEmail({
        to: owner,
        subject: `Feed The Bear feedback${email ? ` from ${email}` : ''}`,
        tag: 'feedback',
        html: emailHtml([`<strong>${mood === 'love' ? 'Happy member' : 'Not quite happy'}</strong>${email ? ` · ${esc(email)}` : ''}`, esc(text).replace(/\n/g, '<br>')]),
      }).catch(err => console.warn('[FTB] feedback email failed:', err.message));
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[FTB] feedback failed:', err.message);
    return res.status(500).json({ error: 'Could not send that. Please try again.' });
  }
};
