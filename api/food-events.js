/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Food challenges nationwide
   ════════════════════════════════════════════════════════════
   GET /api/food-events[?state=AZ] -> { events, at, stale }
   Events include a branch-aware id, dates, venue/location, source links,
   organizer facts when available, and discoveredAt (not verification).

   Upcoming eating contests and food challenges across the US, found with
   Gemini + Google Search, five regions at once, kept in foodEvents/current;
   with ?state=, that state is searched on its own too (foodEvents/st_XX).
   Each list is searched at most once a day (api/nudges.js refreshes the
   national one every morning). If a new search fails, the last good list is served.

   Env: GEMINI_API_KEY, FIREBASE_SERVICE_ACCOUNT (GEMINI_MODEL optional)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { createHash } = require('crypto');
const { overLimit, clientIp } = require('./_limit');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const FRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000; // after a failed search, wait before trying again
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
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function cleanUrl (v) {
  try {
    const u = new URL(String(v || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 400) : '';
  } catch { return ''; }
}

// Keep only well-formed, upcoming events; soonest first, no repeats.
// A restaurant challenge you can take any day has no date (date ''), and
// comes after the dated ones.
function cleanEvents (list, today = new Date().toISOString().slice(0, 10), max = 40) {
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
      address: str(e?.address, 160),
      entryCost: str(e?.entryCost, 100),
      rules: str(e?.rules, 600),
      eligibility: str(e?.eligibility, 200),
      registrationUrl: cleanUrl(e?.registrationUrl),
      discoveredAt: Number.isFinite(e?.discoveredAt) && e.discoveredAt > 0 && e.discoveredAt <= Date.now() ? e.discoveredAt : 0,
    };
  }).map(e => (e.kind === 'challenge' && !isDay(e.date) ? { ...e, date: '', endDate: '' } : e)).filter(e => {
    if (!e.name || !e.state) return false;
    if (e.date === '' ? e.kind !== 'challenge' : (!isDay(e.date) || (e.endDate || e.date) < today)) return false;
    const key = [e.name, e.date, e.state, e.city, e.venue].map(v => v.trim().toLowerCase()).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(e => ({
    ...e,
    id: createHash('sha256').update([e.name, e.date, e.state, e.city, e.venue].map(v => v.trim().toLowerCase()).join('|')).digest('hex').slice(0, 24),
  })).sort((a, b) => (a.date === '') - (b.date === '') || a.date.localeCompare(b.date)).slice(0, max);
}

// The first JSON array in the model's answer.
function parseArray (text) {
  const s = String(text || '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return []; }
}

// Five regions searched at once (one search only ever found a handful), and
// a state on its own when someone in that state opens Play.
const REGIONS = {
  northeast: 'the Northeast (NY, NJ, PA, MA, CT, RI, NH, VT, ME, MD, DE, DC)',
  southeast: 'the Southeast (FL, GA, NC, SC, VA, WV, TN, KY, AL, MS, LA, AR)',
  midwest: 'the Midwest (OH, MI, IN, IL, WI, MN, IA, MO, KS, NE, SD, ND)',
  southwest: 'the Southwest and Mountain states (TX, OK, NM, AZ, CO, UT, NV, ID, MT, WY)',
  west: 'the West Coast, Alaska and Hawaii (CA, OR, WA, AK, HI)',
};
const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'Washington, DC', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

const DETAIL_FIELDS = `"address": "street address or empty", "entryCost": "confirmed cost or empty",
 "rules": "brief organizer rules or empty", "eligibility": "age, reservation or eligibility requirements or empty",
 "registrationUrl": "official registration link or empty"`;
const CHALLENGES_PROMPT = (where, today, max) => `Today is ${today}. Search the web for restaurant food challenges in ${where} that are ongoing, not one-time competitions.
Only include challenges a current source says are still offered. Do not invent anything; leave a field empty if you cannot confirm it.
Prefer the restaurant's own page. Do not invent images, prices, rules, dates or claims of verification. Summarize neutrally, without encouraging unsafe eating.
Answer with only a JSON array, no other text. Each item:
{"name": "challenge name at restaurant name", "kind": "challenge", "date": "", "endDate": "",
 "city": "...", "state": "two-letter code", "venue": "restaurant name", "url": "source page", "prize": "short, or empty", "blurb": "neutral one-sentence description", ${DETAIL_FIELDS}}
Give up to ${max} challenges.`;

async function searchEvents (key, where = 'the United States', max = 15, { challenges = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = challenges ? CHALLENGES_PROMPT(where, today, max) : `Today is ${today}. Search the web for upcoming public eating contests and food challenges in ${where} in the next 6 months:
competitive eating contests (Major League Eating events, hot dog, wing, pie, taco, burrito, pizza, chili, oyster, rib, cannoli, pickle, ramen contests and the like),
food festivals and fairs that hold eating contests, and well-known restaurant food challenges people can sign up for.
Only include events with a confirmed date on or after ${today}. Do not invent anything; leave a field empty if you cannot confirm it.
Prefer official organizer pages. Do not invent images, prices, rules or claims of verification. Include spectator information in the rules if confirmed.
Answer with only a JSON array, no other text. Each item:
{"name": "...", "kind": "contest" | "challenge" | "festival", "date": "YYYY-MM-DD", "endDate": "YYYY-MM-DD or empty",
 "city": "...", "state": "two-letter code", "venue": "...", "url": "official page", "prize": "short, or empty", "blurb": "neutral one-sentence description", ${DETAIL_FIELDS}}
Give up to ${max} events.`;
  const resp = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    // A slow search gives up and the saved list is used (it once hit the function's time limit).
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 6000, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
  const json = await resp.json();
  const text = (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return cleanEvents(parseArray(text), today);
}

// A saved list, refreshed when a day old (at most one try per RETRY_MS).
// `search` returns events; a failed or empty search keeps the old list.
async function cachedList (db, docId, search, { force = false } = {}) {
  let ref = null, cur = null;
  try {
    ref = db.doc(`foodEvents/${docId}`);
    cur = (await ref.get()).data() || null;
  } catch (err) { console.error('[FTB] food-events read failed:', err.message); }
  const now = Date.now();
  const cached = cur ? cleanEvents(cur.events, undefined, 150).map(e => ({ ...e, discoveredAt: e.discoveredAt || cur.at || 0 })) : [];
  const fresh = cur && now - (cur.at || 0) < FRESH_MS && cached.length;
  const tooSoon = cur && now - (cur.triedAt || 0) < RETRY_MS;
  if ((force || (!fresh && !tooSoon)) && process.env.GEMINI_API_KEY && ref) {
    try {
      await ref.set({ triedAt: now }, { merge: true });
      const events = (await search(process.env.GEMINI_API_KEY)).map(e => ({ ...e, discoveredAt: now }));
      if (events.length) {
        await ref.set({ events, at: now, triedAt: now });
        return { events, at: now, stale: false };
      }
      console.warn(`[FTB] food-events ${docId}: nothing usable found`);
    } catch (err) {
      console.error(`[FTB] food-events ${docId} search failed:`, err.message);
    }
  }
  return { events: cached, at: cur?.at || 0, stale: !fresh };
}

// Every region at once, dated contests and any-day restaurant challenges
// separately; a search that fails doesn't sink the rest.
async function searchNational (key) {
  const searches = Object.values(REGIONS).flatMap(where => [
    searchEvents(key, where, 15),
    searchEvents(key, where, 8, { challenges: true }),
  ]);
  const lists = await Promise.all(searches.map(s => s.catch(err => {
    console.error('[FTB] food-events region failed:', err.message);
    return [];
  })));
  console.log(`[FTB] food-events national: ${lists.map(l => l.length).join(',')}`);
  return cleanEvents(lists.flat(), undefined, 150);
}

function nationalList (db, opts) { return cachedList(db, 'current', searchNational, opts); }
function stateList (db, st, opts) {
  return cachedList(db, `st_${st}`, key => Promise.all([
    searchEvents(key, STATE_NAMES[st], 15).catch(err => { console.error('[FTB] food-events state search failed:', err.message); return []; }),
    searchEvents(key, STATE_NAMES[st], 8, { challenges: true }).catch(err => { console.error('[FTB] food-events state challenges failed:', err.message); return []; }),
  ]).then(([a, b]) => cleanEvents([...a, ...b].filter(e => e.state === st), undefined, 40)), opts);
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (await overLimit(`food-events:${clientIp(req)}`, 60, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
  const st = String(req.query?.state || '').toUpperCase();
  let db = null;
  try { db = getAdmin().firestore(); } catch (err) { console.error('[FTB] food-events admin failed:', err.message); }
  if (!db) return res.status(503).json({ error: 'Challenge discovery is unavailable. Please try again later.' });
  const [nat, mine] = await Promise.all([nationalList(db), STATES.has(st) ? stateList(db, st) : null]);
  const events = cleanEvents([...(mine?.events || []), ...nat.events], undefined, 150);
  if (!events.length && !nat.at && !mine?.at) return res.status(503).json({ error: 'Could not refresh challenges. Please try again later.' });
  res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800');
  return res.status(200).json({ events, at: mine ? Math.min(nat.at || mine.at, mine.at || nat.at) : nat.at, stale: nat.stale || !!mine?.stale });
};

module.exports.nationalList = nationalList;
module.exports.stateList = stateList;
module.exports.cleanEvents = cleanEvents;
module.exports.parseArray = parseArray;
