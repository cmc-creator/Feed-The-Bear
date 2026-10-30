// Android app: the web app hands Want to Try spots to Android geofencing,
// explains background location before asking, and signs in with Google
// through Chrome with a PKCE-style challenge. Android itself is faked here.
const Module = require('module');
const crypto = require('crypto');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server: native-start / native-finish (api/verify-session.js) ──
const docs = {};
const fakeAdmin = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('tok-')) throw new Error('bad'); return { uid: t.slice(4) }; }, createCustomToken: async uid => `custom-${uid}` }),
  firestore: () => ({ doc: p => ({
    set: async d => { docs[p] = d; }, get: async () => ({ exists: !!docs[p], data: () => docs[p] }), delete: async () => { delete docs[p]; },
  }) }),
};
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === 'stripe') return () => ({});
  return realLoad.call(this, req, ...rest);
};
const verify = require(path.join(__dirname, '..', 'api', 'verify-session.js'));
Module._load = realLoad;
const call = (body, headers = {}) => new Promise(resolve => {
  let status = 200;
  verify({ method: 'POST', query: {}, body, headers }, { status (s) { status = s; return this; }, setHeader () {}, json (d) { resolve({ status, ...d }); return this; } });
});

(async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  let r = await call({ action: 'native-start', challenge });
  check(r.status === 401, 'starting a native sign-in needs a signed-in Google user');
  r = await call({ action: 'native-start', challenge }, { authorization: 'Bearer tok-user1' });
  check(r.ok && docs[`nativeSignins/${challenge}`].uid === 'user1', 'Chrome records who signed in for the challenge');
  r = await call({ action: 'native-finish', verifier: crypto.randomBytes(32).toString('base64url') });
  check(r.status === 404 && !r.token, 'the wrong verifier gets nothing');
  r = await call({ action: 'native-finish', verifier });
  check(r.token === 'custom-user1', 'the app with the right verifier gets a sign-in token');
  r = await call({ action: 'native-finish', verifier });
  check(r.status === 404, 'it only works once');

  // ── App, with Android faked ──
  const browser = await launch();
  const here = { latitude: 33.4942, longitude: -111.9261 };
  const p = await newPage(browser, {
    geo: here,
    settings: { nearAlerts: true, nearAlertMiles: 10, locationEnabled: true },
    seed: [
      { id: 'far', name: 'Far Pho', status: 'want-to-try', lat: 33.70, lng: -111.92, tags: [], visits: [] },
      { id: 'near', name: 'Near Nobu', status: 'want-to-try', lat: 33.497, lng: -111.926, tags: [], visits: [] },
      { id: 'been', name: 'Been Here', status: 'visited', lat: 33.495, lng: -111.926, tags: [], visits: [] },
      { id: 'nopin', name: 'No Pin', status: 'want-to-try', tags: [], visits: [] },
    ],
  });
  await p.context().addInitScript(() => {
    window.__native = { setSpots: [], asked: [], opened: [] };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        NearbyAlerts: {
          status: async () => ({ location: true, background: window.__native.bg || false, notifications: true }),
          setSpots: async o => { window.__native.setSpots.push(o); return {}; },
          requestLocation: async () => { window.__native.asked.push('location'); return {}; },
          requestNotifications: async () => { window.__native.asked.push('notifications'); return {}; },
          requestBackground: async () => { window.__native.asked.push('background'); window.__native.bg = true; return { background: true }; },
        },
        Browser: { open: async o => { window.__native.opened.push(o.url); }, close: async () => {} },
      },
    };
  });
  await p.route(/wikimedia|overpass|nominatim/, rt => rt.abort());
  await p.route('**/api/verify-session', rt => {
    const body = JSON.parse(rt.request().postData() || '{}');
    return rt.fulfill({ json: body.action === 'native-finish' ? { token: 'custom-abc' } : {} });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(3500);
  const first = await p.evaluate(() => window.__native.setSpots.at(-1));
  check(first?.enabled === true && first.radiusMeters === 16093, `Android gets alerts on, at 10 miles (${JSON.stringify(first && { enabled: first.enabled, r: first.radiusMeters })})`);
  check(first?.spots.map(s => s.id).join() === 'near,far', `only pinned Want to Try spots go to Android, nearest first (${first?.spots.map(s => s.id)})`);

  await p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); openAccountModal(); });
  check(/Tap to get them when it's closed too/.test(await p.locator('#account-nearalerts-state').innerText()), 'the row offers alerts when the app is closed');
  await p.click('#account-nearalerts-row');
  check(/Pick a distance to set up alerts when it is closed too/.test(await p.locator('#nearalerts-note').innerText()), 'the chooser explains the closed-app option');
  await p.click('#nearalerts-choices [data-miles="25"]');
  await p.waitForTimeout(2200);
  check(await p.evaluate(() => window.__native.setSpots.at(-1).radiusMeters) === 40234, 'a new distance is handed to Android');
  check(await p.locator('#bg-location-overlay').isVisible() && /does not store it, share it, or use it for ads/.test(await p.locator('#bg-location-overlay').innerText()), 'background location is explained before Android asks');
  await p.click('#bg-location-allow');
  await p.waitForTimeout(500);
  check(await p.evaluate(() => window.__native.asked.join()) === 'location,notifications,background', 'then location, notifications and "all the time" are requested');
  await p.evaluate(() => openAccountModal());
  check(/even when the app is closed/.test(await p.locator('#account-nearalerts-state').innerText()), 'the row then says alerts work when the app is closed');
  await p.evaluate(() => closeAccountModal());

  // Saving a new Want to Try spot updates Android.
  await p.evaluate(() => { state.restaurants.push({ id: 'new', name: 'New Taco', status: 'want-to-try', lat: 33.50, lng: -111.93, tags: [], visits: [] }); saveData(); });
  await p.waitForTimeout(2000);
  check(await p.evaluate(() => window.__native.setSpots.at(-1).spots.some(s => s.id === 'new')), 'a newly saved spot is handed to Android');

  // ── Google sign-in goes through Chrome ──
  await p.evaluate(() => _handleGoogleAuth());
  await p.waitForTimeout(400);
  const opened = await p.evaluate(() => window.__native.opened.at(-1));
  const c = new URL(opened).searchParams.get('c');
  const v = await p.evaluate(() => localStorage.getItem('ftb_native_verifier_v1'));
  check(/native-signin\.html\?c=/.test(opened) && c === crypto.createHash('sha256').update(v).digest('base64url'), 'Google sign-in opens Chrome with only the challenge');
  await p.evaluate(() => { window.__signedIn = null; _auth.signInWithCustomToken = async t => { window.__signedIn = t; }; location.hash = 'native-signin-done'; _finishNativeSignIn(); });
  await p.waitForTimeout(600);
  check(await p.evaluate(() => window.__signedIn) === 'custom-abc' && await p.evaluate(() => !localStorage.getItem('ftb_native_verifier_v1') && location.hash === ''), 'back in the app it finishes signing in and forgets the verifier');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  // On the website, none of the Android parts run.
  const w = await newPage(browser, { seed: [{ id: 'x', name: 'X', status: 'want-to-try', lat: 33.5, lng: -111.9, tags: [], visits: [] }], settings: { nearAlerts: true, locationEnabled: true } });
  await w.route(/wikimedia|overpass|nominatim/, rt => rt.abort());
  await w.goto(`${BASE}/app.html`);
  await w.waitForTimeout(1500);
  check(await w.evaluate(() => NativeAlerts.available() === false && /while Feed The Bear is open|notifications are blocked/.test((openAccountModal(), document.getElementById('account-nearalerts-state').textContent))), 'the website keeps its own alerts and wording');
  check(w.errors.length === 0, `no page errors on the website (${w.errors.slice(0, 2).join(' | ')})`);

  // The sign-in page refuses to run without a challenge.
  await w.goto(`${BASE}/native-signin.html`);
  check(/Open this from the app/.test(await w.locator('#ns-title').innerText()), 'the Chrome sign-in page only works when opened from the app');

  await browser.close();
  finish('native');
})();
