// Unverified email accounts created after the verification cutoff can't sync
// spots to the cloud (api/save-spots.js): verified, Google, and grandfathered
// accounts still can. The client keeps spots on the device until then.
const path = require('path');
const Module = require('module');
const { ROOT, check, finish } = require('./lib');

const CUTOFF = '2026-11-10T21:00:00Z';
const BEFORE = '2026-11-09T12:00:00Z';
const AFTER = '2026-11-11T12:00:00Z';

// In-memory Firestore: profiles by uid, restaurant docs by uid.
const profiles = {};
const spots = {};
const users = {}; // uid -> { email_verified, created }

const colRef = uid => ({
  select: () => ({
    get: async () => ({ docs: Object.keys(spots[uid] || {}).map(id => ({ id })) }),
  }),
  doc: id => ({ id, path: `users/${uid}/restaurants/${id}` }),
});
const fakeDb = {
  doc: p => ({
    get: async () => {
      const m = p.match(/^users\/([^/]+)\/meta\/profile$/);
      const data = m ? (profiles[m[1]] || {}) : {};
      return { exists: !!Object.keys(data).length, data: () => data };
    },
  }),
  collection: p => {
    const m = p.match(/^users\/([^/]+)\/restaurants$/);
    return colRef(m[1]);
  },
  batch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(['set', ref, data]),
      delete: ref => ops.push(['delete', ref]),
      commit: async () => {
        for (const [op, ref, data] of ops) {
          const uid = ref.path.split('/')[1];
          spots[uid] = spots[uid] || {};
          if (op === 'set') spots[uid][ref.id] = data;
          else delete spots[uid][ref.id];
        }
      },
    };
  },
};
const fake = {
  apps: [1],
  auth: () => ({
    verifyIdToken: async t => {
      const u = users[t];
      if (!u) throw new Error('bad token');
      return { uid: t, email_verified: u.email_verified };
    },
    getUser: async uid => {
      const u = users[uid];
      if (!u) throw new Error('no such user');
      return { metadata: { creationTime: u.created } };
    },
  }),
  firestore: () => fakeDb,
};
function fresh () {
  const full = path.join(ROOT, 'api', 'save-spots.js');
  Object.keys(require.cache).filter(k => k.includes(`${path.sep}api${path.sep}`)).forEach(k => delete require.cache[k]);
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  try { return require(full); } finally { Module._load = orig; }
}
function res () {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = code => { r.statusCode = code; return r; };
  r.json = obj => { r.body = obj; return r; };
  return r;
}
const call = async (handler, token, body) => {
  const r = res();
  await handler({ method: 'POST', headers: { authorization: token ? `Bearer ${token}` : '' }, body }, r);
  return r;
};
const spot = id => ({ id, name: 'Spot ' + id, updatedAt: 1 });

(async () => {
  const handler = fresh();
  users.newbie = { email_verified: false, created: AFTER };
  users.verified = { email_verified: true, created: AFTER };
  users.google = { email_verified: true, created: AFTER };
  users.oldie = { email_verified: false, created: BEFORE };
  profiles.newbie = {};
  profiles.verified = {};
  profiles.google = {};
  profiles.oldie = {};

  // ── Unverified account created after the cutoff ──
  let r = await call(handler, 'newbie', { spots: [spot('a')] });
  check(r.statusCode === 403, 'unverified account created after the cutoff gets 403 from save-spots');
  check(!spots.newbie || !spots.newbie.a, 'unverified account writes nothing to the cloud');

  // ── Verified, Google, and grandfathered accounts still sync ──
  r = await call(handler, 'verified', { spots: [spot('a')] });
  check(r.statusCode === 200 && r.body.saved === 1, 'verified account saves spots');
  r = await call(handler, 'google', { spots: [spot('a')] });
  check(r.statusCode === 200 && r.body.saved === 1, 'Google account saves spots');
  r = await call(handler, 'oldie', { spots: [spot('a')] });
  check(r.statusCode === 200 && r.body.saved === 1, 'unverified account created before the cutoff is grandfathered');

  // ── Unverified account can't delete from the cloud either ──
  spots.newbie = { a: spot('a') };
  r = await call(handler, 'newbie', { removeIds: ['a'] });
  check(r.statusCode === 403, 'unverified account gets 403 on deletes too');
  check(!!spots.newbie.a, 'unverified delete leaves the cloud spot alone');

  // ── No token ──
  r = await call(handler, '', { spots: [spot('a')] });
  check(r.statusCode === 401, 'no token still gets 401');

  // ── Free limit still enforced for verified accounts ──
  spots.verified = {};
  for (let i = 0; i < 25; i++) spots.verified['s' + i] = spot('s' + i);
  r = await call(handler, 'verified', { spots: [spot('new1')] });
  check(r.statusCode === 200 && r.body.skipped === 1, 'verified free account still capped at 25 spots');

  finish('savespots-verify');
})();
