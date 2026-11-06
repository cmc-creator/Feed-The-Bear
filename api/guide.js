/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: city food guides
   ════════════════════════════════════════════════════════════
   feed-the-bear.com/eat                      every city
   feed-the-bear.com/eat/scottsdale-az        what to eat there
   feed-the-bear.com/eat/scottsdale-az/tacos  the places
   (vercel.json rewrites → /api/guide?city=&food=; listed in sitemap.xml)

   Pages Google can find, so people searching "tacos in Scottsdale" land
   here, with "Save" buttons that open the app's Add form for that place.
   Places come from OpenStreetMap (ODbL, credited on the page), found with
   Overpass in a box around the city and kept in guides/{city}_{food}; a
   query takes ~30s, so api/nudges.js refreshes the oldest few each day and
   a page with none yet is left out of search results until it has some.
   Feed The Bear members' public picks that match (profiles, rated 4+) go
   first, live. Not Google Places: its terms don't allow keeping its data.
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');
const { overLimit } = require('./_limit');

const SITE = 'https://www.feed-the-bear.com';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// [slug, name, state, lat, lng, radius km]
const CITIES = [
  ['phoenix-az', 'Phoenix', 'AZ', 33.4484, -112.074, 14], ['scottsdale-az', 'Scottsdale', 'AZ', 33.4942, -111.9261, 8],
  ['tempe-az', 'Tempe', 'AZ', 33.4255, -111.94, 6], ['mesa-az', 'Mesa', 'AZ', 33.4152, -111.8315, 9],
  ['chandler-az', 'Chandler', 'AZ', 33.3062, -111.8413, 7], ['tucson-az', 'Tucson', 'AZ', 32.2226, -110.9747, 10],
  ['los-angeles-ca', 'Los Angeles', 'CA', 34.0522, -118.2437, 10], ['san-diego-ca', 'San Diego', 'CA', 32.7157, -117.1611, 9],
  ['san-francisco-ca', 'San Francisco', 'CA', 37.7749, -122.4194, 6], ['las-vegas-nv', 'Las Vegas', 'NV', 36.1699, -115.1398, 10],
  ['denver-co', 'Denver', 'CO', 39.7392, -104.9903, 8], ['seattle-wa', 'Seattle', 'WA', 47.6062, -122.3321, 7],
  ['portland-or', 'Portland', 'OR', 45.5152, -122.6784, 7], ['austin-tx', 'Austin', 'TX', 30.2672, -97.7431, 9],
  ['dallas-tx', 'Dallas', 'TX', 32.7767, -96.797, 10], ['houston-tx', 'Houston', 'TX', 29.7604, -95.3698, 11],
  ['san-antonio-tx', 'San Antonio', 'TX', 29.4241, -98.4936, 10], ['chicago-il', 'Chicago', 'IL', 41.8781, -87.6298, 9],
  ['nashville-tn', 'Nashville', 'TN', 36.1627, -86.7816, 8], ['atlanta-ga', 'Atlanta', 'GA', 33.749, -84.388, 9],
  ['miami-fl', 'Miami', 'FL', 25.7617, -80.1918, 8], ['new-orleans-la', 'New Orleans', 'LA', 29.9511, -90.0715, 7],
  ['new-york-ny', 'New York', 'NY', 40.7306, -73.9866, 7], ['boston-ma', 'Boston', 'MA', 42.3601, -71.0589, 6],
  ['philadelphia-pa', 'Philadelphia', 'PA', 39.9526, -75.1652, 7],
].map(([slug, name, st, lat, lng, km]) => ({ slug, name, st, lat, lng, km }));

// [slug, label, emoji, OSM cuisine pattern, name pattern]
const FOODS = [
  ['tacos', 'Tacos', '🌮', 'mexican|taco|tex-mex', 'Taco|taco|Taqueria|taqueria'],
  ['pizza', 'Pizza', '🍕', 'pizza', 'Pizza|pizza|Pizzeria'],
  ['burgers', 'Burgers', '🍔', 'burger', 'Burger|burger'],
  ['sushi', 'Sushi', '🍣', 'sushi|japanese', 'Sushi|sushi'],
  ['bbq', 'BBQ', '🍖', 'barbecue|bbq', 'BBQ|Barbecue|Bar-B-Q|Smokehouse'],
  ['ramen', 'Ramen', '🍜', 'ramen|noodle', 'Ramen|ramen'],
  ['pho', 'Pho', '🍲', 'vietnamese|pho', 'Pho|Phở'],
  ['wings', 'Wings', '🍗', 'chicken_wings|wings', 'Wing|wing'],
  ['breakfast', 'Breakfast', '🥞', 'breakfast|brunch|pancake', 'Breakfast|Brunch|Pancake|Waffle'],
  ['thai', 'Thai food', '🍛', 'thai', 'Thai'],
].map(([slug, label, emoji, cuisine, name]) => ({ slug, label, emoji, cuisine, name }));

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// One OSM element → a place, or null. Chains (a brand tag) are marked.
function toPlace (el) {
  const t = el?.tags || {};
  const name = String(t.name || '').trim().slice(0, 80);
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const address = [street, t['addr:city']].filter(Boolean).join(', ').slice(0, 100);
  return {
    name, address,
    lat: Number.isFinite(lat) ? Math.round(lat * 1e5) / 1e5 : null,
    lng: Number.isFinite(lng) ? Math.round(lng * 1e5) / 1e5 : null,
    chain: !!(t.brand || t['brand:wikidata']),
    site: /^https?:\/\//.test(t.website || '') ? String(t.website).slice(0, 200) : '',
  };
}

// Local places first, then chains; named once each; at most 40.
function pickPlaces (elements) {
  const seen = new Set();
  return (Array.isArray(elements) ? elements : []).map(toPlace).filter(p => {
    if (!p) return false;
    const k = norm(p.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (a.chain - b.chain) || (!!b.address - !!a.address) || a.name.localeCompare(b.name)).slice(0, 40);
}

// A box, not a radius (much faster for Overpass), and case spelled out in
// the name pattern (a case-insensitive match is slow). Every server at once;
// the first good answer wins.
async function overpass (city, food, timeoutMs = 45000) {
  const dLat = city.km / 111;
  const dLng = city.km / (111 * Math.cos(city.lat * Math.PI / 180));
  const box = [city.lat - dLat, city.lng - dLng, city.lat + dLat, city.lng + dLng].map(n => n.toFixed(4)).join(',');
  const q = `[out:json][timeout:40];(
nwr["amenity"~"^(restaurant|fast_food)$"]["cuisine"~"${food.cuisine}"](${box});
nwr["amenity"~"^(restaurant|fast_food)$"]["name"~"${food.name}"](${box});
);out center tags 300;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await Promise.any(OVERPASS.map(async url => {
      const resp = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(q)}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FeedTheBear/1.0 (www.feed-the-bear.com)' }, signal: ctrl.signal });
      if (!resp.ok) throw new Error(`${url} ${resp.status}`);
      const places = pickPlaces((await resp.json())?.elements);
      if (!places.length) throw new Error(`${url} empty`);
      return places;
    }));
  } catch (err) {
    console.warn('[FTB] guide overpass failed:', city.slug, food.slug, (err.errors || [err]).map(e => e.message).join('; ').slice(0, 300));
    return null;
  } finally { clearTimeout(timer); ctrl.abort(); }
}

// Whatever is saved, however old (refreshGuides keeps them current); none
// saved yet: try now.
async function placesFor (db, city, food) {
  const ref = db.doc(`guides/${city.slug}_${food.slug}`);
  const cur = (await ref.get()).data();
  if (Array.isArray(cur?.places) && cur.places.length) return cur.places;
  const places = await overpass(city, food, 40000);
  if (places && places.length) { await ref.set({ places, at: Date.now() }); return places; }
  return [];
}

// The `n` guides saved longest ago (or never), searched again. For the daily cron.
async function refreshGuides (db, n = 6) {
  const all = CITIES.flatMap(city => FOODS.map(food => ({ city, food, id: `${city.slug}_${food.slug}` })));
  const snaps = await db.getAll(...all.map(g => db.doc(`guides/${g.id}`)));
  const oldest = all.map((g, i) => ({ ...g, at: snaps[i].data()?.at || 0 })).sort((a, b) => a.at - b.at).slice(0, n);
  let done = 0;
  for (const g of oldest) {
    const places = await overpass(g.city, g.food);
    if (places) { await db.doc(`guides/${g.id}`).set({ places, at: Date.now() }); done++; }
  }
  return done;
}

// Restaurants that pay to be featured here (advertise.js), approved by the owner.
async function featuredFor (db, city, food) {
  try {
    const snap = await db.collection('featured').where('key', '==', `${city.slug}_${food.slug}`).limit(10).get();
    return snap.docs.map(d => d.data()).filter(f => f.status === 'live').slice(0, 3);
  } catch { return []; }
}

// Members' public picks (rated 4+) in this city for this food, best first.
async function memberPicks (db, city, food) {
  const snap = await db.collection('profiles').limit(500).get().catch(() => null);
  if (!snap) return [];
  const cuisine = new RegExp(food.cuisine.replace(/_/g, ' '), 'i');
  const named = new RegExp(food.name, 'i');
  const where = new RegExp(`\\b${city.name}\\b`, 'i');
  const byName = new Map();
  snap.docs.forEach(d => {
    const p = d.data();
    (Array.isArray(p?.profile?.picks) ? p.profile.picks : []).forEach(x => {
      const r = Number(x?.r) || 0;
      if (r < 4 || !x?.n || !where.test(String(x.a || ''))) return;
      if (!cuisine.test(String(x.c || '')) && !named.test(String(x.n))) return;
      const k = norm(x.n);
      const e = byName.get(k) || { name: String(x.n).slice(0, 80), address: String(x.a || '').slice(0, 100), stars: [], get: new Set() };
      e.stars.push(r);
      (Array.isArray(x.g) ? x.g : []).slice(0, 3).forEach(g => e.get.add(String(g).slice(0, 40)));
      byName.set(k, e);
    });
  });
  return [...byName.values()].map(e => ({ ...e, avg: e.stars.reduce((a, b) => a + b, 0) / e.stars.length, get: [...e.get].slice(0, 3) }))
    .sort((a, b) => b.avg - a.avg || b.stars.length - a.stars.length).slice(0, 10);
}

const saveLink = (name, address) => `/app.html?share-target=1&title=${encodeURIComponent(name)}${address ? `&addr=${encodeURIComponent(address)}` : ''}`;
const mapsLink = (p, city) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address || `${city.name}, ${city.st}`].join(', '))}`;

function page (res, status, { title, description, canonical, body, jsonld = null, noindex = false }) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' : 'no-store');
  return res.status(status).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />${noindex ? '\n  <meta name="robots" content="noindex" />' : ''}
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${SITE}/og-image.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#1b241c" />
  <link rel="icon" href="/feedbear-sm.jpg" />
  ${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
  <style>
    :root { --bg: #1b241c; --card: #26322a; --text: #f6ecdc; --dim: #c9bfae; --accent: #ff8a3d; --gold: #ffd98a; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 500 1rem/1.45 system-ui, -apple-system, sans-serif; }
    main { max-width: 640px; margin: 0 auto; padding: 24px 16px 130px; }
    a { color: var(--gold); }
    .top { display: flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); font-weight: 800; }
    .top img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
    h1 { font-size: 1.7rem; line-height: 1.2; margin: 18px 0 6px; }
    h2 { font-size: 1.1rem; margin: 26px 0 10px; }
    .lead { color: var(--dim); margin: 0 0 8px; }
    .list { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
    .place { display: flex; gap: 10px; align-items: center; background: var(--card); border-radius: 14px; padding: 12px; }
    .place .body { flex: 1; min-width: 0; }
    .name { font-weight: 800; overflow-wrap: anywhere; }
    .meta { font-size: .82rem; color: var(--dim); overflow-wrap: anywhere; }
    .meta a { color: var(--dim); }
    .stars { color: var(--gold); }
    .get b { color: var(--gold); }
    .place.featured { border: 2px solid var(--gold); }
    .badge { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: var(--gold); color: #1b130b; font-size: .68rem; font-weight: 800; vertical-align: middle; }
    .save { flex-shrink: 0; padding: 8px 12px; border-radius: 999px; background: rgba(255,138,61,.14); border: 1px solid rgba(255,138,61,.5); color: var(--accent); font-weight: 800; font-size: .85rem; text-decoration: none; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chips a { padding: 8px 12px; border-radius: 999px; background: var(--card); color: var(--text); text-decoration: none; font-weight: 700; font-size: .9rem; }
    .note { font-size: .78rem; color: var(--dim); margin-top: 22px; }
    .cta { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); background: linear-gradient(transparent, var(--bg) 30%); }
    .cta a { display: block; max-width: 640px; margin: 0 auto; padding: 15px; border-radius: 16px; background: var(--accent); color: #1b130b; font-weight: 800; text-align: center; text-decoration: none; }
    .cta small { display: block; text-align: center; color: var(--dim); font-size: .78rem; margin-top: 6px; }
  </style>
</head>
<body>
<main>
  <a class="top" href="/"><img src="/feedbear-sm.jpg" alt="" />Feed The Bear</a>
${body}
</main>
<div class="cta"><a href="/app.html">Save places like these free in Feed The Bear</a><small>Your list of where to eat and what to order · also on <a href="https://play.google.com/store/apps/details?id=com.feedthebear.app">Google Play</a></small></div>
</body>
</html>`);
}

function notFound (res) {
  return page(res, 404, { title: 'Feed The Bear', description: 'Save the places you want to eat and what to order there.', canonical: `${SITE}/eat`,
    body: '<h1>No guide here</h1><p class="lead"><a href="/eat">See every city</a></p>' });
}

function indexPage (res) {
  const byState = {};
  CITIES.forEach(c => { (byState[c.st] ||= []).push(c); });
  return page(res, 200, {
    title: 'Where to eat, city by city | Feed The Bear',
    description: `Tacos, pizza, burgers, sushi and more in ${CITIES.length} US cities: local spots to try, and what to order.`,
    canonical: `${SITE}/eat`,
    body: `<h1>Where to eat, city by city</h1><p class="lead">Pick a city, then what you're craving.</p>
      ${Object.keys(byState).sort().map(st => `<h2>${esc(st)}</h2><div class="chips">${byState[st].map(c => `<a href="/eat/${c.slug}">${esc(c.name)}</a>`).join('')}</div>`).join('')}`,
  });
}

function cityPage (res, city) {
  return page(res, 200, {
    title: `Where to eat in ${city.name}, ${city.st} | Feed The Bear`,
    description: `The local spots for tacos, pizza, burgers, sushi, BBQ and more in ${city.name}, ${city.st}.`,
    canonical: `${SITE}/eat/${city.slug}`,
    body: `<h1>Where to eat in ${esc(city.name)}</h1><p class="lead">What are you craving?</p>
      <div class="chips">${FOODS.map(f => `<a href="/eat/${city.slug}/${f.slug}">${f.emoji} ${esc(f.label)}</a>`).join('')}</div>
      <p class="note"><a href="/eat">Other cities</a></p>`,
  });
}

function guidePage (res, city, food, places, members, featured = []) {
  const canonical = `${SITE}/eat/${city.slug}/${food.slug}`;
  const title = `${food.label} in ${city.name}, ${city.st}: ${places.length + members.length + featured.length} spots to try | Feed The Bear`;
  const memberHtml = members.length ? `<h2>Feed The Bear members' favorites</h2><ul class="list">${members.map(m => `
    <li class="place"><div class="body"><div class="name">${esc(m.name)}</div>
      <div class="meta"><span class="stars">${'★'.repeat(Math.round(m.avg))}</span> from ${m.stars.length} member${m.stars.length === 1 ? '' : 's'}${m.address ? ` · ${esc(m.address)}` : ''}</div>
      ${m.get.length ? `<div class="get">Get the <b>${m.get.map(esc).join(', ')}</b></div>` : ''}</div>
      <a class="save" href="${esc(saveLink(m.name, m.address))}">Save</a></li>`).join('')}</ul>` : '';
  const featuredHtml = featured.length ? `<ul class="list" style="margin-top:14px">${featured.map(f => `
    <li class="place featured"><div class="body"><div class="name">${esc(f.name)} <span class="badge">Featured</span></div>
      ${f.blurb ? `<div class="get">${esc(f.blurb)}</div>` : ''}
      <div class="meta">${f.address ? `${esc(f.address)} · ` : ''}${f.website ? `<a href="${esc(f.website)}" rel="sponsored noopener" target="_blank">Website</a>` : ''}</div></div>
      <a class="save" href="${esc(saveLink(f.name, f.address))}">Save</a></li>`).join('')}</ul>` : '';
  const placeHtml = places.length ? `<h2>${members.length ? 'More' : 'Local'} ${esc(food.label.toLowerCase())} spots</h2><ul class="list">${places.map(p => `
    <li class="place"><div class="body"><div class="name">${esc(p.name)}</div>
      <div class="meta">${p.address ? `${esc(p.address)} · ` : ''}<a href="${esc(mapsLink(p, city))}" rel="nofollow noopener" target="_blank">Map</a>${p.chain ? ' · chain' : ''}</div></div>
      <a class="save" href="${esc(saveLink(p.name, p.address))}">Save</a></li>`).join('')}</ul>`
    : '<p class="lead">We are still gathering spots here. Check back soon.</p>';
  const others = FOODS.filter(f => f.slug !== food.slug).map(f => `<a href="/eat/${city.slug}/${f.slug}">${f.emoji} ${esc(f.label)}</a>`).join('');
  const nearby = CITIES.filter(c => c.st === city.st && c.slug !== city.slug).map(c => `<a href="/eat/${c.slug}/${food.slug}">${esc(food.label)} in ${esc(c.name)}</a>`).join('');
  const all = [...featured.map(f => ({ name: f.name, address: f.address })), ...members.map(m => ({ name: m.name, address: m.address })), ...places];
  return page(res, 200, {
    title,
    noindex: !all.length,
    description: `${food.label} in ${city.name}, ${city.st}: ${all.slice(0, 4).map(p => p.name).join(', ')}${all.length > 4 ? ' and more' : ''}. Save the ones you want to try and what to order.`,
    canonical,
    jsonld: { '@context': 'https://schema.org', '@type': 'ItemList', name: `${food.label} in ${city.name}, ${city.st}`, url: canonical,
      itemListElement: all.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Restaurant', name: p.name, ...(p.address ? { address: p.address } : {}) } })) },
    body: `<h1>${food.emoji} ${esc(food.label)} in ${esc(city.name)}, ${esc(city.st)}</h1>
      <p class="lead">Local spots first. Tap Save to put one on your Want to Try list in Feed The Bear, then rate it and note what to order once you've been.</p>
      ${featuredHtml}${memberHtml}${placeHtml}
      <h2>More in ${esc(city.name)}</h2><div class="chips">${others}</div>
      ${nearby ? `<h2>Nearby</h2><div class="chips">${nearby}</div>` : ''}
      <p class="note">Own a restaurant here? <a href="/advertise.html">Get it featured on this guide</a>.</p>
      <p class="note">Places from <a href="https://www.openstreetmap.org/copyright" rel="nofollow noopener">© OpenStreetMap contributors</a>; favorites from Feed The Bear members' public pages. <a href="/eat">Other cities</a></p>`,
  });
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).send('Method not allowed'); }
  const citySlug = String(req.query?.city || '').toLowerCase();
  const foodSlug = String(req.query?.food || '').toLowerCase();
  if (!citySlug) return indexPage(res);
  const city = CITIES.find(c => c.slug === citySlug);
  if (!city) return notFound(res);
  if (!foodSlug) return cityPage(res, city);
  const food = FOODS.find(f => f.slug === foodSlug);
  if (!food) return notFound(res);
  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (await overLimit(`guide:${ip}`, 120, 600)) { res.setHeader('Retry-After', '600'); return res.status(429).send('Slow down a little and try again soon.'); }
  let places = [], members = [], featured = [];
  try {
    const db = getAdmin().firestore();
    [places, members, featured] = await Promise.all([placesFor(db, city, food), memberPicks(db, city, food), featuredFor(db, city, food)]);
  } catch (err) { console.error('[FTB] guide failed:', err.message); }
  const memberNames = new Set(members.map(m => norm(m.name)));
  featured.forEach(f => memberNames.add(norm(f.name)));
  return guidePage(res, city, food, places.filter(p => !memberNames.has(norm(p.name))), members.filter(m => !featured.some(f => norm(f.name) === norm(m.name))), featured);
};

module.exports.CITIES = CITIES;
module.exports.FOODS = FOODS;
module.exports.pickPlaces = pickPlaces;
module.exports.refreshGuides = refreshGuides;
module.exports.overpass = overpass;
