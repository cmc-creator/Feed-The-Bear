// Dish-level ratings: rate the dish, not just the place.
// - Spot view highlights the top-rated dish ("Order this again") and flags
//   low-rated dishes ("Skip this").
// - Dish Tracker adds a dish with stars + a note, and badges the top/skip dishes.
// - "I just ate" rates the dish with the same stars (stars decide the verdict
//   when no verdict button was tapped), and dishes never count as spots.
const { BASE, check, launch, newPage, finish } = require('./lib');

const spot = () => ({
  id: 's0', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'visited',
  myRating: 5, tags: [], visits: [], updatedAt: 1,
  dishes: [
    { id: 'd1', name: 'Green Chile Burrito', verdict: 'again', rating: 5, note: 'extra spicy, ask for no onions', date: '2026-11-10' },
    { id: 'd2', name: 'Soggy Fries', verdict: 'skip', rating: 1, note: '', date: '2026-11-10' },
    { id: 'd3', name: 'House Salad', verdict: 'ok', rating: 3, note: '', date: '2026-11-10' },
  ],
});

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [spot()] });
  await p.route(/overpass|nominatim|place-info/, r => r.abort());
  // The Firebase CDN is blocked in this sandbox; stub the SDK so init
  // succeeds instead of logging a console error (guest mode needs no auth).
  await p.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
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
        doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), set: async () => {} }),
        collection: () => ({ get: async () => ({ docs: [] }) }),
        batch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
      }),
    };
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);

  // ── 1. Spot view: top dish highlighted, low dish flagged ──
  await p.evaluate(() => openDetailModal('s0'));
  await p.waitForFunction(() => document.querySelector('.yo-top-dish'));
  check(await p.evaluate(() => document.querySelector('.yo-top-dish')?.textContent.includes('Green Chile Burrito')), 'spot view highlights the top-rated dish');
  check(await p.evaluate(() => document.querySelector('.yo-top-dish')?.textContent.includes('Order this again')), 'top dish is labelled Order this again');
  check(await p.evaluate(() => document.querySelector('.yo-group-skip')?.textContent.includes('Soggy Fries')), 'low-rated dish is flagged in the Skip group');

  // ── 2. Dish Tracker: add a dish with stars + note ──
  await p.evaluate(() => openDishTracker('s0'));
  check(await p.evaluate(() => document.querySelector('.dish-badge-again')?.textContent.includes('Order again')), 'tracker badges the top dish Order again');
  check(await p.evaluate(() => document.querySelector('.dish-badge-skip')?.textContent.includes('Skip this')), 'tracker flags the low dish Skip this');
  check(await p.evaluate(() => document.getElementById('dish-list')?.textContent.includes('extra spicy')), 'tracker shows the dish note');
  await p.fill('#dish-name-input', 'Truffle Pasta');
  await p.click('#dish-rating-picker .spm[data-v="4"]');
  await p.fill('#dish-note-input', 'ask for extra parmesan');
  await p.click('#dish-add-btn');
  await p.waitForFunction(() => document.getElementById('dish-list').textContent.includes('Truffle Pasta'));
  check(await p.evaluate(() => {
    const items = [...document.querySelectorAll('#dish-list .dish-item')];
    const t = items.find(el => el.textContent.includes('Truffle Pasta'));
    return !!t && t.textContent.includes('ask for extra parmesan') && (t.querySelector('.dish-item-stars')?.textContent || '').includes('★★★★');
  }), 'tracker saves the new dish with stars and note');
  await p.evaluate(() => closeDishTracker());

  // ── 3. "I just ate": stars rate the dish (no verdict tap) ──
  await p.evaluate(() => openJustAte('s0'));
  await p.fill('#just-ate-dish', 'Churros');
  await p.click('#just-ate-stars .ja-star[data-n="2"]');
  await p.waitForFunction(() => !document.getElementById('just-ate-save').disabled);
  await p.click('#just-ate-save');
  await p.waitForFunction(() => state.restaurants.find(r => r.id === 's0')?.dishes.some(d => d.name === 'Churros'));
  check(await p.evaluate(() => {
    const d = state.restaurants.find(r => r.id === 's0').dishes.find(x => x.name === 'Churros');
    return d && d.rating === 2 && d.verdict === 'skip';
  }), 'Just Ate 2 stars rates the dish and marks it Skip');
  check(await p.evaluate(() => state.restaurants.length === 1), 'rating a dish does not create a new spot');

  // ── 4. "I just ate": 5 stars marks the dish Order again ──
  await p.evaluate(() => openJustAte('s0'));
  await p.fill('#just-ate-dish', 'Tres Leches');
  await p.click('#just-ate-stars .ja-star[data-n="5"]');
  await p.waitForFunction(() => !document.getElementById('just-ate-save').disabled);
  await p.click('#just-ate-save');
  await p.waitForFunction(() => state.restaurants.find(r => r.id === 's0')?.dishes.some(d => d.name === 'Tres Leches'));
  check(await p.evaluate(() => {
    const d = state.restaurants.find(r => r.id === 's0').dishes.find(x => x.name === 'Tres Leches');
    return d && d.rating === 5 && d.verdict === 'again';
  }), 'Just Ate 5 stars rates the dish and marks it Order again');

  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('dish-ratings');
})();
