// The owner cannot gift, vote for, or follow their own cave (bug found
// by Connie on the public cave page).
// - Server: api/cave-gift.js and api/cave-vote.js reject a request whose
//   uid is the cave owner's (403, reason 'own-cave'); an owner's vote
//   never counts toward Cave of the Day; api/handle.js already blocks
//   self-follow (verified here: it records nothing).
// - Client: on their own page the owner sees no vote button, no gift
//   chips, and no follow CTA — just "This is your cave". Visitors and
//   anonymous readers still see all three.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, finish } = require('./lib');

const now = new Date().toISOString();

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/ownershare01': { uid: 'ownerUid12345', u: 'Owner', profile: { picks: [{ n: 'Tacos Chiwas', c: 'Mexican', r: 5 }], cave: { t: 'forest', d: [] }, pts: 100 } },
  'profiles/ownershare02': { uid: 'ownerUid12345', u: 'Owner Alt', profile: { picks: [], cave: { t: 'forest', d: [] }, pts: 0 } },
  'profiles/visitorshare1': { uid: 'visitorUid1234', u: 'Visitor', profile: { picks: [], cave: { t: 'beach', d: [] }, pts: 10 } },
  'handles/owner_eats': { uid: 'ownerUid12345', id: 'ownershare01', public: true, u: 'Owner' },
  'handles/visitor_eats': { uid: 'visitorUid1234', id: 'visitorshare1', public: true, u: 'Visitor' },
  'users/ownerUid12345/meta/profile': { cave: { t: 'forest', d: [] }, pantry: {}, caveGifts: [] },
  'users/visitorUid1234/meta/profile': { cave: { t: 'beach', d: [] }, pantry: {}, caveGifts: [] },
  'caveVotes/ownershare01/votes/voterOwn1111': { at: now, uid: 'ownerUid12345' },
  'caveVotes/ownershare01/votes/voterV111111': { at: now },
  'caveVotes/visitorshare1/votes/voterV222222': { at: now },
  'caveVotes/visitorshare1/votes/voterV333333': { at: now },
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
  firestore: () => ({
    doc: ref,
    collection,
    runTransaction: async fn => fn({
      get: r => r.get(),
      set: (r, d, opts) => { docs[r.p] = opts?.merge ? { ...(docs[r.p] || {}), ...d } : d; },
      delete: r => { delete docs[r.p]; },
    }),
  }),
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
const voteApi = require(path.join(__dirname, '..', 'api', 'cave-vote.js'));
const giftApi = require(path.join(__dirname, '..', 'api', 'cave-gift.js'));
const cotdApi = require(path.join(__dirname, '..', 'api', 'cave-of-the-day.js'));
const handleApi = require(path.join(__dirname, '..', 'api', 'handle.js'));
const creatorApi = require(path.join(__dirname, '..', 'api', 'creator.js'));
Module._load = orig;

const call = (api, method, { query = {}, body = {}, token } = {}) => new Promise(resolve => {
  let status = 200;
  const res = { setHeader () {}, status (c) { status = c; return this; }, json (d) { resolve({ status, ...d }); return this; }, send (t) { resolve({ status, html: String(t) }); return this; } };
  api({ method, query, body, headers: { 'x-forwarded-for': '9.9.9.9', ...(token ? { 'x-ftb-token': `token-${token}` } : {}) } }, res);
});

(async () => {
  // ── 0. Cave of the Day never counts an owner's vote ──
  // (First, before the vote tests below add a vote to the owner's cave.)
  let r = await call(cotdApi, 'GET');
  check(r.status === 200 && r.handle === 'visitor_eats' && r.votes === 2,
    `the visitor cave (2 real votes) wins over the owner cave (1 real + 1 own) (${r.handle}, ${r.votes})`);

  // ── 1. The vote endpoint rejects the owner, accepts a visitor ──
  r = await call(voteApi, 'POST', { body: { action: 'vote', share: 'ownershare01', voter: 'voterOwn1111', uid: 'ownerUid12345' } });
  check(r.status === 403 && r.reason === 'own-cave', `the owner cannot vote for their own cave (${r.status}, ${r.reason})`);
  check(!docs['caveVotes/ownershare01/votes/voterOwn1111'] || docs['caveVotes/ownershare01/votes/voterOwn1111'].at === now,
    'the rejected vote is not recorded');
  r = await call(voteApi, 'POST', { body: { action: 'vote', share: 'ownershare01', voter: 'voterNew9999', uid: 'visitorUid1234' } });
  check(r.status === 200 && r.voted === true, 'a visitor can still vote for the cave');
  check(docs['caveVotes/ownershare01/votes/voterNew9999']?.uid === 'visitorUid1234', 'the vote is stored with the voter\'s uid');
  r = await call(voteApi, 'POST', { body: { action: 'unvote', share: 'ownershare01', voter: 'voterOwn1111', uid: 'ownerUid12345' } });
  check(r.status === 200, 'removing a vote is always allowed (it only takes love away)');

  // ── 2. The gift endpoint rejects the owner, accepts visitors ──
  r = await call(giftApi, 'POST', { body: { share: 'ownershare01', voter: 'voterOwn1111', uid: 'ownerUid12345', gift: { kind: 'food', id: 'pie' } } });
  check(r.status === 403 && r.reason === 'own-cave', `the owner cannot gift their own cave (${r.status}, ${r.reason})`);
  r = await call(giftApi, 'POST', { body: { share: 'ownershare01', voter: 'voterGift7777', uid: 'visitorUid1234', gift: { kind: 'food', id: 'pie' } } });
  check(r.status === 200 && r.ok === true, 'a signed-in visitor can still leave a gift');
  r = await call(giftApi, 'POST', { body: { share: 'ownershare01', voter: 'voterAnon8888', gift: { kind: 'food', id: 'donut' } } });
  check(r.status === 200 && r.ok === true, 'an anonymous visitor can still leave a gift');

  // ── 3. Cave of the Day never counts an owner's vote ──
  // (Checked at the top of this run, before the vote tests added a vote
  // to the owner's cave — the owner cave has 1 real vote + 1 own vote,
  // the visitor cave has 2 real votes, and the visitor wins.)

  // ── 4. Self-follow is a no-op server-side ──
  r = await call(handleApi, 'POST', { token: 'ownerUid12345', body: { action: 'followed', id: 'ownershare02', me: 'ownershare01' } });
  check(r.status === 200 && r.ok === true, 'a self-follow returns ok (it is ignored, not an error)');
  check(!docs['followedBy/ownerUid12345'], 'but nothing is recorded for a self-follow');
  r = await call(handleApi, 'POST', { token: 'visitorUid1234', body: { action: 'followed', id: 'ownershare01', me: 'visitorshare1' } });
  check(r.status === 200 && r.ok === true, 'a real follow still works');
  check((docs['followedBy/ownerUid12345']?.list || []).some(f => f.id === 'visitorshare1'),
    'the real follow is recorded on the owner\'s followers list');

  // ── 5. The page itself: the owner sees no vote / gift / follow UI ──
  const pg = await call(creatorApi, 'GET', { query: { h: 'owner_eats' } });
  check(pg.status === 200 && pg.html.includes('cave-vote-btn') && pg.html.includes('cave-gift-note') && pg.html.includes('Follow Owner'),
    'the page still renders the vote, gift, and follow controls (they are hidden per viewer, not removed)');
  check(pg.html.includes(JSON.stringify('ownerUid12345')), 'the owner uid is embedded in the page for the viewer check');

  const browser = await launch();
  const viewAs = async (uid) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    if (uid) await p.addInitScript(v => localStorage.setItem('ftb_data_owner_v1', v), uid);
    // The creator page is a serverless route, not a static file, so the
    // test renders it in-process and writes it into a real origin (the
    // static server) — setContent leaves an opaque origin and the page
    // cannot read localStorage there.
    await p.goto(`${BASE}/app.html`);
    await p.evaluate(html => { document.open(); document.write(html); document.close(); }, pg.html);
    await p.waitForTimeout(300);
    const state = await p.evaluate(() => ({
      voteHidden: document.getElementById('cave-vote-btn')?.style.display === 'none',
      voteNote: document.getElementById('cave-vote-count')?.textContent || '',
      giftDisabled: [...document.querySelectorAll('.cave-gift-chip')].every(c => c.disabled),
      giftNote: document.getElementById('cave-gift-note')?.textContent || '',
      ctaHidden: document.querySelector('.cta')?.style.display === 'none',
    }));
    await ctx.close();
    return state;
  };

  let s = await viewAs('ownerUid12345');
  check(s.voteHidden === true, 'the owner sees no vote button on their own page');
  check(/This is your cave/.test(s.voteNote), `the owner sees "This is your cave" by the vote count ("${s.voteNote}")`);
  check(s.giftDisabled === true, 'the owner sees no gift chips on their own page');
  check(/This is your cave/.test(s.giftNote), `the owner sees "This is your cave" by the gifts ("${s.giftNote}")`);
  check(s.ctaHidden === true, 'the owner sees no follow CTA on their own page');

  s = await viewAs('visitorUid1234');
  check(s.voteHidden === false, 'a visitor still sees the vote button');
  check(s.giftDisabled === false, 'a visitor still sees the gift chips');
  check(s.ctaHidden === false, 'a visitor still sees the follow CTA');

  s = await viewAs(null);
  check(s.voteHidden === false && s.giftDisabled === false && s.ctaHidden === false,
    'an anonymous reader still sees the vote, gift, and follow controls');

  await browser.close();
  finish('cave-owner');
})();
