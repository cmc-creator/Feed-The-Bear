// City guides (api/guide.js): feed-the-bear.com/eat/<city>/<food>, pages
// Google can find, with Save buttons that open the app's Add form.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

// The guide with a fake database and a fake OpenStreetMap.
const store = {};
let profiles = [];
const fakeAdmin = { apps: [1], firestore: () => ({
  doc: k => ({ get: async () => ({ data: () => store[k] }), set: async v => { store[k] = v; } }),
  collection: () => ({ limit: () => ({ get: async () => ({ docs: profiles.map(p => ({ data: () => p })) }) }) }),
}) };
const load = Module._load;
Module._load = function (req, ...a) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === './_limit') return { overLimit: async () => false };
  return load.call(this, req, ...a);
};
const guide = require('../api/guide');
Module._load = load;
let osm = [];
global.fetch = async () => ({ ok: true, json: async () => ({ elements: osm }) });
const run = query => new Promise(resolve => {
  const res = { h: {}, setHeader (k, v) { this.h[k] = v; }, status (c) { this.c = c; return this; }, send (b) { resolve({ status: this.c, body: b }); } };
  guide({ method: 'GET', query, headers: {} }, res);
});

(async () => {
  osm = [
    { type: 'node', lat: 33.5, lon: -111.9, tags: { name: 'Taco Bell', brand: 'Taco Bell', amenity: 'fast_food' } },
    { type: 'node', lat: 33.51, lon: -111.91, tags: { name: 'Tacos Chiwas', amenity: 'restaurant', cuisine: 'mexican', 'addr:housenumber': '1923', 'addr:street': 'E McDowell Rd', 'addr:city': 'Phoenix' } },
    { type: 'way', center: { lat: 33.52, lon: -111.92 }, tags: { name: 'Tacos Chiwas', amenity: 'restaurant' } },
    { type: 'node', lat: 33.53, lon: -111.93, tags: { amenity: 'restaurant' } },
    { type: 'node', lat: 33.54, lon: -111.94, tags: { name: 'La Santisima', amenity: 'restaurant', cuisine: 'mexican' } },
  ];
  profiles = [{ profile: { picks: [{ n: 'Taco Guild', c: 'Mexican', r: 5, a: '546 E Osborn Rd, Phoenix', g: ['Duck taco'] }, { n: 'Meh Tacos', c: 'Mexican', r: 2, a: 'Phoenix' }, { n: 'Sushi Roku', c: 'Japanese', r: 5, a: 'Phoenix' }] } }];
  let r = await run({ city: 'phoenix-az', food: 'tacos' });
  const names = [...r.body.matchAll(/<div class="name">([^<]+)</g)].map(m => m[1]);
  check(r.status === 200 && /<title>Tacos in Phoenix, AZ/.test(r.body), 'a guide page for tacos in Phoenix');
  check(names[0] === 'Taco Guild' && /Duck taco/.test(r.body) && /from 1 member/.test(r.body), `members' 4-5 star picks come first, with what to order (${names})`);
  check(!names.includes('Meh Tacos') && !names.includes('Sushi Roku'), 'low ratings and other foods are left out');
  check(names.indexOf('Tacos Chiwas') < names.indexOf('Taco Bell') && names.filter(n => n === 'Tacos Chiwas').length === 1 && /chain/.test(r.body), 'local spots before chains, each once, chains marked');
  check(/href="\/app\.html\?share-target=1&amp;title=Tacos%20Chiwas&amp;addr=1923%20E%20McDowell%20Rd%2C%20Phoenix"/.test(r.body), 'Save opens the app with the name and address');
  check(/OpenStreetMap contributors/.test(r.body) && /"@type":"ItemList"/.test(r.body) && /rel="canonical" href="https:\/\/www\.feed-the-bear\.com\/eat\/phoenix-az\/tacos"/.test(r.body), 'credits OpenStreetMap, with search-engine markup and a canonical link');
  check(!/noindex/.test(r.body) && /\/eat\/scottsdale-az\/tacos/.test(r.body), 'linked to the same food in nearby cities');
  check(store['guides/phoenix-az_tacos']?.places?.length === 3, 'places are kept for next time');

  // Nothing found yet: kept out of search results.
  osm = []; profiles = [];
  r = await run({ city: 'boston-ma', food: 'pho' });
  check(r.status === 200 && /noindex/.test(r.body), 'a guide with no spots yet is hidden from search engines');
  check((await run({ city: 'nowhere-zz', food: 'tacos' })).status === 404 && (await run({ city: 'phoenix-az', food: 'caviar' })).status === 404, 'unknown cities and foods are 404s');
  check(/Where to eat in Phoenix/.test((await run({ city: 'phoenix-az' })).body) && /Scottsdale/.test((await run({})).body), 'city pages and the index of cities');

  const sitemap = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');
  check(sitemap.includes('/eat/scottsdale-az/tacos') && (sitemap.match(/\/eat\//g) || []).length === guide.CITIES.length * (guide.FOODS.length + 1), 'every guide is in the sitemap');
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  check(vercel.rewrites.some(x => x.source === '/eat/:city/:food'), 'the /eat addresses are wired up');

  // Save in the app: the Add form, with the exact name and address.
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, x => x.abort());
  await p.goto(`${BASE}/app.html?share-target=1&title=${encodeURIComponent('Bar-B-Q Joint')}&addr=${encodeURIComponent('12 Main St, Mesa')}`);
  await p.waitForTimeout(1800);
  check(await p.locator('#modal-overlay').isVisible() && await p.inputValue('#form-name') === 'Bar-B-Q Joint' && await p.inputValue('#form-address') === '12 Main St, Mesa', 'Save from a guide opens Add with the name (hyphen kept) and address');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('guide');
})();
