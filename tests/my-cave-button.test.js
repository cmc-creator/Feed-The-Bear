// "My Cave" button at the top of the homepage: a small button in the header
// that takes the user to their own Bear Cave (their /@you personal page).
// - Signed in with a live page -> opens the cave URL.
// - Signed in but no username yet, or the page is off -> opens the cave setup.
// - Not signed in -> opens the sign-in sheet first.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

// Fake Firebase (as in avatar-stuck.test.js): the app's firebase.js needs the
// SDK to exist or it logs an init error, and ftbApiHeaders waits up to 4s for
// auth to settle. Firing the auth observer at boot (signed out) marks auth
// ready immediately, so API calls don't stall.
async function mockFirebase (p) {
  await p.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.addInitScript(() => {
    window.__profiles = {};
    const auth = { currentUser: null, setPersistence: async () => {},
      onAuthStateChanged(fn) { window.__observer = fn; queueMicrotask(() => fn(null)); },
      async signOut() { this.currentUser = null; __observer(null); } };
    const db = {
      doc: path => ({
        get: async () => ({ exists: !!__profiles[path], data: () => __profiles[path] || {} }),
        set: async data => { __profiles[path] = { ...__profiles[path], ...data }; },
      }),
      collection: () => ({ get: async () => ({ docs: [] }) }),
      batch: () => ({ set() {}, delete() {}, commit: async () => {} }),
    };
    window.firebase = { initializeApp() {}, firestore: () => db,
      auth: Object.assign(() => auth, { GoogleAuthProvider: class {}, Auth: { Persistence: { LOCAL: 'local' } } }) };
  });
}

async function mockApi (p, handleState) {
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo/, r => r.abort());
  await p.route('**/api/**', r => r.fulfill({ json: { following: [], followers: [], pages: {} } }));
  // Specific handle stub wins over the generic /api/** stub above.
  await p.route('**/api/handle**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mine')) return route.fulfill({ json: handleState });
    return route.fulfill({ json: {} });
  });
}

async function openHome (browser, { grizzly = false, handleState = {} } = {}) {
  const p = await newPage(browser, { seed: [] });
  if (grizzly) {
    // Signed in, per page (not the sticky asGrizzly flag): hold a uid the app
    // can't clear when the mocked auth fires signed-out, as the real fixture does.
    await p.addInitScript(() => {
      localStorage.setItem('ftb_plan_v1', 'grizzly');
      let uid = 'testCaveUser00001';
      Object.defineProperty(window, '_ftbUid', { configurable: true, get: () => uid, set: v => { if (v) uid = v; } });
    });
  }
  await mockFirebase(p);
  await mockApi(p, handleState);
  await p.addInitScript(() => {
    window.__openedUrls = [];
    window.open = (url, target, features) => { window.__openedUrls.push(String(url)); return null; };
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  return p;
}

(async () => {
  const browser = await launch();

  // 1. Signed in, live page: the button is there and opens the cave URL.
  let p = await openHome(browser, { grizzly: true, handleState: { handle: 'connie_eats', public: true, views: 3, joins: 1, votes: 2 } });
  const btn = p.locator('#header-cave-btn');
  check(await btn.count() === 1, 'the header has a My Cave button');
  check(await btn.isVisible(), 'the My Cave button is visible on the homepage');
  check(await btn.evaluate(el => el.getAttribute('aria-label') === 'My Cave' && el.textContent.includes('My Cave')),
    'the button is labelled My Cave');
  check(await btn.evaluate(el => el.closest('.app-header') !== null), 'the button sits in the top header bar');
  await btn.click();
  await p.waitForFunction(() => window.__openedUrls.length > 0, null, { timeout: 10000 }).catch(() => {});
  const opened = await p.evaluate(() => window.__openedUrls);
  check(opened.length === 1 && opened[0] === 'https://www.feed-the-bear.com/@connie_eats',
    `signed in with a live page: tapping My Cave opens the cave (${opened.join(', ') || 'nothing opened'})`);
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  // 2. Signed in, no username yet: the cave setup opens instead.
  p = await openHome(browser, { grizzly: true, handleState: { handle: '' } });
  await p.locator('#header-cave-btn').click();
  await p.waitForSelector('#handle-overlay:not(.hidden)', { timeout: 10000 }).catch(() => {});
  check(await p.locator('#handle-overlay').isVisible(), 'signed in with no username: tapping My Cave opens the cave setup');
  await p.close();

  // 3. Signed in, username but the page is off: the cave setup opens instead.
  p = await openHome(browser, { grizzly: true, handleState: { handle: 'connie_eats', public: false } });
  await p.locator('#header-cave-btn').click();
  await p.waitForSelector('#handle-overlay:not(.hidden)', { timeout: 10000 }).catch(() => {});
  check(await p.locator('#handle-overlay').isVisible(), 'signed in with the page off: tapping My Cave opens the cave setup');
  await p.close();

  // 4. Not signed in: the sign-in sheet opens first.
  p = await openHome(browser, { handleState: {} });
  await closeAllDialogs(p);
  check(await p.locator('#auth-overlay').isHidden(), 'guest: the sign-in sheet starts hidden');
  await p.locator('#header-cave-btn').click();
  await p.waitForSelector('#auth-overlay:not(.hidden)', { timeout: 10000 }).catch(() => {});
  check(await p.locator('#auth-overlay').isVisible(), 'guest: tapping My Cave opens the sign-in sheet first');
  await p.close();

  await browser.close();
  finish('my-cave-button');
})();
