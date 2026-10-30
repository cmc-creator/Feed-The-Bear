/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Restaurant from a link
   ════════════════════════════════════════════════════════════
   GET /api/link-spot?q=<TikTok/Instagram/YouTube link or plain text>&lat=&lng=
   Reads the post's caption, asks Gemini which restaurant it is about,
   then finds it on Google Places. Returns up to 3 places to choose from:
     { caption, guess: { name, city, dish }, places: [{ name, address, lat, lng, rating, mapsUrl, website }] }

   Uses GEMINI_API_KEY (ai-gemini.js) and GOOGLE_PLACES_API_KEY (place-info.js).
   ════════════════════════════════════════════════════════════ */

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// Only these sites are fetched, so the function can't be pointed at anything else.
const PAGE_HOSTS = ['tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'x.com', 'twitter.com', 'yelp.com', 'threads.net'];
const OEMBED = {
  'tiktok.com': u => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  'youtube.com': u => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  'youtu.be': u => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
};
const FIELDS = 'places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.websiteUri,places.primaryType';

const hits = new Map();
function limited (ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

function hostOf (u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\.|^m\.|^vm\.|^vt\./, ''); } catch { return ''; }
}
const allowedHost = h => PAGE_HOSTS.find(a => h === a || h.endsWith(`.${a}`)) || '';

function timedFetch (url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

const decode = s => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function metaTag (html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  return decode((html.match(re) || html.match(re2) || [])[1] || '');
}

// The words of the post: oEmbed when the site has it, else the page's share tags.
async function captionFor (link) {
  const host = allowedHost(hostOf(link));
  if (!host) return '';
  const parts = [];
  try {
    if (OEMBED[host]) {
      const r = await timedFetch(OEMBED[host](link));
      if (r.ok) {
        const j = await r.json();
        parts.push(j.title, j.author_name);
      }
    }
  } catch { /* fall back to the page */ }
  if (!parts.filter(Boolean).length) {
    try {
      // Short links redirect; follow each hop only while it stays on an allowed site.
      let url = link;
      let r = null;
      for (let hop = 0; hop < 4; hop++) {
        if (!/^https:\/\//.test(url) || !allowedHost(hostOf(url))) { r = null; break; }
        r = await timedFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedTheBear/1.0; +https://www.feed-the-bear.com)', 'Accept-Language': 'en' }, redirect: 'manual' });
        const next = r.status >= 300 && r.status < 400 ? r.headers.get('location') : '';
        if (!next) break;
        url = new URL(next, url).toString();
        r = null;
      }
      if (r?.ok) {
        const html = (await r.text()).slice(0, 400000);
        parts.push(metaTag(html, 'og:title'), metaTag(html, 'og:description'), metaTag(html, 'description'));
      }
    } catch { /* nothing readable */ }
  }
  return [...new Set(parts.filter(Boolean).map(s => String(s).trim()))].join('\n').slice(0, 1500);
}

async function guessRestaurant (text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !text) return null;
  const prompt = `This is the caption of a social media food post, or text a user typed.\n"""${text}"""\n`
    + 'Which restaurant, cafe, bar or food truck is it about? Reply with JSON only: '
    + '{"name": "...", "city": "...", "dish": "..."}. Use "" for anything not stated. '
    + 'If no specific place is named, use "" for name.';
  try {
    const r = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1536, temperature: 0 },
      }),
    }, 9000);
    if (!r.ok) return null;
    const j = await r.json();
    const out = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    const g = JSON.parse(out.replace(/^```(?:json)?|```$/g, '').trim());
    return { name: String(g.name || '').slice(0, 100), city: String(g.city || '').slice(0, 80), dish: String(g.dish || '').slice(0, 80) };
  } catch { return null; }
}

async function findPlaces (query, lat, lng) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !query) return [];
  const body = { textQuery: query, maxResultCount: 3 };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } };
  }
  try {
    const r = await timedFetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify(body),
    });
    if (!r.ok) return [];
    return ((await r.json()).places || []).map(p => ({
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: Number(p.rating) || 0,
      reviews: Number(p.userRatingCount) || 0,
      type: p.primaryType || '',
      mapsUrl: /^https:\/\//.test(p.googleMapsUri || '') ? p.googleMapsUri : '',
      website: /^https?:\/\//.test(p.websiteUri || '') ? p.websiteUri : '',
    })).filter(p => p.name);
  } catch { return []; }
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = String(req.query.q || '').trim().slice(0, 600);
  if (!q) return res.status(400).json({ error: 'Paste a link or a restaurant name.' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'Slow down a little and try again in a few minutes.' });
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);

  const link = (q.match(/https?:\/\/\S+/) || [])[0] || '';
  const typed = q.replace(link, '').trim();
  if (link && !allowedHost(hostOf(link)) && !typed) {
    return res.status(200).json({ caption: '', guess: null, places: [], error: 'That link is not from TikTok, Instagram, YouTube, Facebook, X, Threads or Yelp. Try typing the restaurant name instead.' });
  }

  const caption = link ? await captionFor(link) : '';
  const text = [typed, caption].filter(Boolean).join('\n');
  const guess = await guessRestaurant(text);
  // Without a guess, plain typed text is searched as-is.
  const query = guess?.name ? [guess.name, guess.city].filter(Boolean).join(', ') : (link ? '' : typed);
  const places = await findPlaces(query, lat, lng);

  res.setHeader('Cache-Control', 'private, max-age=0');
  return res.status(200).json({
    caption: caption.slice(0, 300),
    guess,
    places,
    error: places.length ? '' : (link && !caption ? 'We could not read that post. Try typing the restaurant name instead.' : 'We could not tell which restaurant that is. Try typing its name.'),
  });
};
