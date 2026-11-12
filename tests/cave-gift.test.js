// Bear Cave gifts: a visitor leaves one small gift a day for the cave
// owner — a food for their pantry or a decor piece for their cave.
// - POST validates the gift (food from the 25 foods, small decor only),
//   the cave, and the visitor; one gift per visitor per day.
// - A food gift lands in the owner's pantry; a decor gift waits in
//   caveGifts for the owner to claim in cave setup.
// - GET tells the public page whether this visitor already gifted today.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server, with a fake Firebase ──
const docs = {
  'profiles/giftshare01': { uid: 'giftUid12345', u: 'Gifty', profile: { picks: [] } },
  'users/giftUid12345/meta/profile': { cave: { t: 'forest', d: [] }, pantry: { pie: 1 }, caveGifts: [] },
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
const caveGiftApi = require(path.join(__dirname, '..', 'api', 'cave-gift.js'));
Module._load = orig;

const giftCall = (method, { query = {}, body = {} } = {}) => new Promise(resolve => {
  let status = 200;
  const res = { setHeader () {}, status (c) { status = c; return this; }, json (d) { resolve({ status, ...d }); return this; } };
  caveGiftApi({ method, query, body, headers: { 'x-forwarded-for': '9.9.9.9' } }, res);
});

(async () => {
  // ── 1. The API: one gift per visitor per day ──
  let r = await giftCall('GET', { query: { share: 'giftshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.status === 200 && r.giftedToday === false, 'a fresh visitor has not gifted today');
  r = await giftCall('GET', { query: { share: 'nope12345678', voter: 'aaaa1111bbbb2222' } });
  check(r.status === 404, 'an unknown cave says it was not found');
  r = await giftCall('GET', { query: { share: 'giftshare01', voter: 'x' } });
  check(r.status === 400, 'a bad voter id is rejected');

  // A food gift lands in the owner's pantry and in caveGifts.
  r = await giftCall('POST', { body: { share: 'giftshare01', voter: 'aaaa1111bbbb2222', gift: { kind: 'food', id: 'pie' } } });
  check(r.status === 200 && r.ok === true && r.gift?.label === 'Pie', 'a pie gift sends');
  check(docs['users/giftUid12345/meta/profile'].pantry.pie === 2, 'the pie lands in the owner\'s pantry (was 1, now 2)');
  check(docs['users/giftUid12345/meta/profile'].caveGifts[0]?.id === 'pie', 'the pie is recorded in caveGifts');
  r = await giftCall('GET', { query: { share: 'giftshare01', voter: 'aaaa1111bbbb2222' } });
  check(r.status === 200 && r.giftedToday === true, 'the same visitor has gifted today now');
  r = await giftCall('POST', { body: { share: 'giftshare01', voter: 'aaaa1111bbbb2222', gift: { kind: 'food', id: 'taco' } } });
  check(r.status === 409, 'a second gift the same day is blocked');

  // A different visitor can still gift; decor does not touch the pantry.
  r = await giftCall('POST', { body: { share: 'giftshare01', voter: 'cccc3333dddd4444', gift: { kind: 'decor', id: 'lantern' } } });
  check(r.status === 200 && r.ok === true && r.gift?.label === 'Lantern glow', 'a lantern gift sends from a second visitor');
  check(docs['users/giftUid12345/meta/profile'].caveGifts.length === 2, 'two gifts are recorded');
  check(docs['users/giftUid12345/meta/profile'].caveGifts[0]?.id === 'lantern', 'the newest gift is first');
  check(docs['users/giftUid12345/meta/profile'].pantry.pie === 2, 'a decor gift does not change the pantry');

  // Bad gifts are rejected, never recorded.
  r = await giftCall('POST', { body: { share: 'giftshare01', voter: 'eeee5555ffff6666', gift: { kind: 'food', id: 'nope' } } });
  check(r.status === 400, 'an unknown food is rejected');
  r = await giftCall('POST', { body: { share: 'giftshare01', voter: 'eeee5555ffff6666', gift: { kind: 'toy', id: 'pie' } } });
  check(r.status === 400, 'an unknown gift kind is rejected');
  r = await giftCall('POST', { body: { share: 'giftshare01', voter: 'eeee5555ffff6666' } });
  check(r.status === 400, 'a missing gift is rejected');
  r = await giftCall('POST', { body: { share: 'nope12345678', voter: 'eeee5555ffff6666', gift: { kind: 'food', id: 'pie' } } });
  check(r.status === 404, 'a gift to an unknown cave is rejected');
  check(docs['users/giftUid12345/meta/profile'].caveGifts.length === 2, 'rejected gifts are never recorded');

  // ── 2. The app: the owner sees the gift and claims it ──
  const browser = await launch();
  const spot = i => ({
    id: `s${i}`, name: `Spot ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [],
  });
  const p = await newPage(browser, { seed: [spot(0)], settings: {} });
  await p.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await p.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
  await p.route('**/api/handle**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') return rt.fulfill({ json: { ok: true, public: true } });
    if (/mine=1/.test(req.url())) return rt.fulfill({ json: { handle: 'gifty', public: true, views: 5, joins: 2, votes: 3 } });
    return rt.fulfill({ json: { followers: [], invites: [] } });
  });
  await p.addInitScript(() => {
    const auth = {
      currentUser: null,
      setPersistence: async () => {},
      onAuthStateChanged (fn) { queueMicrotask(() => fn(null)); return () => {}; },
      signOut: async () => {},
    };
    window.firebase = {
      initializeApp () {},
      auth: Object.assign(() => auth, { GoogleAuthProvider: class {}, Auth: { Persistence: { LOCAL: 'local' } } }),
      firestore: () => ({
        doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), set: async () => {}, delete: async () => {} }),
        collection: () => ({ get: async () => ({ docs: [] }) }),
        batch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
      }),
    };
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  await p.evaluate(() => { window._ftbUid = 'giftUid12345'; });

  // Two gifts arrive on the profile: a lantern to claim, a pie (already in the pantry).
  await p.evaluate(() => {
    const prof = loadUserProfile() || { name: 'Gifty', avatar: '🧸', joinDate: new Date().toISOString() };
    saveUserProfile({ ...prof, caveGifts: [
      { kind: 'decor', id: 'lantern', label: 'Lantern glow', at: new Date().toISOString() },
      { kind: 'food', id: 'pie', label: 'Pie', at: new Date().toISOString() },
    ] });
  });
  check(await p.evaluate(() => caveUnseenGifts().length) === 2, 'two unseen gifts wait in the profile');
  await p.evaluate(() => openHandleSettings());
  await p.waitForFunction(() => !document.getElementById('handle-overlay')?.classList.contains('hidden'));
  check(/You got a gift!/.test(await p.locator('#cave-gift-note').innerText()), 'cave setup shows the gift note');
  check(/Lantern glow/.test(await p.locator('#cave-gift-note').innerText()), 'the note names the gifted lantern');

  // Claiming the lantern puts it in the cave (and makes it owned, a gift).
  check(await p.evaluate(() => claimCaveGift(0)) === true, 'claiming the lantern works');
  check(await p.evaluate(() => (loadUserProfile()?.cave?.decor || []).includes('lantern')), 'the gifted lantern is in the cave');
  check(await p.evaluate(() => (loadUserProfile()?.caveOwnedDecor || []).includes('lantern')), 'the gifted lantern is now owned');
  check(await p.evaluate(() => caveUnseenGifts().length) === 1, 'one unseen gift is left');
  // The food gift just marks seen — it was already in the pantry.
  check(await p.evaluate(() => claimCaveGift(1)) === true, 'claiming the pie marks it seen');
  check(await p.evaluate(() => caveUnseenGifts().length) === 0, 'no unseen gifts are left');
  // A full cave cannot take another gifted piece.
  await p.evaluate(() => saveCave({ theme: 'cozy', decor: ['lantern', 'lights', 'plant', 'rug'] }));
  await p.evaluate(() => {
    const prof = loadUserProfile();
    saveUserProfile({ ...prof, caveGifts: [{ kind: 'decor', id: 'honeypot', label: 'Honey pot', at: new Date().toISOString() }] });
  });
  check(await p.evaluate(() => claimCaveGift(0)) === false, 'claiming into a full cave is blocked');
  check(await p.evaluate(() => caveUnseenGifts().length) === 1, 'the blocked gift stays unseen');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();

  await browser.close();
  finish('cave-gift');
})();
