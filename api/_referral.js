/* ════════════════════════════════════════════════════════════
   Feed The Bear - Invite a friend rewards (shared helper, not an endpoint:
   Vercel skips files in api/ that start with "_")
   ════════════════════════════════════════════════════════════
   A friend who opens an invite link (app.html?ref=<uid>) gets a 30-day
   Grizzly trial instead of 7 days. When they finish checkout, the person
   who invited them gets a free month:
     - paying already: a $4.99 credit on their next Stripe bill
     - not paying:     Grizzly until rewards/{uid}.grizzlyUntil, then back to free
   Server-only collections (no client rules, so the app can't touch them):
     referrals/{friendUid}  who invited them; written once, so one reward per friend
     rewards/{uid}          grizzlyUntil, invites, credits
   ════════════════════════════════════════════════════════════ */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const CREDIT_CENTS = 499;
const LIVE = ['active', 'trialing', 'past_due'];

async function hasLiveSubscription (stripe, customerId) {
  if (!stripe || !customerId) return false;
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
  return subs.data.some(s => LIVE.includes(s.status));
}

// A real account that isn't the buyer themselves.
async function validInviter (auth, inviterUid, friendUid) {
  if (!inviterUid || typeof inviterUid !== 'string' || inviterUid === friendUid || !/^[A-Za-z0-9]{10,64}$/.test(inviterUid)) return false;
  try { return !!(await auth.getUser(inviterUid)); } catch { return false; }
}

async function rewardInviter ({ db, stripe, inviterUid, friendUid }) {
  if (!inviterUid || inviterUid === friendUid) return 'none';
  try {
    await db.doc(`referrals/${friendUid}`).create({ inviter: inviterUid, at: new Date().toISOString() });
  } catch { return 'already'; } // this friend already earned someone a reward

  const rewardRef = db.doc(`rewards/${inviterUid}`);
  const reward = (await rewardRef.get()).data() || {};
  const profile = (await db.doc(`users/${inviterUid}/meta/profile`).get()).data() || {};

  if (await hasLiveSubscription(stripe, profile.stripeCustomerId)) {
    await stripe.customers.createBalanceTransaction(profile.stripeCustomerId, {
      amount: -CREDIT_CENTS, currency: 'usd', description: 'Feed The Bear: free month for inviting a friend',
    });
    await rewardRef.set({ invites: (reward.invites || 0) + 1, credits: (reward.credits || 0) + 1 }, { merge: true });
    return 'credit';
  }

  const start = Math.max(Date.now(), Date.parse(reward.grizzlyUntil || '') || 0);
  const until = new Date(start + MONTH_MS).toISOString();
  await rewardRef.set({ invites: (reward.invites || 0) + 1, grizzlyUntil: until }, { merge: true });
  await db.doc(`users/${inviterUid}/meta/profile`).set({ plan: 'grizzly' }, { merge: true });
  return 'month';
}

// A free month that ran out goes back to free, unless they now pay.
async function expireReward ({ db, stripe, uid }) {
  const reward = (await db.doc(`rewards/${uid}`).get()).data() || {};
  const until = Date.parse(reward.grizzlyUntil || '') || 0;
  if (!until) return { grizzlyUntil: null, invites: reward.invites || 0 };
  if (until > Date.now()) return { grizzlyUntil: reward.grizzlyUntil, invites: reward.invites || 0 };
  const profile = (await db.doc(`users/${uid}/meta/profile`).get()).data() || {};
  if (profile.plan === 'grizzly' && !(await hasLiveSubscription(stripe, profile.stripeCustomerId))) {
    await db.doc(`users/${uid}/meta/profile`).set({ plan: 'free' }, { merge: true });
  }
  await db.doc(`rewards/${uid}`).set({ grizzlyUntil: null }, { merge: true });
  return { grizzlyUntil: null, invites: reward.invites || 0, expired: true };
}

module.exports = { rewardInviter, expireReward, validInviter, MONTH_MS };
