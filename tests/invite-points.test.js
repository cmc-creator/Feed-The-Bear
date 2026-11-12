// Invite reward (finding 8): the inviter gets +50 cave points the moment
// a friend joins from their invite — once per friend — and the friend
// sees a "Your friend joined — +50 cave points" notice. The free month
// still waits until the friend goes Grizzly (api/_referral.js); this is
// the instant half only. A failed reward never fails the join.
const path = require('path');
const Module = require('module');
const { check, finish } = require('./lib');

const today = new Date().toISOString().slice(0, 10);
const docs = {
  'profiles/friendshare1': { uid: 'friendUid12345', u: 'Friend' },
  'profiles/friendshare2': { uid: 'friendUid67890', u: 'Friend 2' },
  'invites/invitecode123456': { owner: 'ownerUid12345', name: 'Friend' },
  'users/ownerUid12345/meta/profile': { caveFun: 0, caveFunDays: {} },
};
const ref = p => ({
  p,
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  set: async (d, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...d } : d; },
  delete: async () => { delete docs[p]; },
});
const fake = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
  firestore: () => ({
    doc: ref,
    runTransaction: async fn => fn({
      get: r => r.get(),
      set: (r, d, opts) => { docs[r.p] = opts?.merge ? { ...(docs[r.p] || {}), ...d } : d; },
      delete: r => { delete docs[r.p]; },
    }),
  }),
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
const api = require(path.join(__dirname, '..', 'api', 'handle.js'));
Module._load = orig;

const call = (uid, body) => new Promise(resolve => {
  let status = 200;
  const res = { setHeader () {}, status (c) { status = c; return this; }, json (d) { resolve({ status, ...d }); return this; } };
  api({ method: 'POST', body, headers: { 'x-ftb-token': `token-${uid}`, 'x-forwarded-for': '9.9.9.9' } }, res);
});

(async () => {
  // The friend joins from the invite.
  let r = await call('friendUid12345', { action: 'inviteJoined', code: 'invitecode123456', me: 'friendshare1' });
  check(r.status === 200 && r.ok === true, 'the friend joins from the invite');
  const owner = docs['users/ownerUid12345/meta/profile'];
  check(owner.caveFun === 50, `the inviter gets +50 cave points (${owner.caveFun})`);
  check(owner.caveFunDays['invite:friendUid12345'] === today, 'the join is marked once per friend');
  check(owner.caveRewardNotice?.text === 'Your friend joined — +50 cave points', 'the inviter gets the +50 notice');
  check(docs['invites/invitecode123456'].joinedUid === 'friendUid12345', 'the join is still recorded on the invite');

  // The same friend re-joins: the join still works, but no second +50.
  r = await call('friendUid12345', { action: 'inviteJoined', code: 'invitecode123456', me: 'friendshare1' });
  check(r.status === 200 && r.ok === true, 'a re-join still succeeds');
  check(docs['users/ownerUid12345/meta/profile'].caveFun === 50, 'a re-join pays nothing twice');

  // A different friend tries the same code: the invite is taken.
  r = await call('friendUid67890', { action: 'inviteJoined', code: 'invitecode123456', me: 'friendshare2' });
  check(r.status === 200 && r.ok === false, 'a spent invite cannot be joined by someone else');
  check(docs['users/ownerUid12345/meta/profile'].caveFun === 50, 'a failed join pays nothing');

  // The owner joining their own invite: no reward, no self-join.
  r = await call('ownerUid12345', { action: 'inviteJoined', code: 'invitecode123456', me: 'friendshare1' });
  check(r.status === 403 || r.ok === false, 'the owner cannot join their own invite for points');

  finish('invite-points');
})();
