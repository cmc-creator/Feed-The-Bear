/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Create Stripe Checkout
   ════════════════════════════════════════════════════════════
   GET  ?uid=…&email=…&ref=…  → { trial, days }  (is a free trial on offer, and how long?)
   POST { uid, email, priceId, ref } → { url, trial, days }  (Stripe Checkout link)
   ref is the uid from a friend's invite link: 30 days instead of 7.

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

  const { uid, email, priceId, ref } = req.body || {};
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
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      customer_email:       email,
      line_items:           [{ price: priceId, quantity: 1 }],
      metadata:             invitedBy ? { uid, ref: invitedBy } : { uid },
      client_reference_id:  uid,
      // The webhook reads this to find the account when a subscription changes.
      subscription_data:    {
        metadata: { uid },
        // A card is still collected; the first charge comes when the trial ends.
        ...(trial ? { trial_period_days: days } : {}),
      },
      success_url:          `${appUrl}/app.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:           `${appUrl}/app.html?upgrade=cancel`,
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url, trial, days });
  } catch (err) {
    console.error('[FTB] Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
};
