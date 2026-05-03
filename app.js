/* ════════════════════════════════════════════════════════════
   Feed The Bear — App Logic
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ── Constants ───────────────────────────────────────────── */
const STORAGE_KEY   = 'ftb_restaurants_v2';
const SETTINGS_KEY  = 'ftb_settings_v1';
const ALERT_RADIUS  = 500;   // metres — show proximity alert
const NOTIFY_RADIUS = 800;   // metres — browser notification
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
    state.restaurants = raw ? JSON.parse(raw) : seedData();
    if (!raw) saveData();
  } catch { state.restaurants = seedData(); saveData(); }

  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    state.settings = s ? JSON.parse(s) : {};
  } catch { state.settings = {}; }
}

function saveData () {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.restaurants));
  updateTagSuggestions();
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
  return [
    {
      id: uid(), name: "The Golden Spoon", cuisine: "Italian",
      address: "123 W 51st St, New York, NY 10019",
      lat: 40.7615, lng: -73.9833,
      website: "https://thegoldenspoon.example.com",
      status: "want-to-try", myRating: 0,
      googleRating: 4.6, googleReviews: 1842,
      notes: "Heard the truffle pasta is unreal 🤤 Need to book ahead — super popular on weekends!",
      photo: "", priceRange: 3, tags: ['date night', 'italian'],
      dateAdded: iso(-10), dateVisited: null, visits: []
    },
    {
      id: uid(), name: "Sakura Garden", cuisine: "Japanese",
      address: "45 E Village Blvd, New York, NY 10003",
      lat: 40.7265, lng: -73.9867,
      website: "https://sakuragarden.example.com",
      status: "visited", myRating: 5,
      googleRating: 4.8, googleReviews: 3102,
      notes: "Omakase was 🔥 The chef's special toro melt in your mouth. Pricey but worth every penny!",
      photo: "", priceRange: 4, tags: ['special occasion', 'sushi'],
      dateAdded: iso(-30), dateVisited: iso(-5), visits: [{date: iso(-5), note:'Omakase dinner', rating:5}]
    },
    {
      id: uid(), name: "El Rancho Taqueria", cuisine: "Mexican",
      address: "880 Fulton Ave, Houston, TX 77009",
      lat: 29.7800, lng: -95.3700,
      website: "", status: "visited", myRating: 4,
      googleRating: 4.3, googleReviews: 567,
      notes: "Street tacos are legit. Get the birria — dipping broth is incredible.",
      photo: "", priceRange: 1, tags: ['budget', 'casual'],
      dateAdded: iso(-45), dateVisited: iso(-14), visits: [{date: iso(-14), note:'Birria tacos', rating:4}]
    },
    {
      id: uid(), name: "Smoke & Ember BBQ", cuisine: "BBQ",
      address: "2200 Peachtree Rd, Atlanta, GA 30309",
      lat: 33.8023, lng: -84.3894,
      website: "https://smokeember.example.com",
      status: "want-to-try", myRating: 0,
      googleRating: 4.7, googleReviews: 2314,
      notes: "Pitmaster won last year's regional comp. Brisket allegedly the best in the South.",
      photo: "", priceRange: 2, tags: ['bbq', 'worth the drive'],
      dateAdded: iso(-7), dateVisited: null, visits: []
    },
    {
      id: uid(), name: "Café Lumière", cuisine: "French",
      address: "18 Rue Lafayette, Chicago, IL 60601",
      lat: 41.8845, lng: -87.6241,
      website: "https://cafelumiere.example.com",
      status: "visited", myRating: 4,
      googleRating: 4.5, googleReviews: 798,
      notes: "Croissants are flaky perfection. Grab a table by the window for Sunday brunch.",
      photo: "", priceRange: 3, tags: ['brunch', 'date night'],
      dateAdded: iso(-60), dateVisited: iso(-20), visits: [{date: iso(-20), note:'Sunday brunch', rating:4}]
    },
    {
      id: uid(), name: "Spice Route", cuisine: "Indian",
      address: "512 Devon Ave, Chicago, IL 60659",
      lat: 41.9989, lng: -87.7066,
      website: "",
      status: "want-to-try", myRating: 0,
      googleRating: 4.4, googleReviews: 441,
      notes: "Biryani is the star. Friday specials are half price!",
      photo: "", priceRange: 2, tags: ['budget', 'spicy'],
      dateAdded: iso(-3), dateVisited: null, visits: []
    },
  ];
}

function uid () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
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
      updateLocationBtn();
      hideBanner('location-banner');
      renderCards();
      showToast('📍 Location On', 'You\'ll get alerts when near restaurants on your list!', 'success');
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      startWatching();
    },
    err => {
      showToast('Location Error', err.message || 'Unable to get location.', 'error');
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
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

function fmtDist (m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m/1609.344).toFixed(1)} mi`;
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
  const [c1, c2] = cuisineGrad(r.cuisine);
  const photoHtml = r.photo
    ? `<img src="${escHtml(r.photo)}" alt="${escHtml(r.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
    : '';
  const bgStyle = `background: linear-gradient(135deg, ${c1}, ${c2});`;

  // Collection badge
  const col = (state.settings.collections||[]).find(c => c.id === r.collectionId);
  const collBadge = col
    ? `<span class="collection-badge" style="background:${col.color}22;color:${col.color};border-color:${col.color}44"><span class="collection-dot" style="background:${col.color}"></span>${escHtml(col.name)}</span>`
    : '';

  card.innerHTML = `
    <div class="card-checkbox${state.selectedIds.has(r.id) ? ' checked' : ''}" title="Select"></div>
    <div class="card-photo">
      ${photoHtml}
      <div class="card-photo-bg" style="${bgStyle}${r.photo ? 'display:none;' : ''}">${cuisineEmoji(r.cuisine)}</div>
      <div class="card-img-overlay"></div>
      <span class="card-status-badge ${r.status === 'want-to-try' ? 'want' : 'visited'}">
        ${r.status === 'want-to-try' ? '🔖 Want to Try' : '✅ Visited'}
      </span>
      ${r.priceRange ? `<span class="card-price-badge">${priceDollars(r.priceRange)}</span>` : ''}
      ${distStr ? `<span class="card-distance-badge">📍 ${distStr}</span>` : ''}
    </div>
    <div class="card-body">
      ${r.cuisine ? `<div class="card-cuisine">${cuisineEmoji(r.cuisine)} ${escHtml(r.cuisine)}</div>` : ''}
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

  card.innerHTML = `
    <div class="card-photo">
      ${photoHtml}
      <div class="card-photo-bg" style="${bgStyle}${r.photo ? 'display:none;' : ''}">${cuisineEmoji(r.cuisine)}</div>
      <div class="card-img-overlay"></div>
      <span class="card-status-badge ${r.status === 'want-to-try' ? 'want' : 'visited'}">
        ${r.status === 'want-to-try' ? '🔖 Want to Try' : '✅ Visited'}
      </span>
      ${r.priceRange ? `<span class="card-price-badge">${priceDollars(r.priceRange)}</span>` : ''}
      ${distStr ? `<span class="card-distance-badge">📍 ${distStr}</span>` : ''}
    </div>
    <div class="card-body">
      ${r.cuisine ? `<div class="card-cuisine">${cuisineEmoji(r.cuisine)} ${escHtml(r.cuisine)}</div>` : ''}
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

  // Event delegation on the card
  card.addEventListener('click', e => {
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
   CHAT BUDDY — FOODIE BEAR
   ════════════════════════════════════════════════════════════ */
const GREETINGS = [
  'Hey foodie! 🐻 I\'m Foodie Bear, your personal restaurant strategist. What should we plan first?',
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

  if (!nearby.length) return `No saved restaurants within 5km of your current location. Try adding some nearby spots! 🗺️`;
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
  { icon: '🐻', title: 'Let Foodie Bear Curate', desc: 'Ask for smart recommendations, random picks, tag-based suggestions, and ready-to-share cards.' },
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
  if (!state.locationEnabled || state.userLat == null) {
    showToast('Location needed', 'Enable location tracking first.', 'error'); return;
  }
  const overlay = document.getElementById('nearby-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  document.getElementById('nearby-results').innerHTML = '<div class="nearby-loading">🐻 Sniffing out restaurants near you…</div>';
  try {
    const { userLat: lat, userLng: lng } = state;
    const query = `[out:json][timeout:15];(node["amenity"="restaurant"](around:1000,${lat},${lng});way["amenity"="restaurant"](around:1000,${lat},${lng}););out center 20;`;
    const res  = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body:query });
    const data = await res.json();
    const els  = (data.elements || []).slice(0, 20);
    if (!els.length) { document.getElementById('nearby-results').innerHTML = '<div class="nearby-empty">No restaurants found within 1 km. Try a different area!</div>'; return; }
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
      document.getElementById('nearby-overlay').classList.add('hidden');
      document.getElementById('collections-panel').classList.remove('open');
      maybeHideOverlay();
    }
  });
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
  initCollections();
  updateTagSuggestions();
  renderAll();
  showOnboarding();
});
