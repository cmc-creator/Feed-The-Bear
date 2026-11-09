// Map tags from Discover ("steak_house", "regional") never show raw on cards, friend lists or public pages.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const seed = [
    { id: 'a', name: 'LongHorn Steakhouse', cuisine: 'steak_house', status: 'visited', myRating: 4, tags: [], visits: [] },
    { id: 'b', name: 'State 48 Brewery', cuisine: 'regional', status: 'visited', myRating: 5, tags: [], visits: [] },
    { id: 'c', name: 'Rio Mirage', cuisine: 'mexican;pizza', status: 'visited', myRating: 4, tags: [], visits: [] },
    { id: 'd', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [] },
  ];
  const p = await newPage(browser, { seed });
  await p.route('**/api/**', r => r.fulfill({ json: {} }));
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  const c = await p.evaluate(() => Object.fromEntries(state.restaurants.map(r => [r.id, r.cuisine])));
  check(c.a === 'Steakhouse' && c.b === '' && c.c === 'Mexican' && c.d === 'Mexican', `saved cuisines read like words (${JSON.stringify(c)})`);
  check(await p.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)).find(r => r.id === 'a').cuisine === 'Steakhouse'), 'and stay tidy once saved');
  check(!/steak_house|regional/.test(await p.locator('body').innerText()), 'no raw tag shows anywhere on screen');
  check(await p.evaluate(() => cuisineEmoji('Steakhouse') === '🥩'), 'steakhouses get a steak, not a plate');
  const friend = await p.evaluate(() => sanitizeFriendData({ id: 'x', u: 'Jo', picks: [{ n: 'Old Spot', c: 'steak_house', r: 5 }, { n: 'Brew', c: 'regional', r: 4 }] }).picks.map(x => x.c));
  check(friend[0] === 'Steakhouse' && friend[1] === '', `friends' spots are tidied too (${friend})`);
  await browser.close();
  finish('cuisinetidy');
})();
