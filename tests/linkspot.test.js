// Restaurant from a TikTok/Instagram link (api/link-spot.js), with the
// outside services faked: reads the caption, finds the place, and refuses
// to fetch sites that aren't social media.
const path = require('path');
const { check, finish } = require('./lib');

const fetched = [];
global.fetch = async (url, opts = {}) => {
  url = String(url);
  fetched.push(url);
  const json = data => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => '' } });
  if (url.startsWith('https://www.tiktok.com/oembed')) return json({ title: 'The best birria in Phoenix 🌮 @tacosch #phxfood', author_name: 'phxeats' });
  if (url.startsWith('https://vm.tiktok.com/')) return { ok: false, status: 301, headers: { get: h => (h === 'location' ? 'http://169.254.169.254/latest' : '') }, text: async () => '' };
  if (url.includes('instagram.com/p/')) return { ok: true, status: 200, headers: { get: () => '' }, text: async () => '<meta property="og:description" content="Pizzeria Bianco in Phoenix, still the best margherita" />' };
  if (url.includes('generativelanguage.googleapis.com')) {
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    const name = /birria/.test(prompt) ? 'Tacos Chiwas' : /Bianco/.test(prompt) ? 'Pizzeria Bianco' : '';
    return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ name, city: 'Phoenix', dish: name ? 'house special' : '' }) }] } }] });
  }
  if (url.includes('places.googleapis.com')) {
    const q = JSON.parse(opts.body).textQuery;
    return json({ places: [{ displayName: { text: q.split(',')[0] }, formattedAddress: '1 Main St, Phoenix, AZ', location: { latitude: 33.45, longitude: -112.07 }, rating: 4.7, googleMapsUri: 'https://maps.google.com/?cid=1' }] });
  }
  throw new Error('unexpected fetch ' + url);
};
process.env.GEMINI_API_KEY = 'k';
process.env.GOOGLE_PLACES_API_KEY = 'k';
const handler = require(path.join(__dirname, '..', 'api', 'link-spot.js'));

const call = q => new Promise(resolve => {
  let status = 200;
  handler({ method: 'GET', query: { q, lat: '33.49', lng: '-111.92' }, headers: {} }, {
    status (s) { status = s; return this; }, setHeader () {}, json (d) { resolve({ status, ...d }); return this; },
  });
});

(async () => {
  let r = await call('https://www.tiktok.com/@phxeats/video/7312345678901234567');
  check(r.places[0]?.name === 'Tacos Chiwas' && /birria/.test(r.caption), `a TikTok link finds the restaurant (${r.places[0]?.name})`);
  r = await call('https://www.instagram.com/p/C1abcDEF/');
  check(r.places[0]?.name === 'Pizzeria Bianco', 'an Instagram post is read from its share tags');
  r = await call('Pizzeria Bianco downtown');
  check(r.places[0]?.name === 'Pizzeria Bianco', 'typing a name works too');

  fetched.length = 0;
  r = await call('https://evil.example.com/internal');
  check(!fetched.length && r.places.length === 0 && /not from TikTok/.test(r.error), 'other websites are never fetched');
  fetched.length = 0;
  r = await call('https://vm.tiktok.com/ZMabc123/');
  check(!fetched.some(u => u.includes('169.254')), 'a short link that redirects off the allowed sites is not followed');
  r = await call('');
  check(r.status === 400, 'an empty paste is rejected');
  finish('linkspot');
})();
