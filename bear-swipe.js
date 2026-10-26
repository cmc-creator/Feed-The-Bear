/* ════════════════════════════════════════════════════════════
   Feed The Bear - Bear Swipe
   Swipe real dishes: right = "I'd eat that", left = "not tonight".
   After a round the bear names your craving and finds it nearby.
   No = a claw slash that tears the card; yes = a bite and a NOM.

   Photos come from data/food-photos.json (Wikimedia Commons, credited on
   each card; see scripts/build_food_photos.py).
   Everything lives under window.BearSwipe: classic scripts share one global
   scope, and a duplicate top-level name once stopped app.js from loading.
   ════════════════════════════════════════════════════════════ */

window.BearSwipe = (() => {
  'use strict';

  const ROUND = 20;
  const STORE_KEY = 'ftb_bear_swipe_v2';
  const SEEN_LIMIT = 400;

  let manifest = null;        // Promise<photos[]>
  let deck = [];
  let index = 0;
  let round = { yes: [], no: [] };
  let busy = false;
  let els = null;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const haptic = kind => { try { window.hapticTap?.(kind); } catch { /* optional */ } };
  const track = (name, data) => { try { window.trackProductEvent?.(name, data); } catch { /* optional */ } };

  function loadStore () {
    try { return { tastes: {}, dishes: {}, seen: [], rounds: 0, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { tastes: {}, dishes: {}, seen: [], rounds: 0 }; }
  }
  function saveStore (s) {
    s.seen = (s.seen || []).slice(-SEEN_LIMIT);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* storage full */ }
  }

  function loadPhotos () {
    if (!manifest) {
      manifest = fetch('data/food-photos.json')
        .then(r => (r.ok ? r.json() : { photos: [] }))
        .then(d => (Array.isArray(d.photos) ? d.photos : [])// Wikimedia serves resized photos from thumb.wikimedia.org (newer) and
        // upload.wikimedia.org; allowing only the latter dropped 97% of them.
        .filter(p => /^https:\/\/(thumb|upload)\.wikimedia\.org\//.test(p.url)))
        .catch(() => []);
    }
    return manifest;
  }

  // One photo per dish, varied cuisines, leaning toward what you like, and
  // skipping photos you've seen recently.
  function buildDeck (photos) {
    const store = loadStore();
    const seen = new Set(store.seen);
    const byDish = new Map();
    photos.forEach(p => {
      if (!byDish.has(p.dish)) byDish.set(p.dish, []);
      byDish.get(p.dish).push(p);
    });
    const tasteScore = c => (store.tastes[c] || 0);
    // Dishes with a photo you haven't seen come first; seen photos only
    // fill in once every dish has been shown.
    const dishes = [...byDish.keys()].map(dish => {
      const options = byDish.get(dish);
      const fresh = options.filter(p => !seen.has(p.url));
      const pool = fresh.length ? fresh : options;
      const photo = pool[Math.floor(Math.random() * pool.length)];
      const pref = Math.max(-2, Math.min(4, tasteScore(photo.cuisine) + (store.dishes[dish] || 0)));
      return { ...photo, fresh: fresh.length > 0, sort: Math.random() * 3 + pref * 0.6 - (store.dishes[dish] < 0 ? 3 : 0) };
    }).sort((a, b) => (b.fresh - a.fresh) || (b.sort - a.sort));

    // At most two of the same cuisine in a round so it stays a real choice.
    const out = [];
    const perCuisine = {};
    for (const d of dishes) {
      if ((perCuisine[d.cuisine] || 0) >= 2) continue;
      perCuisine[d.cuisine] = (perCuisine[d.cuisine] || 0) + 1;
      out.push(d);
      if (out.length >= ROUND) break;
    }
    return out;
  }

  function preload (from) {
    deck.slice(from, from + 3).forEach(d => { const img = new Image(); img.src = d.url; });
  }

  function cardHtml (d, extraClass = '') {
    return `<div class="bs-card ${extraClass}" data-dish="${esc(d.dish)}">
      <img class="bs-photo" src="${esc(d.url)}" alt="${esc(d.dish)}" draggable="false" />
      <div class="bs-hint bs-hint-no" aria-hidden="true">NOPE</div>
      <div class="bs-hint bs-hint-yes" aria-hidden="true">YUM</div>
      <div class="bs-info">
        <span class="bs-cuisine">${esc(d.cuisine)}</span>
        <div class="bs-dish">${esc(d.dish)}</div>
      </div>
      <a class="bs-credit" href="${esc(d.page)}" target="_blank" rel="noopener">Photo: ${esc(d.credit)} · ${esc(d.license)}</a>
    </div>`;
  }

  function renderProgress () {
    const n = Math.min(index, ROUND);
    els.progress.style.width = `${(n / ROUND) * 100}%`;
    els.count.textContent = `${n}/${ROUND}`;
  }

  function render () {
    if (index >= deck.length) { showResult(); return; }
    const d = deck[index];
    const next = deck[index + 1];
    els.stage.innerHTML = (next ? cardHtml(next, 'bs-next') : '') + cardHtml(d, 'bs-top');
    els.result.classList.add('hidden');
    els.stage.classList.remove('hidden');
    els.actions.classList.remove('hidden');
    renderProgress();
    const top = els.stage.querySelector('.bs-top');
    bindDrag(top);
    top?.querySelector('.bs-photo')?.addEventListener('error', () => replaceBrokenPhoto(d), { once: true });
    preload(index + 1);
  }

  // A photo that fails to load (Wikimedia can throttle) is swapped for another
  // photo of the same dish, or another dish, instead of showing a broken card.
  const failedUrls = new Set();
  let swapsThisRound = 0;
  async function replaceBrokenPhoto (broken) {
    if (deck[index] !== broken) return;
    failedUrls.add(broken.url);
    if (++swapsThisRound > 8) {
      els.stage.innerHTML = '<div class="bs-loading">Dish photos are having trouble loading. Tap ↻ to try again.</div>';
      return;
    }
    const photos = await loadPhotos();
    const inDeck = new Set(deck.map(x => x.dish));
    const sameDish = photos.find(p => p.dish === broken.dish && !failedUrls.has(p.url));
    const otherDish = photos.find(p => !inDeck.has(p.dish) && !failedUrls.has(p.url));
    const swap = sameDish || otherDish;
    if (swap) deck[index] = { ...swap };
    else deck.splice(index, 1);
    render();
  }

  /* ── Effects ─────────────────────────────────────────────── */
  // A claw gouge: a curved sliver, thin at both ends and widest in the middle.
  function gouge (x1, y1, cx, cy, x2, y2, width) {
    const left = [], right = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2;
      const y = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2;
      const dx = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx);
      const dy = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy);
      const len = Math.hypot(dx, dy) || 1;
      const w = width * Math.sin(Math.PI * t) ** 0.8;
      left.push(`${(x - (dy / len) * w).toFixed(2)},${(y + (dx / len) * w).toFixed(2)}`);
      right.unshift(`${(x + (dy / len) * w).toFixed(2)},${(y - (dx / len) * w).toFixed(2)}`);
    }
    return { poly: left.concat(right).join(' '), path: `M${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}` };
  }

  // Three claw gouges rake across the photo, then the card tears in two.
  function clawSlash (card) {
    return new Promise(resolve => {
      const slash = document.createElement('div');
      slash.className = 'bs-claw';
      const marks = [[14, 6, 30, 52, 62, 98, 3.2], [32, 2, 48, 48, 80, 94, 3.8], [50, 0, 66, 44, 98, 86, 3.2]].map(m => gouge(...m));
      slash.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs>${
        marks.map((m, i) => `<mask id="bs-claw-m${i}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120"><path class="bs-claw-reveal" d="${m.path}" /></mask>`).join('')
      }</defs>${marks.map((m, i) => `<g mask="url(#bs-claw-m${i})"><polygon class="bs-gouge" points="${m.poly}" /><polygon class="bs-gouge-edge" points="${m.poly}" /></g>`).join('')}</svg>`;
      card.appendChild(slash);
      haptic('heavy');
      setTimeout(() => {
        const rect = card.getBoundingClientRect();
        const host = card.parentElement;
        const halves = ['a', 'b'].map(side => {
          const half = card.cloneNode(true);
          half.classList.remove('bs-top', 'is-dragging');
          half.classList.add('bs-half', `bs-half-${side}`);
          half.style.transform = card.style.transform;
          return half;
        });
        halves.forEach(h => host.appendChild(h));
        card.remove();
        requestAnimationFrame(() => halves.forEach(h => h.classList.add('go')));
        setTimeout(() => { halves.forEach(h => h.remove()); resolve(); }, 900);
        void rect;
      }, 1050); // let the claw marks sit long enough to see before the tear
    });
  }

  // A bite comes out of the corner, NOM pops, crumbs fly, then it slides away.
  function bite (card) {
    return new Promise(resolve => {
      haptic('medium');
      card.classList.add('bs-bite-1');
      const nom = document.createElement('div');
      nom.className = 'bs-nom';
      nom.textContent = 'NOM!';
      card.appendChild(nom);
      for (let i = 0; i < 9; i++) {
        const crumb = document.createElement('span');
        crumb.className = 'bs-crumb';
        crumb.style.setProperty('--dx', `${Math.round(30 + Math.random() * 90)}px`);
        crumb.style.setProperty('--dy', `${Math.round(-60 - Math.random() * 80)}px`);
        crumb.style.setProperty('--r', `${Math.round(Math.random() * 360)}deg`);
        card.appendChild(crumb);
      }
      setTimeout(() => card.classList.add('bs-bite-2'), 160);
      setTimeout(() => card.classList.add('bs-fly-right'), 520);
      setTimeout(resolve, 900);
    });
  }

  async function choose (reaction) {
    if (busy || index >= deck.length) return;
    const card = els.stage.querySelector('.bs-top');
    if (!card) return;
    busy = true;
    const d = deck[index];
    const store = loadStore();
    store.tastes[d.cuisine] = (store.tastes[d.cuisine] || 0) + (reaction === 'yes' ? 1 : -0.5);
    store.dishes[d.dish] = (store.dishes[d.dish] || 0) + (reaction === 'yes' ? 1 : -1);
    store.seen.push(d.url);
    saveStore(store);
    round[reaction].push(d);
    // Keep feeding the app's existing taste profile (For You, Pick For Me).
    try { window.recordSwipePreference?.({ cuisine: d.cuisine, name: d.dish, source: 'mood' }, reaction); } catch { /* optional */ }
    if (reaction === 'yes') await bite(card); else await clawSlash(card);
    index++;
    busy = false;
    render();
  }

  /* ── Dragging (pointer events only; vertical scroll still works) ── */
  function bindDrag (card) {
    if (!card) return;
    let startX = 0, startY = 0, dx = 0, dragging = false, id = null;
    const setDrag = x => {
      dx = x;
      card.style.transform = `translateX(${dx}px) rotate(${Math.max(-12, Math.min(12, dx * 0.05))}deg)`;
      card.style.setProperty('--no', String(Math.max(0, Math.min(1, -dx / 90))));
      card.style.setProperty('--yes', String(Math.max(0, Math.min(1, dx / 90))));
    };
    card.addEventListener('pointerdown', e => {
      if (busy || e.target.closest('a, button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      dragging = true; id = e.pointerId; startX = e.clientX; startY = e.clientY; dx = 0;
      card.classList.add('is-dragging');
      try { card.setPointerCapture(id); } catch { /* old browsers */ }
    });
    card.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== id) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (Math.abs(my) > Math.abs(mx) * 1.2 && Math.abs(mx) < 20) return; // let the page scroll
      setDrag(mx);
    });
    const end = e => {
      if (!dragging || e.pointerId !== id) return;
      dragging = false;
      card.classList.remove('is-dragging');
      if (Math.abs(dx) > 80) { choose(dx > 0 ? 'yes' : 'no'); return; }
      card.style.transform = '';
      card.style.setProperty('--no', '0');
      card.style.setProperty('--yes', '0');
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  /* ── Result ──────────────────────────────────────────────── */
  function topCravings () {
    const score = {};
    round.yes.forEach(d => { score[d.cuisine] = (score[d.cuisine] || 0) + 1; });
    return Object.entries(score).sort((a, b) => b[1] - a[1]);
  }

  function showResult () {
    const store = loadStore();
    store.rounds = (store.rounds || 0) + 1;
    saveStore(store);
    renderProgress();
    els.stage.classList.add('hidden');
    els.actions.classList.add('hidden');
    const cravings = topCravings();
    const liked = round.yes;
    track('bear_swipe_round_done', { liked: liked.length, top: cravings[0]?.[0] || '' });

    if (!liked.length) {
      els.result.innerHTML = `<div class="bs-result-title">Picky bear today.</div>
        <p class="bs-result-sub">Nothing grabbed you. Fresh dishes are waiting.</p>
        <button type="button" class="btn-primary bs-again">Swipe another 10</button>`;
    } else {
      const top = cravings[0][0];
      const dish = liked.find(d => d.cuisine === top)?.dish || liked[0].dish;
      els.result.innerHTML = `<div class="bs-result-kicker">Tonight you're craving</div>
        <div class="bs-result-title">${esc(top)}</div>
        <p class="bs-result-sub">You'd eat ${liked.length} of ${round.yes.length + round.no.length}. Top pick: <strong>${esc(dish)}</strong>.</p>
        <div class="bs-collage">${liked.slice(0, 6).map(d => `<img src="${esc(d.url)}" alt="${esc(d.dish)}" title="${esc(d.dish)}" />`).join('')}</div>
        <div class="bs-bars">${cravings.slice(0, 3).map(([c, n]) => `<div class="bs-bar"><span>${esc(c)}</span><i style="width:${Math.round((n / liked.length) * 100)}%"></i></div>`).join('')}</div>
        <div class="bs-result-actions">
          <button type="button" class="btn-primary bs-find" data-q="${esc(top)}">Find ${esc(top)} near me</button>
          <button type="button" class="btn-secondary bs-decide">Decision Mode</button>
          <button type="button" class="btn-ghost bs-again">Swipe again</button>
        </div>`;
    }
    els.result.classList.remove('hidden');
    els.result.querySelector('.bs-again')?.addEventListener('click', () => start());
    els.result.querySelector('.bs-decide')?.addEventListener('click', () => window.openDecisionMode?.());
    els.result.querySelector('.bs-find')?.addEventListener('click', e => findNearby(e.currentTarget.dataset.q));
  }

  async function findNearby (query) {
    track('bear_swipe_find_nearby', { query });
    try {
      await window.discoverNearby?.();
      const input = document.getElementById('disc-search');
      if (input) { input.value = query; input.dispatchEvent(new Event('input', { bubbles: true })); }
    } catch { /* discovery shows its own errors */ }
  }

  function showHelp () {
    window.showToast?.('How Bear Swipe works', `Swipe right on dishes you'd eat, left on ones you wouldn't. After ${ROUND}, the bear names your craving and finds it nearby. It also tunes your picks.`, 'info');
  }

  /* ── Public ──────────────────────────────────────────────── */
  async function start () {
    if (!els) return;
    els.stage.innerHTML = '<div class="bs-loading">Plating up dishes…</div>';
    els.result.classList.add('hidden');
    els.stage.classList.remove('hidden');
    const photos = await loadPhotos();
    if (!photos.length) {
      els.stage.innerHTML = '<div class="bs-loading">Couldn\'t load dishes. Check your connection and tap ↻.</div>';
      return;
    }
    deck = buildDeck(photos.filter(p => !failedUrls.has(p.url)));
    index = 0;
    swapsThisRound = 0;
    round = { yes: [], no: [] };
    render();
  }

  function init () {
    const root = document.getElementById('bear-swipe-home');
    if (!root || root.dataset.v2 === '1') return;
    root.dataset.v2 = '1';
    root.classList.remove('hidden');
    root.innerHTML = `
      <div class="bs-header">
        <div>
          <div class="bs-title">Bear Swipe</div>
          <div class="bs-sub">Swipe real dishes. <b>Right</b> if you'd eat it, <b>left</b> if not. After ${ROUND}, the bear names your craving and finds it nearby.</div>
        </div>
        <div class="bs-header-btns">
          <button type="button" class="bs-icon-btn bs-help-btn" aria-label="How Bear Swipe works">?</button>
          <button type="button" class="bs-icon-btn bs-refresh-btn" aria-label="New dishes">↻</button>
        </div>
      </div>
      <div class="bs-progress-row"><div class="bs-progress"><span></span></div><span class="bs-count">0/${ROUND}</span></div>
      <div class="bs-stage" aria-live="polite"></div>
      <div class="bs-result hidden"></div>
      <div class="bs-actions">
        <button type="button" class="bs-btn bs-btn-no" aria-label="Not tonight"><span aria-hidden="true">✕</span> Nope</button>
        <button type="button" class="bs-btn bs-btn-yes" aria-label="I'd eat that"><span aria-hidden="true">♥</span> Yum</button>
      </div>`;
    els = {
      root,
      stage: root.querySelector('.bs-stage'),
      result: root.querySelector('.bs-result'),
      actions: root.querySelector('.bs-actions'),
      progress: root.querySelector('.bs-progress span'),
      count: root.querySelector('.bs-count'),
    };
    root.querySelector('.bs-btn-no').addEventListener('click', () => choose('no'));
    root.querySelector('.bs-btn-yes').addEventListener('click', () => choose('yes'));
    root.querySelector('.bs-refresh-btn').addEventListener('click', () => start());
    root.querySelector('.bs-help-btn').addEventListener('click', showHelp);
    root.tabIndex = -1;
    root.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); choose('no'); }
      if (e.key === 'ArrowRight') { e.preventDefault(); choose('yes'); }
    });
    start();
  }

  return { init, start, choose, loadPhotos, _state: () => ({ deck, index, round, failed: failedUrls.size }) };
})();
