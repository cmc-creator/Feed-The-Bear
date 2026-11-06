// Play lists eating contests and food challenges across the US
// (api/food-events.js), saved ★ first, then your state; a heads-up before
// one. api/nudges.js picks the daily notification. Also: a website update
// never reloads the page under you (that sent a shared spot's Add form to Home).
const fs = require('fs');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');
const { cleanEvents, parseArray } = require('../api/food-events');
const { pick } = require('../api/nudges');

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

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
  const anyDay = cleanEvents([{ name: 'Big Burger Challenge', kind: 'challenge', date: '', city: 'Mesa', state: 'AZ' }, { name: 'Undated contest', kind: 'contest', date: '', city: 'X', state: 'TX' }, { name: 'Wings', kind: 'contest', date: '2026-12-01', city: 'Y', state: 'PA' }], '2026-11-06');
  check(anyDay.map(e => e.name).join(',') === 'Wings,Big Burger Challenge', 'restaurant challenges you can take any day are kept (after dated ones); undated contests are not');
  check(parseArray('Here you go:\n```json\n[{"name":"A"}]\n```').length === 1 && parseArray('nothing').length === 0, 'the JSON list is read out of the answer');

  // Daily nudges: a contest in your state within 4 days first, once each.
  const events = [{ name: 'Wing Off', date: day(2), city: 'Phoenix', state: 'AZ', blurb: 'Wings.' }, { name: 'Far Off', date: day(30), city: 'Mesa', state: 'AZ' }];
  const area = { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [{ n: 'Casa Birria', lat: 33.5, lng: -111.93 }, { n: 'Far Away', lat: 40, lng: -100 }] };
  let m = pick(area, events);
  check(m?.kind === 'contest' && /Wing Off/.test(m.title) && m.data.open === 'contests', `a contest in your state this week is the day's notification (${m?.title})`);
  m = pick({ ...area, sent: { contests: [`Wing Off|${day(2)}`] } }, events, Date.parse('2026-11-06T16:00:00Z')); // a Friday
  check(m?.kind === 'weekly' && /Casa Birria is near you/.test(m.title) && m.data.open === 'want', `Fridays: Want to Try spots within your distance (${m?.title})`);
  check(pick({ ...area, sent: { contests: [`Wing Off|${day(2)}`] } }, events, Date.parse('2026-11-04T16:00:00Z')) === null, 'no weekly nudge midweek');
  check(pick({ ...area, sent: { lastAt: Date.now() - 3600000 } }, events) === null, 'at most one a day');

  // No reload when the service worker updates.
  const html = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
  check(!/location\.reload\(/.test(html), 'a website update never reloads the open page');

  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 's1', name: 'Casa', status: 'want-to-try', tags: [], visits: [], dishes: [] }], settings: { locationEnabled: true } });
  await p.route(/overpass|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.route(/nominatim/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ address: { city: 'Scottsdale', state: 'Arizona' } }) }));
  const asked = [];
  await p.route(/\/api\/food-events/, r => { asked.push(new URL(r.request().url()).search); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ at: Date.now(), events: [
    { name: 'Nathan\'s Famous Hot Dog Eating Contest', kind: 'contest', date: '2027-07-04', city: 'Brooklyn', state: 'NY', url: 'https://example.com/nathans', prize: '$10,000', blurb: 'Most hot dogs in 10 minutes.' },
    { name: 'Wing Off', kind: 'contest', date: day(1), city: 'Phoenix', state: 'AZ', url: 'https://example.com/wings', blurb: 'Hot wings, 12 minutes.' },
  ] }) }); });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1800);
  // The heads-up: a contest in your state tomorrow.
  await p.waitForTimeout(6500);
  check(await p.evaluate(() => document.body.innerText.includes('Wing Off is')), 'a contest in your state in the next few days gets a heads-up');
  check(asked.some(q => q === '?state=AZ'), `your state is searched too (${asked.join(' ')})`);
  await p.evaluate(() => { document.querySelectorAll('.modal-overlay, [role=dialog]').forEach(e => e.classList.add('hidden')); document.querySelectorAll('.toast').forEach(t => t.remove()); openMobileHub(); });
  await p.waitForSelector('.fe-card', { timeout: 6000 }).catch(() => {});
  const names = await p.locator('.fe-name').allInnerTexts();
  check(names.length === 2, `Play lists the contests (${names.length})`);
  check(/Wing Off/.test(names[0] || '') && /Your state/.test(await p.locator('.fe-card').first().innerText()), 'contests in your state come first, marked "Your state"');
  check(/\$10,000/.test(await p.locator('.fe-card').nth(1).innerText()) && /Jul 4/.test(await p.locator('.fe-card').nth(1).innerText()), 'with the date and prize');
  check(/1 in your state · 2 nationwide/.test(await p.locator('.food-events').innerText()), 'it says how many are in your state');

  await p.evaluate(() => { window.__shared = null; navigator.share = o => { window.__shared = o; return Promise.resolve(); }; window.__opened = null; window.open = u => { window.__opened = u; }; });
  await p.locator('.fe-card').first().locator('.fe-share').click();
  check(/Wing Off/.test((await p.evaluate(() => window.__shared))?.text || ''), 'Share asks a friend to go');
  await p.locator('.fe-card').first().locator('.fe-main').click();
  check((await p.evaluate(() => window.__opened)) === 'https://example.com/wings', 'tapping one opens its page');

  // ★ saves it, and saved ones come first next time.
  await p.locator('.fe-card').nth(1).locator('.fe-star').click();
  check(await p.locator('.fe-card').nth(1).locator('.fe-star').innerText() === '★', 'the star saves a contest');
  await p.evaluate(() => { closeMobileHub(); openMobileHub(); });
  await p.waitForSelector('.fe-card', { timeout: 6000 }).catch(() => {});
  check(/Nathan/.test((await p.locator('.fe-name').allInnerTexts())[0] || ''), 'saved contests are listed first');

  // Searching tools hides the list; reopening uses the saved copy.
  await p.fill('#mobile-hub-search', 'spin');
  await p.waitForTimeout(200);
  check(!(await p.locator('.food-events').count()), 'searching tools hides the contests');
  await p.fill('#mobile-hub-search', '');
  await p.waitForTimeout(400);
  check(await p.locator('.fe-card').count() === 2 && asked.length === 1, `the list is kept on the phone (server asked ${asked.length}x)`);

  // A contest notification tapped: Play opens at the contests.
  await p.evaluate(() => { closeMobileHub(); openFoodEvents(); });
  await p.waitForTimeout(1200);
  check(await p.locator('#mobile-hub-overlay').isVisible() && await p.locator('.food-events').isVisible(), 'a contest notification opens Play at the contests');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  await browser.close();
  finish('foodevents');
})();
