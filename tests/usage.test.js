// The private usage dashboard (usage.html + api/usage.js).
const path = require('path');
const Module = require('module');
const { BASE, ROOT, SHOTS, check, launch, newPage, finish } = require('./lib');

// api/usage.js with a fake firebase-admin, so the access rules run without real credentials.
function loadApi (decoded, docs = {}) {
  const fake = {
    apps: [1],
    auth: () => ({ verifyIdToken: async t => { if (t !== 'good') throw new Error('bad token'); return decoded; } }),
    firestore: () => ({
      doc: p => p,
      getAll: async (...paths) => paths.map(p => {
        const c = docs[p.split('/')[1]];
        return { exists: !!c, data: () => ({ counts: c }) };
      }),
    }),
  };
  const file = path.join(ROOT, 'api', 'usage.js');
  delete require.cache[file];
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  try { return require(file); } finally { Module._load = orig; }
}

async function call (handler, { token, days } = {}) {
  const out = {};
  const res = {
    setHeader () {},
    status (c) { out.status = c; return res; },
    json (b) { out.body = b; return res; },
    end () { return res; },
  };
  await handler({ method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, query: { days } }, res);
  return out;
}

(async () => {
  // Access rules
  const today = new Date().toISOString().slice(0, 10);
  const owner = { email: 'owner@example.com', email_verified: true };
  process.env.ADMIN_EMAILS = '';
  check((await call(loadApi(owner), { token: 'good' })).status === 503, 'no ADMIN_EMAILS set: nobody gets in');
  process.env.ADMIN_EMAILS = 'Owner@Example.com, other@example.com';
  check((await call(loadApi(owner))).status === 401, 'no token: 401');
  check((await call(loadApi(owner), { token: 'bad' })).status === 401, 'bad token: 401');
  check((await call(loadApi({ email: 'someone@example.com', email_verified: true }), { token: 'good' })).status === 403, 'another account: 403');
  check((await call(loadApi({ email: 'owner@example.com', email_verified: false }), { token: 'good' })).status === 403, 'unverified email: 403');
  const ok = await call(loadApi(owner, { [today]: { app_opened: 7 } }), { token: 'good', days: '7' });
  check(ok.status === 200 && ok.body.days.length === 7, 'the owner gets 7 days');
  check(ok.body.days[6].date === today && ok.body.days[6].counts.app_opened === 7 && Object.keys(ok.body.days[0].counts).length === 0, 'days are oldest first, empty days included');
  check((await call(loadApi(owner), { token: 'good', days: '5000' })).body.days.length === 90, 'at most 90 days');

  // The page, with made-up numbers
  const browser = await launch();
  const p = await newPage(browser, { viewport: { width: 1100, height: 900 } });
  await p.goto(`${BASE}/usage.html?demo`);
  await p.waitForSelector('#board:not([hidden])');
  check(await p.locator('#gate').isHidden(), 'demo mode skips sign-in');
  const tiles = await p.$$eval('.tile span', s => s.map(x => x.textContent));
  check(tiles.includes('App opens') && tiles.includes('Grizzly upgrades'), `headline numbers show (${tiles.join(', ')})`);
  check(await p.locator('#chart path').count() === 30, 'a bar for each of 30 days');
  await p.hover('#chart rect.hit[data-i="29"]');
  check(/opens/.test(await p.locator('.tip').innerText()), 'hovering a bar shows the count');
  check(await p.locator('#funnel-money .step').count() === 3, 'the upgrade funnel has three steps');
  check(await p.locator('#rows tr', { hasText: 'Meal logged' }).count() === 1, 'the table lists events with plain names');
  await p.screenshot({ path: path.join(SHOTS, 'usage-desktop.png'), fullPage: true }).catch(() => {});
  await p.click('.range [data-days="7"]');
  check(await p.locator('#chart path').count() === 7, 'switching to 7 days redraws');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.context().close();

  const m = await newPage(browser);
  await m.goto(`${BASE}/usage.html?demo`);
  await m.waitForSelector('#board:not([hidden])');
  check(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on a phone');
  await m.screenshot({ path: path.join(SHOTS, 'usage-phone.png'), fullPage: true }).catch(() => {});
  await m.context().close();

  // Without demo, it asks for sign-in
  const g = await newPage(browser);
  await g.route(/gstatic\.com/, r => r.fulfill({ body: '' }));
  await g.goto(`${BASE}/usage.html`);
  await g.waitForTimeout(500);
  check(await g.locator('#gate').isVisible() && await g.locator('#board').isHidden(), 'signed out: shows the sign-in gate only');
  await g.context().close();

  await browser.close();
  finish('usage');
})();
