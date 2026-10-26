// The cub's first-run welcome.
const path = require('path');
const { BASE, SHOTS, check, launch, newPage, finish } = require('./lib');

// A brand-new user: profile done, welcome not seen yet.
async function freshPage (browser) {
  const p = await newPage(browser);
  await p.context().addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('ftb_settings_v1', JSON.stringify({ profileSetupDone: true }));
  });
  await p.route(/nominatim\.openstreetmap\.org|overpass/, route => route.fulfill({ json: { elements: [] } }));
  await p.goto(`${BASE}/app.html`);
  await p.waitForSelector('#cub-welcome:not(.hidden)', { timeout: 8000 }).catch(() => {});
  return p;
}

const step = p => p.getAttribute('#cub-welcome', 'data-step');
const settings = p => p.evaluate(() => JSON.parse(localStorage.getItem('ftb_settings_v1') || '{}'));

(async () => {
  const browser = await launch();

  // Walk through every step and add a first spot.
  const p = await freshPage(browser);
  check(await p.locator('#cub-welcome').isVisible(), 'a new user is greeted by the cub');
  check(!(await p.locator('#onboarding-overlay').isVisible()), 'the old text slides stay hidden');
  check(await step(p) === 'hi', 'starts on the hello step');
  check(!(await p.locator('#cub-buddy .cub-btn').isVisible()), 'the buddy waits until the welcome is over');
  await p.locator('#cub-welcome .cw-card').screenshot({ path: path.join(SHOTS, 'welcome-1.png') }).catch(() => {});

  await p.click('.cw-go');
  check(await step(p) === 'location', 'next asks for location');
  check(await p.$$eval('.cw-dots i.on', d => d.length) === 2, 'progress dots move along');
  await p.click('.cw-go');
  await p.waitForTimeout(600);
  check(await step(p) === 'spot', 'then asks for a first spot');
  check(await p.evaluate(() => state.locationEnabled === true), 'location is turned on');

  await p.click('.cw-go');
  await p.waitForSelector('#quick-add-overlay:not(.hidden)');
  check(await p.locator('#cub-welcome').isHidden(), 'Quick Add opens in place of the welcome');
  await p.fill('.qa-input', 'Pho Corner');
  await p.waitForTimeout(250);
  await p.locator('.qa-sugg-new').click();
  await p.click('.qa-status[data-status="want-to-try"]');
  await p.click('.qa-save');
  await p.waitForSelector('#cub-welcome:not(.hidden)', { timeout: 4000 }).catch(() => {});
  check(await step(p) === 'swipe', 'after saving, the cub comes back for the last step');
  check(await p.evaluate(() => state.restaurants.some(r => r.name === 'Pho Corner')), 'the first spot is saved');

  await p.click('.cw-go');
  await p.waitForTimeout(400);
  check(await p.locator('#cub-welcome').isHidden(), 'the welcome closes at the end');
  check((await settings(p)).onboardingDone === true, 'it is marked done');
  check(!(await p.evaluate(() => document.body.classList.contains('overlay-open'))), 'the page is usable again');
  await p.reload();
  await p.waitForTimeout(1500);
  check(await p.locator('#cub-welcome').count() === 0 || await p.locator('#cub-welcome').isHidden(), 'it does not come back on the next visit');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.context().close();

  // Closing Quick Add without saving still moves on.
  const q = await freshPage(browser);
  await q.click('.cw-go');
  await q.click('.cw-skip');
  check(await step(q) === 'spot', '"Not now" skips location');
  await q.click('.cw-go');
  await q.waitForSelector('#quick-add-overlay:not(.hidden)');
  await q.evaluate(() => Cub.close());
  await q.waitForTimeout(400);
  check(await step(q) === 'swipe' && await q.locator('#cub-welcome').isVisible(), 'closing Quick Add returns to the welcome');
  await q.click('.cw-skip');
  check(await q.locator('#cub-welcome').isHidden() && (await settings(q)).onboardingDone === true, 'skipping the last step finishes');
  await q.context().close();

  // Skip everything from the first screen.
  const s = await freshPage(browser);
  await s.click('.cw-skip');
  check(await s.locator('#cub-welcome').isHidden(), '"Skip setup" closes the welcome right away');
  check((await settings(s)).onboardingDone === true, 'and it stays done');
  check(await s.locator('#cub-buddy .cub-btn').isVisible(), 'the buddy shows up after');
  check(s.errors.length === 0, `no page errors (${s.errors.slice(0, 2).join(' | ')})`);
  await s.context().close();

  // Existing users never see it.
  const e = await newPage(browser, { seed: [] });
  await e.goto(`${BASE}/app.html`);
  await e.waitForTimeout(1500);
  check(await e.locator('#cub-welcome').count() === 0, 'returning users skip the welcome');
  await e.context().close();

  await browser.close();
  finish('welcome');
})();
