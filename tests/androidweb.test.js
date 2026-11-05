// Inside the Android app the web view has no share sheet, downloads, printing,
// or a way to hand links to Maps. app.js routes those to ShareSheetPlugin.java.
// The plugin is faked here; on the website none of it changes anything.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const a = await newPage(browser, { seed: [
    { id: 's1', name: 'Casa Birria', cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], address: '120 Main St', lat: 33.49, lng: -111.92 },
  ] });
  await a.addInitScript(() => {
    delete Navigator.prototype.share; // like Android's web view
    delete Navigator.prototype.canShare;
    window.__calls = [];
    const log = fn => async o => { window.__calls.push({ ...(o || {}), fn }); };
    window.Capacitor = { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: {
      ShareSheet: { share: log('share'), shareFile: log('shareFile'), openUrl: log('openUrl'), print: log('print') },
    } };
  });
  await a.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await a.goto(`${BASE}/app.html`);
  await a.waitForTimeout(1800);
  await closeAllDialogs(a);
  const calls = () => a.evaluate(() => window.__calls);
  const last = async name => (await calls()).filter(c => c.fn === name).at(-1);

  // Text share.
  await a.evaluate(() => navigator.share({ title: 'T', text: 'Hi', url: 'https://www.feed-the-bear.com/x' }));
  check((await last('share'))?.url === 'https://www.feed-the-bear.com/x', 'text and links open the share sheet');

  // Image share (story cards, Taste DNA).
  const can = await a.evaluate(() => navigator.canShare({ files: [new File(['x'], 'a.png', { type: 'image/png' })] }));
  check(can === true, 'the app says it can share images');
  await a.evaluate(() => navigator.share({ title: 'Card', files: [new File([new Uint8Array([137, 80, 78, 71])], 'card.png', { type: 'image/png' })] }));
  let f = await last('shareFile');
  check(f?.name === 'card.png' && f.mime === 'image/png' && f.base64 === 'iVBORw==', `images go to the share sheet as files (${f?.name} ${f?.base64})`);

  // Downloads: the backup.
  await a.evaluate(() => exportData());
  await a.waitForTimeout(500);
  f = await last('shareFile');
  check(/^feed-the-bear-.*\.json$/.test(f?.name || '') && /json/.test(f.mime) && JSON.parse(atob(f.base64)).length !== undefined, `a download (backup) is handed over as a file (${f?.name})`);

  // Printing.
  await a.evaluate(() => window.print());
  check(!!(await last('print')), 'printing opens Android print');

  // Links to Maps and other sites open outside the app; our own pages don't.
  await a.evaluate(() => window.open('https://www.google.com/maps/dir/?api=1&destination=1,2', '_blank', 'noopener'));
  check((await last('openUrl'))?.url.startsWith('https://www.google.com/maps/dir/'), 'Directions open in Maps');
  await a.evaluate(() => window.open('sms:?body=hi'));
  check((await last('openUrl'))?.url === 'sms:?body=hi', 'texts open the messages app');
  const before = (await calls()).filter(c => c.fn === 'openUrl').length;
  await a.evaluate(() => { try { window.open(location.origin + '/terms.html', '_blank'); } catch { /* popup */ } });
  check((await calls()).filter(c => c.fn === 'openUrl').length === before, 'our own pages are not sent out');
  check(!a.errors.length, `no page errors ${a.errors.join(' | ')}`);

  // Website: untouched.
  const w = await newPage(browser, {});
  await w.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await w.goto(`${BASE}/app.html`);
  await w.waitForTimeout(1200);
  check(await w.evaluate(() => HTMLAnchorElement.prototype.click.toString().includes('[native code]') && window.print.toString().includes('[native code]')), 'the website keeps the browser\'s own download and print');

  await browser.close();
  finish('androidweb');
})();
