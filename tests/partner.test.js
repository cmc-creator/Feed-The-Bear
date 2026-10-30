// Book a table / Order delivery on a spot: each opens the right services,
// searching for that restaurant, and taps are counted.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'want-to-try', address: '623 E Adams St, Phoenix, AZ 85004, USA', lat: 33.4492, lng: -112.0653, phone: '(602) 258-8300', tags: [], visits: [] }] });
  await p.route(/wikimedia|overpass|nominatim|place-info/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { window._events = []; const t = window.trackProductEvent; window.trackProductEvent = (n, d) => { window._events.push([n, d]); try { t(n, d); } catch {} }; openDetailModal('r1'); });
  await p.waitForTimeout(300);
  check(await p.locator('#detail-book-btn').isVisible() && await p.locator('#detail-order-btn').isVisible(), 'a spot shows Book a table and Order delivery');

  await p.click('#detail-book-btn');
  const book = await p.$$eval('#partner-links a', as => as.map(a => [a.textContent.trim(), a.href]));
  check(book.some(([t, h]) => /OpenTable/.test(t) && /opentable\.com\/s\?term=Pizzeria%20Bianco&latitude=33\.4492/.test(h)), 'OpenTable searches for this restaurant near its location');
  check(book.some(([t, h]) => /Call them/.test(t) && h === 'tel:6022588300'), 'you can call them when the number is known');
  check(/Book Pizzeria Bianco/.test(await p.locator('#partner-title').innerText()), 'the sheet is titled for the spot');
  await p.evaluate(() => { document.querySelector('#partner-links a[data-partner=opentable]').addEventListener('click', e => e.preventDefault()); });
  await p.click('#partner-links a[data-partner=opentable]');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => window._events.some(([n, d]) => n === 'partner_click' && d.partner === 'opentable')), 'taps are counted (for partner deals)');
  check(await p.locator('#partner-overlay').isHidden() && await p.locator('#detail-overlay').isVisible(), 'the sheet closes back to the spot');

  await p.click('#detail-order-btn');
  const order = await p.$$eval('#partner-links a', as => as.map(a => a.href));
  check(order.some(h => /doordash\.com\/search\/store\/Pizzeria%20Bianco\//.test(h)) && order.some(h => /ubereats\.com\/search\?q=Pizzeria%20Bianco/.test(h)) && order.some(h => /grubhub\.com/.test(h)), 'delivery opens DoorDash, Uber Eats and Grubhub for this spot');
  check(await p.$$eval('#partner-links a', as => as.every(a => a.target === '_blank' && /noopener/.test(a.rel))), 'links open in a new tab safely');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('partner');
})();
