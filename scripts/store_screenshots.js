// Store screenshots from the real app with sample data.
//   node scripts/store_screenshots.js [baseUrl]
// Writes store/screenshots/ios-6.9/*.png (1290x2796) and store/screenshots/android/*.png (1080x1920).
// Needs the test deps: cd tests && npm install. Uses Edge (PW_CHANNEL) like the tests.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'tests', 'node_modules', 'playwright-core'));

const BASE = process.argv[2] || 'http://127.0.0.1:8765';
const OUT = path.join(__dirname, '..', 'store', 'screenshots');
const DEVICES = [
  { dir: 'ios-6.9', width: 430, height: 932, scale: 3 },
  { dir: 'android', width: 360, height: 640, scale: 3 },
];

const day = n => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Made-up restaurants and addresses: store screenshots shouldn't feature real businesses.
// Open 7 AM to 10 PM every day, so "Open · closes 10 PM" when shot during the day.
const OPEN = [0, 1, 2, 3, 4, 5, 6].map(d => ({ open: { day: d, hour: 7, minute: 0 }, close: { day: d, hour: 22, minute: 0 } }));
const HOURS = ['Monday: 7:00 AM – 10:00 PM', 'Tuesday: 7:00 AM – 10:00 PM', 'Wednesday: 7:00 AM – 10:00 PM', 'Thursday: 7:00 AM – 10:00 PM', 'Friday: 7:00 AM – 10:00 PM', 'Saturday: 7:00 AM – 10:00 PM', 'Sunday: 7:00 AM – 10:00 PM'];
const spot = (id, name, cuisine, extra = {}) => ({
  id, name, cuisine, status: 'want-to-try', myRating: 0, tags: [], visits: [], dishes: [], dateAdded: day(20),
  priceRange: 2, googleRating: 4.6, googleReviews: 1800, placeInfoAt: Date.now(), periods: OPEN, hours: HOURS, ...extra,
});
const SPOTS = [
  spot('s1', 'Casa Birria', 'Mexican', { status: 'visited', myRating: 5, isFavorite: true, dateVisited: day(2), googleRating: 4.7, googleReviews: 3120,
    visits: [{ date: day(2), rating: 5, note: 'Birria night' }], dishes: [{ id: 'd1', name: 'Birria', verdict: 'again', rating: 5, date: day(2) }, { id: 'd2', name: 'Horchata', verdict: 'ok', date: day(2) }],
    address: '120 Main St' }),
  spot('s2', 'Brick Oven Pie Co.', 'Pizza', { dishes: [{ id: 'd3', name: 'Pepperoni pizza', verdict: 'want', date: day(5) }], googleRating: 4.4, googleReviews: 2210, address: '48 Elm Ave' }),
  spot('s3', 'Smokestack BBQ', 'BBQ', { status: 'visited', myRating: 5, dateVisited: day(9), visits: [{ date: day(9), rating: 5 }], dishes: [{ id: 'd4', name: 'Brisket', verdict: 'again', rating: 5, date: day(9) }], googleRating: 4.8, googleReviews: 4130, address: '9 Depot Rd' }),
  spot('s4', 'Pho Real', 'Vietnamese', { dishes: [{ id: 'd5', name: 'Pho', verdict: 'want', date: day(3) }], googleRating: 4.5, address: '310 Oak St' }),
  spot('s5', 'Stack Burger', 'Burgers', { status: 'visited', myRating: 4, dateVisited: day(14), visits: [{ date: day(14), rating: 4 }], dishes: [{ id: 'd6', name: 'Cheeseburger', verdict: 'again', date: day(14) }], googleRating: 4.3 }),
  spot('s6', 'Kumo Sushi', 'Japanese', { priceRange: 4, googleRating: 4.5 }),
];
const FRIENDS = [
  { key: 'id:sam', name: 'Sam', av: 'panda', data: { id: 'sam', u: 'Sam', picks: [], w: [] }, recent: [
    { k: 'dish', n: 'La Esquina', c: 'Mexican', d: 'Carne asada', at: day(0) },
    { k: 'visit', n: 'Golden Wok', c: 'Chinese', r: 5, at: day(1) },
  ] },
  { key: 'id:jo', name: 'Jo', av: 'bear-crown', data: { id: 'jo', u: 'Jo', picks: [], w: [] }, recent: [
    { k: 'save', n: 'Thai Orchid', c: 'Thai', at: day(1) },
    { k: 'dish', n: 'Smokestack BBQ', c: 'BBQ', d: 'Brisket', at: day(3) },
  ] },
];

async function shoot (browser, dev) {
  const dir = path.join(OUT, dev.dir);
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: dev.width, height: dev.height }, deviceScaleFactor: dev.scale, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([spots, friends]) => {
    localStorage.setItem('ftb_onboarded_v1', '1');
    localStorage.setItem('ftb_restaurants_v2', JSON.stringify(spots));
    localStorage.setItem('ftb_friends_v1', JSON.stringify(friends));
    localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie', avatar: 'bear-chef' }));
    localStorage.setItem('ftb_user_profile_v1', JSON.stringify({ name: 'Connie', avatar: 'bear-chef' }));
    localStorage.setItem('ftb_save_nudge_v1', JSON.stringify({ at: Date.now(), dismissed: 3 }));
    localStorage.setItem('ftb_grizzly_card_snooze', String(Date.now() + 864e5));
  }, [SPOTS, FRIENDS]);
  const p = await ctx.newPage();
  await p.route(/overpass|nominatim|place-info/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(3000);
  const clean = () => p.evaluate(() => {
    document.querySelectorAll('.cub-welcome, .toast, #save-diary-nudge, .proximity-alert, .cub-bubble').forEach(e => e.classList.add('hidden'));
    document.querySelectorAll('img[loading="lazy"]').forEach(i => { i.loading = 'eager'; });
  });
  const snap = async name => { await clean(); await p.waitForTimeout(1500); await p.screenshot({ path: path.join(dir, name) }); };

  // 1. Home: open right now, crave list, friends.
  await snap('1-home.png');
  // 2. A spot: Google rating, open now, hours, your order.
  await p.evaluate(() => openDetailModal('s1'));
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#detail-hours details')?.setAttribute('open', ''));
  await snap('2-spot.png');
  await p.evaluate(() => closeDetailModal());
  // 3. Friends' feed.
  await clean();
  await p.locator('#friends-feed-home').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await snap('3-friends.png');
  // 4. Swipe to decide.
  await p.evaluate(() => { document.getElementById('home-quick-actions')?.scrollIntoView({ block: 'start' }); openSwipeDeck(); });
  await snap('4-swipe.png');
  await p.evaluate(() => closeSwipeDeck());
  // 5. Discover & Play.
  await p.evaluate(() => openMobileHub());
  await p.waitForTimeout(1500);
  await snap('5-play.png');
  await ctx.close();
  console.log(`${dev.dir}: 5 screenshots`);
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
  for (const dev of DEVICES) await shoot(browser, dev);
  await browser.close();
})();
