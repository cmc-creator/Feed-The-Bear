// Search shows matches right under the bar, and the phone's Back button
// closes what is open (panel, tab, search) instead of leaving the app.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    { id: 'a', name: 'Nobu', cuisine: 'Japanese', status: 'want-to-try', tags: [], visits: [], dishes: [{ id: 'd1', name: 'Black cod miso', verdict: 'again' }] },
    { id: 'b', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'visited', myRating: 5, tags: [], visits: [] },
    { id: 'c', name: 'Ramen Kagawa', cuisine: 'Japanese', status: 'visited', myRating: 4, tags: [], visits: [] },
    { id: 'd', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [] },
  ] });
  await p.route(/wikimedia|overpass|nominatim/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const back = async () => { await p.evaluate(() => history.back()); await p.waitForTimeout(400); };
  const onApp = () => /app\.html/.test(p.url());

  // ── Search ──
  await p.click('#search-input');
  await p.keyboard.type('ramen', { delay: 30 });
  await p.waitForTimeout(500);
  const firstCard = await p.locator('.restaurant-card[data-id]:visible').first().boundingBox();
  check(firstCard && firstCard.y < 500, `the match shows right under the search bar (${firstCard && Math.round(firstCard.y)}px down)`);
  check(await p.locator('#home-discovery').isHidden(), 'home sections step aside while searching');
  check(/1 spot match/.test(await p.locator('#search-summary').innerText()), 'it says how many spots match');
  await p.fill('#search-input', 'miso');
  await p.waitForTimeout(400);
  check(await p.$$eval('.restaurant-card[data-id]', els => els.filter(e => e.offsetHeight).map(e => e.dataset.id).join()) === 'a', 'a dish name finds its spot');
  await back();
  check(onApp() && (await p.inputValue('#search-input')) === '' && await p.locator('#home-discovery').isVisible(), 'Back clears the search and shows home again');
  await p.fill('#search-input', 'zzzz');
  await p.waitForTimeout(400);
  check(/Nothing matches/.test(await p.locator('#search-summary').innerText()) && await p.locator('#search-summary [data-act=nearby]').isVisible(), 'no matches offers to search nearby');
  await p.click('#search-summary [data-act=clear]');
  await p.waitForTimeout(300);
  check(await p.evaluate(() => BackNav.depth()) === 0 && await p.locator('#search-summary').count() === 0, 'Clear tidies up without leaving a Back step behind');

  // ── Panels ──
  await p.evaluate(() => openDetailModal('b'));
  await p.waitForTimeout(300);
  await back();
  check(onApp() && await p.locator('#detail-overlay').isHidden(), 'Back closes a spot instead of leaving the app');
  await p.evaluate(() => openAccountModal());
  await p.waitForTimeout(200);
  await p.click('#account-close-btn');
  await p.waitForTimeout(400);
  check(await p.evaluate(() => BackNav.depth()) === 0, 'closing with ✕ leaves no extra Back step');

  // ── Tabs, then a panel on top ──
  await p.evaluate(() => setView('want-to-try'));
  await p.waitForTimeout(200);
  await p.evaluate(() => openDetailModal('a'));
  await p.waitForTimeout(300);
  await back();
  check(await p.locator('#detail-overlay').isHidden() && await p.evaluate(() => state.currentView) === 'want-to-try', 'Back closes the top thing first');
  await back();
  check(onApp() && await p.evaluate(() => state.currentView) === 'all', 'then Back returns to Home');
  check(await p.evaluate(() => BackNav.depth()) === 0, 'at Home with nothing open, the next Back leaves as usual');

  // Several panels closing at once must never step back out of the app.
  await p.evaluate(() => { setView('visited'); openAccountModal(); openDetailModal('b'); window.Cub.openAdd(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    document.querySelectorAll('.modal-overlay').forEach(e => e.classList.add('hidden'));
    setView('all');
  });
  await p.waitForTimeout(800);
  check(onApp() && await p.evaluate(() => BackNav.depth() === 0 && !history.state?.ftbBack), 'closing many panels at once stays in the app and cleans up its Back step');

  // The Cub's quick add sheet (added to the page later) also closes on Back.
  await p.evaluate(() => window.Cub.openAdd());
  await p.waitForTimeout(300);
  await back();
  check(onApp() && await p.locator('#quick-add-overlay').isHidden(), 'Back closes Add a spot');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  await browser.close();
  finish('back');
})();
