// Returning user must never be trapped on the avatar picker, and a new
// user who picks an avatar must not be asked again.
// Bug: initUserProfile runs at boot before sign-in resolves, so
// loadUserProfile() returns null (uid unknown / account mid-switch) and the
// avatar setup opens on every app open — and nothing closes it once auth
// settles, so the user is stuck on it.
const { BASE, check, launch, newPage, finish } = require('./lib');

const OWNER = 'returningUid00001';

async function mockFirebase (p, { fireAtBoot = false } = {}) {
  await p.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route(/overpass|nominatim|open-meteo|place-info/, r => r.abort());
  await p.route('**/api/**', r => r.fulfill({ json: { following: [], followers: [], pages: {} } }));
  await p.addInitScript(({ fireAtBoot }) => {
    window.__profiles = {};
    const auth = { currentUser: null, setPersistence: async () => {},
      onAuthStateChanged(fn) { window.__observer = fn; if (fireAtBoot) queueMicrotask(() => fn(null)); },
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
    window.__signIn = uid => {
      auth.currentUser = { uid, email: `${uid}@example.test`, emailVerified: true, providerData: [], metadata: {}, getIdToken: async () => 'test-token' };
      __observer(auth.currentUser);
    };
  }, { fireAtBoot });
}

async function seedReturningUser (browser) {
  const p = await newPage(browser, { seed: [] });
  await mockFirebase(p);
  await p.addInitScript(uid => {
    localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie', avatar: 'bear-chef', joinDate: new Date().toISOString() }));
    localStorage.setItem('ftb_data_owner_v1', uid);
    localStorage.setItem('ftb_uid_v1', uid);
    localStorage.setItem('ftb_settings_v1', JSON.stringify({ onboardingDone: true }));
    localStorage.setItem('ftb_restaurants_v2', JSON.stringify([]));
  }, OWNER);
  return p;
}

(async () => {
  const browser = await launch();

  // 1. Returning user, sign-in still resolving at boot: the avatar picker
  //    must NOT open — the diary is the landing page.
  const p = await seedReturningUser(browser);
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  check(await p.locator('#profile-setup-overlay').isHidden(),
    'returning user, auth not yet resolved: avatar picker stays hidden');
  check(await p.evaluate(() => loadUserProfile()?.avatar === 'bear-chef'),
    'returning user, auth not yet resolved: saved avatar is still readable');

  // 2. Sign-in now resolves for the same account: the picker must stay
  //    hidden (pre-fix it was still open / re-opened, trapping the user).
  await p.evaluate(async () => { __signIn('returningUid00001'); await _sessionTask; });
  await p.waitForTimeout(800);
  check(await p.locator('#profile-setup-overlay').isHidden(),
    'returning user after sign-in resolves: avatar picker stays hidden');
  check(await p.evaluate(() => loadUserProfile()?.avatar === 'bear-chef'),
    'returning user after sign-in resolves: saved avatar survives the restore');
  check(await p.locator('.restaurant-card, #home-empty, #den-empty, main').first().isVisible(),
    'returning user after sign-in resolves: the diary/home is shown');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  // 3. A genuine new user (no profile at all) is NOT stranded on the picker
  //    either: they reach the diary, can pick an avatar via Edit Profile,
  //    and are never asked again after it is saved.
  const q = await newPage(browser, { seed: [] });
  await mockFirebase(q);
  await q.addInitScript(() => {
    localStorage.setItem('ftb_settings_v1', JSON.stringify({ onboardingDone: true }));
    localStorage.setItem('ftb_restaurants_v2', JSON.stringify([]));
  });
  await q.goto(`${BASE}/app.html`);
  await q.waitForTimeout(900);
  await q.evaluate(async () => { __signIn('brandNewUid00001'); await _sessionTask; });
  await q.waitForTimeout(900);
  check(await q.locator('#profile-setup-overlay').isHidden(),
    'genuine new user: avatar picker does not trap them on the diary');
  check(await q.evaluate(() => !!loadUserProfile()),
    'genuine new user: a profile exists so the diary opens');
  await q.evaluate(() => openEditProfile());
  await q.fill('#edit-name', 'New Foodie');
  await q.locator('#edit-avatar-grid .avatar-option').nth(2).click();
  await q.click('#edit-profile-save-btn');
  await q.waitForTimeout(500);
  const picked = await q.evaluate(() => loadUserProfile()?.avatar);
  check(await q.evaluate(() => loadUserProfile()?.name === 'New Foodie' && !!loadUserProfile()?.avatar),
    'new user: the chosen name and avatar are saved via Edit Profile');
  check(picked && picked !== 'bear-chef',
    'new user: a non-default avatar was actually picked');
  // Reload: the saved avatar must take them straight to the diary.
  await q.reload();
  await q.waitForTimeout(1200);
  check(await q.locator('#profile-setup-overlay').isHidden(),
    'new user after reload: avatar picker is not shown again');
  check(await q.evaluate(() => loadUserProfile()?.name === 'New Foodie'),
    'new user after reload: the saved profile is still there');
  await q.close();

  await browser.close();
  finish('avatar-stuck');
})();
