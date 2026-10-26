// Home screen order and layout.
const path = require('path');
const { BASE, SHOTS, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [{ id: 'd1', name: 'Mole', verdict: 'want' }] }] });
  await p.route(/wikimedia|overpass|nominatim/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2000);

  const order = await p.$$eval('#home-discovery > [id], #home-discovery > .nearby-home-header', els => els.map(e => e.id || 'nearby'));
  const at = id => order.indexOf(id);
  check(at('home-quick-actions') < at('nearby') && at('nearby') < at('crave-home') && at('crave-home') < at('for-you-home'), `act now, then near you, then your lists (${order.join(' > ')})`);
  check(at('bear-swipe-home') > at('for-you-home') && at('grizzly-home') > at('bear-swipe-home'), 'Bear Swipe and the Grizzly card come after the useful stuff');
  check(order[order.length - 1] === 'today-status-row', 'the stats row sits at the bottom');

  const qa = await p.$$eval('#home-quick-actions .home-quick-btn', bs => bs.filter(b => b.offsetHeight).map(b => b.getBoundingClientRect().top));
  check(qa.length === 3 && new Set(qa.map(Math.round)).size === 1, 'three quick actions in one row on a phone');
  check(await p.locator('#home-quick-actions').evaluate(e => e.offsetHeight) < 130, 'the quick actions stay compact');
  check(await p.locator('#location-banner').isHidden(), 'only one "enable location" ask shows');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.screenshot({ path: path.join(SHOTS, 'home.png') }).catch(() => {});

  // Desktop keeps the wider layout working.
  const d = await newPage(browser, { seed: [], viewport: { width: 1280, height: 900 } });
  await d.goto(`${BASE}/app.html`);
  await d.waitForTimeout(1500);
  check(await d.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop: no sideways scroll');
  await d.context().close();

  await browser.close();
  finish('home');
})();
