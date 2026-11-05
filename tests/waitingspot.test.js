// At the free limit, a spot you try to save isn't lost: the upgrade names it,
// and it's saved the moment you go Grizzly.
const { BASE, check, launch, newPage, finish } = require('./lib');

const FULL = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, name: `Spot ${i}`, cuisine: 'Pizza', status: 'want-to-try', tags: [], visits: [] }));

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: FULL, grizzly: false });
  await p.route(/wikimedia|overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { window._ftbUid = 'freeUid1234567890'; window._ftbPlan = 'free'; localStorage.setItem('ftb_plan_v1', 'free'); });

  // Saving a 26th spot (as a shared TikTok or a search pick does).
  const made = await p.evaluate(() => createSpotFrom({ found: { name: 'Little Miss BBQ', address: '4301 E University Dr, Phoenix, AZ', kind: 'BBQ restaurant' } }));
  check(made === null && await p.evaluate(() => state.restaurants.length) === 25, 'over the limit, the spot is not added yet');
  check(await p.locator('#upgrade-overlay').isVisible(), 'the upgrade opens');
  check((await p.locator('#upgrade-title').innerText()) === 'Save Little Miss BBQ?', 'and names the spot they were saving');
  check(/Little Miss BBQ is saved right away/.test(await p.locator('#upgrade-feature-highlight').innerText()), 'and says it will be saved');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('ftb_waiting_spot_v1')).r.name) === 'Little Miss BBQ', 'the spot waits');

  // Free accounts: nothing changes on the next render.
  await p.evaluate(() => { closeUpgradeModal(); renderGrizzlyUi(); });
  check(await p.evaluate(() => state.restaurants.length) === 25, 'still on Cub: it keeps waiting');

  // They go Grizzly.
  await p.evaluate(() => { window._ftbPlan = 'grizzly'; localStorage.setItem('ftb_plan_v1', 'grizzly'); renderGrizzlyUi(); });
  await p.waitForTimeout(200);
  check(await p.evaluate(() => state.restaurants[0]?.name === 'Little Miss BBQ' && state.restaurants.length === 26), 'after upgrading, the waiting spot is saved');
  check(/Little Miss BBQ saved/.test(await p.locator('.toast').last().innerText().catch(() => '')), 'with a toast saying so');
  check(await p.evaluate(() => !localStorage.getItem('ftb_waiting_spot_v1')), 'and it stops waiting');
  await p.evaluate(() => renderGrizzlyUi());
  check(await p.evaluate(() => state.restaurants.filter(r => r.name === 'Little Miss BBQ').length) === 1, 'saved once, not twice');

  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('waitingspot');
})();
