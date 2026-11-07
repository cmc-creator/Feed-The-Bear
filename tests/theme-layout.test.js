const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const seed = [
  { id: 'a', name: 'A Very Long Restaurant Name on Waddell Road', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [{ date: '2026-10-01', rating: 5 }], dishes: [{ id: 'soup', name: 'Broccoli cheddar soup', verdict: 'want' }], lat: 33.4, lng: -112 },
  { id: 'b', name: 'Another Restaurant', cuisine: 'Pizza', status: 'want-to-try', tags: [], dishes: [], visits: [], lat: 33.41, lng: -112 },
];
const events = [
  { id: 'burger', name: 'A Very Long Burger Challenge at the Restaurant on Waddell', kind: 'challenge', date: '', city: 'Surprise', state: 'AZ', venue: 'Bear Grill', url: 'https://example.com/challenges/restaurant', prize: 'Organizer trophy', entryCost: '$25' },
];
async function setup (browser, viewport, settings = {}) {
  const p = await newPage(browser, { seed, viewport, settings });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.route('**/api/food-events**', r => r.fulfill({ json: { events, at: Date.now() } }));
  await p.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  return p;
}

async function fit (p, scope = 'body') {
  return p.evaluate(selector => {
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Missing layout scope ${selector}`);
    const buttons = [...root.querySelectorAll('.btn-primary,.btn-secondary,.btn-ghost,.btn-danger,.btn-orange,.auth-tab,.grizzly-pill,.list-tab,.home-quick-btn,.suggestion-chip,.card-action-btn,.bs-btn')];
    return buttons.filter(e => e.offsetHeight && !e.closest('.hidden') && getComputedStyle(e).visibility !== 'hidden').flatMap(button => {
      const box = button.getBoundingClientRect();
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim() || getComputedStyle(node.parentElement).display === 'none') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)) {
            return [`${button.id || button.className}: ${button.innerText.trim().slice(0, 70)} (${Math.round(box.width)}px)`];
          }
        }
      }
      return [];
    });
  }, scope);
}

async function contrast (p, selector, backgroundSelector = selector) {
  return p.evaluate(([textSelector, bgSelector]) => {
    const text = document.querySelector(textSelector);
    const bg = document.querySelector(bgSelector);
    if (!text || !bg) throw new Error(`Missing contrast target ${textSelector}/${bgSelector}`);
    const parse = color => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const fg = getComputedStyle(text).color;
    const background = getComputedStyle(bg).backgroundColor;
    if (background === 'rgba(0, 0, 0, 0)') throw new Error(`Contrast target needs an opaque background: ${bgSelector}`);
    const a = lum(parse(fg)), b = lum(parse(background));
    return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), fg, background };
  }, [selector, backgroundSelector]);
}

(async () => {
  const browser = await launch();
  try {
    const p = await setup(browser, { width: 412, height: 915 });
    await p.goto(`${BASE}/app.html`);
    await p.waitForSelector('#bear-challenges-home-list .bc-card');
    await closeAllDialogs(p);
    check(await p.evaluate(() => !document.body.classList.contains('light-mode') && state.settings.themeChoice === 'dark'), 'Pixel 9 sized screen defaults to dark even when the phone prefers light');
    check(await p.evaluate(() => document.documentElement.style.colorScheme === 'dark'), 'native form controls use the default dark color scheme');
    check(await p.locator('#theme-toggle-btn').isVisible(), 'theme switch is visible on a Pixel sized screen');
    const target = await p.locator('#theme-toggle-btn').boundingBox();
    check(target.width >= 44 && target.height >= 44, 'theme switch has a 44px touch target');
    check(await p.locator('#theme-toggle-btn').getAttribute('aria-label') === 'Switch to light theme', 'switch has an accessible action label');
    check(await p.evaluate(() => document.querySelector('meta[name="theme-color"]').content === '#12141b'), 'browser chrome matches the dark page rather than a bright accent');
    await p.click('#theme-toggle-btn');
    check(await p.evaluate(() => document.body.classList.contains('light-mode') && state.settings.themeManual), 'header switches to light and records a deliberate choice');
    check(await p.locator('#theme-toggle-btn').getAttribute('aria-label') === 'Switch to dark theme' && await p.locator('#theme-toggle-btn').getAttribute('aria-pressed') === 'false', 'toggle action and state update in light mode');
    await p.reload();
    await p.waitForSelector('#bear-challenges-home-list .bc-card');
    await closeAllDialogs(p);
    check(await p.evaluate(() => document.body.classList.contains('light-mode')), 'chosen light mode survives reload');
    await p.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    check(await p.evaluate(() => document.body.classList.contains('light-mode')), 'system changes cannot replace the manually chosen theme');
    await p.evaluate(() => applyThemeChoice('auto'));
    check(await p.evaluate(() => state.settings.themeChoice === 'auto' && !document.body.classList.contains('light-mode')), 'explicit Auto follows the phone');
    await p.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await p.waitForFunction(() => document.body.classList.contains('light-mode'));
    check(await p.evaluate(() => state.settings.themeChoice === 'auto'), 'Auto preserves its own identity after applying the phone theme');
    await p.reload();
    await p.waitForSelector('#bear-challenges-home-list .bc-card');
    await closeAllDialogs(p);
    check(await p.evaluate(() => state.settings.themeChoice === 'auto' && !state.settings.themeManual && document.body.classList.contains('light-mode')), 'Auto remains opt-in and survives reload');
    await p.evaluate(() => openPersonalizeSettings());
    check(await p.inputValue('#personalize-theme-select') === 'auto', 'Settings correctly shows the saved Auto choice');
    await closeAllDialogs(p);

    const panels = [
      ['Home', 'body', () => setView('all')],
      ['My Lists', 'body', () => setView('visited')],
      ['Place details', '#detail-overlay', () => openDetailModal('a')],
      ['Add a place', '#modal-overlay', () => openAddModal()],
      ['Settings', '#personalize-overlay', () => openPersonalizeSettings()],
      ['Account', '#account-overlay', () => openAccountModal()],
      ['Discover / Play', '#mobile-hub-overlay', () => openMobileHub()],
      ['Bear Challenges', '#bear-challenges-overlay', () => openFoodEvents()],
      ['Challenge details', '#bear-challenge-detail-overlay', () => openFoodEventDetail(events[0])],
    ];
    // Serialized browser functions cannot capture the Node-side fixture.
    panels[8][2] = () => openFoodEventDetail({ id: 'burger', name: 'A Very Long Burger Challenge at the Restaurant on Waddell', kind: 'challenge', date: '', city: 'Surprise', state: 'AZ', url: 'https://example.com/challenges/restaurant' });
    for (const theme of ['dark', 'light', 'mint']) {
      for (const width of [320, 360, 412, 1280]) {
        await p.setViewportSize({ width, height: width > 700 ? 900 : 915 });
        await p.evaluate(value => { document.documentElement.style.fontSize = '20px'; applyThemeChoice(value, { persist: false }); }, theme);
        for (const [name, scope, open] of panels) {
          await closeAllDialogs(p);
          await p.evaluate(open);
          if (name === 'Bear Challenges') await p.waitForFunction(() => !_bc.loading);
          const overflow = await fit(p, scope);
          check(!overflow.length, `${theme} ${name} @${width}px with 125% text has fitting button labels (${overflow.join('; ')})`);
          check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${name} @${width}px has no horizontal page overflow`);
          if (name === 'My Lists') {
            const smallActions = await p.locator('.card-action-btn').evaluateAll(buttons => buttons.filter(el => el.getBoundingClientRect().height < 44).map(el => el.innerText));
            check(!smallActions.length, `${theme} saved-place actions have 44px touch targets @${width}px (${smallActions.join(', ')})`);
          }
        }
        await closeAllDialogs(p);
        await p.evaluate(() => setView('all'));
        const header = await p.evaluate(() => {
          const items = [...document.querySelectorAll('.app-header button')].filter(el => el.offsetHeight && !el.closest('.more-menu'));
          return items.filter(el => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).map(el => el.id);
        });
        check(!header.length, `${theme} header controls fit @${width}px (${header.join(', ')})`);
        check(await p.locator('#theme-toggle-btn').isVisible(), `${theme} theme switch stays visible @${width}px`);
      }
    }
    await p.setViewportSize({ width: 412, height: 915 });
    await p.evaluate(() => { document.documentElement.style.fontSize = ''; setView('all'); });
    for (const theme of ['light', 'mint']) {
      await p.evaluate(value => applyThemeChoice(value, { persist: false }), theme);
      for (const [label, fg, bg] of [
        ['Home challenge heading', '#bear-challenges-home h2', '#bear-challenges-home'],
        ['Home challenge subtitle', '#bear-challenges-home-sub', '#bear-challenges-home'],
        ['Challenge name', '.bc-card-name', '.bc-card'],
        ['Challenge metadata', '.bc-card .bc-muted', '.bc-card'],
        ['Challenge type', '.bc-tag', '.bc-card'],
        ['Crave heading', '.crave-home-title', '#crave-home'],
        ['Crave restaurant', '.crave-where', '#crave-home'],
        ['Bear Swipe heading', '.bs-title', '#bear-swipe-home'],
        ['Bear Swipe explanation', '.bs-sub', '#bear-swipe-home'],
        ['Bear Swipe progress', '.bs-count', '#bear-swipe-home'],
      ]) {
        const color = await contrast(p, fg, bg);
        check(color.ratio >= 4.5, `${theme} ${label} meets 4.5:1 text contrast (${color.ratio.toFixed(2)}:1)`);
      }
      await p.evaluate(() => setView('visited'));
      const title = await contrast(p, '.list-title', '.restaurant-card');
      check(title.ratio >= 4.5, `${theme} My Lists title is readable (${title.ratio.toFixed(2)}:1)`);
      for (const [label, selector] of [['Restaurant name', '.card-name'], ['Restaurant cuisine', '.card-cuisine'], ['Order label', '.card-order-label'], ['Delete action', '.card-action-btn.delete-card']]) {
        const color = await contrast(p, selector, '.restaurant-card');
        check(color.ratio >= 4.5, `${theme} ${label} meets 4.5:1 (${color.ratio.toFixed(2)}:1)`);
      }
      await p.evaluate(() => openPersonalizeSettings());
      const settings = await contrast(p, '#personalize-title', '.personalize-card');
      check(settings.ratio >= 4.5, `${theme} Settings heading meets 4.5:1 (${settings.ratio.toFixed(2)}:1)`);
      await closeAllDialogs(p);
      await p.evaluate(() => openAddModal());
      const star = await contrast(p, '.star-pick:not(.active)', '#modal-overlay .modal-card');
      check(star.ratio >= 3, `${theme} unselected rating stars meet 3:1 control contrast (${star.ratio.toFixed(2)}:1)`);
      await closeAllDialogs(p);
    }
    check(!p.errors.length, `no errors across themes and layouts (${p.errors.join(' | ')})`);

    const migrated = await setup(browser, { width: 412, height: 915 }, { theme: 'light', themeChoice: 'light', themeManual: false });
    await migrated.goto(`${BASE}/app.html`);
    await migrated.waitForSelector('#bear-challenges-home-list .bc-card');
    check(await migrated.evaluate(() => state.settings.themeChoice === 'dark' && !document.body.classList.contains('light-mode')), 'old automatically applied light theme migrates to the dark default');
    const manual = await setup(browser, { width: 412, height: 915 }, { theme: 'light', themeChoice: 'mint', themeManual: true });
    await manual.goto(`${BASE}/app.html`);
    await manual.waitForSelector('#bear-challenges-home-list .bc-card');
    check(await manual.evaluate(() => state.settings.themeChoice === 'mint' && document.body.classList.contains('light-mode')), 'existing deliberate theme choices are preserved');
  } finally { await browser.close(); }
  finish('theme-layout');
})().catch(err => { console.error(err); process.exitCode = 1; });
