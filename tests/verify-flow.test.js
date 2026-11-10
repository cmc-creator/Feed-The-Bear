// A new signup can use the diary right away and verifies in the background:
// the verify screen is a reminder (not a wall), cloud sync stays gated until
// verified, the joined email fires only after confirmation, and a server skip
// over the free limit shows the Grizzly upsell instead of failing silently.
const { BASE, check, launch, newPage, finish } = require('./lib');

const spot = (id, name) => ({ id, name, status: 'visited', tags: [], dishes: [], visits: [], updatedAt: 1 });

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [spot('guest', 'Guest spot')] });
  await p.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  const saveSpotsCalls = [];
  const pushCalls = [];
  let saveSpotsReply = { saved: 1, skipped: 0, removed: 0, limit: 25, plan: 'free' };
  await p.route('**/api/**', r => {
    const url = r.request().url();
    if (url.includes('/api/save-spots')) {
      saveSpotsCalls.push(1);
      return r.fulfill({ json: saveSpotsReply });
    }
    if (url.includes('/api/push')) {
      try { pushCalls.push(JSON.parse(r.request().postData() || '{}').action); } catch { pushCalls.push('?'); }
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { plan: 'free', following: [], followers: [] } });
  });
  await p.route('**/api/delete-account', r => r.fulfill({ json: { deleted: true } }));
  await p.addInitScript(() => {
    window.__cloud = {};
    window.__loadError = false;
    window.__deferLoad = false;
    window.__verifyNow = false;
    const auth = {
      currentUser: null,
      setPersistence: async () => {},
      onAuthStateChanged (fn) { window.__observer = fn; queueMicrotask(() => fn(null)); return () => {}; },
      async signOut () { this.currentUser = null; window.__observer(null); },
    };
    const db = {
      doc: path => ({
        get: async () => ({ exists: !!window.__cloud[path]?.profile, data: () => window.__cloud[path]?.profile || {} }),
        set: async () => {},
      }),
      collection: path => ({
        get: async () => ({ docs: (window.__cloud[path] || []).map(data => ({ data: () => data })) }),
      }),
      batch: () => {
        const paths = [];
        return { set: doc => paths.push(doc), delete: doc => paths.push(doc), commit: async () => window.__writes.push(paths) };
      },
    };
    window.firebase = {
      initializeApp () {},
      auth: Object.assign(() => auth, { GoogleAuthProvider: class {}, Auth: { Persistence: { LOCAL: 'local' } } }),
      firestore: () => db,
    };
    window.__signIn = (uid, opts = {}) => {
      const created = opts.created || '2026-11-10T22:00:00Z'; // after the verification cutoff
      const user = {
        uid, email: `${uid}@example.test`,
        emailVerified: !!opts.verified,
        metadata: { creationTime: created, lastSignInTime: created },
        providerData: [],
        getIdToken: async () => 'test-token',
        sendEmailVerification: async () => {},
        reload: async () => { if (window.__verifyNow) user.emailVerified = true; },
      };
      auth.currentUser = user;
      window.__testUser = user;
      window.__observer(user);
      return window._sessionTaskForTest();
    };
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForFunction(() => typeof window.__observer === 'function' && window._ftbAuthReady === true);
  await p.evaluate(() => { window._sessionTaskForTest = () => _sessionTask; });

  // ── 1. New unverified signup: reminder shows, diary still loads ──
  await p.evaluate(() => window.__signIn('newbie1'));
  await p.waitForFunction(() => !document.getElementById('auth-verify').classList.contains('hidden'));
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'guest')), 'unverified signup still gets the diary (guest spot adopted)');
  check(await p.evaluate(() => !!document.getElementById('auth-verify-later')), 'verify screen offers Continue to my diary');

  // ── 2. Dismiss to the diary ──
  await p.evaluate(() => document.getElementById('auth-verify-later').click());
  await p.waitForFunction(() => document.getElementById('auth-overlay').classList.contains('hidden'));
  check(true, 'Continue to my diary closes the verify screen');

  // ── 3. Save a spot locally: no cloud sync while unverified ──
  await p.waitForFunction(() => typeof photosReadyForSync === 'function' && photosReadyForSync());
  await p.evaluate(async () => {
    state.restaurants.push({ id: 'local1', name: 'Local spot', status: 'visited', tags: [], dishes: [], visits: [], updatedAt: 1 });
    await fbSaveRestaurants(window._ftbUid, state.restaurants);
  });
  check(saveSpotsCalls.length === 0, 'unverified account does not call save-spots (cloud sync gated)');
  check(await p.evaluate(() => state.restaurants.some(r => r.id === 'local1')), 'spot is saved locally while unverified');

  // ── 4. Sign out and back in: reminder shows again ──
  await p.evaluate(async () => { await fbSignOut(); });
  await p.evaluate(() => window.__signIn('newbie1'));
  await p.waitForFunction(() => !document.getElementById('auth-verify').classList.contains('hidden'));
  check(true, 'verify reminder shows again on the next sign-in');

  // ── 5. Verify: joined email fires, local spots sync ──
  await p.evaluate(() => { window.__verifyNow = true; });
  await p.evaluate(() => document.getElementById('auth-verify-check').click());
  await p.waitForFunction(() => document.getElementById('auth-overlay').classList.contains('hidden'));
  await p.waitForFunction(() => window.__testUser.emailVerified === true);
  await p.waitForTimeout(500); // joined email is fire-and-forget
  check(pushCalls.includes('joined'), 'joined email fires once the inbox is confirmed');
  await p.evaluate(async () => { await fbSaveRestaurants(window._ftbUid, state.restaurants); });
  check(saveSpotsCalls.length >= 1, 'verified account syncs local spots to the cloud');

  // ── 6. Server skip over the free limit: toast + upsell, once ──
  saveSpotsReply = { saved: 0, skipped: 2, removed: 0, limit: 25, plan: 'free' };
  await p.evaluate(async () => {
    for (let i = 0; i < 26; i++) state.restaurants.push({ id: 'x' + i, name: 'Spot ' + i, status: 'visited', tags: [], dishes: [], visits: [], updatedAt: 1 });
    await fbSaveRestaurants(window._ftbUid, state.restaurants);
  });
  // The toast queues behind any toast already showing, so wait for it.
  await p.waitForFunction(() => document.body.innerText.includes('Cub limit reached'), null, { timeout: 8000 });
  check(true, 'server skip shows the Cub limit reached toast');
  check(await p.evaluate(() => !document.getElementById('upgrade-overlay').classList.contains('hidden')), 'server skip opens the Grizzly upsell');
  await p.evaluate(() => closeUpgradeModal());
  await p.evaluate(async () => { await fbSaveRestaurants(window._ftbUid, state.restaurants); });
  check(await p.evaluate(() => document.getElementById('upgrade-overlay').classList.contains('hidden')), 'upsell does not reopen on every background sync');

  await browser.close();
  finish('verify-flow');
})();
