// Bug fix + three features: friend want-to-try is never a recommendation,
// mood picks (adventurous / late-night), Cook it at home, Never again list.
// - buildProfileData picks only include visited spots (a want-to-try spot with
//   stars is NOT a recommendation); the save note says "wants to try".
// - Home Mood Picks has Adventurous + Late night chips that filter spots and
//   surface each spot's top dish.
// - Cook it at home: the cook button only shows on loved dishes; a free user
//   without AI access gets the Grizzly upsell (AI is a Grizzly perk).
// - Never again: 1-2 star dishes collect in the leaderboard with a Remove
//   that takes the dish off the list.
const { BASE, check, launch, newPage, finish } = require('./lib');

const seed = () => ([
  { id: 'sA', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1,
    dishes: [{ id: 'd1', name: 'Green Chile Burrito', verdict: 'again', rating: 5, note: 'extra spicy', date: '2026-11-10' }] },
  { id: 'sB', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'want-to-try', myRating: 4, tags: [], visits: [], dateAdded: '2026-11-09', updatedAt: 1, dishes: [] },
  { id: 'sC', name: 'Burger Joint', cuisine: 'American', status: 'visited', myRating: 2, tags: [], visits: [], dateAdded: '2026-11-02', updatedAt: 1,
    dishes: [{ id: 'd3', name: 'Soggy Fries', verdict: 'skip', rating: 1, note: 'cold', date: '2026-11-10' }] },
  { id: 'sD', name: 'Bangkok Thai', cuisine: 'Thai', status: 'visited', myRating: 4, tags: [], visits: [], dateAdded: '2026-11-03', updatedAt: 1, dishes: [] },
]);

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: seed() });
  await p.route(/overpass|nominatim|place-info/, r => r.abort());
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

  // ── 1. Bug fix: want-to-try is never a recommendation ──
  const picks = await p.evaluate(() => buildProfileData().picks.map(x => x.n));
  check(picks.includes('Taqueria Uno'), 'picks include the visited 5-star spot');
  check(!picks.includes('Pizzeria Bianco'), 'picks exclude the want-to-try spot even though it has 4 stars');
  check(await p.evaluate(() => friendNoteFor({ k: 'save' }, 'Sam') === 'Sam wants to try it.'), 'save note says wants to try');
  check(await p.evaluate(() => friendNoteFor({ k: 'dish' }, 'Sam') === 'Sam recommended it.'), 'dish note says recommended');
  check(await p.evaluate(() => friendNoteFor({ r: 2 }, 'Sam') === 'Sam ate there.'), 'low-rated visit note says ate there, not recommended');

  // ── 2. Mood picks: Adventurous + Late night in Tonight's Pick ──
  // (The home Mood Picks section is hidden by the Lean Home design, so the
  // visible mood picker is Tonight's Pick.)
  await p.evaluate(() => showTonightsPick());
  await p.waitForFunction(() => !document.getElementById('tonight-overlay')?.classList.contains('hidden'));
  check(await p.evaluate(() => !!document.querySelector('#tonight-moods .mood-chip[data-mood="adventurous"]')), 'Tonight mood picker has Adventurous');
  check(await p.evaluate(() => !!document.querySelector('#tonight-moods .mood-chip[data-mood="late-night"]')), 'Tonight mood picker has Late night');
  await p.click('#tonight-moods .mood-chip[data-mood="adventurous"]');
  await p.click('#tonight-pick-btn');
  await p.waitForFunction(() => !document.getElementById('tonight-result')?.classList.contains('hidden') && document.getElementById('tonight-result').textContent.trim().length > 0);
  check(await p.evaluate(() => document.getElementById('tonight-result').textContent.includes('Bangkok Thai')), 'Adventurous pick surfaces the Thai spot');
  check(await p.evaluate(() => !!document.querySelector('.home-mood-chip[data-mood="adventurous"]') && !!document.querySelector('.home-mood-chip[data-mood="late-night"]')), 'Home mood chips include Adventurous and Late night');

  // ── 3. Cook it at home: button only on loved dishes; free user gets the upsell ──
  await p.evaluate(() => openDishTracker('sA'));
  await p.waitForFunction(() => document.querySelector('#dish-list .dish-item'));
  check(await p.evaluate(() => {
    const items = [...document.querySelectorAll('#dish-list .dish-item')];
    const loved = items.find(el => el.textContent.includes('Green Chile Burrito'));
    return !!loved && !!loved.querySelector('.dish-item-cook');
  }), 'loved dish has a Cook it at home button');
  await p.evaluate(() => closeDishTracker());
  await p.evaluate(() => openDishTracker('sC'));
  await p.waitForFunction(() => document.querySelector('#dish-list .dish-item'));
  check(await p.evaluate(() => {
    const items = [...document.querySelectorAll('#dish-list .dish-item')];
    const skipped = items.find(el => el.textContent.includes('Soggy Fries'));
    return !!skipped && !skipped.querySelector('.dish-item-cook');
  }), 'skipped dish has no Cook it at home button');
  await p.evaluate(() => closeDishTracker());
  await p.evaluate(() => openDishTracker('sA'));
  await p.waitForFunction(() => document.querySelector('#dish-list .dish-item-cook'));
  await p.click('#dish-list .dish-item-cook');
  await p.waitForFunction(() => !document.getElementById('upgrade-overlay')?.classList.contains('hidden'));
  check(await p.evaluate(() => !document.getElementById('upgrade-overlay')?.classList.contains('hidden')), 'free user without AI access gets the Grizzly upsell for a recipe');
  await p.evaluate(() => document.getElementById('upgrade-overlay')?.classList.add('hidden'));
  await p.evaluate(() => closeDishTracker());

  // ── 4. Never again: skipped dishes collect, Remove takes one off ──
  await p.evaluate(() => openDishLeaderboard());
  await p.waitForFunction(() => document.querySelector('.dish-board-never'));
  check(await p.evaluate(() => {
    const el = document.querySelector('.dish-board-never');
    return !!el && el.textContent.includes('Soggy Fries') && el.textContent.includes('Burger Joint') && el.textContent.includes('★');
  }), 'Never again lists the skipped dish with spot and stars');
  await p.click('.dish-board-never-remove');
  await p.waitForFunction(() => !document.querySelector('.dish-board-never'));
  check(await p.evaluate(() => !document.querySelector('.dish-board-never')), 'Remove takes the dish off the Never again list');
  check(await p.evaluate(() => {
    const r = state.restaurants.find(x => x.id === 'sC');
    const d = r.dishes.find(x => x.name === 'Soggy Fries');
    return !!d && d.verdict === 'ok';
  }), 'removed dish is kept, just un-skipped');

  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('mood-recipe-never');
})();
