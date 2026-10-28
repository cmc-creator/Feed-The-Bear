// Spots with no photo get a labeled dish photo; real photos and unknown cuisines are left alone.
const { BASE, check, launch, newPage, finish } = require('./lib');

const SEED = [
  { id: 'a', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] },
  { id: 'b', name: 'Burger Joint', cuisine: 'Burgers', status: 'visited', myRating: 4, tags: [], visits: [], dishes: [{ id: 'd', name: 'Cheeseburger', verdict: 'again' }] },
  { id: 'c', name: 'Own Photo', cuisine: 'Mexican', status: 'visited', photo: 'https://images.example.com/mine.jpg', tags: [], visits: [], dishes: [] },
  { id: 'e', name: 'Mystery Spot', cuisine: 'Martian', status: 'want-to-try', tags: [], visits: [], dishes: [] },
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim|place-info|wikimedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2500);

  const card = name => p.locator('.restaurant-card', { hasText: name });
  check(await card('Taqueria Uno').locator('.card-photo-stock').count() === 1, 'a spot with no photo gets a dish photo');
  check((await card('Taqueria Uno').locator('.card-stock-tag').innerText()).includes('Typical Mexican'), 'labeled as a typical dish, not the restaurant');
  check((await card('Burger Joint').locator('.card-stock-tag').innerText()).includes('Cheeseburger'), 'a saved dish is used when the library has it');
  check((await card('Burger Joint').locator('.card-stock-tag').innerText()).includes('add yours'), 'visited spots invite your own photo');
  check(await card('Own Photo').locator('.card-photo-stock').count() === 0, 'your own photo is never replaced');
  check(await card('Mystery Spot').locator('.card-photo-empty').count() === 1, 'unknown cuisine keeps the emoji tile');
  const same = await p.evaluate(() => { const r = state.restaurants.find(x => x.id === 'a'); return stockDishPhoto(r).photo.url === stockDishPhoto(r).photo.url; });
  check(same, 'the same spot always gets the same photo');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('stockphoto');
})();
