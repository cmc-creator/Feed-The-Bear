// First impressions: messages stay out of the way, cards show only real
// information, everyone gets a daily pick, and Add a spot finds real places.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const ALWAYS = [0, 1, 2, 3, 4, 5, 6].map(d => ({ open: { day: d, hour: 0, minute: 0 }, close: { day: d, hour: 23, minute: 59 } }));
const spot = (id, name, extra) => ({ id, name, cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], ...extra });

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    spot('a', 'Tacos Chiwas', { periods: ALWAYS, dishes: [{ id: 'd', name: 'Birria', verdict: 'want' }] }),
    spot('b', 'Pizzeria Bianco', { cuisine: 'Pizza' }),
  ] });
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.route('**/api/place-info?mode=search**', r => r.fulfill({ json: { places: [
    { placeId: 'g1', name: 'Bacanora', address: '1301 Grand Ave, Phoenix', lat: 33.46, lng: -112.09, kind: 'Mexican Restaurant', rating: 4.6, reviews: 800, priceLevel: 2 }] } }));
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1800);
  await closeAllDialogs(p);

  // Messages drop in at the top on phones, two at most, and never block the bottom bar.
  await p.evaluate(() => { for (let i = 0; i < 4; i++) showToast('Hello ' + i, 'msg'); });
  await p.waitForTimeout(400);
  const toastBox = await p.locator('#toast-container .toast').last().boundingBox();
  check(toastBox && toastBox.y < 200, `messages show at the top (y=${toastBox && Math.round(toastBox.y)})`);
  check(await p.locator('#toast-container .toast:not(.removing)').count() <= 2, 'no more than two at once');
  const atMap = await p.evaluate(() => document.elementFromPoint(120, 815)?.closest('.mobile-nav-btn') !== null);
  check(atMap, 'the bottom bar stays tappable');
  await p.locator('#toast-container .toast').last().click();
  await p.waitForTimeout(400);

  // Cards: no made-up "% match" or filler tags.
  const cardText = await p.locator('.restaurant-card').first().innerText();
  check(!/% match|Up next|Trusted pick/.test(cardText), 'cards show no invented match score');

  // Today's Pick is Grizzly: a free account sees it locked, without the answer.
  check(await p.locator('#ai-rec-banner').isVisible(), "free accounts see Today's Pick");
  check(/unlock it with Grizzly/.test(await p.locator('#ai-rec-text').innerText()), 'locked, without giving the pick away');
  check((await p.locator('#ai-rec-banner .ai-rec-label').textContent()) === "Today's Pick", "labelled Today's Pick");
  // The pick itself, with a reason, that opens the spot (as Grizzly sees it).
  const pickText = await p.evaluate(() => { sessionStorage.clear(); return localDailyPick().text; });
  check(/(breakfast|lunch|dinner|late-night bite): Tacos Chiwas/.test(pickText), `it picks the open spot you're craving (${pickText})`);
  check(/wanting the Birria|open now/i.test(pickText), 'and says why');
  await p.evaluate(() => { window._ftbUid = 'grizzlyUser0001'; window._ftbPlan = 'grizzly'; window.AI = undefined; showLocalDailyPick(); });
  await p.click('#ai-rec-refresh-btn');
  await p.waitForTimeout(200);
  check(/Pizzeria Bianco/.test(await p.locator('#ai-rec-text').innerText()), 'refresh suggests something else');
  await p.click('#ai-rec-text');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => state.detailId) === 'b', 'tapping it opens that spot');
  await p.evaluate(() => { window._ftbUid = null; window._ftbPlan = 'free'; });
  await closeAllDialogs(p);

  // Add a spot finds real places (Google) with rating and cuisine filled in.
  await p.click('#home-add-bar');
  await p.fill('.qa-input', 'bacan');
  await p.waitForTimeout(1200);
  const sugg = (await p.locator('.qa-sugg').first().innerText()).replace(/\s+/g, ' ');
  check(/Bacanora ★ 4\.6 · Mexican · 1301 Grand Ave/.test(sugg), `search shows real places (${sugg})`);
  await p.locator('.qa-sugg').first().click();
  await p.click('.qa-status[data-status="want-to-try"]');
  await p.click('.qa-save');
  await p.waitForTimeout(500);
  const saved = await p.evaluate(() => { const r = state.restaurants.find(x => x.name === 'Bacanora'); return r && [r.cuisine, r.googleRating, r.priceRange, r.address].join('|'); });
  check(saved === 'Mexican|4.6|2|1301 Grand Ave, Phoenix', `saved with details filled in (${saved})`);

  // Friends screen (Grizzly) leads with Invite.
  await closeAllDialogs(p);
  await p.evaluate(() => { window._ftbUid = 'grizzlyUser0001'; window._ftbPlan = 'grizzly'; openFoodieFriends(); });
  await p.waitForTimeout(300);
  const first = await p.evaluate(() => [...document.querySelectorAll('#friends-overlay button, #friends-overlay input')].find(e => e.offsetParent)?.id);
  check(first === 'friends-close-btn' || first === 'friends-invite-btn', `Invite is the first thing on Friends (${first})`);
  check(!(await p.locator('#friends-link-input').isVisible()), 'pasting a link is tucked away until needed');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('firstimpressions');
})();
