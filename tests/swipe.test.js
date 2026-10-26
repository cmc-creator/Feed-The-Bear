// Bear Swipe: real photos load, drag and buttons both work, the claw and bite
// effects run, a round of 10 ends with a craving and a way to find it.
const path = require('path');
const { BASE, ROOT, SHOTS, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [] }] });
  // Wikimedia throttles data-centre traffic (GitHub runners), which made this
  // test flaky. Locally and in CI, serve a bundled food photo instead; a run
  // against the live site (TEST_BASE) still loads real Wikimedia photos.
  if (!process.env.TEST_BASE) {
    await p.route(/^https:\/\/(thumb|upload)\.wikimedia\.org\//, route => route.fulfill({ path: path.join(ROOT, 'assets', 'food', 'ramen.jpg'), contentType: 'image/jpeg' }));
  }
  await p.goto(`${BASE}/app.html`);
  await p.waitForSelector('#bear-swipe-home .bs-card.bs-top .bs-photo', { timeout: 15000 });
  const mod = p.locator('#bear-swipe-home');
  await mod.scrollIntoViewIfNeeded();
  check(await mod.isVisible(), 'Bear Swipe shows on home');
  check(/Right.*if you'd eat it.*left.*if not/i.test(await mod.locator('.bs-sub').innerText()), 'explains what swiping does');

  // Everyday food first: most of a round is burgers, pizza, tacos and friends.
  const deck = await p.evaluate(() => BearSwipe._state().deck.map(d => d.dish));
  const staples = ['Cheeseburger', 'Hamburger', 'French fries', 'Tacos', 'Cheese pizza', 'Pepperoni pizza', 'Caesar salad', 'Fried rice', 'Orange chicken', 'Burrito', 'Buffalo wings', 'Fried chicken', 'Pancakes', 'Sub sandwich', 'Loaded baked potato', 'Sirloin steak', 'Mac and cheese', 'Nachos', 'Lasagna', 'Chow mein', 'Chicken tenders', 'BBQ ribs', 'Grilled cheese', 'Hot dog', 'Sushi', 'Ramen', 'Pad thai', 'Philly cheesesteak', 'Chicken sandwich', 'Quesadilla', 'Fajitas', 'Enchiladas', 'Pulled pork', 'Brisket', 'Onion rings', 'Waffles', 'French toast', 'Omelette', 'Donuts', 'Cupcakes', 'Cheesecake', 'Brownies', 'Apple pie', 'Milkshake', 'Gyro', 'Pho', 'Egg rolls', 'Chili', 'Meatloaf', 'Club sandwich', 'BLT', 'Cobb salad', 'Chicken nuggets', 'Mashed potatoes', 'Pot roast', 'Steak frites', 'BBQ chicken', 'Chicken fried steak', 'Chicken pot pie', 'Clam chowder', 'Fish and chips', 'Grilled salmon', 'Meatball sub', 'Wrap', 'Reuben sandwich', 'Pizza margherita', 'Spaghetti and meatballs', 'Fettuccine Alfredo', 'Chicken parmesan', "General Tso's chicken", 'Kung pao chicken', 'Sweet and sour pork', 'Beef and broccoli', 'Sesame chicken', 'Eggs Benedict', 'Breakfast burrito', 'Hash browns', 'Chocolate chip cookies', 'Ice cream sundae'];
  const everyday = deck.filter(d => staples.includes(d)).length;
  check(deck.length === 20 && everyday >= 15, `a round is mostly everyday food (${everyday}/20: ${deck.slice(0, 6).join(', ')}...)`);
  const photos = require('../data/food-photos.json').photos;
  check(!photos.some(x => /syringe|needle/i.test(x.page)), 'no syringe photos in the set');

  // Wikimedia sometimes throttles data-centre traffic (CI); the app swaps in
  // another photo when one fails, so allow time for that.
  const loaded = await p.waitForFunction(() => {
    const img = document.querySelector('#bear-swipe-home .bs-top .bs-photo');
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  check(loaded, `a dish photo loads from Wikimedia (swapped ${await p.evaluate(() => BearSwipe._state().failed)} broken)`);

  // A photo that fails to load is replaced rather than shown broken.
  const swapped = await p.evaluate(async () => {
    const before = BearSwipe._state().deck[BearSwipe._state().index];
    const img = document.querySelector('.bs-top .bs-photo');
    img.dispatchEvent(new Event('error'));
    await new Promise(r => setTimeout(r, 400));
    const after = BearSwipe._state().deck[BearSwipe._state().index];
    return before.url !== after.url && document.querySelector('.bs-top .bs-photo')?.getAttribute('src') === after.url;
  });
  check(swapped, 'a broken photo is swapped for another');
  const photoCount = await p.evaluate(async () => (await BearSwipe.loadPhotos()).length);
  check(photoCount > 1000, `the full photo set loads (${photoCount} photos)`);
  const first = await p.evaluate(() => { const d = BearSwipe._state().deck; return { n: d.length, dishes: new Set(d.map(x => x.dish)).size, credit: document.querySelector('.bs-top .bs-credit')?.textContent }; });
  check(first.n === 20 && first.dishes === 20, `a round is 20 different dishes (${first.n}, ${first.dishes} unique)`);
  check(/^Photo: .+ · .+/.test(first.credit || ''), `each card credits the photo ("${first.credit}")`);
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-card.png') }).catch(() => {});

  // Drag left past the threshold: claw slash, then the card tears.
  const box = await p.locator('.bs-top').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(box.x + box.width / 2 - i * 14, box.y + box.height / 2 + i);
  check(Number(await p.locator('.bs-top').evaluate(el => getComputedStyle(el).getPropertyValue('--no'))) > 0.9, 'dragging left shows NOPE');
  await p.mouse.up();
  const swipedAt = Date.now();
  const at = ms => p.waitForTimeout(Math.max(0, ms - (Date.now() - swipedAt)));
  await at(150);
  check(await p.locator('.bs-claw').count() === 1, 'swiping left rakes claw marks across the card');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-claw.png') }).catch(() => {});
  await at(750);
  check(await p.locator('.bs-top .bs-claw').count() === 1 && await p.locator('.bs-half').count() === 0, 'claw marks linger before the tear');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-claw-linger.png') }).catch(() => {});
  await at(1250);
  check(await p.locator('.bs-half').count() === 2 && await p.locator('.bs-half .bs-claw').count() === 2, 'then the card tears in two, claw marks still on both halves');
  check(await p.evaluate(() => [...document.querySelectorAll('.bs-half .bs-claw-reveal')].every(m => parseFloat(getComputedStyle(m).strokeDashoffset) === 0)), 'claw marks stay fully drawn as the card tears');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-tear.png') }).catch(() => {});
  await p.waitForTimeout(1100);
  check(await p.evaluate(() => BearSwipe._state().index === 1), 'moves to the next dish');

  // Yes via the button: bite + NOM.
  await p.click('.bs-btn-yes');
  await p.waitForTimeout(260);
  check(await p.locator('.bs-top.bs-bite-2, .bs-card.bs-bite-2').count() === 1 && await p.locator('.bs-nom').count() === 1, 'yes takes a bite and shows NOM');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-bite.png') }).catch(() => {});
  await p.waitForTimeout(900);

  // Finish the round with a mix, using the keyboard too.
  await mod.focus();
  for (let i = 2; i < 20; i++) {
    const left = i % 3 === 0;
    await p.keyboard.press(left ? 'ArrowLeft' : 'ArrowRight');
    await p.waitForTimeout(left ? 2200 : 1000);
  }
  await p.waitForSelector('.bs-result:not(.hidden)', { timeout: 5000 }).catch(() => {});
  const result = await p.locator('.bs-result').innerText().catch(() => '');
  check(/Tonight you're craving/i.test(result) && /Find .+ near me/.test(result), `round ends with a craving and a find-it button ("${result.replace(/\s+/g, ' ').slice(0, 90)}")`);
  check(await p.locator('.bs-collage img').count() >= 1, 'result shows the dishes you liked');
  await mod.screenshot({ path: path.join(SHOTS, 'swipe-result.png') }).catch(() => {});
  const store = await p.evaluate(() => JSON.parse(localStorage.getItem('ftb_bear_swipe_v2')));
  check(store.rounds === 1 && store.seen.length === 20 && Object.keys(store.tastes).length > 0, 'remembers tastes and seen photos');

  // Swipe again starts a fresh round without repeating photos.
  const before = await p.evaluate(() => BearSwipe._state().deck.map(d => d.url));
  await p.click('.bs-again');
  await p.waitForSelector('.bs-top .bs-photo');
  const after = await p.evaluate(() => BearSwipe._state().deck.map(d => d.url));
  const repeats = after.filter(u => before.includes(u));
  if (repeats.length) console.log('repeats:', JSON.stringify(await p.evaluate(r => ({ n: r.length, deck: BearSwipe._state().deck.filter(d => r.includes(d.url)).map(d => d.dish + ':' + d.fresh), idx: BearSwipe._state().deck.map((d, i) => r.includes(d.url) ? i : -1).filter(i => i >= 0), nFresh: BearSwipe._state().deck.filter(d => d.fresh).length, seen: JSON.parse(localStorage.getItem('ftb_bear_swipe_v2')).seen.filter(u => r.includes(u)).length }), repeats)));
  check(repeats.length === 0, 'next round has fresh photos');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('swipe');
})();
