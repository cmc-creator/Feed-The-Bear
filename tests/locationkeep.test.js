// Location is a phone setting: signing out or switching accounts never asks again.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a1', name: 'Pizzeria Bianco', status: 'visited', tags: [], visits: [] }] });
  await p.route('**/api/**', r => r.fulfill({ json: {} }));
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    state.settings.locationEnabled = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    localStorage.setItem('ftb_data_owner_v1', 'A'); window._ftbDataOwner = 'A';
    // Account B was saved on this phone before location was ever turned on.
    await photoDbOp('readwrite', store => store.put({ [STORAGE_KEY]: '[]', [SETTINGS_KEY]: '{"theme":"dark"}' }, 'B'), 'accounts');
    const loc = () => JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').locationEnabled === true && state.settings.locationEnabled === true;
    await switchAccountData('B', () => true, captureAccountData());
    const toB = loc();
    await switchAccountData('', () => true, captureAccountData());
    const signedOut = loc();
    await switchAccountData('A', () => true, captureAccountData());
    return { toB, signedOut, backToA: loc(), aSpots: state.restaurants.length };
  });
  check(r.toB, 'switching to another account keeps location on');
  check(r.signedOut, 'signing out keeps location on');
  check(r.backToA && r.aSpots === 1, `back on the first account, location is on and its spots are all there (${JSON.stringify(r)})`);
  await browser.close();
  finish('locationkeep');
})();
