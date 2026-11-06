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
      collection: c => {
        const where = (field, op, val) => {
          const q = { limit: () => q, get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(c + '/') && docs[k][field] === val).map(k => ({ id: k.slice(c.length + 1), data: () => docs[k], ref: ref(k) })) }) };
          return q;
        };
        const all = { get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(c + '/') && !k.slice(c.length + 1).includes('/')).map(k => ({ id: k.slice(c.length + 1), data: () => docs[k], ref: ref(k) })) }) };
        return { where, limit: () => all };
      },
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
  // Sam lost his list in a sync: who he follows comes back from Connie's followers list.
  docs['profiles/connienewer01'] = { uid: 'connie', u: 'Connie B', updatedAt: '2026-11-01' };
  r = await call('sam', { query: { following: '1' } });
  check(r.data.following?.length === 1 && r.data.following[0].id === 'connienewer01' && r.data.following[0].u === 'Connie B', `Sam's follows are rebuilt, with her newest profile (${JSON.stringify(r.data)})`);
  delete docs['profiles/connienewer01'];
  check((await call('connie', { query: { following: '1' } })).data.following.length === 0, 'someone who follows nobody gets an empty list');
  check((await call(null, { query: { following: '1' } })).status === 401, 'rebuilding follows needs sign-in');
  r = await call('mallory', { method: 'POST', body: { action: 'followed', id: 'connieshare01', me: 'samshare0001' } });
  check(r.status === 403, "you can't follow in someone else's name");
  check((await call(null, { query: { followers: '1' } })).status === 401, 'the followers list needs sign-in');
  delete docs['profiles/samshare0001'];
  check((await call('connie', { query: { followers: '1' } })).data.followers.length === 0, 'a deleted account drops off the list');
  docs['profiles/samshare0001'] = { uid: 'sam', u: 'Sam' };
  await call('sam', { method: 'POST', body: { action: 'unfollowed', id: 'connieshare01', me: 'samshare0001' } });
  check((await call('connie', { query: { followers: '1' } })).data.followers.length === 0, 'unfollowing takes them off');

  // Invites: each has a code; Connie sees it opened, then who joined.
  const code = 'abcdefghij0123456789';
  r = await call('connie', { method: 'POST', body: { action: 'invite', code } });
  check(r.status === 200 && docs[`invites/${code}`]?.owner === 'connie', 'sending an invite records its code with your account');
  check((await call('sam', { method: 'POST', body: { action: 'invite', code } })).status === 409, "someone else can't take an invite code");
  check((await call('connie', { method: 'POST', body: { action: 'invite', code: 'BAD' } })).status === 400, 'a malformed code is refused');
  r = await call('connie', { query: { invites: '1' } });
  check(r.data.invites?.length === 1 && !r.data.invites[0].opened && !r.data.invites[0].joined, 'a new invite is just Sent');
  r = await call(null, { method: 'POST', body: { action: 'inviteOpened', code } });
  check(r.status === 200 && docs[`invites/${code}`].openedAt, 'tapping the link marks it opened, no account needed');
  check((await call('connie', { query: { invites: '1' } })).data.invites[0].opened === true, 'Connie sees it was opened');
  r = await call('mallory', { method: 'POST', body: { action: 'inviteJoined', code, me: 'samshare0001' } });
  check(r.status === 403, "you can't join in someone else's name");
  r = await call('connie', { method: 'POST', body: { action: 'inviteJoined', code, me: 'connieshare01' } });
  check(r.data.ok === false && !docs[`invites/${code}`].joinedUid, "you can't join from your own invite");
  r = await call('sam', { method: 'POST', body: { action: 'inviteJoined', code, me: 'samshare0001' } });
  check(r.data.ok === true, 'the friend signing in marks it joined');
  r = await call('connie', { query: { invites: '1' } });
  check(r.data.invites[0].joined && r.data.invites[0].u === 'Sam' && r.data.invites[0].id === 'samshare0001', `Connie sees Sam joined from it (${JSON.stringify(r.data.invites)})`);
  docs['profiles/joshare00001'] = { uid: 'jo', u: 'Jo' };
  r = await call('jo', { method: 'POST', body: { action: 'inviteJoined', code, me: 'joshare00001' } });
  check(r.data.ok === false && docs[`invites/${code}`].joinedUid === 'sam', 'an invite counts one person joining');
  check((await call('sam', { query: { invites: '1' } })).data.invites.length === 0, "nobody sees other people's invites");
  check((await call(null, { query: { invites: '1' } })).status === 401, 'the invite list needs sign-in');

  // ── The Friends screen ──
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Bacanora', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  const claims = [];
  let inviteRows = [];
  await p.route('**/api/handle**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') { const b = JSON.parse(req.postData()); claims.push(b); return route.fulfill({ json: b.action === 'claim' ? { handle: b.handle } : { ok: true } }); }
    if (url.searchParams.get('mine')) return route.fulfill({ json: { handle: '' } });
    if (url.searchParams.get('invites')) return route.fulfill({ json: { invites: inviteRows } });
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
  // Inviting: "Who's this for?", then a link with its own code.
  await p.evaluate(() => { window._shared = null; navigator.share = async d => { window._shared = d; }; inviteFriend(); });
  await p.waitForSelector('#invite-who', { timeout: 3000 });
  check(await p.locator('#invite-who .invite-who-name').isVisible(), 'Invite asks who it is for');
  await p.fill('#invite-who .invite-who-name', 'Mom');
  await p.click('#invite-who .invite-who-send');
  await p.waitForTimeout(400);
  const shared = await p.evaluate(() => window._shared);
  const icode = (String(shared?.url || '').match(/[?&]i=([a-z0-9]{16,32})/) || [])[1];
  check(!!icode && /^Hey Mom!/.test(shared.text), `the invite has its own code and says hi to them (${shared?.url})`);
  check(claims.some(b => b.action === 'invite' && b.code === icode), 'and the code is registered with the server');
  check(!claims.some(b => JSON.stringify(b).includes('Mom')), 'the name stays on the phone, never sent');
  let listText = await p.locator('#friends-list').innerText();
  check(/Sent invites \(1\)/i.test(listText) && /Mom/.test(listText) && /not opened yet/.test(listText), 'it shows under Sent invites by name, not opened yet');
  inviteRows = [{ code: icode, opened: true, joined: false }];
  await p.evaluate(() => loadInviteStatus());
  await p.waitForTimeout(300);
  check(/Opened the link/.test(await p.locator('#friends-list').innerText()), 'once they tap it, it says Opened');
  inviteRows = [{ code: icode, opened: true, joined: true, id: 'momshare0001', u: 'Linda' }];
  await p.evaluate(() => loadInviteStatus());
  await p.waitForTimeout(300);
  listText = await p.locator('#friends-list').innerText();
  check(/Mom/.test(listText) && /Joined as Linda/.test(listText) && await p.locator('.friend-invite-follow').isVisible(), 'once they join, it says who joined, with Follow back');
  await p.click('.friend-invite-follow');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => getFriends().some(f => f.data?.id === 'momshare0001')), 'Follow back from the invite follows them');
  await p.evaluate(() => { inviteFriend(); });
  await p.waitForSelector('#invite-who');
  await p.click('#invite-who .invite-who-close');
  await p.waitForTimeout(200);
  check(await p.locator('#invite-who').count() === 0 && (await p.evaluate(() => getSentInvites().length)) === 1, "closing \"Who's this for?\" sends nothing");

  // The friend's side: opening the link tells the server, and joining marks it.
  const q = await newPage(browser, { seed: [] });
  await q.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  const friendCalls = [];
  await q.route('**/api/handle**', route => {
    if (route.request().method() === 'POST') { friendCalls.push(JSON.parse(route.request().postData())); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: {} });
  });
  await q.goto(`${BASE}/app.html?i=${icode}`);
  await q.waitForTimeout(1200);
  check(friendCalls.some(b => b.action === 'inviteOpened' && b.code === icode) && !/[?&]i=/.test(q.url()), 'opening the invite tells the inviter it was opened');
  await q.evaluate(() => { window._ftbUid = 'momUser000001'; return noteInviteJoined(); });
  check(friendCalls.some(b => b.action === 'inviteJoined' && b.code === icode && b.me), 'signing in marks the invite joined');
  check(await q.evaluate(() => !localStorage.getItem('ftb_invite_code_v1')), 'only once');
  await q.close();

  // Picking your own username.
  await p.click('#friends-handle .friends-handle-edit');
  await p.fill('#friends-handle .friends-handle-form input', 'Connie_Eats');
  await p.click('#friends-handle .friends-handle-form button[type=submit]');
  await p.waitForTimeout(400);
  const claim = claims.find(b => b.action === 'claim');
  check(claim?.handle === 'connie_eats' && claim.id, 'picking a username sends it with your profile');
  check(/@connie_eats/.test(await p.locator('#friends-handle').innerText()), 'and shows it');
  check(await p.evaluate(() => state.settings.shareLive === true), 'and starts sharing so followers get your picks');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('handle');
})();
