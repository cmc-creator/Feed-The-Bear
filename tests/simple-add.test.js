const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1000);
  await closeAllDialogs(p);
  await p.click('#mobile-add-btn');
  check(await p.locator('.qa-input').isVisible() && await p.locator('.qa-import').isHidden(),
    'Add opens with a single place input and keeps bulk import out of the main path');
  await p.fill('.qa-input', 'Simple Taco Place');
  await p.locator('.qa-input').press('Enter');
  check(await p.locator('.qa-status').allTextContents().then(names => names.join('|') === 'Here now|Went before|Want to try'),
    'three plain-language choices distinguish a current visit, past visit, and bucket-list save');
  await p.click('.qa-status[data-status="visited"]');
  check(await p.locator('.qa-save').isEnabled() && await p.locator('.qa-save').innerText() === 'Save my visit',
    'a current visit can be saved without a rating, dish, cuisine or photo');
  check(await p.locator('.qa-cuisine').isHidden() && await p.locator('.qa-ai').isHidden()
    && await p.locator('.qa-dish').isHidden() && await p.locator('.qa-star').first().isHidden() && await p.locator('.qa-more').isHidden(),
    'every optional detail stays collapsed until requested');
  check(await p.locator('.qa-photo').isVisible() && await p.locator('.qa-photo').innerText() === 'Take photo',
    'one clearly labelled camera action replaces the duplicate camera icon');
  for (const width of [320, 390]) {
    await p.setViewportSize({ width, height: 740 });
    check(await p.evaluate(() => {
      const save = document.querySelector('.qa-save').getBoundingClientRect();
      const card = document.querySelector('.qa-card');
      return save.bottom <= innerHeight && save.top >= 0 && card.scrollHeight <= card.clientHeight + 1
        && document.documentElement.scrollWidth <= innerWidth;
    }), `the collapsed Add flow and Save fit a ${width}px phone without scrolling`);
    check(await p.locator('.qa-photo').evaluate(button => {
      const label = button.querySelector('span');
      const rect = label.getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      return button.scrollWidth <= button.clientWidth && rect.left >= bounds.left && rect.right <= bounds.right
        && bounds.height >= 60 && button.querySelector('svg') !== null;
    }), `the full-width camera icon and complete Take photo label fit at ${width}px`);
  }
  await p.emulateMedia({ reducedMotion: 'reduce' });
  check(await p.locator('.qa-photo').evaluate(button => getComputedStyle(button).animationName === 'none'),
    'the camera glow respects the device reduced-motion setting');
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.evaluate(() => { document.body.dataset.uiMotion = 'reduced'; });
  check(await p.locator('.qa-photo').evaluate(button => getComputedStyle(button).animationName === 'none'),
    'the camera glow respects the app reduced-motion preference');
  await p.evaluate(() => { document.body.dataset.uiMotion = 'playful'; });
  await p.evaluate(() => {
    navigator.share = async data => { window.__post = data; };
    navigator.canShare = () => true;
  });
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.qa-photo')]);
  check(await chooser.element().getAttribute('capture') === 'environment', 'Take photo explicitly requests rear-camera capture');
  await chooser.setFiles(path.join(ROOT, 'assets', 'food', 'tacos.jpg'));
  await p.waitForFunction(() => !foodMediaBusy());
  await p.click('.qa-save');
  await p.waitForSelector('.sn-media:not([disabled])');
  check(await p.evaluate(() => {
    const r = state.restaurants.find(r => r.name === 'Simple Taco Place');
    return !!r.photo && r.myRating === 0 && r.visits[0].date === iso() && !(r.dishes || []).length && !window.__post;
  }), 'save retains the photo and current visit without forcing details or posting automatically');
  await p.click('.sn-media');
  check(await p.evaluate(() => window.__post.files[0].type.startsWith('image/') && window.__post.text.includes('Simple Taco Place')),
    'one post-save share action sends the real photo and caption to the social share sheet');
  await p.evaluate(() => Cub.openAdd());
  await p.fill('.qa-input', 'Remembered Cafe');
  await p.locator('.qa-input').press('Enter');
  await p.click('.qa-status[data-status="visited-before"]');
  await p.click('.qa-details summary');
  await p.fill('.qa-visit-date', '2025-04-12');
  await p.fill('.qa-dish', 'Breakfast tacos');
  await p.click('.qa-star[data-n="4"]');
  await p.click('.qa-save');
  check(await p.evaluate(() => {
    const r = state.restaurants.find(r => r.name === 'Remembered Cafe');
    return r.status === 'visited' && r.dateVisited === '2025-04-12' && r.visits[0].date === '2025-04-12'
      && r.dishes[0].date === '2025-04-12' && r.myRating === 4;
  }), 'past visit details preserve the actual date consistently for the spot, visit and dish');
  check(!/Just ate/.test(await p.locator('.sn-caption-text').inputValue()), 'a past visit caption does not pretend the meal happened today');
  await p.evaluate(() => Cub.openAdd());
  await p.fill('.qa-input', 'Unknown Date Cafe');
  await p.locator('.qa-input').press('Enter');
  await p.click('.qa-status[data-status="visited-before"]');
  await p.click('.qa-save');
  check(await p.evaluate(() => {
    const r = state.restaurants.find(r => r.name === 'Unknown Date Cafe');
    return r.status === 'visited' && r.dateVisited === null && r.visits[0].date === '';
  }), 'a past visit without an optional date is not invented as today');
  await p.evaluate(() => Cub.openAdd());
  check(!(await p.locator('.qa-details').getAttribute('open')), 'optional details reset to collapsed for the next place');
  await p.fill('.qa-input', 'Future Date Cafe');
  await p.locator('.qa-input').press('Enter');
  await p.click('.qa-status[data-status="visited-before"]');
  await p.click('.qa-details summary');
  await p.fill('.qa-visit-date', '2099-01-01');
  await p.click('.qa-details summary');
  await p.click('.qa-save');
  check(await p.locator('.qa-visit-date').isVisible()
    && await p.evaluate(() => !state.restaurants.some(r => r.name === 'Future Date Cafe')),
    'an invalid future visit reveals the date field instead of silently saving bad data');
  await p.evaluate(() => Cub.close());
  check(!p.errors.length, `no unexpected page errors (${p.errors.join(' | ')})`);
  await browser.close();
  finish('simple-add');
})();
