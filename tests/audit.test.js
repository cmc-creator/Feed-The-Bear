// Audit fixes: untrusted shared-list and vote data can't run script, share text and
// social previews point at the real site, and the photo scraper stays off internal hosts.
const path = require('path');
const { BASE, ROOT, check, launch, newPage, finish } = require('./lib');

async function scraperStaysPublic () {
  const handler = require(path.join(ROOT, 'api', 'restaurant-image.js'));
  const realFetch = global.fetch;
  const asked = [];
  global.fetch = async url => { asked.push(String(url)); return new Response('', { status: 404 }); };
  const run = website => new Promise(resolve => {
    const res = {
      headers: {}, setHeader (k, v) { this.headers[k] = v; },
      status (code) { this.code = code; return this; },
      json (body) { resolve({ code: this.code, body }); return this; },
      end () { resolve({ code: this.code }); },
    };
    handler({ method: 'GET', headers: { 'x-forwarded-for': '203.0.113.9' }, query: { name: '', website } }, res);
  });
  for (const site of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://localhost:8080/', 'http://[::1]/']) {
    asked.length = 0;
    await run(site);
    check(!asked.some(u => u.startsWith(site.slice(0, 18))), `scraper won't fetch ${site}`);
  }
  global.fetch = realFetch;
}

(async () => {
  await scraperStaysPublic();

  const browser = await launch();
  const p = await newPage(browser, { seed: [{ id: 'a', name: 'Taqueria Uno', cuisine: 'Mexican', status: 'visited', tags: [], visits: [], dishes: [] }] });
  await p.route(/overpass|nominatim|place-info/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1500);

  // A collaborator writes hostile data into a shared list doc.
  const shared = await p.evaluate(() => {
    window.__pwned = 0;
    state.settings.collections = [{ id: 'c1', name: 'Date night', restaurantIds: [] }];
    applySharedCloudData('c1', {
      collaborators: [
        { id: 'x"><img src=x onerror="window.__pwned++">', name: '<b>Mallory</b>', role: 'admin' },
        { id: 'ok-1', name: 'Pat', role: 'editor' },
      ],
      activity: [{ text: '<img src=x onerror="window.__pwned++">', ts: 'soon' }],
    });
    openSharedManageModal('c1');
    const meta = ensureSharedMeta('c1');
    return { roles: meta.collaborators.map(c => c.role), ids: meta.collaborators.map(c => c.id), injected: document.querySelectorAll('#shared-manage-overlay img').length };
  });
  await p.waitForTimeout(300);
  check(shared.injected === 0 && await p.evaluate(() => window.__pwned) === 0, 'hostile shared-list data renders as text');
  check(shared.roles[0] === 'viewer' && !/[<>"]/.test(shared.ids.join('')), `collaborator roles and ids are cleaned (${shared.roles}, ${shared.ids})`);
  await p.evaluate(() => closeSharedManageModal?.());

  // A crafted Group Vote link.
  const evil = Buffer.from(JSON.stringify([{ id: "x',window.__pwned=99,'", n: 'Trap', c: '' }, { id: 'b', n: 'Other', c: '' }])).toString('base64');
  await p.goto(`${BASE}/app.html?vote=${encodeURIComponent(evil)}`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => openGroupVote());
  await p.locator('#groupvote-bars button').first().click();
  await p.waitForTimeout(300);
  check(await p.evaluate(() => window.__pwned) === undefined, 'a crafted vote link cannot run script');
  check(await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('ftb_votes_'))), 'the vote is still recorded');

  // Share text and social previews.
  const digestText = await p.evaluate(() => {
    let text = '';
    navigator.share = d => { text = d.text; return Promise.resolve(); };
    shareDigest();
    return text;
  });
  check(digestText.includes('https://www.feed-the-bear.com/') && !digestText.includes('github.io'), 'digest share links the real site');
  for (const page of ['index.html', 'app.html']) {
    await p.goto(`${BASE}/${page}`);
    const og = await p.evaluate(() => ({
      img: document.querySelector('meta[property="og:image"]')?.content,
      card: document.querySelector('meta[name="twitter:card"]')?.content,
      bear: [...document.images].filter(i => i.getAttribute('src') === 'feedbear.png').length,
    }));
    check(og.img === 'https://www.feed-the-bear.com/og-image.jpg' && og.card === 'summary_large_image', `${page} has a social preview image`);
    check(og.bear === 0, `${page} uses the light mascot image`);
  }
  for (const f of ['og-image.jpg', 'feedbear.jpg', 'robots.txt', 'sitemap.xml']) {
    const r = await p.request.get(`${BASE}/${f}`);
    check(r.ok(), `${f} is served`);
  }
  check(p.errors.length === 0, `no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await browser.close();
  finish('audit');
})();
