// Bear Swipe and Today's Pick agree: once a round names your craving, the
// pick (the regular one and Grizzly's AI one) follows it.
const { BASE, check, launch, newPage, closeAllDialogs, asGrizzly, finish } = require('./lib');

const spot = (id, name, cuisine, extra) => ({ id, name, cuisine, status: 'want-to-try', tags: [], visits: [], dishes: [], ...extra });

(async () => {
  const browser = await launch();
  asGrizzly();
  const p = await newPage(browser, { seed: [
    // The Mexican spot would win on its own (a dish you've been wanting).
    spot('m', 'Tacos Chiwas', 'Mexican', { dishes: [{ id: 'd', name: 'Birria', verdict: 'want' }] }),
    spot('a', "Joe's Diner", 'American'),
    spot('i', 'Pizzeria Bianco', 'Pizza'),
  ] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);

  const pick = () => p.evaluate(() => { sessionStorage.clear(); return localDailyPick().text; });
  check(/Tacos Chiwas/.test(await pick()), 'without a swipe, the pick is the spot you were wanting');

  await p.evaluate(() => localStorage.setItem('ftb_bear_swipe_v2', JSON.stringify({ craving: { cuisine: 'American', at: Date.now() } })));
  const text = await pick();
  check(/Joe's Diner/.test(text) && /craving American/.test(text), `after Bear Swipe says American, the pick is American (${text})`);

  // Grizzly's AI pick is told the craving and which saved spots fit it.
  await p.evaluate(() => {
    AI.call = async prompt => { window._prompt = prompt; return "Go get a burger at Joe's Diner!"; };
    sessionStorage.clear();
    onBearSwipeCraving();
  });
  await p.waitForTimeout(400);
  const prompt = await p.evaluate(() => window._prompt || '');
  check(/craving American food right now/.test(prompt) && /Joe's Diner \(American\)/.test(prompt) && !/Tacos Chiwas \(Mexican\)/.test(prompt.split('craving American')[1] || ''),
    'the AI pick is asked for American, from your American spots');
  check(/Joe's Diner/.test(await p.locator('#ai-rec-text').innerText()), "Today's Pick updates right after the round");

  // Bear Swipe's result lists matching saved spots; "Find American near me" finds burgers and BBQ too.
  const saved = await p.evaluate(() => savedCravingSpots('American').map(s => s.name));
  check(saved.join() === "Joe's Diner", `your saved American spots show with the craving (${saved})`);
  const found = await p.evaluate(() => {
    discoverNearby();
    _discAllResults = [
      { name: 'Smash Burger Co', cuisine: 'burger', amenity: 'fast_food', dist: 300, matchScore: 1 },
      { name: 'Little Miss BBQ', cuisine: 'bbq', amenity: 'restaurant', dist: 900, matchScore: 1 },
      { name: 'Pho 43', cuisine: 'vietnamese', amenity: 'restaurant', dist: 200, matchScore: 1 },
    ];
    document.getElementById('disc-search').value = 'american';
    _discApplyFilters();
    return document.getElementById('nearby-results').textContent;
  });
  check(/Smash Burger/.test(found) && /Little Miss BBQ/.test(found) && !/Pho 43/.test(found), 'searching "american" nearby finds burgers and BBQ, not pho');
  await closeAllDialogs(p);

  // An old craving (hours ago) stops steering.
  await p.evaluate(() => localStorage.setItem('ftb_bear_swipe_v2', JSON.stringify({ craving: { cuisine: 'American', at: Date.now() - 7 * 3600000 } })));
  check(/Tacos Chiwas/.test(await pick()), 'a craving from hours ago no longer counts');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('craving');
})();
