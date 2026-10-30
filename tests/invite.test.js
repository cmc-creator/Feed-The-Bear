// Free trial, invite links and Manage subscription in the app (the server
// side is covered by trial.test.js; here /api is faked with page routes).
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [] }] });
  await p.route(/wikimedia|overpass|nominatim/, r => r.abort());
  let offer = { trial: true, days: 7 };
  let checkoutBody = null;
  let rewards = { grizzlyUntil: null, invites: 0 };
  await p.route('**/api/create-checkout**', async r => {
    if (r.request().method() === 'GET') return r.fulfill({ json: offer });
    checkoutBody = JSON.parse(r.request().postData());
    return r.fulfill({ json: { url: `${BASE}/app.html?checkout=stub` } });
  });
  await p.route('**/api/verify-session', r => {
    const { action } = JSON.parse(r.request().postData() || '{}');
    return r.fulfill(action === 'portal' ? { json: { url: `${BASE}/app.html?billing=stub` } } : { json: rewards });
  });

  // ── Opening a friend's invite link ──
  await p.goto(`${BASE}/app.html?ref=inviterABC123`);
  await p.waitForTimeout(2500);
  check(await p.evaluate(() => localStorage.getItem('ftb_ref_v1')) === 'inviterABC123', 'the invite is remembered');
  check(!/ref=/.test(p.url()), 'the address bar is cleaned up');
  check(/A friend invited you/.test(await p.locator('body').innerText()), 'they are told about the 30 free days');

  // Signed out: the 30-day trial is offered.
  await p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); openUpgradeModal(); });
  await p.waitForTimeout(300);
  check((await p.locator('#upgrade-cta-btn').innerText()) === 'Start my 30-day free trial', 'an invited friend sees a 30-day free trial');
  check(/Free for 30 days, then \$53\.89 a year/.test(await p.locator('#upgrade-footer').innerText()), 'the footer says when billing starts');
  await p.evaluate(() => closeUpgradeModal());

  // ── Signed in ──
  await p.evaluate(() => {
    const u = { uid: 'me000000001', email: 'me@example.com', providerData: [{ providerId: 'password' }], getIdToken: async () => 'tok' };
    _auth = { currentUser: u };
    window._ftbUid = u.uid;
    localStorage.removeItem('ftb_ref_v1');
    updateAuthUI(u);
  });
  await p.evaluate(() => openUpgradeModal());
  await p.waitForTimeout(500);
  check((await p.locator('#upgrade-cta-btn').innerText()) === 'Start my 7-day free trial' && /7 days free/i.test(await p.locator('#upgrade-plan-badge').innerText()), 'a new member is offered 7 days free');
  await p.click('#upgrade-monthly-btn');
  check(/then \$4\.99 a month/.test(await p.locator('#upgrade-footer').innerText()), 'switching to monthly updates the price after the trial');
  await p.evaluate(() => closeUpgradeModal());
  offer = { trial: false, days: 0 };
  await p.evaluate(() => openUpgradeModal());
  await p.waitForTimeout(500);
  check((await p.locator('#upgrade-cta-btn').innerText()) === 'Upgrade to Grizzly' && /Cancel anytime/.test(await p.locator('#upgrade-footer').innerText()), 'someone who had a trial sees the normal price');
  await p.evaluate(() => { localStorage.setItem('ftb_ref_v1', 'inviterABC123'); });
  await p.click('#upgrade-cta-btn');
  await p.waitForTimeout(1200);
  check(checkoutBody?.ref === 'inviterABC123' && checkoutBody?.uid === 'me000000001', 'checkout carries the invite');

  // ── Inviting friends ──
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2000);
  const shared = await p.evaluate(async () => {
    const u = { uid: 'me000000001', email: 'me@example.com', providerData: [{ providerId: 'password' }], getIdToken: async () => 'tok' };
    _auth = { currentUser: u };
    let got = null;
    navigator.share = async d => { got = d; };
    await shareInvite();
    return got;
  });
  check(/app\.html\?ref=me000000001$/.test(shared?.url || '') && /30 days of Grizzly free/.test(shared?.text || ''), `the invite shares your personal link (${shared?.url})`);

  // A free month from invites shows on the account.
  rewards = { grizzlyUntil: new Date(Date.now() + 20 * 864e5).toISOString(), invites: 2 };
  await p.evaluate(async () => {
    window._ftbPlan = 'grizzly';
    window._ftbUid = 'me000000001';
    await _checkInviteRewards();
    openAccountModal();
  });
  await p.waitForTimeout(300);
  check((await p.locator('#account-plan-badge').innerText()) === 'Grizzly - free month', 'a free month shows on the plan badge');
  check(/2 friends joined so far\. Free Grizzly until/.test(await p.locator('#account-invite-state').innerText()), 'the invite row counts friends who joined');
  check(await p.locator('#account-billing-row').isHidden(), 'no bill to manage on a free month');

  // A paying member can manage or cancel.
  rewards = { grizzlyUntil: null, invites: 2 };
  await p.evaluate(async () => { await _checkInviteRewards(); });
  check(await p.locator('#account-billing-row').isVisible(), 'a paying member sees Manage subscription');
  await p.click('#account-billing-row');
  await p.waitForURL(/billing=stub/, { timeout: 5000 }).catch(() => {});
  check(/billing=stub/.test(p.url()), 'it opens Stripe to change or cancel');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  await browser.close();
  finish('invite');
})();
