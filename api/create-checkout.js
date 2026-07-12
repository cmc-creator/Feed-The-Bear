/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Create Stripe Checkout
   ════════════════════════════════════════════════════════════
   Environment variables required (set in Vercel dashboard):
     STRIPE_SECRET_KEY      - Stripe secret key (sk_live_… or sk_test_…)
     APP_URL                - Your Vercel URL, e.g. https://feed-the-bear.vercel.app
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');

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

  const stripe   = Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl   = process.env.APP_URL || 'https://feed-the-bear.vercel.app';

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      customer_email:       email,
      line_items:           [{ price: priceId, quantity: 1 }],
      metadata:             { uid },
      success_url:          `${appUrl}/?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:           `${appUrl}/?upgrade=cancel`,
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[FTB] Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
