// Adding friends by QR code: the code carries a short follow link (so it
// always fits, even with a big profile), and scanning it leads to Follow.
const { BASE, check, launch, newPage, closeAllDialogs, finish, asGrizzly } = require('./lib');
asGrizzly();

(async () => {
  const browser = await launch();
  // A big profile: 15 rated spots with long names and dishes (too long for a QR as a full link).
  const seed = Array.from({ length: 15 }, (_, i) => ({ id: 's' + i, name: `A Restaurant With A Very Long Name Number ${i}`, cuisine: 'Mexican', status: 'visited', myRating: 5,
    address: '1234 Some Long Street Name, Phoenix, AZ 85004', tags: [], visits: [], dishes: [{ id: 'd' + i, name: 'The house special with extra everything', verdict: 'again' }] }));
  const p = await newPage(browser, { seed });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  await p.evaluate(() => localStorage.setItem('ftb_user_v1', JSON.stringify({ name: 'Connie' })));

  const links = await p.evaluate(() => ({ full: buildInviteLink(), short: buildFollowLink(), back: decodeProfileLink(buildFollowLink().split('#')[1] ? '#' + buildFollowLink().split('#')[1] : '') }));
  check(links.full.length > 500 && links.short.length < 300, `the QR link stays short even with a big profile (${links.short.length} vs ${links.full.length} chars)`);
  check(links.back.id && links.back.u === 'Connie', 'and still says who to follow');

  const inked = sel => p.evaluate(s => {
    const c = document.querySelector(s);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 80) dark++;
    return dark;
  }, sel);

  // Friends: Show my QR code.
  await p.evaluate(() => openFoodieFriends());
  await p.click('#friends-qr-btn');
  await p.waitForTimeout(600);
  check(await p.locator('#friends-qr').isVisible() && await inked('#friends-qr-canvas') > 500, 'Friends shows a QR code to follow you');
  check(await p.evaluate(() => state.settings.shareLive === true), 'and starts sharing so the follower gets your picks');
  await closeAllDialogs(p);

  // The profile card's QR shows even though the full profile is long.
  await p.evaluate(() => openFoodieProfile());
  await p.waitForTimeout(600);
  check(await p.locator('#profile-qr-wrap').isVisible() && await inked('#profile-qr') > 500, 'the profile card always has its QR code now');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('qr');
})();
