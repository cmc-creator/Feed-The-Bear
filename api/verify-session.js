/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Verify Stripe Session
   ════════════════════════════════════════════════════════════
   Called after Stripe redirects back to the app with ?session_id=xxx
   Verifies payment was successful and writes plan to Firestore.

   Environment variables required (set in Vercel dashboard):
     STRIPE_SECRET_KEY        - Stripe secret key
     FIREBASE_SERVICE_ACCOUNT - Stringified JSON of Firebase service account key
                                 (Firebase Console → Project Settings → Service accounts
                                  → Generate new private key → copy contents as one-line JSON)
   ════════════════════════════════════════════════════════════ */

const Stripe  = require('stripe');
const admin   = require('firebase-admin');

// Initialize Firebase Admin once (Vercel may reuse the runtime)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = async function handler (req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { sessionId, uid } = req.query;
  if (!sessionId || !uid) {
    res.status(400).json({ error: 'Missing sessionId or uid' });
    return;
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Security: confirm the UID in Stripe metadata matches the caller
    if (session.metadata?.uid !== uid) {
      res.status(403).json({ error: 'UID mismatch' });
      return;
    }

    if (session.payment_status !== 'paid') {
      res.status(402).json({ error: 'Payment not completed', payment_status: session.payment_status });
      return;
    }

    // Write Grizzly plan to Firestore
    const db = admin.firestore();
    await db.doc(`users/${uid}/meta/profile`).set(
      {
        plan:              'grizzly',
        stripeCustomerId:  session.customer,
        stripeSessionId:   sessionId,
        upgradedAt:        new Date().toISOString(),
      },
      { merge: true }
    );

    res.status(200).json({ plan: 'grizzly' });
  } catch (err) {
    console.error('[FTB] verify-session error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
