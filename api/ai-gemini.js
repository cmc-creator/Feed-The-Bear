/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Byte Cub AI Proxy (Gemini)
   ════════════════════════════════════════════════════════════
   Lets Grizzly subscribers use Byte Cub AI without their own key.

   Environment variables required (set in Vercel dashboard):
     GEMINI_API_KEY           - Google AI Studio API key
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON service account key
                                 (same one verify-session.js uses)

   Auth: client sends Firebase ID token as  Authorization: Bearer <token>.
   The token is verified and the user's plan must be 'grizzly'.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE  = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
    });
  }
  return admin;
}

// Cache plan lookups briefly so every chat message isn't a Firestore read
const _planCache = new Map(); // uid -> { plan, expires }
const PLAN_TTL_MS = 5 * 60 * 1000;

async function getPlan (uid) {
  const cached = _planCache.get(uid);
  if (cached && cached.expires > Date.now()) return cached.plan;
  const snap = await getAdmin().firestore().doc(`users/${uid}/meta/profile`).get();
  const plan = (snap.exists && snap.data().plan) || 'free';
  _planCache.set(uid, { plan, expires: Date.now() + PLAN_TTL_MS });
  return plan;
}

function sanitizeBody (input) {
  // Only pass through the fields we expect; clamp token spend.
  const body = {};
  if (!input || !Array.isArray(input.contents) || !input.contents.length) return null;
  body.contents = input.contents;
  if (input.systemInstruction) body.systemInstruction = input.systemInstruction;
  const gen = input.generationConfig || {};
  body.generationConfig = {
    temperature:     Math.min(Math.max(Number(gen.temperature) || 0.85, 0), 2),
    maxOutputTokens: Math.min(Math.max(parseInt(gen.maxOutputTokens) || 512, 1), 1024),
    topP:            Math.min(Math.max(Number(gen.topP) || 0.95, 0), 1),
  };
  return body;
}

module.exports = async function handler (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    res.status(503).json({ error: 'AI is not configured on the server yet.' });
    return;
  }

  // ── Auth: verify Firebase ID token + Grizzly plan ──
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) {
    res.status(401).json({ error: 'Sign in to use Byte Cub AI.' });
    return;
  }

  let uid;
  try {
    const decoded = await getAdmin().auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.error('[FTB] ai-gemini token verify failed:', err.message);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  try {
    const plan = await getPlan(uid);
    if (plan !== 'grizzly') {
      res.status(402).json({ error: 'Byte Cub AI is a Grizzly feature. Upgrade to unlock it.' });
      return;
    }
  } catch (err) {
    console.error('[FTB] ai-gemini plan check failed:', err.message);
    res.status(500).json({ error: 'Could not verify your plan. Try again.' });
    return;
  }

  // ── Forward to Gemini ──
  const body = sanitizeBody(req.body?.body);
  if (!body) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }
  const wantStream = req.body?.stream === true;

  try {
    const url = wantStream
      ? `${GEMINI_BASE}:streamGenerateContent?alt=sse`
      : `${GEMINI_BASE}:generateContent`;

    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error('[FTB] ai-gemini upstream error:', upstream.status, errText.slice(0, 300));
      res.status(upstream.status >= 500 ? 502 : 429).json({ error: 'AI is busy right now. Try again in a moment.' });
      return;
    }

    if (wantStream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } else {
      const json = await upstream.json();
      res.status(200).json(json);
    }
  } catch (err) {
    console.error('[FTB] ai-gemini proxy error:', err.message);
    res.status(500).json({ error: 'AI request failed. Try again.' });
  }
};
