// "Enjoying Feed The Bear?": asked after a new 5-star visit (with some use
// behind it), never again once answered; "Not really" sends a private note.
const path = require('path');
const Module = require('module');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const spot = (id, name) => ({ id, name, cuisine: 'Mexican', status: 'visited', tags: [], visits: [], dishes: [] });

(async () => {
  // The server keeps the note and emails the owner.
  const saved = [];
  const mails = [];
  const fake = {
    apps: [1],
    auth: () => ({ verifyIdToken: async () => ({ uid: 'u1', email: 'eater@example.com' }) }),
    firestore: () => ({ collection: () => ({ add: async d => { saved.push(d); } }) }),
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  const feedback = require(path.join(ROOT, 'api', 'feedback.js'));
  Module._load = orig;
  process.env.ADMIN_EMAILS = 'owner@example.com';
  process.env.BREVO_API_KEY = 'k'; process.env.DIGEST_FROM_EMAIL = 'picks@feed-the-bear.com';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { mails.push(JSON.parse(opts.body)); return { ok: true, text: async () => '' }; };
  const status = await new Promise(resolve => feedback({ method: 'POST', headers: { 'x-ftb-token': 't' }, body: { text: 'The map is slow', mood: 'meh' } },
    { status (c) { this.c = c; return this; }, json () { resolve(this.c); return this; } }));
  global.fetch = realFetch;
  check(status === 200 && saved[0]?.text === 'The map is slow' && saved[0].email === 'eater@example.com', 'a note is saved with who sent it');
  check(mails[0]?.to[0].email === 'owner@example.com' && /The map is slow/.test(mails[0].htmlContent), 'and emailed to the owner');

  // The app.
  const browser = await launch();
  const p = await newPage(browser, { seed: [spot('a', 'Bacanora'), spot('b', 'Kai'), spot('c', 'Pizzeria Bianco')] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  let note = null;
  await p.route('**/api/feedback', r => { note = JSON.parse(r.request().postData()); r.fulfill({ json: { ok: true } }); });
  await p.addInitScript(() => localStorage.setItem('ftb_product_events_v1', JSON.stringify({ counts: { app_opened: 5 }, recent: [] })));
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);

  const fiveStar = () => p.evaluate(() => { state.restaurants[0].visits.push({ date: '2026-11-0' + (state.restaurants[0].visits.length + 1), rating: 5 }); renderAll(); });
  await p.evaluate(() => { state.restaurants[1].visits.push({ date: '2026-11-01', rating: 3 }); renderAll(); });
  await p.waitForTimeout(1500);
  check(await p.locator('#rate-prompt').count() === 0, 'not after an ordinary visit');
  await fiveStar();
  await p.waitForTimeout(1600);
  check(/Enjoying Feed The Bear\?/.test(await p.locator('#rate-prompt').innerText().catch(() => '')), 'asked right after a 5-star visit');

  await p.click('#rate-prompt .rate-meh');
  await p.fill('#rate-prompt .rate-text', 'Wish I could sort by distance');
  await p.click('#rate-prompt .rate-send');
  await p.waitForTimeout(400);
  check(note?.text === 'Wish I could sort by distance' && note.mood === 'meh', '"Not really" sends a private note');
  check(await p.locator('#rate-prompt').count() === 0, 'and closes');

  await fiveStar();
  await p.waitForTimeout(1600);
  check(await p.locator('#rate-prompt').count() === 0, 'never asked again after answering');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  // In the Android app, "Love it" asks for a Google Play rating; a finished
  // Bear Swipe round counts as a good moment too.
  const q = await newPage(browser, { seed: [spot('a', 'Bacanora'), spot('b', 'Kai'), spot('c', 'Pizzeria Bianco')] });
  await q.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await q.addInitScript(() => {
    localStorage.setItem('ftb_product_events_v1', JSON.stringify({ counts: { app_opened: 5 }, recent: [] }));
    window.Capacitor = { isNativePlatform: () => true, Plugins: {}, isPluginAvailable: () => false };
    window.__opened = [];
    window.open = u => { window.__opened.push(u); return null; };
  });
  await q.goto(`${BASE}/app.html`);
  await q.waitForTimeout(1500);
  await closeAllDialogs(q);
  check(await q.evaluate(() => noteGoodMoment()), 'a good moment (like a Bear Swipe round) asks');
  await q.waitForTimeout(1500);
  await q.click('#rate-prompt .rate-love');
  check(await q.locator('#rate-prompt .rate-play').isVisible(), '"Love it" in the app offers Rate on Google Play');
  await q.click('#rate-prompt .rate-play');
  check(await q.evaluate(() => window.__opened[0]) === 'https://play.google.com/store/apps/details?id=com.feedthebear.app', 'which opens the Play Store listing');
  check(await q.evaluate(() => noteGoodMoment()) === false, 'and it never asks again');
  await browser.close();
  finish('rate');
})();
