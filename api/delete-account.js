/* ════════════════════════════════════════════════════════════
   Feed The Bear - Vercel Serverless: Delete Account
   ════════════════════════════════════════════════════════════
   POST /api/delete-account  (Authorization: Bearer <Firebase ID token>)
   Permanently deletes the signed-in user's account and data:
     - users/{uid} and everything under it (spots, profile)
     - live friend profiles they published (profiles where uid == uid)
     - weekly email sign-up, invite rewards, trial and Stripe customer records
     - any active Grizzly subscription in Stripe (cancelled now)
     - the Firebase sign-in account itself
   Runs on the server because the profile doc can't be deleted from
   the app (firestore.rules protects the billing fields).

   Environment variables (same as verify-session.js):
     FIREBASE_SERVICE_ACCOUNT, STRIPE_SECRET_KEY (optional here)
   ════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

function getAdmin () {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
}

async function cancelStripe (customerId) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !customerId) return;
  const stripe = require('stripe')(key);
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  for (const sub of subs.data) {
    if (!['canceled', 'incomplete_expired'].includes(sub.status)) await stripe.subscriptions.cancel(sub.id);
  }
}

module.exports = async function handler (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const idToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!idToken) return res.status(401).json({ error: 'Sign in first.' });

  let fb, uid;
  try {
    fb = getAdmin();
    // Require a recent sign-in, like changing a password would.
    const decoded = await fb.auth().verifyIdToken(idToken, true);
    if (Date.now() / 1000 - decoded.auth_time > 15 * 60) {
      return res.status(403).json({ error: 'recent-login', message: 'Please sign in again, then delete.' });
    }
    uid = decoded.uid;
  } catch (err) {
    return res.status(401).json({ error: 'Your sign-in expired. Please sign in again.' });
  }

  try {
    const db = fb.firestore();
    const profile = await db.doc(`users/${uid}/meta/profile`).get();
    const customerId = profile.exists ? profile.data().stripeCustomerId : null;
    try {
      await cancelStripe(customerId);
    } catch (err) {
      // Keep the account until billing is stopped, so nobody is charged for a deleted account.
      console.error('[FTB] delete-account: Stripe cancel failed:', err.message);
      return res.status(502).json({ error: 'We could not cancel your Grizzly subscription. Nothing was deleted; please try again.' });
    }
    const published = await db.collection('profiles').where('uid', '==', uid).get();
    await Promise.all(published.docs.map(d => d.ref.delete()));
    // Friend notifications (push.js): their followers list, and them on everyone else's.
    await Promise.all(published.docs.map(d => db.doc(`followers/${d.id}`).delete()));
    const follows = (await db.doc(`pushFollows/${uid}`).get()).data()?.ids || [];
    await Promise.all(follows.map(id => db.doc(`followers/${id}`).set({ uids: fb.firestore.FieldValue.arrayRemove(uid) }, { merge: true })));
    // Feedback notes they sent from the app keep their email (api/feedback.js).
    const notes = await db.collection('feedback').where('uid', '==', uid).get();
    await Promise.all(notes.docs.map(d => d.ref.delete()));
    // Their username, if they picked one (api/handle.js).
    const handle = (await db.doc(`handleOf/${uid}`).get()).data()?.handle;
    if (handle) await db.doc(`handles/${handle}`).delete();
    // Server-only records keyed by this account (the weekly email list holds their address).
    // Invites you sent go; on invites you joined from, your name comes off.
    const sent = await db.collection('invites').where('owner', '==', uid).get();
    await Promise.all(sent.docs.map(d => d.ref.delete()));
    const joined = await db.collection('invites').where('joinedUid', '==', uid).get();
    await Promise.all(joined.docs.map(d => { const { owner, at, openedAt } = d.data(); return d.ref.set({ owner, at, ...(openedAt ? { openedAt } : {}) }); }));
    const serverDocs = ['digestSubscribers', 'rewards', 'trials', 'referrals', 'pushTokens', 'pushFollows', 'apiQuota', 'aiQuota', 'handleOf', 'followedBy'].map(c => `${c}/${uid}`);
    if (customerId) serverDocs.push(`stripeCustomers/${customerId}`);
    await Promise.all(serverDocs.map(p => db.doc(p).delete()));
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await fb.auth().deleteUser(uid);
    return res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('[FTB] delete-account failed:', err.message);
    return res.status(500).json({ error: 'Deleting your account failed. Please try again.' });
  }
};
