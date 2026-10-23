// Every page loads and every open* feature opens without errors or sideways
// scrolling. Catches load-order crashes like the duplicate `toRad` that
// stopped app.js from running in production.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

// Need arguments or leave the page, so they are covered by flows.test.js.
const SKIP = new Set(['openDirections', 'openDirectionsForSwipeItem', 'openWebsite', 'openMapsSearch', 'openLightbox',
  'openEditModal', 'openDetailModal', 'openAddModalPreFilled', 'openSwipeChoiceDetails', 'openCheckinWithPhoto',
  'openDishTracker', 'openVisitDebrief', 'openDecisionDirections', 'openPhotoGallery']);

const SEED = [
  { id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, lat: 33.4918, lng: -111.9242, priceRange: 2, tags: [], dateAdded: '2026-09-01',
    dishes: [{ id: 'a', name: 'Tableside guacamole', verdict: 'again', rating: 5 }, { id: 'b', name: 'Churros', verdict: 'skip', rating: 2 }], visits: [{ date: '2026-10-02', rating: 5 }] },
  { id: 'r2', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', lat: 33.5099, lng: -112.0464, priceRange: 1, tags: [], dateAdded: '2026-09-02',
    dishes: [{ id: 'c', name: 'Birria quesatacos', verdict: 'want', rating: 0 }], visits: [] },
];

(async () => {
  const browser = await launch();

  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
    for (const pg of ['index.html', 'app.html', 'auth.html']) {
      const p = await newPage(browser, { viewport });
      await p.goto(`${BASE}/${pg}`);
      await p.waitForTimeout(2000);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, `${pg} @${viewport.width}px has no horizontal overflow (${overflow}px)`);
      check(!p.errors.length, `${pg} @${viewport.width}px loads without errors ${p.errors.join(' | ')}`);
      if (pg === 'app.html') check(await p.evaluate(() => typeof state === 'object' && typeof renderAll === 'function'), 'app.js started (state and renderAll defined)');
      await p.context().close();
    }
  }

  const p = await newPage(browser, { seed: SEED });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2500);
  const fns = (await p.evaluate(() => Object.keys(window).filter(k => /^open[A-Z]/.test(k) && typeof window[k] === 'function'))).filter(f => !SKIP.has(f)).sort();
  check(fns.length >= 45, `found the feature openers (${fns.length})`);
  for (const fn of fns) {
    p.errors.length = 0;
    const res = await p.evaluate(async f => { try { await window[f](); return 'ok'; } catch (e) { return e.message; } }, fn);
    await p.waitForTimeout(300);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(res === 'ok', `${fn}() runs (${res})`);
    check(!p.errors.length, `${fn}() has no errors ${p.errors.join(' | ')}`);
    check(overflow <= 0, `${fn}() has no horizontal overflow (${overflow}px)`);
    await p.keyboard.press('Escape');
    await closeAllDialogs(p);
  }

  await browser.close();
  finish('smoke');
})();
