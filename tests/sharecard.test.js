// A spot's Share makes a Story-sized card (photo or cuisine art, rating,
// go-to dish) and the message carries a link back to the app.
const path = require('path');
const { BASE, SHOTS, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Pizzeria Bianco at Town & Country Center', cuisine: 'Pizza', priceRange: 2, status: 'visited', myRating: 5,
    address: '4743 N 20th St, Phoenix, AZ 85016', tags: [], visits: [], dishes: [{ id: 'd', name: 'Rosa pizza', verdict: 'again' }] }] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);

  const out = await p.evaluate(async () => {
    window._ftbUid = 'abcdefghij12345';
    let got = null;
    navigator.canShare = () => true;
    navigator.share = async d => { got = d; };
    openDetailModal('a');
    document.getElementById('detail-share-btn').click();
    for (let i = 0; i < 40 && !got; i++) await new Promise(r => setTimeout(r, 100));
    if (!got) return null;
    const bmp = await createImageBitmap(got.files[0]);
    return { w: bmp.width, h: bmp.height, text: got.text, type: got.files[0].type };
  });
  check(out && out.w === 1080 && out.h === 1920 && out.type === 'image/png', `Share makes a Story-sized image (${out && `${out.w}x${out.h}`})`);
  check(/Pizzeria Bianco/.test(out?.text || '') && /the Rosa pizza/.test(out?.text || ''), 'the message names the spot and the dish to get');
  check(/feed-the-bear\.com\/app\.html\?ref=abcdefghij12345/.test(out?.text || ''), 'and links back with your invite');
  await p.locator('#share-canvas').screenshot({ path: path.join(SHOTS, 'share-card.png') }).catch(() => {});

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('sharecard');
})();
