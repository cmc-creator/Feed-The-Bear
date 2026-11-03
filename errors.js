/* ════════════════════════════════════════════════════════════
   Feed The Bear - Error reports
   When something breaks on someone's phone, its message (links and long
   numbers stripped, no user id) is counted per day at /api/track, so the
   owner sees it on /usage.html instead of never hearing about it.
   Loaded before every other script so it catches their errors too.
   ════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
  const SENDING = !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.protocol === 'https:';
  const MAX_PER_VISIT = 10;
  // Browser noise and network blips, not bugs.
  const IGNORE = /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection|AbortError|Load failed|NetworkError|Failed to fetch|cancell?ed/i;
  const seen = new Set();
  let queue = [];
  let timer = null;

  const clean = s => String(s ?? '').replace(/^Uncaught\s+/, '').replace(/^Error:\s*/, '')
    .replace(/https?:\/\/\S+/g, '<link>').replace(/\d{4,}/g, '#').replace(/\s+/g, ' ').trim();

  function report (message, where = '') {
    const m = clean(message).slice(0, 160);
    if (!m || IGNORE.test(m) || seen.has(m) || seen.size >= MAX_PER_VISIT) return;
    seen.add(m);
    queue.push({ m, w: clean(where).slice(0, 80) });
    if (!SENDING) return;
    clearTimeout(timer);
    timer = setTimeout(flush, 5000);
  }

  function flush () {
    clearTimeout(timer);
    if (!SENDING || !queue.length) return;
    const body = JSON.stringify({ errors: queue });
    queue = [];
    try {
      if (!navigator.sendBeacon?.('/api/track', body)) {
        fetch('/api/track', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
      }
    } catch { /* best effort */ }
  }

  // Script errors only (a broken image fires on the element, not here).
  window.addEventListener('error', e => {
    if (e.target && e.target !== window) return;
    const file = String(e.filename || '').split('/').pop().split('?')[0];
    report(e.message || e.error?.message, file ? `${file}:${e.lineno || 0}` : '');
  });
  window.addEventListener('unhandledrejection', e => report(e.reason?.message || e.reason, 'promise'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // For errors the app catches itself but still wants to know about.
  window.ftbReportError = report;
  window._ftbErrorQueue = () => queue.slice();
})();
