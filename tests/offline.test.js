// No signal: after one visit, the app opens offline from the service worker,
// shows your list and says it's offline, and logging still works.
const { BASE, check, launch, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  await ctx.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('ftb_dishes_merged_v1', '1');
    localStorage.setItem('ftb_settings_v1', JSON.stringify({ onboardingDone: true, profileSetupDone: true }));
    localStorage.setItem('ftb_restaurants_v2', JSON.stringify([
      { id: 'a', name: 'Bacanora', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] },
      { id: 'b', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [] },
    ]));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());

  // First visit online: the service worker saves the app.
  await p.goto(`${BASE}/app.html`);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForTimeout(2500);
  await p.reload();
  await p.waitForTimeout(2000);
  check(await p.evaluate(() => !!navigator.serviceWorker.controller), 'the app is saved for offline after one visit');

  // Lose the signal and open it again.
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForTimeout(3000);
  await closeAllDialogs(p);
  await p.evaluate(() => { setView('want-to-try'); renderCards(); });
  check(/Bacanora/.test(await p.locator('#restaurant-grid').innerText().catch(() => '')), 'offline, it opens with your list');
  check(await p.locator('#offline-banner').isVisible() && /Your list still works/.test(await p.locator('#offline-banner').innerText()), 'and says it is offline');

  // Logging a meal still works (it lives on the phone until the signal is back).
  await p.evaluate(() => { const r = state.restaurants.find(x => x.id === 'a'); r.status = 'visited'; r.visits.push({ date: '2026-11-03', rating: 4 }); saveData(); renderAll(); });
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('ftb_restaurants_v2')).find(r => r.id === 'a').visits.length) === 1, 'a meal logged offline is kept');

  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(300);
  check(await p.locator('#offline-banner').isHidden(), 'the note goes away when the signal is back');

  check(!errors.length, `no page errors ${errors.join(' | ')}`);
  await browser.close();
  finish('offline');
})();
