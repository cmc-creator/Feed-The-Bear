// Small phones: nothing pushes the app sideways, and the landing page
// shows one number per step and drawn icons (no "LOCK", no odd symbols).
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  for (const width of [320, 360, 390]) {
    const p = await newPage(browser, { seed: [{ id: 'a', name: 'Bacanora', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] }], viewport: { width, height: 760 } });
    await p.route(/overpass|nominatim|open-meteo|place-info/, r => r.abort());
    await p.goto(`${BASE}/app.html`);
    await p.waitForTimeout(1500);
    await closeAllDialogs(p);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(wide <= 0, `the app fits a ${width}px phone (${wide}px too wide)`);
    if (width === 390) {
      // The Saved count is readable in the light theme.
      const c = await p.evaluate(() => { applyThemeChoice('light', { persist: false }); return getComputedStyle(document.getElementById('stat-total')).color; });
      check(c !== 'rgb(245, 232, 212)', `Saved count isn't cream-on-white in the light theme (${c})`);
    }
    await p.context().close();
  }

  const l = await newPage(browser, { viewport: { width: 360, height: 760 } });
  await l.goto(`${BASE}/index.html`);
  await l.waitForTimeout(800);
  check(await l.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the landing page fits a 360px phone');
  check(await l.locator('.step-icon').count() === 0 && await l.locator('.step-num').count() === 3, 'each step shows one number');
  const pricing = await l.locator('#pricing').innerText();
  check(!/LOCK/.test(pricing) && await l.locator('.pricing-lock svg').count() >= 4, 'locked features use a padlock icon, not the word LOCK');
  check(await l.locator('.feature-icon svg').count() === await l.locator('.feature-icon').count(), 'every feature has a drawn icon');
  check(!/Grizzly keeps new saves in sync/.test(await l.locator('body').innerText()), 'sync is not described as Grizzly-only');
  await browser.close();
  finish('layout');
})();
