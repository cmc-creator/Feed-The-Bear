// Import an old "places to try" list from a notes app: pasted text, a list
// shared into the app, and exported files (Google Keep Takeout, plain text).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const KEEP_PASTE = [
  'Restaurants to try',
  '☐ Tacos Chiwas - get the birria',
  '☐ Pizzeria Bianco',
  '☑ Nobu, 105 Hudson St, New York',
  '• Lou Malnati\'s (deep dish)',
  '1. Franklin Barbecue: go early',
  '- [x] Joe\'s Pizza',
  '☐ pizzeria bianco',
  '',
  'https://maps.app.goo.gl/abc123 Bacanora',
  '☐ The Mission',
].join('\n');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'm', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);

  // The parser on its own.
  const parsed = await p.evaluate(t => parseImportSource(t), KEEP_PASTE);
  const byName = Object.fromEntries(parsed.map(x => [x.name, x]));
  check(!byName['Restaurants to try'], 'the note title is skipped');
  check(byName['Tacos Chiwas']?.note === 'get the birria', `"name - note" splits (${JSON.stringify(byName['Tacos Chiwas'])})`);
  check(byName['Nobu']?.address === '105 Hudson St, New York' && byName['Nobu'].checked, 'a ticked line with an address keeps both');
  check(byName["Lou Malnati's"]?.note === 'deep dish', 'parentheses become a note');
  check(byName['Franklin Barbecue']?.note === 'go early', 'numbered "name: note" works');
  check(byName["Joe's Pizza"]?.checked === true, 'Markdown [x] counts as ticked');
  check(byName['Bacanora']?.website === 'https://maps.app.goo.gl/abc123', 'a link on the line becomes the website');

  // Paste, preview, untick one, import.
  await p.evaluate(() => showImportBookmarks());
  await p.fill('#import-paste-area', KEEP_PASTE);
  await p.click('#import-parse-btn');
  const rows = await p.$$eval('#import-preview .import-row-name', es => es.map(e => e.textContent));
  check(rows.filter(n => /pizzeria bianco/i.test(n)).length === 1, `duplicates in the list collapse (${rows})`);
  check(await p.locator('#import-preview .import-row.is-dupe').count() === 1, 'a spot you already saved is flagged');
  check(!(await p.locator('#import-preview .import-row.is-dupe input').isChecked()), 'and left unticked');
  await p.locator('#import-preview .import-row', { hasText: 'Franklin Barbecue' }).locator('input').uncheck();
  const label = await p.locator('#import-confirm-btn').innerText();
  check(/Import 6 \(2 to Visited\)/.test(label), `button counts what will happen (${label})`);
  await p.click('#import-confirm-btn');
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => state.restaurants.map(r => ({ n: r.name, s: r.status, note: r.notes })));
  const find = n => after.find(x => x.n === n);
  check(find('Tacos Chiwas')?.s === 'want-to-try' && find('Tacos Chiwas').note === 'get the birria', 'imported to Want to Try with the note');
  check(find('Nobu')?.s === 'visited', 'ticked items go to Visited');
  check(!find('Franklin Barbecue'), 'unticked rows are skipped');
  check(after.filter(x => x.n === 'The Mission').length === 1, 'the existing spot is not duplicated');
  await closeAllDialogs(p);

  // Free plan limit: only what fits is imported.
  const limited = await p.evaluate(() => {
    const before = state.restaurants.length;
    showImportBookmarks(Array.from({ length: 20 }, (_, i) => `Spot number ${i + 1}`).join('\n'));
    confirmImport();
    return { before, after: state.restaurants.length, limit: FREE_RESTAURANT_LIMIT };
  });
  check(limited.after === limited.limit, `free import stops at the limit (${JSON.stringify(limited)})`);
  await closeAllDialogs(p);

  // A list shared in from a notes app opens the import, not Add Restaurant.
  const p2 = await newPage(browser, { seed: [] });
  await p2.route(/overpass|nominatim|place-info|open-meteo/, r => r.abort());
  await p2.goto(`${BASE}/app.html?text=${encodeURIComponent('Places to try\n☐ Tacos Chiwas\n☐ Pizzeria Bianco\n☐ Bacanora')}`);
  await p2.waitForTimeout(1800);
  check(await p2.locator('#import-overlay').isVisible(), 'a shared list opens the import');
  check(await p2.locator('#import-preview .import-row').count() === 3, 'with the places already previewed');
  check(await p2.locator('#modal-overlay').isHidden().catch(() => true), 'and not the Add Restaurant form');

  // The empty list offers the import.
  await closeAllDialogs(p2);
  check(await p2.locator('#empty-import-btn').isVisible(), 'an empty list offers to import from notes');

  // Files: Google Keep Takeout JSON + HTML and a Samsung Notes text file, picked together.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftb-notes-'));
  const keepJson = path.join(dir, 'Food list.json');
  fs.writeFileSync(keepJson, JSON.stringify({ title: 'Food list', isTrashed: false, listContent: [
    { text: 'Kai Restaurant', isChecked: false }, { text: 'Binkley\'s', isChecked: true }] }));
  const keepHtml = path.join(dir, 'Brunch.html');
  fs.writeFileSync(keepHtml, '<html><body><div class="note"><div class="title">Brunch</div><div class="content"><ul class="list">'
    + '<li class="listitem"><span class="bullet">&#9744;</span><span class="text">Snooze</span></li>'
    + '<li class="listitem checked"><span class="bullet">&#9745;</span><span class="text">Hash Kitchen</span></li></ul></div></div></body></html>');
  const samsung = path.join(dir, 'Weekend eats.txt');
  fs.writeFileSync(samsung, 'Weekend eats\nCafe Monarch - tasting menu\nSt. Francis\n');
  await p2.evaluate(() => showImportBookmarks());
  const [chooser] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('.import-file-btn')]);
  await chooser.setFiles([keepJson, keepHtml, samsung]);
  await p2.waitForTimeout(800);
  const fileRows = await p2.$$eval('#import-preview .import-row', es => es.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  const has = n => fileRows.some(r => r.includes(n));
  check(['Kai Restaurant', "Binkley's", 'Snooze', 'Hash Kitchen', 'Cafe Monarch', 'St. Francis'].every(has), `all three files parse (${fileRows.join(' | ')})`);
  check(!has('Weekend eats') && !has('Brunch') && !has('Food list'), 'note titles are skipped');
  check(fileRows.some(r => r.includes("Binkley's") && /Been there/i.test(r)) && fileRows.some(r => r.includes('Hash Kitchen') && /Been there/i.test(r)), 'Keep ticked items are marked Been there');
  fs.rmSync(dir, { recursive: true, force: true });

  check(!p.errors.length && !p2.errors.length, `no page errors ${[...p.errors, ...p2.errors].join(' | ')}`);
  await browser.close();
  finish('notesimport');
})();
