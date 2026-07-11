/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Real Place Photo Lookup
   ════════════════════════════════════════════════════════════
   Attempts to resolve a real venue photo from Wikimedia/Wikipedia
   using geosearch + page image APIs.
   ════════════════════════════════════════════════════════════ */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

function sendJson (res, status, body) {
  res.status(status).json(body);
}

function norm (s = '') {
  return String(s || '').trim().toLowerCase();
}

function splitTokens (s = '') {
  return norm(s)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !['the', 'and', 'restaurant', 'cafe', 'bar', 'grill', 'kitchen', 'eatery'].includes(t));
}

function scoreTitle (title = '', name = '') {
  const t = splitTokens(title);
  const n = splitTokens(name);
  if (!t.length || !n.length) return 0;
  let hits = 0;
  n.forEach(tok => { if (t.includes(tok)) hits += 1; });
  return hits / Math.max(1, n.length);
}

async function fetchJsonWithTimeout (url, timeoutMs = 4500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'FeedTheBear/1.0 (+photo-lookup)' },
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function pickBestPageFromQuery (queryJson, name) {
  const pages = Object.values(queryJson?.query?.pages || {});
  if (!pages.length) return null;

  const withThumb = pages.filter(p => p?.thumbnail?.source);
  const ranked = (withThumb.length ? withThumb : pages)
    .map(p => ({ p, score: scoreTitle(p?.title || '', name) }))
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.p || null;
}

async function lookupByGeo (name, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const url = new URL(WIKI_API);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('generator', 'geosearch');
  url.searchParams.set('ggscoord', `${lat}|${lon}`);
  url.searchParams.set('ggsradius', '1200');
  url.searchParams.set('ggslimit', '12');
  url.searchParams.set('prop', 'pageimages');
  url.searchParams.set('piprop', 'thumbnail');
  url.searchParams.set('pithumbsize', '1200');
  url.searchParams.set('origin', '*');

  const json = await fetchJsonWithTimeout(url.toString());
  return pickBestPageFromQuery(json, name);
}

async function lookupByTitleSearch (name, city = '') {
  if (!norm(name)) return null;

  const search = `${name}${city ? ` ${city}` : ''} restaurant`;
  const searchUrl = new URL(WIKI_API);
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('formatversion', '2');
  searchUrl.searchParams.set('list', 'search');
  searchUrl.searchParams.set('srlimit', '6');
  searchUrl.searchParams.set('srsearch', search);
  searchUrl.searchParams.set('origin', '*');

  const searchJson = await fetchJsonWithTimeout(searchUrl.toString());
  const rows = searchJson?.query?.search || [];
  if (!rows.length) return null;

  const best = rows
    .map(r => ({
      title: r?.title || '',
      score: scoreTitle(r?.title || '', name),
      pageid: Number(r?.pageid || 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best?.pageid) return null;

  const pageUrl = new URL(WIKI_API);
  pageUrl.searchParams.set('action', 'query');
  pageUrl.searchParams.set('format', 'json');
  pageUrl.searchParams.set('formatversion', '2');
  pageUrl.searchParams.set('pageids', String(best.pageid));
  pageUrl.searchParams.set('prop', 'pageimages');
  pageUrl.searchParams.set('piprop', 'thumbnail');
  pageUrl.searchParams.set('pithumbsize', '1200');
  pageUrl.searchParams.set('origin', '*');

  const pageJson = await fetchJsonWithTimeout(pageUrl.toString());
  const page = Object.values(pageJson?.query?.pages || {})[0] || null;
  return page;
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const name = String(req.query?.name || '').trim();
  const city = String(req.query?.city || '').trim();
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);

  if (!name) {
    sendJson(res, 400, { error: 'Missing name' });
    return;
  }

  try {
    let page = await lookupByGeo(name, lat, lon);
    if (!page?.thumbnail?.source) {
      page = await lookupByTitleSearch(name, city);
    }

    const url = page?.thumbnail?.source || '';
    if (!url) {
      sendJson(res, 404, { found: false });
      return;
    }

    sendJson(res, 200, {
      found: true,
      photoUrl: url,
      source: 'wikipedia',
      title: page?.title || '',
    });
  } catch (err) {
    console.error('[FTB] place-photo error:', err?.message || err);
    sendJson(res, 500, { error: 'Lookup failed' });
  }
};
