// Play's arcade games (games.js) and the photo bear avatars.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Casa', status: 'visited', tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);

  // Avatars: photo bears first, and a picked one shows as a picture everywhere.
  const av = await p.evaluate(() => ({ first: AVATAR_OPTIONS[0], html: avatarSvg('pic-tacos'), old: avatarSvg('bear-chef').startsWith('<svg'), bad: normalizeAvatar('pic-nope') }));
  check(av.first === 'pic-tacos' && /<img[^>]+assets\/avatars\/bear-tacos\.jpg/.test(av.html) && av.old && av.bad === 'bear-chef', 'photo bear avatars come first; drawn bears and old codes still work');
  check(await p.evaluate(async () => (await fetch('assets/avatars/bear-birthday.jpg')).ok), 'the bear pictures are there');

  // Play lists the games.
  await p.evaluate(() => openMobileHub());
  await p.waitForTimeout(300);
  const titles = await p.locator('.hub-card-title').allInnerTexts();
  check(['Food Fight', 'Bear Burger Bar', 'Food Match'].every(t => titles.includes(t)), `Play has Food Fight, Burger Bar and Food Match (${titles.slice(0, 8)})`);
  await p.evaluate(() => closeMobileHub());

  // Food Match: solve it by peeking at the faces.
  await p.evaluate(() => openFoodMatch());
  const faces = await p.locator('.match-face').allInnerTexts();
  const pairs = {};
  faces.forEach((f, i) => (pairs[f] ||= []).push(i));
  for (const [a, b] of Object.values(pairs)) {
    await p.locator('.match-card').nth(a).click();
    await p.locator('.match-card').nth(b).click();
  }
  await p.waitForSelector('.game-over', { timeout: 3000 }).catch(() => {});
  check(/All matched!/.test(await p.locator('.game-over').innerText().catch(() => '')) && /8 moves/.test(await p.locator('.game-over').innerText().catch(() => '')), 'Food Match: finding all 8 pairs ends the game with the moves');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('ftb_game_best_v1')).match) === 8, 'and keeps the best score');

  // Food Fight: feed a bear, avoid the raccoon.
  await p.evaluate(() => openFoodFight());
  await p.click('#fight-go');
  await p.waitForSelector('.fight-critter:not(.raccoon)', { timeout: 5000 });
  await p.locator('.fight-critter:not(.raccoon)').first().dispatchEvent('pointerdown');
  check(Number(await p.textContent('#fight-score')) >= 1, 'Food Fight: feeding a bear scores');
  await p.evaluate(() => {
    const h = document.querySelector('.fight-hole');
    const r = document.createElement('button'); r.className = 'fight-critter raccoon'; h.appendChild(r);
    r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  check(Number(await p.textContent('#fight-score')) === 0, 'feeding the raccoon costs points');

  // Bear Burger Bar: build the order bottom to top.
  await p.evaluate(() => openBurgerBar());
  await p.click('#bar-go');
  const order = await p.evaluate(() => [...document.querySelectorAll('.bar-need')].map(n => n.title));
  const wrong = ['Patty', 'Cheese'].find(t => t !== order[0]);
  await p.locator('.bar-btn', { hasText: wrong }).first().click();
  check(await p.locator('.bar-stack span').count() === 0, 'Burger Bar: a wrong ingredient is not added');
  for (const t of order) await p.locator('.bar-btn', { hasText: t }).first().click();
  check(Number(await p.textContent('#bar-score')) === order.length * 2, `a finished order scores (${order.join(' > ')})`);
  await p.evaluate(() => closeGame());
  check(await p.locator('#game-overlay').isHidden(), 'the ✕ closes the game');
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);

  // Feed the Bear draws the bear mascot (it was once an empty emoji).
  const bearPx = await p.evaluate(async () => {
    document.querySelectorAll('.modal-overlay').forEach(o => o.classList.add('hidden'));
    openFeedBearGame();
    await new Promise(r => setTimeout(r, 600)); _ftbDrawIdle();
    const c = document.getElementById('feedbear-canvas'), x = c.getContext('2d');
    const d = x.getImageData(Math.round(c.width / 2) - 10, Math.round(c.height * 0.49) - 10, 20, 20).data;
    let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++;
    closeFeedBearGame(); return lit;
  });
  check(bearPx > 100, `Feed the Bear shows the bear (${bearPx}/400 bear pixels)`);
  await browser.close();
  finish('games');
})();
