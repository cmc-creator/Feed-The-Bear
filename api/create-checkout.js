/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Create Stripe Checkout
   ════════════════════════════════════════════════════════════
   GET  ?uid=…&email=…&ref=…  → { trial, days }  (is a free trial on offer, and how long?)
   POST { uid, email, priceId, ref, playToken, promo } → { url, trial, days }  (Stripe Checkout link)
   promo: a discount code from an owner's VIP link (owner.js); applied for them.
   ref is the uid from a friend's invite link: 30 days instead of 7.
   playToken: from Google in the Play app, so the sale is reported to Google (_play.js).
   ios: true from the iPhone app, which opens checkout in Safari; Stripe then
   sends them to native-return.html, whose button reopens the app.

   Environment variables required (set in Vercel dashboard):
     STRIPE_SECRET_KEY        - Stripe secret key (sk_live_… or sk_test_…)
     APP_URL                  - The site URL, e.g. https://www.feed-the-bear.com
     FIREBASE_SERVICE_ACCOUNT - needed to check who already had a trial;
                                without it nobody gets a trial
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');
const admin  = require('firebase-admin');
const { validInviter } = require('./_referral');

// Only the Grizzly prices may be bought. STRIPE_PRICE_IDS (comma-separated) overrides.
const ALLOWED_PRICES = (process.env.STRIPE_PRICE_IDS || 'price_1UW2DmLzFIsRCvKRfFexC3P8,price_1UW2F1LzFIsRCvKRvztAuCOE')
  .split(',').map(s => s.trim()).filter(Boolean);

const TRIAL_DAYS = 7;
const INVITED_TRIAL_DAYS = 30; // came from a friend's invite link (see _referral.js)

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

// One free trial per person: not if this account ever finished a checkout
// (trials/{uid}, written by verify-session and the webhook), already has a
// Stripe customer, or the email has paid us before under another account.
async function trialEligible (stripe, uid, email) {
  try {
    const db = getAdmin().firestore();
    const [trial, profile] = await Promise.all([
      db.doc(`trials/${uid}`).get(),
      db.doc(`users/${uid}/meta/profile`).get(),
    ]);
    if (trial.exists) return false;
    if (profile.exists && (profile.data().stripeCustomerId || profile.data().plan === 'grizzly')) return false;
    if (email) {
      const prior = await stripe.customers.list({ email: String(email).toLowerCase(), limit: 1 });
      if (prior.data.length) return false;
    }
    return true;
  } catch (err) {
    console.error('[FTB] trial check failed:', err.message);
    return false;
  }
}

async function trialDays (uid, ref) {
  try {
    return ref && await validInviter(getAdmin().auth(), String(ref), uid) ? INVITED_TRIAL_DAYS : TRIAL_DAYS;
  } catch { return TRIAL_DAYS; }
}

module.exports = async function handler (req, res) {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  if (req.method === 'GET') {
    const { uid, email, ref } = req.query || {};
    if (!uid) { res.status(400).json({ error: 'Missing uid' }); return; }
    const trial = await trialEligible(stripe, uid, email);
    res.status(200).json({ trial, days: trial ? await trialDays(uid, ref) : 0 });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { uid, email, priceId, ref, playToken, promo, ios } = req.body || {};
  if (!uid || !priceId) {
    res.status(400).json({ error: 'Missing uid or priceId' });
    return;
  }
  if (!ALLOWED_PRICES.includes(priceId)) {
    res.status(400).json({ error: 'Unknown plan' });
    return;
  }

  const appUrl = process.env.APP_URL || 'https://www.feed-the-bear.com';

  try {
    const trial = await trialEligible(stripe, uid, email);
    const days = trial ? await trialDays(uid, ref) : 0;
    const invitedBy = days === INVITED_TRIAL_DAYS ? ref : '';
    // A VIP link's code, applied up front (Stripe takes either this or the code box).
    let promoId = '';
    if (typeof promo === 'string' && /^[A-Za-z0-9_-]{3,30}$/.test(promo)) {
      const found = await stripe.promotionCodes.list({ code: promo.toUpperCase(), active: true, limit: 1 }).catch(() => null);
      promoId = found?.data?.[0]?.id || '';
    }
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      customer_email:       email,
      line_items:           [{ price: priceId, quantity: 1 }],
      metadata:             invitedBy ? { uid, ref: invitedBy } : { uid },
      client_reference_id:  uid,
      // The webhook reads this to find the account when a subscription changes.
      subscription_data:    {
        // ref: the inviter is rewarded at the first real payment (stripe-webhook.js invoice.paid).
        metadata: invitedBy ? { uid, ref: invitedBy } : { uid },
        // A card is still collected; the first charge comes when the trial ends.
        ...(trial ? { trial_period_days: days } : {}),
      },
      success_url:          ios ? `${appUrl}/native-return.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}` : `${appUrl}/app.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:           ios ? `${appUrl}/native-return.html?upgrade=cancel` : `${appUrl}/app.html?upgrade=cancel`,
      ...(promoId ? { discounts: [{ promotion_code: promoId }] } : { allow_promotion_codes: true }),
    });

    // Kept until checkout finishes; the webhook reports the sale to Google with it.
    if (typeof playToken === 'string' && playToken && playToken.length < 4000) {
      await getAdmin().firestore().doc(`playCheckouts/${session.id}`).set({ token: playToken, uid, at: new Date().toISOString() });
    }

    res.status(200).json({ url: session.url, trial, days });
  } catch (err) {
    console.error('[FTB] Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
};
