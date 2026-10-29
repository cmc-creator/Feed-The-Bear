// Payments: the Stripe webhook turns Grizzly on and off by itself, and a
// paid checkout is never lost when the buyer comes back signed out.
const Module = require('module');
const { Readable } = require('stream');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

// Fake Stripe and Firestore so the webhook runs without real services.
const docs = {};
const fakeAdmin = {
  apps: [1],
  firestore: () => ({
    doc: p => ({
      set: async (data, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...data } : data; },
      get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
    }),
  }),
};
const fakeStripe = () => ({
  webhooks: {
    constructEvent: (body, sig) => {
      if (sig !== 'good') throw new Error('bad signature');
      return JSON.parse(body.toString());
    },
  },
});
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return fakeStripe;
  if (req === 'firebase-admin') return fakeAdmin;
  return realLoad.call(this, req, ...rest);
};
const webhook = require(path.join(__dirname, '..', 'api', 'stripe-webhook.js'));
Module._load = realLoad;

async function send (event, sig = 'good') {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': sig };
  let status = 0;
  const res = { status (s) { status = s; return this; }, json () { return this; } };
  await webhook(req, res);
  return status;
}
const plan = uid => docs[`users/${uid}/meta/profile`]?.plan;

(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

  check(await send({ type: 'checkout.session.completed', data: { object: {} } }, 'forged') === 400, 'webhook rejects a forged signature');

  await send({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', customer: 'cus_1', payment_status: 'paid', metadata: { uid: 'u1' } } } });
  check(plan('u1') === 'grizzly', 'a paid checkout turns on Grizzly without the app');
  check(docs['stripeCustomers/cus_1']?.uid === 'u1', 'remembers which account the Stripe customer is');

  await send({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', customer: 'cus_2', payment_status: 'unpaid', metadata: { uid: 'u2' } } } });
  check(plan('u2') === undefined, 'an unpaid checkout grants nothing');

  await send({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'incomplete', metadata: {} } } });
  check(plan('u1') === 'grizzly', 'a late mid-checkout update does not take Grizzly away');

  await send({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'unpaid', metadata: {} } } });
  check(plan('u1') === 'free', 'stopped paying: back to free');

  await send({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'active', metadata: {} } } });
  check(plan('u1') === 'grizzly', 'paid again: Grizzly is back');

  await send({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_9', status: 'canceled', metadata: { uid: 'u1' } } } });
  check(plan('u1') === 'free', 'a cancelled subscription goes back to free');

  // Coming back from Stripe signed out (e.g. it opened in a browser, not the app)
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [] }] });
  await p.goto(`${BASE}/app.html?upgrade=success&session_id=cs_test_abc123`);
  await p.waitForTimeout(3500);
  check(await p.evaluate(() => localStorage.getItem('ftb_pending_session_v1')) === 'cs_test_abc123', 'the paid checkout is kept until it is confirmed');
  check(!/session_id/.test(p.url()), 'the address bar is cleaned up');
  const toast = await p.locator('body').innerText();
  check(/Payment received/.test(toast), 'tells the buyer their payment arrived');
  check(await p.locator('#auth-overlay').isVisible(), 'asks them to sign in to finish');
  await browser.close();
  finish('payments');
})();
