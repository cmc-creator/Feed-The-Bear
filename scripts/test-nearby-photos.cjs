const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
function extract(name, next) {
  return source.slice(source.indexOf(`function ${name} (`), source.indexOf(`\n${next}`, source.indexOf(`function ${name} (`)));
}
const context = vm.createContext({
  safeUrl: value => value || '',
  isLikelyRealPlacePhotoUrl: value => !!value,
});
vm.runInContext(extract('hasReliableNearbyCardPhoto', 'async function fetchPlacePhotoFromWikiClient'), context);
for (const photoUrl of ['', 'assets/food/pizza.webp', './assets/food/burger.jpg', 'https://images.unsplash.com/photo-123']) {
  assert.equal(context.hasReliableNearbyCardPhoto({ photoUrl }), false, photoUrl);
}
assert.equal(context.hasReliableNearbyCardPhoto({ photoUrl: 'https://images.example.com/venue.jpg' }), true);
// Exercise real rendering with deterministic UI helpers, without booting Firebase.
Object.assign(context, {
  formatCuisineLabel: v => v, fmtDist: () => '1 mi', verifiedPriceLevel: () => 0,
  nearbyPopularityLabel: () => '', favoriteDishesForSaved: () => [],
  escHtml: v => String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;'),
  escJsArg: v => v, cleanVenueWebsite: () => '',
  buildGoogleDirectionsUrl: () => '', buildGooglePlaceSearchUrl: () => '', buildMenuSearchUrl: () => '',
});
const start = source.indexOf('function renderNearbyVisualCard (');
const end = source.indexOf('\nfunction ', start + 1);
vm.runInContext(source.slice(start, end), context);
const empty = context.renderNearbyVisualCard({ name: 'Test', photoUrl: 'assets/food/pizza.webp' });
assert.ok(empty.includes('Restaurant photo unavailable'));
assert.ok(!empty.includes('<img'));
const real = context.renderNearbyVisualCard({ name: 'Test', photoUrl: 'https://images.example.com/venue.jpg?a=1&b=2' });
assert.ok(real.includes('alt="Photo of Test"'));
assert.ok(real.includes('?a=1&amp;b=2'));
assert.ok(real.includes('onerror='));
console.log('Nearby photo checks passed');
