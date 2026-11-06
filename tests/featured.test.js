// Featured restaurants: a restaurant pays $29/month (advertise.js), the owner
// approves it (owner.js), and it shows first on its city guide (guide.js)
// until the subscription ends (stripe-webhook.js). Fake Stripe and Firestore.
const Module = require('module');
const { Readable } = require('stream');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

const docs = {};
const ref = p => ({ id: p.split('/').pop(), path: p,
  set: async (v, o) => { docs[p] = o?.merge ? { ...(docs[p] || {}), ...v } : { ...v }; },
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }) });
const query = (col, filters = []) => ({
  where: (f, op, v) => query(col, [...filters, [f, v]]), orderBy: () => query(col, filters), limit: () => query(col, filters),
  get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(`${col}/`) && filters.every(([f, v]) => docs[k][f] === v)).map(k => ({ id: k.split('/')[1], ref: ref(k), data: () => docs[k] })) }),
});
const fakeAdmin = { apps: [1],
  firestore: Object.assign(() => ({ doc: ref, collection: c => query(c), getAll: async (...refs) => Promise.all(refs.map(r => r.get())) }), { FieldValue: { delete: () => null, increment: n => n } }),
  auth: () => ({ verifyIdToken: async t => ({ email: t === 'owner' ? 'cmc@conniemichelleconsulting.com' : 'x@y.z', email_verified: true }) }) };
const sessions = [];
const fakeStripe = () => ({
  webhooks: { constructEvent: body => JSON.parse(body.toString()) },
  checkout: { sessions: { create: async s => { sessions.push(s); return { id: 'cs_feat1', url: 'https://checkout.stripe.com/x' }; } } },
  promotionCodes: { list: async () => ({ data: [] }) },
});
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return fakeStripe;
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === './_limit') return { overLimit: async () => false, clientIp: () => 'x' };
  return load.call(this, req, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const api = f => require(path.join(__dirname, '..', 'api', f));
const advertise = api('advertise.js');
const webhook = api('stripe-webhook.js');
const owner = api('owner.js');
const guide = api('guide.js');
Module._load = load;
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ elements: [{ type: 'node', lat: 33.5, lon: -111.9, tags: { name: 'Taco Town', amenity: 'restaurant', cuisine: 'mexican' } }] }), text: async () => '' });

const call = (fn, method, body, headers = {}, query = {}) => new Promise(resolve => {
  let status = 200;
  fn({ method, body, headers, query }, { status (s) { status = s; return this; }, json (data) { resolve({ status, data }); return this; }, send (b) { resolve({ status, body: b }); return this; }, setHeader () {} });
});
async function hook (event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST'; req.headers = { 'stripe-signature': 'x' };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
  return new Promise(resolve => webhook(req, { status () { return this; }, json: resolve, send: resolve, setHeader () {} }));
}

(async () => {
  let r = await call(advertise, 'POST', { name: 'Casa Birria', city: 'scottsdale-az', food: 'tacos', email: 'owner@casabirria.com', website: 'casabirria.com', blurb: 'Birria with consommé' });
  const s = sessions[0];
  check(r.status === 200 && s.mode === 'subscription' && s.line_items[0].price_data.unit_amount === 2900 && s.line_items[0].price_data.recurring.interval === 'month', 'a restaurant gets a $29/month checkout');
  check(s.metadata.website === 'https://casabirria.com' && s.metadata.kind === 'featured', 'with its details carried along');
  check((await call(advertise, 'POST', { name: 'X', city: 'nowhere', food: 'tacos', email: 'a@b.co' })).status === 400 && (await call(advertise, 'POST', { name: 'X', city: 'scottsdale-az', food: 'tacos', email: 'nope' })).status === 400, 'a bad city or email is refused');

  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_feat1', payment_status: 'paid', subscription: 'sub_f1', customer: 'cus_f1', metadata: s.metadata } } });
  check(docs['featured/cs_feat1']?.status === 'pending' && !docs['users/undefined/meta/profile'], 'paid: waiting for the owner, and no Grizzly account is touched');

  let g = await call(guide, 'GET', null, {}, { city: 'scottsdale-az', food: 'tacos' });
  check(!/Featured<\/span>/.test(g.body), 'not on the guide before approval');
  const list = await call(owner, 'GET', null, { authorization: 'Bearer owner' });
  check(list.data.featured?.[0]?.name === 'Casa Birria', 'the owner portal lists it');
  r = await call(owner, 'POST', { action: 'featured', id: 'cs_feat1', status: 'live' }, { authorization: 'Bearer owner' });
  check(r.status === 200 && docs['featured/cs_feat1'].status === 'live', 'the owner approves it');
  g = await call(guide, 'GET', null, {}, { city: 'scottsdale-az', food: 'tacos' });
  check(/Casa Birria <span class="badge">Featured<\/span>/.test(g.body) && g.body.indexOf('Casa Birria') < g.body.indexOf('Taco Town') && /rel="sponsored noopener"/.test(g.body), 'approved: first on its guide, marked Featured, sponsored link');
  check(!/Casa Birria/.test((await call(guide, 'GET', null, {}, { city: 'scottsdale-az', food: 'pizza' })).body), 'only on the guide it paid for');
  check(/advertise\.html/.test(g.body), 'guides invite restaurants to get featured');

  await hook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_f1', customer: 'cus_f1', metadata: { kind: 'featured' } } } });
  check(docs['featured/cs_feat1'].status === 'ended', 'cancelled: off the guide');

  const browser = await launch();
  const p = await newPage(browser, {});
  await p.route('**/api/advertise', rt => rt.request().method() === 'GET'
    ? rt.fulfill({ json: { price: 2900, cities: [{ slug: 'scottsdale-az', name: 'Scottsdale, AZ' }], foods: [{ slug: 'tacos', name: 'Tacos' }] } })
    : rt.fulfill({ status: 400, json: { error: "Add your restaurant's name." } }));
  await p.goto(`${BASE}/advertise.html`);
  await p.waitForTimeout(500);
  check(await p.locator('#city option').count() === 2 && /\$29/.test(await p.textContent('.perks')), 'the advertise page lists cities and the price');
  await p.click('#go');
  await p.waitForTimeout(300);
  check(/restaurant's name/.test(await p.textContent('#err')), 'and shows what to fix');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('featured');
})();
