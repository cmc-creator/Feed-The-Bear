// Share images carry your link (feed-the-bear.com/@you when your public page
// is on, else the site) and a Google Play badge, so each share brings people in.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 's1', name: 'Casa Birria', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  let mine = { handle: 'connie', public: true };
  await p.route(/\/api\/handle/, r => r.fulfill({ json: mine }));
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);

  check(await p.evaluate(() => myShareLink()) === 'feed-the-bear.com', 'signed out: the site');
  await p.evaluate(() => { window._ftbUid = 'u1'; });
  check(await p.evaluate(() => myShareLink()) === 'feed-the-bear.com/@connie', 'with a public page: your page');
  mine = { handle: 'connie', public: false };
  await p.evaluate(() => { window._ftbUid = 'u2'; });
  check(await p.evaluate(() => myShareLink()) === 'feed-the-bear.com', 'page not public: the site (no dead link)');

  // The footer is drawn: the link's text and the badge's words land on the canvas.
  const drawn = await p.evaluate(async () => {
    const texts = [];
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { texts.push(String(t)); return orig.call(this, t, ...a); };
    await StoryCard.drawStory({ kind: 'spot', kicker: 'Been there', title: 'Casa Birria', stars: 5, sections: [] });
    CanvasRenderingContext2D.prototype.fillText = orig;
    return texts;
  });
  check(drawn.includes('feed-the-bear.com') && drawn.includes('GET IT ON') && drawn.includes('Google Play'), `story cards end with your link and a Google Play badge (${drawn.slice(-4).join(' | ')})`);
  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('brand');
})();
