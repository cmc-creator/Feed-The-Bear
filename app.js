/* ════════════════════════════════════════════════════════════
   Feed The Bear — App Logic
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ── Defensive AI stub — if ai.js failed to load (old SW cache,
   offline, etc.) replace window.AI with a no-op stub so the app
   still boots instead of throwing ReferenceError on first call. */
if (typeof AI === 'undefined') {
  window.AI = {
    getKey: () => '', setKey: () => {}, hasKey: () => false,
    call: () => Promise.reject(new Error('AI module not loaded')),
    callVision: () => Promise.reject(new Error('AI module not loaded')),
    stream: async function* () {},
    chat: () => Promise.reject(new Error('AI module not loaded')),
    smartFill: () => Promise.reject(new Error('AI module not loaded')),
    enrichNotes: () => Promise.reject(new Error('AI module not loaded')),
    dishRecs: () => Promise.reject(new Error('AI module not loaded')),
    digest: () => Promise.reject(new Error('AI module not loaded')),
    tasteProfile: () => Promise.reject(new Error('AI module not loaded')),
    captionPhoto: () => Promise.reject(new Error('AI module not loaded')),
    restaurantSummary: () => Promise.reject(new Error('AI module not loaded')),
    cravingMatch: () => Promise.reject(new Error('AI module not loaded')),
    buildContext: () => '',
  };
}

/* ── Constants ───────────────────────────────────────────── */
const STORAGE_KEY   = 'ftb_restaurants_v2';
const SETTINGS_KEY  = 'ftb_settings_v1';
const ALERT_RADIUS  = 805;   // ~0.5 miles — show proximity alert
const NOTIFY_RADIUS = 1609;  // ~1 mile — browser notification
const NOTIFY_COOLDOWN = 10 * 60 * 1000; // 10 min between alerts for same place

/* ── Cuisine → emoji map ──────────────────────────────────── */
const CUISINE_EMOJI = {
  american:'🍔',bbq:'🍖',breakfast:'🥞',brunch:'🥂',burgers:'🍔',cafe:'☕',
  chinese:'🥢',desserts:'🍰',french:'🥐',greek:'🫒',indian:'🍛',italian:'🍝',
  japanese:'🍣',korean:'🍜',mediterranean:'🥙',mexican:'🌮',pizza:'🍕',
  seafood:'🦞',steakhouse:'🥩',sushi:'🍣',thai:'🍜',vegan:'🥗',
  vietnamese:'🍜',default:'🍽️'
};
const cuisineEmoji = c => CUISINE_EMOJI[(c||'').toLowerCase()] || CUISINE_EMOJI.default;

/* ── Cuisine → gradient map ───────────────────────────────── */
const CUISINE_GRAD = {
  italian:   ['#E74C3C','#C0392B'],
  japanese:  ['#3498DB','#1A5276'],
  mexican:   ['#F39C12','#D35400'],
  american:  ['#2ECC71','#1A8A4A'],
  chinese:   ['#E74C3C','#8E44AD'],
  indian:    ['#F39C12','#E74C3C'],
  french:    ['#3498DB','#8E44AD'],
  thai:      ['#1ABC9C','#16A085'],
  mediterranean:['#27AE60','#1A5276'],
  bbq:       ['#E67E22','#C0392B'],
  seafood:   ['#1ABC9C','#3498DB'],
  pizza:     ['#E74C3C','#F39C12'],
  steakhouse:['#8E44AD','#C0392B'],
  sushi:     ['#3498DB','#1ABC9C'],
  vegan:     ['#27AE60','#1ABC9C'],
  cafe:      ['#7F8C8D','#5D4E37'],
  desserts:  ['#E91E63','#9C27B0'],
  default:   ['#FF6B35','#C0392B']
};
const cuisineGrad = c => CUISINE_GRAD[(c||'').toLowerCase()] || CUISINE_GRAD.default;

/* ── Cuisine → Unsplash photo map ────────────────────────── */
// Curated Unsplash photo IDs — free, no API key needed
const CUISINE_PHOTOS = {
  italian:       'photo-1555396273-367ea4eb4db5',
  pizza:         'photo-1565299624946-b28f40a0ae38',
  japanese:      'photo-1579871494447-9811cf80d66c',
  sushi:         'photo-1563245372-f21724e3856d',
  mexican:       'photo-1565299585323-38d6b0865b47',
  american:      'photo-1568901346375-23c9450c58cd',
  burgers:       'photo-1568901346375-23c9450c58cd',
  chinese:       'photo-1563245372-f21724e3856d',
  indian:        'photo-1585937421612-70a008356fbe',
  french:        'photo-1414235077428-338989a2e8c0',
  bbq:           'photo-1529193591184-b1d58069ecdd',
  thai:          'photo-1562565652-a0d8f0c59eb4',
  korean:        'photo-1590301157890-4810ed352733',
  vietnamese:    'photo-1582878826629-29b7ad1cdc43',
  greek:         'photo-1544025162-d76694265947',
  mediterranean: 'photo-1544025162-d76694265947',
  seafood:       'photo-1559339352-11d035aa65de',
  steakhouse:    'photo-1546833999-b9f581a1996d',
  cafe:          'photo-1501339847302-ac426a4a7cbb',
  breakfast:     'photo-1533089860892-a7c6f0a88666',
  brunch:        'photo-1504754524776-8f4f37790ca0',
  desserts:      'photo-1551024506-0bccd828d307',
  vegan:         'photo-1512621776951-a57141f2eefd',
  spanish:       'photo-1515443961218-a51367888e4b',
  turkish:       'photo-1565557623262-b51c2513a641',
  lebanese:      'photo-1565557623262-b51c2513a641',
  default:       'photo-1414235077428-338989a2e8c0',
};
function getCuisinePhoto (cuisine, w = 600, h = 400) {
  const key = (cuisine || '').toLowerCase();
  const id  = CUISINE_PHOTOS[key] || CUISINE_PHOTOS.default;
  return `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&crop=center&q=80&auto=format`;
}

/* ── State ───────────────────────────────────────────────── */
let state = {
  restaurants: [],
  userLat: null,
  userLng: null,
  locationEnabled: false,
  watchId: null,
  notifiedAt: {},          // id → timestamp
  currentView: 'all',
  filter: { search:'', cuisine:'', price:'', sort:'date-desc', tag:'', collection:'' },
  settings: {},
  editingId: null,
  formRating: 0,
  detailId: null,
  mapLeaflet: null,
  mapMarkers: [],
  groupBy: false,
  bulkMode: false,
  selectedIds: new Set(),
};

/* ════════════════════════════════════════════════════════════
   STORAGE
   ════════════════════════════════════════════════════════════ */
function loadData () {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : seedData();
    state.restaurants = pruneLegacyDemoRestaurants(parsed);
    if (!raw || state.restaurants.length !== parsed.length) saveData();
  } catch {
    state.restaurants = pruneLegacyDemoRestaurants(seedData());
    saveData();
  }

  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    state.settings = s ? JSON.parse(s) : {};
  } catch { state.settings = {}; }
}

function pruneLegacyDemoRestaurants (list) {
  if (!Array.isArray(list)) return [];
  const demoNames = new Set([
    'The Golden Spoon',
    'Sakura Garden',
    'El Rancho Taqueria',
    'Smoke & Ember BBQ',
    'Cafe Lumiere',
    'Café Lumiere',
    'Spice Route',
  ]);
  const cleaned = list.filter(r => {
    const website = String(r?.website || '').toLowerCase();
    const name = String(r?.name || '').trim();
    const isDemoWebsite = website.includes('.example.com');
    const isKnownDemo = demoNames.has(name);
    return !(isDemoWebsite || isKnownDemo);
  });
  if (list.length !== cleaned.length) {
    const removed = list.length - cleaned.length;
    showToast('Cleaned Demo Data', `${removed} sample entr${removed === 1 ? 'y was' : 'ies were'} removed.`, 'info');
  }
  return cleaned;
}

function saveData () {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.restaurants));
  updateTagSuggestions();
  setTimeout(checkAchievements, 0);
  setTimeout(renderWeeklyGoal, 0);
}

/* ════════════════════════════════════════════════════════════
   EXPORT / IMPORT
   ════════════════════════════════════════════════════════════ */
function exportData () {
  const json = JSON.stringify(state.restaurants, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `feed-the-bear-${iso()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported! 📥', `${state.restaurants.length} restaurants saved to file.`, 'success');
}

function importData (file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Invalid format');
      let added = 0;
      data.forEach(r => {
        const exists = state.restaurants.some(x =>
          x.id === r.id || (x.name === r.name && x.address === r.address)
        );
        if (!exists) {
          state.restaurants.push({ ...r, id: r.id || uid() });
          added++;
        }
      });
      saveData();
      renderAll();
      showToast('Imported! 📤', `${added} new restaurant${added !== 1 ? 's' : ''} added.`, 'success');
    } catch {
      showToast('Import Error', 'Invalid file. Please use a Feed The Bear export file.', 'error');
    }
  };
  reader.readAsText(file);
}

/* ── Seed restaurants so the app looks populated on first run */
function seedData () {
  return [];
}

function uid () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2-3);
}
function iso (offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

/* ════════════════════════════════════════════════════════════
   GEOLOCATION
   ════════════════════════════════════════════════════════════ */
function enableLocation () {
  if (!navigator.geolocation) {
    showToast('Location', 'Geolocation is not supported by your browser.', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      state.locationEnabled = true;
      state.settings.locationEnabled = true;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      updateLocationBtn();
      hideBanner('location-banner');
      renderCards();
      showToast('📍 Location On', 'You\'ll get alerts when near restaurants on your list!', 'success');
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      startWatching();
      // Load home discovery strip + AI rec
      loadHomeDiscovery();
      // Auto-open nearby discovery so the user sees restaurants right away
      setTimeout(() => discoverNearby(), 300);
    },
    err => {
      showToast('Location Error', err.message || 'Unable to get location.', 'error');
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

async function ensureLocationForDiscovery () {
  if (state.userLat != null && state.userLng != null) return true;
  if (!navigator.geolocation) {
    showToast('Location', 'Geolocation is not supported by your browser.', 'error');
    return false;
  }
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 });
    });
    state.userLat = pos.coords.latitude;
    state.userLng = pos.coords.longitude;
    if (!state.locationEnabled) {
      state.locationEnabled = true;
      state.settings.locationEnabled = true;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      updateLocationBtn();
      hideBanner('location-banner');
      startWatching();
    }
    renderCards();
    return true;
  } catch (err) {
    showToast('Location Error', err?.message || 'Unable to get your current location.', 'error');
    return false;
  }
}

function startWatching () {
  if (state.watchId !== null) return;
  state.watchId = navigator.geolocation.watchPosition(
    pos => {
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      checkProximity();
      renderCards(); // refresh distances
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
  );
}

function disableLocation () {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  state.locationEnabled = false;
  state.settings.locationEnabled = false;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  state.userLat = null;
  state.userLng = null;
  updateLocationBtn();
  renderCards();
  showToast('📍 Location Off', 'Location tracking disabled.', 'info');
}

function updateLocationBtn () {
  const btn = document.getElementById('location-toggle-btn');
  if (state.locationEnabled) {
    btn.classList.add('active');
    btn.title = 'Disable location tracking';
  } else {
    btn.classList.remove('active');
    btn.title = 'Enable location tracking';
  }
}

/* Haversine distance in metres */
function haversine (lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const toRad = d => d * Math.PI / 180;

// Returns imperial distance string (ft under 0.2 mi, otherwise mi)
function fmtDist (m) {
  const miles = m / 1609.344;
  if (miles < 0.2) return `${Math.round(m * 3.28084)} ft`;
  if (miles < 10)  return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

function checkProximity () {
  if (!state.locationEnabled) return;
  const now = Date.now();
  state.restaurants.forEach(r => {
    if (!r.lat || !r.lng) return;
    const d = haversine(state.userLat, state.userLng, r.lat, r.lng);
    if (d <= NOTIFY_RADIUS) {
      const last = state.notifiedAt[r.id] || 0;
      if (now - last > NOTIFY_COOLDOWN) {
        state.notifiedAt[r.id] = now;
        showProximityAlert(r, d);
        sendBrowserNotification(r, d);
      }
    }
  });
}

function showProximityAlert (r, distM) {
  const alert = document.getElementById('proximity-alert');
  document.getElementById('proximity-icon').textContent = cuisineEmoji(r.cuisine);
  document.getElementById('proximity-name').textContent = r.name;
  document.getElementById('proximity-msg').textContent =
    `${r.status === 'want-to-try' ? '🔖 On your want-to-try list!' : '✅ You\'ve been here!'} — ${fmtDist(distM)} away`;

  const dirBtn = document.getElementById('proximity-directions');
  dirBtn.onclick = () => openDirections(r);

  alert.classList.remove('hidden');
  clearTimeout(alert._timeout);
  alert._timeout = setTimeout(() => alert.classList.add('hidden'), 15000);
}

function sendBrowserNotification (r, distM) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const tag = `ftb-${r.id}`;
  const n = new Notification(`🐻 Feed The Bear — ${r.name}`, {
    body: `${r.status === 'want-to-try' ? '🔖 On your list!' : '✅ You\'ve been here!'} ${fmtDist(distM)} away`,
    tag,
    icon: 'https://raw.githubusercontent.com/cmc-creator/Feed-The-Bear/main/bear-icon.png',
    badge: 'https://raw.githubusercontent.com/cmc-creator/Feed-The-Bear/main/bear-icon.png'
  });
  n.onclick = () => { window.focus(); n.close(); };
}

/* ════════════════════════════════════════════════════════════
   RENDERING
   ════════════════════════════════════════════════════════════ */
function getFiltered () {
  let list = [...state.restaurants];

  // View filter
  if (state.currentView !== 'all') {
    list = list.filter(r => r.status === state.currentView);
  }
  // Search
  if (state.filter.search) {
    const q = state.filter.search.toLowerCase();
    list = list.filter(r =>
      (r.name||'').toLowerCase().includes(q) ||
      (r.cuisine||'').toLowerCase().includes(q) ||
      (r.notes||'').toLowerCase().includes(q) ||
      (r.address||'').toLowerCase().includes(q)
    );
  }
  // Cuisine
  if (state.filter.cuisine) {
    list = list.filter(r =>
      (r.cuisine||'').toLowerCase() === state.filter.cuisine.toLowerCase()
    );
  }
  // Price
  if (state.filter.price) {
    list = list.filter(r => String(r.priceRange) === String(state.filter.price));
  }
  // Tag filter
  if (state.filter.tag) {
    const t = state.filter.tag.toLowerCase();
    list = list.filter(r => (r.tags||[]).some(tag => tag.toLowerCase().includes(t)));
  }
  // Collection filter
  if (state.filter.collection) {
    list = list.filter(r => r.collectionId === state.filter.collection);
  }
  // Sort
  switch (state.filter.sort) {
    case 'name-asc':
      list.sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'name-desc':
      list.sort((a,b) => b.name.localeCompare(a.name)); break;
    case 'rating-desc':
      list.sort((a,b) => (b.googleRating||0) - (a.googleRating||0)); break;
    case 'distance-asc':
      if (state.locationEnabled) {
        list.sort((a,b) => distOf(a) - distOf(b));
      }
      break;
    case 'date-asc':
      list.sort((a,b) => (a.dateAdded||'').localeCompare(b.dateAdded||'')); break;
    default: // date-desc
      list.sort((a,b) => (b.dateAdded||'').localeCompare(a.dateAdded||'')); break;
  }

  // Phase 11: For want-to-try view, put "hot" priority items first
  if (state.currentView === 'want-to-try') {
    const priorityOrder = { hot: 0, next: 1, '': 2, normal: 2, someday: 3 };
    list.sort((a, b) => (priorityOrder[a.priority||''] ?? 2) - (priorityOrder[b.priority||''] ?? 2));
  }

  return list;
}

function distOf (r) {
  if (!state.locationEnabled || !r.lat || !r.lng) return Infinity;
  return haversine(state.userLat, state.userLng, r.lat, r.lng);
}

function renderStats () {
  const all = state.restaurants;
  const visited = all.filter(r => r.status === 'visited');
  const want    = all.filter(r => r.status === 'want-to-try');
  const rated   = all.filter(r => r.googleRating > 0);
  const avg     = rated.length
    ? (rated.reduce((s,r) => s + r.googleRating, 0) / rated.length).toFixed(1)
    : null;

  document.getElementById('stat-total').textContent   = all.length;
  document.getElementById('stat-visited').textContent = visited.length;
  document.getElementById('stat-want').textContent    = want.length;
  document.getElementById('stat-avg').textContent     = avg || '—';
  document.getElementById('stat-avg-stars').textContent = avg ? '★' : '';
}

function renderCuisineFilter () {
  const sel = document.getElementById('filter-cuisine');
  const current = sel.value;
  const cuisines = [...new Set(
    state.restaurants.map(r => r.cuisine).filter(Boolean)
  )].sort();

  // rebuild options
  while (sel.options.length > 1) sel.remove(1);
  cuisines.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = `${cuisineEmoji(c)} ${c}`;
    sel.appendChild(o);
  });
  sel.value = current;
}

function renderCards () {
  if (state.currentView === 'map') return;
  const grid   = document.getElementById('restaurant-grid');
  const empty  = document.getElementById('empty-state');
  const noRes  = document.getElementById('no-results');
  const list   = getFiltered();

  grid.innerHTML = '';
  empty.classList.add('hidden');
  noRes.classList.add('hidden');

  if (state.restaurants.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  if (list.length === 0) {
    noRes.classList.remove('hidden');
    return;
  }

  if (state.groupBy) {
    const groups = {};
    list.forEach(r => { const k = r.cuisine || 'Other'; (groups[k] = groups[k] || []).push(r); });
    Object.entries(groups).sort(([a],[b]) => a.localeCompare(b)).forEach(([cuisine, items]) => {
      const hdr = document.createElement('div');
      hdr.className = 'cuisine-group-header';
      hdr.innerHTML = `<span>${cuisineEmoji(cuisine)} ${escHtml(cuisine)}</span><span class="group-count">${items.length}</span>`;
      grid.appendChild(hdr);
      items.forEach(r => grid.appendChild(buildCard(r)));
    });
  } else {
    list.forEach(r => grid.appendChild(buildCard(r)));
  }
}

function buildCard (r) {
  const card = document.createElement('article');
  card.className = 'restaurant-card';
  card.dataset.id = r.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `View details for ${r.name}`);
  if (state.selectedIds.has(r.id)) card.classList.add('bulk-selected');

  const dist = distOf(r);
  const distStr = dist < Infinity ? fmtDist(dist) : '';
  // Use saved photo if available, else a cuisine-matched Unsplash image
  const photoSrc  = r.photo || getCuisinePhoto(r.cuisine);
  const isUnsplash = !r.photo;

  // Collection badge
  const col = (state.settings.collections||[]).find(c => c.id === r.collectionId);
  const collBadge = col
    ? `<span class="collection-badge" style="background:${col.color}22;color:${col.color};border-color:${col.color}44"><span class="collection-dot" style="background:${col.color}"></span>${escHtml(col.name)}</span>`
    : '';

  card.innerHTML = `
    <div class="card-checkbox${state.selectedIds.has(r.id) ? ' checked' : ''}" title="Select"></div>
    <div class="card-photo">
      <img src="${escHtml(photoSrc)}" alt="${escHtml(r.name)}" loading="lazy" class="${isUnsplash ? 'photo-unsplash' : ''}" onload="this.classList.add('loaded')" />
      <div class="card-img-overlay"></div>
      <span class="card-status-badge ${r.status === 'want-to-try' ? 'want' : 'visited'}">
        ${r.status === 'want-to-try' ? 'Want to Try' : 'Visited'}
      </span>
      ${r.priceRange ? `<span class="card-price-badge">${priceDollars(r.priceRange)}</span>` : ''}
      ${distStr ? `<span class="card-distance-badge">📍 ${distStr}</span>` : ''}
    </div>
    <div class="card-body">
      ${r.cuisine ? `<div class="card-cuisine">${escHtml(r.cuisine.toUpperCase())}</div>` : ''}
      <div class="card-name">${escHtml(r.name)}</div>
      <div class="card-rating-row">
        ${r.googleRating ? googleStarsHtml(r.googleRating, r.googleReviews) : ''}
        ${r.myRating ? `<span class="my-rating-row"><span class="my-stars">${'★'.repeat(r.myRating)}${'☆'.repeat(5-r.myRating)}</span> My Rating</span>` : ''}
      </div>
      ${r.address ? `
        <div class="card-address">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${escHtml(r.address)}
        </div>` : ''}
      ${r.tags && r.tags.length ? `<div class="card-tags">${r.tags.map(t=>`<span class="card-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
      ${collBadge}
      ${priorityBadgeHtml(r)}
      ${r.notes ? `<div class="card-notes">"${escHtml(r.notes)}"</div>` : ''}
      <div class="card-actions">
        ${r.address ? `<button class="card-action-btn directions" data-action="directions" aria-label="Get directions to ${escHtml(r.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Directions
          </button>` : ''}
        ${r.website ? `<button class="card-action-btn website" data-action="website" aria-label="Open website for ${escHtml(r.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            Website
          </button>` : ''}
        <button class="card-action-btn edit-card" data-action="edit" aria-label="Edit ${escHtml(r.name)}">
          ✏️ Edit
        </button>
      </div>
    </div>`;

  // Bulk-mode checkbox click
  card.querySelector('.card-checkbox').addEventListener('click', e => {
    if (!state.bulkMode) return;
    e.stopPropagation();
    if (state.selectedIds.has(r.id)) {
      state.selectedIds.delete(r.id);
      card.classList.remove('bulk-selected');
      e.currentTarget.classList.remove('checked');
    } else {
      state.selectedIds.add(r.id);
      card.classList.add('bulk-selected');
      e.currentTarget.classList.add('checked');
    }
    updateBulkCount();
  });

  // Event delegation on the card
  card.addEventListener('click', e => {
    if (state.bulkMode) return; // checkboxes handle it
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'directions')   { e.stopPropagation(); openDirections(r);      return; }
    if (action === 'website')       { e.stopPropagation(); openWebsite(r);         return; }
    if (action === 'edit')          { e.stopPropagation(); openEditModal(r.id);    return; }
    if (action === 'mark-visited')  { e.stopPropagation(); markVisited(r.id);      return; }
    openDetailModal(r.id);
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetailModal(r.id); }
  });
  return card;
}

/* ── Stars HTML ──────────────────────────────────────────── */
function googleStarsHtml (rating, reviews) {
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      stars += `<span class="g-star">★</span>`;
    } else if (rating >= i - 0.75) {
      stars += `<span class="g-star half">★</span>`;
    } else {
      stars += `<span class="g-star empty">★</span>`;
    }
  }
  const count = reviews ? `<span class="g-review-count">(${reviews.toLocaleString()})</span>` : '';
  return `<span class="g-rating">
    <span class="g-rating-score">${rating.toFixed(1)}</span>
    <span class="g-stars">${stars}</span>
    ${count}
  </span>`;
}

function googleStarsLgHtml (rating, reviews) {
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      stars += `<span class="g-star-lg">★</span>`;
    } else if (rating >= i - 0.75) {
      stars += `<span class="g-star-lg half">★</span>`;
    } else {
      stars += `<span class="g-star-lg empty">★</span>`;
    }
  }
  const count = reviews
    ? `<div style="font-size:.78rem;color:var(--text-dim);margin-top:4px">${reviews.toLocaleString()} reviews</div>`
    : '';
  return `
    <label>Google Rating</label>
    <div class="g-rating-main">
      <span class="g-rating-score-lg">${rating.toFixed(1)}</span>
      <span class="g-stars-lg">${stars}</span>
    </div>
    ${count}
  `;
}

function myRatingHtml (rating) {
  if (!rating) {
    return `<label>My Rating</label><div style="color:var(--text-dim);font-size:.85rem">Not rated yet</div>`;
  }
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  return `<label>My Rating</label>
    <div style="font-size:1.5rem;color:var(--gold);letter-spacing:2px">${stars}</div>`;
}

function priceDollars (n) {
  return n ? '$'.repeat(n) : '';
}

/* ── Detail Modal ─────────────────────────────────────────── */
function openDetailModal (id) {
  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;
  state.detailId = id;

  const [c1, c2] = cuisineGrad(r.cuisine);
  const hero = document.getElementById('detail-hero');
  if (r.photo) {
    const safePhoto = safeUrl(r.photo);
    if (safePhoto) {
      hero.style.backgroundImage = `url('${safePhoto}')`;
      hero.style.backgroundSize = 'cover';
      hero.style.backgroundPosition = 'center';
    } else {
      hero.style.backgroundImage = `linear-gradient(135deg, ${c1}, ${c2})`;
    }
  } else {
    hero.style.backgroundImage = `linear-gradient(135deg, ${c1}, ${c2})`;
  }

  document.getElementById('detail-name').textContent = r.name;
  document.getElementById('detail-address').textContent = r.address || '';
  document.getElementById('detail-cuisine-badge').textContent =
    r.cuisine ? `${cuisineEmoji(r.cuisine)} ${r.cuisine}` : '';

  document.getElementById('detail-google-rating').innerHTML =
    r.googleRating ? googleStarsLgHtml(r.googleRating, r.googleReviews)
    : `<label>Google Rating</label><div style="color:var(--text-dim);font-size:.85rem">Not available</div>`;

  document.getElementById('detail-my-rating').innerHTML = myRatingHtml(r.myRating);
  document.getElementById('detail-price').innerHTML =
    `<label>Price Range</label><div style="font-size:1.2rem;color:var(--gold);font-weight:700">${priceDollars(r.priceRange)||'<span style="color:var(--text-dim);font-size:.85rem">Unknown</span>'}</div>`;

  const notesWrap = document.getElementById('detail-notes-wrap');
  if (r.notes) {
    document.getElementById('detail-notes').textContent = r.notes;
    notesWrap.style.display = '';
  } else {
    notesWrap.style.display = 'none';
  }

  const dist = distOf(r);
  const meta = [];
  if (dist < Infinity) meta.push(`📍 ${fmtDist(dist)} away`);
  meta.push(`🔖 Added ${fmtDate(r.dateAdded)}`);
  if (r.dateVisited) meta.push(`✅ Visited ${fmtDate(r.dateVisited)}`);
  meta.push(`<span style="padding:3px 8px;border-radius:12px;font-size:.72rem;background:${r.status==='visited'?'rgba(46,204,113,.15)':'rgba(74,144,217,.15)'};color:${r.status==='visited'?'var(--green)':'var(--blue-lt)'};font-weight:600">
    ${r.status==='visited'?'✅ Visited':'🔖 Want to Try'}</span>`);
  document.getElementById('detail-meta').innerHTML = meta.join('<span style="color:var(--border)">|</span>');

  // Tags display
  const tagsWrap = document.getElementById('detail-tags-wrap');
  if (r.tags && r.tags.length) {
    tagsWrap.innerHTML = r.tags.map(t =>
      `<span class="detail-tag" data-tag="${escHtml(t)}">${escHtml(t)}</span>`
    ).join('');
    tagsWrap.querySelectorAll('.detail-tag').forEach(el => {
      el.addEventListener('click', () => {
        state.filter.tag = el.dataset.tag;
        closeDetailModal();
        state.currentView = 'all';
        document.querySelectorAll('.nav-btn, .mobile-nav-btn[data-view]').forEach(b => b.classList.remove('active'));
        document.querySelector('.nav-btn[data-view="all"]')?.classList.add('active');
        document.querySelector('.mobile-nav-btn[data-view="all"]')?.classList.add('active');
        renderCards();
        showToast('Filtered 🏷️', `Showing: ${el.dataset.tag}`, 'info');
      });
    });
    tagsWrap.classList.remove('hidden');
  } else {
    tagsWrap.innerHTML = '';
    tagsWrap.classList.add('hidden');
  }

  // Visit log
  const visits = r.visits || [];
  const logList = document.getElementById('detail-visit-log-list');
  logList.innerHTML = visits.length
    ? visits.slice().reverse().map(v => `
        <div class="visit-log-item">
          <span class="visit-date">${fmtDate(v.date)}</span>
          ${v.rating ? `<span class="visit-stars">${'\u2605'.repeat(v.rating)}</span>` : ''}
          ${v.note ? `<span class="visit-note">${escHtml(v.note)}</span>` : ''}
        </div>`).join('')
    : '<div class="visit-log-empty">No visits logged yet.</div>';

  document.getElementById('detail-checkin-btn').onclick = () => {
    const note = prompt('Quick note for this visit (optional):') || '';
    const ratingStr = prompt('Your rating 1-5 (optional):') || '0';
    const rating = Math.min(5, Math.max(0, parseInt(ratingStr) || 0));
    const visitEntry = { date: iso(), note, rating };
    const idx = state.restaurants.findIndex(x => x.id === id);
    if (idx !== -1) {
      if (!state.restaurants[idx].visits) state.restaurants[idx].visits = [];
      state.restaurants[idx].visits.push(visitEntry);
      state.restaurants[idx].status = 'visited';
      state.restaurants[idx].dateVisited = state.restaurants[idx].dateVisited || iso();
      if (rating) state.restaurants[idx].myRating = rating;
      saveData();
      renderAll();
      openDetailModal(id);
      showToast('✅ Checked In!', `Visit logged for ${state.restaurants[idx].name}`, 'success');
    }
  };

  // Reminder
  const reminderStatus = document.getElementById('detail-reminder-status');
  const storedReminder = state.settings[`reminder_${id}`];
  reminderStatus.textContent = storedReminder
    ? `🔔 Reminder set for ${new Date(storedReminder).toLocaleString()}`
    : '';
  document.getElementById('detail-set-reminder-btn').onclick = () => scheduleReminder(r);

  document.getElementById('detail-share-btn').onclick = () => shareCard(r);
  document.getElementById('detail-directions-btn').onclick = () => openDirections(r);
  document.getElementById('detail-sms-btn').onclick = () => shareViaSMS(r);
  document.getElementById('detail-website-btn').style.display = r.website ? '' : 'none';
  document.getElementById('detail-website-btn').onclick = () => openWebsite(r);
  document.getElementById('detail-maps-search-btn').onclick = () => openMapsSearch(r);
  document.getElementById('detail-edit-btn').onclick = () => { closeDetailModal(); openEditModal(r.id); };
  document.getElementById('detail-delete-btn').onclick = () => {
    if (confirm(`Delete "${r.name}"? This cannot be undone.`)) {
      state.restaurants = state.restaurants.filter(x => x.id !== id);
      saveData();
      renderAll();
      closeDetailModal();
      showToast('Deleted', `"${r.name}" removed from your list.`, 'info');
    }
  };

  document.getElementById('detail-overlay').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  // Phase 9 — load cuisine photo + hide stale AI summary
  loadDetailPhoto(r);
  const aiSumEl = document.getElementById('detail-ai-summary');
  if (aiSumEl) aiSumEl.classList.add('hidden');
}

function closeDetailModal () {
  document.getElementById('detail-overlay').classList.add('hidden');
  maybeHideOverlay();
}

/* ── Add / Edit Modal ────────────────────────────────────── */
function openAddModal () {
  state.editingId = null;
  state.formRating = 0;
  document.getElementById('modal-title').textContent = 'Add Restaurant';
  document.getElementById('modal-save-btn').textContent = 'Save Restaurant';
  document.getElementById('restaurant-form').reset();
  document.getElementById('form-id').value = '';
  setFormStars(0);
  document.getElementById('form-date-visited-group').classList.add('hidden');
  document.getElementById('form-date-visited').value = '';
  document.getElementById('form-photo-file').value = '';
  document.getElementById('form-tags').value = '';
  document.getElementById('form-maps-url').value = '';
  populateFormCollections();
  document.getElementById('form-collection').value = '';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  document.getElementById('form-name').focus();
}

function openEditModal (id) {
  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;
  state.editingId = id;
  state.formRating = r.myRating || 0;

  document.getElementById('modal-title').textContent = 'Edit Restaurant';
  document.getElementById('modal-save-btn').textContent = 'Save Changes';
  document.getElementById('form-id').value = id;
  document.getElementById('form-name').value = r.name || '';
  document.getElementById('form-cuisine').value = r.cuisine || '';
  document.getElementById('form-price').value = r.priceRange || 0;
  document.getElementById('form-address').value = r.address || '';
  document.getElementById('form-website').value = r.website || '';
  document.getElementById('form-photo').value = r.photo || '';
  document.getElementById('form-google-rating').value = r.googleRating || '';
  document.getElementById('form-google-reviews').value = r.googleReviews || '';
  document.getElementById('form-notes').value = r.notes || '';
  document.getElementById('form-tags').value = (r.tags||[]).join(', ');
  populateFormCollections();
  document.getElementById('form-collection').value = r.collectionId || '';
  // status radio
  document.querySelectorAll('input[name="form-status"]').forEach(radio => {
    radio.checked = radio.value === r.status;
  });
  setFormStars(r.myRating || 0);

  const dvGroup = document.getElementById('form-date-visited-group');
  const dvField = document.getElementById('form-date-visited');
  if (r.status === 'visited') {
    dvGroup.classList.remove('hidden');
    dvField.value = r.dateVisited || '';
  } else {
    dvGroup.classList.add('hidden');
    dvField.value = '';
  }
  document.getElementById('form-photo-file').value = '';

  const priorityEl = document.getElementById('form-priority');
  if (priorityEl) priorityEl.value = r.priority || '';

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  document.getElementById('form-name').focus();
}

function closeModal () {
  document.getElementById('modal-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function markVisited (id) {
  const idx = state.restaurants.findIndex(r => r.id === id);
  if (idx === -1) return;
  state.restaurants[idx].status = 'visited';
  state.restaurants[idx].dateVisited = state.restaurants[idx].dateVisited || iso();
  saveData();
  renderAll();
  showToast('✅ Visited!', `"${state.restaurants[idx].name}" marked as visited.`, 'success');
}

function setFormStars (n) {
  state.formRating = n;
  document.getElementById('form-rating').value = n;
  document.querySelectorAll('.star-pick').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.val) <= n);
  });
}

function handleFormSubmit (e) {
  e.preventDefault();
  const name = document.getElementById('form-name').value.trim();
  if (!name) { showToast('Missing Name', 'Please enter a restaurant name.', 'error'); return; }

  const status = document.querySelector('input[name="form-status"]:checked')?.value || 'want-to-try';
  const isNew  = !state.editingId;

  // Try to geocode address for proximity detection (best-effort via nominatim)
  const address = document.getElementById('form-address').value.trim();

  const now = iso();
  const entry = {
    id: state.editingId || uid(),
    name,
    cuisine:       document.getElementById('form-cuisine').value.trim(),
    priceRange:    parseInt(document.getElementById('form-price').value) || 0,
    address,
    lat:           null,
    lng:           null,
    website:       document.getElementById('form-website').value.trim(),
    photo:         document.getElementById('form-photo').value.trim(),
    googleRating:  parseFloat(document.getElementById('form-google-rating').value) || 0,
    googleReviews: parseInt(document.getElementById('form-google-reviews').value) || 0,
    myRating:      state.formRating,
    notes:         document.getElementById('form-notes').value.trim(),
    tags:          document.getElementById('form-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    collectionId:  document.getElementById('form-collection').value || null,
    priority:      document.getElementById('form-priority')?.value || '',
    status,
    dateAdded:     isNew ? now : (state.restaurants.find(r => r.id === state.editingId)?.dateAdded || now),
    dateVisited:   status === 'visited'
      ? (document.getElementById('form-date-visited').value ||
         state.restaurants.find(r => r.id === state.editingId)?.dateVisited || now)
      : null,
  };

  if (state.editingId) {
    // Preserve lat/lng from original
    const orig = state.restaurants.find(r => r.id === state.editingId);
    entry.lat = orig?.lat || null;
    entry.lng = orig?.lng || null;
    entry.visits = orig?.visits || [];
    state.restaurants = state.restaurants.map(r => r.id === state.editingId ? entry : r);
    showToast('Updated! ✏️', `"${name}" has been updated.`, 'success');
  } else {
    entry.visits = [];
    state.restaurants.unshift(entry);
    showToast('Added! 🍽️', `"${name}" added to your list.`, 'success');
  }

  // Geocode in background if address provided
  if (address) geocodeAddress(entry.id, address);

  saveData();
  renderAll();
  closeModal();
}

/* ── Geocode via Nominatim (free, no API key) ─────────────── */
async function geocodeAddress (id, address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data && data.length > 0) {
      const idx = state.restaurants.findIndex(r => r.id === id);
      if (idx !== -1) {
        state.restaurants[idx].lat = parseFloat(data[0].lat);
        state.restaurants[idx].lng = parseFloat(data[0].lon);
        saveData();
        renderCards();
      }
    }
  } catch { /* silent — geocoding is best-effort */ }
}

/* ── External links ──────────────────────────────────────── */
function openDirections (r) {
  if (r.address) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.address)}`, '_blank', 'noopener');
  } else {
    showToast('No Address', 'This restaurant has no address saved.', 'error');
  }
}
function openWebsite (r) {
  if (r.website) {
    window.open(r.website, '_blank', 'noopener');
  } else {
    showToast('No Website', 'This restaurant has no website saved.', 'error');
  }
}
function openMapsSearch (r) {
  const q = r.address || r.name;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, '_blank', 'noopener');
}

/* ── Reminder scheduling ──────────────────────────────────── */
async function scheduleReminder (r) {
  const dateVal = document.getElementById('detail-reminder-date').value;
  const timeVal = document.getElementById('detail-reminder-time').value || '12:00';
  if (!dateVal) { showToast('Pick a date', 'Choose a date for the reminder.', 'error'); return; }
  const when = new Date(`${dateVal}T${timeVal}`);
  if (when <= new Date()) { showToast('Past date', 'Please pick a future date and time.', 'error'); return; }
  const delay = when.getTime() - Date.now();

  if ('Notification' in window && Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { showToast('Notifications blocked', 'Enable notifications in browser settings.', 'error'); return; }
  }

  const swReg = await navigator.serviceWorker?.ready.catch(() => null);
  if (swReg) {
    swReg.active.postMessage({
      type: 'SCHEDULE_REMINDER',
      title: `🐻 Time to visit ${r.name}!`,
      body: `${r.cuisine ? cuisineEmoji(r.cuisine)+' '+r.cuisine+' · ' : ''}${r.address || ''}`,
      delay,
    });
  } else {
    setTimeout(() => {
      if (Notification.permission === 'granted') {
        new Notification(`🐻 Time to visit ${r.name}!`, { body: r.address || r.cuisine || '' });
      }
    }, delay);
  }

  state.settings[`reminder_${r.id}`] = when.toISOString();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  document.getElementById('detail-reminder-status').textContent = `🔔 Reminder set for ${when.toLocaleString()}`;
  showToast('🔔 Reminder Set!', `We'll remind you on ${when.toLocaleDateString()} at ${when.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`, 'success');
}

/* ── Share via SMS ─────────────────────────────────────── */
function shareViaSMS (r) {
  const lines = [`🐻 ${r.name}`];
  if (r.cuisine) lines.push(`${cuisineEmoji(r.cuisine)} ${r.cuisine}`);
  if (r.address) lines.push(`📍 ${r.address}`);
  if (r.googleRating) lines.push(`⭐ ${r.googleRating}/5`);
  if (r.website) lines.push(`🌐 ${r.website}`);
  lines.push('\n— via Feed The Bear');
  window.open(`sms:?body=${encodeURIComponent(lines.join('\n'))}`);
}

/* ════════════════════════════════════════════════════════════
   MAP VIEW (Leaflet + OpenStreetMap)
   ════════════════════════════════════════════════════════════ */
function initMap () {
  if (state.mapLeaflet) return;
  const container = document.getElementById('map-container');
  state.mapLeaflet = L.map(container, { center: [39.8283, -98.5795], zoom: 4 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '\u00a9 <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(state.mapLeaflet);
  window.__ftbOpenDetail = id => openDetailModal(id);
  window.__ftbDirections = id => { const r = state.restaurants.find(x => x.id === id); if (r) openDirections(r); };
}

function renderMap () {
  if (!state.mapLeaflet) return;
  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];
  const list = getFiltered().filter(r => r.lat && r.lng);
  if (!list.length) {
    showToast('No Map Data', 'Add addresses to restaurants so they appear on the map.', 'info');
    return;
  }
  const bounds = [];
  list.forEach(r => {
    const emoji = cuisineEmoji(r.cuisine);
    const isVisited = r.status === 'visited';
    const bg  = isVisited ? 'rgba(46,204,113,.9)' : 'rgba(74,144,217,.9)';
    const bdr = isVisited ? '#2ECC71' : '#4A90D9';
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:38px;height:38px;background:${bg};border:3px solid ${bdr};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 3px 12px rgba(0,0,0,.6);cursor:pointer">${emoji}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -24],
    });
    const popup = `<div style="min-width:180px;font-family:system-ui,sans-serif">
      <div style="font-weight:700;font-size:.92rem;margin-bottom:3px">${escHtml(r.name)}</div>
      <div style="font-size:.77rem;color:#aaa;margin-bottom:6px">${r.cuisine ? escHtml(r.cuisine)+'&nbsp;&middot;&nbsp;' : ''}${priceDollars(r.priceRange)||''}</div>
      ${r.googleRating ? `<div style="font-size:.8rem;margin-bottom:6px">⭐ ${r.googleRating}/5</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:8px">
        <button onclick="window.__ftbOpenDetail('${r.id}')" style="flex:1;padding:5px 8px;background:#FF6B35;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Details</button>
        ${r.address ? `<button onclick="window.__ftbDirections('${r.id}')" style="flex:1;padding:5px 8px;background:#4A90D9;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Directions</button>` : ''}
      </div>
    </div>`;
    const marker = L.marker([r.lat, r.lng], { icon })
      .bindPopup(popup, { maxWidth: 250, closeButton: true })
      .addTo(state.mapLeaflet);
    state.mapMarkers.push(marker);
    bounds.push([r.lat, r.lng]);
  });
  if (bounds.length === 1) {
    state.mapLeaflet.setView(bounds[0], 14);
  } else {
    state.mapLeaflet.fitBounds(bounds, { padding: [50, 50] });
  }
  setTimeout(() => state.mapLeaflet.invalidateSize(), 150);
}

function showMapView () {
  document.getElementById('map-container').classList.remove('hidden');
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('stats-view').classList.add('hidden');
  initMap();
  renderMap();
}

function hideMapView () {
  document.getElementById('map-container').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
}

/* ════════════════════════════════════════════════════════════
   STATS / ANALYTICS VIEW
   ════════════════════════════════════════════════════════════ */
function showStatsView () {
  document.getElementById('stats-view').classList.remove('hidden');
  document.getElementById('main-content').classList.add('hidden');
  document.getElementById('map-container').classList.add('hidden');
  renderStatsView();
  renderStreaks();
  renderHeatmap();
  renderLeaderboard();
  renderPriceTrend();
  renderPassport();
  renderBudgetChart();
  renderVisitCalendar();
}

function hideStatsView () {
  const sv = document.getElementById('stats-view');
  if (sv) sv.classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
}

function renderStatsView () {
  const all       = state.restaurants;
  const visited   = all.filter(r => r.status === 'visited');
  const want      = all.filter(r => r.status === 'want-to-try');
  const allVisits = all.flatMap(r => r.visits || []);
  const rated     = visited.filter(r => r.myRating > 0);
  const avgMy     = rated.length
    ? (rated.reduce((s,r) => s + r.myRating, 0) / rated.length).toFixed(1)
    : null;

  // KPI row
  document.getElementById('stats-kpi-row').innerHTML = [
    { label: 'Restaurants Saved', value: all.length,       color: 'var(--primary)' },
    { label: 'Places Visited',    value: visited.length,   color: 'var(--green)' },
    { label: 'Want to Try',       value: want.length,      color: 'var(--blue)' },
    { label: 'Total Check-ins',   value: allVisits.length, color: 'var(--purple, #9B59B6)' },
    { label: 'Avg My Rating',     value: avgMy ? `${avgMy} ★` : '—', color: 'var(--gold)' },
  ].map(k => `
    <div class="kpi-card">
      <div class="kpi-value" style="color:${k.color}">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  // Cuisine bar chart
  const cuisineMap = {};
  all.forEach(r => { const k = r.cuisine || 'Other'; cuisineMap[k] = (cuisineMap[k]||0)+1; });
  const maxC = Math.max(...Object.values(cuisineMap), 1);
  document.getElementById('chart-cuisine').innerHTML = Object.entries(cuisineMap)
    .sort(([,a],[,b]) => b-a).slice(0,8)
    .map(([c,n]) => `
      <div class="bar-row">
        <div class="bar-label">${cuisineEmoji(c)} ${escHtml(c)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(n/maxC*100).toFixed(0)}%;background:${cuisineGrad(c)[0]}"></div></div>
        <div class="bar-count">${n}</div>
      </div>`).join('') || '<div class="chart-empty">No data yet</div>';

  // Visits over time (last 6 months)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
      label: d.toLocaleString('default', { month: 'short' }),
    });
  }
  const visitsByMonth = {};
  allVisits.forEach(v => {
    const m = (v.date||'').slice(0,7);
    if (m) visitsByMonth[m] = (visitsByMonth[m]||0)+1;
  });
  visited.forEach(r => {
    if (r.dateVisited && !(r.visits||[]).length) {
      const m = r.dateVisited.slice(0,7);
      visitsByMonth[m] = (visitsByMonth[m]||0)+1;
    }
  });
  const maxV = Math.max(...months.map(m => visitsByMonth[m.key]||0), 1);
  document.getElementById('chart-visits').innerHTML = months.map(m => {
    const n = visitsByMonth[m.key] || 0;
    return `<div class="bar-row">
      <div class="bar-label">${m.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(n/maxV*100).toFixed(0)}%;background:var(--green)"></div></div>
      <div class="bar-count">${n}</div>
    </div>`;
  }).join('');

  // Price distribution
  const priceLabels = {1:'$ Budget', 2:'$$ Casual', 3:'$$$ Upscale', 4:'$$$$ Fine Dining'};
  const priceMap = {};
  all.forEach(r => { if (r.priceRange) priceMap[r.priceRange] = (priceMap[r.priceRange]||0)+1; });
  const maxP = Math.max(...Object.values(priceMap), 1);
  document.getElementById('chart-price').innerHTML = [1,2,3,4].map(p => {
    const n = priceMap[p] || 0;
    return `<div class="bar-row">
      <div class="bar-label">${priceLabels[p]}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(n/maxP*100).toFixed(0)}%;background:var(--gold)"></div></div>
      <div class="bar-count">${n}</div>
    </div>`;
  }).join('');

  // Top rated visited
  const topRated = [...visited].filter(r => r.myRating > 0)
    .sort((a,b) => b.myRating - a.myRating).slice(0,5);
  document.getElementById('chart-top').innerHTML = topRated.length
    ? topRated.map((r,i) => `
        <div class="top-list-item" data-id="${r.id}">
          <span class="top-rank">#${i+1}</span>
          <span class="top-emoji">${cuisineEmoji(r.cuisine)}</span>
          <span class="top-name">${escHtml(r.name)}</span>
          <span class="top-stars">${'\u2605'.repeat(r.myRating)}</span>
        </div>`).join('')
    : '<div class="chart-empty">Rate your visits to see top picks</div>';

  document.querySelectorAll('.top-list-item[data-id]').forEach(el => {
    el.addEventListener('click', () => openDetailModal(el.dataset.id));
  });
  // Taste DNA
  renderTasteDna();
}

/* ── Full render ──────────────────────────────────────────── */
function renderAll () {
  renderStats();
  renderCuisineFilter();
  if (state.currentView === 'map') {
    showMapView();
  } else if (state.currentView === 'stats') {
    showStatsView();
  } else {
    hideMapView();
    hideStatsView();
    renderCards();
  }
  updateLocationBanner();
  renderWeeklyGoal();
}

function updateLocationBanner () {
  const banner = document.getElementById('location-banner');
  const dismissed = state.settings.locationBannerDismissed;
  if (!state.locationEnabled && !dismissed) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

/* ════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ════════════════════════════════════════════════════════════ */
function showToast (title, msg, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      ${msg ? `<div class="toast-msg">${escHtml(msg)}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Dismiss">✕</button>`;

  const dismiss = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  };
  toast.querySelector('.toast-close').onclick = dismiss;
  container.appendChild(toast);
  setTimeout(dismiss, 5000);
}

/* ════════════════════════════════════════════════════════════
   CHAT BUDDY — BYTE CUB
   ════════════════════════════════════════════════════════════ */
const GREETINGS = [
  'Hey foodie! 🐻 I\'m Byte Cub, your personal restaurant strategist. What should we plan first?',
  'Welcome back, hungry adventurer. 🐻 Want a recommendation, a surprise pick, or your next list idea?',
  'Roar and ready. 🐻 I can help you discover, organize, and decide where to eat next.',
];

const FOOD_TIPS = [
  'Pro tip: Always check if a restaurant takes reservations before you go — nothing worse than a long wait when you\'re starving! 🍽️',
  'Foodie fact: The best time to try a new restaurant is often a Tuesday or Wednesday — quieter, and the kitchen isn\'t overwhelmed!',
  'Hot tip: Follow your favorite restaurants on social media. They often post flash specials and secret menu items! 📱',
  'Did you know? Lunch menus at upscale restaurants often have the same great food at half the dinner price! 💰',
  'Sneak peek strategy: Check a restaurant\'s Google rating AND Yelp — two perspectives are better than one! ⭐',
  'The best restaurant in any city is usually NOT on the main tourist street. Wander a few blocks away! 🚶',
  'When in doubt, order what the table next to you is having — if it looks amazing, it probably is! 👀',
];

const GENERAL_RESPONSES = [
  (q) => q.match(/\b(hi|hello|hey|yo|sup)\b/i) && randomFrom([
    'Hey! 🐻 What foodie adventure shall we plan today?',
    'Hello, fellow food lover! 🍽️ What can I help you find?',
    'Hi there! Ready to discover something delicious? 😋',
  ]),
  (q) => q.match(/\b(help|how|what can)\b/i) && `Here's how I can help:\n\n• **Find** restaurants by cuisine, rating, tags, or status\n• **Recommend** high-rated spots you still need to try\n• **Nearby** discovery based on your live location\n• **Surprise me** for instant decision relief\n• **Top cuisine** insights from your visit history\n• **Collections** to organize date nights, lunch spots, and more\n• **Share cards** so your picks look great on social\n\nSay what you're craving and I'll do the rest. 🐻`,
  (q) => q.match(/\b(nearby|close|near me|around me|area)\b/i) && nearbyResponse(),
  (q) => q.match(/\b(surprise|random|anything|don.?t care|pick for me|choose for me)\b/i) && surpriseMeResponse(),
  (q) => q.match(/\b(recommend|suggest|best|top|favorite|favourite)\b/i) && recommendResponse(),
  (q) => q.match(/\b(want.?to.?try|bucket|list|haven.?t visited|unvisited)\b/i) && wantToTryResponse(),
  (q) => q.match(/\b(visited|been|went|tried|already)\b/i) && visitedResponse(),
  (q) => q.match(/\b(tip|advice|hack|secret|trick|pro tip)\b/i) && randomFrom(FOOD_TIPS),
  (q) => q.match(/\b(note|notes|reminder|remember)\b/i) && notesResponse(),
  (q) => q.match(/\b(direction|navigate|how to get|get there)\b/i) && `To get directions, just click the **Directions** button on any restaurant card — it'll open Google Maps and route you right to the door! 🗺️`,
  (q) => q.match(/\b(rate|rating|star|review)\b/i) && `You can rate any restaurant from 1–5 stars when you add or edit it. I also show the **Google rating** and review count so you know what others think! ⭐`,
  (q) => q.match(/\b(add|new restaurant|save)\b/i) && `Click **＋ Add Restaurant** in the header to add a new spot. You can even paste a Google Maps link and I'll auto-fill the details instantly! 📍`,
  (q) => q.match(/\b(notification|alert|remind|ping)\b/i) && `Enable location tracking (the 📍 button in the header) and I'll alert you whenever you're within walking distance of a restaurant on your list! 🔔`,
  (q) => q.match(/\b(cheap|budget|affordable|\$[^$])/i) && budgetResponse(),
  (q) => q.match(/\b(expensive|fancy|upscale|fine dining|\$\$\$\$)/i) && fancyResponse(),
  (q) => q.match(/\b(collection|list|group|category)\b/i) && collectionsResponse(),
  (q) => q.match(/\b(tag|tagged|#)\b/i) && tagQueryResponse(q),
  (q) => q.match(/\b(most|history|pattern|cuisine breakdown|eating most|ate most)\b/i) && topCuisineResponse(),
  (q) => cuisineFromQuery(q) && cuisineResponse(cuisineFromQuery(q)),
  // Phase 11 — enhanced responses
  (q) => q.match(/\b(taste|dna|profile|personality|my style|what am i|who am i|flavor|flavour)\b/i) && tasteDnaResponse(),
  (q) => q.match(/\b(never tried|new cuisine|never been|haven.?t been|exotic|different cuisine)\b/i) && neverTriedCuisineResponse(),
  (q) => q.match(/\b(breakfast|brunch|lunch|dinner|tonight|this evening|morning|noon|supper)\b/i) && timeBasedResponse(q),
  (q) => q.match(/\b(how many|how much|total|count|my stats|how am i doing|how.?re? i doing)\b/i) && myStatsResponse(),
  (q) => q.match(/\b(note|funny note|funniest|memorable moment|best memory)\b/i) && funnyNoteResponse(),
  (q) => q.match(/\b(going tonight|plans tonight|where tonight|eat tonight)\b/i) && goingTonightResponse(),
];

function chatResponse (userText) {
  const q = userText.trim();
  for (const fn of GENERAL_RESPONSES) {
    const r = fn(q);
    if (r) return r;
  }
  // Fallback: search restaurants by name
  const nameMatch = state.restaurants.find(r =>
    q.toLowerCase().includes(r.name.toLowerCase())
  );
  if (nameMatch) return restaurantDetailResponse(nameMatch);

  // Generic fallback
  return randomFrom([
    `Try asking "surprise me", "what's nearby", or "top cuisine breakdown" and I'll pull your best options. 🐻`,
    `Ask me for "date night ideas", "best rated", or "my collections" and I'll curate from your list. 🍽️`,
    `Tell me a cuisine like "Thai" or "Sushi", and I'll instantly surface your top choices. 🐻`,
  ]);
}

function nearbyResponse () {
  if (!state.locationEnabled) {
    return `Enable location tracking first (click the 📍 button in the header) and I'll tell you exactly what's nearby! 🗺️`;
  }
  const nearby = state.restaurants
    .filter(r => r.lat && r.lng)
    .map(r => ({ ...r, dist: haversine(state.userLat, state.userLng, r.lat, r.lng) }))
    .filter(r => r.dist < 5000)
    .sort((a,b) => a.dist - b.dist)
    .slice(0, 5);

  if (!nearby.length) return `No saved restaurants within 3 miles of your current location. Try adding some nearby spots! 🗺️`;
  const list = nearby.map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} (${fmtDist(r.dist)})</span>`
  ).join('');
  return `Here's what's close to you right now! 📍\n${list}`;
}

function recommendResponse () {
  const unvisited = state.restaurants.filter(r => r.status === 'want-to-try' && r.googleRating > 0);
  if (!unvisited.length) {
    const top = [...state.restaurants].sort((a,b) => (b.googleRating||0) - (a.googleRating||0)).slice(0,3);
    if (!top.length) return `Your list is empty! Click **＋ Add Restaurant** to start building your foodie bucket list 🐻`;
    const list = top.map(r => `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} ⭐${r.googleRating}</span>`).join('');
    return `Your top-rated spots:\n${list}`;
  }
  const top = unvisited.sort((a,b) => b.googleRating - a.googleRating).slice(0, 3);
  const list = top.map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} — ⭐${r.googleRating}</span>`
  ).join('');
  return `Here are your highest-rated spots you haven't tried yet! 🌟\n${list}\n\nGet out there and eat! 🐻`;
}

function wantToTryResponse () {
  const list = state.restaurants.filter(r => r.status === 'want-to-try');
  if (!list.length) return `Your want-to-try list is empty. Start adding restaurants you've been eyeing! 🔖`;
  const items = list.slice(0,5).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name}</span>`
  ).join('');
  return `You've got **${list.length}** restaurants on your want-to-try list! 🔖\n${items}${list.length > 5 ? `\n…and ${list.length-5} more!` : ''}`;
}

function visitedResponse () {
  const list = state.restaurants.filter(r => r.status === 'visited');
  if (!list.length) return `You haven't marked any restaurants as visited yet. Go eat something! 🍽️`;
  const items = list.slice(0,5).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name}${r.myRating ? ` ${'★'.repeat(r.myRating)}` : ''}</span>`
  ).join('');
  return `You've visited **${list.length}** place${list.length>1?'s':''}! 🏆\n${items}`;
}

function notesResponse () {
  const withNotes = state.restaurants.filter(r => r.notes);
  if (!withNotes.length) return `No notes saved yet. When you add or edit a restaurant, you can jot down must-try dishes, tips, or reminders! 📝`;
  const item = randomFrom(withNotes);
  return `Here's a note from **${item.name}**: *"${item.notes.slice(0,120)}${item.notes.length>120?'…':''}"* 📝`;
}

function budgetResponse () {
  const cheap = state.restaurants.filter(r => r.priceRange === 1);
  if (!cheap.length) return `No budget spots on your list yet. Add some $ restaurants and I'll help you find a bargain! 💰`;
  const items = cheap.slice(0,4).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} ($)</span>`
  ).join('');
  return `Budget eats on your list! 💰\n${items}`;
}

function fancyResponse () {
  const fancy = state.restaurants.filter(r => r.priceRange >= 3);
  if (!fancy.length) return `No fine dining spots on your list yet. Time to live a little! 🥂`;
  const items = fancy.slice(0,4).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} (${priceDollars(r.priceRange)})</span>`
  ).join('');
  return `Your fancy picks! 🥂\n${items}`;
}

function cuisineFromQuery (q) {
  const cuisines = [...new Set(state.restaurants.map(r => r.cuisine).filter(Boolean))];
  return cuisines.find(c => q.toLowerCase().includes(c.toLowerCase())) || null;
}

function cuisineResponse (cuisine) {
  const list = state.restaurants.filter(r =>
    (r.cuisine||'').toLowerCase() === cuisine.toLowerCase()
  );
  if (!list.length) return `No ${cuisine} restaurants on your list yet! Add one 🍽️`;
  const items = list.slice(0,5).map(r =>
    `<span class="chip-link" data-id="${r.id}">${r.name}${r.googleRating ? ` ⭐${r.googleRating}` : ''}</span>`
  ).join('');
  return `Your **${cuisine}** spots (${list.length} total):\n${items}`;
}

function restaurantDetailResponse (r) {
  const dist = distOf(r);
  const distStr = dist < Infinity ? ` — ${fmtDist(dist)} away` : '';
  return `Here's what I know about **${r.name}**:\n\n` +
    (r.googleRating ? `⭐ Google: ${r.googleRating}/5\n` : '') +
    (r.myRating ? `⭐ Your rating: ${r.myRating}/5\n` : '') +
    (r.address ? `📍 ${r.address}${distStr}\n` : '') +
    (r.priceRange ? `💰 ${priceDollars(r.priceRange)}\n` : '') +
    (r.tags?.length ? `🏷️ Tags: ${r.tags.join(', ')}\n` : '') +
    (r.notes ? `\n📝 "${r.notes}"` : '') +
    `\n\n<span class="chip-link" data-id="${r.id}">View full details</span>`;
}

function surpriseMeResponse () {
  const unvisited = state.restaurants.filter(r => r.status === 'want-to-try');
  const pool = unvisited.length ? unvisited : state.restaurants;
  if (!pool.length) return `Your list is empty! Add some restaurants first 🐻`;
  const r = randomFrom(pool);
  return `🎲 How about… **${r.name}**? ${r.cuisine ? `${cuisineEmoji(r.cuisine)} ${r.cuisine} vibes.` : ''} ${r.googleRating ? `Rated ⭐${r.googleRating}.` : ''} ${r.address ? `📍 ${r.address}` : ''}\n\n<span class="chip-link" data-id="${r.id}">View details</span>`;
}

function topCuisineResponse () {
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) return `No visited restaurants yet! Mark some as visited to see your cuisine breakdown 📊`;
  const counts = {};
  visited.forEach(r => { const c = r.cuisine || 'Other'; counts[c] = (counts[c]||0)+1; });
  const sorted = Object.entries(counts).sort(([,a],[,b]) => b-a).slice(0,5);
  const total = visited.length;
  const lines = sorted.map(([c,n]) => `${cuisineEmoji(c)} **${c}** — ${n} visit${n>1?'s':''} (${Math.round(n/total*100)}%)`).join('\n');
  return `Your foodie habits revealed! 🔍\n\n${lines}\n\n*Total: ${total} restaurants visited* 🐻`;
}

function collectionsResponse () {
  const cols = state.settings.collections || [];
  if (!cols.length) return `You haven't created any custom lists yet. Tap the 📁 button to create lists like "Date Night", "Lunch Spots", or "Hidden Gems"! 🗂️`;
  const lines = cols.map(c => {
    const count = state.restaurants.filter(r => r.collectionId === c.id).length;
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color};margin-right:4px"></span> **${c.name}** — ${count} restaurant${count!==1?'s':''}`;
  }).join('\n');
  return `Your custom lists 📁\n\n${lines}`;
}

function tagQueryResponse (q) {
  const allTags = [...new Set(state.restaurants.flatMap(r => r.tags||[]))];
  const matched = allTags.find(t => q.toLowerCase().includes(t.toLowerCase()));
  if (matched) {
    const matches = state.restaurants.filter(r => (r.tags||[]).some(t => t.toLowerCase() === matched.toLowerCase()));
    if (!matches.length) return `Nothing tagged "${matched}" yet!`;
    const items = matches.slice(0,5).map(r => `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name}</span>`).join('');
    return `Restaurants tagged **#${matched}** (${matches.length}):\n${items}`;
  }
  if (!allTags.length) return `No tags yet! Add tags to your restaurants when you save or edit them to quickly filter by vibe, occasion, or food type. 🏷️`;
  return `Your tags: ${allTags.map(t=>`**#${t}**`).join(', ')}\n\nAsk me about a specific tag!`;
}

const QUICK_REPLIES = [
  'Recommend something 🌟',
  'Surprise me! 🎲',
  'What\'s nearby? 📍',
  'Date night ideas 💫',
  'Top cuisine breakdown 📊',
  'Want to try list 🔖',
  'My collections 📁',
  'Food tip! 💡',
];

function randomFrom (arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ── Chat UI ──────────────────────────────────────────────── */
function addChatMsg (text, role = 'bot') {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = role === 'bot' ? '🐻' : '😋';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  // Convert **bold**, newlines, and preserve chip-links
  bubble.innerHTML = markdownLite(escHtml(text));

  div.appendChild(avatar);
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  // Allow chip-links to open detail modal
  bubble.querySelectorAll('.chip-link[data-id]').forEach(el => {
    el.addEventListener('click', () => openDetailModal(el.dataset.id));
  });
}

function markdownLite (html) {
  // Undo escaping for chip-link spans (they were already safe)
  return html
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/&lt;span class=&quot;chip-link&quot; data-id=&quot;(.+?)&quot;&gt;(.+?)&lt;\/span&gt;/g,
      '<span class="chip-link" data-id="$1">$2</span>');
}

function showTyping () {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg bot';
  div.id = 'typing-indicator';

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = '🐻';

  const bubble = document.createElement('div');
  bubble.className = 'chat-typing';
  bubble.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';

  div.appendChild(avatar);
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping () {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function sendChat () {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  addChatMsg(text, 'user');
  showTyping();

  // Simulate thinking delay
  setTimeout(() => {
    hideTyping();
    const response = chatResponse(text);
    addChatMsg(response, 'bot');
  }, 500 + Math.random() * 600);
}

function openChat () {
  document.getElementById('chat-panel').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  document.getElementById('chat-input').focus();

  // Show welcome message if first time
  const messages = document.getElementById('chat-messages');
  if (!messages.children.length) {
    addChatMsg(randomFrom(GREETINGS), 'bot');
    renderQuickReplies();
  }
}

function closeChat () {
  document.getElementById('chat-panel').classList.add('hidden');
  maybeHideOverlay();
}

function renderQuickReplies () {
  const container = document.getElementById('chat-suggestions');
  container.innerHTML = '';
  QUICK_REPLIES.forEach(text => {
    const btn = document.createElement('button');
    btn.className = 'suggestion-chip';
    btn.textContent = text;
    btn.onclick = () => {
      document.getElementById('chat-input').value = text;
      sendChat();
    };
    container.appendChild(btn);
  });
}

/* ════════════════════════════════════════════════════════════
   HELPER UTILS
   ════════════════════════════════════════════════════════════ */
function escHtml (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Only allow http/https photo URLs; strip characters that could break CSS url() */
function safeUrl (url) {
  if (!url) return '';
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    // Remove characters that would break CSS url('...') context
    return url.replace(/['"()\\]/g, '');
  } catch { return ''; }
}

function fmtDate (str) {
  if (!str) return '';
  try {
    return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return str; }
}

function hideBanner (id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function maybeHideOverlay () {
  const anyOpen =
    !document.getElementById('modal-overlay').classList.contains('hidden') ||
    !document.getElementById('detail-overlay').classList.contains('hidden') ||
    !document.getElementById('chat-panel').classList.contains('hidden');
  if (!anyOpen) {
    document.getElementById('ui-overlay').classList.add('hidden');
  }
}

function hasActiveFilters () {
  return !!(state.filter.search || state.filter.cuisine || state.filter.price || state.filter.tag || state.filter.collection);
}

/* ════════════════════════════════════════════════════════════
   PWA INSTALL PROMPT
   ════════════════════════════════════════════════════════════ */
let _pwaPromptEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaPromptEvent = e;
  if (!state.settings.pwaDismissed) {
    document.getElementById('pwa-banner').classList.remove('hidden');
  }
});
function initPwa () {
  document.getElementById('pwa-install-btn').addEventListener('click', async () => {
    if (!_pwaPromptEvent) return;
    _pwaPromptEvent.prompt();
    const { outcome } = await _pwaPromptEvent.userChoice;
    if (outcome === 'accepted') document.getElementById('pwa-banner').classList.add('hidden');
    _pwaPromptEvent = null;
  });
  document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
    document.getElementById('pwa-banner').classList.add('hidden');
    state.settings.pwaDismissed = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  });
}

/* ════════════════════════════════════════════════════════════
   LIGHT / DARK THEME TOGGLE
   ════════════════════════════════════════════════════════════ */
function initTheme () {
  if (state.settings.theme === 'light') document.body.classList.add('light-mode');
  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const light = document.body.classList.toggle('light-mode');
    state.settings.theme = light ? 'light' : 'dark';
    state.settings.themeManual = true; // user overrode auto-theme
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  });
}

/* ════════════════════════════════════════════════════════════
   ONBOARDING TOUR
   ════════════════════════════════════════════════════════════ */
const ONBOARDING_STEPS = [
  { icon: '🐻', title: 'Welcome to Feed The Bear', desc: 'Build your personal restaurant HQ: save spots, track visits, and keep every great find in one place.' },
  { icon: '➕', title: 'Capture Places Instantly', desc: 'Add restaurants in seconds, or paste a Google Maps URL to auto-fill details and move faster.' },
  { icon: '🗺️', title: 'Discover Around You', desc: 'Use Map view and Nearby Discovery to find what\'s close now, then save your favorites with one tap.' },
  { icon: '📊', title: 'See Your Food Story', desc: 'Stats turns your history into insights: top cuisines, ratings, trends, and your best-performing picks.' },
  { icon: '🐻', title: 'Let Byte Cub Curate', desc: 'Ask for smart recommendations, random picks, tag-based suggestions, and ready-to-share cards.' },
];
let _onboardingStep = 0;
function showOnboarding () {
  if (state.settings.onboardingDone) return;
  _onboardingStep = 0;
  renderOnboardingStep();
  document.getElementById('onboarding-overlay').classList.remove('hidden');
}
function renderOnboardingStep () {
  const step = ONBOARDING_STEPS[_onboardingStep];
  document.getElementById('onboarding-icon').textContent = step.icon;
  document.getElementById('onboarding-title').textContent = step.title;
  document.getElementById('onboarding-desc').textContent = step.desc;
  const isLast = _onboardingStep === ONBOARDING_STEPS.length - 1;
  document.getElementById('onboarding-next-btn').textContent = isLast ? 'Get Started! 🐻' : 'Next →';
  document.getElementById('onboarding-dots').innerHTML = ONBOARDING_STEPS.map((_,i) =>
    `<div class="onboarding-dot ${i === _onboardingStep ? 'active' : ''}"></div>`
  ).join('');
}
function dismissOnboarding () {
  document.getElementById('onboarding-overlay').classList.add('hidden');
  state.settings.onboardingDone = true;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

/* ════════════════════════════════════════════════════════════
   QUICK-ADD FROM GOOGLE MAPS URL
   ════════════════════════════════════════════════════════════ */
function parseMapsUrl (raw) {
  if (!raw?.trim()) { showToast('No URL', 'Paste a Google Maps link first.', 'error'); return; }
  try {
    const u = new URL(raw.trim());
    let name = '', addr = '';
    const placeMatch = u.pathname.match(/\/place\/([^/@?]+)/);
    if (placeMatch) name = decodeURIComponent(placeMatch[1]).replace(/\+/g, ' ');
    const q = u.searchParams.get('q');
    if (q) addr = decodeURIComponent(q).replace(/\+/g, ' ');
    if (name) {
      document.getElementById('form-name').value = name;
      if (!addr) document.getElementById('form-address').value = name;
    }
    if (addr && addr !== name) document.getElementById('form-address').value = addr;
    if (!name && !addr) throw new Error('no data');
    document.getElementById('form-maps-url').value = '';
    showToast('✓ Pre-filled!', 'Review the details, add notes, and save.', 'success');
    document.getElementById('form-name').focus();
  } catch {
    showToast('Could not parse', 'Copy the full Google Maps URL from your browser address bar.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   NEARBY DISCOVERY — Overpass API
   ════════════════════════════════════════════════════════════ */
async function discoverNearby () {
  if (!(await ensureLocationForDiscovery())) return;
  const overlay = document.getElementById('nearby-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  document.getElementById('nearby-results').innerHTML = '<div class="nearby-loading">🐻 Sniffing out restaurants near you…</div>';
  try {
    const { userLat: lat, userLng: lng } = state;
    const query = `[out:json][timeout:15];(node["amenity"="restaurant"](around:1609,${lat},${lng});way["amenity"="restaurant"](around:1609,${lat},${lng}););out center 20;`;
    const res  = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body:query });
    const data = await res.json();
    const els  = (data.elements || []).slice(0, 20);
    if (!els.length) { document.getElementById('nearby-results').innerHTML = '<div class="nearby-empty">No restaurants found within 1 mile. Try a different area!</div>'; return; }
    const html = els.map(el => {
      const tags = el.tags || {};
      const elLat = el.lat ?? el.center?.lat, elLon = el.lon ?? el.center?.lon;
      const name = tags.name || 'Unknown Restaurant';
      const cuisine = (tags.cuisine || '').split(';')[0];
      const dist = (elLat && elLon) ? haversine(lat, lng, elLat, elLon) : null;
      const saved = state.restaurants.some(r => r.name.toLowerCase() === name.toLowerCase());
      return `<div class="nearby-item">
        <div class="nearby-item-info">
          <div class="nearby-item-name">${escHtml(name)}</div>
          <div class="nearby-item-meta">${cuisine ? `${cuisineEmoji(cuisine)} ${escHtml(cuisine)} · ` : ''}${dist ? fmtDist(dist)+' away' : ''}</div>
        </div>
        ${saved ? '<span class="nearby-saved-badge">✓ Saved</span>' :
          `<button class="btn-sm btn-orange nearby-add-btn" data-name="${escHtml(name)}" data-cuisine="${escHtml(cuisine)}" data-lat="${elLat||''}" data-lng="${elLon||''}">+ Add</button>`}
      </div>`;
    }).join('');
    document.getElementById('nearby-results').innerHTML = html;
    document.querySelectorAll('.nearby-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.classList.add('hidden'); maybeHideOverlay();
        openAddModal();
        document.getElementById('form-name').value    = btn.dataset.name;
        document.getElementById('form-cuisine').value = btn.dataset.cuisine;
        showToast('Pre-filled!', 'Review the details and save.', 'info');
      });
    });
  } catch {
    document.getElementById('nearby-results').innerHTML = '<div class="nearby-empty">Could not fetch — check your connection.</div>';
  }
}

/* ════════════════════════════════════════════════════════════
   SHAREABLE RESTAURANT CARD — Canvas API
   ════════════════════════════════════════════════════════════ */
function ftbRoundRect (ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}
function shareCard (r) {
  const canvas = document.getElementById('share-canvas');
  const ctx = canvas.getContext('2d');
  const W = 800, H = 450;
  canvas.width = W; canvas.height = H;
  const [c1, c2] = cuisineGrad(r.cuisine);
  const bg = ctx.createLinearGradient(0,0,W,H);
  bg.addColorStop(0,'#0D0D1A'); bg.addColorStop(1,'#1A1A2E');
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
  const acc = ctx.createLinearGradient(0,0,0,H);
  acc.addColorStop(0,c1); acc.addColorStop(1,c2);
  ctx.fillStyle = acc; ctx.fillRect(0,0,8,H);
  ctx.globalAlpha = .07; ctx.font = '220px serif'; ctx.fillStyle = '#FFF';
  ctx.fillText(cuisineEmoji(r.cuisine), W-260, H-10); ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFF'; ctx.font = 'bold 40px system-ui,sans-serif';
  ctx.fillText(r.name.length>30 ? r.name.slice(0,30)+'…' : r.name, 50, 130);
  if (r.cuisine) {
    ctx.font = '15px system-ui,sans-serif';
    const badge = `${cuisineEmoji(r.cuisine)} ${r.cuisine}`;
    const bw = ctx.measureText(badge).width + 24;
    ctx.fillStyle = c1+'44'; ftbRoundRect(ctx,50,148,bw,28,8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(badge, 62, 168);
  }
  if (r.googleRating) {
    ctx.fillStyle = '#F4C430'; ctx.font = 'bold 26px system-ui,sans-serif';
    ctx.fillText(`★ ${r.googleRating}`, 50, 225);
    if (r.googleReviews) { ctx.fillStyle = '#888'; ctx.font = '14px system-ui,sans-serif'; ctx.fillText(`(${r.googleReviews.toLocaleString()} reviews)`, 50, 248); }
  }
  if (r.myRating) { ctx.fillStyle = '#F4C430'; ctx.font = '18px system-ui,sans-serif'; ctx.fillText('★'.repeat(r.myRating)+'☆'.repeat(5-r.myRating)+' My Rating', 50, r.googleRating ? 278 : 225); }
  if (r.address) { ctx.fillStyle = '#AAA'; ctx.font = '17px system-ui,sans-serif'; ctx.fillText(`📍 ${r.address.length>55?r.address.slice(0,55)+'…':r.address}`, 50, 318); }
  if (r.notes) { ctx.fillStyle = '#777'; ctx.font = 'italic 15px system-ui,sans-serif'; ctx.fillText(`"${r.notes.length>72?r.notes.slice(0,72)+'…':r.notes}"`, 50, 356); }
  if (r.priceRange) { ctx.fillStyle = '#F4C430'; ctx.font = 'bold 20px monospace'; ctx.fillText(priceDollars(r.priceRange), 50, 408); }
  const bc = r.status==='visited' ? '#2ECC71' : '#4A90D9';
  ctx.fillStyle = bc+'33'; ftbRoundRect(ctx, r.priceRange?110:50, 390, 130, 28, 8); ctx.fill();
  ctx.fillStyle = bc; ctx.font = 'bold 13px system-ui,sans-serif';
  ctx.fillText(r.status==='visited'?'✅ Visited':'🔖 Want to Try', r.priceRange?122:62, 409);
  ctx.fillStyle = '#FF6B35'; ctx.font = 'bold 15px system-ui,sans-serif';
  ctx.fillText('🐻 Feed The Bear', W-195, H-18);
  canvas.toBlob(blob => {
    const file = new File([blob], `${r.name.replace(/[^a-z0-9]/gi,'_')}-ftb.png`, {type:'image/png'});
    if (navigator.share && navigator.canShare?.({files:[file]})) {
      navigator.share({title:r.name, text:`Check out ${r.name} on Feed The Bear 🐻`, files:[file]}).catch(()=>{});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=file.name; a.click(); URL.revokeObjectURL(url);
    }
    showToast('📤 Card Ready!', `"${r.name}" card saved!`, 'success');
  }, 'image/png');
}

/* ════════════════════════════════════════════════════════════
   BULK SELECT & ACTIONS
   ════════════════════════════════════════════════════════════ */
function toggleBulkMode () {
  state.bulkMode = !state.bulkMode;
  state.selectedIds.clear();
  document.body.classList.toggle('bulk-mode', state.bulkMode);
  document.getElementById('bulk-bar').classList.toggle('hidden', !state.bulkMode);
  document.getElementById('bulk-select-btn').classList.toggle('active', state.bulkMode);
  updateBulkCount();
  renderCards();
}
function updateBulkCount () {
  const n = state.selectedIds.size;
  document.getElementById('bulk-count').textContent = n === 0 ? 'Select restaurants' : `${n} selected`;
  ['bulk-tag-btn','bulk-collection-btn','bulk-export-btn','bulk-delete-btn'].forEach(id => {
    document.getElementById(id).disabled = n === 0;
  });
}
function bulkDelete () {
  const n = state.selectedIds.size;
  if (!n || !confirm(`Delete ${n} restaurant${n>1?'s':''}? This cannot be undone.`)) return;
  state.restaurants = state.restaurants.filter(r => !state.selectedIds.has(r.id));
  saveData(); toggleBulkMode(); renderAll();
  showToast('🗑️ Deleted', `${n} restaurant${n>1?'s':''} removed.`, 'info');
}
function bulkTag () {
  if (!state.selectedIds.size) return;
  const tag = prompt('Tag to add to all selected:');
  if (!tag?.trim()) return;
  const t = tag.trim().toLowerCase();
  state.selectedIds.forEach(id => {
    const idx = state.restaurants.findIndex(r => r.id === id);
    if (idx !== -1) { if (!state.restaurants[idx].tags) state.restaurants[idx].tags = []; if (!state.restaurants[idx].tags.includes(t)) state.restaurants[idx].tags.push(t); }
  });
  saveData(); toggleBulkMode(); renderAll();
  showToast('🏷️ Tagged!', `"${t}" added to ${state.selectedIds.size} restaurants.`, 'success');
}
function bulkExport () {
  const sel = state.restaurants.filter(r => state.selectedIds.has(r.id));
  if (!sel.length) return;
  const blob = new Blob([JSON.stringify(sel, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=`ftb-export-${iso()}.json`; a.click(); URL.revokeObjectURL(url);
  showToast('📥 Exported!', `${sel.length} restaurants saved.`, 'success');
}
function bulkMoveToCollection () {
  if (!state.selectedIds.size) return;
  const cols = state.settings.collections || [];
  if (!cols.length) { showToast('No Lists', 'Create a list first via the 📁 button.', 'info'); return; }
  const names = cols.map((c,i) => `${i+1}. ${c.name}`).join('\n');
  const choice = prompt(`Move to which list?\n\n${names}\n\n(Enter number, or 0 to remove from all):`);
  const num = parseInt(choice);
  if (isNaN(num)) return;
  const col = num===0 ? null : cols[num-1];
  state.selectedIds.forEach(id => { const idx = state.restaurants.findIndex(r=>r.id===id); if (idx!==-1) state.restaurants[idx].collectionId = col?.id||null; });
  saveData(); toggleBulkMode(); renderAll();
  showToast('📁 Moved!', col ? `Added to "${col.name}".` : 'Removed from all lists.', 'success');
}

/* ════════════════════════════════════════════════════════════
   CUSTOM LISTS / COLLECTIONS
   ════════════════════════════════════════════════════════════ */
const COLLECTION_COLORS = ['#FF6B35','#E74C3C','#9B59B6','#3498DB','#2ECC71','#F39C12','#1ABC9C','#E91E63'];
let _newCollectionColor = COLLECTION_COLORS[0];
function initCollections () {
  const panel = document.getElementById('collections-panel');
  const swatchRow = document.getElementById('collection-color-swatches');
  swatchRow.innerHTML = COLLECTION_COLORS.map(c =>
    `<div class="collection-color-swatch${c===_newCollectionColor?' selected':''}" data-color="${c}" style="background:${c}" title="${c}"></div>`
  ).join('');
  swatchRow.querySelectorAll('.collection-color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      _newCollectionColor = sw.dataset.color;
      swatchRow.querySelectorAll('.collection-color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
  });
  document.getElementById('collections-btn').addEventListener('click', () => {
    panel.classList.add('open');
    document.getElementById('ui-overlay').classList.remove('hidden');
    renderCollectionsList();
  });
  document.getElementById('collections-panel-close').addEventListener('click', () => {
    panel.classList.remove('open'); maybeHideOverlay();
  });
  document.getElementById('add-collection-btn').addEventListener('click', () => {
    const name = document.getElementById('new-collection-name').value.trim();
    if (!name) return;
    if (!state.settings.collections) state.settings.collections = [];
    state.settings.collections.push({id: uid(), name, color: _newCollectionColor});
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    document.getElementById('new-collection-name').value = '';
    renderCollectionsList(); renderCollectionFilter();
    showToast('📁 List Created!', `"${name}" ready.`, 'success');
  });
  renderCollectionFilter();
}
function renderCollectionsList () {
  const list = document.getElementById('collections-list');
  const cols = state.settings.collections || [];
  if (!cols.length) { list.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">No custom lists yet. Create one below!</div>'; return; }
  list.innerHTML = cols.map(c => {
    const count = state.restaurants.filter(r => r.collectionId === c.id).length;
    return `<div class="collection-item" data-cid="${c.id}">
      <div class="collection-dot" style="background:${c.color}"></div>
      <div class="collection-item-name">${escHtml(c.name)}</div>
      <div class="collection-item-count">${count}</div>
      <button class="collection-item-del" data-del="${c.id}" title="Delete">✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.collection-item-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteCollection(btn.dataset.del); });
  });
}
function deleteCollection (id) {
  if (!confirm('Delete this list? Restaurants won\'t be deleted.')) return;
  state.settings.collections = (state.settings.collections||[]).filter(c => c.id!==id);
  state.restaurants.forEach(r => { if (r.collectionId===id) r.collectionId=null; });
  saveData(); localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  renderCollectionsList(); renderCollectionFilter(); renderAll();
}
function renderCollectionFilter () {
  const sel = document.getElementById('filter-collection'); if (!sel) return;
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  (state.settings.collections||[]).forEach(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=`📁 ${c.name}`; sel.appendChild(o); });
  sel.value = cur;
}
function populateFormCollections () {
  const sel = document.getElementById('form-collection'); if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  (state.settings.collections||[]).forEach(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; sel.appendChild(o); });
}

/* ════════════════════════════════════════════════════════════
   TAG AUTOCOMPLETE
   ════════════════════════════════════════════════════════════ */
function updateTagSuggestions () {
  const dl = document.getElementById('tag-suggestions'); if (!dl) return;
  const allTags = [...new Set(state.restaurants.flatMap(r => r.tags||[]))].sort();
  dl.innerHTML = allTags.map(t => `<option value="${escHtml(t)}">`).join('');
}

/* ════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ════════════════════════════════════════════════════════════ */
function setupEvents () {
  // Nav buttons
  document.getElementById('main-nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    document.querySelectorAll('.nav-btn, .mobile-nav-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.mobile-nav-btn[data-view="${btn.dataset.view}"]`)?.classList.add('active');
    state.currentView = btn.dataset.view;
    if (state.currentView === 'map') { showMapView(); }
    else if (state.currentView === 'stats') { showStatsView(); }
    else { hideMapView(); hideStatsView(); renderCards(); }
  });

  // Add button
  document.getElementById('add-btn').addEventListener('click', openAddModal);
  document.getElementById('empty-add-btn').addEventListener('click', openAddModal);

  // Modal close
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Detail modal close
  document.getElementById('detail-close-btn').addEventListener('click', closeDetailModal);
  document.getElementById('detail-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('detail-overlay')) closeDetailModal();
  });

  // Form submit
  document.getElementById('restaurant-form').addEventListener('submit', handleFormSubmit);

  // Star picker
  const picker = document.getElementById('form-star-picker');
  picker.addEventListener('mouseover', e => {
    const btn = e.target.closest('.star-pick');
    if (!btn) return;
    const val = parseInt(btn.dataset.val);
    document.querySelectorAll('.star-pick').forEach(b => {
      b.classList.toggle('hover', parseInt(b.dataset.val) <= val);
      b.classList.remove('active');
    });
  });
  picker.addEventListener('mouseout', () => {
    document.querySelectorAll('.star-pick').forEach(b => {
      b.classList.remove('hover');
      b.classList.toggle('active', parseInt(b.dataset.val) <= state.formRating);
    });
  });
  picker.addEventListener('click', e => {
    const btn = e.target.closest('.star-pick');
    if (!btn) return;
    const val = parseInt(btn.dataset.val);
    setFormStars(state.formRating === val ? 0 : val); // toggle off if same
  });

  // Filters
  document.getElementById('search-input').addEventListener('input', e => {
    state.filter.search = e.target.value;
    updateClearBtn();
    renderCards();
  });
  document.getElementById('filter-cuisine').addEventListener('change', e => {
    state.filter.cuisine = e.target.value;
    updateClearBtn();
    renderCards();
  });
  document.getElementById('filter-price').addEventListener('change', e => {
    state.filter.price = e.target.value;
    updateClearBtn();
    renderCards();
  });
  document.getElementById('sort-select').addEventListener('change', e => {
    state.filter.sort = e.target.value;
    renderCards();
  });
  document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);
  document.getElementById('no-results-clear-btn').addEventListener('click', clearFilters);

  // Location toggle
  document.getElementById('location-toggle-btn').addEventListener('click', () => {
    if (state.locationEnabled) disableLocation();
    else enableLocation();
  });
  document.getElementById('enable-location-btn').addEventListener('click', () => {
    enableLocation();
  });
  document.getElementById('dismiss-location-banner').addEventListener('click', () => {
    state.settings.locationBannerDismissed = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    hideBanner('location-banner');
  });

  // Proximity alert close
  document.getElementById('proximity-close').addEventListener('click', () => {
    document.getElementById('proximity-alert').classList.add('hidden');
  });

  // Chat
  document.getElementById('chat-toggle-btn').addEventListener('click', openChat);
  document.getElementById('chat-close-btn').addEventListener('click', closeChat);
  document.getElementById('chat-send-btn').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  // Overlay click dismisses panels
  document.getElementById('ui-overlay').addEventListener('click', () => {
    closeModal();
    closeDetailModal();
    closeChat();
  });

  // Status radio → show/hide date-visited field
  document.querySelectorAll('input[name="form-status"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isVisited = document.querySelector('input[name="form-status"]:checked')?.value === 'visited';
      document.getElementById('form-date-visited-group').classList.toggle('hidden', !isVisited);
      if (!isVisited) document.getElementById('form-date-visited').value = '';
    });
  });

  // Photo file upload → read as data URL into URL field
  document.getElementById('form-photo-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Invalid File', 'Please select an image file.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('form-photo').value = ev.target.result;
      showToast('Photo Added 📷', 'Image loaded successfully.', 'success');
    };
    reader.readAsDataURL(file);
  });

  // Export / Import
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-file-input').addEventListener('change', e => {
    importData(e.target.files[0]);
    e.target.value = '';
  });

  // Mobile bottom nav
  document.getElementById('mobile-bottom-nav').addEventListener('click', e => {
    const btn = e.target.closest('.mobile-nav-btn');
    if (!btn) return;
    if (btn.id === 'mobile-add-btn') { openAddModal(); return; }
    document.querySelectorAll('.nav-btn, .mobile-nav-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.nav-btn[data-view="${btn.dataset.view}"]`)?.classList.add('active');
    state.currentView = btn.dataset.view;
    if (state.currentView === 'map') { showMapView(); }
    else if (state.currentView === 'stats') { showStatsView(); }
    else { hideMapView(); hideStatsView(); renderCards(); }
  });

  // Group-by toggle
  document.getElementById('group-by-btn').addEventListener('click', () => {
    state.groupBy = !state.groupBy;
    document.getElementById('group-by-btn').classList.toggle('active', state.groupBy);
    if (state.currentView !== 'map') renderCards();
  });

  // Quick filter chips
  document.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const action = chip.dataset.action;
      if (action === 'top-rated') {
        state.filter.sort = 'rating-desc';
        document.getElementById('sort-select').value = 'rating-desc';
      } else if (action === 'nearest') {
        if (!state.locationEnabled) { showToast('Location needed', 'Enable location tracking first.', 'error'); return; }
        state.filter.sort = 'distance-asc';
        document.getElementById('sort-select').value = 'distance-asc';
      } else if (action === 'discover') {
        discoverNearby(); return;
      }
      if (state.currentView !== 'map') renderCards();
    });
  });

  // Collection filter
  const fcSel = document.getElementById('filter-collection');
  if (fcSel) {
    fcSel.addEventListener('change', e => {
      state.filter.collection = e.target.value;
      updateClearBtn(); renderCards();
    });
  }

  // Maps URL parse
  document.getElementById('form-maps-parse-btn').addEventListener('click', () => {
    parseMapsUrl(document.getElementById('form-maps-url').value);
  });
  document.getElementById('form-maps-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); parseMapsUrl(e.target.value); }
  });

  // Bulk mode
  document.getElementById('bulk-select-btn').addEventListener('click', toggleBulkMode);
  document.getElementById('bulk-cancel-btn').addEventListener('click', toggleBulkMode);
  document.getElementById('bulk-tag-btn').addEventListener('click', bulkTag);
  document.getElementById('bulk-collection-btn').addEventListener('click', bulkMoveToCollection);
  document.getElementById('bulk-export-btn').addEventListener('click', bulkExport);
  document.getElementById('bulk-delete-btn').addEventListener('click', bulkDelete);

  // Nearby overlay close
  document.getElementById('nearby-close-btn').addEventListener('click', () => {
    document.getElementById('nearby-overlay').classList.add('hidden'); maybeHideOverlay();
  });
  document.getElementById('nearby-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('nearby-overlay')) {
      document.getElementById('nearby-overlay').classList.add('hidden'); maybeHideOverlay();
    }
  });

  // Onboarding
  document.getElementById('onboarding-next-btn').addEventListener('click', () => {
    if (_onboardingStep < ONBOARDING_STEPS.length - 1) {
      _onboardingStep++; renderOnboardingStep();
    } else { dismissOnboarding(); }
  });
  document.getElementById('onboarding-skip-btn').addEventListener('click', dismissOnboarding);

  // Keyboard: Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      closeDetailModal();
      closeChat();
      closeTonightsPick();
      closeChallengeModal();
      closeWrap();
      closeImportBookmarks();
      closeGallery();
      closeCompare();
      closeBudget();
      closeFoodieProfile();
      closeCravingEngine();
      closeDishTracker();
      closeYearReview();
      closeFoodieFriends();
      closeDiscover();
      closeChallenges();
      closeDebrief();
      closeStats2();
      closeAiPanel();
      closeRoutePlanner();
      closeExport2();
      closeAchievements();
      closeSwipeDeck();
      closeSpinWheel();
      closeTravelMode();
      closeMonthlyDigest();
      closeOpenNow();
      closeDuel();
      closeBingo();
      closeFortune();
      closeMoodCal();
      closeDailyChallenge();
      closeVisitLog();
      closeSpendTracker();
      closeBeenaWhile();
      closeMealPlanner();
      closeGroupVote();
      closeWorldMap();
      closePassport();
      closeFeedBearGame();
      document.getElementById('nearby-overlay').classList.add('hidden');
      document.getElementById('collections-panel').classList.remove('open');
      maybeHideOverlay();
    }
  });

  // Tonight's Pick
  document.getElementById('tonight-btn').addEventListener('click', showTonightsPick);
  document.getElementById('tonight-close-btn').addEventListener('click', closeTonightsPick);
  document.getElementById('tonight-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('tonight-overlay')) closeTonightsPick();
  });
  document.getElementById('tonight-pick-btn').addEventListener('click', runTonightsPick);
  document.getElementById('tonight-moods').addEventListener('click', e => {
    const chip = e.target.closest('.mood-chip');
    if (chip) chip.classList.toggle('selected');
  });

  // PDF export
  document.getElementById('pdf-export-btn').addEventListener('click', exportFoodieReport);

  // Friend Challenge
  document.getElementById('challenge-btn').addEventListener('click', openChallengeModal);
  document.getElementById('challenge-close-btn').addEventListener('click', closeChallengeModal);
  document.getElementById('challenge-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('challenge-overlay')) closeChallengeModal();
  });
  document.getElementById('challenge-copy-btn').addEventListener('click', copyChallengeLink);
  document.getElementById('challenge-share-btn').addEventListener('click', shareChallengeLink);

  // AI Photo Fill
  document.getElementById('ai-photo-btn').addEventListener('click', aiPhotoFill);

  // Phase 6 — Wrap
  document.getElementById('wrap-btn').addEventListener('click', () => showWrap(0));
  document.getElementById('wrap-close-btn').addEventListener('click', closeWrap);
  document.getElementById('wrap-prev-btn').addEventListener('click', () => showWrap(_wrapOffset - 1));
  document.getElementById('wrap-next-btn').addEventListener('click', () => showWrap(_wrapOffset + 1));
  document.getElementById('wrap-share-btn').addEventListener('click', shareWrap);
  document.getElementById('wrap-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('wrap-overlay')) closeWrap();
  });

  // Phase 6 — Import Bookmarks
  document.getElementById('import-bookmarks-btn').addEventListener('click', showImportBookmarks);
  document.getElementById('import-close-btn').addEventListener('click', closeImportBookmarks);
  document.getElementById('import-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('import-overlay')) closeImportBookmarks();
  });
  document.getElementById('import-parse-btn').addEventListener('click', parseImportText);
  document.getElementById('import-confirm-btn').addEventListener('click', confirmImport);

  // Phase 6 — Add to Calendar
  document.getElementById('detail-calendar-btn').addEventListener('click', () => {
    if (state.detailId) addToGoogleCalendar(state.detailId);
  });

  // Phase 7 — Voice
  document.getElementById('voice-btn').addEventListener('click', startVoiceAdd);
  document.getElementById('voice-cancel-btn').addEventListener('click', stopVoice);

  // Phase 7 — Gallery
  document.getElementById('gallery-btn').addEventListener('click', openGallery);
  document.getElementById('gallery-close-btn').addEventListener('click', closeGallery);
  document.getElementById('gallery-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('gallery-overlay')) closeGallery();
  });
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', () => { if (_lightboxIdx > 0) { _lightboxIdx--; renderLightbox(); } });
  document.getElementById('lightbox-next').addEventListener('click', () => { if (_lightboxIdx < _galleryPhotos.length-1) { _lightboxIdx++; renderLightbox(); } });

  // Phase 7 — Compare
  document.getElementById('compare-btn').addEventListener('click', toggleCompareMode);
  document.getElementById('compare-now-btn').addEventListener('click', showCompare);
  document.getElementById('compare-cancel-btn').addEventListener('click', cancelCompare);
  document.getElementById('compare-close-btn').addEventListener('click', closeCompare);
  document.getElementById('compare-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('compare-overlay')) closeCompare();
  });

  // Phase 7 — Budget
  document.getElementById('budget-btn').addEventListener('click', openBudget);
  document.getElementById('budget-close-btn').addEventListener('click', closeBudget);
  document.getElementById('budget-save-btn').addEventListener('click', saveBudget);
  document.getElementById('budget-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('budget-overlay')) closeBudget();
  });

  // Phase 7 — Profile
  document.getElementById('profile-btn').addEventListener('click', openFoodieProfile);
  document.getElementById('profile-close-btn').addEventListener('click', closeFoodieProfile);
  document.getElementById('profile-copy-btn').addEventListener('click', copyProfileLink);
  document.getElementById('profile-share-btn').addEventListener('click', shareProfile);
  document.getElementById('profile-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('profile-overlay')) closeFoodieProfile();
  });

  // Phase 7 — Reservation Reminders
  document.getElementById('detail-set-reminder-btn').addEventListener('click', () => {
    if (state.detailId) setReminder(state.detailId);
  });

  // Phase 7 — Auto-Tags (form field hooks)
  ['form-name','form-cuisine','form-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', computeAutoTags);
  });

  // Phase 7 — Escape closes new modals (comment only — actual close calls below in Escape handler)
  document.getElementById('form-name').addEventListener('input', computeAutoTags);

  // Phase 8 — ⋯ More Menu
  initMoreMenu();

  // Phase 8 — Craving Engine
  document.getElementById('craving-btn').addEventListener('click', openCravingEngine);
  document.getElementById('craving-close-btn').addEventListener('click', closeCravingEngine);
  document.getElementById('craving-go-btn').addEventListener('click', runCravingEngine);
  document.getElementById('craving-overlay').addEventListener('click', e => { if (e.target === document.getElementById('craving-overlay')) closeCravingEngine(); });
  document.getElementById('craving-mood-chips').addEventListener('click', e => {
    const chip = e.target.closest('.craving-chip');
    if (!chip) return;
    chip.classList.toggle('selected');
    const mood = chip.dataset.mood;
    if (_cravingMoods.has(mood)) _cravingMoods.delete(mood); else _cravingMoods.add(mood);
  });

  // Phase 8 — Dish Tracker
  document.getElementById('dish-close-btn').addEventListener('click', closeDishTracker);
  document.getElementById('dish-overlay').addEventListener('click', e => { if (e.target === document.getElementById('dish-overlay')) closeDishTracker(); });
  document.getElementById('dish-add-btn').addEventListener('click', addDish);
  document.getElementById('dish-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') addDish(); });
  document.getElementById('dish-rating-picker').addEventListener('click', e => {
    const star = e.target.closest('.spm');
    if (!star) return;
    _renderDishRatingPicker(parseInt(star.dataset.v));
  });
  document.getElementById('detail-dishes-btn').addEventListener('click', () => { if (state.detailId) openDishTracker(state.detailId); });

  // Phase 8 — Visit Debrief
  document.getElementById('detail-debrief-btn').addEventListener('click', () => { if (state.detailId) openVisitDebrief(state.detailId); });
  document.getElementById('debrief-save-btn').addEventListener('click', saveDebrief);
  document.getElementById('debrief-skip-btn').addEventListener('click', closeDebrief);
  document.getElementById('debrief-overlay').addEventListener('click', e => { if (e.target === document.getElementById('debrief-overlay')) closeDebrief(); });

  // Phase 8 — Year in Review
  document.getElementById('review-close-btn').addEventListener('click', closeYearReview);
  document.getElementById('review-close-btn2').addEventListener('click', closeYearReview);
  document.getElementById('review-share-btn').addEventListener('click', shareYearReview);
  document.getElementById('review-overlay').addEventListener('click', e => { if (e.target === document.getElementById('review-overlay')) closeYearReview(); });
  document.getElementById('review-prev-year').addEventListener('click', () => { _reviewYear--; document.getElementById('review-year-label').textContent = _reviewYear; renderYearReview(); });
  document.getElementById('review-next-year').addEventListener('click', () => { _reviewYear++; document.getElementById('review-year-label').textContent = _reviewYear; renderYearReview(); });

  // Phase 8 — Foodie Friends
  document.getElementById('friends-close-btn').addEventListener('click', closeFoodieFriends);
  document.getElementById('friends-overlay').addEventListener('click', e => { if (e.target === document.getElementById('friends-overlay')) closeFoodieFriends(); });
  document.getElementById('friends-load-btn').addEventListener('click', loadFriendProfile);
  document.getElementById('friends-link-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadFriendProfile(); });
  document.getElementById('friends-copy-btn').addEventListener('click', () => { navigator.clipboard?.writeText(document.getElementById('friends-my-link-input').value); showToast('Copied!', 'Profile link copied.', 'success'); });

  // Phase 8 — Smart Discovery
  document.getElementById('discover-close-btn').addEventListener('click', closeDiscover);
  document.getElementById('discover-overlay').addEventListener('click', e => { if (e.target === document.getElementById('discover-overlay')) closeDiscover(); });
  document.getElementById('discover-search-btn').addEventListener('click', runDiscover);

  // Phase 8 — Challenges
  document.getElementById('challenges-close-btn').addEventListener('click', closeChallenges);
  document.getElementById('challenges-overlay').addEventListener('click', e => { if (e.target === document.getElementById('challenges-overlay')) closeChallenges(); });
  document.querySelectorAll('.chal-tab').forEach(tab => tab.addEventListener('click', () => switchChalTab(tab.dataset.tab)));
  document.getElementById('chal-create-btn').addEventListener('click', createChallenge);
  document.getElementById('chal-friend-load-btn').addEventListener('click', loadFriendChallenge);

  // Phase 9 — Deep Stats
  document.getElementById('stats2-close-btn').addEventListener('click', closeStats2);
  document.getElementById('stats2-overlay').addEventListener('click', e => { if (e.target === document.getElementById('stats2-overlay')) closeStats2(); });

  // AI Core — Byte Cub panel
  document.getElementById('ai-panel-close-btn').addEventListener('click', closeAiPanel);
  document.getElementById('ai-panel-overlay').addEventListener('click', e => { if (e.target === document.getElementById('ai-panel-overlay')) closeAiPanel(); });
  document.getElementById('ai-chat-send-btn').addEventListener('click', () => sendAiMessage(document.getElementById('ai-chat-input').value));
  document.getElementById('ai-chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendAiMessage(document.getElementById('ai-chat-input').value); });
  document.getElementById('ai-chat-history').addEventListener('click', e => {
    const btn = e.target.closest('.ai-quick-btn');
    if (btn) handleAiQuickBtn(btn.dataset.prompt);
  });
  document.querySelectorAll('.ai-quick-btn').forEach(btn => btn.addEventListener('click', () => handleAiQuickBtn(btn.dataset.prompt)));

  // AI Core — API key setup
  document.getElementById('ai-save-key-btn').addEventListener('click', () => {
    const val = document.getElementById('ai-gemini-key-input').value.trim();
    if (!val.startsWith('AIza')) { showToast('Invalid Key', 'Gemini keys start with AIza\u2026', 'error'); return; }
    AI.setKey(val);
    _syncAiKeyUI();
    showToast('\u2728 Gemini Connected!', 'AI features are now unlocked.', 'success');
  });
  document.getElementById('ai-change-key-btn').addEventListener('click', () => {
    document.getElementById('ai-key-setup').classList.remove('hidden');
    document.getElementById('ai-key-active').classList.add('hidden');
  });

  // AI — Detail modal
  document.getElementById('detail-ai-btn').addEventListener('click', () => { if (state.detailId) getAiDetailSummary(state.detailId); });
  document.getElementById('detail-dishes-ai-btn').addEventListener('click', () => { if (state.detailId) getAiDishRecs(state.detailId); });

  // AI — Smart Fill button in add/edit form
  document.getElementById('ai-smart-fill-btn').addEventListener('click', async () => {
    const name = document.getElementById('form-name').value.trim();
    if (!name) { showToast('Name needed', 'Enter a restaurant name first.', 'info'); return; }
    if (!AI.hasKey()) { openAiPanel(); return; }
    const fillResult = document.getElementById('ai-fill-result');
    fillResult.classList.remove('hidden');
    fillResult.innerHTML = '\uD83D\uDC3B <span class="ai-thinking-inline"><span></span><span></span><span></span></span>';
    try {
      const addr = document.getElementById('form-address').value.trim();
      const data = await AI.smartFill(name, addr);
      if (data.cuisine)    { document.getElementById('form-cuisine').value = data.cuisine; }
      if (data.priceRange) { const sel = document.getElementById('form-price'); if (sel) sel.value = data.priceRange; }
      if (data.description) { const notesEl = document.getElementById('form-notes'); if (!notesEl.value) notesEl.value = data.description; }
      // Tags
      if (data.tags && data.tags.length) {
        data.tags.forEach(tag => {
          const cb = document.querySelector(`.tag-check[value="${escHtml(tag)}"]`);
          if (cb) cb.checked = true;
        });
      }
      fillResult.innerHTML = `\u2713 AI filled — cuisine, price & tags. Confidence: ${Math.round((data.confidence || 0.8)*100)}%`;
      fillResult.style.color = 'var(--green)';
    } catch (err) {
      fillResult.innerHTML = '\u26A0 ' + escHtml(err.message || 'AI error');
      fillResult.style.color = 'var(--primary)';
    }
  });

  // AI — Notes enricher
  document.getElementById('ai-notes-btn').addEventListener('click', async () => {
    const notes = document.getElementById('form-notes').value.trim();
    if (!notes) { showToast('Write a note first', 'Jot down something and let AI enrich it.', 'info'); return; }
    if (!AI.hasKey()) { openAiPanel(); return; }
    const notesResult = document.getElementById('ai-notes-result');
    notesResult.classList.remove('hidden');
    notesResult.innerHTML = '\uD83D\uDC3B <span class="ai-thinking-inline"><span></span><span></span><span></span></span>';
    try {
      const r = {
        name: document.getElementById('form-name').value.trim(),
        cuisine: document.getElementById('form-cuisine').value.trim(),
        myRating: document.getElementById('form-rating').value,
      };
      const rich = await AI.enrichNotes(r, notes);
      notesResult.innerHTML = `<strong>AI Enriched:</strong> ${escHtml(rich)} <button class="btn-sm btn-ai" id="notes-apply-btn" style="margin-left:8px">Apply</button>`;
      document.getElementById('notes-apply-btn').addEventListener('click', () => {
        document.getElementById('form-notes').value = rich;
        notesResult.classList.add('hidden');
      });
    } catch (err) {
      notesResult.innerHTML = '\u26A0 ' + escHtml(err.message || 'AI error');
    }
  });

  // AI — Lightbox caption
  document.getElementById('lightbox-ai-caption-btn').addEventListener('click', async () => {
    const img = document.getElementById('lightbox-img');
    if (!img.src || img.src === window.location.href) return;
    if (!AI.hasKey()) { openAiPanel(); return; }
    const captionBtn = document.getElementById('lightbox-ai-caption-btn');
    captionBtn.disabled = true; captionBtn.textContent = '\u2728 Captioning\u2026';
    try {
      // Convert img src to base64
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const b64 = canvas.toDataURL('image/jpeg').split(',')[1];
      const rName = state.detailId ? (state.restaurants.find(r=>r.id===state.detailId)||{}).name||'' : '';
      const caption = await AI.captionPhoto(b64, 'image/jpeg', rName);
      const capEl = document.getElementById('lightbox-caption');
      capEl.textContent = caption;
      captionBtn.textContent = '\u2713 Captioned!';
    } catch (err) {
      captionBtn.textContent = '\u26A0 Error'; showToast('Caption failed', err.message, 'error');
    }
    setTimeout(() => { captionBtn.disabled = false; captionBtn.textContent = '\u2728 AI Caption'; }, 4000);
  });

  // AI — Monthly wrap narrative
  const wrapAiBtn = document.getElementById('wrap-ai-btn');
  if (wrapAiBtn) wrapAiBtn.addEventListener('click', async () => {
    if (!AI.hasKey()) { openAiPanel(); return; }
    const digestEl = document.getElementById('wrap-ai-digest');
    digestEl.classList.remove('hidden');
    digestEl.innerHTML = '\uD83D\uDC3B <span class="ai-thinking-inline"><span></span><span></span><span></span></span>';
    try {
      const monthLabel = new Date().toLocaleDateString('en-US', { month:'long', year:'numeric' });
      const narrative = await AI.digest(state.restaurants, monthLabel);
      digestEl.innerHTML = '<div class="ai-digest-inner">' + markdownLite(escHtml(narrative)) + '</div>';
    } catch (err) {
      digestEl.innerHTML = '\u26A0 ' + escHtml(err.message || 'AI error');
    }
  });

  // AI — Year review narrative
  const reviewAiBtn = document.getElementById('review-ai-btn');
  if (reviewAiBtn) reviewAiBtn.addEventListener('click', async () => {
    if (!AI.hasKey()) { openAiPanel(); return; }
    const digestEl = document.getElementById('review-ai-digest');
    digestEl.classList.remove('hidden');
    digestEl.innerHTML = '\uD83D\uDC3B <span class="ai-thinking-inline"><span></span><span></span><span></span></span>';
    try {
      const narrative = await AI.digest(state.restaurants, new Date().getFullYear() + ' Year in Review');
      digestEl.innerHTML = '<div class="ai-digest-inner">' + markdownLite(escHtml(narrative)) + '</div>';
    } catch (err) {
      digestEl.innerHTML = '\u26A0 ' + escHtml(err.message || 'AI error');
    }
  });

  // AI — Taste Profile (stats view)
  const tasteBtn = document.getElementById('ai-taste-profile-btn');
  if (tasteBtn) tasteBtn.addEventListener('click', async () => {
    if (!AI.hasKey()) { openAiPanel(); return; }
    const card = document.getElementById('ai-taste-profile-result');
    card.classList.remove('hidden');
    card.innerHTML = '\uD83D\uDC3B <span class="ai-thinking-inline"><span></span><span></span><span></span></span>';
    try {
      const profile = await AI.tasteProfile(state.restaurants);
      card.innerHTML = `
        <div class="taste-profile-card">
          <div class="taste-profile-emoji">${escHtml(profile.emoji || '\uD83C\uDF74')}</div>
          <div class="taste-profile-body">
            <div class="taste-profile-title">${escHtml(profile.title || 'Food Explorer')}</div>
            <div class="taste-profile-sub">${escHtml(profile.subtitle || '')}</div>
            <div class="taste-profile-traits">${(profile.traits || []).map(t => `<span class="taste-trait">${escHtml(t)}</span>`).join('')}</div>
            <p class="taste-profile-insight">${escHtml(profile.insight || '')}</p>
            ${profile.challenge ? `<p class="taste-profile-challenge"><strong>Your challenge:</strong> ${escHtml(profile.challenge)}</p>` : ''}
          </div>
        </div>`;
    } catch (err) {
      card.innerHTML = '\u26A0 ' + escHtml(err.message || 'AI error');
    }
  });

  // Phase 9 — Route Planner
  document.getElementById('route-close-btn').addEventListener('click', closeRoutePlanner);
  document.getElementById('route-overlay').addEventListener('click', e => { if (e.target === document.getElementById('route-overlay')) closeRoutePlanner(); });
  document.getElementById('route-go-btn').addEventListener('click', launchRoute);
  document.getElementById('detail-route-btn').addEventListener('click', openRoutePlanner);

  // Phase 9 — Export v2
  document.getElementById('export2-close-btn').addEventListener('click', closeExport2);
  document.getElementById('export2-overlay').addEventListener('click', e => { if (e.target === document.getElementById('export2-overlay')) closeExport2(); });
  document.getElementById('export2-passport-btn').addEventListener('click', exportPassport);
  document.getElementById('export2-page-btn').addEventListener('click', exportShareablePage);
  document.getElementById('export2-csv-btn').addEventListener('click', exportCSV);

  // Phase 10 — Achievements
  document.getElementById('ach-close-btn').addEventListener('click', closeAchievements);
  document.getElementById('achievements-overlay').addEventListener('click', e => { if (e.target === document.getElementById('achievements-overlay')) closeAchievements(); });

  // Phase 10 — Swipe Deck
  document.getElementById('swipe-close-btn').addEventListener('click', closeSwipeDeck);
  document.getElementById('swipe-overlay').addEventListener('click', e => { if (e.target === document.getElementById('swipe-overlay')) closeSwipeDeck(); });
  document.getElementById('swipe-pick-btn').addEventListener('click', swipePick);
  document.getElementById('swipe-skip-btn').addEventListener('click', swipeSkip);

  // Phase 10 — Spin Wheel
  document.getElementById('spin-close-btn').addEventListener('click', closeSpinWheel);
  document.getElementById('spin-overlay').addEventListener('click', e => { if (e.target === document.getElementById('spin-overlay')) closeSpinWheel(); });
  document.getElementById('spin-btn').addEventListener('click', spinWheel);

  // Phase 10 — Travel Mode
  document.getElementById('travel-close-btn').addEventListener('click', closeTravelMode);
  document.getElementById('travel-overlay').addEventListener('click', e => { if (e.target === document.getElementById('travel-overlay')) closeTravelMode(); });
  document.getElementById('travel-deactivate-btn').addEventListener('click', clearTravelMode);
  document.getElementById('travel-set-btn').addEventListener('click', () => {
    const v = document.getElementById('travel-city-input').value.trim();
    if (v) activateTravelCity(v);
  });
  document.getElementById('travel-city-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) activateTravelCity(v); }
  });
  document.querySelectorAll('.travel-city-btn').forEach(btn => {
    btn.addEventListener('click', () => activateTravelCity(btn.dataset.city, btn.dataset.lat, btn.dataset.lng));
  });

  // Phase 10 — Monthly Digest
  document.getElementById('digest-close-btn').addEventListener('click', closeMonthlyDigest);
  document.getElementById('digest-overlay').addEventListener('click', e => { if (e.target === document.getElementById('digest-overlay')) closeMonthlyDigest(); });
  document.getElementById('digest-share-btn').addEventListener('click', shareDigest);
  document.getElementById('digest-prev-btn').addEventListener('click', () => {
    _digestMonth--; if (_digestMonth < 0) { _digestMonth = 11; _digestYear--; } _renderDigest();
  });
  document.getElementById('digest-next-btn').addEventListener('click', () => {
    _digestMonth++; if (_digestMonth > 11) { _digestMonth = 0; _digestYear++; } _renderDigest();
  });

  // Phase 10 — Open Now
  document.getElementById('open-now-close-btn').addEventListener('click', closeOpenNow);
  document.getElementById('open-now-overlay').addEventListener('click', e => { if (e.target === document.getElementById('open-now-overlay')) closeOpenNow(); });
  document.getElementById('open-now-search-btn').addEventListener('click', runOpenNowSearch);

  // Phase 12 — Restaurant Duel
  document.getElementById('duel-close-btn').addEventListener('click', closeDuel);
  document.getElementById('duel-overlay').addEventListener('click', e => { if (e.target === document.getElementById('duel-overlay')) closeDuel(); });
  document.getElementById('duel-go-btn').addEventListener('click', runDuel);

  // Phase 12 — Cuisine Bingo
  document.getElementById('bingo-close-btn').addEventListener('click', closeBingo);
  document.getElementById('bingo-overlay').addEventListener('click', e => { if (e.target === document.getElementById('bingo-overlay')) closeBingo(); });
  document.getElementById('bingo-share-btn').addEventListener('click', () => {
    const card = _getBingoCard();
    const visitedCuisines = new Set(state.restaurants.map(r => r.cuisine?.toLowerCase()).filter(Boolean));
    const filled = card.filter(c => !c.free && visitedCuisines.has(c.n.toLowerCase())).length;
    const total = card.filter(c => !c.free).length;
    const txt = `🎯 My Cuisine Bingo: ${filled}/${total} cuisines explored! #FeedTheBear`;
    if (navigator.share) { navigator.share({ title: 'Cuisine Bingo', text: txt }); }
    else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Bingo result copied.', 'success'); }
  });

  // Phase 12 — Fortune Cookie
  document.getElementById('fortune-close-btn').addEventListener('click', closeFortune);
  document.getElementById('fortune-overlay').addEventListener('click', e => { if (e.target === document.getElementById('fortune-overlay')) closeFortune(); });
  document.getElementById('fortune-cookie').addEventListener('click', crackFortuneCookie);
  document.getElementById('fortune-cookie').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') crackFortuneCookie(); });
  document.getElementById('fortune-again-btn').addEventListener('click', () => { _resetFortuneCookie(); });

  // Phase 12 — Mood Calendar
  document.getElementById('moodcal-close-btn').addEventListener('click', closeMoodCal);
  document.getElementById('moodcal-overlay').addEventListener('click', e => { if (e.target === document.getElementById('moodcal-overlay')) closeMoodCal(); });
  document.getElementById('moodcal-grid').addEventListener('click', e => {
    const cell = e.target.closest('.moodcal-day[data-day]');
    if (!cell) return;
    const gridEl = document.getElementById('moodcal-grid');
    const visitMap = gridEl._visitMap || {};
    const monthName = gridEl._monthName || '';
    const day = parseInt(cell.dataset.day);
    const visits = visitMap[day] || [];
    if (!visits.length) return;
    const detailEl = document.getElementById('moodcal-detail');
    detailEl.classList.remove('hidden');
    detailEl.innerHTML = `<strong>${monthName} ${day}</strong><br>` +
      visits.map(r => {
        const stars = r.myRating ? '⭐'.repeat(Math.round(r.myRating)) : '—';
        return `<div class="moodcal-visit-item">${stars} <span>${escHtml(r.name)}${r.cuisine ? ' · ' + escHtml(r.cuisine) : ''}</span></div>`;
      }).join('');
  });
  document.getElementById('moodcal-prev').addEventListener('click', () => {
    _moodCalMonth--; if (_moodCalMonth < 0) { _moodCalMonth = 11; _moodCalYear--; } _renderMoodCal();
  });
  document.getElementById('moodcal-next').addEventListener('click', () => {
    _moodCalMonth++; if (_moodCalMonth > 11) { _moodCalMonth = 0; _moodCalYear++; } _renderMoodCal();
  });

  // Phase 12 — Daily Challenge
  document.getElementById('dailychallenge-close-btn').addEventListener('click', closeDailyChallenge);
  document.getElementById('dailychallenge-overlay').addEventListener('click', e => { if (e.target === document.getElementById('dailychallenge-overlay')) closeDailyChallenge(); });
  document.getElementById('dc-complete-btn').addEventListener('click', completeDailyChallenge);
  document.getElementById('dc-skip-btn').addEventListener('click', skipDailyChallenge);

  // Phase 13 — Visit Log
  document.getElementById('visitlog-close-btn').addEventListener('click', closeVisitLog);
  document.getElementById('visitlog-overlay').addEventListener('click', e => { if (e.target === document.getElementById('visitlog-overlay')) closeVisitLog(); });
  document.getElementById('visitlog-load-btn').addEventListener('click', _loadVisitLogEntries);
  document.getElementById('vl-save-btn').addEventListener('click', _saveVisitLogEntry);
  document.getElementById('vl-star-row').addEventListener('click', e => {
    const btn = e.target.closest('.vl-star');
    if (btn) _setVlStars(parseInt(btn.dataset.val));
  });

  // Phase 13 — Spend Tracker
  document.getElementById('spend-close-btn').addEventListener('click', closeSpendTracker);
  document.getElementById('spend-overlay').addEventListener('click', e => { if (e.target === document.getElementById('spend-overlay')) closeSpendTracker(); });

  // Phase 13 — Been a While
  document.getElementById('beenawhile-close-btn').addEventListener('click', closeBeenaWhile);
  document.getElementById('beenawhile-overlay').addEventListener('click', e => { if (e.target === document.getElementById('beenawhile-overlay')) closeBeenaWhile(); });

  // Phase 13 — Meal Planner
  document.getElementById('mealplanner-close-btn').addEventListener('click', closeMealPlanner);
  document.getElementById('mealplanner-overlay').addEventListener('click', e => { if (e.target === document.getElementById('mealplanner-overlay')) closeMealPlanner(); });
  document.getElementById('mp-generate-btn').addEventListener('click', generateMealPlan);

  // Phase 13 — Group Vote
  document.getElementById('groupvote-close-btn').addEventListener('click', closeGroupVote);
  document.getElementById('groupvote-overlay').addEventListener('click', e => { if (e.target === document.getElementById('groupvote-overlay')) closeGroupVote(); });
  document.getElementById('groupvote-generate-btn').addEventListener('click', _generateVoteLink);
  document.getElementById('groupvote-copy-btn').addEventListener('click', () => {
    const val = document.getElementById('groupvote-link-input').value;
    navigator.clipboard?.writeText(val);
    showToast('Copied!', 'Vote link copied to clipboard.', 'success');
  });
  document.getElementById('groupvote-share-btn').addEventListener('click', () => {
    const val = document.getElementById('groupvote-link-input').value;
    if (navigator.share) navigator.share({ title: 'Vote for our restaurant!', url: val });
    else { navigator.clipboard?.writeText(val); showToast('Copied!', 'Vote link copied.', 'success'); }
  });

  // Phase 13 — World Map
  document.getElementById('worldmap-close-btn').addEventListener('click', closeWorldMap);
  document.getElementById('worldmap-overlay').addEventListener('click', e => { if (e.target === document.getElementById('worldmap-overlay')) closeWorldMap(); });
  document.getElementById('worldmap-share-btn').addEventListener('click', () => {
    const { countries, cuisineVisits } = _getVisitedCountries();
    const txt = `🌍 I've tasted ${countries.size} countries & ${Object.keys(cuisineVisits).length} cuisines! #FeedTheBear`;
    if (navigator.share) navigator.share({ title: 'My Food World Map', text: txt });
    else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Map summary copied.', 'success'); }
  });

  // Phase 13 — Passport
  document.getElementById('passport-close-btn').addEventListener('click', closePassport);
  document.getElementById('passport-overlay').addEventListener('click', e => { if (e.target === document.getElementById('passport-overlay')) closePassport(); });

  // Phase 14 — Feed the Bear Game
  document.getElementById('feedbear-close-btn').addEventListener('click', closeFeedBearGame);
  document.getElementById('feedbear-overlay').addEventListener('click', e => { if (e.target === document.getElementById('feedbear-overlay')) closeFeedBearGame(); });
  document.getElementById('feedbear-canvas').addEventListener('click', _ftbHandleCanvasTap);
  document.getElementById('feedbear-canvas').addEventListener('touchstart', _ftbHandleTouch, { passive: false });
  document.getElementById('feedbear-canvas').addEventListener('touchmove', _ftbHandleTouch, { passive: false });
  document.addEventListener('keydown', _ftbHandleKey);
  document.addEventListener('keyup',   _ftbHandleKey);

  // Phase 11 — Weekly Goal
  const wgBtn = document.getElementById('wg-set-btn');
  if (wgBtn) wgBtn.addEventListener('click', setWeeklyGoal);
}

function updateClearBtn () {
  const btn = document.getElementById('clear-filters-btn');
  if (hasActiveFilters()) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

function clearFilters () {
  state.filter.search = '';
  state.filter.cuisine = '';
  state.filter.price = '';
  state.filter.tag = '';
  state.filter.collection = '';
  document.getElementById('search-input').value = '';
  document.getElementById('filter-cuisine').value = '';
  document.getElementById('filter-price').value = '';
  const fc = document.getElementById('filter-collection');
  if (fc) fc.value = '';
  updateClearBtn();
  renderCards();
}

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEvents();
  initPwa();
  initTheme();
  initAutoTheme();
  initCollections();
  initOfflineIndicator();
  initSwipeGestures();
  initReminders();
  initInstallPrompt();
  checkAndNudge();
  checkAchievements();
  // Restore travel mode state on load
  (function () { const t = getTravelMode(); if (t) { state._travelLat = t.lat; state._travelLng = t.lng; } })();
  // Silently restore location if it was on last session
  if (state.settings.locationEnabled && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userLat = pos.coords.latitude;
        state.userLng = pos.coords.longitude;
        state.locationEnabled = true;
        updateLocationBtn();
        hideBanner('location-banner');
        startWatching();
        renderCards();
        loadHomeDiscovery();
      },
      () => {
        // Permission revoked or unavailable — clear persisted flag so banner shows again
        state.settings.locationEnabled = false;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  }
  updateTagSuggestions();
  updateAppBadge();
  renderAll();
  showOnboarding();
  checkIncomingChallenge();
  trackReferralOpen();
  updateChallengeBtnBadge();
  checkWeeklySuggestion();
  checkGuestProfile();
  handleWebShareTarget();
  // Post-render: add compare checkboxes if mode was active
  if (_compareMode) addCompareCheckboxes();
  // Wire home discovery buttons
  document.getElementById('nearby-home-more-btn')?.addEventListener('click', openDiscover);
  document.getElementById('ai-rec-refresh-btn')?.addEventListener('click', () => {
    const cacheKey = 'ftb_airec_' + new Date().toDateString();
    sessionStorage.removeItem(cacheKey);
    const textEl = document.getElementById('ai-rec-text');
    if (textEl) textEl.textContent = 'Thinking…';
    if (_homeDiscCache) loadAiRec(_homeDiscCache);
  });
});
/* ------------------------------------------------------------
   PHASE 5 • STREAK TRACKER
   ------------------------------------------------------------ */

function calcStreaks () {
  const all       = state.restaurants;
  const allVisits = all.flatMap(r => (r.visits || []).map(v => v.date)).filter(Boolean);
  all.forEach(r => { if (r.dateVisited && !(r.visits||[]).length) allVisits.push(r.dateVisited); });
  if (!allVisits.length) return { currentStreak: 0, longestStreak: 0 };
  const isoWeek = d => {
    const date = new Date(d);
    const jan1 = new Date(date.getFullYear(), 0, 1);
    const week = Math.ceil(((date - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return date.getFullYear() + '-W' + String(week).padStart(2,'0');
  };
  const weekSet = new Set(allVisits.map(isoWeek));
  const sorted  = [...weekSet].sort();
  let longest = 1, current = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], next = sorted[i];
    const [py, pw] = prev.split('-W').map(Number);
    const [ny, nw] = next.split('-W').map(Number);
    const consec = (ny === py && nw === pw + 1) || (ny === py + 1 && pw >= 52 && nw === 1);
    if (consec) { current++; if (current > longest) longest = current; } else { current = 1; }
  }
  const nowWeek  = isoWeek(new Date().toISOString().slice(0,10));
  const lastWeek = (() => { const d = new Date(); d.setDate(d.getDate()-7); return isoWeek(d.toISOString().slice(0,10)); })();
  const lastVisitWeek = sorted[sorted.length-1];
  const active = lastVisitWeek === nowWeek || lastVisitWeek === lastWeek;
  return { currentStreak: active ? current : 0, longestStreak: longest };
}

function renderStreaks () {
  const el = document.getElementById('chart-streaks');
  if (!el) return;
  const { currentStreak, longestStreak } = calcStreaks();
  const totalVisited = state.restaurants.filter(r => r.status === 'visited').length;
  const allVisits    = state.restaurants.flatMap(r => r.visits || []);
  let msg = currentStreak >= 5 ? 'You are on a hot streak! Keep it up!'
          : currentStreak >= 3 ? 'Nice streak - do not break it!'
          : currentStreak >  0 ? 'Just getting started!'
          : 'No recent visits - time to eat out!';
  el.innerHTML = '<div class="streak-big' + (currentStreak >= 3 ? ' fire' : '') + '">' + currentStreak + '</div>'
    + '<div class="streak-label">week' + (currentStreak !== 1 ? 's' : '') + ' current streak</div>'
    + '<div class="streak-row">'
    + '<div class="streak-mini"><div class="sm-val">' + longestStreak + '</div><div class="sm-lbl">Best streak</div></div>'
    + '<div class="streak-mini"><div class="sm-val">' + totalVisited + '</div><div class="sm-lbl">Visited</div></div>'
    + '<div class="streak-mini"><div class="sm-val">' + allVisits.length + '</div><div class="sm-lbl">Check-ins</div></div>'
    + '</div>'
    + '<div class="streak-msg">' + (currentStreak >= 5 ? '🔥🔥 ' : currentStreak >= 3 ? '🔥 ' : currentStreak > 0 ? '✨ ' : '') + escHtml(msg) + '</div>';
}

/* ------------------------------------------------------------
   PHASE 5 • VISIT HEATMAP
   ------------------------------------------------------------ */

function renderHeatmap () {
  const el = document.getElementById('chart-heatmap');
  if (!el) return;
  const dateCounts = {};
  state.restaurants.forEach(r => {
    (r.visits || []).forEach(v => { if (v.date) dateCounts[v.date] = (dateCounts[v.date]||0)+1; });
    if (r.dateVisited && !(r.visits||[]).length) dateCounts[r.dateVisited] = (dateCounts[r.dateVisited]||0)+1;
  });
  const today = new Date();
  const dow   = today.getDay();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - dow - 7 * 51);
  const cur = new Date(startDate);
  const weeks = [];
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const iso   = cur.toISOString().slice(0,10);
      const count = dateCounts[iso] || 0;
      const level = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4;
      const future = cur > today;
      days.push({ iso, level, count, future });
      cur.setDate(cur.getDate()+1);
    }
    weeks.push(days);
  }
  const weeksHtml = weeks.map(days =>
    '<div class="heatmap-week">' + days.map(d =>
      '<div class="heatmap-cell" data-level="' + (d.future ? 0 : d.level) + '" title="' + d.iso + (d.count > 0 ? ': ' + d.count + ' visit' + (d.count > 1 ? 's' : '') : '') + '"></div>'
    ).join('') + '</div>'
  ).join('');
  el.innerHTML = '<div class="heatmap-inner">' + weeksHtml + '</div>'
    + '<div class="heatmap-legend">Less'
    + '<div class="heatmap-legend-cell" data-level="0"></div>'
    + '<div class="heatmap-legend-cell" data-level="1"></div>'
    + '<div class="heatmap-legend-cell" data-level="2"></div>'
    + '<div class="heatmap-legend-cell" data-level="3"></div>'
    + '<div class="heatmap-legend-cell" data-level="4"></div>'
    + 'More</div>';
}

/* ------------------------------------------------------------
   PHASE 5 • TONIGHT'S PICK
   ------------------------------------------------------------ */

function showTonightsPick () {
  document.getElementById('tonight-result').classList.add('hidden');
  document.getElementById('tonight-result').innerHTML = '';
  document.querySelectorAll('.mood-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('tonight-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeTonightsPick () {
  document.getElementById('tonight-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function runTonightsPick () {
  const moods = [...document.querySelectorAll('.mood-chip.selected')].map(c => c.dataset.mood);
  const all   = state.restaurants;
  if (!all.length) {
    document.getElementById('tonight-result').innerHTML = '<p style="text-align:center;color:var(--text-dim)">No restaurants saved yet!</p>';
    document.getElementById('tonight-result').classList.remove('hidden');
    return;
  }
  const scored = all.map(r => {
    let s = Math.random() * 0.3;
    if (r.myRating >= 4) s += 2; else if (r.myRating === 3) s += 1;
    if (moods.includes('new')     && r.status === 'want-to-try') s += 3;
    if (moods.includes('budget')  && r.priceRange <= 2) s += 2;
    if (moods.includes('fancy')   && r.priceRange >= 3) s += 2;
    if (moods.includes('date')    && r.priceRange >= 2) s += 1;
    if (moods.includes('comfort') && ['Italian','American','Mexican','Japanese','Chinese','Indian'].includes(r.cuisine)) s += 2;
    if (moods.includes('healthy') && ['Mediterranean','Japanese','Vietnamese','Thai','Greek'].includes(r.cuisine)) s += 2;
    if (moods.includes('quick')   && r.priceRange <= 2) s += 1;
    if (moods.includes('surprise')) s += Math.random() * 2;
    return { r, s };
  });
  scored.sort((a,b) => b.s - a.s);
  const p = scored[0].r;
  const stars = p.myRating > 0 ? '?'.repeat(p.myRating) : '';
  const price = p.priceRange ? '$'.repeat(p.priceRange) : '';
  const status = p.status === 'visited' ? '✅ Visited' : '🔖 Want to Try';
  const vc = (p.visits||[]).length;
  const res = document.getElementById('tonight-result');
  res.innerHTML = '<div class="pick-name">' + escHtml(p.name) + '</div>'
    + '<div class="pick-meta">' + escHtml(p.cuisine||'Restaurant') + (price ? ' · '+price : '') + (stars ? ' · '+stars : '') + ' · ' + status + (vc > 0 ? ' · '+vc+' visit'+(vc>1?'s':'') : '') + '</div>'
    + (p.address ? '<div class="pick-address">📍 ' + escHtml(p.address) + '</div>' : '')
    + '<div class="pick-actions">'
    + '<button class="btn-sm btn-orange" onclick="openDetailModal(\'' + p.id + '\');closeTonightsPick()">View Details</button>'
    + (p.address ? '<a class="btn-sm btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center" href="https://maps.google.com/?q=' + encodeURIComponent(p.address) + '" target="_blank" rel="noopener">🗺 Directions</a>' : '')
    + '</div>';
  res.classList.remove('hidden');
}

/* ------------------------------------------------------------
   PHASE 5 • OFFLINE INDICATOR
   ------------------------------------------------------------ */

function initOfflineIndicator () {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  const update = () => navigator.onLine ? banner.classList.add('hidden') : banner.classList.remove('hidden');
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

/* ------------------------------------------------------------
   PHASE 5 • EXPORT PDF (FOODIE REPORT)
   ------------------------------------------------------------ */

function exportFoodieReport () {
  const all       = state.restaurants;
  const visited   = all.filter(r => r.status === 'visited');
  const want      = all.filter(r => r.status === 'want-to-try');
  const allVisits = all.flatMap(r => r.visits || []);
  const rated     = visited.filter(r => r.myRating > 0);
  const avgRating = rated.length ? (rated.reduce((s,r)=>s+r.myRating,0)/rated.length).toFixed(1) : '—';
  const topPicks  = [...visited].filter(r=>r.myRating>0).sort((a,b)=>b.myRating-a.myRating).slice(0,10);
  const wantTop   = want.slice(0,8);
  const { currentStreak, longestStreak } = calcStreaks();
  const today = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const reportEl = document.getElementById('print-report');
  reportEl.innerHTML = '<div class="pr-cover"><h1>Feed The Bear</h1>'
    + '<p style="font-size:1.6rem;font-weight:700;margin:4px 0">My Foodie Report</p>'
    + '<p>Generated ' + today + '</p></div>'
    + '<div class="pr-section"><h2>Overview</h2>'
    + '<div class="pr-stat-row">'
    + '<div class="pr-stat"><div class="val">'+all.length+'</div><div class="lbl">Total Saved</div></div>'
    + '<div class="pr-stat"><div class="val">'+visited.length+'</div><div class="lbl">Visited</div></div>'
    + '<div class="pr-stat"><div class="val">'+want.length+'</div><div class="lbl">Want to Try</div></div>'
    + '<div class="pr-stat"><div class="val">'+allVisits.length+'</div><div class="lbl">Check-ins</div></div>'
    + '<div class="pr-stat"><div class="val">'+avgRating+(avgRating!=='—'?' ?':'')+'</div><div class="lbl">Avg Rating</div></div>'
    + '<div class="pr-stat"><div class="val">'+currentStreak+' wk</div><div class="lbl">Current Streak</div></div>'
    + '<div class="pr-stat"><div class="val">'+longestStreak+' wk</div><div class="lbl">Best Streak</div></div>'
    + '</div></div>'
    + (topPicks.length ? '<div class="pr-section"><h2>Top Rated Visits</h2>'
      + topPicks.map((r,i) => '<div class="pr-pick"><div class="rank">#'+(i+1)+'</div><div><div class="name">'+escHtml(r.name)+'</div>'+(r.address?'<div class="addr">'+escHtml(r.address)+'</div>':'')+'</div><div class="stars">'+'?'.repeat(r.myRating)+'</div></div>').join('')
      + '</div>' : '')
    + (wantTop.length ? '<div class="pr-section"><h2>Restaurants to Try</h2>'
      + wantTop.map((r,i) => '<div class="pr-pick"><div class="rank">'+(i+1)+'.</div><div><div class="name">'+escHtml(r.name)+'</div>'+(r.address?'<div class="addr">'+escHtml(r.address)+'</div>':'')+'</div><div class="stars">'+(r.priceRange?'$'.repeat(r.priceRange):'')+'</div></div>').join('')
      + '</div>' : '');
  window.print();
}

/* ------------------------------------------------------------
   PHASE 5 • FRIEND CHALLENGE
   ------------------------------------------------------------ */

function openChallengeModal () {
  const top5 = [...state.restaurants].filter(r=>r.myRating>0).sort((a,b)=>b.myRating-a.myRating).slice(0,5);
  const preview = document.getElementById('challenge-preview');
  if (!top5.length) {
    preview.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:16px">Rate some restaurants first!</p>';
  } else {
    preview.innerHTML = top5.map((r,i) =>
      '<div class="challenge-pick-item"><span class="cp-rank">#'+(i+1)+'</span><span class="cp-emoji">'+cuisineEmoji(r.cuisine)+'</span><span class="cp-name">'+escHtml(r.name)+'</span><span class="cp-stars">'+'?'.repeat(r.myRating)+'</span></div>'
    ).join('');
  }
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
  const payload = top5.map(r => ({ n: r.name.slice(0,40), c: r.cuisine||'', s: r.myRating, a: (r.address||'').slice(0,60) }));
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  document.getElementById('challenge-link').value = baseUrl + '?challenge=' + encoded;
  document.getElementById('challenge-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeChallengeModal () {
  document.getElementById('challenge-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function copyChallengeLink () {
  const input = document.getElementById('challenge-link');
  input.select();
  try { navigator.clipboard.writeText(input.value).catch(()=>document.execCommand('copy')); } catch(_) { document.execCommand('copy'); }
  const btn = document.getElementById('challenge-copy-btn');
  btn.textContent = '? Copied!';
  setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
}
function shareChallengeLink () {
  const link = document.getElementById('challenge-link').value;
  if (navigator.share) { navigator.share({ title: 'Feed The Bear Challenge', text: 'Can you beat my restaurant picks?', url: link }).catch(()=>{}); }
  else { copyChallengeLink(); }
}
function checkIncomingChallenge () {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('challenge');
  if (!encoded) return;
  try {
    const picks = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (!Array.isArray(picks) || !picks.length) return;
    const preview = document.getElementById('challenge-preview');
    preview.innerHTML = '<div class="challenge-incoming"><h3>A friend challenged you!</h3><p>Here are their top ' + picks.length + ' restaurants:</p></div>'
      + picks.map((p,i) => '<div class="challenge-pick-item"><span class="cp-rank">#'+(i+1)+'</span><span class="cp-name">'+escHtml(p.n)+'</span><span class="cp-stars">'+'?'.repeat(p.s)+'</span></div>').join('')
      + '<div class="challenge-reaction-row" id="cr-row"></div>';
    const row = document.getElementById('cr-row');
    [['Been there','✅','var(--green)'],['Want to try','🔖','var(--blue)'],['Never heard of it','🤷','var(--text-dim)']].forEach(([lbl,em,col]) => {
      const btn = document.createElement('button');
      btn.className = 'reaction-btn';
      btn.textContent = em + ' ' + lbl;
      btn.onclick = () => { row.innerHTML = '<p style="text-align:center;color:'+col+';padding:8px">'+em+' Nice!</p>'; };
      row.appendChild(btn);
    });
    document.getElementById('challenge-link').closest('.challenge-share-row').style.display = 'none';
    const shareBtn = document.getElementById('challenge-share-btn');
    shareBtn.textContent = 'Add Your Own List';
    shareBtn.onclick = () => { closeChallengeModal(); openAddModal(); };
    document.getElementById('challenge-title').textContent = 'Friend Challenge';
    document.getElementById('challenge-overlay').classList.remove('hidden');
    document.body.classList.add('overlay-open');
  } catch(_) { /* malformed - ignore */ }
}

/* ------------------------------------------------------------
   PHASE 5 • AI PHOTO RECOGNITION STUB
   ------------------------------------------------------------ */

async function aiPhotoFill () {
  if (!AI.hasKey()) {
    openAiPanel();
    showToast('\uD83D\uDC3B Add API Key', 'Enter your Gemini key in the Byte Cub panel to use AI photo fill.', 'info');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const nameGroup = document.getElementById('form-name').parentElement;
    let ind = nameGroup.querySelector('.ai-analyzing');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'ai-analyzing';
      ind.innerHTML = '\uD83D\uDC3B Analyzing photo<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>';
      nameGroup.appendChild(ind);
    }
    try {
      const b64      = await new Promise((res,rej) => { const r = new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(file); });
      const prompt   = 'If this image shows a restaurant, extract name, cuisine, address. Reply ONLY with JSON like {"name":"...","cuisine":"...","address":""}. If nothing identifiable, reply {}.';
      const raw      = await AI.callVision(prompt, b64, file.type || 'image/jpeg', { maxTokens: 256, temperature: 0.2 });
      const result   = JSON.parse(raw.replace(/```json\n?|\n?```/g,'').trim());
      if (result.name)    document.getElementById('form-name').value    = result.name;
      if (result.cuisine) document.getElementById('form-cuisine').value = result.cuisine;
      if (result.address) document.getElementById('form-address').value = result.address;
      ind.innerHTML = '\u2713 AI filled! Review and save.'; ind.style.color = 'var(--green)';
      setTimeout(() => ind.remove(), 4000);
    } catch (err) {
      ind.innerHTML = '\u26A0 ' + escHtml(err.message || 'AI error'); ind.style.color = 'var(--primary)';
      setTimeout(() => ind.remove(), 5000);
    }
  };
  input.click();
}
/* ------------------------------------------------------------
   PHASE 6 • SMART DUPLICATE DETECTOR
   ------------------------------------------------------------ */

function normalizeName (s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g,'').trim();
}
function levenshtein (a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => i||j ? (i ? (j ? 0 : i) : j) : 0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
function findDuplicates (name) {
  const norm = normalizeName(name);
  if (!norm) return [];
  return state.restaurants.filter(r => {
    if (r.id === state.editingId) return false;
    const rn = normalizeName(r.name);
    if (!rn) return false;
    if (rn === norm) return true;
    const maxLen = Math.max(norm.length, rn.length);
    if (maxLen === 0) return false;
    return levenshtein(norm, rn) / maxLen < 0.25;
  });
}
function checkDuplicate () {
  const name = document.getElementById('form-name').value.trim();
  const existing = document.getElementById('duplicate-warning');
  if (existing) existing.remove();
  if (!name || state.editingId) return;
  const dupes = findDuplicates(name);
  if (!dupes.length) return;
  const warn = document.createElement('div');
  warn.id = 'duplicate-warning';
  warn.className = 'duplicate-warning';
  warn.innerHTML = '⚠ Possible duplicate: '
    + dupes.map(r => '<a onclick="openDetailModal(\'' + r.id + '\');closeModal()">' + escHtml(r.name) + '</a>').join(', ')
    + ' already in your list.';
  document.getElementById('form-name').after(warn);
}

/* ------------------------------------------------------------
   PHASE 6 • ANIMATED CONFETTI
   ------------------------------------------------------------ */

const CONFETTI_COLORS = ['#FF6B35','#FFD700','#2ED573','#3498DB','#9B59B6','#FF69B4','#00CEC9'];
let _confettiAnim = null;

function launchConfetti (durationMs) {
  durationMs = durationMs || 2500;
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('active');
  const ctx = canvas.getContext('2d');
  const pieces = Array.from({length: 80}, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 60,
    w: 6 + Math.random() * 8,
    h: 10 + Math.random() * 8,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    speed: 2 + Math.random() * 4,
    spin: (Math.random() - .5) * 0.2,
    angle: Math.random() * Math.PI * 2,
    drift: (Math.random() - .5) * 1.5,
  }));
  const start = performance.now();
  function draw (now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.y += p.speed;
      p.x += p.drift;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < durationMs) {
      _confettiAnim = requestAnimationFrame(draw);
    } else {
      canvas.classList.remove('active');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  if (_confettiAnim) cancelAnimationFrame(_confettiAnim);
  _confettiAnim = requestAnimationFrame(draw);
}

function checkConfettiMilestones (prev, next) {
  const prevTotal = prev.flatMap(r => r.visits || []).length + prev.filter(r => r.status==='visited' && !(r.visits||[]).length).length;
  const nextTotal = next.flatMap(r => r.visits || []).length + next.filter(r => r.status==='visited' && !(r.visits||[]).length).length;
  const milestones = [1,5,10,25,50,100];
  const hit = milestones.find(m => prevTotal < m && nextTotal >= m);
  if (hit) {
    launchConfetti(3000);
    showToast('🏆 Milestone!', 'You have ' + hit + ' total check-in' + (hit>1?'s':'') + '! Keep exploring!', 'success');
  }
  // streak milestone
  if (next.length > prev.length) {
    const { currentStreak } = calcStreaks();
    if ([3,5,10,20].includes(currentStreak)) {
      launchConfetti(2500);
      showToast('🔥 Streak ' + currentStreak + '!', currentStreak + '-week streak! You are a foodie legend.', 'success');
    }
  }
}

/* ------------------------------------------------------------
   PHASE 6 • AUTO DARK / LIGHT MODE
   ------------------------------------------------------------ */

function initAutoTheme () {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const apply = (isLight) => {
    if (state.settings.themeManual) return; // user overrode - respect their choice
    document.body.classList.toggle('light-mode', isLight);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.querySelector('.icon-moon')?.style && (btn.querySelector('.icon-moon').style.display = isLight ? '' : 'none');
      btn.querySelector('.icon-sun')?.style  && (btn.querySelector('.icon-sun').style.display  = isLight ? 'none' : '');
    }
  };
  mq.addEventListener('change', e => apply(e.matches));
  // Only apply auto if no manual preference saved yet
  if (!state.settings.themeManual) apply(mq.matches);
}

/* ------------------------------------------------------------
   PHASE 6 • SWIPE GESTURES (MOBILE)
   ------------------------------------------------------------ */

function initSwipeGestures () {
  const grid = document.getElementById('restaurant-grid');
  if (!grid) return;
  let startX = 0, startY = 0, activeCard = null;
  grid.addEventListener('touchstart', e => {
    const card = e.target.closest('.restaurant-card');
    if (!card || state.bulkMode) return;
    activeCard = card;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  grid.addEventListener('touchmove', e => {
    if (!activeCard) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > Math.abs(dx)) { activeCard = null; return; } // vertical scroll
    if (Math.abs(dx) > 20) {
      activeCard.classList.toggle('swipe-right', dx > 20);
      activeCard.classList.toggle('swipe-left',  dx < -20);
    }
  }, { passive: true });
  grid.addEventListener('touchend', e => {
    if (!activeCard) return;
    const dx = e.changedTouches[0].clientX - startX;
    const id = activeCard.dataset.id;
    const THRESHOLD = 80;
    if (dx > THRESHOLD && id) {
      // Swipe right ? mark visited
      const r = state.restaurants.find(x => x.id === id);
      if (r && r.status !== 'visited') {
        r.status = 'visited';
        r.dateVisited = r.dateVisited || iso();
        saveData();
        renderAll();
        showToast('? Visited!', '"' + r.name + '" marked as visited.', 'success');
        launchConfetti(1500);
      }
    } else if (dx < -THRESHOLD && id) {
      // Swipe left ? show detail
      openDetailModal(id);
    }
    activeCard.classList.remove('swipe-right','swipe-left');
    activeCard = null;
  }, { passive: true });
}

/* ------------------------------------------------------------
   PHASE 6 • LEADERBOARD
   ------------------------------------------------------------ */

function renderLeaderboard () {
  const el = document.getElementById('chart-leaderboard');
  if (!el) return;
  const medals = ['🥇','🥈','🥉','4th','5th','6th','7th','8th'];
  const top = [...state.restaurants]
    .filter(r => r.myRating > 0)
    .sort((a,b) => {
      if (b.myRating !== a.myRating) return b.myRating - a.myRating;
      return (b.visits||[]).length - (a.visits||[]).length;
    }).slice(0, 8);
  if (!top.length) { el.innerHTML = '<div class="chart-empty">Rate restaurants to build your leaderboard</div>'; return; }
  el.innerHTML = top.map((r,i) => {
    const visits = (r.visits||[]).length;
    return '<div class="lb-item" data-id="' + r.id + '">'
      + '<span class="lb-medal">' + (medals[i]||'') + '</span>'
      + '<span class="lb-name">' + escHtml(r.name) + '</span>'
      + '<div><div class="lb-stars">' + '?'.repeat(r.myRating) + '</div>'
      + '<div class="lb-meta">' + escHtml(r.cuisine||'') + (visits ? ' · ' + visits + ' visit' + (visits>1?'s':'') : '') + '</div></div>'
      + '</div>';
  }).join('');
  el.querySelectorAll('.lb-item[data-id]').forEach(el2 =>
    el2.addEventListener('click', () => openDetailModal(el2.dataset.id)));
}

/* ------------------------------------------------------------
   PHASE 6 • PRICE TREND
   ------------------------------------------------------------ */

function renderPriceTrend () {
  const el = document.getElementById('chart-price-trend');
  if (!el) return;
  const all = state.restaurants;
  if (!all.length) { el.innerHTML = '<div class="chart-empty">No data yet</div>'; return; }

  // Average price range by month (last 6 months)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth()-i);
    months.push({
      key: d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'),
      label: d.toLocaleString('default',{month:'short'}),
    });
  }
  const trendData = months.map(m => {
    const inMonth = all.filter(r => {
      const date = r.dateVisited || (r.visits||[])[0]?.date || '';
      return date.slice(0,7) === m.key && r.priceRange > 0;
    });
    const avg = inMonth.length ? inMonth.reduce((s,r) => s+r.priceRange,0)/inMonth.length : 0;
    return { label: m.label, avg, count: inMonth.length };
  });

  const maxAvg = Math.max(...trendData.map(d => d.avg), 1);
  const overallAvg = (() => {
    const withPrice = all.filter(r => r.priceRange > 0);
    return withPrice.length ? withPrice.reduce((s,r) => s+r.priceRange,0)/withPrice.length : 0;
  })();
  const trend6 = trendData.filter(d => d.count > 0);
  let insight = '';
  if (trend6.length >= 2) {
    const first = trend6[0].avg, last = trend6[trend6.length-1].avg;
    if (last > first + 0.3) insight = '📈 Trending upscale lately';
    else if (last < first - 0.3) insight = '📉 More budget-friendly recently';
    else insight = '📊 Spending has been consistent';
  }

  el.innerHTML = (insight ? '<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:8px">' + insight + '</div>' : '')
    + trendData.map(d => {
    const pct = d.avg > 0 ? (d.avg/maxAvg*100).toFixed(0) : 0;
    const label = d.avg > 0 ? ['','$','$$','$$$','$$$$'][Math.round(d.avg)]||'' : '—';
    return '<div class="bar-row">'
      + '<div class="bar-label">' + d.label + '</div>'
      + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--gold)"></div></div>'
      + '<div class="bar-count">' + (d.count > 0 ? label : '—') + '</div>'
      + '</div>';
  }).join('');

  // Show overall average below
  if (overallAvg > 0) {
    const avgLabel = ['','$','$$','$$$','$$$$'][Math.round(overallAvg)] || '';
    el.innerHTML += '<div style="margin-top:8px;font-size:.75rem;color:var(--text-dim)">Overall avg: <strong>' + avgLabel + '</strong> ('+overallAvg.toFixed(1)+')</div>';
  }
}

/* ------------------------------------------------------------
   PHASE 6 • CUISINE PASSPORT
   ------------------------------------------------------------ */

const ALL_CUISINES = [
  ['Italian','🍝'],['Japanese','🍣'],['Mexican','🌮'],['Chinese','🥢'],['Indian','🍛'],
  ['American','🍔'],['Thai','🍜'],['French','🥐'],['Mediterranean','🥙'],['Korean','🍜'],
  ['Vietnamese','🍜'],['Greek','🫒'],['Spanish','🥘'],['Brazilian','🥩'],['Ethiopian','🍲'],
  ['Turkish','🥙'],['Middle Eastern','🧆'],['Caribbean','🥥'],['Peruvian','🍲'],['Sushi','🍣'],
  ['Pizza','🍕'],['Burgers','🍔'],['Seafood','🦐'],['Steakhouse','🥩'],['Vegan','🥗'],
  ['BBQ','🍖'],['Dim Sum','🥟'],['Tapas','🥖'],['Ramen','🍜'],['Breakfast','🥞'],
];
function renderPassport () {
  const el = document.getElementById('chart-passport');
  if (!el) return;
  const visited = state.restaurants.filter(r => r.status === 'visited');
  const triedSet = new Set(visited.map(r => (r.cuisine||'').toLowerCase().trim()));
  const prevUnlocked = new Set(state.settings.passportUnlocked || []);

  let html = '';
  let newUnlocks = 0;
  ALL_CUISINES.forEach(([name, emoji]) => {
    const key = name.toLowerCase();
    const count = visited.filter(r => (r.cuisine||'').toLowerCase() === key).length;
    const unlocked = triedSet.has(key);
    const isNew = unlocked && !prevUnlocked.has(key);
    if (isNew) newUnlocks++;
    html += '<div class="passport-stamp ' + (unlocked ? 'unlocked' : 'locked') + (isNew ? ' new-unlock' : '') + '" title="' + (count > 0 ? count + ' visit' + (count>1?'s':'') : 'Not tried yet') + '">'
      + '<span class="ps-emoji">' + (unlocked ? emoji : '🔒') + '</span>'
      + '<span>' + escHtml(name) + '</span>'
      + (count > 0 ? '<span class="ps-count">' + count + 'x</span>' : '')
      + '</div>';
  });

  el.innerHTML = html + '<div style="width:100%;margin-top:8px;font-size:.75rem;color:var(--text-dim)">'
    + triedSet.size + ' of ' + ALL_CUISINES.length + ' cuisines explored</div>';

  // Save newly unlocked
  if (newUnlocks > 0) {
    state.settings.passportUnlocked = [...new Set([...(state.settings.passportUnlocked||[]), ...Array.from(triedSet)])];
    saveData();
    launchConfetti(2000);
    showToast('🌍 Passport Stamped!', newUnlocks + ' new cuisine' + (newUnlocks>1?'s':'') + ' unlocked!', 'success');
  }
}

/* ------------------------------------------------------------
   PHASE 6 • MONTHLY WRAP
   ------------------------------------------------------------ */

let _wrapOffset = 0; // 0 = current month, -1 = last month, etc.

function showWrap (offset) {
  _wrapOffset = (typeof offset === 'number') ? offset : 0;
  renderWrapContent();
  document.getElementById('wrap-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeWrap () {
  document.getElementById('wrap-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function renderWrapContent () {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + _wrapOffset, 1);
  const year  = d.getFullYear();
  const month = d.getMonth();
  const monthKey = year + '-' + String(month+1).padStart(2,'0');
  const monthName = d.toLocaleString('default',{month:'long'});

  const all = state.restaurants;
  const allVisits = all.flatMap(r =>
    (r.visits||[]).filter(v => (v.date||'').slice(0,7) === monthKey)
      .map(v => ({...v, r}))
  );
  // also count restaurants marked visited that month
  const visitedThatMonth = all.filter(r => r.status==='visited' && r.dateVisited?.slice(0,7)===monthKey && !(r.visits||[]).length);
  const totalVisits = allVisits.length + visitedThatMonth.length;
  const addedThatMonth = all.filter(r => (r.dateAdded||'').slice(0,7) === monthKey);
  const ratedThatMonth = allVisits.filter(v => v.stars > 0);

  // Top cuisine
  const cuisineCounts = {};
  allVisits.forEach(v => { const c = v.r.cuisine||'Other'; cuisineCounts[c]=(cuisineCounts[c]||0)+1; });
  visitedThatMonth.forEach(r => { const c = r.cuisine||'Other'; cuisineCounts[c]=(cuisineCounts[c]||0)+1; });
  const topCuisine = Object.entries(cuisineCounts).sort(([,a],[,b])=>b-a)[0];

  // Best rated visit this month
  const bestVisit = [...allVisits].sort((a,b) => (b.stars||0)-(a.stars||0))[0];

  let headline = '';
  if (totalVisits === 0) headline = 'A quiet ' + monthName + '.';
  else if (totalVisits === 1) headline = 'One great meal in ' + monthName + '!';
  else if (totalVisits < 4) headline = totalVisits + ' tasty adventures in ' + monthName + '!';
  else if (totalVisits < 8) headline = monthName + ' was delicious!';
  else headline = monthName + ' was your best foodie month yet!';

  const el = document.getElementById('wrap-content');
  el.innerHTML = '<div class="wrap-month-label">' + monthName + ' ' + year + '</div>'
    + '<div class="wrap-headline">' + headline + '</div>'
    + '<div class="wrap-stat-grid">'
    + '<div class="wrap-stat"><div class="ws-val">' + totalVisits + '</div><div class="ws-lbl">Meals Out</div></div>'
    + '<div class="wrap-stat"><div class="ws-val">' + addedThatMonth.length + '</div><div class="ws-lbl">Places Added</div></div>'
    + '<div class="wrap-stat"><div class="ws-val">' + (ratedThatMonth.length > 0 ? (ratedThatMonth.reduce((s,v)=>s+(v.stars||0),0)/ratedThatMonth.length).toFixed(1)+' ★' : '—') + '</div><div class="ws-lbl">Avg Rating</div></div>'
    + '</div>'
    + (topCuisine ? '<div class="wrap-top"><h4>Top Cuisine</h4><div class="wrap-top-item">' + cuisineEmoji(topCuisine[0]) + ' ' + escHtml(topCuisine[0]) + '<span class="wrap-badge">' + topCuisine[1] + 'x</span></div></div>' : '')
    + (bestVisit ? '<div class="wrap-top"><h4>Best Visit</h4><div class="wrap-top-item">' + cuisineEmoji(bestVisit.r.cuisine) + ' ' + escHtml(bestVisit.r.name) + ' <span class="wrap-badge">?'.repeat(bestVisit.stars||0) + '</span></div></div>' : '')
    + (totalVisits === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-dim)">No visits logged this month. Time to get out there! 🔥</div>' : '');

  // Disable next if we're at current month
  const nextBtn = document.getElementById('wrap-next-btn');
  if (nextBtn) nextBtn.disabled = _wrapOffset >= 0;
}
function shareWrap () {
  const d = new Date();
  const month = new Date(d.getFullYear(), d.getMonth() + _wrapOffset, 1)
    .toLocaleString('default',{month:'long',year:'numeric'});
  const all = state.restaurants;
  const monthKey = new Date(d.getFullYear(), d.getMonth()+_wrapOffset, 1).toISOString().slice(0,7);
  const total = all.flatMap(r=>(r.visits||[]).filter(v=>(v.date||'').slice(0,7)===monthKey)).length;
  const text = 'My ' + month + ' foodie wrap: ' + total + ' meals out! Track yours with Feed The Bear 🐻';
  if (navigator.share) { navigator.share({ title: 'My Foodie Wrap', text }).catch(()=>{}); }
  else { navigator.clipboard?.writeText(text); showToast('Copied!','Wrap text copied to clipboard','success'); }
}

/* ------------------------------------------------------------
   PHASE 6 • GOOGLE CALENDAR SYNC
   ------------------------------------------------------------ */

function addToGoogleCalendar (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  const now = new Date();
  // Default to tomorrow 7pm for 1.5h
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 19, 0, 0);
  const end   = new Date(start.getTime() + 90*60*1000);
  const fmt = d => d.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';
  const title  = encodeURIComponent('Dinner at ' + r.name);
  const loc    = encodeURIComponent(r.address || r.name);
  const detail = encodeURIComponent((r.cuisine ? r.cuisine + ' · ' : '') + (r.website || '') + '\n\nAdded via Feed The Bear 🐻');
  const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + title
    + '&dates=' + fmt(start) + '/' + fmt(end)
    + '&location=' + loc
    + '&details=' + detail;
  window.open(url, '_blank', 'noopener');
}

/* ------------------------------------------------------------
   PHASE 6 • IMPORT FROM YELP / GOOGLE MAPS
   ------------------------------------------------------------ */

let _importParsed = [];

function showImportBookmarks () {
  _importParsed = [];
  document.getElementById('import-paste-area').value = '';
  document.getElementById('import-preview').innerHTML = '';
  document.getElementById('import-confirm-btn').disabled = true;
  document.getElementById('import-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeImportBookmarks () {
  document.getElementById('import-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function parseImportText () {
  const raw = document.getElementById('import-paste-area').value.trim();
  if (!raw) return;
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  _importParsed = [];
  lines.forEach(line => {
    // Try CSV: Name, Address, (optional more fields)
    // Skip header rows
    if (/^(name|title|place|location)/i.test(line)) return;
    // Remove Google Takeout JSON array brackets
    if (line === '[' || line === ']' || line === '{' || line === '}') return;
    // Try JSON object {"Title":"...","Note":"...","Location":{"Address":"..."}}
    try {
      const obj = JSON.parse(line.replace(/,$/, ''));
      const name    = obj.Title || obj.name || obj.Name || '';
      const address = obj.Location?.Address || obj.address || obj.Address || '';
      if (name) { _importParsed.push({ name, address }); return; }
    } catch(_) {}
    // Try CSV-style
    const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g,''));
    if (parts[0]) {
      _importParsed.push({ name: parts[0], address: parts.slice(1).join(', ').trim() });
    }
  });
  const preview = document.getElementById('import-preview');
  if (!_importParsed.length) {
    preview.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem;padding:8px">Could not parse any entries. Try one name per line.</div>';
    document.getElementById('import-confirm-btn').disabled = true;
    return;
  }
  preview.innerHTML = '<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:6px">Found ' + _importParsed.length + ' places:</div>'
    + _importParsed.map(p =>
      '<div class="import-row"><span class="import-row-name">' + escHtml(p.name) + '</span>'
      + (p.address ? '<span class="import-row-addr">' + escHtml(p.address.slice(0,50)) + '</span>' : '')
      + '</div>'
    ).join('');
  document.getElementById('import-confirm-btn').disabled = false;
}
function confirmImport () {
  if (!_importParsed.length) return;
  const now = iso();
  let added = 0;
  _importParsed.forEach(p => {
    const dupes = findDuplicates(p.name);
    if (dupes.length) return; // skip duplicates
    const entry = {
      id: uid(), name: p.name, cuisine: '', priceRange: 0,
      address: p.address||'', lat: null, lng: null,
      website: '', photo: '', googleRating: 0, googleReviews: 0,
      myRating: 0, notes: '', tags: [], collectionId: null,
      status: 'want-to-try', dateAdded: now, dateVisited: null, visits: [],
    };
    state.restaurants.unshift(entry);
    if (p.address) geocodeAddress(entry.id, p.address);
    added++;
  });
  saveData(); renderAll();
  closeImportBookmarks();
  showToast('? Imported!', added + ' restaurant' + (added!==1?'s':'') + ' added to Want to Try.', 'success');
  if (added > 0) launchConfetti(2000);
}

/* ------------------------------------------------------------
   PHASE 6 • AI WEEKLY SUGGESTION
   ------------------------------------------------------------ */

function checkWeeklySuggestion () {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const last = state.settings.lastWeeklySuggest || 0;
  const now  = Date.now();
  // Only show on Monday (day 1) and if >6 days since last shown
  const isMonday = new Date().getDay() === 1;
  if (!isMonday && (now - last) < WEEK_MS) return;

  const wantToTry = state.restaurants.filter(r => r.status === 'want-to-try');
  if (!wantToTry.length) return;

  // Find favourite cuisine type from visited restaurants
  const visited = state.restaurants.filter(r => r.status === 'visited');
  const cuisineMap = {};
  visited.forEach(r => { if (r.cuisine) cuisineMap[r.cuisine] = (cuisineMap[r.cuisine]||0)+1; });
  const favCuisine = Object.entries(cuisineMap).sort(([,a],[,b])=>b-a)[0]?.[0];

  // Pick a restaurant to suggest
  let suggestion = favCuisine
    ? wantToTry.find(r => r.cuisine === favCuisine) || wantToTry[Math.floor(Math.random()*wantToTry.length)]
    : wantToTry[Math.floor(Math.random()*wantToTry.length)];

  state.settings.lastWeeklySuggest = now;
  saveData();

  // Show banner in main content
  const main = document.getElementById('main-content');
  if (!main) return;
  const banner = document.createElement('div');
  banner.className = 'weekly-suggest-banner';
  banner.innerHTML = '<div class="wsb-icon">✨</div>'
    + '<div class="wsb-body">'
    + '<div class="wsb-title">Byte Cub\'s Pick of the Week</div>'
    + '<div class="wsb-text">How about <strong>' + escHtml(suggestion.name) + '</strong>'
    + (suggestion.cuisine ? ' (' + escHtml(suggestion.cuisine) + ')' : '')
    + (favCuisine ? ' · you love ' + escHtml(favCuisine) + '!' : '') + '</div>'
    + '</div>'
    + '<button class="btn-sm btn-orange" onclick="openDetailModal(\'' + suggestion.id + '\');this.closest(\'.weekly-suggest-banner\').remove()">View</button>'
    + '<button class="wsb-dismiss" onclick="this.closest(\'.weekly-suggest-banner\').remove()" aria-label="Dismiss">?</button>';
  main.prepend(banner);
}

/* ------------------------------------------------------------
   PHASE 6 • REFERRAL SHARE COUNT
   ------------------------------------------------------------ */

function trackReferralOpen () {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('challenge')) return;
  const count = (parseInt(localStorage.getItem('ftb_referral_opens')||'0') || 0) + 1;
  localStorage.setItem('ftb_referral_opens', String(count));
}
function getReferralCount () {
  return parseInt(localStorage.getItem('ftb_referral_opens')||'0') || 0;
}
function updateChallengeBtnBadge () {
  const count = getReferralCount();
  if (!count) return;
  const btn = document.getElementById('challenge-btn');
  if (!btn) return;
  if (!btn.querySelector('.referral-badge')) {
    const badge = document.createElement('span');
    badge.className = 'referral-badge';
    btn.appendChild(badge);
  }
  btn.querySelector('.referral-badge').textContent = count;
}
/* ------------------------------------------------------------
   PHASE 7 • VOICE ADD
   ------------------------------------------------------------ */

let _voiceRecognition = null;

function startVoiceAdd () {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Not Supported', 'Voice input is not supported in this browser. Try Chrome.', 'error');
    return;
  }
  const overlay = document.getElementById('voice-overlay');
  const status = document.getElementById('voice-status');
  const transcript = document.getElementById('voice-transcript');
  overlay.classList.remove('hidden');
  document.getElementById('voice-btn').classList.add('listening');
  status.textContent = 'Listening...';
  transcript.textContent = 'Say: "Add [name] on [address]" or just "[name]"';

  _voiceRecognition = new SpeechRecognition();
  _voiceRecognition.lang = 'en-US';
  _voiceRecognition.interimResults = true;
  _voiceRecognition.maxAlternatives = 1;

  _voiceRecognition.onresult = e => {
    const text = Array.from(e.results).map(r => r[0].transcript).join('');
    transcript.textContent = '"' + text + '"';
    if (e.results[e.results.length - 1].isFinal) {
      parseVoiceInput(text);
      stopVoice();
    }
  };
  _voiceRecognition.onerror = e => {
    status.textContent = 'Error: ' + e.error;
    setTimeout(stopVoice, 1200);
  };
  _voiceRecognition.onend = () => stopVoice();
  _voiceRecognition.start();
}
function stopVoice () {
  if (_voiceRecognition) { try { _voiceRecognition.stop(); } catch(_){} _voiceRecognition = null; }
  document.getElementById('voice-overlay').classList.add('hidden');
  document.getElementById('voice-btn').classList.remove('listening');
}
function parseVoiceInput (text) {
  text = text.trim();
  // "add nobu on 105 hudson street"
  const addMatch = text.match(/^add\s+(.+?)(?:\s+(?:on|at|in)\s+(.+))?$/i);
  let name = '', address = '';
  if (addMatch) {
    name    = addMatch[1].trim();
    address = (addMatch[2] || '').trim();
  } else {
    name = text;
  }
  if (!name) { showToast('Couldn\'t parse', 'Please try again.', 'error'); return; }
  // Open add modal pre-filled
  openAddModal();
  document.getElementById('form-name').value = name;
  if (address) document.getElementById('form-address').value = address;
  showToast('🎤 Voice Captured!', '"' + name + '"' + (address ? ' at ' + address : '') + ' · review and save.', 'success');
}

/* ------------------------------------------------------------
   PHASE 7 • SMART AUTO-TAGS
   ------------------------------------------------------------ */

const TAG_RULES = [
  { keywords: ['pasta','pizza','lasagna','risotto','tiramisu','italian'], tags: ['italian','date-night'] },
  { keywords: ['sushi','ramen','udon','tempura','japanese','bento'], tags: ['japanese','asian'] },
  { keywords: ['taco','burrito','enchilada','guacamole','mexican'], tags: ['mexican'] },
  { keywords: ['curry','naan','biryani','tikka','indian','masala'], tags: ['indian','spicy'] },
  { keywords: ['rooftop','romantic','candlelit','intimate','anniversary'], tags: ['date-night','romantic'] },
  { keywords: ['brunch','breakfast','eggs','pancake','mimosa','waffles'], tags: ['brunch','weekend'] },
  { keywords: ['takeout','delivery','grab','quick','fast'], tags: ['quick-bite','takeout'] },
  { keywords: ['kids','family','child','toddler'], tags: ['family-friendly'] },
  { keywords: ['vegan','vegetarian','plant-based','dairy-free'], tags: ['vegan','healthy'] },
  { keywords: ['burger','fries','wings','bbq','grill'], tags: ['casual','comfort-food'] },
  { keywords: ['cheap','budget','affordable','inexpensive'], tags: ['budget-friendly'] },
  { keywords: ['fancy','fine dining','tasting menu','reservation','michelin'], tags: ['special-occasion','fine-dining'] },
  { keywords: ['bar','cocktail','wine','beer','happy hour'], tags: ['drinks','bar'] },
  { keywords: ['seafood','fish','lobster','oyster','crab','shrimp'], tags: ['seafood'] },
  { keywords: ['outdoor','patio','terrace','al fresco'], tags: ['outdoor-seating'] },
];

function computeAutoTags () {
  const name    = (document.getElementById('form-name').value || '').toLowerCase();
  const cuisine = (document.getElementById('form-cuisine').value || '').toLowerCase();
  const notes   = (document.getElementById('form-notes').value || '').toLowerCase();
  const combined = name + ' ' + cuisine + ' ' + notes;
  const suggested = new Set();
  TAG_RULES.forEach(rule => {
    if (rule.keywords.some(k => combined.includes(k))) {
      rule.tags.forEach(t => suggested.add(t));
    }
  });
  // Remove tags already present in the field
  const existing = document.getElementById('form-tags').value
    .split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  existing.forEach(t => suggested.delete(t));

  const container = document.getElementById('form-auto-tags');
  if (!container) return;
  if (!suggested.size) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');
  container.innerHTML = '<span class="auto-tag-chip-label">Suggested: </span>'
    + [...suggested].map(tag =>
      '<button type="button" class="auto-tag-chip" data-tag="' + tag + '">+ ' + tag + '</button>'
    ).join('');
  container.querySelectorAll('.auto-tag-chip[data-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = document.getElementById('form-tags');
      const cur = field.value.trim();
      field.value = cur ? cur + ', ' + btn.dataset.tag : btn.dataset.tag;
      btn.remove();
      if (!container.querySelectorAll('.auto-tag-chip[data-tag]').length)
        container.classList.add('hidden');
    });
  });
}

/* ------------------------------------------------------------
   PHASE 7 • RESERVATION REMINDERS
   ------------------------------------------------------------ */

function initReminders () {
  // Check stored reminders on load
  const reminders = JSON.parse(localStorage.getItem('ftb_reminders') || '[]');
  const now = Date.now();
  const due = reminders.filter(r => r.ts <= now + 30000 && !r.shown);
  due.forEach(r => {
    fireReminder(r);
    r.shown = true;
  });
  localStorage.setItem('ftb_reminders', JSON.stringify(reminders));
  // Poll every 30s for upcoming reminders
  setInterval(() => {
    const all = JSON.parse(localStorage.getItem('ftb_reminders') || '[]');
    const n = Date.now();
    let changed = false;
    all.forEach(r => {
      if (r.ts <= n + 5000 && !r.shown) { fireReminder(r); r.shown = true; changed = true; }
    });
    if (changed) localStorage.setItem('ftb_reminders', JSON.stringify(all));
  }, 30000);
}
function fireReminder (r) {
  if (Notification.permission === 'granted') {
    new Notification('🐻 Feed The Bear Reminder', {
      body: 'Time for your visit to ' + r.name + '!',
      icon: './icon-192.png',
    });
  }
  showToast('🔔 Reminder!', 'Time for your visit to "' + r.name + '"!', 'success');
}
function setReminder (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  const dateVal = document.getElementById('detail-reminder-date').value;
  const timeVal = document.getElementById('detail-reminder-time').value || '12:00';
  if (!dateVal) { showToast('Date Required', 'Pick a date for your reminder.', 'error'); return; }
  const ts = new Date(dateVal + 'T' + timeVal).getTime();
  if (ts < Date.now()) { showToast('Past Date', 'Choose a future date.', 'error'); return; }
  // Request notification permission
  const save = () => {
    const all = JSON.parse(localStorage.getItem('ftb_reminders') || '[]')
      .filter(x => x.id !== restaurantId);
    all.push({ id: restaurantId, name: r.name, ts, shown: false });
    localStorage.setItem('ftb_reminders', JSON.stringify(all));
    const diff = ts - Date.now();
    // In-tab setTimeout for same session
    setTimeout(() => fireReminder({ name: r.name }), Math.max(diff, 0));
    const status = document.getElementById('detail-reminder-status');
    if (status) status.innerHTML = '<span style="color:var(--green)">? Reminder set for '
      + new Date(ts).toLocaleString() + '</span>';
    showToast('? Reminder Set!', '"' + r.name + '" on ' + new Date(ts).toLocaleDateString(), 'success');
  };
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(save);
  } else {
    save();
  }
}
/* ------------------------------------------------------------
   PHASE 7 • PHOTO GALLERY + LIGHTBOX
   ------------------------------------------------------------ */

let _galleryPhotos = []; // [{src, name, id}]
let _lightboxIdx   = 0;

function openGallery () {
  const withPhotos = state.restaurants.filter(r => r.photo);
  _galleryPhotos = withPhotos.map(r => ({ src: r.photo, name: r.name, id: r.id }));
  const grid = document.getElementById('gallery-grid');
  if (!_galleryPhotos.length) {
    grid.innerHTML = '<div class="gallery-empty">No photos yet! Add photos when saving restaurants.</div>';
  } else {
    grid.innerHTML = _galleryPhotos.map((p,i) =>
      '<div class="gallery-item" data-idx="' + i + '">'
      + '<img src="' + escHtml(p.src) + '" alt="' + escHtml(p.name) + '" loading="lazy" />'
      + '<div class="gallery-item-name">' + escHtml(p.name) + '</div>'
      + '</div>'
    ).join('');
    grid.querySelectorAll('.gallery-item[data-idx]').forEach(el => {
      el.addEventListener('click', () => openLightbox(parseInt(el.dataset.idx)));
    });
  }
  document.getElementById('gallery-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeGallery () {
  document.getElementById('gallery-overlay').classList.add('hidden');
  closeLightbox();
  maybeHideOverlay();
}
function openLightbox (idx) {
  _lightboxIdx = idx;
  renderLightbox();
  document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox () {
  document.getElementById('lightbox').classList.add('hidden');
}
function renderLightbox () {
  const p = _galleryPhotos[_lightboxIdx];
  if (!p) return;
  document.getElementById('lightbox-img').src = p.src;
  document.getElementById('lightbox-img').alt = p.name;
  document.getElementById('lightbox-caption').textContent = p.name;
  document.getElementById('lightbox-prev').disabled = _lightboxIdx === 0;
  document.getElementById('lightbox-next').disabled = _lightboxIdx === _galleryPhotos.length - 1;
}

/* ------------------------------------------------------------
   PHASE 7 • COMPARE MODE
   ------------------------------------------------------------ */

let _compareMode = false;
const _compareIds = new Set();

function toggleCompareMode () {
  _compareMode = !_compareMode;
  _compareIds.clear();
  document.getElementById('compare-bar').classList.toggle('hidden', !_compareMode);
  document.getElementById('compare-btn').classList.toggle('active', _compareMode);
  updateCompareBar();
  renderCards();
}
function cancelCompare () {
  _compareMode = false;
  _compareIds.clear();
  document.getElementById('compare-bar').classList.add('hidden');
  document.getElementById('compare-btn').classList.remove('active');
  renderCards();
}
function toggleCompareCard (id) {
  if (_compareIds.has(id)) { _compareIds.delete(id); }
  else { if (_compareIds.size >= 3) { showToast('Max 3', 'Compare up to 3 restaurants at a time.', 'error'); return; } _compareIds.add(id); }
  updateCompareBar();
  renderCards();
}
function updateCompareBar () {
  const n = _compareIds.size;
  document.getElementById('compare-count').textContent =
    n === 0 ? 'Tap restaurants to compare (2-3)'
    : n === 1 ? '1 selected · pick 1 or 2 more'
    : n + ' selected';
  document.getElementById('compare-now-btn').disabled = n < 2;
}
function showCompare () {
  const ids = [..._compareIds];
  const restaurants = ids.map(id => state.restaurants.find(r => r.id === id)).filter(Boolean);
  if (restaurants.length < 2) return;
  const cols = restaurants.length + 1;
  const FIELDS = [
    { label: 'Cuisine',   fn: r => escHtml(r.cuisine||'—') },
    { label: 'Price',     fn: r => ['Free','$','$$','$$$','$$$$'][r.priceRange||0] },
    { label: 'My Rating', fn: r => r.myRating ? '?'.repeat(r.myRating) : '—', num: r => r.myRating||0 },
    { label: 'Google ?',  fn: r => r.googleRating ? r.googleRating + ' / 5' : '—', num: r => r.googleRating||0 },
    { label: 'Visits',    fn: r => String((r.visits||[]).length || (r.dateVisited?1:0)), num: r => (r.visits||[]).length||(r.dateVisited?1:0) },
    { label: 'Status',    fn: r => r.status === 'visited' ? '✅ Visited' : '🔖 Want to Try' },
    { label: 'Address',   fn: r => escHtml((r.address||'—').slice(0,40)) },
  ];
  let html = '<div class="compare-grid" style="grid-template-columns: 100px ' + restaurants.map(()=>'1fr').join(' ') + '">';
  // Header row
  html += '<div class="compare-row" style="grid-column: 1 / -1; display:grid; grid-template-columns: 100px ' + restaurants.map(()=>'1fr').join(' ') + '">';
  html += '<div class="compare-cell label"></div>';
  restaurants.forEach(r => { html += '<div class="compare-cell header">' + cuisineEmoji(r.cuisine) + ' ' + escHtml(r.name) + '</div>'; });
  html += '</div>';
  // Data rows
  FIELDS.forEach(f => {
    html += '<div class="compare-row" style="display:grid; grid-template-columns: 100px ' + restaurants.map(()=>'1fr').join(' ') + '">';
    html += '<div class="compare-cell label">' + f.label + '</div>';
    // find winner
    let winnerIdx = -1;
    if (f.num) {
      const vals = restaurants.map(r => f.num(r));
      const max = Math.max(...vals);
      if (max > 0 && vals.filter(v=>v===max).length === 1) winnerIdx = vals.indexOf(max);
    }
    restaurants.forEach((r,i) => {
      const cls = 'compare-cell' + (i === winnerIdx ? ' winner' : '');
      html += '<div class="' + cls + '">' + f.fn(r) + '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  document.getElementById('compare-table').innerHTML = html;
  document.getElementById('compare-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeCompare () {
  document.getElementById('compare-overlay').classList.add('hidden');
  maybeHideOverlay();
}

/* ------------------------------------------------------------
   PHASE 7 • BUDGET TRACKER
   ------------------------------------------------------------ */

function openBudget () {
  const { monthlyBudget = 0, avgSpend = 35 } = state.settings;
  document.getElementById('budget-monthly-input').value = monthlyBudget || '';
  document.getElementById('budget-avg-input').value = avgSpend || '';
  document.getElementById('budget-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeBudget () {
  document.getElementById('budget-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function saveBudget () {
  state.settings.monthlyBudget = parseFloat(document.getElementById('budget-monthly-input').value) || 0;
  state.settings.avgSpend      = parseFloat(document.getElementById('budget-avg-input').value) || 35;
  saveData();
  closeBudget();
  showToast('💰 Budget Saved!', 'Monthly budget set to $' + state.settings.monthlyBudget, 'success');
  if (state.currentView === 'stats') renderBudgetChart();
}
function renderBudgetChart () {
  const el = document.getElementById('chart-budget');
  if (!el) return;
  const { monthlyBudget = 0, avgSpend = 35 } = state.settings;
  if (!monthlyBudget) {
    el.innerHTML = '<div class="budget-setup">No budget set. <a onclick="openBudget()">Set your monthly budget ?</a></div>';
    return;
  }
  const now = new Date();
  const monthKey = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const all = state.restaurants;
  // Count visits this month
  let visitsThisMonth = 0;
  all.forEach(r => {
    visitsThisMonth += (r.visits||[]).filter(v=>(v.date||'').slice(0,7)===monthKey).length;
    if (r.dateVisited?.slice(0,7)===monthKey && !(r.visits||[]).length) visitsThisMonth++;
  });
  const estimated = visitsThisMonth * avgSpend;
  const pct = Math.min((estimated / monthlyBudget) * 100, 110);
  const over = estimated > monthlyBudget;
  const remaining = monthlyBudget - estimated;
  el.innerHTML = '<div class="budget-gauge-wrap">'
    + '<div class="budget-gauge-label">'
    + '<span>$0</span><span>$' + estimated.toFixed(0) + ' estimated</span><span>$' + monthlyBudget.toFixed(0) + '</span>'
    + '</div>'
    + '<div class="budget-gauge-track"><div class="budget-gauge-fill' + (over?' over':'') + '" style="width:' + Math.min(pct,100) + '%"></div></div>'
    + '</div>'
    + '<div class="budget-insight">'
    + visitsThisMonth + ' visit' + (visitsThisMonth!==1?'s':'') + ' · $' + avgSpend + '/avg = ~$' + estimated.toFixed(0)
    + (over ? ' · <span style="color:#e74c3c">$' + (estimated-monthlyBudget).toFixed(0) + ' over budget ❌</span>'
             : ' · <span style="color:var(--green)">$' + remaining.toFixed(0) + ' remaining ?</span>')
    + '</div>';
}

/* ------------------------------------------------------------
   PHASE 7 • VISIT CALENDAR
   ------------------------------------------------------------ */

let _calOffset = 0; // months from now

function renderVisitCalendar () {
  const el = document.getElementById('chart-calendar');
  if (!el) return;
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + _calOffset, 1);
  const year = d.getFullYear(), month = d.getMonth();
  const monthKey = year + '-' + String(month+1).padStart(2,'0');
  const monthName = d.toLocaleString('default',{month:'long',year:'numeric'});

  // Build set of visit dates this month
  const visitDates = new Set();
  state.restaurants.forEach(r => {
    (r.visits||[]).forEach(v => { if ((v.date||'').slice(0,7)===monthKey) visitDates.add(v.date.slice(0,10)); });
    if (r.dateVisited?.slice(0,7)===monthKey) visitDates.add(r.dateVisited.slice(0,10));
  });

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = iso();
  const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let html = '<div class="cal-header">'
    + '<button class="cal-nav" id="cal-prev">?</button>'
    + '<span class="cal-month-label">' + monthName + '</span>'
    + '<button class="cal-nav" id="cal-next">?</button>'
    + '</div>'
    + '<div class="cal-grid">'
    + DAY_LABELS.map(l=>'<div class="cal-day-header">'+l+'</div>').join('');

  // empty cells before first day
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day other-month"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    const hasVisit = visitDates.has(dateStr);
    const isToday  = dateStr === todayStr;
    html += '<div class="cal-day' + (hasVisit?' has-visit':'') + (isToday?' today':'') + '" data-date="' + dateStr + '">'
      + day
      + '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
  el.querySelector('#cal-prev').addEventListener('click', () => { _calOffset--; renderVisitCalendar(); });
  el.querySelector('#cal-next').addEventListener('click', () => { _calOffset++; renderVisitCalendar(); });
  el.querySelectorAll('.cal-day.has-visit').forEach(cell => {
    cell.addEventListener('click', () => {
      const date = cell.dataset.date;
      const visited = state.restaurants.filter(r =>
        (r.visits||[]).some(v=>v.date?.slice(0,10)===date) ||
        (r.dateVisited?.slice(0,10)===date && !(r.visits||[]).length)
      );
      if (visited.length === 1) openDetailModal(visited[0].id);
      else showToast('📅 ' + date, visited.map(r=>r.name).join(', '), 'success');
    });
  });
}
/* ------------------------------------------------------------
   PHASE 7 • PUBLIC FOODIE PROFILE + QR CODE
   ------------------------------------------------------------ */

function buildProfileData () {
  const top = [...state.restaurants]
    .filter(r => r.myRating > 0)
    .sort((a,b) => b.myRating - a.myRating)
    .slice(0, 10)
    .map(r => ({
      n: r.name, c: r.cuisine||'', r: r.myRating,
      a: (r.address||'').slice(0,60), p: (r.photo||'').slice(0,300),
    }));
  return { picks: top, ts: Date.now() };
}
function openFoodieProfile () {
  const data = buildProfileData();
  if (!data.picks.length) {
    showToast('No ratings yet', 'Rate some restaurants first to generate your profile.', 'error');
    return;
  }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const url = window.location.href.split('?')[0].split('#')[0] + '#profile=' + encoded;
  document.getElementById('profile-link').value = url;

  // Generate QR code
  const canvas = document.getElementById('profile-qr');
  canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  if (window.QRCode) {
    try {
      // qrcodejs uses a div; we'll render to a temp div then extract img
      const tmp = document.createElement('div');
      new QRCode(tmp, { text: url, width:180, height:180, colorDark:'#FF6B35', colorLight:'#1A1A2E' });
      setTimeout(() => {
        const img = tmp.querySelector('img');
        if (img) {
          const ctx = canvas.getContext('2d');
          const i = new Image(); i.onload = () => ctx.drawImage(i,0,0,180,180); i.src = img.src;
        }
      }, 200);
    } catch(_) {}
  }

  // Profile preview
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('profile-preview').innerHTML = data.picks.map((p,i) =>
    '<div class="profile-preview-item">'
    + '<span class="pp-rank">' + (medals[i]||'') + '</span>'
    + '<span class="pp-name">' + escHtml(p.n) + '</span>'
    + (p.c ? '<span style="font-size:.72rem;color:var(--text-dim)">' + escHtml(p.c) + '</span>' : '')
    + '<span class="pp-stars">' + '?'.repeat(p.r) + '</span>'
    + '</div>'
  ).join('');

  document.getElementById('profile-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeFoodieProfile () {
  document.getElementById('profile-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function copyProfileLink () {
  const val = document.getElementById('profile-link').value;
  navigator.clipboard?.writeText(val);
  showToast('Copied!', 'Profile link copied to clipboard.', 'success');
}
function shareProfile () {
  const url = document.getElementById('profile-link').value;
  if (navigator.share) { navigator.share({ title: 'My Foodie Profile', url }).catch(()=>{}); }
  else copyProfileLink();
}

// Check for incoming profile hash on load
function checkGuestProfile () {
  const hash = window.location.hash;
  if (!hash.startsWith('#profile=')) return;
  try {
    const encoded = hash.slice('#profile='.length);
    const data = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (!data.picks?.length) return;
    renderGuestProfile(data);
  } catch(_) { /* invalid hash - ignore */ }
}
function renderGuestProfile (data) {
  const overlay = document.getElementById('guest-profile-overlay');
  const list    = document.getElementById('guest-profile-list');
  const medals  = ['🥇','🥈','🥉'];
  const priceMap = ['','$','$$','$$$','$$$$'];
  list.innerHTML = data.picks.map((p,i) =>
    '<div class="guest-item">'
    + '<div class="guest-item-photo">' + (p.p ? `<img src="${escHtml(p.p)}" alt="${escHtml(p.n)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />` : (CUISINE_EMOJI[(p.c||'').toLowerCase()] || '🍽')) + '</div>'
    + '<div class="guest-item-body">'
    + '<div class="guest-item-name">' + (medals[i]||'') + ' ' + escHtml(p.n) + '</div>'
    + '<div class="guest-item-meta">' + escHtml(p.c||'Restaurant') + (p.a ? ' · ' + escHtml(p.a.slice(0,40)) : '') + '</div>'
    + '<div class="guest-item-stars">' + '?'.repeat(p.r) + '</div>'
    + '</div>'
    + '</div>'
  ).join('');
  overlay.classList.remove('hidden');
  document.getElementById('guest-profile-close').addEventListener('click', () => {
    overlay.classList.add('hidden');
    history.replaceState(null, '', window.location.pathname + window.location.search);
  });
}

/* ------------------------------------------------------------
   PHASE 7 • WEB SHARE TARGET HANDLER
   ------------------------------------------------------------ */

function handleWebShareTarget () {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('share-target')) return;
  const title = params.get('title') || '';
  const url   = params.get('url')   || '';
  const text  = params.get('text')  || '';
  if (!title && !url) return;
  // Clean up the URL
  history.replaceState(null,'', window.location.pathname);
  // Try to parse as restaurant
  const name = title.replace(/\s*[-|].*$/, '').trim() || text.trim() || 'Shared Place';
  openAddModal();
  document.getElementById('form-name').value = name;
  if (url) {
    document.getElementById('form-website').value = url;
    // Auto-parse if it looks like a Maps URL
    if (url.includes('maps.google') || url.includes('goo.gl/maps') || url.includes('maps.app.goo.gl')) {
      document.getElementById('form-maps-url').value = url;
      parseMapsUrl(url);
    }
  }
  showToast('📤 Shared!', '"' + name + '" opened for review · fill in details and save!', 'success');
}

/* ------------------------------------------------------------
   PHASE 7 • renderCards hook for compare mode
   ------------------------------------------------------------ */

// Patch card rendering to show compare checkbox when _compareMode is on
const _origRenderCards = window.renderCards;

function addCompareCheckboxes () {
  if (!_compareMode) return;
  document.querySelectorAll('.restaurant-card[data-id]').forEach(card => {
    if (card.querySelector('.compare-check')) return;
    const id = card.dataset.id;
    const cb = document.createElement('button');
    cb.className = 'compare-check icon-btn';
    cb.title = 'Add to compare';
    cb.style.cssText = 'position:absolute;top:8px;left:8px;width:28px;height:28px;border-radius:50%;background:rgba(37,99,235,.8);color:#fff;font-size:.8rem;z-index:10';
    cb.textContent = _compareIds.has(id) ? '?' : '+';
    cb.addEventListener('click', e => { e.stopPropagation(); toggleCompareCard(id); });
    card.style.position = 'relative';
    card.prepend(cb);
  });
}

/* ------------------------------------------------------------
   PHASE 8 • ? MORE MENU CONTROLLER
   ------------------------------------------------------------ */

function initMoreMenu () {
  const btn  = document.getElementById('more-menu-btn');
  const menu = document.getElementById('more-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  // Dispatch to existing handlers via data-more attribute
  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-more]');
    if (!item) return;
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    const action = item.dataset.more;
    const map = {
      'tonight':          () => document.getElementById('tonight-btn').click(),
      'craving':          openCravingEngine,
      'discover':         openDiscover,
      'challenge':        openChallenges,
      'gallery':          openGallery,
      'compare':          toggleCompareMode,
      'budget':           openBudget,
      'dishes':           () => { if (state.detailId) openDishTracker(state.detailId); else showToast('Open a restaurant first', 'View a restaurant then tap Dishes.', 'error'); },
      'review':           openYearReview,
      'profile':          openFoodieProfile,
      'friends':          openFoodieFriends,
      'stats2':           openStats2,
      'ai-panel':         openAiPanel,
      'route':            openRoutePlanner,
      'export2':          openExport2,
      'push':             requestPushPermission,
      'open-now':         openOpenNow,
      'travel':           openTravelMode,
      'swipe':            openSwipeDeck,
      'spin':             openSpinWheel,
      'achievements':     openAchievements,
      'digest':           openMonthlyDigest,
      'duel':             openDuel,
      'bingo':            openBingo,
      'fortune':          openFortune,
      'moodcal':          openMoodCal,
      'feedbear':         openFeedBearGame,
      'dailychallenge':   openDailyChallenge,
      'passport':         openPassport,
      'worldmap':         openWorldMap,
      'visitlog':         openVisitLog,
      'spend':            openSpendTracker,
      'beenawhile':       openBeenaWhile,
      'mealplanner':      openMealPlanner,
      'groupvote':        openGroupVote,
      'wrap':             () => document.getElementById('wrap-btn').click(),
      'export':           () => document.getElementById('export-btn').click(),
      'import-bookmarks': () => document.getElementById('import-bookmarks-btn').click(),
      'pdf':              () => document.getElementById('pdf-export-btn').click(),
      'bulk':             () => document.getElementById('bulk-select-btn').click(),
      'collections':      () => document.getElementById('collections-btn').click(),
      'location':         () => document.getElementById('location-toggle-btn').click(),
    };
    if (map[action]) map[action]();
  });
}

/* ------------------------------------------------------------
   PHASE 8 • 🎯 CRAVING ENGINE
   ------------------------------------------------------------ */

let _cravingMoods = new Set();

function openCravingEngine () {
  _cravingMoods.clear();
  document.querySelectorAll('.craving-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('craving-freetext').value = '';
  document.getElementById('craving-result').classList.add('hidden');
  document.getElementById('craving-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  // Populate my-link in friends while we're at it (pre-generate)
  _buildFriendsMyLink();
}
function closeCravingEngine () {
  document.getElementById('craving-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function runCravingEngine () {
  const moods   = [..._cravingMoods];
  const freetext = document.getElementById('craving-freetext').value.toLowerCase();
  const candidates = state.restaurants.filter(r => r.status === 'want-to-try' || r.status === 'visited');
  if (!candidates.length) {
    document.getElementById('craving-result').innerHTML = '<p style="color:var(--text-dim);text-align:center">Add some restaurants first!</p>';
    document.getElementById('craving-result').classList.remove('hidden');
    return;
  }

  // Score each candidate
  function score (r) {
    let s = 0;
    // Prefer unvisited if mood is 'new'
    if (moods.includes('new') && r.status === 'want-to-try') s += 30;
    if (!moods.includes('new') && r.myRating) s += r.myRating * 6;
    // Price filters
    const price = r.priceRange || 0;
    if (moods.includes('cheap') && price <= 1) s += 25;
    if (moods.includes('splurge') && price >= 3) s += 25;
    if (moods.includes('quick') && price <= 2) s += 15;
    if (moods.includes('date-night') && price >= 2) s += 20;
    // Cuisine vibe
    const cuisine = (r.cuisine || '').toLowerCase();
    if (moods.includes('comfort') && /burger|pizza|bbq|american|italian|pasta/.test(cuisine)) s += 20;
    if (moods.includes('healthy') && /salad|vegan|vegetarian|japanese|sushi|thai|mediterranean/.test(cuisine)) s += 20;
    if (moods.includes('adventurous') && !/american|burger|pizza/.test(cuisine)) s += 15;
    // Freetext matching
    if (freetext) {
      const haystack = [r.name, r.cuisine, r.notes, r.address].join(' ').toLowerCase();
      const words = freetext.split(/\s+/).filter(w => w.length > 2);
      words.forEach(w => { if (haystack.includes(w)) s += 12; });
      // Budget hint
      const budgetMatch = freetext.match(/under\s*\$?(\d+)/);
      if (budgetMatch) {
        const limit = parseInt(budgetMatch[1]);
        const avgPerPrice = [0, 15, 30, 55, 90];
        if (avgPerPrice[price] <= limit) s += 20;
      }
    }
    // Recency penalty (don't always pick same place)
    const visits = (r.visits||[]).length || (r.dateVisited ? 1 : 0);
    s -= visits * 2;
    // Random tiebreaker
    s += Math.random() * 8;
    return s;
  }

  const ranked = [...candidates].sort((a,b) => score(b) - score(a));
  const winner = ranked[0];
  const runner = ranked[1];

  const priceMap = ['','$','$$','$$$','$$$$'];
  const cuisine = winner.cuisine || 'Restaurant';
  const price   = priceMap[winner.priceRange||0] || '';
  const rating  = winner.myRating ? '?'.repeat(winner.myRating) : (winner.status === 'want-to-try' ? '🔖 Want to Try' : '');

  // Build why string
  const whyParts = [];
  if (moods.includes('cheap') && (winner.priceRange||0) <= 1) whyParts.push('budget-friendly');
  if (moods.includes('splurge') && (winner.priceRange||0) >= 3) whyParts.push('a great splurge');
  if (moods.includes('date-night')) whyParts.push('perfect for a date night');
  if (moods.includes('adventurous')) whyParts.push('something a bit different');
  if (moods.includes('comfort')) whyParts.push('great comfort food vibes');
  if (moods.includes('new') && winner.status === 'want-to-try') whyParts.push('on your want-to-try list');
  if (!whyParts.length && winner.myRating >= 4) whyParts.push('one of your favourites');
  if (!whyParts.length) whyParts.push('a solid pick from your list');
  const why = 'Matches because it\'s ' + whyParts.join(', ') + '.';

  const resultEl = document.getElementById('craving-result');
  resultEl.innerHTML = `
    <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--primary);margin-bottom:10px">🎯 Tonight's Match</div>
    <div class="craving-match-name">${cuisineEmoji(winner.cuisine)} ${escHtml(winner.name)}</div>
    <div class="craving-match-meta">${escHtml(cuisine)}${price ? ' · ' + price : ''}${rating ? ' · ' + rating : ''}</div>
    <div class="craving-match-why">${escHtml(why)}</div>
    <div class="craving-match-actions">
      <button class="btn-primary btn-sm" onclick="openDetailModal('${winner.id}');closeCravingEngine()">View ?</button>
      ${runner ? `<button class="btn-ghost btn-sm" onclick="runCravingEngine()">🎯 Try Again</button>` : ''}
    </div>
  `;
  resultEl.classList.remove('hidden');
}

/* ------------------------------------------------------------
   PHASE 8 • 🍽 DISH TRACKER
   ------------------------------------------------------------ */

let _dishRating = 0;
const DISHES_KEY = 'ftb_dishes_v1';

function getDishes () {
  try { return JSON.parse(localStorage.getItem(DISHES_KEY)) || {}; } catch(_) { return {}; }
}
function saveDishes (data) { localStorage.setItem(DISHES_KEY, JSON.stringify(data)); }

function openDishTracker (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  state.detailId = restaurantId;
  document.getElementById('dish-title').textContent = '🍽 Dish Tracker';
  document.getElementById('dish-restaurant-name').textContent = r.name;
  document.getElementById('dish-name-input').value = '';
  _dishRating = 0;
  _renderDishRatingPicker(0);
  renderDishList(restaurantId);
  document.getElementById('dish-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeDishTracker () {
  document.getElementById('dish-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _renderDishRatingPicker (val) {
  document.querySelectorAll('.spm').forEach((s, i) => {
    s.classList.toggle('on', i < val);
  });
  _dishRating = val;
}
function addDish () {
  const name = document.getElementById('dish-name-input').value.trim();
  if (!name) { showToast('Name required', 'Enter a dish name.', 'error'); return; }
  const dishes = getDishes();
  if (!dishes[state.detailId]) dishes[state.detailId] = [];
  dishes[state.detailId].push({ id: uid(), name, rating: _dishRating, date: iso() });
  saveDishes(dishes);
  document.getElementById('dish-name-input').value = '';
  _renderDishRatingPicker(0);
  renderDishList(state.detailId);
  showToast('✅ Dish saved!', name + ' added to your dish log.', 'success');
}
function deleteDish (restaurantId, dishId) {
  const dishes = getDishes();
  if (dishes[restaurantId]) dishes[restaurantId] = dishes[restaurantId].filter(d => d.id !== dishId);
  saveDishes(dishes);
  renderDishList(restaurantId);
}
function renderDishList (restaurantId) {
  const dishes = getDishes();
  const list = (dishes[restaurantId] || []).sort((a,b) => b.rating - a.rating || b.date.localeCompare(a.date));
  const el = document.getElementById('dish-list');
  if (!list.length) {
    el.innerHTML = '<div class="dish-empty">No dishes logged yet. Add your first one above!</div>';
    return;
  }
  el.innerHTML = list.map(d => `
    <div class="dish-item">
      <div class="dish-item-name">${escHtml(d.name)}</div>
      <div class="dish-item-stars">${d.rating ? '?'.repeat(d.rating) + '?'.repeat(5-d.rating) : '☆'}</div>
      <div class="dish-item-date" style="font-size:.72rem;color:var(--text-dim)">${d.date||''}</div>
      <button class="dish-item-delete icon-btn" onclick="deleteDish('${restaurantId}','${d.id}')" title="Remove">?</button>
    </div>
  `).join('');
}

/* ------------------------------------------------------------
   PHASE 8 • 🎉 YEAR IN REVIEW
   ------------------------------------------------------------ */

let _reviewYear = new Date().getFullYear();

function openYearReview () {
  _reviewYear = new Date().getFullYear();
  document.getElementById('review-year-label').textContent = _reviewYear;
  renderYearReview();
  document.getElementById('review-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeYearReview () {
  document.getElementById('review-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function renderYearReview () {
  const yr = _reviewYear;
  const all = state.restaurants;
  const yearKey = String(yr);

  // All visits this year
  const yearVisits = [];
  all.forEach(r => {
    (r.visits||[]).forEach(v => { if ((v.date||'').startsWith(yearKey)) yearVisits.push({ r, v }); });
    if (r.dateVisited?.startsWith(yearKey) && !(r.visits||[]).length) yearVisits.push({ r, v: { date: r.dateVisited, rating: r.myRating } });
  });

  const totalVisits = yearVisits.length;
  const uniqueRestaurants = new Set(yearVisits.map(x => x.r.id)).size;
  const cuisineMap = {};
  yearVisits.forEach(x => { const c = x.r.cuisine || 'Other'; cuisineMap[c] = (cuisineMap[c]||0) + 1; });
  const topCuisine = Object.entries(cuisineMap).sort((a,b)=>b[1]-a[1])[0];
  const topRated = [...all].filter(r => r.myRating > 0).sort((a,b)=>b.myRating-a.myRating).slice(0,5);
  const mostVisited = [...all].sort((a,b) => {
    const av = (a.visits||[]).filter(v=>(v.date||'').startsWith(yearKey)).length + (a.dateVisited?.startsWith(yearKey)?1:0);
    const bv = (b.visits||[]).filter(v=>(v.date||'').startsWith(yearKey)).length + (b.dateVisited?.startsWith(yearKey)?1:0);
    return bv - av;
  }).filter(r => {
    const v = (r.visits||[]).filter(v=>(v.date||'').startsWith(yearKey)).length + (r.dateVisited?.startsWith(yearKey)?1:0);
    return v > 0;
  }).slice(0, 1)[0];
  const avgRating = (() => {
    const rated = yearVisits.filter(x=>x.v.rating);
    return rated.length ? (rated.reduce((s,x)=>s+(x.v.rating||0),0)/rated.length).toFixed(1) : null;
  })();
  const totalCuisines = Object.keys(cuisineMap).length;
  // Monthly distribution
  const months = Array(12).fill(0);
  yearVisits.forEach(x => {
    const m = parseInt((x.v.date||'').slice(5,7)) - 1;
    if (m >= 0 && m < 12) months[m]++;
  });
  const peakMonthIdx = months.indexOf(Math.max(...months));
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const estimatedSpend = totalVisits * (state.settings.avgSpend || 35);

  const slides = [];

  if (!totalVisits) {
    slides.push(`<div class="review-slide"><div class="review-slide-emoji">😔</div><div class="review-slide-title">No visits in ${yr}</div><div class="review-slide-value">0</div><div class="review-slide-sub">Start logging your visits!</div></div>`);
  } else {
    slides.push(`<div class="review-slide"><div class="review-slide-emoji">🍽</div><div class="review-slide-title">Meals Out in ${yr}</div><div class="review-slide-value">${totalVisits}</div><div class="review-slide-sub">across ${uniqueRestaurants} restaurant${uniqueRestaurants!==1?'s':''}</div></div>`);
    if (topCuisine) slides.push(`<div class="review-slide"><div class="review-slide-emoji">${cuisineEmoji(topCuisine[0])}</div><div class="review-slide-title">Your #1 Cuisine</div><div class="review-slide-value">${escHtml(topCuisine[0])}</div><div class="review-slide-sub">${topCuisine[1]} visit${topCuisine[1]!==1?'s':''} · you really love it</div></div>`);
    if (totalCuisines > 1) slides.push(`<div class="review-slide"><div class="review-slide-emoji">🌍</div><div class="review-slide-title">Cuisines Explored</div><div class="review-slide-value">${totalCuisines}</div><div class="review-slide-sub">You ate: ${Object.keys(cuisineMap).slice(0,5).join(', ')}</div></div>`);
    if (mostVisited) slides.push(`<div class="review-slide"><div class="review-slide-emoji">🏆</div><div class="review-slide-title">Your Go-To Spot</div><div class="review-slide-value" style="font-size:1.3rem">${escHtml(mostVisited.name)}</div><div class="review-slide-sub">${cuisineEmoji(mostVisited.cuisine)} ${mostVisited.cuisine||''}</div></div>`);
    if (avgRating) slides.push(`<div class="review-slide"><div class="review-slide-emoji">?</div><div class="review-slide-title">Your Average Rating</div><div class="review-slide-value">${avgRating} / 5</div><div class="review-slide-sub">${avgRating>=4.5?'You have high standards!':avgRating>=3.5?'You eat well ?':'Room to discover better spots'}</div></div>`);
    if (months[peakMonthIdx] > 0) slides.push(`<div class="review-slide"><div class="review-slide-emoji">📅</div><div class="review-slide-title">Most Active Month</div><div class="review-slide-value">${MONTH_NAMES[peakMonthIdx]}</div><div class="review-slide-sub">${months[peakMonthIdx]} meal${months[peakMonthIdx]!==1?'s':''} out that month</div></div>`);
    slides.push(`<div class="review-slide"><div class="review-slide-emoji">💰</div><div class="review-slide-title">Estimated Dining Spend</div><div class="review-slide-value">~$${estimatedSpend.toLocaleString()}</div><div class="review-slide-sub">Based on ${totalVisits} visits · $${state.settings.avgSpend||35}/avg</div></div>`);
    if (topRated.length) {
      const topRatedHtml = topRated.map(r=>`<li><span>${escHtml(r.name)}</span><span>${'?'.repeat(r.myRating)}</span></li>`).join('');
      slides.push(`<div class="review-slide" style="text-align:left"><div class="review-slide-emoji" style="text-align:center">⭐</div><div class="review-slide-title" style="text-align:center">Your Top Rated</div><ul class="review-top-list">${topRatedHtml}</ul></div>`);
    }
  }

  document.getElementById('review-content').innerHTML = slides.join('');
}

function shareYearReview () {
  const yr = _reviewYear;
  const all = state.restaurants;
  const yearVisits = [];
  all.forEach(r => {
    (r.visits||[]).forEach(v => { if ((v.date||'').startsWith(yr)) yearVisits.push(r); });
    if (r.dateVisited?.startsWith(yr) && !(r.visits||[]).length) yearVisits.push(r);
  });
  const text = `🎉 My ${yr} Foodie Year: ${yearVisits.length} meals out, ${new Set(yearVisits.map(r=>r.id)).size} restaurants. Track yours at Feed The Bear!`;
  if (navigator.share) navigator.share({ title: 'My Foodie Year ' + yr, text }).catch(()=>{});
  else { navigator.clipboard?.writeText(text); showToast('Copied!', 'Year in Review summary copied.', 'success'); }
}

/* ------------------------------------------------------------
   PHASE 8 • ❤ FOODIE FRIENDS
   ------------------------------------------------------------ */

function _buildFriendsMyLink () {
  const data = buildProfileData();
  if (!data.picks.length) return;
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const url = window.location.href.split('?')[0].split('#')[0] + '#profile=' + encoded;
  const el = document.getElementById('friends-my-link-input');
  if (el) el.value = url;
}

function openFoodieFriends () {
  _buildFriendsMyLink();
  document.getElementById('friends-link-input').value = '';
  document.getElementById('friends-result').classList.add('hidden');
  document.getElementById('friends-result').innerHTML = '';
  document.getElementById('friends-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeFoodieFriends () {
  document.getElementById('friends-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function loadFriendProfile () {
  const rawInput = document.getElementById('friends-link-input').value.trim();
  if (!rawInput) { showToast('Paste a link', 'Paste your friend\'s profile link first.', 'error'); return; }
  
  // Extract the hash from a full URL or bare encoded string
  let encoded = rawInput;
  const hashMatch = rawInput.match(/#profile=(.+)$/);
  if (hashMatch) encoded = hashMatch[1];

  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    if (!data.picks?.length) throw new Error('empty');
    renderFriendComparison(data);
  } catch(_) {
    showToast('Invalid link', 'Could not read that profile link. Ask your friend to reshare.', 'error');
  }
}

function renderFriendComparison (friendData) {
  const myTop  = [...state.restaurants].filter(r => r.myRating > 0).sort((a,b) => b.myRating - a.myRating).slice(0,10);
  const myNames = new Set(myTop.map(r => normalizeName(r.name)));
  const friendNames = new Set(friendData.picks.map(p => normalizeName(p.n)));

  // Find overlap by normalised name
  const overlap = friendData.picks.filter(p => myNames.has(normalizeName(p.n)));
  const onlyFriend = friendData.picks.filter(p => !myNames.has(normalizeName(p.n)));

  // Shared cuisines
  const myCuisines = new Set(myTop.map(r => (r.cuisine||'').toLowerCase()));
  const friendCuisines = new Set(friendData.picks.map(p => (p.c||'').toLowerCase()));
  const sharedCuisines = [...myCuisines].filter(c => c && friendCuisines.has(c));

  let html = '<div class="friends-result">';

  // Overlap section
  if (overlap.length) {
    html += `<div class="friends-overlap">
      <div class="friends-overlap-title">❤ You both love these (${overlap.length})</div>
      ${overlap.map(p => `<div class="friends-overlap-item">${cuisineEmoji(p.c)} ${escHtml(p.n)} · you: ${'?'.repeat(p.r)}</div>`).join('')}
    </div>`;
  } else {
    html += `<div class="friends-overlap"><div class="friends-overlap-title">Hmm, no direct overlap yet · time to branch out!</div></div>`;
  }

  // Shared cuisines
  if (sharedCuisines.length) {
    html += `<div class="friends-section-title">Shared Cuisine Love</div>`;
    html += sharedCuisines.map(c => `<div class="friends-overlap-item">${cuisineEmoji(c)} ${c.charAt(0).toUpperCase()+c.slice(1)}</div>`).join('');
  }

  // Friend's exclusive picks you haven't tried
  if (onlyFriend.length) {
    html += `<div class="friends-section-title">Their Picks You Haven't Tried (${onlyFriend.length})</div>`;
    html += onlyFriend.slice(0,6).map(p => `
      <div class="friends-pick-item">
        <span style="font-size:1.2rem">${cuisineEmoji(p.c)}</span>
        <div class="friends-pick-name">${escHtml(p.n)}<br><span style="font-size:.72rem;color:var(--text-dim)">${escHtml(p.c||'')}</span></div>
        <div class="friends-pick-stars">${'?'.repeat(p.r)}</div>
        <button class="btn-sm btn-orange" onclick="openAddModalPreFilled('${escHtml(p.n).replace(/'/g,"\\'")}','${escHtml(p.c||'')}')">Add +</button>
      </div>`).join('');
  }
  html += '</div>';

  const resultEl = document.getElementById('friends-result');
  resultEl.innerHTML = html;
  resultEl.classList.remove('hidden');
}

function openAddModalPreFilled (name, cuisine) {
  closeFoodieFriends();
  openAddModal();
  setTimeout(() => {
    document.getElementById('form-name').value = name;
    if (cuisine) document.getElementById('form-cuisine').value = cuisine;
  }, 100);
}

/* ------------------------------------------------------------
   HOME DISCOVERY — Near You Now strip + AI Rec banner
   ------------------------------------------------------------ */
let _homeDiscCache = null;
let _homeDiscCacheTime = 0;
const HOME_DISC_TTL = 15 * 60 * 1000; // 15 min

async function loadHomeDiscovery () {
  if (!state.userLat || !state.userLng) return;
  const section = document.getElementById('home-discovery');
  const list    = document.getElementById('nearby-home-list');
  if (!section || !list) return;
  section.classList.remove('hidden');

  // Serve from cache if fresh
  if (_homeDiscCache && Date.now() - _homeDiscCacheTime < HOME_DISC_TTL) {
    renderHomeDiscovery(_homeDiscCache);
    loadAiRec(_homeDiscCache);
    return;
  }

  list.innerHTML = '<div class="nearby-home-loading">🐻 Sniffing out restaurants near you…</div>';
  try {
    const { userLat: lat, userLng: lng } = state;
    const q = `[out:json][timeout:15];(node["amenity"~"restaurant|cafe|fast_food|bar"](around:1609,${lat},${lng}););out body 30;`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), { signal: ctrl.signal });
    clearTimeout(t);
    const json = await resp.json();
    const raw = (json.elements || []).filter(el => el.tags?.name);
    const withDist = raw.map(el => {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      const d = (elLat != null && elLon != null) ? haversine(lat, lng, elLat, elLon) : Infinity;
      return { ...el, _dist: d };
    }).sort((a, b) => a._dist - b._dist).slice(0, 12);

    _homeDiscCache = { elements: withDist, lat, lng };
    _homeDiscCacheTime = Date.now();
    renderHomeDiscovery(_homeDiscCache);
    loadAiRec(_homeDiscCache);
  } catch {
    list.innerHTML = '<div class="nearby-home-loading">Could not load nearby restaurants — check your connection.</div>';
  }
}

function renderHomeDiscovery ({ elements }) {
  const list = document.getElementById('nearby-home-list');
  if (!list || !elements.length) {
    if (list) list.innerHTML = '<div class="nearby-home-loading">No restaurants found within 1 mile.</div>';
    return;
  }
  const savedNames = new Set(state.restaurants.map(r => normalizeName(r.name)));
  list.innerHTML = elements.map(el => {
    const tags    = el.tags || {};
    const name    = tags.name || 'Unknown';
    const isSaved = savedNames.has(normalizeName(name));
    const cuisine = (tags.cuisine || '').split(';')[0];
    const amenity = tags.amenity || 'restaurant';
    const emoji   = cuisineEmoji(cuisine) || ({ restaurant:'🍽', cafe:'☕', fast_food:'🍟', bar:'🍺' }[amenity] || '🍽');
    const dist    = el._dist < Infinity ? fmtDist(el._dist) : '';
    const safe    = escHtml(name).replace(/'/g, "\\'");
    const safeCu  = escHtml(cuisine).replace(/'/g, "\\'");
    return `<div class="nearby-home-card${isSaved ? ' saved' : ''}">
      <div class="nearby-home-card-emoji">${emoji}</div>
      <div class="nearby-home-card-name" title="${escHtml(name)}">${escHtml(name)}</div>
      ${cuisine ? `<div class="nearby-home-card-meta">${escHtml(cuisine)}</div>` : ''}
      ${dist    ? `<div class="nearby-home-card-dist">📍 ${dist}</div>` : ''}
      ${isSaved
        ? '<div class="nearby-home-card-saved">✓ In your list</div>'
        : `<button class="btn-sm btn-orange nearby-home-card-add" onclick="openAddModalPreFilled('${safe}','${safeCu}')">+ Save</button>`}
    </div>`;
  }).join('');
}

async function loadAiRec (discData) {
  if (!window.AI || !AI.hasKey()) return;
  const banner = document.getElementById('ai-rec-banner');
  const textEl = document.getElementById('ai-rec-text');
  if (!banner || !textEl) return;

  // Cache per calendar day
  const cacheKey = 'ftb_airec_' + new Date().toDateString();
  const cached   = sessionStorage.getItem(cacheKey);
  if (cached) { textEl.textContent = cached; banner.classList.remove('hidden'); return; }

  banner.classList.remove('hidden');
  textEl.textContent = 'Thinking…';
  try {
    const topSaved = state.restaurants
      .filter(r => r.myRating >= 4)
      .sort((a, b) => (b.myRating || 0) - (a.myRating || 0))
      .slice(0, 5)
      .map(r => `${r.name} (${r.cuisine || 'various'})`).join(', ');
    const nearby = (discData.elements || []).slice(0, 5)
      .map(el => `${el.tags?.name} (${(el.tags?.cuisine || el.tags?.amenity || 'restaurant').split(';')[0]})`).join(', ');
    const cuisineCounts = {};
    state.restaurants.filter(r => r.myRating >= 4 && r.cuisine).forEach(r => {
      const c = r.cuisine.toLowerCase(); cuisineCounts[c] = (cuisineCounts[c] || 0) + 1;
    });
    const topCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c).join(', ');

    const prompt = `You are Byte Cub, a fun foodie AI assistant. Give ONE enthusiastic sentence (max 25 words) recommending what to eat tonight. Use this info:
- User's favourite cuisines: ${topCuisines || 'various'}
- Their top saved restaurants: ${topSaved || 'none yet'}
- Restaurants near them right now: ${nearby || 'various places'}
Mention a specific place or cuisine name. Be warm and exciting.`;

    const rec = await AI.call(prompt);
    const clean = (rec || '').trim().split('\n')[0].replace(/^["']|["']$/g, '');
    if (clean) { sessionStorage.setItem(cacheKey, clean); textEl.textContent = clean; }
    else { banner.classList.add('hidden'); }
  } catch { banner.classList.add('hidden'); }
}

/* ------------------------------------------------------------
   PHASE 8 • 🔍 SMART DISCOVERY
   ------------------------------------------------------------ */

function openDiscover () {
  document.getElementById('discover-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeDiscover () {
  document.getElementById('discover-overlay').classList.add('hidden');
  maybeHideOverlay();
}

async function runDiscover () {
  if (!(await ensureLocationForDiscovery())) return;
  const radius = parseInt(document.getElementById('discover-radius').value) || 1000;
  const resultsEl = document.getElementById('discover-results');
  resultsEl.innerHTML = '<div class="discover-loading">🔍 Searching nearby places...</div>';

  // Overpass API query: restaurants + cafes within radius
  const lat = state.userLat, lng = state.userLng;
  const overpassQuery = `[out:json][timeout:15];(node["amenity"~"restaurant|cafe|fast_food|bar"](around:${radius},${lat},${lng}););out body 30;`;
  const overpassUrl = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(overpassQuery);

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch(overpassUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) throw new Error(`Overpass error ${resp.status}`);
    const json = await resp.json();
    const elements = (json.elements || []).filter(el => el.tags?.name);

    if (!elements.length) {
      resultsEl.innerHTML = '<div class="discover-empty">No places found nearby. Try a larger radius.</div>';
      return;
    }

    // Filter out already-saved places (by normalised name)
    const savedNames = new Set(state.restaurants.map(r => normalizeName(r.name)));
    const unsaved = elements.filter(el => !savedNames.has(normalizeName(el.tags.name)));

    // Score by taste profile
    const myCuisines = {};
    state.restaurants.filter(r => r.myRating >= 4 && r.cuisine).forEach(r => {
      const c = (r.cuisine||'').toLowerCase();
      myCuisines[c] = (myCuisines[c]||0) + r.myRating;
    });

    function scorePlace (el) {
      const tags = el.tags || {};
      let s = Math.random() * 10;
      // Match cuisine preference
      const cuisine = (tags.cuisine||tags.amenity||'').toLowerCase();
      Object.entries(myCuisines).forEach(([c,w]) => { if (cuisine.includes(c) || c.includes(cuisine)) s += w * 2; });
      // Prefer restaurants over fast_food
      if (tags.amenity === 'restaurant') s += 10;
      if (tags.opening_hours) s += 5;
      if (tags.website) s += 3;
      return s;
    }

    const ranked = unsaved.sort((a,b) => scorePlace(b) - scorePlace(a)).slice(0, 12);

    if (!ranked.length) {
      resultsEl.innerHTML = '<div class="discover-empty">All nearby places are already in your list! Try a larger radius.</div>';
      return;
    }

    // Cuisine emoji map helper
    const amenityEmoji = t => ({ restaurant:'🍽', cafe:'☕', fast_food:'🍟', bar:'🍺' }[t]||'🍽');

    resultsEl.innerHTML = ranked.map(el => {
      const tags = el.tags || {};
      const name = escHtml(tags.name||'Unknown');
      const cuisine = tags.cuisine ? escHtml(tags.cuisine.replace(/_/g,' ')) : '';
      const type = tags.amenity || 'restaurant';
      const emoji = amenityEmoji(type);
      const address = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
      const matchCuisines = Object.keys(myCuisines).filter(c => (tags.cuisine||'').toLowerCase().includes(c));
      const matchTag = matchCuisines.length ? `Matches your love of ${matchCuisines[0]}` : '';
      const safeName = name.replace(/'/g, "\\'");
      const safeCuisine = cuisine.replace(/'/g, "\\'");

      return `<div class="discover-item">
        <div class="discover-item-emoji">${emoji}</div>
        <div class="discover-item-body">
          <div class="discover-item-name">${name}</div>
          <div class="discover-item-meta">${cuisine ? cuisine + ' · ' : ''}${escHtml(type)}</div>
          ${address ? `<div class="discover-item-meta">📍 ${escHtml(address)}</div>` : ''}
          ${matchTag ? `<div class="discover-item-match">? ${escHtml(matchTag)}</div>` : ''}
        </div>
        <div class="discover-item-add">
          <button class="btn-sm btn-orange" onclick="openAddModalPreFilled('${safeName}','${safeCuisine}')">Add +</button>
        </div>
      </div>`;
    }).join('');

  } catch (err) {
    resultsEl.innerHTML = '<div class="discover-empty">Search failed. Check your connection and try again.</div>';
  }
}

/* ------------------------------------------------------------
   PHASE 8 • 🎯 CUSTOM CHALLENGES
   ------------------------------------------------------------ */

const CHALLENGES_KEY = 'ftb_challenges_v1';

function getChallenges () {
  try { return JSON.parse(localStorage.getItem(CHALLENGES_KEY)) || []; } catch(_) { return []; }
}
function saveChallenges (data) { localStorage.setItem(CHALLENGES_KEY, JSON.stringify(data)); }

function openChallenges () {
  renderChallengesList();
  renderChallengeShareLink();
  document.getElementById('challenges-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeChallenges () {
  document.getElementById('challenges-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function switchChalTab (tab) {
  document.querySelectorAll('.chal-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.chal-tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'chal-tab-' + tab));
}

function calcChallengeProgress (ch) {
  const now = state.restaurants;
  switch (ch.type) {
    case 'cuisine_count': {
      const cuisines = new Set(now.filter(r => r.status==='visited').map(r => (r.cuisine||'').toLowerCase()).filter(Boolean));
      return cuisines.size;
    }
    case 'visit_count':
      return now.filter(r => r.status === 'visited').length;
    case 'new_only': {
      // Restaurants added AFTER challenge creation AND visited
      const since = ch.createdAt || '2000-01-01';
      return now.filter(r => r.status==='visited' && (r.dateAdded||'')>=since).length;
    }
    case 'price_budget':
      return now.filter(r => r.status==='visited' && (r.priceRange||0) === 1).length;
    case 'rating_avg': {
      const rated = now.filter(r => r.myRating > 0);
      const avg = rated.length ? rated.reduce((s,r)=>s+r.myRating,0)/rated.length : 0;
      return parseFloat(avg.toFixed(2-3));
    }
    default: return 0;
  }
}

function renderChallengesList () {
  const challenges = getChallenges();
  const el = document.getElementById('challenges-list');
  if (!challenges.length) {
    el.innerHTML = '<div class="challenges-empty">No challenges yet. <a onclick="switchChalTab(\'create\')">Create one ?</a></div>';
    return;
  }
  el.innerHTML = challenges.map((ch, idx) => {
    const progress = calcChallengeProgress(ch);
    const goal = ch.goal;
    const pct = Math.min((progress / goal) * 100, 100);
    const done = progress >= goal;
    return `<div class="challenge-item ${done?'challenge-complete':''}">
      <div class="challenge-item-header">
        <div class="challenge-item-name">${escHtml(ch.name)}</div>
        <div style="display:flex;gap:8px;align-items:center">
          ${ch.deadline ? `<div class="challenge-item-deadline">? ${ch.deadline}</div>` : ''}
          <button class="icon-btn" style="font-size:.7rem;padding:2px 6px" onclick="deleteChallenge(${idx})" title="Delete">?</button>
        </div>
      </div>
      <div class="challenge-progress-track">
        <div class="challenge-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="challenge-progress-label">${progress} / ${goal}${done?' ✅ Complete!':''}</div>
    </div>`;
  }).join('');
}

function createChallenge () {
  const name     = document.getElementById('chal-name-input').value.trim();
  const type     = document.getElementById('chal-type-input').value;
  const goal     = parseInt(document.getElementById('chal-goal-input').value) || 0;
  const deadline = document.getElementById('chal-deadline-input').value || '';
  if (!name || !goal) { showToast('Fill in name + goal', 'Both fields required.', 'error'); return; }
  const challenges = getChallenges();
  challenges.push({ id: uid(), name, type, goal, deadline, createdAt: iso() });
  saveChallenges(challenges);
  document.getElementById('chal-name-input').value = '';
  document.getElementById('chal-goal-input').value = '';
  document.getElementById('chal-deadline-input').value = '';
  showToast('🏆 Challenge created!', name, 'success');
  switchChalTab('active');
  renderChallengesList();
}

function deleteChallenge (idx) {
  const challenges = getChallenges();
  challenges.splice(idx, 1);
  saveChallenges(challenges);
  renderChallengesList();
}

function renderChallengeShareLink () {
  const wrap = document.getElementById('chal-friend-share-wrap');
  if (!wrap) return;
  const challenges = getChallenges();
  if (!challenges.length) { wrap.innerHTML = '<p style="color:var(--text-dim);font-size:.8rem">Create a challenge first.</p>'; return; }
  const ch = challenges[0];
  const encoded = btoa(JSON.stringify({ n: ch.name, t: ch.type, g: ch.goal, d: ch.deadline||'' }));
  const url = window.location.href.split('?')[0].split('#')[0] + '#challenge=' + encoded;
  wrap.innerHTML = `<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:4px">Share your latest challenge:</div>
    <div style="display:flex;gap:6px">
      <input class="form-input" readonly value="${escHtml(url)}" style="flex:1;font-size:.72rem" />
      <button class="btn-sm btn-orange" onclick="navigator.clipboard?.writeText('${escHtml(url)}');showToast('Copied!','','success')">Copy</button>
    </div>`;
}

function loadFriendChallenge () {
  const rawInput = document.getElementById('chal-friend-link').value.trim();
  let encoded = rawInput;
  const hashMatch = rawInput.match(/#challenge=(.+)$/);
  if (hashMatch) encoded = hashMatch[1];
  try {
    const ch = JSON.parse(atob(encoded));
    if (!ch.n || !ch.g) throw new Error('invalid');
    const challenges = getChallenges();
    challenges.push({ id: uid(), name: ch.n + ' (from friend)', type: ch.t||'visit_count', goal: ch.g, deadline: ch.d||'', createdAt: iso() });
    saveChallenges(challenges);
    showToast('🎯 Challenge joined!', ch.n, 'success');
    switchChalTab('active');
    renderChallengesList();
  } catch(_) {
    showToast('Invalid link', 'Could not load that challenge.', 'error');
  }
}

/* ------------------------------------------------------------
   PHASE 8 • ✅ VISIT DEBRIEF
   ------------------------------------------------------------ */

let _debriefId = null;

function openVisitDebrief (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  _debriefId = restaurantId;
  document.getElementById('debrief-restaurant-name').textContent = 'How was ' + r.name + '?';

  const steps = `
    <div>
      <div class="debrief-q">Overall vibe?</div>
      <div class="debrief-emoji-row" id="debrief-vibe">
        <button class="debrief-emoji-btn" data-val="amazing">🤩 Amazing</button>
        <button class="debrief-emoji-btn" data-val="good">😊 Good</button>
        <button class="debrief-emoji-btn" data-val="okay">😐 Okay</button>
        <button class="debrief-emoji-btn" data-val="disappointing">😞 Disappointing</button>
      </div>
    </div>
    <div>
      <div class="debrief-q">Would you go back?</div>
      <div class="debrief-emoji-row" id="debrief-return">
        <button class="debrief-emoji-btn" data-val="definitely">✅ Definitely</button>
        <button class="debrief-emoji-btn" data-val="maybe">🤔 Maybe</button>
        <button class="debrief-emoji-btn" data-val="nope">❌ Nope</button>
      </div>
    </div>
    <div>
      <div class="debrief-q">Quick note (optional)</div>
      <textarea id="debrief-note" class="form-input debrief-textarea" placeholder="Best dish? Service? Parking? Anything..." rows="2"></textarea>
    </div>
  `;
  document.getElementById('debrief-steps').innerHTML = steps;

  // Toggle selected state
  document.getElementById('debrief-steps').querySelectorAll('.debrief-emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.debrief-emoji-row');
      group.querySelectorAll('.debrief-emoji-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  document.getElementById('debrief-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeDebrief () {
  document.getElementById('debrief-overlay').classList.add('hidden');
  _debriefId = null;
  maybeHideOverlay();
}

function saveDebrief () {
  if (!_debriefId) { closeDebrief(); return; }
  const r = state.restaurants.find(x => x.id === _debriefId);
  if (!r) { closeDebrief(); return; }

  const vibe   = document.querySelector('#debrief-vibe .selected')?.dataset.val || '';
  const goBack = document.querySelector('#debrief-return .selected')?.dataset.val || '';
  const note   = document.getElementById('debrief-note')?.value.trim() || '';

  // Build note prefix
  const vibeMap   = { amazing:'🤩 Amazing visit', good:'😊 Good visit', okay:'😐 Okay visit', disappointing:'😞 Disappointing' };
  const returnMap = { definitely:'Would definitely return', maybe:'Might return', nope:'Wouldn\'t return' };
  const parts = [vibeMap[vibe], returnMap[goBack], note].filter(Boolean);

  // Append to restaurant notes
  if (parts.length) {
    const stamp = '[' + iso() + '] ' + parts.join('. ');
    r.notes = r.notes ? r.notes + '\n' + stamp : stamp;
    // Update most recent visit note too
    if (r.visits?.length) r.visits[r.visits.length-1].note = parts.join('. ');
    saveData();
    showToast('✅ Debrief saved!', 'Notes updated for ' + r.name, 'success');
  }
  closeDebrief();
}

/* ------------------------------------------------------------
   PHASE 9 • 📊 DEEP STATS
   ------------------------------------------------------------ */

function openStats2 () {
  document.getElementById('stats2-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  renderStats2();
}
function closeStats2 () {
  document.getElementById('stats2-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function renderStats2 () {
  const visited = state.restaurants.filter(r => r.status === 'visited');

  // -- Cuisine Diversity (Shannon entropy normalised 0-100) --
  const cuisineCount = {};
  visited.forEach(r => {
    const c = (r.cuisine || 'Unknown').toLowerCase();
    cuisineCount[c] = (cuisineCount[c] || 0) + 1;
  });
  const total = visited.length || 1;
  const uniq  = Object.keys(cuisineCount).length;
  let entropy = 0;
  Object.values(cuisineCount).forEach(n => {
    const p = n / total;
    entropy -= p * Math.log2(p);
  });
  const maxEntropy = Math.log2(Math.max(uniq, 2));
  const diversityPct = maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) : 0;
  document.getElementById('s2-diversity-val').textContent = diversityPct + '%';
  document.getElementById('s2-diversity-bar').style.width = diversityPct + '%';
  document.getElementById('s2-diversity-sub').textContent = uniq + ' cuisines explored';

  // -- Visit Streak (consecutive weeks with =1 new place) --
  const visitDates = visited
    .map(r => r.dateVisited || r.dateAdded)
    .filter(Boolean)
    .map(d => new Date(d))
    .sort((a, b) => b - a);

  let streak = 0;
  if (visitDates.length) {
    const msPerWeek = 7 * 24 * 3600 * 1000;
    let ref = new Date();
    ref.setHours(0,0,0,0);
    for (let w = 0; w < 52; w++) {
      const weekStart = new Date(ref - w * msPerWeek);
      const weekEnd   = new Date(ref - (w-1) * msPerWeek);
      if (visitDates.some(d => d >= weekStart && d < weekEnd)) streak++;
      else if (w > 0) break;
    }
  }
  document.getElementById('s2-streak-val').textContent = streak + ' wk' + (streak !== 1 ? 's' : '');
  document.getElementById('s2-streak-sub').textContent = streak >= 4 ? '🔥🔥 On fire!' : streak >= 2 ? '🔥 Nice rhythm' : 'Try something new this week!';

  // -- Scatter: Price (x) vs Rating (y) --
  renderScatterPlot(visited);

  // -- Hidden Gems (high rating = 4, cheap price $ / $$) --
  const gems = visited
    .filter(r => r.myRating >= 4 && (r.priceRange || 0) <= 2 && r.priceRange > 0)
    .sort((a, b) => b.myRating - a.myRating)
    .slice(0, 5);

  const gemsList = document.getElementById('s2-gems-list');
  if (gems.length) {
    gemsList.innerHTML = gems.map(r => `
      <div class="gem-item">
        <div class="gem-item-emoji">${cuisineEmoji(r.cuisine)}</div>
        <div>
          <div class="gem-item-name">${escHtml(r.name)}</div>
          <div class="gem-item-meta">${escHtml(r.cuisine||'')} · ${'$'.repeat(r.priceRange||1)}</div>
        </div>
        <div class="gem-badge">?${r.myRating} Hidden Gem</div>
      </div>`).join('');
  } else {
    gemsList.innerHTML = '<div style="font-size:.8rem;color:var(--text-dim)">No hidden gems yet · rate more cheap spots!</div>';
  }

  // -- Visit heatmap (last 52 weeks) --
  renderVisitHeatmap(visited);
}

function renderScatterPlot (visited) {
  const canvas = document.getElementById('scatter-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const pad = { l: 36, r: 16, t: 14, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(0,0,W,H,10) : ctx.rect(0,0,W,H);
  ctx.fill();

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 5; i++) {
    const y = pad.t + ih - (i/5)*ih;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+iw, y); ctx.stroke();
  }
  for (let i = 1; i <= 4; i++) {
    const x = pad.l + (i/4)*iw;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t+ih); ctx.stroke();
  }

  // Axis labels
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.font = '10px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Cheap', pad.l, H-6);
  ctx.fillText('Expensive', pad.l+iw, H-6);
  ctx.save();
  ctx.translate(11, pad.t + ih/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('Rating', 0, 0);
  ctx.restore();

  // Axis title
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.font = '9px Poppins, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Price vs Enjoyment', W/2, 11);

  // Data points
  const withBoth = visited.filter(r => r.myRating > 0 && r.priceRange > 0);
  withBoth.forEach(r => {
    const x = pad.l + ((r.priceRange - 1) / 3) * iw;
    const y = pad.t + ih - ((r.myRating - 1) / 4) * ih;
    const isGem = r.myRating >= 4 && r.priceRange <= 2;
    ctx.beginPath();
    ctx.arc(x + (Math.random()-.5)*14, y + (Math.random()-.5)*10, 5, 0, Math.PI*2);
    ctx.fillStyle = isGem ? '#ffd166' : 'rgba(255,107,53,.75)';
    ctx.fill();
  });

  // Legend
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(pad.l+6, pad.t+8, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '9px Poppins, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('Hidden gem', pad.l+14, pad.t+12);
  ctx.fillStyle = 'rgba(255,107,53,.75)'; ctx.beginPath(); ctx.arc(pad.l+76, pad.t+8, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText('Other', pad.l+84, pad.t+12);

  if (!withBoth.length) {
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.font = '12px Poppins, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Rate & set prices to see scatter', W/2, H/2);
  }
}

function renderVisitHeatmap (visited) {
  const el = document.getElementById('s2-heatmap');
  if (!el) return;
  const msPerDay = 86400000;
  const today = new Date(); today.setHours(0,0,0,0);
  const WEEKS = 26;
  const DAYS = WEEKS * 7;

  // Count visits per day
  const dayCounts = {};
  visited.forEach(r => {
    const d = r.dateVisited || r.dateAdded;
    if (d) dayCounts[d.slice(0,10)] = (dayCounts[d.slice(0,10)] || 0) + 1;
  });

  let html = '';
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date(today - i * msPerDay);
    const key  = date.toISOString().slice(0,10);
    const n    = dayCounts[key] || 0;
    const cls  = n === 0 ? '' : n === 1 ? 'h1' : n === 2 ? 'h2' : n === 3 ? 'h3' : 'h4';
    html += `<div class="heatmap-cell ${cls}" title="${key}: ${n} visit${n!==1?'s':''}"></div>`;
  }
  el.innerHTML = html;
}

/* ------------------------------------------------------------
   PHASE 9 • 🐻 AI ASSISTANT (Gemini-powered Byte Cub)
   ------------------------------------------------------------ */

const _aiHistory = [];

function openAiPanel () {
  _syncAiKeyUI();
  document.getElementById('ai-panel-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  if (!_aiHistory.length) _appendAiMsg('assistant', "Hi! I'm Byte Cub \uD83D\uDC3B\u2014your personal food guide, now powered by Gemini AI. Ask me anything about your restaurant list!");
}
function closeAiPanel () {
  document.getElementById('ai-panel-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function _syncAiKeyUI () {
  const hasKey = AI.hasKey();
  document.getElementById('ai-key-setup').classList.toggle('hidden', hasKey);
  document.getElementById('ai-key-active').classList.toggle('hidden', !hasKey);
}

function _appendAiMsg (role, text) {
  _aiHistory.push({ role, text });
  const hist = document.getElementById('ai-chat-history');
  const div  = document.createElement('div');
  div.className = 'ai-msg ' + role;
  const safeText = markdownLite(escHtml(text));
  div.innerHTML  = `<div class="ai-msg-avatar">${role === 'assistant' ? '\uD83D\uDC3B' : '\uD83D\uDE0B'}</div><div class="ai-msg-bubble">${safeText}</div>`;
  hist.appendChild(div);
  hist.scrollTop = hist.scrollHeight;
  div.querySelectorAll('.chip-link[data-id]').forEach(el =>
    el.addEventListener('click', () => openDetailModal(el.dataset.id)));
}

function _showAiThinking () {
  const hist = document.getElementById('ai-chat-history');
  const div  = document.createElement('div');
  div.className = 'ai-msg assistant';
  div.id        = 'ai-thinking-bubble';
  div.innerHTML = `<div class="ai-msg-avatar">\uD83D\uDC3B</div><div class="ai-msg-bubble ai-thinking"><span></span><span></span><span></span></div>`;
  hist.appendChild(div);
  hist.scrollTop = hist.scrollHeight;
  return div;
}

function _buildListContext () {
  return AI.buildContext(state.restaurants);
}

async function sendAiMessage (userText) {
  if (!userText.trim()) return;
  _appendAiMsg('user', userText);
  document.getElementById('ai-chat-input').value = '';

  if (!AI.hasKey()) {
    const ruleResp = typeof chatResponse === 'function' ? chatResponse(userText) : "I need a Gemini API key to give smart answers!";
    _appendAiMsg('assistant', ruleResp + '\n\n*Add a Gemini API key above for full AI-powered answers!*');
    return;
  }

  const thinking = _showAiThinking();
  try {
    const reply = await AI.chat(userText, _aiHistory.slice(-12), state.restaurants);
    thinking.remove();
    _appendAiMsg('assistant', reply);
  } catch (err) {
    thinking.remove();
    if (err.message === 'NO_KEY') {
      _appendAiMsg('assistant', 'Add your Gemini API key above to enable AI chat. \uD83D\uDC3B');
    } else {
      _appendAiMsg('assistant', '\u26A0\uFE0F ' + (err.message || 'Connection error. Check your API key and internet.'));
    }
  }
}

function handleAiQuickBtn (prompt) {
  const prompts = {
    summarize:       'Give me a fun, personalised summary of my food journey so far.',
    recommend:       'Based on my taste profile, what should I eat tonight? Be specific!',
    rut:             'Am I stuck in a food rut? What do you suggest I try next?',
    'next-cuisine':  'What new cuisine would suit my tastes that I have never tried yet?',
    'hidden-gems':   'Which of my saved restaurants are hidden gems I might be overlooking?',
    'taste-profile': 'Give me a creative personality read on my food tastes based on my list.',
  };
  sendAiMessage(prompts[prompt] || prompt);
}

async function getAiDetailSummary (restaurantId) {
  const r  = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  const el = document.getElementById('detail-ai-summary');
  if (!el) return;
  el.classList.remove('hidden');

  if (!AI.hasKey()) {
    el.innerHTML = `<span class="ai-badge">\uD83D\uDC3B Byte Cub</span> Add a Gemini API key in the Byte Cub panel to get AI summaries. <em>${escHtml(r.name)}: ${escHtml(r.cuisine || 'restaurant')}, ${r.myRating ? r.myRating + '\u2605' : 'unrated'}.</em>`;
    return;
  }

  el.innerHTML = `<span class="ai-badge">\uD83D\uDC3B Byte Cub</span> <span class="ai-thinking-inline"><span></span><span></span><span></span></span>`;
  try {
    const text = await AI.restaurantSummary(r);
    el.innerHTML = `<span class="ai-badge">\uD83D\uDC3B Byte Cub</span> ${escHtml(text)}`;
  } catch (err) {
    el.innerHTML = `<span class="ai-badge">\u26A0\uFE0F</span> ${escHtml(err.message || 'Could not connect to AI.')}`;
  }
}

async function getAiDishRecs (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  const el = document.getElementById('detail-ai-summary');
  if (!el) return;
  el.classList.remove('hidden');

  if (!AI.hasKey()) {
    el.innerHTML = `<span class="ai-badge">\uD83C\uDF7D\uFE0F Dish Picks</span> Add your Gemini key in the Byte Cub panel to get AI dish recommendations.`;
    return;
  }

  el.innerHTML = `<span class="ai-badge">\uD83C\uDF7D\uFE0F Dish Picks</span> <span class="ai-thinking-inline"><span></span><span></span><span></span></span>`;
  try {
    const dishes = await AI.dishRecs(r);
    const html = dishes.map(d =>
      `<div class="ai-dish-item"><strong>${escHtml(d.dish)}</strong> \u2014 ${escHtml(d.reason)}</div>`
    ).join('');
    el.innerHTML = `<span class="ai-badge">\uD83C\uDF7D\uFE0F AI Dish Picks for ${escHtml(r.name)}</span><div class="ai-dish-list">${html}</div>`;
  } catch (err) {
    el.innerHTML = `<span class="ai-badge">\u26A0\uFE0F</span> ${escHtml(err.message || 'Could not get dish recommendations.')}`;
  }
}

/* ------------------------------------------------------------
   PHASE 9 • 🍽 MAP UPGRADES (cluster + route)
   ------------------------------------------------------------ */

// Route planner selected IDs
const _routeSelected = new Set();

function openRoutePlanner () {
  _routeSelected.clear();
  const visited = state.restaurants.filter(r => r.status === 'visited' && r.lat && r.lng);
  const wishlist = state.restaurants.filter(r => r.status === 'wishlist' && r.lat && r.lng);
  const all = [...visited, ...wishlist];

  const list = document.getElementById('route-pick-list');
  if (!all.length) {
    list.innerHTML = '<div style="font-size:.8rem;color:var(--text-dim)">No restaurants with location data found. Add addresses to your entries first.</div>';
  } else {
    list.innerHTML = all.map(r => `
      <div class="route-pick-item" data-id="${r.id}" onclick="toggleRouteItem('${r.id}', this)">
        <div class="route-pick-check" id="route-check-${r.id}"></div>
        <div>
          <div class="route-pick-name">${cuisineEmoji(r.cuisine)} ${escHtml(r.name)}</div>
          <div class="route-pick-meta">${escHtml(r.cuisine||'')}${r.address ? ' · ' + escHtml(r.address) : ''}</div>
        </div>
      </div>`).join('');
  }
  _updateRouteBar();
  document.getElementById('route-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeRoutePlanner () {
  document.getElementById('route-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function toggleRouteItem (id, el) {
  if (_routeSelected.has(id)) {
    _routeSelected.delete(id);
    el.classList.remove('selected');
    document.getElementById('route-check-' + id).textContent = '';
  } else {
    if (_routeSelected.size >= 5) { showToast('Max 5 stops', 'Remove one first.', 'error'); return; }
    _routeSelected.add(id);
    el.classList.add('selected');
    document.getElementById('route-check-' + id).textContent = '?';
  }
  _updateRouteBar();
}

function _updateRouteBar () {
  const bar = document.getElementById('route-selected-bar');
  const cnt = document.getElementById('route-selected-count');
  const n = _routeSelected.size;
  cnt.textContent = n + ' stop' + (n !== 1 ? 's' : '') + ' selected';
  bar.classList.toggle('hidden', n < 2);
}

function launchRoute () {
  const stops = [..._routeSelected].map(id => state.restaurants.find(r => r.id === id)).filter(Boolean);
  if (stops.length < 2) return;
  const waypoints = stops.map(r => encodeURIComponent(r.address || (r.lat + ',' + r.lng)));
  const origin = waypoints.shift();
  const dest   = waypoints.pop();
  const via    = waypoints.length ? '&waypoints=' + waypoints.join('|') : '';
  const url    = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${via}&travelmode=driving`;
  window.open(url, '_blank', 'noopener');
  closeRoutePlanner();
}

/* Detail photo from Unsplash Source (no API key) */
function loadDetailPhoto (restaurant) {
  const el = document.getElementById('detail-photo-strip');
  if (!el) return;
  const query = encodeURIComponent((restaurant.cuisine || 'food') + ' restaurant');
  // Use picsum as reliable no-key fallback; encode cuisine as seed for consistency
  const seed = restaurant.id ? restaurant.id.slice(-6) : '1';
  el.src = `https://picsum.photos/seed/${seed}/640/160`;
  el.alt = restaurant.cuisine + ' restaurant photo';
  el.style.display = 'block';
  el.onerror = () => { el.style.display = 'none'; };
}

/* ------------------------------------------------------------
   PHASE 9 • 📤 EXPORT v2
   ------------------------------------------------------------ */

function openExport2 () {
  document.getElementById('export2-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeExport2 () {
  document.getElementById('export2-overlay').classList.add('hidden');
  maybeHideOverlay();
}

/* Restaurant Passport - print-ready HTML page */
function exportPassport () {
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) { showToast('No visits yet', 'Mark some restaurants as visited first.', 'error'); return; }

  const priceStr = n => n ? '$'.repeat(n) : '';
  const ratingStr = n => n ? '?'.repeat(n) + '?'.repeat(5-n) : 'Unrated';

  const cards = visited.map(r => `
    <div style="border:1px solid #ddd;border-radius:12px;padding:16px 18px;break-inside:avoid;margin-bottom:12px;font-family:Georgia,serif">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-size:2rem">${cuisineEmoji(r.cuisine)}</span>
        <div>
          <div style="font-size:1.1rem;font-weight:700">${escHtml(r.name)}</div>
          <div style="font-size:.8rem;color:#666">${escHtml(r.cuisine||'')} ${priceStr(r.priceRange)}</div>
        </div>
        <div style="margin-left:auto;font-size:.9rem;color:#e63946">${ratingStr(r.myRating)}</div>
      </div>
      ${r.address ? `<div style="font-size:.78rem;color:#888;margin-bottom:4px">📍 ${escHtml(r.address)}</div>` : ''}
      ${r.dateVisited ? `<div style="font-size:.78rem;color:#888;margin-bottom:4px">📅 Visited: ${r.dateVisited}</div>` : ''}
      ${r.notes ? `<div style="font-size:.8rem;color:#444;border-top:1px solid #eee;padding-top:6px;margin-top:6px">${escHtml(r.notes.slice(0,200))}</div>` : ''}
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>My Restaurant Passport</title>
  <style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 20px;color:#222}
  h1{font-size:1.8rem;border-bottom:2px solid #e63946;padding-bottom:8px;margin-bottom:24px}
  @media print{body{margin:0;padding:10px}}</style></head><body>
  <h1>🗺 My Restaurant Passport</h1>
  <p style="color:#888;font-size:.85rem">Generated ${new Date().toLocaleDateString()} · ${visited.length} restaurants visited</p>
  ${cards}
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'restaurant-passport.html';
  a.click();
  URL.revokeObjectURL(a.href);
  closeExport2();
  showToast('✅ Passport downloaded!', 'Open the HTML file in any browser to print.', 'success');
}

/* Shareable standalone page */
function exportShareablePage () {
  const restaurants = state.restaurants;
  if (!restaurants.length) { showToast('Nothing to export', 'Add some restaurants first.', 'error'); return; }

  const items = restaurants.map(r => `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid #2a2a3e;border-radius:10px;background:#16162a">
      <span style="font-size:1.6rem">${cuisineEmoji(r.cuisine)}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.95rem">${escHtml(r.name)}</div>
        <div style="font-size:.78rem;color:#aaa">${escHtml(r.cuisine||'')}${r.priceRange ? ' · ' + '$'.repeat(r.priceRange) : ''}</div>
        ${r.myRating ? `<div style="color:#ff6b35;font-size:.82rem">${'?'.repeat(r.myRating)}</div>` : ''}
        ${r.notes ? `<div style="font-size:.75rem;color:#888;margin-top:4px">${escHtml(r.notes.slice(0,100))}</div>` : ''}
      </div>
      <span style="font-size:.7rem;padding:3px 8px;border-radius:10px;background:${r.status==='visited'?'#1a3a2a':r.status==='wishlist'?'#1a1a3a':'#2a2a2a'};color:${r.status==='visited'?'#4caf50':r.status==='wishlist'?'#7c83fd':'#888'}">${r.status}</span>
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>My Food List - Feed The Bear</title>
  <style>*{box-sizing:border-box}body{background:#0d0d1a;color:#e8e8f0;font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px}
  h1{font-size:1.5rem;margin-bottom:4px}p{color:#888;font-size:.82rem;margin-top:0 0 20px}
  .list{display:flex;flex-direction:column;gap:8px}</style></head><body>
  <h1>🍽 My Food List</h1>
  <p>Shared from Feed The Bear · ${restaurants.length} places · ${new Date().toLocaleDateString()}</p>
  <div class="list">${items}</div>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-food-list.html';
  a.click();
  URL.revokeObjectURL(a.href);
  closeExport2();
  showToast('✅ Page downloaded!', 'Share the HTML file · it works in any browser.', 'success');
}

/* CSV export */
function exportCSV () {
  const rows = [['Name','Cuisine','Status','Rating','Price','Address','Date Added','Notes']];
  state.restaurants.forEach(r => {
    rows.push([
      r.name, r.cuisine||'', r.status||'', r.myRating||'', r.priceRange ? '$'.repeat(r.priceRange) : '',
      r.address||'', r.dateAdded||'', (r.notes||'').replace(/\n/g,' ')
    ].map(v => '"' + String(v).replace(/"/g,'""') + '"'));
  });
  const csv = rows.map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'feed-the-bear.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  closeExport2();
  showToast('✅ CSV downloaded!', '', 'success');
}

/* ------------------------------------------------------------
   PHASE 9 • ⚙ PWA INSTALL PROMPT + APP BADGING
   ------------------------------------------------------------ */

let _deferredInstallPrompt = null;

function initInstallPrompt () {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    // Show banner after 30 seconds if not dismissed
    if (!localStorage.getItem('ftb_install_dismissed')) {
      setTimeout(showInstallBanner, 30000);
    }
  });

  window.addEventListener('appinstalled', () => {
    hideInstallBanner();
    showToast('✅ Installed!', 'Feed The Bear is now on your home screen.', 'success');
  });

  document.getElementById('install-accept-btn').addEventListener('click', async () => {
    hideInstallBanner();
    if (!_deferredInstallPrompt) return;
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    _deferredInstallPrompt = null;
    if (outcome === 'accepted') showToast('⏳ Installing…', '', 'success');
  });

  document.getElementById('install-dismiss-btn').addEventListener('click', () => {
    hideInstallBanner();
    localStorage.setItem('ftb_install_dismissed', '1');
  });
}

function showInstallBanner () {
  document.getElementById('install-banner').classList.remove('hidden');
}
function hideInstallBanner () {
  document.getElementById('install-banner').classList.add('hidden');
}

/* App Badging - show count of wishlist items as badge */
function updateAppBadge () {
  const wishlistCount = state.restaurants.filter(r => r.status === 'wishlist').length;
  if ('setAppBadge' in navigator) {
    if (wishlistCount > 0) navigator.setAppBadge(wishlistCount).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }
}

/* ------------------------------------------------------------
   PHASE 9 • 🔔 PUSH NOTIFICATION NUDGES
   ------------------------------------------------------------ */

async function requestPushPermission () {
  if (!('Notification' in window)) {
    showToast('Not supported', 'Push notifications not available in this browser.', 'error');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('🔔 Notifications on!', 'You\'ll get nudges when you haven\'t visited anywhere in a while.', 'success');
    localStorage.setItem('ftb_push_enabled', '1');
    schedulePushNudge();
  } else {
    showToast('Notifications blocked', 'Enable them in browser settings.', 'error');
  }
}

function schedulePushNudge () {
  if (Notification.permission !== 'granted') return;
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) return;

  const lastVisitDates = visited
    .map(r => r.dateVisited || r.dateAdded)
    .filter(Boolean)
    .sort()
    .reverse();

  const last = lastVisitDates[0];
  if (!last) return;

  const daysSince = Math.floor((Date.now() - new Date(last)) / 86400000);
  if (daysSince >= 14) {
    // Fire a nudge now (in a real app this would use Push API via server)
    new Notification('🐻 Feed The Bear misses you!', {
      body: `It's been ${daysSince} days since your last visit. Time to try somewhere new!`,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'ftb-nudge'
    });
  }
}

function checkAndNudge () {
  if (localStorage.getItem('ftb_push_enabled') && Notification.permission === 'granted') {
    schedulePushNudge();
  }
}

/* ------------------------------------------------------------
   PHASE 10 • 🏆 ACHIEVEMENTS & XP
   ------------------------------------------------------------ */

const XP_KEY  = 'ftb_xp_v1';
const ACH_KEY = 'ftb_ach_v1';

const LEVELS = [
  { name: 'Foodie Rookie',         minXp: 0    },
  { name: 'Taste Explorer',        minXp: 100  },
  { name: 'Cuisine Connoisseur',   minXp: 300  },
  { name: 'Gastronome',            minXp: 700  },
  { name: 'Food Legend',           minXp: 1500 },
];

const BADGE_DEFS = [
  { id: 'first_visit',      icon: '🍽',  name: 'First Bite',       desc: 'Log your first visited restaurant',  xp: 20,  check: r => r.filter(x=>x.status==='visited').length >= 1 },
  { id: 'visits_5',         icon: '⭐',  name: 'Regular',           desc: '5 restaurants visited',              xp: 30,  check: r => r.filter(x=>x.status==='visited').length >= 5 },
  { id: 'visits_10',        icon: '⭐⭐',  name: 'Foodie',            desc: '10 restaurants visited',             xp: 50,  check: r => r.filter(x=>x.status==='visited').length >= 10 },
  { id: 'visits_25',        icon: '🏅',  name: 'Veteran',           desc: '25 restaurants visited',             xp: 100, check: r => r.filter(x=>x.status==='visited').length >= 25 },
  { id: 'visits_50',        icon: '🏆',  name: 'Legend',            desc: '50 restaurants visited',             xp: 200, check: r => r.filter(x=>x.status==='visited').length >= 50 },
  { id: 'cuisines_5',       icon: '🌍',  name: 'Globe Trotter',     desc: '5 different cuisines explored',      xp: 40,  check: r => new Set(r.filter(x=>x.status==='visited').map(x=>(x.cuisine||'').toLowerCase()).filter(Boolean)).size >= 5 },
  { id: 'cuisines_10',      icon: '🗺', name: 'Culinary Tourist',  desc: '10 different cuisines explored',     xp: 80,  check: r => new Set(r.filter(x=>x.status==='visited').map(x=>(x.cuisine||'').toLowerCase()).filter(Boolean)).size >= 10 },
  { id: 'wishlist_10',      icon: '🔖',  name: 'Dream List',        desc: '10 places on your wishlist',         xp: 25,  check: r => r.filter(x=>x.status==='wishlist').length >= 10 },
  { id: 'first_5star',      icon: '⭐',  name: 'Perfection',        desc: 'Give a restaurant 5 stars',          xp: 30,  check: r => r.some(x=>x.myRating >= 5) },
  { id: 'photo_added',      icon: '📸',  name: 'Shutterbug',        desc: 'Add a photo to a restaurant',        xp: 15,  check: r => r.some(x=>x.photo) },
  { id: 'has_notes',        icon: '📝',  name: 'Critic',            desc: 'Write notes on 5 restaurants',       xp: 20,  check: r => r.filter(x=>x.notes&&x.notes.length>10).length >= 5 },
  { id: 'cheap_gem',        icon: '💎',  name: 'Bargain Hunter',    desc: 'Rate a $ restaurant 4+ stars',       xp: 25,  check: r => r.some(x=>x.priceRange===1&&x.myRating>=4) },
];

function getXpData () {
  try { return JSON.parse(localStorage.getItem(XP_KEY)) || { xp: 0, unlocked: [] }; } catch(_) { return { xp: 0, unlocked: [] }; }
}
function saveXpData (data) { localStorage.setItem(XP_KEY, JSON.stringify(data)); }

function getLevelForXp (xp) {
  let level = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.minXp) level = l; }
  return level;
}

function getNextLevel (xp) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].minXp) {
      return LEVELS[i + 1] || null;
    }
  }
  return LEVELS[1];
}

function awardXp (amount, reason) {
  const data = getXpData();
  const before = getLevelForXp(data.xp);
  data.xp += amount;
  const after = getLevelForXp(data.xp);
  saveXpData(data);

  // XP toast
  const toast = document.createElement('div');
  toast.className = 'ach-xp-toast';
  toast.textContent = '+' + amount + ' XP · ' + reason;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);

  // Level up
  if (before.name !== after.name) {
    setTimeout(() => showToast('⭐ Level Up!', 'You are now: ' + after.name, 'success'), 400);
  }
}

function checkAchievements () {
  const data = getXpData();
  const restaurants = state.restaurants;
  let newUnlocks = [];

  BADGE_DEFS.forEach(def => {
    if (!data.unlocked.includes(def.id) && def.check(restaurants)) {
      data.unlocked.push(def.id);
      newUnlocks.push(def);
    }
  });

  if (newUnlocks.length) {
    saveXpData(data);
    newUnlocks.forEach((def, i) => {
      setTimeout(() => {
        showToast('🏅 Badge Unlocked!', def.icon + ' ' + def.name, 'success');
        awardXp(def.xp, def.name);
      }, i * 600);
    });
  }
}

function openAchievements () {
  checkAchievements();
  const data = getXpData();
  const level = getLevelForXp(data.xp);
  const next  = getNextLevel(data.xp);

  document.getElementById('ach-level-label').textContent = level.icon || '' + level.name;
  document.getElementById('ach-xp-label').textContent    = data.xp + ' XP' + (next ? ' / ' + next.minXp : ' · MAX');

  const pct = next
    ? Math.min(((data.xp - level.minXp) / (next.minXp - level.minXp)) * 100, 100)
    : 100;
  document.getElementById('ach-xp-fill').style.width = pct + '%';

  const grid = document.getElementById('ach-badges-grid');
  grid.innerHTML = BADGE_DEFS.map(def => {
    const unlocked = data.unlocked.includes(def.id);
    return `<div class="ach-badge ${unlocked ? 'unlocked' : ''}">
      <div class="ach-badge-icon">${def.icon}</div>
      <div class="ach-badge-name">${def.name}</div>
      <div class="ach-badge-desc">${def.desc}</div>
    </div>`;
  }).join('');

  document.getElementById('achievements-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeAchievements () {
  document.getElementById('achievements-overlay').classList.add('hidden');
  maybeHideOverlay();
}

/* ------------------------------------------------------------
   PHASE 10 • 🎲 SWIPE TO DECIDE
   ------------------------------------------------------------ */

let _swipeDeck = [];
let _swipeIdx  = 0;
let _swipeDragging = false;
let _swipeStartX = 0;
let _swipeCurrentCard = null;

function openSwipeDeck () {
  _swipeDeck = [...state.restaurants]
    .filter(r => r.status === 'wishlist')
    .sort(() => Math.random() - .5);
  _swipeIdx = 0;
  _renderSwipeDeck();
  document.getElementById('swipe-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeSwipeDeck () {
  document.getElementById('swipe-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function _renderSwipeDeck () {
  const deck = document.getElementById('swipe-deck');
  const empty = document.getElementById('swipe-empty');
  deck.querySelectorAll('.swipe-card-item').forEach(el => el.remove());

  const remaining = _swipeDeck.slice(_swipeIdx);
  if (!remaining.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Render top 3 cards (z-stacked)
  remaining.slice(0, 3).reverse().forEach((r, stackIdx) => {
    const isTop = stackIdx === remaining.slice(0,3).length - 1;
    const card = document.createElement('div');
    card.className = 'swipe-card-item';
    card.style.zIndex = stackIdx + 1;
    card.style.transform = `scale(${1 - (remaining.slice(0,3).length - 1 - stackIdx) * 0.04}) translateY(${(remaining.slice(0,3).length - 1 - stackIdx) * -8}px)`;
    card.innerHTML = `
      <div class="swipe-label yes">PICK ?</div>
      <div class="swipe-label no">SKIP ?</div>
      <div class="swipe-card-emoji">${cuisineEmoji(r.cuisine)}</div>
      <div class="swipe-card-name">${escHtml(r.name)}</div>
      <div class="swipe-card-meta">${escHtml(r.cuisine||'')}${r.priceRange ? ' · ' + '$'.repeat(r.priceRange) : ''}</div>
      ${r.myRating ? `<div class="swipe-card-rating">${'?'.repeat(r.myRating)}</div>` : ''}
      ${r.address ? `<div class="swipe-card-meta" style="margin-top:4px">📍 ${escHtml(r.address)}</div>` : ''}
    `;
    if (isTop) {
      _attachSwipeListeners(card, r);
      _swipeCurrentCard = card;
    }
    deck.appendChild(card);
  });
}

function _attachSwipeListeners (card, restaurant) {
  let startX = 0, currentX = 0, dragging = false;

  const onStart = e => {
    dragging = true;
    startX = (e.touches ? e.touches[0].clientX : e.clientX);
    card.style.transition = 'none';
  };
  const onMove = e => {
    if (!dragging) return;
    currentX = (e.touches ? e.touches[0].clientX : e.clientX) - startX;
    const rot = currentX * 0.12;
    card.style.transform = `translateX(${currentX}px) rotate(${rot}deg)`;
    const yesLabel = card.querySelector('.swipe-label.yes');
    const noLabel  = card.querySelector('.swipe-label.no');
    yesLabel.style.opacity = Math.min(Math.max(currentX / 80, 0), 1);
    noLabel.style.opacity  = Math.min(Math.max(-currentX / 80, 0), 1);
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(currentX) > 80) {
      _completeSwipe(card, restaurant, currentX > 0);
    } else {
      card.style.transition = 'transform .3s ease';
      card.style.transform  = '';
    }
  };

  card.addEventListener('mousedown', onStart);
  card.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);
}

function _completeSwipe (card, restaurant, picked) {
  const dir = picked ? 1 : -1;
  card.style.transition = 'transform .35s ease, opacity .35s ease';
  card.style.transform  = `translateX(${dir * 500}px) rotate(${dir * 20}deg)`;
  card.style.opacity    = '0';
  setTimeout(() => {
    card.remove();
    _swipeIdx++;
    if (picked) {
      // Add to tonight's pick toast
      showToast('🎯 ' + restaurant.name + ' picked!', 'Opening in Maps…', 'success');
      setTimeout(() => openDirections(restaurant), 800);
      awardXp(5, 'Made a dinner decision');
    }
    _renderSwipeDeck();
  }, 350);
}

function swipePick ()  { if (_swipeCurrentCard) { const r = _swipeDeck[_swipeIdx]; _completeSwipe(_swipeCurrentCard, r, true);  } }
function swipeSkip ()  { if (_swipeCurrentCard) { const r = _swipeDeck[_swipeIdx]; _completeSwipe(_swipeCurrentCard, r, false); } }

/* ------------------------------------------------------------
   PHASE 10 • 🎲 SPIN THE WHEEL
   ------------------------------------------------------------ */

let _spinItems    = [];
let _spinAngle    = 0;
let _spinAnimId   = null;
let _spinning     = false;

const WHEEL_COLORS = ['#FF6B35','#FF8C42','#FFA62B','#FFD166','#06D6A0','#118AB2','#7C83FD','#EF476F','#F78C6B','#C77DFF'];

function openSpinWheel () {
  _spinItems = state.restaurants.filter(r => r.status === 'wishlist' || r.status === 'visited');
  if (_spinItems.length < 2) {
    showToast('Need more restaurants', 'Add at least 2 to your list first.', 'error');
    return;
  }
  if (_spinItems.length > 12) _spinItems = _spinItems.sort(() => Math.random() - .5).slice(0, 12);
  _drawWheel();
  document.getElementById('spin-result').classList.add('hidden');
  document.getElementById('spin-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeSpinWheel () {
  if (_spinAnimId) { cancelAnimationFrame(_spinAnimId); _spinAnimId = null; }
  document.getElementById('spin-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function _drawWheel (highlightIdx = -1) {
  const canvas = document.getElementById('spin-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = W / 2 - 6;
  const n = _spinItems.length;
  const arc = (Math.PI * 2) / n;

  ctx.clearRect(0, 0, W, H);

  _spinItems.forEach((item, i) => {
    const startAngle = _spinAngle + arc * i - Math.PI / 2;
    const endAngle   = startAngle + arc;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle   = i === highlightIdx ? '#fff' : WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.lineWidth   = 2;
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startAngle + arc / 2);
    ctx.textAlign    = 'right';
    ctx.fillStyle    = '#000';
    ctx.font         = `bold ${Math.max(10, Math.min(14, 160/n))}px Poppins, sans-serif`;
    ctx.shadowColor  = 'rgba(255,255,255,.5)';
    ctx.shadowBlur   = 3;
    const label = item.name.length > 12 ? item.name.slice(0, 11) + '...' : item.name;
    ctx.fillText(label, r - 10, 5);
    ctx.restore();
  });

  // Centre circle
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#0D0D1A';
  ctx.fill();
  ctx.strokeStyle = 'var(--border)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#FF6B35';
  ctx.font = 'bold 14px Poppins';
  ctx.textAlign = 'center';
  ctx.fillText('🎲', cx, cy + 5);
}

function spinWheel () {
  if (_spinning) return;
  _spinning = true;
  document.getElementById('spin-result').classList.add('hidden');

  const targetRotations = 6 + Math.random() * 6;
  const targetAngle     = _spinAngle + targetRotations * Math.PI * 2 + Math.random() * Math.PI * 2;
  const duration        = 3500 + Math.random() * 1500;
  const startAngle      = _spinAngle;
  const startTime       = performance.now();

  function easeOut (t) { return 1 - Math.pow(1 - t, 3); }

  function step (now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    _spinAngle = startAngle + (targetAngle - startAngle) * easeOut(progress);
    _drawWheel();
    if (progress < 1) {
      _spinAnimId = requestAnimationFrame(step);
    } else {
      _spinning = false;
      // Determine winner: pointer at top (angle = 0 in canvas space = -p/2)
      const normalised = ((-_spinAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const arc = (Math.PI * 2) / _spinItems.length;
      const idx = Math.floor(normalised / arc) % _spinItems.length;
      const winner = _spinItems[idx];
      _drawWheel(idx);
      const resultEl = document.getElementById('spin-result');
      resultEl.innerHTML = `${cuisineEmoji(winner.cuisine)} <strong>${escHtml(winner.name)}</strong> wins the spin!`;
      resultEl.classList.remove('hidden');
      showToast('🎉 The wheel chose!', winner.name, 'success');
      awardXp(5, 'Spun the wheel');
    }
  }
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------
   PHASE 10 • ✈ TRAVEL MODE
   ------------------------------------------------------------ */

const TRAVEL_KEY = 'ftb_travel_v1';

function getTravelMode () {
  try { return JSON.parse(localStorage.getItem(TRAVEL_KEY)); } catch(_) { return null; }
}
function _saveTravelMode (city, lat, lng) {
  localStorage.setItem(TRAVEL_KEY, JSON.stringify({ city, lat, lng }));
  state._travelLat = lat;
  state._travelLng = lng;
}
function clearTravelMode () {
  localStorage.removeItem(TRAVEL_KEY);
  delete state._travelLat;
  delete state._travelLng;
  _refreshTravelUI();
  showToast('C:\Users\baild Travel Mode Off', 'Back to real location', 'info');
}

function _refreshTravelUI () {
  const t = getTravelMode();
  const banner   = document.getElementById('travel-active-banner');
  const cityLabel = document.getElementById('travel-active-city');
  if (t) {
    banner?.classList.remove('hidden');
    if (cityLabel) cityLabel.textContent = t.city;
  } else {
    banner?.classList.add('hidden');
  }
  document.querySelectorAll('.travel-city-btn').forEach(btn => {
    btn.classList.toggle('active', t && btn.dataset.city === t.city);
  });
}

function openTravelMode () {
  _refreshTravelUI();
  document.getElementById('travel-city-input').value = '';
  document.getElementById('travel-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeTravelMode () {
  document.getElementById('travel-overlay').classList.add('hidden');
  maybeHideOverlay();
}

async function activateTravelCity (city, lat, lng) {
  if (!city) return;

  if (lat !== undefined && lng !== undefined) {
    _saveTravelMode(city, parseFloat(lat), parseFloat(lng));
    _refreshTravelUI();
    showToast('✈ Travel Mode!', 'Location set to ' + city, 'success');
    awardXp(10, 'Activated Travel Mode');
    checkAchievements();
  } else {
    // Geocode via Nominatim
    try {
      const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(city), { headers: { 'Accept-Language': 'en' } });
      const results = await resp.json();
      if (!results.length) { showToast('Not found', 'Try a different city name.', 'error'); return; }
      const displayCity = results[0].display_name.split(',')[0];
      _saveTravelMode(displayCity, parseFloat(results[0].lat), parseFloat(results[0].lon));
      _refreshTravelUI();
      showToast('✈ Travel Mode!', 'Location set to ' + displayCity, 'success');
      awardXp(10, 'Activated Travel Mode');
      checkAchievements();
    } catch(e) {
      showToast('Error', 'Could not find that city.', 'error');
    }
  }
}

/* ------------------------------------------------------------
   PHASE 10 • 📊 MONTHLY DIGEST
   ------------------------------------------------------------ */

let _digestMonth = 0;
let _digestYear  = 0;

const _MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function openMonthlyDigest () {
  const now = new Date();
  _digestMonth = now.getMonth();
  _digestYear  = now.getFullYear();
  _renderDigest();
  document.getElementById('digest-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeMonthlyDigest () {
  document.getElementById('digest-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function _renderDigest () {
  const monthStr = _digestYear + '-' + String(_digestMonth + 1).padStart(2, '0');
  const visited  = state.restaurants.filter(r => r.status === 'visited' && ((r.dateVisited || r.dateAdded) || '').startsWith(monthStr));
  const added    = state.restaurants.filter(r => (r.dateAdded || '').startsWith(monthStr));
  const cuisines = new Set(visited.map(r => (r.cuisine || '').toLowerCase()).filter(Boolean));
  const rated    = visited.filter(r => r.myRating > 0);
  const avgRating = rated.length ? (rated.reduce((s,r) => s + r.myRating, 0) / rated.length).toFixed(1) : '—';
  const topRated  = rated.sort((a,b) => b.myRating - a.myRating)[0];
  const estSpend  = visited.filter(r => r.priceRange).reduce((s,r) => s + [0,12,25,45,75][r.priceRange || 0], 0);

  document.getElementById('digest-body').innerHTML = `
    <div class="digest-month-label">${_MONTH_NAMES[_digestMonth]} ${_digestYear}</div>
    <div class="digest-big">${visited.length}<br><span style="font-size:.95rem;font-weight:500;color:rgba(255,255,255,.6)">visits this month</span></div>
    <div class="digest-grid">
      <div class="digest-stat"><div class="digest-stat-val">${added.length}</div><div class="digest-stat-label">Added</div></div>
      <div class="digest-stat"><div class="digest-stat-val">${cuisines.size}</div><div class="digest-stat-label">Cuisines</div></div>
      <div class="digest-stat"><div class="digest-stat-val">${avgRating}</div><div class="digest-stat-label">Avg ?</div></div>
    </div>
    ${topRated ? `<div><div class="digest-top-label">Top spot this month</div><div class="digest-top-name">${cuisineEmoji(topRated.cuisine)} ${escHtml(topRated.name)} ${'?'.repeat(topRated.myRating)}</div></div>` : ''}
    ${estSpend > 0 ? `<div class="digest-sub">Estimated spend: ~$${estSpend}</div>` : ''}
    ${visited.length === 0 ? '<div style="color:rgba(255,255,255,.35);font-size:.82rem;margin-top:8px">No visits recorded for this month.</div>' : ''}
  `;
}

function shareDigest () {
  const visitedCount = state.restaurants.filter(r => {
    const d = r.dateVisited || r.dateAdded || '';
    return r.status === 'visited' && d.startsWith(_digestYear + '-' + String(_digestMonth + 1).padStart(2,'0'));
  }).length;
  const text = `📊 Feed The Bear · ${_MONTH_NAMES[_digestMonth]} ${_digestYear} Digest\n` +
               `Visited: ${visitedCount} restaurant${visitedCount !== 1 ? 's' : ''}\n` +
               `Track yours at https://cmc-creator.github.io/Feed-The-Bear/`;
  if (navigator.share) {
    navigator.share({ title: 'My Food Digest', text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text);
    showToast('Copied!', 'Digest copied to clipboard', 'success');
  }
}

/* ------------------------------------------------------------
   PHASE 10 • 🟢 OPEN NOW
   ------------------------------------------------------------ */

function openOpenNow () {
  document.getElementById('open-now-time').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  document.getElementById('open-now-results').innerHTML = '';
  document.getElementById('open-now-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeOpenNow () {
  document.getElementById('open-now-overlay').classList.add('hidden');
  maybeHideOverlay();
}

async function runOpenNowSearch () {
  const travelData = getTravelMode();
  if (!travelData && !(await ensureLocationForDiscovery())) return;
  const lat = travelData ? travelData.lat : state.userLat;
  const lng = travelData ? travelData.lng : state.userLng;
  if (!lat || !lng) {
    showToast('Location needed', 'Enable location or activate Travel Mode first.', 'error');
    return;
  }

  const radius     = parseInt(document.getElementById('open-now-radius').value) || 1000;
  const resultsEl  = document.getElementById('open-now-results');
  resultsEl.innerHTML = '<div class="open-now-loading">🔍 Searching nearby...</div>';

  const now        = new Date();
  const DAY_MAP    = { 0:'Su', 1:'Mo', 2:'Tu', 3:'We', 4:'Th', 5:'Fr', 6:'Sa' };
  const todayKey   = DAY_MAP[now.getDay()];
  const curMins    = now.getHours() * 60 + now.getMinutes();
  const DAY_ORDER  = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  const query = `[out:json][timeout:20];(node["amenity"~"restaurant|cafe|fast_food|bar"]["opening_hours"](around:${radius},${lat},${lng}););out body 40;`;

  try {
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 18000);
    const resp = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query), {
      signal: ctrl2.signal
    });
    clearTimeout(t2);
    const json = await resp.json();
    const elements = (json.elements || []).filter(el => el.tags?.name);

    if (!elements.length) {
      resultsEl.innerHTML = '<div class="open-now-loading">No places found nearby. Try increasing the radius.</div>';
      return;
    }

    function parseOpenNow (ohStr) {
      if (!ohStr) return null;
      if (ohStr.trim() === '24/7') return true;
      try {
        const segments = ohStr.split(';');
        for (const seg of segments) {
          const match = seg.trim().match(/^([A-Za-z,\-]+)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
          if (!match) continue;
          const [, dayPart, startT, endT] = match;
          const [sh, sm] = startT.split(':').map(Number);
          const [eh, em] = endT.split(':').map(Number);
          const startMin = sh * 60 + sm, endMin = eh * 60 + em;

          // Parse day part: "Mo-Fr", "Mo,We,Fr", "Mo"
          const dayRangeMatch = dayPart.match(/^([A-Z][a-z])(?:-([A-Z][a-z]))?$/);
          if (dayRangeMatch) {
            const dStart = DAY_ORDER.indexOf(dayRangeMatch[1]);
            const dEnd   = dayRangeMatch[2] ? DAY_ORDER.indexOf(dayRangeMatch[2]) : dStart;
            const today  = DAY_ORDER.indexOf(todayKey);
            if (today < 0) continue;
            const inRange = dEnd >= dStart
              ? (today >= dStart && today <= dEnd)
              : (today >= dStart || today <= dEnd);
            if (inRange && curMins >= startMin && curMins <= endMin) return true;
          }
        }
        return false;
      } catch(_) { return null; }
    }

    const TYPE_EMOJI = { restaurant:'🍽', cafe:'☕', fast_food:'🍟', bar:'🍺', pub:'🍺' };
    const savedNames = new Set(state.restaurants.map(r => normalizeName(r.name)));

    const items = elements.map(el => {
      const tags       = el.tags || {};
      const isOpen     = parseOpenNow(tags.opening_hours);
      const alreadyIn  = savedNames.has(normalizeName(tags.name));
      return { tags, isOpen, alreadyIn };
    }).filter(item => item.isOpen !== false)
      .sort((a,b) => (b.isOpen === true ? 1 : 0) - (a.isOpen === true ? 1 : 0))
      .slice(0, 20);

    if (!items.length) {
      resultsEl.innerHTML = '<div class="open-now-loading">No open places found right now. Try a larger radius.</div>';
      return;
    }

    resultsEl.innerHTML = items.map(({ tags, isOpen, alreadyIn }) => {
      const type = tags.amenity || 'restaurant';
      const emoji = TYPE_EMOJI[type] || '🍽';
      const badge = isOpen === true ? '🟢 Open' : '🟡 Maybe';
      const safeName = tags.name.replace(/'/g, '\\\'').replace(/"/g, '&quot;');
      const safeCuisine = (tags.cuisine || '').replace(/'/g, '\\\'');
      return `<div class="open-now-item">
        <div class="open-now-item-emoji">${emoji}</div>
        <div style="flex:1;min-width:0">
          <div class="open-now-name">${escHtml(tags.name)}</div>
          <div class="open-now-meta">${tags.cuisine ? escHtml(tags.cuisine.replace(/_/g,' ')) + ' · ' : ''}${tags.opening_hours ? escHtml(tags.opening_hours.slice(0,50)) : 'Hours vary'}</div>
        </div>
        <div class="open-now-badge">${badge}</div>
        ${!alreadyIn ? `<button class="btn-sm btn-orange" onclick="openAddModalPreFilled('${safeName}','${safeCuisine}')">+</button>` : ''}
      </div>`;
    }).join('');

  } catch(e) {
    resultsEl.innerHTML = '<div class="open-now-loading">Search failed. Check your connection and try again.</div>';
  }
}

/* ════════════════════════════════════════════════════════════
   PHASE 11 • TASTE DNA + WEEKLY GOAL + ENHANCEMENTS
   ════════════════════════════════════════════════════════════ */

/* ── Taste DNA ─────────────────────────────────────────── */
function renderTasteDna () {
  const el = document.getElementById('chart-taste-dna');
  if (!el) return;
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) {
    el.innerHTML = '<div class="chart-empty">Visit restaurants to reveal your Taste DNA!</div>';
    return;
  }

  const cuisineMap = {};
  visited.forEach(r => {
    const c = (r.cuisine || 'Other').trim();
    cuisineMap[c] = (cuisineMap[c] || 0) + 1 + (r.myRating || 0) * 0.15;
  });
  const total = Object.values(cuisineMap).reduce((a, b) => a + b, 0);
  const top5 = Object.entries(cuisineMap).sort(([, a], [, b]) => b - a).slice(0, 5);

  const withPrice = visited.filter(r => r.priceRange > 0);
  const avgPrice = withPrice.length ? withPrice.reduce((s, r) => s + r.priceRange, 0) / withPrice.length : 0;
  const priceLabel = avgPrice < 1.5 ? 'Budget Hunter 💰'
    : avgPrice < 2.5 ? 'Value Seeker 🍜'
    : avgPrice < 3.5 ? 'Upscale Diner 🍷'
    : 'Fine Dining Connoisseur 🥂';

  const uniqueCuisines = Object.keys(cuisineMap).length;
  const adventureScore = Math.min(Math.round((uniqueCuisines / Math.max(visited.length, 1)) * 100), 100);
  const adventureLabel = adventureScore > 70 ? 'Adventurous Explorer 🌍'
    : adventureScore > 40 ? 'Curious Foodie 🍽️'
    : 'Comfort Loyalist 🏠';

  const signature = top5[0];
  const dnaColors = ['#FF6B35', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6'];

  el.innerHTML = `
    <div class="dna-personality">${adventureLabel} · ${priceLabel}</div>
    <div class="dna-cuisines">
      ${top5.map(([c, score], i) => {
        const pct = Math.round(score / total * 100);
        return `<div class="dna-bar-row">
          <div class="dna-bar-label">${cuisineEmoji(c)} ${escHtml(c)}</div>
          <div class="dna-bar-track"><div class="dna-bar-fill" style="width:${pct}%;background:${dnaColors[i]}"></div></div>
          <div class="dna-bar-pct">${pct}%</div>
        </div>`;
      }).join('')}
    </div>
    <div class="dna-stats-row">
      <div class="dna-stat"><div class="dna-stat-val">${uniqueCuisines}</div><div class="dna-stat-lbl">Cuisines</div></div>
      <div class="dna-stat"><div class="dna-stat-val">${adventureScore}%</div><div class="dna-stat-lbl">Variety</div></div>
      <div class="dna-stat"><div class="dna-stat-val">${signature ? cuisineEmoji(signature[0]) : '🍽️'}</div><div class="dna-stat-lbl">Signature</div></div>
    </div>
    <button class="btn-sm btn-orange" style="width:100%;margin-top:10px" onclick="shareTasteDna()">📤 Share My Taste DNA</button>
  `;
}

function shareTasteDna () {
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) { showToast('No data yet', 'Visit some restaurants first!', 'error'); return; }

  const cuisineMap = {};
  visited.forEach(r => { const c = r.cuisine || 'Other'; cuisineMap[c] = (cuisineMap[c] || 0) + 1; });
  const top3 = Object.entries(cuisineMap).sort(([, a], [, b]) => b - a).slice(0, 3);
  const total = visited.length;

  const canvas = document.getElementById('share-canvas');
  const ctx = canvas.getContext('2d');
  const W = 800, H = 450;
  canvas.width = W; canvas.height = H;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0D0D1A'); bg.addColorStop(1, '#1A1A2E');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const acc = ctx.createLinearGradient(0, 0, 0, H);
  acc.addColorStop(0, '#FF6B35'); acc.addColorStop(1, '#C0392B');
  ctx.fillStyle = acc; ctx.fillRect(0, 0, 8, H);

  ctx.globalAlpha = .06; ctx.font = '200px serif'; ctx.fillStyle = '#FFF';
  ctx.fillText('🧬', W - 240, H - 10); ctx.globalAlpha = 1;

  ctx.fillStyle = '#FFF'; ctx.font = 'bold 38px system-ui,sans-serif';
  ctx.fillText('🧬 My Taste DNA', 50, 75);
  ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '16px system-ui,sans-serif';
  ctx.fillText('Based on ' + total + ' restaurant' + (total !== 1 ? 's' : '') + ' visited', 50, 104);

  const dnaColors = ['#FF6B35', '#3498DB', '#2ECC71'];
  const maxVal = Math.max(...top3.map(([, v]) => v), 1);
  top3.forEach(([c, n], i) => {
    const y = 155 + i * 82;
    const barW = Math.max((n / maxVal) * 430, 8);
    ctx.fillStyle = dnaColors[i] + '22';
    ctx.beginPath(); try { ctx.roundRect(50, y - 28, 480, 40, 8); } catch(_) { ctx.rect(50, y-28, 480, 40); } ctx.fill();
    ctx.fillStyle = dnaColors[i];
    ctx.beginPath(); try { ctx.roundRect(50, y - 28, barW, 40, 8); } catch(_) { ctx.rect(50, y-28, barW, 40); } ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 17px system-ui,sans-serif';
    ctx.fillText(cuisineEmoji(c) + ' ' + c + '  ' + Math.round(n / total * 100) + '%', 62, y);
  });

  ctx.fillStyle = '#FF6B35'; ctx.font = 'bold 15px system-ui,sans-serif';
  ctx.fillText('🐻 Feed The Bear', W - 195, H - 18);

  canvas.toBlob(blob => {
    const file = new File([blob], 'taste-dna-ftb.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      navigator.share({ title: 'My Taste DNA', text: 'My foodie personality on Feed The Bear 🐻🧬', files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); URL.revokeObjectURL(url);
    }
    showToast('🧬 Taste DNA!', 'Your flavor profile card is ready!', 'success');
  }, 'image/png');
}

/* ── Weekly Dining Goal ────────────────────────────────── */
function renderWeeklyGoal () {
  const widget = document.getElementById('weekly-goal-widget');
  if (!widget) return;
  const goal = state.settings.weeklyGoal || 0;
  if (!goal) { widget.classList.add('hidden'); return; }

  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const weekStart = startOfWeek.toISOString().slice(0, 10);

  let count = 0;
  state.restaurants.forEach(r => {
    (r.visits || []).forEach(v => { if ((v.date || '') >= weekStart) count++; });
    if (r.dateVisited >= weekStart && !(r.visits || []).length) count++;
  });

  const pct = Math.min(count / goal * 100, 100);
  const done = count >= goal;

  widget.classList.remove('hidden');
  document.getElementById('wg-count').textContent = count;
  document.getElementById('wg-goal').textContent = goal;
  const fill = document.getElementById('wg-fill');
  fill.style.width = pct + '%';
  fill.classList.toggle('complete', done);
  const label = document.getElementById('wg-label');
  if (label) {
    label.textContent = done ? '🎉 Goal crushed! You\'re on fire!'
      : count === 0 ? 'Get out and eat this week!'
      : (goal - count) + ' more meal' + ((goal - count) !== 1 ? 's' : '') + ' to hit your goal!';
  }
  if (done) {
    widget.style.borderColor = 'rgba(46,204,113,.5)';
    widget.style.background = 'linear-gradient(135deg,rgba(46,204,113,.1),rgba(46,204,113,.05))';
  } else {
    widget.style.borderColor = '';
    widget.style.background = '';
  }
}

function setWeeklyGoal () {
  const current = state.settings.weeklyGoal || 0;
  const val = prompt('How many meals do you want to eat out each week?\n\nEnter 0 to disable the goal widget.', current || 3);
  if (val === null) return;
  const n = Math.max(0, parseInt(val) || 0);
  state.settings.weeklyGoal = n;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  renderWeeklyGoal();
  if (n > 0) {
    showToast('🎯 Weekly Goal Set!', n + ' meal' + (n !== 1 ? 's' : '') + ' per week. Let\'s eat!', 'success');
  } else {
    showToast('Goal Cleared', 'Weekly goal widget hidden.', 'info');
  }
}

/* ── Gallery with Visit Photos ─────────────────────────── */
// Override the original openGallery to include visit photos
(function _patchGallery () {
  const _origOpenGallery = openGallery;
  window.openGallery = function () {
    const allPhotos = [];
    state.restaurants.forEach(r => {
      if (r.photo) allPhotos.push({ src: r.photo, name: r.name, id: r.id, type: 'cover' });
      (r.visits || []).forEach(v => {
        if (v.photo) allPhotos.push({ src: v.photo, name: r.name + ' — ' + fmtDate(v.date), id: r.id, type: 'visit' });
      });
    });
    _galleryPhotos = allPhotos;

    const grid = document.getElementById('gallery-grid');
    if (!allPhotos.length) {
      grid.innerHTML = '<div class="gallery-empty">No photos yet! Add a photo when saving a restaurant or logging a visit.</div>';
    } else {
      grid.innerHTML = allPhotos.map((p, i) =>
        '<div class="gallery-item" data-idx="' + i + '">'
        + '<img src="' + escHtml(p.src) + '" alt="' + escHtml(p.name) + '" loading="lazy" />'
        + '<div class="gallery-item-name">' + escHtml(p.name) + '</div>'
        + (p.type === 'visit' ? '<div class="gallery-type-badge">Visit</div>' : '')
        + '</div>'
      ).join('');
      grid.querySelectorAll('.gallery-item[data-idx]').forEach(el => {
        el.addEventListener('click', () => openLightbox(parseInt(el.dataset.idx)));
      });
    }
    document.getElementById('gallery-overlay').classList.remove('hidden');
    document.body.classList.add('overlay-open');
  };
})();

/* ── Visit Photo Support in Check-In ───────────────────── */
// Enhance detail modal checkin to support photos
function openCheckinWithPhoto (id) {
  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;

  const note = prompt('Quick note for this visit (optional):') || '';
  const ratingStr = prompt('Your rating 1-5 (optional):') || '0';
  const rating = Math.min(5, Math.max(0, parseInt(ratingStr) || 0));

  const visitEntry = { date: iso(), note, rating, photo: '' };
  const idx = state.restaurants.findIndex(x => x.id === id);
  if (idx === -1) return;

  if (!state.restaurants[idx].visits) state.restaurants[idx].visits = [];
  state.restaurants[idx].visits.push(visitEntry);
  state.restaurants[idx].status = 'visited';
  state.restaurants[idx].dateVisited = state.restaurants[idx].dateVisited || iso();
  if (rating) state.restaurants[idx].myRating = rating;

  // Offer photo upload
  const wantPhoto = confirm('Add a photo from this visit? 📷');
  if (wantPhoto) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const vIdx = state.restaurants[idx].visits.length - 1;
        state.restaurants[idx].visits[vIdx].photo = ev.target.result;
        saveData();
        renderAll();
        openDetailModal(id);
        showToast('📷 Photo Added!', 'Visit photo saved to gallery.', 'success');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  saveData();
  renderAll();
  openDetailModal(id);
  showToast('✅ Checked In!', 'Visit logged for ' + r.name, 'success');
  checkConfettiMilestones(state.restaurants, state.restaurants);
}

/* ── Priority Badge Helper ──────────────────────────────── */
function priorityBadgeHtml (r) {
  if (!r.priority || r.status !== 'want-to-try') return '';
  if (r.priority === 'hot')    return '<span class="priority-badge hot">🔥 Must Go!</span>';
  if (r.priority === 'next')   return '<span class="priority-badge next">⭐ Up Next</span>';
  if (r.priority === 'someday') return '<span class="priority-badge someday">📌 Someday</span>';
  return '';
}

/* ── Smarter Byte Cub Responses ─────────────────────────── */
function tasteDnaResponse () {
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) return 'Visit some restaurants first and I\'ll reveal your Taste DNA! 🧬';
  const cuisineMap = {};
  visited.forEach(r => { const c = r.cuisine || 'Other'; cuisineMap[c] = (cuisineMap[c] || 0) + 1; });
  const top3 = Object.entries(cuisineMap).sort(([, a], [, b]) => b - a).slice(0, 3);
  const uniqueCount = Object.keys(cuisineMap).length;
  const adventureLabel = uniqueCount > 7 ? 'an Adventurous Explorer 🌍' : uniqueCount > 4 ? 'a Curious Foodie 🍽️' : 'a Comfort Loyalist 🏠';
  const topStr = top3.map(([c, n]) => `${cuisineEmoji(c)} **${c}** (${n}x)`).join(', ');
  return `🧬 Your Taste DNA:\n\nYou\'re **${adventureLabel}** who loves ${topStr}.\n\nHead to **Stats** for your full flavor breakdown and a shareable Taste DNA card!`;
}

function neverTriedCuisineResponse () {
  const triedCuisines = new Set(
    state.restaurants.filter(r => r.status === 'visited').map(r => (r.cuisine || '').toLowerCase())
  );
  const allKnown = ['Italian','Japanese','Mexican','Chinese','Indian','Thai','French','Mediterranean','Korean','Vietnamese','Greek','Spanish','Brazilian','Ethiopian','Turkish','Caribbean','Peruvian','Lebanese'];
  const notTried = allKnown.filter(c => !triedCuisines.has(c.toLowerCase()));
  if (!notTried.length) return 'Wow, you\'ve explored every cuisine on my list! You\'re a true global foodie 🌍🏆';
  const pick = notTried[Math.floor(Math.random() * notTried.length)];
  return `You haven\'t tried **${pick}** yet! ${cuisineEmoji(pick.toLowerCase()) || '🍽️'}\n\nPerfect time to branch out — ask me to "discover nearby" to find a ${pick} spot near you! 🔍`;
}

function timeBasedResponse (q) {
  const hour = new Date().getHours();
  const want = state.restaurants.filter(r => r.status === 'want-to-try');
  const isMorning = hour < 11;
  const isLunch   = hour >= 11 && hour < 15;
  const isDinner  = hour >= 17;

  if (q.match(/breakfast|brunch|morning/) || (isMorning && !q.match(/lunch|dinner/))) {
    const brunch = want.filter(r => ['Breakfast','Brunch','Cafe','American'].includes(r.cuisine));
    if (brunch.length) {
      const pick = brunch[Math.floor(Math.random() * brunch.length)];
      return `Good morning! ☀️ How about this for breakfast:\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} ${pick.name}</span>\n\nPerfect way to start the day! ☕`;
    }
    return `Good morning! ☕ Add some breakfast or café spots to your list and I\'ll have morning recommendations ready!`;
  }
  if (q.match(/lunch|noon/) || (isLunch && q.match(/eat|food|hungry/))) {
    const quick = want.filter(r => r.priceRange <= 2 || ['Cafe','American','Mexican','Japanese','Korean'].includes(r.cuisine));
    if (quick.length) {
      const pick = quick[Math.floor(Math.random() * quick.length)];
      return `Lunchtime! 🍱 A quick and delicious option:\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} ${pick.name} ${priceDollars(pick.priceRange) || ''}</span>`;
    }
  }
  if (q.match(/dinner|tonight|evening/) || (isDinner && q.match(/eat|food|hungry/))) {
    const topDinner = [...want].sort((a, b) => (b.googleRating || 0) - (a.googleRating || 0)).slice(0, 3);
    if (topDinner.length) {
      const pick = topDinner[Math.floor(Math.random() * topDinner.length)];
      return `For dinner tonight 🌙, how about:\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} ${pick.name}${pick.googleRating ? ' ⭐' + pick.googleRating : ''}</span>\n\nOr ask for "Tonight\'s Pick" to get a mood-matched recommendation! 🎯`;
    }
  }
  return `Tell me more about your mood or craving and I\'ll find the perfect match! 🐻`;
}

function myStatsResponse () {
  const all     = state.restaurants;
  const visited = all.filter(r => r.status === 'visited');
  const want    = all.filter(r => r.status === 'want-to-try');
  const { currentStreak } = calcStreaks();
  const cuisineMap = {};
  visited.forEach(r => { const c = r.cuisine || 'Other'; cuisineMap[c] = (cuisineMap[c] || 0) + 1; });
  const topCuisine = Object.entries(cuisineMap).sort(([, a], [, b]) => b - a)[0];
  return `📊 **Your Foodie Stats:**\n\n🍽️ ${all.length} restaurants saved\n✅ ${visited.length} visited · 🔖 ${want.length} to try\n${currentStreak > 0 ? `🔥 ${currentStreak}-week streak!\n` : ''}${topCuisine ? `❤️ Favourite cuisine: **${topCuisine[0]}** (${topCuisine[1]}x)\n` : ''}\nCheck the **Stats** tab for the full breakdown!`;
}

function funnyNoteResponse () {
  const withNotes = state.restaurants.filter(r => r.notes);
  if (!withNotes.length) return 'No notes saved yet! Add personal notes when saving restaurants — best dishes, funny moments, must-order items. 📝';
  const item = withNotes[Math.floor(Math.random() * Math.min(withNotes.length, 8))];
  return `Here\'s a gem from your notes for **${item.name}**:\n\n*"${item.notes.slice(0, 180)}${item.notes.length > 180 ? '…' : ''}"* 🗒️\n\n<span class="chip-link" data-id="${item.id}">View restaurant</span>`;
}

function goingTonightResponse () {
  const want = state.restaurants.filter(r => r.status === 'want-to-try');
  const hot  = want.filter(r => r.priority === 'hot');
  const pool = hot.length ? hot : want;
  if (!pool.length) return `Your want-to-try list is empty — add some spots and come back! 🔖`;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return `🎯 **Going tonight?** Here\'s my top pick:\n\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} **${pick.name}**</span>\n${pick.address ? '📍 ' + pick.address + '\n' : ''}${pick.googleRating ? '⭐ ' + pick.googleRating + '/5\n' : ''}\nSay "directions" to get there, or ask for another pick!`;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 12 — Feature: 🥊 AI RESTAURANT DUEL
   ═══════════════════════════════════════════════════════════ */
function openDuel () {
  const overlay = document.getElementById('duel-overlay');
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _populateDuelPickers();
  document.getElementById('duel-result').classList.add('hidden');
  document.getElementById('duel-share-row').classList.add('hidden');
}
function closeDuel () {
  document.getElementById('duel-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _populateDuelPickers () {
  const opts = state.restaurants
    .slice()
    .sort((a,b) => a.name.localeCompare(b.name))
    .map(r => `<option value="${r.id}">${escHtml(r.name)}${r.cuisine ? ' (' + escHtml(r.cuisine) + ')' : ''}</option>`)
    .join('');
  ['duel-pick-a','duel-pick-b'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">Choose a restaurant…</option>' + opts;
  });
}
async function runDuel () {
  const idA = document.getElementById('duel-pick-a').value;
  const idB = document.getElementById('duel-pick-b').value;
  if (!idA || !idB) { showToast('Pick two', 'Select both restaurants first.', 'info'); return; }
  if (idA === idB) { showToast('Same restaurant!', 'Pick two different spots.', 'info'); return; }
  if (!AI.hasKey()) { showToast('AI key needed', 'Add your Gemini key in Settings → AI Key.', 'info'); return; }
  const rA = state.restaurants.find(r => r.id === idA);
  const rB = state.restaurants.find(r => r.id === idB);
  if (!rA || !rB) return;
  const resultEl = document.getElementById('duel-result');
  const goBtn = document.getElementById('duel-go-btn');
  resultEl.classList.remove('hidden');
  resultEl.classList.remove('duel-animate');
  resultEl.innerHTML = '<span class="ai-thinking-inline"><span></span><span></span><span></span></span> Byte Cub is judging…';
  goBtn.disabled = true;
  const describe = r => `Name: ${r.name}\nCuisine: ${r.cuisine||'unknown'}\nMy rating: ${r.myRating||'unrated'}/5\nPrice: ${r.priceRange||'unknown'}\nStatus: ${r.status||''}\nNotes: ${r.notes||'none'}`;
  const prompt = `You are a dramatic foodie sports commentator. Two restaurants are entering the ring for an epic duel!\n\nCORNER ONE — ${rA.name}:\n${describe(rA)}\n\nCORNER TWO — ${rB.name}:\n${describe(rB)}\n\nGive a fun, dramatic 6-8 sentence head-to-head breakdown covering: cuisine & vibe, value, overall experience based on the notes & ratings. End with a clear winner declaration on its own line starting with "🏆 WINNER:". Keep it under 200 words and make it entertaining!`;
  try {
    const text = await AI.call(prompt);
    const escaped = escHtml(text);
    const html = escaped.replace(/🏆 WINNER:[^\n]*/g, m => `<div class="duel-winner">${m}</div>`);
    resultEl.innerHTML = html;
    void resultEl.offsetWidth;
    resultEl.classList.add('duel-animate');
    document.getElementById('duel-share-row').classList.remove('hidden');
    document.getElementById('duel-share-btn').onclick = () => {
      const txt = `🥊 Restaurant Duel: ${rA.name} vs ${rB.name}\n\n${text}`;
      if (navigator.share) { navigator.share({ title: 'Restaurant Duel', text: txt }); }
      else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Fight card copied to clipboard.', 'success'); }
    };
  } catch (err) {
    resultEl.innerHTML = '⚠ ' + escHtml(err.message || 'AI error');
  }
  goBtn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 12 — Feature: 🎯 CUISINE BINGO
   ═══════════════════════════════════════════════════════════ */
const _BINGO_POOL = [
  {e:'🍕',n:'Italian'},{e:'🌮',n:'Mexican'},{e:'🍣',n:'Japanese'},{e:'🥘',n:'Indian'},
  {e:'🥡',n:'Chinese'},{e:'🥐',n:'French'},{e:'🥙',n:'Mediterranean'},{e:'🍔',n:'American'},
  {e:'🧆',n:'Middle Eastern'},{e:'🍜',n:'Thai'},{e:'🥩',n:'Steakhouse'},{e:'🍤',n:'Seafood'},
  {e:'🌯',n:'Vietnamese'},{e:'🥗',n:'Salad/Healthy'},{e:'🍺',n:'Pub/Bar'},{e:'🥞',n:'Breakfast'},
  {e:'🍛',n:'Korean'},{e:'🌶',n:'Ethiopian'},{e:'🥨',n:'German'},{e:'🫔',n:'Peruvian'},
  {e:'🧇',n:'Brunch'},{e:'🥟',n:'Dim Sum'},{e:'🍖',n:'BBQ'},{e:'🥬',n:'Vegan'},
  {e:'🫕',n:'Spanish'},{e:'🍝',n:'Pasta'},{e:'🍟',n:'Fast Food'},{e:'🥫',n:'Soul Food'},
  {e:'🌸',n:'Hawaiian'},{e:'🧁',n:'Bakery/Cafe'}
];
function _getBingoCard () {
  if (!state.settings.bingoCard) { _newBingoCard(); }
  return state.settings.bingoCard;
}
function _newBingoCard () {
  const userCuisines = [...new Set(state.restaurants.map(r => r.cuisine).filter(Boolean))];
  const poolNames = _BINGO_POOL.map(b => b.n);
  const extras = userCuisines.filter(c => !poolNames.includes(c)).slice(0, 5);
  const extraCells = extras.map(n => ({ e: '🍽', n }));
  const fullPool = [..._BINGO_POOL, ...extraCells];
  const shuffled = fullPool.sort(() => Math.random() - .5).slice(0, 24);
  const card = [...shuffled.slice(0, 12), { e: '⭐', n: 'FREE', free: true }, ...shuffled.slice(12)];
  state.settings.bingoCard = card;
  saveData();
  return card;
}
function openBingo () {
  document.getElementById('bingo-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderBingoGrid();
}
function closeBingo () {
  document.getElementById('bingo-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _renderBingoGrid () {
  const card = _getBingoCard();
  const visitedCuisines = new Set(state.restaurants.map(r => r.cuisine?.toLowerCase()).filter(Boolean));
  const gridEl = document.getElementById('bingo-grid');
  const filledIndices = new Set();
  gridEl.innerHTML = card.map((cell, i) => {
    const filled = cell.free || visitedCuisines.has(cell.n.toLowerCase());
    if (filled) filledIndices.add(i);
    return `<div class="bingo-cell${filled ? ' filled' : ''}${cell.free ? ' free' : ''}" data-idx="${i}">
      <span class="bingo-cell-emoji">${cell.e}</span>
      <span>${escHtml(cell.n)}</span>
    </div>`;
  }).join('');
  const totalFilled = [...filledIndices].filter(i => !card[i].free).length;
  const total = card.filter(c => !c.free).length;
  document.getElementById('bingo-progress').textContent = `${totalFilled} / ${total} cuisines visited`;
  const winner = _checkBingoLines(filledIndices);
  const banner = document.getElementById('bingo-winner-banner');
  if (winner) {
    banner.classList.remove('hidden');
    winner.forEach(idx => {
      const el = gridEl.children[idx];
      if (el) el.classList.add('bingo-line');
    });
  } else {
    banner.classList.add('hidden');
  }
}
function _checkBingoLines (filledSet) {
  const rows = [
    [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24]
  ];
  const cols = [
    [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24]
  ];
  const diags = [[0,6,12,18,24],[4,8,12,16,20]];
  for (const line of [...rows,...cols,...diags]) {
    if (line.every(i => filledSet.has(i))) return line;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 12 — Feature: 🥠 AI FOOD FORTUNE COOKIE
   ═══════════════════════════════════════════════════════════ */
const _FORTUNE_FALLBACKS = [
  'The best meal you have not yet tasted is waiting just around the corner.',
  'Your adventurous palate will lead you to an unexpected culinary gem this week.',
  'A cuisine you have never tried holds your next favorite dish.',
  'Sharing a meal with good company turns ordinary food into a feast.',
  'Trust your instincts at the menu — your gut feeling is hungry for a reason.',
  'The secret ingredient in every unforgettable meal is the story behind it.',
  'Your five-star experience is one reservation away.',
  'New flavors await those bold enough to order off-menu.',
];
let _fortuneLoading = false;
function openFortune () {
  const overlay = document.getElementById('fortune-overlay');
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _resetFortuneCookie();
}
function closeFortune () {
  document.getElementById('fortune-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _resetFortuneCookie () {
  const cookie = document.getElementById('fortune-cookie');
  const hint = document.getElementById('fortune-tap-hint');
  const result = document.getElementById('fortune-result');
  cookie.classList.remove('cracking');
  cookie.textContent = '🥠';
  hint.classList.remove('hidden');
  result.classList.add('hidden');
  _fortuneLoading = false;
}
async function crackFortuneCookie () {
  if (_fortuneLoading) return;
  _fortuneLoading = true;
  const cookie = document.getElementById('fortune-cookie');
  const hint = document.getElementById('fortune-tap-hint');
  const result = document.getElementById('fortune-result');
  const textEl = document.getElementById('fortune-text');
  cookie.classList.add('cracking');
  hint.classList.add('hidden');
  textEl.innerHTML = '<span class="ai-thinking-inline"><span></span><span></span><span></span></span>';
  result.classList.remove('hidden');
  try {
    let fortune;
    if (AI.hasKey() && state.restaurants.length > 0) {
      const top = state.restaurants
        .filter(r => r.myRating >= 4)
        .slice(0, 5)
        .map(r => r.name + (r.cuisine ? ' (' + r.cuisine + ')' : ''))
        .join(', ');
      const cuisines = [...new Set(state.restaurants.map(r => r.cuisine).filter(Boolean))].slice(0, 8).join(', ');
      const prompt = `You are a mystical food fortune cookie oracle. Based on this foodie's taste profile, craft ONE short, witty, personal food fortune (2-3 sentences max). Make it fun, insightful, and food-themed.\n\nFoodie profile:\n- Favorite restaurants: ${top || 'none yet'}\n- Cuisines explored: ${cuisines || 'none yet'}\n- Total restaurants tracked: ${state.restaurants.length}\n\nWrite only the fortune text, no quotes, no label, no extra commentary.`;
      fortune = await AI.call(prompt);
    } else {
      fortune = _FORTUNE_FALLBACKS[Math.floor(Math.random() * _FORTUNE_FALLBACKS.length)];
    }
    textEl.textContent = fortune;
    document.getElementById('fortune-share-btn').onclick = () => {
      const txt = '🥠 My food fortune: ' + fortune;
      if (navigator.share) { navigator.share({ title: 'Food Fortune', text: txt }); }
      else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Fortune copied.', 'success'); }
    };
  } catch (err) {
    const fb = _FORTUNE_FALLBACKS[Math.floor(Math.random() * _FORTUNE_FALLBACKS.length)];
    textEl.textContent = fb;
  }
  _fortuneLoading = false;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 12 — Feature: 📅 FOOD MOOD CALENDAR
   ═══════════════════════════════════════════════════════════ */
let _moodCalYear  = new Date().getFullYear();
let _moodCalMonth = new Date().getMonth();
function openMoodCal () {
  _moodCalYear  = new Date().getFullYear();
  _moodCalMonth = new Date().getMonth();
  document.getElementById('moodcal-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderMoodCal();
}
function closeMoodCal () {
  document.getElementById('moodcal-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _renderMoodCal () {
  const y = _moodCalYear, m = _moodCalMonth;
  const monthName = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('moodcal-label').textContent = monthName;
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  const visitMap = {};
  state.restaurants.forEach(r => {
    const dateStr = r.visitedAt || r.updatedAt || r.createdAt || null;
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (d.getFullYear() === y && d.getMonth() === m) {
      const day = d.getDate();
      if (!visitMap[day]) visitMap[day] = [];
      visitMap[day].push(r);
    }
  });
  const dows = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html = dows.map(d => `<div class="moodcal-dow">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div class="moodcal-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const visits = visitMap[day] || [];
    const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === day;
    let dotHtml = '';
    if (visits.length) {
      const avgRating = visits.reduce((s, r) => s + (r.myRating || 0), 0) / visits.length;
      const dotColor = avgRating >= 4 ? 'var(--green)' : avgRating >= 3 ? '#f5a623' : avgRating > 0 ? 'var(--primary)' : 'var(--surface3)';
      dotHtml = `<div class="moodcal-dot-inner" style="background:${dotColor}"></div>`;
    }
    html += `<div class="moodcal-day${isToday ? ' today' : ''}${visits.length ? ' has-visit' : ''}" data-day="${day}">${day}${dotHtml}</div>`;
  }
  const gridEl2 = document.getElementById('moodcal-grid');
  gridEl2.innerHTML = html;
  gridEl2._visitMap = visitMap;
  gridEl2._monthName = monthName;
  document.getElementById('moodcal-detail').classList.add('hidden');

/* ═══════════════════════════════════════════════════════════
   PHASE 12 — Feature: 🔥 DAILY FOODIE CHALLENGE
   ═══════════════════════════════════════════════════════════ */
const _DC_CHALLENGES = [
  { e: '🗺', t: 'New territory', d: 'Visit a cuisine type you have never rated before.' },
  { e: '📸', t: 'Snap & rate', d: 'Add a photo to one of your saved restaurants today.' },
  { e: '⭐', t: 'Rate something', d: 'Rate a restaurant you visited but never scored.' },
  { e: '📝', t: 'Leave a note', d: 'Add personal tasting notes to a restaurant with none.' },
  { e: '🔍', t: 'Hidden gem', d: 'Find and add a restaurant with under 100 Google reviews.' },
  { e: '🌶', t: 'Spice it up', d: 'Try or add a restaurant serving spicy cuisine.' },
  { e: '💸', t: 'Budget bite', d: 'Visit a $ price-range restaurant you have never tried.' },
  { e: '🥂', t: 'Special occasion', d: 'Book a fine dining ($$$+) spot for an upcoming occasion.' },
  { e: '🏆', t: 'Top the list', d: 'Rate a restaurant 5 stars and add a note on why.' },
  { e: '🔁', t: 'Return visit', d: 'Revisit a restaurant you rated 4+ stars over 3 months ago.' },
  { e: '🌍', t: 'World tour', d: 'Add a restaurant of a cuisine from a continent you have not tracked yet.' },
  { e: '👥', t: 'Squad goals', d: 'Plan a group outing to one of your want-to-try spots.' },
  { e: '🕵', t: 'Foodie detective', d: 'Find a restaurant in your city that opened in the last 6 months.' },
  { e: '🥗', t: 'Green & lean', d: 'Try a plant-based or vegan restaurant today.' },
  { e: '🍳', t: 'Breakfast club', d: 'Track a breakfast or brunch spot you love.' },
  { e: '🎲', t: 'Spin the wheel', d: 'Use Spin the Wheel to pick a restaurant and actually go.' },
  { e: '📖', t: 'Story time', d: 'Add a funny memory or story to a restaurant\'s notes.' },
  { e: '🗓', t: 'Monthly review', d: 'Open Monthly Digest and reflect on last month\'s visits.' },
  { e: '🤝', t: 'Share the love', d: 'Export your Food Passport and share it with a friend.' },
  { e: '🎯', t: 'Bucket list', d: 'Add 3 restaurants to your want-to-try list right now.' },
];
function _getDCState () {
  return state.settings.dailyChallenge || { date: '', text: '', emoji: '', completed: false, streak: 0, xp: 0, history: [] };
}
function _getTodayStr () { return new Date().toISOString().slice(0, 10); }
function _initDailyChallenge () {
  const dc = _getDCState();
  const today = _getTodayStr();
  if (dc.date !== today) {
    const pick = _DC_CHALLENGES[Math.floor(Math.random() * _DC_CHALLENGES.length)];
    dc.date = today;
    dc.text = pick.t;
    dc.desc = pick.d;
    dc.emoji = pick.e;
    dc.completed = false;
    state.settings.dailyChallenge = dc;
    saveData();
  }
  return dc;
}
function openDailyChallenge () {
  document.getElementById('dailychallenge-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderDailyChallenge();
}
function closeDailyChallenge () {
  document.getElementById('dailychallenge-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _renderDailyChallenge () {
  const dc = _initDailyChallenge();
  document.getElementById('dc-streak-count').textContent = dc.streak || 0;
  document.getElementById('dc-xp-count').textContent = dc.xp || 0;
  document.getElementById('dc-emoji').textContent = dc.emoji || '🎯';
  document.getElementById('dc-text').textContent = dc.text || 'Challenge loading…';
  document.getElementById('dc-desc').textContent = dc.desc || '';
  const completeBtn = document.getElementById('dc-complete-btn');
  const banner = document.getElementById('dc-completed-banner');
  if (dc.completed) {
    completeBtn.disabled = true;
    completeBtn.textContent = '✅ Completed!';
    banner.classList.remove('hidden');
  } else {
    completeBtn.disabled = false;
    completeBtn.textContent = '✅ Mark Complete';
    banner.classList.add('hidden');
  }
  _renderDCHistory(dc);
}
function _renderDCHistory (dc) {
  const hist = (dc.history || []).slice(-7).reverse();
  const el = document.getElementById('dc-history');
  if (!hist.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="dc-history-title">Last 7 days</div>' +
    hist.map(h => `<div class="dc-history-item"><span class="${h.done ? 'dc-history-done' : 'dc-history-skip'}">${h.done ? '✅' : '⏭'}</span><span>${escHtml(h.text)}</span><span style="margin-left:auto;color:var(--text2)">${h.date}</span></div>`).join('');
}
function completeDailyChallenge () {
  const dc = _getDCState();
  const today = _getTodayStr();
  if (dc.completed) { showToast('Already done!', 'Come back tomorrow for a new challenge.', 'info'); return; }
  dc.completed = true;
  dc.streak = (dc.streak || 0) + 1;
  dc.xp = (dc.xp || 0) + 25;
  if (!dc.history) dc.history = [];
  dc.history.push({ date: today, done: true, text: dc.text });
  state.settings.dailyChallenge = dc;
  saveData();
  showToast('🔥 Challenge complete!', `+25 XP · ${dc.streak} day streak!`, 'success');
  _renderDailyChallenge();
}
function skipDailyChallenge () {
  const dc = _getDCState();
  const today = _getTodayStr();
  if (dc.completed) return;
  dc.streak = 0;
  if (!dc.history) dc.history = [];
  dc.history.push({ date: today, done: false, text: dc.text });
  const pick = _DC_CHALLENGES[Math.floor(Math.random() * _DC_CHALLENGES.length)];
  dc.date = today;
  dc.text = pick.t;
  dc.desc = pick.d;
  dc.emoji = pick.e;
  dc.completed = false;
  state.settings.dailyChallenge = dc;
  saveData();
  showToast('Skipped', 'Streak reset. New challenge loaded!', 'info');
  _renderDailyChallenge();
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 — Feature: 📋 VISIT LOG
   ═══════════════════════════════════════════════════════════ */
let _vlRestaurantId = null;
let _vlStarVal = 0;

function openVisitLog () {
  _vlRestaurantId = null;
  _vlStarVal = 0;
  document.getElementById('visitlog-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _populateVisitLogSelect();
  document.getElementById('visitlog-entries').classList.add('hidden');
  document.getElementById('vl-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('vl-spend').value = '';
  document.getElementById('vl-dish').value = '';
  document.getElementById('vl-notes').value = '';
  _setVlStars(0);
}
function closeVisitLog () {
  document.getElementById('visitlog-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _populateVisitLogSelect () {
  const sel = document.getElementById('visitlog-restaurant-select');
  const sorted = state.restaurants.slice().sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">Select a restaurant…</option>' +
    sorted.map(r => `<option value="${r.id}">${escHtml(r.name)}${r.cuisine ? ' (' + escHtml(r.cuisine) + ')' : ''}</option>`).join('');
}
function _loadVisitLogEntries () {
  const id = document.getElementById('visitlog-restaurant-select').value;
  if (!id) { showToast('Choose a restaurant', 'Select one from the list first.', 'info'); return; }
  _vlRestaurantId = id;
  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;
  if (!r.visitLog) r.visitLog = [];
  document.getElementById('visitlog-entries').classList.remove('hidden');
  _renderVisitLogList(r);
}
function _renderVisitLogList (r) {
  const listEl = document.getElementById('visitlog-list');
  if (!r.visitLog || !r.visitLog.length) {
    listEl.innerHTML = '<div style="color:var(--text2);font-size:.82rem;padding:8px 0">No visits logged yet.</div>';
    return;
  }
  listEl.innerHTML = r.visitLog.slice().reverse().map((v, i) => {
    const realIdx = r.visitLog.length - 1 - i;
    const stars = v.rating ? '⭐'.repeat(v.rating) : '';
    return `<div class="visitlog-entry">
      <div class="visitlog-entry-header">
        <span class="visitlog-entry-date">${v.date || ''}</span>
        ${v.spend ? `<span class="visitlog-entry-spend">$${parseFloat(v.spend).toFixed(2)}</span>` : ''}
        <button class="visitlog-entry-del" data-idx="${realIdx}" title="Delete">✕</button>
      </div>
      ${v.dish ? `<div class="visitlog-entry-dish">🍴 ${escHtml(v.dish)}</div>` : ''}
      ${stars ? `<div class="visitlog-entry-stars">${stars}</div>` : ''}
      ${v.notes ? `<div class="visitlog-entry-notes">${escHtml(v.notes)}</div>` : ''}
    </div>`;
  }).join('');
  listEl.querySelectorAll('.visitlog-entry-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      r.visitLog.splice(idx, 1);
      saveData();
      _renderVisitLogList(r);
      _invalidateSpendCache();
    });
  });
}
function _setVlStars (n) {
  _vlStarVal = n;
  document.querySelectorAll('.vl-star').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.val) <= n);
  });
}
function _saveVisitLogEntry () {
  if (!_vlRestaurantId) { showToast('Load a restaurant first', '', 'info'); return; }
  const r = state.restaurants.find(x => x.id === _vlRestaurantId);
  if (!r) return;
  const date  = document.getElementById('vl-date').value;
  const spend = document.getElementById('vl-spend').value;
  const dish  = document.getElementById('vl-dish').value.trim();
  const notes = document.getElementById('vl-notes').value.trim();
  if (!date) { showToast('Pick a date', '', 'info'); return; }
  if (!r.visitLog) r.visitLog = [];
  r.visitLog.push({ date, spend: spend ? parseFloat(spend) : null, dish, notes, rating: _vlStarVal || null });
  // Bump updatedAt so Mood Calendar picks it up
  r.updatedAt = new Date(date).toISOString();
  saveData();
  renderAll();
  _renderVisitLogList(r);
  _invalidateSpendCache();
  document.getElementById('vl-dish').value = '';
  document.getElementById('vl-notes').value = '';
  document.getElementById('vl-spend').value = '';
  _setVlStars(0);
  showToast('Visit saved!', `Logged a visit to ${escHtml(r.name)}.`, 'success');
}
function _invalidateSpendCache () { _spendCacheValid = false; }

/* ═══════════════════════════════════════════════════════════
   PHASE 13 — Feature: 💸 SPEND TRACKER
   ═══════════════════════════════════════════════════════════ */
let _spendCacheValid = false;

function openSpendTracker () {
  document.getElementById('spend-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderSpendTracker();
}
function closeSpendTracker () {
  document.getElementById('spend-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _getAllVisits () {
  const visits = [];
  state.restaurants.forEach(r => {
    (r.visitLog || []).forEach(v => {
      if (v.spend != null && v.spend > 0) {
        visits.push({ name: r.name, cuisine: r.cuisine, rating: r.myRating, visitRating: v.rating, spend: parseFloat(v.spend), date: v.date || '' });
      }
    });
  });
  return visits;
}
function _renderSpendTracker () {
  const visits = _getAllVisits();
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let totalMonth = 0, totalAll = 0;
  const byMonth = {};
  const byRestaurant = {};
  visits.forEach(v => {
    totalAll += v.spend;
    const mk = v.date ? v.date.slice(0, 7) : 'unknown';
    if (mk === thisMonthKey) totalMonth += v.spend;
    byMonth[mk] = (byMonth[mk] || 0) + v.spend;
    if (!byRestaurant[v.name]) byRestaurant[v.name] = { total: 0, count: 0, rating: v.rating || 0 };
    byRestaurant[v.name].total += v.spend;
    byRestaurant[v.name].count++;
    if (v.rating) byRestaurant[v.name].rating = Math.max(byRestaurant[v.name].rating, v.rating);
  });
  const avgVisit = visits.length ? totalAll / visits.length : 0;
  document.getElementById('spend-total-month').textContent = '$' + totalMonth.toFixed(2);
  document.getElementById('spend-total-all').textContent   = '$' + totalAll.toFixed(2);
  document.getElementById('spend-avg-visit').textContent   = '$' + avgVisit.toFixed(2);

  // Best value: cost per star
  const valueItems = Object.entries(byRestaurant)
    .filter(([, d]) => d.rating > 0)
    .map(([name, d]) => ({ name, perStar: d.total / d.rating, count: d.count }))
    .sort((a, b) => a.perStar - b.perStar)
    .slice(0, 8);
  document.getElementById('spend-value-list').innerHTML = valueItems.length
    ? valueItems.map(v => `<div class="spend-value-item"><span>${escHtml(v.name)}</span><span class="spend-value-score">$${v.perStar.toFixed(0)}/⭐</span></div>`).join('')
    : '<div style="color:var(--text2);font-size:.82rem">Log visits with ratings to see value scores.</div>';

  // Monthly bars
  const sortedMonths = Object.entries(byMonth).filter(([k]) => k !== 'unknown').sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const maxAmt = Math.max(...sortedMonths.map(([, v]) => v), 1);
  document.getElementById('spend-monthly-bars').innerHTML = sortedMonths.length
    ? sortedMonths.map(([mk, amt]) => {
        const label = mk.slice(0, 7);
        const pct = Math.round((amt / maxAmt) * 100);
        return `<div class="spend-bar-row">
          <span class="spend-bar-label">${label}</span>
          <div class="spend-bar-track"><div class="spend-bar-fill" style="width:${pct}%"></div></div>
          <span class="spend-bar-amt">$${amt.toFixed(0)}</span>
        </div>`;
      }).join('')
    : '<div style="color:var(--text2);font-size:.82rem">No spend data yet. Log visits with amounts via Visit Log.</div>';
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 — Feature: ⏰ IT'S BEEN A WHILE
   ═══════════════════════════════════════════════════════════ */
function openBeenaWhile () {
  document.getElementById('beenawhile-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderBeenaWhile();
}
function closeBeenaWhile () {
  document.getElementById('beenawhile-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _renderBeenaWhile () {
  const now = Date.now();
  const MS_90 = 90 * 24 * 60 * 60 * 1000;
  const candidates = state.restaurants
    .filter(r => r.myRating >= 4 && (r.status === 'visited' || (r.visitLog && r.visitLog.length)))
    .map(r => {
      const lastLogDate = r.visitLog && r.visitLog.length
        ? r.visitLog.reduce((best, v) => (!best || v.date > best) ? v.date : best, null)
        : null;
      const dateStr = lastLogDate || r.dateVisited || r.visitedAt || r.updatedAt || null;
      const ms = dateStr ? now - new Date(dateStr).getTime() : Infinity;
      return { r, ms, dateStr };
    })
    .filter(x => x.ms >= MS_90)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 20);

  const listEl = document.getElementById('beenawhile-list');
  if (!candidates.length) {
    listEl.innerHTML = '<div class="beenawhile-empty">🎉 You\'re on top of it! All your faves have been visited recently.</div>';
    return;
  }
  const cuisineEmoji = { Italian:'🍕', Mexican:'🌮', Japanese:'🍣', Indian:'🥘', Chinese:'🥡', French:'🥐', American:'🍔', Thai:'🍜', Mediterranean:'🥙' };
  listEl.innerHTML = candidates.map(({ r, ms }) => {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const ago = days > 365 ? `${Math.floor(days/365)}y ago` : `${days}d ago`;
    const emoji = (r.cuisine && cuisineEmoji[r.cuisine]) || '🍽';
    const stars = '⭐'.repeat(Math.round(r.myRating || 0));
    return `<div class="beenawhile-item" data-id="${r.id}">
      <div class="beenawhile-emoji">${emoji}</div>
      <div class="beenawhile-info">
        <div class="beenawhile-name">${escHtml(r.name)}</div>
        <div class="beenawhile-meta">${stars}${r.cuisine ? ' · ' + escHtml(r.cuisine) : ''}</div>
      </div>
      <div class="beenawhile-ago">${ago}</div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.beenawhile-item[data-id]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      closeBeenaWhile();
      openDetailModal(el.dataset.id);
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 — Feature: 📆 AI MEAL PLANNER
   ═══════════════════════════════════════════════════════════ */
function openMealPlanner () {
  document.getElementById('mealplanner-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  document.getElementById('mp-result').classList.add('hidden');
  document.getElementById('mp-share-btn').classList.add('hidden');
}
function closeMealPlanner () {
  document.getElementById('mealplanner-overlay').classList.add('hidden');
  maybeHideOverlay();
}
async function generateMealPlan () {
  if (!AI.hasKey()) { showToast('AI key needed', 'Add your Gemini key in Settings → AI Key.', 'info'); return; }
  const days   = document.getElementById('mp-days').value;
  const budget = document.getElementById('mp-budget').value;
  const vibe   = document.getElementById('mp-vibe').value.trim();
  const btn    = document.getElementById('mp-generate-btn');
  const result = document.getElementById('mp-result');
  result.classList.remove('hidden');
  result.innerHTML = '<span class="ai-thinking-inline"><span></span><span></span><span></span></span> Planning your foodie week…';
  btn.disabled = true;
  const wantToTry = state.restaurants.filter(r => r.status === 'want-to-try').slice(0, 10).map(r => r.name + (r.cuisine ? ' (' + r.cuisine + ')' : '')).join(', ');
  const faves = state.restaurants.filter(r => r.myRating >= 4).slice(0, 8).map(r => r.name + (r.cuisine ? ' (' + r.cuisine + ')' : '')).join(', ');
  const prompt = `You are a personal dining concierge. Create a ${days}-day dining plan for this week.

User profile:
- Favourite restaurants: ${faves || 'not specified'}
- Want to try: ${wantToTry || 'not specified'}
- Weekly budget: ${budget ? '$' + budget : 'flexible'}
- Vibe: ${vibe || 'whatever feels good'}
- Total restaurants in their list: ${state.restaurants.length}

Write a clear day-by-day dining plan. For each day use this format:
DAY [number] — [Day name]: [Restaurant name] ([cuisine]) — [1-2 sentence reason]

End with a 1-sentence budget note if budget was given. Keep total response under 300 words. Be enthusiastic and personal!`;
  try {
    const text = await AI.call(prompt);
    const html = escHtml(text).replace(/DAY \d[^\n]*/g, m => `<div class="mp-day-block"><div class="mp-day-heading">${m}</div></div>`);
    result.innerHTML = html;
    document.getElementById('mp-share-btn').classList.remove('hidden');
    document.getElementById('mp-share-btn').onclick = () => {
      if (navigator.share) navigator.share({ title: 'My Dining Plan', text });
      else { navigator.clipboard?.writeText(text); showToast('Copied!', 'Plan copied to clipboard.', 'success'); }
    };
  } catch (err) {
    result.innerHTML = '⚠ ' + escHtml(err.message || 'AI error');
  }
  btn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 — Feature: 🗳 GROUP VOTE
   ═══════════════════════════════════════════════════════════ */
const _GV_MAX = 5;
let _gvSelected = new Set();

function openGroupVote () {
  _gvSelected.clear();
  document.getElementById('groupvote-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  document.getElementById('groupvote-link-row').classList.add('hidden');
  document.getElementById('groupvote-results').classList.add('hidden');
  _renderGroupVotePicker();
  // Check if arriving via ?vote= link
  const params = new URLSearchParams(window.location.search);
  if (params.has('vote')) { _loadGroupVoteResults(params.get('vote')); }
}
function closeGroupVote () {
  document.getElementById('groupvote-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _renderGroupVotePicker () {
  const sorted = state.restaurants.slice().sort((a, b) => (b.myRating || 0) - (a.myRating || 0)).slice(0, 30);
  document.getElementById('groupvote-picker').innerHTML = sorted.map(r =>
    `<div class="groupvote-pick-item${_gvSelected.has(r.id) ? ' selected' : ''}" data-id="${r.id}">
      <div class="groupvote-pick-check">${_gvSelected.has(r.id) ? '✓' : ''}</div>
      <span class="groupvote-pick-name">${escHtml(r.name)}</span>
      <span class="groupvote-pick-cuisine">${r.cuisine ? escHtml(r.cuisine) : ''}</span>
    </div>`
  ).join('');
  document.getElementById('groupvote-picker').querySelectorAll('.groupvote-pick-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (_gvSelected.has(id)) { _gvSelected.delete(id); }
      else if (_gvSelected.size >= _GV_MAX) { showToast('Max 5 options', 'Remove one first.', 'info'); return; }
      else { _gvSelected.add(id); }
      _renderGroupVotePicker();
    });
  });
}
function _generateVoteLink () {
  if (_gvSelected.size < 2) { showToast('Pick at least 2', 'Select 2–5 restaurants to vote on.', 'info'); return; }
  const ids = [..._gvSelected];
  const payload = ids.map(id => {
    const r = state.restaurants.find(x => x.id === id);
    return r ? { id: r.id, n: r.name.slice(0, 40), c: r.cuisine || '' } : null;
  }).filter(Boolean);
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = window.location.origin + window.location.pathname + '?vote=' + encoded;
  document.getElementById('groupvote-link-input').value = url;
  document.getElementById('groupvote-link-row').classList.remove('hidden');
}
function _loadGroupVoteResults (encoded) {
  try {
    const items = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    document.getElementById('groupvote-results').classList.remove('hidden');
    // Show as vote options with click-to-vote
    document.getElementById('groupvote-bars').innerHTML = items.map(item =>
      `<div class="groupvote-bar-row">
        <span class="groupvote-bar-name">${escHtml(item.n)}${item.c ? ' <small style="color:var(--text2)">(' + escHtml(item.c) + ')</small>' : ''}</span>
        <button class="btn-sm btn-orange" style="font-size:.72rem;padding:3px 10px" onclick="_castVote('${escHtml(item.id)}', '${encoded}')">Vote</button>
      </div>`
    ).join('');
  } catch (e) { /* ignore bad encoded */ }
}
function _castVote (id, encoded) {
  const key = 'ftb_votes_' + encoded.slice(0, 16);
  if (localStorage.getItem(key) === id) { showToast('Already voted!', 'You already voted for this spot.', 'info'); return; }
  localStorage.setItem(key, id);
  showToast('Vote cast! 🗳', 'Your choice has been recorded.', 'success');
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 — Feature: 🌍 CUISINE WORLD MAP
   ═══════════════════════════════════════════════════════════ */

// Cuisine → ISO country code(s) mapping
const _CUISINE_COUNTRY_MAP = {
  'Italian': ['ITA'], 'Mexican': ['MEX'], 'Japanese': ['JPN'], 'Indian': ['IND'],
  'Chinese': ['CHN'], 'French': ['FRA'], 'Mediterranean': ['GRC','TUR','ESP'],
  'American': ['USA'], 'Middle Eastern': ['LBN','ISR','JOR'], 'Thai': ['THA'],
  'Korean': ['KOR'], 'Vietnamese': ['VNM'], 'German': ['DEU'], 'Spanish': ['ESP'],
  'Peruvian': ['PER'], 'Ethiopian': ['ETH'], 'Hawaiian': ['USA'], 'Brazilian': ['BRA'],
  'Greek': ['GRC'], 'Turkish': ['TUR'], 'Moroccan': ['MAR'], 'Lebanese': ['LBN'],
  'Israeli': ['ISR'], 'Pakistani': ['PAK'], 'Sri Lankan': ['LKA'], 'Malaysian': ['MYS'],
  'Indonesian': ['IDN'], 'Filipino': ['PHL'], 'Cambodian': ['KHM'], 'Burmese': ['MMR'],
  'Singaporean': ['SGP'], 'Australian': ['AUS'], 'British': ['GBR'], 'Irish': ['IRL'],
  'Portuguese': ['PRT'], 'Dutch': ['NLD'], 'Belgian': ['BEL'], 'Swiss': ['CHE'],
  'Austrian': ['AUT'], 'Polish': ['POL'], 'Russian': ['RUS'], 'Ukrainian': ['UKR'],
  'Swedish': ['SWE'], 'Norwegian': ['NOR'], 'Danish': ['DNK'], 'Finnish': ['FIN'],
  'Argentinian': ['ARG'], 'Colombian': ['COL'], 'Venezuelan': ['VEN'], 'Cuban': ['CUB'],
  'Jamaican': ['JAM'], 'Caribbean': ['CUB','JAM','DOM'], 'Egyptian': ['EGY'],
  'Nigerian': ['NGA'], 'Ghanaian': ['GHA'], 'South African': ['ZAF'],
  'Afghan': ['AFG'], 'Iranian': ['IRN'], 'Iraqi': ['IRQ'], 'Saudi': ['SAU'],
  'Nepalese': ['NPL'], 'Tibetan': ['CHN'], 'Taiwanese': ['TWN'],
  'Dim Sum': ['CHN'], 'Sushi': ['JPN'], 'Steakhouse': ['USA'], 'BBQ': ['USA'],
  'Seafood': ['NOR'], 'Vegan': ['USA'], 'Bakery/Cafe': ['FRA'], 'Brunch': ['USA'],
  'Breakfast': ['USA'], 'Fast Food': ['USA'], 'Pub/Bar': ['GBR'],
};

function openWorldMap () {
  document.getElementById('worldmap-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderWorldMap();
}
function closeWorldMap () {
  document.getElementById('worldmap-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _getVisitedCountries () {
  const countries = new Set();
  const cuisineVisits = {};
  state.restaurants.forEach(r => {
    if (!r.cuisine) return;
    const codes = _CUISINE_COUNTRY_MAP[r.cuisine];
    if (!codes) return;
    codes.forEach(c => countries.add(c));
    if (!cuisineVisits[r.cuisine]) cuisineVisits[r.cuisine] = 0;
    cuisineVisits[r.cuisine]++;
  });
  return { countries, cuisineVisits };
}
function _renderWorldMap () {
  const { countries, cuisineVisits } = _getVisitedCountries();
  const total = Object.keys(_CUISINE_COUNTRY_MAP).length;
  const visited = [...new Set(Object.keys(cuisineVisits))].length;

  document.getElementById('worldmap-stats').innerHTML =
    `<span>🌍 <strong>${countries.size}</strong> countries tasted</span>` +
    `<span>🍽 <strong>${visited}</strong> cuisine styles</span>` +
    `<span>📍 <strong>${state.restaurants.length}</strong> restaurants logged</span>`;

  // Build a simplified SVG world map using country outlines
  // We use a simplified rectangle-based representation for each region
  const svgRegions = _buildWorldMapSVG(countries);
  document.getElementById('worldmap-svg-container').innerHTML = svgRegions;

  // Legend: top visited cuisines
  const topCuisines = Object.entries(cuisineVisits).sort(([,a],[,b]) => b-a).slice(0,6);
  document.getElementById('worldmap-legend').innerHTML =
    '<div class="worldmap-legend-item"><div class="worldmap-legend-dot" style="background:var(--primary)"></div><span>Visited</span></div>' +
    '<div class="worldmap-legend-item"><div class="worldmap-legend-dot" style="background:var(--surface3)"></div><span>Not yet</span></div>' +
    (topCuisines.length ? ' <span style="margin-left:8px;color:var(--text2)">Top: ' + topCuisines.map(([c,n]) => escHtml(c) + ' ×' + n).join(', ') + '</span>' : '');
}
function _buildWorldMapSVG (visitedCountries) {
  // Simplified continent/country blocks for a quick visual map
  // Each entry: [id, label, cx, cy, w, h]
  const blocks = [
    // North America
    ['USA','USA',60,90,55,35],['CAN','CAN',60,55,60,35],['MEX','MEX',55,127,30,25],
    // Central America / Caribbean
    ['CUB','Cuba',100,130,18,8],['JAM','Jamaica',108,140,8,5],['DOM','DR',118,133,8,6],
    // South America
    ['COL','Colombia',80,160,22,22],['VEN','Venezuela',100,157,22,18],['BRA','Brazil',95,185,50,50],
    ['ARG','Argentina',85,238,25,40],['PER','Peru',68,190,22,30],
    // Europe
    ['GBR','UK',205,60,14,18],['IRL','Ireland',193,60,10,12],['FRA','France',212,74,20,20],
    ['ESP','Spain',200,88,24,18],['PRT','Portugal',190,88,10,18],['DEU','Germany',225,64,18,18],
    ['ITA','Italy',230,82,14,26],['NLD','Netherlands',218,58,10,10],['BEL','Belgium',216,66,10,10],
    ['CHE','Switzerland',224,74,10,8],['AUT','Austria',232,72,14,10],['POL','Poland',238,60,18,16],
    ['SWE','Sweden',238,42,14,22],['NOR','Norway',232,30,16,22],['DNK','Denmark',230,50,10,10],
    ['FIN','Finland',248,30,16,22],['GRC','Greece',245,90,14,16],['TUR','Turkey',262,80,28,18],
    ['RUS','Russia',268,30,80,45],['UKR','Ukraine',260,65,28,16],
    // Middle East / Africa
    ['LBN','Lebanon',280,88,8,8],['ISR','Israel',278,92,8,10],['JOR','Jordan',286,92,12,12],
    ['SAU','Saudi',284,100,26,24],['IRN','Iran',292,80,30,24],['IRQ','Iraq',282,80,14,18],
    ['AFG','Afghan',318,76,20,18],['EGY','Egypt',258,108,24,22],['MAR','Morocco',200,106,22,18],
    ['ETH','Ethiopia',268,138,24,22],['NGA','Nigeria',220,148,22,20],['GHA','Ghana',208,148,12,14],
    ['ZAF','S.Africa',230,198,26,24],
    // South Asia
    ['IND','India',332,98,30,36],['PAK','Pakistan',316,88,18,22],['NPL','Nepal',338,88,14,10],
    ['LKA','Sri Lanka',340,138,8,10],['BGD','Bangladesh',352,98,10,12],
    // Southeast Asia
    ['THA','Thailand',365,118,18,22],['VNM','Vietnam',376,118,12,26],['MYS','Malaysia',372,140,22,14],
    ['IDN','Indonesia',378,152,40,14],['PHL','Philippines',396,124,14,18],
    ['KHM','Cambodia',370,130,12,12],['MMR','Myanmar',356,108,14,18],['SGP','Singapore',382,146,6,6],
    // East Asia
    ['CHN','China',358,76,48,38],['JPN','Japan',406,76,14,22],['KOR','Korea',400,78,12,16],
    ['TWN','Taiwan',404,96,8,10],
    // Oceania
    ['AUS','Australia',396,200,44,34],
  ];
  const vCodes = new Set(visitedCountries);
  const W = 460, H = 260;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="background:var(--surface2);border-radius:10px">`;
  blocks.forEach(([id, label, cx, cy, w, h]) => {
    const fill = vCodes.has(id) ? 'var(--primary)' : 'var(--surface3)';
    const stroke = vCodes.has(id) ? '#ff8c5a' : 'var(--border)';
    const opacity = vCodes.has(id) ? '1' : '0.6';
    svg += `<rect x="${cx}" y="${cy}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="0.8" opacity="${opacity}">`;
    svg += `<title>${label}${vCodes.has(id) ? ' ✓' : ''}</title></rect>`;
    if (w >= 16 && h >= 10) {
      svg += `<text x="${cx + w/2}" y="${cy + h/2 + 3}" text-anchor="middle" font-size="5" fill="${vCodes.has(id) ? '#fff' : 'var(--text2)'}" opacity="0.9">${label}</text>`;
    }
  });
  svg += '</svg>';
  return svg;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 — Feature: 🛂 FOODIE PASSPORT
   ═══════════════════════════════════════════════════════════ */
const _PASSPORT_CUISINES = [
  {e:'🍕',n:'Italian'},{e:'🌮',n:'Mexican'},{e:'🍣',n:'Japanese'},{e:'🥘',n:'Indian'},
  {e:'🥡',n:'Chinese'},{e:'🥐',n:'French'},{e:'🥙',n:'Mediterranean'},{e:'🍔',n:'American'},
  {e:'🧆',n:'Middle Eastern'},{e:'🍜',n:'Thai'},{e:'🍛',n:'Korean'},{e:'🌯',n:'Vietnamese'},
  {e:'🥩',n:'Steakhouse'},{e:'🍤',n:'Seafood'},{e:'🍺',n:'Pub/Bar'},{e:'🥞',n:'Breakfast'},
  {e:'🌶',n:'Ethiopian'},{e:'🥨',n:'German'},{e:'🫕',n:'Spanish'},{e:'🫔',n:'Peruvian'},
  {e:'🧇',n:'Brunch'},{e:'🥟',n:'Dim Sum'},{e:'🍖',n:'BBQ'},{e:'🥬',n:'Vegan'},
  {e:'🍝',n:'Pasta'},{e:'🍟',n:'Fast Food'},{e:'🌸',n:'Hawaiian'},{e:'🧁',n:'Bakery/Cafe'},
  {e:'🥗',n:'Salad/Healthy'},{e:'🥫',n:'Soul Food'},{e:'🇧🇷',n:'Brazilian'},{e:'🥩',n:'Greek'},
  {e:'🫙',n:'Turkish'},{e:'🍲',n:'Moroccan'},{e:'🫕',n:'Lebanese'},{e:'🌿',n:'Sri Lankan'},
  {e:'🍱',n:'Singaporean'},{e:'🥜',n:'Malaysian'},{e:'🥘',n:'Filipino'},{e:'🌾',n:'Nepalese'},
];
function openPassport () {
  document.getElementById('passport-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderPassport();
}
function closePassport () {
  document.getElementById('passport-overlay').classList.add('hidden');
  maybeHideOverlay();
}
function _renderPassport () {
  const visitedCuisines = {};
  state.restaurants.forEach(r => {
    if (r.cuisine) {
      visitedCuisines[r.cuisine] = (visitedCuisines[r.cuisine] || 0) + 1;
    }
  });
  const earnedCount = _PASSPORT_CUISINES.filter(p => visitedCuisines[p.n]).length;
  const totalCuisines = Object.keys(visitedCuisines).length;

  document.getElementById('passport-stats-row').innerHTML =
    `<div class="passport-stat"><div class="passport-stat-num">${earnedCount}</div><div class="passport-stat-label">Stamps earned</div></div>` +
    `<div class="passport-stat"><div class="passport-stat-num">${totalCuisines}</div><div class="passport-stat-label">Cuisines tried</div></div>` +
    `<div class="passport-stat"><div class="passport-stat-num">${state.restaurants.length}</div><div class="passport-stat-label">Restaurants</div></div>`;

  // Show all passport stamps (earned first, then unearned)
  const allStamps = [
    ..._PASSPORT_CUISINES.filter(p => visitedCuisines[p.n]),
    ..._PASSPORT_CUISINES.filter(p => !visitedCuisines[p.n]),
    // Add user cuisines not in the list
    ...Object.keys(visitedCuisines)
      .filter(c => !_PASSPORT_CUISINES.find(p => p.n === c))
      .map(c => ({ e: '🍽', n: c }))
  ];
  document.getElementById('passport-stamps').innerHTML = allStamps.map(p => {
    const count = visitedCuisines[p.n] || 0;
    const earned = count > 0;
    return `<div class="passport-stamp${earned ? ' earned' : ''}">
      <div class="passport-stamp-emoji">${p.e}</div>
      <div class="passport-stamp-name">${escHtml(p.n)}</div>
      ${earned ? `<div class="passport-stamp-count">${count}×</div>` : ''}
    </div>`;
  }).join('');

  document.getElementById('passport-share-btn').onclick = () => {
    const txt = `🛂 My Foodie Passport: ${earnedCount} cuisine stamps, ${totalCuisines} cuisines explored, ${state.restaurants.length} restaurants. #FeedTheBear`;
    if (navigator.share) navigator.share({ title: 'My Foodie Passport', text: txt });
    else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Passport summary copied.', 'success'); }
  };
}

/* ═══════════════════════════════════════════════════════════
   PHASE 14 — 🐻 FEED THE BEAR GAME
   ═══════════════════════════════════════════════════════════ */

const _FTB = {
  canvas: null, ctx: null,
  state: 'idle',   // 'idle' | 'playing' | 'gameover'
  score: 0, lives: 3, level: 1, hiScore: 0,
  frame: 0, raf: null,
  bear: { x: 0, y: 0, w: 68, speed: 6 },
  foods: [],
  popups: [],
  spawnIn: 70,
  keys: { left: false, right: false },
  touchTargetX: null,
  _flashColor: null, _flashTimer: 0,
};

const _FTB_GOOD = [
  '🍕','🍣','🌮','🍔','🍜','🥘','🥐','🍱','🍤',
  '🍝','🍛','🥩','🌯','🍦','🍰','🧁','🍩','🍪',
  '🥞','🍗','🥪','🍙','🥟','🍢','🍡',
];
const _FTB_BONUS  = ['⭐','🌟','💎'];  // +50 pts each
const _FTB_BAD    = ['🪲','🗑️','🤮'];  // dodge! -1 life if caught

function _ftbPts(e) {
  if (_FTB_BONUS.includes(e)) return 50;
  if (_FTB_BAD.includes(e))   return -99;
  return 10;
}

/* ---- open / close ---- */
function openFeedBearGame() {
  const g = _FTB;
  g.hiScore = parseInt(localStorage.getItem('ftb_bear_hi') || '0');
  document.getElementById('feedbear-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _ftbInitCanvas();
  _ftbDrawIdle();
}

function closeFeedBearGame() {
  const g = _FTB;
  if (g.raf) { cancelAnimationFrame(g.raf); g.raf = null; }
  g.state = 'idle';
  g.keys.left = g.keys.right = false;
  g.touchTargetX = null;
  document.getElementById('feedbear-overlay').classList.add('hidden');
  maybeHideOverlay();
}

/* ---- canvas init ---- */
function _ftbInitCanvas() {
  const g = _FTB;
  const el = document.getElementById('feedbear-canvas');
  g.canvas = el;
  g.ctx = el.getContext('2d');
  const maxW = Math.min(340, window.innerWidth - 56);
  el.width  = maxW;
  el.height = Math.round(maxW * 1.4);
  g.bear.x  = el.width / 2;
  g.bear.y  = el.height - 44;
  g.bear.speed = Math.max(5, Math.round(el.width * 0.022));
}

/* ---- start / restart ---- */
function _ftbStart() {
  const g = _FTB;
  if (g.raf) cancelAnimationFrame(g.raf);
  Object.assign(g, {
    state: 'playing', score: 0, lives: 3, level: 1,
    frame: 0, foods: [], popups: [], spawnIn: 70,
    _flashColor: null, _flashTimer: 0,
  });
  g.bear.x = g.canvas.width / 2;
  _ftbLoop();
}

/* ---- main loop ---- */
function _ftbLoop() {
  const g = _FTB;
  if (g.state !== 'playing') return;
  g.frame++;
  const { ctx, canvas } = g;

  /* level & difficulty */
  g.level = 1 + Math.floor(g.score / 60);
  const fallSpd    = Math.min(6, 1.6 + g.level * 0.35);
  const spawnBase  = Math.max(28, 75 - g.level * 7);

  /* move bear — keyboard */
  const bHalf = g.bear.w / 2;
  if (g.keys.left)  g.bear.x = Math.max(bHalf,              g.bear.x - g.bear.speed);
  if (g.keys.right) g.bear.x = Math.min(canvas.width - bHalf, g.bear.x + g.bear.speed);

  /* move bear — touch (smooth lerp) */
  if (g.touchTargetX !== null) {
    const dx = g.touchTargetX - g.bear.x;
    g.bear.x += dx * 0.28;
    if (Math.abs(dx) < 1) g.touchTargetX = null;
  }

  /* spawn food */
  g.spawnIn--;
  if (g.spawnIn <= 0) {
    const isBad = Math.random() < 0.14;
    let emoji;
    if (isBad) {
      emoji = _FTB_BAD[Math.floor(Math.random() * _FTB_BAD.length)];
    } else if (Math.random() < 0.08) {
      emoji = _FTB_BONUS[Math.floor(Math.random() * _FTB_BONUS.length)];
    } else {
      emoji = _FTB_GOOD[Math.floor(Math.random() * _FTB_GOOD.length)];
    }
    const pts  = _ftbPts(emoji);
    const margin = 20;
    g.foods.push({
      e: emoji, pts,
      x: margin + Math.random() * (canvas.width - margin * 2),
      y: -24,
      speed: (fallSpd + Math.random() * 1.2) * (pts < 0 ? 0.85 : 1),
      size: pts < 0 ? 22 : (pts >= 50 ? 30 : 24),
    });
    g.spawnIn = spawnBase + Math.floor(Math.random() * 18) - 9;
  }

  /* update & collide food */
  const catchY   = g.bear.y - 28;
  const catchH   = 30;
  for (let i = g.foods.length - 1; i >= 0; i--) {
    const f = g.foods[i];
    f.y += f.speed;

    /* hit check */
    const inX = Math.abs(f.x - g.bear.x) < bHalf + f.size * 0.4 - 6;
    const inY = f.y >= catchY && f.y <= catchY + catchH;
    if (inX && inY) {
      if (f.pts < 0) {
        g.lives--;
        g._flashColor = 'red'; g._flashTimer = 9;
        g.popups.push({ t: '-💔', x: f.x, y: f.y, a: 1, c: '#ff4444' });
      } else {
        g.score += f.pts;
        const big = f.pts >= 50;
        g._flashColor = big ? 'gold' : null; if (big) g._flashTimer = 7;
        g.popups.push({ t: '+' + f.pts, x: f.x, y: f.y, a: 1, c: big ? '#ffd700' : '#4ade80' });
      }
      g.foods.splice(i, 1);
      continue;
    }

    /* missed */
    if (f.y > canvas.height + 12) {
      if (f.pts > 0) {
        g.lives--;
        g._flashColor = 'red'; g._flashTimer = 9;
        g.popups.push({ t: 'Miss!', x: f.x, y: canvas.height - 20, a: 1, c: '#ff8888' });
      }
      g.foods.splice(i, 1);
    }
  }

  /* game over */
  if (g.lives <= 0) {
    g.lives = 0;
    g.state = 'gameover';
    if (g.score > g.hiScore) {
      g.hiScore = g.score;
      localStorage.setItem('ftb_bear_hi', g.hiScore);
    }
    _ftbDrawGameOver();
    return;
  }

  /* draw frame */
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  _ftbBg();
  _ftbHUD();
  _ftbDrawItems();
  _ftbDrawPopups();
  _ftbDrawBear();

  g.raf = requestAnimationFrame(_ftbLoop);
}

/* ---- draw helpers ---- */
function _ftbBg() {
  const { ctx, canvas, _flashColor, _flashTimer } = _FTB;
  const gr = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gr.addColorStop(0, '#0f1923');
  gr.addColorStop(1, '#1a1f2e');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (_flashTimer > 0) {
    ctx.fillStyle = _flashColor === 'red' ? 'rgba(255,60,60,0.18)' : 'rgba(255,215,0,0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    _FTB._flashTimer--;
  }

  /* ground line */
  ctx.strokeStyle = 'rgba(255,107,53,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(0, canvas.height - 6);
  ctx.lineTo(canvas.width, canvas.height - 6);
  ctx.stroke();
  ctx.setLineDash([]);
}

function _ftbHUD() {
  const g = _FTB;
  const { ctx, canvas } = g;
  const fs = Math.max(13, Math.round(canvas.width * 0.046));

  ctx.textAlign = 'left';
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.fillStyle = '#ff6b35';
  ctx.fillText('Score: ' + g.score, 10, fs + 4);
  ctx.font = `${Math.round(fs * 0.78)}px sans-serif`;
  ctx.fillStyle = '#666';
  ctx.fillText('Best: ' + g.hiScore, 10, fs * 2 + 2);

  /* hearts */
  const hfs = Math.round(fs * 1.05);
  ctx.font = `${hfs}px serif`;
  ctx.textAlign = 'right';
  ctx.fillText('❤️'.repeat(Math.max(0, g.lives)), canvas.width - 8, fs + 4);

  /* level */
  ctx.font = `${Math.round(fs * 0.78)}px sans-serif`;
  ctx.fillStyle = '#666';
  ctx.fillText('Lv ' + g.level, canvas.width - 8, fs * 2 + 2);
}

function _ftbDrawItems() {
  const { ctx, foods } = _FTB;
  foods.forEach(f => {
    ctx.font = `${f.size}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(f.e, f.x, f.y);
  });
}

function _ftbDrawPopups() {
  const { ctx, popups } = _FTB;
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.y -= 1.4;
    p.a -= 0.028;
    if (p.a <= 0) { popups.splice(i, 1); continue; }
    ctx.globalAlpha = p.a;
    ctx.font = `bold 15px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = p.c;
    ctx.fillText(p.t, p.x, p.y);
    ctx.globalAlpha = 1;
  }
}

function _ftbDrawBear() {
  const { ctx, canvas, bear } = _FTB;
  const sz = Math.round(canvas.width * 0.17);
  ctx.font = `${sz}px serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🐻', bear.x, bear.y);
}

function _ftbDrawIdle() {
  const g = _FTB;
  const { ctx, canvas } = g;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  _ftbBg();

  const W = canvas.width, H = canvas.height;
  const bearSz = Math.round(W * 0.22);
  ctx.font = `${bearSz}px serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🐻', W / 2, H * 0.52);

  ctx.font = `bold ${Math.round(W * 0.088)}px sans-serif`;
  ctx.fillStyle = '#ff6b35';
  ctx.fillText('FEED THE BEAR!', W / 2, H * 0.22);

  ctx.font = `${Math.round(W * 0.052)}px sans-serif`;
  ctx.fillStyle = '#aaa';
  ctx.fillText('Catch food · Dodge pests', W / 2, H * 0.31);

  if (g.hiScore > 0) {
    ctx.font = `${Math.round(W * 0.048)}px sans-serif`;
    ctx.fillStyle = '#ffd700';
    ctx.fillText('🏆 Best: ' + g.hiScore, W / 2, H * 0.38);
  }

  /* food preview strip */
  const previews = ['🍕','🍣','🌮','🍔','🍜','🥐','⭐'];
  const gap = W / (previews.length + 1);
  ctx.font = '20px serif';
  previews.forEach((e, i) => ctx.fillText(e, gap * (i + 1), H * 0.65));

  ctx.font = `bold ${Math.round(W * 0.062)}px sans-serif`;
  ctx.fillStyle = '#ff6b35';
  ctx.fillText('Tap to Start!', W / 2, H * 0.78);
}

function _ftbDrawGameOver() {
  const g = _FTB;
  const { ctx, canvas } = g;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  _ftbBg();
  _ftbDrawItems();
  _ftbDrawBear();

  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(W * 0.095)}px sans-serif`;
  ctx.fillStyle = '#ff4444';
  ctx.fillText('GAME OVER', W / 2, H * 0.27);

  ctx.font = `bold ${Math.round(W * 0.07)}px sans-serif`;
  ctx.fillStyle = '#ff6b35';
  ctx.fillText('Score: ' + g.score, W / 2, H * 0.4);

  const isHi = g.score > 0 && g.score >= g.hiScore;
  if (isHi) {
    ctx.font = `bold ${Math.round(W * 0.056)}px sans-serif`;
    ctx.fillStyle = '#ffd700';
    ctx.fillText('🏆 NEW HIGH SCORE!', W / 2, H * 0.5);
  } else if (g.hiScore > 0) {
    ctx.font = `${Math.round(W * 0.05)}px sans-serif`;
    ctx.fillStyle = '#888';
    ctx.fillText('Best: ' + g.hiScore, W / 2, H * 0.5);
  }

  ctx.font = `bold ${Math.round(W * 0.062)}px sans-serif`;
  ctx.fillStyle = '#ff6b35';
  ctx.fillText('Tap to Play Again', W / 2, H * 0.64);

  ctx.font = `${Math.round(W * 0.044)}px sans-serif`;
  ctx.fillStyle = '#555';
  ctx.fillText('Lv ' + g.level + ' reached', W / 2, H * 0.71);
}


/* ---- keyboard handler ---- */
function _ftbHandleKey(e) {
  const g = _FTB;
  if (g.state !== 'playing') return;
  const dn = e.type === 'keydown';
  if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') { g.keys.left  = dn; e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { g.keys.right = dn; e.preventDefault(); }
}

/* ---- canvas tap (start / restart) ---- */
function _ftbHandleCanvasTap(e) {
  const g = _FTB;
  if (g.state === 'idle' || g.state === 'gameover') {
    g.keys.left = g.keys.right = false;
    g.touchTargetX = null;
    _ftbStart();
    return;
  }
  /* during play: click left/right half to move */
  if (g.state === 'playing') {
    const rect = g.canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (g.canvas.width / rect.width);
    g.touchTargetX = cx;
  }
}

/* ---- touch handler ---- */
function _ftbHandleTouch(e) {
  const g = _FTB;
  e.preventDefault();
  const t = e.touches[0];
  if (!t) return;
  if (g.state === 'idle' || g.state === 'gameover') {
    g.keys.left = g.keys.right = false;
    g.touchTargetX = null;
    _ftbStart();
    return;
  }
  if (g.state === 'playing') {
    const rect = g.canvas.getBoundingClientRect();
    const cx = (t.clientX - rect.left) * (g.canvas.width / rect.width);
    g.touchTargetX = Math.max(g.bear.w / 2, Math.min(g.canvas.width - g.bear.w / 2, cx));
  }
}

