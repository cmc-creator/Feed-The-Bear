// Dinner Vote: the host picks spots and shares a link; friends vote yes/no
// on vote.html without the app; everyone sees the tally and the winner.
const Module = require('module');
const path = require('path');
const { BASE, check, launch, newPage, finish } = require('./lib');

// ── Server (api/vote.js) with a fake Firestore ──
const docs = {};
const fakeAdmin = {
  apps: [1],
  firestore: () => ({
    doc: p => ({
      set: async (data, opts) => { docs[p] = opts?.merge ? { ...(docs[p] || {}), ...data } : data; },
      get: async () => ({ exists: !!docs[p], data: () => JSON.parse(JSON.stringify(docs[p])) }),
    }),
  }),
};
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'firebase-admin') return fakeAdmin;
  return realLoad.call(this, req, ...rest);
};
const api = require(path.join(__dirname, '..', 'api', 'vote.js'));
Module._load = realLoad;
const call = (method, { query = {}, body = {} } = {}) => new Promise(resolve => {
  let status = 200;
  api({ method, query, body, headers: {} }, { status (s) { status = s; return this; }, setHeader () {}, json (d) { resolve({ status, ...d }); return this; } });
});

(async () => {
  let r = await call('POST', { body: { action: 'create', host: 'Connie', options: [{ name: 'Only one' }] } });
  check(r.status === 400, 'a vote needs at least 2 spots');
  r = await call('POST', { body: { action: 'create', host: 'Connie', options: [
    { name: 'Nobu', cuisine: 'Japanese', rating: 4 }, { name: 'Pizzeria Bianco', cuisine: 'Pizza', rating: 5 }, { name: '<b>Taco</b> Spot', rating: 3 },
  ] } });
  const code = r.code;
  check(/^[A-Z0-9]{6}$/.test(code || ''), `a vote gets a short code (${code})`);
  r = await call('POST', { body: { action: 'vote', code, voter: { id: 'aaaaaaaa1111', name: 'Sam' }, yes: [0, 1, 99] } });
  check(r.yes.join() === '1,1,0' && r.winner === 1, 'votes are counted and a tie goes to the better-rated spot');
  r = await call('POST', { body: { action: 'vote', code, voter: { id: 'bbbbbbbb2222', name: 'Alex' }, yes: [0] } });
  check(r.winner === 0 && r.voters.join() === 'Sam,Alex', 'the most yes votes wins; everyone who voted is listed');
  r = await call('POST', { body: { action: 'vote', code, voter: { id: 'aaaaaaaa1111', name: 'Sam' }, yes: [2] } });
  check(r.voters.length === 2 && r.yes.join() === '1,0,1', 'voting again replaces your earlier vote');
  r = await call('GET', { query: { code } });
  check(r.status === 200 && r.options[2].name === '<b>Taco</b> Spot' && r.host === 'Connie', 'anyone with the code can see the vote');
  r = await call('GET', { query: { code: 'ZZZZZZ' } });
  check(r.status === 404, 'an unknown code says it was not found');
  docs[`dinnerVotes/${code}`].expiresAt = new Date(Date.now() - 1000).toISOString();
  r = await call('POST', { body: { action: 'vote', code, voter: { id: 'cccccccc3333', name: 'Late' }, yes: [0] } });
  check(r.status === 410 && r.closed, 'votes close after 3 days');

  // ── App: the host starts a vote ──
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    { id: 'w1', name: 'Nobu', cuisine: 'Japanese', status: 'want-to-try', tags: [], visits: [] },
    { id: 'v1', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 5, isFavorite: true, tags: [], visits: [] },
    { id: 'v2', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 4, tags: [], visits: [] },
  ] });
  await p.route(/wikimedia|overpass|nominatim/, rt => rt.abort());
  let created = null;
  await p.route('**/api/vote**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData());
      if (body.action === 'create') { created = body; return rt.fulfill({ json: { code: 'ABC234' } }); }
    }
    return rt.fulfill({ status: 404, json: { error: 'nope' } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); });
  check(/Dinner Vote/.test(await p.locator('#home-quick-rooms-btn').innerText({ timeout: 2000 }).catch(() => '') || await p.locator('#home-quick-rooms-btn').textContent()), 'the home quick action is called Dinner Vote');
  await p.click('#cub-buddy .cub-btn');
  await p.locator('#cub-buddy .cub-menu [data-act="vote"]').click();
  check(await p.locator('.dv-pick.on').count() === 3, 'the best 3 spots are picked to start');
  await p.locator('.dv-pick.on').first().click();
  check((await p.locator('#dv-start').innerText()) === 'Start the vote (2 spots)', 'tapping a spot unpicks it');
  const shared = await p.evaluate(async () => {
    let got = null;
    navigator.share = async d => { got = d; };
    await startDinnerVote();
    return got;
  });
  check(created?.options?.length === 2 && created.options.every(o => o.name), 'starting sends the picked spots');
  check(shared?.url === 'https://www.feed-the-bear.com/vote.html?v=ABC234', `the vote link is shared (${shared?.url})`);
  check(/See results/.test(await p.locator('#dv-recent').innerText()), 'your vote is listed to check results later');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  // ── vote.html: a friend votes without the app ──
  const f = await newPage(browser);
  let room = {
    code: 'ABC234', host: 'Connie', options: [{ name: 'Nobu', cuisine: 'Japanese', rating: 4 }, { name: '<img src=x onerror=window.__pwned=1>', rating: 5 }],
    yes: [0, 0], voters: [], winner: null, closed: false,
  };
  let sent = null;
  await f.route('**/api/vote**', async rt => {
    const req = rt.request();
    if (req.method() === 'POST') {
      sent = JSON.parse(req.postData());
      room = { ...room, yes: [sent.yes.includes(0) ? 1 : 0, sent.yes.includes(1) ? 1 : 0], voters: [sent.voter.name], winner: sent.yes.includes(0) ? 0 : null };
    }
    return rt.fulfill({ json: room });
  });
  await f.goto(`${BASE}/vote.html?v=ABC234`);
  await f.waitForTimeout(800);
  check(/Connie wants to know/.test(await f.locator('#vote-title').innerText()), 'the friend sees who is asking');
  check(await f.evaluate(() => window.__pwned) === undefined, 'spot names are shown as text, never run');
  await f.click('.vote-option >> nth=0 >> button.yes');
  await f.click('#vote-submit');
  check(/name first/.test(await f.locator('#vote-name').getAttribute('placeholder')), 'they are asked for their name first');
  await f.fill('#vote-name', 'Sam');
  await f.click('#vote-submit');
  await f.waitForTimeout(500);
  check(sent?.yes?.join() === '0' && sent.voter.name === 'Sam' && sent.voter.id.length >= 16, 'their yes votes are sent');
  check(/Nobu/.test(await f.locator('#vote-winner').innerText()) && /Voted so far: Sam/.test(await f.locator('#vote-voters').innerText()), 'they see the winner and who voted');
  check(await f.locator('.vote-promo a[href="app.html"]').isVisible(), 'the page invites them to get the app');
  await f.reload();
  await f.waitForTimeout(800);
  check(await f.locator('#vote-results').isVisible(), 'coming back shows the results, not the form');
  check(f.errors.length === 0, `no page errors on the vote page (${f.errors.slice(0, 2).join(' | ')})`);

  await browser.close();
  finish('vote');
})();
