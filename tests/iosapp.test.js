// The iPhone app (native/ios) loads this site with a fake Capacitor here:
// Sign in with Apple, Grizzly checkout and Google sign-in open in Safari,
// App Store ratings, Apple notification tokens, and no Google Play anywhere.
const crypto = require('crypto');
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const spot = (id, name) => ({ id, name, cuisine: 'Mexican', status: 'visited', tags: [], visits: [], dishes: [] });

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [spot('a', 'Bacanora'), spot('b', 'Kai'), spot('c', 'Pizzeria Bianco')] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.addInitScript(() => {
    localStorage.setItem('ftb_product_events_v1', JSON.stringify({ counts: { app_opened: 5 }, recent: [] }));
    const listeners = {};
    window._ios = { opened: [], reviewed: 0, nonce: '', listeners };
    const Plugins = {
      AppleSignIn: { signIn: async o => { window._ios.nonce = o.nonce; return { idToken: 'apple-id-token', authorizationCode: 'code1', name: 'Connie Michelle', email: '' }; } },
      ExternalLink: { open: async o => { window._ios.opened.push(o.url); }, requestReview: async () => { window._ios.reviewed++; } },
      PushNotifications: {
        checkPermissions: async () => ({ receive: 'granted' }),
        requestPermissions: async () => ({ receive: 'granted' }),
        register: async () => { setTimeout(() => listeners.registration?.({ value: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90' }), 10); },
        unregister: async () => {},
        addListener: (name, fn) => { listeners[name] = fn; return { remove () {} }; },
      },
    };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: n => !!Plugins[n], Plugins };
  });
  const pushCalls = [];
  await p.route('**/api/push', r => { pushCalls.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ json: { ok: true } }); });
  let checkoutBody = null;
  await p.route('**/api/create-checkout**', r => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { trial: true, days: 7 } });
    checkoutBody = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({ json: { url: 'https://checkout.stripe.com/c/pay/cs_test_ios' } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);

  check(await p.evaluate(() => document.documentElement.classList.contains('ios-app') && window.FTB_IOS_APP === true), 'the site knows it is in the iPhone app');
  check(await p.locator('#app-update-banner').count() === 0, 'no "new version on Google Play" bar');
  await p.evaluate(() => checkAndroidAppVersion());
  check(await p.locator('#app-update-banner').count() === 0, 'even when asked directly');

  // Rating: Apple's own card, never Google Play.
  await p.evaluate(() => { state.restaurants[0].visits.push({ date: '2026-11-01', rating: 5 }); renderAll(); });
  await p.waitForTimeout(1600);
  if (await p.locator('#rate-prompt .rate-love').count()) {
    await p.click('#rate-prompt .rate-love');
    const text = await p.locator('#rate-prompt').innerText();
    check(/App Store/.test(text) && !/Google Play/.test(text), 'Love it asks for an App Store rating');
    await p.click('#rate-prompt .rate-ios');
    check(await p.evaluate(() => window._ios.reviewed) === 1, 'Rate opens Apple\'s rating card');
  } else check(false, 'the rating ask appears after a 5-star visit');

  await closeAllDialogs(p);

  // Sign in with Apple, next to Google.
  await p.evaluate(() => { window._ftbAuthReady = true; openAuthModal(); });
  await p.waitForTimeout(300);
  check(await p.locator('#auth-apple-btn').isVisible() && await p.locator('#auth-google-btn').isVisible(), 'Continue with Apple shows next to Google');
  const box = await p.locator('#auth-apple-btn').boundingBox();
  const gbox = await p.locator('#auth-google-btn').boundingBox();
  check(box && gbox && box.y < gbox.y && box.width >= gbox.width - 1, 'Apple is first and as big as Google');
  await p.evaluate(() => {
    window._signedWith = null;
    window._named = '';
    const user = { uid: 'appleUser0001', displayName: '', providerData: [{ providerId: 'apple.com' }], getIdToken: async () => 't', updateProfile: async o => { window._named = o.displayName; } };
    _auth = { currentUser: null, setPersistence: async () => {}, signInWithCredential: async c => { window._signedWith = c; _auth.currentUser = user; return { user }; } };
    window.firebase = window.firebase || {};
    firebase.auth = firebase.auth || {};
    firebase.auth.Auth = firebase.auth.Auth || { Persistence: { LOCAL: 'local' } };
    firebase.auth.OAuthProvider = class { constructor (id) { this.id = id; } credential (o) { return { providerId: this.id, ...o }; } };
  });
  await p.click('#auth-apple-btn');
  await p.waitForTimeout(500);
  const signed = await p.evaluate(() => ({ cred: window._signedWith, nonce: window._ios.nonce, named: window._named }));
  check(signed.cred?.providerId === 'apple.com' && signed.cred.idToken === 'apple-id-token', 'Apple\'s token signs in to Firebase');
  check(/^[0-9a-f]{64}$/.test(signed.nonce) && crypto.createHash('sha256').update(signed.cred?.rawNonce || '').digest('hex') === signed.nonce, 'Apple gets the hashed nonce, Firebase the raw one');
  check(signed.named === 'Connie Michelle', 'the name Apple shares the first time is kept');
  check(!(await p.locator('#auth-overlay').isVisible()), 'and the sign-in sheet closes');

  // Google sign-in happens in Safari itself.
  await p.evaluate(() => _nativeGoogleSignIn());
  check(await p.evaluate(() => window._ios.opened.some(u => u.startsWith('https://www.feed-the-bear.com/native-signin.html?c='))), 'Continue with Google opens in Safari');

  // Grizzly: checkout opens in Safari, and Stripe brings them back to the app.
  await p.evaluate(() => { _auth.currentUser.email = 'connie@example.com'; openUpgradeModal(); });
  await p.waitForTimeout(400);
  await p.click('#upgrade-cta-btn');
  await p.waitForTimeout(600);
  check(checkoutBody?.ios === true, 'checkout is asked for the iPhone app');
  check(await p.evaluate(() => window._ios.opened.includes('https://checkout.stripe.com/c/pay/cs_test_ios')), 'checkout opens in Safari');
  check(p.url().startsWith(`${BASE}/app.html`), 'the app stays where it was');
  check(/Finish in Safari/.test(await p.locator('#toast-container').innerText()), 'and says to finish in Safari');
  await closeAllDialogs(p);

  // Notifications: Apple's token, marked for the server.
  await p.evaluate(() => FriendPings.start());
  await p.waitForTimeout(400);
  check(pushCalls.some(c => c.action === 'register' && c.token === 'apns:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'), 'the iPhone registers its Apple token');

  // Share cards: no Google Play badge.
  const drawn = await p.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const words = [];
    const fill = ctx.fillText.bind(ctx);
    ctx.fillText = (t, ...a) => { words.push(t); fill(t, ...a); };
    window.StoryCard.brand(ctx, { x: 0, y: 100, w: 1000, link: 'feed-the-bear.com/@connie' });
    return words.join(' | ');
  });
  check(/feed-the-bear.com/.test(drawn) && !/Google Play/.test(drawn), `share cards carry the link but no Google Play badge (${drawn})`);

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('iosapp');
})();
