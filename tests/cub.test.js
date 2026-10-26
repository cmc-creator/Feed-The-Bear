// Quick Add with the cub, and the cub buddy.
const path = require('path');
const { BASE, ROOT, SHOTS, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const NEARBY = [
  { id: 1, lat: 33.4918, lon: -111.9242, _dist: 180, tags: { name: 'Taqueria El Sol', amenity: 'restaurant', 'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'Scottsdale' } },
  { id: 2, lat: 33.4930, lon: -111.9250, _dist: 320, tags: { name: 'Ramen Ya', amenity: 'restaurant', cuisine: 'ramen;japanese' } },
  { id: 3, lat: 33.4940, lon: -111.9260, _dist: 450, tags: { name: 'The Mission', amenity: 'restaurant', cuisine: 'mexican' } },
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [] }] });
  // No real Nominatim calls from tests.
  await p.route(/nominatim\.openstreetmap\.org/, route => route.fulfill({ json: [] }));
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(n => { _homeDiscCache = { elements: n, lat: 33.49, lng: -111.92 }; }, NEARBY);

  // Buddy
  check(await p.locator('#cub-buddy .cub-btn').isVisible(), 'the cub buddy is on screen');
  await p.click('#cub-buddy .cub-btn');
  const actions = await p.$$eval('#cub-buddy .cub-menu button', bs => bs.map(b => b.textContent.trim()));
  check(actions.includes('Add a spot') && actions.includes('I just ate') && actions.includes('Pick for me'), `tapping the cub shows quick actions (${actions.join(', ')})`);

  // Quick add: nearby suggestions, pick one, "Want to try" with a crave dish
  await p.locator('#cub-buddy .cub-menu [data-act="add"]').click();
  await p.waitForSelector('#quick-add-overlay:not(.hidden)');
  const suggs = await p.$$eval('.qa-sugg strong', s => s.map(x => x.textContent));
  check(suggs.includes('Taqueria El Sol') && suggs.includes('Ramen Ya'), `shows nearby places to pick (${suggs.join(', ')})`);
  await p.locator('#quick-add-overlay .modal-card').screenshot({ path: path.join(SHOTS, 'qa-1.png') }).catch(() => {});
  await p.fill('.qa-input', 'taq');
  await p.waitForTimeout(200);
  check(JSON.stringify(await p.$$eval('.qa-sugg:not(.qa-sugg-new) strong', s => s.map(x => x.textContent))) === '["Taqueria El Sol"]', 'typing filters the suggestions');
  await p.locator('.qa-sugg', { hasText: 'Taqueria El Sol' }).click();
  check(await p.inputValue('.qa-cuisine') === 'Mexican', 'the cub guesses Mexican from "Taqueria"');
  check(/12 Main St, Scottsdale/.test(await p.locator('.qa-place-meta').innerText()), 'address comes from the place data');
  check(await p.locator('.qa-save').isDisabled(), 'save waits for Been there / Want to try');
  await p.click('.qa-status[data-status="want-to-try"]');
  await p.fill('.qa-dish', 'Birria tacos');
  await p.locator('#quick-add-overlay .modal-card').screenshot({ path: path.join(SHOTS, 'qa-2.png') }).catch(() => {});
  await p.click('.qa-save');
  await p.waitForTimeout(400);
  const saved = await p.evaluate(() => { const r = state.restaurants.find(x => x.name === 'Taqueria El Sol'); return r && { status: r.status, cuisine: r.cuisine, lat: r.lat, dish: (r.dishes || [])[0] }; });
  check(saved && saved.status === 'want-to-try' && saved.cuisine === 'Mexican' && saved.lat === 33.4918, `saved with cuisine and location (${JSON.stringify(saved)})`);
  check(saved?.dish?.name === 'Birria tacos' && saved.dish.verdict === 'want', 'the must-try dish lands on the Crave List');

  // Been there with stars, typed name, photo
  await p.evaluate(() => Cub.openAdd());
  await p.fill('.qa-input', 'Pho Hoa');
  await p.waitForTimeout(150);
  await p.locator('.qa-sugg-new').click();
  check(await p.inputValue('.qa-cuisine') === 'Vietnamese', 'a typed name gets a cuisine guess ("Pho" → Vietnamese)');
  await p.click('.qa-status[data-status="visited"]');
  await p.click('.qa-star[data-n="5"]');
  check(/Five stars/.test(await p.locator('.qa-say').innerText()), 'the cub reacts to the rating');
  await p.fill('.qa-dish', 'Rare beef pho');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.qa-photo')]);
  await chooser.setFiles(path.join(ROOT, 'assets', 'food', 'pho.jpg'));
  await p.waitForTimeout(700);
  await p.click('.qa-save');
  await p.waitForTimeout(400);
  const been = await p.evaluate(() => { const r = state.restaurants.find(x => x.name === 'Pho Hoa'); return r && { status: r.status, myRating: r.myRating, visits: r.visits.length, photo: !!r.photo, dish: r.dishes?.[0]?.verdict }; });
  check(been && been.status === 'visited' && been.myRating === 5 && been.visits === 1 && been.photo && been.dish === 'again', `"Been there" saves rating, visit, photo, and dish (${JSON.stringify(been)})`);
  await p.waitForTimeout(2200);

  // Duplicates open the existing spot
  await p.evaluate(() => Cub.openAdd());
  await p.locator('.qa-sugg', { hasText: 'The Mission' }).click();
  check(/already in your den/i.test(await p.locator('.qa-say').innerText()), 'a duplicate is caught');
  await p.waitForTimeout(1200);
  check(await p.locator('#detail-overlay').isVisible(), 'and the existing spot opens');
  await closeAllDialogs(p);

  // Maps link, and "More details" hands off to the full form
  await p.evaluate(() => Cub.openAdd());
  await p.fill('.qa-input', 'https://www.google.com/maps/place/Pizzeria+Bianco/@33.449174,-112.0656515,17z');
  await p.waitForTimeout(200);
  check(await p.locator('.qa-place-name').innerText() === 'Pizzeria Bianco' && await p.inputValue('.qa-cuisine') === 'Italian', 'a Google Maps link fills the name and a cuisine guess');
  await p.click('.qa-more');
  await p.waitForTimeout(300);
  check(await p.inputValue('#form-name') === 'Pizzeria Bianco', '"More details" opens the full form, pre-filled');
  await closeAllDialogs(p);

  // AI fill is a Grizzly pitch for free users
  await p.evaluate(() => Cub.openAdd());
  await p.fill('.qa-input', 'Some Place');
  await p.keyboard.press('Enter');
  await p.click('.qa-ai');
  await p.waitForSelector('#upgrade-overlay:not(.hidden)', { timeout: 3000 }).catch(() => {});
  check((await p.locator('#upgrade-title').innerText().catch(() => '')) === 'Let the cub do the typing', 'AI fill pitches Grizzly to free users');
  await closeAllDialogs(p);

  // Header + and mobile + open Quick Add
  await p.click('#mobile-add-btn');
  check(await p.locator('#quick-add-overlay').isVisible(), 'the + button opens Quick Add');
  await closeAllDialogs(p);

  // Tip and hide
  await p.evaluate(() => { sessionStorage.removeItem('ftb_cub_tip_session'); Cub.tip(); });
  const tip = await p.locator('#cub-buddy .cub-bubble-text').innerText();
  check(/What did you order at/.test(tip), `the cub offers a relevant tip ("${tip}")`);
  await p.click('#cub-buddy .cub-btn');
  await p.locator('[data-act="hide"]').click();
  check(await p.locator('#cub-buddy').count() === 0, '"Hide the cub" hides it');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('cub');
})();
