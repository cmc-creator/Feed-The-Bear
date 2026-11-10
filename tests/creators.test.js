// Creator payouts: 20% of each payment (before tax) from someone who joined
// from a creator's link is owed to that creator (stripe-webhook.js), shown in
// the owner portal and paid out with Mark paid (owner.js). Fakes throughout.
const Module = require('module');
const { Readable } = require('stream');
const path = require('path');
const { check, finish } = require('./lib');

const docs = {};
const ref = p => ({ id: p.split('/').pop(),
  set: async (v, o) => {
    const cur = o?.merge ? { ...(docs[p] || {}) } : {};
    for (const [k, x] of Object.entries(v)) cur[k] = x && x.__inc !== undefined ? (Number(cur[k]) || 0) + x.__inc : x;
    docs[p] = cur;
  },
  create: async v => { if (docs[p]) throw new Error('exists'); docs[p] = { ...v }; },
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  delete: async () => { delete docs[p]; } });
const query = (col, filters = []) => ({
  where: (f, op, v) => query(col, [...filters, [f, v]]), orderBy: () => query(col, filters), limit: () => query(col, filters),
  get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(`${col}/`) && filters.every(([f, v]) => docs[k][f] === v)).map(k => ({ id: k.split('/')[1], ref: ref(k), data: () => docs[k] })) }),
});
const firestore = Object.assign(() => ({ doc: ref, collection: c => query(c) }), { FieldValue: { increment: n => ({ __inc: n }), delete: () => null } });
const fakeAdmin = { apps: [1], firestore,
  auth: () => ({ verifyIdToken: async t => ({ email: t === 'owner' ? 'cmc@conniemichelleconsulting.com' : 'x@y.z', email_verified: true }), getUser: async uid => ({ email: `${uid}@example.com` }) }) };
const fakeStripe = () => ({
  webhooks: { constructEvent: body => JSON.parse(body.toString()) },
  subscriptions: { retrieve: async id => ({ id, metadata: id === 'sub_ref' ? { uid: 'friendUid0001', ref: 'creatorUid001' } : { uid: 'soloUid000001' } }), list: async () => ({ data: [] }) },
  checkout: { sessions: { list: async () => ({ data: [] }) } },
  customers: { update: async () => ({}), retrieve: async () => ({ balance: 0 }), createBalanceTransaction: async () => ({}) },
  promotionCodes: { list: async () => ({ data: [] }) },
});
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return fakeStripe;
  if (req === 'firebase-admin') return fakeAdmin;
  return load.call(this, req, ...rest);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const webhook = require(path.join(__dirname, '..', 'api', 'stripe-webhook.js'));
const owner = require(path.join(__dirname, '..', 'api', 'owner.js'));
Module._load = load;
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

async function hook (event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST'; req.headers = { 'stripe-signature': 'x' };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
  return new Promise(resolve => webhook(req, { status () { return this; }, json: resolve, send: resolve, setHeader () {} }));
}
const call = (method, body) => new Promise(resolve => {
  let status = 200;
  owner({ method, body, headers: { authorization: 'Bearer owner' }, query: {} }, { status (s) { status = s; return this; }, json (data) { resolve({ status, ...data }); return this; }, setHeader () {} });
});

(async () => {
  const paid = { id: 'in_1', amount_paid: 4999, total_taxes: [{ amount: 400 }], customer: 'cus_f', subscription: 'sub_ref' };
  await hook({ type: 'invoice.paid', data: { object: paid } });
  check(docs['creatorEarnings/creatorUid001']?.owedCents === 920, `20% of the payment before tax is owed to the creator (${docs['creatorEarnings/creatorUid001']?.owedCents} cents)`);
  await hook({ type: 'invoice.paid', data: { object: paid } });
  check(docs['creatorEarnings/creatorUid001'].owedCents === 920, 'the same invoice twice is credited once');
  await hook({ type: 'invoice.paid', data: { object: { ...paid, id: 'in_2', total_taxes: [] } } });
  check(docs['creatorEarnings/creatorUid001'].owedCents === 920 + 1000 && docs['creatorEarnings/creatorUid001'].payments === 2, 'every renewal adds 20% more');
  await hook({ type: 'invoice.paid', data: { object: { ...paid, id: 'in_3', subscription: 'sub_solo' } } });
  check(Object.keys(docs).filter(k => k.startsWith('creatorEarnings/')).length === 1, "someone who didn't join from a link earns nobody anything");

  const list = await call('GET');
  const c = list.creators?.[0];
  check(c?.uid === 'creatorUid001' && c.owedCents === 1920 && c.email === 'creatorUid001@example.com', 'the owner portal shows what each creator is owed');
  const r = await call('POST', { action: 'creatorPaid', uid: 'creatorUid001' });
  check(r.status === 200 && docs['creatorEarnings/creatorUid001'].owedCents === 0 && docs['creatorEarnings/creatorUid001'].paidCents === 1920 && /\$19\.20/.test(r.message), 'Mark paid clears what is owed and keeps the total paid');
  check((await call('POST', { action: 'creatorPaid', uid: 'creatorUid001' })).status === 400, 'nothing owed: nothing to mark');
  finish('creators');
})();
