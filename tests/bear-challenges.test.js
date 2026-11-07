const Module = require('module');
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');
const load = Module._load;
Module._load = function (req, ...args) {
  if (req === 'firebase-admin') return { apps: [1], firestore: () => ({}) };
  return load.call(this, req, ...args);
};
const foodEventsApi = require('../api/food-events');
Module._load = load;

const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const friday = new Date();
friday.setDate(friday.getDate() + (friday.getDay() >= 5 || friday.getDay() === 0 ? 0 : 5 - friday.getDay()));
const weekendDay = `${friday.getFullYear()}-${String(friday.getMonth() + 1).padStart(2, '0')}-${String(friday.getDate()).padStart(2, '0')}`;
const events = [
  { id: 'burger-mesa', name: 'Burger Challenge', kind: 'challenge', date: '', venue: 'Bear Grill', city: 'Mesa', state: 'AZ', url: 'https://example.com/mesa', blurb: 'A restaurant challenge.', entryCost: '$25', rules: 'Book with the restaurant; spectators welcome.', eligibility: 'Check age requirements with organizer', prize: 'T-shirt', discoveredAt: Date.now() },
  { id: 'burger-phoenix', name: 'Burger Challenge', kind: 'challenge', date: '', venue: 'Bear Grill', city: 'Phoenix', state: 'AZ', url: 'https://example.com/phoenix' },
  { id: 'weekend-wings', name: 'Wing Competition', kind: 'contest', date: weekendDay, city: 'Phoenix', state: 'AZ', venue: 'Town Square', url: 'https://example.com/wings', registrationUrl: 'https://example.com/register', discoveredAt: Date.now() },
  { id: 'taco-future', name: 'Taco Festival', kind: 'festival', date: localDay(45), city: 'Austin', state: 'TX', url: 'https://example.com/tacos' },
  { id: 'old', name: 'Ended Contest', kind: 'contest', date: localDay(-3), city: 'Mesa', state: 'AZ' },
];
const seed = [{ id: 'spot', name: 'Cafe', status: 'visited', tags: [], dishes: [], visits: [] }];

(async () => {
  const clean = foodEventsApi.cleanEvents([
    { name: 'Burger', kind: 'challenge', date: '', city: 'Mesa', state: 'AZ', venue: 'Grill', entryCost: '$25', rules: 'Reservations required.', registrationUrl: 'javascript:alert(1)' },
    { name: 'Burger', kind: 'challenge', date: '', city: 'Phoenix', state: 'AZ', venue: 'Grill' },
    { name: 'Burger', kind: 'challenge', date: '', city: 'Mesa', state: 'AZ', venue: 'Grill' },
    { name: 'Impossible date', kind: 'contest', date: '2027-02-30', state: 'AZ' },
  ]);
  check(clean.length === 2 && clean[0].id !== clean[1].id, 'server identity deduplicates exact repeats but preserves separate branches');
  check(clean[0].entryCost === '$25' && clean[0].rules === 'Reservations required.' && !clean[0].registrationUrl, 'organizer facts survive and unsafe registration links are removed');
  check(foodEventsApi.cleanEvents([{ ...clean[0], id: 'invented' }])[0].id === clean[0].id, 'event IDs are deterministic and do not trust model IDs');
  check(!clean[0].discoveredAt && !clean[0].verified, 'the cleaner never invents a verification date or verified label');
  const oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const db = { doc: () => ({ get: async () => ({ data: () => ({ events: clean, at: Date.now() - 2 * 864e5 }) }) }) };
  const stale = await foodEventsApi.nationalList(db);
  check(stale.stale && stale.events[0].discoveredAt === stale.at, 'older server caches carry discovery time and stale status');
  if (oldKey !== undefined) process.env.GEMINI_API_KEY = oldKey;
  const fresh = await foodEventsApi.nationalList({ doc: () => ({ get: async () => ({ data: () => ({ events: clean, at: Date.now() }) }) }) });
  check(!fresh.stale, 'fresh server cache is not falsely labelled stale');

  const browser = await launch();
  const p = await newPage(browser, { seed, settings: { locationEnabled: false } });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  const requests = [];
  let response = events;
  let outage = false;
  await p.route('**/api/food-events**', r => {
    requests.push(new URL(r.request().url()).searchParams.get('state') || '');
    return outage ? r.fulfill({ status: 503, json: { error: 'Unavailable' } }) : r.fulfill({ json: { events: response, at: Date.now() } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForSelector('#bear-challenges-home-list .bc-card');
  await closeAllDialogs(p);
  check(await p.locator('#bear-challenges-home').isVisible(), 'Home prominently shows Bear Challenges without location permission');
  check(await p.locator('#bear-challenges-home-list .bc-card').count() === 3, 'Home highlights a bounded three-card selection');
  check(/Restaurant challenge/i.test(await p.locator('#bear-challenges-home-list').innerText()) && /Eating competition/i.test(await p.locator('#bear-challenges-home-list').innerText()), 'Home includes ongoing challenges and dated competitions');
  check(!/Ended Contest/.test(await p.locator('#bear-challenges-home-list').innerText()), 'Home excludes ended events');

  await p.click('#bear-challenges-all');
  await p.waitForSelector('#bc-list .bc-card');
  check(await p.locator('#bear-challenges-overlay').isVisible() && await p.inputValue('#bc-state') === '', 'See all opens the dedicated nationwide screen');
  check(await p.locator('#bc-list .bc-card').count() === 4, 'browsing excludes past events');
  const networkBefore = requests.length;
  await p.selectOption('#bc-kind', 'challenge');
  check(await p.locator('#bc-list .bc-card').count() === 2, 'restaurant challenges filter excludes dated competitions');
  await p.fill('#bc-search', 'Mesa');
  check(await p.locator('#bc-list .bc-card').count() === 1, 'city search narrows the list');
  await p.locator('#bc-list [data-bc-action=detail]').click();
  check(await p.locator('#bear-challenge-detail-overlay').isVisible() && /Burger Challenge/.test(await p.locator('#bc-detail-title').innerText()), 'card opens an in-app detail screen');
  const detailText = await p.locator('#bc-detail').innerText();
  check(/\$25/.test(detailText) && /Reservations|Book with the restaurant/.test(detailText) && /T-shirt/.test(detailText), 'detail shows entry cost, rules and prize');
  check(/Found/.test(detailText) && /not organizer-verified/.test(detailText), 'discovery time is not presented as verification');
  check(/Ongoing · check availability/.test(detailText) && !/Any day/.test(detailText), 'undated challenge does not imply daily availability');
  check(await p.locator('#bc-detail a[href="https://example.com/mesa"]').count() === 1, 'details include the original source');
  check(/Food illustration/.test(detailText), 'illustrative card imagery is explicitly labelled rather than passed off as venue photos');
  await p.locator('#bc-detail [data-detail-action=save]').click();
  check(await p.locator('#bc-detail [data-detail-action=save]').getAttribute('aria-pressed') === 'true', 'saving from details updates its state');
  check(await p.evaluate(() => foodEventBookmarks().length === 1), 'save persists the full listing snapshot');
  check(await p.locator('#bc-detail [data-detail-action=save]').evaluate(el => el === document.activeElement), 'saving keeps keyboard focus on the detail action');
  await p.evaluate(() => { navigator.share = async value => { window.__invite = value; }; });
  await p.locator('#bc-detail [data-detail-action=share]').click();
  const invite = await p.evaluate(() => window.__invite);
  check(new URL(invite.url).searchParams.get('foodEvent') === 'burger-mesa' && /example.com\/mesa/.test(invite.text), 'friend invite contains a deep link and original source');
  await p.evaluate(() => history.back());
  await p.waitForTimeout(300);
  check(await p.locator('#bear-challenge-detail-overlay').isHidden() && await p.locator('#bear-challenges-overlay').isVisible(), 'Back closes details while keeping the browser screen open');
  check(await p.evaluate(() => document.activeElement.closest('#bear-challenges-overlay') !== null), 'closing details returns focus into browsing');
  await p.fill('#bc-search', '');
  const branchStates = await p.locator('#bc-list [data-bc-action=save]').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-pressed')));
  check(branchStates.filter(x => x === 'true').length === 1, 'saving one branch does not save another with the same challenge name');
  check(requests.length === networkBefore, 'client filters, details and saves reuse the fetched list');

  await p.selectOption('#bc-kind', 'upcoming');
  await p.selectOption('#bc-when', 'weekend');
  check(await p.locator('#bc-list .bc-card').count() === 1 && /Wing Competition/.test(await p.locator('#bc-list').innerText()), 'This weekend selects upcoming dated events only');
  await p.selectOption('#bc-when', 'month');
  check(await p.locator('#bc-list .bc-card').count() === 1, 'Next 30 days excludes more distant dates');
  await p.selectOption('#bc-kind', 'all');
  await p.selectOption('#bc-when', 'all');
  await p.selectOption('#bc-state', 'TX');
  await p.waitForFunction(() => !_bc.loading);
  check(requests.includes('TX') && /Taco Festival/.test(await p.locator('#bc-list').innerText()) && await p.locator('#bc-list .bc-card').count() === 1, 'manual state choice requests that state and filters without geolocation');
  await p.selectOption('#bc-state', '');
  await p.waitForFunction(() => !_bc.loading);
  await p.click('#bc-saved');
  check(await p.locator('#bc-list .bc-card').count() === 1 && /Mesa/.test(await p.locator('#bc-list').innerText()), 'Saved shows the saved branch');
  response = events.filter(e => e.id !== 'burger-mesa');
  await p.click('#bc-refresh');
  await p.waitForFunction(() => !_bc.loading);
  check(await p.locator('#bc-list .bc-card').count() === 1, 'saved snapshot remains after disappearing from discovery');
  check(await p.locator('#bc-list [data-bc-action=save]').getAttribute('aria-pressed') === 'true', 'retained saved snapshot is still marked saved');
  await p.locator('#bc-list [data-bc-action=detail]').click();
  check(/not in the current discovery/.test(await p.locator('#bc-detail').innerText()), 'saved missing listing is labelled unavailable rather than active');
  await p.keyboard.press('Escape');
  check(await p.locator('#bear-challenge-detail-overlay').isHidden() && await p.locator('#bear-challenges-overlay').isVisible(), 'Escape closes only the top Bear Challenges panel');

  outage = true;
  await p.click('#bc-saved');
  await p.click('#bc-refresh');
  await p.waitForFunction(() => !_bc.loading);
  check(/Could not refresh.*older list/.test(await p.locator('#bc-status').innerText()) && await p.locator('#bc-list .bc-card').count() > 0, 'refresh outage preserves cached listings with explicit stale warning');
  await p.click('#bc-saved');
  await p.locator('#bc-list [data-bc-action=detail]').click();
  await p.evaluate(() => { navigator.share = async () => { throw new DOMException('Blocked', 'NotAllowedError'); }; });
  await p.locator('#bc-detail [data-detail-action=share]').click();
  check(/Could not share/.test(await p.locator('.toast').last().innerText()), 'failed invitation is disclosed');
  await p.evaluate(() => {
    window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === FOOD_EVENT_BOOKMARKS_KEY) throw new DOMException('Full', 'QuotaExceededError');
      return window.__setItem.call(this, key, value);
    };
  });
  await p.locator('#bc-detail [data-detail-action=save]').click();
  check(await p.locator('#bc-detail [data-detail-action=save]').getAttribute('aria-pressed') === 'true' && /Could not save/.test(await p.locator('.toast').last().innerText()), 'storage failure never reports a successful unsave');
  await p.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
  await p.locator('#bc-detail [data-detail-action=save]').click();
  check(await p.evaluate(() => foodEventBookmarks().length === 0), 'unsaving removes the saved snapshot');
  await closeAllDialogs(p);
  await p.evaluate(() => openFoodEvents({ state: '' }));
  await p.waitForFunction(() => !_bc.loading);
  await p.click('#bc-saved');
  await p.selectOption('#bc-state', 'CA');
  await p.waitForFunction(() => !_bc.loading);
  check(/could not be loaded/.test(await p.locator('#bc-list').innerText()) && /Could not load/.test(await p.locator('#bc-status').innerText()), 'uncached outage is an explicit error, not a fake empty result');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone screen has no horizontal overflow');
  check(!p.errors.length, `no browser errors (${p.errors.join(' | ')})`);

  outage = false;
  response = events;
  await p.evaluate(() => {
    localStorage.setItem(FOOD_EVENTS_SAVED_KEY, JSON.stringify(['Wing Competition|' + _foodEventLists.get('').events.find(e => e.id === 'weekend-wings').date]));
  });
  await p.reload();
  await p.waitForSelector('#bear-challenges-home-list .bc-card');
  await closeAllDialogs(p);
  await p.click('#bear-challenges-all');
  await p.waitForFunction(() => !_bc.loading);
  await p.click('#bc-saved');
  check(await p.locator('#bc-list .bc-card').count() === 1 && /Wing Competition/.test(await p.locator('#bc-list').innerText()), 'legacy saves survive a reload and remain discoverable');
  check(await p.evaluate(() => foodEventBookmarks().some(e => e.id === 'weekend-wings')), 'legacy saved event acquires a persistent detail snapshot');
  await p.locator('#bc-list [data-bc-action=detail]').click();
  await p.locator('#bc-detail [data-detail-action=save]').click();
  await p.click('#bear-challenge-detail-close');
  check(await p.locator('#bc-list .bc-card').count() === 0, 'unsaving a migrated legacy save clears both old and new save identities');
  await p.click('#bc-saved');
  await p.locator('#bc-list [data-bc-action=save]').first().click();
  const persistedName = await p.locator('#bc-list [data-bc-action=save][aria-pressed=true]').first().getAttribute('aria-label');
  await p.reload();
  await p.waitForSelector('#bear-challenges-home-list .bc-card');
  await closeAllDialogs(p);
  await p.click('#bear-challenges-all');
  await p.waitForFunction(() => !_bc.loading);
  await p.click('#bc-saved');
  check(await p.locator('#bc-list .bc-card').count() === 1 && persistedName === await p.locator('#bc-list [data-bc-action=save]').getAttribute('aria-label'), 'new saved listing persists across a full page reload');
  check(!p.errors.length, `no reload errors (${p.errors.join(' | ')})`);

  const desktop = await newPage(browser, { seed, viewport: { width: 1280, height: 900 } });
  await desktop.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await desktop.route('**/api/food-events**', r => r.fulfill({ json: { events, at: Date.now() } }));
  await desktop.goto(`${BASE}/app.html?foodEvent=weekend-wings&eventState=AZ`);
  await desktop.waitForSelector('#bear-challenge-detail-overlay:not(.hidden)');
  check(/Wing Competition/.test(await desktop.locator('#bc-detail-title').innerText()), 'shared deep link opens the requested listing');
  check(await desktop.locator('#bc-detail a[href="https://example.com/register"]').count() === 1, 'official registration link is available when supplied');
  await desktop.evaluate(() => {
    window.__originalCapacitor = window.Capacitor;
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true };
    window.__originalOpen = window.open;
    window.open = url => { window.__externalEventUrl = url; };
  });
  await desktop.locator('#bc-detail a[href="https://example.com/register"]').click();
  check(await desktop.evaluate(() => window.__externalEventUrl === 'https://example.com/register'), 'Android detail links use the existing external-browser handoff');
  await desktop.evaluate(() => { window.Capacitor = window.__originalCapacitor; window.open = window.__originalOpen; });
  await desktop.click('#bear-challenge-detail-close');
  await desktop.keyboard.press('Shift+Tab');
  check(await desktop.evaluate(() => document.activeElement.closest('#bear-challenges-overlay') !== null), 'keyboard focus remains trapped in the active dialog');
  check(await desktop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop screen has no horizontal overflow');
  await desktop.selectOption('#bc-state', '');
  await desktop.waitForFunction(() => !_bc.loading);
  const boxes = await desktop.locator('#bc-list .bc-card').evaluateAll(cards => cards.map(c => ({ x: c.getBoundingClientRect().x, y: c.getBoundingClientRect().y })));
  check(boxes.length > 1 && boxes[0].y === boxes[1].y && boxes[0].x !== boxes[1].x, 'desktop browsing uses a responsive card grid');
  check(!desktop.errors.length, `no desktop errors (${desktop.errors.join(' | ')})`);
  await desktop.route('**/api/food-events?state=CA', async r => {
    await new Promise(resolve => setTimeout(resolve, 400));
    return r.fulfill({ json: { events: [{ id: 'ca', name: 'California Event', kind: 'contest', date: localDay(5), state: 'CA', city: 'Los Angeles' }], at: Date.now() } });
  });
  await desktop.selectOption('#bc-state', 'CA');
  await desktop.selectOption('#bc-state', 'TX');
  await desktop.waitForFunction(() => !_bc.loading);
  await desktop.waitForTimeout(450);
  check(await desktop.inputValue('#bc-state') === 'TX' && /Taco Festival/.test(await desktop.locator('#bc-list').innerText()), 'out-of-order state responses cannot overwrite the current selection');
  await desktop.evaluate(() => {
    openFoodEventDetail({ id: 'unsafe', name: '<script>alert(1)</script>', date: '', kind: 'challenge', city: 'Mesa', state: 'AZ', url: 'javascript:alert(1)', registrationUrl: 'data:text/html,unsafe', rules: '<img src=x onerror=alert(1)>' });
  });
  check(await desktop.locator('#bc-detail script, #bc-detail img[src=x]').count() === 0 && await desktop.locator('#bc-detail a[href^="javascript"], #bc-detail a[href^="data:"]').count() === 0, 'detail renders untrusted text safely and rejects unsafe source links');
  check(/No source link supplied/.test(await desktop.locator('#bc-detail').innerText()), 'missing source is explained instead of inventing a link');
  await desktop.click('#bear-challenge-detail-close');
  await desktop.evaluate(() => openFoodEvents({ state: 'AZ', eventKey: 'no-longer-listed' }));
  await desktop.waitForFunction(() => !_bc.loading);
  check(/Listing no longer available/.test(await desktop.locator('.toast').last().innerText()), 'missing shared event is explicitly disclosed');
  const noShare = process.env.PW_NO_SHARE;
  process.env.PW_NO_SHARE = '1';
  const fallback = await newPage(browser, { seed });
  if (noShare === undefined) delete process.env.PW_NO_SHARE; else process.env.PW_NO_SHARE = noShare;
  await fallback.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await fallback.route('**/api/food-events**', r => r.fulfill({ json: { events, at: Date.now() } }));
  await fallback.goto(`${BASE}/app.html?foodEvent=weekend-wings&eventState=AZ`);
  await fallback.waitForSelector('#bear-challenge-detail-overlay:not(.hidden)');
  await fallback.locator('#bc-detail [data-detail-action=share]').click();
  check(await fallback.locator('#share-menu').isVisible(), 'friend invites work through the app share menu when native sharing is unavailable');
  await fallback.keyboard.press('Escape');
  check(await fallback.locator('#share-menu').count() === 0 && await fallback.locator('#bear-challenge-detail-overlay').isVisible(), 'Escape cancels a share without closing the challenge underneath');
  check(!fallback.errors.length, `no share fallback errors (${fallback.errors.join(' | ')})`);
  await browser.close();
  finish('bear-challenges');
})().catch(err => { console.error(err); process.exitCode = 1; });
