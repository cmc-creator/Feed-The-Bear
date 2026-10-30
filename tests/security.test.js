// My Account security: the portal fits the screen, email/password/phone can be changed,
// and Want to Try spots nearby raise an alert that can be switched off.
const { BASE, check, launch, newPage, finish } = require('./lib');

const spots = [
  { id: 'v1', name: 'Old Faithful Diner', cuisine: 'American', status: 'visited', lat: 33.4946, lng: -111.9261, tags: [], visits: [] },
  { id: 'w1', name: 'Nobu', cuisine: 'Japanese', status: 'want-to-try', lat: 33.4975, lng: -111.9261, tags: [], visits: [] },
];

(async () => {
  const browser = await launch();

  // ── The portal fits a short phone screen and scrolls to its last row ──
  const p = await newPage(browser, { seed: spots, settings: { nearAlerts: false }, viewport: { width: 390, height: 640 } });
  await p.route(/wikimedia|overpass|nominatim/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); openAccountModal(); });
  await p.waitForTimeout(400);
  const fit = await p.evaluate(() => {
    const card = document.querySelector('.account-portal-card').getBoundingClientRect();
    const list = document.querySelector('.account-portal-actions');
    list.scrollTop = list.scrollHeight;
    const last = [...list.children].filter(e => e.offsetHeight).pop().getBoundingClientRect();
    return { cardBottom: card.bottom, lastBottom: last.bottom, h: innerHeight, scrolls: list.scrollHeight > list.clientHeight };
  });
  check(fit.cardBottom <= fit.h + 1, `the account card ends on screen (${Math.round(fit.cardBottom)} of ${fit.h})`);
  check(fit.scrolls && fit.lastBottom <= fit.h + 1, `the last account row can be scrolled into view (${Math.round(fit.lastBottom)} of ${fit.h})`);

  // ── Signed in: email shows, and the security screen works ──
  await p.evaluate(() => {
    window._calls = [];
    window._fakeUser = {
      email: 'bear@example.com',
      providerData: [{ providerId: 'password' }],
      reauthenticateWithCredential: async () => { if (document.getElementById('security-current-password').value !== 'right') throw { code: 'auth/wrong-password' }; },
      verifyBeforeUpdateEmail: async e => window._calls.push(['email', e]),
      updatePassword: async pw => window._calls.push(['password', pw]),
    };
    _auth = { currentUser: window._fakeUser, sendPasswordResetEmail: async e => window._calls.push(['reset', e]) };
    updateAuthUI(window._fakeUser);
  });
  check((await p.locator('#account-email-display').innerText()) === 'bear@example.com', 'the account shows your email');
  check(await p.locator('#account-security-row').isVisible(), 'an "Email, Password & Phone" row shows when signed in');
  await p.click('#account-security-row');
  await p.waitForTimeout(300);
  check(await p.locator('#security-overlay').isVisible() && (await p.locator('#security-email').innerText()) === 'bear@example.com', 'the security screen opens with your email');

  const toastText = () => p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  await p.fill('#security-new-password', 'newsecret');
  await p.fill('#security-current-password', 'wrong');
  await p.click('#security-password-save');
  await p.waitForTimeout(300);
  check(/current password is not right/.test(await toastText()), 'a wrong current password says so');
  await p.fill('#security-current-password', 'right');
  await p.click('#security-password-save');
  await p.fill('#security-current-password', 'right');
  await p.fill('#security-new-email', 'cub@example.com');
  await p.click('#security-email-save');
  await p.click('#security-reset-email');
  await p.waitForTimeout(300);
  const calls = await p.evaluate(() => window._calls);
  check(calls.some(c => c[0] === 'password' && c[1] === 'newsecret'), 'the password changes with the right current password');
  check(calls.some(c => c[0] === 'email' && c[1] === 'cub@example.com'), 'changing email sends a confirm link to the new address');
  check(calls.some(c => c[0] === 'reset' && c[1] === 'bear@example.com'), 'a reset link can be emailed');

  await p.fill('#security-phone', '(480) 555-0123');
  await p.click('#security-phone-save');
  check(await p.evaluate(() => loadUserProfile().phone) === '(480) 555-0123', 'the phone number is saved to the profile');

  await p.evaluate(() => { closeSecurity(); window._fakeUser.providerData = [{ providerId: 'google.com' }]; openSecurity(); });
  check(await p.locator('#security-google-note').isVisible() && await p.locator('#security-password-section').isHidden(), 'Google accounts are told their password lives with Google');
  await p.evaluate(() => closeSecurity());

  // ── Want to Try alerts ──
  check(/^Off/.test(await p.locator('#account-nearalerts-state').innerText()), 'nearby alerts show as off when switched off');
  await p.evaluate(() => { state.notifiedAt = {}; localStorage.removeItem('ftb_near_alerts_v1'); checkProximity(); });
  check(await p.locator('#proximity-alert').isHidden(), 'no nearby alert while alerts are off');

  await p.evaluate(() => openAccountModal());
  await p.click('#account-nearalerts-row');
  await p.waitForTimeout(1500);
  check(await p.evaluate(() => state.settings.nearAlerts === true && JSON.parse(localStorage.getItem('ftb_settings_v1')).nearAlerts === true), 'tapping the row turns alerts on and remembers it');
  check(/^On/.test(await p.locator('#account-nearalerts-state').innerText()), 'the row then says alerts are on');
  const alert = (await p.locator('#proximity-alert').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(await p.locator('#proximity-alert').isVisible() && /Nobu/.test(alert) && /Want to Try/.test(alert), `a Want to Try spot wins over a closer visited one ("${alert}")`);
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  // ── The phone notification goes through the service worker ──
  const n = await newPage(browser, { seed: spots });
  await n.context().grantPermissions(['geolocation', 'notifications'], { origin: BASE });
  await n.route(/wikimedia|overpass|nominatim/, r => r.abort());
  await n.goto(`${BASE}/app.html?spot=w1`);
  await n.waitForTimeout(1500);
  check(await n.locator('#detail-overlay').isVisible(), 'a notification link (?spot=) opens that spot');
  const shown = await n.evaluate(async () => {
    const got = [];
    // Headless Chromium on CI never grants notifications, so stand in for the "Allow".
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ showNotification: async (t, o) => got.push({ t, o }) }) } });
    await sendBrowserNotification(state.restaurants.find(r => r.id === 'w1'), 380);
    return got;
  });
  check(shown.length === 1 && /Nobu is/.test(shown[0].t) && /Want to Try/.test(shown[0].o.body) && /spot=w1/.test(shown[0].o.data.url), `the alert is shown as a phone notification that opens the spot (${JSON.stringify(shown[0]?.t)})`);
  check(n.errors.length === 0, `no page errors (${n.errors.slice(0, 2).join(' | ')})`);

  await browser.close();
  finish('security');
})();
