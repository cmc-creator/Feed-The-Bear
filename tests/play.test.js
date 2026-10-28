// Google Play requirements: privacy policy, account deletion (app + web), and the app link file.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'visited', tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|place-info/, r => r.abort());

  // Public pages.
  for (const [page, text] of [['privacy.html', 'Privacy Policy'], ['delete-account.html', 'Delete your account']]) {
    const resp = await p.goto(`${BASE}/${page}`);
    check(resp.ok() && (await p.locator('h1').innerText()).includes(text), `${page} is up`);
    check(await p.locator('a[href^="mailto:support@feed-the-bear.com"]').count() > 0, `${page} lists the support email`);
  }
  const links = await p.goto(`${BASE}/.well-known/assetlinks.json`);
  const json = await links.json();
  check(json[0].target.package_name === 'com.feedthebear.app' && json[0].target.sha256_cert_fingerprints.length === 1, 'assetlinks.json names the Android app');

  // In the app: Delete Account only when signed in, guarded by typing DELETE.
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  check(await p.locator('.app-footer-legal a[href="privacy.html"]').count() === 1, 'app footer links the privacy policy');
  await p.evaluate(() => updateAuthUI(null));
  check(await p.locator('#account-delete-row').isHidden(), 'no Delete Account when signed out');

  await p.evaluate(async () => {
    const log = window.__log = [];
    const user = {
      email: 'bear@example.com',
      providerData: [{ providerId: 'password' }],
      reauthenticateWithCredential: async () => { log.push('reauth'); },
      getIdToken: async () => 'fake-token',
    };
    window._auth = _auth || {};
    Object.defineProperty(_auth, 'currentUser', { value: user, configurable: true });
    _auth.signOut = async () => { log.push('signout'); };
    window.firebase = window.firebase || {};
    firebase.auth = firebase.auth || {};
    firebase.auth.EmailAuthProvider = { credential: () => ({}) };
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/delete-account')) { log.push(`${opts.method} ${opts.headers.Authorization}`); return new Response('{"deleted":true}', { status: 200 }); }
      return realFetch(url, opts);
    };
    window.location.replace = () => log.push('reload');
    updateAuthUI(user);
  });
  check(await p.locator('#account-delete-row').count() === 1, 'Delete Account row exists');
  await p.evaluate(() => openDeleteAccount());
  check(await p.locator('#delete-account-overlay').isVisible(), 'delete opens a confirmation');
  check(await p.locator('#delete-account-go').isDisabled(), 'the button stays off until you type DELETE');
  check(await p.locator('#delete-account-password-wrap').isVisible(), 'email accounts confirm with their password');
  await p.fill('#delete-account-confirm', 'delete');
  check(await p.locator('#delete-account-go').isEnabled(), 'typing delete turns it on');
  await p.fill('#delete-account-password', 'hunter22');
  await p.locator('#delete-account-go').click();
  await p.waitForTimeout(600);
  const log = await p.evaluate(() => window.__log || null);
  const result = await p.evaluate(() => ({ spots: localStorage.getItem('ftb_restaurants_v2'), toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ') }));
  check(result.toast.includes('Account deleted'), `shows Account deleted (${result.toast.slice(0, 80)})`);
  check(!result.spots, 'erasing this device clears saved spots');
  check(log.includes('reauth') && log.includes('POST Bearer fake-token') && log.includes('signout'), `re-checks your password, calls the server with your sign-in, signs out (${log})`);
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('play');
})();
