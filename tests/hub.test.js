// Discover & Play: six favorites first, themed rows, utilities folded away, search finds everything.
const { BASE, check, launch, newPage, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route(/overpass|nominatim|place-info/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  await p.evaluate(() => openMobileHub());
  await p.waitForTimeout(300);

  const first = await p.$$eval('#mobile-hub-body .hub-section:first-child .hub-card', els => els.map(e => e.dataset.tool));
  check(JSON.stringify(first) === JSON.stringify(['just-ate', 'swipe', 'tonight', 'open-now', 'friends', 'spin']), `six favorites up top (${first})`);
  const visibleCards = await p.$$eval('#mobile-hub-body .hub-card', els => els.length);
  check(visibleCards <= 32, `fewer big cards than before (${visibleCards})`);
  check(await p.locator('#mobile-hub-body .hub-row').count() >= 4, 'themed sections are sideways rows');

  // Utilities are folded until asked for.
  const more = p.locator('#mobile-hub-body details.hub-more');
  check(await more.count() === 1 && !(await more.evaluate(d => d.open)), 'More tools starts folded');
  check(!(await p.locator('[data-tool="export"]').isVisible()), 'Export JSON is tucked away');
  await more.locator('summary').click();
  check(await p.locator('[data-tool="export"]').isVisible(), 'and shows when you open More tools');

  // Every tile has an icon, not a blank square.
  const blank = await p.$$eval('#mobile-hub-body .hub-tile-emoji', els => els.filter(e => !e.textContent.trim()).length);
  check(blank === 0, `no blank tile icons (${blank})`);

  // Dropped overlaps are still one search away, and every tool still works.
  check(await p.locator('[data-tool="digest"]').count() === 0, 'Monthly Digest is not in the main list');
  await p.fill('#mobile-hub-search', 'digest');
  await p.dispatchEvent('#mobile-hub-search', 'input');
  await p.waitForTimeout(200);
  check(await p.locator('[data-tool="digest"]').isVisible(), 'searching finds Monthly Digest');
  const allTools = await p.evaluate(() => HUB_SECTIONS.flatMap(s => s.items.map(i => i[0])));
  const missing = await p.evaluate(tools => tools.filter(t => typeof TOOL_ACTIONS[t] !== 'function'), allTools);
  check(missing.length === 0, `every hub tool has an action (${missing})`);
  check(new Set(allTools).size === allTools.length, 'no tool listed twice');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('hub');
})();
