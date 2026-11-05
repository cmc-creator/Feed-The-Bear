// A new phone (or a list lost in a sync) still shows everything: who you
// follow comes back from the server's followers lists, and every invite you
// sent shows, not just ones sent from this phone.
const { BASE, check, launch, newPage, finish } = require('./lib');

const SEED = [{ id: 'm1', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 5, tags: [], dateAdded: '2026-09-05', visits: [] }];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  const calls = [];
  await p.route('**/api/handle**', route => {
    const url = new URL(route.request().url());
    calls.push(url.search);
    if (url.searchParams.get('following')) return route.fulfill({ json: { following: [{ id: 'samshare0001', u: 'Sam' }, { id: 'jojoshare001', u: 'Jo' }] } });
    if (url.searchParams.get('invites')) return route.fulfill({ json: { invites: [
      { code: 'aaaaaaaaaaaaaaaaaaaa', at: '2026-10-01T10:00:00.000Z', opened: true, joined: true, id: 'jojoshare001', u: 'Jo' },
      { code: 'bbbbbbbbbbbbbbbbbbbb', at: '2026-10-03T10:00:00.000Z', opened: false, joined: false, id: '', u: '' },
    ] } });
    if (url.searchParams.get('followers')) return route.fulfill({ json: { followers: [{ id: 'jojoshare001', u: 'Jo' }] } });
    if (url.searchParams.get('mine')) return route.fulfill({ json: { handle: 'connie' } });
    return route.fulfill({ json: { ok: true } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    window._ftbUid = 'user0000001'; window._ftbPlan = 'grizzly';
    window.fbFetchFriendProfiles = async ids => ids.map(id => ({ u: id === 'samshare0001' ? 'Sam' : 'Jo', profile: { picks: [{ n: 'Tacos Chiwas', c: 'Mexican', r: 5 }] }, recent: [] }));
    openFoodieFriends();
  });
  await p.waitForTimeout(1200);
  check(calls.some(c => c.includes('following')), 'opening Friends asks the server who you follow');
  check(await p.evaluate(() => getFriends().map(f => f.data.id).sort().join(',')) === 'jojoshare001,samshare0001', 'follows missing from this phone come back');
  const list = await p.locator('#friends-list').innerText();
  check(/Following \(2\)/i.test(list) && /Sam/.test(list) && /Jo/.test(list), 'and show under Following');
  check(/Sent invites \(2\)/i.test(list), `invites sent from another phone show (${list.replace(/\n/g, ' | ').slice(0, 160)})`);
  check(/Joined/.test(list), 'with who joined');
  check(await p.evaluate(() => getFriends().find(f => f.data.id === 'samshare0001')?.data.picks.length) === 1, "and their spots load");

  // Running it again adds nothing twice.
  await p.evaluate(() => loadFollowing());
  await p.waitForTimeout(400);
  check(await p.evaluate(() => getFriends().length) === 2, 'no duplicates on a second load');

  // An empty list on this phone never wins over the account's list.
  await p.evaluate(() => {
    localStorage.setItem('ftb_friends_v1', '[]');
    localStorage.setItem('ftb_friends_at_v1', String(Date.now()));
    localStorage.setItem('ftb_friends_uid_v1', 'user0000001');
    _mergeFriendsFromCloud({ friendsAt: 1000, friends: [{ key: 'id:samshare0001', name: 'Sam', data: { id: 'samshare0001', u: 'Sam', picks: [] }, savedAt: 1 }] });
  });
  check(await p.evaluate(() => getFriends().length) === 1, "an empty phone list takes the account's list instead of erasing it");

  // Another account's list on this phone is not pushed into yours.
  await p.evaluate(() => {
    localStorage.setItem('ftb_friends_v1', JSON.stringify([{ key: 'id:otherperson1', name: 'Other', data: { id: 'otherperson1', u: 'Other', picks: [] }, savedAt: 1 }]));
    localStorage.setItem('ftb_friends_at_v1', String(Date.now()));
    localStorage.setItem('ftb_friends_uid_v1', 'someoneelse01');
    _mergeFriendsFromCloud({ friendsAt: 1000, friends: [{ key: 'id:samshare0001', name: 'Sam', data: { id: 'samshare0001', u: 'Sam', picks: [] }, savedAt: 1 }] });
  });
  check(await p.evaluate(() => getFriends().map(f => f.name).join(',')) === 'Sam', "another account's friends are replaced by yours");

  check(!p.errors.length, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('friendsrestore');
})();
