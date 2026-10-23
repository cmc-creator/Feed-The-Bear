// The core foodie flows, end to end in a phone-sized browser.
const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const photo = name => path.join(ROOT, 'assets', 'food', `${name}.jpg`);
const SEED = () => ([
  { id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, isFavorite: true, lat: 33.4918, lng: -111.9242, priceRange: 2, tags: [],
    dateAdded: '2026-09-01', address: '3815 N Brown Ave, Scottsdale, AZ', visits: [{ date: '2026-10-02', rating: 5 }],
    dishes: [{ id: 'a', name: 'Tableside guacamole', verdict: 'again', rating: 5 }, { id: 'b', name: 'Churros', verdict: 'skip', rating: 2 }] },
  { id: 'r2', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', lat: 33.5099, lng: -112.0464, priceRange: 1, tags: [], dateAdded: '2026-09-02', visits: [],
    dishes: [{ id: 'c', name: 'Birria quesatacos', verdict: 'want', rating: 0 }] },
  { id: 'r3', name: 'Nobu Scottsdale', cuisine: 'Japanese', status: 'want-to-try', tags: [], dateAdded: '2026-09-03', visits: [] },
]);

async function legacyDishMigration (browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('ftb_settings_v1', JSON.stringify({ onboardingDone: true, profileSetupDone: true }));
    localStorage.setItem('ftb_restaurants_v2', JSON.stringify([{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], dateAdded: '2026-09-01', updatedAt: 1 }]));
    localStorage.setItem('ftb_dishes_v1', JSON.stringify({ r1: [{ id: 'd1', name: 'Tableside guacamole', rating: 5 }, { id: 'd2', name: 'Churros', rating: 2 }] }));
    localStorage.setItem('ftb_menu_notes_v1', JSON.stringify({ r1: [{ id: 'm1', name: 'Pork shoulder tacos', reaction: 'liked', note: 'get the salsa trio' }, { id: 'm2', name: 'tableside guacamole', reaction: 'liked' }] }));
  });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  const dishes = await p.evaluate(() => state.restaurants[0].dishes.map(d => `${d.name}:${d.verdict}`));
  check(JSON.stringify(dishes) === JSON.stringify(['Tableside guacamole:again', 'Churros:skip', 'Pork shoulder tacos:again']),
    `legacy Dish Tracker + Menu Notes fold into r.dishes once, de-duplicated ${JSON.stringify(dishes)}`);
  await ctx.close();
}

(async () => {
  const browser = await launch();
  await legacyDishMigration(browser);

  // Standing next to Tacos Chiwas, which has a craved dish.
  const p = await newPage(browser, { seed: SEED(), settings: { locationEnabled: true }, geo: { latitude: 33.5096, longitude: -112.0460 } });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(3500);

  // Craving alert
  const alert = (await p.locator('#proximity-alert').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(await p.locator('#proximity-alert').isVisible() && /Birria quesatacos is \d+ ft away/.test(alert), `craving alert shows the nearby dish ("${alert}")`);
  await p.click('#proximity-close').catch(() => {});

  // Home: Crave List and card lines
  check(/Birria quesatacos/.test(await p.locator('#crave-home-list').innerText()), 'Crave List shows want-to-try dishes');
  const cardLines = await p.$$eval('.restaurant-card', cs => cs.map(c => c.querySelector('.card-order')?.innerText || ''));
  check(cardLines.some(t => /GET\s+Tableside guacamole/i.test(t)) && cardLines.some(t => /TRY\s+Birria/i.test(t)), `cards show Get/Try lines ${JSON.stringify(cardLines)}`);

  // Your Order on the restaurant page
  await p.evaluate(() => openDetailModal('r1'));
  await p.waitForTimeout(300);
  check(/ORDER AGAIN/i.test(await p.locator('#your-order-list').innerText()), 'Your Order groups dishes by verdict');
  check(/1×/.test(await p.locator('#detail-my-rating').innerText()) && /Oct 2, 2026/.test(await p.locator('#detail-my-rating').innerText()), 'visits tile shows count and the correct local date');
  await p.fill('#your-order-input', 'churros');
  await p.click('.yo-btn[data-verdict="ok"]');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => state.restaurants[0].dishes.filter(d => /churros/i.test(d.name)).length === 1 && state.restaurants[0].dishes.find(d => /churros/i.test(d.name)).verdict === 'ok'),
    're-logging a dish updates it instead of duplicating');
  const [c1] = await Promise.all([p.waitForEvent('filechooser'), p.click('#your-order-photo')]);
  await c1.setFiles(photo('tacos'));
  await p.waitForTimeout(700);
  await p.fill('#your-order-input', 'Elote');
  await p.click('.yo-btn[data-verdict="again"]');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => !!state.restaurants[0].dishes.find(d => d.name === 'Elote')?.photo), 'Your Order: snap first, name it, dish saved with photo');
  await closeAllDialogs(p);

  // Just Ate with photo, tags, note
  await p.click('#home-quick-justate-btn');
  await p.waitForTimeout(300);
  await p.click('.ja-place[data-id="r3"]');
  const [c2] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await c2.setFiles(photo('sushi'));
  await p.waitForTimeout(700);
  await p.locator('.ja-tag', { hasText: 'Worth the wait' }).click();
  await p.locator('.ja-tag', { hasText: 'Go early' }).click();
  await p.fill('#just-ate-dish', 'Black cod miso');
  await p.click('#just-ate-verdicts .yo-btn[data-verdict="again"]');
  await p.click('#just-ate-save');
  await p.waitForTimeout(400);
  const ja = await p.evaluate(() => {
    const r = state.restaurants.find(x => x.id === 'r3');
    const v = r.visits.at(-1); const d = r.dishes.find(x => x.name === 'Black cod miso');
    return { status: r.status, note: v.note, kb: Math.round((v.photo || '').length / 1024), dishPhoto: !!d?.photo, cover: !!r.photo, verdict: d?.verdict, today: v.date === iso() };
  });
  check(ja.status === 'visited' && ja.verdict === 'again' && ja.today, `Just Ate logs a visit and dish ${JSON.stringify(ja)}`);
  check(ja.note === 'Worth the wait · Go early', 'Just Ate tags build the note');
  check(ja.dishPhoto && ja.cover && ja.kb > 5 && ja.kb < 160, `Just Ate photo saved compact on dish and as cover (${ja.kb} KB)`);
  await p.waitForTimeout(2300);

  // Just Ate: new spot by typing; exact name reuses the spot
  await p.click('#home-quick-justate-btn');
  await p.fill('#just-ate-place', 'Pho Cao');
  await p.click('#just-ate-save');
  await p.waitForTimeout(300);
  await p.click('#home-quick-justate-btn');
  await p.fill('#just-ate-place', 'the mission');
  await p.click('#just-ate-save');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => state.restaurants.some(r => r.name === 'Pho Cao' && r.status === 'visited') && state.restaurants.filter(r => /mission/i.test(r.name)).length === 1),
    'Just Ate creates new spots and reuses exact-name matches');

  // Search by dish
  await p.fill('#search-input', 'cod');
  await p.waitForTimeout(300);
  const hits = await p.$$eval('.restaurant-card', cs => cs.map(c => c.querySelector('.card-name').innerText));
  check(hits.length === 1 && hits[0] === 'Nobu Scottsdale', `dish search finds the spot ${JSON.stringify(hits)}`);
  await p.fill('#search-input', '');

  // Editing keeps fields the form doesn't cover
  await p.evaluate(() => openEditModal('r1'));
  await p.waitForTimeout(300);
  await p.fill('#form-notes', 'edited');
  await p.click('#modal-save-btn');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => { const r = state.restaurants.find(x => x.id === 'r1'); return r.isFavorite && r.dishes.length >= 3 && r.notes === 'edited'; }), 'editing a spot keeps dishes and favorite');

  // Share text recommends only real winners
  const share = await p.evaluate(() => buildOrderShareText(state.restaurants.find(x => x.id === 'r1')));
  check(/Get: Tableside guacamole, Elote/.test(share) && !/Get:.*Churros/.test(share), 'share text lists Order again dishes only');

  // Decision Mode explains dish-based picks
  await closeAllDialogs(p);
  await p.evaluate(() => { openDecisionMode(); setDecisionModeConstraint('miles', 25); });
  await p.click('#decision-mode-run-btn');
  await p.waitForTimeout(300);
  const why = await p.$$eval('.decision-result-why', es => es.map(e => e.innerText).join(' | '));
  check(/go-to: Tableside guacamole|wanting the Birria/.test(why), `Decision Mode gives dish reasons (${why})`);
  await closeAllDialogs(p);

  // Gallery includes dish and visit photos
  await p.evaluate(() => openGallery());
  await p.waitForTimeout(300);
  const caps = await p.$$eval('.gallery-item-name', es => es.map(e => e.innerText));
  check(caps.some(c => /Black cod miso · Nobu/.test(c)) && caps.some(c => /Elote · The Mission/.test(c)), `gallery shows dish photos ${JSON.stringify(caps)}`);
  await closeAllDialogs(p);

  // Craving alert does not repeat the same day
  await p.reload();
  await p.waitForTimeout(3000);
  check(!(await p.locator('#proximity-alert').isVisible() && /Birria/.test(await p.locator('#proximity-alert').innerText())), 'craving alert does not repeat the same day');

  // Dates are local calendar dates
  check(await p.evaluate(() => { const d = new Date(); return iso() === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }), 'iso() is the local date');
  check(await p.evaluate(() => fmtDate('2026-10-02') === 'Oct 2, 2026'), 'fmtDate shows YYYY-MM-DD without shifting a day');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('flows');
})();
