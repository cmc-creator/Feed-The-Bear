// Responsive layout: the app must fit narrow phones (Pixel 9 is ~360px
// CSS wide; iPhone SE is 375px; 320px is the floor) without horizontal
// overflow and without button labels being cut off.
//
// What this guards:
// - No horizontal document overflow (scrollWidth <= innerWidth) on the
//   home screen and every overlay at 320/360/375px.
// - Button labels fully visible: the label's own text range must fit in
//   the button's content box (measured with a Range, not scrollWidth —
//   scrollWidth is polluted by box-shadows, e.g. the gold Add FAB's ring).
// - The bottom nav keeps all five buttons on screen at 1.5x text size
//   (Android's largest font is 1.3x; the nav must survive beyond it).
// - The public cave page (server-rendered, api/creator.js) fits at 360px.
const path = require('path');
const Module = require('module');
const { BASE, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

// Long names on purpose: they are what overflowed on the other phone.
const spot = (i, name) => ({ id: `s${i}`, name, cuisine: 'Mexican', status: 'visited', myRating: 5, tags: [], visits: [], dateAdded: '2026-11-01', updatedAt: 1, dishes: [{ name: 'Birria quesatacos with extra consommé', stars: 5 }] });
const seed = [spot(1, 'Tacos Chiwas'), spot(2, 'A Very Long Restaurant Name That Keeps Going And Going')];

// Every visible element must end at or before the right edge, unless it
// lives inside a deliberately horizontal scroller (filter bar, picker).
// Buttons whose text is wider than their content box are clipped labels.
async function audit (page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const out = { vw, scrollW: document.documentElement.scrollWidth, overflow: [], clipped: [] };
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (b.left >= vw) continue; // off-canvas panels
      let a = el.parentElement, inScroll = false;
      while (a && a !== document.body) {
        const acs = getComputedStyle(a);
        if (acs.overflowX === 'auto' || acs.overflowX === 'scroll') { inScroll = true; break; }
        a = a.parentElement;
      }
      const tag = el.tagName.toLowerCase();
      if (b.right > vw + 1 && !inScroll) {
        out.overflow.push(`${tag}${el.id ? '#' + el.id : ''} right=${Math.round(b.right)} "${(el.textContent || '').trim().slice(0, 40)}"`);
      }
      if (tag === 'button' && (el.textContent || '').trim().length > 0 && cs.whiteSpace === 'nowrap') {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tw = range.getBoundingClientRect().width;
        const contentW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        if (tw > contentW + 1) out.clipped.push(`"${(el.textContent || '').trim().slice(0, 40)}" textW=${Math.round(tw)} contentW=${Math.round(contentW)}`);
      }
    }
    out.overflow = [...new Set(out.overflow)].slice(0, 10);
    out.clipped = [...new Set(out.clipped)].slice(0, 10);
    return out;
  });
}

function assertAudit (label, r) {
  check(r.scrollW <= r.vw + 1, `${label}: no horizontal overflow (scrollW ${r.scrollW} <= vw ${r.vw})`);
  check(r.overflow.length === 0, `${label}: nothing runs off the right edge${r.overflow.length ? ' — ' + r.overflow.join('; ') : ''}`);
  check(r.clipped.length === 0, `${label}: no clipped button labels${r.clipped.length ? ' — ' + r.clipped.join('; ') : ''}`);
}

async function blockExternal (page) {
  await page.route(/overpass|nominatim|place-info|open-meteo/, rt => rt.abort());
  await page.route('https://www.gstatic.com/firebasejs/**', rt => rt.fulfill({ contentType: 'text/javascript', body: '' }));
}

(async () => {
  const browser = await launch();
  for (const w of [320, 360, 375]) {
    const p = await newPage(browser, { seed, settings: {}, viewport: { width: w, height: 844 } });
    await blockExternal(p);
    await p.goto(`${BASE}/app.html`);
    await p.waitForTimeout(1500);
    assertAudit(`home ${w}px`, await audit(p));

    // Cave setup (theme picker + points).
    await p.evaluate(() => { window._ftbUid = 'probeUid1234567'; if (typeof openHandleSettings === 'function') openHandleSettings(); });
    await p.waitForTimeout(800);
    assertAudit(`cave setup ${w}px`, await audit(p));
    await closeAllDialogs(p);

    // Cave Shop (cards, prices, buy buttons).
    await p.evaluate(() => { if (typeof openCaveShop === 'function') openCaveShop(); });
    await p.waitForTimeout(800);
    assertAudit(`cave shop ${w}px`, await audit(p));
    await closeAllDialogs(p);

    // Upgrade / Grizzly modal (Monthly / Yearly).
    await p.evaluate(() => { if (typeof openUpgradeModal === 'function') openUpgradeModal(); });
    await p.waitForTimeout(700);
    assertAudit(`upgrade ${w}px`, await audit(p));
    await closeAllDialogs(p);

    // Friends overlay (invite + find).
    await p.evaluate(() => { document.getElementById('friends-overlay')?.classList.remove('hidden'); });
    await p.waitForTimeout(500);
    assertAudit(`friends ${w}px`, await audit(p));
    await closeAllDialogs(p);

    // "I just ate" sheet (long spot names + photo buttons).
    await p.evaluate(() => { if (typeof openJustAte === 'function') openJustAte(); });
    await p.waitForTimeout(700);
    assertAudit(`just ate ${w}px`, await audit(p));
    await closeAllDialogs(p);

    // Food fight (board + Start).
    await p.evaluate(() => { if (typeof openFoodFight === 'function') openFoodFight(); });
    await p.waitForTimeout(800);
    assertAudit(`food fight ${w}px`, await audit(p));
    await closeAllDialogs(p);
    await p.close();
  }

  // Bottom nav at 1.5x text (root font-size 24px): all five buttons,
  // including Map, must stay inside the viewport.
  const p = await newPage(browser, { seed, settings: {}, viewport: { width: 360, height: 844 } });
  await blockExternal(p);
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
  await p.waitForTimeout(400);
  const nav = await p.evaluate(() => {
    const kids = [...document.querySelectorAll('#mobile-bottom-nav > *')].map(el => Math.round(el.getBoundingClientRect().right));
    return { vw: window.innerWidth, rights: kids };
  });
  check(Math.max(...nav.rights) <= nav.vw + 1, `bottom nav at 1.5x text: all buttons on screen (right edges ${nav.rights.join(', ')} <= ${nav.vw})`);
  await p.close();

  // Public cave page at 360px (Pixel 9), rendered by api/creator.js.
  const docs = {
    'profiles/pubshare01': { uid: 'pubUid1234567', u: 'Connie', profile: { picks: [
      { n: 'Tacos Chiwas — Authentic Sonoran Mexican Restaurant & Cantina', c: 'Mexican', a: 'Phoenix', r: 5, g: ['Birria quesatacos with extra consommé and cheese'], s: ['Horchata de arroz'] },
    ], cave: { t: 'forest', d: ['lights', 'plant'] }, pts: 560 } },
    'users/pubUid1234567/meta/profile': { cave: { theme: 'forest', decor: ['lights', 'plant'], furniture: ['couch'] }, pts: 560, photo: '' },
    'handles/connie_eats': { uid: 'pubUid1234567', id: 'pubshare01', u: 'Connie', public: true, views: 0, joins: 0 },
  };
  const ref = pp => ({ p: pp, get: async () => ({ exists: !!docs[pp], data: () => docs[pp] }), set: async () => {}, delete: async () => {} });
  const fake = { apps: [1], auth: () => ({ verifyIdToken: async () => { throw new Error('no'); } }), firestore: () => ({ doc: ref, collection: () => ({ get: async () => ({ size: 0, docs: [] }) }), runTransaction: async fn => fn({ get: r => r.get(), set: () => {}, delete: () => {} }) }) };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  const creatorApi = require(path.join(__dirname, '..', 'api', 'creator.js'));
  Module._load = orig;
  const html = await new Promise(resolve => {
    const res = { setHeader () {}, status (c) { this.c = c; return this; }, send (d) { resolve(String(d)); return this; } };
    creatorApi({ method: 'GET', query: { h: 'connie_eats' }, headers: { 'x-forwarded-for': '1.2.3.4' } }, res);
  });
  check(html.includes('viewport-fit=cover'), 'public cave page: viewport meta has viewport-fit=cover');
  const pg = await browser.newPage({ viewport: { width: 360, height: 844 } });
  await pg.setContent(html, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(500);
  assertAudit('public cave page 360px', await audit(pg));
  await pg.close();

  await browser.close();
  finish('responsive');
})();
