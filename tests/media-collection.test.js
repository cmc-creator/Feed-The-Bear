const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route(/overpass|nominatim|open-meteo|place-info|wikimedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1000);
  await closeAllDialogs(p);
  await p.evaluate(async () => {
    window._ftbPlan = 'grizzly';
    window.__photos = Array.from({ length: 10 }, (_, i) => {
      const c = document.createElement('canvas'); c.width = c.height = 40;
      const g = c.getContext('2d'); g.fillStyle = `rgb(${100 + i},80,40)`; g.fillRect(0, 0, 40, 40);
      return { photo: c.toDataURL() };
    });
    window.__clip = { photo: __photos[0].photo, video: await storeFoodVideo(new Blob(['actual-test-clip'], { type: 'video/mp4' })) };
    window.__realPicker = pickFoodMediaList;
    pickFoodMediaList = async () => window.__batch;
    Cub.openAdd();
  });
  await p.fill('.qa-input', 'Ten Photo Taco Cafe');
  await p.locator('.qa-input').press('Enter');
  await p.click('.qa-status[data-status="visited"]');
  await p.evaluate(() => { window.__batch = __photos; });
  await p.click('#quick-add-overlay [data-source="library"]');
  check(await p.locator('.qa-media-list .pm-item').count() === 10, 'Quick Add keeps ten independently removable photos');
  await p.evaluate(() => { window.__batch = [__clip]; });
  await p.click('.qa-video');
  check(await p.locator('.qa-media-list .pm-item').count() === 11, 'a clip can be added after ten photos without replacing them');
  for (const width of [320, 390]) {
    await p.setViewportSize({ width, height: 740 });
    check(await p.evaluate(() => {
      const strip = document.querySelector('.qa-media-list .pm-strip');
      return document.documentElement.scrollWidth <= innerWidth && strip.getBoundingClientRect().height <= 221
        && [...strip.querySelectorAll('img')].every(img => img.getBoundingClientRect().width === 64)
        && [...strip.querySelectorAll('button')].every(button => button.getBoundingClientRect().height >= 44)
        && document.querySelector('.qa-save').getBoundingClientRect().bottom <= innerHeight
        && document.querySelector('.qa-save').getBoundingClientRect().top >= 0;
    }), `all eleven previews stay compact with tappable cover/removal actions at ${width}px`);
  }
  await p.locator('.qa-cover-pick').nth(4).click();
  check(await p.locator('.qa-cover-pick').first().getAttribute('aria-pressed') === 'true'
    && await p.locator('.qa-cover-pick img').first().getAttribute('src') === await p.evaluate(() => __photos[4].photo),
    'tapping a thumbnail selects that exact personal photo as cover');
  check(await p.evaluate(() => mergeFoodMedia([], [...__photos, __clip, __clip], { notify: false }).length === 11
    && mergeFoodMedia([], [...__photos, __photos[0]], { notify: false }).length === 10),
    'limits are ten photos plus one video, not eleven arbitrary items');
  check(await p.evaluate(() => {
    const r = { photo: 'data:image/jpeg;base64,' + 'a'.repeat(100000),
      media: Array.from({ length: 10 }, () => ({ photo: 'data:image/jpeg;base64,' + 'a'.repeat(100000) })) };
    const copy = cloudSafeRestaurant(r);
    return JSON.stringify(copy).length <= 900 * 1024 && r.media.every(m => m.photo.length > 100000);
  }), 'large root-level photo collections respect cloud budgets without changing device originals');
  check(await p.evaluate(() => {
    const local = { photo: 'cover', media: [{ photo: 'extra-one' }, { photo: 'poster', video: 'clip-one' }] };
    const cloud = { photo: 'new-cover', media: [{ photo: '' }, { photo: '', video: 'clip-one' }], notes: 'New cloud note' };
    restoreTrimmedPhotos(cloud, local);
    return cloud.photo === 'new-cover' && cloud.media[0].photo === 'extra-one'
      && cloud.media[1].photo === 'poster' && cloud.notes === 'New cloud note';
  }), 'cloud restore recovers device-only root photos and clip posters without overwriting newer fields');
  check(await p.evaluate(() => {
    const local = { media: [{ photo: 'old-poster', video: 'old-clip' }] };
    const cloud = { media: [{ photo: '', video: 'new-clip' }] };
    restoreTrimmedPhotos(cloud, local);
    const removed = { media: [] };
    restoreTrimmedPhotos(removed, local);
    return cloud.media[0].photo === '' && removed.media.length === 0;
  }), 'restore never attaches an old poster to a different clip or recreates removed media entries');
  await p.click('.qa-details summary');
  await p.fill('.qa-notes', 'Order the birria. My private food diary.');
  await p.fill('.qa-dish', 'Birria tacos');
  await p.click('.qa-star[data-n="5"]');
  await p.click('.qa-save');
  check(await p.evaluate(() => {
    const r = state.restaurants[0];
    return mediaOf(r).length === 11 && mediaOf(r.visits[0]).length === 11 && mediaOf(r.dishes[0]).length === 11
      && r.notes.includes('private food diary') && r.myRating === 5 && r.photo === __photos[4].photo;
  }), 'saving retains all photos, clip, notes, rating and dish');
  await p.waitForSelector('.sn-media:not([disabled])');
  await p.evaluate(() => {
    navigator.canShare = () => true;
    navigator.share = async data => { window.__sharedCollection = data; };
  });
  await p.click('.sn-go');
  await p.waitForSelector('#story-card-overlay:not(.hidden)');
  await p.click('.story-collection summary');
  check(await p.locator('.story-files button').count() === 11, 'card preview exposes all ten original photos and the actual clip');
  await p.click('.story-share-all');
  check(await p.evaluate(() => __sharedCollection.files.length === 12
    && __sharedCollection.files.filter(f => f.type.startsWith('video/')).length === 1
    && __sharedCollection.files[0].type === 'image/png'
    && !__sharedCollection.text.includes('private food diary')), 'collection shares the cover, ten photos and one clip without private notes');
  const [download] = await Promise.all([p.waitForEvent('download'), p.locator('.story-files button').last().click()]);
  check(download.suggestedFilename().endsWith('.mp4'), 'individual download saves the original clip, not a poster');
  await p.evaluate(() => { navigator.share = async () => { throw new DOMException('Blocked', 'NotAllowedError'); }; });
  await p.click('.story-share-all');
  await p.waitForFunction(() => document.querySelector('.story-collection-status').textContent.includes('blocked'));
  check((await p.locator('.story-collection-status').innerText()).includes('individual'), 'rejected collection sharing gives an explicit individual-file fallback');
  await p.evaluate(() => {
    StoryCard.close();
    navigator.canShare = () => false;
    window.__pending = StoryCard.openStory({ kind: 'spot', title: 'Unsupported collection', media: __photos }, 'caption');
  });
  await p.evaluate(() => window.__pending);
  check(await p.locator('.story-share-all').isDisabled(), 'unsupported multi-file sharing never silently drops originals');
  await p.evaluate(() => { StoryCard.close(); Cub.openAdd(); });
  await p.fill('.qa-input', 'Expanded Cafe');
  await p.locator('.qa-input').press('Enter');
  await p.click('.qa-status[data-status="visited-before"]');
  await p.evaluate(() => { window.__batch = [__photos[0], __clip]; });
  await p.click('#quick-add-overlay [data-source="library"]');
  await p.click('.qa-details summary');
  await p.fill('.qa-notes', 'Keep my notes');
  await p.fill('.qa-dish', 'Chilaquiles');
  await p.click('.qa-star[data-n="4"]');
  await p.click('.qa-more');
  await p.waitForTimeout(150);
  check(await p.evaluate(() => _formMedia.length === 2 && document.getElementById('form-notes').value === 'Keep my notes'
    && state.formRating === 4 && document.querySelector('input[name="form-status"]:checked').value === 'visited'),
    'More details preserves media, notes, rating and visit status');
  await p.click('#modal-save-btn');
  check(await p.evaluate(() => {
    const r = state.restaurants.find(r => r.name === 'Expanded Cafe');
    return r?.dishes[0].name === 'Chilaquiles' && r.dateVisited === null && mediaOf(r).length === 2;
  }), 'advanced-form save preserves the dish, media and unknown past date');
  await p.evaluate(() => { pickFoodMediaList = __realPicker; });
  const errors = p.errors.filter(e => !/Collection sharing failed/.test(e));
  check(!errors.length, `no unexpected page errors (${errors.join(' | ')})`);
  await browser.close();
  finish('media-collection');
})();
