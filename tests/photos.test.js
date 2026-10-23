// Photo storage: photos move out of the ~5 MB localStorage into IndexedDB,
// come back after reload, and existing users' inline photos migrate.
const path = require('path');
const { BASE, ROOT, check, launch, newPage, finish } = require('./lib');

const photo = name => path.join(ROOT, 'assets', 'food', `${name}.jpg`);

(async () => {
  const browser = await launch();

  // An existing user whose photos are still inline in localStorage.
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], dateAdded: '2026-09-01', visits: [], dishes: [] }] });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  const inline = await p.evaluate(async () => {
    const r = state.restaurants[0];
    const c = document.createElement('canvas'); c.width = 400; c.height = 400;
    const g = c.getContext('2d');
    for (let i = 0; i < 400; i += 8) { g.fillStyle = `hsl(${i},70%,50%)`; g.fillRect(i, 0, 8, 400); }
    r.photo = c.toDataURL('image/jpeg', 0.9);
    r.visits.push({ date: '2026-10-01', photo: r.photo, note: 'old inline photo' });
    // Simulate the old format: photos inline in the saved list.
    localStorage.setItem('ftb_restaurants_v2', JSON.stringify(state.restaurants));
    return localStorage.getItem('ftb_restaurants_v2').length;
  });
  await p.reload();
  await p.waitForTimeout(2000);
  const migrated = await p.evaluate(() => {
    const saved = localStorage.getItem('ftb_restaurants_v2');
    return { savedLen: saved.length, inlineLeft: saved.includes('"data:image/'), refs: (saved.match(/"idb:/g) || []).length, memPhoto: state.restaurants[0].photo.slice(0, 15), visitPhoto: state.restaurants[0].visits[0].photo.slice(0, 15) };
  });
  check(!migrated.inlineLeft && migrated.refs === 2, `inline photos migrate to IndexedDB (${JSON.stringify(migrated)})`);
  check(migrated.savedLen < inline / 4, `saved list shrinks (${inline} -> ${migrated.savedLen} chars)`);
  check(migrated.memPhoto === 'data:image/jpeg' && migrated.visitPhoto === 'data:image/jpeg', 'photos are back in memory after reload');

  // New photos through Just Ate go straight to IndexedDB and survive reload.
  await p.click('#home-quick-justate-btn');
  await p.waitForTimeout(300);
  await p.click('.ja-place[data-id="r1"]');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await chooser.setFiles(photo('ramen'));
  await p.waitForTimeout(700);
  await p.fill('#just-ate-dish', 'Ramen special');
  await p.click('#just-ate-save');
  await p.waitForTimeout(800);
  const afterSave = await p.evaluate(() => localStorage.getItem('ftb_restaurants_v2').includes('"data:image/'));
  check(!afterSave, 'a new photo is not written into localStorage');
  await p.reload();
  await p.waitForTimeout(2000);
  const reloaded = await p.evaluate(() => ({ dish: state.restaurants[0].dishes.find(d => d.name === 'Ramen special')?.photo?.slice(0, 15) }));
  check(reloaded.dish === 'data:image/jpeg', 'new dish photo survives reload');
  await p.evaluate(() => openDetailModal('r1'));
  await p.waitForTimeout(500);
  check(await p.locator('.yo-dish-photo img').count() === 1, 'dish photo renders after reload');
  check(await p.evaluate(() => photosReadyForSync()), 'cloud sync is allowed once photos are restored');

  // Many photos: well past the old ~5 MB ceiling.
  const many = await p.evaluate(async () => {
    const r = state.restaurants[0];
    const c = document.createElement('canvas'); c.width = 800; c.height = 800;
    const g = c.getContext('2d');
    for (let n = 0; n < 60; n++) {
      for (let i = 0; i < 800; i += 4) { g.fillStyle = `hsl(${(i + n * 37) % 360},${40 + (i % 50)}%,${30 + (n % 40)}%)`; g.fillRect(i, (n * 13) % 800, 4, 800); }
      r.dishes.push({ id: 'bulk' + n, name: 'Dish ' + n, verdict: 'ok', photo: c.toDataURL('image/jpeg', 0.92) });
    }
    const mb = r.dishes.reduce((s, d) => s + (d.photo || '').length, 0) / 1e6;
    saveData();
    await new Promise(res => setTimeout(res, 2500));
    return { mb: Math.round(mb * 10) / 10, savedKB: Math.round(localStorage.getItem('ftb_restaurants_v2').length / 1024) };
  });
  await p.reload();
  await p.waitForTimeout(3000);
  const back = await p.evaluate(() => state.restaurants[0].dishes.filter(d => (d.photo || '').startsWith('data:image/')).length);
  check(many.mb > 6 && many.savedKB < 200 && back >= 61, `${many.mb} MB of photos stored; saved list ${many.savedKB} KB; ${back} photos back after reload`);

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('photos');
})();
