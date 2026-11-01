// Invites that work on the friend's end, follows that sync to your account,
// and an Add button nobody can miss.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();

  // ── The sender: no name yet, nothing rated, signed in (has a uid) ──
  const me = await newPage(browser, { seed: [{ id: 'w', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [] }] });
  await me.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await me.goto(`${BASE}/app.html`);
  await me.waitForTimeout(1500);
  await me.evaluate(() => { localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Foodie' })); window._ftbUid = 'inviterUid1234567890'; });
  me.once('dialog', d => d.accept('Connie'));
  const link = await me.evaluate(async () => {
    let shared = '';
    navigator.share = async ({ text, url }) => { shared = url; };
    await inviteFriend();
    return shared;
  });
  check(/\?ref=inviterUid1234567890#profile=/.test(link), `one link carries the free month and the profile (${link.slice(0, 90)})`);
  check(await me.evaluate(() => loadUserProfile()?.name) === 'Connie', 'asked for a name before sending');
  check(await me.evaluate(() => state.settings.shareLive === true), 'sharing live starts so followers get updates');

  // Account menu invite sends the same link.
  const viaAccount = await me.evaluate(async () => {
    let shared = '';
    navigator.share = async ({ url }) => { shared = url; };
    _auth = { currentUser: { uid: 'inviterUid1234567890' } };
    await shareInvite();
    return shared;
  }).catch(e => 'ERR ' + e.message);
  check(/\?ref=inviterUid1234567890#profile=/.test(viaAccount), `account Invite uses the same link (${String(viaAccount).slice(0, 60)})`);
  await me.context().close();

  // ── The friend: brand new, opens the link ──
  const path = link.slice(link.indexOf('/app.html'));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const f = await ctx.newPage();
  const errs = [];
  f.on('pageerror', e => errs.push(e.message));
  await f.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await f.goto(`${BASE}${path}`);
  await f.waitForTimeout(2500);
  check(await f.locator('#guest-profile-overlay').isVisible(), 'the friend sees the invite even though Connie has no ratings yet');
  check((await f.locator('#guest-profile-name').innerText()) === "Connie's food picks", 'it names who sent it');
  check(/Connie invited you.*30 days of Grizzly free/.test(await f.locator('#guest-profile-sub').innerText()), 'and mentions the free month');
  check(/just getting started/.test(await f.locator('#guest-profile-list').innerText()), 'an empty profile explains itself');
  check(await f.evaluate(() => localStorage.getItem('ftb_ref_v1')) === 'inviterUid1234567890', 'the free-month invite is remembered');
  await f.click('#guest-profile-follow');
  check(await f.evaluate(() => getFriends().some(x => x.name === 'Connie')), 'Follow works');
  check(await f.evaluate(() => friendsUpdatedAt() > 0), 'and is stamped for syncing');
  await f.click('#guest-profile-close');
  await f.waitForTimeout(400);
  const welcome = await f.locator('#cub-welcome .cw-body').innerText().catch(() => '');
  check(/Connie invited you!/.test(welcome), `the Cub welcome repeats who invited them (${welcome})`);

  // An old-style link with only ?ref still says a friend invited them.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: 'block' });
  const g = await ctx2.newPage();
  await g.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await g.goto(`${BASE}/app.html?ref=oldStyleRef12345`);
  await g.waitForTimeout(2500);
  check(/A friend invited you!/.test(await g.locator('#cub-welcome .cw-body').innerText().catch(() => '')), 'old ?ref links show the invite on the welcome');
  await ctx2.close();

  // ── Friends sync: newer cloud list wins, older one gets pushed ──
  const merged = await f.evaluate(() => {
    const writes = [];
    _db = { doc: () => ({ set: (data) => { writes.push(data); return Promise.resolve(); }, get: () => Promise.resolve({ exists: false, data: () => ({}) }) }), collection: () => ({ get: () => Promise.resolve({ docs: [] }) }) };
    window._ftbUid = 'friendUid12345678';
    const cloud = { friendsAt: Date.now() + 60000, friends: [{ key: 'id:zzz', name: 'Sam', data: { id: 'zzz', u: 'Sam', picks: [{ n: 'Bacanora', r: 5 }], w: [] } }] };
    _mergeFriendsFromCloud(cloud);
    const afterCloud = getFriends().map(x => x.name);
    // Now a local change: pushed up (after the debounce).
    saveFriends([...getFriends(), { key: 'id:yyy', name: 'Alex', data: { id: 'yyy', u: 'Alex', picks: [], w: [] } }]);
    return new Promise(res => setTimeout(() => res({ afterCloud, pushed: writes.at(-1)?.friends?.map(x => x.name) }), 1800));
  });
  check(merged.afterCloud.join() === 'Sam', `a newer list from the account replaces this device's (${merged.afterCloud})`);
  check(merged.pushed?.includes('Alex') && merged.pushed.includes('Sam'), `a follow here is saved to the account (${merged.pushed})`);
  await ctx.close();

  // ── Add button: labelled, bright, with a home shortcut ──
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'One Spot', cuisine: 'Pizza', status: 'want-to-try', tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  check((await p.locator('#mobile-add-btn .mobile-nav-fab-label').innerText()) === 'Add', 'the bottom button says Add');
  check(await p.evaluate(() => document.body.classList.contains('add-hint')), 'it pulses for someone with few places');
  check(await p.locator('#home-add-bar').isVisible(), 'home has an Add a place button near the top');
  const box = await p.locator('#home-add-bar').boundingBox();
  check(box && box.y < 844, `and it's on the first screen (y=${box && Math.round(box.y)})`);
  await p.click('#home-add-bar');
  await p.waitForTimeout(300);
  check(await p.locator('.qa-sheet:not(.hidden), #quick-add:not(.hidden), .qa-input').first().isVisible(), 'it opens Add a spot');
  await p.click('.qa-import');
  await p.waitForTimeout(400);
  check(await p.locator('#import-overlay').isVisible(), 'which links to importing a whole list');

  check(!errs.length && !p.errors.length, `no page errors ${[...errs, ...p.errors].join(' | ')}`);
  await browser.close();
  finish('invitefix');
})();
