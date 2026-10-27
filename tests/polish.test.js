// Things an audit found broken: letter-code placeholders, an empty map, and more.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

// Local calendar date, as the app saves it.
const day = n => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const SEED = [
  { id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, lat: 33.4936, lng: -111.9256, tags: [], dishes: [], visits: [{ date: day(2), rating: 5, note: '' }] },
  { id: 'r2', name: 'Thai Basil', cuisine: 'Thai', status: 'want-to-try', myRating: 0, googleRating: 3.1, lat: 33.51, lng: -111.91, tags: [], dishes: [], visits: [] },
  { id: 'r3', name: 'Bourbon Steak', cuisine: 'Steakhouse', status: 'visited', myRating: 3, lat: 33.52, lng: -111.93, tags: [], dishes: [], visits: [] },
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.addInitScript(() => localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie', avatar: 'CHEF' })));
  await p.route(/overpass|nominatim/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);

  // Avatars are pictures, and old text codes map to a bear.
  check(await p.locator('#header-avatar svg.bear-avatar').count() === 1, 'the header shows a bear avatar, not letters');
  await p.evaluate(() => openEditProfile());
  check(await p.locator('#edit-avatar-grid .avatar-option svg').count() === 12, '12 bear avatars to choose from');
  check(await p.locator('#edit-avatar-grid .avatar-option.selected').getAttribute('data-emoji') === 'bear-chef', 'an old "CHEF" profile picks the chef bear');
  await closeAllDialogs(p);

  // No letter codes standing in for icons.
  check(await p.evaluate(() => cuisineEmoji('Mexican') === '🌮' && cuisineEmoji('Irish') === '☘️' && cuisineEmoji('Nope') === '🍽️'), 'cuisines get food emoji');
  const codes = await p.$$eval('.aar-icon, #proximity-icon, .export2-icon', els => els.map(e => e.textContent.trim()).filter(t => /^[A-Z]{2,6}$/.test(t)));
  check(codes.length === 0, `menu icons are not letter codes (${codes.join(', ')})`);
  check(await p.evaluate(() => _FTB_GOOD.every(Boolean) && _FTB_BAD.every(Boolean)), 'Feed the Bear has food to catch');
  await p.evaluate(() => openFortune());
  check((await p.locator('#fortune-cookie').innerText()).trim() === '🥠', 'Food Fortune shows a cookie to tap');
  await closeAllDialogs(p);

  // Header average is your own rating (5 and 3), not Google's.
  check((await p.locator('#stat-avg').innerText()).trim() === '4.0', `Avg Rating uses your ratings (${await p.locator('#stat-avg').innerText()})`);

  // The map shows your saved spots.
  await p.locator('[data-view="map"]:visible').first().click();
  await p.waitForTimeout(1500);
  check(await p.evaluate(() => state.mapMarkers.length) === 3, `the map has a pin for each saved spot (${await p.evaluate(() => state.mapMarkers.length)})`);
  await p.locator('[data-view="all"]:visible').first().click().catch(() => {});

  // Mood calendar colors the day you ate out.
  await p.evaluate(() => openMoodCal());
  const d = new Date(Date.now() - 2 * 86400000);
  if (d.getMonth() === new Date().getMonth()) {
    const marked = await p.$$eval('#moodcal-grid .has-visit', els => els.map(e => e.dataset.day));
    check(marked.includes(String(d.getDate())), `the mood calendar marks the visit (${marked})`);
  }
  await closeAllDialogs(p);

  // Several badges at once: one celebration, not a stack of popups.
  await p.evaluate(() => { localStorage.removeItem('ftb_xp_v1'); document.querySelectorAll('.toast').forEach(t => t.remove()); });
  const toastsBefore = await p.locator('.toast').count();
  await p.evaluate(() => checkAchievements());
  await p.waitForTimeout(400);
  check(await p.locator('.toast').count() - toastsBefore <= 1, 'unlocking several badges shows at most one toast');

  // Chat avatars are pictures.
  await p.evaluate(() => { openChat(); addChatMsg('hi', 'bot'); addChatMsg('hello', 'user'); });
  check(await p.locator('.chat-msg.bot .chat-msg-avatar img').count() > 0 && await p.locator('.chat-msg.user .chat-msg-avatar svg').count() > 0, 'chat shows Cub and your bear, not "BC"/"YOU"');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  await browser.close();
  finish('polish');
})();
