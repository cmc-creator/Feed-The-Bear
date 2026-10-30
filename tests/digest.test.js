// Weekly picks email (api/digest.js): opt-in only, nothing sends until
// Brevo is set up, one-click unsubscribe, and the app's on/off row.
const Module = require('module');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

const docs = {};
const users = { u1: { email: 'bear@example.com' }, u2: { email: 'empty@example.com' } };
const coll = prefix => ({
  get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(prefix + '/') && k.split('/').length === prefix.split('/').length + 1).map(k => ({ id: k.split('/').pop(), data: () => docs[k], ref: { set: async (d, o) => { docs[k] = { ...docs[k], ...d }; } } })) }),
  where: (f, op, v) => ({ get: async () => ({ docs: (await coll(prefix).get()).docs.filter(d => d.data()[f] === v) }) }),
});
const fakeAdmin = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('tok-')) throw new Error('bad'); const uid = t.slice(4); return { uid, email: users[uid]?.email }; }, getUser: async uid => ({ uid, ...users[uid] }) }),
  firestore: () => ({
    doc: p => ({ set: async (d, o) => { docs[p] = o?.merge ? { ...(docs[p] || {}), ...d } : d; }, get: async () => ({ exists: !!docs[p], data: () => docs[p] }) }),
    collection: coll,
  }),
};
const realLoad = Module._load;
Module._load = function (req, ...rest) { if (req === 'firebase-admin') return fakeAdmin; return realLoad.call(this, req, ...rest); };
const api = require(path.join(__dirname, '..', 'api', 'digest.js'));
Module._load = realLoad;

const sentMail = [];
global.fetch = async (url, opts) => { sentMail.push({ url, body: JSON.parse(opts.body), headers: opts.headers }); return { ok: true, text: async () => '' }; };
const call = (method, { query = {}, body = {}, headers = {} } = {}) => new Promise(resolve => {
  let status = 200;
  api({ method, query, body, headers }, { status (s) { status = s; return this; }, setHeader () {}, json (d) { resolve({ status, ...d }); return this; }, send (t) { resolve({ status, text: t }); return this; } });
});

(async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  process.env.CRON_SECRET = 'cron-secret-123';
  docs['users/u1/meta/profile'] = { name: 'Connie' };
  docs['users/u1/restaurants/a'] = { name: 'Nobu', status: 'want-to-try', cuisine: 'Japanese', dateAdded: '2026-01-02' };
  docs['users/u1/restaurants/b'] = { name: '<script>x</script> Tacos', status: 'want-to-try', dateAdded: '2026-03-01' };
  docs['users/u1/restaurants/c'] = { name: 'The Mission', status: 'visited', dishes: [{ name: 'Mole', verdict: 'want' }] };

  let r = await call('POST', { body: { on: true }, headers: { authorization: 'Bearer nope' } });
  check(r.status === 401, 'turning it on needs a signed-in member');
  r = await call('POST', { body: { on: true }, headers: { authorization: 'Bearer tok-u1' } });
  check(r.on === true && docs['digestSubscribers/u1'].email === 'bear@example.com', 'a member can turn on the weekly email');
  await call('POST', { body: { on: true }, headers: { authorization: 'Bearer tok-u2' } });

  r = await call('GET', { headers: { authorization: 'Bearer wrong' } });
  check(r.status === 401 && !sentMail.length, 'only the scheduled job can send');
  r = await call('GET', { headers: { authorization: 'Bearer cron-secret-123' } });
  check(r.sent === 0 && /not set up/.test(r.skipped) && !sentMail.length, 'nothing sends until Brevo is set up');

  process.env.BREVO_API_KEY = 'xkeysib-test';
  process.env.DIGEST_FROM_EMAIL = 'picks@feed-the-bear.com';
  process.env.DIGEST_ADDRESS = '123 Test St, Phoenix AZ';
  r = await call('GET', { headers: { authorization: 'Bearer cron-secret-123' } });
  check(r.sent === 1 && r.empty === 1, `members with spots get one email; empty lists are skipped (${JSON.stringify(r)})`);
  const mail = sentMail[0]?.body;
  check(mail?.to[0].email === 'bear@example.com' && /Nobu/.test(mail.subject), `the subject names their longest-waiting spot ("${mail?.subject}")`);
  check(/Hi Connie/.test(mail.htmlContent) && /Mole/.test(mail.htmlContent) && !/<script>x/.test(mail.htmlContent), 'the email is personal and spot names are escaped');
  check(/123 Test St/.test(mail.htmlContent) && /api\/digest\?unsub=u1&amp;sig=|api\/digest\?unsub=u1&sig=/.test(mail.htmlContent) && /unsub=u1/.test(mail.headers ? JSON.stringify(mail.headers) : JSON.stringify(mail)), 'it has the postal address and an unsubscribe link');

  const link = new URL(mail.htmlContent.match(/href="([^"]*unsub=[^"]*)"/)[1].replace(/&amp;/g, '&'));
  r = await call('GET', { query: { unsub: 'u1', sig: 'f'.repeat(32) } });
  check(r.status === 400 && docs['digestSubscribers/u1'].on === true, 'a forged unsubscribe link does nothing');
  r = await call('GET', { query: { unsub: link.searchParams.get('unsub'), sig: link.searchParams.get('sig') } });
  check(r.status === 200 && docs['digestSubscribers/u1'].on === false, 'the unsubscribe link works in one click');

  // ── App row ──
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'X', status: 'visited', tags: [], visits: [] }] });
  await p.route(/wikimedia|overpass|nominatim/, rt => rt.abort());
  let on = false;
  await p.route('**/api/digest**', rt => {
    if (rt.request().method() === 'POST') on = JSON.parse(rt.request().postData()).on;
    return rt.fulfill({ json: { on, sending: false } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  check(await p.evaluate(() => { openAccountModal(); return document.getElementById('account-digest-row').classList.contains('hidden'); }), 'signed out, there is no email row');
  await p.evaluate(() => {
    const u = { uid: 'u1', email: 'bear@example.com', providerData: [{ providerId: 'password' }], getIdToken: async () => 'tok' };
    _auth = { currentUser: u };
    updateAuthUI(u);
  });
  await p.waitForTimeout(400);
  check(/^Off/.test(await p.locator('#account-digest-state').innerText()), 'signed in, the weekly email starts off');
  await p.click('#account-digest-row');
  await p.waitForTimeout(400);
  check(on === true && /^On/.test(await p.locator('#account-digest-state').innerText()), 'tapping it turns it on');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('digest');
})();
