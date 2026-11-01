// My Lists: Want to Try and Been There are easy to find and open from the
// bottom bar and the counts at the top; cards carry photos, notes and links;
// Just Ate finds the real restaurant and takes a star rating.
const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const spot = (id, name, extra) => ({ id, name, cuisine: 'Mexican', tags: [], visits: [], dishes: [], ...extra });

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    spot('w1', 'Pizzeria Bianco', { status: 'want-to-try', cuisine: 'Pizza', notes: 'Saw it on TikTok, get the Rosa',
      links: [{ url: 'https://www.tiktok.com/@foodie/video/123' }] }),
    spot('v1', 'Tacos Chiwas', { status: 'visited', myRating: 5,
      visits: [{ date: '2026-10-20', rating: 5, photo: 'assets/food/tacos.jpg' }], dishes: [{ id: 'd', name: 'Birria', verdict: 'again', photo: 'assets/food/burrito.jpg' }] }),
  ] });
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.route('**/api/place-info?mode=search**', r => r.fulfill({ json: { places: [
    { placeId: 'g1', name: 'Bacanora', address: '1301 Grand Ave, Phoenix', lat: 33.46, lng: -112.09, kind: 'Mexican Restaurant', rating: 4.6, reviews: 800, priceLevel: 2 }] } }));
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1800);
  await closeAllDialogs(p);

  // The count at the top opens the list itself, at the top of the screen.
  await p.click('.stat-item[data-view-filter="want-to-try"]');
  await p.waitForTimeout(400);
  check(await p.locator('#list-header').isVisible(), 'tapping Want to Try opens My Lists');
  check(!(await p.locator('#home-discovery').isVisible()), 'home cards step aside');
  const names = await p.$$eval('.restaurant-card .card-name', es => es.map(e => e.textContent));
  check(names.join() === 'Pizzeria Bianco', `only Want to Try places show (${names})`);
  const top = await p.locator('#list-header').boundingBox();
  check(top && top.y < 400, `the tabs are right there on screen (y=${top && Math.round(top.y)})`);
  check(/Saw it on TikTok/.test(await p.locator('.restaurant-card').first().innerText()), 'the card shows your note');
  check(await p.locator('.restaurant-card .link-chip', { hasText: 'TikTok' }).count() === 1, 'and the TikTok link');

  // Tabs switch lists; counts are on them.
  check((await p.locator('.list-tab[data-list="visited"] .list-tab-count').innerText()) === '1', 'Been There shows its count');
  await p.click('.list-tab[data-list="visited"]');
  await p.waitForTimeout(300);
  check((await p.$$eval('.restaurant-card .card-name', es => es.map(e => e.textContent))).join() === 'Tacos Chiwas', 'Been There lists places you have been');
  check(await p.locator('.restaurant-card .card-media-strip .cms-item').count() === 2, 'with your photos on the card');

  // The bottom bar has Lists, and it remembers the last tab.
  await p.click('.mobile-nav-btn[data-view="all"]');
  await p.waitForTimeout(300);
  check(await p.locator('#home-discovery').isVisible(), 'Home is home again');
  await p.click('.mobile-nav-btn[data-view="lists"]');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => state.currentView) === 'visited' && await p.locator('.mobile-nav-btn[data-view="lists"]').evaluate(e => e.classList.contains('active')), 'Lists opens on the last tab and lights up');

  // Links on a spot.
  await p.evaluate(() => openDetailModal('v1'));
  await p.waitForTimeout(300);
  await p.fill('#detail-link-input', 'https://www.instagram.com/p/abc/');
  await p.click('#detail-link-add-btn');
  check(/Instagram/.test(await p.locator('#detail-links-list').innerText()), 'you can add an Instagram link to a spot');
  check(await p.evaluate(() => state.restaurants.find(r => r.id === 'v1').links.length) === 1, 'and it is saved');
  await closeAllDialogs(p);

  // Just Ate: finds the real restaurant, takes a rating, lands on Been There.
  await p.evaluate(() => openJustAte());
  await p.fill('#just-ate-place', 'bacan');
  await p.waitForSelector('.ja-place-real', { timeout: 4000 }).catch(() => {});
  check(/Bacanora.*4\.6.*1301 Grand Ave/s.test(await p.locator('.ja-place-real').first().innerText().catch(() => '')), 'Just Ate searches real restaurants');
  await p.locator('.ja-place-real').first().click();
  await p.click('#just-ate-stars .ja-star[data-n="4"]');
  check(await p.locator('#just-ate-stars .ja-star.on').count() === 4, 'you can rate it');
  await p.fill('#just-ate-link', 'https://www.tiktok.com/@x/video/9');
  await p.click('#just-ate-save');
  await p.waitForTimeout(500);
  const saved = await p.evaluate(() => { const r = state.restaurants.find(x => x.name === 'Bacanora'); return r && { s: r.status, my: r.myRating, g: r.googleRating, addr: r.address, cuisine: r.cuisine, links: (r.links || []).length, visit: r.visits[0]?.rating }; });
  check(saved && saved.s === 'visited' && saved.my === 4 && saved.visit === 4, `rated and on Been There (${JSON.stringify(saved)})`);
  check(saved && saved.g === 4.6 && saved.addr === '1301 Grand Ave, Phoenix' && saved.cuisine === 'Mexican' && saved.links === 1, 'with the real address, cuisine, Google rating and link');
  check(/on your Been There list/.test(await p.locator('#toast-container').innerText()), 'and it says where it went');

  // Empty lists explain themselves.
  await p.evaluate(() => { state.restaurants = state.restaurants.filter(r => r.status !== 'want-to-try'); setView('want-to-try'); });
  check(/Nothing on your Want to Try list yet/.test(await p.locator('#restaurant-grid').innerText()), 'an empty list says what goes there');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('mylists');
})();
