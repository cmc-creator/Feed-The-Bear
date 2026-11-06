// Shared helpers for the browser tests. The app must be served at BASE
// (python -m http.server 8765 from the repo root).
//   PW_CHANNEL=msedge  use an installed browser instead of Playwright's Chromium
//   PW_NO_SHARE=1      hide the browser's share sheet (as on CI's Linux Chromium)
//   TEST_BASE=...      point at another server (e.g. a preview deployment)
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8765';
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');

const results = [];
function check (ok, msg) {
  results.push({ ok: !!ok, msg });
  if (!ok) {
    console.log(`  FAIL ${msg}`);
    // In GitHub Actions this becomes an annotation, readable without the logs.
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=${path.basename(process.argv[1] || 'test')}::${String(msg).replace(/[\r\n]+/g, ' ').slice(0, 400)}`);
  }
}

function launch () {
  return chromium.launch({ channel: process.env.PW_CHANNEL || undefined, headless: true });
}

// Friends, Dinner Vote, Bear Swipe and Today's Pick are Grizzly-only. A test
// of those calls asGrizzly() first: its pages act as a signed-in Grizzly
// member (a test can still set window._ftbUid / _ftbPlan itself).
let grizzlyPages = false;
function asGrizzly () { grizzlyPages = true; }

// A phone-sized page. `seed` (array of restaurants) pre-loads an existing
// user who has finished onboarding; `settings` merges into their settings.
async function newPage (browser, { seed = null, settings = {}, viewport = { width: 390, height: 844 }, geo = { latitude: 33.4942, longitude: -111.9261 }, grizzly = grizzlyPages } = {}) {
  const ctx = await browser.newContext({
    viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, serviceWorkers: 'block',
    geolocation: geo, permissions: ['geolocation'],
  });
  // PW_NO_SHARE=1: no built-in share sheet, like CI's Chromium on Linux
  // (Edge on Windows has one, which hid a CI-only failure).
  if (process.env.PW_NO_SHARE) {
    await ctx.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
  }
  if (grizzly) {
    await ctx.addInitScript(() => {
      localStorage.setItem('ftb_plan_v1', 'grizzly');
      // Signed out on the test server, the app clears the uid; keep it unless a test sets another.
      let uid = 'testGrizzly00001';
      Object.defineProperty(window, '_ftbUid', { configurable: true, get: () => uid, set: v => { if (v) uid = v; } });
    });
  }
  if (seed) {
    await ctx.addInitScript(([s, extra]) => {
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', '1');
      localStorage.setItem('ftb_dishes_merged_v1', '1');
      localStorage.setItem('ftb_settings_v1', JSON.stringify({ onboardingDone: true, profileSetupDone: true, ...extra }));
      localStorage.setItem('ftb_restaurants_v2', JSON.stringify(s));
    }, [seed, settings]);
  }
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => {
    // Missing /api functions and blocked third-party assets are expected on a static server.
    // Public map servers (Overpass, Nominatim) reject busy requests without CORS
    // headers; the app falls back to another source, so that isn't a failure here.
    const text = m.text();
    if (m.type() === 'error' && !/Failed to load resource|ERR_|navigator\.vibrate/.test(text)
        && !/CORS policy/.test(text) && !/overpass|nominatim|maps\.mail\.ru/.test(text)) page.errors.push('[console] ' + text.slice(0, 160));
  });
  return page;
}

function closeAllDialogs (page) {
  return page.evaluate(() => {
    document.querySelectorAll('.modal-overlay, [role=dialog], #ui-overlay').forEach(e => e.classList.add('hidden'));
    document.body.classList.remove('overlay-open');
  });
}

function finish (name) {
  const failed = results.filter(r => !r.ok);
  console.log(`${name}: ${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}

module.exports = { BASE, ROOT, SHOTS, check, launch, newPage, asGrizzly, closeAllDialogs, finish };
