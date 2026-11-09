// The owner portal page (owner.html): opening it from the app hands over the
// app's sign-in, so it never asks again; and its script loads without errors.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  let auth = '';
  const posted = [];
  await p.route('**/api/owner', r => { auth = r.request().headers().authorization || ''; if (r.request().method() === 'POST') { posted.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); } r.fulfill({ json: { vips: [], codes: [], me: 'cmc@conniemichelleconsulting.com', partners: {}, featured: [], creators: [],
    signups: { today: 1, week: 3, month: 9, total: 42, recent: [{ email: 'jo@example.com', name: 'Jo', via: 'Google', at: new Date().toISOString(), lastAt: '' }] },
    alerts: { push: true, email: true, phone: 0, emailReady: false } } }); });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  await p.evaluate(() => {
    window._ftbUserEmail = 'cmc@conniemichelleconsulting.com';
    _auth = { currentUser: { email: 'cmc@conniemichelleconsulting.com', getIdToken: async () => 'APP-TOKEN' } };
    openAccountModal();
  });
  check(await p.locator('#account-owner-row').isVisible(), 'the owner sees Owner portal in Account');
  await p.click('#account-owner-row');
  await p.waitForURL(/owner\.html/, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(1500);
  check(await p.locator('#portal').isVisible() && await p.locator('#gate').isHidden(), 'it opens signed in, no second sign-in');
  check(auth === 'Bearer APP-TOKEN' && /cmc@conniemichelleconsulting\.com/.test(await p.textContent('#who')), "using the app's sign-in");
  check(await p.locator('#creator-list').isVisible() && await p.locator('#featured-list').isVisible() && await p.locator('#partner-form').isVisible(), 'every section is there');
  check((await p.textContent('#su-total')) === '42' && /jo@example\.com.*Google/.test(await p.textContent('#signup-list')), 'New sign-ups lists who joined, with counts');
  check(/not set up yet/.test(await p.textContent('#alert-push-note')), 'and says when the phone is not set up for alerts');
  await p.click('#alert-email');
  await p.waitForTimeout(400);
  check(posted.some(b => b.action === 'alerts' && b.email === false), 'the email switch saves');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  // Opened on its own with no sign-in: the Google button, no errors.
  const q = await browser.newPage();
  const errs = [];
  q.on('pageerror', e => errs.push(e.message));
  await q.goto(`${BASE}/owner.html`);
  await q.waitForTimeout(2000);
  check(await q.locator('#sign-in').isVisible() && !errs.length, `on its own it offers Google sign-in, no script errors ${errs.join(' | ')}`);
  await browser.close();
  finish('ownerpage');
})();
