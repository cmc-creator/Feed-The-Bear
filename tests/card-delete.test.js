const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  try {
    for (const viewport of [{ width: 412, height: 915 }, { width: 1280, height: 900 }]) {
      const p = await newPage(browser, { viewport, seed: [
        { id: 'visited', name: 'Been Here Cafe', status: 'visited', myRating: 4, tags: [], visits: [{ date: '2026-10-01', note: 'Soup' }], dishes: [] },
        { id: 'want', name: 'Want to Try Restaurant', status: 'want-to-try', tags: [], visits: [], dishes: [] },
      ] });
      await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
      await p.route('**/api/food-events**', r => r.fulfill({ json: { events: [], at: Date.now() } }));
      await p.goto(`${BASE}/app.html`);
      await p.waitForTimeout(1200);
      await closeAllDialogs(p);
      await p.evaluate(() => setView('want-to-try'));
      const want = p.locator('.restaurant-card[data-id="want"]');
      check(await want.locator('[data-action="delete"]').isVisible(), `Delete is visible on Want to Try @${viewport.width}`);
      check(await want.locator('[data-action="delete"]').getAttribute('aria-label') === 'Delete Want to Try Restaurant', 'Delete is labelled with the restaurant name');
      const actions = await want.locator('.card-actions button').allInnerTexts();
      check(actions.join(',').includes('Plan This') && actions[actions.length - 2].trim() === 'Edit' && actions[actions.length - 1].trim() === 'Delete', 'card includes Plan, Edit and Delete beside each other');
      p.once('dialog', dialog => dialog.dismiss());
      await want.locator('[data-action="delete"]').click();
      check(await p.evaluate(() => state.restaurants.some(r => r.id === 'want')) && await want.count() === 1, 'cancelling Delete keeps the place and its card');
      check(await p.locator('#detail-overlay').isHidden(), 'Delete click never opens the detail screen');
      await p.evaluate(() => {
        window._ftbUid = 'deleteTestUser';
        window.__deletedInCloud = [];
        window.fbDeleteRestaurantsCloud = (uid, ids) => { window.__deletedInCloud.push({ uid, ids }); };
      });
      let message = '';
      p.once('dialog', async dialog => { message = dialog.message(); await dialog.accept(); });
      const button = want.locator('[data-action="delete"]');
      await button.focus();
      await p.keyboard.press('Enter');
      check(/Want to Try Restaurant/.test(message) && /cannot be undone/.test(message), 'keyboard Delete asks for confirmation with the place name');
      check(await p.evaluate(() => !state.restaurants.some(r => r.id === 'want')) && await want.count() === 0, 'confirmed Delete removes the place and rerenders its list');
      check(await p.locator('#detail-overlay').isHidden(), 'keyboard action does not bubble into opening the card');
      check(await p.evaluate(() => getDeletedRestaurantIds().includes('want')), 'card deletion records the sync tombstone so the place cannot return');
      check(await p.evaluate(() => window.__deletedInCloud.some(call => call.uid === 'deleteTestUser' && call.ids.includes('want'))), 'card deletion uses the existing cloud deletion flow');
      check(await p.evaluate(() => !JSON.parse(localStorage.getItem(STORAGE_KEY)).some(r => r.id === 'want')), 'deletion is persistent in local storage');
      await p.evaluate(() => { setView('visited'); applyThemeChoice('light', { persist: false }); });
      const visited = p.locator('.restaurant-card[data-id="visited"]');
      check(await visited.locator('[data-action="delete"]').isVisible() && await visited.locator('[data-action="edit"]').isVisible(), 'Been There also exposes Edit and Delete in light theme');
      p.once('dialog', dialog => dialog.dismiss());
      await visited.locator('[data-action="delete"]').click();
      check(await p.evaluate(() => state.restaurants.find(r => r.id === 'visited').visits[0].note === 'Soup'), 'cancelling visited-place deletion preserves visit history');
      p.once('dialog', dialog => dialog.accept());
      await visited.locator('[data-action="delete"]').click();
      check(await p.evaluate(() => state.restaurants.length === 0), 'visited-place Delete removes the selected place');
      check(!p.errors.length, `no card deletion errors @${viewport.width} (${p.errors.join(' | ')})`);
      await p.context().close();
    }
  } finally { await browser.close(); }
  finish('card-delete');
})().catch(err => { console.error(err); process.exitCode = 1; });
