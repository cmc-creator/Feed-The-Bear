// Food videos: Grizzly only, 15 seconds max, stored on the device, played back.
const path = require('path');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

// Records a colour-cycling canvas for `seconds` and returns it as a WebM buffer.
async function recordVideo (page, seconds) {
  const b64 = await page.evaluate(async secs => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.start(250);
    const t0 = performance.now();
    await new Promise(res => {
      const tick = () => {
        const t = performance.now() - t0;
        g.fillStyle = `hsl(${(t / 8) % 360},70%,50%)`; g.fillRect(0, 0, 320, 240);
        g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText((t / 1000).toFixed(1), 100, 130);
        if (t < secs * 1000) requestAnimationFrame(tick); else res();
      };
      tick();
    });
    rec.stop();
    await new Promise(r => { rec.onstop = r; });
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, seconds);
  return Buffer.from(b64, 'base64');
}

const grizzly = p => p.evaluate(() => { window._ftbUid = 'u1'; window._ftbPlan = 'grizzly'; });

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'r1', name: 'The Mission', cuisine: 'Mexican', status: 'visited', tags: [], visits: [], dishes: [] }] });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  const short = await recordVideo(p, 2);
  check(short.length > 1000, `test video recorded (${Math.round(short.length / 1024)} KB)`);

  // Free users get the pitch, nothing is saved
  await p.click('#home-quick-justate-btn');
  await p.click('.ja-place[data-id="r1"]');
  let [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await chooser.setFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: short });
  await p.waitForSelector('#upgrade-overlay:not(.hidden)', { timeout: 4000 }).catch(() => {});
  check((await p.locator('#upgrade-title').innerText().catch(() => '')) === 'Save food videos', 'free users picking a video see the Grizzly pitch');
  check(await p.locator('#just-ate-photo-preview img').count() === 0, 'and no video is attached');
  await closeAllDialogs(p);

  // Grizzly: video with a poster, saved with the visit and dish
  await grizzly(p);
  await p.click('#home-quick-justate-btn');
  await p.click('.ja-place[data-id="r1"]');
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await chooser.setFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: short });
  await p.waitForSelector('#just-ate-photo-preview .video-badge', { timeout: 8000 }).catch(() => {});
  check(await p.locator('#just-ate-photo-preview .video-badge').count() === 1, 'the preview shows a play badge');
  check((await p.locator('#just-ate-photo-label').innerText()) === 'Retake video', 'the button says Retake video');
  await p.fill('#just-ate-dish', 'Birria tacos');
  await p.click('#just-ate-verdicts .yo-btn[data-verdict="again"]');
  await p.click('#just-ate-save');
  await p.waitForTimeout(2500);
  const saved = await p.evaluate(() => {
    const r = state.restaurants.find(x => x.id === 'r1');
    const d = r.dishes.find(x => x.name === 'Birria tacos');
    return { visitVideo: r.visits.at(-1).video, dishVideo: d?.video, poster: (d?.photo || '').slice(0, 15) };
  });
  check(/^vid:/.test(saved.dishVideo || '') && saved.dishVideo === saved.visitVideo, `video saved on the dish and visit (${saved.dishVideo})`);
  check(saved.poster === 'data:image/jpeg', 'a poster frame becomes its photo');
  check(!(await p.evaluate(() => localStorage.getItem('ftb_restaurants_v2'))).includes('video/webm'), 'the video file is not stored in localStorage');

  // After a reload: still there, plays from the dish and the gallery
  await p.reload();
  await p.waitForTimeout(2500);
  await grizzly(p);
  const blob = await p.evaluate(async ref => { const b = await getFoodVideo(ref); return b ? { size: b.size, type: b.type } : null; }, saved.dishVideo);
  check(blob && blob.size === short.length, `the video file survives a reload (${JSON.stringify(blob)})`);
  await p.evaluate(() => openDetailModal('r1'));
  await p.waitForTimeout(400);
  check(await p.locator('.yo-dish-photo.is-video .video-badge').count() === 1, 'Your Order marks the dish as a video');
  await p.locator('.yo-dish-photo.is-video').click();
  await p.waitForSelector('#video-viewer:not(.hidden)', { timeout: 4000 }).catch(() => {});
  const playing = await p.waitForFunction(() => { const v = document.querySelector('#video-viewer video'); return v && v.readyState >= 2 && /^blob:/.test(v.src); }, null, { timeout: 6000 }).then(() => true).catch(() => false);
  check(playing, 'tapping it plays the video');
  await p.click('.video-viewer-close');
  check(await p.locator('#video-viewer').isHidden(), 'the player closes');
  await closeAllDialogs(p);
  await p.evaluate(() => openGallery());
  await p.waitForTimeout(300);
  check(await p.locator('.gallery-item .video-badge').count() >= 1, 'the gallery marks videos');
  await closeAllDialogs(p);

  // Over 15 seconds is turned away
  const long = await recordVideo(p, 16.5);
  await p.click('#home-quick-justate-btn');
  await p.click('.ja-place[data-id="r1"]');
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await chooser.setFiles({ name: 'long.webm', mimeType: 'video/webm', buffer: long });
  await p.waitForTimeout(3000);
  check(await p.locator('#just-ate-photo-preview img').count() === 0, 'a video over 15 seconds is not attached');
  check(/Keep it to 15 seconds/.test(await p.locator('#toast-container, .toast-container, body').first().innerText()), 'and the cub explains why');
  await closeAllDialogs(p);

  // Photos still work through the same picker
  await p.click('#home-quick-justate-btn');
  await p.click('.ja-place[data-id="r1"]');
  [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#just-ate-photo')]);
  await chooser.setFiles(path.join(ROOT, 'assets', 'food', 'tacos.jpg'));
  await p.waitForTimeout(800);
  check(await p.locator('#just-ate-photo-preview img').count() === 1 && await p.locator('#just-ate-photo-preview .video-badge').count() === 0, 'photos still work the same way');

  check(!p.errors.length, `no page errors ${p.errors.join(' | ')}`);
  await browser.close();
  finish('video');
})();
