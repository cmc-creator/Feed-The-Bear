// Google rating, price, hours and "open now" on saved spots (Google Places is faked here).
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const SEED = [
  { id: 'r1', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'want-to-try', address: '1 Main St', lat: 33.49, lng: -111.92, tags: [], dishes: [], visits: [] },
  { id: 'r2', name: 'Nowhere Diner', cuisine: 'American', status: 'want-to-try', tags: [], dishes: [], visits: [] },
];
// Open 11 AM - 10 PM every day.
const PERIODS = [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: { day, hour: 11, minute: 0 }, close: { day, hour: 22, minute: 0 } }));
const INFO = {
  found: true, placeId: 'abc', name: 'Taqueria Uno', rating: 4.6, reviews: 1234, priceLevel: 2,
  hours: ['Monday: 11:00 AM – 10:00 PM', 'Tuesday: 11:00 AM – 10:00 PM', 'Wednesday: 11:00 AM – 10:00 PM', 'Thursday: 11:00 AM – 10:00 PM', 'Friday: 11:00 AM – 10:00 PM', 'Saturday: 11:00 AM – 10:00 PM', 'Sunday: 11:00 AM – 10:00 PM'],
  periods: PERIODS, phone: '(480) 555-0100', website: 'https://taqueria.example', mapsUrl: 'https://maps.google.com/?cid=1',
};

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  const asked = [];
  await p.route(/overpass|nominatim/, r => r.abort());
  await p.route(/\/api\/place-info/, r => {
    const url = new URL(r.request().url());
    asked.push(url.searchParams.get('name'));
    const body = url.searchParams.get('name') === 'Taqueria Uno' ? INFO : { found: false };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);

  // Open / closed math (day 0 = Sunday).
  const st = await p.evaluate(periods => {
    const r = { periods };
    const at = (d, h, m) => openStatus(r, new Date(2026, 9, 25 + d, h, m)); // Oct 25 2026 is a Sunday
    return { lunch: at(1, 12, 0), late: at(1, 21, 30), early: at(1, 9, 0), night: at(1, 23, 0), none: openStatus({}) };
  }, PERIODS);
  check(st.lunch.open && st.lunch.text === 'Open · closes 10 PM', `open at lunch (${st.lunch.text})`);
  check(st.late.open && st.late.soon, `closes soon at 9:30 PM (${st.late.text})`);
  check(!st.early.open && st.early.text === 'Closed · opens 11 AM', `closed in the morning (${st.early.text})`);
  check(!st.night.open && st.night.text === 'Closed · opens tomorrow 11 AM', `closed at night (${st.night.text})`);
  check(st.none === null, 'no hours, no claim');
  const overnight = await p.evaluate(() => openStatus({ periods: [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }] }, new Date(2026, 9, 31, 1, 0)));
  check(overnight.open, 'a bar open past midnight is still open at 1 AM');

  // Opening the spot looks it up and fills the page.
  await p.evaluate(() => openDetailModal('r1'));
  await p.waitForTimeout(800);
  check((await p.locator('#detail-google-rating').innerText()).includes('4.6'), 'detail shows the Google rating');
  check((await p.locator('#detail-google-rating').innerText()).includes('1,234'), 'and the review count');
  check((await p.locator('#detail-price').innerText()).includes('$$'), 'price filled from Google');
  check(await p.locator('#detail-hours details li').count() === 7, 'a full week of hours');
  check(await p.locator('#detail-hours a[href^="tel:"]').count() === 1, 'tap to call');
  const saved = await p.evaluate(() => state.restaurants.find(r => r.id === 'r1'));
  check(saved.placeInfoAt > 0 && saved.periods.length === 7 && saved.website === 'https://taqueria.example', 'the info is saved on the spot');
  await closeAllDialogs(p);

  // Cached for a week: reopening doesn't ask Google again.
  const before = asked.length;
  await p.evaluate(() => openDetailModal('r1'));
  await p.waitForTimeout(500);
  check(asked.length === before, 'no repeat lookup within a week');
  await closeAllDialogs(p);

  // No match: honest "Not available", no fake hours.
  await p.evaluate(() => openDetailModal('r2'));
  await p.waitForTimeout(800);
  check((await p.locator('#detail-google-rating').innerText()).includes('Not available'), 'unmatched spot says Not available');
  check(await p.locator('#detail-hours').isHidden(), 'and shows no hours');
  await closeAllDialogs(p);

  // Cards show open status.
  await p.evaluate(() => renderCards());
  check(await p.locator('.card-highlight.open-now, .card-highlight.open-soon, .card-highlight.closed-now').count() === 1, 'the card shows open or closed');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('placeinfo');
})();
