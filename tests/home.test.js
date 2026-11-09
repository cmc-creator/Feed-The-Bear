// Home screen order and layout.
const path = require('path');
const { BASE, SHOTS, check, launch, newPage, closeAllDialogs, finish, asGrizzly } = require('./lib');
asGrizzly(); // uses Grizzly-only features

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [{ id: 'd1', name: 'Mole', verdict: 'want' }] }] });
  await p.route(/wikimedia|overpass|nominatim/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2000);

  // The lean home: Bear Swipe, Near You Now and Bear Challenges (owner's MVPs), nothing else piled on.
  const shown = await p.$$eval('#home-discovery > [id], #home-discovery > .nearby-home-header', els => els.filter(e => e.offsetHeight > 0).map(e => e.id || 'nearby'));
  const at = id => shown.indexOf(id);
  check(at('bear-swipe-home') === 0 && at('nearby') > 0, `Bear Swipe leads, then Near You Now (${shown.join(' > ')})`);
  check(['home-add-bar', 'home-quick-actions', 'ai-rec-banner', 'for-you-home', 'mood-picks-home', 'today-status-row', 'week-recap-home'].every(id => at(id) < 0), `the extras are off the home screen (${shown.join(' > ')})`);
  check(await p.locator('#restaurant-grid').isHidden(), 'your saved cards live in Lists, not on home');
  await p.fill('#search-input', 'mission').catch(() => {});
  await p.waitForTimeout(400);
  const searching = await p.evaluate(() => document.body.classList.contains('home-filtering'));
  if (searching) check(await p.locator('#restaurant-grid').isVisible(), 'searching from home shows your matching spots');
  await p.fill('#search-input', '').catch(() => {});
  await closeAllDialogs(p);
  for (const width of [320, 390]) {
    await p.setViewportSize({ width, height: 740 });
    await p.evaluate(() => { setView('all'); window.scrollTo(0, 0); });
    check(await p.evaluate(() => {
      const swipe = document.querySelector('#bear-swipe-home');
      const nav = document.querySelector('#mobile-add-btn').getBoundingClientRect();
      return swipe.offsetHeight > 0 && swipe.getBoundingClientRect().top < nav.top - 150;
    }), `Bear Swipe is on the first ${width}px phone screen`);
  }
  await p.setViewportSize({ width: 390, height: 844 });
  check(await p.evaluate(() => document.documentElement.scrollHeight) < 3200, `home is short (${await p.evaluate(() => document.documentElement.scrollHeight)}px)`);
  check(await p.locator('#location-banner').isHidden(), 'only one "enable location" ask shows');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  // Byte Cub's picks: whole sentences, and tapping them does something.
  const cut = await p.evaluate(() => [wholeSentences('Head to The Mission tonight! Their mole is'), wholeSentences('Try the tacos at'), wholeSentences('Go to The Mission tonight!')]);
  check(cut[0] === 'Head to The Mission tonight!' && cut[1] === '' && cut[2] === 'Go to The Mission tonight!', `cut-off AI replies are trimmed to whole sentences (${JSON.stringify(cut)})`);
  await p.evaluate(() => {
    document.body.classList.add('home-full');
    const b = document.getElementById('ai-rec-banner');
    b.classList.remove('hidden');
    document.getElementById('ai-rec-text').textContent = 'The Mission is calling your name tonight!';
  });
  await p.click('#ai-rec-text');
  check(await p.locator('#detail-overlay').isVisible(), "tapping Byte Cub's pick opens the place it names");
  await p.evaluate(() => { closeDetailModal?.(); document.body.classList.remove('home-full'); });
  await p.evaluate(() => {
    state.restaurants.push({ id: 'w1', name: 'Nobu', cuisine: 'Japanese', status: 'want-to-try', tags: [], visits: [] });
    state.settings.lastWeeklySuggest = 0;
    checkWeeklySuggestion();
  });
  await p.waitForFunction(() => /Nobu/.test(document.getElementById('toast-container')?.innerText || ''), null, { timeout: 12000 }).catch(() => {});
  const pickText = await p.locator('#toast-container .toast-msg').innerText().catch(() => '');
  check(/^Try Nobu this week\. .+[.!]$/.test(pickText), `Byte Cub says the Pick of the Week as a full sentence ("${pickText}")`);
  await p.click('#toast-container .cub-say-act');
  check(await p.locator('#detail-overlay').isVisible(), 'See it opens the spot');
  await p.screenshot({ path: path.join(SHOTS, 'home.png') }).catch(() => {});

  // Desktop keeps the wider layout working.
  const d = await newPage(browser, { seed: [], viewport: { width: 1280, height: 900 } });
  await d.goto(`${BASE}/app.html`);
  await d.waitForTimeout(1500);
  check(await d.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop: no sideways scroll');
  await d.context().close();

  // A saved spot near you: one alert, and closing it keeps it quiet next time.
  const n = await newPage(browser, { seed: [{ id: 'w1', name: 'Irish Wolfhound Pub', cuisine: 'Irish', status: 'want-to-try', lat: 33.4945, lng: -111.9265, tags: [], visits: [], dishes: [] }] });
  await n.route(/wikimedia|overpass|nominatim/, r => r.abort());
  await n.goto(`${BASE}/app.html`);
  await n.waitForTimeout(1500);
  await n.evaluate(() => { state.locationEnabled = true; state.userLat = 33.4942; state.userLng = -111.9261; checkProximity(); });
  check(await n.locator('#proximity-alert').isVisible(), 'a saved spot nearby gets one alert');
  await n.click('#proximity-close');
  await n.reload();
  await n.waitForTimeout(1500);
  await n.evaluate(() => { state.locationEnabled = true; state.userLat = 33.4942; state.userLng = -111.9261; checkProximity(); });
  check(await n.locator('#proximity-alert').isHidden(), 'after closing it, reopening the app does not show it again');
  await n.context().close();

  await browser.close();
  finish('home');
})();
