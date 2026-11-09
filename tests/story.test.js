// "What to order" story cards.
const fs = require('fs');
const path = require('path');
const { BASE, SHOTS, check, launch, newPage, finish } = require('./lib');

// A small warm-colored JPEG made in the page, standing in for a food photo.
const makePhoto = () => {
  const c = document.createElement('canvas'); c.width = 600; c.height = 400;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 600, 400); grad.addColorStop(0, '#d9822b'); grad.addColorStop(1, '#7a2e12');
  g.fillStyle = grad; g.fillRect(0, 0, 600, 400);
  g.fillStyle = '#f3d27a'; g.beginPath(); g.arc(300, 200, 120, 0, 7); g.fill();
  return c.toDataURL('image/jpeg', .8);
};

const SEED = [
  { id: 'r1', name: 'Taqueria El Sol', cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dishes: [
    { id: 'd1', name: 'Birria tacos', verdict: 'again', rating: 5, date: '2026-10-01' },
    { id: 'd2', name: 'Al pastor', verdict: 'again', rating: 4, date: '2026-10-01' },
    { id: 'd3', name: 'Elote', verdict: 'ok', rating: 3, date: '2026-10-01' },
    { id: 'd4', name: 'Horchata', verdict: 'want', date: '2026-10-01' },
    { id: 'd5', name: 'Fish taco', verdict: 'skip', rating: 2, date: '2026-10-01' },
  ] },
  { id: 'r2', name: 'The Extraordinarily Long Named Neighborhood Noodle House and Dumpling Bar', cuisine: 'Chinese', status: 'visited', tags: [], visits: [], dishes: [
    { id: 'e1', name: 'Soup dumplings with a very very long description that goes on', verdict: 'ok', rating: 4, date: '2026-10-01' },
  ] },
];

(async () => {
  const browser = await launch();
  const p = await newPage(browser, { seed: SEED });
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  await p.evaluate(mk => { const r = state.restaurants.find(x => x.id === 'r1'); r.dishes[0].photo = (new Function(`return (${mk})()`))(); }, makePhoto.toString());

  await p.evaluate(() => openDetailModal('r1'));
  await p.waitForSelector('#your-order-share:not(.hidden)');
  await p.click('#your-order-share');
  await p.waitForSelector('#story-card-overlay:not(.hidden)', { timeout: 6000 });
  check(await p.locator('#story-card-overlay').isVisible(), 'Share opens the card preview');
  const size = await p.$eval('.story-img', i => new Promise(res => i.complete ? res([i.naturalWidth, i.naturalHeight]) : (i.onload = () => res([i.naturalWidth, i.naturalHeight]))));
  check(size[0] === 1080 && size[1] === 1920, `the card is story-sized (${size.join('x')})`);
  check(/Taqueria El Sol/.test(await p.getAttribute('.story-img', 'alt')), 'the preview is labeled with the restaurant');
  check(await p.locator('.story-copy').isVisible(), 'Copy text is offered');

  // The photo is drawn: the top of the card is the warm photo, not the brown background.
  const px = await p.$eval('.story-img', i => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return [...g.getImageData(540, 420, 1, 1).data]; });
  check(px[0] > 180 && px[1] > 140, `the dish photo is on the card (rgb ${px.slice(0, 3).join(',')})`);
  await p.$eval('.story-img', i => i.src).then(async src => {
    const b64 = await p.evaluate(async s => { const b = await (await fetch(s)).blob(); return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(b); }); }, src);
    fs.writeFileSync(path.join(SHOTS, 'story-card.png'), Buffer.from(b64, 'base64'));
  });
  await p.screenshot({ path: path.join(SHOTS, 'story-preview.png') }).catch(() => {});

  // With a share sheet, the image file goes to it.
  await p.evaluate(() => { navigator.canShare = () => true; navigator.share = async d => { window._shared = d; }; });
  await p.click('.story-share');
  const shared = await p.evaluate(() => window._shared && { name: window._shared.files?.[0]?.name, text: window._shared.text });
  check(shared?.name === 'taqueria-el-sol-what-to-order.png' && /Birria tacos/.test(shared.text), `Share sends the image and the text (${shared?.name})`);

  await p.click('.story-x');
  check(await p.locator('#story-card-overlay').isHidden(), 'the ✕ closes it');

  // Which dishes make the card
  const picks = await p.evaluate(() => { const k = StoryCard.pickDishes(state.restaurants[0]); return { get: k.get.map(d => d.name), want: k.want.map(d => d.name), skip: k.skip.map(d => d.name) }; });
  check(JSON.stringify(picks.get) === '["Birria tacos","Al pastor"]', `"Get this" lists the order-again dishes, best first (${picks.get})`);
  // Every section fits: the skip row is drawn (light text in the bottom area).
  check(await p.evaluate(async () => {
    const blob = await StoryCard.draw(state.restaurants[0]);
    const img = await createImageBitmap(blob);
    const c = new OffscreenCanvas(1080, 1920); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(84, 1600, 300, 80).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200) return true;
    return false;
  }), 'the skip dish fits above the footer');
  check(picks.want[0] === 'Horchata' && picks.skip[0] === 'Fish taco', 'next time and skip sections are filled');

  // Long names, no photo, only "fine" dishes, no share sheet
  await p.evaluate(() => { navigator.canShare = () => false; });
  await p.evaluate(() => openDetailModal('r2'));
  await p.waitForSelector('#your-order-share:not(.hidden)');
  await p.click('#your-order-share');
  await p.waitForSelector('#story-card-overlay:not(.hidden)', { timeout: 6000 });
  check(await p.locator('#story-card-overlay').isVisible(), 'a long name with no photo still makes a card');
  check(await p.locator('.story-share').innerText() === 'Download image' && await p.locator('.story-save').isHidden(), 'with no share sheet, the main button downloads');
  const dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null);
  await p.click('.story-share');
  const file = await dl;
  check(/what-to-order\.png$/.test(file?.suggestedFilename() || ''), `and the image downloads (${file?.suggestedFilename()})`);
  await p.$eval('.story-img', i => i.src).then(async src => {
    const b64 = await p.evaluate(async s => { const b = await (await fetch(s)).blob(); return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.split(',')[1]); f.readAsDataURL(b); }); }, src);
    fs.writeFileSync(path.join(SHOTS, 'story-card-long.png'), Buffer.from(b64, 'base64'));
  });
  await p.keyboard.press('Escape');
  check(await p.locator('#story-card-overlay').isHidden(), 'Escape closes it');
  check(await p.evaluate(() => StoryCard.photosFor({ placePhoto: 'https://example.com/stock.jpg', visits: [], dishes: [] }).length === 0),
    'place listing and stock fallback photos never become personal share photos');
  check(await p.evaluate(() => {
    const r = { photo: 'https://example.com/one.jpg', media: [{ photo: 'https://example.com/two.jpg' }],
      visits: [{ photo: 'https://example.com/three.jpg' }], dishes: [{ photo: 'https://example.com/four.jpg' }] };
    return JSON.stringify(StoryCard.photosFor(r, 'https://example.com/two.jpg'))
      === '["https://example.com/two.jpg","https://example.com/one.jpg","https://example.com/three.jpg"]';
  }), 'personal photo selection prioritizes the current photo, deduplicates, and limits the collage to three');
  check(await p.evaluate(async () => {
    const solid = color => {
      const c = document.createElement('canvas'); c.width = c.height = 20;
      const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 20, 20);
      return c.toDataURL();
    };
    const text = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) { text.push(args[0]); return original.apply(this, args); };
    let blob;
    try {
      blob = await StoryCard.drawStory({ kind: 'meal', place: 'My Taco Cafe', location: '123 Taco St', title: 'Birria',
        photos: [solid('#ff0000'), solid('#00ff00'), solid('#0000ff')] });
    } finally { CanvasRenderingContext2D.prototype.fillText = original; }
    const image = await createImageBitmap(blob);
    const c = new OffscreenCanvas(1080, 1920); const g = c.getContext('2d'); g.drawImage(image, 0, 0);
    const pixel = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3).join(',');
    return image.width === 1080 && image.height === 1920 && pixel(540, 600) === '255,0,0'
      && pixel(250, 1300) === '0,255,0' && pixel(800, 1300) === '0,0,255'
      && text.includes('My Taco Cafe') && text.includes('123 Taco St') && text.includes('Birria')
      && !text.includes('Google Play');
  }), 'clean story card renders all three actual photos, restaurant, location and dish with understated branding');
  check(await p.evaluate(async () => {
    try { await StoryCard.drawStory({ kind: 'spot', title: 'Broken photo', photo: 'data:image/png;base64,broken' }); return false; }
    catch (err) { return err.message.includes('Your photo could not load'); }
  }), 'an unreadable personal photo fails explicitly instead of replacing it with stock imagery');
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);

  await browser.close();
  finish('story');
})();
