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
  ['Username', 'openHandleSettings', '#handle-overlay'],
  ['Achievements', 'openAchievements', '#achievements-overlay'],
  ['Bingo', 'openBingo', '#bingo-overlay'],
  ['Burger Bar', 'openBurgerBar', '#game-overlay'],
  ['Food Match', 'openFoodMatch', '#game-overlay'],
  ['Swipe choices', 'openSwipeDeck', '#swipe-overlay'],
  ['Export formats', 'openExport2', '#export2-overlay'],
  ['Spin wheel', 'openSpinWheel', '#spin-overlay'],
  ['Mood calendar', 'openMoodCal', '#moodcal-overlay'],
  ['Place detail', 'DETAIL', '#detail-overlay'],
  ['Open now', 'openOpenNow', '#open-now-overlay'],
  ['Byte Cub', 'openChat', '#chat-panel'],
];
(async () => {
  const browser = await launch();
  try {
    const p = await newPage(browser, { grizzly: true, seed: [
      { id: 'a', name: 'A Very Long Restaurant Name on Waddell Road', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [{ id: 'soup', name: 'Broccoli cheddar soup', verdict: 'again' }] },
      { id: 'b', name: 'Another Restaurant', cuisine: 'Pizza', status: 'want-to-try', tags: [], visits: [], dishes: [] },
    ] });
    await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
    await p.goto(`${BASE}/app.html`);
    await p.waitForTimeout(1500);
    await p.evaluate(() => { document.body.dataset.uiMotion = 'reduced'; document.getElementById('cub-welcome')?.remove(); });
    for (const [width, height, fontSize, light] of [[320, 568, 32, false], [844, 390, 32, false], [768, 1024, 32, false], [390, 340, 20, false], [320, 568, 32, true]]) {
      await p.setViewportSize({ width, height });
      await p.evaluate(({ size, light }) => { document.documentElement.style.fontSize = `${size}px`; document.body.classList.toggle('light-mode', light); }, { size: fontSize, light });
      await closeAllDialogs(p);
      await p.evaluate(() => { document.getElementById('chat-panel').classList.add('hidden'); setView('all'); });
      check(await p.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth + 2), `Home with saved places fits at ${width}px and ${fontSize}px text`);
      const layoutWidth = await p.evaluate(() => innerWidth);
      check(layoutWidth <= width + 1, `Home does not enlarge the ${width}x${height}px mobile layout viewport (${layoutWidth}px)`);
      await p.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('.filter-bar')).top) - document.querySelector('.app-header').getBoundingClientRect().height) < 1);
      check(true, 'sticky filters follow the actual enlarged header height');
      for (const [name, open, selector] of panels) {
        await closeAllDialogs(p);
        await p.evaluate(() => document.getElementById('chat-panel').classList.add('hidden'));
        await p.evaluate(fn => fn === 'DETAIL' ? openDetailModal('a') : window[fn](), open);
        const box = await p.locator(selector).evaluate(root => {
          const card = root.querySelector('.modal-card') || root;
          return { overflow: card.scrollWidth - card.clientWidth, top: card.getBoundingClientRect().top, culprits: [...card.querySelectorAll('*')].filter(el => el.offsetHeight && !el.closest('.hidden') && el.scrollWidth > el.clientWidth + 2).map(el => `${el.id || el.className}: ${el.scrollWidth - el.clientWidth}px`) };
        });
        check(box.overflow <= 2, `${name} @${width}x${height}, ${light ? 'light' : 'dark'} theme, font ${fontSize}px has no internal horizontal overflow (${box.overflow}px${box.overflow > 2 ? '; ' + box.culprits.join(', ') : ''})`);
        check(box.top >= 0, `${name} remains reachable from the top at ${height}px height`);
        if (['Burger Bar', 'Swipe choices', 'Just Ate', 'Add a place', 'Nearby alerts', 'Export formats'].includes(name)) {
          const clipped = await p.locator(selector).evaluate(root => {
            const buttons = [...root.querySelectorAll('.bar-btn,.swipe-btn,.ja-stars button,.star-picker button,.nearalerts-choices button,.export2-option')].filter(el => el.getClientRects().length);
            return buttons.some(button => {
              const box = button.getBoundingClientRect();
              const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
              let node;
              while ((node = walker.nextNode())) {
                if (!node.textContent.trim()) continue;
                const range = document.createRange(); range.selectNodeContents(node);
                if ([...range.getClientRects()].some(r => r.width && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1))) return true;
              }
            });
          });
          check(!clipped, `${name} icons and button labels stay inside their targets at ${fontSize}px text`);
        }
        if (selector === '#game-overlay') await p.evaluate(() => closeGame());
      }
      await closeAllDialogs(p);
      await p.evaluate(() => { document.getElementById('chat-panel').classList.add('hidden'); openAuthModal(); });
      const auth = await p.locator('#auth-overlay .auth-card').boundingBox();
      check(auth.y >= 0 && auth.y + auth.height <= height, `sign-in fits the visible ${width}x${height}px viewport`);
      check(await p.locator('#auth-overlay .auth-card').evaluate(card => {
        const button = [...card.querySelectorAll('button')].filter(el => el.getClientRects().length).at(-1);
        button.scrollIntoView({ block: 'nearest' });
        const r = button.getBoundingClientRect(), bounds = card.getBoundingClientRect();
        return r.top >= bounds.top && r.bottom <= bounds.bottom + 1;
      }), 'sign-in bottom actions are reachable by scrolling');
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { document.documentElement.style.fontSize = ''; document.body.classList.remove('light-mode'); });
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
    await p.locator('#personalize-close-btn').focus();
    await p.keyboard.press('Shift+Tab');
    check(await p.evaluate(() => document.getElementById('personalize-overlay').contains(document.activeElement)), 'Shift+Tab cannot leave Settings');
    await p.locator('#theme-toggle-btn').focus();
    check(await p.evaluate(() => document.getElementById('personalize-overlay').contains(document.activeElement)), 'focus moved behind a dialog is redirected inside');
    await p.locator('#personalize-close-btn').focus();
    await p.evaluate(() => {
      shareWithMenu({ text: 'A nested dialog test' }).then(() => { window._testShareResult = 'sent'; }, err => { window._testShareResult = err.name; });
    });
    check(await p.evaluate(() => document.getElementById('share-menu').contains(document.activeElement)), 'a newly created nested Share dialog receives focus');
    await p.locator('#share-menu .share-menu-cancel').focus();
    await p.keyboard.press('Tab');
    check(await p.evaluate(() => document.getElementById('share-menu').contains(document.activeElement)), 'Tab stays in the topmost dialog');
    await p.locator('#share-menu .share-menu-cancel').click();
    check(await p.evaluate(() => document.activeElement.id === 'personalize-close-btn' && window._testShareResult === 'AbortError'), 'closing nested Share restores the parent dialog trigger');
    await p.click('#personalize-close-btn');
    check(await p.evaluate(() => document.activeElement.id === 'theme-toggle-btn'), 'closing Settings restores focus to its trigger');
    await p.evaluate(() => { openAddModal(); document.getElementById('form-name').focus(); });
    await p.locator('#modal-close-btn').click();
    check(await p.evaluate(() => document.activeElement.id === 'theme-toggle-btn'), 'immediate field focus preserves the original dialog trigger');

    for (const id of ['edit-name', 'chat-input', 'challenge-link', 'command-palette-input', 'craving-freetext', 'ai-chat-input', 'travel-city-input', 'mp-budget', 'mp-vibe', 'profile-link', 'friends-link-input', 'detail-notes-edit', 'detail-link-input']) {
      check(await p.locator('#' + id).evaluate(el => !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.labels?.length)), `${id} has an explicit accessible name, not just a placeholder`);
    }
    check(!p.errors.length, `no unexpected errors during accessibility and layout checks (${p.errors.join(' | ')})`);
  } finally { await browser.close(); }
  finish('ui-accessibility');
})().catch(err => { console.error(err); process.exitCode = 1; });
