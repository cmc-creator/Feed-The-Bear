// Bear Swipe: real photos load, drag and buttons both work, the claw and bite
// effects run, a round of 10 ends with a craving and a way to find it.
const path = require('path');
const { BASE, SHOTS, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [] }] });
  await p.goto(`${BASE}/app.html`);
  await p.waitForSelector('#bear-swipe-home .bs-card.bs-top .bs-photo', { timeout: 15000 });
  const mod = p.locator('#bear-swipe-home');
  await mod.scrollIntoViewIfNeeded();
  check(await mod.isVisible(), 'Bear Swipe shows on home');
  check(/Right.*if you'd eat it.*left.*if not/i.test(await mod.locator('.bs-sub').innerText()), 'explains what swiping does');

  const loaded = await p.waitForFunction(() => {
    const img = document.querySelector('#bear-swipe-home .bs-top .bs-photo');
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  check(loaded, 'first dish photo loads from Wikimedia');
  const first = await p.evaluate(() => { const d = BearSwipe._state().deck; return { n: d.length, dishes: new Set(d.map(x => x.dish)).size, credit: document.querySelector('.bs-top .bs-credit')?.textContent }; });
  check(first.n === 10 && first.dishes === 10, `a round is 10 different dishes (${first.n}, ${first.dishes} unique)`);
  check(/^Photo: .+ · .+/.test(first.credit || ''), `each card credits the photo ("${first.credit}")`);
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-card.png') }).catch(() => {});

  // Drag left past the threshold: claw slash, then the card tears.
  const box = await p.locator('.bs-top').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(box.x + box.width / 2 - i * 14, box.y + box.height / 2 + i);
  check(Number(await p.locator('.bs-top').evaluate(el => getComputedStyle(el).getPropertyValue('--no'))) > 0.9, 'dragging left shows NOPE');
  await p.mouse.up();
  await p.waitForTimeout(150);
  check(await p.locator('.bs-claw').count() === 1, 'swiping left rakes claw marks across the card');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-claw.png') }).catch(() => {});
  await p.waitForTimeout(250);
  check(await p.locator('.bs-half').count() === 2, 'then the card tears into two halves');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-tear.png') }).catch(() => {});
  await p.waitForTimeout(700);
  check(await p.evaluate(() => BearSwipe._state().index === 1), 'moves to the next dish');

  // Yes via the button: bite + NOM.
  await p.click('.bs-btn-yes');
  await p.waitForTimeout(260);
  check(await p.locator('.bs-top.bs-bite-2, .bs-card.bs-bite-2').count() === 1 && await p.locator('.bs-nom').count() === 1, 'yes takes a bite and shows NOM');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-bite.png') }).catch(() => {});
  await p.waitForTimeout(900);

  // Finish the round with a mix, using the keyboard too.
  await mod.focus();
  for (let i = 2; i < 10; i++) {
    await p.keyboard.press(i % 3 === 0 ? 'ArrowLeft' : 'ArrowRight');
    await p.waitForTimeout(1000);
  }
  await p.waitForSelector('.bs-result:not(.hidden)', { timeout: 5000 }).catch(() => {});
  const result = await p.locator('.bs-result').innerText().catch(() => '');
  check(/Tonight you're craving/i.test(result) && /Find .+ near me/.test(result), `round ends with a craving and a find-it button ("${result.replace(/\s+/g, ' ').slice(0, 90)}")`);
  check(await p.locator('.bs-collage img').count() >= 1, 'result shows the dishes you liked');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-result.png') }).catch(() => {});
  const store = await p.evaluate(() => JSON.parse(localStorage.getItem('ftb_bear_swipe_v2')));
  check(store.rounds === 1 && store.seen.length === 10 && Object.keys(store.tastes).length > 0, 'remembers tastes and seen photos');

  // Swipe again starts a fresh round without repeating photos.
  const before = await p.evaluate(() => BearSwipe._state().deck.map(d => d.url));
  await p.click('.bs-again');
  await p.waitForSelector('.bs-top .bs-photo');
  const after = await p.evaluate(() => BearSwipe._state().deck.map(d => d.url));
  check(after.filter(u => before.includes(u)).length === 0, 'next round has fresh photos');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('swipe');
})();
