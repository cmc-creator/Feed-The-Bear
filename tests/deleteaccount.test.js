// Account deletion on the server: billing stops first, then every record
// keyed by the account goes, including the weekly email list.
const Module = require('module');
const path = require('path');
const { check, finish } = require('./lib');

const docs = {};
const deletedUsers = [];
const cancelled = [];
let stripeFails = false;
const fakeAdmin = {
  apps: [1],
  auth: () => ({
    verifyIdToken: async t => ({ uid: t.replace('token-', ''), auth_time: Math.floor(Date.now() / 1000) - (t.includes('old') ? 3600 : 10) }),
    deleteUser: async uid => { deletedUsers.push(uid); },
  }),
  firestore: () => ({
    doc: p => ({
      get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
      delete: async () => { delete docs[p]; },
    }),
    collection: c => ({
      where: (f, op, v) => ({
        get: async () => ({
          docs: Object.keys(docs).filter(k => k.startsWith(`${c}/`) && docs[k][f] === v)
            .map(k => ({ ref: { delete: async () => { delete docs[k]; } } })),
        }),
      }),
    }),
    recursiveDelete: async ref => { Object.keys(docs).filter(k => k.startsWith('users/u1/')).forEach(k => delete docs[k]); },
  }),
};
const fakeStripe = () => ({
  subscriptions: {
    list: async () => { if (stripeFails) throw new Error('stripe down'); return { data: [{ id: 'sub_1', status: 'active' }] }; },
    cancel: async id => { cancelled.push(id); },
  },
});
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return fakeStripe;
  if (req === 'firebase-admin') return fakeAdmin;
  return realLoad.call(this, req, ...rest);
};
// Left in place: delete-account.js requires stripe lazily, inside the handler.
const del = require(path.join(__dirname, '..', 'api', 'delete-account.js'));

function call ({ method = 'POST', headers = {} } = {}) {
  return new Promise(resolve => {
    let status = 200;
    del({ method, headers }, {
      status (s) { status = s; return this; },
      json (data) { resolve({ status, data }); return this; },
      setHeader () {},
    });
  });
}

(async () => {
  process.env.FIREBASE_SERVICE_ACCOUNT = '{}';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  const seed = () => Object.assign(docs, {
    'users/u1/meta/profile': { plan: 'grizzly', stripeCustomerId: 'cus_1' },
    'users/u1/restaurants/r1': { name: 'Taco Spot' },
    'profiles/share1': { uid: 'u1' },
    'profiles/share2': { uid: 'someone-else' },
    'digestSubscribers/u1': { on: true, email: 'bear@example.com' },
    'rewards/u1': { invites: 2 },
    'trials/u1': { at: 'x' },
    'referrals/u1': { inviter: 'u9' },
    'stripeCustomers/cus_1': { uid: 'u1' },
  });

  seed();
  let r = await call({ method: 'GET' });
  check(r.status === 405, 'only POST deletes');
  r = await call();
  check(r.status === 401, 'deleting needs a signed-in user');
  r = await call({ headers: { authorization: 'Bearer token-old-u1' } });
  check(r.status === 403 && docs['users/u1/meta/profile'], 'an old sign-in must sign in again first');

  stripeFails = true;
  r = await call({ headers: { authorization: 'Bearer token-u1' } });
  check(r.status === 502 && docs['digestSubscribers/u1'] && !deletedUsers.length, 'if billing cannot be stopped, nothing is deleted');
  stripeFails = false;

  r = await call({ headers: { authorization: 'Bearer token-u1' } });
  check(r.status === 200 && r.data.deleted, 'the account is deleted');
  check(cancelled.includes('sub_1'), 'the Grizzly subscription is cancelled');
  check(deletedUsers.includes('u1'), 'the sign-in account is removed');
  const left = Object.keys(docs);
  check(!left.some(k => k.includes('u1') || k.includes('cus_1') || k === 'profiles/share1'), `nothing keyed by the account is left (${left.join(', ')})`);
  check(!docs['digestSubscribers/u1'], 'their email is off the weekly email list');
  check(docs['profiles/share2'], "other people's profiles are untouched");

  finish('deleteaccount');
})();
