// Scan the menu: Grizzly snaps a menu photo, Byte Cub picks dishes for their
// taste (only dishes on that menu), and a pick goes on the Crave List in one tap.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const seed = [
  { id: 'm', name: 'Bacanora', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] },
  { id: 'p', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [{ id: 'd1', name: 'Rosa pizza', verdict: 'again' }, { id: 'd2', name: 'Caesar salad', verdict: 'skip' }] },
];

(async () => {
  const browser = await launch();

  // Free accounts see what it does and the upgrade.
  const f = await newPage(browser, { seed, grizzly: false });
  await f.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await f.goto(`${BASE}/app.html`);
  await f.waitForTimeout(1500);
  await closeAllDialogs(f);
  await f.evaluate(() => { window._ftbUid = 'freeUser000001'; window._ftbPlan = 'free'; openDetailModal('m'); });
  await f.click('#menu-scan-btn');
  await f.waitForSelector('#upgrade-overlay:not(.hidden)', { timeout: 3000 }).catch(() => {});
  check((await f.locator('#upgrade-title').innerText().catch(() => '')).trim() === 'Snap the menu, get your order', 'free accounts get the menu-scan pitch');
  await f.context().close();

  // Grizzly.
  const p = await newPage(browser, { seed, grizzly: true });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  await p.evaluate(() => {
    window._asked = '';
    AI.callVision = async (prompt, data, mime) => { window._asked = prompt; window._img = { len: data.length, mime }; return '```json\n{"picks":[{"dish":"Carne Asada","why":"You love a grilled, smoky plate"},{"dish":"Elote","why":"Easy to share"}],"skip":[{"dish":"House salad","why":"You skip salads"}]}\n```'; };
    openDetailModal('m');
  });
  check(await p.locator('.menu-scan-badge').isHidden(), 'members don\'t see the GRIZZLY badge');
  await p.setInputFiles('#menu-scan-file', { name: 'menu.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('.menu-scan-pick', { timeout: 5000 }).catch(() => {});
  const asked = await p.evaluate(() => ({ prompt: window._asked, img: window._img }));
  check(/menu at Bacanora/.test(asked.prompt) && /order again: Rosa pizza/.test(asked.prompt) && /didn't like: Caesar salad/.test(asked.prompt), 'Byte Cub gets the photo with their taste');
  check(asked.img?.mime === 'image/jpeg' && asked.img.len > 0, 'the photo is sent as a small JPEG');
  const result = await p.locator('#menu-scan-result').innerText();
  check(/Carne Asada/.test(result) && /grilled, smoky/.test(result) && /Maybe skip: House salad/.test(result), `picks show with reasons, and what to skip (${result.replace(/\s+/g, ' ').slice(0, 80)})`);
  await p.click('.menu-scan-add[data-i="0"]');
  const dish = await p.evaluate(() => state.restaurants.find(r => r.id === 'm').dishes.find(d => d.name === 'Carne Asada'));
  check(dish?.verdict === 'want', 'one tap puts a pick on the Crave List');

  // A photo that isn't a menu.
  await p.evaluate(() => { AI.callVision = async () => '{"error":"not a menu"}'; });
  await p.setInputFiles('#menu-scan-file', { name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForTimeout(600);
  check(/doesn't look like a menu/.test(await p.locator('#menu-scan-result').innerText()), 'a photo that isn\'t a menu says so');

  // Another spot starts clean.
  await p.evaluate(() => openDetailModal('p'));
  check(await p.locator('#menu-scan-result').isHidden(), 'opening another spot clears the scan');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('menuscan');
})();
