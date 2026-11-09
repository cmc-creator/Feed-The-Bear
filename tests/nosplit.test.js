// No button breaks a word across lines ("Directio / ns") on phone widths.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const seed = [{ id: 's1', name: 'LongHorn Steakhouse', cuisine: 'Steakhouse', status: 'visited', myRating: 4, tags: [], visits: [], address: 'Surprise, AZ', website: 'https://longhorn.com' },
    { id: 's2', name: 'Tacos Chiwas', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], address: 'Phoenix, AZ' }];
  for (const width of [320, 360, 390, 412]) {
    const p = await newPage(browser, { seed, viewport: { width, height: 800 } });
    await p.route('**/api/**', r => r.fulfill({ json: {} }));
    await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
    await p.goto(`${BASE}/app.html`);
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.querySelectorAll('.modal-overlay').forEach(o => o.classList.add('hidden')));
    const bad = [];
    for (const v of ['all', 'visited', 'want-to-try']) {
      await p.evaluate(v => setView(v), v);
      await p.waitForTimeout(400);
      bad.push(...await p.evaluate(() => [...document.querySelectorAll('button, a.btn-sm')].filter(el => el.offsetParent && el.innerText.trim()).flatMap(el => {
        const out = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n; (n = walker.nextNode());) {
          const re = /[A-Za-z]{4,}/g; let m;
          while ((m = re.exec(n.textContent))) {
            const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
            if (r.getClientRects().length > 1) out.push(m[0]);
          }
        }
        return out;
      })));
    }
    check(!bad.length, `no split words on buttons at ${width}px${bad.length ? ` (${[...new Set(bad)]})` : ''}`);
    await p.close();
  }
  await browser.close();
  finish('nosplit');
})();
