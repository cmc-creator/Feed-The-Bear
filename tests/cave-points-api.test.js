// Cave points from the public page (finding 6, server half).
// - A +2 for loving a cave only lands when the vote actually exists, and
//   only once per cave per day.
// - A +5 for giving a gift only lands when the gift was left today.
// - A fake uid (not a real Firebase user) gets nothing; bad input gets a 400.
const path = require('path');
const Module = require('module');
const { check, finish } = require('./lib');

const today = new Date().toISOString().slice(0, 10); // ISO, like the server
const docs = {
  'caveVotes/caveshare01/votes/voterA1111bbbb2222': { at: new Date().toISOString() },
  'caveGiftLog/caveshare01/days/voterB2222cccc3333': { date: today, kind: 'food', id: 'pie' },
  'users/realUid12345/meta/profile': { caveFun: 0, caveFunDays: {} },
  'users/realUid67890/meta/profile': { caveFun: 0, caveFunDays: {} },
};
const ref = p => ({
  p,
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  set: async (d, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...d } : d; },
  delete: async () => { delete docs[p]; },
});
const fake = {
  apps: [1],
  auth: () => ({ getUser: async uid => {
    if (uid !== 'realUid12345' && uid !== 'realUid67890') throw new Error('no user');
    return { uid };
  } }),
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
const api = require(path.join(__dirname, '..', 'api', 'cave-points.js'));
Module._load = orig;

const call = (body) => new Promise(resolve => {
  let status = 200;
  const res = { setHeader () {}, status (c) { status = c; return this; }, json (d) { resolve({ status, ...d }); return this; } };
  api({ method: 'POST', body, headers: { 'x-forwarded-for': '9.9.9.9' } }, res);
});

(async () => {
  // ── Vote: +2, once per cave per day ──
  let r = await call({ action: 'vote', share: 'caveshare01', voter: 'voterA1111bbbb2222', uid: 'realUid12345' });
  check(r.status === 200 && r.ok === true && r.awarded === true, `a real vote pays +2 (${JSON.stringify(r)})`);
  check(docs['users/realUid12345/meta/profile'].caveFun === 2, 'the +2 lands in caveFun');
  check(docs['users/realUid12345/meta/profile'].caveFunDays[`vote:caveshare01`] === today, 'the vote is marked for today');
  r = await call({ action: 'vote', share: 'caveshare01', voter: 'voterA1111bbbb2222', uid: 'realUid12345' });
  check(r.status === 200 && r.awarded === false, 'a second vote award the same day pays nothing');
  check(docs['users/realUid12345/meta/profile'].caveFun === 2, 'the second call does not stack');

  // No vote, no points — and a fake uid gets nothing.
  r = await call({ action: 'vote', share: 'caveshare01', voter: 'nobody9999999999', uid: 'realUid67890' });
  check(r.status === 200 && r.ok === false && r.reason === 'novote', 'a vote that does not exist pays nothing');
  check(docs['users/realUid67890/meta/profile'].caveFun === 0, 'no points for a phantom vote');
  r = await call({ action: 'vote', share: 'caveshare01', voter: 'voterA1111bbbb2222', uid: 'ghostUid123456' });
  check(r.status === 400, 'a uid that is not a real user is rejected');

  // ── Gift given: +5, only when the gift was left today ──
  r = await call({ action: 'giftGiven', share: 'caveshare01', voter: 'voterB2222cccc3333', uid: 'realUid67890' });
  check(r.status === 200 && r.ok === true && r.awarded === true, `a real gift pays +5 (${JSON.stringify(r)})`);
  check(docs['users/realUid67890/meta/profile'].caveFun === 5, 'the +5 lands in caveFun');
  r = await call({ action: 'giftGiven', share: 'caveshare01', voter: 'nobody9999999999', uid: 'realUid67890' });
  check(r.status === 200 && r.ok === false && r.reason === 'nogift', 'a gift that was not left pays nothing');

  // ── Bad input ──
  r = await call({ action: 'dance', share: 'caveshare01', voter: 'voterA1111bbbb2222', uid: 'realUid12345' });
  check(r.status === 400, 'an unknown action is rejected');
  r = await call({ action: 'vote', share: 'x', voter: 'voterA1111bbbb2222', uid: 'realUid12345' });
  check(r.status === 400, 'a malformed share id is rejected');

  finish('cave-points-api');
})();
