// Public creator pages (feed-the-bear.com/@handle): opt-in, show top spots
// and what to order, and one button that joins, follows and saves them.
// Creators see visits and joins. The page escapes everything it shows.
const path = require('path');
const Module = require('module');
const { BASE, ROOT, check, launch, newPage, finish } = require('./lib');

(async () => {
  // ── Server, with a fake Firebase ──
  const docs = {
    'profiles/connieshare01': { uid: 'connieUid12345', u: 'Connie <b>', profile: { picks: [
      { n: 'Tacos Chiwas', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos'], s: ['Horchata'], p: 'javascript:alert(1)' },
      { n: '<script>x</script>', c: 'Pizza', r: 4 },
    ] } },
    'profiles/samshare0001': { uid: 'samUid1234567', u: 'Sam' },
  };
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
  const handleApi = require(path.join(ROOT, 'api', 'handle.js'));
  const creatorApi = require(path.join(ROOT, 'api', 'creator.js'));
  Module._load = orig;
  const call = (uid, { method = 'GET', query = {}, body } = {}) => new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
    handleApi({ method, query, body, headers: uid ? { 'x-ftb-token': `token-${uid}` } : {} }, res);
  });
  const view = h => new Promise(resolve => {
    const res = { h: {}, setHeader (k, v) { this.h[k] = v; }, status (c) { this.c = c; return this; }, send (d) { resolve({ status: this.c, html: String(d) }); return this; } };
    creatorApi({ method: 'GET', query: { h }, headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
  });

  await call('connieUid12345', { method: 'POST', body: { action: 'claim', handle: 'connie_eats', id: 'connieshare01', name: 'Connie' } });
  check((await view('connie_eats')).status === 404, 'a username is not a public page until they turn it on');
  check((await call('samUid1234567', { method: 'POST', body: { action: 'publicPage', on: true } })).status === 400, 'no username, no page');
  let r = await call('connieUid12345', { method: 'POST', body: { action: 'publicPage', on: true } });
  check(r.status === 200 && r.data.public === true, 'Connie turns her page on');

  const pg = await view('Connie_Eats');
  check(pg.status === 200, 'the page opens (any capitalization)');
  check(/<title>Connie &lt;b&gt;&#39;s food spots<\/title>/.test(pg.html), 'titled with her name, escaped');
  check(/Tacos Chiwas/.test(pg.html) && /<b>Get:<\/b> Birria quesatacos/.test(pg.html) && /Skip: Horchata/.test(pg.html), 'shows her spots and what to order');
  check(!/<script>x/.test(pg.html) && /&lt;script&gt;x/.test(pg.html), 'spot names are escaped');
  check(!/javascript:/.test(pg.html), 'unsafe photo links are dropped');
  check(/og:url" content="https:\/\/www\.feed-the-bear\.com\/@connie_eats"/.test(pg.html), 'a link preview for bios and texts');
  const join = (pg.html.match(/href="(\/app\.html\?[^"]+)"/) || [])[1] || '';
  check(/accept=1&amp;ref=connieUid12345&amp;src=connie_eats#profile=/.test(join), `the button joins with her free month and counts for her page (${join.slice(0, 80)})`);
  const data = JSON.parse(Buffer.from(join.split('#profile=')[1], 'base64').toString('utf8'));
  check(data.id === 'connieshare01' && data.picks.length === 2 && data.picks[0].g[0] === 'Birria quesatacos', 'and carries her spots, so the new member can add them');
  await view('connie_eats');
  r = await call('connieUid12345', { query: { mine: '1' } });
  check(r.data.public === true && r.data.views === 2, `she sees her visits (${r.data.views})`);

  // Sam joins from her page: counted once.
  r = await call('samUid1234567', { method: 'POST', body: { action: 'pageJoined', handle: 'connie_eats' } });
  check(r.data.ok === true, 'a new member who came from her page is counted');
  r = await call('samUid1234567', { method: 'POST', body: { action: 'pageJoined', handle: 'connie_eats' } });
  check(r.data.ok === false, 'only once');
  check((await call('connieUid12345', { method: 'POST', body: { action: 'pageJoined', handle: 'connie_eats' } })).data.ok === false, 'her own visit does not count');
  check((await call('connieUid12345', { query: { mine: '1' } })).data.joins === 1, 'she sees 1 joined');

  // Renaming keeps the page and its numbers.
  await call('connieUid12345', { method: 'POST', body: { action: 'claim', handle: 'connie_b', id: 'connieshare01', name: 'Connie' } });
  check((await view('connie_eats')).status === 404 && (await view('connie_b')).status === 200, 'a new username moves the page');
  r = await call('connieUid12345', { query: { mine: '1' } });
  check(r.data.public && r.data.joins === 1 && r.data.views >= 3, 'with its visits and joins');

  await call('connieUid12345', { method: 'POST', body: { action: 'publicPage', on: false } });
  check((await view('connie_b')).status === 404, 'turning it off takes the page down');
  check((await view('../etc')).status === 404, 'odd names are just not found');

  // ── App: Friends shows your page, and ?src= is remembered for the join ──
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a1', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [] }] });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  let page = { public: false, views: 0, joins: 0 };
  const posts = [];
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      posts.push(b);
      if (b.action === 'publicPage') { page = { ...page, public: b.on }; return rt.fulfill({ json: { public: b.on, handle: 'connie_eats' } }); }
      return rt.fulfill({ json: { ok: true } });
    }
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'connie_eats', ...page } });
    return rt.fulfill({ json: { followers: [], invites: [] } });
  });
  await p.goto(`${BASE}/app.html?src=Connie_Eats`);
  await p.waitForTimeout(1500);
  check(await p.evaluate(() => localStorage.getItem('ftb_page_src_v1')) === 'connie_eats' && await p.evaluate(() => !/src=/.test(location.search)), 'arriving from a page remembers it (and tidies the address)');
  await p.evaluate(() => { localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie' })); window._ftbUid = 'connieUid12345'; window.fbPublishFriendProfile = async () => {}; });
  await p.evaluate(() => notePageJoined());
  await p.waitForTimeout(300);
  check(posts.some(b => b.action === 'pageJoined' && b.handle === 'connie_eats') && await p.evaluate(() => !localStorage.getItem('ftb_page_src_v1')), 'once signed in, the join is counted for that page');

  await p.evaluate(() => openFoodieFriends());
  await p.waitForTimeout(600);
  check(/Your public page/.test(await p.locator('.my-page').innerText()), 'Friends explains the public page');
  await p.click('.my-page-on');
  await p.waitForTimeout(600);
  const on = await p.locator('.my-page').innerText();
  check(/feed-the-bear\.com\/@connie_eats/.test(on) && /0 visits · 0 people joined/.test(on), `once on, it shows the link and numbers ("${on.replace(/\s+/g, ' ')}")`);
  check(await p.locator('.my-page-copy').isVisible() && await p.locator('.my-page-off').isVisible(), 'with Copy link and Turn off');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('creator');
})();
