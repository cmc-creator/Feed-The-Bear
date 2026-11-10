// Editing a spot: typing its name searches real places, and picking one
// links the spot to it (address, location, ratings, fresh hours).
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    { id: 'b', name: 'Bacanora PHX', cuisine: '', status: 'want-to-try', tags: [], visits: [], dishes: [],
      address: 'Somewhere wrong', lat: 40, lng: -100, placeId: 'old', mapsUrl: 'https://maps.example/old', hours: ['Mon: Closed'], placeInfoAt: Date.now() },
    { id: 'k', name: 'Kai', cuisine: 'Fine Dining', status: 'want-to-try', tags: [], visits: [], dishes: [], address: 'Chandler', lat: 33.27, lng: -111.97 },
  ] });
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.route('**/api/place-info?mode=search**', r => r.fulfill({ json: { places: [
    { placeId: 'g1', name: 'Bacanora', address: '1301 Grand Ave, Phoenix', lat: 33.46, lng: -112.09, kind: 'Mexican Restaurant', rating: 4.6, reviews: 800, priceLevel: 2 }] } }));
  let lookups = 0;
  await p.route('**/api/place-info?name=**', r => { lookups++; r.fulfill({ json: { found: true, placeId: 'g1', hours: ['Monday: 5 – 10 PM'], mapsUrl: 'https://maps.google.com/?cid=1' } }); });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);

  // The dark default stays readable at every hour; system matching is opt-in.
  const looks = await p.evaluate(() => [8, 13, 19, 23].map(h => getAutoThemePresetByHour(h).accent));
  check(JSON.stringify(looks) === '["midnight","midnight","midnight","midnight"]', `default themes stay dark (${looks})`);

  await p.evaluate(() => openEditModal('b'));
  check(await p.locator('#form-collection-group').isHidden(), 'no "add to a list" question when you have no lists');
  await p.evaluate(() => { state.settings.collections = [{ id: 'c1', name: 'Date night', restaurantIds: [] }]; populateFormCollections(); });
  check(await p.locator('#form-collection-group').isVisible() && (await p.locator('#form-collection option').first().innerText()) === 'No, just save it', 'with a list, it asks plainly');
  await p.evaluate(() => { state.settings.collections = []; populateFormCollections(); });
  await p.fill('#form-name', 'Bacanora');
  await p.waitForSelector('#form-name-suggs:not(.hidden) .qa-sugg', { timeout: 4000 }).catch(() => {});
  check(/Bacanora.*1301 Grand Ave/s.test(await p.locator('#form-name-suggs').innerText().catch(() => '')), 'typing the name in Edit shows real places');
  await p.click('#form-name-suggs .qa-sugg');
  check(await p.inputValue('#form-address') === '1301 Grand Ave, Phoenix', 'picking one fills the address');
  check(await p.inputValue('#form-cuisine') === 'Mexican', 'and the cuisine');
  check(await p.locator('#form-name-suggs').isHidden(), 'and the list closes');
  await p.click('#modal-save-btn');
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => state.restaurants.find(x => x.id === 'b'));
  check(r.lat === 33.46 && r.lng === -112.09 && r.address === '1301 Grand Ave, Phoenix', `the spot moves to the real place (${r.lat},${r.lng})`);
  check(r.googleRating === 4.6 && r.googleReviews === 800, 'with its Google rating');
  check(lookups === 1 && r.placeId === 'g1' && r.mapsUrl === 'https://maps.google.com/?cid=1' && r.hours[0] === 'Monday: 5 – 10 PM', 'old hours and Maps link are replaced with the new place\'s');

  // Renaming without picking keeps where it is.
  await p.evaluate(() => openEditModal('k'));
  await p.fill('#form-name', 'Kai Restaurant');
  await p.press('#form-name', 'Enter');
  await p.waitForTimeout(600);
  const k = await p.evaluate(() => state.restaurants.find(x => x.id === 'k'));
  check(k.name === 'Kai Restaurant' && k.lat === 33.27 && k.lng === -111.97, 'a plain rename keeps the location');
  check(await p.locator('#form-name-suggs').isHidden(), 'no stray results after the form closes');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  // Want to Try spots get the restaurant's own photo.
  const q = await newPage(browser, { seed: [
    { id: 'w', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], lat: 33.465, lng: -112.04 },
  ] });
  await q.route(/overpass|nominatim|open-meteo|place-info|wikipedia/, r => r.abort());
  await q.route('**/api/restaurant-image?**', r => r.fulfill({ json: { found: true, photoUrl: 'https://lh3.googleusercontent.com/place-photo-1' } }));
  await q.route('**/lh3.googleusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  await q.goto(`${BASE}/app.html`);
  await q.waitForTimeout(1500);
  await closeAllDialogs(q);
  await q.evaluate(() => setView('want-to-try'));
  await q.waitForTimeout(1200);
  check(await q.locator('.restaurant-card[data-id="w"] .card-photo img[src*="place-photo-1"]').count() === 1, 'a Want to Try card shows the restaurant\'s photo');
  check(await q.evaluate(() => state.restaurants[0].placePhoto) === 'https://lh3.googleusercontent.com/place-photo-1', 'and keeps it on the spot');
  check(!q.errors.length, `no page errors ${q.errors.join(' | ')}`);

  // Is this the right place? A spot pinned somewhere else gets asked; one at the right spot doesn't.
  const c = await newPage(browser, { seed: [
    { id: 'x', name: 'Bacanora', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], address: 'Wrong St', lat: 40, lng: -100, placeInfoAt: Date.now() },
    { id: 'y', name: 'Bacanora Too', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], address: '1301 Grand Ave', lat: 33.4601, lng: -112.0901, placeInfoAt: Date.now() },
  ] });
  await c.route(/overpass|nominatim|open-meteo|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await c.route('**/api/place-info?mode=search**', r => r.fulfill({ json: { places: [
    { placeId: 'g1', name: 'Bacanora', address: '1301 Grand Ave, Phoenix', lat: 33.46, lng: -112.09, kind: 'Mexican Restaurant', rating: 4.6, reviews: 800, priceLevel: 2 }] } }));
  await c.route('**/api/place-info?name=**', r => r.fulfill({ json: { found: true, placeId: 'g1', hours: ['Monday: 5 – 10 PM'] } }));
  await c.goto(`${BASE}/app.html`);
  await c.waitForTimeout(1500);
  await closeAllDialogs(c);
  await c.evaluate(() => Promise.all(state.restaurants.map(r => checkSpotPlace(r))).then(() => renderCards()));
  const flags = await c.evaluate(() => state.restaurants.map(r => [r.id, !!r.placeSuggest, !!r.placeChecked]));
  check(JSON.stringify(flags) === '[["x",true,false],["y",false,true]]', `the wrongly pinned spot is flagged, the right one is confirmed (${JSON.stringify(flags)})`);
  check(await c.locator('.restaurant-card[data-id="x"] .card-place-check').count() === 1, 'its card asks "Right place?"');
  await c.evaluate(() => openDetailModal('x'));
  await c.waitForTimeout(400);
  check(/Is this the right place\?.*1301 Grand Ave/s.test(await c.locator('#detail-location').innerText()), "the spot's page shows the suggestion");
  await c.click('.dl-check-yes');
  await c.waitForTimeout(600);
  const x = await c.evaluate(() => state.restaurants.find(r => r.id === 'x'));
  check(x.lat === 33.46 && x.address === '1301 Grand Ave, Phoenix' && x.placeId === 'g1' && x.placeChecked && !x.placeSuggest, 'Yes links it to the real place');
  check(await c.locator('#detail-location .dl-check').isHidden(), 'and the question goes away');
  check(!c.errors.length, `no page errors ${c.errors.join(' | ')}`);

  // What to order: Grizzly gets dishes Google reviewers recommend, only ones really in the reviews.
  const o = await newPage(browser, { grizzly: true, seed: [
    { id: 'o', name: 'Bacanora', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], placeId: 'ChIJbacanora123', lat: 33.46, lng: -112.09, placeInfoAt: Date.now(), placeChecked: true },
  ] });
  await o.route(/overpass|nominatim|open-meteo|restaurant-image|place-photo|wikipedia/, r => r.abort());
  let reviewCalls = 0;
  await o.route('**/api/place-info?mode=reviews**', r => { reviewCalls++; r.fulfill({ json: { reviews: [
    { rating: 5, text: 'The carne asada is unreal. Get the carne asada and the tortillas.' },
    { rating: 5, text: 'Carne asada was perfect, and the elote too.' },
    { rating: 4, text: 'Loved the elote.' }] } }); });
  await o.goto(`${BASE}/app.html`);
  await o.waitForTimeout(1500);
  await closeAllDialogs(o);
  await o.evaluate(() => { AI.call = async () => '["Carne asada", "Elote", "Lobster thermidor"]'; });
  await o.evaluate(() => openDetailModal('o'));
  await o.waitForTimeout(800);
  const bet = (await o.locator('#yo-best-bet').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(/BEST BET Carne asada 2 reviews/i.test(bet) && /Also good: Elote/.test(bet), `Best bet names what reviewers recommend (${bet})`);
  check(!/thermidor/i.test(bet), "a dish the reviews don't mention is dropped");
  await closeAllDialogs(o);
  await o.evaluate(() => openDetailModal('o'));
  await o.waitForTimeout(400);
  check(reviewCalls === 1, 'reviews are looked up once, then kept on the spot');
  check(!o.errors.length, `no page errors ${o.errors.join(' | ')}`);
  await browser.close();
  finish('editlink');
})();
