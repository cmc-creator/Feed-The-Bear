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
  filter: { search:'', cuisine:'', price:'', sort:'date-desc' },
  settings: {},
  editingId: null,
  formRating: 0,
  detailId: null,
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
      photo: "", priceRange: 3,
      dateAdded: iso(-10), dateVisited: null
    },
    {
      id: uid(), name: "Sakura Garden", cuisine: "Japanese",
      address: "45 E Village Blvd, New York, NY 10003",
      lat: 40.7265, lng: -73.9867,
      website: "https://sakuragarden.example.com",
      status: "visited", myRating: 5,
      googleRating: 4.8, googleReviews: 3102,
      notes: "Omakase was 🔥 The chef's special toro melt in your mouth. Pricey but worth every penny!",
      photo: "", priceRange: 4,
      dateAdded: iso(-30), dateVisited: iso(-5)
    },
    {
      id: uid(), name: "El Rancho Taqueria", cuisine: "Mexican",
      address: "880 Fulton Ave, Houston, TX 77009",
      lat: 29.7800, lng: -95.3700,
      website: "", status: "visited", myRating: 4,
      googleRating: 4.3, googleReviews: 567,
      notes: "Street tacos are legit. Get the birria — dipping broth is incredible.",
      photo: "", priceRange: 1,
      dateAdded: iso(-45), dateVisited: iso(-14)
    },
    {
      id: uid(), name: "Smoke & Ember BBQ", cuisine: "BBQ",
      address: "2200 Peachtree Rd, Atlanta, GA 30309",
      lat: 33.8023, lng: -84.3894,
      website: "https://smokeember.example.com",
      status: "want-to-try", myRating: 0,
      googleRating: 4.7, googleReviews: 2314,
      notes: "Pitmaster won last year's regional comp. Brisket allegedly the best in the South.",
      photo: "", priceRange: 2,
      dateAdded: iso(-7), dateVisited: null
    },
    {
      id: uid(), name: "Café Lumière", cuisine: "French",
      address: "18 Rue Lafayette, Chicago, IL 60601",
      lat: 41.8845, lng: -87.6241,
      website: "https://cafelumiere.example.com",
      status: "visited", myRating: 4,
      googleRating: 4.5, googleReviews: 798,
      notes: "Croissants are flaky perfection. Grab a table by the window for Sunday brunch.",
      photo: "", priceRange: 3,
      dateAdded: iso(-60), dateVisited: iso(-20)
    },
    {
      id: uid(), name: "Spice Route", cuisine: "Indian",
      address: "512 Devon Ave, Chicago, IL 60659",
      lat: 41.9989, lng: -87.7066,
      website: "",
      status: "want-to-try", myRating: 0,
      googleRating: 4.4, googleReviews: 441,
      notes: "Biryani is the star. Friday specials are half price!",
      photo: "", priceRange: 2,
      dateAdded: iso(-3), dateVisited: null
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

  list.forEach(r => grid.appendChild(buildCard(r)));
}

function buildCard (r) {
  const card = document.createElement('article');
  card.className = 'restaurant-card';
  card.dataset.id = r.id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `View details for ${r.name}`);

  const dist = distOf(r);
  const distStr = dist < Infinity ? fmtDist(dist) : '';
  const [c1, c2] = cuisineGrad(r.cuisine);
  const photoHtml = r.photo
    ? `<img src="${escHtml(r.photo)}" alt="${escHtml(r.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
    : '';
  const bgStyle = `background: linear-gradient(135deg, ${c1}, ${c2});`;

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
    if (action === 'directions') { e.stopPropagation(); openDirections(r); return; }
    if (action === 'website')    { e.stopPropagation(); openWebsite(r);    return; }
    if (action === 'edit')       { e.stopPropagation(); openEditModal(r.id); return; }
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

  document.getElementById('detail-directions-btn').onclick = () => openDirections(r);
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
  // status radio
  document.querySelectorAll('input[name="form-status"]').forEach(radio => {
    radio.checked = radio.value === r.status;
  });
  setFormStars(r.myRating || 0);

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  document.getElementById('form-name').focus();
}

function closeModal () {
  document.getElementById('modal-overlay').classList.add('hidden');
  maybeHideOverlay();
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
    status,
    dateAdded:     isNew ? now : (state.restaurants.find(r => r.id === state.editingId)?.dateAdded || now),
    dateVisited:   status === 'visited'
      ? (state.restaurants.find(r => r.id === state.editingId)?.dateVisited || now)
      : null,
  };

  if (state.editingId) {
    // Preserve lat/lng from original
    const orig = state.restaurants.find(r => r.id === state.editingId);
    entry.lat = orig?.lat || null;
    entry.lng = orig?.lng || null;
    state.restaurants = state.restaurants.map(r => r.id === state.editingId ? entry : r);
    showToast('Updated! ✏️', `"${name}" has been updated.`, 'success');
  } else {
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

/* ── Full render ──────────────────────────────────────────── */
function renderAll () {
  renderStats();
  renderCuisineFilter();
  renderCards();
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
  'Hey foodie! 🐻 I\'m Foodie Bear — your personal restaurant guide. Ask me anything!',
  'Hey there, hungry adventurer! 🐻 What are we hunting for today?',
  'Roar! 🐻 Ready to help you find the perfect bite. What\'s on your mind?',
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
  (q) => q.match(/\b(help|how|what can)\b/i) && `Here's what I can do:\n\n• **Find** restaurants from your list by cuisine, rating, or status\n• **Recommend** top-rated spots you haven't visited yet\n• **Nearby** — show what's close to you\n• **Tips** — share foodie advice\n\nJust ask! 🐻`,
  (q) => q.match(/\b(nearby|close|near me|around me|area)\b/i) && nearbyResponse(),
  (q) => q.match(/\b(recommend|suggest|best|top|favorite|favourite)\b/i) && recommendResponse(),
  (q) => q.match(/\b(want.?to.?try|bucket|list|haven.?t visited|unvisited)\b/i) && wantToTryResponse(),
  (q) => q.match(/\b(visited|been|went|tried|already)\b/i) && visitedResponse(),
  (q) => q.match(/\b(tip|advice|hack|secret|trick|pro tip)\b/i) && randomFrom(FOOD_TIPS),
  (q) => q.match(/\b(note|notes|reminder|remember)\b/i) && notesResponse(),
  (q) => q.match(/\b(direction|navigate|how to get|get there)\b/i) && `To get directions, just click the **Directions** button on any restaurant card — it'll open Google Maps and route you right to the door! 🗺️`,
  (q) => q.match(/\b(rate|rating|star|review)\b/i) && `You can rate any restaurant from 1–5 stars when you add or edit it. I also show the **Google rating** and review count so you know what others think! ⭐`,
  (q) => q.match(/\b(add|new restaurant|save)\b/i) && `Click **＋ Add Restaurant** in the header to add a new spot. Fill in the name, cuisine, address, and any notes — I'll even geocode the address so you get proximity alerts! 📍`,
  (q) => q.match(/\b(notification|alert|remind|ping)\b/i) && `Enable location tracking (the 📍 button in the header) and I'll alert you whenever you're within walking distance of a restaurant on your list! 🔔`,
  (q) => q.match(/\b(cheap|budget|affordable|\$[^$])/i) && budgetResponse(),
  (q) => q.match(/\b(expensive|fancy|upscale|fine dining|\$\$\$\$)/i) && fancyResponse(),
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
    `Hmm, let me think… 🐻 Try asking "recommend something", "what's nearby", or name a cuisine like "Italian" or "Sushi"!`,
    `Not sure about that one! But I know your restaurant list pretty well. Try asking "best rated" or "want to try" 🍽️`,
    `Great question! I'm still learning… but try asking me about cuisines, ratings, or nearby restaurants! 🐻`,
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
    (r.notes ? `\n📝 "${r.notes}"` : '') +
    `\n\n<span class="chip-link" data-id="${r.id}">View full details</span>`;
}

const QUICK_REPLIES = [
  'Recommend something 🌟',
  'What\'s nearby? 📍',
  'Want to try list 🔖',
  'Food tip! 💡',
  'Best rated ⭐',
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
  return !!(state.filter.search || state.filter.cuisine || state.filter.price);
}

/* ════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ════════════════════════════════════════════════════════════ */
function setupEvents () {
  // Nav buttons
  document.getElementById('main-nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentView = btn.dataset.view;
    renderCards();
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

  // Keyboard: Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      closeDetailModal();
      closeChat();
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
  document.getElementById('search-input').value = '';
  document.getElementById('filter-cuisine').value = '';
  document.getElementById('filter-price').value = '';
  updateClearBtn();
  renderCards();
}

/* ════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setupEvents();
  renderAll();
});
