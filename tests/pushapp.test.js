// Friend notifications in the Android app (firebase.js FriendPings), with a
// fake Capacitor PushNotifications plugin: asks once after following, registers
// the phone and its follows, and handles a notification arriving or being tapped.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Bacanora', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] }] });
  await p.addInitScript(() => {
    const listeners = {};
    window._push = { asked: 0, registered: 0, perm: 'prompt', listeners };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        PushNotifications: {
          checkPermissions: async () => ({ receive: window._push.perm }),
          requestPermissions: async () => { window._push.asked++; window._push.perm = 'granted'; return { receive: 'granted' }; },
          register: async () => { window._push.registered++; setTimeout(() => listeners.registration?.({ value: 'fcm-test-token-1234567890' }), 10); },
          unregister: async () => {},
          addListener: (name, fn) => { listeners[name] = fn; return { remove () {} }; },
        },
      },
    };
  });
  const calls = [];
  await p.route('**/api/push', r => { calls.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ json: { ok: true } }); });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  // Signed in (the push calls carry the ID token).
  await p.evaluate(() => { window._ftbUid = 'phoneUser000001'; _auth = { currentUser: { uid: 'phoneUser000001', getIdToken: async () => 'id-token' } }; });

  // Following a friend asks for notifications once, then registers the phone and the follow.
  await p.evaluate(() => followFriend({ id: 'samshare0001', u: 'Sam', picks: [], w: [] }));
  await p.waitForTimeout(400);
  check(await p.evaluate(() => window._push.asked) === 1 && await p.evaluate(() => window._push.registered) === 1, 'following a friend asks once and registers');
  check(calls.some(c => c.action === 'register' && c.token === 'fcm-test-token-1234567890'), 'the phone is registered with the server');
  check(calls.some(c => c.action === 'follows' && c.ids.includes('samshare0001')), 'and who it follows');

  // A second follow doesn't ask again.
  await p.evaluate(() => { window._ftbPlan = 'grizzly'; followFriend({ id: 'alexshare002', u: 'Alex', picks: [], w: [] }); });
  await p.waitForTimeout(2200);
  check(await p.evaluate(() => window._push.asked) === 1, 'it never asks twice');
  check(calls.filter(c => c.action === 'follows').at(-1)?.ids.length === 2, 'new follows are sent too');

  // A notification while the app is open shows in the app; tapping one opens Friends.
  await p.evaluate(() => window._push.listeners.pushNotificationReceived({ title: 'Sam ate at Bacanora', body: 'Tap to see' }));
  check(/Sam ate at Bacanora/.test(await p.locator('#toast-container').innerText()), 'a notification while the app is open shows as a message');
  await p.evaluate(() => window._push.listeners.pushNotificationActionPerformed({ notification: {} }));
  await p.waitForTimeout(700);
  check(await p.locator('#friends-overlay').isVisible(), 'tapping a notification opens Friends');

  // A reinstall (already following friends, never asked on this phone) is asked at sign-in.
  await p.evaluate(() => { localStorage.removeItem('ftb_push_asked'); window._push.perm = 'prompt'; window._push.asked = 0; FriendPings.start(); });
  await p.waitForTimeout(6600);
  check(await p.evaluate(() => window._push.asked) === 1, 'after a reinstall, someone who follows friends is asked once at sign-in');

  // An up-to-date app shows no update banner; an old one (no notifications) offers the newest build.
  await closeAllDialogs(p);
  check(await p.locator('#app-update-banner').count() === 0, 'an up-to-date app shows no update banner');
  const opened = await p.evaluate(() => {
    let url = '';
    delete window.Capacitor.Plugins.PushNotifications;
    window.Capacitor.Plugins.Browser = { open: async o => { url = o.url; } };
    checkAndroidAppVersion();
    document.querySelector('#app-update-banner .app-update-go')?.click();
    return new Promise(r => setTimeout(() => r(url), 50));
  });
  check(await p.locator('#app-update-banner').isVisible(), 'an older app offers the update');
  check(opened === 'https://github.com/cmc-creator/Feed-The-Bear/releases/latest/download/feed-the-bear.apk', `Update opens the newest build (${opened})`);
  await p.click('#app-update-banner .app-update-later');
  await p.evaluate(() => checkAndroidAppVersion());
  check(await p.locator('#app-update-banner').count() === 0, '"Later" hides it for the day');

  // Paid lookups carry the sign-in (api/_guard.js checks it).
  let token = '';
  await p.route('**/api/place-info?**', r => { token = r.request().headers()['x-ftb-token'] || ''; r.fulfill({ json: { places: [] } }); });
  await p.evaluate(() => apiGet('/api/place-info?mode=search&q=tacos'));
  check(token === 'id-token', `place lookups send the signed-in token (${token})`);

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('pushapp');
})();
