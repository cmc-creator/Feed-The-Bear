// Someone who accepts your invite (follows you) is followed back, so you're
// friends both ways. And nobody shows as "Foodie" when their Google account
// has a name.
const { BASE, check, launch, newPage, closeAllDialogs, finish, asGrizzly } = require('./lib');

(async () => {
  asGrizzly();
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Bacanora', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  const posts = [];
  await p.route('**/api/handle**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') { posts.push(JSON.parse(req.postData())); return route.fulfill({ json: { ok: true } }); }
    if (url.searchParams.get('followers')) return route.fulfill({ json: { followers: [{ id: 'jeremyshare01', u: 'Jeremy' }] } });
    if (url.searchParams.get('invites')) return route.fulfill({ json: { invites: [] } });
    if (url.searchParams.get('following')) return route.fulfill({ json: { following: [] } });
    return route.fulfill({ json: { handle: '' } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);

  // Name: the placeholder gives way to the Google first name.
  await p.evaluate(() => {
    localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Foodie' }));
    window.firebase = { ...(window.firebase || {}), auth: () => ({ currentUser: { displayName: 'Connie Michelle' } }) };
  });
  check(await p.evaluate(() => buildProfileData().u) === 'Connie', 'friends see your Google first name, not "Foodie"');
  await p.evaluate(() => localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'CJ' })));
  check(await p.evaluate(() => buildProfileData().u) === 'CJ', 'a name you typed wins');

  // Jeremy accepted the invite: opening Friends follows him back.
  await p.evaluate(() => openFoodieFriends());
  await p.waitForTimeout(1200);
  check(await p.evaluate(() => getFriends().some(f => f.data?.id === 'jeremyshare01' && f.name === 'Jeremy')), 'someone who follows you is followed back');
  check(posts.some(b => b.action === 'followed' && b.id === 'jeremyshare01'), 'and the server is told, so he sees you too');
  check(/You and Jeremy are friends/.test(await p.locator('#toast-container, .toast').first().innerText().catch(() => '')) || await p.evaluate(() => document.body.innerText.includes('You and Jeremy are friends')), 'it says you are friends now');

  // Unfollowing him sticks.
  await p.evaluate(() => { unfollowFriend('id:jeremyshare01'); closeFoodieFriends(); openFoodieFriends(); });
  await p.waitForTimeout(1200);
  check(!(await p.evaluate(() => getFriends().some(f => f.data?.id === 'jeremyshare01'))), 'unfollowing later sticks');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  await browser.close();
  finish('followback');
})();
