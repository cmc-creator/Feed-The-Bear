const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');
const panels = [
  ['Add a place', 'openAddModal', '#modal-overlay'],
  ['Just Ate', 'openJustAte', '#just-ate-overlay'],
  ['Nearby alerts', 'openNearAlerts', '#nearalerts-overlay'],
  ['Challenge sharing', 'openChallengeModal', '#challenge-overlay'],
  ['Challenges', 'openChallenges', '#challenges-overlay'],
  ['Spending', 'openSpendTracker', '#spend-overlay'],
  ['Meal planner', 'openMealPlanner', '#mealplanner-overlay'],
  ['Passport', 'openPassport', '#passport-overlay'],
  ['Foodie profile', 'openFoodieProfile', '#profile-overlay'],
  ['Achievements', 'openAchievements', '#achievements-overlay'],
  ['Bingo', 'openBingo', '#bingo-overlay'],
  ['Burger Bar', 'openBurgerBar', '#game-overlay'],
  ['Open now', 'openOpenNow', '#open-now-overlay'],
  ['Byte Cub', 'openChat', '#chat-panel'],
];
(async () => {
  const browser = await launch();
  try {
    const p = await newPage(browser, { grizzly: true, seed: [
      { id: 'a', name: 'A Very Long Restaurant Name on Waddell Road', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [{ id: 'soup', name: 'Broccoli cheddar soup', verdict: 'again' }] },
    ] });
    await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
    await p.goto(`${BASE}/app.html`);
    await p.waitForTimeout(1500);
    await p.evaluate(() => { document.body.dataset.uiMotion = 'reduced'; document.getElementById('cub-welcome')?.remove(); });
    for (const [width, height, fontSize] of [[320, 568, 32], [844, 390, 32], [768, 1024, 32], [390, 340, 20]]) {
      await p.setViewportSize({ width, height });
      await p.evaluate(size => document.documentElement.style.fontSize = `${size}px`, fontSize);
      for (const [name, open, selector] of panels) {
        await closeAllDialogs(p);
        await p.evaluate(() => document.getElementById('chat-panel').classList.add('hidden'));
        await p.evaluate(fn => window[fn](), open);
        const box = await p.locator(selector).evaluate(root => {
          const card = root.querySelector('.modal-card') || root;
          return { overflow: card.scrollWidth - card.clientWidth, top: card.getBoundingClientRect().top };
        });
        check(box.overflow <= 2, `${name} @${width}x${height}, font ${fontSize}px has no internal horizontal overflow (${box.overflow}px)`);
        check(box.top >= 0, `${name} remains reachable from the top at ${height}px height`);
      }
      await closeAllDialogs(p);
      await p.evaluate(() => { document.getElementById('chat-panel').classList.add('hidden'); openAuthModal(); });
      const auth = await p.locator('#auth-overlay .auth-card').boundingBox();
      check(auth.y >= 0 && auth.y + auth.height <= height, `sign-in fits the visible ${width}x${height}px viewport`);
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await closeAllDialogs(p);
    await p.locator('#theme-toggle-btn').focus();
    await p.evaluate(() => openPersonalizeSettings());
    const initial = await p.evaluate(() => document.getElementById('personalize-overlay').contains(document.activeElement));
    check(initial, 'opening Settings places keyboard focus inside the dialog');
    await p.evaluate(() => {
      const items = [...document.querySelectorAll('#personalize-overlay button,#personalize-overlay input,#personalize-overlay select')].filter(el => el.offsetHeight && !el.disabled);
      items.at(-1).focus();
    });
    await p.keyboard.press('Tab');
    check(await p.evaluate(() => document.getElementById('personalize-overlay').contains(document.activeElement)), 'Tab cannot leave an open Settings dialog');
    await p.click('#personalize-close-btn');
    check(await p.evaluate(() => document.activeElement.id === 'theme-toggle-btn'), 'closing Settings restores focus to its trigger');

    for (const id of ['edit-name', 'chat-input', 'challenge-link', 'command-palette-input', 'craving-freetext', 'ai-chat-input', 'travel-city-input', 'mp-budget', 'mp-vibe', 'profile-link', 'friends-link-input', 'detail-notes-edit', 'detail-link-input']) {
      check(await p.locator('#' + id).evaluate(el => !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.labels?.length)), `${id} has an explicit accessible name, not just a placeholder`);
    }
    check(!p.errors.length, `no unexpected errors during accessibility and layout checks (${p.errors.join(' | ')})`);
  } finally { await browser.close(); }
  finish('ui-accessibility');
})().catch(err => { console.error(err); process.exitCode = 1; });
