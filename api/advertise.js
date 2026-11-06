/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Featured restaurants (/advertise.html)
   ════════════════════════════════════════════════════════════
   POST { name, address, website, email, blurb, city, food }
     → { url }  a $29/month Stripe subscription checkout.
   Paid: stripe-webhook.js saves featured/{session id} as 'pending'; the owner
   approves it in owner.html, and it shows first on that city guide
   (guide.js) until the subscription ends.
   ════════════════════════════════════════════════════════════ */

const Stripe = require('stripe');
const { overLimit, clientIp } = require('./_limit');
const { CITIES, FOODS } = require('./guide');

const MONTHLY_CENTS = 2900;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const APP = process.env.APP_URL || 'https://www.feed-the-bear.com';
const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    return res.status(200).json({ price: MONTHLY_CENTS, cities: CITIES.map(c => ({ slug: c.slug, name: `${c.name}, ${c.st}` })), foods: FOODS.map(f => ({ slug: f.slug, name: f.label })) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (await overLimit(`advertise:${clientIp(req)}`, 20, 600)) return res.status(429).json({ error: 'Slow down a little and try again soon.' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Not set up yet.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const city = CITIES.find(c => c.slug === body.city);
  const food = FOODS.find(f => f.slug === body.food);
  const name = clean(body.name, 60);
  const email = clean(body.email, 200).toLowerCase();
  let website = clean(body.website, 200);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (!name) return res.status(400).json({ error: "Add your restaurant's name." });
  if (!city || !food) return res.status(400).json({ error: 'Pick the city and the food guide.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Add an email we can reach you at.' });
  if (website) { try { new URL(website); } catch { return res.status(400).json({ error: 'Check the website address.' }); } }
  const meta = { kind: 'featured', name, address: clean(body.address, 100), website, email, blurb: clean(body.blurb, 140), city: city.slug, food: food.slug };
  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: MONTHLY_CENTS, recurring: { interval: 'month' },
        product_data: { name: `Featured on Feed The Bear: ${food.label} in ${city.name}`, description: name },
      } }],
      metadata: meta,
      subscription_data: { metadata: meta },
      allow_promotion_codes: true,
      success_url: `${APP}/advertise.html?done=1`,
      cancel_url: `${APP}/advertise.html`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[FTB] advertise checkout failed:', err.message);
    return res.status(500).json({ error: 'Checkout did not open. Please try again.' });
  }
};

module.exports.MONTHLY_CENTS = MONTHLY_CENTS;
