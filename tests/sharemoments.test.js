// Share moments (Story card after a meal, monthly wrap card), who's been
// here + Go together, trip guides, the regulars' home order, and effects.
const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish, asGrizzly } = require('./lib');
asGrizzly(); // uses Grizzly-only features

const today = new Date();
const day = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const spot = (id, name, extra) => ({ id, name, cuisine: 'Mexican', status: 'visited', myRating: 4, tags: [], visits: [], dishes: [], dateAdded: day(40), ...extra });
const SEED = [
  spot('t', 'Tacos Chiwas', { address: '1923 E McDowell Rd, Phoenix, AZ', lat: 33.465, lng: -112.04, myRating: 5,
    visits: [{ date: day(0), rating: 5, note: '' }], dishes: [{ id: 'd', name: 'Birria', verdict: 'again', rating: 5, date: day(0) }] }),
  spot('p', 'Pizzeria Bianco', { cuisine: 'Pizza', address: '623 E Adams St, Phoenix, AZ', lat: 33.449, lng: -112.065, status: 'want-to-try', myRating: 0 }),
  spot('c', 'Lou Malnati\'s', { cuisine: 'Pizza', address: '439 N Wells St, Chicago, IL', lat: 41.89, lng: -87.634 }),
  spot('x1', 'Extra One', {}), spot('x2', 'Extra Two', {}),
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1800);
  await closeAllDialogs(p);
  await p.evaluate(() => followFriend(decodeProfileLink(encodeProfileLink({ id: 'sam1', u: 'Sam', w: [],
    picks: [{ n: 'Tacos Chiwas', r: 5, g: ['Birria'], a: 'Phoenix' }, { n: 'Bacanora', r: 5, g: ['Pollo asado'], a: '1301 Grand Ave, Phoenix' }] }))));
  await closeAllDialogs(p);

  // Bear Swipe stays at the top of home, however many spots you have.
  const order = await p.evaluate(() => {
    const top = id => { const el = document.getElementById(id); return el?.offsetParent ? el.getBoundingClientRect().top : 1e9; };
    return { pick: top('ai-rec-banner'), swipe: top('bear-swipe-home'), add: top('home-add-bar') };
  });
  check(order.swipe < order.add && order.swipe < order.pick, `Bear Swipe stays first on home (${JSON.stringify(order)})`);

  // Who's been here + Go together.
  await p.evaluate(() => openDetailModal('t'));
  await p.waitForTimeout(400);
  check(/Sam.*has been here/.test(await p.locator('#detail-friends').innerText()), "a spot shows which friends have been");
  const goText = await p.evaluate(async () => {
    let got = '';
    navigator.share = async d => { got = d.text; };
    document.querySelector('#detail-friends .df-go').click();
    await new Promise(r => setTimeout(r, 100));
    return got;
  });
  check(/^Sam, want to go to Tacos Chiwas together\?.*Birria/.test(goText), `Go together writes the invite (${goText})`);
  check(await p.locator('#detail-together-btn').isVisible(), 'every spot has Go with a friend');
  await closeAllDialogs(p);

  // Just Ate offers a Story card, which draws and opens.
  await p.click('#home-quick-justate-btn');
  await p.click('.ja-place[data-id="t"]');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await chooser.setFiles(path.join(ROOT, 'assets', 'food', 'tacos.jpg'));
  await p.waitForTimeout(700);
  await p.fill('#just-ate-dish', 'Quesabirria');
  await p.click('#just-ate-verdicts .yo-btn[data-verdict="again"]');
  await p.click('#just-ate-save');
  await p.waitForSelector('.share-nudge.in', { timeout: 5000 }).catch(() => {});
  check(await p.locator('.share-nudge.in').isVisible(), 'after logging a meal: Share this meal?');
  await p.click('.share-nudge .sn-go');
  await p.waitForSelector('#story-card-overlay:not(.hidden) .story-img[src]', { timeout: 6000 }).catch(() => {});
  const meal = await p.evaluate(() => {
    const img = document.querySelector('#story-card-overlay .story-img');
    return { open: !document.getElementById('story-card-overlay').classList.contains('hidden'), w: img.naturalWidth, h: img.naturalHeight, alt: img.alt };
  });
  check(meal.open && meal.w === 1080 && meal.h === 1920, `a 1080×1920 Story card is made (${JSON.stringify(meal)})`);
  check(meal.alt === 'Quesabirria', 'for the dish just logged');
  await p.evaluate(() => StoryCard.close());

  // Monthly wrap card.
  const wrap = await p.evaluate(async () => { const s = wrapStats(0); _wrapOffset = 0; await shareWrap(); return { meals: s.meals, best: s.bestDish?.x.name, alt: document.querySelector('#story-card-overlay .story-img').alt }; });
  check(wrap.meals >= 2 && wrap.best && wrap.alt === 'My month in food', `monthly wrap becomes a Story card (${JSON.stringify(wrap)})`);
  await p.evaluate(() => StoryCard.close());

  // Trip guide inside Travel Mode.
  await p.evaluate(() => { openTravelMode(); _saveTravelMode('Phoenix, AZ', 33.4484, -112.074); _refreshTravelUI(); });
  await p.waitForTimeout(200);
  const guide = (await p.locator('#travel-guide').innerText()).replace(/\s+/g, ' ');
  check(/Your Phoenix food guide/.test(guide) && /Tacos Chiwas/.test(guide) && /Pizzeria Bianco/.test(guide), `Phoenix guide lists your spots (${guide.slice(0, 120)})`);
  check(!/Lou Malnati/.test(guide), 'and not the Chicago one');
  check(/FRIENDS' PICKS.*Bacanora/i.test(guide), "plus friends' picks you haven't saved");
  await p.click('.tg-share');
  await p.waitForSelector('#story-card-overlay:not(.hidden)', { timeout: 6000 }).catch(() => {});
  check(await p.evaluate(() => document.querySelector('#story-card-overlay .story-img').alt) === 'Phoenix', 'the guide shares as a Story card');
  await p.evaluate(() => { StoryCard.close(); localStorage.removeItem('ftb_travel_v1'); });
  await closeAllDialogs(p);

  // Effects: counts pop when they change; a favorite bursts.
  await p.evaluate(() => { state.restaurants.push({ id: 'n', name: 'New One', status: 'want-to-try', tags: [], visits: [], dishes: [] }); renderAll(); });
  check(await p.evaluate(() => document.getElementById('stat-total').classList.contains('stat-pop')), 'header count pops when it changes');
  await p.evaluate(() => setView('stats'));
  check(await p.evaluate(() => document.getElementById('main-content').classList.contains('view-enter') && state.currentView === 'stats'), 'switching views animates, and switches right away');
  await p.evaluate(() => setView('all'));
  await p.locator('.restaurant-card .card-favorite-btn:not(.active)').first().click();
  check(await p.locator('.particle').count() > 0, 'favoriting bursts');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('sharemoments');
})();
