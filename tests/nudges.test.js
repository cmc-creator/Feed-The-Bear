// Dinner nudge + win-back (findings 3 and 4).
// - pickDinner: 5:30pm Phoenix, members with saved spots, one a day
//   (dinnerAt), independent of the morning nudge.
// - dinnerNudges: sends only to members with tokens and saved spots,
//   marks dinnerAt, and never touches the morning lastAt.
// - winbackNudges: members who saved spots then went quiet for 7 or 14
//   days get one nudge each, personalized (a gift waiting beats a
//   generic miss-you; else the nearest cave unlock). Active members,
//   empty accounts, and already-nudged members get nothing.
const path = require('path');
const Module = require('module');
const { check, finish } = require('./lib');

const DAY = 86400000;
const now = Date.now();
const iso = ms => new Date(ms).toISOString();

// ── Fake Firebase ──
const docs = {
  // Dinner members: u1 has spots + tokens, u2 has tokens but no spots,
  // u3 has spots but no tokens, u4 already got dinner today.
  'pushArea/u1': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: {}, at: iso(now) },
  'pushArea/u2': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: {}, at: iso(now) },
  'pushArea/u3': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: {}, at: iso(now) },
  'pushArea/u4': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: { dinnerAt: iso(now).slice(0, 10) }, at: iso(now) },
  'pushTokens/u1': { tokens: ['tok-u1'] },
  'pushTokens/u2': { tokens: ['tok-u2'] },
  'pushTokens/u4': { tokens: ['tok-u4'] },
  'users/u1/restaurants/r1': { name: 'Tacos Chiwas' },
  'users/u3/restaurants/r1': { name: 'Tacos Chiwas' },
  'users/u4/restaurants/r1': { name: 'Tacos Chiwas' },
  // Win-back members: w7 signed up 8 days ago, has spots, quiet 8 days;
  // w14 signed up 15 days ago, has spots, quiet 15 days, already got the
  // day-7 nudge; wActive signed up 8 days ago but was active yesterday;
  // wEmpty signed up 8 days ago, quiet, but never saved a spot;
  // wDone signed up 15 days ago and already got both nudges.
  // (They all already got today's dinner nudge, so the dinner run below
  // does not also send to them.)
  'signups/w7': { at: iso(now - 8 * DAY), email: 'w7@example.com', name: 'W7' },
  'signups/w14': { at: iso(now - 15 * DAY), email: 'w14@example.com', name: 'W14', winback7At: iso(now - 7 * DAY) },
  'signups/wActive': { at: iso(now - 8 * DAY), email: 'wa@example.com', name: 'WA' },
  'signups/wEmpty': { at: iso(now - 8 * DAY), email: 'we@example.com', name: 'WE' },
  'signups/wDone': { at: iso(now - 15 * DAY), email: 'wd@example.com', name: 'WD', winback7At: iso(now - 7 * DAY), winback14At: iso(now - DAY) },
  'pushArea/w7': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: { dinnerAt: iso(now).slice(0, 10) }, at: iso(now - 8 * DAY) },
  'pushArea/w14': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: { dinnerAt: iso(now).slice(0, 10) }, at: iso(now - 15 * DAY) },
  'pushArea/wActive': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: { dinnerAt: iso(now).slice(0, 10) }, at: iso(now - DAY) },
  'pushArea/wEmpty': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: { dinnerAt: iso(now).slice(0, 10) }, at: iso(now - 8 * DAY) },
  'pushArea/wDone': { lat: 33.49, lng: -111.92, state: 'AZ', miles: 10, want: [], sent: { dinnerAt: iso(now).slice(0, 10) }, at: iso(now - 15 * DAY) },
  'pushTokens/w7': { tokens: ['tok-w7'] },
  'pushTokens/w14': { tokens: ['tok-w14'] },
  'pushTokens/wActive': { tokens: ['tok-wa'] },
  'pushTokens/wEmpty': { tokens: ['tok-we'] },
  'pushTokens/wDone': { tokens: ['tok-wd'] },
  'users/w7/restaurants/r1': { name: 'Tacos Chiwas' },
  'users/w14/restaurants/r1': { name: 'Tacos Chiwas' },
  'users/wActive/restaurants/r1': { name: 'Tacos Chiwas' },
  'users/wDone/restaurants/r1': { name: 'Tacos Chiwas' },
  'users/w7/meta/profile': { caveLifetime: 40, caveGifts: [{ id: 'pie', kind: 'food', seen: false }] },
  'users/w14/meta/profile': { caveLifetime: 90, caveGifts: [] },
};
const ref = p => ({
  p,
  get: async () => ({ exists: !!docs[p], data: () => docs[p] }),
  set: async (d, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...d } : d; },
  delete: async () => { delete docs[p]; },
});
const coll = prefix => {
  const kids = () => Object.keys(docs)
    .filter(k => k.startsWith(prefix + '/') && !k.slice(prefix.length + 1).includes('/'))
    .map(k => ({ id: k.slice(prefix.length + 1), data: () => docs[k], ref: ref(k) }));
  const q = {
    get: async () => { const ds = kids(); return { size: ds.length, docs: ds }; },
    where: (f, op, v) => ({ get: async () => {
      const ds = kids().filter(d => op === '>=' ? d.data()[f] >= v : d.data()[f] === v);
      return { size: ds.length, docs: ds };
    }, limit: n => ({ get: async () => {
      const ds = kids().filter(d => op === '>=' ? d.data()[f] >= v : d.data()[f] === v).slice(0, n);
      return { size: ds.length, docs: ds };
    } }) }),
    limit: n => ({ get: async () => { const ds = kids().slice(0, n); return { size: ds.length, docs: ds }; } }),
  };
  return q;
};
const sentPush = [];
const fakeFirestore = () => ({ doc: ref, collection: coll });
fakeFirestore.FieldValue = {
  arrayRemove: (...v) => ({ __arrayRemove: v }),
  increment: n => ({ __increment: n }),
};
const fakeAdmin = {
  apps: [1],
  credential: { cert: () => ({}) },
  auth: () => ({ getUser: async uid => ({ uid }) }),
  messaging: () => ({ sendEachForMulticast: async msg => {
    sentPush.push(msg);
    return { successCount: msg.tokens.length, responses: msg.tokens.map(() => ({ success: true })) };
  } }),
  firestore: fakeFirestore,
};
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') return fakeAdmin;
  // api/owner.js requires stripe, which is not installed in the test
  // sandbox; the win-back and dinner paths never touch it.
  if (req === 'stripe') return function () { return { customers: { list: async () => ({ data: [] }) } }; };
  return orig.call(this, req, ...rest);
};
const nudges = require(path.join(__dirname, '..', 'api', 'nudges.js'));
Module._load = orig;

(async () => {
  // ── pickDinner (pure) ──
  const area = { sent: {} };
  let m = nudges.pickDinner(area, true, now);
  check(m && m.kind === 'dinner' && /Tonight's Pick/.test(m.title) && m.data?.open === 'tonight',
    'pickDinner returns the dinner nudge for a member with spots');
  check(nudges.pickDinner(area, false, now) === null, 'pickDinner skips members with no saved spots');
  check(nudges.pickDinner({ sent: { dinnerAt: iso(now).slice(0, 10) } }, true, now) === null,
    'pickDinner sends at most one dinner nudge a day');
  check(nudges.pickDinner({ sent: { lastAt: now } }, true, now) !== null,
    'a morning nudge does not block the dinner nudge (separate dinnerAt)');

  // ── dinnerNudges ──
  let sent = await nudges.dinnerNudges({ doc: ref, collection: coll }, fakeAdmin, now);
  check(sent === 1, `the dinner run sends exactly one nudge (${sent})`);
  check(sentPush.length === 1 && sentPush[0].tokens[0] === 'tok-u1' && /Tonight's Pick/.test(sentPush[0].notification.title),
    'the dinner nudge goes to the member with spots and tokens');
  check(docs['pushArea/u1'].sent.dinnerAt === iso(now).slice(0, 10), 'dinnerAt is marked so it does not repeat today');
  check(!docs['pushArea/u2'].sent.dinnerAt && !docs['pushArea/u3'].sent.dinnerAt && docs['pushArea/u4'].sent.dinnerAt === iso(now).slice(0, 10),
    'no-spots and no-tokens members get nothing; the already-sent member keeps their mark');
  check(docs['pushArea/u1'].sent.lastAt === undefined, 'the dinner run never touches the morning lastAt');
  sent = await nudges.dinnerNudges({ doc: ref, collection: coll }, fakeAdmin, now);
  check(sent === 0 && sentPush.length === 1, 'a second dinner run the same day sends nothing');

  // ── winbackNudges ──
  sent = await nudges.winbackNudges({ doc: ref, collection: coll }, fakeAdmin);
  check(sent === 2, `the win-back run sends two nudges (${sent})`);
  const w7msg = sentPush.find(x => x.tokens[0] === 'tok-w7');
  const w14msg = sentPush.find(x => x.tokens[0] === 'tok-w14');
  check(!!w7msg && /gift/i.test(w7msg.notification.title), 'the day-7 nudge leads with the gift waiting in their cave');
  check(!!w14msg && /points from your next cave unlock/.test(w14msg.notification.body),
    'the day-14 nudge names how far their next unlock is');
  check(!!docs['signups/w7'].winback7At && !!docs['signups/w14'].winback14At, 'the win-back markers are set');
  check(!sentPush.some(x => ['tok-wa', 'tok-we', 'tok-wd'].includes(x.tokens[0])),
    'active members, empty accounts, and already-nudged members get nothing');
  sent = await nudges.winbackNudges({ doc: ref, collection: coll }, fakeAdmin);
  check(sent === 0, 'a second win-back run sends nothing (markers hold)');

  // ── handler dinner branch ──
  process.env.CRON_SECRET = 'test-secret';
  const call = (query = {}) => new Promise(resolve => {
    let status = 200;
    nudges({ method: 'GET', query, headers: { authorization: 'Bearer test-secret' } },
      { status (s) { status = s; return this; }, setHeader () {}, json (d) { resolve({ status, ...d }); return this; }, send (t) { resolve({ status, text: t }); return this; } });
  });
  // Reset the dinner marker so the handler run has something to send.
  delete docs['pushArea/u1'].sent.dinnerAt;
  let r = await call({ dinner: '1' });
  check(r.status === 200 && r.dinner === 1, `GET ?dinner=1 runs only the dinner nudge (${JSON.stringify(r)})`);
  check(r.welcomeNudges === undefined && r.winback === undefined, 'the dinner run does no morning work');

  finish('nudges');
})();
