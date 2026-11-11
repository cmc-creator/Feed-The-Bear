// Food fight: throw food at a friend you follow; they get a push and a splat
// next time they open the app, and can throw one back. A few throws a day.
const Module = require('module');
const path = require('path');
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

// ── Server (api/foodfight.js) with a fake Firestore ──
const docs = {};
const sent = [];
const ref = p => ({ path: p, get: async () => ({ exists: !!docs[p], data: () => docs[p] }), set: async d => { docs[p] = d; } });
const fakeAdmin = {
  apps: [1],
  firestore: () => ({ doc: ref, runTransaction: async fn => fn({ get: r => r.get(), set: (r, d) => { docs[r.path] = d; } }) }),
  auth: () => ({ verifyIdToken: async t => { if (!t) throw new Error('no'); return { uid: t }; } }),
  messaging: () => ({ sendEachForMulticast: async m => { sent.push(m); return { successCount: m.tokens.length }; } }),
};
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fakeAdmin : realLoad.call(this, req, ...rest); };
const api = require(path.join(__dirname, '..', 'api', 'foodfight.js'));
Module._load = realLoad;
const call = (uid, body) => new Promise(resolve => {
  const res = { status (s) { this.s = s; return this; }, json (d) { resolve({ status: this.s, ...d }); }, setHeader () {} };
  api({ method: 'POST', headers: uid ? { 'x-ftb-token': uid } : {}, body }, res);
});

const JO = { v: 2, id: 'joshare12345', u: 'Jo Smith', w: [], ts: Date.now(), picks: [{ n: 'Tacos Chiwas', c: 'Mexican', r: 5 }] };

(async () => {
  docs['profiles/joshare12345'] = { uid: 'joUid000001' };
  docs['profiles/connieshare1'] = { uid: 'connieUid01' };
  docs['pushTokens/joUid000001'] = { tokens: ['jo-phone-token-0000000000001'] };

  check((await call(null, { action: 'throw', to: 'joshare12345' })).status === 401, 'signed out: no throwing');
  let r = await call('connieUid01', { action: 'throw', to: 'joshare12345', food: 'taco', name: 'Connie' });
  check(r.status === 200 && r.me === 1 && r.them === 0, `a throw lands and scores (${JSON.stringify(r)})`);
  check(sent.length === 1 && sent[0].tokens[0] === 'jo-phone-token-0000000000001' && /Connie threw a taco at you! 🌮/.test(sent[0].notification.title) && sent[0].data.open === 'foodfight', `Jo gets a push (${sent[0]?.notification?.title})`);
  const inbox = await call('joUid000001', { action: 'inbox' });
  check(inbox.hits.length === 1 && inbox.hits[0].name === 'Connie' && inbox.hits[0].emoji === '🌮' && inbox.hits[0].them === 1, 'it waits in Jo\'s inbox with the score');
  check((await call('joUid000001', { action: 'inbox' })).hits.length === 0, 'and only splats once');
  r = await call('joUid000001', { action: 'throw', pair: inbox.hits[0].pair, food: 'pie', name: 'Jo' });
  check(r.status === 200 && r.me === 1 && r.them === 1, 'Jo throws one back');
  check((await call('strangerUid', { action: 'throw', pair: inbox.hits[0].pair, food: 'pie' })).status === 404, 'nobody else can throw into that fight');
  check((await call('connieUid01', { action: 'throw', to: 'connieshare1' })).status === 400, "you can't throw food at yourself");
  check((await call('connieUid01', { action: 'throw', to: 'nobodyshare1' })).status === 404, 'only at friends whose profile is live');
  await call('connieUid01', { action: 'throw', to: 'joshare12345', food: 'pie', name: 'Connie' });
  await call('connieUid01', { action: 'throw', to: 'joshare12345', food: 'pie', name: 'Connie' });
  r = await call('connieUid01', { action: 'throw', to: 'joshare12345', food: 'pie', name: 'Connie' });
  check(r.status === 429 && /plenty of food/.test(r.error), 'three a day at the same friend');
  const sc = await call('connieUid01', { action: 'scores', ids: ['joshare12345', 'nobodyshare1'] });
  check(sc.live.includes('joshare12345') && !sc.live.includes('nobodyshare1'), 'scores say which friends can be hit');
  check(sc.scores.joshare12345?.me === 3 && sc.scores.joshare12345.them === 1 && !sc.scores.nobodyshare1, `scores per friend (${JSON.stringify(sc.scores)})`);

  // ── In the app ──
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  const posted = [];
  let inboxHits = [];
  await p.route('**/api/foodfight', route => {
    const b = route.request().postDataJSON();
    posted.push(b);
    if (b.action === 'throw') return route.fulfill({ json: { ok: true, pair: 'a_b', food: b.food, me: 4, them: 2, left: 2, pushed: 1 } });
    if (b.action === 'scores') return route.fulfill({ json: { scores: { joshare12345: { pair: 'a_b', me: 3, them: 2 } }, live: ['joshare12345'] } });
    if (b.action === 'inbox') { const hits = inboxHits; inboxHits = []; return route.fulfill({ json: { hits } }); }
    return route.fulfill({ status: 400, json: {} });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  await p.evaluate(j => { window._ftbUid = 'connieUid01'; saveFriends([{ key: `id:${j.id}`, name: j.u, data: j, savedAt: Date.now() }]); openFoodieFriends(); }, JO);
  await p.waitForTimeout(800);
  check(await p.locator('.fx-throw').isVisible(), 'a friend whose profile is live has a Throw button');
  check(/Food fight: You 3 · Jo 2/.test(await p.locator('.fft-score').innerText()), 'with your running score');
  await p.evaluate(() => { window._ftbUid = 'connieUid01'; });
  await p.click('.fx-throw');
  check(await p.locator('.fft-overlay .fft-food').count() === 25 && /Throw something at Jo!/.test(await p.locator('.fft-title').innerText()), 'pick a food to throw at Jo (25 to choose from)');
  await p.click('.fft-food[data-food="taco"]');
  await p.waitForTimeout(700);
  check(posted.some(b => b.action === 'throw' && b.to === 'joshare12345' && b.food === 'taco'), 'the taco is thrown at Jo');
  check(/Splat!.*You 4 · Jo 2/.test(await p.locator('.fft-status').innerText()), 'splat, with the new score');
  await p.waitForTimeout(1200);
  check(await p.locator('.fft-overlay').count() === 0, 'it closes by itself');
  await p.waitForFunction(() => /Direct hit on Jo/.test(document.getElementById('toast-container')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  check(/Direct hit on Jo/.test(await p.locator('#toast-container').innerText()), 'Byte Cub cheers the hit');

  // Jo hit you back while you were away: it lands on your screen.
  await closeAllDialogs(p);
  inboxHits = [{ pair: 'a_b', name: 'Jo Smith', food: 'pie', emoji: '🥧', at: new Date().toISOString(), me: 4, them: 3 }];
  await p.evaluate(() => { window._ftbUid = 'connieUid01'; return checkFoodFight({ force: true }); });
  await p.waitForTimeout(600);
  check(await p.locator('.fft-incoming').isVisible() && /Jo threw a pie at you! 🥧/.test(await p.locator('.fft-incoming .fft-title').innerText()), 'incoming food splats on screen');
  check(/You 4 · Jo 3/.test(await p.locator('.fft-incoming .fft-status').innerText()), 'with the score');
  await p.evaluate(() => { window._ftbUid = 'connieUid01'; });
  await p.click('.fft-wipe');
  await p.waitForTimeout(300);
  await p.evaluate(() => { window._ftbUid = 'connieUid01'; closeFoodieFriends?.(); renderFriendsFeedHome(); });
  check(await p.locator('.fft-home').isVisible() && /Jo hit you with a pie!/.test(await p.locator('.fft-home').innerText()), 'wiped it off? Home keeps a Throw back card');
  await p.click('.fft-home-back');
  await p.waitForTimeout(300);
  await p.evaluate(() => { window._ftbUid = 'connieUid01'; });
  await p.click('.fft-food[data-food="pie"]').catch(() => {});
  await p.waitForTimeout(1600);
  check(await p.locator('.fft-home').count() === 0, 'throwing back clears it');
  check(posted.some(b => b.action === 'throw' && b.pair === 'a_b' && b.food === 'pie'), 'Throw one back answers the same fight');
  await p.screenshot({ path: path.join(__dirname, 'shots', 'foodfight.png') }).catch(() => {});
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('foodfight');
})();
