// The same place saved twice: the list asks, and merging keeps everything
// from both. Two locations of a chain aren't flagged; "They're different" sticks.
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

const spot = (id, name, extra) => ({ id, name, cuisine: 'Mexican', status: 'want-to-try', tags: [], visits: [], dishes: [], dateAdded: '2026-10-01', ...extra });

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [
    spot('a', 'Bacanora', { status: 'visited', myRating: 5, dateAdded: '2026-09-01', lat: 33.4601, lng: -112.0901, tags: ['date night'],
      visits: [{ date: '2026-10-02', rating: 5, dish: 'carne asada' }], dishes: [{ id: 'd1', name: 'Carne asada', verdict: 'again' }] }),
    spot('b', 'Bacanora PHX', { placeId: 'g1', address: '1301 Grand Ave, Phoenix', lat: 33.4602, lng: -112.0902, tags: ['tiktok'],
      links: [{ url: 'https://www.tiktok.com/@x/video/1', added: '2026-10-05' }], dishes: [{ id: 'd2', name: 'Elote', verdict: 'want' }] }),
    // Two locations of one chain, miles apart: not the same place.
    spot('c', 'Pizzeria Bianco', { cuisine: 'Pizza', lat: 33.449, lng: -112.066 }),
    spot('d', 'Pizzeria Bianco', { cuisine: 'Pizza', lat: 33.508, lng: -112.037 }),
  ] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await closeAllDialogs(p);
  await p.evaluate(() => { setView('want-to-try'); renderCards(); });
  await p.waitForTimeout(300);

  const pairs = await p.evaluate(() => findDuplicateSpots().map(([x, y]) => [x.id, y.id].sort().join('')));
  check(JSON.stringify(pairs) === '["ab"]', `"Bacanora" and "Bacanora PHX" next door are flagged, the two Pizzeria Biancos aren't (${pairs})`);
  const banner = await p.locator('.dupe-banner').innerText().catch(() => '');
  check(/Same place saved twice\?/.test(banner) && /Bacanora/.test(banner) && /Bacanora PHX/.test(banner), 'the list asks about it');

  await p.click('.dupe-banner .dupe-merge');
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => ({ n: state.restaurants.length, x: state.restaurants.find(s => /Bacanora/.test(s.name)) }));
  check(r.n === 3 && r.x.id === 'a', 'merging keeps one spot (the one saved first)');
  check(r.x.status === 'visited' && r.x.myRating === 5 && r.x.visits.length === 1, 'with the visit and rating');
  check(r.x.dishes.map(d => d.name).sort().join() === 'Carne asada,Elote', 'and the dishes from both');
  check(r.x.links.length === 1 && r.x.tags.sort().join() === 'date night,tiktok', 'and the TikTok link and both tags');
  check(r.x.placeId === 'g1' && r.x.name === 'Bacanora PHX' && r.x.address === '1301 Grand Ave, Phoenix', 'and the real-place link');
  check(await p.locator('.dupe-banner').count() === 0, 'and the question goes away');
  check(await p.evaluate(() => getDeletedRestaurantIds().includes('b')), "the merged-away copy is marked deleted, so a cloud sync can't bring it back and ask again");

  // "They're different" is remembered.
  await p.evaluate(() => { state.restaurants.push({ id: 'e', name: 'Bacanora PHX', status: 'want-to-try', tags: [], visits: [], dishes: [] }); renderCards(); });
  await p.click('.dupe-banner .dupe-keep');
  await p.evaluate(() => renderCards());
  check(await p.locator('.dupe-banner').count() === 0 && await p.evaluate(() => state.restaurants.length) === 4, '"They\'re different" keeps both and stops asking');

  // Several duplicates at once: a count, and Merge all.
  await p.evaluate(() => {
    const s = (id, name) => ({ id, name, cuisine: 'Thai', status: 'want-to-try', tags: [], visits: [], dishes: [], dateAdded: '2026-10-0' + id.slice(1) });
    state.restaurants.push(s('t1', 'Lotus of Siam'), s('t2', 'Lotus of Siam'), s('t3', 'Lotus of Siam'), s('u1', 'Pho Cao'), s('u2', 'Pho Cao'));
    renderCards();
  });
  const many = await p.locator('.dupe-banner').innerText();
  check(/1 of 3/.test(many) && /Merge all 3/.test(many), `it says how many are left and offers Merge all (${many.replace(/\s+/g, ' ')})`);
  await p.click('.dupe-banner .dupe-merge-all');
  await p.waitForTimeout(300);
  const left = await p.evaluate(() => state.restaurants.filter(r => /Lotus|Pho Cao/.test(r.name)).map(r => r.id).sort().join());
  check(left === 't1,u1' && await p.locator('.dupe-banner').count() === 0, `Merge all folds every copy into one and stops asking (${left})`);

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('dupes');
})();
