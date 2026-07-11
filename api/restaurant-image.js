/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Real Restaurant Photo Lookup
   ════════════════════════════════════════════════════════════
   Resolves a REAL photo of a venue (storefront or dish) using,
   in order of quality:
     1. Google Places API  (env: GOOGLE_PLACES_API_KEY)   - paid, best coverage
     2. Foursquare Places  (env: FOURSQUARE_API_KEY)      - free tier, great coverage
     3. Yelp Fusion        (env: YELP_API_KEY)            - free tier, great coverage
     4. Venue website og:image scrape                     - free, spotty
     5. Wikipedia geo/title image                         - free, landmarks only

   Set at least ONE of the three API keys in Vercel dashboard →
   Project → Settings → Environment Variables, then redeploy.
   ════════════════════════════════════════════════════════════ */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

function cors (res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeHttpUrl (value = '') {
  const v = String(value || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

function looksLikeJunkImage (url = '') {
  return /(logo|icon|favicon|avatar|sprite|placeholder|default[_-]?image|og-default|map[_-]?pin|marker)/i.test(url);
}

async function fetchWithTimeout (url, opts = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ── 1. Google Places API (New) ─────────────────────────────── */
async function googlePlacesPhoto ({ name, lat, lon }) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !name) return '';

  const body = {
    textQuery: name,
    maxResultCount: 1,
  };
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lon }, radius: 2000 } };
  }

  const searchResp = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.photos,places.displayName',
    },
    body: JSON.stringify(body),
  });
  if (!searchResp.ok) return '';
  const searchJson = await searchResp.json();
  const photoName = searchJson?.places?.[0]?.photos?.[0]?.name || '';
  if (!photoName) return '';

  // Resolve the media redirect server-side so the returned URL has no API key in it.
  const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media?key=${key}&maxWidthPx=900&skipHttpRedirect=true`;
  const mediaResp = await fetchWithTimeout(mediaUrl);
  if (!mediaResp.ok) return '';
  const mediaJson = await mediaResp.json();
  return safeHttpUrl(mediaJson?.photoUri || '');
}

/* ── 2. Foursquare Places API ───────────────────────────────── */
async function foursquarePhoto ({ name, lat, lon }) {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key || !name) return '';

  const search = new URL('https://api.foursquare.com/v3/places/search');
  search.searchParams.set('query', name);
  search.searchParams.set('limit', '1');
  search.searchParams.set('categories', '13000'); // Dining & Drinking
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    search.searchParams.set('ll', `${lat},${lon}`);
    search.searchParams.set('radius', '2000');
  }

  const headers = { Accept: 'application/json', Authorization: key };
  const searchResp = await fetchWithTimeout(search.toString(), { headers });
  if (!searchResp.ok) return '';
  const searchJson = await searchResp.json();
  const fsqId = searchJson?.results?.[0]?.fsq_id || '';
  if (!fsqId) return '';

  const photosResp = await fetchWithTimeout(
    `https://api.foursquare.com/v3/places/${fsqId}/photos?limit=1&sort=POPULAR`,
    { headers }
  );
  if (!photosResp.ok) return '';
  const photos = await photosResp.json();
  const p = Array.isArray(photos) ? photos[0] : null;
  if (!p?.prefix || !p?.suffix) return '';
  return safeHttpUrl(`${p.prefix}900x600${p.suffix}`);
}

/* ── 3. Yelp Fusion API ─────────────────────────────────────── */
async function yelpPhoto ({ name, lat, lon }) {
  const key = process.env.YELP_API_KEY;
  if (!key || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) return '';

  const search = new URL('https://api.yelp.com/v3/businesses/search');
  search.searchParams.set('term', name);
  search.searchParams.set('latitude', String(lat));
  search.searchParams.set('longitude', String(lon));
  search.searchParams.set('radius', '2000');
  search.searchParams.set('limit', '1');

  const resp = await fetchWithTimeout(search.toString(), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) return '';
  const json = await resp.json();
  return safeHttpUrl(json?.businesses?.[0]?.image_url || '');
}

/* ── 4. Website og:image scrape ─────────────────────────────── */
function absolutize (baseUrl = '', candidate = '') {
  const raw = String(candidate || '').trim();
  if (!raw) return '';
  try {
    return safeHttpUrl(new URL(raw, baseUrl).toString());
  } catch {
    return '';
  }
}

function extractMetaImage (html = '', baseUrl = '') {
  const source = String(html || '');
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
  ];

  for (const re of patterns) {
    const m = source.match(re);
    if (m?.[1]) {
      const abs = absolutize(baseUrl, m[1]);
      if (abs && !looksLikeJunkImage(abs)) return abs;
    }
  }
  return '';
}

async function scrapeWebsiteImage (website = '') {
  const url = safeHttpUrl(website);
  if (!url) return '';
  const resp = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'FeedTheBearBot/1.0 (+https://github.com/cmc-creator/Feed-The-Bear)',
      accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!resp.ok) return '';
  const type = String(resp.headers.get('content-type') || '').toLowerCase();
  if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) return '';
  const html = await resp.text();
  return extractMetaImage(html, url);
}

/* ── 5. Wikipedia (landmarks only) ──────────────────────────── */
async function wikiGeoImage ({ name, lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

  const geo = new URL(WIKI_API);
  geo.searchParams.set('action', 'query');
  geo.searchParams.set('format', 'json');
  geo.searchParams.set('formatversion', '2');
  geo.searchParams.set('generator', 'geosearch');
  geo.searchParams.set('ggscoord', `${lat}|${lon}`);
  geo.searchParams.set('ggsradius', '300');
  geo.searchParams.set('ggslimit', '5');
  geo.searchParams.set('prop', 'pageimages');
  geo.searchParams.set('piprop', 'thumbnail');
  geo.searchParams.set('pithumbsize', '900');

  const r = await fetchWithTimeout(geo.toString());
  if (!r.ok) return '';
  const j = await r.json();
  const pages = Object.values(j?.query?.pages || {});

  // Only accept a page whose TITLE matches the venue name. A generic
  // geosearch hit returns city/neighborhood pages whose photos are
  // skylines - exactly the wrong-image bug.
  const nameTokens = String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !['the', 'and', 'restaurant', 'cafe', 'bar', 'grill'].includes(t));
  if (!nameTokens.length) return '';

  for (const p of pages) {
    const title = String(p?.title || '').toLowerCase();
    const matches = nameTokens.filter(t => title.includes(t)).length;
    if (matches / nameTokens.length < 0.6) continue;
    const img = safeHttpUrl(p?.thumbnail?.source || '');
    if (img && !looksLikeJunkImage(img)) return img;
  }
  return '';
}

module.exports = async function handler (req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const name = String(req.query?.name || '').trim();
  const website = String(req.query?.website || '').trim();
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);

  if (!name && !website) {
    return res.status(400).json({ found: false, error: 'Missing name or website' });
  }

  const providers = [
    ['google',    () => googlePlacesPhoto({ name, lat, lon })],
    ['foursquare', () => foursquarePhoto({ name, lat, lon })],
    ['yelp',      () => yelpPhoto({ name, lat, lon })],
    ['website',   () => scrapeWebsiteImage(website)],
    ['wikipedia', () => wikiGeoImage({ name, lat, lon })],
  ];

  for (const [source, fn] of providers) {
    try {
      const photoUrl = await fn();
      if (photoUrl && !looksLikeJunkImage(photoUrl)) {
        // Found photos rarely change - cache at the edge for 7 days.
        res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
        return res.status(200).json({ found: true, photoUrl, source });
      }
    } catch {
      /* try next provider */
    }
  }

  const keysConfigured = !!(process.env.GOOGLE_PLACES_API_KEY || process.env.FOURSQUARE_API_KEY || process.env.YELP_API_KEY);
  // Cache misses briefly only, so newly added API keys or new venue photos show up fast.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
  return res.status(404).json({
    found: false,
    photoUrl: '',
    source: 'none',
    hint: keysConfigured ? undefined : 'No photo provider API key configured. Set FOURSQUARE_API_KEY, YELP_API_KEY, or GOOGLE_PLACES_API_KEY in Vercel env vars.',
  });
};
