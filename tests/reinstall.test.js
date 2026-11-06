// Reinstalling (or a new phone): signing in to an account that already set up
// never shows the first-time setup. A brand-new account still gets it, after
// sign-in, and it never covers a shared spot's Add form.
const { BASE, check, launch, newPage, finish } = require('./lib');

const shown = p => p.evaluate(() => !!document.querySelector('#cub-welcome:not(.hidden), #onboarding-overlay:not(.hidden)'));

(async () => {
  const browser = await launch();
  const fresh = async () => {
    const p = await newPage(browser, {});
    await p.addInitScript(() => localStorage.setItem('ftb_test_auth_gate', '1'));
    await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
    return p;
  };
  // Signs in the way firebase.js finishes: gate off, then the account's data is in.
  const signIn = (p, existing) => p.evaluate(e => { localStorage.removeItem('ftb_test_auth_gate'); window._ftbUid = 'u1'; closeAuthModal(); onboardingAfterSignIn(e); }, existing);

  let p = await fresh();
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  check(!(await shown(p)), 'no setup over the sign-in sheet');
  await signIn(p, true);
  await p.waitForTimeout(900);
  check(!(await shown(p)) && await p.evaluate(() => state.settings.onboardingDone), 'an account that already set up skips setup');
  await p.context().close();

  p = await fresh();
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await signIn(p, false);
  await p.waitForTimeout(900);
  check(await shown(p), 'a brand-new account gets setup after signing in');
  await p.context().close();

  // Opened from a share (signed in already on this phone): the form, not setup.
  p = await newPage(browser, {});
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.goto(`${BASE}/app.html?text=${encodeURIComponent('https://www.joespizzanyc.com/')}`);
  await p.waitForTimeout(2000);
  check(await p.locator('#modal-overlay').isVisible() && !(await shown(p)), 'a shared spot opens its form with no setup on top');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  // A new visitor can try it first: the sheet offers it, setup follows, and
  // the 3rd saved spot asks for the free account (and can't be skipped).
  p = await fresh();
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { window._ftbAuthReady = true; openAuthModal({ tryFirst: true }); });
  check(await p.locator('#auth-try-first').isVisible(), 'a new visitor is offered "Try it first"');
  await p.click('#auth-try-first');
  await p.waitForTimeout(900);
  check(await p.locator('#auth-overlay').isHidden() && await shown(p), 'trying first closes the sheet and starts setup');
  await p.evaluate(() => { document.querySelectorAll('#cub-welcome, #onboarding-overlay').forEach(e => e.classList.add('hidden')); maybeHideOverlay(); });
  for (let i = 1; i <= 3; i++) {
    await p.evaluate(n => { state.restaurants.push({ id: `t${n}`, name: `Spot ${n}`, status: 'want-to-try', tags: [], visits: [], dishes: [] }); saveData(); }, i);
    await p.waitForTimeout(1200);
    if (i < 3) check(await p.locator('#auth-overlay').isHidden(), `spot ${i} saves without an account`);
  }
  check(await p.locator('#auth-overlay').isVisible() && await p.evaluate(() => document.getElementById('auth-overlay').classList.contains('auth-required')), 'the 3rd spot asks for the free account, and it stays until they sign up');
  check(/come with you/.test(await p.textContent('#auth-overlay .auth-sub')), 'it says their spots come with them');
  await browser.close();
  finish('reinstall');
})();
