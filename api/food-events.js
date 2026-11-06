/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Food challenges nationwide
   ════════════════════════════════════════════════════════════
   GET /api/food-events -> { events: [{ name, kind, date, endDate, city, state, venue, url, prize, blurb }], at }

   Upcoming eating contests and food challenges across the US, found with
   Gemini + Google Search. One search a day for everyone: the list is kept in
   foodEvents/current and served from there until it's a day old. If a new
   search fails, the last good list is served.

   Env: GEMINI_API_KEY, FIREBASE_SERVICE_ACCOUNT (GEMINI_MODEL optional)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit, clientIp } = require('./_limit');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const FRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000; // after a failed search, wait before trying again
const KINDS = new Set(['contest', 'challenge', 'festival']);
const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
function cleanUrl (v) {
  try {
    const u = new URL(String(v || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 400) : '';
  } catch { return ''; }
}

// Keep only well-formed, upcoming events; soonest first, no repeats.
function cleanEvents (list, today = new Date().toISOString().slice(0, 10)) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(e => {
    const date = str(e?.date, 10);
    const endDate = isDay(str(e?.endDate, 10)) ? str(e.endDate, 10) : '';
    const state = str(e?.state, 2).toUpperCase();
    return {
      name: str(e?.name, 90),
      kind: KINDS.has(str(e?.kind, 12).toLowerCase()) ? str(e.kind, 12).toLowerCase() : 'contest',
      date,
      endDate: endDate && endDate >= date ? endDate : '',
      city: str(e?.city, 40),
      state: STATES.has(state) ? state : '',
      venue: str(e?.venue, 80),
      url: cleanUrl(e?.url),
      prize: str(e?.prize, 60),
      blurb: str(e?.blurb, 160),
    };
  }).filter(e => {
    if (!e.name || !isDay(e.date) || (e.endDate || e.date) < today || !e.state) return false;
    const key = `${e.name.toLowerCase()}|${e.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40);
}

// The first JSON array in the model's answer.
function parseArray (text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return []; }
}

async function searchEvents (key) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${today}. Search the web for upcoming public eating contests and food challenges in the United States in the next 6 months:
competitive eating contests (Major League Eating events, hot dog, wing, pie, taco, burrito, pizza, chili, oyster, rib, cannoli contests and the like),
food festivals that hold eating contests, and well-known restaurant food challenges people can sign up for.
Only include events with a confirmed date on or after ${today}. Do not invent anything; leave a field empty if you cannot confirm it.
Answer with only a JSON array, no other text. Each item:
{"name": "...", "kind": "contest" | "challenge" | "festival", "date": "YYYY-MM-DD", "endDate": "YYYY-MM-DD or empty",
 "city": "...", "state": "two-letter code", "venue": "...", "url": "official page", "prize": "short, or empty", "blurb": "one sentence: what you eat and how"}
Give up to 30 events from as many different states as you can find.`;
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
  const json = await resp.json();
  const text = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return cleanEvents(parseArray(text), today);
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (await overLimit(`food-events:${clientIp(req)}`, 60, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });

  let ref = null, cur = null;
  try {
    ref = getAdmin().firestore().doc('foodEvents/current');
    cur = (await ref.get()).data() || null;
  } catch (err) { console.error('[FTB] food-events read failed:', err.message); }

  const now = Date.now();
  const cached = cur ? cleanEvents(cur.events) : [];
  const fresh = cur && now - (cur.at || 0) < FRESH_MS && cached.length;
  const tooSoon = cur && now - (cur.triedAt || 0) < RETRY_MS;
  const key = process.env.GEMINI_API_KEY;

  if (!fresh && !tooSoon && key && ref) {
    try {
      await ref.set({ triedAt: now }, { merge: true });
      const events = await searchEvents(key);
      if (events.length) {
        await ref.set({ events, at: now, triedAt: now });
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
        return res.status(200).json({ events, at: now });
      }
      console.warn('[FTB] food-events search found nothing usable');
    } catch (err) {
      console.error('[FTB] food-events search failed:', err.message);
    }
  }
  res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
  return res.status(200).json({ events: cached, at: cur?.at || 0 });
};

module.exports.cleanEvents = cleanEvents;
module.exports.parseArray = parseArray;
