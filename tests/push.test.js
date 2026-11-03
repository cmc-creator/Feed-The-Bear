// Friend notifications on the server (api/push.js): phones register, follows
// are kept per friend, and a friend's new visit pings followers once.
const Module = require('module');
const path = require('path');
const { check, finish } = require('./lib');

const docs = {};
const sent = [];
let deadToken = '';
const FV = {
  arrayUnion: (...v) => ({ __op: 'union', v }),
  arrayRemove: (...v) => ({ __op: 'remove', v }),
};
function applyMerge (prev, data) {
  const out = { ...(prev || {}) };
  for (const [k, v] of Object.entries(data)) {
    if (v && v.__op === 'union') out[k] = [...new Set([...(out[k] || []), ...v.v])];
    else if (v && v.__op === 'remove') out[k] = (out[k] || []).filter(x => !v.v.includes(x));
    else out[k] = v;
  }
  return out;
}
const ref = p => ({
  path: p,
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  set: async (data, opts) => { docs[p] = opts?.merge ? applyMerge(docs[p], data) : applyMerge({}, data); },
  delete: async () => { delete docs[p]; },
});
const firestore = () => ({ doc: ref, getAll: async (...refs) => Promise.all(refs.map(r => r.get())) });
firestore.FieldValue = FV;
const fakeAdmin = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
  firestore,
  messaging: () => ({
    sendEachForMulticast: async msg => {
      sent.push(msg);
      return { successCount: msg.tokens.filter(t => t !== deadToken).length,
        responses: msg.tokens.map(t => (t === deadToken ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true })) };
    },
  }),
};
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fakeAdmin : realLoad.call(this, req, ...rest); };
const push = require(path.join(__dirname, '..', 'api', 'push.js'));
Module._load = realLoad;

function call (uid, body) {
  return new Promise(resolve => {
    let status = 200;
    const res = { status (s) { status = s; return this; }, json (data) { resolve({ status, data }); return this; }, setHeader () {} };
    push({ method: 'POST', headers: { authorization: uid ? `Bearer token-${uid}` : '' }, body }, res);
  });
}
const today = new Date().toISOString().slice(0, 10);
const TOKEN = 'fcm-token-for-follower-phone-0001';

(async () => {
  let r = await call(null, { action: 'register', token: TOKEN });
  check(r.status === 401, 'needs a signed-in member');

  // A follower's phone registers and follows Sam's live profile.
  await call('follower1', { action: 'register', token: TOKEN });
  check(docs['pushTokens/follower1'].tokens[0] === TOKEN, 'a phone registers for notifications');
  r = await call('follower1', { action: 'follows', ids: ['samshare0001', 'BAD ID!'] });
  check(r.data.added === 1 && docs['followers/samshare0001'].uids.includes('follower1'), 'following Sam is recorded (bad ids ignored)');

  // Sam's profile: old history only. The first look remembers it without pinging anyone.
  docs['profiles/samshare0001'] = { uid: 'sam', u: 'Sam', recent: [{ k: 'visit', n: 'Old Spot', r: 4, at: '2026-01-02' }] };
  r = await call('sam', { action: 'notify', id: 'samshare0001' });
  check(r.data.sent === 0 && !sent.length, 'old history never pings anyone');

  // Someone else can't trigger pings for Sam.
  r = await call('mallory', { action: 'notify', id: 'samshare0001' });
  check(r.data.sent === 0 && r.data.reason === 'not yours', "only the profile's owner can ping its followers");

  // Sam eats somewhere new today: one ping to the follower.
  docs['profiles/samshare0001'].recent.unshift({ k: 'visit', n: 'Bacanora', r: 5, at: today });
  r = await call('sam', { action: 'notify', id: 'samshare0001' });
  check(r.data.sent === 1 && sent[0].tokens[0] === TOKEN, 'a new visit pings the follower');
  check(/^Sam ate at Bacanora ★★★★★$/.test(sent[0].notification.title) && sent[0].data.open === 'friends', `with what happened (${sent[0].notification.title})`);

  // The same thing again, or another post within 20 minutes, doesn't ping again.
  r = await call('sam', { action: 'notify', id: 'samshare0001' });
  check(r.data.sent === 0 && sent.length === 1, 'the same post is not sent twice');
  docs['profiles/samshare0001'].recent.unshift({ k: 'save', n: 'Tacos Chiwas', at: today });
  r = await call('sam', { action: 'notify', id: 'samshare0001' });
  check(r.data.reason === 'quiet' && sent.length === 1, 'no burst of pings: one per friend every 20 minutes');

  // Later: a dish post. A phone that uninstalled is forgotten.
  docs['followers/samshare0001'].lastAt = 0;
  docs['pushTokens/follower1'].tokens.push('fcm-token-uninstalled-phone-0002');
  deadToken = 'fcm-token-uninstalled-phone-0002';
  docs['profiles/samshare0001'].recent.unshift({ k: 'dish', n: 'Bacanora', d: 'carne asada', at: today });
  r = await call('sam', { action: 'notify', id: 'samshare0001' });
  check(/would get the carne asada again at Bacanora/.test(sent.at(-1).notification.title), 'a dish post says what to get');
  check(!docs['pushTokens/follower1'].tokens.includes(deadToken), "an uninstalled phone's token is dropped");

  // Unfollowing removes them from Sam's followers.
  await call('follower1', { action: 'follows', ids: [] });
  check(!docs['followers/samshare0001'].uids.includes('follower1'), 'unfollowing stops the pings');

  finish('push');
})();
