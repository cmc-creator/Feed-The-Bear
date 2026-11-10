/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: why didn't sign-in work?
   ════════════════════════════════════════════════════════════
   Firebase answers a failed email sign-in the same way whether the password
   was wrong, there's no account, or the account uses Google. This endpoint
   used to say which, but that lets anyone check whether an email has an
   account and how it signs in — so now it always answers the same way
   ('unknown') and the sign-in sheet shows one generic hint instead.
     POST { email } -> { status: 'unknown' }
   Rate-limited per IP, so it can't be used to check lists of emails.
   Needs FIREBASE_SERVICE_ACCOUNT, like the other functions.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (await overLimit(`signinhelp:${ip}`, 15, 600)) return res.status(429).json({ error: 'Too many tries. Wait a few minutes.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That email does not look right.' });
  // Deliberately the same answer for every well-formed email: whether an
  // account exists, and how it signs in, is not something this endpoint
  // reveals. The sign-in sheet shows its generic hint for 'unknown'.
  return res.status(200).json({ status: 'unknown' });
};
