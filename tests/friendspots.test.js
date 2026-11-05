// A friend's spots you don't have yet: see them from home or Friends, add one
// or all of them to Want to Try. And an invite opened while signed out waits
// for sign-in, then follows the inviter and shows their spots.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const CONNIE = {
  v: 2, id: 'connie12345', u: 'Connie', w: [], ts: Date.now(),
  picks: [
    { n: 'Tacos Chiwas', c: 'Mexican', r: 5, a: 'Phoenix', g: ['Birria quesatacos'] },
    { n: 'Pizzeria Bianco', c: 'Pizza', r: 5, a: 'Phoenix' },
    { n: 'Little Miss BBQ', c: 'BBQ', r: 4, a: 'Phoenix', g: ['Brisket'] },
  ],
};
const ME = [{ id: 'm1', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], dateAdded: '2026-09-05', visits: [] }];

(async () => {
  const browser = await launch();

  // ── Already following Connie: home says what's new, one tap adds it all ──
  const me = await newPage(browser, { seed: ME });
  await me.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await me.goto(`${BASE}/app.html`);
  await me.waitForTimeout(1500);
  await me.evaluate(c => { saveFriends([{ key: `id:${c.id}`, name: c.u, data: c, savedAt: Date.now() }]); renderFriendsFeedHome(); }, CONNIE);
  const nudge = await me.locator('.ff-new').innerText().catch(() => '');
  check(/Connie has 2 spots you don't have yet/.test(nudge), `home: what Connie has that you don't ("${nudge.trim()}")`);
  await me.click('.ff-new-see');
  await me.waitForTimeout(300);
  check(await me.locator('#guest-profile-overlay').isVisible(), 'See them opens her spots');
  check((await me.locator('#guest-profile-name').innerText()) === "Connie's spots", 'titled with her name');
  check(/On your list/.test(await me.locator('#guest-profile-list').innerText()), 'a spot you already have is marked');
  check(await me.locator('.guest-add').count() === 2, 'the others have an Add button');
  check(/Add all 2/.test(await me.locator('#guest-profile-addall').innerText()), 'and Add all says how many');
  await me.locator('.guest-add').first().click();
  await me.waitForTimeout(200);
  check(await me.evaluate(() => state.restaurants.some(r => r.name === 'Pizzeria Bianco' && r.status === 'want-to-try' && r.tags.includes('From a friend'))), 'Add puts it on Want to Try');
  check(await me.locator('#guest-profile-addall').isHidden(), 'one left: no Add all needed');
  await me.locator('.guest-add').first().click();
  await me.waitForTimeout(200);
  check(await me.evaluate(() => state.restaurants.find(r => r.name === 'Little Miss BBQ')?.dishes?.some(d => d.name === 'Brisket' && d.verdict === 'want')), 'her go-to order comes along to try');
  await me.click('#guest-profile-close');
  await me.waitForTimeout(200);
  check(await me.locator('.ff-new').count() === 0, 'nothing new left: the nudge goes away');

  // Add all, from the Friends screen.
  await me.evaluate(c => {
    state.restaurants = state.restaurants.filter(r => r.id === 'm1'); saveData();
    openFoodieFriends();
  }, CONNIE);
  await me.waitForTimeout(400);
  check(/2 new spots/.test(await me.locator('.friend-spots').innerText()), 'Friends: the row says how many are new');
  await me.click('.friend-spots');
  await me.waitForTimeout(300);
  await me.click('#guest-profile-addall');
  await me.waitForTimeout(300);
  check(await me.evaluate(() => state.restaurants.length) === 3 && await me.locator('.guest-add').count() === 0, 'Add all adds every spot you were missing');
  await me.click('#guest-profile-close');
  await closeAllDialogs(me);
  await me.context().close();

  // ── Signed out: the invite waits for sign-in ──
  const g = await newPage(browser);
  await g.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await g.addInitScript(() => { try { localStorage.setItem('ftb_test_auth_gate', '1'); } catch {} });
  const hash = await g.evaluate(c => '#profile=' + btoa(unescape(encodeURIComponent(JSON.stringify(c)))), CONNIE);
  await g.goto(`${BASE}/app.html?accept=1${hash}`);
  await g.waitForTimeout(2500);
  check(await g.locator('#guest-profile-overlay').isHidden(), 'signed out: the spots wait behind sign-in');
  const sub = await g.locator('#auth-overlay .auth-sub').innerText().catch(() => '');
  check(/Connie invited you!.*follow Connie/.test(sub), `the sign-in sheet says who invited them ("${sub}")`);
  // Signing in (simulated): the app picks the invite back up.
  await g.evaluate(() => { localStorage.removeItem('ftb_test_auth_gate'); window._ftbUid = 'newFriendUid1234'; closeAuthModal(); resumePendingInvite(); });
  await g.waitForTimeout(300);
  check(await g.evaluate(() => getFriends().some(f => f.name === 'Connie')), 'after sign-in they follow Connie');
  check((await g.locator('#guest-profile-name').innerText()) === 'Connie invited you 🐻' && await g.locator('.guest-add').count() === 3, 'and see all her spots to add');
  check(await g.evaluate(() => !localStorage.getItem('ftb_pending_invite_v1')), 'the invite is used up');

  await browser.close();
  finish('friendspots');
})();
