/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Gift Grizzly (/gift.html)
   ════════════════════════════════════════════════════════════
   POST { to, toName, from, buyerEmail, months: 3 | 12, message }
     → { url }  a one-time Stripe Checkout payment, no account needed.
   When it's paid, stripe-webhook.js gives `to` Grizzly for those months
   (owner.js grantVip: now if they have an account, else at first sign-in)
   and emails them. Website only: the Android app doesn't sell gifts.
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');
const { overLimit, clientIp } = require('./_limit');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const PRICES = { 3: 1499, 12: 4999 }; // cents
const APP = process.env.APP_URL || 'https://www.feed-the-bear.com';
const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (await overLimit(`gift:${clientIp(req)}`, 20, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Gifts are not set up yet.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const to = clean(body.to, 200).toLowerCase();
  const buyerEmail = clean(body.buyerEmail, 200).toLowerCase();
  const months = Number(body.months) === 12 ? 12 : 3;
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "Check your friend's email." });
  if (buyerEmail && !EMAIL_RE.test(buyerEmail)) return res.status(400).json({ error: 'Check your email.' });
  const meta = { kind: 'gift', to, toName: clean(body.toName, 40), from: clean(body.from, 40), months: String(months), message: clean(body.message, 300) };
  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: PRICES[months],
        product_data: { name: `Feed The Bear Grizzly, ${months === 12 ? '1 year' : '3 months'} (gift)`, description: `A gift for ${to}` },
      } }],
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      metadata: meta,
      payment_intent_data: { metadata: meta },
      allow_promotion_codes: true,
      success_url: `${APP}/gift.html?sent=1&to=${encodeURIComponent(meta.toName || to)}`,
      cancel_url: `${APP}/gift.html`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[FTB] gift checkout failed:', err.message);
    return res.status(500).json({ error: 'Checkout did not open. Please try again.' });
  }
};

module.exports.PRICES = PRICES;
