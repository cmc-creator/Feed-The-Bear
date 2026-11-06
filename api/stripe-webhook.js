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
             charge.refunded                 (Google Play sale reports, _play.js)

   Environment variables required (set in Vercel dashboard):
     STRIPE_SECRET_KEY        - Stripe secret key
     STRIPE_WEBHOOK_SECRET    - The endpoint's signing secret (whsec_…)
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON service account key
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');
const admin  = require('firebase-admin');
const { rewardInviter } = require('./_referral');
const play = require('./_play');
const { vipFor, grantVip } = require('./owner');
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

async function giftPaid (db, session) {
  const m = session.metadata || {};
  const ref = db.doc(`gifts/${session.id}`);
  if ((await ref.get()).exists) return; // Stripe can send an event twice
  const months = Number(m.months) === 12 ? 12 : 3;
  const from = m.from || 'A friend';
  const r = await grantVip(db, getAdmin(), { email: m.to, months, note: `Gift from ${from}`, by: 'gift' });
  await ref.set({ to: m.to, from, months, buyer: session.customer_details?.email || session.customer_email || '', paid: session.amount_total || 0, at: new Date().toISOString(), pending: r.pending });
  await bump(db, 'gift_bought').catch(() => {});
  const app = process.env.APP_URL || 'https://www.feed-the-bear.com';
  const hi = m.toName ? `Hi ${esc(m.toName)},` : 'Hi,';
  await sendEmail({
    to: m.to, name: m.toName || '', tag: 'gift',
    subject: `🎁 ${from} gave you Feed The Bear Grizzly`,
    html: emailHtml([
      `<h1 style="margin:0 0 8px;font-size:22px">You got Grizzly! 🐻</h1>`,
      `<p>${hi} <strong>${esc(from)}</strong> gave you ${months === 12 ? 'a year' : '3 months'} of Feed The Bear Grizzly: unlimited spots, Byte Cub AI picks, your Bear Cave page and more.</p>`,
      m.message ? `<p style="padding:12px 14px;border-radius:12px;background:#f3ead9;font-style:italic">"${esc(m.message)}"</p>` : '',
      `<p>Sign in with <strong>${esc(m.to)}</strong> and it's already on.</p>`,
      `<p><a href="${app}/app.html" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#ff8a3d;color:#1b130b;font-weight:800;text-decoration:none">Open Feed The Bear</a></p>`,
    ]),
  }).catch(err => console.error('[FTB] gift email:', err.message));
  const buyer = session.customer_details?.email || session.customer_email;
  if (buyer) {
    await sendEmail({
      to: buyer, tag: 'gift-receipt', subject: `Your Grizzly gift for ${m.toName || m.to} is on its way`,
      html: emailHtml([`<h1 style="margin:0 0 8px;font-size:22px">Gift sent 🎁</h1>`, `<p>${esc(m.toName || m.to)} has ${months === 12 ? 'a year' : '3 months'} of Grizzly${r.pending ? ' waiting for them the first time they sign in' : ' on their account now'}. We emailed them too. Thank you!</p>`]),
    }).catch(() => {});
  }
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

    // A Grizzly gift (gift.js): the friend gets Grizzly for those months, and an email.
    if (event.type === 'checkout.session.completed' && obj.metadata?.kind === 'gift') {
      if (obj.payment_status === 'paid') await giftPaid(db, obj);
      return res.status(200).json({ received: true });
    }

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
        // Bought in the Play app: report it to Google (never blocks Grizzly).
        try {
          const invoice = obj.invoice ? await stripe.invoices.retrieve(obj.invoice) : null;
          await play.reportStart(db, { session: obj, sub, invoice });
        } catch (err) { console.error('[FTB] play start report:', err.message); }
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

    if (event.type === 'invoice.paid') {
      const subId = obj.subscription || obj.parent?.subscription_details?.subscription;
      await play.reportRenewal(db, obj, typeof subId === 'string' ? subId : subId?.id).catch(err => console.error('[FTB] play renewal report:', err.message));
    }

    if (event.type === 'charge.refunded') {
      await play.reportRefund(db, obj).catch(err => console.error('[FTB] play refund report:', err.message));
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const uid = await uidForCustomer(db, obj.customer, obj.metadata?.uid);
      // 'incomplete' happens mid-checkout and may arrive late, so it changes nothing.
      const plan = event.type === 'customer.subscription.deleted' || ENDED.includes(obj.status) ? 'free'
        : ACTIVE.includes(obj.status) ? 'grizzly' : null;
      // A VIP (owner.js) keeps Grizzly when a subscription of theirs ends.
      const keep = plan === 'free' && uid && await vipFor(db, uid).catch(() => false);
      if (uid && plan && !keep) await setPlan(db, uid, { plan, ...trialFields(event.type === 'customer.subscription.deleted' ? null : obj) });
    }

    if (event.type === 'customer.subscription.trial_will_end') {
      // A failed email shouldn't make Stripe retry the whole event.
      await trialEndingEmail(db, obj).catch(err => console.error('[FTB] trial email failed:', err.message));
    }

    await play.retryPending(db);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[FTB] stripe-webhook error:', err.message);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
