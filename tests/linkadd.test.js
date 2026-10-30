// "Saw it on TikTok": paste or share a food post and it lands on Want to
// Try with the dish (the server half is linkspot.test.js; here it is faked).
const { BASE, check, launch, newPage, finish } = require('./lib');

const TIKTOK = 'https://www.tiktok.com/@phxeats/video/7312345678901234567';

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [] }] });
  await p.route(/wikimedia|overpass|nominatim/, r => r.abort());
  const asked = [];
  await p.route('**/api/link-spot**', r => {
    const q = new URL(r.request().url()).searchParams.get('q');
    asked.push(q);
    if (/nothing/.test(q)) return r.fulfill({ json: { places: [], guess: null, error: 'We could not tell which restaurant that is. Try typing its name.' } });
    return r.fulfill({ json: {
      caption: 'The best birria in Phoenix', guess: { name: 'Tacos Chiwas', city: 'Phoenix', dish: 'Birria tacos' },
      places: [
        { name: 'Tacos Chiwas', address: '1923 E McDowell Rd, Phoenix, AZ', lat: 33.4655, lng: -112.0397, rating: 4.6, type: 'mexican_restaurant' },
        { name: 'Tacos Chiwas Chandler', address: '1 S Arizona Ave, Chandler, AZ', lat: 33.30, lng: -111.84, rating: 4.5, type: 'mexican_restaurant' },
      ],
    } });
  });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(2000);

  // ── Paste a TikTok link into Add a spot ──
  await p.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); window.Cub.openAdd(); });
  check(/TikTok, Instagram/.test(await p.locator('.qa-input').getAttribute('placeholder')), 'the add box says links from TikTok and Instagram work');
  await p.fill('.qa-input', TIKTOK);
  await p.waitForSelector('.qa-sugg', { timeout: 5000 }).catch(() => {});
  const suggs = await p.$$eval('.qa-sugg strong', els => els.map(e => e.textContent));
  check(asked[0] === TIKTOK && suggs[0] === 'Tacos Chiwas', `the post is read and the restaurant offered (${suggs.join(', ')})`);
  await p.click('.qa-sugg >> nth=0');
  check(await p.locator('.qa-status[data-status="want-to-try"]').evaluate(b => b.classList.contains('active')), 'it goes on Want to Try by default');
  check((await p.locator('.qa-dish').inputValue()) === 'Birria tacos', 'the dish from the video is filled in');
  await p.click('.qa-save');
  const saved = await p.evaluate(() => {
    const r = state.restaurants.find(x => x.name === 'Tacos Chiwas');
    return r && { status: r.status, lat: r.lat, address: r.address, crave: (r.dishes || []).find(d => d.verdict === 'want')?.name };
  });
  check(saved?.status === 'want-to-try' && saved.lat === 33.4655 && /McDowell/.test(saved.address), 'saved with its address and map pin');
  check(saved?.crave === 'Birria tacos', 'the dish is on the Crave List');

  // A post with no restaurant in it says so.
  await p.evaluate(() => window.Cub.openAdd());
  await p.fill('.qa-input', 'https://www.instagram.com/p/nothing123/');
  await p.waitForTimeout(800);
  check(/could not tell which restaurant/.test(await p.locator('.qa-suggs').innerText()), 'a post without a restaurant asks for the name');
  await p.evaluate(() => window.Cub.close());

  // ── Shared from the TikTok app (Android share sheet → app.html?text=…) ──
  await p.goto(`${BASE}/app.html?title=${encodeURIComponent('TikTok')}&text=${encodeURIComponent('Check this out ' + TIKTOK)}`);
  await p.waitForTimeout(2500);
  check(await p.locator('#quick-add-overlay').isVisible() && /Tacos Chiwas/.test(await p.locator('.qa-suggs').innerText()), 'sharing a TikTok to the app opens Add a spot with the restaurant');
  check(await p.locator('#add-modal, #add-overlay').evaluateAll(els => els.every(e => e.classList.contains('hidden'))), 'it does not open the long form');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  await browser.close();
  finish('linkadd');
})();
