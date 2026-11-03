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
             customer.subscription.deleted,
             invoice.paid                    (invite rewards)
             customer.subscription.trial_will_end (reminder email, 3 days before)

   Environment variables required (set in Vercel dashboard):
     STRIPE_SECRET_KEY        - Stripe secret key
     STRIPE_WEBHOOK_SECRET    - The endpoint's signing secret (whsec_…)
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON service account key
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');
const admin  = require('firebase-admin');
const { rewardInviter } = require('./_referral');
const { sendEmail, emailHtml, esc } = require('./_email');

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

// Funnel counts for /usage.html (same daily counters as track.js), counted here
// because only Stripe knows a trial started or a first payment went through.
async function bump (db, name) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db.doc(`analytics/${day}`).set({ counts: { [name]: admin.firestore.FieldValue.increment(1) } }, { merge: true });
  } catch (err) { console.warn('[FTB] usage count failed:', err.message); }
}

// When a free trial ends (null once it's over) and whether they've cancelled,
// so the app can remind them a few days before.
function trialFields (sub) {
  return {
    trialEndsAt: sub?.status === 'trialing' && sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
  };
}

// Stripe's 3-day notice: say when the plan starts and what it costs, and how to cancel.
async function trialEndingEmail (db, sub) {
  const uid = await uidForCustomer(db, sub.customer, sub.metadata?.uid);
  if (!uid || sub.cancel_at_period_end || sub.status !== 'trialing') return;
  const user = await getAdmin().auth().getUser(uid).catch(() => null);
  if (!user?.email) return;
  const price = sub.items?.data?.[0]?.price;
  const amount = price?.unit_amount ? `$${(price.unit_amount / 100).toFixed(2)}` : '';
  const per = price?.recurring?.interval || '';
  const when = new Date(sub.trial_end * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  await sendEmail({
    to: user.email,
    subject: `Your Grizzly trial ends ${when}`,
    tag: 'trial-ending',
    html: emailHtml([
      `Your free Grizzly trial ends on <strong>${esc(when)}</strong>.`,
      `Then your plan starts${amount ? ` at <strong>${esc(amount)}${per ? `/${esc(per)}` : ''}</strong>` : ''}, and you keep unlimited spots, Today's Pick, Bear Swipe, friends and Byte Cub. There's nothing to do to keep it.`,
      'Rather not continue? Open the app, tap <strong>My Account → Manage subscription</strong>, and cancel before then. You won\'t be charged.',
      '<a href="https://www.feed-the-bear.com/app.html" style="display:inline-block;background:#c8803a;color:#fff;text-decoration:none;font-weight:800;padding:12px 22px;border-radius:999px">Open Feed The Bear</a>',
    ]),
  });
}

// Who invited this subscriber, if anyone. Subscriptions started before the
// invite was copied onto them only have it on their checkout session.
async function inviteFor (stripe, subId) {
  if (!subId) return null;
  const sub = typeof subId === 'string' ? await stripe.subscriptions.retrieve(subId) : subId;
  let { uid, ref } = sub.metadata || {};
  if (!ref) {
    const session = (await stripe.checkout.sessions.list({ subscription: sub.id, limit: 1 })).data[0];
    ({ uid, ref } = { uid: uid || session?.metadata?.uid, ref: session?.metadata?.ref });
  }
  return uid && ref ? { uid, ref } : null;
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
        // Only for the trial date: a failed lookup must not block turning Grizzly on.
        let sub = null;
        try { if (obj.subscription) sub = await stripe.subscriptions.retrieve(obj.subscription); } catch { sub = null; }
        await setPlan(db, uid, {
          plan:             'grizzly',
          stripeCustomerId: obj.customer,
          stripeSessionId:  obj.id,
          upgradedAt:       new Date().toISOString(),
          ...(sub ? trialFields(sub) : {}),
        });
        if (obj.customer) await db.doc(`stripeCustomers/${obj.customer}`).set({ uid }, { merge: true });
        await bump(db, obj.payment_status === 'no_payment_required' ? 'trial_started' : 'paid_signup');
      }
    }

    // A member's first real payment (after a trial, or straight away), once each.
    // Only a count: a failure here must not make Stripe retry the payment event.
    if (event.type === 'invoice.paid' && obj.amount_paid > 0) {
      try {
        const uid = await uidForCustomer(db, obj.customer, null);
        const ref = uid && db.doc(`users/${uid}/meta/profile`);
        if (ref && !(await ref.get()).data()?.firstPaidAt) {
          await ref.set({ firstPaidAt: new Date().toISOString() }, { merge: true });
          await bump(db, 'first_payment');
        }
      } catch (err) { console.warn('[FTB] first payment count failed:', err.message); }
    }

    // A friend's first real payment (after their free trial): whoever invited
    // them gets the free month, only ever once per friend. Rewarding at
    // checkout let free trials, cancelled right away, farm free months.
    if (event.type === 'invoice.paid' && obj.amount_paid > 0) {
      const invite = await inviteFor(stripe, obj.subscription || obj.parent?.subscription_details?.subscription);
      if (invite) await rewardInviter({ db, stripe, inviterUid: invite.ref, friendUid: invite.uid });
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const uid = await uidForCustomer(db, obj.customer, obj.metadata?.uid);
      // 'incomplete' happens mid-checkout and may arrive late, so it changes nothing.
      const plan = event.type === 'customer.subscription.deleted' || ENDED.includes(obj.status) ? 'free'
        : ACTIVE.includes(obj.status) ? 'grizzly' : null;
      if (uid && plan) await setPlan(db, uid, { plan, ...trialFields(event.type === 'customer.subscription.deleted' ? null : obj) });
    }

    if (event.type === 'customer.subscription.trial_will_end') {
      // A failed email shouldn't make Stripe retry the whole event.
      await trialEndingEmail(db, obj).catch(err => console.error('[FTB] trial email failed:', err.message));
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[FTB] stripe-webhook error:', err.message);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
