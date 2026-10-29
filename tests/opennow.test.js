// "Open right now" on the home screen, and no passport party for stamps you already had.
const { BASE, check, launch, newPage, finish } = require('./lib');

const ALWAYS = [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: { day, hour: 0, minute: 0 }, close: { day, hour: 23, minute: 59 } }));
const NEVER_NOW = (() => {
  // Open for one hour, 12 hours from now: closed at test time.
  const d = new Date(Date.now() + 12 * 3600000);
  return [{ open: { day: d.getDay(), hour: d.getHours(), minute: 0 }, close: { day: d.getDay(), hour: d.getHours(), minute: 59 } }];
})();
const spot = (id, name, extra) => ({ id, name, cuisine: 'Mexican', status: 'visited', myRating: 3, tags: [], visits: [], dishes: [], ...extra });
const SEED = [
  spot('a', 'Plain Open', { periods: ALWAYS }),
  spot('b', 'Crave Open', { status: 'want-to-try', periods: ALWAYS, dishes: [{ id: 'd', name: 'Birria', verdict: 'want' }] }),
  spot('c', 'Closed Now', { status: 'want-to-try', periods: NEVER_NOW }),
  spot('d', 'No Hours', { status: 'want-to-try' }),
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim|place-info/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);

  check(await p.locator('#open-now-home').isVisible(), 'home shows Open right now');
  const names = await p.$$eval('#open-now-home-list .onc-name', els => els.map(e => e.textContent));
  check(names.length === 2, `only spots open right now (${names})`);
  check(names[0].includes('Crave Open'), `a spot with a craving comes first (${names[0]})`);
  check((await p.locator('#open-now-home-list .open-now-card').first().innerText()).includes('Craving: Birria'), 'and says what you are craving');
  await p.locator('#open-now-home-list .open-now-card').first().click();
  check(await p.evaluate(() => state.detailId) === 'b', 'tapping opens the spot');

  // Passport (drawn with Stats): a fresh install with old visits gets no confetti or toast.
  await p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); renderPassport(); });
  await p.waitForTimeout(300);
  const toasts = await p.$$eval('.toast', els => els.map(e => e.textContent).join(' | '));
  check(!toasts.includes('Passport Stamped'), `no Passport Stamped on first load (${toasts})`);
  check(await p.evaluate(() => state.settings.passportUnlocked.includes('mexican')), 'existing stamps are recorded quietly');
  // A genuinely new cuisine still celebrates.
  await p.evaluate(() => { state.restaurants.push({ id: 'z', name: 'Thai Basil', cuisine: 'Thai', status: 'visited', tags: [], visits: [], dishes: [] }); renderPassport(); });
  await p.waitForTimeout(300);
  check((await p.$$eval('.toast', els => els.map(e => e.textContent).join(' '))).includes('Passport Stamped'), 'a new cuisine still gets its stamp');
  // Swipe to Decide: real photo when there is one, open status always.
  await p.evaluate(() => {
    closeDetailModal();
    state.restaurants.forEach(r => { if (r.status === 'want-to-try') r.photo = r.id === 'b' ? 'https://images.example.com/birria.jpg' : ''; });
    openSwipeDeck();
  });
  await p.waitForTimeout(300);
  const cards = await p.$$eval('#swipe-deck .swipe-card-item', els => els.map(e => ({ name: e.querySelector('.swipe-card-name').textContent, img: !!e.querySelector('.swipe-card-photo img'), open: e.querySelector('.swipe-card-open')?.textContent || '' })));
  const crave = cards.find(c => c.name === 'Crave Open');
  const noPhoto = cards.find(c => c.name === 'No Hours');
  // In the last hour of the day it says "Closes soon", which is still open.
  check(crave && crave.img && /^(Open|Closes soon)/.test(crave.open), `swipe card shows the photo and Open (${JSON.stringify(crave)})`);
  check(noPhoto && !noPhoto.img && !noPhoto.open, 'no photo, no hours: emoji card with no made-up status');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();

  // Nothing open: the card stays out of the way.
  const b2 = await launch();
  const q = await newPage(b2, { seed: [SEED[2], SEED[3]] });
  await q.route(/overpass|nominatim|place-info/, r => r.abort());
  await q.goto(`${BASE}/app.html`);
  await q.waitForTimeout(1200);
  check(await q.locator('#open-now-home').isHidden(), 'hidden when nothing saved is open');
  await b2.close();
  finish('opennow');
})();
