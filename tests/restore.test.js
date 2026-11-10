// A paid Grizzly whose account was re-created (new Firebase project) comes
// back: the server finds the subscription by the verified email.
const path = require('path');
const Module = require('module');
const { ROOT, check, finish } = require('./lib');

(async () => {
  const docs = {};
  const docRef = p => ({ get: async () => ({ exists: !!docs[p], data: () => docs[p] }), set: async (d, o) => { docs[p] = o?.merge ? { ...(docs[p] || {}), ...d } : d; }, delete: async () => { delete docs[p]; } });
  const users = {
    'token-new': { uid: 'newuid', email: 'Connie@Gmail.com', email_verified: true },
    'token-unverified': { uid: 'u2', email: 'connie@gmail.com', email_verified: false },
    'token-other': { uid: 'u3', email: 'nobody@gmail.com', email_verified: true },
  };
  const fakeAdmin = {
    apps: [1],
    auth: () => ({ verifyIdToken: async t => { if (!users[t]) throw new Error('bad'); return users[t]; } }),
    firestore: () => ({ doc: docRef }),
  };
  const updates = [];
  const fakeStripe = () => ({
    customers: {
      list: async ({ email }) => ({ data: email === 'connie@gmail.com' ? [{ id: 'cus_1', metadata: { uid: 'olduid' } }] : [] }),
      update: async (id, d) => { updates.push(['customer', id, d]); },
    },
    subscriptions: {
      list: async () => ({ data: [{ id: 'sub_1', status: 'active', metadata: { uid: 'olduid' }, cancel_at_period_end: false }] }),
      update: async (id, d) => { updates.push(['sub', id, d]); },
    },
  });
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'firebase-admin') return fakeAdmin;
    if (req === 'stripe') return fakeStripe;
    return orig.call(this, req, ...rest);
  };
  const api = require(path.join(ROOT, 'api', 'verify-session.js'));
  Module._load = orig;
  const call = token => new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (d) { resolve({ status: this.c, data: d }); return this; } };
    api({ method: 'POST', body: { action: 'restore' }, headers: { authorization: `Bearer ${token}` }, query: {} }, res);
  });

  let r = await call('token-new');
  check(r.data.plan === 'grizzly' && r.data.restored, `the paid email gets Grizzly back (${JSON.stringify(r.data)})`);
  check(docs['users/newuid/meta/profile']?.plan === 'grizzly' && docs['users/newuid/meta/profile']?.stripeCustomerId === 'cus_1', 'on the account signed in now');
  check(docs['stripeCustomers/cus_1']?.uid === 'newuid', 'and Stripe events now find this account');
  check(updates.some(([k, id, d]) => k === 'sub' && id === 'sub_1' && d.metadata.uid === 'newuid'), 'the subscription points at the new account, so renewals keep it on');
  r = await call('token-new');
  check(r.data.plan === 'grizzly' && !r.data.restored, 'asking again changes nothing');
  r = await call('token-unverified');
  check(r.data.plan !== 'grizzly' && !docs['users/u2/meta/profile']?.plan, 'an unverified email is never given a paid plan');
  r = await call('token-other');
  check(r.data.plan === 'free' && !r.data.restored, 'an email with no subscription stays free');
  finish('restore');
})();
