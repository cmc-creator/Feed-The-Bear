// Place search (api/place-info.js mode=search): Google ranks by text
// relevance, so a place right in front of you can be cut off behind
// far-away exact matches. The API fetches more results and returns the
// closest first when it knows where you are.
const path = require('path');
const Module = require('module');
const { check, finish } = require('./lib');

const fake = {
  apps: [1],
  auth: () => ({
    verifyIdToken: async t => {
      if (!String(t || '').startsWith('token-')) throw new Error('bad');
      return { uid: t.slice(6), email_verified: true };
    },
  }),
  firestore: () => ({
    doc: () => ({ get: async () => ({ data: () => ({}) }), set: async () => {} }),
    runTransaction: async fn => fn({
      get: async () => ({ data: () => ({}) }),
      set: () => {},
    }),
  }),
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
const placeInfo = require(path.join(__dirname, '..', 'api', 'place-info.js'));
Module._load = orig;

process.env.GOOGLE_PLACES_API_KEY = 'test-key';

// Google's order: the exact-name match 20 km away first, the nearest place last.
const GOOGLE_ORDER = [
  { id: 'far-exact', displayName: { text: 'Tacos Chiwas' }, formattedAddress: 'Far away', location: { latitude: 33.65, longitude: -111.92 }, primaryTypeDisplayName: { text: 'Mexican restaurant' }, rating: 4.8, userRatingCount: 900, priceLevel: 'PRICE_LEVEL_MODERATE' },
  { id: 'mid', displayName: { text: 'Tacos Chiwas Express' }, formattedAddress: '2 km away', location: { latitude: 33.51, longitude: -111.92 }, primaryTypeDisplayName: { text: 'Mexican restaurant' }, rating: 4.2, userRatingCount: 120, priceLevel: 'PRICE_LEVEL_INEXPENSIVE' },
  { id: 'no-coords', displayName: { text: 'Tacos Chiwas Truck' }, formattedAddress: 'Somewhere', primaryTypeDisplayName: { text: 'Food truck' }, rating: 4.0, userRatingCount: 50 },
  { id: 'near', displayName: { text: 'Tacos Chiwas Downtown' }, formattedAddress: 'Right here', location: { latitude: 33.4945, longitude: -111.9265 }, primaryTypeDisplayName: { text: 'Mexican restaurant' }, rating: 4.5, userRatingCount: 300, priceLevel: 'PRICE_LEVEL_MODERATE' },
];
let lastBody = null;
global.fetch = async () => ({
  ok: true,
  json: async () => ({ places: GOOGLE_ORDER }),
});
// Capture the request body Google sees.
const realFetch = global.fetch;
global.fetch = async (url, opts) => { lastBody = JSON.parse(opts.body); return realFetch(url, opts); };

const call = (query = {}) => new Promise(resolve => {
  const res = {
    setHeader () {},
    status (c) { this.c = c; return this; },
    json (d) { resolve({ status: this.c, data: d }); return this; },
  };
  placeInfo({ method: 'GET', query, headers: { 'x-ftb-token': 'token-testUid12345', 'x-forwarded-for': '1.2.3.4' } }, res);
});

(async () => {
  const lat = 33.4942, lng = -111.9261;
  let r = await call({ mode: 'search', q: 'tacos', lat: String(lat), lng: String(lng) });
  check(r.status === 200, 'search answers 200');
  check(lastBody && lastBody.maxResultCount === 10, `search asks Google for 10, not 5 (got ${lastBody?.maxResultCount})`);
  const names = (r.data.places || []).map(p => p.placeId);
  check(JSON.stringify(names) === JSON.stringify(['near', 'mid', 'far-exact', 'no-coords']),
    `closest first when location is known (got ${names.join(', ')})`);
  const near = (r.data.places || [])[0] || {};
  check(near.placeId === 'near' && near.name === 'Tacos Chiwas Downtown' && near.address === 'Right here' && near.kind === 'Mexican restaurant' && near.rating === 4.5 && near.reviews === 300 && near.priceLevel === 2,
    'the response shape is unchanged (placeId, name, address, lat, lng, kind, rating, reviews, priceLevel)');

  // No location: Google's order is kept, nothing is dropped.
  r = await call({ mode: 'search', q: 'tacos' });
  check(JSON.stringify((r.data.places || []).map(p => p.placeId)) === JSON.stringify(['far-exact', 'mid', 'no-coords', 'near']),
    'without a location Google order is kept');

  // Short queries are still rejected.
  r = await call({ mode: 'search', q: 'ta', lat: String(lat), lng: String(lng) });
  check(r.status === 400 && (r.data.places || []).length === 0, 'a query under 3 letters is rejected');

  finish('placesearch');
})();
