// Owner portal (api/owner.js, /owner.html): free Grizzly for VIPs by email,
// and Stripe discount codes with a link that applies them.
const Module = require('module');
const { check, finish } = require('./lib');

// A fake Firestore, Firebase Auth and Stripe.
const docs = {};
const users = { 'friend@example.com': 'uidFriend', 'cmc@conniemichelleconsulting.com': 'uidOwner' };
const tokens = { owner: { email: 'cmc@conniemichelleconsulting.com', email_verified: true }, stranger: { email: 'someone@example.com', email_verified: true } };
const merge = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b)) { if (v === '__delete__') delete o[k]; else o[k] = v; } return o; };
const ref = path => ({ id: path.split('/').pop(), path,
  get: async () => ({ exists: !!docs[path], data: () => docs[path] }),
  set: async (v, o) => { docs[path] = o?.merge ? merge(docs[path], v) : { ...v }; } });
const query = (col, filters = []) => ({
  where: (f, op, v) => query(col, [...filters, [f, v]]),
  orderBy: () => query(col, filters), limit: () => query(col, filters),
  get: async () => ({ docs: Object.keys(docs).filter(k => k.startsWith(`${col}/`) && k.split('/').length === 2 && filters.every(([f, v]) => docs[k][f] === v)).map(k => ({ id: k.split('/')[1], ref: ref(k), data: () => docs[k] })) }),
});
const firestore = () => ({ doc: ref, collection: c => query(c) });
firestore.FieldValue = { delete: () => '__delete__' };
const fakeAdmin = { apps: [1], firestore, auth: () => ({
  verifyIdToken: async t => { if (!tokens[t]) throw new Error('bad'); return tokens[t]; },
  getUserByEmail: async e => { if (!users[e]) throw new Error('none'); return { uid: users[e] }; },
  listUsers: async () => ({ users: [
    { email: 'old@example.com', metadata: { creationTime: new Date(Date.now() - 40 * 864e5).toUTCString() }, providerData: [] },
    { email: 'jo@example.com', displayName: 'Jo', metadata: { creationTime: new Date(Date.now() - 3600e3).toUTCString() }, providerData: [{ providerId: 'google.com' }] },
  ] }),
}) };
const codes = [];
const fakeStripe = () => ({
  subscriptions: { list: async () => ({ data: [] }) },
  coupons: { create: async c => ({ id: `co_${codes.length}`, ...c }) },
  promotionCodes: {
    list: async ({ code } = {}) => ({ data: codes.filter(p => !code || p.code === code) }),
    create: async p => { const x = { id: `promo_${codes.length + 1}`, active: true, times_redeemed: 0, max_redemptions: p.max_redemptions, expires_at: p.expires_at, code: p.code, coupon: { percent_off: 25, duration: 'once' } }; codes.push(x); return x; },
    update: async (id, u) => { Object.assign(codes.find(c => c.id === id), u); return {}; },
  },
});
const load = Module._load;
Module._load = function (req, ...a) {
  if (req === 'firebase-admin') return fakeAdmin;
  if (req === 'stripe') return fakeStripe;
  return load.call(this, req, ...a);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const owner = require('../api/owner');
Module._load = load;

const call = (token, method, body) => new Promise(resolve => {
  const res = { setHeader () {}, status (c) { this.c = c; return this; }, json (b) { resolve({ status: this.c, ...b }); } };
  owner({ method, body, headers: { authorization: token ? `Bearer ${token}` : '' } }, res);
});

(async () => {
  check((await call('stranger', 'GET')).status === 403 && (await call(null, 'GET')).status === 401, 'only the owner gets in');
  const g = await call('owner', 'GET');
  check(g.signups?.total === 2 && g.signups.today === 1 && g.signups.recent[0].email === 'jo@example.com' && g.signups.recent[0].via === 'Google', `sign-ups, newest first, with counts (${JSON.stringify(g.signups?.recent?.[0])})`);
  check(g.alerts?.push === true && g.alerts.email === true, 'sign-up alerts start on');
  await call('owner', 'POST', { action: 'alerts', email: false });
  check(docs['config/ownerAlerts']?.email === false && docs['config/ownerAlerts'].push === undefined, 'the owner can switch one off');

  let r = await call('owner', 'POST', { action: 'grant', email: 'Friend@Example.com', months: 3, note: 'Food blogger' });
  check(r.status === 200 && docs['users/uidFriend/meta/profile']?.plan === 'grizzly' && docs['users/uidFriend/meta/profile'].compedBy === 'owner', `an existing account gets Grizzly now (${r.message})`);
  check(!!docs['users/uidFriend/meta/profile'].vipUntil && Date.parse(docs['users/uidFriend/meta/profile'].vipUntil) > Date.now() + 80 * 864e5, 'for the months chosen');

  r = await call('owner', 'POST', { action: 'grant', email: 'newbie@example.com', months: 0 });
  check(r.pending && /first time they sign in/.test(r.message), 'someone without an account yet: waiting for sign-in');
  check(await owner.applyPendingVip(firestore(), 'uidNew', 'newbie@example.com') && docs['users/uidNew/meta/profile']?.plan === 'grizzly' && docs['vips/newbie@example.com'].uid === 'uidNew', 'their first sign-in turns Grizzly on');
  check(!(await owner.applyPendingVip(firestore(), 'uidOther', 'newbie@example.com')), 'and nobody else can claim it');
  check(await owner.vipFor(firestore(), 'uidNew'), 'a VIP keeps Grizzly if a subscription of theirs ends');

  const list = await call('owner', 'GET');
  check(list.vips.length === 2 && list.vips.every(v => v.live), 'the portal lists VIPs');

  r = await call('owner', 'POST', { action: 'revoke', email: 'newbie@example.com' });
  check(r.status === 200 && docs['users/uidNew/meta/profile'].plan === 'free' && !docs['users/uidNew/meta/profile'].compedBy, 'End turns Grizzly off');

  docs['vips/friend@example.com'].until = new Date(Date.now() - 1000).toISOString();
  check(await owner.expireVips(firestore()) === 1 && docs['users/uidFriend/meta/profile'].plan === 'free', 'a VIP whose time is up goes back to free each morning');

  check((await call('owner', 'POST', { action: 'grant', email: 'not-an-email' })).status === 400, 'a bad email is refused');

  r = await call('owner', 'POST', { action: 'code', code: 'bearvip', percent: 25, duration: 'once', maxUses: 10, expiresDays: 30 });
  check(r.status === 200 && r.code === 'BEARVIP' && r.link === 'https://www.feed-the-bear.com/app.html?promo=BEARVIP' && codes[0].max_redemptions === 10 && codes[0].expires_at > Date.now() / 1000, `a discount code with a link (${r.link})`);
  check((await call('owner', 'POST', { action: 'code', code: 'BEARVIP', percent: 25 })).status === 409, 'the same code twice is refused');
  check((await call('owner', 'POST', { action: 'code', code: 'X', percent: 25 })).status === 400 && (await call('owner', 'POST', { action: 'code', code: 'GOODCODE', percent: 0 })).status === 400, 'bad codes and percents are refused');
  check((await call('owner', 'GET')).codes[0]?.code === 'BEARVIP', 'the portal lists codes with how often they were used');
  r = await call('owner', 'POST', { action: 'codeOff', id: 'promo_1' });
  check(r.status === 200 && codes[0].active === false, 'a code can be switched off');

  // Affiliate codes: saved by the owner, read by anyone (they end up in links).
  r = await call('owner', 'POST', { action: 'partners', partners: { doordash: 'https://dd.example/c/1?u={url}', ubereats: 'ref=feedthebear' } });
  check(r.status === 200 && docs['config/partners'].doordash.includes('{url}'), 'affiliate codes are saved');
  check((await call('owner', 'POST', { action: 'partners', partners: { opentable: 'https://ot.example/track' } })).status === 400, 'a tracking link without {url} is refused');
  const pub = await new Promise(resolve => owner({ method: 'GET', query: { partners: '1' }, headers: {} }, { setHeader () {}, status (c) { this.c = c; return this; }, json (b) { resolve(b); } }));
  check(pub.partners?.ubereats === 'ref=feedthebear', 'the app can read them without signing in');

  r = await call('owner', 'POST', { action: 'partners', partners: { shop: 'https://feedthebear.printful.me' } });
  check(r.status === 200 && docs['config/partners'].shop === 'https://feedthebear.printful.me', 'the merch shop link is saved');
  check((await call('owner', 'POST', { action: 'partners', partners: { shop: 'javascript:alert(1)' } })).status === 400, 'only an https shop link is accepted');

  finish('owner');
})();
