// A brand-new account tells the owner once (api/push.js 'joined'): a push to
// the owner's phone and/or an email, per the owner portal's switches.
const Module = require('module');
const path = require('path');
const { check, finish } = require('./lib');

const docs = {};
const sent = [];
const emails = [];
const now = Date.now();
const people = {
  newbie: { uid: 'newbie', email: 'jo@example.com', displayName: 'Jo', metadata: { creationTime: new Date(now - 60000).toUTCString() }, providerData: [{ providerId: 'google.com' }] },
  oldie: { uid: 'oldie', email: 'old@example.com', metadata: { creationTime: new Date(now - 5 * 864e5).toUTCString() }, providerData: [] },
  boss: { uid: 'boss', email: 'cmc@conniemichelleconsulting.com', metadata: { creationTime: new Date(now - 1000).toUTCString() }, providerData: [] },
};
const ref = p => ({ path: p, get: async () => ({ exists: !!docs[p], data: () => docs[p] }), set: async (d, o) => { docs[p] = o?.merge ? { ...docs[p], ...d } : d; } });
const firestore = () => ({
  doc: ref,
  getAll: async (...refs) => Promise.all(refs.map(r => r.get())),
  runTransaction: async fn => fn({ get: r => r.get(), set: (r, d) => { docs[r.path] = d; } }),
});
firestore.FieldValue = {};
const fakeAdmin = {
  apps: [1],
  firestore,
  auth: () => ({
    verifyIdToken: async t => ({ uid: t }),
    getUser: async uid => people[uid],
    getUserByEmail: async e => { const u = Object.values(people).find(x => x.email === e); if (!u) throw new Error('none'); return u; },
  }),
  messaging: () => ({ sendEachForMulticast: async m => { sent.push(m); return { successCount: m.tokens.length, responses: m.tokens.map(() => ({ success: true })) }; } }),
};
process.env.BREVO_API_KEY = 'x';
process.env.DIGEST_FROM_EMAIL = 'bear@feed-the-bear.com';
global.fetch = async (url, o) => { emails.push(JSON.parse(o.body)); return { ok: true, text: async () => '' }; };
const realLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fakeAdmin : realLoad.call(this, req, ...rest); };
const push = require(path.join(__dirname, '..', 'api', 'push.js'));
Module._load = realLoad;
const call = (uid, body) => new Promise(resolve => {
  const res = { status (s) { this.s = s; return this; }, json (d) { resolve({ status: this.s, ...d }); }, setHeader () {} };
  push({ method: 'POST', headers: { authorization: `Bearer ${uid}` }, body }, res);
});

(async () => {
  docs['pushTokens/boss'] = { tokens: ['owner-phone-token-000000000001'] };
  let r = await call('newbie', { action: 'joined' });
  check(r.told && sent.length === 1 && sent[0].tokens[0] === 'owner-phone-token-000000000001', "a new account pings the owner's phone");
  check(/New sign-up/.test(sent[0].notification.title) && /Jo \(jo@example\.com\).*Google/.test(sent[0].notification.body) && sent[0].data.open === 'owner', `saying who and how (${sent[0].notification.body})`);
  const toOwner = () => emails.filter(e => e.tags?.[0] === 'owner-signup');
  const welcomes = () => emails.filter(e => e.tags?.[0] === 'welcome');
  check(toOwner().length === 1 && toOwner()[0].to[0].email === 'cmc@conniemichelleconsulting.com' && /jo@example\.com/.test(toOwner()[0].subject), 'and emails the owner');
  check(welcomes().length === 1 && welcomes()[0].to[0].email === 'jo@example.com' && /Welcome, Jo/.test(welcomes()[0].htmlContent) && /Save 3 spots/.test(welcomes()[0].htmlContent), 'the new member gets a welcome email with first steps');
  check(docs['signups/newbie']?.via === 'Google', 'the sign-up is recorded');
  r = await call('newbie', { action: 'joined' });
  check(!r.told && sent.length === 1 && toOwner().length === 1 && welcomes().length === 1, 'only once per account');
  r = await call('oldie', { action: 'joined' });
  check(!r.told && r.reason === 'not new', 'an old account signing in again is not a sign-up');
  r = await call('boss', { action: 'joined' });
  check(!r.told, "the owner's own account does not ping the owner");
  docs['config/ownerAlerts'] = { push: false, email: false };
  people.newbie2 = { ...people.newbie, uid: 'newbie2', email: 'sam@example.com', displayName: '' };
  r = await call('newbie2', { action: 'joined' });
  check(r.told && sent.length === 1 && toOwner().length === 1 && welcomes().length === 2, 'switched off in the portal: no push or email to the owner (the member is still welcomed)');
  // Next day: nothing saved yet gets one nudge (push if they have the app, else email).
  const realLoad2 = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fakeAdmin : req === 'stripe' ? (() => ({})) : realLoad2.call(this, req, ...rest); };
  const { welcomeNudges } = require(path.join(__dirname, '..', 'api', 'nudges.js'));
  Module._load = realLoad2;
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const nd = { 'signups/empty': { email: 'e@example.com', at: ago(24) }, 'signups/busy': { email: 'b@example.com', at: ago(24) }, 'signups/tooSoon': { email: 's@example.com', at: ago(2) } };
  const ndb = {
    doc: p => ({ get: async () => ({ data: () => nd[p] }) }),
    collection: c => ({
      where: () => ({ limit: () => ({ get: async () => ({ docs: Object.keys(nd).filter(k => k.startsWith('signups/')).map(k => ({ id: k.split('/')[1], data: () => nd[k], ref: { set: async d => { nd[k] = { ...nd[k], ...d }; } } })) }) }) }),
      limit: () => ({ get: async () => ({ size: c === 'users/busy/restaurants' ? 1 : 0 }) }),
    }),
  };
  const before = emails.length;
  const n = await welcomeNudges(ndb, fakeAdmin);
  const nudgeMails = emails.slice(before);
  check(n === 1 && nudgeMails.length === 1 && nudgeMails[0].to[0].email === 'e@example.com', `day two: only the empty den gets a nudge (${n})`);
  check(nd['signups/busy'].nudgedAt && !nd['signups/tooSoon'].nudgedAt, 'someone with spots is left alone, and a brand-new one waits a day');
  check(await welcomeNudges(ndb, fakeAdmin) === 0, 'never twice');
  finish('signupalert');
})();
