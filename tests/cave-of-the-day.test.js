// Cave of the Day: the public cave with the most "Love this cave?"
// votes in the last 24 hours, featured on the app home screen.
// - Votes older than 24 hours do not count; votes without a timestamp
//   predate the timestamp and count as recent.
// - Private pages never win, however many votes they have.
// - No votes at all today: Connie's own cave is the default.
const path = require('path');
const Module = require('module');
const { check, finish } = require('./lib');

const now = new Date().toISOString();
const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

// ── Server, with a fake Firebase ──
const docs = {
  'handles/feedthebear32': { uid: 'connieUid12345', id: 'connieshare01', public: true, u: 'Connie' },
  'handles/sam_eats': { uid: 'samUid1234567', id: 'samshare0001', public: true, u: 'Sam' },
  'handles/priv_eats': { uid: 'privUid123456', id: 'privshare001', public: false, u: 'Priv' },
  'profiles/connieshare01': { uid: 'connieUid12345', u: 'Connie', profile: { picks: [], cave: { t: 'forest' }, pts: 100 } },
  'profiles/samshare0001': { uid: 'samUid1234567', u: 'Sam', profile: { picks: [], cave: { t: 'beach' }, pts: 10 } },
  'profiles/privshare001': { uid: 'privUid123456', u: 'Priv', profile: { picks: [], cave: { t: 'winter' }, pts: 5 } },
  'caveVotes/connieshare01/votes/voterA1111': { at: now },
  'caveVotes/connieshare01/votes/voterOld999': { at: old },
  'caveVotes/samshare0001/votes/voterB2222': { at: now },
  'caveVotes/samshare0001/votes/voterC3333': { at: now },
  'caveVotes/privshare001/votes/voterP0001': { at: now },
  'caveVotes/privshare001/votes/voterP0002': { at: now },
  'caveVotes/privshare001/votes/voterP0003': { at: now },
  'caveVotes/privshare001/votes/voterP0004': { at: now },
  'caveVotes/privshare001/votes/voterP0005': { at: now },
};
const ref = p => ({
  p,
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  set: async (d, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...d } : d; },
  delete: async () => { delete docs[p]; },
});
const collection = prefix => ({
  get: async () => {
    const list = Object.keys(docs).filter(k => k.startsWith(prefix + '/'))
      .map(k => ({ id: k.slice(prefix.length + 1), data: () => docs[k] }));
    return { size: list.length, docs: list };
  },
});
const fake = {
  apps: [1],
  auth: () => ({ verifyIdToken: async t => { if (!t.startsWith('token-')) throw new Error('bad'); return { uid: t.slice(6) }; } }),
  firestore: () => ({ doc: ref, collection }),
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
const cotdApi = require(path.join(__dirname, '..', 'api', 'cave-of-the-day.js'));
Module._load = orig;

const cotdCall = (method = 'GET') => new Promise(resolve => {
  let status = 200;
  const res = { setHeader () {}, status (c) { status = c; return this; }, json (d) { resolve({ status, ...d }); return this; } };
  cotdApi({ method, query: {}, headers: {} }, res);
});

(async () => {
  // Sam has 2 recent votes, Connie 1 recent + 1 old, Priv 5 but private.
  let r = await cotdCall();
  check(r.status === 200, 'cave of the day answers');
  check(r.handle === 'sam_eats', `the most-voted public cave wins (${r.handle}, ${r.votes} votes)`);
  check(r.votes === 2, 'only votes from the last 24 hours count');
  check(r.name === 'Sam' && r.theme === 'beach' && r.scene === 'scene-beach-3d.jpg', 'the winner brings its name, theme, and scene image');
  check(r.url === '/@sam_eats', 'the winner links to its public cave');
  check(r.points === 10, 'the winner brings its points total');

  // Sam's votes go away: Connie's 1 recent vote wins (the 3-day-old one still does not count).
  delete docs['caveVotes/samshare0001/votes/voterB2222'];
  delete docs['caveVotes/samshare0001/votes/voterC3333'];
  r = await cotdCall();
  check(r.handle === 'feedthebear32' && r.votes === 1, 'one recent vote wins once the leader loses theirs');
  check(r.theme === 'forest' && r.scene === 'scene-forest-3d.jpg', 'Connie brings her Forest scene');

  // No votes at all today: Connie's cave is the default, never an empty slot.
  delete docs['caveVotes/connieshare01/votes/voterA1111'];
  delete docs['caveVotes/connieshare01/votes/voterOld999'];
  r = await cotdCall();
  check(r.handle === 'feedthebear32' && r.votes === 0, 'no votes today still features Connie\'s cave');
  check(r.name === 'Connie' && r.url === '/@feedthebear32', 'the default links to Connie\'s public cave');

  // Only POST is rejected; GET is the only method.
  r = await cotdCall('POST');
  check(r.status === 405, 'POST is not allowed');

  finish('cave-of-the-day');
})();
