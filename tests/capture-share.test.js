const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'Taco Cafe', status: 'visited', tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|open-meteo/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1000);
  await closeAllDialogs(p);
  await p.evaluate(() => { window._ftbUid = 'test-member'; window._ftbPlan = 'grizzly'; });
  const photo = path.join(ROOT, 'assets', 'food', 'tacos.jpg');

  await p.evaluate(() => Cub.openAdd());
  await p.fill('.qa-input', 'Capture Cafe');
  await p.locator('.qa-input').press('Enter');
  await p.click('.qa-status[data-status="visited"]');
  check(await p.locator('#quick-add-overlay [data-source="library"]').innerText() === 'Choose photos or video',
    'existing photo selection is explicitly labelled separately from taking a new photo');

  for (const [source, accept, capture] of [['photo', 'image/*', 'environment'], ['video', 'video/*', 'environment'], ['library', 'image/*,video/*', null]]) {
    const [chooser] = await Promise.all([
      p.waitForEvent('filechooser'),
      p.click(`#quick-add-overlay [data-source="${source}"]`),
    ]);
    const attrs = await chooser.element().evaluate(el => ({ accept: el.accept, capture: el.getAttribute('capture'), multiple: el.multiple }));
    check(attrs.accept === accept && attrs.capture === capture && attrs.multiple === (source === 'library'),
      `${source} launches the correct camera or multi-select gallery intent (${JSON.stringify(attrs)})`);
    check(await p.locator('.qa-save').isDisabled(), 'save is disabled while the picker is open');
    await chooser.element().dispatchEvent('cancel');
    await p.waitForFunction(() => !foodMediaBusy());
    check(await p.locator('.qa-save').isEnabled(), 'cancel restores the save button without leaving a stuck job');
  }

  await p.evaluate(() => {
    window.__realMediaFromFile = mediaFromFile;
    mediaFromFile = file => new Promise(resolve => { window.__finishMedia = async () => resolve(await window.__realMediaFromFile(file)); });
  });
  let [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.qa-photo')]);
  await chooser.setFiles(photo);
  await p.waitForFunction(() => !!window.__finishMedia);
  check(await p.locator('.qa-save').isDisabled(), 'save stays disabled while the photo is compressed');
  await p.evaluate(() => document.querySelector('.qa-save').click());
  check(await p.evaluate(() => !state.restaurants.some(r => r.name === 'Capture Cafe')), 'saving during processing cannot create a place without its attachment');
  await p.evaluate(() => window.__finishMedia());
  await p.waitForFunction(() => !foodMediaBusy());
  await p.click('.qa-save');
  await p.waitForSelector('.share-nudge.in .sn-media:not([disabled])');
  check(await p.evaluate(() => !!state.restaurants.find(r => r.name === 'Capture Cafe')?.photo), 'the completed attachment is stored with the new place');
  check(await p.locator('.share-nudge .sn-go').isVisible() && await p.locator('.share-nudge .sn-x').isVisible(),
    'Quick Add immediately offers direct sharing, a Story card and Done');

  await p.evaluate(() => {
    navigator.canShare = () => true;
    navigator.share = async data => { window.__shared = { type: data.files?.[0]?.type, text: data.text }; };
  });
  await p.click('.share-nudge .sn-media');
  check(await p.evaluate(() => window.__shared?.type.startsWith('image/') && /Capture Cafe/.test(window.__shared.text)),
    'direct share passes the actual photo file and spot caption to the native share sheet');
  await p.evaluate(() => { navigator.share = async () => { throw new DOMException('Blocked', 'NotAllowedError'); }; });
  await p.click('.share-nudge .sn-media');
  await p.waitForFunction(() => document.querySelector('.sn-error')?.textContent.includes('blocked'));
  check(await p.locator('.sn-error').isVisible(), 'blocked sharing reports an explicit error rather than pretending it posted');
  await p.click('.share-nudge .sn-x');
  await p.waitForSelector('.share-nudge', { state: 'detached' });

  // The recorded video, not its poster image, is handed to social sharing.
  await p.evaluate(async () => {
    const blob = new Blob(['test-video-bytes'], { type: 'video/mp4' });
    const ref = await storeFoodVideo(blob);
    navigator.share = async data => { window.__shared = { type: data.files?.[0]?.type, size: data.files?.[0]?.size }; };
    offerShareMeal({ r: state.restaurants[0], video: ref, photo: state.restaurants[0].photo });
  });
  await p.waitForSelector('.sn-media:not([disabled])');
  await p.click('.sn-media');
  check(await p.evaluate(() => window.__shared.type === 'video/mp4' && window.__shared.size === 16),
    'video sharing passes the stored clip instead of its poster frame');
  await p.click('.sn-social-help summary');
  check(await p.locator('.sn-social-help').innerText().then(text => ['TikTok', 'Instagram', 'Facebook', 'Nothing posts automatically'].every(s => text.includes(s))),
    'social instructions name the supported workflow without promising automatic publishing');
  await p.evaluate(() => {
    navigator.clipboard.writeText = async text => { window.__copiedCaption = text; };
  });
  await p.click('.sn-caption summary');
  await p.fill('.sn-caption-text', 'These tacos deserve a Reel!');
  await p.click('.sn-copy');
  check(await p.evaluate(() => window.__copiedCaption === 'These tacos deserve a Reel!'),
    'copy caption uses the foodie edited caption for social apps that drop shared text');
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('.sn-download')]);
  check(download.suggestedFilename().endsWith('.mp4'), 'manual social upload downloads the actual video file');
  await p.evaluate(() => { navigator.canShare = () => false; });
  const [fallbackDownload] = await Promise.all([p.waitForEvent('download'), p.click('.sn-media')]);
  check(fallbackDownload.suggestedFilename().endsWith('.mp4')
    && (await p.locator('.sn-error').innerText()).includes('upload'),
    'unsupported native video sharing offers a real download with upload instructions');
  await p.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
  await p.click('.sn-copy');
  check(await p.locator('.sn-caption-text').isVisible()
    && (await p.locator('.sn-error').innerText()).includes('manually'),
    'blocked clipboard exposes the editable caption for manual copying');
  await p.evaluate(() => Cub.openAdd());
  check(await p.locator('.share-nudge').count() === 0, 'a previous share prompt cannot cover the next Add flow');

  // A late photo from a closed form must not attach to its replacement.
  await p.fill('.qa-input', 'Old Cafe');
  await p.locator('.qa-input').press('Enter');
  await p.click('.qa-status[data-status="visited"]');
  await p.evaluate(() => { delete window.__finishMedia; });
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.qa-photo')]);
  await chooser.setFiles(photo);
  await p.waitForFunction(() => !!window.__finishMedia);
  await p.evaluate(() => { Cub.close(); Cub.openAdd(); });
  await p.evaluate(() => window.__finishMedia());
  await p.waitForFunction(() => !foodMediaBusy());
  check(await p.locator('.qa-photo-preview').isHidden(), 'a late result cannot attach to a reopened quick-add form');
  await p.evaluate(() => { mediaFromFile = window.__realMediaFromFile; Cub.close(); });

  // Both other primary entry points expose the same capture choices.
  await p.evaluate(() => openJustAte('r1'));
  check(await p.locator('#just-ate-overlay .food-capture-buttons button').count() === 3, 'Just Ate exposes photo, video and gallery actions');
  await closeAllDialogs(p);
  await p.evaluate(() => openAddModal());
  check(await p.locator('#restaurant-form .food-capture-buttons button').count() === 3, 'the full Add form exposes the same actions');
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#restaurant-form [data-source="photo"]')]);
  await chooser.setFiles(photo);
  await p.waitForFunction(() => !foodMediaBusy());
  await p.fill('#form-name', 'Full Form Cafe');
  await p.click('#modal-save-btn');
  check(await p.evaluate(() => !!state.restaurants.find(r => r.name === 'Full Form Cafe')?.photo), 'the full form saves camera-picked media');

  for (const width of [320, 390]) {
    await p.setViewportSize({ width, height: 640 });
    await closeAllDialogs(p);
    await p.evaluate(() => Cub.openAdd());
    await p.fill('.qa-input', 'Small Phone Cafe');
    await p.locator('.qa-input').press('Enter');
    await p.click('.qa-status[data-status="visited"]');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `capture UI fits a ${width}px phone without sideways scrolling`);
  }
  const realErrors = p.errors.filter(e => !/Media share failed|Caption copy failed/.test(e));
  check(!realErrors.length, `no unexpected page errors (${realErrors.join(' | ')})`);
  await browser.close();
  finish('capture-share');
})();
