// Upgrade paths: locked features pitch Grizzly instead of dead-ending, free
// users can see where Grizzly lives, members don't get nagged. Also covers
// the cuisine filter listing nearby cuisines.
const path = require('path');
const { BASE, SHOTS, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const SEED = [
  { id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], dateAdded: '2026-09-01', visits: [{ date: '2026-10-02' }],
    dishes: [{ id: 'a', name: 'Tableside guacamole', verdict: 'again', rating: 5 }] },
  { id: 'r2', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 4, tags: [], dateAdded: '2026-09-02', visits: [] },
];

async function upgradeTitle (p) {
  await p.waitForSelector('#upgrade-overlay:not(.hidden)', { timeout: 3000 }).catch(() => {});
  return (await p.locator('#upgrade-title').innerText().catch(() => '')).trim();
}

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2000);

  // Header pill and home card
  check(await p.locator('#grizzly-pill').isVisible(), 'free users see the Go Grizzly pill');
  await p.click('#grizzly-pill');
  check(await upgradeTitle(p) === 'Go Grizzly', 'the pill opens the upgrade screen');
  await closeAllDialogs(p);
  const card = p.locator('#grizzly-home');
  check(await card.isHidden(), 'no Grizzly card for a brand-new den (2 spots)');
  await p.evaluate(() => {
    for (let i = 0; i < 3; i++) state.restaurants.push({ id: 'y' + i, name: 'Early ' + i, status: 'want-to-try', tags: [], visits: [] });
    renderAll();
  });
  check(await card.isVisible() && /5 of 15 free spots used/.test(await card.innerText()), 'home card shows spots used once they have 5');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: path.join(SHOTS, 'grizzly-card.png') }).catch(() => {});
  await p.click('#grizzly-home .gz-snooze');
  check(await card.isHidden(), '"Not now" hides the card');

  // Near the limit the card comes back regardless.
  await p.evaluate(() => {
    for (let i = 0; i < 8; i++) state.restaurants.push({ id: 'x' + i, name: 'Spot ' + i, status: 'want-to-try', tags: [], visits: [] });
    renderAll();
  });
  check(await card.isVisible() && /13 of 15/.test(await card.innerText()), 'near the limit the card shows even after "Not now"');

  // Hub lock badges and Year in Review gating
  await p.evaluate(() => openMobileHub());
  await p.waitForTimeout(300);
  const locked = await p.$$eval('.hub-tile, .hub-card', tiles => tiles.filter(t => t.querySelector('.hub-lock')).map(t => t.dataset.tool).sort());
  check(JSON.stringify(locked) === JSON.stringify(['ai-panel', 'mealplanner', 'review']), `Grizzly badges on locked tools (${locked})`);
  await p.locator('[data-tool="review"]').click();
  check(await upgradeTitle(p) === 'Your foodie Year in Review', 'Year in Review pitches Grizzly');
  await closeAllDialogs(p);

  // Duel: free verdict plus the upsell, instead of "AI unavailable"
  await p.evaluate(() => openDuel());
  await p.waitForTimeout(300);
  await p.selectOption('#duel-pick-a', 'r1');
  await p.selectOption('#duel-pick-b', 'r2');
  await p.click('#duel-go-btn');
  await p.waitForTimeout(300);
  const duel = await p.locator('#duel-result').innerText();
  check(/WINNER: The Mission/.test(duel) && /Unlock with Grizzly/.test(duel), `Duel gives a free verdict and an upsell ("${duel.replace(/\s+/g, ' ').slice(0, 80)}")`);
  await p.locator('#duel-result').screenshot({ path: path.join(SHOTS, 'duel-free.png') }).catch(() => {});
  await p.click('#duel-result [data-upsell="duel"]');
  check(await upgradeTitle(p) === 'Let Byte Cub judge the showdown', 'Duel upsell opens a Duel-specific pitch');
  await closeAllDialogs(p);

  // Meal planner and restaurant AI buttons pitch instead of dead-ending
  await p.evaluate(() => openMealPlanner());
  await p.waitForTimeout(200);
  await p.click('#mp-generate-btn');
  check(/Plan your week of eating out/.test(await p.locator('#mp-result').innerText()), 'Meal Planner shows the unlock card');
  await closeAllDialogs(p);
  await p.evaluate(() => { openDetailModal('r1'); getAiDetailSummary('r1'); });
  check(await upgradeTitle(p) === 'Byte Cub sums up every spot', 'AI summary pitches its own benefit');
  await closeAllDialogs(p);
  await p.evaluate(() => { openDetailModal('r1'); getAiDishRecs('r1'); });
  check(await upgradeTitle(p) === 'Know what to order before you go', 'AI dish picks pitch their own benefit');

  // Byte Cub panel
  await closeAllDialogs(p);
  await p.evaluate(() => openAiPanel());
  check(await upgradeTitle(p) === 'Your personal food concierge', 'Byte Cub pitches itself');

  // Upgrading while signed out: sign in first, remembered for the return trip
  await p.click('#upgrade-cta-btn');
  await p.waitForTimeout(400);
  check(await p.locator('#auth-overlay').isVisible().catch(() => false), 'signed-out upgrade opens sign-in');
  check(await p.evaluate(() => sessionStorage.getItem('ftb_pending_upgrade')) === 'yearly', 'upgrade intent is remembered through sign-in');
  await closeAllDialogs(p);

  // Grizzly members don't see upsells
  await p.evaluate(() => { window._ftbUid = 'u1'; window._ftbPlan = 'grizzly'; renderGrizzlyUi(); renderMobileHub(); });
  check(await p.locator('#grizzly-pill').isHidden() && await card.isHidden(), 'members see no pill or card');
  check(await p.locator('.hub-lock').count() === 0, 'members see no lock badges');
  await p.evaluate(() => { window._ftbUid = null; window._ftbPlan = 'free'; });

  // Cuisine filter lists nearby cuisines and filters Near You Now
  await closeAllDialogs(p);
  await p.evaluate(() => {
    _homeDiscCache = { lat: 33.49, lng: -111.92, elements: [
      { id: 1, lat: 33.491, lon: -111.921, _dist: 120, tags: { name: 'Ramen Spot', amenity: 'restaurant', cuisine: 'ramen;japanese' } },
      { id: 2, lat: 33.492, lon: -111.922, _dist: 220, tags: { name: 'Taco Stand', amenity: 'fast_food', cuisine: 'mexican' } },
      { id: 3, lat: 33.493, lon: -111.923, _dist: 320, tags: { name: 'Gelato Bar', amenity: 'ice_cream', cuisine: 'ice_cream' } },
    ] };
    renderCuisineFilter();
  });
  const groups = await p.$$eval('#filter-cuisine optgroup', gs => gs.map(g => `${g.label}: ${[...g.children].map(o => o.textContent).join(', ')}`));
  check(groups.some(g => /^Your spots: .*Mexican \(1\)/.test(g)) && groups.some(g => /^Near you: .*Ramen \(1\).*Ice Cream \(1\)|^Near you: .*Ice Cream \(1\).*Ramen \(1\)/.test(g)), `filter lists your and nearby cuisines ${JSON.stringify(groups)}`);
  await p.selectOption('#filter-cuisine', 'ramen');
  await p.waitForTimeout(300);
  const strip = await p.locator('#nearby-home-list').innerText();
  check(/Ramen Spot/.test(strip) && !/Taco Stand/.test(strip), 'filter applies to Near You Now');
  await p.selectOption('#filter-cuisine', 'mexican');
  await p.waitForTimeout(300);
  const cards = await p.$$eval('.restaurant-card .card-name', es => es.map(e => e.innerText));
  check(cards.length === 1 && cards[0] === 'The Mission', `filter applies to your list (${cards})`);

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('money');
})();
