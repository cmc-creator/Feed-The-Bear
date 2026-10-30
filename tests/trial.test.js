// Free trial and invite rewards on the server: one 7-day trial per person,
// 30 days from a friend's invite, and the inviter's free month.
const Module = require('module');
const { Readable } = require('stream');
const path = require('path');
const { check, finish } = require('./lib');

// Fake Stripe and Firestore so the functions run without real services.
const docs = {};
const stripeCalls = { sessions: [], credits: [] };
let stripeCustomersByEmail = {};
let liveSubs = {};
const fakeAdmin = {
  apps: [1],
  auth: () => ({
    getUser: async uid => { if (!docs[`users/${uid}/meta/profile`]) throw new Error('no user'); return { uid }; },
    verifyIdToken: async t => ({ uid: t.replace('token-', '') }),
  }),
  firestore: () => ({
    doc: p => ({
      set: async (data, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...data } : data; },
      create: async data => { if (docs[p]) throw new Error('exists'); docs[p] = data; },
      get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
    }),
  }),
};
const fakeStripe = () => ({
  webhooks: { constructEvent: body => JSON.parse(body.toString()) },
  customers: {
    list: async ({ email }) => ({ data: stripeCustomersByEmail[email] ? [{ id: stripeCustomersByEmail[email] }] : [] }),
    createBalanceTransaction: async (customer, tx) => { stripeCalls.credits.push({ customer, ...tx }); return {}; },
  },
  subscriptions: {
    list: async ({ customer }) => ({ data: liveSubs[customer] ? [{ status: 'active' }] : [] }),
    retrieve: async () => ({ trial_end: Math.floor(Date.now() / 1000) + 7 * 86400 }),
  },
  billingPortal: { sessions: { create: async ({ customer }) => ({ url: `https://billing.stripe.com/p/${customer}` }) } },
  checkout: {
    sessions: {
      create: async params => { stripeCalls.sessions.push(params); return { url: 'https://checkout.stripe.com/x' }; },
      retrieve: async id => sessionsById[id],
    },
  },
});
const sessionsById = {};
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return fakeStripe;
  if (req === 'firebase-admin') return fakeAdmin;
  return realLoad.call(this, req, ...rest);
};
const api = f => require(path.join(__dirname, '..', 'api', f));
const checkout = api('create-checkout.js');
const verify = api('verify-session.js');
const webhook = api('stripe-webhook.js');
Module._load = realLoad;

function call (fn, { method = 'GET', query = {}, body = {}, headers = {} } = {}) {
  return new Promise(resolve => {
    let status = 200;
    const res = {
      status (s) { status = s; return this; },
      json (data) { resolve({ status, data }); return this; },
      setHeader () {},
    };
    fn({ method, query, body, headers }, res);
  });
}
async function hook (event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': 'x' };
  await new Promise(resolve => webhook(req, { status () { return this; }, json () { resolve(); return this; } }));
}
const PRICE = 'price_1UW2DmLzFIsRCvKRfFexC3P8';

(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

  // A brand new account gets the 7-day trial.
  docs['users/newbie0000001/meta/profile'] = { name: 'New' };
  let r = await call(checkout, { query: { uid: 'newbie0000001', email: 'new@example.com' } });
  check(r.data.trial === true && r.data.days === 7, `a new account is offered a 7-day free trial (${JSON.stringify(r.data)})`);
  r = await call(checkout, { method: 'POST', body: { uid: 'newbie0000001', email: 'new@example.com', priceId: PRICE } });
  check(stripeCalls.sessions.at(-1).subscription_data.trial_period_days === 7, 'checkout starts with 7 free days');

  // A trial checkout completes with nothing charged: still unlocks Grizzly, and the trial is used up.
  sessionsById.cs_t1 = { id: 'cs_t1', status: 'complete', payment_status: 'no_payment_required', customer: 'cus_t1', subscription: 'sub_t1', metadata: { uid: 'newbie0000001' } };
  r = await call(verify, { query: { sessionId: 'cs_t1', uid: 'newbie0000001' } });
  check(r.status === 200 && docs['users/newbie0000001/meta/profile'].plan === 'grizzly', 'a free-trial checkout unlocks Grizzly');
  check(Date.parse(r.data.trialEnd) > Date.now() + 6 * 864e5, 'it says when the trial ends');
  r = await call(verify, { method: 'POST', body: { action: 'portal' }, headers: { authorization: 'Bearer token-newbie0000001' } });
  check(/billing\.stripe\.com\/p\/cus_t1/.test(r.data.url || ''), 'a subscriber can open Stripe to manage or cancel');
  r = await call(verify, { method: 'POST', body: { action: 'portal' }, headers: { authorization: 'Bearer token-friend00000009' } });
  check(r.status === 404, 'no subscription, no billing page');
  r = await call(checkout, { query: { uid: 'newbie0000001', email: 'new@example.com' } });
  check(r.data.trial === false, 'the same account cannot get a second trial');

  // Someone who paid before under another account doesn't get a trial either.
  docs['users/again00000001/meta/profile'] = {};
  stripeCustomersByEmail['old@example.com'] = 'cus_old';
  r = await call(checkout, { query: { uid: 'again00000001', email: 'old@example.com' } });
  check(r.data.trial === false, 'an email that already paid us gets no new trial');
  r = await call(checkout, { method: 'POST', body: { uid: 'again00000001', email: 'old@example.com', priceId: PRICE } });
  check(!('trial_period_days' in stripeCalls.sessions.at(-1).subscription_data), 'their checkout charges right away');

  // An unpaid, incomplete checkout still grants nothing.
  sessionsById.cs_bad = { id: 'cs_bad', status: 'open', payment_status: 'unpaid', metadata: { uid: 'again00000001' } };
  r = await call(verify, { query: { sessionId: 'cs_bad', uid: 'again00000001' } });
  check(r.status === 402 && docs['users/again00000001/meta/profile'].plan === undefined, 'an unfinished checkout grants nothing');

  // ── Invites ──
  docs['users/inviterfree001/meta/profile'] = { name: 'Inviter' };
  docs['users/friend00000001/meta/profile'] = { name: 'Friend' };
  r = await call(checkout, { query: { uid: 'friend00000001', email: 'friend@example.com', ref: 'inviterfree001' } });
  check(r.data.days === 30, 'an invited friend gets a 30-day trial');
  r = await call(checkout, { query: { uid: 'friend00000001', email: 'friend@example.com', ref: 'nobody00000000' } });
  check(r.data.days === 7, 'a made-up invite code gives the normal 7 days');
  r = await call(checkout, { query: { uid: 'friend00000001', email: 'friend@example.com', ref: 'friend00000001' } });
  check(r.data.days === 7, 'you cannot invite yourself');
  await call(checkout, { method: 'POST', body: { uid: 'friend00000001', email: 'friend@example.com', priceId: PRICE, ref: 'inviterfree001' } });
  const sess = stripeCalls.sessions.at(-1);
  check(sess.subscription_data.trial_period_days === 30 && sess.metadata.ref === 'inviterfree001', 'the invite is carried through checkout');

  // Friend finishes checkout: a free inviter gets a Grizzly month, once.
  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_f1', status: 'complete', payment_status: 'no_payment_required', customer: 'cus_f1', metadata: { uid: 'friend00000001', ref: 'inviterfree001' } } } });
  const until = Date.parse(docs['rewards/inviterfree001']?.grizzlyUntil || '');
  check(docs['users/inviterfree001/meta/profile'].plan === 'grizzly' && until > Date.now() + 29 * 864e5, 'the inviter gets a free Grizzly month');
  sessionsById.cs_f1 = { id: 'cs_f1', status: 'complete', payment_status: 'no_payment_required', customer: 'cus_f1', metadata: { uid: 'friend00000001', ref: 'inviterfree001' } };
  await call(verify, { query: { sessionId: 'cs_f1', uid: 'friend00000001' } });
  check(docs['rewards/inviterfree001'].invites === 1 && Date.parse(docs['rewards/inviterfree001'].grizzlyUntil) === until, 'the same friend only counts once');

  // A paying inviter gets a $4.99 credit instead.
  docs['users/inviterpaid01/meta/profile'] = { plan: 'grizzly', stripeCustomerId: 'cus_paid' };
  liveSubs.cus_paid = true;
  docs['users/friend00000002/meta/profile'] = {};
  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_f2', status: 'complete', payment_status: 'no_payment_required', customer: 'cus_f2', metadata: { uid: 'friend00000002', ref: 'inviterpaid01' } } } });
  check(stripeCalls.credits.some(c => c.customer === 'cus_paid' && c.amount === -499), 'a paying inviter gets $4.99 off their next bill');

  // When the free month ends, the inviter goes back to free.
  docs['rewards/inviterfree001'].grizzlyUntil = new Date(Date.now() - 1000).toISOString();
  r = await call(verify, { method: 'POST', headers: { authorization: 'Bearer token-inviterfree001' } });
  check(r.data.expired === true && docs['users/inviterfree001/meta/profile'].plan === 'free', 'an ended free month goes back to free');
  r = await call(verify, { method: 'POST', headers: {} });
  check(r.status === 401, 'reward status needs a signed-in user');

  finish('trial');
})();
