/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Create Stripe Checkout
   ════════════════════════════════════════════════════════════
   Environment variables required (set in Vercel dashboard):
     STRIPE_SECRET_KEY      - Stripe secret key (sk_live_… or sk_test_…)
     APP_URL                - The site URL, e.g. https://www.feed-the-bear.com
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');

// Only the Grizzly prices may be bought. STRIPE_PRICE_IDS (comma-separated) overrides.
const ALLOWED_PRICES = (process.env.STRIPE_PRICE_IDS || 'price_1Tk9n0LzFIsRCvKRQpBwQRjN,price_1Tk9ntLzFIsRCvKRgn4KnUZm')
  .split(',').map(s => s.trim()).filter(Boolean);

module.exports = async function handler (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { uid, email, priceId } = req.body || {};
  if (!uid || !priceId) {
    res.status(400).json({ error: 'Missing uid or priceId' });
    return;
  }
  if (!ALLOWED_PRICES.includes(priceId)) {
    res.status(400).json({ error: 'Unknown plan' });
    return;
  }

  const stripe   = Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl   = process.env.APP_URL || 'https://www.feed-the-bear.com';

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      customer_email:       email,
      line_items:           [{ price: priceId, quantity: 1 }],
      metadata:             { uid },
      client_reference_id:  uid,
      // The webhook reads this to find the account when a subscription changes.
      subscription_data:    { metadata: { uid } },
      success_url:          `${appUrl}/app.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:           `${appUrl}/app.html?upgrade=cancel`,
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[FTB] Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
};
