// Best bet (you + friends on what to order), the passport's Explorer section,
// and Decision Mode's context: open hours, recent visits, eating with friends.
const { BASE, check, launch, newPage, closeAllDialogs, finish, asGrizzly } = require('./lib');
asGrizzly(); // uses Grizzly-only features

const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const ALWAYS = [0, 1, 2, 3, 4, 5, 6].map(d => ({ open: { day: d, hour: 0, minute: 0 }, close: { day: d, hour: 23, minute: 59 } }));
const CLOSED_NOW = (() => {
  const d = new Date(Date.now() + 12 * 3600000);
  return [{ open: { day: d.getDay(), hour: d.getHours(), minute: 0 }, close: { day: d.getDay(), hour: d.getHours(), minute: 59 } }];
})();
const spot = (id, name, extra) => ({ id, name, cuisine: 'Mexican', status: 'visited', myRating: 3, tags: [], visits: [], dishes: [], dateAdded: day(60), ...extra });
const SEED = [
  spot('tac', 'Tacos Chiwas', { status: 'want-to-try', myRating: 0 }),
  spot('piz', 'Pizzeria Bianco', { cuisine: 'Pizza', dishes: [{ id: 'p1', name: 'Rosa pizza', verdict: 'again' }, { id: 'p2', name: 'Salad', verdict: 'skip' }] }),
  spot('new1', 'Week One', { cuisine: 'Thai', dateVisited: day(0) }),
  spot('new2', 'Week Two', { cuisine: 'Thai', dateVisited: day(7) }),
  spot('eth', 'Queen of Sheba', { cuisine: 'Ethiopian', status: 'want-to-try', myRating: 0 }),
  spot('shut', 'Closed Diner', { status: 'want-to-try', myRating: 5, periods: CLOSED_NOW }),
  spot('just', 'Went Yesterday', { myRating: 4, dateVisited: day(1), periods: ALWAYS }),
  spot('open', 'Always Open', { myRating: 4, periods: ALWAYS }),
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);

  // Follow Sam, who has been to both spots.
  await p.evaluate(() => {
    const sam = { id: 'sam', u: 'Sam', picks: [
      { n: 'Tacos Chiwas', r: 5, g: ['Birria quesatacos', 'Elote'], s: ['Horchata'] },
      { n: 'Pizzeria Bianco', r: 4, g: ['Rosa pizza'], s: [] },
    ], w: [{ d: 'Doro wat', at: 'Queen of Sheba' }] };
    followFriend(decodeProfileLink(encodeProfileLink(sam)));
    renderAll();
  });

  // Best bet on a spot you've never ordered at: all from Sam.
  await p.evaluate(() => openDetailModal('tac'));
  await p.waitForTimeout(300);
  const bet = (await p.locator('#yo-best-bet').innerText()).replace(/\s+/g, ' ');
  check(/BEST BET Birria quesatacos Sam/i.test(bet), `best bet is the friend's pick (${bet})`);
  check(/Also good: Elote/.test(bet) && /skip the Horchata \(Sam\)/.test(bet), 'shows also-good and a skip warning');
  await closeAllDialogs(p);

  // You and Sam agree: both named.
  await p.evaluate(() => openDetailModal('piz'));
  await p.waitForTimeout(300);
  const agree = (await p.locator('#yo-best-bet').innerText()).replace(/\s+/g, ' ');
  check(/Rosa pizza you \+ Sam/.test(agree) && /skip the Salad \(you\)/.test(agree), `your verdict and the friend's combine (${agree})`);
  await closeAllDialogs(p);

  const tacCard = await p.evaluate(() => cardOrderLine(state.restaurants.find(r => r.id === 'tac')));
  check(/Friends<\/span> Birria quesatacos/.test(tacCard), 'list card falls back to the friends pick');

  // Passport: want-to-try spots don't earn stamps; Explorer streak and next stamp.
  await p.evaluate(() => openPassport());
  await p.waitForTimeout(300);
  const stamps = await p.$$eval('#passport-stamps .passport-stamp.earned .passport-stamp-name', es => es.map(e => e.textContent));
  check(!stamps.includes('Ethiopian'), `want-to-try cuisine is not stamped (${stamps})`);
  const explorer = (await p.locator('#passport-explorer').innerText()).replace(/\s+/g, ' ');
  check(/2 weeks in a row trying somewhere new/.test(explorer), `explorer streak counts consecutive weeks (${explorer})`);
  check(/Ethiopian: Queen of Sheba is on your list/.test(explorer), 'next stamp points at a saved spot of a missing cuisine');
  await p.click('#pe-next-btn');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => state.detailId) === 'eth', 'next stamp button opens that spot');
  await closeAllDialogs(p);

  // Decision Mode: context line, eating with Sam, closed and just-visited spots sink.
  await p.evaluate(() => { openDecisionMode(); setDecisionModeConstraint('miles', 25); });
  await p.waitForTimeout(200);
  check(/(breakfast|lunch|dinner|late-night bite)/.test(await p.locator('#decision-mode-context').innerText()), 'context line names the meal');
  check(await p.locator('#decision-mode-with').isVisible(), 'Eating with lists followed friends');
  await p.click('#decision-with-chips .decision-chip');
  check(await p.evaluate(() => _decisionModeState.with.length === 1 && _decisionModeState.party === 2), 'picking a friend sets party size');
  await p.click('#decision-mode-run-btn');
  await p.waitForTimeout(300);
  const ranked = await p.$$eval('.decision-result-name', es => es.map(e => e.textContent));
  check(!ranked.includes('Closed Diner'), `closed spot left out (${ranked})`);
  check(!ranked.includes('Went Yesterday') || ranked.indexOf('Went Yesterday') > ranked.indexOf('Always Open'), `yesterday's spot ranks below a fresh one (${ranked})`);
  const fit = await p.evaluate(() => {
    const keys = _decisionModeState.with;
    const by = id => companionFit(state.restaurants.find(r => r.id === id), keys);
    return { tac: by('tac').score, eth: by('eth').score, open: by('open').score, ethWhy: by('eth').reason };
  });
  check(fit.tac > 0 && fit.eth > 0 && fit.open === 0, `spots Sam loves or wants score higher (${JSON.stringify(fit)})`);
  check(fit.ethWhy === 'Sam wants to try the Doro wat', `and say why (${fit.ethWhy})`);
  const why = await p.$$eval('.decision-result-why', es => es.map(e => e.innerText).join(' | '));
  check(/Sam/.test(why), `a reason cites Sam (${why})`);

  // Hand the top 3 to a group vote.
  await p.click('.decision-vote-btn');
  await p.waitForTimeout(400);
  check(await p.locator('#dinner-rooms-overlay').isVisible(), 'vote button opens Dinner Vote');
  const picked = await p.$$eval('.dv-pick.on .dv-name', es => es.map(e => e.textContent));
  check(picked.length === ranked.length && ranked.every(n => picked.includes(n)), `top picks are pre-selected (${picked})`);

  check(!p.errors.length, `no page errors (${p.errors.join(' | ')})`);
  await browser.close();
  finish('foodie');
})();
