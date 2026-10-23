// Friends: one user shares a profile link, another follows it and sees the
// friend's orders on matching restaurants. Links are untrusted input.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const SAM = [
  { id: 's1', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], dateAdded: '2026-09-01', visits: [],
    dishes: [{ id: 'a', name: 'Birria quesatacos', verdict: 'again', rating: 5 }, { id: 'b', name: 'Horchata', verdict: 'skip' }] },
  { id: 's2', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'want-to-try', tags: [], dateAdded: '2026-09-02', visits: [],
    dishes: [{ id: 'c', name: 'Rosa pizza', verdict: 'want' }] },
];
const ME = [
  { id: 'm1', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], dateAdded: '2026-09-05', visits: [] },
  { id: 'm2', name: 'Pizzeria Bianco', cuisine: 'Pizza', status: 'want-to-try', tags: [], dateAdded: '2026-09-06', visits: [],
    dishes: [{ id: 'd', name: 'Rosa pizza', verdict: 'want' }] },
];

(async () => {
  const browser = await launch();

  // Sam builds a link.
  const sam = await newPage(browser, { seed: SAM });
  await sam.goto(`${BASE}/app.html`);
  await sam.waitForTimeout(1500);
  const link = await sam.evaluate(() => {
    localStorage.setItem('ftb_user_profile_v1', JSON.stringify({ name: 'Sam' }));
    const data = buildProfileData();
    data.u = 'Sam';
    return encodeProfileLink(data);
  });
  const samId = await sam.evaluate(() => state.settings.profileShareId);
  check(/#profile=/.test(link) && link.length < 4000, `profile link built (${link.length} chars)`);

  // Opening your own link doesn't follow yourself.
  check(await sam.evaluate(l => followFriend(decodeProfileLink(l)) === null, link), 'cannot follow your own link');
  await sam.context().close();

  // I open Sam's link.
  const me = await newPage(browser, { seed: ME });
  const hash = link.slice(link.indexOf('#'));
  await me.goto(`${BASE}/app.html${hash}`);
  await me.waitForTimeout(2000);
  check(await me.locator('#guest-profile-overlay').isVisible(), 'incoming profile link opens the preview');
  check((await me.locator('#guest-profile-name').innerText()) === "Sam's food picks", 'preview shows the friend name');
  check(/Get: Birria quesatacos/.test(await me.locator('#guest-profile-list').innerText()), 'preview shows their go-to order');
  await me.click('#guest-profile-follow');
  await me.waitForTimeout(300);
  check(await me.evaluate(id => getFriends().length === 1 && getFriends()[0].key === `id:${id}`, samId), 'Follow saves the friend');
  await me.click('#guest-profile-close');
  await closeAllDialogs(me);

  // Sam's advice on my matching restaurants.
  await me.evaluate(() => openDetailModal('m1'));
  await me.waitForTimeout(300);
  const tips = (await me.locator('#your-order-list').innerText()).replace(/\s+/g, ' ');
  check(/FRIENDS SAY/i.test(tips) && /Sam/.test(tips) && /get the Birria quesatacos/.test(tips) && /skip the Horchata/.test(tips), `Friends say on the restaurant page ("${tips}")`);
  await closeAllDialogs(me);
  await me.evaluate(() => openDetailModal('m2'));
  await me.waitForTimeout(300);
  check(/wants to try the Rosa pizza/.test(await me.locator('#your-order-list').innerText()), "friend's craving shows on the matching spot");
  await closeAllDialogs(me);

  // Friends screen lists them; the comparison shows shared cravings.
  await me.evaluate(() => openFoodieFriends());
  await me.waitForTimeout(300);
  check(/Following \(1\)/i.test(await me.locator('#friends-list').innerText()), 'Friends screen lists who you follow');
  await me.fill('#friends-link-input', link);
  await me.click('#friends-load-btn');
  await me.waitForTimeout(300);
  const cmp = await me.locator('#friends-result').innerText();
  check(/You both want to try/i.test(cmp) && /Rosa pizza/.test(cmp) && /Their go-to orders/i.test(cmp), 'comparison shows shared cravings and their orders');
  check((await me.locator('.friend-follow-btn').innerText()) === 'Update', 'an already-followed friend offers Update');
  await closeAllDialogs(me);

  // Decision Mode uses the friend's recommendation.
  await me.evaluate(() => { openDecisionMode(); setDecisionModeConstraint('miles', 25); });
  await me.click('#decision-mode-run-btn');
  await me.waitForTimeout(300);
  const why = await me.$$eval('.decision-result-why', es => es.map(e => e.innerText).join(' | '));
  check(/Sam says get the Birria quesatacos|wanting the Rosa pizza/.test(why), `Decision Mode cites the friend (${why})`);
  await closeAllDialogs(me);

  // A hostile link can't run script or break the page.
  const evil = await me.evaluate(() => {
    const payload = { id: 'x', u: '<img src=x onerror="window.__pwned=1">', picks: [{ n: 'Tacos Chiwas', r: 9, g: ['<script>window.__pwned=2</script>'], p: 'javascript:alert(1)' }], w: [{ d: '"><svg onload=window.__pwned=3>', at: 'Tacos Chiwas' }] };
    const link = encodeProfileLink(payload);
    followFriend(decodeProfileLink(link));
    openDetailModal('m1');
    return { stars: getFriends().find(f => f.key === 'id:x').data.picks[0].r, photo: getFriends().find(f => f.key === 'id:x').data.picks[0].p };
  });
  await me.waitForTimeout(500);
  check(!(await me.evaluate(() => window.__pwned)), 'hostile profile link does not execute script');
  check(evil.stars === 5 && evil.photo === '', `hostile values are clamped (stars ${evil.stars}, photo "${evil.photo}")`);
  check(await me.locator('#your-order-list').innerText().then(t => t.includes('<img src=x')), 'hostile name is shown as text, not HTML');

  // Unfollow
  await closeAllDialogs(me);
  await me.evaluate(() => { unfollowFriend('id:x'); openFoodieFriends(); });
  await me.waitForTimeout(200);
  await me.click('.friend-remove');
  await me.waitForTimeout(200);
  check(await me.evaluate(() => getFriends().length === 0), 'unfollow removes friends');

  check(!me.errors.length, `no page errors ${me.errors.join(' | ')}`);
  await browser.close();
  finish('friends');
})();
