// Play lists eating contests and food challenges across the US
// (api/food-events.js), your state first. Also: a website update never
// reloads the page under you (that sent a shared spot's Add form to Home).
const fs = require('fs');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');
const { cleanEvents, parseArray } = require('../api/food-events');

(async () => {
  // Server: only real, upcoming, well-formed events, soonest first.
  const got = cleanEvents([
    { name: 'Wing Bowl', kind: 'contest', date: '2026-12-01', city: 'Philadelphia', state: 'pa', url: 'https://x.test/w' },
    { name: 'Old Pie Off', kind: 'contest', date: '2026-01-01', city: 'Austin', state: 'TX' },
    { name: 'Taco Fest', kind: 'festival', date: '2026-11-20', city: 'Phoenix', state: 'AZ', url: 'javascript:alert(1)' },
    { name: 'Wing Bowl', kind: 'contest', date: '2026-12-01', city: 'Philadelphia', state: 'PA' },
    { name: 'No State', kind: 'contest', date: '2026-12-05', city: 'Somewhere', state: '' },
    { name: 'Bad date', kind: 'contest', date: 'soon', city: 'Reno', state: 'NV' },
  ], '2026-11-05');
  check(got.map(e => e.name).join(',') === 'Taco Fest,Wing Bowl', `past, duplicate, stateless and undated events are dropped (${got.map(e => e.name)})`);
  check(got[0].url === '' && got[1].state === 'PA', 'bad links are removed and states are normalized');
  check(parseArray('Here you go:\n```json\n[{"name":"A"}]\n```').length === 1 && parseArray('nothing').length === 0, 'the JSON list is read out of the answer');

  // No reload when the service worker updates.
  const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
  check(!/location\.reload\(/.test(html), 'a website update never reloads the open page');

  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 's1', name: 'Casa', status: 'want-to-try', tags: [], visits: [], dishes: [] }], settings: { locationEnabled: true } });
  await p.route(/overpass|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.route(/nominatim/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ address: { city: 'Scottsdale', state: 'Arizona' } }) }));
  let calls = 0;
  await p.route('**/api/food-events', r => { calls++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ at: Date.now(), events: [
    { name: 'Nathan\'s Famous Hot Dog Eating Contest', kind: 'contest', date: '2027-07-04', city: 'Brooklyn', state: 'NY', url: 'https://example.com/nathans', prize: '$10,000', blurb: 'Most hot dogs in 10 minutes.' },
    { name: 'Wing Off', kind: 'contest', date: '2026-12-01', city: 'Phoenix', state: 'AZ', url: 'https://example.com/wings', blurb: 'Hot wings, 12 minutes.' },
  ] }) }); });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1800);
  await p.evaluate(() => { document.querySelectorAll('.modal-overlay, [role=dialog]').forEach(e => e.classList.add('hidden')); openMobileHub(); });
  await p.waitForSelector('.fe-card', { timeout: 6000 }).catch(() => {});
  const names = await p.locator('.fe-name').allInnerTexts();
  check(names.length === 2, `Play lists the contests (${names.length})`);
  check(/Wing Off/.test(names[0] || '') && /Your state/.test(await p.locator('.fe-card').first().innerText()), 'contests in your state come first, marked "Your state"');
  check(/\$10,000/.test(await p.locator('.fe-card').nth(1).innerText()) && /Jul 4/.test(await p.locator('.fe-card').nth(1).innerText()), 'with the date and prize');

  await p.evaluate(() => { window.__shared = null; navigator.share = o => { window.__shared = o; return Promise.resolve(); }; window.__opened = null; window.open = u => { window.__opened = u; }; });
  await p.locator('.fe-card').first().locator('.fe-share').click();
  check(/Wing Off/.test((await p.evaluate(() => window.__shared))?.text || ''), 'Share asks a friend to go');
  await p.locator('.fe-card').first().locator('.fe-main').click();
  check((await p.evaluate(() => window.__opened)) === 'https://example.com/wings', 'tapping one opens its page');

  // Searching tools hides the list; reopening uses the saved copy.
  await p.fill('#mobile-hub-search', 'spin');
  await p.waitForTimeout(200);
  check(!(await p.locator('.food-events').count()), 'searching tools hides the contests');
  await p.fill('#mobile-hub-search', '');
  await p.waitForTimeout(400);
  check(await p.locator('.fe-card').count() === 2 && calls === 1, `the list is kept on the phone (server asked ${calls}x)`);
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  await browser.close();
  finish('foodevents');
})();
