// Free accounts: a "save your diary" nudge after a few spots, and backup for everyone signed in.
const { BASE, check, launch, newPage, finish } = require('./lib');

const spot = (id, name) => ({ id, name, cuisine: 'Mexican', status: 'visited', myRating: 4, tags: [], dishes: [], visits: [] });
const SEED = [spot('r1', 'Taqueria Uno'), spot('r2', 'Taqueria Dos')];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { window._ftbAuthReady = true; window._ftbUid = null; });

  // Editing an existing spot never nags; only adding one does.
  await p.evaluate(() => saveData());
  await p.waitForTimeout(2200);
  check(await p.locator('#save-diary-nudge').count() === 0, 'no nudge when nothing was added');

  const add = name => p.evaluate(n => { state.restaurants.unshift({ id: 'x' + Math.random(), name: n, cuisine: 'Thai', status: 'want-to-try', tags: [], dishes: [], visits: [] }); saveData(); }, name);
  await add('Thai Basil');
  await p.waitForTimeout(2200);
  check(await p.locator('#save-diary-nudge').isVisible(), 'adding a 3rd spot offers to save the diary');
  check((await p.locator('#save-diary-nudge strong').innerText()).includes('3 spots'), 'the nudge counts their spots');

  await p.locator('#save-diary-nudge .sdn-save').click();
  check(await p.locator('#auth-overlay').isVisible(), 'Save my diary opens sign-up');
  check(await p.locator('#auth-overlay').getAttribute('data-mode') === 'signup', 'it opens in sign-up mode');
  await p.evaluate(() => closeAuthModal());

  // Once a session, and "Not now" is remembered.
  await add('Pho King');
  await p.waitForTimeout(2200);
  check(await p.locator('#save-diary-nudge').count() === 0, 'only one nudge per session');
  const log = await p.evaluate(() => JSON.parse(localStorage.getItem('ftb_save_nudge_v1')));
  check(log && log.at > 0, 'the nudge time is remembered');

  // Signed-in free accounts get backed up (sync no longer needs Grizzly).
  const synced = await p.evaluate(async () => {
    let called = false;
    const orig = window.fbSaveRestaurants;
    window.fbSaveRestaurants = () => { called = true; };
    // fbDebouncedSync calls the global binding, so swap it the same way.
    // eslint-disable-next-line no-global-assign
    fbSaveRestaurants = window.fbSaveRestaurants;
    window._ftbUid = 'test-user';
    localStorage.setItem('ftb_plan_v1', 'free');
    fbDebouncedSync();
    await new Promise(r => setTimeout(r, 4500));
    window._ftbUid = null;
    fbSaveRestaurants = orig;
    return called;
  });
  check(synced, 'a free signed-in account is backed up');
  check(!(await p.locator('.upgrade-plan-features').first().innerText()).includes('✗ Cross-device'), 'the pricing card no longer lists backup as Grizzly-only');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();

  // A second visit soon after: still quiet (5-day gap).
  const b2 = await launch();
  const q = await newPage(b2, { seed: [...SEED, spot('r3', 'Three')] });
  await q.addInitScript(() => localStorage.setItem('ftb_save_nudge_v1', JSON.stringify({ at: Date.now(), dismissed: 1 })));
  await q.route(/overpass|nominatim/, r => r.abort());
  await q.goto(`${BASE}/app.html`);
  await q.waitForTimeout(1500);
  await q.evaluate(() => { window._ftbAuthReady = true; window._ftbUid = null; saveData(); state.restaurants.unshift({ id: 'n1', name: 'New', cuisine: 'Thai', status: 'want-to-try', tags: [], dishes: [], visits: [] }); saveData(); });
  await q.waitForTimeout(2200);
  check(await q.locator('#save-diary-nudge').count() === 0, 'no nudge again within 5 days');
  await b2.close();
  finish('account');
})();
