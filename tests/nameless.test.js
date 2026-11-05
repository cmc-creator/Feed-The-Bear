// A spot with no name (old or half-saved data) must not blank Friends: the
// list, sent invites and your username box all still show.
const { BASE, check, launch, newPage, finish } = require('./lib');

const SAM = { v: 2, id: 'samshare0001', u: 'Sam', w: [], ts: Date.now(), picks: [{ n: 'Tacos Chiwas', c: 'Mexican', r: 5, a: 'Phoenix' }] };
const SEED = [
  { id: 'm1', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 5, tags: [], dateAdded: '2026-09-05', visits: [] },
  { id: 'm2', cuisine: 'Thai', status: 'want-to-try', tags: [], dateAdded: '2026-09-06', visits: [] },
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await p.route('**/api/handle**', r => r.fulfill({ json: { handle: '', followers: [], invites: [] } }));
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(s => {
    localStorage.setItem('ftb_invites_sent_v1', JSON.stringify([{ at: new Date().toISOString(), code: '', name: 'Jo' }]));
    saveFriends([{ key: `id:${s.id}`, name: s.u, data: s, savedAt: Date.now() }]);
    window._ftbUid = 'user0000001'; window._ftbPlan = 'grizzly';
    try { renderFriendsFeedHome(); } catch (e) { window._homeErr = e.message; }
    openFoodieFriends();
  }, SAM);
  await p.waitForTimeout(500);
  check(!(await p.evaluate(() => window._homeErr)), 'home Friends feed draws');
  const list = await p.locator('#friends-list').innerText();
  check(/Following \(1\)/i.test(list) && /Sam/.test(list), `friends you follow show (${list.slice(0, 80)})`);
  check(/Sent invites \(1\)/i.test(list) && /Jo/.test(list), 'sent invites show');
  check(/1 new spot/.test(list), 'and what they have that you do not');
  check(!p.errors.length, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('nameless');
})();
