/* ════════════════════════════════════════════════════════════
   Feed The Bear - App Logic
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ── Defensive AI stub - if ai.js failed to load (old SW cache,
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
const SWIPE_PREFS_KEY = 'ftb_swipe_prefs_v1';
const PRODUCT_EVENTS_KEY = 'ftb_product_events_v1';
const USER_KEY      = 'ftb_user_v1';
const DAILY_QUEST_KEY = 'ftb_daily_quest_v1';
const LOCATION_BANNER_DISMISSED_KEY = 'ftb_location_banner_dismissed_v1';
const LOCATION_BANNER_SNOOZE_UNTIL_KEY = 'ftb_location_banner_snooze_until_v1';
const LOCATION_BANNER_SNOOZE_MS = 12 * 60 * 60 * 1000;
const ALERT_RADIUS  = 805;   // ~0.5 miles - show proximity alert
const NOTIFY_RADIUS = 1609;  // ~1 mile - browser notification
const NOTIFY_COOLDOWN = 10 * 60 * 1000; // 10 min between alerts for same place

/* ── Cuisine badge map ───────────────────────────────────── */
const CUISINE_EMOJI = {
  american:'AM',bbq:'BBQ',breakfast:'BRK',brunch:'BR',burgers:'BRG',cafe:'CAF',
  chinese:'CHN',desserts:'DES',french:'FR',greek:'GR',indian:'IND',italian:'IT',
  japanese:'JP',korean:'KR',mediterranean:'MED',mexican:'MX',pizza:'PIZ',
  seafood:'SEA',steakhouse:'STK',sushi:'SUS',thai:'TH',vegan:'VGN',
  vietnamese:'VN',default:''
};
const cuisineEmoji = c => CUISINE_EMOJI[(c||'').toLowerCase()] || CUISINE_EMOJI.default;

const CUISINE_FAVORITE_DISHES = {
  mexican: ['Birria Tacos', 'Carne Asada Fries', 'Street Corn'],
  italian: ['Spicy Vodka Rigatoni', 'Margherita Pizza', 'Tiramisu'],
  japanese: ['Tonkotsu Ramen', 'Karaage', 'Salmon Nigiri'],
  sushi: ['Spicy Tuna Roll', 'Dragon Roll', 'Miso Soup'],
  chinese: ['Soup Dumplings', 'Kung Pao Chicken', 'Scallion Pancake'],
  indian: ['Butter Chicken', 'Garlic Naan', 'Paneer Tikka'],
  thai: ['Pad Thai', 'Drunken Noodles', 'Mango Sticky Rice'],
  bbq: ['Brisket Plate', 'Ribs', 'Burnt Ends'],
  burgers: ['Double Smashburger', 'Truffle Fries', 'Milkshake'],
  american: ['Chicken Sandwich', 'Loaded Fries', 'Mac and Cheese'],
  mediterranean: ['Chicken Shawarma', 'Falafel Plate', 'Hummus Trio'],
  greek: ['Gyro Plate', 'Greek Salad', 'Baklava'],
  vietnamese: ['Pho', 'Banh Mi', 'Spring Rolls'],
  korean: ['Korean Fried Chicken', 'Bibimbap', 'Kimchi Pancake'],
  cafe: ['Iced Latte', 'Avocado Toast', 'Blueberry Muffin'],
  breakfast: ['Eggs Benedict', 'French Toast', 'Breakfast Burrito'],
  brunch: ['Chicken and Waffles', 'Mimosa Flight', 'Brioche Toast'],
  seafood: ['Fish Tacos', 'Salmon Bowl', 'Garlic Shrimp'],
  steakhouse: ['Ribeye', 'Creamed Spinach', 'Truffle Mash'],
  desserts: ['Cheesecake', 'Molten Cake', 'Churros'],
  vegan: ['Cauliflower Wings', 'Falafel Wrap', 'Coconut Curry'],
  bar: ['Wings', 'Loaded Nachos', 'Craft Burger'],
  pub: ['Fish and Chips', 'Shepherds Pie', 'Beer Battered Onion Rings'],
  fast_food: ['Signature Combo', 'Crispy Fries', 'House Sauce'],
  restaurant: ['Chef Special', 'House Favorite', 'Signature Dessert'],
  default: ['House Favorite', 'Chef Special', 'Popular Plate'],
};

function formatCuisineLabel (raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')
    .join(' ');
}

function cuisineKey (raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function estimatePriceLevel ({ tags = {}, cuisine = '', amenity = 'restaurant', savedRestaurant = null } = {}) {
  const savedPrice = Number(savedRestaurant?.priceRange || 0);
  if (savedPrice >= 1 && savedPrice <= 4) return savedPrice;

  const key = cuisineKey(cuisine || amenity || 'restaurant');
  const byCuisine = {
    cafe: 1,
    breakfast: 1,
    brunch: 2,
    fast_food: 1,
    pub: 2,
    bar: 2,
    mexican: 2,
    chinese: 2,
    thai: 2,
    vietnamese: 2,
    korean: 2,
    indian: 2,
    italian: 3,
    mediterranean: 3,
    seafood: 3,
    japanese: 3,
    sushi: 3,
    steakhouse: 4,
    french: 4,
  };
  return byCuisine[key] || 2;
}

function nearbyPopularityLabel (distMeters, savedRestaurant = null) {
  const rating = Number(savedRestaurant?.myRating || savedRestaurant?.googleRating || 0);
  if (rating >= 4.6) return 'Very Popular';
  if (rating >= 4.2) return 'Trending';
  if (Number.isFinite(distMeters) && distMeters <= 500) return 'Hot Nearby';
  if (Number.isFinite(distMeters) && distMeters <= 1200) return 'Buzzing';
  if (Number.isFinite(distMeters) && distMeters <= 2200) return 'Local Favorite';
  return 'Neighborhood Pick';
}

function favoriteDishesForSaved (restaurant) {
  const rows = Array.isArray(restaurant?.dishes) ? restaurant.dishes : [];
  const normalized = rows
    .map(d => ({
      name: String(d?.name || d?.dish || '').trim(),
      score: Number(d?.rating || d?.stars || d?.score || 0),
    }))
    .filter(d => d.name)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(d => d.name);
  if (normalized.length) return normalized;
  return null;
}

function favoriteDishesForNearby (cuisine = '', amenity = 'restaurant') {
  const key = cuisineKey(cuisine || amenity || 'restaurant');
  const list = CUISINE_FAVORITE_DISHES[key] || CUISINE_FAVORITE_DISHES.default;
  return list.slice(0, 2);
}

function renderNearbyVisualCard ({
  name = 'Unknown',
  cuisine = '',
  amenity = 'restaurant',
  photoUrl = '',
  distMeters = Infinity,
  priceLevel = 0,
  popularity = '',
  isSaved = false,
  restaurantId = '',
  website = '',
  address = '',
  lat = null,
  lon = null,
  key = '',
  savedRestaurant = null,
} = {}) {
  const cuisineLabel = formatCuisineLabel(cuisine || amenity || 'Restaurant');
  const distText = Number.isFinite(distMeters) ? fmtDist(distMeters) : 'Distance unknown';
  const effectivePrice = Number(priceLevel) || estimatePriceLevel({ cuisine, amenity, savedRestaurant });
  const effectivePopularity = popularity || nearbyPopularityLabel(distMeters, savedRestaurant);
  const dishes = favoriteDishesForSaved(savedRestaurant) || favoriteDishesForNearby(cuisine, amenity);
  const dishesLabel = dishes.length ? dishes.join(' • ') : 'House favorites';
  const fallbackTerm = `${name || ''} ${cuisineLabel || amenity || 'food'}`.trim();
  const localFallbackPhoto = safeUrl(getMoodFoodImageCandidates(fallbackTerm, key || name || 'nearby')[0] || '');
  const photo = safeUrl(photoUrl) || localFallbackPhoto;
  const safeName = escHtml(name);
  const safeNameForClick = String(name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeCuisine = String(cuisine || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const websiteUrl = safeUrl(savedRestaurant?.website || website || '');
  const safeAddressForClick = String(savedRestaurant?.address || address || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeWebsiteForClick = String(savedRestaurant?.website || websiteUrl || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const prefillLat = Number.isFinite(savedRestaurant?.lat) ? Number(savedRestaurant.lat) : (Number.isFinite(lat) ? Number(lat) : null);
  const prefillLon = Number.isFinite(savedRestaurant?.lng) ? Number(savedRestaurant.lng) : (Number.isFinite(lon) ? Number(lon) : null);
  const directionsUrl = buildGoogleDirectionsUrl({
    name,
    address: savedRestaurant?.address || address || '',
    lat: Number.isFinite(savedRestaurant?.lat) ? Number(savedRestaurant.lat) : (Number.isFinite(lat) ? Number(lat) : null),
    lng: Number.isFinite(savedRestaurant?.lng) ? Number(savedRestaurant.lng) : (Number.isFinite(lon) ? Number(lon) : null),
  });
  const menuUrl = buildMenuSearchUrl({
    name,
    address: savedRestaurant?.address || address || '',
  });
  const popularityScore = Math.max(30, Math.min(98,
    Math.round((effectivePopularity === 'Very Popular' ? 92
      : effectivePopularity === 'Trending' ? 84
        : effectivePopularity === 'Hot Nearby' ? 78
          : effectivePopularity === 'Buzzing' ? 70
            : effectivePopularity === 'Local Favorite' ? 62
              : 54))));

  return `<article class="nearby-home-card${isSaved ? ' saved' : ''}" data-nearby-key="${escHtml(key || `${name}-${distText}`)}" data-nearby-price="${effectivePrice}" data-nearby-popularity="${escHtml(effectivePopularity)}">
    <div class="nearby-home-card-media">
      <img class="nearby-home-card-photo" src="${photo}" alt="${escHtml(cuisineLabel)} food" loading="lazy" />
      <div class="nearby-home-card-badges">
        <span class="nearby-home-card-badge price">${'$'.repeat(Math.max(1, Math.min(4, effectivePrice)))}</span>
        <span class="nearby-home-card-badge pop">${escHtml(effectivePopularity)}</span>
      </div>
    </div>
    <div class="nearby-home-card-body">
      <div class="nearby-home-card-name" title="${safeName}">${safeName}</div>
      <div class="nearby-home-card-meta">${escHtml(cuisineLabel)} • ${distText}</div>
      <div class="nearby-home-card-pop-meter"><span style="width:${popularityScore}%"></span></div>
      <div class="nearby-home-card-dishes">Favorite dishes: ${escHtml(dishesLabel)}</div>
    </div>
    <div class="nearby-home-card-footer">
      ${isSaved
        ? `<button class="btn-sm btn-secondary nearby-home-card-add" onclick="openDetailModal('${restaurantId}')">View</button>`
        : `<button class="btn-sm btn-orange nearby-home-card-add" onclick="openAddModalPreFilled('${safeNameForClick}','${safeCuisine}',{name:'${safeNameForClick}',address:'${safeAddressForClick}',website:'${safeWebsiteForClick}',lat:${prefillLat == null ? 'null' : prefillLat},lon:${prefillLon == null ? 'null' : prefillLon}})">+ Save</button>`}
      ${(menuUrl || websiteUrl || directionsUrl)
        ? `<div class="nearby-home-card-links">${menuUrl ? `<a class="btn-sm btn-ghost nearby-home-card-link" href="${escHtml(menuUrl)}" target="_blank" rel="noopener">Menu</a>` : ''}${websiteUrl ? `<a class="btn-sm btn-ghost nearby-home-card-link" href="${escHtml(websiteUrl)}" target="_blank" rel="noopener">Website</a>` : ''}${directionsUrl ? `<a class="btn-sm btn-secondary nearby-home-card-link" href="${escHtml(directionsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}</div>`
        : ''}
    </div>
  </article>`;
}

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
  default:   ['#E8B15A','#C0392B']
};
const cuisineGrad = c => CUISINE_GRAD[(c||'').toLowerCase()] || CUISINE_GRAD.default;

/* ── Cuisine → Unsplash photo map ────────────────────────── */
// Curated Unsplash photo IDs - free, no API key needed
const CUISINE_PHOTOS = {
  italian:       'photo-1555396273-367ea4eb4db5',
  pizza:         'photo-1513104890138-7c749659a591',
  japanese:      'photo-1579871494447-9811cf80d66c',
  ramen:         'photo-1617093727343-374698b1b08d',
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

const MOOD_TERM_ALIASES = {
  'fried chicken': 'chicken',
  'chicken': 'chicken',
  'dumplings': 'dumplings',
  'pho': 'pho',
  'curry': 'indian',
  'brunch': 'brunch',
  'dessert': 'desserts',
  'sweets': 'desserts',
  'steak': 'steakhouse',
  'sandwich': 'sandwich',
  'noodles': 'ramen',
  'kebab': 'turkish',
  'shawarma': 'lebanese',
  'paella': 'spanish',
  'bibimbap': 'korean',
  'burrito': 'mexican',
  'gelato': 'desserts',
  'burger': 'burgers',
  'bbq': 'bbq',
  'pasta': 'italian',
  'seafood': 'seafood',
  'pizza': 'pizza',
  'ramen': 'ramen',
  'sushi': 'sushi',
  'tacos': 'mexican',
};

function normalizeMoodTermKey (term = '') {
  const raw = String(term || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return 'default';
  return MOOD_TERM_ALIASES[raw] || MOOD_TERM_ALIASES[raw.split(' ')[0]] || raw.split(' ')[0] || 'default';
}

function getCuisinePhoto (cuisine, w = 600, h = 400) {
  const key = (cuisine || '').toLowerCase();
  const id  = CUISINE_PHOTOS[key] || CUISINE_PHOTOS.default;
  return `https://images.unsplash.com/${id}?w=${w}&h=${h}&fit=crop&crop=center&q=80&auto=format`;
}

function resolveWikimediaPhotoUrl (raw = '', width = 960) {
  const value = String(raw || '').trim();
  if (!value) return '';

  if (/^https?:\/\//i.test(value)) {
    if (value.includes('commons.wikimedia.org/wiki/File:')) {
      const fileName = decodeURIComponent(value.split('/wiki/File:')[1] || '').trim();
      if (!fileName) return '';
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=${Math.max(320, Number(width) || 960)}`;
    }
    return value;
  }

  const fileMatch = value.match(/^(?:File:)?(.+)$/i);
  const fileName = fileMatch?.[1] ? fileMatch[1].trim() : '';
  if (!fileName) return '';
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=${Math.max(320, Number(width) || 960)}`;
}

function pickRealRestaurantPhoto ({ savedRestaurant = null, tags = null, cuisine = '', amenity = 'restaurant', width = 960, height = 640, allowFallback = false } = {}) {
  const looksLikeGoodFoodPhoto = (url = '') => {
    const raw = safeUrl(url);
    if (!raw) return false;
    if (/^(?:file:|data:image\/|(?:\.\/)?assets\/)/i.test(raw)) return true;
    try {
      const parsed = new URL(raw, window.location.href);
      const host = (parsed.hostname || '').toLowerCase();
      const path = (parsed.pathname || '').toLowerCase();
      const full = `${host}${path}`;

      if (/(?:^|\.)lemon-film\.com$/.test(host)) return false;
      if (/(?:^|\.)pinterest\./.test(host)) return false;

      if (/\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i.test(path)) return true;
      if (/wikimedia|wikipedia|unsplash|cdn|images\./i.test(full)) return true;
      return false;
    } catch {
      return false;
    }
  };

  const userPhoto = safeUrl(savedRestaurant?.photo || '');
  if (looksLikeGoodFoodPhoto(userPhoto)) return { url: userPhoto, source: 'user' };

  const tagImage = safeUrl(tags?.image || tags?.photo || '');
  if (looksLikeGoodFoodPhoto(tagImage)) return { url: tagImage, source: 'osm' };

  const wikimedia = safeUrl(resolveWikimediaPhotoUrl(tags?.wikimedia_commons || tags?.wikipedia || '', width));
  if (looksLikeGoodFoodPhoto(wikimedia)) return { url: wikimedia, source: 'wikimedia' };

  if (!allowFallback) {
    return { url: '', source: 'none' };
  }

  return {
    url: getCuisinePhoto(cuisine || amenity || 'restaurant', width, height),
    source: 'fallback',
  };
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
  dinnerRooms: {},
  activeDinnerRoomCode: '',
  commandPaletteIndex: 0,
  swipeDeck: [],
  swipeIndex: 0,
  swipeReveal: false,
  swipeLikes: [],
};

const BEAR_SWIPE_JOKES = [
  'I can bear-ly choose, so you pick the vibe.',
  'You are the pawsident of dinner tonight.',
  'No pressure, just pure snack instincts.',
  'Swipe like nobody is judging your cravings.',
  'This card is either destiny or a hard pass.',
  'Dad joke of the day: I am pawsitive this one smells amazing.',
  'Un-bear-lievable food decisions happening right now.',
  'Dad joke alert: I told my fridge a joke. It cracked up.',
  'Bear with me, your next craving is loading.',
  'If this dish were a movie, it would be a snack-buster hit.',
  'Pawdon me, but this looks ridiculously good.',
  'I am not lion... wait wrong animal. Still a tasty pick.',
  'Call it instinct, call it hunger, call it bear science.',
  'Forest forecast: 98% chance of snacks.',
  'Welcome to the dencision engine.',
  'One does not simply walk into dinner without swiping.',
  'Honey levels rising. Appetite confirmed.',
  'If this flops, we blame raccoons and try again.',
  'Tracking dinner by pawprint, one swipe at a time.',
  'Cabin vibes, cozy bites, no wrong answers.',
];

const BEAR_REACTION_COPY = {
  yes: [
    'Paw-sitive pick. Adding that to your craving trail.',
    'Big bear energy. Great yes.',
    'That got an immediate yes claw.',
    'That one passed the bear minimum. Love it.',
    'Snack approved. Fur real.',
    'Stamped with the official paw of approval.',
    'This one made the den menu.',
    'Honey, that is a heck yes.',
  ],
  no: [
    'Nope noted. Back to foraging.',
    'That one can hibernate for now.',
    'Hard pass, soft paws.',
    'Not your vibe. We keep hunting.',
    'No worries, cub boss. Next bite incoming.',
    'That snack wandered off trail. Next.',
    'Nope. We leave that one in the woods.',
    'Not today. The bear palate demands better.',
  ],
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

  // Keep location-banner dismissal sticky even if settings object is replaced.
  if (localStorage.getItem(LOCATION_BANNER_DISMISSED_KEY) === '1') {
    state.settings.locationBannerDismissed = true;
  }

  state.dinnerRooms = state.settings.dinnerRooms && typeof state.settings.dinnerRooms === 'object'
    ? state.settings.dinnerRooms
    : {};
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
    'QA Bistro',
    'No Photo Test',
    'Test Spot',
    'NoPic Spot',
  ]);
  const cleaned = list.filter(r => {
    const website = String(r?.website || '').toLowerCase();
    const name = String(r?.name || '').trim();
    const notes = String(r?.notes || '').toLowerCase();
    const isDemoWebsite = website.includes('.example.com');
    const isKnownDemo = demoNames.has(name);
    const isQaSeed = notes.includes('seeded for qa flow');
    return !(isDemoWebsite || isKnownDemo || isQaSeed);
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
  // Sync to Firestore if user is signed in (debounced)
  if (typeof fbDebouncedSync === 'function') fbDebouncedSync();
}

function persistSettingsLocal () {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings || {}));
}

function loadProductEvents () {
  try {
    const raw = localStorage.getItem(PRODUCT_EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return { counts: {}, recent: [] };
    if (!parsed.counts || typeof parsed.counts !== 'object') parsed.counts = {};
    if (!Array.isArray(parsed.recent)) parsed.recent = [];
    return parsed;
  } catch {
    return { counts: {}, recent: [] };
  }
}

function trackProductEvent (eventName, payload = {}) {
  const name = String(eventName || '').trim();
  if (!name) return;
  const store = loadProductEvents();
  store.counts[name] = Number(store.counts[name] || 0) + 1;
  store.recent.unshift({
    name,
    ts: Date.now(),
    payload: payload && typeof payload === 'object' ? payload : {},
  });
  store.recent = store.recent.slice(0, 120);
  try {
    localStorage.setItem(PRODUCT_EVENTS_KEY, JSON.stringify(store));
  } catch {
    // Best-effort analytics.
  }
}

function loadSwipePrefs () {
  try {
    const raw = localStorage.getItem(SWIPE_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return { history: [] };
    if (!Array.isArray(parsed.history)) parsed.history = [];
    return parsed;
  } catch {
    return { history: [] };
  }
}

function saveSwipePrefs (prefs) {
  try {
    localStorage.setItem(SWIPE_PREFS_KEY, JSON.stringify(prefs || { history: [] }));
  } catch {
    // Best-effort persistence.
  }
}

function swipeCuisineKey (item = {}) {
  return cuisineKey(item.cuisine || item.amenity || 'restaurant') || 'restaurant';
}

function recordSwipePreference (item, reaction = '') {
  if (!item || (reaction !== 'yes' && reaction !== 'no')) return;

  const likedDishKey = extractLocalFoodKeyFromUrl(item.photoUrl || '');
  const likedDishLabel = formatLocalFoodKeyLabel(likedDishKey);

  const prefs = loadSwipePrefs();
  const entry = {
    ts: Date.now(),
    reaction,
    source: item.source || (item.isSaved ? 'saved' : 'nearby'),
    cuisine: swipeCuisineKey(item),
    term: normalizeMoodTermKey(item.cuisine || item.name || ''),
    dishKey: likedDishKey || '',
    dishLabel: likedDishLabel || '',
    priceLevel: Number(item.priceLevel || 0) || 0,
    distMeters: Number.isFinite(item.distMeters) ? Number(item.distMeters) : null,
  };

  prefs.history = (prefs.history || []).concat([entry]).slice(-240);
  saveSwipePrefs(prefs);
  if (!document.getElementById('personalize-overlay')?.classList.contains('hidden')) {
    renderTasteLearningSettingsCard();
  }
}

function getSwipePreferenceProfile () {
  const prefs = loadSwipePrefs();
  const history = (prefs.history || []).slice(-120);
  const profile = {
    total: history.length,
    byCuisine: {},
    priceBias: 0,
    nearBias: 0,
  };

  if (!history.length) return profile;

  let priceSum = 0;
  let priceCount = 0;
  let distSum = 0;
  let distCount = 0;

  history.forEach(h => {
    const w = h.reaction === 'yes' ? 1 : -1;
    const ck = cuisineKey(h.cuisine || 'restaurant') || 'restaurant';
    profile.byCuisine[ck] = (profile.byCuisine[ck] || 0) + w;

    if (Number(h.priceLevel) > 0) {
      priceSum += w * Number(h.priceLevel);
      priceCount += 1;
    }
    if (Number.isFinite(h.distMeters)) {
      // Positive when liking closer places.
      const nearVal = Math.max(0, 1 - (Number(h.distMeters) / 3000));
      distSum += w * nearVal;
      distCount += 1;
    }
  });

  profile.priceBias = priceCount ? (priceSum / priceCount) : 0;
  profile.nearBias = distCount ? (distSum / distCount) : 0;
  return profile;
}

function getSwipePreferenceReasonForCandidate (c) {
  const profile = getSwipePreferenceProfile();
  if (profile.total < 6) return '';

  const ck = swipeCuisineKey(c);
  const cScore = Number(profile.byCuisine[ck] || 0);
  if (cScore >= 3) return `Because you liked ${formatCuisineLabel(c.cuisine || c.amenity || 'this cuisine')} picks`;
  if (cScore <= -3) return `You usually skip ${formatCuisineLabel(c.cuisine || c.amenity || 'this cuisine')} picks`;
  if (profile.nearBias > 0.15 && Number.isFinite(c.distMeters) && c.distMeters <= 1200) return 'Because you like nearby quick wins';
  if (profile.priceBias > 0.2 && Number(c.priceLevel || 0) >= 3) return 'Because you leaned toward splurge picks';
  if (profile.priceBias < -0.2 && Number(c.priceLevel || 0) > 0 && Number(c.priceLevel || 0) <= 2) return 'Because you leaned toward budget picks';
  return '';
}

function renderTasteLearningSettingsCard () {
  const countEl = document.getElementById('taste-learning-count');
  const summaryEl = document.getElementById('taste-learning-summary');
  const tagsEl = document.getElementById('taste-learning-tags');
  if (!countEl || !summaryEl || !tagsEl) return;

  const profile = getSwipePreferenceProfile();
  countEl.textContent = `${profile.total} swipe${profile.total === 1 ? '' : 's'}`;

  if (!profile.total) {
    summaryEl.textContent = 'Swipe a few cards and I will start learning your flavor patterns.';
    tagsEl.innerHTML = '';
    return;
  }

  const topPos = Object.entries(profile.byCuisine || {})
    .sort((a, b) => b[1] - a[1])
    .find(([, score]) => Number(score) >= 2);
  const topNeg = Object.entries(profile.byCuisine || {})
    .sort((a, b) => a[1] - b[1])
    .find(([, score]) => Number(score) <= -2);

  const summaryParts = [];
  if (topPos) summaryParts.push(`You are leaning toward ${formatCuisineLabel(topPos[0])}`);
  if (topNeg) summaryParts.push(`you often skip ${formatCuisineLabel(topNeg[0])}`);
  if (profile.nearBias > 0.12) summaryParts.push('you usually prefer closer spots');
  if (profile.priceBias > 0.2) summaryParts.push('you have been choosing pricier picks');
  if (profile.priceBias < -0.2) summaryParts.push('you have been choosing budget picks');
  summaryEl.textContent = summaryParts.length
    ? `${summaryParts.join(' • ')}.`
    : 'Your preferences are warming up. A few more swipes will sharpen your picks.';

  const chips = [];
  if (topPos) chips.push({ label: `Likes ${formatCuisineLabel(topPos[0])}`, cls: 'positive' });
  if (topNeg) chips.push({ label: `Skips ${formatCuisineLabel(topNeg[0])}`, cls: 'negative' });
  if (profile.nearBias > 0.12) chips.push({ label: 'Prefers nearby', cls: 'positive' });
  if (profile.nearBias < -0.12) chips.push({ label: 'Open to farther spots', cls: 'positive' });
  if (profile.priceBias > 0.2) chips.push({ label: 'Leans splurge', cls: 'positive' });
  if (profile.priceBias < -0.2) chips.push({ label: 'Leans budget', cls: 'positive' });

  tagsEl.innerHTML = chips
    .slice(0, 5)
    .map(c => `<span class="taste-learning-tag ${c.cls}">${escHtml(c.label)}</span>`)
    .join('');
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
  showToast('Exported! ', `${state.restaurants.length} restaurants saved to file.`, 'success');
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
      showToast('Imported! ', `${added} new restaurant${added !== 1 ? 's' : ''} added.`, 'success');
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

function hapticTap (strength = 'light') {
  if (!navigator.vibrate) return;
  if (state?.settings?.uiMotion === 'reduced') return;
  const ms = strength === 'medium' ? 16 : 8;
  navigator.vibrate(ms);
}

/* ════════════════════════════════════════════════════════════
   USER PROFILE
   ════════════════════════════════════════════════════════════ */
const AVATAR_OPTIONS = ['FTB', 'VIP', 'DINE', 'CHEF', 'TABLE', 'CITY', 'DATE', 'GOLD', 'CLUB', 'FINE', 'PLUS', 'NYX'];
const DEFAULT_AVATAR = 'FTB';
const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const THEME_PRESETS = {
  dark:     { mode: 'dark',  accent: 'midnight' },
  light:    { mode: 'light', accent: 'sunset' },
  forest:   { mode: 'dark',  accent: 'forest' },
  ocean:    { mode: 'dark',  accent: 'ocean' },
  sunset:   { mode: 'light', accent: 'sunset' },
  midnight: { mode: 'dark',  accent: 'midnight' },
  berry:    { mode: 'dark',  accent: 'berry' },
  mint:     { mode: 'light', accent: 'mint' },
  neon:     { mode: 'dark',  accent: 'neon' },
};
const UI_DENSITY = new Set(['cozy', 'compact']);
const UI_CORNERS = new Set(['rounded', 'sharp']);
const UI_MOTION = new Set(['playful', 'reduced']);

function loadUserProfile () {
  try {
    const profile = JSON.parse(localStorage.getItem(USER_KEY)) || null;
    if (!profile) return null;
    if (profile.avatar === '') profile.avatar = DEFAULT_AVATAR;
    return profile;
  } catch {
    return null;
  }
}
function saveUserProfile (profile) {
  localStorage.setItem(USER_KEY, JSON.stringify(profile));
  if (window._ftbUid && typeof fbSaveProfileCloud === 'function') {
    fbSaveProfileCloud(window._ftbUid, profile);
  }
}

function persistAppearanceProfile () {
  const base = loadUserProfile() || { name: 'Foodie', avatar: DEFAULT_AVATAR, joinDate: iso() };
  const appearance = {
    themeChoice: state.settings.themeChoice || 'dark',
    themeMode: state.settings.theme || 'dark',
    uiDensity: UI_DENSITY.has(state.settings.uiDensity) ? state.settings.uiDensity : 'cozy',
    uiCorners: UI_CORNERS.has(state.settings.uiCorners) ? state.settings.uiCorners : 'rounded',
    uiMotion: UI_MOTION.has(state.settings.uiMotion) ? state.settings.uiMotion : 'playful',
  };
  saveUserProfile({ ...base, appearance });
}

function initUserProfile () {
  const profile = loadUserProfile();
  if (!profile) {
    // Show full-screen signup immediately - suppress onboarding for new users
    const ob = document.getElementById('onboarding-overlay');
    if (ob) ob.classList.add('hidden');
    state.settings.onboardingDone = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    openProfileSetup();
  } else {
    updateProfileVisuals(profile);
  }
}

function updateHeaderAvatar (emoji) {
  const el = document.getElementById('header-avatar');
  if (!el) return;
  const profile = loadUserProfile() || {};
  if (profile.photo) {
    el.innerHTML = `<img src="${profile.photo}" alt="Profile" class="account-avatar-photo" />`;
  } else {
    const avatar = (emoji === '' ? DEFAULT_AVATAR : emoji) || (profile.avatar === '' ? DEFAULT_AVATAR : profile.avatar) || DEFAULT_AVATAR;
    el.textContent = avatar;
  }
}

function updateProfileVisuals (profile = null) {
  const p = profile || loadUserProfile() || { avatar: DEFAULT_AVATAR };
  const normalizedAvatar = p.avatar === '' ? DEFAULT_AVATAR : (p.avatar || DEFAULT_AVATAR);

  const accountAvatar = document.getElementById('account-avatar-display');
  if (accountAvatar) {
    if (p.photo) {
      accountAvatar.innerHTML = `<img src="${p.photo}" alt="Profile" class="account-avatar-photo account-avatar-photo-lg" />`;
    } else {
      accountAvatar.textContent = normalizedAvatar;
    }
  }

  const editAvatar = document.getElementById('edit-avatar-display');
  const editPreview = document.getElementById('edit-photo-preview');
  if (editAvatar && editPreview) {
    if (p.photo) {
      editAvatar.classList.add('hidden');
      editPreview.src = p.photo;
      editPreview.classList.remove('hidden');
    } else {
      editPreview.classList.add('hidden');
      editPreview.removeAttribute('src');
      editAvatar.classList.remove('hidden');
      editAvatar.textContent = normalizedAvatar;
    }
  }

  updateHeaderAvatar(normalizedAvatar);
}

function applyThemeChoice (choice = 'dark', opts = {}) {
  const markManual = opts.manual !== false;
  const shouldPersist = opts.persist !== false;
  const preset = THEME_PRESETS[choice] || THEME_PRESETS.dark;
  document.body.classList.toggle('light-mode', preset.mode === 'light');
  document.body.dataset.themeAccent = preset.accent;
  state.settings.theme = preset.mode;
  state.settings.themeChoice = choice;
  if (markManual) state.settings.themeManual = true;
  if (shouldPersist) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    persistAppearanceProfile();
  }
  syncThemeMetaColor();
}

function syncThemeMetaColor () {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const primary = getComputedStyle(document.body).getPropertyValue('--primary').trim();
  if (primary) meta.setAttribute('content', primary);
}

function applyPersonalizationSettings () {
  const density = UI_DENSITY.has(state.settings.uiDensity) ? state.settings.uiDensity : 'cozy';
  const corners = UI_CORNERS.has(state.settings.uiCorners) ? state.settings.uiCorners : 'rounded';
  const motion = UI_MOTION.has(state.settings.uiMotion) ? state.settings.uiMotion : 'playful';

  state.settings.uiDensity = density;
  state.settings.uiCorners = corners;
  state.settings.uiMotion = motion;

  document.body.dataset.uiDensity = density;
  document.body.dataset.uiCorners = corners;
  document.body.dataset.uiMotion = motion;
}

function buildAvatarGrid (gridId, currentAvatar, onSelect) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  let selected = currentAvatar || AVATAR_OPTIONS[0];
  grid.innerHTML = AVATAR_OPTIONS.map(e =>
    `<button class="avatar-option${e === selected ? ' selected' : ''}" data-emoji="${e}" type="button">${e}</button>`
  ).join('');
  grid.addEventListener('click', e => {
    const btn = e.target.closest('.avatar-option');
    if (!btn) return;
    grid.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selected = btn.dataset.emoji;
    onSelect(selected);
  });
}

function openProfileSetup () {
  const overlay = document.getElementById('profile-setup-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  let chosenAvatar = DEFAULT_AVATAR;
  const avatarDisplay = document.getElementById('setup-avatar-display');
  if (avatarDisplay) avatarDisplay.textContent = chosenAvatar;
  buildAvatarGrid('avatar-emoji-grid', chosenAvatar, emoji => {
    chosenAvatar = emoji;
    const d = document.getElementById('setup-avatar-display');
    if (d) d.textContent = emoji;
  });
  const nameInput = document.getElementById('setup-name');
  if (nameInput) nameInput.focus();

  const doSave = () => {
    const name = (document.getElementById('setup-name')?.value || '').trim() || 'Foodie';
    const profile = { name, avatar: chosenAvatar, joinDate: new Date().toISOString() };
    saveUserProfile(profile);
    updateHeaderAvatar(profile.avatar);
    overlay.classList.add('hidden');
    showToast(`Welcome, ${name}!`, 'Your account is set. Now let\'s find some food!', 'success');
    // Show onboarding tour after signup
    setTimeout(() => {
      state.settings.onboardingDone = false;
      showOnboarding();
    }, 600);
  };

  const doSkip = () => {
    const profile = { name: 'Foodie', avatar: DEFAULT_AVATAR, joinDate: new Date().toISOString() };
    saveUserProfile(profile);
    updateHeaderAvatar(profile.avatar);
    overlay.classList.add('hidden');
    showToast('Welcome!', 'You can set up your profile anytime via the account button.', 'info');
  };

  document.getElementById('setup-save-btn').onclick = doSave;
  const skipBtn = document.getElementById('setup-skip-btn');
  if (skipBtn) skipBtn.onclick = doSkip;
}

function openAccountModal () {
  const overlay = document.getElementById('account-overlay');
  if (!overlay) return;
  const profile = loadUserProfile() || { name: 'Foodie', avatar: DEFAULT_AVATAR, joinDate: new Date().toISOString() };
  const normalizedAvatar = profile.avatar === '' ? DEFAULT_AVATAR : (profile.avatar || DEFAULT_AVATAR);

  const avatarEl = document.getElementById('account-avatar-display');
  const nameEl   = document.getElementById('account-name-display');
  const sinceEl  = document.getElementById('account-since-display');
  const statsEl  = document.getElementById('account-stats-row');

  if (avatarEl) {
    if (profile.photo) {
      avatarEl.innerHTML = `<img src="${profile.photo}" alt="Profile" class="account-avatar-photo account-avatar-photo-lg" />`;
    } else {
      avatarEl.textContent = normalizedAvatar;
    }
  }
  if (nameEl)   nameEl.textContent   = profile.name   || 'Foodie';
  if (sinceEl) {
    const joined = profile.joinDate
      ? new Date(profile.joinDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : 'recently';
    sinceEl.textContent = `Member since ${joined}`;
  }

  if (statsEl) {
    const all       = state.restaurants;
    const visited   = all.filter(r => r.status === 'visited').length;
    const rated     = all.filter(r => r.myRating > 0);
    const avgRating = rated.length
      ? (rated.reduce((s, r) => s + (r.myRating || 0), 0) / rated.length).toFixed(1)
      : '-';
    const cuisines  = new Set(all.filter(r => r.cuisine).map(r => r.cuisine.toLowerCase())).size;
    statsEl.innerHTML = `
      <div class="account-stat"><span class="account-stat-val">${all.length}</span><span class="account-stat-label">Saved</span></div>
      <div class="account-stat"><span class="account-stat-val">${visited}</span><span class="account-stat-label">Visited</span></div>
      <div class="account-stat"><span class="account-stat-val">${avgRating}${avgRating !== '-' ? ' ★' : ''}</span><span class="account-stat-label">Avg Rating</span></div>
    `;
  }

  // Wire portal action buttons (safe: use onclick to avoid stacking listeners)
  const btn = id => document.getElementById(id);
  const gotoAndClose = fn => { closeAccountModal(); setTimeout(fn, 150); };
  if (btn('account-personalize-btn'))  btn('account-personalize-btn').onclick  = () => gotoAndClose(openPersonalizeSettings);
  if (btn('account-dishes-link-btn'))  btn('account-dishes-link-btn').onclick  = () => gotoAndClose(openDishLeaderboard);
  if (btn('account-smartplanner-btn')) btn('account-smartplanner-btn').onclick = () => gotoAndClose(openSmartPlanner);
  if (btn('account-sharehighlights-btn')) btn('account-sharehighlights-btn').onclick = () => gotoAndClose(openShareHighlights);
  if (btn('account-profile-link-btn'))  btn('account-profile-link-btn').onclick  = () => gotoAndClose(openFoodieProfile);
  if (btn('account-review-link-btn'))   btn('account-review-link-btn').onclick   = () => gotoAndClose(() => (typeof requiresPremium === 'function' ? requiresPremium('Year in Review ', openYearReview) : openYearReview()));
  if (btn('account-ach-link-btn'))      btn('account-ach-link-btn').onclick      = () => gotoAndClose(() => (typeof requiresPremium === 'function' ? requiresPremium('Achievements ', openAchievements) : openAchievements()));
  if (btn('account-export-link-btn'))   btn('account-export-link-btn').onclick   = () => gotoAndClose(openExport2);

  // Hide lock icons on premium features if user is Grizzly
  const prem = typeof isPremium === 'function' && isPremium();
  overlay.querySelectorAll('.prem-lock').forEach(el => { el.textContent = prem ? '›' : ''; });

  // Refresh auth UI badges
  if (typeof updateAuthUI === 'function') updateAuthUI(typeof _auth !== 'undefined' ? _auth.currentUser : null);

  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeAccountModal () {
  document.getElementById('account-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function openEditProfile () {
  closeAccountModal();
  const overlay = document.getElementById('edit-profile-overlay');
  if (!overlay) return;
  const profile = loadUserProfile() || { name: 'Foodie', avatar: DEFAULT_AVATAR };
  let chosenAvatar = (profile.avatar === '' ? DEFAULT_AVATAR : profile.avatar) || DEFAULT_AVATAR;
  let chosenPhoto = profile.photo || '';
  document.getElementById('edit-name').value = profile.name || '';

  const setEditPhotoState = () => {
    const avatarEl = document.getElementById('edit-avatar-display');
    const previewEl = document.getElementById('edit-photo-preview');
    if (!avatarEl || !previewEl) return;
    if (chosenPhoto) {
      avatarEl.classList.add('hidden');
      previewEl.src = chosenPhoto;
      previewEl.classList.remove('hidden');
    } else {
      previewEl.classList.add('hidden');
      previewEl.removeAttribute('src');
      avatarEl.classList.remove('hidden');
      avatarEl.textContent = chosenAvatar;
    }
  };

  setEditPhotoState();

  buildAvatarGrid('edit-avatar-grid', chosenAvatar, emoji => {
    chosenAvatar = emoji;
    if (!chosenPhoto) document.getElementById('edit-avatar-display').textContent = emoji;
  });

  const photoInput = document.getElementById('edit-photo-input');
  const photoUploadBtn = document.getElementById('edit-photo-upload-btn');
  const photoRemoveBtn = document.getElementById('edit-photo-remove-btn');

  if (photoUploadBtn && photoInput) {
    photoUploadBtn.onclick = () => photoInput.click();
  }
  if (photoRemoveBtn) {
    photoRemoveBtn.onclick = () => {
      chosenPhoto = '';
      if (photoInput) photoInput.value = '';
      setEditPhotoState();
    };
  }
  if (photoInput) {
    photoInput.onchange = async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Invalid file', 'Please select an image file.', 'error');
        return;
      }
      if (file.size > PROFILE_PHOTO_MAX_BYTES) {
        showToast('Photo too large', 'Please choose an image under 2 MB.', 'error');
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      chosenPhoto = String(dataUrl);
      setEditPhotoState();
    };
  }

  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  document.getElementById('edit-profile-save-btn').onclick = () => {
    const name = document.getElementById('edit-name').value.trim() || profile.name || 'Foodie';
    const updated = { ...profile, name, avatar: chosenAvatar, photo: chosenPhoto || '' };
    saveUserProfile(updated);
    updateProfileVisuals(updated);
    overlay.classList.add('hidden');
    maybeHideOverlay();
    showToast('Profile updated!', '', 'success');
  };
}

function openPersonalizeSettings () {
  const overlay = document.getElementById('personalize-overlay');
  if (!overlay) return;

  const themeSel = document.getElementById('personalize-theme-select');
  const densitySel = document.getElementById('personalize-density-select');
  const cornersSel = document.getElementById('personalize-corners-select');
  const motionSel = document.getElementById('personalize-motion-select');
  const nearbyRadiusSel = document.getElementById('personalize-nearby-radius-select');
  const weeklyGoalInput = document.getElementById('personalize-weekly-goal-input');
  const avgSpendInput = document.getElementById('personalize-avg-spend-input');
  const monthlyBudgetInput = document.getElementById('personalize-monthly-budget-input');
  const enableLocationBtn = document.getElementById('settings-enable-location-btn');
  const disableLocationBtn = document.getElementById('settings-disable-location-btn');
  const resetTasteBtn = document.getElementById('taste-learning-reset-btn');

  if (themeSel) {
    if (!state.settings.themeManual) {
      themeSel.value = 'auto';
    } else {
      themeSel.value = state.settings.themeChoice || (state.settings.theme === 'light' ? 'light' : 'dark');
    }
  }
  if (densitySel) densitySel.value = UI_DENSITY.has(state.settings.uiDensity) ? state.settings.uiDensity : 'cozy';
  if (cornersSel) cornersSel.value = UI_CORNERS.has(state.settings.uiCorners) ? state.settings.uiCorners : 'rounded';
  if (motionSel) motionSel.value = UI_MOTION.has(state.settings.uiMotion) ? state.settings.uiMotion : 'playful';
  if (nearbyRadiusSel) nearbyRadiusSel.value = String(Math.max(1, Math.min(5, Number(state.settings.nearbyRadiusMiles) || 1)));
  if (weeklyGoalInput) weeklyGoalInput.value = String(Math.max(0, Number(state.settings.weeklyGoal) || 0));
  if (avgSpendInput) avgSpendInput.value = String(Math.max(0, Number(state.settings.avgSpend) || 35));
  if (monthlyBudgetInput) monthlyBudgetInput.value = String(Math.max(0, Number(state.settings.monthlyBudget) || 0));

  if (enableLocationBtn) enableLocationBtn.onclick = () => enableLocation();
  if (disableLocationBtn) disableLocationBtn.onclick = () => disableLocation();
  if (resetTasteBtn) {
    resetTasteBtn.onclick = () => {
      saveSwipePrefs({ history: [] });
      renderTasteLearningSettingsCard();
      showToast('Taste learning reset', 'Swipe cards again to retrain your picks.', 'info');
    };
  }
  renderTasteLearningSettingsCard();

  document.getElementById('personalize-save-btn').onclick = () => {
    const choice = themeSel?.value || 'dark';
    const nearbyRadius = Math.max(1, Math.min(5, Number(nearbyRadiusSel?.value) || 1));
    state.settings.uiDensity = densitySel?.value || 'cozy';
    state.settings.uiCorners = cornersSel?.value || 'rounded';
    state.settings.uiMotion = motionSel?.value || 'playful';
    state.settings.nearbyRadiusMiles = nearbyRadius;
    state.settings.weeklyGoal = Math.max(0, Math.min(30, Number(weeklyGoalInput?.value) || 0));
    state.settings.avgSpend = Math.max(0, Number(avgSpendInput?.value) || 35);
    state.settings.monthlyBudget = Math.max(0, Number(monthlyBudgetInput?.value) || 0);
    if (choice === 'auto') {
      state.settings.themeManual = false;
      state.settings.themeChoice = 'auto';
      applyAutoThemeByClock({ persist: true, announce: true });
      scheduleNextAutoThemeTick();
    } else {
      applyThemeChoice(choice);
    }
    applyPersonalizationSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    persistAppearanceProfile();
    overlay.classList.add('hidden');
    maybeHideOverlay();
    renderTodayStatusRow();
    renderTodayVibeRow();
    if (state.userLat && state.userLng) loadHomeDiscovery();
    showToast('Settings saved!', '', 'success');
  };

  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
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
      showToast(' Location enabled', 'You\'ll get a nudge when you\'re near spots on your list!', 'success');
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      startWatching();
      // Load home discovery strip + AI rec
      loadHomeDiscovery();
    },
    err => {
      if (err?.code === 1) setLocationBannerCooldown();
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
  showToast(' Location Off', 'Location tracking disabled.', 'info');
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
    `${r.status === 'want-to-try' ? 'Saved for later.' : 'Previously visited.'} ${fmtDist(distM)} away`;

  const dirBtn = document.getElementById('proximity-directions');
  dirBtn.onclick = () => openDirections(r);

  alert.classList.remove('hidden');
  clearTimeout(alert._timeout);
  alert._timeout = setTimeout(() => alert.classList.add('hidden'), 15000);
}

function sendBrowserNotification (r, distM) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const tag = `ftb-${r.id}`;
  const n = new Notification(`Feed The Bear: ${r.name}`, {
    body: `${r.status === 'want-to-try' ? 'Saved on your list.' : 'Previously visited.'} ${fmtDist(distM)} away`,
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
  document.getElementById('stat-avg').textContent     = avg || '-';
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
  grid.classList.add('restaurant-grid-single');
  const shouldAnimateCards = state.settings.uiMotion !== 'reduced' && !state.settings.homeEntranceSeen;
  if (shouldAnimateCards) {
    grid.classList.add('card-enter-run');
    state.settings.homeEntranceSeen = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } else {
    grid.classList.remove('card-enter-run');
  }
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
  const photoPick = pickRealRestaurantPhoto({
    savedRestaurant: r,
    cuisine: r.cuisine,
    amenity: 'restaurant',
    width: 1200,
    height: 900,
    allowFallback: false,
  });
  const photoSrc = photoPick.url;
  const hasPhoto = !!photoSrc;

  // Collection badge
  const col = (state.settings.collections||[]).find(c => c.id === r.collectionId);
  const collBadge = col
    ? `<span class="collection-badge" style="background:${col.color}22;color:${col.color};border-color:${col.color}44"><span class="collection-dot" style="background:${col.color}"></span>${escHtml(col.name)}</span>`
    : '';
  const matchScore = Math.max(42, Math.min(99, Math.round(((r.myRating || r.googleRating || 3) * 18) + (r.isFavorite ? 10 : 0) + (r.status === 'want-to-try' ? 6 : 0))));
  const moodLabel = r.status === 'want-to-try' ? 'Up next' : 'Trusted pick';

  card.innerHTML = `
    <div class="card-checkbox${state.selectedIds.has(r.id) ? ' checked' : ''}" title="Select"></div>
    <div class="card-photo">
      ${hasPhoto
        ? `<img src="${escHtml(photoSrc)}" alt="${escHtml(r.name)}" loading="lazy" onload="this.classList.add('loaded')" />`
        : `<div class="card-photo-empty"><span>No verified photo yet</span></div>`}
      <div class="card-img-overlay"></div>
      <span class="card-status-badge ${r.status === 'want-to-try' ? 'want' : 'visited'}">
        ${r.status === 'want-to-try' ? 'Want to Try' : 'Visited'}
      </span>
      <button class="card-favorite-btn ${r.isFavorite ? 'active' : ''}" data-action="toggle-favorite" aria-label="Toggle favorite restaurant">
        ${r.isFavorite ? '★ Favorite' : '☆ Favorite'}
      </button>
      ${r.priceRange ? `<span class="card-price-badge">${priceDollars(r.priceRange)}</span>` : ''}
      ${distStr ? `<span class="card-distance-badge"> ${distStr}</span>` : ''}
    </div>
    <div class="card-body">
      ${r.cuisine ? `<div class="card-cuisine">${escHtml(`${cuisineEmoji(r.cuisine)} ${r.cuisine}`.trim())}</div>` : ''}
      <div class="card-name">${escHtml(r.name)}</div>
      <div class="card-rating-row">
        ${r.googleRating ? googleStarsHtml(r.googleRating, r.googleReviews) : ''}
        ${r.myRating ? `<span class="my-rating-row"><span class="my-stars">${'★'.repeat(r.myRating)}${'☆'.repeat(5-r.myRating)}</span> My Rating</span>` : ''}
      </div>
      <div class="card-highlights">
        <span class="card-highlight good"> ${matchScore}% match</span>
        <span class="card-highlight mood"> ${escHtml(moodLabel)}</span>
        ${distStr ? `<span class="card-highlight neutral"> ${distStr}</span>` : ''}
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
        <button class="card-action-btn primary-action" data-action="open" aria-label="Open ${escHtml(r.name)}">
          ${r.status === 'want-to-try' ? 'Plan This' : 'Open'}
        </button>
        ${r.address ? `<button class="card-action-btn directions" data-action="directions" aria-label="Get directions to ${escHtml(r.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Directions
          </button>` : ''}
        ${r.website ? `<button class="card-action-btn website" data-action="website" aria-label="Open website for ${escHtml(r.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            Website
          </button>` : ''}
        <button class="card-action-btn edit-card" data-action="edit" aria-label="Edit ${escHtml(r.name)}">
          ✏ Edit
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
    if (action === 'toggle-favorite') {
      e.stopPropagation();
      const i = state.restaurants.findIndex(x => x.id === r.id);
      if (i !== -1) {
        state.restaurants[i].isFavorite = !state.restaurants[i].isFavorite;
        saveData();
        renderCards();
      }
      return;
    }
    if (action === 'directions')   { e.stopPropagation(); openDirections(r);      return; }
    if (action === 'website')       { e.stopPropagation(); openWebsite(r);         return; }
    if (action === 'edit')          { e.stopPropagation(); openEditModal(r.id);    return; }
    if (action === 'open')          { e.stopPropagation(); openDetailModal(r.id);  return; }
    if (action === 'mark-visited')  { e.stopPropagation(); markVisited(r.id);      return; }
    hapticTap('light');
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

  const notesEdit = document.getElementById('detail-notes-edit');
  if (notesEdit) notesEdit.value = r.notes || '';
  const notesSaved = document.getElementById('detail-notes-saved');
  if (notesSaved) notesSaved.textContent = '';
  renderDetailQuickCapture(r);

  const dist = distOf(r);
  const meta = [];
  if (dist < Infinity) meta.push(` ${fmtDist(dist)} away`);
  meta.push(` Added ${fmtDate(r.dateAdded)}`);
  if (r.dateVisited) meta.push(`✅ Visited ${fmtDate(r.dateVisited)}`);
  meta.push(`<span style="padding:3px 8px;border-radius:12px;font-size:.72rem;background:${r.status==='visited'?'rgba(46,204,113,.15)':'rgba(74,144,217,.15)'};color:${r.status==='visited'?'var(--green)':'var(--blue-lt)'};font-weight:600">
    ${r.status==='visited'?'✅ Visited':' Want to Try'}</span>`);
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
        showToast('Filtered ', `Showing: ${el.dataset.tag}`, 'info');
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
      celebrateMilestones();
    }
  };

  // Reminder
  const reminderStatus = document.getElementById('detail-reminder-status');
  const storedReminder = state.settings[`reminder_${id}`];
  reminderStatus.textContent = storedReminder
    ? ` Reminder set for ${new Date(storedReminder).toLocaleString()}`
    : '';
  document.getElementById('detail-set-reminder-btn').onclick = () => scheduleReminder(r);

  document.getElementById('detail-share-btn').onclick = () => shareCard(r);
  document.getElementById('detail-directions-btn').onclick = () => openDirections(r);
  document.getElementById('detail-sms-btn').onclick = () => shareViaSMS(r);
  const detailFavBtn = document.getElementById('detail-favorite-btn');
  if (detailFavBtn) {
    detailFavBtn.classList.toggle('active', !!r.isFavorite);
    detailFavBtn.textContent = r.isFavorite ? '★ Favorite' : '☆ Favorite';
  }
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

  resetDetailMenuForm();
  renderDetailMenuList(id);

  document.getElementById('detail-overlay').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  // Phase 9 - load cuisine photo + hide stale AI summary
  loadDetailPhoto(r);
  const aiSumEl = document.getElementById('detail-ai-summary');
  if (aiSumEl) aiSumEl.classList.add('hidden');
}

function closeDetailModal () {
  document.getElementById('detail-overlay').classList.add('hidden');
  maybeHideOverlay();
}

/* ── Detail Quick Capture: set rating / status / price inline ── */
function renderDetailQuickCapture (r) {
  const stars = document.querySelectorAll('#dq-stars .dq-star');
  stars.forEach(b => b.classList.toggle('on', parseInt(b.dataset.val) <= (r.myRating || 0)));
  document.querySelectorAll('#dq-status .dq-seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.status === r.status));
  document.querySelectorAll('#dq-price .dq-seg-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.price) === (r.priceRange || 0)));
}

/* Patch a restaurant in place, persist, and refresh the open detail + lists
   without closing the modal. */
function patchRestaurant (id, patch) {
  const i = state.restaurants.findIndex(x => x.id === id);
  if (i === -1) return null;
  Object.assign(state.restaurants[i], patch);
  saveData();
  return state.restaurants[i];
}

function initDetailQuickCapture () {
  const stars = document.getElementById('dq-stars');
  if (stars) {
    stars.addEventListener('click', e => {
      const btn = e.target.closest('[data-val]');
      if (!btn || !state.detailId) return;
      const val = parseInt(btn.dataset.val);
      const r = patchRestaurant(state.detailId, { myRating: val });
      if (!r) return;
      hapticTap('medium');
      renderDetailQuickCapture(r);
      document.getElementById('detail-my-rating').innerHTML = myRatingHtml(r.myRating);
      stars.classList.remove('just-set'); void stars.offsetWidth; stars.classList.add('just-set');
      if (val === 5) launchConfetti(1200);
      renderStats();
    });
  }

  const statusSeg = document.getElementById('dq-status');
  if (statusSeg) {
    statusSeg.addEventListener('click', e => {
      const btn = e.target.closest('[data-status]');
      if (!btn || !state.detailId) return;
      const status = btn.dataset.status;
      const patch = { status };
      if (status === 'visited') {
        const cur = state.restaurants.find(x => x.id === state.detailId);
        if (cur && !cur.dateVisited) patch.dateVisited = iso();
      }
      const r = patchRestaurant(state.detailId, patch);
      if (!r) return;
      hapticTap('medium');
      renderDetailQuickCapture(r);
      renderAll();
      if (status === 'visited') celebrateVisit(r.name);
    });
  }

  const priceSeg = document.getElementById('dq-price');
  if (priceSeg) {
    priceSeg.addEventListener('click', e => {
      const btn = e.target.closest('[data-price]');
      if (!btn || !state.detailId) return;
      const cur = state.restaurants.find(x => x.id === state.detailId);
      const price = parseInt(btn.dataset.price);
      // tapping the active price clears it
      const next = (cur && cur.priceRange === price) ? 0 : price;
      const r = patchRestaurant(state.detailId, { priceRange: next });
      if (!r) return;
      hapticTap('light');
      renderDetailQuickCapture(r);
      document.getElementById('detail-price').innerHTML =
        `<label>Price Range</label><div style="font-size:1.2rem;color:var(--gold);font-weight:700">${priceDollars(r.priceRange)||'<span style="color:var(--text-dim);font-size:.85rem">Unknown</span>'}</div>`;
    });
  }

  // Editable notes - autosave on input (debounced) + on blur
  const notes = document.getElementById('detail-notes-edit');
  if (notes) {
    let t = null;
    const save = () => {
      if (!state.detailId) return;
      patchRestaurant(state.detailId, { notes: notes.value.trim() });
      const saved = document.getElementById('detail-notes-saved');
      if (saved) { saved.textContent = 'Saved ✓'; clearTimeout(t); t = setTimeout(() => saved.textContent = '', 1600); }
    };
    let dt = null;
    notes.addEventListener('input', () => { clearTimeout(dt); dt = setTimeout(save, 600); });
    notes.addEventListener('blur', save);
  }
}

/* ── Celebration / milestone helpers (delight) ───────────────── */
let _celebrationTimer = null;

function showCelebrationMoment (title, subtitle = '', opts = {}) {
  const banner = document.getElementById('celebration-banner');
  const titleEl = document.getElementById('celebration-title');
  const subEl = document.getElementById('celebration-sub');
  if (!banner || !titleEl || !subEl) return;

  const duration = Math.max(900, Number(opts.durationMs || 1800));
  titleEl.textContent = title;
  subEl.textContent = subtitle || '';
  banner.classList.remove('hidden');

  if (opts.glow !== false) {
    document.body.classList.add('celebrate-glow');
    setTimeout(() => document.body.classList.remove('celebrate-glow'), Math.min(duration, 900));
  }
  if (opts.confetti) launchConfetti(Number(opts.confettiMs || 2000));
  if (opts.haptic) hapticTap(opts.haptic);

  clearTimeout(_celebrationTimer);
  _celebrationTimer = setTimeout(() => banner.classList.add('hidden'), duration);
}

function visitedCount () {
  return state.restaurants.filter(r => r.status === 'visited').length;
}
function celebrateVisit (name) {
  hapticTap('medium');
  showToast('✅ Visited!', `"${name}" added to your conquests.`, 'success');
  showCelebrationMoment('Visit Logged', name, { durationMs: 1500, glow: true, confetti: false });
  celebrateMilestones();
}
const VISIT_MILESTONES = [1, 5, 10, 25, 50, 100, 150, 200, 300, 500];
function celebrateMilestones () {
  const count = visitedCount();
  const last = state.settings.lastMilestone || 0;
  const hit = VISIT_MILESTONES.filter(m => m > last && m <= count).pop();
  if (!hit) return;
  state.settings.lastMilestone = hit;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  launchConfetti(3200);
  const msg = hit === 1 ? 'Your first visit logged - the adventure begins!'
    : `${hit} restaurants visited! You're a certified foodie explorer. `;
  showCelebrationMoment(`${hit} Visited`, msg, { durationMs: 2200, glow: true, confetti: true, confettiMs: 2500, haptic: 'medium' });
  setTimeout(() => showToast(` ${hit} Visited!`, msg, 'success'), 250);
}

/* ── Pull-to-refresh (mobile) ────────────────────────────────── */
function initPullToRefresh () {
  const indicator = document.getElementById('ptr-indicator');
  if (!indicator) return;
  let startY = 0, pulling = false, dist = 0;
  const THRESHOLD = 70, MAX = 120;
  const canPull = () =>
    window.scrollY <= 0 &&
    !document.body.classList.contains('overlay-open') &&
    state.currentView !== 'map' &&
    state.settings.uiMotion !== 'reduced';

  window.addEventListener('touchstart', e => {
    pulling = canPull();
    if (pulling) { startY = e.touches[0].clientY; dist = 0; }
  }, { passive: true });

  window.addEventListener('touchmove', e => {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0) { indicator.classList.remove('visible', 'ready'); indicator.style.transform = ''; return; }
    const pull = Math.min(dist * 0.5, MAX);
    indicator.classList.add('visible');
    indicator.style.transform = `translateX(-50%) translateY(${pull}px) rotate(${pull * 3}deg)`;
    indicator.classList.toggle('ready', pull >= THRESHOLD);
  }, { passive: true });

  const reset = () => { indicator.classList.remove('visible', 'ready', 'refreshing'); indicator.style.transform = ''; };
  window.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    if (Math.min(dist * 0.5, MAX) < THRESHOLD) { reset(); return; }
    indicator.classList.add('refreshing');
    hapticTap('medium');
    setTimeout(() => {
      _forYouSeed = (state._ptrTick = (state._ptrTick || 0) + 1); // reroll For You picks
      renderAll();
      if (typeof loadHomeDiscovery === 'function') { try { loadHomeDiscovery(); } catch (_) {} }
      reset();
      showToast('Refreshed', 'Fresh picks served up.', 'success');
    }, 520);
  });
}

/* ── Add / Edit Modal ────────────────────────────────────── */
function openAddModal () {
  state.editingId = null;
  _pendingAddPrefill = null;
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
  celebrateVisit(state.restaurants[idx].name);
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

  // Free plan: cap at 15 restaurants
  if (isNew && typeof isPremium === 'function' && !isPremium() && state.restaurants.length >= FREE_RESTAURANT_LIMIT) {
    showToast('Cub limit reached', `Cub includes up to ${FREE_RESTAURANT_LIMIT} spots. Upgrade to Grizzly for unlimited saves.`, 'info');
    if (typeof openUpgradeModal === 'function') openUpgradeModal('Unlimited restaurants');
    return;
  }

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

  if (isNew && _pendingAddPrefill && normalizeName(_pendingAddPrefill.name || name) === normalizeName(name)) {
    if (!entry.website && _pendingAddPrefill.website) entry.website = String(_pendingAddPrefill.website || '').trim();
    if (!entry.address && _pendingAddPrefill.address) entry.address = String(_pendingAddPrefill.address || '').trim();
    if (!entry.photo && _pendingAddPrefill.photo) entry.photo = String(_pendingAddPrefill.photo || '').trim();

    const preLat = Number(_pendingAddPrefill.lat);
    const preLng = Number(_pendingAddPrefill.lng ?? _pendingAddPrefill.lon);
    if (Number.isFinite(preLat) && Number.isFinite(preLng)) {
      entry.lat = preLat;
      entry.lng = preLng;
    }
  }

  if (state.editingId) {
    // Preserve lat/lng from original
    const orig = state.restaurants.find(r => r.id === state.editingId);
    entry.lat = orig?.lat || null;
    entry.lng = orig?.lng || null;
    entry.visits = orig?.visits || [];
    state.restaurants = state.restaurants.map(r => r.id === state.editingId ? entry : r);
    showToast('Updated', `"${name}" was refreshed in your list.`, 'success');
  } else {
    entry.visits = [];
    state.restaurants.unshift(entry);
    showToast('Saved', `"${name}" is now on your list.`, 'success');
  }

  // Geocode in background if address provided
  if (address) geocodeAddress(entry.id, address);

  saveData();
  renderAll();
  closeModal();
  _pendingAddPrefill = null;
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
  } catch { /* silent - geocoding is best-effort */ }
}

/* ── External links ──────────────────────────────────────── */
function buildDirectionsDestination (place) {
  if (!place) return '';
  const lat = Number(place.lat);
  const lon = Number(place.lon ?? place.lng);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `${lat},${lon}`;

  const name = String(place.name || '').trim();
  const address = String(place.address || '').trim();
  if (name && address) return `${name}, ${address}`;
  return address || name;
}

function buildGoogleDirectionsUrl (place) {
  const dest = buildDirectionsDestination(place);
  if (!dest) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}

function buildMenuSearchUrl (place) {
  if (!place) return '';
  const name = String(place.name || '').trim();
  const address = String(place.address || '').trim();
  const query = [name, address, 'menu'].filter(Boolean).join(' ');
  if (!query) return '';
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function openDirections (r) {
  const url = buildGoogleDirectionsUrl(r);
  if (!url) {
    showToast('No Location', 'This restaurant needs an address or coordinates for directions.', 'error');
    return;
  }
  window.open(url, '_blank', 'noopener');
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
      title: `Time to visit ${r.name}!`,
      body: `${r.cuisine ? cuisineEmoji(r.cuisine)+' '+r.cuisine+' · ' : ''}${r.address || ''}`,
      delay,
    });
  } else {
    setTimeout(() => {
      if (Notification.permission === 'granted') {
        new Notification(`Time to visit ${r.name}!`, { body: r.address || r.cuisine || '' });
      }
    }, delay);
  }

  state.settings[`reminder_${r.id}`] = when.toISOString();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  document.getElementById('detail-reminder-status').textContent = ` Reminder set for ${when.toLocaleString()}`;
  showToast(' Reminder Set!', `We'll remind you on ${when.toLocaleDateString()} at ${when.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`, 'success');
}

/* ── Share via SMS ─────────────────────────────────────── */
function shareViaSMS (r) {
  const lines = [r.name];
  if (r.cuisine) lines.push(`${cuisineEmoji(r.cuisine)} ${r.cuisine}`);
  if (r.address) lines.push(` ${r.address}`);
  if (r.googleRating) lines.push(`⭐ ${r.googleRating}/5`);
  if (r.website) lines.push(` ${r.website}`);
  lines.push('\n- via Feed The Bear');
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
  window.__ftbDirections = id => {
    const r = state.restaurants.find(x => x.id === id);
    if (r) {
      openDirections(r);
      return;
    }
    const nearby = getNearbyDiscoveryRows(30).find(x => String(x.id) === String(id));
    if (nearby) openDirections(nearby);
  };
}

function renderMap () {
  if (!state.mapLeaflet) return;
  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];
  const list = getFiltered().filter(r => r.lat && r.lng);
  const nearbyFallback = !list.length
    ? getNearbyDiscoveryRows(20).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
    : [];
  const mapRows = list.length ? list : nearbyFallback;
  if (!mapRows.length) {
    if (state.locationEnabled && Number.isFinite(state.userLat) && Number.isFinite(state.userLng)) {
      loadHomeDiscovery();
    }
    showToast('No Map Data', 'No map pins yet. Enable location and run Discover to load nearby markers.', 'info');
    return;
  }
  const bounds = [];
  mapRows.forEach(r => {
    const emoji = cuisineEmoji(r.cuisine);
    const isVisited = !r._nearbyElement && r.status === 'visited';
    const bg  = isVisited ? 'rgba(46,204,113,.9)' : 'rgba(74,144,217,.9)';
    const bdr = isVisited ? '#2ECC71' : '#9B7BE0';
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:38px;height:38px;background:${bg};border:3px solid ${bdr};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 3px 12px rgba(0,0,0,.6);cursor:pointer">${emoji}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
      popupAnchor: [0, -24],
    });
    const popup = `<div style="min-width:180px;font-family:system-ui,sans-serif">
      <div style="font-weight:700;font-size:.92rem;margin-bottom:3px">${escHtml(r.name)}</div>
      <div style="font-size:.77rem;color:#aaa;margin-bottom:6px">${r.cuisine ? escHtml(r.cuisine)+'&nbsp;&middot;&nbsp;' : ''}${priceDollars(r.priceRange)||''}${Number.isFinite(r._distMeters) ? `&nbsp;&middot;&nbsp;${fmtDist(r._distMeters)}` : ''}</div>
      ${r.googleRating ? `<div style="font-size:.8rem;margin-bottom:6px">⭐ ${r.googleRating}/5</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:8px">
        ${r._nearbyElement
          ? `<button onclick="openAddModalPreFilled('${String(r.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}','${String(r.cuisine || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',{name:'${String(r.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',address:'${String(r.address || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',website:'${String(r.website || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',lat:${Number.isFinite(r.lat) ? Number(r.lat) : 'null'},lon:${Number.isFinite(r.lng) ? Number(r.lng) : 'null'}})" style="flex:1;padding:5px 8px;background:#E8B15A;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Save</button>`
          : `<button onclick="window.__ftbOpenDetail('${r.id}')" style="flex:1;padding:5px 8px;background:#E8B15A;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Details</button>`}
        ${(r.address || (Number.isFinite(r.lat) && Number.isFinite(r.lng))) ? `<button onclick="window.__ftbDirections('${r.id}')" style="flex:1;padding:5px 8px;background:#9B7BE0;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Directions</button>` : ''}
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
    { label: 'Avg My Rating',     value: avgMy ? `${avgMy} ★` : '-', color: 'var(--gold)' },
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
  // Home sections are isolated: a failure in one must never cascade and
  // abort renderAll (which would leave later init wiring unattached).
  [renderWeeklyGoal, renderForYouHome, renderWeeklyRecapHome, renderMoodPicksHome]
    .forEach(fn => { try { fn(); } catch (err) { console.error(`${fn.name} failed:`, err); } });
}

function updateLocationBanner () {
  const banner = document.getElementById('location-banner');
  const dismissed = !!state.settings.locationBannerDismissed || localStorage.getItem(LOCATION_BANNER_DISMISSED_KEY) === '1';
  const restoringSavedLocation = !!state.settings.locationEnabled && !state.locationEnabled;
  const snoozed = isLocationBannerSnoozed();
  if (!state.locationEnabled && !dismissed && !restoringSavedLocation && !snoozed) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function setLocationBannerCooldown (ms = LOCATION_BANNER_SNOOZE_MS) {
  const until = Date.now() + Math.max(0, Number(ms) || 0);
  localStorage.setItem(LOCATION_BANNER_SNOOZE_UNTIL_KEY, String(until));
}

function isLocationBannerSnoozed () {
  const raw = localStorage.getItem(LOCATION_BANNER_SNOOZE_UNTIL_KEY);
  const until = Number(raw || 0);
  if (!Number.isFinite(until) || until <= 0) return false;
  if (Date.now() >= until) {
    localStorage.removeItem(LOCATION_BANNER_SNOOZE_UNTIL_KEY);
    return false;
  }
  return true;
}

/* ════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ════════════════════════════════════════════════════════════ */
function showToast (title, msg, type = 'default') {
  const safeTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const safeMsg = String(msg || '').replace(/\s+/g, ' ').trim();
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-body">
      <div class="toast-title">${escHtml(safeTitle)}</div>
      ${safeMsg ? `<div class="toast-msg">${escHtml(safeMsg)}</div>` : ''}
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
   CHAT BUDDY - BYTE CUB
   ════════════════════════════════════════════════════════════ */
const GREETINGS = [
  'Hey foodie. I\'m Byte Cub, your personal restaurant strategist. What should we plan first?',
  'Welcome back, hungry adventurer. Want a recommendation, a surprise pick, or your next list idea?',
  'Ready when you are. I can help you discover, organize, and decide where to eat next.',
];

const FOOD_TIPS = [
  'Pro tip: Always check if a restaurant takes reservations before you go - nothing worse than a long wait when you\'re starving! ',
  'Foodie fact: The best time to try a new restaurant is often a Tuesday or Wednesday - quieter, and the kitchen isn\'t overwhelmed!',
  'Hot tip: Follow your favorite restaurants on social media. They often post flash specials and secret menu items! ',
  'Did you know? Lunch menus at upscale restaurants often have the same great food at half the dinner price! ',
  'Sneak peek strategy: Check a restaurant\'s Google rating AND Yelp - two perspectives are better than one! ⭐',
  'The best restaurant in any city is usually NOT on the main tourist street. Wander a few blocks away! ',
  'When in doubt, order what the table next to you is having - if it looks amazing, it probably is! ',
];

const GENERAL_RESPONSES = [
  (q) => q.match(/\b(hi|hello|hey|yo|sup)\b/i) && randomFrom([
    'Hey! What foodie adventure shall we plan today?',
    'Hello, fellow food lover!  What can I help you find?',
    'Hi there! Ready to discover something delicious? ',
  ]),
  (q) => q.match(/\b(help|how|what can)\b/i) && `Here's how I can help:\n\n• **Find** restaurants by cuisine, rating, tags, or status\n• **Recommend** high-rated spots you still need to try\n• **Nearby** discovery based on your live location\n• **Surprise me** for instant decision relief\n• **Top cuisine** insights from your visit history\n• **Collections** to organize date nights, lunch spots, and more\n• **Share cards** so your picks look great on social\n\nSay what you're craving and I'll do the rest.`,
  (q) => q.match(/\b(nearby|close|near me|around me|area)\b/i) && nearbyResponse(),
  (q) => q.match(/\b(surprise|random|anything|don.?t care|pick for me|choose for me)\b/i) && surpriseMeResponse(),
  (q) => q.match(/\b(recommend|suggest|best|top|favorite|favourite)\b/i) && recommendResponse(),
  (q) => q.match(/\b(want.?to.?try|bucket|list|haven.?t visited|unvisited)\b/i) && wantToTryResponse(),
  (q) => q.match(/\b(visited|been|went|tried|already)\b/i) && visitedResponse(),
  (q) => q.match(/\b(tip|advice|hack|secret|trick|pro tip)\b/i) && randomFrom(FOOD_TIPS),
  (q) => q.match(/\b(note|notes|reminder|remember)\b/i) && notesResponse(),
  (q) => q.match(/\b(direction|navigate|how to get|get there)\b/i) && `To get directions, just click the **Directions** button on any restaurant card - it'll open Google Maps and route you right to the door! `,
  (q) => q.match(/\b(rate|rating|star|review)\b/i) && `You can rate any restaurant from 1-5 stars when you add or edit it. I also show the **Google rating** and review count so you know what others think! ⭐`,
  (q) => q.match(/\b(add|new restaurant|save)\b/i) && `Click **＋ Add Restaurant** in the header to add a new spot. You can even paste a Google Maps link and I'll auto-fill the details instantly! `,
  (q) => q.match(/\b(notification|alert|remind|ping)\b/i) && `Enable location tracking (the  button in the header) and I'll alert you whenever you're within walking distance of a restaurant on your list! `,
  (q) => q.match(/\b(cheap|budget|affordable|\$[^$])/i) && budgetResponse(),
  (q) => q.match(/\b(expensive|fancy|upscale|fine dining|\$\$\$\$)/i) && fancyResponse(),
  (q) => q.match(/\b(collection|list|group|category)\b/i) && collectionsResponse(),
  (q) => q.match(/\b(tag|tagged|#)\b/i) && tagQueryResponse(q),
  (q) => q.match(/\b(most|history|pattern|cuisine breakdown|eating most|ate most)\b/i) && topCuisineResponse(),
  (q) => cuisineFromQuery(q) && cuisineResponse(cuisineFromQuery(q)),
  // Phase 11 - enhanced responses
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
    `Try asking "surprise me", "what's nearby", or "top cuisine breakdown" and I'll pull your best options.`,
    `Ask me for "date night ideas", "best rated", or "my collections" and I'll curate from your list. `,
    `Tell me a cuisine like "Thai" or "Sushi", and I'll instantly surface your top choices.`,
  ]);
}

function getNearbyDiscoveryRows (limit = 12) {
  const rows = Array.isArray(_homeDiscCache?.elements) ? _homeDiscCache.elements : [];
  if (!rows.length) return [];
  return rows.slice(0, Math.max(1, Number(limit) || 12)).map((el, idx) => {
    const tags = el.tags || {};
    const name = String(tags.name || '').trim() || `Nearby Spot ${idx + 1}`;
    const cuisine = String((tags.cuisine || tags.amenity || 'restaurant').split(';')[0] || '').trim();
    const lat = Number.isFinite(el.lat ?? el.center?.lat) ? Number(el.lat ?? el.center?.lat) : null;
    const lng = Number.isFinite(el.lon ?? el.center?.lon) ? Number(el.lon ?? el.center?.lon) : null;
    const dist = Number.isFinite(el._dist)
      ? Number(el._dist)
      : (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(state.userLat) && Number.isFinite(state.userLng)
          ? haversine(state.userLat, state.userLng, lat, lng)
          : Infinity);
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ');
    return {
      id: `nearby-${el.id || idx}`,
      _nearbyElement: true,
      key: `nearby-${el.id || idx}`,
      name,
      cuisine,
      amenity: tags.amenity || 'restaurant',
      status: 'want-to-try',
      priceRange: estimatePriceLevel({ tags, cuisine, amenity: tags.amenity || 'restaurant' }),
      website: tags.website || tags['contact:website'] || tags.url || '',
      address,
      lat,
      lng,
      _distMeters: dist,
      myRating: 0,
      googleRating: Number(tags.stars || 0) || 0,
      isFavorite: false,
      notes: '',
      visits: [],
    };
  });
}

function nearbyResponse () {
  if (!state.locationEnabled && !getNearbyDiscoveryRows(1).length) {
    return `Enable location tracking first (click the location button in the header) and I will show what is nearby right now.`;
  }
  const nearby = state.restaurants
    .filter(r => r.lat && r.lng)
    .map(r => ({ ...r, dist: haversine(state.userLat, state.userLng, r.lat, r.lng) }))
    .filter(r => r.dist < 5000)
    .sort((a,b) => a.dist - b.dist)
    .slice(0, 5);

  if (!nearby.length) {
    const liveNearby = getNearbyDiscoveryRows(5).filter(r => Number.isFinite(r._distMeters));
    if (!liveNearby.length) return `No nearby places are cached yet. Open Discover and run a scan so I can suggest local options.`;
    const list = liveNearby.map(r => `${cuisineEmoji(r.cuisine)} ${r.name} (${fmtDist(r._distMeters)})`).join(' • ');
    return `You do not have saved nearby spots yet, but live nearby picks are: ${list}`;
  }
  const list = nearby.map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} (${fmtDist(r.dist)})</span>`
  ).join('');
  return `Here's what's close to you right now! \n${list}`;
}

function recommendResponse () {
  const unvisited = state.restaurants.filter(r => r.status === 'want-to-try' && r.googleRating > 0);
  if (!unvisited.length) {
    const top = [...state.restaurants].sort((a,b) => (b.googleRating||0) - (a.googleRating||0)).slice(0,3);
    if (!top.length) {
      const nearby = getNearbyDiscoveryRows(3);
      if (!nearby.length) return `Your saved list is empty, and I do not have live nearby data yet. Open Discover, run a scan, and I will recommend from nearby immediately.`;
      const nearbyList = nearby.map(r => `${cuisineEmoji(r.cuisine)} ${r.name}${Number.isFinite(r._distMeters) ? ` (${fmtDist(r._distMeters)})` : ''}`).join(' • ');
      return `You are starting fresh, so here are live nearby recommendations: ${nearbyList}. Tap Discover to save your favorites.`;
    }
    const list = top.map(r => `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} ⭐${r.googleRating}</span>`).join('');
    return `Your top-rated spots:\n${list}`;
  }
  const top = unvisited.sort((a,b) => b.googleRating - a.googleRating).slice(0, 3);
  const list = top.map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} - ⭐${r.googleRating}</span>`
  ).join('');
  return `Here are your highest-rated spots you haven't tried yet! \n${list}\n\nGet out there and eat!`;
}

function wantToTryResponse () {
  const list = state.restaurants.filter(r => r.status === 'want-to-try');
  if (!list.length) return `Your want-to-try list is empty. Start adding restaurants you've been eyeing! `;
  const items = list.slice(0,5).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name}</span>`
  ).join('');
  return `You've got **${list.length}** restaurants on your want-to-try list! \n${items}${list.length > 5 ? `\n…and ${list.length-5} more!` : ''}`;
}

function visitedResponse () {
  const list = state.restaurants.filter(r => r.status === 'visited');
  if (!list.length) return `You haven't marked any restaurants as visited yet. Go eat something! `;
  const items = list.slice(0,5).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name}${r.myRating ? ` ${'★'.repeat(r.myRating)}` : ''}</span>`
  ).join('');
  return `You've visited **${list.length}** place${list.length>1?'s':''}! \n${items}`;
}

function notesResponse () {
  const withNotes = state.restaurants.filter(r => r.notes);
  if (!withNotes.length) return `No notes saved yet. When you add or edit a restaurant, you can jot down must-try dishes, tips, or reminders! `;
  const item = randomFrom(withNotes);
  return `Here's a note from **${item.name}**: *"${item.notes.slice(0,120)}${item.notes.length>120?'…':''}"* `;
}

function budgetResponse () {
  const cheap = state.restaurants.filter(r => r.priceRange === 1);
  if (!cheap.length) return `No budget spots on your list yet. Add some $ restaurants and I'll help you find a bargain! `;
  const items = cheap.slice(0,4).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} ($)</span>`
  ).join('');
  return `Budget eats on your list! \n${items}`;
}

function fancyResponse () {
  const fancy = state.restaurants.filter(r => r.priceRange >= 3);
  if (!fancy.length) return `No fine dining spots on your list yet. Time to live a little! `;
  const items = fancy.slice(0,4).map(r =>
    `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} (${priceDollars(r.priceRange)})</span>`
  ).join('');
  return `Your fancy picks! \n${items}`;
}

function cuisineFromQuery (q) {
  const cuisines = [...new Set(state.restaurants.map(r => r.cuisine).filter(Boolean))];
  return cuisines.find(c => q.toLowerCase().includes(c.toLowerCase())) || null;
}

function cuisineResponse (cuisine) {
  const list = state.restaurants.filter(r =>
    (r.cuisine||'').toLowerCase() === cuisine.toLowerCase()
  );
  if (!list.length) return `No ${cuisine} restaurants on your list yet! Add one `;
  const items = list.slice(0,5).map(r =>
    `<span class="chip-link" data-id="${r.id}">${r.name}${r.googleRating ? ` ⭐${r.googleRating}` : ''}</span>`
  ).join('');
  return `Your **${cuisine}** spots (${list.length} total):\n${items}`;
}

function restaurantDetailResponse (r) {
  const dist = distOf(r);
  const distStr = dist < Infinity ? ` - ${fmtDist(dist)} away` : '';
  return `Here's what I know about **${r.name}**:\n\n` +
    (r.googleRating ? `⭐ Google: ${r.googleRating}/5\n` : '') +
    (r.myRating ? `⭐ Your rating: ${r.myRating}/5\n` : '') +
    (r.address ? ` ${r.address}${distStr}\n` : '') +
    (r.priceRange ? ` ${priceDollars(r.priceRange)}\n` : '') +
    (r.tags?.length ? ` Tags: ${r.tags.join(', ')}\n` : '') +
    (r.notes ? `\n "${r.notes}"` : '') +
    `\n\n<span class="chip-link" data-id="${r.id}">View full details</span>`;
}

function surpriseMeResponse () {
  const unvisited = state.restaurants.filter(r => r.status === 'want-to-try');
  const pool = unvisited.length ? unvisited : state.restaurants;
  if (!pool.length) return `Your list is empty! Add some restaurants first.`;
  const r = randomFrom(pool);
  return ` How about… **${r.name}**? ${r.cuisine ? `${cuisineEmoji(r.cuisine)} ${r.cuisine} vibes.` : ''} ${r.googleRating ? `Rated ⭐${r.googleRating}.` : ''} ${r.address ? ` ${r.address}` : ''}\n\n<span class="chip-link" data-id="${r.id}">View details</span>`;
}

function topCuisineResponse () {
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) return `No visited restaurants yet! Mark some as visited to see your cuisine breakdown `;
  const counts = {};
  visited.forEach(r => { const c = r.cuisine || 'Other'; counts[c] = (counts[c]||0)+1; });
  const sorted = Object.entries(counts).sort(([,a],[,b]) => b-a).slice(0,5);
  const total = visited.length;
  const lines = sorted.map(([c,n]) => `${cuisineEmoji(c)} **${c}** - ${n} visit${n>1?'s':''} (${Math.round(n/total*100)}%)`).join('\n');
  return `Your foodie habits revealed! \n\n${lines}\n\n*Total: ${total} restaurants visited*`;
}

function collectionsResponse () {
  const cols = state.settings.collections || [];
  if (!cols.length) return `You haven't created any custom lists yet. Tap the  button to create lists like "Date Night", "Lunch Spots", or "Hidden Gems"! `;
  const lines = cols.map(c => {
    const count = state.restaurants.filter(r => r.collectionId === c.id).length;
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.color};margin-right:4px"></span> **${c.name}** - ${count} restaurant${count!==1?'s':''}`;
  }).join('\n');
  return `Your custom lists \n\n${lines}`;
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
  if (!allTags.length) return `No tags yet! Add tags to your restaurants when you save or edit them to quickly filter by vibe, occasion, or food type. `;
  return `Your tags: ${allTags.map(t=>`**#${t}**`).join(', ')}\n\nAsk me about a specific tag!`;
}

const QUICK_REPLIES = [
  'Recommend something ',
  'Surprise me! ',
  'What\'s nearby? ',
  'Date night ideas ',
  'Top cuisine breakdown ',
  'Want to try list ',
  'My collections ',
  'Food tip! ',
];

function randomFrom (arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ── Chat UI ──────────────────────────────────────────────── */
function addChatMsg (text, role = 'bot') {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = role === 'bot' ? 'BC' : 'YOU';

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
  avatar.textContent = 'BC';

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

/* Allow safe photo URLs, including local app assets used by offline/PWA mode. */
function safeUrl (url) {
  if (!url) return '';
  const raw = String(url).trim();
  if (!raw) return '';
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(raw)) return raw;
  if (/^(\.\/)?assets\//i.test(raw) || /^feedbear\.png$/i.test(raw)) return raw.replace(/["'()\\]/g, '');
  try {
    const parsed = new URL(raw, window.location.href);
    if (!['https:', 'http:', 'file:'].includes(parsed.protocol)) return '';
    return parsed.href.replace(/["'()\\]/g, '');
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
  const anyOpen = !!document.querySelector('.modal-overlay:not(.hidden), #chat-panel:not(.hidden)');
  if (!anyOpen) {
    document.getElementById('ui-overlay').classList.add('hidden');
    document.body.classList.remove('overlay-open');
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
  const appearance = loadUserProfile()?.appearance || {};
  if (!state.settings.themeChoice && appearance.themeChoice) state.settings.themeChoice = appearance.themeChoice;
  if (!state.settings.theme && appearance.themeMode) state.settings.theme = appearance.themeMode;
  if (!state.settings.uiDensity && appearance.uiDensity) state.settings.uiDensity = appearance.uiDensity;
  if (!state.settings.uiCorners && appearance.uiCorners) state.settings.uiCorners = appearance.uiCorners;
  if (!state.settings.uiMotion && appearance.uiMotion) state.settings.uiMotion = appearance.uiMotion;

  if (state.settings.themeChoice === 'auto') state.settings.themeManual = false;
  const initialChoice = state.settings.themeChoice || (state.settings.theme === 'light' ? 'light' : 'dark');
  if (initialChoice !== 'auto') {
    applyThemeChoice(initialChoice, { manual: !!state.settings.themeManual, persist: true });
  }
  applyPersonalizationSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const light = document.body.classList.contains('light-mode');
    applyThemeChoice(light ? 'dark' : 'light');
  });
}

function setAutoAmbientTheme (announce = true) {
  state.settings.themeManual = false;
  state.settings.themeChoice = 'auto';
  applyAutoThemeByClock({ persist: true, announce });
  scheduleNextAutoThemeTick();
}

function toggleThemeFromPalette () {
  const light = document.body.classList.contains('light-mode');
  applyThemeChoice(light ? 'dark' : 'light', { manual: true, persist: true });
}

/* ════════════════════════════════════════════════════════════
   ONBOARDING TOUR
   ════════════════════════════════════════════════════════════ */
const ONBOARDING_STEPS = [
  { title: 'Welcome to Feed The Bear', desc: 'Build your private dining archive: save standout spots, track visits, and keep every great find in one polished home.' },
  { title: 'Capture Places Instantly', desc: 'Add restaurants in seconds, or paste a Google Maps URL to auto-fill details and save time.' },
  { title: 'Discover Around You', desc: 'Use Map view and Nearby Discovery to find what is close now, then save your favorites with one tap.' },
  { title: 'See Your Food Story', desc: 'Stats turns your history into insight: top cuisines, ratings, trends, and your strongest picks.' },
  { title: 'Let Byte Cub Curate', desc: 'Ask for smart recommendations, tie breakers, and refined shareable cards.' },
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
  document.getElementById('onboarding-title').textContent = step.title;
  document.getElementById('onboarding-desc').textContent = step.desc;
  const isLast = _onboardingStep === ONBOARDING_STEPS.length - 1;
  document.getElementById('onboarding-next-btn').textContent = isLast ? 'Get Started' : 'Next >';
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
   NEARBY DISCOVERY - Full-screen Grubhub-style restaurant list
   ════════════════════════════════════════════════════════════ */

let _discAllResults  = [];   // full result set for client-side filtering
let _discActiveCuisine = 'all';
let _discSort = 'distance';

async function discoverNearby () {
  if (!(await ensureLocationForDiscovery())) return;

  const overlay = document.getElementById('nearby-overlay');
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');

  // Update location label
  const locLabel = document.getElementById('disc-location-label');
  if (locLabel) locLabel.textContent = ' Near your current location';

  // Wire controls once
  _discWireControls();

  // Run initial fetch
  await _discFetch();
}

function _discWireControls () {
  // Only attach listeners once (guard with a flag on the element)
  const overlay = document.getElementById('nearby-overlay');
  if (overlay._wired) return;
  overlay._wired = true;

  document.getElementById('disc-search')?.addEventListener('input', _discApplyFilters);
  document.getElementById('disc-sort')?.addEventListener('change', e => {
    _discSort = e.target.value;
    _discApplyFilters();
  });
  document.getElementById('disc-radius')?.addEventListener('change', () => _discFetch());
  document.getElementById('disc-refresh-btn')?.addEventListener('click', () => _discFetch());

  // Chip clicks (delegate since chips are dynamic)
  document.getElementById('disc-cuisine-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.disc-chip');
    if (!chip) return;
    _discActiveCuisine = chip.dataset.cuisine;
    document.querySelectorAll('#disc-cuisine-chips .disc-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    _discApplyFilters();
  });
}

async function _discFetch () {
  const resultsEl = document.getElementById('nearby-results');
  const metaEl    = document.getElementById('disc-result-meta');
  const chipWrap  = document.getElementById('disc-cuisine-chips');
  if (!resultsEl) return;

  resultsEl.innerHTML = '<div class="disc-loading"><span class="disc-spinner"></span>Sniffing out restaurants near you…</div>';
  if (metaEl) metaEl.textContent = '';

  const { userLat: lat, userLng: lng } = state;
  const radius = parseInt(document.getElementById('disc-radius')?.value) || 3219;

  try {
    const q = `[out:json][timeout:20];(node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"](around:${radius},${lat},${lng});way["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"](around:${radius},${lat},${lng}););out center 60;`;
    const elementsRaw = await fetchOverpassElements(q, {
      timeoutMs: 18000,
      nominatimFallback: true,
      lat,
      lng,
      radiusMeters: radius,
      limit: 60,
    });

    const savedNames = new Set(state.restaurants.map(r => normalizeName(r.name)));
    const myCuisines = {};
    state.restaurants.filter(r => r.myRating >= 4 && r.cuisine).forEach(r => {
      const c = (r.cuisine || '').toLowerCase();
      myCuisines[c] = (myCuisines[c] || 0) + (r.myRating || 3);
    });

    _discAllResults = (elementsRaw || [])
      .filter(el => el.tags?.name)
      .map(el => {
        const tags   = el.tags || {};
        const elLat  = el.lat ?? el.center?.lat;
        const elLon  = el.lon ?? el.center?.lon;
        const dist   = (elLat != null && elLon != null) ? haversine(lat, lng, elLat, elLon) : Infinity;
        const rawCuisines = (tags.cuisine || '').split(';').map(s => s.trim().replace(/_/g, ' ')).filter(Boolean);
        const cuisine = rawCuisines[0] || '';
        const amenity = tags.amenity || 'restaurant';

        // Taste-match score
        let matchScore = 0;
        Object.entries(myCuisines).forEach(([c, w]) => {
          if (cuisine.toLowerCase().includes(c) || c.includes(cuisine.toLowerCase())) matchScore += w;
        });
        if (amenity === 'restaurant') matchScore += 5;
        if (tags.opening_hours)       matchScore += 3;
        if (tags.website)             matchScore += 2;
        if (tags['addr:street'])      matchScore += 1;

        // Check if open now (simple heuristic - mark unknown if no hours)
        const openNow = _discIsOpenNow(tags.opening_hours);

        const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
        const city   = tags['addr:city'] || '';

        return {
          name: tags.name,
          cuisine,
          rawCuisines,
          amenity,
          dist,
          lat: Number.isFinite(elLat) ? Number(elLat) : null,
          lon: Number.isFinite(elLon) ? Number(elLon) : null,
          matchScore,
          openNow,
          street,
          city,
          website: tags.website || '',
          phone:   tags.phone || '',
          saved:   savedNames.has(normalizeName(tags.name)),
        };
      })
      .sort((a, b) => a.dist - b.dist);   // default: nearest first

    if (!_discAllResults.length) {
      resultsEl.innerHTML = `<div class="disc-empty">
        <div class="disc-empty-icon">FTB</div>
        <div class="disc-empty-title">No spots found nearby</div>
        <div class="disc-empty-sub">Try increasing the radius above.</div>
      </div>`;
      return;
    }

    // Build cuisine chip list from results
    _discBuildChips(_discAllResults, chipWrap);

    _discActiveCuisine = 'all';
    _discSort = document.getElementById('disc-sort')?.value || 'distance';
    _discApplyFilters();

  } catch (err) {
    resultsEl.innerHTML = `<div class="disc-empty">
      <div class="disc-empty-icon"></div>
      <div class="disc-empty-title">${err?.name === 'AbortError' ? 'Took too long' : 'Connection error'}</div>
      <div class="disc-empty-sub">Check your connection and tap the refresh button.</div>
    </div>`;
  }
}

function _discBuildChips (results, wrap) {
  if (!wrap) return;
  const counts = {};
  results.forEach(r => {
    const c = r.cuisine || r.amenity;
    if (c) counts[c] = (counts[c] || 0) + 1;
  });
  const topCuisines = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c]) => c);

  const amenityEmoji = { restaurant:'', cafe:'☕', fast_food:'', bar:'', pub:'', food_court:'', ice_cream:'' };

  wrap.innerHTML = `<button class="disc-chip active" data-cuisine="all">All <span class="disc-chip-count">${results.length}</span></button>` +
    topCuisines.map(c => {
      const emoji = cuisineEmoji(c) || amenityEmoji[c] || '';
      const label = c.charAt(0).toUpperCase() + c.slice(1);
      return `<button class="disc-chip" data-cuisine="${escHtml(c)}">${emoji} ${escHtml(label)} <span class="disc-chip-count">${counts[c]}</span></button>`;
    }).join('');
}

function _discApplyFilters () {
  const query   = (document.getElementById('disc-search')?.value || '').trim().toLowerCase();
  const cuisine = _discActiveCuisine;
  const sort    = document.getElementById('disc-sort')?.value || 'distance';
  const metaEl  = document.getElementById('disc-result-meta');

  let results = _discAllResults.filter(r => {
    if (cuisine !== 'all' && r.cuisine !== cuisine && r.amenity !== cuisine) return false;
    if (query && !r.name.toLowerCase().includes(query) && !r.cuisine.toLowerCase().includes(query)) return false;
    return true;
  });

  if (sort === 'distance') {
    results = results.slice().sort((a, b) => a.dist - b.dist);
  } else if (sort === 'match') {
    results = results.slice().sort((a, b) => b.matchScore - a.matchScore);
  } else if (sort === 'type') {
    results = results.slice().sort((a, b) => a.amenity.localeCompare(b.amenity) || a.dist - b.dist);
  }

  if (metaEl) {
    metaEl.textContent = results.length
      ? `${results.length} spot${results.length !== 1 ? 's' : ''} found`
      : '';
  }

  const resultsEl = document.getElementById('nearby-results');
  if (!results.length) {
    resultsEl.innerHTML = `<div class="disc-empty">
      <div class="disc-empty-icon"></div>
      <div class="disc-empty-title">No matches</div>
      <div class="disc-empty-sub">Try a different filter or search term.</div>
    </div>`;
    return;
  }

  const myCuisines = new Set(
    state.restaurants.filter(r => r.myRating >= 4 && r.cuisine).map(r => r.cuisine.toLowerCase())
  );
  const amenityLabel = { restaurant:'Restaurant', cafe:'Café', fast_food:'Fast Food', bar:'Bar', pub:'Pub', food_court:'Food Court', ice_cream:'Ice Cream' };
  const amenityEmoji = { restaurant:'', cafe:'☕', fast_food:'', bar:'', pub:'', food_court:'', ice_cream:'' };

  resultsEl.innerHTML = results.map(r => {
    const emoji    = cuisineEmoji(r.cuisine) || amenityEmoji[r.amenity] || '';
    const typeLabel = r.cuisine
      ? (r.cuisine.charAt(0).toUpperCase() + r.cuisine.slice(1))
      : (amenityLabel[r.amenity] || 'Restaurant');
    const distStr  = r.dist < Infinity ? fmtDist(r.dist) : '';
    const isMatch  = r.cuisine && myCuisines.has(r.cuisine.toLowerCase());

    const safeName    = escHtml(r.name).replace(/'/g, "\\'");
    const safeCuisine = escHtml(r.cuisine).replace(/'/g, "\\'");
    const saveAddress = [String(r.street || '').trim(), String(r.city || '').trim()].filter(Boolean).join(', ');
    const safeAddress = saveAddress.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeWebsite = String(r.website || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return `<div class="disc-card${r.saved ? ' disc-card-saved' : ''}">
      <div class="disc-card-thumb" aria-hidden="true">${emoji}</div>
      <div class="disc-card-body">
        <div class="disc-card-name">${escHtml(r.name)}</div>
        <div class="disc-card-meta">
          <span>${escHtml(typeLabel)}</span>
          ${distStr ? `<span class="disc-meta-dot">·</span><span class="disc-card-dist"> ${distStr} away</span>` : ''}
        </div>
        ${r.street ? `<div class="disc-card-addr">${escHtml(r.street)}${r.city ? ', ' + escHtml(r.city) : ''}</div>` : ''}
        <div class="disc-card-tags">
          ${r.openNow === true  ? '<span class="disc-tag disc-tag-open">Open Now</span>'   : ''}
          ${r.openNow === false ? '<span class="disc-tag disc-tag-closed">Closed</span>'   : ''}
          ${isMatch             ? '<span class="disc-tag disc-tag-match"> Matches your taste</span>' : ''}
          ${r.saved             ? '<span class="disc-tag disc-tag-saved">✓ In your list</span>'        : ''}
        </div>
      </div>
      <div class="disc-card-action">
        ${r.saved
          ? `<div class="disc-saved-mark">✓</div>`
          : `<button class="disc-save-btn" onclick="openAddModalPreFilled('${safeName}','${safeCuisine}',{name:'${safeName}',address:'${safeAddress}',website:'${safeWebsite}',lat:${Number.isFinite(r.lat) ? Number(r.lat) : 'null'},lon:${Number.isFinite(r.lon) ? Number(r.lon) : 'null'}});document.getElementById('nearby-overlay').classList.add('hidden');maybeHideOverlay();" aria-label="Save ${escHtml(r.name)}">+ Save</button>`
        }
      </div>
    </div>`;
  }).join('');
}

// Simple open-now check using OpenStreetMap opening_hours string
function _discIsOpenNow (ohStr) {
  if (!ohStr) return null;   // unknown
  if (/^24\/7$/i.test(ohStr.trim())) return true;
  try {
    const now   = new Date();
    const day   = ['Su','Mo','Tu','We','Th','Fr','Sa'][now.getDay()];
    const hhmm  = now.getHours() * 60 + now.getMinutes();
    // Match patterns like "Mo-Fr 11:00-22:00" or "Mo-Su 09:00-23:00"
    const segs  = ohStr.split(';').map(s => s.trim());
    for (const seg of segs) {
      const m = seg.match(/([A-Za-z,\-]+)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
      if (!m) continue;
      const dayPart  = m[1];
      const openMin  = _ohToMin(m[2]);
      const closeMin = _ohToMin(m[3]);
      if (_dayInRange(day, dayPart) && hhmm >= openMin && hhmm < closeMin) return true;
    }
    return false;
  } catch { return null; }
}
const _ohToMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function _dayInRange (day, part) {
  const DAYS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
  const segments = part.split(',');
  return segments.some(seg => {
    if (seg.includes('-')) {
      const [s, e] = seg.split('-');
      const si = DAYS.indexOf(s.trim()), ei = DAYS.indexOf(e.trim()), di = DAYS.indexOf(day);
      return si !== -1 && ei !== -1 && di >= si && di <= ei;
    }
    return seg.trim() === day;
  });
}

/* ════════════════════════════════════════════════════════════
   SHAREABLE RESTAURANT CARD - Canvas API
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
  bg.addColorStop(0,'#15111C'); bg.addColorStop(1,'#281F34');
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
  if (r.address) { ctx.fillStyle = '#AAA'; ctx.font = '17px system-ui,sans-serif'; ctx.fillText(` ${r.address.length>55?r.address.slice(0,55)+'…':r.address}`, 50, 318); }
  if (r.notes) { ctx.fillStyle = '#777'; ctx.font = 'italic 15px system-ui,sans-serif'; ctx.fillText(`"${r.notes.length>72?r.notes.slice(0,72)+'…':r.notes}"`, 50, 356); }
  if (r.priceRange) { ctx.fillStyle = '#F4C430'; ctx.font = 'bold 20px monospace'; ctx.fillText(priceDollars(r.priceRange), 50, 408); }
  const bc = r.status==='visited' ? '#2ECC71' : '#9B7BE0';
  ctx.fillStyle = bc+'33'; ftbRoundRect(ctx, r.priceRange?110:50, 390, 130, 28, 8); ctx.fill();
  ctx.fillStyle = bc; ctx.font = 'bold 13px system-ui,sans-serif';
  ctx.fillText(r.status==='visited'?'✅ Visited':' Want to Try', r.priceRange?122:62, 409);
  ctx.fillStyle = '#E8B15A'; ctx.font = 'bold 15px system-ui,sans-serif';
  ctx.fillText('Feed The Bear', W-195, H-18);
  canvas.toBlob(blob => {
    const file = new File([blob], `${r.name.replace(/[^a-z0-9]/gi,'_')}-ftb.png`, {type:'image/png'});
    if (navigator.share && navigator.canShare?.({files:[file]})) {
      navigator.share({title:r.name, text:`Check out ${r.name} on Feed The Bear`, files:[file]}).catch(()=>{});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=file.name; a.click(); URL.revokeObjectURL(url);
    }
    showToast(' Card Ready!', `"${r.name}" card saved!`, 'success');
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
  showToast(' Deleted', `${n} restaurant${n>1?'s':''} removed.`, 'info');
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
  showToast(' Tagged!', `"${t}" added to ${state.selectedIds.size} restaurants.`, 'success');
}
function bulkExport () {
  const sel = state.restaurants.filter(r => state.selectedIds.has(r.id));
  if (!sel.length) return;
  const blob = new Blob([JSON.stringify(sel, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=`ftb-export-${iso()}.json`; a.click(); URL.revokeObjectURL(url);
  showToast(' Exported!', `${sel.length} restaurants saved.`, 'success');
}
function bulkMoveToCollection () {
  if (!state.selectedIds.size) return;
  const cols = state.settings.collections || [];
  if (!cols.length) { showToast('No Lists', 'Create a list first via the  button.', 'info'); return; }
  const names = cols.map((c,i) => `${i+1}. ${c.name}`).join('\n');
  const choice = prompt(`Move to which list?\n\n${names}\n\n(Enter number, or 0 to remove from all):`);
  const num = parseInt(choice);
  if (isNaN(num)) return;
  const col = num===0 ? null : cols[num-1];
  state.selectedIds.forEach(id => { const idx = state.restaurants.findIndex(r=>r.id===id); if (idx!==-1) state.restaurants[idx].collectionId = col?.id||null; });
  saveData(); toggleBulkMode(); renderAll();
  showToast(' Moved!', col ? `Added to "${col.name}".` : 'Removed from all lists.', 'success');
}

/* ════════════════════════════════════════════════════════════
   CUSTOM LISTS / COLLECTIONS
   ════════════════════════════════════════════════════════════ */
const COLLECTION_COLORS = ['#E8B15A','#E74C3C','#9B59B6','#3498DB','#2ECC71','#F39C12','#1ABC9C','#E91E63'];
let _newCollectionColor = COLLECTION_COLORS[0];
let _sharedManageCollectionId = null;
const _sharedRealtimeUnsubs = {};

function getSharedListsMap () {
  if (!state.settings.sharedLists || typeof state.settings.sharedLists !== 'object') state.settings.sharedLists = {};
  return state.settings.sharedLists;
}

function getCollaboratorId () {
  const key = 'ftb_collab_id_v1';
  let id = localStorage.getItem(key);
  if (!id) {
    id = uid();
    localStorage.setItem(key, id);
  }
  return id;
}

function getActorName () {
  const profile = loadUserProfile?.() || null;
  if (profile?.name) return profile.name;
  if (typeof _auth !== 'undefined' && _auth?.currentUser) {
    return _auth.currentUser.displayName || _auth.currentUser.email || 'Foodie';
  }
  return 'Foodie';
}

function sharedAgo (ts) {
  const ms = Math.max(0, Date.now() - Number(ts || 0));
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ensureSharedMeta (collectionId) {
  const map = getSharedListsMap();
  if (!map[collectionId]) {
    map[collectionId] = {
      token: uid(),
      cloudId: null,
      ownerName: getActorName(),
      collaborators: [],
      activity: [],
      updatedAt: Date.now(),
    };
  }
  const meta = map[collectionId];
  if (!Array.isArray(meta.collaborators)) meta.collaborators = [];
  if (!Array.isArray(meta.activity)) meta.activity = [];
  if (!meta.ownerName) meta.ownerName = getActorName();
  return meta;
}

function getSharedCloudId (collectionId) {
  const meta = ensureSharedMeta(collectionId);
  if (!meta.cloudId) {
    const base = `${collectionId}-${meta.token || uid()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    meta.cloudId = base.slice(0, 120);
  }
  return meta.cloudId;
}

function syncSharedMetaToCloud (collectionId) {
  const meta = getSharedListsMap()[collectionId];
  if (!meta || !window._ftbUid || typeof fbSharedListUpsert !== 'function') return;
  const col = (state.settings.collections || []).find(c => c.id === collectionId);
  if (!col) return;
  const cloudId = getSharedCloudId(collectionId);
  fbSharedListUpsert(cloudId, {
    localId: collectionId,
    name: col.name,
    color: col.color,
    token: meta.token,
    ownerName: meta.ownerName,
    collaborators: meta.collaborators || [],
    activity: meta.activity || [],
    updatedAt: Date.now(),
  });
}

function applySharedCloudData (collectionId, data) {
  if (!data) return;
  const meta = ensureSharedMeta(collectionId);
  if (data.token) meta.token = data.token;
  if (data.cloudId) meta.cloudId = data.cloudId;
  if (data.ownerName) meta.ownerName = data.ownerName;
  if (Array.isArray(data.collaborators)) meta.collaborators = data.collaborators;
  if (Array.isArray(data.activity)) meta.activity = data.activity;
  meta.updatedAt = data.updatedAt || Date.now();
}

function refreshSharedRealtimeSubscriptions () {
  Object.values(_sharedRealtimeUnsubs).forEach(unsub => { try { unsub(); } catch {} });
  Object.keys(_sharedRealtimeUnsubs).forEach(k => delete _sharedRealtimeUnsubs[k]);
  if (!window._ftbUid || typeof fbSharedListSubscribe !== 'function') return;

  Object.entries(getSharedListsMap()).forEach(([cid, meta]) => {
    const cloudId = getSharedCloudId(cid);
    _sharedRealtimeUnsubs[cid] = fbSharedListSubscribe(cloudId, data => {
      if (!data) return;
      applySharedCloudData(cid, { ...data, cloudId });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      renderCollectionsList();
      if (_sharedManageCollectionId === cid) renderSharedManageModal();
    });
  });
}

function logSharedActivity (collectionId, text) {
  const meta = ensureSharedMeta(collectionId);
  meta.activity.unshift({ id: uid(), text, ts: Date.now() });
  meta.activity = meta.activity.slice(0, 10);
  meta.updatedAt = Date.now();
  syncSharedMetaToCloud(collectionId);
}

function addOrUpdateCollaborator (collectionId, role = 'editor') {
  const meta = ensureSharedMeta(collectionId);
  const cid = getCollaboratorId();
  const name = getActorName();
  const existing = meta.collaborators.find(c => c.id === cid);
  if (existing) {
    existing.name = name;
    existing.role = role;
    existing.updatedAt = Date.now();
  } else {
    meta.collaborators.push({ id: cid, name, role, updatedAt: Date.now() });
  }
  meta.updatedAt = Date.now();
  syncSharedMetaToCloud(collectionId);
}

function encodeInvitePayload (obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

function decodeInvitePayload (encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

function buildCollectionShareLink (collectionId, role = 'editor') {
  const col = (state.settings.collections || []).find(c => c.id === collectionId);
  if (!col) return '';
  const meta = ensureSharedMeta(collectionId);
  const payload = {
    v: 1,
    id: collectionId,
    t: meta.token,
    n: col.name,
    c: col.color,
    o: meta.ownerName,
    r: role,
  };
  return `${location.origin}${location.pathname}#join-list=${encodeURIComponent(encodeInvitePayload(payload))}`;
}

function shareCollectionInvite (collectionId) {
  const col = (state.settings.collections || []).find(c => c.id === collectionId);
  if (!col) return;
  const asked = (prompt('Invite role for this link: owner, editor, or viewer', 'editor') || 'editor').trim().toLowerCase();
  const role = ['owner', 'editor', 'viewer'].includes(asked) ? asked : 'editor';
  addOrUpdateCollaborator(collectionId, 'owner');
  const link = buildCollectionShareLink(collectionId, role);
  if (!link) return;

  const done = () => {
    logSharedActivity(collectionId, `${getActorName()} shared link (${role})`);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    renderCollectionsList();
    showToast('Invite ready ', `Share link for ${col.name} copied.`, 'success');
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(link).then(done).catch(() => {
      prompt('Copy this shared list link:', link);
      done();
    });
  } else {
    prompt('Copy this shared list link:', link);
    done();
  }
}

function joinCollectionFromPayload (payload) {
  if (!payload?.id || !payload?.t) return false;
  if (!state.settings.collections) state.settings.collections = [];

  let target = state.settings.collections.find(c => c.id === payload.id) || null;
  const map = getSharedListsMap();
  const existingMeta = map[payload.id];

  if (target && existingMeta?.token && existingMeta.token !== payload.t) {
    const newId = `${payload.id}-${uid().slice(0, 4)}`;
    target = null;
    payload.id = newId;
  }

  if (!target) {
    target = {
      id: payload.id,
      name: payload.n || 'Shared List',
      color: payload.c || COLLECTION_COLORS[0],
    };
    state.settings.collections.push(target);
  }

  map[target.id] = {
    ...(map[target.id] || {}),
    token: payload.t,
    cloudId: map[target.id]?.cloudId || null,
    ownerName: payload.o || map[target.id]?.ownerName || 'Friend',
    collaborators: Array.isArray(map[target.id]?.collaborators) ? map[target.id].collaborators : [],
    activity: Array.isArray(map[target.id]?.activity) ? map[target.id].activity : [],
    updatedAt: Date.now(),
  };

  const role = ['owner', 'editor', 'viewer'].includes(payload.r) ? payload.r : 'editor';
  addOrUpdateCollaborator(target.id, role);
  logSharedActivity(target.id, `${getActorName()} joined as ${role}`);

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  renderCollectionsList();
  renderCollectionFilter();
  populateFormCollections();
  state.filter.collection = target.id;
  const sel = document.getElementById('filter-collection');
  if (sel) sel.value = target.id;
  renderAll();
  showToast('Joined shared list ', `You joined ${target.name} as ${role}.`, 'success');
  syncSharedMetaToCloud(target.id);
  refreshSharedRealtimeSubscriptions();
  return true;
}

function joinCollectionFromInput () {
  const input = document.getElementById('join-list-input');
  const raw = (input?.value || '').trim();
  if (!raw) return;
  try {
    const hash = raw.includes('#') ? raw.split('#')[1] : raw;
    const params = new URLSearchParams(hash.startsWith('join-list=') ? hash : hash.replace(/^.*\?/, ''));
    const encoded = params.get('join-list') || (hash.startsWith('join-list=') ? hash.slice('join-list='.length) : '');
    if (!encoded) throw new Error('bad-link');
    const payload = decodeInvitePayload(decodeURIComponent(encoded));
    joinCollectionFromPayload(payload);
    if (input) input.value = '';
  } catch {
    showToast('Invalid link', 'That shared list link looks invalid.', 'error');
  }
}

function processSharedListInviteFromUrl () {
  const hash = window.location.hash || '';
  if (!hash.includes('join-list=')) return;
  try {
    const params = new URLSearchParams(hash.slice(1));
    const encoded = params.get('join-list');
    if (!encoded) return;
    const payload = decodeInvitePayload(decodeURIComponent(encoded));
    const ask = confirm(`Join shared list "${payload.n || 'Shared List'}" as ${payload.r || 'editor'}?`);
    if (ask) joinCollectionFromPayload(payload);
  } catch {
    showToast('Invalid invite', 'Could not parse shared list invite.', 'error');
  } finally {
    history.replaceState({}, document.title, window.location.pathname + window.location.search);
  }
}

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
  document.getElementById('join-list-btn')?.addEventListener('click', joinCollectionFromInput);
  document.getElementById('join-list-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      joinCollectionFromInput();
    }
  });
  document.getElementById('add-collection-btn').addEventListener('click', () => {
    const name = document.getElementById('new-collection-name').value.trim();
    if (!name) return;
    if (!state.settings.collections) state.settings.collections = [];
    state.settings.collections.push({id: uid(), name, color: _newCollectionColor});
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    document.getElementById('new-collection-name').value = '';
    renderCollectionsList(); renderCollectionFilter();
    showToast(' List Created!', `"${name}" ready.`, 'success');
  });

  window.addEventListener('storage', e => {
    if (e.key !== SETTINGS_KEY) return;
    try {
      const next = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      state.settings = { ...state.settings, ...next };
      renderCollectionsList();
      renderCollectionFilter();
      populateFormCollections();
      renderAll();
    } catch {}
  });

  processSharedListInviteFromUrl();
  refreshSharedRealtimeSubscriptions();
  renderCollectionFilter();
}
function renderCollectionsList () {
  const list = document.getElementById('collections-list');
  const me = getCollaboratorId();
  const cols = state.settings.collections || [];
  if (!cols.length) { list.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">No custom lists yet. Create one below!</div>'; return; }
  list.innerHTML = cols.map(c => {
    const count = state.restaurants.filter(r => r.collectionId === c.id).length;
    const shared = getSharedListsMap()[c.id];
    const mine = shared?.collaborators?.find(x => x.id === me);
    const sharedLabel = shared ? `<span class="collection-shared-pill">Shared • ${escHtml((mine?.role || 'editor').toUpperCase())}</span>` : '';
    const activity = shared?.activity?.[0]
      ? `<div class="collection-item-activity">${escHtml(shared.activity[0].text)} · ${sharedAgo(shared.activity[0].ts)}</div>`
      : '';
    return `<div class="collection-item" data-cid="${c.id}">
      <div class="collection-dot" style="background:${c.color}"></div>
      <div class="collection-item-main">
        <div class="collection-item-name-row">
          <div class="collection-item-name">${escHtml(c.name)}</div>
          ${sharedLabel}
        </div>
        ${activity}
      </div>
      <div class="collection-item-count">${count}</div>
      <button class="collection-item-share" data-share="${c.id}" title="Share list"></button>
      <button class="collection-item-manage" data-manage="${c.id}" title="Manage collaborators"></button>
      <button class="collection-item-del" data-del="${c.id}" title="Delete">✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.collection-item-share').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); shareCollectionInvite(btn.dataset.share); });
  });
  list.querySelectorAll('.collection-item-manage').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openSharedManageModal(btn.dataset.manage); });
  });
  list.querySelectorAll('.collection-item-del').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteCollection(btn.dataset.del); });
  });
}
function deleteCollection (id) {
  if (!confirm('Delete this list? Restaurants won\'t be deleted.')) return;
  const sharedMeta = state.settings.sharedLists?.[id] || null;
  state.settings.collections = (state.settings.collections||[]).filter(c => c.id!==id);
  if (state.settings.sharedLists && state.settings.sharedLists[id]) delete state.settings.sharedLists[id];
  state.restaurants.forEach(r => { if (r.collectionId===id) r.collectionId=null; });
  saveData(); localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  renderCollectionsList(); renderCollectionFilter(); renderAll();
  if (typeof fbSharedListDelete === 'function' && window._ftbUid) {
    const cloudId = sharedMeta?.cloudId || `${id}`;
    fbSharedListDelete(cloudId);
  }
  refreshSharedRealtimeSubscriptions();
}

function openSharedManageModal (collectionId) {
  _sharedManageCollectionId = collectionId;
  renderSharedManageModal();
  document.getElementById('shared-manage-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeSharedManageModal () {
  document.getElementById('shared-manage-overlay')?.classList.add('hidden');
  _sharedManageCollectionId = null;
  maybeHideOverlay();
}

function renderSharedManageModal () {
  const cid = _sharedManageCollectionId;
  if (!cid) return;
  const meta = ensureSharedMeta(cid);
  const col = (state.settings.collections || []).find(c => c.id === cid);
  const title = document.getElementById('shared-manage-title');
  const subtitle = document.getElementById('shared-manage-subtitle');
  const collabList = document.getElementById('shared-manage-collab-list');
  const actList = document.getElementById('shared-manage-activity-list');
  if (!collabList || !actList) return;
  if (title) title.textContent = ` ${col?.name || 'Shared List'} Manager`;
  if (subtitle) subtitle.textContent = `Owner: ${meta.ownerName || 'Unknown'} • ${meta.collaborators.length} collaborator(s)`;

  collabList.innerHTML = meta.collaborators.length
    ? meta.collaborators.map(c => `<div class="shared-collab-row">
        <div class="shared-collab-name">${escHtml(c.name || 'Foodie')}</div>
        <select class="shared-collab-role" data-collab="${c.id}">
          <option value="owner" ${c.role === 'owner' ? 'selected' : ''}>Owner</option>
          <option value="editor" ${c.role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="viewer" ${c.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        </select>
        <button class="shared-collab-remove" data-collab="${c.id}" type="button">Remove</button>
      </div>`).join('')
    : '<div class="dish-empty">No collaborators yet.</div>';

  actList.innerHTML = meta.activity.length
    ? meta.activity.map(a => `<div class="shared-activity-row">
        <div class="shared-activity-text">${escHtml(a.text || '')}</div>
        <div class="shared-activity-time">${sharedAgo(a.ts)}</div>
      </div>`).join('')
    : '<div class="dish-empty">No activity yet.</div>';
}

function updateCollaboratorRole (collabId, role) {
  const cid = _sharedManageCollectionId;
  if (!cid) return;
  const meta = ensureSharedMeta(cid);
  const item = meta.collaborators.find(c => c.id === collabId);
  if (!item) return;
  item.role = role;
  item.updatedAt = Date.now();
  logSharedActivity(cid, `${item.name || 'Foodie'} role changed to ${role}`);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  renderCollectionsList();
  renderSharedManageModal();
  syncSharedMetaToCloud(cid);
}

function removeCollaborator (collabId) {
  const cid = _sharedManageCollectionId;
  if (!cid) return;
  const meta = ensureSharedMeta(cid);
  const who = meta.collaborators.find(c => c.id === collabId);
  meta.collaborators = meta.collaborators.filter(c => c.id !== collabId);
  logSharedActivity(cid, `${who?.name || 'Foodie'} removed from list`);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  renderCollectionsList();
  renderSharedManageModal();
  syncSharedMetaToCloud(cid);
}

function openSmartPlanner () {
  const dateEl = document.getElementById('smart-date');
  if (dateEl && !dateEl.value) dateEl.value = iso();
  document.getElementById('smart-plan-results').innerHTML = '';
  document.getElementById('smart-planner-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeSmartPlanner () {
  document.getElementById('smart-planner-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

let _decisionModeState = {
  mood: 'quick',
  budget: 0,
  miles: 5,
  party: 2,
};

function resetDecisionModeState () {
  _decisionModeState = {
    mood: 'quick',
    budget: 0,
    miles: 5,
    party: 2,
  };
}

function syncDecisionModeChips () {
  document.querySelectorAll('.decision-chip[data-group][data-value]').forEach(btn => {
    const group = btn.dataset.group;
    const value = btn.dataset.value;
    const current = _decisionModeState[group];
    btn.classList.toggle('active', String(current) === String(value));
  });
}

function setDecisionModeConstraint (group, value) {
  if (!group) return;
  if (group === 'mood') {
    _decisionModeState.mood = String(value || 'quick');
  } else if (group === 'budget') {
    _decisionModeState.budget = Math.max(0, Number(value || 0));
  } else if (group === 'miles') {
    _decisionModeState.miles = Math.max(1, Number(value || 5));
  } else if (group === 'party') {
    _decisionModeState.party = Math.max(1, Number(value || 2));
  }
  syncDecisionModeChips();
}

function openDecisionMode () {
  resetDecisionModeState();
  syncDecisionModeChips();
  const out = document.getElementById('decision-mode-results');
  if (out) out.innerHTML = '';
  document.getElementById('decision-mode-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  trackProductEvent('decision_session_started', {
    from: 'home',
    locationEnabled: !!state.locationEnabled,
    restaurantCount: Number(state.restaurants.length || 0),
  });
}

function closeDecisionMode () {
  document.getElementById('decision-mode-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function decisionConfidenceLabel (level = 0) {
  if (level >= 0.8) return 'High';
  if (level >= 0.5) return 'Medium';
  return 'Low';
}

function buildDecisionModeShortlist () {
  const mood = _decisionModeState.mood || 'quick';
  const budget = Number(_decisionModeState.budget || 0);
  const maxMeters = Math.max(1, Number(_decisionModeState.miles || 5)) * 1609.34;
  const party = Math.max(1, Number(_decisionModeState.party || 2));

  const scored = state.restaurants.map(r => {
    const distance = distOf(r);
    let score = scoreMoodPick(r, mood);

    if (budget > 0) {
      if ((r.priceRange || 0) > budget) score -= 3.2;
      if ((r.priceRange || 0) > 0 && (r.priceRange || 0) <= budget) score += 0.9;
    }

    if (Number.isFinite(distance)) {
      if (distance <= maxMeters) score += 1.2;
      else score -= Math.min(2.4, (distance - maxMeters) / 2200);
    }

    const cuisine = String(r.cuisine || '').toLowerCase();
    if (party >= 4) {
      if ((r.priceRange || 0) <= 2) score += 0.8;
      if (/(pizza|mexican|american|bbq|thai|chinese|italian)/.test(cuisine)) score += 0.8;
    } else if (party === 1) {
      if (/(cafe|japanese|sushi|mediterranean|vietnamese|thai)/.test(cuisine)) score += 0.6;
    }

    const imageConfidence = safeUrl(r.photo || '') ? 0.9 : 0.55;
    const menuConfidence = r.website ? 0.9 : (r.address ? 0.55 : 0.35);
    const distanceConfidence = Number.isFinite(distance)
      ? (distance <= maxMeters ? 0.92 : distance <= maxMeters * 1.5 ? 0.62 : 0.35)
      : 0.42;

    const reasons = [];
    reasons.push(mood === 'date' ? 'date-night fit' : mood === 'comfort' ? 'comfort match' : mood === 'healthy' ? 'lighter option' : 'fast decision pick');
    if (budget > 0 && (r.priceRange || 0) > 0 && (r.priceRange || 0) <= budget) reasons.push('inside budget');
    if (Number.isFinite(distance) && distance <= maxMeters) reasons.push('close enough now');
    if (party >= 4 && (r.priceRange || 0) <= 2) reasons.push('good for groups');
    if (!reasons.length) reasons.push('balanced overall score');

    return {
      r,
      score,
      distance,
      imageConfidence,
      menuConfidence,
      distanceConfidence,
      reasons,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function renderDecisionModeResults (shortlist = []) {
  const out = document.getElementById('decision-mode-results');
  if (!out) return;

  if (!state.restaurants.length) {
    out.innerHTML = '<div class="dish-empty">Add a few spots first, then Decision Mode can pick your winner.</div>';
    return;
  }

  if (!shortlist.length) {
    out.innerHTML = '<div class="dish-empty">No matches yet. Try widening distance or budget.</div>';
    return;
  }

  out.innerHTML = shortlist.map((item, idx) => {
    const r = item.r;
    const rankLabel = idx === 0 ? 'Winner' : `Option ${idx + 1}`;
    const distText = Number.isFinite(item.distance) ? fmtDist(item.distance) : 'distance n/a';
    const menuUrl = buildMenuSearchUrl({ name: r.name, address: r.address || '' });
    const directionsUrl = buildGoogleDirectionsUrl({ name: r.name, address: r.address || '', lat: r.lat, lon: r.lng });
    const canMenu = !!menuUrl;
    const canDirections = !!directionsUrl;
    const fit = Math.max(40, Math.min(99, Math.round(item.score * 9.5)));

    return `<article class="decision-result-card${idx === 0 ? ' winner' : ''}" data-id="${r.id}">
      <div class="decision-result-top">
        <span class="decision-result-rank">${rankLabel}</span>
        <span class="decision-result-fit">${fit}% fit</span>
      </div>
      <div class="decision-result-name">${escHtml(r.name || 'Restaurant')}</div>
      <div class="decision-result-meta">${escHtml(r.cuisine || 'Restaurant')} • ${distText}${r.priceRange ? ` • ${'$'.repeat(Math.max(1, Math.min(4, Number(r.priceRange))))}` : ''}</div>
      <div class="decision-result-why">${escHtml(item.reasons.slice(0, 2).join(' • '))}</div>
      <div class="decision-result-confidence">
        <span>Image: ${decisionConfidenceLabel(item.imageConfidence)}</span>
        <span>Menu: ${decisionConfidenceLabel(item.menuConfidence)}</span>
        <span>Distance: ${decisionConfidenceLabel(item.distanceConfidence)}</span>
      </div>
      <div class="decision-result-actions">
        <button class="btn-primary btn-sm decision-result-action" data-action="choose" data-id="${r.id}" type="button">Choose This</button>
        <button class="btn-secondary btn-sm decision-result-action" data-action="backup" data-id="${r.id}" type="button">Save Backup</button>
        <button class="btn-ghost btn-sm decision-result-action" data-action="menu" data-id="${r.id}" ${canMenu ? '' : 'disabled'} type="button">View Menu</button>
        <button class="btn-ghost btn-sm decision-result-action" data-action="directions" data-id="${r.id}" ${canDirections ? '' : 'disabled'} type="button">Directions</button>
      </div>
    </article>`;
  }).join('');
}

function runDecisionMode () {
  const shortlist = buildDecisionModeShortlist();
  renderDecisionModeResults(shortlist);
}

function handleDecisionModeActionClick (btn) {
  const action = btn?.dataset?.action;
  const id = btn?.dataset?.id;
  if (!action || !id) return;
  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;

  trackProductEvent('decision_option_selected', {
    action,
    restaurantId: id,
    mood: _decisionModeState.mood,
    budget: _decisionModeState.budget,
    miles: _decisionModeState.miles,
    party: _decisionModeState.party,
  });

  if (action === 'choose') {
    trackProductEvent('decision_session_completed', {
      restaurantId: id,
      mood: _decisionModeState.mood,
    });
    closeDecisionMode();
    setTimeout(() => openDetailModal(id), 120);
    return;
  }

  if (action === 'backup') {
    r.isFavorite = true;
    saveData();
    renderCards();
    showToast('Backup saved', `${r.name} is now pinned as a backup pick.`, 'success');
    return;
  }

  if (action === 'menu') {
    const url = buildMenuSearchUrl({ name: r.name, address: r.address || '' });
    if (!url) {
      showToast('No menu found', 'Try adding a website for this place first.', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener');
    return;
  }

  if (action === 'directions') {
    const url = buildGoogleDirectionsUrl({ name: r.name, address: r.address || '', lat: r.lat, lon: r.lng });
    if (!url) {
      showToast('No location', 'This place needs an address or coordinates first.', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }
}

function runSmartPlanner () {
  const budget = Number(document.getElementById('smart-budget')?.value || 0);
  const miles = Math.max(1, Number(document.getElementById('smart-distance')?.value || 8));
  const vibe = document.getElementById('smart-vibe')?.value || 'quick';
  const maxMeters = miles * 1609.34;
  const out = document.getElementById('smart-plan-results');
  if (!out) return;

  const nearbyFallback = getNearbyDiscoveryRows(16);
  const plannerPool = state.restaurants.length ? [...state.restaurants] : nearbyFallback;

  const picks = plannerPool.map(r => {
    if (budget && (r.priceRange || 0) > budget) return { r, s: -999 };
    const d = r._nearbyElement ? Number(r._distMeters) : distOf(r);
    if (Number.isFinite(d) && d > maxMeters) return { r, s: -999 };
    let s = scoreMoodPick(r, vibe);
    s += r.isFavorite ? 1 : 0;
    s += r.status === 'want-to-try' ? 0.8 : 0.2;
    return { r, s };
  }).filter(x => x.s > -900).sort((a, b) => b.s - a.s).slice(0, 3);

  if (!picks.length) {
    out.innerHTML = '<div class="dish-empty">No matches. Try increasing distance or budget.</div>';
    return;
  }

  out.innerHTML = picks.map(p => {
    const d = p.r._nearbyElement ? Number(p.r._distMeters) : distOf(p.r);
    const dist = Number.isFinite(d) ? fmtDist(d) : 'distance n/a';
    return `<button class="smart-plan-row" data-id="${p.r.id}" data-nearby="${p.r._nearbyElement ? '1' : '0'}" type="button">
      <div>
        <div class="smart-plan-name">${escHtml(p.r.name)}</div>
        <div class="smart-plan-meta">${escHtml(p.r.cuisine || 'Restaurant')} • ${dist}</div>
      </div>
      <div class="smart-plan-score">${(p.s).toFixed(1)}</div>
    </button>`;
  }).join('');

  out.querySelectorAll('.smart-plan-row[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSmartPlanner();
      const row = picks.find(x => String(x.r.id) === String(btn.dataset.id));
      if (btn.dataset.nearby === '1' && row?.r) {
        const near = row.r;
        setTimeout(() => {
          openAddModalPreFilled(near.name, near.cuisine, {
            name: near.name,
            address: near.address || '',
            website: near.website || '',
            lat: Number.isFinite(near.lat) ? Number(near.lat) : null,
            lon: Number.isFinite(near.lng) ? Number(near.lng) : null,
          });
        }, 120);
        return;
      }
      setTimeout(() => openDetailModal(btn.dataset.id), 120);
    });
  });
}

function openSmartItinerary () {
  document.getElementById('smart-itinerary-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeSmartItinerary () {
  document.getElementById('smart-itinerary-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function _minutesToTimeLabel (mins) {
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function buildSmartItinerary () {
  const stops = Math.min(4, Math.max(2, Number(document.getElementById('itinerary-stops')?.value || 3)));
  const style = document.getElementById('itinerary-vibe')?.value || 'balanced';
  const start = document.getElementById('itinerary-start')?.value || '18:30';
  const out = document.getElementById('itinerary-results');
  if (!out) return;

  const [sh, sm] = start.split(':').map(Number);
  let t = (Number.isFinite(sh) ? sh : 18) * 60 + (Number.isFinite(sm) ? sm : 30);
  const styleWeights = {
    balanced: { visited: 0.8, fav: 0.5 },
    quick: { visited: 0.5, fav: 0.3 },
    date: { visited: 1.2, fav: 0.9 },
    comfort: { visited: 1.1, fav: 0.8 },
    healthy: { visited: 0.6, fav: 0.4 },
  };
  const w = styleWeights[style] || styleWeights.balanced;

  const pool = [...state.restaurants]
    .map(r => {
      const d = distOf(r);
      const moodScore = scoreMoodPick(r, style === 'balanced' ? 'quick' : style);
      const rating = Number(r.myRating || 0);
      let score = moodScore + rating * 0.8;
      score += r.status === 'visited' ? w.visited : 0.25;
      score += r.isFavorite ? w.fav : 0;
      if (Number.isFinite(d)) score += Math.max(0, 2.8 - d / 2400);
      return { r, d, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  if (!pool.length) {
    out.innerHTML = '<div class="dish-empty">Add restaurants first to generate an itinerary.</div>';
    return;
  }

  const selected = [];
  const used = new Set();
  for (const item of pool) {
    if (selected.length >= stops) break;
    if (used.has(item.r.id)) continue;
    used.add(item.r.id);
    selected.push(item);
  }

  const segments = ['Starter', 'Main', 'Dessert', 'Late Bite'];
  out.innerHTML = selected.map((item, idx) => {
    const d = Number.isFinite(item.d) ? fmtDist(item.d) : 'distance n/a';
    const at = _minutesToTimeLabel(t);
    t += idx === 0 ? 70 : 85;
    return `<button class="smart-plan-row" data-id="${item.r.id}" type="button">
      <div>
        <div class="smart-plan-name">${idx + 1}. ${escHtml(item.r.name)}</div>
        <div class="smart-plan-meta">${segments[idx] || 'Stop'} • ${escHtml(item.r.cuisine || 'Restaurant')} • ${d} • ${at}</div>
      </div>
      <div class="smart-plan-score">${item.score.toFixed(1)}</div>
    </button>`;
  }).join('');

  out.querySelectorAll('.smart-plan-row[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSmartItinerary();
      setTimeout(() => openDetailModal(btn.dataset.id), 120);
    });
  });
}

function _persistDinnerRooms () {
  state.settings.dinnerRooms = state.dinnerRooms;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function _getDinnerRoomInvite (code) {
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

function _createDinnerRoomCode () {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
  return out;
}

function openDinnerRooms () {
  document.getElementById('dinner-rooms-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  renderDinnerRoom();
}

function closeDinnerRooms () {
  document.getElementById('dinner-rooms-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function createDinnerRoom () {
  if (!state.restaurants.length) {
    showToast('No restaurants yet', 'Add a few spots before creating a room.', 'info');
    return;
  }
  let code = _createDinnerRoomCode();
  while (state.dinnerRooms[code]) code = _createDinnerRoomCode();
  const options = [...state.restaurants]
    .sort((a, b) => (b.myRating || 0) - (a.myRating || 0))
    .slice(0, 6)
    .map(r => r.id);
  state.dinnerRooms[code] = {
    code,
    createdAt: new Date().toISOString(),
    options,
    votes: {},
    lockedChoice: '',
  };
  state.activeDinnerRoomCode = code;
  _persistDinnerRooms();
  renderDinnerRoom();
  showToast('Room created', `Code ${code} is ready to share.`, 'success');
}

function joinDinnerRoom () {
  const input = document.getElementById('dinner-room-code-input');
  const code = String(input?.value || '').trim().toUpperCase();
  if (!code) return;
  if (!state.dinnerRooms[code]) {
    showToast('Room not found', 'That room code does not exist on this device yet.', 'error');
    return;
  }
  state.activeDinnerRoomCode = code;
  renderDinnerRoom();
}

function renderDinnerRoom () {
  const shell = document.getElementById('dinner-room-shell');
  const meta = document.getElementById('dinner-room-meta');
  const list = document.getElementById('dinner-room-options');
  const result = document.getElementById('dinner-room-result');
  if (!shell || !meta || !list || !result) return;

  const code = state.activeDinnerRoomCode;
  const room = code ? state.dinnerRooms[code] : null;
  if (!room) {
    shell.classList.add('hidden');
    return;
  }
  shell.classList.remove('hidden');
  meta.textContent = `Room ${room.code} • ${room.options.length} options`;

  const votesByOption = {};
  Object.values(room.votes || {}).forEach(id => { votesByOption[id] = (votesByOption[id] || 0) + 1; });

  list.innerHTML = room.options.map(id => {
    const r = state.restaurants.find(x => x.id === id);
    if (!r) return '';
    const votes = votesByOption[id] || 0;
    return `<label class="dinner-room-option">
      <input type="radio" name="dinner-room-vote" value="${id}" ${room.lockedChoice === id ? 'checked' : ''} />
      <span class="dinner-room-option-main">
        <strong>${escHtml(r.name)}</strong>
        <small>${escHtml(r.cuisine || 'Restaurant')} • ${(r.myRating || 0) ? `${r.myRating}★` : 'unrated'}</small>
      </span>
      <span class="dinner-room-votes">${votes} vote${votes === 1 ? '' : 's'}</span>
    </label>`;
  }).join('');

  if (room.lockedChoice) {
    const winner = state.restaurants.find(r => r.id === room.lockedChoice);
    result.innerHTML = winner
      ? `<div class="dinner-room-locked">Locked winner: <strong>${escHtml(winner.name)}</strong></div>`
      : '';
  } else {
    result.innerHTML = '<div class="dinner-room-hint">Vote first, then lock the winner when everyone agrees.</div>';
  }
}

function voteDinnerRoom () {
  const code = state.activeDinnerRoomCode;
  const room = code ? state.dinnerRooms[code] : null;
  if (!room) return;
  const selected = document.querySelector('input[name="dinner-room-vote"]:checked');
  if (!selected) {
    showToast('Pick an option', 'Choose a restaurant before voting.', 'info');
    return;
  }
  const voter = (loadUserProfile()?.name || 'Guest').slice(0, 24);
  room.votes[voter] = selected.value;
  _persistDinnerRooms();
  renderDinnerRoom();
}

function lockDinnerRoomWinner () {
  const code = state.activeDinnerRoomCode;
  const room = code ? state.dinnerRooms[code] : null;
  if (!room) return;

  const tally = {};
  Object.values(room.votes || {}).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
  const winnerId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!winnerId) {
    showToast('No votes yet', 'Collect a few votes before locking.', 'info');
    return;
  }
  room.lockedChoice = winnerId;
  _persistDinnerRooms();
  renderDinnerRoom();
  const winner = state.restaurants.find(r => r.id === winnerId);
  if (winner) showToast('Winner locked', `${winner.name} wins dinner night.`, 'success');
}

function shareDinnerRoomInvite () {
  const code = state.activeDinnerRoomCode;
  if (!code) return;
  const url = _getDinnerRoomInvite(code);
  navigator.clipboard?.writeText(url);
  showToast('Invite copied', 'Room invite link copied to clipboard.', 'success');
}

function openShareHighlights () {
  document.getElementById('share-highlights-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeShareHighlights () {
  document.getElementById('share-highlights-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function exportHighlightCard (kind = 'weekly') {
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = 1080;
  const H = canvas.height = 1080;

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#101a2c');
  bg.addColorStop(0.5, '#13253b');
  bg.addColorStop(1, '#0e1422');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glowA = ctx.createRadialGradient(220, 170, 20, 220, 170, 320);
  glowA.addColorStop(0, 'rgba(232,177,90,.38)');
  glowA.addColorStop(1, 'rgba(232,177,90,0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);

  const glowB = ctx.createRadialGradient(860, 760, 20, 860, 760, 350);
  glowB.addColorStop(0, 'rgba(26,188,156,.35)');
  glowB.addColorStop(1, 'rgba(26,188,156,0)');
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, W, H);

  roundRect(58, 58, W - 116, H - 116, 42);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = '700 56px Poppins, system-ui';
  const title = kind === 'weekly' ? 'Weekly Recap' : kind === 'mood' ? 'Mood Picks' : 'Top Dishes';
  ctx.fillText(`${title}`, 92, 154);

  ctx.fillStyle = '#ffd18a';
  ctx.font = '600 26px Poppins, system-ui';
  ctx.fillText('Feed The Bear Spotlight', 94, 198);

  ctx.font = '600 36px Poppins, system-ui';
  let lines = [];
  if (kind === 'weekly') {
    const weekStart = getWeekStartIso();
    let checkins = 0;
    state.restaurants.forEach(r => {
      (r.visits || []).forEach(v => { if ((v.date || '') >= weekStart) checkins++; });
      if ((r.dateVisited || '') >= weekStart && !(r.visits || []).length) checkins++;
    });
    lines = [
      `${checkins} check-ins this week`,
      `${state.restaurants.filter(r => r.isFavorite).length} favorites saved`,
      `${state.restaurants.length} restaurants in your den`,
    ];
  } else if (kind === 'mood') {
    const mood = document.querySelector('.home-mood-chip.active')?.dataset.mood || 'quick';
    const picks = [...state.restaurants]
      .map(r => ({ ...r, s: scoreMoodPick(r, mood) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);
    lines = [`Mood: ${mood.toUpperCase()}`, ...picks.map((p, i) => `${i + 1}. ${p.name}`)];
  } else {
    const top = getDishLeaderboardData().slice(0, 5);
    lines = top.length ? top.map((d, i) => `${i + 1}. ${d.name} (${d.score})`) : ['No dish data yet'];
  }

  const chips = lines.slice(0, 5);
  chips.forEach((line, i) => {
    const y = 280 + (i * 126);
    roundRect(92, y - 52, W - 184, 92, 26);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#f0f6ff';
    ctx.fillText(line, 126, y + 8);
  });

  ctx.fillStyle = '#FFD166';
  ctx.font = '600 30px Poppins, system-ui';
  ctx.fillText('feed the bear', 92, H - 128);
  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = '500 24px Poppins, system-ui';
  ctx.fillText(new Date().toLocaleDateString(), 92, H - 88);

  canvas.toBlob(blob => {
    if (!blob) {
      showToast('Export failed', 'Could not generate the highlight card.', 'error');
      return;
    }
    const file = new File([blob], `ftb-${kind}-card.png`, { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      navigator.share({ title: `Feed The Bear ${title}`, files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
    showToast('Card ready ', `${title} card generated.`, 'success');
  }, 'image/png');
}
function renderCollectionFilter () {
  const sel = document.getElementById('filter-collection'); if (!sel) return;
  const cur = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  (state.settings.collections||[]).forEach(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=` ${c.name}`; sel.appendChild(o); });
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
  const safeFn = (name, fallback = () => {}) =>
    (typeof globalThis[name] === 'function' ? globalThis[name] : fallback);

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
  document.getElementById('add-btn')?.addEventListener('click', openAddModal);
  document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

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
    localStorage.setItem(LOCATION_BANNER_DISMISSED_KEY, '1');
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
      showToast('Photo Added ', 'Image loaded successfully.', 'success');
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
    const btn = e.target.closest('.mobile-nav-btn, .mobile-nav-fab');
    if (!btn) return;
    if (btn.id === 'mobile-add-btn')  { hapticTap('medium'); openAddModal(); return; }
    if (btn.id === 'mobile-play-btn') { openMobileHub(); return; }
    if (!btn.dataset.view) return;
    hapticTap('light');
    setView(btn.dataset.view);
  });

  // Tappable top stat counters → jump to that list (keeps Want/Visited one tap away on mobile)
  document.getElementById('stats-bar')?.addEventListener('click', e => {
    const item = e.target.closest('.stat-item[data-view-filter]');
    if (!item) return;
    hapticTap('light');
    setView(item.dataset.viewFilter);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.getElementById('stats-bar')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const item = e.target.closest('.stat-item[data-view-filter]');
    if (!item) return;
    e.preventDefault();
    setView(item.dataset.viewFilter);
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
    document.getElementById('nearby-overlay').classList.add('hidden');
    document.body.classList.remove('overlay-open');
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
      closeMobileHub();
      closeModal();
      closeDetailModal();
      closeChat();
      closeTonightsPick();
      closeChallengeModal();
      closeWrap();
      closeImportBookmarks();
      closeSmartItinerary();
      closeDinnerRooms();
      closeCommandPalette();
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

  // Phase 6 - Wrap
  document.getElementById('wrap-btn').addEventListener('click', () => showWrap(0));
  document.getElementById('wrap-close-btn').addEventListener('click', closeWrap);
  document.getElementById('wrap-prev-btn').addEventListener('click', () => showWrap(_wrapOffset - 1));
  document.getElementById('wrap-next-btn').addEventListener('click', () => showWrap(_wrapOffset + 1));
  document.getElementById('wrap-share-btn').addEventListener('click', shareWrap);
  document.getElementById('wrap-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('wrap-overlay')) closeWrap();
  });

  // Phase 6 - Import Bookmarks
  document.getElementById('import-bookmarks-btn').addEventListener('click', showImportBookmarks);
  document.getElementById('import-close-btn').addEventListener('click', closeImportBookmarks);
  document.getElementById('import-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('import-overlay')) closeImportBookmarks();
  });
  document.getElementById('import-parse-btn').addEventListener('click', parseImportText);
  document.getElementById('import-confirm-btn').addEventListener('click', confirmImport);

  // Phase 6 - Add to Calendar
  document.getElementById('detail-calendar-btn').addEventListener('click', () => {
    if (state.detailId) addToGoogleCalendar(state.detailId);
  });

  // Phase 7 - Voice
  document.getElementById('search-voice-btn')?.addEventListener('click', startVoiceAdd);
  document.getElementById('voice-btn')?.addEventListener('click', startVoiceAdd);
  document.getElementById('voice-cancel-btn').addEventListener('click', stopVoice);

  // Phase 7 - Gallery
  document.getElementById('gallery-btn').addEventListener('click', openGallery);
  document.getElementById('gallery-close-btn').addEventListener('click', closeGallery);
  document.getElementById('gallery-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('gallery-overlay')) closeGallery();
  });
  document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-prev').addEventListener('click', () => { if (_lightboxIdx > 0) { _lightboxIdx--; renderLightbox(); } });
  document.getElementById('lightbox-next').addEventListener('click', () => { if (_lightboxIdx < _galleryPhotos.length-1) { _lightboxIdx++; renderLightbox(); } });

  // Phase 7 - Compare
  document.getElementById('compare-btn').addEventListener('click', toggleCompareMode);
  document.getElementById('compare-now-btn').addEventListener('click', showCompare);
  document.getElementById('compare-cancel-btn').addEventListener('click', cancelCompare);
  document.getElementById('compare-close-btn').addEventListener('click', closeCompare);
  document.getElementById('compare-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('compare-overlay')) closeCompare();
  });

  // Phase 7 - Budget
  document.getElementById('budget-btn').addEventListener('click', openBudget);
  document.getElementById('budget-close-btn').addEventListener('click', closeBudget);
  document.getElementById('budget-save-btn').addEventListener('click', saveBudget);
  document.getElementById('budget-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('budget-overlay')) closeBudget();
  });

  // Phase 7 - Profile
  document.getElementById('profile-btn').addEventListener('click', openFoodieProfile);
  document.getElementById('profile-close-btn').addEventListener('click', closeFoodieProfile);
  document.getElementById('profile-copy-btn').addEventListener('click', copyProfileLink);
  document.getElementById('profile-share-btn').addEventListener('click', shareProfile);
  document.getElementById('profile-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('profile-overlay')) closeFoodieProfile();
  });

  // Phase 7 - Reservation Reminders
  document.getElementById('detail-set-reminder-btn').addEventListener('click', () => {
    if (state.detailId) setReminder(state.detailId);
  });

  // Phase 7 - Auto-Tags (form field hooks)
  ['form-name','form-cuisine','form-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', computeAutoTags);
  });

  // Phase 7 - Escape closes new modals (comment only - actual close calls below in Escape handler)
  document.getElementById('form-name').addEventListener('input', computeAutoTags);

  // Phase 8 - ⋯ More Menu
  initMoreMenu();
  initMobileHub();

  // Phase 8 - Craving Engine
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

  // Phase 8 - Dish Tracker
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

  // Phase 8 - Detail favorites + menu notes
  document.getElementById('detail-favorite-btn').addEventListener('click', () => {
    if (!state.detailId) return;
    const i = state.restaurants.findIndex(x => x.id === state.detailId);
    if (i === -1) return;
    state.restaurants[i].isFavorite = !state.restaurants[i].isFavorite;
    saveData();
    renderCards();
    openDetailModal(state.detailId);
  });
  document.getElementById('detail-menu-add-btn').addEventListener('click', () => {
    const formEl = document.getElementById('detail-menu-form');
    if (!formEl) return;
    formEl.classList.remove('hidden');
    document.getElementById('detail-menu-item-input')?.focus();
  });
  document.getElementById('detail-menu-cancel-btn').addEventListener('click', resetDetailMenuForm);
  document.getElementById('detail-menu-save-btn').addEventListener('click', saveDetailMenuItem);
  document.getElementById('detail-menu-item-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveDetailMenuItem();
    }
  });
  document.getElementById('detail-menu-note-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveDetailMenuItem();
    }
  });
  document.getElementById('detail-menu-reaction-row').addEventListener('click', e => {
    const btn = e.target.closest('.detail-menu-react-btn');
    if (!btn) return;
    setDetailMenuReaction(btn.dataset.reaction || 'neutral');
  });

  // Phase 8 - Visit Debrief
  document.getElementById('detail-debrief-btn').addEventListener('click', () => { if (state.detailId) openVisitDebrief(state.detailId); });
  document.getElementById('debrief-save-btn').addEventListener('click', saveDebrief);
  document.getElementById('debrief-skip-btn').addEventListener('click', closeDebrief);
  document.getElementById('debrief-overlay').addEventListener('click', e => { if (e.target === document.getElementById('debrief-overlay')) closeDebrief(); });

  // Phase 8 - Year in Review
  document.getElementById('review-close-btn').addEventListener('click', closeYearReview);
  document.getElementById('review-close-btn2').addEventListener('click', closeYearReview);
  document.getElementById('review-share-btn').addEventListener('click', shareYearReview);
  document.getElementById('review-overlay').addEventListener('click', e => { if (e.target === document.getElementById('review-overlay')) closeYearReview(); });
  document.getElementById('review-prev-year').addEventListener('click', () => { _reviewYear--; document.getElementById('review-year-label').textContent = _reviewYear; renderYearReview(); });
  document.getElementById('review-next-year').addEventListener('click', () => { _reviewYear++; document.getElementById('review-year-label').textContent = _reviewYear; renderYearReview(); });

  // Phase 8 - Foodie Friends
  document.getElementById('friends-close-btn').addEventListener('click', closeFoodieFriends);
  document.getElementById('friends-overlay').addEventListener('click', e => { if (e.target === document.getElementById('friends-overlay')) closeFoodieFriends(); });
  document.getElementById('friends-load-btn').addEventListener('click', loadFriendProfile);
  document.getElementById('friends-link-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadFriendProfile(); });
  document.getElementById('friends-copy-btn').addEventListener('click', () => { navigator.clipboard?.writeText(document.getElementById('friends-my-link-input').value); showToast('Copied!', 'Profile link copied.', 'success'); });

  // Phase 8 - Smart Discovery
  document.getElementById('discover-close-btn').addEventListener('click', closeDiscover);
  document.getElementById('discover-overlay').addEventListener('click', e => { if (e.target === document.getElementById('discover-overlay')) closeDiscover(); });
  document.getElementById('discover-search-btn').addEventListener('click', runDiscover);

  // Phase 8 - Challenges
  document.getElementById('challenges-close-btn').addEventListener('click', closeChallenges);
  document.getElementById('challenges-overlay').addEventListener('click', e => { if (e.target === document.getElementById('challenges-overlay')) closeChallenges(); });
  document.querySelectorAll('.chal-tab').forEach(tab => tab.addEventListener('click', () => switchChalTab(tab.dataset.tab)));
  document.getElementById('chal-create-btn').addEventListener('click', createChallenge);
  document.getElementById('chal-friend-load-btn').addEventListener('click', loadFriendChallenge);

  // Phase 9 - Deep Stats
  document.getElementById('stats2-close-btn').addEventListener('click', closeStats2);
  document.getElementById('stats2-overlay').addEventListener('click', e => { if (e.target === document.getElementById('stats2-overlay')) closeStats2(); });

  // AI Core - Byte Cub panel
  document.getElementById('ai-panel-close-btn').addEventListener('click', closeAiPanel);
  document.getElementById('ai-panel-overlay').addEventListener('click', e => { if (e.target === document.getElementById('ai-panel-overlay')) closeAiPanel(); });
  document.getElementById('ai-chat-send-btn').addEventListener('click', () => sendAiMessage(document.getElementById('ai-chat-input').value));
  document.getElementById('ai-chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendAiMessage(document.getElementById('ai-chat-input').value); });
  document.getElementById('ai-chat-history').addEventListener('click', e => {
    const btn = e.target.closest('.ai-quick-btn');
    if (btn) handleAiQuickBtn(btn.dataset.prompt);
  });
  document.querySelectorAll('.ai-quick-btn').forEach(btn => btn.addEventListener('click', () => handleAiQuickBtn(btn.dataset.prompt)));

  // AI Core - API key setup
  document.getElementById('ai-save-key-btn')?.addEventListener('click', () => {
    const val = document.getElementById('ai-gemini-key-input')?.value?.trim() || '';
    if (!val.startsWith('AIza')) { showToast('Invalid Key', 'Gemini keys start with AIza\u2026', 'error'); return; }
    AI.setKey(val);
    _syncAiKeyUI();
    showToast('\u2728 Dev key saved', 'Server AI remains the default for all users.', 'success');
  });
  document.getElementById('ai-change-key-btn')?.addEventListener('click', () => {
    showToast('Grizzly feature', 'Byte Cub AI is unlocked with Grizzly upgrade.', 'info');
  });

  // AI - Detail modal
  document.getElementById('detail-ai-btn').addEventListener('click', () => { if (state.detailId) getAiDetailSummary(state.detailId); });
  document.getElementById('detail-dishes-ai-btn').addEventListener('click', () => { if (state.detailId) getAiDishRecs(state.detailId); });

  // AI - Smart Fill button in add/edit form
  document.getElementById('ai-smart-fill-btn').addEventListener('click', async () => {
    const name = document.getElementById('form-name').value.trim();
    if (!name) { showToast('Name needed', 'Enter a restaurant name first.', 'info'); return; }
    if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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
      fillResult.innerHTML = `\u2713 AI filled - cuisine, price & tags. Confidence: ${Math.round((data.confidence || 0.8)*100)}%`;
      fillResult.style.color = 'var(--green)';
    } catch (err) {
      fillResult.innerHTML = '\u26A0 ' + escHtml(err.message || 'AI error');
      fillResult.style.color = 'var(--primary)';
    }
  });

  // AI - Notes enricher
  document.getElementById('ai-notes-btn').addEventListener('click', async () => {
    const notes = document.getElementById('form-notes').value.trim();
    if (!notes) { showToast('Write a note first', 'Jot down something and let AI enrich it.', 'info'); return; }
    if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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

  // AI - Lightbox caption
  document.getElementById('lightbox-ai-caption-btn').addEventListener('click', async () => {
    const img = document.getElementById('lightbox-img');
    if (!img.src || img.src === window.location.href) return;
    if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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

  // AI - Monthly wrap narrative
  const wrapAiBtn = document.getElementById('wrap-ai-btn');
  if (wrapAiBtn) wrapAiBtn.addEventListener('click', async () => {
    if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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

  // AI - Year review narrative
  const reviewAiBtn = document.getElementById('review-ai-btn');
  if (reviewAiBtn) reviewAiBtn.addEventListener('click', async () => {
    if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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

  // AI - Taste Profile (stats view)
  const tasteBtn = document.getElementById('ai-taste-profile-btn');
  if (tasteBtn) tasteBtn.addEventListener('click', async () => {
    if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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

  // Phase 9 - Route Planner
  document.getElementById('route-close-btn').addEventListener('click', closeRoutePlanner);
  document.getElementById('route-overlay').addEventListener('click', e => { if (e.target === document.getElementById('route-overlay')) closeRoutePlanner(); });
  document.getElementById('route-go-btn').addEventListener('click', launchRoute);
  document.getElementById('detail-route-btn').addEventListener('click', openRoutePlanner);

  // Phase 9 - Export v2
  document.getElementById('export2-close-btn').addEventListener('click', closeExport2);
  document.getElementById('export2-overlay').addEventListener('click', e => { if (e.target === document.getElementById('export2-overlay')) closeExport2(); });
  document.getElementById('export2-passport-btn').addEventListener('click', exportPassport);
  document.getElementById('export2-page-btn').addEventListener('click', exportShareablePage);
  document.getElementById('export2-csv-btn').addEventListener('click', exportCSV);

  // Phase 10 - Achievements
  document.getElementById('ach-close-btn').addEventListener('click', closeAchievements);
  document.getElementById('achievements-overlay').addEventListener('click', e => { if (e.target === document.getElementById('achievements-overlay')) closeAchievements(); });

  // Phase 10 - Swipe Deck
  document.getElementById('swipe-close-btn').addEventListener('click', closeSwipeDeck);
  document.getElementById('swipe-overlay').addEventListener('click', e => { if (e.target === document.getElementById('swipe-overlay')) closeSwipeDeck(); });
  document.getElementById('swipe-pick-btn').addEventListener('click', swipePick);
  document.getElementById('swipe-skip-btn').addEventListener('click', swipeSkip);

  // Phase 10 - Spin Wheel
  document.getElementById('spin-close-btn').addEventListener('click', closeSpinWheel);
  document.getElementById('spin-overlay').addEventListener('click', e => { if (e.target === document.getElementById('spin-overlay')) closeSpinWheel(); });
  document.getElementById('spin-btn').addEventListener('click', spinWheel);

  // Phase 10 - Travel Mode
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

  // Phase 10 - Monthly Digest
  document.getElementById('digest-close-btn').addEventListener('click', closeMonthlyDigest);
  document.getElementById('digest-overlay').addEventListener('click', e => { if (e.target === document.getElementById('digest-overlay')) closeMonthlyDigest(); });
  document.getElementById('digest-share-btn').addEventListener('click', shareDigest);
  document.getElementById('digest-prev-btn').addEventListener('click', () => {
    _digestMonth--; if (_digestMonth < 0) { _digestMonth = 11; _digestYear--; } _renderDigest();
  });
  document.getElementById('digest-next-btn').addEventListener('click', () => {
    _digestMonth++; if (_digestMonth > 11) { _digestMonth = 0; _digestYear++; } _renderDigest();
  });

  // Phase 10 - Open Now
  document.getElementById('open-now-close-btn').addEventListener('click', closeOpenNow);
  document.getElementById('open-now-overlay').addEventListener('click', e => { if (e.target === document.getElementById('open-now-overlay')) closeOpenNow(); });
  document.getElementById('open-now-search-btn').addEventListener('click', runOpenNowSearch);

  // Phase 12 - Restaurant Duel
  document.getElementById('duel-close-btn').addEventListener('click', closeDuel);
  document.getElementById('duel-overlay').addEventListener('click', e => { if (e.target === document.getElementById('duel-overlay')) closeDuel(); });
  document.getElementById('duel-go-btn').addEventListener('click', runDuel);

  // Phase 12 - Cuisine Bingo
  document.getElementById('bingo-close-btn').addEventListener('click', closeBingo);
  document.getElementById('bingo-overlay').addEventListener('click', e => { if (e.target === document.getElementById('bingo-overlay')) closeBingo(); });
  document.getElementById('bingo-share-btn').addEventListener('click', () => {
    const card = _getBingoCard();
    const visitedCuisines = new Set(state.restaurants.map(r => r.cuisine?.toLowerCase()).filter(Boolean));
    const filled = card.filter(c => !c.free && visitedCuisines.has(c.n.toLowerCase())).length;
    const total = card.filter(c => !c.free).length;
    const txt = ` My Cuisine Bingo: ${filled}/${total} cuisines explored! #FeedTheBear`;
    if (navigator.share) { navigator.share({ title: 'Cuisine Bingo', text: txt }); }
    else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Bingo result copied.', 'success'); }
  });

  // Phase 12 - Fortune Cookie
  document.getElementById('fortune-close-btn').addEventListener('click', closeFortune);
  document.getElementById('fortune-overlay').addEventListener('click', e => { if (e.target === document.getElementById('fortune-overlay')) closeFortune(); });
  document.getElementById('fortune-cookie').addEventListener('click', crackFortuneCookie);
  document.getElementById('fortune-cookie').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') crackFortuneCookie(); });
  document.getElementById('fortune-again-btn').addEventListener('click', () => { _resetFortuneCookie(); });

  // Phase 12 - Mood Calendar
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
        const stars = r.myRating ? '⭐'.repeat(Math.round(r.myRating)) : '-';
        return `<div class="moodcal-visit-item">${stars} <span>${escHtml(r.name)}${r.cuisine ? ' · ' + escHtml(r.cuisine) : ''}</span></div>`;
      }).join('');
  });
  document.getElementById('moodcal-prev').addEventListener('click', () => {
    _moodCalMonth--; if (_moodCalMonth < 0) { _moodCalMonth = 11; _moodCalYear--; } _renderMoodCal();
  });
  document.getElementById('moodcal-next').addEventListener('click', () => {
    _moodCalMonth++; if (_moodCalMonth > 11) { _moodCalMonth = 0; _moodCalYear++; } _renderMoodCal();
  });

  // Phase 12 - Daily Challenge (disabled)
  document.getElementById('dailychallenge-close-btn')?.addEventListener('click', safeFn('closeDailyChallenge'));
  document.getElementById('dailychallenge-overlay')?.addEventListener('click', e => { if (e.target === document.getElementById('dailychallenge-overlay')) safeFn('closeDailyChallenge')(); });
  document.getElementById('dc-complete-btn')?.addEventListener('click', safeFn('completeDailyChallenge'));
  document.getElementById('dc-skip-btn')?.addEventListener('click', safeFn('skipDailyChallenge'));

  // Phase 13 - Visit Log
  document.getElementById('visitlog-close-btn').addEventListener('click', safeFn('closeVisitLog'));
  document.getElementById('visitlog-overlay').addEventListener('click', e => { if (e.target === document.getElementById('visitlog-overlay')) safeFn('closeVisitLog')(); });
  document.getElementById('visitlog-load-btn').addEventListener('click', safeFn('_loadVisitLogEntries'));
  document.getElementById('vl-save-btn').addEventListener('click', safeFn('_saveVisitLogEntry'));
  document.getElementById('vl-star-row').addEventListener('click', e => {
    const btn = e.target.closest('.vl-star');
    if (btn) safeFn('_setVlStars')(parseInt(btn.dataset.val));
  });

  // Phase 13 - Spend Tracker
  document.getElementById('spend-close-btn').addEventListener('click', safeFn('closeSpendTracker'));
  document.getElementById('spend-overlay').addEventListener('click', e => { if (e.target === document.getElementById('spend-overlay')) safeFn('closeSpendTracker')(); });

  // Phase 13 - Been a While
  document.getElementById('beenawhile-close-btn').addEventListener('click', safeFn('closeBeenaWhile'));
  document.getElementById('beenawhile-overlay').addEventListener('click', e => { if (e.target === document.getElementById('beenawhile-overlay')) safeFn('closeBeenaWhile')(); });

  // Phase 13 - Meal Planner
  document.getElementById('mealplanner-close-btn').addEventListener('click', safeFn('closeMealPlanner'));
  document.getElementById('mealplanner-overlay').addEventListener('click', e => { if (e.target === document.getElementById('mealplanner-overlay')) safeFn('closeMealPlanner')(); });
  document.getElementById('mp-generate-btn').addEventListener('click', safeFn('generateMealPlan'));

  // Phase 13 - Group Vote
  document.getElementById('groupvote-close-btn').addEventListener('click', safeFn('closeGroupVote'));
  document.getElementById('groupvote-overlay').addEventListener('click', e => { if (e.target === document.getElementById('groupvote-overlay')) safeFn('closeGroupVote')(); });
  document.getElementById('groupvote-generate-btn').addEventListener('click', safeFn('_generateVoteLink'));
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

  // Phase 13 - World Map
  document.getElementById('worldmap-close-btn').addEventListener('click', safeFn('closeWorldMap'));
  document.getElementById('worldmap-overlay').addEventListener('click', e => { if (e.target === document.getElementById('worldmap-overlay')) safeFn('closeWorldMap')(); });
  document.getElementById('worldmap-share-btn').addEventListener('click', () => {
    const { countries, cuisineVisits } = safeFn('_getVisitedCountries', () => ({ countries: new Set(), cuisineVisits: {} }))();
    const txt = ` I've tasted ${countries.size} countries & ${Object.keys(cuisineVisits).length} cuisines! #FeedTheBear`;
    if (navigator.share) navigator.share({ title: 'My Food World Map', text: txt });
    else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Map summary copied.', 'success'); }
  });

  // Phase 13 - Passport
  document.getElementById('passport-close-btn').addEventListener('click', safeFn('closePassport'));
  document.getElementById('passport-overlay').addEventListener('click', e => { if (e.target === document.getElementById('passport-overlay')) safeFn('closePassport')(); });

  // Phase 14 - Feed the Bear Game
  document.getElementById('feedbear-close-btn').addEventListener('click', safeFn('closeFeedBearGame'));
  document.getElementById('feedbear-overlay').addEventListener('click', e => { if (e.target === document.getElementById('feedbear-overlay')) safeFn('closeFeedBearGame')(); });
  document.getElementById('feedbear-canvas').addEventListener('click', safeFn('_ftbHandleCanvasTap'));
  document.getElementById('feedbear-canvas').addEventListener('touchstart', safeFn('_ftbHandleTouch'), { passive: false });
  document.getElementById('feedbear-canvas').addEventListener('touchmove', safeFn('_ftbHandleTouch'), { passive: false });
  document.addEventListener('keydown', safeFn('_ftbHandleKey'));
  document.addEventListener('keyup',   safeFn('_ftbHandleKey'));

  // Phase 11 - Weekly Goal
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

let _bearRoarAudioCtx = null;

function playBearRoarSfx () {
  const ACtx = window.AudioContext || window.webkitAudioContext;
  if (!ACtx) return;

  if (!_bearRoarAudioCtx) {
    _bearRoarAudioCtx = new ACtx();
  }

  const ctx = _bearRoarAudioCtx;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const duration = 0.34;
  const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.setValueAtTime(520, now);
  noiseFilter.Q.setValueAtTime(0.9, now);

  const bodyOsc = ctx.createOscillator();
  bodyOsc.type = 'sawtooth';
  bodyOsc.frequency.setValueAtTime(95, now);
  bodyOsc.frequency.exponentialRampToValueAtTime(62, now + duration);

  const growlOsc = ctx.createOscillator();
  growlOsc.type = 'triangle';
  growlOsc.frequency.setValueAtTime(160, now);
  growlOsc.frequency.exponentialRampToValueAtTime(75, now + duration * 0.9);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-20, now);
  limiter.knee.setValueAtTime(14, now);
  limiter.ratio.setValueAtTime(8, now);

  noise.connect(noiseFilter);
  noiseFilter.connect(gain);
  bodyOsc.connect(gain);
  growlOsc.connect(gain);
  gain.connect(limiter);
  limiter.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + duration);
  bodyOsc.start(now);
  bodyOsc.stop(now + duration);
  growlOsc.start(now);
  growlOsc.stop(now + duration);
}

function initBearRoarInteractions () {
  document.querySelectorAll('img.bear-mark').forEach(el => {
    if (el.dataset.roarBound === '1') return;
    el.dataset.roarBound = '1';
    el.title = el.title || 'Tap for a bear roar';
    el.addEventListener('click', () => {
      playBearRoarSfx();
      hapticTap('light');
    });
  });
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
  initHomeVibeTicker();
  initCollections();
  initOfflineIndicator();
  initSwipeGestures();
  initPullToRefresh();
  initDetailQuickCapture();
  initReminders();
  initInstallPrompt();
  initBearRoarInteractions();
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
      err => {
        // Permission revoked or unavailable - clear persisted flag so banner shows again
        state.settings.locationEnabled = false;
        state.locationEnabled = false;
        if (err?.code === 1) setLocationBannerCooldown();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
        updateLocationBanner();
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
  const roomCodeFromUrl = new URLSearchParams(window.location.search).get('room');
  if (roomCodeFromUrl) {
    state.activeDinnerRoomCode = String(roomCodeFromUrl).toUpperCase();
    openDinnerRooms();
  }
  // Post-render: add compare checkboxes if mode was active
  if (_compareMode) addCompareCheckboxes();
  // Wire home discovery buttons
  document.getElementById('nearby-home-more-btn')?.addEventListener('click', openDiscover);
  document.getElementById('nearby-lucky-btn')?.addEventListener('click', () => {
    hapticTap('medium');
    runNearbyLuckyBite();
  });
  document.getElementById('nearby-home-filters')?.addEventListener('click', e => {
    const chip = e.target.closest('.nearby-filter-chip[data-nearby-filter]');
    if (!chip) return;
    hapticTap('light');
    applyNearbyFilterMode(chip.dataset.nearbyFilter || 'all');
  });
  document.getElementById('home-quick-decision-btn')?.addEventListener('click', () => { hapticTap('medium'); openDecisionMode(); });
  document.getElementById('home-quick-pick-btn')?.addEventListener('click', () => { hapticTap('medium'); showTonightsPick(); });
  document.getElementById('home-quick-nearby-btn')?.addEventListener('click', () => { hapticTap('medium'); openDiscover(); });
  document.getElementById('home-quick-plan-btn')?.addEventListener('click', () => { hapticTap('medium'); openSmartPlanner(); });
  document.getElementById('home-quick-share-btn')?.addEventListener('click', () => { hapticTap('medium'); openShareHighlights(); });
  document.getElementById('home-quick-itinerary-btn')?.addEventListener('click', () => { hapticTap('medium'); openSmartItinerary(); });
  document.getElementById('home-quick-rooms-btn')?.addEventListener('click', () => { hapticTap('medium'); openDinnerRooms(); });
  document.getElementById('ai-rec-refresh-btn')?.addEventListener('click', () => {
    const cacheKey = 'ftb_airec_' + new Date().toDateString();
    sessionStorage.removeItem(cacheKey);
    const textEl = document.getElementById('ai-rec-text');
    if (textEl) textEl.textContent = 'Thinking…';
    if (_homeDiscCache) loadAiRec(_homeDiscCache);
  });
  document.getElementById('for-you-refresh-btn')?.addEventListener('click', () => {
    _forYouSeed = Date.now();
    renderForYouHome();
  });
  document.getElementById('mood-picks-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.home-mood-chip[data-mood]');
    if (!chip) return;
    document.querySelectorAll('.home-mood-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderMoodPicksHome(chip.dataset.mood || 'quick');
  });
  // Wire account/profile buttons
  document.getElementById('account-btn')?.addEventListener('click', openAccountModal);
  document.getElementById('account-close-btn')?.addEventListener('click', closeAccountModal);
  document.getElementById('account-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('account-overlay')) closeAccountModal();
  });
  document.getElementById('account-edit-btn')?.addEventListener('click', openEditProfile);
  document.getElementById('edit-profile-close-btn')?.addEventListener('click', () => {
    document.getElementById('edit-profile-overlay').classList.add('hidden'); maybeHideOverlay();
  });
  document.getElementById('edit-profile-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('edit-profile-overlay')) {
      document.getElementById('edit-profile-overlay').classList.add('hidden'); maybeHideOverlay();
    }
  });
  document.getElementById('personalize-close-btn')?.addEventListener('click', () => {
    document.getElementById('personalize-overlay').classList.add('hidden');
    maybeHideOverlay();
  });
  document.getElementById('personalize-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('personalize-overlay')) {
      document.getElementById('personalize-overlay').classList.add('hidden');
      maybeHideOverlay();
    }
  });
  document.getElementById('dish-board-close-btn')?.addEventListener('click', closeDishLeaderboard);
  document.getElementById('dish-board-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('dish-board-overlay')) closeDishLeaderboard();
  });
  document.getElementById('shared-manage-close-btn')?.addEventListener('click', closeSharedManageModal);
  document.getElementById('shared-manage-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('shared-manage-overlay')) closeSharedManageModal();
  });
  document.getElementById('shared-manage-collab-list')?.addEventListener('change', e => {
    const sel = e.target.closest('.shared-collab-role[data-collab]');
    if (sel) updateCollaboratorRole(sel.dataset.collab, sel.value);
  });
  document.getElementById('shared-manage-collab-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.shared-collab-remove[data-collab]');
    if (btn) removeCollaborator(btn.dataset.collab);
  });
  document.getElementById('smart-planner-close-btn')?.addEventListener('click', closeSmartPlanner);
  document.getElementById('smart-planner-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('smart-planner-overlay')) closeSmartPlanner();
  });
  document.getElementById('smart-plan-run-btn')?.addEventListener('click', runSmartPlanner);
  document.getElementById('decision-mode-close-btn')?.addEventListener('click', closeDecisionMode);
  document.getElementById('decision-mode-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('decision-mode-overlay')) closeDecisionMode();
  });
  document.getElementById('decision-mode-grid')?.addEventListener('click', e => {
    const chip = e.target.closest('.decision-chip[data-group][data-value]');
    if (!chip) return;
    setDecisionModeConstraint(chip.dataset.group, chip.dataset.value);
  });
  document.getElementById('decision-mode-run-btn')?.addEventListener('click', runDecisionMode);
  document.getElementById('decision-mode-results')?.addEventListener('click', e => {
    const btn = e.target.closest('.decision-result-action[data-action][data-id]');
    if (!btn) return;
    handleDecisionModeActionClick(btn);
  });
  document.getElementById('share-highlights-close-btn')?.addEventListener('click', closeShareHighlights);
  document.getElementById('share-highlights-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('share-highlights-overlay')) closeShareHighlights();
  });
  document.getElementById('share-weekly-card-btn')?.addEventListener('click', () => exportHighlightCard('weekly'));
  document.getElementById('share-mood-card-btn')?.addEventListener('click', () => exportHighlightCard('mood'));
  document.getElementById('share-dishes-card-btn')?.addEventListener('click', () => exportHighlightCard('dishes'));
  document.getElementById('smart-itinerary-close-btn')?.addEventListener('click', closeSmartItinerary);
  document.getElementById('smart-itinerary-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('smart-itinerary-overlay')) closeSmartItinerary();
  });
  document.getElementById('itinerary-build-btn')?.addEventListener('click', buildSmartItinerary);
  document.getElementById('dinner-rooms-close-btn')?.addEventListener('click', closeDinnerRooms);
  document.getElementById('dinner-rooms-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('dinner-rooms-overlay')) closeDinnerRooms();
  });
  document.getElementById('dinner-room-create-btn')?.addEventListener('click', createDinnerRoom);
  document.getElementById('dinner-room-join-btn')?.addEventListener('click', joinDinnerRoom);
  document.getElementById('dinner-room-code-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinDinnerRoom();
  });
  document.getElementById('dinner-room-share-btn')?.addEventListener('click', shareDinnerRoomInvite);
  document.getElementById('dinner-room-vote-btn')?.addEventListener('click', voteDinnerRoom);
  document.getElementById('dinner-room-lock-btn')?.addEventListener('click', lockDinnerRoomWinner);
  document.getElementById('settings-btn')?.addEventListener('click', openPersonalizeSettings);
  document.getElementById('command-palette-close-btn')?.addEventListener('click', closeCommandPalette);
  document.getElementById('command-palette-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('command-palette-overlay')) closeCommandPalette();
  });
  document.getElementById('command-palette-input')?.addEventListener('input', renderCommandPaletteResults);
  document.getElementById('command-palette-input')?.addEventListener('keydown', handleCommandPaletteKeydown);
  // Init user profile (shows setup on first run)
  initUserProfile();
  // Show home discovery teaser or load if location ready
  initHomeDiscoverySection();
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
    + '<div class="streak-msg">' + (currentStreak >= 5 ? ' ' : currentStreak >= 3 ? ' ' : currentStreak > 0 ? '✨ ' : '') + escHtml(msg) + '</div>';
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
function scoreTonightDiscoveryCandidate (c, moods = []) {
  const cuisine = String(c.cuisine || '').toLowerCase();
  let s = Math.random() * 0.35;
  const profile = getSwipePreferenceProfile();

  if (Number.isFinite(c.distMeters)) {
    s += Math.max(0, 3.2 - (c.distMeters / 700));
  }
  if (/Very Popular|Trending|Hot Nearby|Buzzing/i.test(String(c.popularity || ''))) s += 1.8;
  if (Number(c.priceLevel || 0) > 0) s += 0.4;

  if (moods.includes('new') && !c.isSaved) s += 2.4;
  if (moods.includes('budget') && Number(c.priceLevel || 0) <= 2) s += 2;
  if (moods.includes('fancy') && Number(c.priceLevel || 0) >= 3) s += 1.9;
  if (moods.includes('date') && Number(c.priceLevel || 0) >= 2) s += 1;
  if (moods.includes('comfort') && ['italian', 'american', 'mexican', 'japanese', 'chinese', 'indian'].some(x => cuisine.includes(x))) s += 1.7;
  if (moods.includes('healthy') && ['mediterranean', 'japanese', 'vietnamese', 'thai', 'greek', 'vegan'].some(x => cuisine.includes(x))) s += 1.8;
  if (moods.includes('quick') && Number(c.priceLevel || 0) <= 2) s += 1.1;
  if (moods.includes('surprise')) s += Math.random() * 2;

  // Learned swipe preferences (yes/no history).
  if (profile.total >= 6) {
    const ck = swipeCuisineKey(c);
    const cScore = Number(profile.byCuisine[ck] || 0);
    s += Math.max(-2.4, Math.min(2.4, cScore * 0.55));

    if (Number(c.priceLevel || 0) > 0) {
      s += Math.max(-1.1, Math.min(1.1, profile.priceBias * (Number(c.priceLevel || 0) - 2) * 0.35));
    }
    if (Number.isFinite(c.distMeters)) {
      const nearVal = Math.max(0, 1 - (Number(c.distMeters) / 3000));
      s += Math.max(-1.1, Math.min(1.1, profile.nearBias * nearVal * 2.2));
    }
  }

  return s;
}

async function runTonightsPick () {
  const moods = [...document.querySelectorAll('.mood-chip.selected')].map(c => c.dataset.mood);

  // Foodie-first mode: prioritize nearby live discovery cards.
  let nearbyLive = (_nearbyCards || []).filter(c => !c.isSaved);
  if (!nearbyLive.length && state.userLat && state.userLng) {
    try {
      await loadHomeDiscovery();
      nearbyLive = (_nearbyCards || []).filter(c => !c.isSaved);
    } catch (_) {
      // Ignore and continue to fallbacks below.
    }
  }

  if (nearbyLive.length) {
    const scored = nearbyLive.map(c => ({ c, s: scoreTonightDiscoveryCandidate(c, moods) }))
      .sort((a, b) => b.s - a.s);
    const p = scored[0].c;
    const price = Number(p.priceLevel || 0) ? '$'.repeat(Math.max(1, Math.min(4, Number(p.priceLevel || 0)))) : '';
    const cuisineLabel = formatCuisineLabel(p.cuisine || p.amenity || 'Restaurant');
    const dist = Number.isFinite(p.distMeters) ? fmtDist(p.distMeters) : '';
    const reason = getSwipePreferenceReasonForCandidate(p);
    const mapsDest = Number.isFinite(p.lat) && Number.isFinite(p.lon)
      ? `${p.lat},${p.lon}`
      : (p.address || p.name);

    const res = document.getElementById('tonight-result');
    res.innerHTML = '<div class="pick-name">' + escHtml(p.name) + '</div>'
      + '<div class="pick-meta">' + escHtml(cuisineLabel)
      + (price ? ' · ' + price : '')
      + (dist ? ' · ' + dist + ' away' : '')
      + (p.popularity ? ' · ' + escHtml(p.popularity) : '')
      + ' · Nearby discovery</div>'
      + (reason ? '<div class="pick-address">' + escHtml(reason) + '</div>' : '')
      + '<div class="pick-address">Fresh find around you, cub boss. Tap save to add it to your list.</div>'
      + '<div class="pick-actions">'
      + '<button class="btn-sm btn-orange" onclick="openAddModalPreFilled(\'' + String(p.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\',\'' + String(p.cuisine || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">+ Save Spot</button>'
      + (mapsDest ? '<a class="btn-sm btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(mapsDest) + '&travelmode=driving" target="_blank" rel="noopener"> Directions</a>' : '')
      + '</div>';
    res.classList.remove('hidden');
    return;
  }

  const all = state.restaurants;
  if (!all.length) {
    document.getElementById('tonight-result').innerHTML = state.userLat && state.userLng
      ? '<p style="text-align:center;color:var(--text-dim)">No nearby foodie finds right now. Try Discover Nearby for a wider scan.</p>'
      : '<p style="text-align:center;color:var(--text-dim)">Enable location and I will pick from nearby spots around you, not just saved places.</p>';
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
  const status = p.status === 'visited' ? '✅ Visited' : ' Want to Try';
  const vc = (p.visits||[]).length;
  const res = document.getElementById('tonight-result');
  res.innerHTML = '<div class="pick-name">' + escHtml(p.name) + '</div>'
    + '<div class="pick-meta">' + escHtml(p.cuisine||'Restaurant') + (price ? ' · '+price : '') + (stars ? ' · '+stars : '') + ' · ' + status + (vc > 0 ? ' · '+vc+' visit'+(vc>1?'s':'') : '') + '</div>'
    + (p.address ? '<div class="pick-address"> ' + escHtml(p.address) + '</div>' : '')
    + '<div class="pick-actions">'
    + '<button class="btn-sm btn-orange" onclick="openDetailModal(\'' + p.id + '\');closeTonightsPick()">View Details</button>'
    + (buildDirectionsDestination(p) ? '<a class="btn-sm btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center" href="' + buildGoogleDirectionsUrl(p) + '" target="_blank" rel="noopener"> Directions</a>' : '')
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
  const avgRating = rated.length ? (rated.reduce((s,r)=>s+r.myRating,0)/rated.length).toFixed(1) : '-';
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
    + '<div class="pr-stat"><div class="val">'+avgRating+(avgRating!=='-'?' ?':'')+'</div><div class="lbl">Avg Rating</div></div>'
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
    [['Been there','✅','var(--green)'],['Want to try','','var(--blue)'],['Never heard of it','','var(--text-dim)']].forEach(([lbl,em,col]) => {
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
  if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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

const CONFETTI_COLORS = ['#E8B15A','#FFD27A','#2ED573','#3498DB','#9B59B6','#FF69B4','#00CEC9'];
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
    showToast(' Milestone!', 'You have ' + hit + ' total check-in' + (hit>1?'s':'') + '! Keep exploring!', 'success');
  }
  // streak milestone
  if (next.length > prev.length) {
    const { currentStreak } = calcStreaks();
    if ([3,5,10,20].includes(currentStreak)) {
      launchConfetti(2500);
      showToast(' Streak ' + currentStreak + '!', currentStreak + '-week streak! You are a foodie legend.', 'success');
    }
  }
}

/* ------------------------------------------------------------
   PHASE 6 • AUTO DARK / LIGHT MODE
   ------------------------------------------------------------ */

let _autoThemeTimer = null;

function getAutoThemePresetByHour (hour = new Date().getHours()) {
  if (hour >= 6 && hour < 11) {
    return { mode: 'light', accent: 'mint', part: 'morning' };
  }
  if (hour >= 11 && hour < 17) {
    return { mode: 'light', accent: 'sunset', part: 'day' };
  }
  if (hour >= 17 && hour < 22) {
    return { mode: 'dark', accent: 'midnight', part: 'evening' };
  }
  return { mode: 'dark', accent: 'neon', part: 'late-night' };
}

function applyAutoThemeByClock (opts = {}) {
  if (state.settings.themeManual) return;
  const preset = getAutoThemePresetByHour();
  const partChanged = state.settings.autoThemePart !== preset.part;

  document.body.classList.toggle('light-mode', preset.mode === 'light');
  document.body.dataset.themeAccent = preset.accent;
  syncThemeMetaColor();

  state.settings.theme = preset.mode;
  state.settings.themeChoice = preset.mode === 'light' ? 'light' : 'dark';
  state.settings.autoThemePart = preset.part;

  if (opts.persist) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }
  if (partChanged && opts.announce) {
    const labels = {
      morning: 'Morning mode',
      day: 'Day mode',
      evening: 'Dinner mode',
      'late-night': 'Late night mode'
    };
    showToast('Ambient Theme', labels[preset.part] || 'Theme refreshed.', 'info');
  }
}

function scheduleNextAutoThemeTick () {
  if (_autoThemeTimer) clearTimeout(_autoThemeTimer);
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() + 1);
  const waitMs = Math.max(1000, next.getTime() - now.getTime() + 200);
  _autoThemeTimer = setTimeout(() => {
    applyAutoThemeByClock({ persist: true, announce: true });
    scheduleNextAutoThemeTick();
  }, waitMs);
}

function initAutoTheme () {
  // Only apply auto if no manual preference saved yet
  if (!state.settings.themeManual) {
    applyAutoThemeByClock({ persist: true, announce: false });
    scheduleNextAutoThemeTick();
  }
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
        celebrateVisit(r.name);
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
  const medals = ['','','','4th','5th','6th','7th','8th'];
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
    if (last > first + 0.3) insight = ' Trending upscale lately';
    else if (last < first - 0.3) insight = ' More budget-friendly recently';
    else insight = ' Spending has been consistent';
  }

  el.innerHTML = (insight ? '<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:8px">' + insight + '</div>' : '')
    + trendData.map(d => {
    const pct = d.avg > 0 ? (d.avg/maxAvg*100).toFixed(0) : 0;
    const label = d.avg > 0 ? ['','$','$$','$$$','$$$$'][Math.round(d.avg)]||'' : '-';
    return '<div class="bar-row">'
      + '<div class="bar-label">' + d.label + '</div>'
      + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--gold)"></div></div>'
      + '<div class="bar-count">' + (d.count > 0 ? label : '-') + '</div>'
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
  ['Italian',''],['Japanese',''],['Mexican',''],['Chinese',''],['Indian',''],
  ['American',''],['Thai',''],['French',''],['Mediterranean',''],['Korean',''],
  ['Vietnamese',''],['Greek',''],['Spanish',''],['Brazilian',''],['Ethiopian',''],
  ['Turkish',''],['Middle Eastern',''],['Caribbean',''],['Peruvian',''],['Sushi',''],
  ['Pizza',''],['Burgers',''],['Seafood',''],['Steakhouse',''],['Vegan',''],
  ['BBQ',''],['Dim Sum',''],['Tapas',''],['Ramen',''],['Breakfast',''],
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
      + '<span class="ps-emoji">' + (unlocked ? emoji : '') + '</span>'
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
    showToast(' Passport Stamped!', newUnlocks + ' new cuisine' + (newUnlocks>1?'s':'') + ' unlocked!', 'success');
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
    + '<div class="wrap-stat"><div class="ws-val">' + (ratedThatMonth.length > 0 ? (ratedThatMonth.reduce((s,v)=>s+(v.stars||0),0)/ratedThatMonth.length).toFixed(1)+' ★' : '-') + '</div><div class="ws-lbl">Avg Rating</div></div>'
    + '</div>'
    + (topCuisine ? '<div class="wrap-top"><h4>Top Cuisine</h4><div class="wrap-top-item">' + cuisineEmoji(topCuisine[0]) + ' ' + escHtml(topCuisine[0]) + '<span class="wrap-badge">' + topCuisine[1] + 'x</span></div></div>' : '')
    + (bestVisit ? '<div class="wrap-top"><h4>Best Visit</h4><div class="wrap-top-item">' + cuisineEmoji(bestVisit.r.cuisine) + ' ' + escHtml(bestVisit.r.name) + ' <span class="wrap-badge">?'.repeat(bestVisit.stars||0) + '</span></div></div>' : '')
    + (totalVisits === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-dim)">No visits logged this month. Time to get out there! </div>' : '');

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
  const text = 'My ' + month + ' foodie wrap: ' + total + ' meals out! Track yours with Feed The Bear.';
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
  const detail = encodeURIComponent((r.cuisine ? r.cuisine + ' · ' : '') + (r.website || '') + '\n\nAdded via Feed The Bear');
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

function setVoiceButtonsListening (isListening) {
  document.querySelectorAll('#search-voice-btn, #voice-btn').forEach(el => {
    if (isListening) el.classList.add('listening');
    else el.classList.remove('listening');
  });
}

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
  setVoiceButtonsListening(true);
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
  setVoiceButtonsListening(false);
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
  showToast(' Voice Captured!', '"' + name + '"' + (address ? ' at ' + address : '') + ' · review and save.', 'success');
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
    new Notification('Feed The Bear Reminder', {
      body: 'Time for your visit to ' + r.name + '!',
      icon: './icon-192.png',
    });
  }
  showToast(' Reminder!', 'Time for your visit to "' + r.name + '"!', 'success');
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
    { label: 'Cuisine',   fn: r => escHtml(r.cuisine||'-') },
    { label: 'Price',     fn: r => ['Free','$','$$','$$$','$$$$'][r.priceRange||0] },
    { label: 'My Rating', fn: r => r.myRating ? '?'.repeat(r.myRating) : '-', num: r => r.myRating||0 },
    { label: 'Google ?',  fn: r => r.googleRating ? r.googleRating + ' / 5' : '-', num: r => r.googleRating||0 },
    { label: 'Visits',    fn: r => String((r.visits||[]).length || (r.dateVisited?1:0)), num: r => (r.visits||[]).length||(r.dateVisited?1:0) },
    { label: 'Status',    fn: r => r.status === 'visited' ? '✅ Visited' : ' Want to Try' },
    { label: 'Address',   fn: r => escHtml((r.address||'-').slice(0,40)) },
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
  showToast(' Budget Saved!', 'Monthly budget set to $' + state.settings.monthlyBudget, 'success');
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
      else showToast(' ' + date, visited.map(r=>r.name).join(', '), 'success');
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
      new QRCode(tmp, { text: url, width:180, height:180, colorDark:'#E8B15A', colorLight:'#281F34' });
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
  const medals = ['','',''];
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
  const medals  = ['','',''];
  const priceMap = ['','$','$$','$$$','$$$$'];
  list.innerHTML = data.picks.map((p,i) =>
    '<div class="guest-item">'
    + '<div class="guest-item-photo">' + (p.p ? `<img src="${escHtml(p.p)}" alt="${escHtml(p.n)}" style="width:100%;height:100%;object-fit:cover;border-radius:10px" />` : (CUISINE_EMOJI[(p.c||'').toLowerCase()] || '')) + '</div>'
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
  showToast(' Shared!', '"' + name + '" opened for review · fill in details and save!', 'success');
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

const COMMAND_PALETTE_ACTIONS = [
  { label: 'View: All Restaurants', hint: 'Switch to all', keys: 'view all restaurants', run: () => setView('all') },
  { label: 'View: Want to Try', hint: 'Switch to want-to-try', keys: 'view want try wishlist', run: () => setView('want-to-try') },
  { label: 'View: Visited', hint: 'Switch to visited', keys: 'view visited history', run: () => setView('visited') },
  { label: 'View: Map', hint: 'Switch to map view', keys: 'view map', run: () => setView('map') },
  { label: 'View: Stats', hint: 'Switch to stats view', keys: 'view stats analytics', run: () => setView('stats') },
  { label: 'Action: Add Restaurant', hint: 'Open add modal', keys: 'add new create restaurant', run: openAddModal },
  { label: 'Action: Decision Mode', hint: 'Top 3 in under a minute', keys: 'decision mode winner shortlist quick', run: openDecisionMode },
  { label: 'Action: Smart Planner', hint: 'Build tonight plan', keys: 'planner plan tonight', run: openSmartPlanner },
  { label: 'Action: Smart Itinerary', hint: 'Generate multi-stop route', keys: 'itinerary route crawl', run: openSmartItinerary },
  { label: 'Action: Dinner Rooms', hint: 'Create or join voting room', keys: 'room rooms vote social', run: openDinnerRooms },
  { label: 'Action: Share Highlights', hint: 'Generate social card', keys: 'share highlight recap card', run: openShareHighlights },
  { label: 'Action: Discover Nearby', hint: 'Find local spots', keys: 'nearby discover find local', run: openDiscover },
  { label: 'Action: Craving Engine', hint: 'Get recommendation now', keys: 'craving recommend', run: openCravingEngine },
  { label: 'Action: Theme Toggle', hint: 'Switch dark/light', keys: 'theme dark light', run: toggleThemeFromPalette },
  { label: 'Action: Theme Auto Ambient', hint: 'Return to time-based mood theme', keys: 'theme auto ambient time day night', run: () => setAutoAmbientTheme(true) },
  { label: 'Action: Collections', hint: 'Manage lists', keys: 'collections lists shared', run: () => runToolAction('collections') },
];

function _paletteMatches (q, item) {
  if (!q) return true;
  const hay = `${item.label} ${item.hint} ${item.keys}`.toLowerCase();
  return q.split(/\s+/).every(tok => hay.includes(tok));
}

function openCommandPalette () {
  const ov = document.getElementById('command-palette-overlay');
  const input = document.getElementById('command-palette-input');
  if (!ov || !input) return;
  ov.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  input.value = '';
  state.commandPaletteIndex = 0;
  renderCommandPaletteResults();
  setTimeout(() => input.focus(), 30);
}

function closeCommandPalette () {
  document.getElementById('command-palette-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function renderCommandPaletteResults () {
  const input = document.getElementById('command-palette-input');
  const list = document.getElementById('command-palette-results');
  if (!list) return;
  const q = String(input?.value || '').trim().toLowerCase();
  const results = COMMAND_PALETTE_ACTIONS.filter(item => _paletteMatches(q, item)).slice(0, 14);
  if (!results.length) {
    list.innerHTML = '<div class="command-palette-empty">No commands found.</div>';
    return;
  }
  if (state.commandPaletteIndex >= results.length) state.commandPaletteIndex = 0;
  list.innerHTML = results.map((item, idx) => `
    <button class="command-row ${idx === state.commandPaletteIndex ? 'active' : ''}" data-cmd="${idx}" type="button">
      <span class="command-row-main">${escHtml(item.label)}</span>
      <span class="command-row-hint">${escHtml(item.hint)}</span>
    </button>
  `).join('');

  list.querySelectorAll('.command-row[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = results[Number(btn.dataset.cmd)];
      if (!sel) return;
      closeCommandPalette();
      setTimeout(() => sel.run(), 40);
    });
  });
}

function handleCommandPaletteKeydown (e) {
  const input = document.getElementById('command-palette-input');
  const q = String(input?.value || '').trim().toLowerCase();
  const results = COMMAND_PALETTE_ACTIONS.filter(item => _paletteMatches(q, item)).slice(0, 14);
  if (!results.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.commandPaletteIndex = (state.commandPaletteIndex + 1) % results.length;
    renderCommandPaletteResults();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.commandPaletteIndex = (state.commandPaletteIndex - 1 + results.length) % results.length;
    renderCommandPaletteResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const sel = results[state.commandPaletteIndex] || results[0];
    if (!sel) return;
    closeCommandPalette();
    setTimeout(() => sel.run(), 40);
  }
}

function initMoreMenu () {
  const btn  = document.getElementById('more-menu-btn');
  const menu = document.getElementById('more-menu');
  if (!btn || !menu) return;

  // The header button now opens the full Discover & Play hub (same as the
  // mobile bottom-nav "Play"). The legacy dropdown markup stays as a no-JS
  // fallback but is no longer toggled.
  btn.addEventListener('click', e => {
    e.stopPropagation();
    openMobileHub();
  });

  // Dispatch to existing handlers via data-more attribute
  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-more]');
    if (!item) return;
    menu.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    runToolAction(item.dataset.more);
  });
}

/* Single source of truth for every secondary tool / game.
   Shared by the desktop ⋯ menu and the mobile Discover & Play hub. */
const TOOL_ACTIONS = {
  'tonight':          () => document.getElementById('tonight-btn').click(),
  'command':          openCommandPalette,
  'craving':          openCravingEngine,
  'itinerary':        openSmartItinerary,
  'rooms':            openDinnerRooms,
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
  'passport':         openPassport,
  'worldmap':         openWorldMap,
  'visitlog':         openVisitLog,
  'spend':            openSpendTracker,
  'beenawhile':       openBeenaWhile,
  'mealplanner':      openMealPlanner,
  'groupvote':        openGroupVote,
  'wrap':             () => document.getElementById('wrap-btn').click(),
  'export':           () => document.getElementById('export-btn').click(),
  'import':           () => document.getElementById('import-file-input').click(),
  'import-bookmarks': () => document.getElementById('import-bookmarks-btn').click(),
  'pdf':              () => document.getElementById('pdf-export-btn').click(),
  'bulk':             () => document.getElementById('bulk-select-btn').click(),
  'collections':      () => document.getElementById('collections-btn').click(),
  'location':         () => document.getElementById('location-toggle-btn').click(),
};

function runToolAction (action) {
  const fn = TOOL_ACTIONS[action];
  if (fn) { hapticTap('light'); fn(); }
}

/* ── Mobile Discover & Play hub ─────────────────────────────
   Replaces the unscrollable 40-item ⋯ menu on phones with a
   thumb-friendly, searchable grid of tiles, grouped by intent. */
const HUB_SECTIONS = [
  { title: ' Decide tonight', items: [
    ['tonight','',"Tonight's Pick"], ['craving','','Craving Engine'],
    ['command','⌘','Command Palette'], ['itinerary','','Smart Itinerary'],
    ['rooms','','Dinner Rooms'],
    ['spin','','Spin the Wheel'], ['swipe','','Swipe to Decide'],
    ['duel','','Restaurant Duel'], ['fortune','','Fortune Cookie'],
  ]},
  { title: ' Discover', items: [
    ['discover','','Smart Discovery'], ['open-now','','Open Now'],
    ['travel','✈','Travel Mode'], ['route','','Route Planner'],
    ['mealplanner','','Meal Planner'], ['worldmap','','Cuisine Map'],
  ]},
  { title: ' Play & earn', items: [
    ['challenge','','Challenges'], ['achievements','','Achievements'],
    ['bingo','','Cuisine Bingo'],
    ['feedbear','','Feed the Bear'], ['passport','','Passport'],
    ['moodcal','','Mood Calendar'],
  ]},
  { title: ' Track', items: [
    ['gallery','','Photo Gallery'], ['dishes','','Dish Tracker'],
    ['visitlog','','Visit Log'], ['budget','','Budget'],
    ['spend','','Spend Tracker'], ['compare','⚖','Compare'],
    ['beenawhile','⏰','Been a While'],
  ]},
  { title: ' Social & stats', items: [
    ['profile','','My Profile'], ['friends','','Friends'],
    ['groupvote','','Group Vote'], ['stats2','','Deep Stats'],
    ['ai-panel','','Byte Cub'], ['review','','Year in Review'],
    ['wrap','','Monthly Wrap'], ['digest','','Monthly Digest'],
  ]},
  { title: ' Data & tools', items: [
    ['collections','','My Lists'], ['bulk','☑','Bulk Select'],
    ['location','','Location'], ['export2','','Export Passport'],
    ['export','','Export JSON'], ['import','','Import JSON'],
    ['import-bookmarks','','Import Bookmarks'], ['pdf','','Export PDF'],
  ]},
];

function renderMobileHub (filter = '') {
  const body = document.getElementById('mobile-hub-body');
  if (!body) return;
  const q = filter.trim().toLowerCase();
  const html = HUB_SECTIONS.map(sec => {
    const items = sec.items.filter(([, , label]) => !q || label.toLowerCase().includes(q));
    if (!items.length) return '';
    return `<div class="hub-section">
      <div class="hub-section-title">${sec.title}</div>
      <div class="hub-grid">
        ${items.map(([action, emoji, label]) => `<button class="hub-tile" data-tool="${action}">
          <span class="hub-tile-emoji">${emoji}</span>
          <span class="hub-tile-label">${label}</span>
        </button>`).join('')}
      </div>
    </div>`;
  }).join('');
  body.innerHTML = html || '<p class="hub-empty">No tools match “' + filter + '”.</p>';
}

function openMobileHub () {
  hapticTap('medium');
  const ov = document.getElementById('mobile-hub-overlay');
  if (!ov) return;
  const search = document.getElementById('mobile-hub-search');
  if (search) search.value = '';
  renderMobileHub();
  ov.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeMobileHub () {
  document.getElementById('mobile-hub-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function initMobileHub () {
  document.getElementById('mobile-hub-close')?.addEventListener('click', closeMobileHub);
  document.getElementById('mobile-hub-search')?.addEventListener('input', e => renderMobileHub(e.target.value));
  document.getElementById('mobile-hub-body')?.addEventListener('click', e => {
    const tile = e.target.closest('.hub-tile');
    if (!tile) return;
    const action = tile.dataset.tool;
    closeMobileHub();
    runToolAction(action);
  });
}

/* Switch the main list/map/stats view from any control (nav, stat chips). */
function setView (view) {
  document.querySelectorAll('.nav-btn, .mobile-nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-view="${view}"]`)?.classList.add('active');
  document.querySelector(`.mobile-nav-btn[data-view="${view}"]`)?.classList.add('active');
  state.currentView = view;
  if (view === 'map') { showMapView(); }
  else if (view === 'stats') { showStatsView(); }
  else { hideMapView(); hideStatsView(); renderCards(); }
}

/* ------------------------------------------------------------
   PHASE 8 •  CRAVING ENGINE
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
  const savedCandidates = state.restaurants.filter(r => r.status === 'want-to-try' || r.status === 'visited');
  const nearbyCandidates = getNearbyDiscoveryRows(20);
  const candidates = savedCandidates.length ? savedCandidates : nearbyCandidates;
  if (!candidates.length) {
    document.getElementById('craving-result').innerHTML = '<p style="color:var(--text-dim);text-align:center">No nearby data yet. Run Discover first, then try Craving Engine again.</p>';
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
  const rating  = winner.myRating ? '?'.repeat(winner.myRating) : (winner.status === 'want-to-try' ? ' Want to Try' : '');

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
    <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--primary);margin-bottom:10px"> Tonight's Match</div>
    <div class="craving-match-name">${cuisineEmoji(winner.cuisine)} ${escHtml(winner.name)}</div>
    <div class="craving-match-meta">${escHtml(cuisine)}${price ? ' · ' + price : ''}${rating ? ' · ' + rating : ''}</div>
    <div class="craving-match-why">${escHtml(why)}</div>
    <div class="craving-match-actions">
      <button class="btn-primary btn-sm" onclick="${winner._nearbyElement
        ? `openAddModalPreFilled('${String(winner.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}','${String(winner.cuisine || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',{name:'${String(winner.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',address:'${String(winner.address || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',website:'${String(winner.website || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',lat:${Number.isFinite(winner.lat) ? Number(winner.lat) : 'null'},lon:${Number.isFinite(winner.lng) ? Number(winner.lng) : 'null'}});closeCravingEngine()`
        : `openDetailModal('${winner.id}');closeCravingEngine()`}">View</button>
      ${runner ? `<button class="btn-ghost btn-sm" onclick="runCravingEngine()"> Try Again</button>` : ''}
    </div>
  `;
  resultEl.classList.remove('hidden');
}

/* ------------------------------------------------------------
   PHASE 8 •  DISH TRACKER
   ------------------------------------------------------------ */

let _dishRating = 0;
const DISHES_KEY = 'ftb_dishes_v1';
const MENU_NOTES_KEY = 'ftb_menu_notes_v1';
let _detailMenuReaction = 'neutral';

function getDishes () {
  try { return JSON.parse(localStorage.getItem(DISHES_KEY)) || {}; } catch(_) { return {}; }
}
function saveDishes (data) { localStorage.setItem(DISHES_KEY, JSON.stringify(data)); }

function getMenuNotes () {
  try { return JSON.parse(localStorage.getItem(MENU_NOTES_KEY)) || {}; } catch (_) { return {}; }
}
function saveMenuNotes (data) { localStorage.setItem(MENU_NOTES_KEY, JSON.stringify(data)); }

function setDetailMenuReaction (reaction = 'neutral') {
  _detailMenuReaction = reaction;
  document.querySelectorAll('.detail-menu-react-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.reaction === reaction);
  });
}

function resetDetailMenuForm () {
  const formEl = document.getElementById('detail-menu-form');
  if (formEl) formEl.classList.add('hidden');
  const itemEl = document.getElementById('detail-menu-item-input');
  const noteEl = document.getElementById('detail-menu-note-input');
  const favEl = document.getElementById('detail-menu-fav-input');
  if (itemEl) itemEl.value = '';
  if (noteEl) noteEl.value = '';
  if (favEl) favEl.checked = false;
  setDetailMenuReaction('neutral');
}

function saveDetailMenuItem () {
  if (!state.detailId) return;
  const name = (document.getElementById('detail-menu-item-input')?.value || '').trim();
  if (!name) {
    showToast('Item name required', 'Add a menu item name first.', 'error');
    return;
  }
  const note = (document.getElementById('detail-menu-note-input')?.value || '').trim();
  const favorite = !!document.getElementById('detail-menu-fav-input')?.checked;
  const notes = getMenuNotes();
  if (!Array.isArray(notes[state.detailId])) notes[state.detailId] = [];
  notes[state.detailId].push({
    id: uid(),
    name,
    note,
    reaction: _detailMenuReaction,
    favorite,
    date: iso(),
  });
  saveMenuNotes(notes);
  resetDetailMenuForm();
  renderDetailMenuList(state.detailId);
  showToast('Saved', `${name} added to menu notes.`, 'success');
}

function renderDetailMenuList (restaurantId) {
  const listEl = document.getElementById('detail-menu-list');
  if (!listEl) return;
  const notes = getMenuNotes();
  const list = (notes[restaurantId] || []).slice().reverse();
  if (!list.length) {
    listEl.innerHTML = '<div class="dish-empty">No menu notes yet. Add your first dish above.</div>';
    return;
  }
  listEl.innerHTML = list.map(item => {
    const reaction = item.reaction === 'liked' ? '' : item.reaction === 'disliked' ? '' : '';
    const fav = item.favorite ? '⭐ ' : '';
    const note = item.note ? `<div class="detail-menu-item-note">${escHtml(item.note)}</div>` : '';
    const cls = item.reaction === 'liked' ? 'liked' : item.reaction === 'disliked' ? 'disliked' : 'neutral';
    return `<div class="detail-menu-item ${cls}">
      <div class="detail-menu-item-top">
        <div class="detail-menu-item-name">${fav}${escHtml(item.name)}</div>
        <div class="detail-menu-item-reaction">${reaction}</div>
      </div>
      ${note}
    </div>`;
  }).join('');
}

function openDishTracker (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  state.detailId = restaurantId;
  document.getElementById('dish-title').textContent = ' Dish Tracker';
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
   PHASE 8 •  YEAR IN REVIEW
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
    slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">No visits in ${yr}</div><div class="review-slide-value">0</div><div class="review-slide-sub">Start logging your visits!</div></div>`);
  } else {
    slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">Meals Out in ${yr}</div><div class="review-slide-value">${totalVisits}</div><div class="review-slide-sub">across ${uniqueRestaurants} restaurant${uniqueRestaurants!==1?'s':''}</div></div>`);
    if (topCuisine) slides.push(`<div class="review-slide"><div class="review-slide-emoji">${cuisineEmoji(topCuisine[0])}</div><div class="review-slide-title">Your #1 Cuisine</div><div class="review-slide-value">${escHtml(topCuisine[0])}</div><div class="review-slide-sub">${topCuisine[1]} visit${topCuisine[1]!==1?'s':''} · you really love it</div></div>`);
    if (totalCuisines > 1) slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">Cuisines Explored</div><div class="review-slide-value">${totalCuisines}</div><div class="review-slide-sub">You ate: ${Object.keys(cuisineMap).slice(0,5).join(', ')}</div></div>`);
    if (mostVisited) slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">Your Go-To Spot</div><div class="review-slide-value" style="font-size:1.3rem">${escHtml(mostVisited.name)}</div><div class="review-slide-sub">${cuisineEmoji(mostVisited.cuisine)} ${mostVisited.cuisine||''}</div></div>`);
    if (avgRating) slides.push(`<div class="review-slide"><div class="review-slide-emoji">?</div><div class="review-slide-title">Your Average Rating</div><div class="review-slide-value">${avgRating} / 5</div><div class="review-slide-sub">${avgRating>=4.5?'You have high standards!':avgRating>=3.5?'You eat well ?':'Room to discover better spots'}</div></div>`);
    if (months[peakMonthIdx] > 0) slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">Most Active Month</div><div class="review-slide-value">${MONTH_NAMES[peakMonthIdx]}</div><div class="review-slide-sub">${months[peakMonthIdx]} meal${months[peakMonthIdx]!==1?'s':''} out that month</div></div>`);
    slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">Estimated Dining Spend</div><div class="review-slide-value">~$${estimatedSpend.toLocaleString()}</div><div class="review-slide-sub">Based on ${totalVisits} visits · $${state.settings.avgSpend||35}/avg</div></div>`);
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
  const text = ` My ${yr} Foodie Year: ${yearVisits.length} meals out, ${new Set(yearVisits.map(r=>r.id)).size} restaurants. Track yours at Feed The Bear!`;
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

function openAddModalPreFilled (name, cuisine, prefill = null) {
  closeFoodieFriends();
  openAddModal();
  _pendingAddPrefill = (prefill && typeof prefill === 'object') ? { ...prefill } : null;
  setTimeout(() => {
    document.getElementById('form-name').value = name;
    if (cuisine) document.getElementById('form-cuisine').value = cuisine;
    if (_pendingAddPrefill?.address) document.getElementById('form-address').value = String(_pendingAddPrefill.address || '').trim();
    if (_pendingAddPrefill?.website) document.getElementById('form-website').value = String(_pendingAddPrefill.website || '').trim();
    if (_pendingAddPrefill?.photo) document.getElementById('form-photo').value = String(_pendingAddPrefill.photo || '').trim();
  }, 100);
}

/* ------------------------------------------------------------
   HOME DISCOVERY - Near You Now strip + AI Rec banner
   ------------------------------------------------------------ */
let _homeDiscCache = null;
let _homeDiscCacheTime = 0;
const HOME_DISC_TTL = 15 * 60 * 1000; // 15 min
let _forYouSeed = Date.now();
let _nearbyFilterMode = 'all';
let _nearbyCards = [];
let _nearbyBannerMsg = '';
let _pendingAddPrefill = null;
const _placePhotoCache = new Map();
const _placePhotoPending = new Map();

function getPlacePhotoLookupKey (card = {}) {
  const name = normalizeName(card.name || '');
  const lat = Number.isFinite(card.lat) ? Number(card.lat).toFixed(4) : '';
  const lon = Number.isFinite(card.lon) ? Number(card.lon).toFixed(4) : '';
  return `${name}|${lat}|${lon}`;
}

async function fetchPlacePhotoFromApi (card = {}) {
  const name = String(card.name || '').trim();
  if (!name) return '';

  const params = new URLSearchParams();
  params.set('name', name);
  if (Number.isFinite(card.lat)) params.set('lat', String(card.lat));
  if (Number.isFinite(card.lon)) params.set('lon', String(card.lon));
  if (card.address) {
    const cityGuess = String(card.address).split(',').slice(-1)[0].trim();
    if (cityGuess) params.set('city', cityGuess);
  }

  if (card.website) params.set('website', String(card.website));

  let resp = await fetch(`/api/restaurant-image?${params.toString()}`);
  if (!resp.ok) {
    resp = await fetch(`/api/place-photo?${params.toString()}`);
  }
  if (!resp.ok) return '';
  const data = await resp.json();
  return safeUrl(data?.photoUrl || '');
}

function isLikelyRealPlacePhotoUrl (url = '') {
  const safe = safeUrl(url || '');
  if (!safe) return false;
  const raw = safe.toLowerCase();

  // Avoid known non-photo assets that frequently come from meta tags.
  if (/(logo|icon|favicon|avatar|gravatar|sprite|placeholder|default[_-]?image|og-default|map[_-]?pin|marker)/i.test(raw)) {
    return false;
  }
  return true;
}

function hasReliableNearbyCardPhoto (card = {}) {
  const raw = String(card?.photoUrl || '').trim();
  const safe = safeUrl(raw);
  if (!safe) return false;

  // Local food assets are acceptable placeholders, but not "proper place" photos.
  if (/^(\.\/)?assets\/food\//i.test(raw)) return false;

  if (/^https?:\/\//i.test(safe)) return isLikelyRealPlacePhotoUrl(safe);
  return true;
}

async function fetchPlacePhotoFromWikiClient (card = {}) {
  const name = String(card.name || '').trim();
  if (!name) return '';

  const lat = Number(card.lat);
  const lon = Number(card.lon);

  const nameTokens = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !['the', 'and', 'restaurant', 'cafe', 'bar', 'grill'].includes(t));
  const titleMatchesVenue = (title = '') => {
    if (!nameTokens.length) return false;
    const t = String(title || '').toLowerCase();
    const hits = nameTokens.filter(tok => t.includes(tok)).length;
    return hits / nameTokens.length >= 0.6;
  };

  // 1) Nearby geosearch with thumbnail - only accept pages titled like the venue.
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const geoUrl = new URL('https://en.wikipedia.org/w/api.php');
    geoUrl.searchParams.set('action', 'query');
    geoUrl.searchParams.set('format', 'json');
    geoUrl.searchParams.set('formatversion', '2');
    geoUrl.searchParams.set('generator', 'geosearch');
    geoUrl.searchParams.set('ggscoord', `${lat}|${lon}`);
    geoUrl.searchParams.set('ggsradius', '400');
    geoUrl.searchParams.set('ggslimit', '10');
    geoUrl.searchParams.set('prop', 'pageimages');
    geoUrl.searchParams.set('piprop', 'thumbnail');
    geoUrl.searchParams.set('pithumbsize', '1200');
    geoUrl.searchParams.set('origin', '*');

    const geoResp = await fetch(geoUrl.toString());
    if (geoResp.ok) {
      const geoJson = await geoResp.json();
      const pages = Object.values(geoJson?.query?.pages || {});
      const match = pages.find(p => titleMatchesVenue(p?.title) && safeUrl(p?.thumbnail?.source || ''));
      if (match) return safeUrl(match.thumbnail.source);
    }
  }

  // 2) Name search fallback - only accept a result titled like the venue.
  const q = `${name} restaurant`;
  const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('formatversion', '2');
  searchUrl.searchParams.set('list', 'search');
  searchUrl.searchParams.set('srlimit', '5');
  searchUrl.searchParams.set('srsearch', q);
  searchUrl.searchParams.set('origin', '*');

  const searchResp = await fetch(searchUrl.toString());
  if (!searchResp.ok) return '';
  const searchJson = await searchResp.json();
  const first = (searchJson?.query?.search || []).find(r => titleMatchesVenue(r?.title));
  if (!first?.pageid) return '';

  const pageUrl = new URL('https://en.wikipedia.org/w/api.php');
  pageUrl.searchParams.set('action', 'query');
  pageUrl.searchParams.set('format', 'json');
  pageUrl.searchParams.set('formatversion', '2');
  pageUrl.searchParams.set('pageids', String(first.pageid));
  pageUrl.searchParams.set('prop', 'pageimages');
  pageUrl.searchParams.set('piprop', 'thumbnail');
  pageUrl.searchParams.set('pithumbsize', '1200');
  pageUrl.searchParams.set('origin', '*');

  const pageResp = await fetch(pageUrl.toString());
  if (!pageResp.ok) return '';
  const pageJson = await pageResp.json();
  const page = Object.values(pageJson?.query?.pages || {})[0] || null;
  return safeUrl(page?.thumbnail?.source || '');
}

async function getOrFetchPlacePhoto (card = {}) {
  const key = getPlacePhotoLookupKey(card);
  if (!key || key === '||') return '';

  if (_placePhotoCache.has(key)) return _placePhotoCache.get(key) || '';
  if (_placePhotoPending.has(key)) return _placePhotoPending.get(key);

  const pending = (async () => {
    try {
      let url = '';
      try {
        url = await fetchPlacePhotoFromApi(card);
      } catch {
        url = '';
      }
      if (!url) {
        try {
          url = await fetchPlacePhotoFromWikiClient(card);
        } catch {
          url = '';
        }
      }
      _placePhotoCache.set(key, url || '');
      return url || '';
    } catch {
      _placePhotoCache.set(key, '');
      return '';
    } finally {
      _placePhotoPending.delete(key);
    }
  })();

  _placePhotoPending.set(key, pending);
  return pending;
}

function syncSwipeDeckPhotosFromNearby () {
  const deck = Array.isArray(state.swipeDeck) ? state.swipeDeck : [];
  if (!deck.length) return;

  const byKey = new Map((_nearbyCards || []).map(c => [String(c.key || ''), c]));
  let changed = false;
  state.swipeDeck = deck.map(item => {
    if (!item || item.source !== 'nearby') return item;
    const fromNearby = byKey.get(String(item.key || ''));
    const nextPhoto = safeUrl(fromNearby?.photoUrl || '');
    if (!nextPhoto || !hasReliableNearbyCardPhoto(fromNearby)) return item;
    if (hasReliableNearbyCardPhoto(item) && safeUrl(item.photoUrl || '') === nextPhoto) return item;
    changed = true;
    return { ...item, photoUrl: nextPhoto, photoSource: fromNearby?.photoSource || 'place' };
  });

  if (changed) renderBearSwipeCard();
}

async function enrichNearbyCardsRealPhotos () {
  const candidates = (_nearbyCards || [])
    .filter(c => !hasReliableNearbyCardPhoto(c))
    .filter(c => !c.isSaved)
    .slice(0, 12);

  if (!candidates.length) return;

  // Small batches so we do not trip provider rate limits (Yelp ~5 QPS).
  const results = [];
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = candidates.slice(i, i + 3);
    const settled = await Promise.allSettled(
      batch.map(async card => ({ card, url: await getOrFetchPlacePhoto(card) }))
    );
    results.push(...settled);
  }

  let changed = false;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { card, url } = r.value;
    if (!url || !isLikelyRealPlacePhotoUrl(url)) continue;
    const idx = _nearbyCards.findIndex(c => String(c.key) === String(card.key));
    if (idx < 0) continue;
    if (hasReliableNearbyCardPhoto(_nearbyCards[idx])) continue;
    _nearbyCards[idx] = { ..._nearbyCards[idx], photoUrl: url, photoSource: 'place' };
    changed = true;
  }

  if (changed) {
    renderNearbyCardsFromState();
    syncSwipeDeckPhotosFromNearby();
  }
}

function getNearbyRadiusMiles () {
  return Math.max(1, Math.min(5, Number(state.settings.nearbyRadiusMiles) || 1));
}

function getNearbyRadiusMeters () {
  return getNearbyRadiusMiles() * 1609.34;
}

function getFilteredNearbyCards (cards = _nearbyCards, mode = _nearbyFilterMode) {
  if (!Array.isArray(cards) || !cards.length) return [];
  if (mode === 'trending') {
    return cards.filter(c => /Very Popular|Trending|Hot Nearby|Buzzing/i.test(String(c.popularity || '')));
  }
  if (mode === 'budget') {
    return cards.filter(c => Number(c.priceLevel || 0) <= 2);
  }
  return cards;
}

function renderNearbyCardsFromState () {
  const list = document.getElementById('nearby-home-list');
  if (!list) return;
  const filtered = getFilteredNearbyCards();

  if (!filtered.length) {
    const msg = _nearbyFilterMode === 'budget'
      ? 'No budget picks in this batch yet. Try All or Trending.'
      : _nearbyFilterMode === 'trending'
        ? 'No trending picks right now. Try All for more options.'
        : 'No nearby cards to show yet.';
    list.innerHTML = `<div class="nearby-home-loading">${escHtml(msg)}</div>`;
    return;
  }

  list.innerHTML = `${_nearbyBannerMsg ? `<div class="nearby-home-loading">${escHtml(_nearbyBannerMsg)}</div>` : ''}` +
    filtered.map(card => renderNearbyVisualCard(card)).join('');
}

function setNearbyCards (cards = [], opts = {}) {
  const preferredNearbyFallbackByCuisine = (cuisine = '', amenity = '') => {
    const raw = `${String(cuisine || '').toLowerCase()} ${String(amenity || '').toLowerCase()}`;
    if (/(mexican|taco|birria|burrito|quesadilla|enchilada)/.test(raw)) return ['assets/food/tacos.jpg', 'assets/food/burrito.jpg', 'assets/food/quesadilla.jpg'];
    if (/(irish|pub|gastropub|fish and chips|shepherd|bangers)/.test(raw)) return ['assets/food/steak.jpg', 'assets/food/burger.jpg', 'assets/food/seafood.jpg'];
    if (/(italian|pasta|pizza|ristorante)/.test(raw)) return ['assets/food/italian_pasta.jpg', 'assets/food/pasta.jpg', 'assets/food/pizza.jpg'];
    if (/(japanese|sushi|ramen)/.test(raw)) return ['assets/food/sushi.jpg', 'assets/food/ramen.jpg', 'assets/food/udon.jpg'];
    if (/(korean)/.test(raw)) return ['assets/food/korean_bbq.jpg', 'assets/food/bibimbap.jpg'];
    if (/(chinese|dumpling|wok)/.test(raw)) return ['assets/food/dumplings.jpg', 'assets/food/chow_mein.jpg', 'assets/food/fried_rice.jpg'];
    if (/(indian|curry|masala|biryani)/.test(raw)) return ['assets/food/butter_chicken.jpg', 'assets/food/biryani.jpg', 'assets/food/indian_curry.jpg'];
    if (/(thai|pad thai)/.test(raw)) return ['assets/food/pad_thai.jpg', 'assets/food/thai_curry.jpg'];
    if (/(seafood|fish|shrimp)/.test(raw)) return ['assets/food/seafood.jpg', 'assets/food/shrimp.jpg', 'assets/food/salmon.jpg'];
    if (/(burger|american|diner)/.test(raw)) return ['assets/food/burger.jpg', 'assets/food/fries.jpg', 'assets/food/fried_chicken.jpg'];
    return [];
  };

  const assignDiverseNearbyFallbackPhotos = (rows = []) => {
    return rows.map((card, idx) => {
      if (!card || typeof card !== 'object') return card;

      const existingRaw = String(card.photoUrl || '').trim();
      const existing = safeUrl(existingRaw);
      const hasLocalFoodAsset = /^(\.\/)?assets\/food\//i.test(existingRaw);
      const canKeepExisting = card.isSaved ? !!existing : hasReliableNearbyCardPhoto(card);

      if (canKeepExisting) return card;
      if (hasLocalFoodAsset && existing) {
        return { ...card, photoUrl: existing, photoSource: 'local' };
      }

      const term = `${card.name || ''} ${card.cuisine || card.amenity || 'food'}`.trim();
      const seed = `${card.key || idx}|${card.name || ''}|${card.cuisine || ''}`;
      const preferred = preferredNearbyFallbackByCuisine(card.cuisine || '', card.amenity || '');
      const general = getMoodFoodImageCandidates(term, seed)
        .map(u => safeUrl(u || ''))
        .filter(Boolean);
      const pool = (preferred.length ? preferred : general)
        .map(u => safeUrl(u || ''))
        .filter(Boolean);
      const pickedIndex = pool.length ? (miniHash(seed) % pool.length) : 0;
      const chosen = pool[pickedIndex] || safeUrl('assets/food/pizza.jpg');

      return chosen ? { ...card, photoUrl: chosen, photoSource: 'local' } : card;
    });
  };

  _nearbyCards = assignDiverseNearbyFallbackPhotos(Array.isArray(cards) ? cards : []);
  _nearbyBannerMsg = String(opts.banner || '');
  renderNearbyCardsFromState();
  enrichNearbyCardsRealPhotos();
}

function runNearbyLuckyBite () {
  const picks = getFilteredNearbyCards();
  if (!picks.length) {
    showToast('No bites yet', 'No nearby cards are available for Lucky Bite right now.', 'info');
    return;
  }
  const pick = picks[Math.floor(Math.random() * picks.length)];
  const list = document.getElementById('nearby-home-list');
  if (list) {
    list.querySelectorAll('.nearby-home-card.lucky').forEach(el => el.classList.remove('lucky'));
    const cardEl = list.querySelector(`.nearby-home-card[data-nearby-key="${pick.key}"]`);
    if (cardEl) {
      cardEl.classList.add('lucky');
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  showToast('Lucky Bite!', `${pick.name} is tonight's wild card.`, 'success');
  if (pick.isSaved && pick.restaurantId) {
    setTimeout(() => openDetailModal(pick.restaurantId), 180);
  } else {
    setTimeout(() => {
      if (Number.isFinite(pick.lat) && Number.isFinite(pick.lon)) {
        const dest = `${pick.lat},${pick.lon}`;
        window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`, '_blank', 'noopener');
      } else {
        openDiscover();
      }
    }, 180);
  }
}

function applyNearbyFilterMode (mode = 'all') {
  _nearbyFilterMode = ['all', 'trending', 'budget'].includes(mode) ? mode : 'all';
  document.querySelectorAll('.nearby-filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.nearbyFilter === _nearbyFilterMode);
  });
  renderNearbyCardsFromState();
}

async function fetchOverpassElements (query, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || 6000;
  const endpoints = opts.endpoints || [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];

  const overpassAttempt = async () => {
    let lastErr = null;
    for (const endpoint of endpoints) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const body = new URLSearchParams({ data: query });
        const resp = await fetch(endpoint, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!resp.ok) throw new Error(`Overpass ${resp.status}`);
        const json = await resp.json();
        const elements = json.elements || [];
        if (elements.length) return elements;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Nearby lookup unavailable');
  };

  const useNominatim = opts.nominatimFallback && Number.isFinite(opts.lat) && Number.isFinite(opts.lng);
  if (!useNominatim) {
    return overpassAttempt();
  }

  const nominatimAttempt = async () => {
    const fallback = await fetchNominatimNearbyElements(
      opts.lat,
      opts.lng,
      Number(opts.radiusMeters) || 1609,
      Number(opts.limit) || 30
    );
    if (!fallback.length) throw new Error('Nominatim empty');
    return fallback;
  };

  try {
    // Return whichever source responds first with usable nearby places.
    return await Promise.any([overpassAttempt(), nominatimAttempt()]);
  } catch (err) {
    throw err || new Error('Nearby lookup unavailable');
  }
}

async function fetchNominatimNearbyElements (lat, lng, radiusMeters = 1609, limit = 30) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) return [];

  const dLat = radiusMeters / 111320;
  const dLng = radiusMeters / (111320 * Math.max(0.2, Math.cos(safeLat * Math.PI / 180)));
  const left = safeLng - dLng;
  const right = safeLng + dLng;
  const top = safeLat + dLat;
  const bottom = safeLat - dLat;
  const viewbox = `${left},${top},${right},${bottom}`;
  const terms = ['restaurant', 'cafe', 'fast food', 'bar'];

  const responses = await Promise.all(terms.map(async term => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&bounded=1&extratags=1&addressdetails=1&limit=${Math.max(6, Math.ceil(limit / terms.length))}&viewbox=${encodeURIComponent(viewbox)}&q=${encodeURIComponent(term)}`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!resp.ok) return [];
    const json = await resp.json();
    return Array.isArray(json) ? json : [];
  }));

  const seen = new Set();
  const merged = [];
  responses.flat().forEach(item => {
    const nLat = Number(item.lat);
    const nLng = Number(item.lon);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return;

    const name = String(item.name || item.display_name || '').split(',')[0].trim();
    if (!name) return;

    const key = `${normalizeName(name)}|${nLat.toFixed(5)}|${nLng.toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);

    merged.push({
      lat: nLat,
      lon: nLng,
      tags: {
        name,
        amenity: String(item.type || 'restaurant').replace(/_/g, ' '),
        cuisine: item.extratags?.cuisine || '',
        opening_hours: item.extratags?.opening_hours || '',
        website: item.extratags?.website || '',
        phone: item.extratags?.phone || '',
        'addr:street': item.address?.road || item.address?.pedestrian || item.address?.suburb || '',
        'addr:city': item.address?.city || item.address?.town || item.address?.village || item.address?.county || '',
      },
    });
  });

  return merged.slice(0, limit);
}

function getWeekStartIso () {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  return start.toISOString().slice(0, 10);
}

function scoreMoodPick (r, mood) {
  const cuisine = String(r.cuisine || '').toLowerCase();
  let s = Math.random() * 0.25;
  s += (r.myRating || 0) * 1.5;
  s += r.isFavorite ? 1.6 : 0;
  s += r.status === 'want-to-try' ? 1.2 : 0.2;
  if (Number.isFinite(distOf(r))) s += Math.max(0, 1.2 - distOf(r) / 4500);

  if (mood === 'quick') {
    if ((r.priceRange || 0) <= 2) s += 1.6;
    if (['cafe', 'pizza', 'american', 'mexican', 'thai'].some(c => cuisine.includes(c))) s += 1.1;
  } else if (mood === 'date') {
    if ((r.priceRange || 0) >= 2) s += 1.5;
    if ((r.googleRating || 0) >= 4.4) s += 1.2;
    if (['italian', 'french', 'japanese', 'seafood', 'steakhouse'].some(c => cuisine.includes(c))) s += 1.2;
  } else if (mood === 'comfort') {
    if (['italian', 'american', 'mexican', 'indian', 'chinese', 'bbq'].some(c => cuisine.includes(c))) s += 1.8;
    if ((r.priceRange || 0) <= 3) s += 0.8;
  } else if (mood === 'healthy') {
    if (['mediterranean', 'greek', 'japanese', 'vietnamese', 'thai', 'vegan'].some(c => cuisine.includes(c))) s += 1.8;
    if ((r.priceRange || 0) <= 3) s += 0.5;
  }
  return s;
}

function renderMoodPicksHome (selectedMood = null) {
  const section = document.getElementById('mood-picks-home');
  const list = document.getElementById('mood-picks-list');
  const chipsWrap = document.getElementById('mood-picks-chips');
  if (!section || !list || !chipsWrap) return;

  if (!state.restaurants.length) {
    section.classList.add('hidden');
    return;
  }

  const activeChip = chipsWrap.querySelector('.home-mood-chip.active');
  const mood = selectedMood || activeChip?.dataset.mood || 'quick';
  chipsWrap.querySelectorAll('.home-mood-chip').forEach(ch => ch.classList.toggle('active', ch.dataset.mood === mood));

  const picks = [...state.restaurants]
    .map(r => ({ ...r, _moodScore: scoreMoodPick(r, mood) }))
    .sort((a, b) => b._moodScore - a._moodScore)
    .slice(0, 3);

  section.classList.remove('hidden');
  if (!picks.length) {
    list.innerHTML = '<div class="for-you-empty">Add more restaurants to unlock mood picks.</div>';
    return;
  }

  list.innerHTML = picks.map(r => {
    const meta = `${escHtml(r.cuisine || 'Restaurant')}${r.myRating ? ` • ${'★'.repeat(r.myRating)}` : ''}`;
    const dist = distOf(r);
    const distMeta = Number.isFinite(dist) ? ` • ${fmtDist(dist)} away` : '';
    const moodFit = Math.max(40, Math.min(98, Math.round(r._moodScore * 9.5)));
    return `<button class="mood-pick-card" type="button" data-id="${r.id}">
      <div class="mood-pick-top">
        <div class="mood-pick-name">${escHtml(r.name)}</div>
        <div class="mood-pick-fit">${moodFit}%</div>
      </div>
      <div class="mood-pick-meta">${meta}${distMeta}</div>
      <div class="mood-pick-meter"><span style="width:${moodFit}%"></span></div>
    </button>`;
  }).join('');

  list.querySelectorAll('.mood-pick-card[data-id]').forEach(btn => {
    btn.addEventListener('click', () => openDetailModal(btn.dataset.id));
  });
}

function renderWeeklyRecapHome () {
  const wrap = document.getElementById('week-recap-home');
  const text = document.getElementById('week-recap-text');
  if (!wrap || !text) return;

  if (!state.restaurants.length) {
    wrap.classList.add('hidden');
    return;
  }

  const weekStart = getWeekStartIso();
  let checkins = 0;
  const cuisineHits = {};

  state.restaurants.forEach(r => {
    const visits = r.visits || [];
    visits.forEach(v => {
      if ((v.date || '') >= weekStart) {
        checkins++;
        const c = r.cuisine || 'Other';
        cuisineHits[c] = (cuisineHits[c] || 0) + 1;
      }
    });
    if ((r.dateVisited || '') >= weekStart && !visits.length) {
      checkins++;
      const c = r.cuisine || 'Other';
      cuisineHits[c] = (cuisineHits[c] || 0) + 1;
    }
  });

  const fav = state.restaurants.filter(r => r.isFavorite).length;
  const topCuisine = Object.entries(cuisineHits).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No streak yet';
  text.innerHTML = `<strong>${checkins}</strong> check-in${checkins === 1 ? '' : 's'} this week • <strong>${fav}</strong> favorite${fav === 1 ? '' : 's'} • <strong>${escHtml(topCuisine)}</strong> in the lead`;
  wrap.classList.remove('hidden');
}

function renderTodayStatusRow () {
  const row = document.getElementById('today-status-row');
  if (!row) return;

  const all = state.restaurants || [];
  const favorites = all.filter(r => r.isFavorite).length;
  const visited = all.filter(r => r.status === 'visited').length;
  const nearby = all.filter(r => Number.isFinite(distOf(r)) && distOf(r) <= getNearbyRadiusMeters()).length;
  const avgMine = all.filter(r => (r.myRating || 0) > 0);
  const avg = avgMine.length ? (avgMine.reduce((s, r) => s + (r.myRating || 0), 0) / avgMine.length).toFixed(1) : null;

  row.innerHTML = `
    <span class="today-status-pill">Saved <strong>${all.length}</strong></span>
    <span class="today-status-pill">Visited <strong>${visited}</strong></span>
    <span class="today-status-pill">Favorites <strong>${favorites}</strong></span>
    <span class="today-status-pill">Nearby <strong>${nearby}</strong></span>
    <span class="today-status-pill">Average <strong>${avg ? `${avg}★` : '-'}</strong></span>
  `;
}

let _homeVibeTicker = null;

function getHomeVibeMeta (hour = new Date().getHours()) {
  if (hour < 11) {
    return { key: 'morning', label: 'Brunch Hunt' };
  }
  if (hour < 17) {
    return { key: 'day', label: 'Lunch Mode' };
  }
  if (hour < 22) {
    return { key: 'evening', label: 'Dinner Prime' };
  }
  return { key: 'night', label: 'Late Bite' };
}

function applyHomeVibeMood (vibeKey) {
  if (!vibeKey) return;

  const prev = document.body.dataset.homeVibe || '';
  document.body.dataset.homeVibe = vibeKey;

  const header = document.querySelector('.app-header');
  if (header && prev && prev !== vibeKey) {
    header.classList.remove('header-vibe-shift');
    void header.offsetWidth;
    header.classList.add('header-vibe-shift');
  }
}

function renderTodayVibeRow () {
  const row = document.getElementById('today-vibe-row');
  if (!row) return;

  const vibeMeta = getHomeVibeMeta();
  const mood = document.querySelector('.home-mood-chip.active')?.textContent?.trim() || 'Quick';
  const nearby = state.restaurants.filter(r => Number.isFinite(distOf(r)) && distOf(r) <= getNearbyRadiusMeters()).length;

  applyHomeVibeMood(vibeMeta.key);
  const prevVibe = row.dataset.vibe || '';
  row.dataset.vibe = vibeMeta.key;
  if (prevVibe && prevVibe !== vibeMeta.key) {
    row.classList.remove('today-vibe-refresh');
    void row.offsetWidth;
    row.classList.add('today-vibe-refresh');
  }

  row.innerHTML = `
    <span class="today-vibe-pill">Now: ${vibeMeta.label}</span>
    <span class="today-vibe-pill">Mood: ${escHtml(mood)}</span>
    <span class="today-vibe-pill">Nearby: ${nearby}</span>
  `;
}

function initHomeVibeTicker () {
  if (_homeVibeTicker) clearInterval(_homeVibeTicker);
  _homeVibeTicker = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    renderTodayVibeRow();
  }, 15 * 60 * 1000);
}

function stageHomeModules () {
  const home = document.getElementById('home-discovery');
  if (!home || state.settings.uiMotion === 'reduced' || state.settings.homeModulesStaged) return;
  home.classList.add('staged');
  state.settings.homeModulesStaged = true;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  setTimeout(() => home.classList.remove('staged'), 900);
}

function getDishLeaderboardData () {
  const map = {};
  const toItems = (val) => Array.isArray(val) ? val : (val && typeof val === 'object' ? Object.values(val) : []);
  const notes = getMenuNotes();
  Object.entries(notes).forEach(([restaurantId, items]) => {
    toItems(items).forEach(item => {
      const key = String(item.name || '').trim().toLowerCase();
      if (!key) return;
      if (!map[key]) map[key] = { key, name: item.name, score: 0, count: 0, restaurants: new Set(), topRestaurantId: restaurantId };
      const row = map[key];
      row.count += 1;
      row.restaurants.add(restaurantId);
      row.score += item.reaction === 'liked' ? 3 : item.reaction === 'disliked' ? -2 : 1;
      if (item.favorite) row.score += 2;
    });
  });

  const dishes = getDishes();
  Object.entries(dishes).forEach(([restaurantId, items]) => {
    toItems(items).forEach(item => {
      const key = String(item.name || '').trim().toLowerCase();
      if (!key) return;
      if (!map[key]) map[key] = { key, name: item.name, score: 0, count: 0, restaurants: new Set(), topRestaurantId: restaurantId };
      const row = map[key];
      row.count += 1;
      row.restaurants.add(restaurantId);
      row.score += Math.max(1, item.rating || 0);
    });
  });

  return Object.values(map)
    .map(row => ({ ...row, restaurantCount: row.restaurants.size }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 12);
}

function openDishLeaderboard () {
  const overlay = document.getElementById('dish-board-overlay');
  const list = document.getElementById('dish-board-list');
  if (!overlay || !list) return;

  const top = getDishLeaderboardData();
  if (!top.length) {
    list.innerHTML = '<div class="dish-empty">No dish data yet. Start adding dish notes and ratings first.</div>';
  } else {
    list.innerHTML = top.map((d, i) => {
      const badge = i < 3 ? ['', '', ''][i] : `#${i + 1}`;
      return `<button class="dish-board-row" type="button" data-id="${d.topRestaurantId}">
        <div class="dish-board-rank">${badge}</div>
        <div class="dish-board-main">
          <div class="dish-board-name">${escHtml(d.name)}</div>
          <div class="dish-board-meta">${d.count} note${d.count === 1 ? '' : 's'} • ${d.restaurantCount} place${d.restaurantCount === 1 ? '' : 's'}</div>
        </div>
        <div class="dish-board-score">${d.score}</div>
      </button>`;
    }).join('');
    list.querySelectorAll('.dish-board-row[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeDishLeaderboard();
        setTimeout(() => openDetailModal(btn.dataset.id), 120);
      });
    });
  }

  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeDishLeaderboard () {
  document.getElementById('dish-board-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function miniHash (str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function forYouReason (item) {
  if (item.isFavorite) return 'Favorite';
  if (item._distMeters < 1300) return 'Near you';
  if ((item.myRating || 0) >= 4) return 'Highly rated';
  if (item.status === 'want-to-try') return 'Try next';
  return 'Good match';
}

const DAILY_QUEST_DEFS = {
  add_spot: {
    title: 'Add One New Spot',
    desc: 'Add one restaurant to your list today.',
    cta: 'Add a Spot Now',
    progressLabel: 'spots added'
  },
  rate_spot: {
    title: 'Drop a Fresh Rating',
    desc: 'Rate one restaurant to sharpen your recommendation engine.',
    cta: 'Rate a Spot',
    progressLabel: 'ratings added'
  },
  note_spot: {
    title: 'Leave a Flavor Note',
    desc: 'Write notes for one spot so future you can pick smarter.',
    cta: 'Add Notes',
    progressLabel: 'notes added'
  },
  favorite_spot: {
    title: 'Crown a Favorite',
    desc: 'Mark one place as favorite to train your premium picks.',
    cta: 'Pick a Favorite',
    progressLabel: 'favorites added'
  },
  visit_spot: {
    title: 'Log a Visit',
    desc: 'Move one restaurant into visited and keep your history current.',
    cta: 'Log a Visit',
    progressLabel: 'visits logged'
  }
};

function getDailyQuestDateKey () {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getQuestMetricValue (type) {
  const all = state.restaurants || [];
  if (type === 'add_spot') return all.length;
  if (type === 'rate_spot') return all.filter(r => (r.myRating || 0) > 0).length;
  if (type === 'note_spot') return all.filter(r => String(r.notes || '').trim().length >= 12).length;
  if (type === 'favorite_spot') return all.filter(r => r.isFavorite).length;
  if (type === 'visit_spot') return all.filter(r => r.status === 'visited').length;
  return 0;
}

function getQuestTypeCandidates () {
  const all = state.restaurants || [];
  const hasRestaurants = all.length > 0;
  const candidates = ['add_spot'];
  if (hasRestaurants) {
    candidates.push('rate_spot', 'note_spot', 'favorite_spot', 'visit_spot');
  }
  return candidates;
}

function createDailyQuest () {
  const date = getDailyQuestDateKey();
  const types = getQuestTypeCandidates();
  const pick = types[miniHash(`${date}|${state.restaurants.length}`) % types.length];
  const base = getQuestMetricValue(pick);
  return { date, type: pick, base, claimedAt: null };
}

function loadDailyQuest () {
  try {
    return JSON.parse(localStorage.getItem(DAILY_QUEST_KEY)) || null;
  } catch {
    return null;
  }
}

function saveDailyQuest (quest) {
  localStorage.setItem(DAILY_QUEST_KEY, JSON.stringify(quest));
}

function getDailyQuestState () {
  let quest = loadDailyQuest();
  const today = getDailyQuestDateKey();
  if (!quest || quest.date !== today || !DAILY_QUEST_DEFS[quest.type]) {
    quest = createDailyQuest();
    saveDailyQuest(quest);
  }
  return quest;
}

function getQuestActionRestaurant (type) {
  const all = state.restaurants || [];
  if (!all.length) return null;
  if (type === 'rate_spot') return all.find(r => (r.myRating || 0) === 0) || all[0];
  if (type === 'note_spot') return all.find(r => String(r.notes || '').trim().length < 12) || all[0];
  if (type === 'favorite_spot') return all.find(r => !r.isFavorite) || all[0];
  if (type === 'visit_spot') return all.find(r => r.status !== 'visited') || all[0];
  return all[0];
}

function launchQuestAction (type) {
  if (type === 'add_spot') {
    openAddModal();
    return;
  }
  const target = getQuestActionRestaurant(type);
  if (!target) {
    showToast('Daily Quest', 'Add at least one restaurant to start this quest.', 'info');
    return;
  }
  openDetailModal(target.id);
}

function claimDailyQuestReward (quest) {
  if (quest.claimedAt) return;
  quest.claimedAt = Date.now();
  saveDailyQuest(quest);
  awardXp(20, 'Daily Quest');
  showCelebrationMoment('Daily Quest Complete', 'Reward claimed: +20 XP', { durationMs: 2100, glow: true, confetti: true, confettiMs: 2000, haptic: 'medium' });
  showToast('Quest Complete', 'Daily quest reward claimed: +20 XP.', 'success');
}

function onDailyQuestPrimaryClick () {
  const quest = getDailyQuestState();
  const now = getQuestMetricValue(quest.type);
  const done = now >= ((quest.base || 0) + 1);
  if (done) {
    claimDailyQuestReward(quest);
    renderDailyQuestHome();
    return;
  }
  launchQuestAction(quest.type);
}

function renderDailyQuestHome () {
  const wrap = document.getElementById('daily-quest-home');
  if (!wrap) return;

  const quest = getDailyQuestState();
  const def = DAILY_QUEST_DEFS[quest.type] || DAILY_QUEST_DEFS.add_spot;
  const base = Number(quest.base || 0);
  const now = getQuestMetricValue(quest.type);
  const target = base + 1;
  const delta = Math.max(0, now - base);
  const pct = Math.max(0, Math.min(100, Math.round((delta / Math.max(1, target - base)) * 100)));
  const done = now >= target;
  const claimed = !!quest.claimedAt;
  const label = done ? (claimed ? 'Reward claimed' : 'Claim reward') : def.cta;
  const meterDeg = Math.round((pct / 100) * 360);

  wrap.classList.add('compact-quest-pill');
  wrap.innerHTML = `
    <div class="daily-quest-compact-wrap">
      <button
        id="daily-quest-action-btn"
        class="daily-quest-pulse-btn ${done && !claimed ? 'is-ready' : ''} ${done && claimed ? 'is-claimed' : ''}"
        type="button"
        title="${escHtml(def.title)} - ${escHtml(def.desc)}"
        style="--quest-arc:${meterDeg}deg;"
      >
        <span class="daily-quest-pulse-core">DQ</span>
      </button>
      <div class="daily-quest-compact-meta">
        <div class="daily-quest-compact-title">Daily Quest ${done && !claimed ? 'Ready' : ''}</div>
        <div class="daily-quest-compact-desc">${escHtml(label)} • ${Math.min(delta, 1)}/1</div>
      </div>
      <button id="daily-quest-open-achievements-btn" class="daily-quest-btn" type="button">Stats</button>
    </div>
  `;

  const actionBtn = document.getElementById('daily-quest-action-btn');
  const achievementsBtn = document.getElementById('daily-quest-open-achievements-btn');
  if (actionBtn) {
    actionBtn.disabled = done && claimed;
    actionBtn.onclick = () => onDailyQuestPrimaryClick();
  }
  if (achievementsBtn) achievementsBtn.onclick = () => openAchievements();
}

function renderForYouHome () {
  const section = document.getElementById('for-you-home');
  const list = document.getElementById('for-you-home-list');
  if (!section || !list) return;

  const all = state.restaurants || [];
  if (!all.length) {
    section.classList.add('hidden');
    return;
  }

  // getMenuNotes() is already a map keyed by restaurant id ({ id: [notes] })
  const notesByRestaurant = getMenuNotes() || {};

  const scored = all.map(r => {
    const notes = notesByRestaurant[String(r.id)] || [];
    const likedCount = notes.filter(n => n.reaction === 'liked').length;
    const dislikedCount = notes.filter(n => n.reaction === 'disliked').length;
    const favDishCount = notes.filter(n => n.favorite).length;
    const dist = distOf(r);
    const nearbyBonus = Number.isFinite(dist) ? Math.max(0, 7 - dist / 850) : 0;
    const ratingScore = (r.myRating || 0) * 7 + (r.googleRating || 0) * 2;
    const statusScore = r.status === 'want-to-try' ? 8 : 3;
    const favoriteScore = r.isFavorite ? 14 : 0;
    const noteScore = likedCount * 5 + favDishCount * 3 - dislikedCount * 5;
    const varietyJitter = (miniHash(`${r.id}|${_forYouSeed}`) % 100) / 100;
    const score = ratingScore + statusScore + favoriteScore + noteScore + nearbyBonus + varietyJitter;
    return { ...r, _score: score, _distMeters: dist };
  }).sort((a, b) => b._score - a._score).slice(0, 3);

  section.classList.remove('hidden');
  if (!scored.length) {
    list.innerHTML = '<div class="for-you-empty">Add a few restaurants and ratings to unlock your personalized picks.</div>';
    return;
  }

  list.innerHTML = scored.map(r => {
    const reason = forYouReason(r);
    const dist = Number.isFinite(r._distMeters) ? fmtDist(r._distMeters) : '';
    const rating = r.myRating ? ` • You ${'★'.repeat(r.myRating)}` : (r.googleRating ? ` • ⭐${r.googleRating}` : '');
    const match = Math.max(45, Math.min(99, Math.round(r._score * 1.7)));
    const basePhoto = pickRealRestaurantPhoto({ savedRestaurant: r, cuisine: r.cuisine, amenity: 'restaurant', allowFallback: false });
    const cachedPhoto = safeUrl(_placePhotoCache.get(getPlacePhotoLookupKey({ name: r.name, lat: r.lat, lon: r.lng })) || '');
    const photoUrl = safeUrl(basePhoto.url || '') || cachedPhoto;
    const sourceLabel = basePhoto.source === 'user' ? 'Your photo' : (cachedPhoto ? 'Wikipedia photo' : 'No photo yet');
    return `<button class="for-you-card" data-id="${r.id}" type="button" title="Open ${escHtml(r.name)}">
      <div class="for-you-card-top">
        <span class="for-you-chip">${escHtml(reason)}</span>
        <span class="for-you-chip alt">${match}% match</span>
      </div>
      <div class="for-you-row">
        ${photoUrl ? `<img class="for-you-thumb" src="${escHtml(photoUrl)}" alt="${escHtml(r.name)}" loading="lazy" />` : ''}
        <div class="for-you-content">
        <div class="for-you-card-name">${escHtml(r.name)}</div>
        <div class="for-you-card-meta">${escHtml(r.cuisine || 'Restaurant')}${rating}</div>
        <div class="for-you-card-meta">${dist ? ` ${dist}` : (r.status === 'want-to-try' ? 'Ready when you are' : 'Saved in your den')}</div>
        <div class="for-you-source">${escHtml(sourceLabel)}</div>
        </div>
      </div>
      <div class="for-you-meter"><span style="width:${match}%"></span></div>
    </button>`;
  }).join('');

  list.querySelectorAll('.for-you-card[data-id]').forEach(el => {
    el.addEventListener('click', () => openDetailModal(el.dataset.id));
  });

  enrichForYouHomePhotos(scored);
}

async function enrichForYouHomePhotos (scoredRows = []) {
  const rows = Array.isArray(scoredRows) ? scoredRows : [];
  const targets = rows
    .filter(r => !safeUrl(r.photo || ''))
    .slice(0, 3);

  if (!targets.length) return;

  let changed = false;
  for (const r of targets) {
    const key = getPlacePhotoLookupKey({ name: r.name, lat: r.lat, lon: r.lng });
    if (_placePhotoCache.has(key) && _placePhotoCache.get(key)) continue;
    const found = await getOrFetchPlacePhoto({ name: r.name, lat: r.lat, lon: r.lng, address: r.address });
    if (found) changed = true;
  }

  if (changed) {
    renderForYouHome();
  }
}

function pickRandom (arr = []) {
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function setBearSwipeJoke (text = '') {
  const jokeEl = document.getElementById('bear-swipe-joke');
  if (!jokeEl) return;
  jokeEl.textContent = text || pickRandom(BEAR_SWIPE_JOKES);
}

function buildSwipeDeckFromElements (elements = []) {
  const profile = getSwipePreferenceProfile();
  return (elements || []).slice(0, 24).map((el, idx) => {
    const tags = el.tags || {};
    const cuisine = (tags.cuisine || '').split(';')[0];
    const amenity = tags.amenity || 'restaurant';
    const cuisineLabel = formatCuisineLabel(cuisine || amenity || 'restaurant');
    const photoPick = pickRealRestaurantPhoto({ tags, cuisine, amenity, width: 960, height: 640 });
    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ');
    return {
      key: `nearby-${el.id || idx}`,
      source: 'nearby',
      name: tags.name || 'Mystery Spot',
      cuisine,
      cuisineLabel,
      amenity,
      distMeters: Number.isFinite(el._dist) ? el._dist : Infinity,
      lat,
      lon,
      address,
      photoUrl: photoPick.url,
      photoFallbacks: getMoodFoodImageCandidates(cuisine || amenity || 'food', `nearby-${el.id || idx}`).slice(1),
      photoSource: photoPick.source,
      isSaved: false,
      restaurantId: null,
      priceLevel: estimatePriceLevel({ cuisine, amenity, savedRestaurant: null }),
    };
  }).sort((a, b) => {
    const aC = Number(profile.byCuisine[swipeCuisineKey(a)] || 0);
    const bC = Number(profile.byCuisine[swipeCuisineKey(b)] || 0);
    let aS = Math.max(-2.2, Math.min(2.2, aC * 0.5));
    let bS = Math.max(-2.2, Math.min(2.2, bC * 0.5));
    if (Number(a.priceLevel || 0) > 0) aS += Math.max(-0.8, Math.min(0.8, profile.priceBias * (Number(a.priceLevel || 0) - 2) * 0.3));
    if (Number(b.priceLevel || 0) > 0) bS += Math.max(-0.8, Math.min(0.8, profile.priceBias * (Number(b.priceLevel || 0) - 2) * 0.3));
    if (Number.isFinite(a.distMeters)) aS += Math.max(-0.8, Math.min(0.8, profile.nearBias * Math.max(0, 1 - (Number(a.distMeters) / 3000)) * 2));
    if (Number.isFinite(b.distMeters)) bS += Math.max(-0.8, Math.min(0.8, profile.nearBias * Math.max(0, 1 - (Number(b.distMeters) / 3000)) * 2));
    return bS - aS;
  }).slice(0, 12);
}

function buildSwipeDeckFromSaved (savedRows = []) {
  const profile = getSwipePreferenceProfile();
  return (savedRows || []).slice(0, 20).map((r, idx) => {
    const cuisine = r.cuisine || '';
    const cuisineLabel = formatCuisineLabel(cuisine || 'Restaurant');
    const photoPick = pickRealRestaurantPhoto({ savedRestaurant: r, cuisine, amenity: 'restaurant', width: 960, height: 640 });
    return {
      key: `saved-${r.id || idx}`,
      source: 'saved',
      name: r.name || 'Saved Spot',
      cuisine,
      cuisineLabel,
      amenity: 'restaurant',
      distMeters: Number.isFinite(r._distMeters) ? r._distMeters : Infinity,
      lat: Number.isFinite(r.lat) ? r.lat : null,
      lon: Number.isFinite(r.lng) ? r.lng : null,
      address: r.address || '',
      photoUrl: photoPick.url,
      photoFallbacks: getMoodFoodImageCandidates(cuisine || 'food', `saved-${r.id || idx}`).slice(1),
      photoSource: photoPick.source,
      isSaved: true,
      restaurantId: r.id || null,
      priceLevel: Number(r.priceRange || 0) || estimatePriceLevel({ cuisine, amenity: 'restaurant', savedRestaurant: r }),
    };
  }).sort((a, b) => {
    const aC = Number(profile.byCuisine[swipeCuisineKey(a)] || 0);
    const bC = Number(profile.byCuisine[swipeCuisineKey(b)] || 0);
    let aS = Math.max(-2, Math.min(2, aC * 0.45));
    let bS = Math.max(-2, Math.min(2, bC * 0.45));
    if (Number(a.priceLevel || 0) > 0) aS += Math.max(-0.7, Math.min(0.7, profile.priceBias * (Number(a.priceLevel || 0) - 2) * 0.3));
    if (Number(b.priceLevel || 0) > 0) bS += Math.max(-0.7, Math.min(0.7, profile.priceBias * (Number(b.priceLevel || 0) - 2) * 0.3));
    return bS - aS;
  }).slice(0, 10);
}

const BEAR_SWIPE_LOCAL_FALLBACKS = [
  'assets/food/pizza.jpg',
  'assets/food/pasta.jpg',
  'assets/food/steak.jpg',
  'assets/food/fried_chicken.jpg',
  'assets/food/churros.jpg',
  'assets/food/tacos.jpg',
  'assets/food/sushi.jpg'
];

const BEAR_SWIPE_LOCAL_FOOD_IMAGES = {
  pancakes: 'assets/food/pancakes.jpg',
  waffles: 'assets/food/waffles.jpg',
  omelette: 'assets/food/omelette.jpg',
  french_toast: 'assets/food/french_toast.jpg',
  eggs_benedict: 'assets/food/eggs_benedict.jpg',
  burger: 'assets/food/burger.jpg',
  fries: 'assets/food/fries.jpg',
  pizza: 'assets/food/pizza.jpg',
  pasta: 'assets/food/pasta.jpg',
  lasagna: 'assets/food/lasagna.jpg',
  gnocchi: 'assets/food/gnocchi.jpg',
  italian_pasta: 'assets/food/italian_pasta.jpg',
  sushi: 'assets/food/sushi.jpg',
  ramen: 'assets/food/ramen.jpg',
  udon: 'assets/food/udon.jpg',
  dumplings: 'assets/food/dumplings.jpg',
  fried_rice: 'assets/food/fried_rice.jpg',
  chow_mein: 'assets/food/chow_mein.jpg',
  biryani: 'assets/food/biryani.jpg',
  butter_chicken: 'assets/food/butter_chicken.jpg',
  tikka_masala: 'assets/food/tikka_masala.jpg',
  dosa: 'assets/food/dosa.jpg',
  indian_curry: 'assets/food/indian_curry.jpg',
  pad_thai: 'assets/food/pad_thai.jpg',
  thai_curry: 'assets/food/thai_curry.jpg',
  pho: 'assets/food/pho.jpg',
  banh_mi: 'assets/food/banh_mi.jpg',
  tacos: 'assets/food/tacos.jpg',
  burrito: 'assets/food/burrito.jpg',
  quesadilla: 'assets/food/quesadilla.jpg',
  enchiladas: 'assets/food/enchiladas.jpg',
  shawarma: 'assets/food/shawarma.jpg',
  kebab: 'assets/food/shawarma.jpg',
  falafel: 'assets/food/falafel.jpg',
  steak: 'assets/food/steak.jpg',
  seafood: 'assets/food/seafood.jpg',
  salmon: 'assets/food/salmon.jpg',
  shrimp: 'assets/food/shrimp.jpg',
  fried_chicken: 'assets/food/fried_chicken.jpg',
  mac_and_cheese: 'assets/food/mac_and_cheese.jpg',
  grilled_cheese: 'assets/food/grilled_cheese.jpg',
  caesar_salad: 'assets/food/caesar_salad.jpg',
  poke_bowl: 'assets/food/poke_bowl.jpg',
  bibimbap: 'assets/food/bibimbap.jpg',
  korean_bbq: 'assets/food/korean_bbq.jpg',
  paella: 'assets/food/paella.jpg',
  gelato: 'assets/food/gelato.jpg',
  cheesecake: 'assets/food/cheesecake.jpg',
  churros: 'assets/food/churros.jpg',
};

const BEAR_SWIPE_FOOD_BANK = {
  breakfast: [['pancakes', 'breakfast'], ['waffles', 'brunch'], ['omelette', 'breakfast']],
  burgers: [['burger', 'fries'], ['cheeseburger', 'food'], ['smashburger', 'burger']],
  pizza: [['pizza', 'slice'], ['margherita', 'pizza'], ['pepperoni', 'pizza']],
  sushi: [['sushi', 'nigiri'], ['sashimi', 'sushi'], ['sushi', 'rolls']],
  ramen: [['ramen', 'noodles'], ['tonkotsu', 'ramen'], ['miso', 'ramen']],
  mexican: [['tacos', 'mexican'], ['burrito', 'mexican'], ['quesadilla', 'mexican']],
  italian: [['pasta', 'italian'], ['lasagna', 'italian'], ['gnocchi', 'italian']],
  korean: [['bibimbap', 'korean'], ['korean', 'bbq'], ['tteokbokki', 'korean']],
  chinese: [['dumplings', 'chinese'], ['fried-rice', 'chinese'], ['chow-mein', 'chinese']],
  indian: [['butter-chicken', 'indian'], ['biryani', 'indian'], ['tandoori', 'indian']],
  thai: [['pad-thai', 'thai'], ['thai-curry', 'thai'], ['tom-yum', 'thai']],
  bbq: [['bbq', 'ribs'], ['brisket', 'bbq'], ['smoked-meat', 'bbq']],
  seafood: [['seafood', 'platter'], ['salmon', 'dish'], ['shrimp', 'seafood']],
  steakhouse: [['steak', 'dinner'], ['ribeye', 'steak'], ['filet', 'steak']],
  desserts: [['dessert', 'cake'], ['gelato', 'dessert'], ['churros', 'dessert']],
  sandwich: [['sandwich', 'deli'], ['grilled-cheese', 'sandwich'], ['panini', 'sandwich']],
  american: [['diner', 'food'], ['comfort-food', 'dinner'], ['fried-chicken', 'meal']],
  default: [['food', 'dish'], ['restaurant', 'food'], ['plated', 'food']]
};

function getCuisineBankPairs (key = 'default') {
  return BEAR_SWIPE_FOOD_BANK[key] || BEAR_SWIPE_FOOD_BANK.default;
}

function getLocalDishCandidates (raw = '', key = 'default') {
  const picks = [];
  const add = k => {
    const url = BEAR_SWIPE_LOCAL_FOOD_IMAGES[k];
    if (url && !picks.includes(url)) picks.push(url);
  };

  const text = String(raw || '').toLowerCase();

  if (/(penne|vodka|lasagna|gnocchi|spaghetti|carbonara|alfredo|ravioli|pasta)/.test(text)) add('italian_pasta');
  if (/(pancake|waffle|french toast|eggs benedict|hash brown|omelette|breakfast|brunch)/.test(text)) ['pancakes', 'waffles', 'french_toast', 'eggs_benedict', 'omelette'].forEach(add);
  if (/(burger|cheeseburger|fries|smash burger)/.test(text)) ['burger', 'fries'].forEach(add);
  if (/(pizza|margherita|deep dish|pepperoni)/.test(text)) add('pizza');
  if (/(sushi|nigiri|sashimi|chirashi|roll)/.test(text)) add('sushi');
  if (/(ramen|udon|tsukemen|tonkotsu|shoyu|miso ramen)/.test(text)) ['ramen', 'udon'].forEach(add);
  if (/(taco|burrito|quesadilla|enchilada|birria|al pastor|pozole)/.test(text)) ['tacos', 'burrito', 'quesadilla', 'enchiladas'].forEach(add);
  if (/(korean|bibimbap|kimchi|tteokbokki|japchae|korean bbq)/.test(text)) ['bibimbap', 'korean_bbq'].forEach(add);
  if (/(dumpling|fried rice|chow mein|mapo|peking|dim sum|bao|kung pao)/.test(text)) ['dumplings', 'fried_rice', 'chow_mein'].forEach(add);
  if (/(biryani|butter chicken|tandoori|paneer|masala|naan|dal|dosa|indian)/.test(text)) ['biryani', 'butter_chicken', 'tikka_masala', 'dosa', 'indian_curry'].forEach(add);
  if (/(pad thai|thai curry|tom yum|pad see ew|thai basil)/.test(text)) ['pad_thai', 'thai_curry'].forEach(add);
  if (/(shawarma|kebab|falafel|hummus)/.test(text)) ['kebab', 'shawarma', 'falafel'].forEach(add);
  if (/(seafood|salmon|shrimp|fish|lobster|octopus|paella)/.test(text)) ['seafood', 'salmon', 'shrimp', 'paella'].forEach(add);
  if (/(steak|ribeye|filet|sirloin|prime rib|steakhouse)/.test(text)) add('steak');
  if (/(cake|gelato|dessert|donut|donuts|churro|cheesecake|tiramisu|pastry)/.test(text)) ['gelato', 'cheesecake', 'churros'].forEach(add);
  if (/(sandwich|blt|grilled cheese|toastie|panini|banh mi)/.test(text)) ['banh_mi', 'grilled_cheese'].forEach(add);
  if (/(american|fried chicken|mac|meatloaf|comfort food|diner)/.test(text)) ['fried_chicken', 'mac_and_cheese', 'burger'].forEach(add);
  if (/(irish|pub|gastropub|fish and chips|shepherd|shepherds pie|bangers and mash)/.test(text)) ['salmon', 'steak', 'fried_chicken'].forEach(add);
  if (/(salad|caesar|cobb|greek)/.test(text)) add('caesar_salad');
  if (/(poke)/.test(text)) add('poke_bowl');
  if (/(pho)/.test(text)) add('pho');

  const byCuisine = {
    breakfast: ['pancakes', 'waffles', 'french_toast', 'eggs_benedict', 'omelette'],
    burgers: ['burger', 'fries'],
    pizza: ['pizza'],
    sushi: ['sushi'],
    ramen: ['ramen', 'udon'],
    mexican: ['tacos', 'burrito', 'quesadilla', 'enchiladas'],
    italian: ['italian_pasta', 'pasta', 'lasagna', 'gnocchi'],
    korean: ['bibimbap', 'korean_bbq'],
    chinese: ['dumplings', 'fried_rice', 'chow_mein'],
    indian: ['biryani', 'butter_chicken', 'tikka_masala', 'dosa', 'indian_curry'],
    thai: ['pad_thai', 'thai_curry'],
    bbq: ['kebab', 'shawarma', 'steak'],
    seafood: ['seafood', 'salmon', 'shrimp', 'paella'],
    steakhouse: ['steak'],
    desserts: ['gelato', 'cheesecake', 'churros'],
    sandwich: ['banh_mi', 'grilled_cheese'],
    american: ['fried_chicken', 'mac_and_cheese', 'burger'],
    default: ['burger', 'steak', 'fried_chicken', 'salmon'],
  };

  (byCuisine[key] || byCuisine.default).forEach(add);
  return picks;
}

function getMoodFoodImageCandidates (term = 'food', seed = '') {
  const raw = String(term || '').trim().toLowerCase();
  const normalized = normalizeMoodTermKey(raw);
  const key = (() => {
    if (/(pancake|waffle|french toast|eggs benedict|hash brown|omelette|breakfast|brunch)/.test(raw)) return 'breakfast';
    if (/(burger|cheeseburger|fries|smash burger)/.test(raw)) return 'burgers';
    if (/(pizza|margherita|deep dish|pepperoni)/.test(raw)) return 'pizza';
    if (/(sushi|nigiri|sashimi|chirashi|roll)/.test(raw)) return 'sushi';
    if (/(ramen|udon|tsukemen|tonkotsu|shoyu|miso ramen)/.test(raw)) return 'ramen';
    if (/(taco|burrito|quesadilla|enchilada|birria|al pastor|pozole)/.test(raw)) return 'mexican';
    if (/(pasta|lasagna|gnocchi|risotto|carbonara|alfredo|spaghetti|ravioli|penne)/.test(raw)) return 'italian';
    if (/(korean|bibimbap|kimchi|tteokbokki|japchae|korean bbq)/.test(raw)) return 'korean';
    if (/(dumpling|fried rice|chow mein|mapo|peking|dim sum|bao|kung pao)/.test(raw)) return 'chinese';
    if (/(biryani|butter chicken|tandoori|paneer|masala|naan|dal|dosa|indian)/.test(raw)) return 'indian';
    if (/(pad thai|thai curry|tom yum|pad see ew|thai basil)/.test(raw)) return 'thai';
    if (/(bbq|brisket|ribs|smoked|pulled pork|burnt ends)/.test(raw)) return 'bbq';
    if (/(seafood|salmon|shrimp|fish and chips|lobster|octopus|paella)/.test(raw)) return 'seafood';
    if (/(steak|ribeye|filet|sirloin|prime rib|steakhouse)/.test(raw)) return 'steakhouse';
    if (/(cake|gelato|dessert|donut|donuts|churro|cheesecake|tiramisu|pastry)/.test(raw)) return 'desserts';
    if (/(sandwich|blt|grilled cheese|toastie|panini)/.test(raw)) return 'sandwich';
    if (/(american|fried chicken|mac|meatloaf|comfort food|diner)/.test(raw)) return 'american';
    if (/(irish|pub|gastropub|fish and chips|shepherd|shepherds pie|bangers and mash)/.test(raw)) return 'irish';
    return normalized;
  })();
  const variants = {
    ramen: ['ramen bowl', 'tonkotsu ramen', 'miso ramen', 'shoyu ramen'],
    pizza: ['margherita pizza', 'wood fired pizza', 'pepperoni pizza', 'detroit pizza'],
    sushi: ['sushi platter', 'nigiri sushi', 'sashimi set', 'sushi rolls'],
    burgers: ['burger and fries', 'smash burger', 'classic cheeseburger', 'double burger'],
    mexican: ['street tacos', 'burrito bowl', 'quesadilla', 'enchiladas'],
    italian: ['fresh pasta', 'lasagna', 'gnocchi', 'italian dinner'],
    bbq: ['barbecue brisket', 'bbq ribs', 'smoked meats', 'pulled pork'],
    desserts: ['dessert plate', 'gelato', 'cake slice', 'pastry'],
    seafood: ['grilled salmon', 'seafood platter', 'shrimp dish', 'fish tacos'],
    steakhouse: ['ribeye steak', 'steak dinner', 'filet mignon', 'grilled steak'],
    korean: ['bibimbap', 'korean bbq', 'kimchi fried rice', 'tteokbokki'],
    chinese: ['dumplings', 'chinese noodles', 'wok stir fry', 'fried rice'],
    indian: ['butter chicken', 'biryani', 'indian curry', 'tandoori'],
    thai: ['pad thai', 'thai curry', 'thai noodles', 'tom yum soup'],
    breakfast: ['pancakes breakfast', 'eggs and toast', 'waffles', 'breakfast platter'],
    sandwich: ['club sandwich', 'deli sandwich', 'grilled cheese', 'chicken sandwich'],
    american: ['american diner food', 'mac and cheese', 'fried chicken dinner', 'comfort food'],
    irish: ['irish pub food', 'fish and chips', 'shepherds pie', 'steak and potatoes'],
    default: ['beautiful food', 'restaurant dish', 'chef plated food', 'dinner plate']
  };

  const cuisineFallbackByKey = {
    breakfast: ['pancakes', 'waffles', 'french_toast', 'eggs_benedict', 'omelette'],
    burgers: ['burger', 'fries'],
    pizza: ['pizza'],
    sushi: ['sushi'],
    ramen: ['ramen', 'udon'],
    mexican: ['tacos', 'burrito', 'quesadilla', 'enchiladas'],
    italian: ['italian_pasta', 'pasta', 'lasagna', 'gnocchi'],
    korean: ['bibimbap', 'korean_bbq'],
    chinese: ['dumplings', 'fried_rice', 'chow_mein'],
    indian: ['biryani', 'butter_chicken', 'tikka_masala', 'dosa', 'indian_curry'],
    thai: ['pad_thai', 'thai_curry'],
    bbq: ['kebab', 'shawarma', 'steak'],
    seafood: ['seafood', 'salmon', 'shrimp', 'paella'],
    steakhouse: ['steak'],
    desserts: ['gelato', 'cheesecake', 'churros'],
    sandwich: ['banh_mi', 'grilled_cheese'],
    american: ['fried_chicken', 'mac_and_cheese', 'burger'],
    irish: ['salmon', 'steak', 'fried_chicken'],
    default: ['burger', 'steak', 'fried_chicken', 'salmon'],
  };

  const picks = variants[key] || variants.default;
  const hash = Math.abs(miniHash(`${key}|${seed || Date.now()}`));
  const phrase = picks[hash % picks.length];
  const local = getLocalDishCandidates(raw || phrase, key);
  const cuisineFallback = (cuisineFallbackByKey[key] || cuisineFallbackByKey.default)
    .map(k => BEAR_SWIPE_LOCAL_FOOD_IMAGES[k])
    .filter(Boolean);
  const base = [...local, ...cuisineFallback].filter(Boolean);
  const unique = [...new Set(base)];
  if (unique.length) return unique;
  return [...BEAR_SWIPE_LOCAL_FALLBACKS];
}

function pickBearSwipePhotoUrl (item, idx = 0) {
  const isLocalFoodAsset = (u = '') => /assets\/food\/[a-z0-9_\-]+\.(?:jpg|jpeg|png|webp)$/i.test(String(u || ''));
  const primary = safeUrl(item?.photoUrl || '');
  if (primary) {
    if (item?.source !== 'mood') return primary;
    if (isLocalFoodAsset(primary)) return primary;
  }

  const localCandidates = [
    ...(Array.isArray(item?.photoFallbacks) ? item.photoFallbacks : []),
    ...getMoodFoodImageCandidates(item?.cuisine || item?.name || 'food', `${item?.key || 'swipe'}-${idx}`),
    ...BEAR_SWIPE_LOCAL_FALLBACKS,
  ];

  for (const c of localCandidates) {
    const safe = safeUrl(c || '');
    if (!safe) continue;
    if (item?.source === 'mood' && !isLocalFoodAsset(safe)) continue;
    return safe;
  }

  return safeUrl('assets/food/pizza.jpg');
}

function extractLocalFoodKeyFromUrl (url = '') {
  const str = String(url || '');
  const match = str.match(/assets\/food\/([a-z0-9_\-]+)\.(jpg|jpeg|png|webp)/i);
  return match ? String(match[1]).toLowerCase() : '';
}

function formatLocalFoodKeyLabel (key = '') {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return '';
  const aliases = {
    italian_pasta: 'Penne Vodka',
    bbq_ribs: 'BBQ Ribs',
    korean_bbq: 'Korean BBQ',
    mac_and_cheese: 'Mac and Cheese',
    fried_rice: 'Fried Rice',
    french_toast: 'French Toast',
    eggs_benedict: 'Eggs Benedict',
    pad_thai: 'Pad Thai',
    thai_curry: 'Thai Curry',
    tikka_masala: 'Tikka Masala',
    poke_bowl: 'Poke Bowl',
    banh_mi: 'Banh Mi',
    grilled_cheese: 'Grilled Cheese',
    caesar_salad: 'Caesar Salad',
  };
  return aliases[k] || formatCuisineLabel(k.replace(/_/g, ' '));
}

function getMoodFoodImage (term = 'food', seed = '') {
  return getMoodFoodImageCandidates(term, seed)[0] || 'feedbear.png';
}

function buildMoodSwipeDeck (elements = [], savedRows = []) {
  void elements;
  void savedRows;

  const defaults = [
    'burger', 'fries', 'club sandwich', 'breakfast platter', 'pancakes', 'waffles', 'omelette',
    'pizza', 'pasta', 'lasagna', 'gnocchi', 'risotto', 'sushi', 'ramen', 'udon',
    'dumplings', 'fried rice', 'chow mein', 'hot and sour soup', 'biryani', 'butter chicken',
    'naan', 'tikka masala', 'dosa', 'pad thai', 'thai curry', 'pho', 'banh mi',
    'tacos', 'burrito', 'quesadilla', 'enchiladas', 'shawarma', 'kebab', 'falafel',
    'bbq ribs', 'brisket', 'steak', 'seafood platter', 'salmon', 'shrimp scampi',
    'fried chicken', 'mac and cheese', 'grilled cheese', 'caesar salad', 'poke bowl',
    'bibimbap', 'korean bbq', 'paella', 'gelato', 'cheesecake', 'churros'
  ];

  const largeCuisinePool = [
    'american burger', 'double cheeseburger', 'loaded fries', 'club sandwich', 'blt sandwich', 'turkey sandwich',
    'breakfast burrito', 'french toast', 'eggs benedict', 'hash browns', 'chicken and waffles', 'avocado toast',
    'new york pizza', 'deep dish pizza', 'wood fired pizza', 'margherita pizza',
    'spaghetti bolognese', 'fettuccine alfredo', 'penne vodka', 'ravioli', 'carbonara',
    'sushi rolls', 'nigiri', 'sashimi', 'chirashi bowl', 'tempura',
    'ramen tonkotsu', 'miso ramen', 'shoyu ramen', 'spicy ramen', 'tsukemen',
    'dim sum', 'bao buns', 'kung pao chicken', 'mapo tofu', 'peking duck',
    'biryani rice', 'palak paneer', 'chana masala', 'dal makhani', 'tandoori chicken',
    'pad see ew', 'green curry', 'red curry', 'thai basil chicken', 'mango sticky rice',
    'pho bo', 'bun cha', 'spring rolls', 'banh xeo', 'com tam',
    'street tacos', 'carne asada tacos', 'al pastor', 'birria tacos', 'pozole',
    'shawarma wrap', 'lamb kebab', 'chicken kebab', 'falafel bowl', 'hummus plate',
    'bbq brisket', 'pulled pork', 'smoked ribs', 'burnt ends', 'cornbread',
    'ribeye steak', 'filet mignon', 'sirloin steak', 'steak frites', 'prime rib',
    'lobster roll', 'fish and chips', 'clam chowder', 'seafood paella', 'grilled octopus',
    'fried chicken sandwich', 'nashville hot chicken', 'buffalo wings', 'chicken tenders',
    'mac n cheese', 'meatloaf', 'chili bowl', 'pot roast',
    'cobb salad', 'greek salad', 'caesar salad', 'mediterranean bowl',
    'poke bowl', 'acai bowl', 'grain bowl',
    'bibimbap bowl', 'korean fried chicken', 'tteokbokki', 'japchae',
    'paella valenciana', 'gazpacho', 'patatas bravas',
    'gelato scoop', 'cheesecake slice', 'chocolate cake', 'tiramisu', 'donuts', 'churros'
  ];

  const profile = getSwipePreferenceProfile();
  const preferred = Object.entries(profile?.byCuisine || {})
    .filter(([, score]) => Number(score) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([c]) => String(c || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 16);

  const terms = [...new Set([...preferred, ...defaults, ...largeCuisinePool])]
    .map(t => String(t || '').trim().toLowerCase())
    .filter(Boolean);

  const roundSeed = Date.now();
  const prefs = loadSwipePrefs();
  const recentYes = (prefs.history || [])
    .filter(h => h && h.reaction === 'yes')
    .slice(-90);
  const recentYesTerms = new Set(recentYes
    .map(h => normalizeMoodTermKey(h.term || h.cuisine || ''))
    .filter(Boolean));
  const recentYesDishKeys = new Set(recentYes
    .map(h => String(h.dishKey || '').trim().toLowerCase())
    .filter(Boolean));

  const shuffled = terms
    .filter(term => !recentYesTerms.has(normalizeMoodTermKey(term)))
    .map(term => ({ term, sort: miniHash(`${term}|${roundSeed}|mood`) }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 170);

  const seenCards = new Set();
  const deck = [];
  shuffled.forEach((item, idx) => {
    const seed = `${item.term}-${roundSeed}-${idx}`;
    const candidates = getMoodFoodImageCandidates(item.term, seed);
    const chosen = candidates[0] || 'assets/food/pizza.jpg';
    const localKey = extractLocalFoodKeyFromUrl(chosen);
    const matchedLabel = formatLocalFoodKeyLabel(localKey) || formatCuisineLabel(item.term);
    const normalizedTerm = normalizeMoodTermKey(item.term);
    const dedupeKey = `${String(localKey || '').toLowerCase()}|${String(matchedLabel || '').toLowerCase()}`;

    if (localKey && recentYesDishKeys.has(String(localKey).toLowerCase())) return;
    if (seenCards.has(dedupeKey) || seenCards.has(`term:${normalizedTerm}`)) return;

    seenCards.add(dedupeKey);
    seenCards.add(`term:${normalizedTerm}`);

    deck.push({
      key: `mood-${item.term}-${idx}`,
      source: 'mood',
      name: `${matchedLabel} mood`,
      cuisine: item.term,
      cuisineLabel: matchedLabel,
      amenity: 'food',
      photoUrl: chosen,
      photoFallbacks: candidates.slice(1),
      photoSource: 'local',
      isSaved: false,
      restaurantId: null,
      distMeters: Infinity,
      priceLevel: estimatePriceLevel({ cuisine: item.term, amenity: 'restaurant', savedRestaurant: null }),
    });
  });

  return deck.slice(0, 120);
}

function openDirectionsForSwipeItem (item) {
  if (!item) return;

  if (item.source === 'mood') {
    showToast('Mood swipe', 'This deck is for craving vibes. Pick For Me uses your swipes to find nearby spots.', 'info');
    return;
  }

  if (item.isSaved && item.restaurantId) {
    const r = state.restaurants.find(x => x.id === item.restaurantId);
    if (r) {
      openDirections(r);
      return;
    }
  }

  if (Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
    const dest = `${item.lat},${item.lon}`;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`, '_blank', 'noopener');
    return;
  }

  const q = item.address || item.name;
  if (q) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`, '_blank', 'noopener');
    return;
  }

  showToast('Directions unavailable', 'No location details are available for this spot yet.', 'info');
}

function openSwipeChoiceDetails (item) {
  if (!item) return;
  if (item.source === 'mood') {
    showTonightsPick();
    showToast('Mood locked in', `${item.cuisineLabel || 'Food'} vibe noted.`, 'success');
    return;
  }
  if (item.isSaved && item.restaurantId) {
    openDetailModal(item.restaurantId);
    return;
  }
  openAddModalPreFilled(item.name, item.cuisine);
}

function hideBearSwipeHome () {
  const mod = document.getElementById('bear-swipe-home');
  if (mod) mod.classList.add('hidden');
}

const SWIPE_DRAG_THRESHOLD_PX = 68;
const SWIPE_DRAG_ROTATION_FACTOR = 0.045;
let _swipeGestureIgnoreClickUntil = 0;
let _swipeDragState = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  dx: 0,
  dy: 0,
  moved: false,
};

function resetBearSwipeDragVisual (cardEl) {
  if (!cardEl) return;
  cardEl.style.transform = '';
  cardEl.style.removeProperty('--swipe-dx');
  cardEl.dataset.dragDir = '';
  cardEl.classList.remove('is-dragging', 'swipe-throw-left', 'swipe-throw-right', 'swipe-snap-back');
}

function animateBearSwipeThrow (cardEl, reaction) {
  if (!cardEl) return;
  const throwClass = reaction === 'yes' ? 'swipe-throw-right' : 'swipe-throw-left';
  const clawClass = reaction === 'yes' ? 'claw-right' : 'claw-left';
  cardEl.classList.remove('swipe-throw-left', 'swipe-throw-right', 'claw-left', 'claw-right', 'swipe-snap-back');
  const mediaEl = cardEl.querySelector('.bear-swipe-photo-wrap');
  mediaEl?.classList.remove('claw-left', 'claw-right');
  // Force reflow so repeated fast swipes always replay claw/tracer animations.
  void cardEl.offsetWidth;
  if (mediaEl) void mediaEl.offsetWidth;

  cardEl.classList.remove('swipe-snap-back');
  cardEl.classList.add(throwClass);
  cardEl.classList.add(clawClass);
  mediaEl?.classList.add(clawClass);
  playBearSwipeScratch(mediaEl, reaction);
  _swipeGestureIgnoreClickUntil = Date.now() + 420;

  window.setTimeout(() => {
    cardEl.classList.remove(throwClass, clawClass);
    mediaEl?.classList.remove('claw-left', 'claw-right');
    resetBearSwipeDragVisual(cardEl);
    nextBearSwipeCard(reaction);
  }, 320);
}

function playBearSwipeScratch (mediaEl, reaction) {
  if (!mediaEl) return;
  mediaEl.querySelector('.bear-swipe-scratch')?.remove();

  const scratch = document.createElement('div');
  scratch.className = `bear-swipe-scratch ${reaction === 'yes' ? 'right' : 'left'}`;
  mediaEl.appendChild(scratch);
  window.setTimeout(() => scratch.remove(), 520);
}

function triggerBearSwipeParty (cardEl) {
  if (!cardEl) return;
  const existing = cardEl.querySelector('.bear-swipe-party');
  if (existing) {
    existing.classList.remove('pop');
    void existing.offsetWidth;
    existing.classList.add('pop');
    const existingVideo = existing.querySelector('.bear-swipe-party-video');
    if (existingVideo) {
      try {
        existingVideo.currentTime = 0;
        const playTry = existingVideo.play();
        if (playTry && typeof playTry.catch === 'function') playTry.catch(() => {});
      } catch (_) {}
    }
    setBearSwipeJoke('Bear dance break. Burger secured.');
    return;
  }

  const partyEl = document.createElement('div');
  partyEl.className = 'bear-swipe-party pop';
  partyEl.innerHTML = `<video class="bear-swipe-party-video" autoplay loop controls playsinline webkit-playsinline muted aria-label="Dancing bear celebration" preload="metadata"><source src="assets/videos/dancingbear.webm" type="video/webm" /><source src="assets/videos/dancingbear.mp4" type="video/mp4" /></video><div class="bear-swipe-party-actions"><button class="bear-swipe-party-close" type="button">Close</button></div><span class="bear-swipe-party-text">SNACK DANCE</span>`;
  cardEl.appendChild(partyEl);
  partyEl.addEventListener('click', e => e.stopPropagation());
  partyEl.querySelector('.bear-swipe-party-close')?.addEventListener('click', () => partyEl.remove());
  const partyVideo = partyEl.querySelector('.bear-swipe-party-video');
  if (partyVideo) {
    const swapToGif = () => {
      const gifUrl = safeUrl('assets/videos/dancingbear.gif');
      if (!gifUrl || !partyVideo.isConnected) return;
      const gif = document.createElement('img');
      gif.className = 'bear-swipe-party-video';
      gif.src = gifUrl;
      gif.alt = 'Dancing bear celebration';
      partyVideo.replaceWith(gif);
    };

    partyVideo.defaultMuted = true;
    partyVideo.muted = true;
    partyVideo.setAttribute('muted', '');
    partyVideo.addEventListener('error', () => {
      swapToGif();
      showToast('Bear dance fallback', 'Using GIF celebration for this device.', 'info');
    }, { once: true });

    try {
      const playTry = partyVideo.play();
      if (playTry && typeof playTry.catch === 'function') {
        playTry.catch(() => {
          swapToGif();
        });
      }
    } catch (_) {}
  }
  setBearSwipeJoke('Bear dance break. Burger secured.');
}

function bindBearSwipePhotoFallbacks (photoEl, item = {}) {
  if (!photoEl) return;
  const normalizeFallbackUrl = u => {
    const raw = String(u || '').trim();
    if (!raw) return '';
    if (/^(assets\/|\.\/assets\/|feedbear\.png$|file:\/\/)/i.test(raw)) return raw;
    return safeUrl(raw);
  };

  const queue = [
    ...(Array.isArray(item.photoFallbacks) ? item.photoFallbacks : []),
    ...BEAR_SWIPE_LOCAL_FALLBACKS,
  ].map(normalizeFallbackUrl).filter(Boolean);

  let idx = 0;
  let settled = false;
  let timeoutId = null;

  const armTimeout = () => {
    if (timeoutId) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      if (!photoEl.complete || photoEl.naturalWidth <= 0) {
        if (useNext()) {
          armTimeout();
          return;
        }
        collapseToEmpty();
      }
    }, 1400);
  };

  const useNext = () => {
    while (idx < queue.length) {
      const next = queue[idx++];
      if (next && next !== photoEl.src) {
        photoEl.src = next;
        return true;
      }
    }
    return false;
  };

  const collapseToEmpty = () => {
    const hard = safeUrl('assets/food/pizza.jpg');
    if (hard && photoEl.isConnected && photoEl.src !== hard) {
      photoEl.src = hard;
      settled = true;
      return;
    }

    const wrap = photoEl.closest('.bear-swipe-photo-wrap');
    if (wrap) {
      photoEl.remove();
      if (!wrap.querySelector('.bear-swipe-photo-empty')) {
        const empty = document.createElement('div');
        empty.className = 'bear-swipe-photo-empty';
        empty.innerHTML = '<span>Loading tasty photo...</span>';
        wrap.prepend(empty);
      }
    }
  };

  armTimeout();

  photoEl.addEventListener('load', () => {
    if (photoEl.naturalWidth > 0) {
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  });

  photoEl.addEventListener('error', () => {
    if (useNext()) {
      armTimeout();
      return;
    }
    collapseToEmpty();
  });
}

function attachBearSwipeDragHandlers (cardEl) {
  if (!cardEl || cardEl.dataset.dragBound === '1') return;

  const isBlockedTarget = target => target?.closest?.('button, a, input, textarea, select, [data-swipe-details], [data-swipe-directions]');

  const startDrag = (x, y, id) => {
    _swipeDragState.active = true;
    _swipeDragState.pointerId = id;
    _swipeDragState.startX = x;
    _swipeDragState.startY = y;
    _swipeDragState.dx = 0;
    _swipeDragState.dy = 0;
    _swipeDragState.moved = false;
    cardEl.classList.add('is-dragging');
    cardEl.style.transition = 'none';
  };

  const moveDrag = (x, y, id) => {
    if (!_swipeDragState.active || _swipeDragState.pointerId !== id) return;
    const dx = x - _swipeDragState.startX;
    const dy = y - _swipeDragState.startY;

    _swipeDragState.dx = dx;
    _swipeDragState.dy = dy;
    _swipeDragState.moved = Math.abs(dx) > 6 || Math.abs(dy) > 6;

    if (Math.abs(dx) < Math.abs(dy) * 0.9) return;

    const rotation = Math.max(-10, Math.min(10, dx * SWIPE_DRAG_ROTATION_FACTOR));
    cardEl.style.transform = `translateX(${dx}px) rotate(${rotation}deg)`;
    cardEl.style.setProperty('--swipe-dx', `${dx}px`);
    cardEl.dataset.dragDir = dx > 14 ? 'right' : dx < -14 ? 'left' : '';
  };

  const endDrag = id => {
    if (!_swipeDragState.active || _swipeDragState.pointerId !== id) return;

    const dx = _swipeDragState.dx;
    const dy = _swipeDragState.dy;
    const wasDrag = _swipeDragState.moved;
    const horizontalIntent = Math.abs(dx) > Math.abs(dy) * 0.9;

    cardEl.classList.remove('is-dragging');
    cardEl.style.transition = '';

    _swipeDragState.active = false;
    _swipeDragState.pointerId = null;

    if (wasDrag && horizontalIntent && Math.abs(dx) >= SWIPE_DRAG_THRESHOLD_PX) {
      animateBearSwipeThrow(cardEl, dx > 0 ? 'yes' : 'no');
      return;
    }

    if (wasDrag) _swipeGestureIgnoreClickUntil = Date.now() + 180;

    cardEl.classList.add('swipe-snap-back');
    window.setTimeout(() => {
      cardEl.classList.remove('swipe-snap-back');
      resetBearSwipeDragVisual(cardEl);
    }, 180);
  };

  cardEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isBlockedTarget(e.target)) return;
    startDrag(e.clientX, e.clientY, `ptr-${e.pointerId}`);
    try { cardEl.setPointerCapture?.(e.pointerId); } catch (_) {}
  });
  cardEl.addEventListener('pointermove', e => moveDrag(e.clientX, e.clientY, `ptr-${e.pointerId}`));
  cardEl.addEventListener('pointerup', e => endDrag(`ptr-${e.pointerId}`));
  cardEl.addEventListener('pointercancel', e => endDrag(`ptr-${e.pointerId}`));

  cardEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (isBlockedTarget(e.target)) return;
    startDrag(e.clientX, e.clientY, 'mouse');
  });
  window.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY, 'mouse'));
  window.addEventListener('mouseup', () => endDrag('mouse'));

  cardEl.addEventListener('touchstart', e => {
    if (isBlockedTarget(e.target)) return;
    const t = e.touches?.[0];
    if (!t) return;
    startDrag(t.clientX, t.clientY, 'touch');
  }, { passive: true });
  cardEl.addEventListener('touchmove', e => {
    const t = e.touches?.[0];
    if (!t) return;
    moveDrag(t.clientX, t.clientY, 'touch');
  }, { passive: true });
  cardEl.addEventListener('touchend', () => endDrag('touch'));

  cardEl.dataset.dragBound = '1';
}

function renderBearSwipeCard () {
  const cardEl = document.getElementById('bear-swipe-card');
  const moduleEl = document.getElementById('bear-swipe-home');
  if (!cardEl || !moduleEl) return;

  const deck = state.swipeDeck || [];
  const idx = state.swipeIndex || 0;
  if (!deck.length || idx >= deck.length) {
    cardEl.innerHTML = `<div class="bear-swipe-empty">\n      <div class="bear-swipe-empty-title">Out of cards, cub boss.</div>\n      <div class="bear-swipe-empty-sub">Hit New Stack and we will keep the snack hunt going.</div>\n    </div>`;
    setBearSwipeJoke('That stack was un-bear-lievably fast. New stack?');
    return;
  }

  const item = deck[idx];
  const isMoodDeck = item.source === 'mood';
  const hiddenName = isMoodDeck ? 'Mystery craving vibe' : (item.source === 'saved' ? 'Saved mystery snack' : 'Nearby mystery snack');
  const reveal = !!state.swipeReveal;
  const progress = `${idx + 1}/${deck.length}`;
  const swipePhoto = pickBearSwipePhotoUrl(item, idx);
  const hasSwipePhoto = !!swipePhoto;
  const revealPrompt = 'Swipe left or right to train your cravings.';
  const detailPrompt = 'Swipe yes/no to train your cravings.';

  cardEl.innerHTML = `<div class="bear-swipe-photo-wrap">\n      ${hasSwipePhoto
      ? `<img class="bear-swipe-photo" src="${swipePhoto}" alt="${escHtml(item.cuisineLabel || 'Food photo')}" loading="lazy" />`
      : `<div class="bear-swipe-photo-empty"><span>Loading tasty photo...</span></div>`}\n      <div class="bear-swipe-topline">\n        <span class="bear-swipe-chip">${escHtml(item.cuisineLabel)}</span>\n        <span class="bear-swipe-chip alt">${escHtml(progress)}</span>\n      </div>\n    </div>\n    <div class="bear-swipe-content">\n      <div class="bear-swipe-name ${reveal ? 'revealed' : 'hidden'}">${escHtml(reveal ? item.name : hiddenName)}</div>\n      <div class="bear-swipe-meta">${reveal
        ? (isMoodDeck
          ? 'Mood-only swipe deck: tune your appetite first, then pick a place.'
          : (item.isSaved ? 'Saved in your den. Tap details for full info.' : 'Tap details for full info. Location stays hidden here.'))
        : revealPrompt}</div>\n      ${reveal && !isMoodDeck ? `<div class="bear-swipe-reveal-row">\n          <button class="btn-sm btn-secondary" data-swipe-details="1" type="button">Details</button>\n          <button class="btn-sm btn-orange" data-swipe-directions="1" type="button">Directions</button>\n        </div>` : `<div class="bear-swipe-secret">${escHtml(detailPrompt)}</div>`}\n    </div>`;

  cardEl.classList.toggle('is-revealed', reveal);

  cardEl.onclick = e => {
    if (Date.now() < _swipeGestureIgnoreClickUntil) return;
    if (e.target?.closest?.('button, a, input, textarea, select, [data-swipe-details], [data-swipe-directions]')) return;
    if (!state.swipeReveal) revealBearSwipeCard();
    triggerBearSwipeParty(cardEl);
  };

  const photoEl = cardEl.querySelector('.bear-swipe-photo');
  bindBearSwipePhotoFallbacks(photoEl, item);
  photoEl?.addEventListener('click', e => {
    e.stopPropagation();
    if (Date.now() < _swipeGestureIgnoreClickUntil) return;
    if (!state.swipeReveal) revealBearSwipeCard();
    triggerBearSwipeParty(cardEl);
  });

  cardEl.querySelector('[data-swipe-details]')?.addEventListener('click', e => {
    e.stopPropagation();
    openSwipeChoiceDetails(item);
  });

  cardEl.querySelector('[data-swipe-directions]')?.addEventListener('click', e => {
    e.stopPropagation();
    openDirectionsForSwipeItem(item);
  });

  attachBearSwipeDragHandlers(cardEl);
}

function nextBearSwipeCard (reaction = '') {
  const deck = state.swipeDeck || [];
  const idx = state.swipeIndex || 0;
  const item = deck[idx];

  if (item && (reaction === 'yes' || reaction === 'no')) {
    recordSwipePreference(item, reaction);
  }

  if (reaction === 'yes' && item) {
    state.swipeLikes = (state.swipeLikes || []).concat([{ key: item.key, ts: Date.now() }]).slice(-50);
  }
  if (reaction === 'yes' || reaction === 'no') {
    setBearSwipeJoke(pickRandom(BEAR_REACTION_COPY[reaction] || BEAR_SWIPE_JOKES));
  }

  if (reaction === 'no' && item?.cuisine) {
    const blocked = normalizeMoodTermKey(item.cuisine);
    state.swipeDeck = deck.filter((d, i) => {
      if (i <= idx) return true;
      return normalizeMoodTermKey(d.cuisine) !== blocked;
    });
  }

  state.swipeIndex = idx + 1;
  state.swipeReveal = false;
  renderBearSwipeCard();
}

function revealBearSwipeCard () {
  const deck = state.swipeDeck || [];
  if (!deck.length || state.swipeIndex >= deck.length) return;
  if (state.swipeReveal) return;
  state.swipeReveal = true;
  setBearSwipeJoke('Reveal unlocked. Bear in mind: calories are emotional math.');
  renderBearSwipeCard();
}

function renderBearSwipeHomeFromElements (elements = []) {
  const mod = document.getElementById('bear-swipe-home');
  if (!mod) return;
  const savedRows = (state.restaurants || []).slice(0, 24);
  const deck = buildMoodSwipeDeck(elements, savedRows);
  if (!deck.length) {
    hideBearSwipeHome();
    return;
  }
  mod.classList.remove('hidden');
  state.swipeDeck = deck;
  state.swipeIndex = 0;
  state.swipeReveal = false;
  renderBearSwipeCard();
  setBearSwipeJoke();
}

function renderBearSwipeHomeFromSaved (savedRows = []) {
  const mod = document.getElementById('bear-swipe-home');
  if (!mod) return;
  const deck = buildMoodSwipeDeck([], savedRows);
  if (!deck.length) {
    hideBearSwipeHome();
    return;
  }
  mod.classList.remove('hidden');
  state.swipeDeck = deck;
  state.swipeIndex = 0;
  state.swipeReveal = false;
  renderBearSwipeCard();
  setBearSwipeJoke('Mood deck loaded. Trust your paws.' );
}

function initBearSwipeHome () {
  const mod = document.getElementById('bear-swipe-home');
  const card = document.getElementById('bear-swipe-card');
  const noBtn = document.getElementById('bear-swipe-no-btn');
  const yesBtn = document.getElementById('bear-swipe-yes-btn');
  const refreshBtn = document.getElementById('bear-swipe-refresh-btn');
  if (!mod || !card || !noBtn || !yesBtn || !refreshBtn) return;
  if (mod.dataset.bound === '1') return;

  card.addEventListener('click', () => {
    if (Date.now() < _swipeGestureIgnoreClickUntil) return;
    if (!state.swipeReveal) {
      revealBearSwipeCard();
      return;
    }
    triggerBearSwipeParty(card);
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (Date.now() < _swipeGestureIgnoreClickUntil) return;
      if (!state.swipeReveal) revealBearSwipeCard();
      else triggerBearSwipeParty(card);
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      animateBearSwipeThrow(card, 'no');
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      animateBearSwipeThrow(card, 'yes');
    }
  });
  noBtn.addEventListener('click', () => {
    if (Date.now() < _swipeGestureIgnoreClickUntil) return;
    animateBearSwipeThrow(card, 'no');
  });
  yesBtn.addEventListener('click', () => {
    if (Date.now() < _swipeGestureIgnoreClickUntil) return;
    animateBearSwipeThrow(card, 'yes');
  });
  refreshBtn.addEventListener('click', () => {
    if (_homeDiscCache?.elements?.length) {
      renderBearSwipeHomeFromElements(_homeDiscCache.elements);
      return;
    }
    const localRows = (state.restaurants || [])
      .map(r => ({ ...r, _distMeters: distOf(r) }))
      .filter(r => Number.isFinite(r._distMeters) && r._distMeters <= getNearbyRadiusMeters())
      .sort((a, b) => a._distMeters - b._distMeters);
    renderBearSwipeHomeFromSaved(localRows);
  });

  mod.dataset.bound = '1';
}

function initHomeDiscoverySection () {
  const list = document.getElementById('nearby-home-list');
  if (!list) return;
  initBearSwipeHome();
  renderTodayStatusRow();
  renderTodayVibeRow();
  stageHomeModules();
  renderForYouHome();
  renderWeeklyRecapHome();
  renderMoodPicksHome();
  if (state.userLat && state.userLng) {
    loadHomeDiscovery();
  } else {
    const savedRows = (state.restaurants || [])
      .slice()
      .sort((a, b) => (Number(b.myRating || 0) - Number(a.myRating || 0)) || (Number(b.googleRating || 0) - Number(a.googleRating || 0)))
      .slice(0, 12);
    if (savedRows.length) {
      renderBearSwipeHomeFromSaved(savedRows);
    } else {
      hideBearSwipeHome();
    }
    // Show teaser CTA when location is not yet enabled
    list.innerHTML = `<div class="nearby-home-teaser" id="nearby-home-teaser">
      <div class="nearby-home-teaser-icon"></div>
      <div class="nearby-home-teaser-body">
        <div class="nearby-home-teaser-title">Sniff what is near your cave right now</div>
        <div class="nearby-home-teaser-sub">Real restaurants within ${getNearbyRadiusMiles()} mile${getNearbyRadiusMiles() === 1 ? '' : 's'} and exactly zero unbearable decisions.</div>
      </div>
      <button class="btn-sm btn-orange nearby-home-teaser-btn" id="nearby-teaser-enable-btn">Enable</button>
    </div>`;
    document.getElementById('nearby-teaser-enable-btn')?.addEventListener('click', enableLocation);
  }
}

async function loadHomeDiscovery () {
  if (!state.userLat || !state.userLng) return;
  const section = document.getElementById('home-discovery');
  const list    = document.getElementById('nearby-home-list');
  if (!section || !list) return;
  section.classList.remove('hidden');

  // Serve from cache if fresh
  if (_homeDiscCache && Date.now() - _homeDiscCacheTime < HOME_DISC_TTL) {
    renderTodayStatusRow();
    renderTodayVibeRow();
    renderHomeDiscovery(_homeDiscCache);
    renderBearSwipeHomeFromElements(_homeDiscCache.elements || []);
    renderForYouHome();
    renderWeeklyRecapHome();
    renderMoodPicksHome();
    loadAiRec(_homeDiscCache);
    return;
  }

  // If cache is stale, still render it immediately for instant UX while refreshing.
  if (_homeDiscCache?.elements?.length) {
    renderTodayStatusRow();
    renderTodayVibeRow();
    renderHomeDiscovery(_homeDiscCache);
    renderBearSwipeHomeFromElements(_homeDiscCache.elements || []);
    renderForYouHome();
    renderWeeklyRecapHome();
    renderMoodPicksHome();
    loadAiRec(_homeDiscCache);
  }

  list.innerHTML = `
    <div class="home-skeleton home-skeleton-title"></div>
    <div class="home-skeleton home-skeleton-row"></div>
    <div class="home-skeleton home-skeleton-row"></div>
  `;
  try {
    const { userLat: lat, userLng: lng } = state;
    const radiusMeters = Math.round(getNearbyRadiusMeters());
    const q = `[out:json][timeout:15];(node["amenity"~"restaurant|cafe|fast_food|bar"](around:${radiusMeters},${lat},${lng}););out body 30;`;
    const elementsRaw = await fetchOverpassElements(q, {
      timeoutMs: 4500,
      nominatimFallback: true,
      lat,
      lng,
      radiusMeters,
      limit: 30,
    });
    const raw = (elementsRaw || []).filter(el => el.tags?.name);
    const withDist = raw.map(el => {
      const elLat = el.lat ?? el.center?.lat;
      const elLon = el.lon ?? el.center?.lon;
      const d = (elLat != null && elLon != null) ? haversine(lat, lng, elLat, elLon) : Infinity;
      return { ...el, _dist: d };
    }).sort((a, b) => a._dist - b._dist).slice(0, 12);

    _homeDiscCache = { elements: withDist, lat, lng };
    _homeDiscCacheTime = Date.now();
    renderTodayStatusRow();
    renderTodayVibeRow();
    renderHomeDiscovery(_homeDiscCache);
    renderBearSwipeHomeFromElements(withDist);
    renderForYouHome();
    renderWeeklyRecapHome();
    renderMoodPicksHome();
    loadAiRec(_homeDiscCache);
  } catch (err) {
    renderNearbyHomeFallback(err);
  }
}

function renderNearbyHomeFallback (err = null) {
  const list = document.getElementById('nearby-home-list');
  if (!list) return;
  const radiusMeters = getNearbyRadiusMeters();
  const radiusMiles = getNearbyRadiusMiles();

  const localFallback = (state.restaurants || [])
    .map(r => ({ ...r, _distMeters: distOf(r) }))
    .filter(r => Number.isFinite(r._distMeters) && r._distMeters <= radiusMeters)
    .sort((a, b) => a._distMeters - b._distMeters)
    .slice(0, 5);

  if (localFallback.length) {
    renderBearSwipeHomeFromSaved(localFallback);
    const cards = localFallback.map((r, idx) => {
      const priceLevel = estimatePriceLevel({ cuisine: r.cuisine, amenity: 'restaurant', savedRestaurant: r });
      const popularity = nearbyPopularityLabel(r._distMeters, r);
      const photoPick = pickRealRestaurantPhoto({ savedRestaurant: r, cuisine: r.cuisine, amenity: 'restaurant', width: 960, height: 960 });
      return {
        key: `saved-${r.id || idx}`,
        name: r.name,
        cuisine: r.cuisine,
        amenity: 'restaurant',
        photoUrl: photoPick.url,
        distMeters: r._distMeters,
        lat: Number.isFinite(r.lat) ? Number(r.lat) : null,
        lon: Number.isFinite(r.lng) ? Number(r.lng) : null,
        address: r.address || '',
        website: r.website || '',
        priceLevel,
        popularity,
        isSaved: true,
        restaurantId: r.id,
        savedRestaurant: r,
      };
    });
    setNearbyCards(cards, {
      banner: `Live lookup is busy, so your bear assistant is foraging in saved places within ${radiusMiles} mile${radiusMiles === 1 ? '' : 's'}.`,
    });
    return;
  }

  hideBearSwipeHome();

  list.innerHTML = err?.name === 'AbortError'
    ? '<div class="nearby-home-loading">Nearby search took a quick hibernation break. Try again in a moment.</div>'
    : '<div class="nearby-home-loading">Nearby live results are temporarily unavailable, but your saved den is still open for business.</div>';
}

function renderHomeDiscovery ({ elements }) {
  const list = document.getElementById('nearby-home-list');
  if (!list || !elements.length) {
    hideBearSwipeHome();
    if (list) {
      const miles = getNearbyRadiusMiles();
      list.innerHTML = `<div class="nearby-home-loading">No nearby spots found within ${miles} mile${miles === 1 ? '' : 's'} yet. The bear keeps looking.</div>`;
    }
    return;
  }
  const savedNames = new Set(state.restaurants.map(r => normalizeName(r.name)));
  const cards = elements.map((el, idx) => {
    const tags    = el.tags || {};
    const name    = tags.name || 'Unknown';
    const isSaved = savedNames.has(normalizeName(name));
    const cuisine = (tags.cuisine || '').split(';')[0];
    const amenity = tags.amenity || 'restaurant';
    const savedRestaurant = isSaved
      ? state.restaurants.find(r => normalizeName(r.name) === normalizeName(name)) || null
      : null;
    const photoPick = pickRealRestaurantPhoto({ savedRestaurant, tags, cuisine, amenity, width: 960, height: 960 });
    const priceLevel = estimatePriceLevel({ cuisine, amenity, savedRestaurant });
    const popularity = nearbyPopularityLabel(el._dist, savedRestaurant);
    return {
      key: `live-${el.id || idx}`,
      name,
      cuisine,
      amenity,
      // Live nearby cards should stay food-forward; avoid generic place/building shots.
      photoUrl: isSaved ? photoPick.url : '',
      distMeters: el._dist,
      lat: Number.isFinite(el.lat ?? el.center?.lat) ? Number(el.lat ?? el.center?.lat) : null,
      lon: Number.isFinite(el.lon ?? el.center?.lon) ? Number(el.lon ?? el.center?.lon) : null,
      address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' '),
      website: tags.website || tags['contact:website'] || tags.url || '',
      priceLevel,
      popularity,
      isSaved,
      restaurantId: savedRestaurant?.id || '',
      savedRestaurant,
    };
  });
  setNearbyCards(cards);
}

async function loadAiRec (discData) {
  if (!window.AI || (typeof isPremium === 'function' && !isPremium())) return;
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
   PHASE 8 •  SMART DISCOVERY
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
  const hasLocation = await ensureLocationForDiscovery();
  const radius = parseInt(document.getElementById('discover-radius').value) || 1000;
  const resultsEl = document.getElementById('discover-results');

  if (!hasLocation) {
    const cached = getNearbyDiscoveryRows(16);
    if (!cached.length) {
      resultsEl.innerHTML = '<div class="discover-empty">Location is off and no nearby cache is available yet. Enable location and try again.</div>';
      return;
    }
    resultsEl.innerHTML = cached.map(row => {
      const safeName = String(row.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safeCuisine = String(row.cuisine || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safeAddress = String(row.address || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const safeWebsite = String(row.website || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<div class="discover-item">
        <div class="discover-item-emoji">${cuisineEmoji(row.cuisine) || ''}</div>
        <div class="discover-item-body">
          <div class="discover-item-name">${escHtml(row.name)}</div>
          <div class="discover-item-meta">${escHtml(row.cuisine || 'Restaurant')}${Number.isFinite(row._distMeters) ? ` • ${fmtDist(row._distMeters)}` : ''}</div>
        </div>
        <div class="discover-item-add">
          <button class="btn-sm btn-orange" onclick="openAddModalPreFilled('${safeName}','${safeCuisine}',{name:'${safeName}',address:'${safeAddress}',website:'${safeWebsite}',lat:${Number.isFinite(row.lat) ? Number(row.lat) : 'null'},lon:${Number.isFinite(row.lng) ? Number(row.lng) : 'null'}})">Add +</button>
        </div>
      </div>`;
    }).join('');
    return;
  }

  resultsEl.innerHTML = '<div class="discover-loading"> Searching nearby places...</div>';

  // Overpass API query: restaurants + cafes within radius
  const lat = state.userLat, lng = state.userLng;
  const overpassQuery = `[out:json][timeout:15];(node["amenity"~"restaurant|cafe|fast_food|bar"](around:${radius},${lat},${lng}););out body 30;`;

  try {
    const elementsRaw = await fetchOverpassElements(overpassQuery, {
      timeoutMs: 12000,
      nominatimFallback: true,
      lat,
      lng,
      radiusMeters: radius,
      limit: 30,
    });
    const elements = (elementsRaw || []).filter(el => el.tags?.name);

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
    const amenityEmoji = t => ({ restaurant:'', cafe:'☕', fast_food:'', bar:'' }[t]||'');

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
          ${address ? `<div class="discover-item-meta"> ${escHtml(address)}</div>` : ''}
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
   PHASE 8 •  CUSTOM CHALLENGES
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
  showToast(' Challenge created!', name, 'success');
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
    showToast(' Challenge joined!', ch.n, 'success');
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
        <button class="debrief-emoji-btn" data-val="amazing"> Amazing</button>
        <button class="debrief-emoji-btn" data-val="good"> Good</button>
        <button class="debrief-emoji-btn" data-val="okay"> Okay</button>
        <button class="debrief-emoji-btn" data-val="disappointing"> Disappointing</button>
      </div>
    </div>
    <div>
      <div class="debrief-q">Would you go back?</div>
      <div class="debrief-emoji-row" id="debrief-return">
        <button class="debrief-emoji-btn" data-val="definitely">✅ Definitely</button>
        <button class="debrief-emoji-btn" data-val="maybe"> Maybe</button>
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
  const vibeMap   = { amazing:' Amazing visit', good:' Good visit', okay:' Okay visit', disappointing:' Disappointing' };
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
   PHASE 9 •  DEEP STATS
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
  document.getElementById('s2-streak-sub').textContent = streak >= 4 ? ' On fire!' : streak >= 2 ? ' Nice rhythm' : 'Try something new this week!';

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
    ctx.fillStyle = isGem ? '#ffd166' : 'rgba(232,177,90,.75)';
    ctx.fill();
  });

  // Legend
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(pad.l+6, pad.t+8, 4, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '9px Poppins, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('Hidden gem', pad.l+14, pad.t+12);
  ctx.fillStyle = 'rgba(232,177,90,.75)'; ctx.beginPath(); ctx.arc(pad.l+76, pad.t+8, 4, 0, Math.PI*2); ctx.fill();
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
   PHASE 9 •  AI ASSISTANT (Gemini-powered Byte Cub)
   ------------------------------------------------------------ */

const _aiHistory = [];

function ensureAiUpgradeAccess (featureName = 'Byte Cub AI') {
  if (typeof isPremium === 'function' && !isPremium()) {
    if (typeof requiresPremium === 'function') {
      requiresPremium(featureName, () => {});
    } else if (typeof openUpgradeModal === 'function') {
      openUpgradeModal(featureName);
    }
    return false;
  }
  return true;
}

function openAiPanel () {
  if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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
  document.getElementById('ai-key-setup')?.classList.toggle('hidden', hasKey);
  document.getElementById('ai-key-active')?.classList.toggle('hidden', !hasKey);
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
  if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
  _appendAiMsg('user', userText);
  document.getElementById('ai-chat-input').value = '';

  if (!AI.hasKey()) {
    const ruleResp = typeof chatResponse === 'function' ? chatResponse(userText) : "I need a Gemini API key to give smart answers!";
    _appendAiMsg('assistant', ruleResp);
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
      _appendAiMsg('assistant', 'Byte Cub is included by default. If AI is unavailable right now, please try again in a moment.');
    } else {
      const ruleResp = typeof chatResponse === 'function' ? chatResponse(userText) : '';
      if (ruleResp) {
        _appendAiMsg('assistant', ruleResp + '\n\n(Cloud AI is temporarily unavailable, so I switched to built-in recommendations.)');
      } else {
        _appendAiMsg('assistant', '\u26A0\uFE0F ' + (err.message || 'Connection error. Please try again shortly.'));
      }
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
  if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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
  if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
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
   PHASE 9 •  MAP UPGRADES (cluster + route)
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
   PHASE 9 •  EXPORT v2
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
      ${r.address ? `<div style="font-size:.78rem;color:#888;margin-bottom:4px"> ${escHtml(r.address)}</div>` : ''}
      ${r.dateVisited ? `<div style="font-size:.78rem;color:#888;margin-bottom:4px"> Visited: ${r.dateVisited}</div>` : ''}
      ${r.notes ? `<div style="font-size:.8rem;color:#444;border-top:1px solid #eee;padding-top:6px;margin-top:6px">${escHtml(r.notes.slice(0,200))}</div>` : ''}
    </div>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>My Restaurant Passport</title>
  <style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 20px;color:#222}
  h1{font-size:1.8rem;border-bottom:2px solid #e63946;padding-bottom:8px;margin-bottom:24px}
  @media print{body{margin:0;padding:10px}}</style></head><body>
  <h1> My Restaurant Passport</h1>
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
  <h1> My Food List</h1>
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

function _isIos () {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function _isInStandaloneMode () {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function initInstallPrompt () {
  // If already installed, do nothing
  if (_isInStandaloneMode()) return;

  // If beforeinstallprompt already fired before this function ran, use it now
  if (_pwaPromptEvent && !_deferredInstallPrompt) {
    _deferredInstallPrompt = _pwaPromptEvent;
    if (!localStorage.getItem('ftb_install_dismissed')) {
      setTimeout(showInstallBanner, 2000);
    }
  }

  // iOS: show manual instructions after 5s on first visit
  if (_isIos()) {
    if (!localStorage.getItem('ftb_install_dismissed')) {
      setTimeout(() => {
        const banner = document.getElementById('install-banner');
        document.getElementById('install-android-content').style.display = 'none';
        document.getElementById('install-ios-content').style.display = 'flex';
        document.getElementById('install-accept-btn').style.display = 'none';
        banner.classList.remove('hidden');
      }, 5000);
    }
  }

  // Android/desktop: capture beforeinstallprompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _deferredInstallPrompt = e;
    if (!localStorage.getItem('ftb_install_dismissed')) {
      setTimeout(showInstallBanner, 6000);
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
   PHASE 9 •  PUSH NOTIFICATION NUDGES
   ------------------------------------------------------------ */

async function requestPushPermission () {
  if (!('Notification' in window)) {
    showToast('Not supported', 'Push notifications not available in this browser.', 'error');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast(' Notifications on!', 'You\'ll get nudges when you haven\'t visited anywhere in a while.', 'success');
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
    new Notification('Feed The Bear misses you!', {
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
   PHASE 10 •  ACHIEVEMENTS & XP
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
  { id: 'first_visit',      icon: '',  name: 'First Bite',       desc: 'Log your first visited restaurant',  xp: 20,  check: r => r.filter(x=>x.status==='visited').length >= 1 },
  { id: 'visits_5',         icon: '⭐',  name: 'Regular',           desc: '5 restaurants visited',              xp: 30,  check: r => r.filter(x=>x.status==='visited').length >= 5 },
  { id: 'visits_10',        icon: '⭐⭐',  name: 'Foodie',            desc: '10 restaurants visited',             xp: 50,  check: r => r.filter(x=>x.status==='visited').length >= 10 },
  { id: 'visits_25',        icon: '',  name: 'Veteran',           desc: '25 restaurants visited',             xp: 100, check: r => r.filter(x=>x.status==='visited').length >= 25 },
  { id: 'visits_50',        icon: '',  name: 'Legend',            desc: '50 restaurants visited',             xp: 200, check: r => r.filter(x=>x.status==='visited').length >= 50 },
  { id: 'cuisines_5',       icon: '',  name: 'Globe Trotter',     desc: '5 different cuisines explored',      xp: 40,  check: r => new Set(r.filter(x=>x.status==='visited').map(x=>(x.cuisine||'').toLowerCase()).filter(Boolean)).size >= 5 },
  { id: 'cuisines_10',      icon: '', name: 'Culinary Tourist',  desc: '10 different cuisines explored',     xp: 80,  check: r => new Set(r.filter(x=>x.status==='visited').map(x=>(x.cuisine||'').toLowerCase()).filter(Boolean)).size >= 10 },
  { id: 'wishlist_10',      icon: '',  name: 'Dream List',        desc: '10 places on your wishlist',         xp: 25,  check: r => r.filter(x=>x.status==='wishlist').length >= 10 },
  { id: 'first_5star',      icon: '⭐',  name: 'Perfection',        desc: 'Give a restaurant 5 stars',          xp: 30,  check: r => r.some(x=>x.myRating >= 5) },
  { id: 'photo_added',      icon: '',  name: 'Shutterbug',        desc: 'Add a photo to a restaurant',        xp: 15,  check: r => r.some(x=>x.photo) },
  { id: 'has_notes',        icon: '',  name: 'Critic',            desc: 'Write notes on 5 restaurants',       xp: 20,  check: r => r.filter(x=>x.notes&&x.notes.length>10).length >= 5 },
  { id: 'cheap_gem',        icon: '',  name: 'Bargain Hunter',    desc: 'Rate a $ restaurant 4+ stars',       xp: 25,  check: r => r.some(x=>x.priceRange===1&&x.myRating>=4) },
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
    showCelebrationMoment('Level Up', `Now: ${after.name}`, { durationMs: 2300, glow: true, confetti: true, confettiMs: 2400, haptic: 'medium' });
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
        showCelebrationMoment('Badge Unlocked', def.name, { durationMs: 1800, glow: true, confetti: true, confettiMs: 1800, haptic: 'light' });
        showToast(' Badge Unlocked!', def.icon + ' ' + def.name, 'success');
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
   PHASE 10 •  SWIPE TO DECIDE
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
      ${r.address ? `<div class="swipe-card-meta" style="margin-top:4px"> ${escHtml(r.address)}</div>` : ''}
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
      showToast(' ' + restaurant.name + ' picked!', 'Opening in Maps…', 'success');
      setTimeout(() => openDirections(restaurant), 800);
      awardXp(5, 'Made a dinner decision');
    }
    _renderSwipeDeck();
  }, 350);
}

function swipePick ()  { if (_swipeCurrentCard) { const r = _swipeDeck[_swipeIdx]; _completeSwipe(_swipeCurrentCard, r, true);  } }
function swipeSkip ()  { if (_swipeCurrentCard) { const r = _swipeDeck[_swipeIdx]; _completeSwipe(_swipeCurrentCard, r, false); } }

/* ------------------------------------------------------------
   PHASE 10 •  SPIN THE WHEEL
   ------------------------------------------------------------ */

let _spinItems    = [];
let _spinAngle    = 0;
let _spinAnimId   = null;
let _spinning     = false;

const WHEEL_COLORS = ['#E8B15A','#FF8C42','#FFA62B','#FFD166','#06D6A0','#118AB2','#7C83FD','#EF476F','#F78C6B','#C77DFF'];

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
  ctx.fillStyle = '#15111C';
  ctx.fill();
  ctx.strokeStyle = 'var(--border)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#E8B15A';
  ctx.font = 'bold 14px Poppins';
  ctx.textAlign = 'center';
  ctx.fillText('', cx, cy + 5);
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
      showToast(' The wheel chose!', winner.name, 'success');
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
   PHASE 10 •  MONTHLY DIGEST
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
  const avgRating = rated.length ? (rated.reduce((s,r) => s + r.myRating, 0) / rated.length).toFixed(1) : '-';
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
  const text = ` Feed The Bear · ${_MONTH_NAMES[_digestMonth]} ${_digestYear} Digest\n` +
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
   PHASE 10 •  OPEN NOW
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
  resultsEl.innerHTML = '<div class="open-now-loading"> Searching nearby...</div>';

  const now        = new Date();
  const DAY_MAP    = { 0:'Su', 1:'Mo', 2:'Tu', 3:'We', 4:'Th', 5:'Fr', 6:'Sa' };
  const todayKey   = DAY_MAP[now.getDay()];
  const curMins    = now.getHours() * 60 + now.getMinutes();
  const DAY_ORDER  = ['Mo','Tu','We','Th','Fr','Sa','Su'];

  const query = `[out:json][timeout:20];(node["amenity"~"restaurant|cafe|fast_food|bar"]["opening_hours"](around:${radius},${lat},${lng}););out body 40;`;

  try {
    const elementsRaw = await fetchOverpassElements(query, { timeoutMs: 18000 });
    const elements = (elementsRaw || []).filter(el => el.tags?.name);

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

    const TYPE_EMOJI = { restaurant:'', cafe:'☕', fast_food:'', bar:'', pub:'' };
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
      const emoji = TYPE_EMOJI[type] || '';
      const badge = isOpen === true ? ' Open' : ' Maybe';
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
  const priceLabel = avgPrice < 1.5 ? 'Budget Hunter '
    : avgPrice < 2.5 ? 'Value Seeker '
    : avgPrice < 3.5 ? 'Upscale Diner '
    : 'Fine Dining Connoisseur ';

  const uniqueCuisines = Object.keys(cuisineMap).length;
  const adventureScore = Math.min(Math.round((uniqueCuisines / Math.max(visited.length, 1)) * 100), 100);
  const adventureLabel = adventureScore > 70 ? 'Adventurous Explorer '
    : adventureScore > 40 ? 'Curious Foodie '
    : 'Comfort Loyalist ';

  const signature = top5[0];
  const dnaColors = ['#E8B15A', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6'];

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
      <div class="dna-stat"><div class="dna-stat-val">${signature ? cuisineEmoji(signature[0]) : ''}</div><div class="dna-stat-lbl">Signature</div></div>
    </div>
    <button class="btn-sm btn-orange" style="width:100%;margin-top:10px" onclick="shareTasteDna()"> Share My Taste DNA</button>
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
  bg.addColorStop(0, '#15111C'); bg.addColorStop(1, '#281F34');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const acc = ctx.createLinearGradient(0, 0, 0, H);
  acc.addColorStop(0, '#E8B15A'); acc.addColorStop(1, '#C0392B');
  ctx.fillStyle = acc; ctx.fillRect(0, 0, 8, H);

  ctx.globalAlpha = .06; ctx.font = '200px serif'; ctx.fillStyle = '#FFF';
  ctx.fillText('', W - 240, H - 10); ctx.globalAlpha = 1;

  ctx.fillStyle = '#FFF'; ctx.font = 'bold 38px system-ui,sans-serif';
  ctx.fillText(' My Taste DNA', 50, 75);
  ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '16px system-ui,sans-serif';
  ctx.fillText('Based on ' + total + ' restaurant' + (total !== 1 ? 's' : '') + ' visited', 50, 104);

  const dnaColors = ['#E8B15A', '#3498DB', '#2ECC71'];
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

  ctx.fillStyle = '#E8B15A'; ctx.font = 'bold 15px system-ui,sans-serif';
  ctx.fillText('Feed The Bear', W - 195, H - 18);

  canvas.toBlob(blob => {
    const file = new File([blob], 'taste-dna-ftb.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      navigator.share({ title: 'My Taste DNA', text: 'My foodie personality on Feed The Bear.', files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); URL.revokeObjectURL(url);
    }
    showToast(' Taste DNA!', 'Your flavor profile card is ready!', 'success');
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
    label.textContent = done ? ' Goal crushed! You\'re on fire!'
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
    showToast(' Weekly Goal Set!', n + ' meal' + (n !== 1 ? 's' : '') + ' per week. Let\'s eat!', 'success');
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
        if (v.photo) allPhotos.push({ src: v.photo, name: r.name + ' - ' + fmtDate(v.date), id: r.id, type: 'visit' });
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
  const wantPhoto = confirm('Add a photo from this visit? ');
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
        showToast(' Photo Added!', 'Visit photo saved to gallery.', 'success');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  saveData();
  renderAll();
  openDetailModal(id);
  showToast('✅ Checked In!', 'Visit logged for ' + r.name, 'success');
  showCelebrationMoment('Visit Logged', r.name, { durationMs: 1500, glow: true, confetti: false });
  checkConfettiMilestones(state.restaurants, state.restaurants);
}

/* ── Priority Badge Helper ──────────────────────────────── */
function priorityBadgeHtml (r) {
  if (!r.priority || r.status !== 'want-to-try') return '';
  if (r.priority === 'hot')    return '<span class="priority-badge hot"> Must Go!</span>';
  if (r.priority === 'next')   return '<span class="priority-badge next">⭐ Up Next</span>';
  if (r.priority === 'someday') return '<span class="priority-badge someday"> Someday</span>';
  return '';
}

/* ── Smarter Byte Cub Responses ─────────────────────────── */
function tasteDnaResponse () {
  const visited = state.restaurants.filter(r => r.status === 'visited');
  if (!visited.length) return 'Visit some restaurants first and I\'ll reveal your Taste DNA! ';
  const cuisineMap = {};
  visited.forEach(r => { const c = r.cuisine || 'Other'; cuisineMap[c] = (cuisineMap[c] || 0) + 1; });
  const top3 = Object.entries(cuisineMap).sort(([, a], [, b]) => b - a).slice(0, 3);
  const uniqueCount = Object.keys(cuisineMap).length;
  const adventureLabel = uniqueCount > 7 ? 'an Adventurous Explorer ' : uniqueCount > 4 ? 'a Curious Foodie ' : 'a Comfort Loyalist ';
  const topStr = top3.map(([c, n]) => `${cuisineEmoji(c)} **${c}** (${n}x)`).join(', ');
  return ` Your Taste DNA:\n\nYou\'re **${adventureLabel}** who loves ${topStr}.\n\nHead to **Stats** for your full flavor breakdown and a shareable Taste DNA card!`;
}

function neverTriedCuisineResponse () {
  const triedCuisines = new Set(
    state.restaurants.filter(r => r.status === 'visited').map(r => (r.cuisine || '').toLowerCase())
  );
  const allKnown = ['Italian','Japanese','Mexican','Chinese','Indian','Thai','French','Mediterranean','Korean','Vietnamese','Greek','Spanish','Brazilian','Ethiopian','Turkish','Caribbean','Peruvian','Lebanese'];
  const notTried = allKnown.filter(c => !triedCuisines.has(c.toLowerCase()));
  if (!notTried.length) return 'Wow, you\'ve explored every cuisine on my list! You\'re a true global foodie ';
  const pick = notTried[Math.floor(Math.random() * notTried.length)];
  return `You haven\'t tried **${pick}** yet! ${cuisineEmoji(pick.toLowerCase()) || ''}\n\nPerfect time to branch out - ask me to "discover nearby" to find a ${pick} spot near you! `;
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
      return `Good morning! ☀ How about this for breakfast:\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} ${pick.name}</span>\n\nPerfect way to start the day! ☕`;
    }
    return `Good morning! ☕ Add some breakfast or café spots to your list and I\'ll have morning recommendations ready!`;
  }
  if (q.match(/lunch|noon/) || (isLunch && q.match(/eat|food|hungry/))) {
    const quick = want.filter(r => r.priceRange <= 2 || ['Cafe','American','Mexican','Japanese','Korean'].includes(r.cuisine));
    if (quick.length) {
      const pick = quick[Math.floor(Math.random() * quick.length)];
      return `Lunchtime!  A quick and delicious option:\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} ${pick.name} ${priceDollars(pick.priceRange) || ''}</span>`;
    }
  }
  if (q.match(/dinner|tonight|evening/) || (isDinner && q.match(/eat|food|hungry/))) {
    const topDinner = [...want].sort((a, b) => (b.googleRating || 0) - (a.googleRating || 0)).slice(0, 3);
    if (topDinner.length) {
      const pick = topDinner[Math.floor(Math.random() * topDinner.length)];
      return `For dinner tonight , how about:\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} ${pick.name}${pick.googleRating ? ' ⭐' + pick.googleRating : ''}</span>\n\nOr ask for "Tonight\'s Pick" to get a mood-matched recommendation! `;
    }
  }
  return `Tell me more about your mood or craving and I\'ll find the perfect match.`;
}

function myStatsResponse () {
  const all     = state.restaurants;
  const visited = all.filter(r => r.status === 'visited');
  const want    = all.filter(r => r.status === 'want-to-try');
  const { currentStreak } = calcStreaks();
  const cuisineMap = {};
  visited.forEach(r => { const c = r.cuisine || 'Other'; cuisineMap[c] = (cuisineMap[c] || 0) + 1; });
  const topCuisine = Object.entries(cuisineMap).sort(([, a], [, b]) => b - a)[0];
  return ` **Your Foodie Stats:**\n\n ${all.length} restaurants saved\n✅ ${visited.length} visited ·  ${want.length} to try\n${currentStreak > 0 ? ` ${currentStreak}-week streak!\n` : ''}${topCuisine ? `❤ Favourite cuisine: **${topCuisine[0]}** (${topCuisine[1]}x)\n` : ''}\nCheck the **Stats** tab for the full breakdown!`;
}

function funnyNoteResponse () {
  const withNotes = state.restaurants.filter(r => r.notes);
  if (!withNotes.length) return 'No notes saved yet! Add personal notes when saving restaurants - best dishes, funny moments, must-order items. ';
  const item = withNotes[Math.floor(Math.random() * Math.min(withNotes.length, 8))];
  return `Here\'s a gem from your notes for **${item.name}**:\n\n*"${item.notes.slice(0, 180)}${item.notes.length > 180 ? '…' : ''}"* \n\n<span class="chip-link" data-id="${item.id}">View restaurant</span>`;
}

function goingTonightResponse () {
  const want = state.restaurants.filter(r => r.status === 'want-to-try');
  const hot  = want.filter(r => r.priority === 'hot');
  const pool = hot.length ? hot : want;
  if (!pool.length) return `Your want-to-try list is empty - add some spots and come back! `;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return ` **Going tonight?** Here\'s my top pick:\n\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} **${pick.name}**</span>\n${pick.address ? ' ' + pick.address + '\n' : ''}${pick.googleRating ? '⭐ ' + pick.googleRating + '/5\n' : ''}\nSay "directions" to get there, or ask for another pick!`;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 12 - Feature:  AI RESTAURANT DUEL
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
  const prompt = `You are a dramatic foodie sports commentator. Two restaurants are entering the ring for an epic duel!\n\nCORNER ONE - ${rA.name}:\n${describe(rA)}\n\nCORNER TWO - ${rB.name}:\n${describe(rB)}\n\nGive a fun, dramatic 6-8 sentence head-to-head breakdown covering: cuisine & vibe, value, overall experience based on the notes & ratings. End with a clear winner declaration on its own line starting with " WINNER:". Keep it under 200 words and make it entertaining!`;
  try {
    const text = await AI.call(prompt);
    const escaped = escHtml(text);
    const html = escaped.replace(/ WINNER:[^\n]*/g, m => `<div class="duel-winner">${m}</div>`);
    resultEl.innerHTML = html;
    void resultEl.offsetWidth;
    resultEl.classList.add('duel-animate');
    document.getElementById('duel-share-row').classList.remove('hidden');
    document.getElementById('duel-share-btn').onclick = () => {
      const txt = ` Restaurant Duel: ${rA.name} vs ${rB.name}\n\n${text}`;
      if (navigator.share) { navigator.share({ title: 'Restaurant Duel', text: txt }); }
      else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Fight card copied to clipboard.', 'success'); }
    };
  } catch (err) {
    resultEl.innerHTML = '⚠ ' + escHtml(err.message || 'AI error');
  }
  goBtn.disabled = false;
}

/* ═══════════════════════════════════════════════════════════
   PHASE 12 - Feature:  CUISINE BINGO
   ═══════════════════════════════════════════════════════════ */
const _BINGO_POOL = [
  {e:'',n:'Italian'},{e:'',n:'Mexican'},{e:'',n:'Japanese'},{e:'',n:'Indian'},
  {e:'',n:'Chinese'},{e:'',n:'French'},{e:'',n:'Mediterranean'},{e:'',n:'American'},
  {e:'',n:'Middle Eastern'},{e:'',n:'Thai'},{e:'',n:'Steakhouse'},{e:'',n:'Seafood'},
  {e:'',n:'Vietnamese'},{e:'',n:'Salad/Healthy'},{e:'',n:'Pub/Bar'},{e:'',n:'Breakfast'},
  {e:'',n:'Korean'},{e:'',n:'Ethiopian'},{e:'',n:'German'},{e:'',n:'Peruvian'},
  {e:'',n:'Brunch'},{e:'',n:'Dim Sum'},{e:'',n:'BBQ'},{e:'',n:'Vegan'},
  {e:'',n:'Spanish'},{e:'',n:'Pasta'},{e:'',n:'Fast Food'},{e:'',n:'Soul Food'},
  {e:'',n:'Hawaiian'},{e:'',n:'Bakery/Cafe'}
];
function _getBingoCard () {
  if (!state.settings.bingoCard) { _newBingoCard(); }
  return state.settings.bingoCard;
}
function _newBingoCard () {
  const userCuisines = [...new Set(state.restaurants.map(r => r.cuisine).filter(Boolean))];
  const poolNames = _BINGO_POOL.map(b => b.n);
  const extras = userCuisines.filter(c => !poolNames.includes(c)).slice(0, 5);
  const extraCells = extras.map(n => ({ e: '', n }));
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
   PHASE 12 - Feature:  AI FOOD FORTUNE COOKIE
   ═══════════════════════════════════════════════════════════ */
const _FORTUNE_FALLBACKS = [
  'The best meal you have not yet tasted is waiting just around the corner.',
  'Your adventurous palate will lead you to an unexpected culinary gem this week.',
  'A cuisine you have never tried holds your next favorite dish.',
  'Sharing a meal with good company turns ordinary food into a feast.',
  'Trust your instincts at the menu - your gut feeling is hungry for a reason.',
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
  cookie.textContent = '';
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
      const txt = ' My food fortune: ' + fortune;
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
   PHASE 12 - Feature:  FOOD MOOD CALENDAR
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
}

/* ═══════════════════════════════════════════════════════════
   PHASE 12 - Feature:  DAILY FOODIE CHALLENGE
   ═══════════════════════════════════════════════════════════ */
const _DC_CHALLENGES = [
  { e: '', t: 'New territory', d: 'Visit a cuisine type you have never rated before.' },
  { e: '', t: 'Snap & rate', d: 'Add a photo to one of your saved restaurants today.' },
  { e: '⭐', t: 'Rate something', d: 'Rate a restaurant you visited but never scored.' },
  { e: '', t: 'Leave a note', d: 'Add personal tasting notes to a restaurant with none.' },
  { e: '', t: 'Hidden gem', d: 'Find and add a restaurant with under 100 Google reviews.' },
  { e: '', t: 'Spice it up', d: 'Try or add a restaurant serving spicy cuisine.' },
  { e: '', t: 'Budget bite', d: 'Visit a $ price-range restaurant you have never tried.' },
  { e: '', t: 'Special occasion', d: 'Book a fine dining ($$$+) spot for an upcoming occasion.' },
  { e: '', t: 'Top the list', d: 'Rate a restaurant 5 stars and add a note on why.' },
  { e: '', t: 'Return visit', d: 'Revisit a restaurant you rated 4+ stars over 3 months ago.' },
  { e: '', t: 'World tour', d: 'Add a restaurant of a cuisine from a continent you have not tracked yet.' },
  { e: '', t: 'Squad goals', d: 'Plan a group outing to one of your want-to-try spots.' },
  { e: '', t: 'Foodie detective', d: 'Find a restaurant in your city that opened in the last 6 months.' },
  { e: '', t: 'Green & lean', d: 'Try a plant-based or vegan restaurant today.' },
  { e: '', t: 'Breakfast club', d: 'Track a breakfast or brunch spot you love.' },
  { e: '', t: 'Spin the wheel', d: 'Use Spin the Wheel to pick a restaurant and actually go.' },
  { e: '', t: 'Story time', d: 'Add a funny memory or story to a restaurant\'s notes.' },
  { e: '', t: 'Monthly review', d: 'Open Monthly Digest and reflect on last month\'s visits.' },
  { e: '', t: 'Share the love', d: 'Export your Food Passport and share it with a friend.' },
  { e: '', t: 'Bucket list', d: 'Add 3 restaurants to your want-to-try list right now.' },
];
function _getDCState () {
  return state.settings.dailyChallenge || { date: '', text: '', emoji: '', completed: false, streak: 0, xp: 0, history: [] };
}
function _getTodayStr () { return getDailyQuestDateKey(); }
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
    persistSettingsLocal();
  }
  return dc;
}
function openDailyChallenge () {
  const overlay = document.getElementById('dailychallenge-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _renderDailyChallenge();
}
function closeDailyChallenge () {
  document.getElementById('dailychallenge-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}
function _renderDailyChallenge () {
  if (!document.getElementById('dailychallenge-overlay')) return;
  const dc = _initDailyChallenge();
  document.getElementById('dc-streak-count').textContent = dc.streak || 0;
  document.getElementById('dc-xp-count').textContent = dc.xp || 0;
  document.getElementById('dc-emoji').textContent = dc.emoji || '';
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
  persistSettingsLocal();
  showToast(' Challenge complete!', `+25 XP · ${dc.streak} day streak!`, 'success');
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
  persistSettingsLocal();
  showToast('Skipped', 'Streak reset. New challenge loaded!', 'info');
  _renderDailyChallenge();
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 - Feature:  VISIT LOG
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
      ${v.dish ? `<div class="visitlog-entry-dish"> ${escHtml(v.dish)}</div>` : ''}
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
  showToast('Visit logged', `Logged your trip to ${escHtml(r.name)}.`, 'success');
}
function _invalidateSpendCache () { _spendCacheValid = false; }

/* ═══════════════════════════════════════════════════════════
   PHASE 13 - Feature:  SPEND TRACKER
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
   PHASE 13 - Feature: ⏰ IT'S BEEN A WHILE
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
    listEl.innerHTML = '<div class="beenawhile-empty"> You\'re on top of it! All your faves have been visited recently.</div>';
    return;
  }
  const cuisineEmoji = { Italian:'', Mexican:'', Japanese:'', Indian:'', Chinese:'', French:'', American:'', Thai:'', Mediterranean:'' };
  listEl.innerHTML = candidates.map(({ r, ms }) => {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const ago = days > 365 ? `${Math.floor(days/365)}y ago` : `${days}d ago`;
    const emoji = (r.cuisine && cuisineEmoji[r.cuisine]) || '';
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
   PHASE 13 - Feature:  AI MEAL PLANNER
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
DAY [number] - [Day name]: [Restaurant name] ([cuisine]) - [1-2 sentence reason]

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
   PHASE 13 - Feature:  GROUP VOTE
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
  if (_gvSelected.size < 2) { showToast('Pick at least 2', 'Select 2-5 restaurants to vote on.', 'info'); return; }
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
  showToast('Vote cast! ', 'Your choice has been recorded.', 'success');
}

/* ═══════════════════════════════════════════════════════════
   PHASE 13 - Feature:  CUISINE WORLD MAP
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
    `<span> <strong>${countries.size}</strong> countries tasted</span>` +
    `<span> <strong>${visited}</strong> cuisine styles</span>` +
    `<span> <strong>${state.restaurants.length}</strong> restaurants logged</span>`;

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
   PHASE 13 - Feature:  FOODIE PASSPORT
   ═══════════════════════════════════════════════════════════ */
const _PASSPORT_CUISINES = [
  {e:'',n:'Italian'},{e:'',n:'Mexican'},{e:'',n:'Japanese'},{e:'',n:'Indian'},
  {e:'',n:'Chinese'},{e:'',n:'French'},{e:'',n:'Mediterranean'},{e:'',n:'American'},
  {e:'',n:'Middle Eastern'},{e:'',n:'Thai'},{e:'',n:'Korean'},{e:'',n:'Vietnamese'},
  {e:'',n:'Steakhouse'},{e:'',n:'Seafood'},{e:'',n:'Pub/Bar'},{e:'',n:'Breakfast'},
  {e:'',n:'Ethiopian'},{e:'',n:'German'},{e:'',n:'Spanish'},{e:'',n:'Peruvian'},
  {e:'',n:'Brunch'},{e:'',n:'Dim Sum'},{e:'',n:'BBQ'},{e:'',n:'Vegan'},
  {e:'',n:'Pasta'},{e:'',n:'Fast Food'},{e:'',n:'Hawaiian'},{e:'',n:'Bakery/Cafe'},
  {e:'',n:'Salad/Healthy'},{e:'',n:'Soul Food'},{e:'',n:'Brazilian'},{e:'',n:'Greek'},
  {e:'',n:'Turkish'},{e:'',n:'Moroccan'},{e:'',n:'Lebanese'},{e:'',n:'Sri Lankan'},
  {e:'',n:'Singaporean'},{e:'',n:'Malaysian'},{e:'',n:'Filipino'},{e:'',n:'Nepalese'},
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
      .map(c => ({ e: '', n: c }))
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
    const txt = ` My Foodie Passport: ${earnedCount} cuisine stamps, ${totalCuisines} cuisines explored, ${state.restaurants.length} restaurants. #FeedTheBear`;
    if (navigator.share) navigator.share({ title: 'My Foodie Passport', text: txt });
    else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Passport summary copied.', 'success'); }
  };
}

/* ═══════════════════════════════════════════════════════════
   PHASE 14 -  FEED THE BEAR GAME
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
  '','','','','','','','','',
  '','','','','','','','','',
  '','','','','','','',
];
const _FTB_BONUS  = ['⭐','',''];  // +50 pts each
const _FTB_BAD    = ['','',''];  // dodge! -1 life if caught

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

  /* move bear - keyboard */
  const bHalf = g.bear.w / 2;
  if (g.keys.left)  g.bear.x = Math.max(bHalf,              g.bear.x - g.bear.speed);
  if (g.keys.right) g.bear.x = Math.min(canvas.width - bHalf, g.bear.x + g.bear.speed);

  /* move bear - touch (smooth lerp) */
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
        g.popups.push({ t: '-', x: f.x, y: f.y, a: 1, c: '#ff4444' });
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
  ctx.strokeStyle = 'rgba(232,177,90,0.25)';
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
  ctx.fillText('❤'.repeat(Math.max(0, g.lives)), canvas.width - 8, fs + 4);

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
  ctx.fillText('', bear.x, bear.y);
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
  ctx.fillText('', W / 2, H * 0.52);

  ctx.font = `bold ${Math.round(W * 0.088)}px sans-serif`;
  ctx.fillStyle = '#ff6b35';
  ctx.fillText('FEED THE BEAR!', W / 2, H * 0.22);

  ctx.font = `${Math.round(W * 0.052)}px sans-serif`;
  ctx.fillStyle = '#aaa';
  ctx.fillText('Catch food · Dodge pests', W / 2, H * 0.31);

  if (g.hiScore > 0) {
    ctx.font = `${Math.round(W * 0.048)}px sans-serif`;
    ctx.fillStyle = '#ffd700';
    ctx.fillText(' Best: ' + g.hiScore, W / 2, H * 0.38);
  }

  /* food preview strip */
  const previews = ['','','','','','','⭐'];
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
    ctx.fillText(' NEW HIGH SCORE!', W / 2, H * 0.5);
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




