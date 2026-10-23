// Shared helpers for the browser tests. The app must be served at BASE
// (python -m http.server 8765 from the repo root).
//   PW_CHANNEL=msedge  use an installed browser instead of Playwright's Chromium
//   TEST_BASE=...      point at another server (e.g. a preview deployment)
const path = require('path');
const { chromium } = require('playwright-core');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8765';
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');

const results = [];
function check (ok, msg) {
  results.push({ ok: !!ok, msg });
  if (!ok) console.log(`  FAIL ${msg}`);
}

function launch () {
  return chromium.launch({ channel: process.env.PW_CHANNEL || undefined, headless: true });
}

// A phone-sized page. `seed` (array of restaurants) pre-loads an existing
// user who has finished onboarding; `settings` merges into their settings.
async function newPage (browser, { seed = null, settings = {}, viewport = { width: 390, height: 844 }, geo = { latitude: 33.4942, longitude: -111.9261 } } = {}) {
  const ctx = await browser.newContext({
    viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, serviceWorkers: 'block',
    geolocation: geo, permissions: ['geolocation'],
  });
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

module.exports = { BASE, ROOT, SHOTS, check, launch, newPage, closeAllDialogs, finish };
