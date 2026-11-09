const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.route('**/api/**', r => r.fulfill({ json: { following: [], followers: [], pages: {} } }));
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
    window.__signIn = uid => {
      auth.currentUser = { uid, email: `${uid}@example.test`, providerData: [], metadata: {}, getIdToken: async () => 'test-token' };
      __observer(auth.currentUser);
    };
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(700);
  await p.evaluate(async () => { __signIn('photoOwner'); await _sessionTask; });
  await closeAllDialogs(p);
  await p.evaluate(() => {
    window.__realCompress = readImageFileCompressed;
    readImageFileCompressed = (...args) => new Promise(resolve => { window.__finishPhoto = async () => resolve(await __realCompress(...args)); });
  });
  await p.evaluate(() => openEditProfile());
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#edit-photo-upload-btn')]);
  await chooser.setFiles(path.join(ROOT, 'assets', 'food', 'tacos.jpg'));
  await p.waitForFunction(() => !!window.__finishPhoto);
  check(await p.locator('#edit-profile-save-btn').isDisabled() && await p.locator('#edit-photo-remove-btn').isDisabled(),
    'saving and removal wait until the chosen image finishes processing');
  await p.evaluate(() => document.getElementById('edit-profile-save-btn').click());
  check(await p.evaluate(() => !loadUserProfile()?.photo), 'a premature Save cannot replace the photo with the old default');
  await p.evaluate(() => window.__finishPhoto());
  await p.waitForFunction(() => !document.getElementById('edit-profile-save-btn').disabled);
  await p.fill('#edit-name', 'Photo Foodie');
  await p.click('#edit-profile-save-btn');
  const selected = await p.evaluate(() => loadUserProfile().photo);
  check(selected.startsWith('data:image/'), 'a chosen photo is saved as an actual image');
  check(await p.evaluate(() => loadUserProfile().visualUpdatedAt > 0 && loadUserProfile().photo.length < 200000),
    'explicit photo choice has its own timestamp and a cloud-safe compressed size');
  await p.evaluate(() => {
    window.__saved = loadUserProfile();
    __profiles['users/photoOwner/meta/profile'] = { name: 'Photo Foodie', avatar: 'bear-chef', photo: '',
      plan: 'free', updatedAt: Date.now() + 10000 };
  });
  await p.evaluate(async () => { __signIn('photoOwner'); await _sessionTask; });
  check(await p.evaluate(photo => loadUserProfile().photo === photo, selected),
    'a newer legacy default cloud profile cannot erase the locally chosen photo');
  check(await p.locator('#header-avatar img').getAttribute('src') === selected,
    'header displays the saved photo after same-account restore');
  await p.evaluate(async () => { await _auth.signOut(); await _sessionTask; });
  check(await p.evaluate(() => !loadUserProfile()?.photo), 'sign-out hides private profile data');
  await p.evaluate(async () => { __signIn('otherOwner'); await _sessionTask; });
  check(await p.evaluate(photo => loadUserProfile()?.photo !== photo, selected),
    'another account never inherits the selected photo');
  await p.evaluate(async () => { __signIn('photoOwner'); await _sessionTask; });
  check(await p.evaluate(photo => loadUserProfile().photo === photo, selected),
    'returning to the photo owner restores the exact selected image');
  await p.evaluate(() => {
    __profiles['users/photoOwner/meta/profile'] = { name: 'Photo Foodie', avatar: DEFAULT_AVATAR, photo: '',
      visualUpdatedAt: Date.now() + 20000, updatedAt: Date.now() + 20000 };
  });
  await p.evaluate(async () => { __signIn('photoOwner'); await _sessionTask; });
  check(await p.evaluate(() => loadUserProfile().photo === ''),
    'a newer explicit removal from another device remains respected');
  await p.evaluate(photo => {
    __profiles['users/photoOwner/meta/profile'] = { name: 'Photo Foodie', photo, avatar: DEFAULT_AVATAR,
      visualUpdatedAt: Date.now() + 30000, updatedAt: Date.now() + 30000 };
  }, selected);
  await p.evaluate(async () => { __signIn('photoOwner'); await _sessionTask; });
  check(await p.evaluate(photo => loadUserProfile().photo === photo, selected),
    'a newer explicit photo selection from another device restores correctly');
  await p.evaluate(() => {
    window.__visualAt = loadUserProfile().visualUpdatedAt;
    applyThemeChoice('mint');
  });
  check(await p.evaluate(photo => loadUserProfile().photo === photo && loadUserProfile().visualUpdatedAt === __visualAt, selected),
    'changing appearance does not change the saved photo or its choice timestamp');
  await p.evaluate(() => openEditProfile());
  await p.click('#edit-photo-remove-btn');
  await p.click('#edit-profile-save-btn');
  check(await p.evaluate(() => loadUserProfile().photo === ''), 'intentional local photo removal is saved');
  await p.evaluate(async () => { __signIn('photoOwner'); await _sessionTask; });
  check(await p.evaluate(() => loadUserProfile().photo === ''), 'intentional removal survives the next login');
  await p.evaluate(() => openEditProfile());
  const [lateChooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#edit-photo-upload-btn')]);
  await p.evaluate(() => { delete window.__finishPhoto; });
  await lateChooser.setFiles(path.join(ROOT, 'assets', 'food', 'tacos.jpg'));
  await p.waitForFunction(() => !!window.__finishPhoto);
  await p.evaluate(async () => {
    __signIn('otherOwner'); await _sessionTask; await __finishPhoto();
  });
  check(await p.evaluate(() => !loadUserProfile()?.photo), 'a late photo upload cannot attach to a different signed-in account');
  await p.evaluate(() => { readImageFileCompressed = __realCompress; });
  await p.reload();
  await p.waitForTimeout(700);
  await p.evaluate(async () => { __signIn('photoOwner'); await _sessionTask; });
  check(await p.evaluate(() => loadUserProfile().photo === ''), 'a cold reload restores the owner profile without resurrecting a removed photo');
  check(!p.errors.length, `no unexpected page errors (${p.errors.join(' | ')})`);
  await browser.close();
  finish('profile-persistence');
})();
