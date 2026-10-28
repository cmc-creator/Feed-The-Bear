/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Place Info (Google Places)
   ════════════════════════════════════════════════════════════
   GET /api/place-info?name=&lat=&lng=&address=
   Returns the Google rating, review count, price level, opening
   hours, phone, website and Maps link for one restaurant.

   Uses the same GOOGLE_PLACES_API_KEY as restaurant-image.js.
   Responses are cached at the CDN for a week, and the app keeps
   them on the saved spot, so each place is looked up rarely.
   ════════════════════════════════════════════════════════════ */

const FIELDS = [
  'places.id', 'places.displayName', 'places.location', 'places.rating', 'places.userRatingCount',
  'places.priceLevel', 'places.regularOpeningHours', 'places.nationalPhoneNumber',
  'places.websiteUri', 'places.googleMapsUri',
].join(',');

const PRICE = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
const STOP = ['the', 'and', 'restaurant', 'cafe', 'bar', 'grill', 'kitchen', 'eatery', 'co'];

// Per-instance limit so one client can't run up the Google bill.
const hits = new Map();
function limited (ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 60;
}

const tokens = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t && !STOP.includes(t));

function nameScore (a, b) {
  const want = tokens(a);
  const got = tokens(b);
  if (!want.length || !got.length) return 0;
  return want.filter(t => got.includes(t)).length / want.length;
}

function metersBetween (lat1, lng1, lat2, lng2) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

function safeHttpUrl (value) {
  try {
    const u = new URL(String(value || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch { return ''; }
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(503).json({ found: false, error: 'Place info is not set up.' });

  const name = String(req.query.name || '').trim().slice(0, 120);
  const address = String(req.query.address || '').trim().slice(0, 200);
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!name) return res.status(400).json({ found: false, error: 'Missing name' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ found: false, error: 'Slow down a little.' });

  const body = { textQuery: address ? `${name}, ${address}` : name, maxResultCount: 3 };
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: 3000 } };
  }

  let places = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!resp.ok) {
      console.warn('[FTB] place-info HTTP', resp.status, (await resp.text()).slice(0, 200));
      return res.status(502).json({ found: false });
    }
    places = (await resp.json())?.places || [];
  } catch (err) {
    console.warn('[FTB] place-info failed:', err.message);
    return res.status(502).json({ found: false });
  }

  // Only trust a result that is clearly the same place: the name matches, or it sits right where the spot is saved.
  const near = p => Number.isFinite(lat) && p.location
    && metersBetween(lat, lng, p.location.latitude, p.location.longitude) < 250;
  const place = places.find(p => nameScore(name, p.displayName?.text) >= 0.6 || (near(p) && nameScore(name, p.displayName?.text) > 0));
  res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
  if (!place) return res.status(200).json({ found: false });

  const hours = place.regularOpeningHours || {};
  return res.status(200).json({
    found: true,
    placeId: place.id || '',
    name: place.displayName?.text || '',
    rating: Number(place.rating) || 0,
    reviews: Number(place.userRatingCount) || 0,
    priceLevel: PRICE[place.priceLevel] || 0,
    hours: Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions.slice(0, 7) : [],
    periods: Array.isArray(hours.periods) ? hours.periods.slice(0, 30).map(p => ({
      open: p.open ? { day: p.open.day, hour: p.open.hour, minute: p.open.minute || 0 } : null,
      close: p.close ? { day: p.close.day, hour: p.close.hour, minute: p.close.minute || 0 } : null,
    })) : [],
    phone: place.nationalPhoneNumber || '',
    website: safeHttpUrl(place.websiteUri),
    mapsUrl: safeHttpUrl(place.googleMapsUri),
  });
};
