// Several photos at once: Just Ate, Your Order, and adding more to a dish.
// Extras live in `media` beside the main photo, survive a reload, and show
// in the gallery.
const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const FOOD = n => path.join(ROOT, 'assets', 'food', n);

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [], dishes: [] }] });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);

  // Just Ate: pick three photos in one go, remove one, add one more.
  await p.evaluate(() => openJustAte());
  await p.click('.ja-place[data-id="r1"]');
  let [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  check(chooser.isMultiple(), 'the picker allows several files');
  await chooser.setFiles([FOOD('tacos.jpg'), FOOD('dumplings.jpg'), FOOD('gnocchi.jpg')]);
  await p.waitForFunction(() => document.querySelectorAll('#just-ate-photo-preview .pm-item').length === 3, null, { timeout: 5000 }).catch(() => {});
  check(await p.locator('#just-ate-photo-preview .pm-item').count() === 3, 'all three show in the preview');
  check((await p.locator('#just-ate-photo-label').innerText()) === 'Add more (3/11)', 'the button counts them');
  await p.click('#just-ate-photo-preview .pm-remove[data-idx="1"]');
  check(await p.locator('#just-ate-photo-preview .pm-item').count() === 2, 'one can be removed');
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await chooser.setFiles(FOOD('banh_mi.jpg'));
  await p.waitForFunction(() => document.querySelectorAll('#just-ate-photo-preview .pm-item').length === 3, null, { timeout: 5000 }).catch(() => {});
  check(await p.locator('#just-ate-photo-preview .pm-item').count() === 3, 'and more added after');
  await p.fill('#just-ate-dish', 'Carnitas plate');
  await p.click('#just-ate-verdicts .yo-btn[data-verdict="again"]');
  await p.click('#just-ate-save');
  await p.waitForTimeout(1500);
  const saved = await p.evaluate(() => {
    const r = state.restaurants.find(x => x.id === 'r1');
    const v = r.visits.at(-1);
    const d = r.dishes.find(x => x.name === 'Carnitas plate');
    return { visit: mediaOf(v).length, dish: mediaOf(d).length, mainSame: v.photo === d.photo };
  });
  check(saved.visit === 3 && saved.dish === 3 && saved.mainSame, `visit and dish keep all three (${JSON.stringify(saved)})`);

  // After a reload the extras come back from photo storage.
  await p.reload();
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => {
    const d = state.restaurants.find(x => x.id === 'r1').dishes.find(x => x.name === 'Carnitas plate');
    return mediaOf(d).map(m => m.photo.slice(0, 15));
  });
  check(after.length === 3 && after.every(s => s === 'data:image/jpeg'), `extras survive a reload (${after})`);
  check(!(await p.evaluate(() => localStorage.getItem('ftb_restaurants_v2'))).includes('data:image/'), 'photos are not inlined in localStorage');

  // Your Order shows the count; adding more to the dish appends.
  await p.evaluate(() => openDetailModal('r1'));
  await p.waitForTimeout(400);
  check((await p.locator('.yo-media-count').first().innerText()) === '+2', 'Your Order shows +2 on the dish');
  await p.locator('.yo-dish-name').first().click();
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.yo-photo-btn').first().click()]);
  await chooser.setFiles([FOOD('tacos.jpg'), FOOD('pizza.jpg')]);
  await p.waitForTimeout(1200);
  check(await p.evaluate(() => mediaOf(state.restaurants.find(x => x.id === 'r1').dishes[0]).length) === 5, 'adding more keeps the old ones');

  // Your Order: pick two before naming a new dish.
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#your-order-photo')]);
  await chooser.setFiles([FOOD('dumplings.jpg'), FOOD('gnocchi.jpg')]);
  await p.waitForFunction(() => document.querySelectorAll('#your-order-pending .pm-item').length === 2, null, { timeout: 5000 }).catch(() => {});
  check(await p.locator('#your-order-pending .pm-item').count() === 2, 'Your Order holds both until the dish is named');
  await p.fill('#your-order-input', 'Churros');
  await p.press('#your-order-input', 'Enter');
  await p.waitForTimeout(600);
  check(await p.evaluate(() => mediaOf(state.restaurants.find(x => x.id === 'r1').dishes.find(d => d.name === 'Churros')).length) === 2, 'the new dish gets both');
  await closeAllDialogs(p);

  // The gallery shows every photo, not just the first per dish.
  await p.evaluate(() => openGallery());
  await p.waitForTimeout(300);
  check(await p.locator('.gallery-item').count() >= 5, `gallery shows the extras (${await p.locator('.gallery-item').count()})`);

  // Cloud copy trims extra photos before the main ones.
  const trimmed = await p.evaluate(() => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(300 * 1024);
    const r = { id: 'x', name: 'Big', visits: [], dishes: [{ id: 'd', name: 'D', photo: big, media: [{ photo: big }, { photo: big }] }] };
    const c = cloudSafeRestaurant(r);
    return { main: !!c.dishes[0].photo, extras: c.dishes[0].media.filter(m => m.photo).length };
  });
  check(trimmed.main && trimmed.extras < 2, `cloud trim drops extras first (${JSON.stringify(trimmed)})`);

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('multiphoto');
})();
