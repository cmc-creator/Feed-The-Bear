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
      if (abs) return abs;
    }
  }
  return '';
}

async function scrapeWebsiteImage (website = '') {
  const url = safeHttpUrl(website);
  if (!url) return '';
  const resp = await fetch(url, {
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

async function wikiGeoImage ({ lat, lon }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

  const geo = new URL(WIKI_API);
  geo.searchParams.set('action', 'query');
  geo.searchParams.set('format', 'json');
  geo.searchParams.set('formatversion', '2');
  geo.searchParams.set('generator', 'geosearch');
  geo.searchParams.set('ggscoord', `${lat}|${lon}`);
  geo.searchParams.set('ggsradius', '1400');
  geo.searchParams.set('ggslimit', '10');
  geo.searchParams.set('prop', 'pageimages');
  geo.searchParams.set('piprop', 'thumbnail');
  geo.searchParams.set('pithumbsize', '1200');

  const r = await fetch(geo.toString());
  if (!r.ok) return '';
  const j = await r.json();
  const pages = Object.values(j?.query?.pages || {});
  for (const p of pages) {
    const img = safeHttpUrl(p?.thumbnail?.source || '');
    if (img) return img;
  }
  return '';
}

async function wikiTitleImage ({ name = '', city = '' }) {
  const term = `${String(name || '').trim()} restaurant ${String(city || '').trim()}`.trim();
  if (!term) return '';

  const search = new URL(WIKI_API);
  search.searchParams.set('action', 'query');
  search.searchParams.set('format', 'json');
  search.searchParams.set('formatversion', '2');
  search.searchParams.set('list', 'search');
  search.searchParams.set('srlimit', '5');
  search.searchParams.set('srsearch', term);

  const rs = await fetch(search.toString());
  if (!rs.ok) return '';
  const js = await rs.json();
  const first = (js?.query?.search || [])[0];
  if (!first?.pageid) return '';

  const page = new URL(WIKI_API);
  page.searchParams.set('action', 'query');
  page.searchParams.set('format', 'json');
  page.searchParams.set('formatversion', '2');
  page.searchParams.set('pageids', String(first.pageid));
  page.searchParams.set('prop', 'pageimages');
  page.searchParams.set('piprop', 'thumbnail');
  page.searchParams.set('pithumbsize', '1200');

  const rp = await fetch(page.toString());
  if (!rp.ok) return '';
  const jp = await rp.json();
  const pageData = Object.values(jp?.query?.pages || {})[0] || null;
  return safeHttpUrl(pageData?.thumbnail?.source || '');
}

module.exports = async function handler (req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const name = String(req.query?.name || '').trim();
  const city = String(req.query?.city || '').trim();
  const website = String(req.query?.website || '').trim();
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);

  if (!name && !website) {
    return res.status(400).json({ found: false, error: 'Missing name or website' });
  }

  try {
    let photoUrl = '';
    let source = '';

    if (website) {
      photoUrl = await scrapeWebsiteImage(website);
      if (photoUrl) source = 'website';
    }

    if (!photoUrl) {
      photoUrl = await wikiGeoImage({ lat, lon });
      if (photoUrl) source = 'wikipedia-geo';
    }

    if (!photoUrl) {
      photoUrl = await wikiTitleImage({ name, city });
      if (photoUrl) source = 'wikipedia-title';
    }

    if (!photoUrl) {
      return res.status(404).json({ found: false, photoUrl: '', source: 'none' });
    }

    return res.status(200).json({ found: true, photoUrl, source });
  } catch (err) {
    return res.status(500).json({ found: false, error: 'lookup_failed', detail: String(err?.message || err) });
  }
};
