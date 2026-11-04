// Find friends by username: opt-in, exact match only, one username per
// person, and Follow from the result.
const path = require('path');
const Module = require('module');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  // ── Server (api/handle.js) with a fake Firebase ──
  const docs = { 'profiles/connieshare01': { uid: 'connie' }, 'profiles/samshare0001': { uid: 'sam' } };
  const ref = p => ({ p, get: async () => ({ data: () => docs[p] }), set: async d => { docs[p] = d; }, delete: async () => { delete docs[p]; } });
  const fake = {
    apps: [1],
    auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
    firestore: () => ({
      doc: ref,
      runTransaction: async fn => fn({ get: r => r.get(), set: (r, d) => { docs[r.p] = d; }, delete: r => { delete docs[r.p]; } }),
    }),
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  const api = require(path.join(ROOT, 'api', 'handle.js'));
  Module._load = orig;
  const call = (uid, { method = 'GET', query = {}, body } = {}) => new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
    api({ method, query, body, headers: uid ? { 'x-ftb-token': `token-${uid}` } : {} }, res);
  });

  check((await call(null, { query: { q: 'connie' } })).status === 401, 'looking someone up needs a signed-in member');
  check((await call('sam', { query: { q: 'connie' } })).data.found === false, 'nobody is findable until they pick a username');
  let r = await call('connie', { method: 'POST', body: { action: 'claim', handle: '@Connie_Eats', id: 'connieshare01', name: 'Connie' } });
  check(r.status === 200 && r.data.handle === 'connie_eats', 'Connie picks @connie_eats');
  r = await call('sam', { method: 'POST', body: { action: 'claim', handle: 'connie_eats', id: 'samshare0001', name: 'Sam' } });
  check(r.status === 409, 'someone else can\'t take it');
  r = await call('sam', { method: 'POST', body: { action: 'claim', handle: 'sam_i_am', id: 'connieshare01', name: 'Sam' } });
  check(r.status === 403, "you can't point a username at someone else's profile");
  check((await call('sam', { method: 'POST', body: { action: 'claim', handle: 'admin', id: 'samshare0001' } })).status === 409, 'reserved names are refused');
  r = await call('sam', { query: { q: 'Connie_Eats' } });
  check(r.data.found && r.data.id === 'connieshare01' && r.data.u === 'Connie', 'an exact search finds her');
  check((await call('sam', { query: { q: 'connie' } })).data.found === false, 'a partial name finds nothing (no browsing)');
  await call('sam', { method: 'POST', body: { action: 'claim', handle: 'sam_i_am', id: 'samnotlive99', name: 'Connie' } });
  check((await call('connie', { query: { q: 'sam_i_am' } })).data.found === false, "a username whose profile isn't live (or isn't theirs) finds nothing");
  docs['profiles/samnotlive99'] = { uid: 'sam', u: 'Sam' };
  r = await call('connie', { query: { q: 'sam_i_am' } });
  check(r.data.found && r.data.u === 'Sam', `once it's live, it shows the profile's real name, not the one sent with the claim (${r.data.u})`);
  await call('connie', { method: 'POST', body: { action: 'claim', handle: 'connie_b', id: 'connieshare01', name: 'Connie' } });
  check(!docs['handles/connie_eats'] && docs['handles/connie_b']?.uid === 'connie', 'changing your username frees the old one');
  await call('connie', { method: 'POST', body: { action: 'release' } });
  check(!docs['handles/connie_b'] && !docs['handleOf/connie'], 'and you can stop being findable');

  // Followers: Sam joins from Connie's invite and follows her; she sees him and can follow back.
  docs['profiles/samshare0001'] = { uid: 'sam', u: 'Sam' };
  docs['profiles/connieshare01'] = { uid: 'connie', u: 'Connie' };
  r = await call('sam', { method: 'POST', body: { action: 'followed', id: 'connieshare01', me: 'samshare0001' } });
  check(r.status === 200, 'following someone notes it on their side');
  r = await call('connie', { query: { followers: '1' } });
  check(r.data.followers?.length === 1 && r.data.followers[0].id === 'samshare0001' && r.data.followers[0].u === 'Sam', `Connie sees Sam under "Following you" (${JSON.stringify(r.data)})`);
  await call('sam', { method: 'POST', body: { action: 'followed', id: 'connieshare01', me: 'samshare0001' } });
  check((await call('connie', { query: { followers: '1' } })).data.followers.length === 1, 'following twice lists them once');
  r = await call('mallory', { method: 'POST', body: { action: 'followed', id: 'connieshare01', me: 'samshare0001' } });
  check(r.status === 403, "you can't follow in someone else's name");
  check((await call(null, { query: { followers: '1' } })).status === 401, 'the followers list needs sign-in');
  delete docs['profiles/samshare0001'];
  check((await call('connie', { query: { followers: '1' } })).data.followers.length === 0, 'a deleted account drops off the list');
  docs['profiles/samshare0001'] = { uid: 'sam', u: 'Sam' };
  await call('sam', { method: 'POST', body: { action: 'unfollowed', id: 'connieshare01', me: 'samshare0001' } });
  check((await call('connie', { query: { followers: '1' } })).data.followers.length === 0, 'unfollowing takes them off');

  // ── The Friends screen ──
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Bacanora', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  const claims = [];
  await p.route('**/api/handle**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') { const b = JSON.parse(req.postData()); claims.push(b); return route.fulfill({ json: b.action === 'claim' ? { handle: b.handle } : { ok: true } }); }
    if (url.searchParams.get('mine')) return route.fulfill({ json: { handle: '' } });
    if (url.searchParams.get('followers')) return route.fulfill({ json: { followers: [{ id: 'jojoshare001', u: 'Jo' }] } });
    return route.fulfill({ json: url.searchParams.get('q') === 'sam_i_am' ? { found: true, u: 'Sam', id: 'samshare0001' } : { found: false } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  await p.evaluate(() => { window._ftbUid = 'freeUser000001'; window._ftbPlan = 'free'; localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie' })); });

  // Free accounts can open Friends and follow the one friend they find.
  await p.evaluate(() => openFoodieFriends());
  await p.waitForTimeout(300);
  check(await p.locator('#friends-overlay').isVisible(), 'a free account can open Friends');
  await p.fill('#friends-find-input', '@nobody_here');
  await p.click('#friends-find-form button[type=submit]');
  await p.waitForTimeout(300);
  check(/No one is using @nobody_here/.test(await p.locator('#friends-find-result').innerText()), 'an unknown username says so');
  await p.fill('#friends-find-input', 'sam_i_am');
  await p.click('#friends-find-form button[type=submit]');
  await p.waitForSelector('.friends-find-follow', { timeout: 3000 }).catch(() => {});
  await p.click('.friends-find-follow');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => getFriends().some(f => f.data?.id === 'samshare0001' && f.name === 'Sam')), 'Follow from the search result follows them');
  await p.waitForTimeout(400);
  check(claims.some(b => b.action === 'followed' && b.id === 'samshare0001' && b.me), 'and tells the server, so Sam sees you under "Following you"');

  // Someone who joined from your invite shows up, with Follow back.
  check(/Following you \(1\)/i.test(await p.locator('#friends-list').innerText()) && await p.locator('.friend-follow-back').isVisible(), 'people who follow you show under "Following you" with Follow back');
  await p.evaluate(() => { window._ftbPlan = 'grizzly'; localStorage.setItem('ftb_plan_v1', 'grizzly'); });
  await p.click('.friend-follow-back');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => getFriends().some(f => f.data?.id === 'jojoshare001')) && /You follow each other/.test(await p.locator('#friends-list').innerText()), 'Follow back follows them, and it says you follow each other');
  // Sent: someone you follow who hasn't followed back, and invites you shared.
  const samRow = p.locator('.friend-row', { hasText: 'Sam' }).last();
  check(/Sent · waiting for them to follow back/.test(await samRow.innerText()), 'someone you follow who has not followed back shows as Sent');
  const joRow = p.locator('.friend-row', { hasText: 'Jo' }).last();
  check(!/Sent ·/.test(await joRow.innerText()), 'a friend who follows you back is not marked Sent');
  await p.evaluate(() => { noteInviteSent(); noteInviteSent(); });
  await p.waitForTimeout(200);
  const listText = await p.locator('#friends-list').innerText();
  check(/Sent invites \(2\)/i.test(listText) && /Today/.test(listText), 'invites you sent show under "Sent invites"');

  // Picking your own username.
  await p.click('.friends-handle-edit');
  await p.fill('.friends-handle-form input', 'Connie_Eats');
  await p.click('.friends-handle-form button[type=submit]');
  await p.waitForTimeout(400);
  const claim = claims.find(b => b.action === 'claim');
  check(claim?.handle === 'connie_eats' && claim.id, 'picking a username sends it with your profile');
  check(/@connie_eats/.test(await p.locator('#friends-handle').innerText()), 'and shows it');
  check(await p.evaluate(() => state.settings.shareLive === true), 'and starts sharing so followers get your picks');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('handle');
})();
