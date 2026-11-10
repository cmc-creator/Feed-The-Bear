// Google Play US alternative billing: a Stripe sale made in the Play app is
// reported to Google (first transaction with the app's token, renewals,
// refunds); website sales aren't. Fake Stripe, Firestore and Google.
const Module = require('module');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { check, finish } = require('./lib');

const docs = {};
const fakeAdmin = {
  apps: [1],
  // A checkout needs a signed-in caller; the fake ID token is just the uid.
  auth: () => ({ getUser: async uid => ({ uid, email: `${uid}@example.com` }), verifyIdToken: async t => ({ uid: t, email: `${t}@example.com` }) }),
  firestore: () => ({
    doc: p => ({
      set: async (data, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...data } : data; },
      get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
      delete: async () => { delete docs[p]; },
    }),
    collection: name => ({
      limit: () => ({ get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(name + '/')).map(k => ({
        data: () => docs[k], ref: { delete: async () => { delete docs[k]; } } })) }) }),
    }),
  }),
};
const subs = {
  sub_trial: { id: 'sub_trial', status: 'trialing', metadata: { uid: 'u1' } },
  sub_paid: { id: 'sub_paid', status: 'active', metadata: { uid: 'u2' } },
  sub_web: { id: 'sub_web', status: 'active', metadata: { uid: 'u3' } },
};
const invoices = { in_paid1: { id: 'in_paid1', amount_paid: 4999, total_taxes: [{ amount: 400 }] } };
let sessionN = 0;
const fakeStripe = () => ({
  webhooks: { constructEvent: body => JSON.parse(body.toString()) },
  customers: { list: async () => ({ data: [] }) },
  subscriptions: { retrieve: async id => subs[id] },
  invoices: { retrieve: async id => invoices[id] },
  checkout: { sessions: { create: async () => ({ id: `cs_${++sessionN}`, url: 'https://checkout.stripe.com/x' }), list: async () => ({ data: [] }) } },
});
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'stripe') return fakeStripe;
  if (req === 'firebase-admin') return fakeAdmin;
  return realLoad.call(this, req, ...rest);
};
const api = f => require(path.join(__dirname, '..', 'api', f));
const checkout = api('create-checkout.js');
const webhook = api('stripe-webhook.js');
Module._load = realLoad;

// Google: a signed-in token, then the reports.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const sent = [];
let googleDown = false;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
    const jwt = new URLSearchParams(opts.body).get('assertion');
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    sent.push({ token: true, scope: claims.scope });
    return { ok: true, status: 200, json: async () => ({ access_token: 'g-token', expires_in: 3600 }) };
  }
  if (googleDown) return { ok: false, status: 503, text: async () => 'down' };
  sent.push({ url: String(url), auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({}) };
};

function call (fn, body) {
  return new Promise(resolve => {
    let status = 200;
    fn({ method: 'POST', query: {}, body, headers: body?.uid ? { authorization: `Bearer ${body.uid}` } : {} }, { status (s) { status = s; return this; }, json (data) { resolve({ status, data }); return this; }, setHeader () {} });
  });
}
async function hook (event) {
  const req = Readable.from([Buffer.from(JSON.stringify(event))]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': 'x' };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
  let status = 200;
  await new Promise(resolve => webhook(req, { status (s) { status = s; return this; }, json () { resolve(); return this; } }));
  return status;
}
const reports = () => sent.filter(s => s.url);
const PRICE = 'price_1UW2DmLzFIsRCvKRfFexC3P8';

(async () => {
  // Checkout from the Play app keeps Google's token for the webhook.
  let r = await call(checkout, { uid: 'u1', email: 'u1@example.com', priceId: PRICE, playToken: 'TOKEN_TRIAL' });
  check(r.status === 200 && docs['playCheckouts/cs_1']?.token === 'TOKEN_TRIAL', 'checkout keeps the Play token');
  r = await call(checkout, { uid: 'u3', email: 'u3@example.com', priceId: PRICE });
  check(r.status === 200 && !docs['playCheckouts/cs_2'], 'website checkout keeps nothing');

  // Free trial from the app: a $0 first transaction with the token.
  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', metadata: { uid: 'u1' }, payment_status: 'no_payment_required', status: 'complete', subscription: 'sub_trial', customer: 'cus_1', created: 1793000000 } } });
  let rep = reports()[0];
  check(rep && rep.url.endsWith('/applications/com.feedthebear.app/externalTransactions?externalTransactionId=ftb_sub_trial_start'), `reported to Google (${rep?.url})`);
  check(rep?.auth === 'Bearer g-token' && sent[0].scope === 'https://www.googleapis.com/auth/androidpublisher', 'signed in with the androidpublisher scope');
  check(rep?.body.originalPreTaxAmount.priceMicros === '0' && rep.body.recurringTransaction.externalTransactionToken === 'TOKEN_TRIAL'
    && rep.body.recurringTransaction.externalSubscription.subscriptionType === 'RECURRING' && rep.body.userTaxAddress.regionCode === 'US', 'trial: $0 with the token, recurring, US');
  check(!docs['playCheckouts/cs_1'] && docs['users/u1/meta/profile']?.plan === 'grizzly', 'token used up; Grizzly on');

  // The $0 trial invoice isn't a sale; the first real charge is a renewal of the start.
  await hook({ type: 'invoice.paid', data: { object: { id: 'in_trial0', amount_paid: 0, customer: 'cus_1', subscription: 'sub_trial' } } });
  check(reports().length === 1, 'the $0 trial invoice is not reported');
  await hook({ type: 'invoice.paid', data: { object: { id: 'in_t1', amount_paid: 499, total_taxes: [{ amount: 40 }], customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_trial' } }, status_transitions: { paid_at: 1793600000 } } } });
  rep = reports()[1];
  check(rep?.url.endsWith('externalTransactionId=ftb_in_t1') && rep.body.recurringTransaction.initialExternalTransactionId === 'ftb_sub_trial_start'
    && !rep.body.recurringTransaction.externalTransactionToken, 'first charge after the trial: a renewal pointing at the start');
  check(rep?.body.originalPreTaxAmount.priceMicros === '4590000' && rep.body.originalTaxAmount.priceMicros === '400000', 'with the price before tax and the tax');

  // Paid straight away: the first invoice is the start, not also a renewal.
  await call(checkout, { uid: 'u2', email: 'u2@example.com', priceId: PRICE, playToken: 'TOKEN_PAID' });
  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_3', metadata: { uid: 'u2' }, payment_status: 'paid', subscription: 'sub_paid', invoice: 'in_paid1', customer: 'cus_2', created: 1793000000 } } });
  rep = reports()[2];
  check(rep?.body.originalPreTaxAmount.priceMicros === '45990000' && rep.body.recurringTransaction.externalTransactionToken === 'TOKEN_PAID', 'paid signup: the charge with the token');
  await hook({ type: 'invoice.paid', data: { object: { id: 'in_paid1', amount_paid: 4999, customer: 'cus_2', subscription: 'sub_paid' } } });
  check(reports().length === 3, 'its first invoice is not reported twice');

  // Website subscriptions are never reported.
  await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', metadata: { uid: 'u3' }, payment_status: 'paid', subscription: 'sub_web', customer: 'cus_3' } } });
  await hook({ type: 'invoice.paid', data: { object: { id: 'in_w2', amount_paid: 4999, customer: 'cus_3', subscription: 'sub_web' } } });
  check(reports().length === 3, 'website sales are not reported');

  // Refunds.
  await hook({ type: 'charge.refunded', data: { object: { id: 'ch_1', invoice: 'in_paid1', amount: 4999, amount_refunded: 4999 } } });
  rep = reports()[3];
  check(rep?.url.endsWith('/externalTransactions/ftb_sub_paid_start:refund') && rep.body.fullRefund && rep.body.refundTime, 'full refund reported on its transaction');
  await hook({ type: 'charge.refunded', data: { object: { id: 'ch_2', invoice: 'in_t1', amount: 499, amount_refunded: 200 } } });
  rep = reports()[4];
  check(rep?.url.endsWith('/ftb_in_t1:refund') && rep.body.partialRefund.refundPreTaxAmount.priceMicros === '2000000', 'partial refund with the amount');
  await hook({ type: 'charge.refunded', data: { object: { id: 'ch_3', invoice: 'in_w2', amount: 4999, amount_refunded: 4999 } } });
  check(reports().length === 5, 'website refunds are not reported');

  // Google unreachable: kept and sent on the next webhook call; Grizzly still turns on.
  googleDown = true;
  await call(checkout, { uid: 'u4', email: 'u4@example.com', priceId: PRICE, playToken: 'TOKEN_LATE' });
  subs.sub_late = { id: 'sub_late', status: 'trialing', metadata: { uid: 'u4' } };
  const st = await hook({ type: 'checkout.session.completed', data: { object: { id: 'cs_4', metadata: { uid: 'u4' }, payment_status: 'no_payment_required', status: 'complete', subscription: 'sub_late', customer: 'cus_4' } } });
  check(st === 200 && docs['users/u4/meta/profile']?.plan === 'grizzly' && docs['playPending/ftb_sub_late_start'], 'Google down: Grizzly still on, report kept');
  googleDown = false;
  await hook({ type: 'customer.subscription.updated', data: { object: { id: 'sub_x', status: 'active', customer: 'cus_9', metadata: {} } } });
  check(!docs['playPending/ftb_sub_late_start'] && reports().some(x => x.body.recurringTransaction?.externalTransactionToken === 'TOKEN_LATE'), 'and sent on the next webhook call');

  // The Android build has what it needs.
  const root = path.join(__dirname, '..', 'native', 'android', 'app');
  const gradle = fs.readFileSync(path.join(root, 'build.gradle'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main/java/com/feedthebear/app/MainActivity.java'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'src/main/AndroidManifest.xml'), 'utf8');
  check(/com\.android\.billingclient:billing:\d/.test(gradle), 'Play Billing Library in the build');
  check(/registerPlugin\(PlayBillingPlugin\.class\)/.test(main) && /registerPlugin\(SpeechPlugin\.class\)/.test(main) && /registerPlugin\(ShareSheetPlugin\.class\)/.test(main), 'billing, speech and share plugins registered');
  check(/RECORD_AUDIO/.test(manifest) && /android\.speech\.RecognitionService/.test(manifest), 'microphone permission and speech service query');
  // 2.3.0: background location for closed-app nearby alerts, explained in the app first (bg-location-overlay).
  check(/ACCESS_BACKGROUND_LOCATION"/.test(manifest.replace(/<!--[\s\S]*?-->/g, '')) && /id="bg-location-overlay"/.test(fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8')), 'background location for nearby alerts, with the explanation screen');

  finish('playbilling');
})();
