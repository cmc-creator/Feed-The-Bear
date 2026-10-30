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
const { rewardInviter, expireReward } = require('./_referral');

// Initialize Firebase Admin once (Vercel may reuse the runtime)
function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(raw)),
    });
  }
  return admin;
}

// POST (Authorization: Bearer <ID token>), signed-in account actions:
//   { action: 'rewards' } → { grizzlyUntil, invites }; an ended free invite month goes back to free
//   { action: 'portal' }  → { url } Stripe's page to change or cancel the subscription
//   { action: 'native-start', challenge } / { action: 'native-finish', verifier } (no token)
//                         → Android app sign-in with Google (see native-signin.html)
// (Kept in this file rather than new endpoints: the free Vercel plan allows 12 functions.)
// Android app, step 2 (back in the app, not signed in yet): Google won't sign
// in inside an app's web view, so the app signs in in Chrome
// (native-signin.html). The app kept a random verifier and only sent its
// SHA-256 challenge, so a link intercepted on the way back is useless.
async function nativeFinish (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const verifier = String(req.body?.verifier || '');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return res.status(400).json({ error: 'Bad request' });
  const challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
  try {
    const a = getAdmin();
    const ref = a.firestore().doc(`nativeSignins/${challenge}`);
    const pending = (await ref.get()).data();
    await ref.delete();
    if (!pending || pending.exp < Date.now()) return res.status(404).json({ error: 'That sign-in expired. Please try again.' });
    return res.status(200).json({ token: await a.auth().createCustomToken(pending.uid) });
  } catch (err) {
    console.error('[FTB] native sign-in error:', err.message);
    return res.status(500).json({ error: 'Sign-in did not finish. Please try again.' });
  }
}

async function accountAction (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.body?.action === 'native-finish') return nativeFinish(req, res);
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first' });
  let uid;
  const a = getAdmin();
  try { ({ uid } = await a.auth().verifyIdToken(token)); } catch { return res.status(401).json({ error: 'Sign in again' }); }
  const key = process.env.STRIPE_SECRET_KEY;
  const stripe = key ? Stripe(key) : null;
  const db = a.firestore();
  try {
    // Android app, step 1 (in Chrome, signed in): remember who signed in for
    // this challenge. See nativeFinish for step 2.
    if (req.body?.action === 'native-start') {
      const challenge = String(req.body.challenge || '');
      if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return res.status(400).json({ error: 'Bad request' });
      await db.doc(`nativeSignins/${challenge}`).set({ uid, exp: Date.now() + 5 * 60 * 1000 });
      return res.status(200).json({ ok: true });
    }
    if (req.body?.action === 'portal') {
      const profile = (await db.doc(`users/${uid}/meta/profile`).get()).data() || {};
      if (!stripe || !profile.stripeCustomerId) return res.status(404).json({ error: 'No subscription on this account.' });
      const appUrl = process.env.APP_URL || 'https://www.feed-the-bear.com';
      const portal = await stripe.billingPortal.sessions.create({ customer: profile.stripeCustomerId, return_url: `${appUrl}/app.html` });
      return res.status(200).json({ url: portal.url });
    }
    return res.status(200).json(await expireReward({ db, stripe, uid }));
  } catch (err) {
    console.error('[FTB] account action error:', err.message);
    return res.status(500).json({ error: 'That did not work. Please try again.' });
  }
}

module.exports = async function handler (req, res) {
  if (req.method === 'POST') return accountAction(req, res);
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

    // A free-trial checkout completes with nothing charged yet.
    const done = session.payment_status === 'paid'
      || (session.payment_status === 'no_payment_required' && session.status === 'complete');
    if (!done) {
      res.status(402).json({ error: 'Payment not completed', payment_status: session.payment_status });
      return;
    }

    // Write Grizzly plan to Firestore
    const db = getAdmin().firestore();
    // Any finished checkout uses up the one free trial (see create-checkout.js).
    await db.doc(`trials/${uid}`).set({ at: new Date().toISOString(), sessionId }, { merge: true });
    await db.doc(`users/${uid}/meta/profile`).set(
      {
        plan:              'grizzly',
        stripeCustomerId:  session.customer,
        stripeSessionId:   sessionId,
        upgradedAt:        new Date().toISOString(),
      },
      { merge: true }
    );
    if (session.customer) await db.doc(`stripeCustomers/${session.customer}`).set({ uid }, { merge: true });
    // Came from a friend's invite: they get their free month (the webhook may do this first; it only happens once).
    if (session.metadata?.ref) {
      try { await rewardInviter({ db, stripe, inviterUid: session.metadata.ref, friendUid: uid }); } catch (err) { console.error('[FTB] invite reward failed:', err.message); }
    }

    // On a free trial nothing is charged until the trial ends.
    let trialEnd = null;
    if (session.payment_status === 'no_payment_required' && session.subscription) {
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        if (sub.trial_end) trialEnd = new Date(sub.trial_end * 1000).toISOString();
      } catch { /* the toast just leaves the date out */ }
    }
    res.status(200).json({ plan: 'grizzly', trialEnd });
  } catch (err) {
    // An unknown session id will never succeed, so tell the app to stop retrying.
    if (err.type === 'StripeInvalidRequestError') {
      res.status(404).json({ error: 'Unknown checkout session' });
      return;
    }
    console.error('[FTB] verify-session error:', err.message);
    res.status(500).json({ error: 'Verification failed. Please contact support.' });
  }
};
