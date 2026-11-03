// An account is required, and the free plan is small: signed out, the sign-in
// sheet can't be closed; a free account gets 25 spots, and Friends, Dinner
// Vote, Bear Swipe and Today's Pick pitch Grizzly instead of opening.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const SEED = [
  { id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], dateAdded: '2026-09-01', visits: [] },
  { id: 'r2', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'want-to-try', tags: [], dateAdded: '2026-09-02', visits: [] },
  { id: 'r3', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], dateAdded: '2026-09-03', visits: [] },
];

async function upgradeTitle (p) {
  await p.waitForSelector('#upgrade-overlay:not(.hidden)', { timeout: 3000 }).catch(() => {});
  return (await p.locator('#upgrade-title').innerText().catch(() => '')).trim();
}

(async () => {
  const browser = await launch();

  // ── Signed out: the sign-in sheet stays up ──
  let p = await newPage(browser, { seed: SEED });
  await p.addInitScript(() => localStorage.setItem('ftb_test_auth_gate', '1'));
  await p.goto(`${BASE}/app.html`);
  await p.waitForSelector('#auth-overlay.auth-required:not(.hidden)', { timeout: 15000 }).catch(() => {});
  const auth = p.locator('#auth-overlay');
  check(await auth.isVisible() && await auth.evaluate(el => el.classList.contains('auth-required')), 'signed out, the sign-in sheet covers the app');
  check(await p.locator('#auth-close-btn').isHidden(), 'it has no close button');
  check(/Create/.test(await p.locator('#auth-title').innerText()), 'it starts on creating an account');
  check(/spots on this phone come with you/.test(await p.locator('#auth-overlay .auth-sub').innerText()), 'someone with spots on the phone is told they come along');
  await p.keyboard.press('Escape');
  await p.mouse.click(5, 5);
  await p.evaluate(() => closeAuthModal());
  check(await auth.isVisible(), 'Escape, tapping outside or closing it in code does not dismiss it');
  await p.close();

  // ── Free account: 25 spots and the Grizzly-only features ──
  p = await newPage(browser, { seed: SEED });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2000);
  await p.evaluate(() => { window._ftbUid = 'freeUser000001'; window._ftbPlan = 'free'; renderAll(); });
  check(await p.evaluate(() => FREE_RESTAURANT_LIMIT) === 25, 'a free account holds 25 spots');

  for (const [label, run, title] of [
    ['Inviting a friend', () => inviteFriend(), 'Eat with all your friends'],
    ['Dinner Vote', () => runToolAction('rooms'), 'End the "where should we eat" debate'],
    ['Swipe to Decide', () => runToolAction('swipe'), 'Find out what you are craving'],
  ]) {
    await closeAllDialogs(p);
    await p.evaluate(run);
    check(await upgradeTitle(p) === title, `${label} pitches Grizzly for a free account`);
    check(await p.locator('#friends-overlay, #dinner-rooms-overlay, #swipe-overlay').evaluateAll(els => els.every(e => e.classList.contains('hidden'))), `${label} does not open`);
  }
  await closeAllDialogs(p);
  await p.evaluate(() => runToolAction('friends'));
  check(await p.locator('#friends-overlay').isVisible(), 'a free account can open Friends (to find the one friend it can follow)');
  await closeAllDialogs(p);
  check(!!(await p.evaluate(() => followFriend({ id: 'abc', u: 'Sam', picks: [], w: [] }))) && await p.evaluate(() => getFriends().length) === 1, 'a free account can follow one friend');
  check(await p.evaluate(() => followFriend({ id: 'def', u: 'Alex', picks: [], w: [] })) === null && await p.evaluate(() => getFriends().length) === 1, 'but not a second');
  await p.evaluate(() => unfollowFriend('id:abc'));

  await closeAllDialogs(p);
  const shown = await p.evaluate(() => showLocalDailyPick());
  if (shown) {
    check(/unlock it with Grizzly/.test(await p.locator('#ai-rec-text').innerText()) && !/Tacos Chiwas|Pizzeria Bianco|The Mission/.test(await p.locator('#ai-rec-text').innerText()), "Today's Pick is locked and doesn't give the pick away");
    await p.evaluate(() => document.getElementById('ai-rec-banner').click());
    check(await upgradeTitle(p) === "Today's Pick, every meal", "tapping Today's Pick pitches Grizzly");
  }

  await p.evaluate(() => openMobileHub());
  await p.waitForTimeout(300);
  check(await p.locator('.hub-tile[data-tool="friends"] .hub-lock, .hub-card[data-tool="friends"] .hub-lock').count() === 0, 'Friends has no lock in the hub (free accounts follow one friend)');
  check(await p.locator('.hub-tile[data-tool="rooms"] .hub-lock, .hub-card[data-tool="rooms"] .hub-lock').count() > 0, 'Dinner Vote still carries a GRIZZLY badge');
  await p.evaluate(() => closeMobileHub());

  // ── Grizzly: everything opens ──
  await closeAllDialogs(p);
  await p.evaluate(() => { window._ftbPlan = 'grizzly'; renderAll(); });
  await p.evaluate(() => runToolAction('friends'));
  check(await p.locator('#friends-overlay').isVisible(), 'Friends opens for Grizzly');
  await closeAllDialogs(p);
  await p.evaluate(() => runToolAction('rooms'));
  check(await p.locator('#dinner-rooms-overlay').isVisible(), 'Dinner Vote opens for Grizzly');
  await closeAllDialogs(p);
  if (await p.evaluate(() => showLocalDailyPick())) {
    check(/Tacos Chiwas|Pizzeria Bianco|The Mission/.test(await p.locator('#ai-rec-text').innerText()), "Grizzly sees Today's Pick");
  }

  check(!p.errors.length, `no page errors (${p.errors.slice(0, 3).join(' | ')})`);
  await browser.close();
  finish('signin');
})();
