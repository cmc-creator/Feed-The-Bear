/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Stripe Webhook
   ════════════════════════════════════════════════════════════
   Stripe calls this directly, so Grizzly turns on after payment even if
   the buyer never makes it back to the app, and turns off when a
   subscription ends or stops being paid.

   Stripe Dashboard → Developers → Webhooks → Add endpoint
     URL:    https://www.feed-the-bear.com/api/stripe-webhook
     Events: checkout.session.completed,
             customer.subscription.updated,
             customer.subscription.deleted

   Environment variables required (set in Vercel dashboard):
     STRIPE_SECRET_KEY        - Stripe secret key
     STRIPE_WEBHOOK_SECRET    - The endpoint's signing secret (whsec_…)
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON service account key
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');
const admin  = require('firebase-admin');
const { rewardInviter } = require('./_referral');

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

// Signature checks need the exact bytes Stripe sent, so read the raw body.
function rawBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const ACTIVE = ['active', 'trialing', 'past_due'];
const ENDED  = ['canceled', 'unpaid', 'incomplete_expired', 'paused'];

async function setPlan (db, uid, fields) {
  await db.doc(`users/${uid}/meta/profile`).set(fields, { merge: true });
}

// Customer id → uid, so subscription events can find the account.
async function uidForCustomer (db, customerId, metadataUid) {
  if (metadataUid) return metadataUid;
  if (!customerId) return null;
  const snap = await db.doc(`stripeCustomers/${customerId}`).get();
  return snap.exists ? snap.data().uid : null;
}

module.exports = async function handler (req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET is not set' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], secret);
  } catch (err) {
    return res.status(400).json({ error: 'Bad signature' });
  }

  try {
    const db = getAdmin().firestore();
    const obj = event.data.object;

    if (event.type === 'checkout.session.completed') {
      const uid = obj.metadata?.uid || obj.client_reference_id;
      // A free-trial checkout completes with nothing charged yet.
      const done = obj.payment_status === 'paid' || (obj.payment_status === 'no_payment_required' && obj.status === 'complete');
      if (uid && done) {
        await db.doc(`trials/${uid}`).set({ at: new Date().toISOString(), sessionId: obj.id }, { merge: true });
        await setPlan(db, uid, {
          plan:             'grizzly',
          stripeCustomerId: obj.customer,
          stripeSessionId:  obj.id,
          upgradedAt:       new Date().toISOString(),
        });
        if (obj.customer) await db.doc(`stripeCustomers/${obj.customer}`).set({ uid }, { merge: true });
        // Came from a friend's invite: they get their free month (only ever once per friend).
        if (obj.metadata?.ref) await rewardInviter({ db, stripe, inviterUid: obj.metadata.ref, friendUid: uid });
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const uid = await uidForCustomer(db, obj.customer, obj.metadata?.uid);
      // 'incomplete' happens mid-checkout and may arrive late, so it changes nothing.
      const plan = event.type === 'customer.subscription.deleted' || ENDED.includes(obj.status) ? 'free'
        : ACTIVE.includes(obj.status) ? 'grizzly' : null;
      if (uid && plan) await setPlan(db, uid, { plan });
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[FTB] stripe-webhook error:', err.message);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
