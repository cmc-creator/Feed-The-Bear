// Gift Grizzly (gift.html, api/gift.js, stripe-webhook.js giftPaid): pay once,
// the friend gets Grizzly for 3 or 12 months and an email. Fake Stripe,
// Firestore and email.
const Module = require('module');
const { Readable } = require('stream');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

const docs = {};
const users = { 'friend@example.com': 'uidFriend' };
const ref = p => ({
  set: async (data, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...data } : data; },
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
});
const fakeAdmin = {
  apps: [1],
  auth: () => ({ getUserByEmail: async e => { if (!users[e]) throw new Error('none'); return { uid: users[e] }; } }),
  firestore: Object.assign(() => ({ doc: ref, collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }) }), { FieldValue: { delete: () => null, increment: n => n } }),
};
const sessions = [];
const fakeStripe = () => ({
  webhooks: { constructEvent: body => JSON.parse(body.toString()) },
  checkout: { sessions: { create: async s => { sessions.push(s); return { id: `cs_${sessions.length}`, url: 'https://checkout.stripe.com/x' }; } } },
});
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return fakeStripe;
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === './_limit') return { overLimit: async () => false, clientIp: () => 'x' };
  return load.call(this, req, ...rest);
};
const api = f => require(path.join(__dirname, '..', 'api', f));
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const gift = api('gift.js');
const webhook = api('stripe-webhook.js');
Module._load = load;

const emails = [];
process.env.BREVO_API_KEY = 'x'; process.env.DIGEST_FROM_EMAIL = 'bear@feed-the-bear.com'; process.env.DIGEST_ADDRESS = 'x'; process.env.CRON_SECRET = 'x';
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes('brevo')) { emails.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; }
  return realFetch(url, opts);
};

const call = (fn, body) => new Promise(resolve => {
  let status = 200;
  fn({ method: 'POST', body, headers: {} }, { status (s) { status = s; return this; }, json (data) { resolve({ status, data }); return this; }, setHeader () {} });
});
async function hook (event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': 'x' };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
  return new Promise(resolve => webhook(req, { status () { return this; }, json: resolve, setHeader () {}, send: resolve }));
}

(async () => {
  let r = await call(gift, { to: 'Friend@Example.com', toName: 'Sam', from: 'Connie', buyerEmail: 'me@example.com', months: 12, message: 'Happy holidays!' });
  const s = sessions[0];
  check(r.status === 200 && r.data.url && s.mode === 'payment' && s.line_items[0].price_data.unit_amount === 4999 && s.metadata.to === 'friend@example.com' && s.metadata.kind === 'gift', 'a year gift opens a $49.99 one-time checkout');
  r = await call(gift, { to: 'nope', months: 3 });
  check(r.status === 400, "a bad friend's email is refused");
  await call(gift, { to: 'a@b.co', months: 99 });
  check(sessions[1].line_items[0].price_data.unit_amount === 1499, 'anything but a year is 3 months ($14.99)');

  // Paid: an existing account gets Grizzly now, and both get an email.
  const paid = { id: 'cs_paid1', payment_status: 'paid', amount_total: 4999, customer_details: { email: 'me@example.com' }, metadata: { kind: 'gift', to: 'friend@example.com', toName: 'Sam', from: 'Connie', months: '12', message: 'Happy holidays!' } };
  await hook({ type: 'checkout.session.completed', data: { object: paid } });
  const prof = docs['users/uidFriend/meta/profile'];
  check(prof?.plan === 'grizzly' && Date.parse(prof.vipUntil) > Date.now() + 360 * 864e5, 'the friend has Grizzly for a year');
  check(!docs['users/undefined/meta/profile'] && !docs['trials/undefined'], 'a gift is not treated as a subscription');
  const toFriend = emails.find(e => e.to?.[0]?.email === 'friend@example.com');
  check(toFriend && /Connie gave you/.test(toFriend.subject) && /Happy holidays!/.test(toFriend.htmlContent), 'the friend is emailed, with the note');
  check(emails.some(e => e.to?.[0]?.email === 'me@example.com'), 'the buyer gets a receipt');
  const before = emails.length;
  await hook({ type: 'checkout.session.completed', data: { object: paid } });
  check(emails.length === before, 'the same payment twice does nothing more');

  // Someone without an account: waiting for their first sign-in; a second gift adds on.
  const p2 = { ...paid, id: 'cs_paid2', metadata: { ...paid.metadata, to: 'new@example.com', months: '3' } };
  await hook({ type: 'checkout.session.completed', data: { object: p2 } });
  await hook({ type: 'checkout.session.completed', data: { object: { ...p2, id: 'cs_paid3' } } });
  const v = docs['vips/new@example.com'];
  check(v?.pending && Date.parse(v.until) > Date.now() + 170 * 864e5, 'no account yet: waiting for sign-in, and two 3-month gifts make 6 months');

  // The page.
  const browser = await launch();
  const p = await newPage(browser, {});
  let posted = null;
  await p.route('**/api/gift', rt => { posted = JSON.parse(rt.request().postData()); rt.fulfill({ json: { url: `${BASE}/gift.html?sent=1&to=Sam` } }); });
  await p.goto(`${BASE}/gift.html`);
  await p.click('#go');
  check(/Check your friend/.test(await p.textContent('#err')), 'the page asks for their email first');
  await p.fill('#to', 'friend@example.com'); await p.fill('#toName', 'Sam'); await p.fill('#from', 'Connie');
  await p.click('.plan:has(input[value="12"])');
  await p.click('#go');
  await p.waitForURL(/sent=1/, { timeout: 5000 }).catch(() => {});
  check(posted?.months === 12 && posted.to === 'friend@example.com' && await p.locator('#done').isVisible() && /We emailed Sam/.test(await p.textContent('#done-line')), 'the page sends the gift and says it was sent');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('gift');
})();
