// Error reports: errors.js catches what breaks on a phone (without links or
// long numbers), and /api/track counts each message per day.
const path = require('path');
const Module = require('module');
const { BASE, ROOT, check, launch, newPage, closeAllDialogs, finish } = require('./lib');

(async () => {
  // The server side: counted per message, at most 10 per report, nothing else accepted.
  let written = null;
  const fake = {
    apps: [1],
    firestore: Object.assign(() => ({ doc: p => ({ set: async (data) => { written = { p, data }; } }) }), {
      FieldValue: { increment: n => ({ inc: n }), serverTimestamp: () => 'ts' },
    }),
  };
  const file = path.join(ROOT, 'api', 'track.js');
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'firebase-admin' ? fake : orig.call(this, req, ...rest); };
  const track = require(file);
  Module._load = orig;
  const call = body => new Promise(resolve => {
    const res = { status (c) { this.c = c; return this; }, json () { resolve(this.c); return this; }, end () { resolve(this.c); return this; } };
    track({ method: 'POST', body, headers: { 'x-forwarded-for': '203.0.113.7' } }, res);
  });
  let status = await call(JSON.stringify({ errors: Array.from({ length: 12 }, (_, i) => ({ m: `Boom ${i}`, w: 'app.js:1' })) }));
  const errs = Object.values(written?.data?.errors || {});
  check(status === 204 && errs.length === 10 && errs[0].m === 'Boom 0' && errs[0].n.inc === 1 && /^analyticsErrors\//.test(written.p), `error reports are counted per message, 10 at most (${errs.length})`);
  check(await call({ errors: [] }) === 400, 'an empty report is refused');

  // The page side.
  const browser = await launch();
  const p = await newPage(browser, { seed: [] });
  await p.route(/overpass|nominatim|open-meteo|place-info|restaurant-image|place-photo|wikipedia/, r => r.abort());
  await p.goto(`${BASE}/app.html`);
  await p.waitForTimeout(1200);
  await closeAllDialogs(p);
  const startErrors = await p.evaluate(() => window._ftbErrorQueue());
  check(Array.isArray(startErrors) && startErrors.length === 0, `the app starts without errors (${JSON.stringify(startErrors).slice(0, 200)})`);
  await p.evaluate(() => {
    setTimeout(() => { throw new Error('Spot 1234567 broke at https://example.com/x'); }, 0);
    setTimeout(() => { throw new Error('ResizeObserver loop completed with undelivered notifications.'); }, 0);
    Promise.reject(new Error('Saving failed'));
  });
  await p.waitForTimeout(300);
  const q = await p.evaluate(() => window._ftbErrorQueue());
  check(q.some(e => e.m === 'Spot # broke at <link>'), `a crash is caught, without the link or the id (${JSON.stringify(q)})`);
  check(q.some(e => e.m === 'Saving failed' && e.w === 'promise'), 'and a failed promise');
  check(!q.some(e => /ResizeObserver/.test(e.m)), 'browser noise is ignored');
  await browser.close();
  finish('errors');
})();
