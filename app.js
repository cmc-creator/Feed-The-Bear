/* ════════════════════════════════════════════════════════════
   Feed The Bear - App Logic
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ── Free (Cub) plan limits ──────────────────────────────────
   Declared in the first app script so grizzly.js, friends.js and cub.js can
   never run before they exist (timers can fire while the parser waits on the
   external Firebase scripts, which used to make renderGrizzlyUi throw). */
const FREE_RESTAURANT_LIMIT = 25;
const FREE_FRIENDS = 1;

/* ── Which app is this? ──────────────────────────────────────
   The iPhone app (native/ios) and the Android app (native/android) both load
   this site. Google Play things (ratings, updates, badges) are Android only;
   Apple rejects iPhone apps that mention Google Play. */
const IS_IOS_APP = window.Capacitor?.getPlatform?.() === 'ios';
const IS_ANDROID_APP = !!window.Capacitor?.isNativePlatform?.() && !IS_IOS_APP;
window.FTB_IOS_APP = IS_IOS_APP;
if (IS_IOS_APP) document.documentElement.classList.add('ios-app');

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

/* ── What Android's web view can't do, in the Android app ────
   No share sheet, no file downloads, no printing, and links meant for Maps
   or a restaurant's site open inside the app. App 2.2.0+ has
   ShareSheetPlugin.java for these; the site's buttons stay as they are. */
const _blobToBase64 = blob => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});
(function nativeAndroidBridges () {
  const sheet = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.ShareSheet : null;
  if (!sheet?.share) return;
  const shareFile = async (file, { title = '', text = '' } = {}) => sheet.shareFile({
    name: file.name || 'feed-the-bear', mime: file.type || 'application/octet-stream',
    base64: await _blobToBase64(file), title: String(title), text: String(text),
  });
  try {
    // Share: text and links, or an image/file (the first one).
    if (!navigator.share || !sheet.shareFile) {
      Object.defineProperty(navigator, 'share', {
        configurable: true, writable: true,
        value: ({ title = '', text = '', url = '', files } = {}) => {
          if (files?.length > 1) return Promise.reject(new DOMException('Share these files individually', 'NotAllowedError'));
          if (files?.length && sheet.shareFile) return shareFile(files[0], { title, text: [text, url].filter(Boolean).join(' ') });
          if (files?.length && !text && !url) return Promise.reject(new DOMException('Files not supported', 'NotAllowedError'));
          return sheet.share({ title: String(title), text: String(text), url: String(url) });
        },
      });
      Object.defineProperty(navigator, 'canShare', {
        configurable: true, writable: true,
        value: (data = {}) => !data.files?.length || (data.files.length === 1 && !!sheet.shareFile),
      });
    }
    if (!sheet.shareFile) return;
    // Downloads (backup, CSV, photos, story cards): a link with `download` and
    // a blob: address. Hand the file to the share sheet, which can save it too.
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download') && /^(blob|data):/.test(this.href)) {
        const name = this.getAttribute('download') || 'feed-the-bear';
        fetch(this.href).then(r => r.blob())
          .then(blob => shareFile(new File([blob], name, { type: blob.type })))
          .catch(() => showToast('Could not save', 'Please try again.', 'error'));
        return;
      }
      return click.call(this);
    };
    // Print: Android's print screen, which also saves a PDF.
    window.print = () => { sheet.print({ title: 'Feed The Bear' }).catch(() => showToast('Printing unavailable', 'This phone has no print service.', 'error')); };
    // Links to other sites and apps (Maps, Directions, websites, texts): open
    // them in the app made for them, not inside Feed The Bear.
    const open = window.open.bind(window);
    window.open = (url, target, features) => {
      try {
        const u = new URL(String(url), location.href);
        if (u.origin !== location.origin) { sheet.openUrl({ url: u.href }).catch(() => open(url, target, features)); return null; }
      } catch { /* not a URL: let the web view try */ }
      return open(url, target, features);
    };
  } catch { /* leave the browser's own behaviour */ }
})();

/* Also used when a browser exposes Web Share but refuses to open it. */
function shareWithMenu ({ title = '', text = '', url = '', files } = {}) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const go = url => { location.href = url; };
  return new Promise((resolve, reject) => {
    const body = [text, url].filter(Boolean).join(' ').trim();
    if (!body) { reject(new DOMException(files?.length ? 'Files not supported' : 'Nothing to share', 'NotAllowedError')); return; }
    document.getElementById('share-menu')?.remove();
    const el = document.createElement('div');
    el.id = 'share-menu';
    el.className = 'modal-overlay share-menu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Share');
    el.innerHTML = `<div class="share-menu-card">
      <h3>${esc(title || 'Share')}</h3>
      <button type="button" class="btn-primary" data-via="sms">💬 Text message</button>
      <button type="button" class="btn-secondary" data-via="whatsapp">🟢 WhatsApp</button>
      <button type="button" class="btn-secondary" data-via="email">✉️ Email</button>
      <button type="button" class="btn-secondary" data-via="copy">📋 Copy</button>
      <div class="share-menu-manual hidden">
        <p>Copying was blocked. Touch and hold the text below, then choose Copy and paste it to your friend.</p>
        <textarea class="form-input share-menu-text" readonly aria-label="Text and link to share">${esc(body)}</textarea>
        <button type="button" class="btn-secondary" data-via="done">I've copied it</button>
      </div>
      <button type="button" class="share-menu-cancel">Cancel</button>
    </div>`;
    document.body.appendChild(el);
    const close = ok => { el.remove(); ok ? resolve() : reject(new DOMException('Share canceled', 'AbortError')); };
    el.addEventListener('click', async e => {
      if (e.target === el || e.target.closest('.share-menu-cancel')) { close(false); return; }
      const via = e.target.closest('[data-via]')?.dataset.via;
      if (!via) return;
      if (via === 'sms') {
        const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        go(`sms:${apple ? '&' : '?'}body=${encodeURIComponent(body)}`);
      }
      if (via === 'whatsapp') go(`https://wa.me/?text=${encodeURIComponent(body)}`);
      if (via === 'email') go(`mailto:?subject=${encodeURIComponent(title || 'Feed The Bear')}&body=${encodeURIComponent(body)}`);
      if (via === 'copy') {
        try { await navigator.clipboard.writeText(body); showToast('Copied', 'Paste it to a friend.', 'success'); }
        catch (err) {
          el.querySelector('.share-menu-manual').classList.remove('hidden');
          const field = el.querySelector('.share-menu-text');
          field.focus();
          field.select();
          return;
        }
      }
      close(true);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') close(false); });
    el.querySelector('[data-via="sms"]').focus();
  });
}
(function shareMenuFallback () {
  if (navigator.share) return;
  Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: shareWithMenu });
})();

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
const NOTIFY_COOLDOWN = 3 * 24 * 60 * 60 * 1000; // a saved spot near you: remind at most every 3 days
const NOTIFY_SNOOZE = 7 * 24 * 60 * 60 * 1000;   // closing the alert: quiet for a week

/* ── Cuisine badge map ───────────────────────────────────── */
// Food emoji for each cuisine (an earlier pass had swapped these for letter
// codes like "MX", which read as broken placeholders).
const CUISINE_EMOJI = {
  american: '🍔', bbq: '🍖', breakfast: '🥞', brunch: '🥂', burgers: '🍔', cafe: '☕', coffee: '☕',
  chinese: '🥡', desserts: '🍰', dessert: '🍰', bakery: '🥐', french: '🥐', greek: '🥙', indian: '🍛', italian: '🍝',
  japanese: '🍱', korean: '🍲', mediterranean: '🫒', mexican: '🌮', pizza: '🍕', seafood: '🦞', steakhouse: '🥩',
  steak: '🥩', sushi: '🍣', thai: '🍜', vegan: '🥗', vegetarian: '🥗', vietnamese: '🍜', ramen: '🍜', irish: '☘️',
  pub: '🍺', bar: '🍺', sandwiches: '🥪', sandwich: '🥪', deli: '🥪', brewery: '🍺', 'tex mex': '🌮', noodle: '🍜', donut: '🍩', burger: '🍔', chicken: '🍗', wings: '🍗', 'fast food': '🍟', southern: '🍗',
  'middle eastern': '🧆', spanish: '🥘', german: '🥨', caribbean: '🍹', ethiopian: '🍲', peruvian: '🐟', 'ice cream': '🍦',
  'dim sum': '🥟', pasta: '🍝', 'pub/bar': '🍺', 'salad/healthy': '🥗', 'bakery/cafe': '🥐', 'korean bbq': '🥩',
  donuts: '🍩', healthy: '🥗', salad: '🥗', soul_food: '🍗', 'soul food': '🍗', turkish: '🥙', filipino: '🍢', hawaiian: '🍍',
  default: '🍽️'
};
const cuisineEmoji = c => CUISINE_EMOJI[String(c || '').toLowerCase().trim()] || CUISINE_EMOJI.default;

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
  pub: ['Fish and Chips', 'Shepherds Pie', 'Beer Battered Onion Rings']
};

const GENERIC_CUISINE_KEYS = new Set(['fast_food', 'fastfood', 'restaurant', 'default', 'food', 'amenity']);
const PARKED_DOMAIN_RE = /expireddomains|hugedomains|sedo\.com|sedo\.net|afternic|dan\.com|parkingcrew|bodis\.com|parked\.com|domainmarket|undeveloped\.com|godaddy\.com\/domain|namecheap\.com\/market|premium[-_ ]?domain|domain[-_ ]?for[-_ ]?sale|buy[-_ ]?this[-_ ]?domain|this domain is for sale|this domain may be for sale/;
const FOOD_VENUE_WORD_RE = /\b(cafe|café|coffee|restaurant|grill|kitchen|bar|pizza|taco|tacos|burger|bistro|diner|eatery|bakery|pub|brew|sushi|pho|noodle|bbq|steak|chicken|wings|donut|donuts|gelato|ice\s*cream|tea|cantina|taqueria|trattoria|ristorante|brasserie|gastropub|smokehouse|steakhouse|deli|sandwich|waffles|pancake|brunch|breakfast|food\s*court|creamery|bagel|bagels|subs?)\b/i;
const STREET_ONLY_NAME_RE = /^(n|s|e|w|north|south|east|west)?\s*[\w.'-]+(\s+[\w.'-]+)*\s+(road|rd|street|st|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|hwy|highway|pkwy|parkway|circle|cir|court|ct|terrace|ter|trail|trl|loop|place|pl)\.?$/i;

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
  const rating = Number(savedRestaurant?.googleRating || 0);
  const reviews = Number(savedRestaurant?.googleReviews || 0);
  if (rating >= 4.6 && reviews >= 20) return 'Very Popular';
  if (rating >= 4.2 && reviews >= 5) return 'Trending';
  return '';
}

function verifiedPriceLevel (savedRestaurant = null, explicit = 0) {
  const savedPrice = Number(savedRestaurant?.priceRange || 0);
  if (savedPrice >= 1 && savedPrice <= 4) return savedPrice;
  const n = Number(explicit || 0);
  return (n >= 1 && n <= 4 && savedRestaurant) ? n : 0;
}

function isJunkWebsiteUrl (url = '') {
  const u = String(url || '').trim().toLowerCase();
  if (!u) return true;
  return PARKED_DOMAIN_RE.test(u);
}

function cleanVenueWebsite (url = '') {
  const raw = String(url || '').trim();
  if (!raw || isJunkWebsiteUrl(raw)) return '';
  const safe = safeUrl(raw);
  return safe && !isJunkWebsiteUrl(safe) ? safe : '';
}

function isCredibleVenueName (name = '', tags = {}) {
  const n = String(name || '').trim();
  if (n.length < 3) return false;
  if (/^(unknown|unnamed|null|undefined|n\/a|none)$/i.test(n)) return false;
  if (/^\d+$/.test(n)) return false;
  const street = String(tags['addr:street'] || '').trim();
  const houseStreet = [tags['addr:housenumber'], street].filter(Boolean).join(' ').trim();
  if (street && normalizeName(n) === normalizeName(street)) return false;
  if (houseStreet && normalizeName(n) === normalizeName(houseStreet)) return false;
  if (/\bfood\s*court\b/i.test(n)) return true;
  if (STREET_ONLY_NAME_RE.test(n)) return false;
  return true;
}

function isCredibleFoodVenue (el = {}) {
  const tags = el?.tags || {};
  return isCredibleVenueName(tags.name, tags);
}

function favoriteDishesForSaved (restaurant) {
  const rank = { again: 2, ok: 1 };
  const normalized = dishesOf(restaurant)
    .filter(d => String(d?.name || '').trim() && rank[d.verdict])
    .sort((a, b) => rank[b.verdict] - rank[a.verdict] || (b.rating || 0) - (a.rating || 0))
    .slice(0, 3)
    .map(d => String(d.name).trim());
  if (normalized.length) return normalized;
  return null;
}

function favoriteDishesForNearby (cuisine = '', amenity = 'restaurant') {
  return [];
}

// Stock dish photos that actually match a cuisine; empty when we don't know.
function cuisineFoodPhotoPool (raw = '') {
  const pool = [];
  if (/(mexican|taco|birria|burrito|quesadilla|enchilada)/.test(raw)) pool.push('assets/food/tacos.jpg', 'assets/food/burrito.jpg', 'assets/food/quesadilla.jpg');
  else if (/(mediterranean|greek|middle eastern|lebanese|turkish|falafel|shawarma|kebab|gyro)/.test(raw)) pool.push('assets/food/falafel.jpg', 'assets/food/shawarma.jpg', 'assets/food/kebab.jpg');
  else if (/(vietnamese|pho|banh mi)/.test(raw)) pool.push('assets/food/pho.jpg', 'assets/food/banh_mi.jpg');
  else if (/(spanish|paella|tapas)/.test(raw)) pool.push('assets/food/paella.jpg');
  else if (/(steak|chophouse)/.test(raw)) pool.push('assets/food/steak.jpg');
  else if (/(poke|hawaiian)/.test(raw)) pool.push('assets/food/poke_bowl.jpg');
  else if (/(dessert|ice cream|gelato|cheesecake|churro)/.test(raw)) pool.push('assets/food/gelato.jpg', 'assets/food/cheesecake.jpg', 'assets/food/churros.jpg');
  else if (/(salad|healthy)/.test(raw)) pool.push('assets/food/caesar_salad.jpg');
  else if (/(dosa|south indian)/.test(raw)) pool.push('assets/food/dosa.jpg');
  else if (/(italian|pasta|pizza|ristorante)/.test(raw)) pool.push('assets/food/italian_pasta.jpg', 'assets/food/pasta.jpg', 'assets/food/pizza.jpg');
  else if (/(japanese|sushi|ramen)/.test(raw)) pool.push('assets/food/sushi.jpg', 'assets/food/ramen.jpg', 'assets/food/udon.jpg');
  else if (/(korean)/.test(raw)) pool.push('assets/food/korean_bbq.jpg', 'assets/food/bibimbap.jpg');
  else if (/(chinese|dumpling|wok)/.test(raw)) pool.push('assets/food/dumplings.jpg', 'assets/food/chow_mein.jpg', 'assets/food/fried_rice.jpg');
  else if (/(indian|curry|masala|biryani)/.test(raw)) pool.push('assets/food/butter_chicken.jpg', 'assets/food/biryani.jpg', 'assets/food/indian_curry.jpg');
  else if (/(thai|pad thai)/.test(raw)) pool.push('assets/food/pad_thai.jpg', 'assets/food/thai_curry.jpg');
  else if (/(seafood|fish|shrimp)/.test(raw)) pool.push('assets/food/seafood.jpg', 'assets/food/shrimp.jpg', 'assets/food/salmon.jpg');
  else if (/(burger|american|diner)/.test(raw)) pool.push('assets/food/burger.jpg', 'assets/food/fries.jpg', 'assets/food/fried_chicken.jpg');
  else if (/(cafe|coffee|tea|bakery|breakfast|brunch)/.test(raw)) pool.push('assets/food/eggs_benedict.jpg', 'assets/food/french_toast.jpg', 'assets/food/pancakes.jpg');
  return pool;
}

function localNearbyFoodPhoto (cuisine = '', amenity = '', seed = '') {
  const raw = `${String(cuisine || '').toLowerCase()} ${String(amenity || '').toLowerCase()}`;
  const pool = cuisineFoodPhotoPool(raw);
  // Nearby cards always need some image; unknown cuisines get a generic mix.
  if (!pool.length) pool.push('assets/food/pizza.jpg', 'assets/food/burger.jpg', 'assets/food/tacos.jpg');
  const idx = pool.length ? (miniHash(String(seed || raw)) % pool.length) : 0;
  return safeUrl(pool[idx] || 'assets/food/pizza.jpg');
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
  websiteVerified = false,
  address = '',
  lat = null,
  lon = null,
  key = '',
  savedRestaurant = null,
} = {}) {
  const cuisineLabel = formatCuisineLabel(cuisine || amenity || 'Restaurant');
  const distText = Number.isFinite(distMeters) ? fmtDist(distMeters) : 'Distance unknown';
  const effectivePrice = verifiedPriceLevel(savedRestaurant, priceLevel);
  const effectivePopularity = popularity || nearbyPopularityLabel(distMeters, savedRestaurant);
  const dishes = favoriteDishesForSaved(savedRestaurant) || [];
  const dishesHtml = dishes.length
    ? `<div class="nearby-home-card-dishes">Favorite dishes: ${escHtml(dishes.join(' • '))}</div>`
    : '';
  const photo = hasReliableNearbyCardPhoto({ photoUrl }) ? safeUrl(photoUrl) : '';
  const safeName = escHtml(name);
  const safeNameForClick = escJsArg(name || '');
  const safeCuisine = escJsArg(cuisine || '');
  const websiteUrl = isSaved ? cleanVenueWebsite(savedRestaurant?.website || website || '') : '';
  const safeAddressForClick = escJsArg(savedRestaurant?.address || address || '');
  const safeWebsiteForClick = escJsArg(websiteUrl || '');
  const prefillLat = Number.isFinite(savedRestaurant?.lat) ? Number(savedRestaurant.lat) : (Number.isFinite(lat) ? Number(lat) : null);
  const prefillLon = Number.isFinite(savedRestaurant?.lng) ? Number(savedRestaurant.lng) : (Number.isFinite(lon) ? Number(lon) : null);
  const placeRef = {
    name,
    address: savedRestaurant?.address || address || '',
    lat: Number.isFinite(savedRestaurant?.lat) ? Number(savedRestaurant.lat) : (Number.isFinite(lat) ? Number(lat) : null),
    lng: Number.isFinite(savedRestaurant?.lng) ? Number(savedRestaurant.lng) : (Number.isFinite(lon) ? Number(lon) : null),
  };
  const directionsUrl = buildGoogleDirectionsUrl(placeRef);
  const mapsUrl = buildGooglePlaceSearchUrl(placeRef);
  const menuUrl = buildMenuSearchUrl(placeRef);
  const cardLink = mapsUrl || directionsUrl;
  const popularityScore = effectivePopularity
    ? Math.max(30, Math.min(98,
      Math.round((effectivePopularity === 'Very Popular' ? 92 : 84))))
    : 0;
  const popBadgeHtml = effectivePopularity
    ? `<span class="nearby-home-card-badge pop">${escHtml(effectivePopularity)}</span>`
    : '';
  const popMeterHtml = effectivePopularity
    ? `<div class="nearby-home-card-pop-meter"><span style="width:${popularityScore}%"></span></div>`
    : '';

  return `<article class="nearby-home-card${isSaved ? ' saved' : ''}" data-nearby-key="${escHtml(key || `${name}-${distText}`)}" data-nearby-price="${effectivePrice}" data-nearby-popularity="${escHtml(effectivePopularity)}" data-card-link="${escHtml(cardLink || '')}" role="link" tabindex="0" title="Open ${safeName}">
    <div class="nearby-home-card-media">
      <div class="nearby-home-card-photo-empty"${photo ? ' style="display:none"' : ''}><span class="nhc-empty-emoji" aria-hidden="true">${cuisineEmoji(cuisine)}</span><span class="nhc-empty-text">${escHtml(cuisineLabel)}</span></div>
      ${photo ? `<img class="nearby-home-card-photo" src="${escHtml(photo)}" alt="Photo of ${safeName}" loading="lazy" onerror="this.previousElementSibling.style.display='grid';this.remove()" />` : ''}
      <div class="nearby-home-card-badges">
        ${effectivePrice ? `<span class="nearby-home-card-badge price">${'$'.repeat(effectivePrice)}</span>` : ''}
        ${popBadgeHtml}
      </div>
    </div>
    <div class="nearby-home-card-body">
      <div class="nearby-home-card-name" title="${safeName}">${safeName}</div>
      <div class="nearby-home-card-meta">${escHtml(cuisineLabel)} • ${distText}</div>
      ${popMeterHtml}
      ${dishesHtml}
    </div>
    <div class="nearby-home-card-footer">
      ${isSaved
        ? `<button class="btn-sm btn-secondary nearby-home-card-add" onclick="openDetailModal('${restaurantId}')">View</button>`
        : `<button class="btn-sm btn-orange nearby-home-card-add" onclick="openAddModalPreFilled('${safeNameForClick}','${safeCuisine}',{name:'${safeNameForClick}',address:'${safeAddressForClick}',website:'${safeWebsiteForClick}',lat:${prefillLat == null ? 'null' : prefillLat},lon:${prefillLon == null ? 'null' : prefillLon}})">+ Save</button>`}
      ${(menuUrl || websiteUrl || directionsUrl)
        ? `<div class="nearby-home-card-links">${menuUrl ? `<a class="btn-sm btn-ghost nearby-home-card-link" href="${escHtml(menuUrl)}" target="_blank" rel="noopener">Find menu</a>` : ''}${websiteUrl ? `<a class="btn-sm btn-ghost nearby-home-card-link" href="${escHtml(websiteUrl)}" target="_blank" rel="noopener">Website</a>` : ''}${directionsUrl ? `<a class="btn-sm btn-secondary nearby-home-card-link" href="${escHtml(directionsUrl)}" target="_blank" rel="noopener">Directions</a>` : ''}</div>`
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

  // The restaurant's own photo, looked up for spots you haven't photographed (fillSpotPhotos).
  const placePhoto = safeUrl(savedRestaurant?.placePhoto || '');
  if (placePhoto) return { url: placePhoto, source: 'place' };

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
  const owner = localStorage.getItem('ftb_data_owner_v1') || localStorage.getItem('ftb_uid_v1');
  const legacy = !owner && !!localStorage.getItem('ftb_last_account_v1') && window._ftbDataOwner === undefined;
  if (window._ftbAccountSwitching || legacy || (owner && owner !== window._ftbUid)) {
    state.restaurants = [];
    state.settings = deviceAppearance();
    return;
  }
  window._ftbDataOwner = owner || '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : seedData();
    state.restaurants = pruneLegacyDemoRestaurants(parsed);
    if (!raw || state.restaurants.length !== parsed.length) saveData();
  } catch {
    state.restaurants = pruneLegacyDemoRestaurants(seedData());
    saveData();
  }

  // One-time migration: fold legacy r.visitLog entries into r.visits so
  // streaks, stats, heatmaps and the spend tracker all read one dataset.
  let _vlMigrated = false;
  (state.restaurants || []).forEach(r => {
    if (!r || typeof r !== 'object') return;
    if (Array.isArray(r.visitLog) && r.visitLog.length) {
      if (!Array.isArray(r.visits)) r.visits = [];
      r.visitLog.forEach(v => r.visits.push({
        date:   v.date || '',
        note:   v.notes || v.note || '',
        rating: v.rating || 0,
        photo:  '',
        spend:  (v.spend != null) ? v.spend : null,
        dish:   v.dish || '',
      }));
      r.visits.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      _vlMigrated = true;
    }
    if ('visitLog' in r) { delete r.visitLog; _vlMigrated = true; }
  });
  if (tidyCuisines()) _vlMigrated = true;
  if (_vlMigrated) saveData();
  if (mergeLegacyDishStores()) saveData();
  // Restore photos kept in IndexedDB, then move any still stored inline there.
  const generation = _dataGeneration;
  hydrateStoredPhotos().then(() => { if (generation === _dataGeneration && _photoDbReady && localStorage.getItem(STORAGE_KEY)?.includes('"data:image/')) saveData(); });

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

/* ── Photo store ────────────────────────────────────────────────
   localStorage holds ~5 MB, so a few dozen food photos filled it and every
   save failed. Photos now live in IndexedDB (hundreds of MB). In memory the
   restaurants still carry data URLs, so nothing else changes; only the
   saved copy swaps each photo for an "idb:<hash>" reference.
   A photo is written to IndexedDB before the list that references it, so
   closing the app mid-save can't leave a dangling reference. */
const PHOTO_DB = 'ftb-photos';
const PHOTO_STORE = 'photos';
const PHOTO_REF = 'idb:';

/* ── Food videos (Grizzly) ──────────────────────────────────────
   Up to 15 seconds. The file is kept as a Blob in IndexedDB's "videos"
   store and referenced as "vid:<id>" on the dish or visit; a poster frame
   becomes its photo, so everything that shows photos keeps working.
   Videos stay on the device that recorded them (Firestore can't hold
   them); other devices show the poster. */
const VIDEO_STORE = 'videos';
const VIDEO_REF = 'vid:';
const FOOD_VIDEO_MAX_SECONDS = 15;
const FOOD_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

// Duration plus a JPEG poster frame from a video file.
function readVideoPoster (file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    const done = (fn, arg) => { clearTimeout(timer); URL.revokeObjectURL(url); fn(arg); };
    const timer = setTimeout(() => done(reject, new Error('timeout')), 10000);
    v.onerror = () => done(reject, new Error('unreadable'));
    // Some WebM files report an infinite duration until you seek to the end.
    let measuring = false;
    const seekPoster = () => { v.currentTime = Math.min(0.5, (Number.isFinite(v.duration) ? v.duration : 1) / 2); };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) { seekPoster(); return; }
      measuring = true;
      v.currentTime = 1e101;
    };
    v.onseeked = () => {
      if (measuring) { measuring = false; seekPoster(); return; }
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      let poster = '';
      try {
        const scale = Math.min(1, FOOD_PHOTO_MAX_DIM / Math.max(v.videoWidth || 1, v.videoHeight || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((v.videoWidth || 640) * scale));
        c.height = Math.max(1, Math.round((v.videoHeight || 480) * scale));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        poster = c.toDataURL('image/jpeg', FOOD_PHOTO_QUALITY);
      } catch { /* some formats decode without a drawable frame */ }
      done(resolve, { duration, poster });
    };
  });
}

function storeFoodVideo (file) {
  const id = uid();
  return photoDbOp('readwrite', store => store.put(file, id), VIDEO_STORE).then(ok => {
    if (!ok) throw new Error('No video storage on this device');
    return VIDEO_REF + id;
  });
}

function getFoodVideo (ref) {
  if (!String(ref || '').startsWith(VIDEO_REF)) return Promise.resolve(null);
  let req;
  return photoDbOp('readonly', store => { req = store.get(ref.slice(VIDEO_REF.length)); return req; }, VIDEO_STORE)
    .then(() => (req?.result instanceof Blob ? req.result : null))
    .catch(() => null);
}

const FOOD_MEDIA_MAX = 11;
const FOOD_PHOTO_MAX = 10;

function mergeFoodMedia (existing, added, { notify = true } = {}) {
  const out = [];
  let photos = 0, videos = 0, omitted = 0;
  for (const item of [...existing, ...added]) {
    if (!item?.photo) continue;
    if (item.video ? videos >= 1 : photos >= FOOD_PHOTO_MAX) { omitted++; continue; }
    if (item.video) videos++; else photos++;
    out.push(item);
  }
  if (omitted && notify) showToast('10 photos and one video per moment', 'Some media was not added. Remove an item to make room.', 'info');
  return out;
}

// One picked file to { photo } or { photo: poster, video }, or null.
// Videos are Grizzly; `quiet` skips the upsell (already shown this batch).
async function mediaFromFile (file, { quiet = false } = {}) {
  if (!/^(image|video)\//.test(file.type)) {
    showToast('Unsupported file', 'Choose a photo or a video file.', 'error');
    return null;
  }
  if (!file.type.startsWith('video/')) {
    try { return { photo: await readImageFileCompressed(file, FOOD_PHOTO_MAX_DIM, FOOD_PHOTO_QUALITY) }; }
    catch { showToast('Photo Error', `Could not load ${file.name || 'that image'}.`, 'error'); return null; }
  }
  if (!hasGrizzly()) {
    if (!quiet) { trackProductEvent('video_upsell_shown', {}); showGrizzlyUpsell('video'); }
    return null;
  }
  if (file.size > FOOD_VIDEO_MAX_BYTES) { showToast('Video too big', 'Try a shorter clip (up to 15 seconds).', 'error'); return null; }
  try {
    const { duration, poster } = await readVideoPoster(file);
    if (!Number.isFinite(duration) || duration <= 0) {
      showToast('Could not read video length', 'Choose a clip with a readable duration, up to 15 seconds.', 'error');
      return null;
    }
    if (duration > FOOD_VIDEO_MAX_SECONDS + 0.5) {
      showToast('Keep it to 15 seconds', `That clip is ${Math.round(duration)}s. Trim it in your camera app, then add it again.`, 'info');
      return null;
    }
    if (!poster) throw new Error('No video poster');
    const video = await storeFoodVideo(file);
    trackProductEvent('video_added', { seconds: Math.round(duration) });
    return { photo: poster, video };
  } catch {
    showToast('Video Error', 'Could not read that video. Try one from your camera.', 'error');
    return null;
  }
}

// Photo and video picker, several at a time. Resolves an array (empty if
// nothing usable was picked), at most `max` items.
let _foodMediaJobs = 0;
let _mediaContext = 0;
function foodMediaBusy () { return _foodMediaJobs > 0; }
function invalidateFoodMedia () {
  _mediaContext++;
  document.querySelector('.share-nudge')?.remove();
}

function refreshMediaBusy () {
  const busy = foodMediaBusy();
  document.querySelectorAll('#modal-save-btn, #just-ate-save, .your-order-verdicts button').forEach(btn => {
    btn.disabled = busy;
    btn.setAttribute('aria-busy', String(busy));
  });
  syncJustAteSave();
  window.Cub?.syncSave();
  document.querySelectorAll('.food-capture-actions').forEach(el => {
    el.querySelectorAll('button').forEach(btn => { btn.disabled = busy; });
    el.querySelector('.food-media-status').textContent = busy ? 'Adding media... Please wait before saving.' : '';
  });
}

function addFoodCaptureActions (anchor, onPick, { video = true } = {}) {
  const el = document.createElement('div');
  el.className = 'food-capture-actions';
  el.innerHTML = `<div class="food-capture-buttons">
    <button type="button" class="btn-sm food-capture-btn" data-source="photo"><span aria-hidden="true">📷</span> Take photo</button>
    ${video ? '<button type="button" class="btn-sm food-capture-btn" data-source="video"><span aria-hidden="true">🎥</span> Record video</button>' : ''}
    <button type="button" class="btn-sm food-capture-btn" data-source="library"><span aria-hidden="true">🖼️</span> Choose photos or video</button>
    </div>${video ? '<small class="food-video-limits">Video: Grizzly, up to 15 seconds. Clips stay on this device.</small>' : ''}<span class="food-media-status" role="status"></span>`;
  anchor.insertAdjacentElement('afterend', el);
  el.addEventListener('click', e => {
    const button = e.target.closest('button[data-source]');
    if (button) onPick(button.dataset.source);
  });
  return el;
}

function pickFoodFiles ({ max = FOOD_MEDIA_MAX, source = 'library', accept = 'image/*,video/*' } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = source === 'photo' ? 'image/*' : source === 'video' ? 'video/*' : accept;
    input.multiple = source === 'library' && max > 1;
    if (source !== 'library') input.setAttribute('capture', 'environment');
    input.hidden = true;
    document.body.appendChild(input);
    let settled = false;
    let focusTimer;
    const finish = files => {
      if (settled) return;
      settled = true;
      clearTimeout(focusTimer);
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    const onFocus = () => {
      if (!('oncancel' in input)) focusTimer = setTimeout(() => { if (!input.files?.length) finish([]); }, 1000);
    };
    input.onchange = () => finish([...(input.files || [])]);
    input.addEventListener('cancel', () => finish([]), { once: true });
    window.addEventListener('focus', onFocus);
    try { input.click(); }
    catch (err) {
      console.error('[FTB] Media picker failed:', err);
      showToast('Could not open media picker', 'Allow camera access in device settings, or tap Choose photos or video.', 'error');
      finish([]);
    }
  });
}

async function pickFoodMediaList (max = FOOD_MEDIA_MAX, source = 'library') {
  if (max <= 0) { showToast('Your media collection is full', 'Remove an item to add another.', 'info'); return []; }
  if (source === 'video' && !hasGrizzly()) { showGrizzlyUpsell('video'); return []; }
  if (foodMediaBusy()) return [];
  const context = _mediaContext;
  const generation = _dataGeneration;
  _foodMediaJobs++;
  refreshMediaBusy();
  try {
      const files = await pickFoodFiles({ max, source });
      if (context !== _mediaContext || generation !== _dataGeneration) return [];
      if (files.length > max) showToast(`Up to ${max} at a time`, `Added the first ${max}.`, 'info');
      const out = [];
      let upsold = false;
      for (const file of files.slice(0, max)) {
        const isVideo = file.type.startsWith('video/');
        const m = await mediaFromFile(file, { quiet: upsold });
        if (context !== _mediaContext || generation !== _dataGeneration) return [];
        if (isVideo && !m && !hasGrizzly()) upsold = true;
        if (m) out.push(m);
      }
      if (!files.length && source !== 'library') showToast('No media added', 'If camera access is blocked, allow it in device settings or tap Choose photos or video.', 'info');
      return mergeFoodMedia([], out);
  } finally {
    _foodMediaJobs--;
    refreshMediaBusy();
  }
}

// Single-item picker kept for callers that hold one photo.
async function pickFoodMedia (source = 'library') {
  return (await pickFoodMediaList(1, source))[0] || null;
}

// Every photo/clip on a dish or visit: the main one (photo/video) first,
// then extras in `media`. Older entries simply have no `media`.
function mediaOf (obj) {
  if (!obj) return [];
  const main = obj.photo ? [{ photo: obj.photo, ...(obj.video ? { video: obj.video } : {}) }] : [];
  const extra = Array.isArray(obj.media) ? obj.media.filter(m => m && m.photo) : [];
  return [...main, ...extra];
}

function setMediaOn (obj, list) {
  const items = mergeFoodMedia([], list || []);
  if (items[0]) obj.photo = items[0].photo; else delete obj.photo;
  if (items[0]?.video) obj.video = items[0].video; else delete obj.video;
  if (items.length > 1) obj.media = items.slice(1).map(m => ({ photo: m.photo, ...(m.video ? { video: m.video } : {}) }));
  else delete obj.media;
}

// Small thumbnail strip for media waiting to be saved, each removable.
function pendingMediaHtml (list, hint) {
  return `<div class="pm-strip">${list.map((m, i) => `<span class="pm-item">
      <img src="${escHtml(safeUrl(m.photo))}" alt="" />${m.video ? '<span class="video-badge small" aria-label="Video">▶</span>' : ''}
      <button type="button" class="pm-remove" data-idx="${i}" aria-label="Remove ${m.video ? 'video' : 'photo'} ${i + 1}">✕</button>
    </span>`).join('')}</div>${hint ? `<span class="pm-hint">${escHtml(hint)}</span>` : ''}`;
}

let _videoViewerUrl = '';
async function playFoodVideo (ref, caption = '') {
  const blob = await getFoodVideo(ref);
  if (!blob) { showToast('Video not on this device', 'Videos stay on the phone that recorded them. The photo shows everywhere.', 'info'); return; }
  let viewer = document.getElementById('video-viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'video-viewer';
    viewer.className = 'video-viewer hidden';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Food video');
    viewer.innerHTML = '<button type="button" class="video-viewer-close" aria-label="Close">✕</button><video controls playsinline autoplay loop></video><div class="video-viewer-caption"></div>';
    document.body.appendChild(viewer);
    const close = () => {
      const v = viewer.querySelector('video');
      v.pause(); v.removeAttribute('src'); v.load();
      if (_videoViewerUrl) { URL.revokeObjectURL(_videoViewerUrl); _videoViewerUrl = ''; }
      viewer.classList.add('hidden');
    };
    viewer.querySelector('.video-viewer-close').addEventListener('click', close);
    viewer.addEventListener('click', e => { if (e.target === viewer) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.classList.contains('hidden')) close(); });
  }
  if (_videoViewerUrl) URL.revokeObjectURL(_videoViewerUrl);
  _videoViewerUrl = URL.createObjectURL(blob);
  viewer.querySelector('video').src = _videoViewerUrl;
  viewer.querySelector('.video-viewer-caption').textContent = caption;
  viewer.classList.remove('hidden');
  viewer.querySelector('video').play()?.catch?.(() => {});
}
let _photoDb = null;            // Promise<IDBDatabase|null>
let _photosHydrated = false;    // in-memory photos restored from IndexedDB
const _photoRefCache = new Map(); // data URL -> ref
const _storedPhotoRefs = new Set();
let _saveChain = Promise.resolve();

function openPhotoDb () {
  if (_photoDb) return _photoDb;
  _photoDb = new Promise(resolve => {
    try {
      const req = indexedDB.open(PHOTO_DB, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
        if (!db.objectStoreNames.contains(VIDEO_STORE)) db.createObjectStore(VIDEO_STORE);
        if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts');
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); _photoDb = null; };
        _photoDbReady = true;
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return _photoDb;
}

function photoDbOp (mode, fn, storeName = PHOTO_STORE) {
  return openPhotoDb().then(db => db && new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const out = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(out?.result ?? true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// Two 32-bit FNV-1a passes with different seeds: a 64-bit content key.
function photoRefFor (dataUrl) {
  let ref = _photoRefCache.get(dataUrl);
  if (ref) return ref;
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ dataUrl.length;
  for (let i = 0; i < dataUrl.length; i++) {
    const c = dataUrl.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  ref = `${PHOTO_REF}${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
  _photoRefCache.set(dataUrl, ref);
  return ref;
}

// The saved copy of the list, plus any photos that still need writing.
function serializeRestaurants (offload, restaurants = state.restaurants) {
  const pending = new Map();
  const json = JSON.stringify(restaurants, (key, value) => {
    if (offload && key === 'photo' && typeof value === 'string' && value.startsWith('data:image/')) {
      const ref = photoRefFor(value);
      if (!_storedPhotoRefs.has(ref)) pending.set(ref, value);
      return ref;
    }
    return value;
  });
  return { json, pending };
}

function writeRestaurantsToLocalStorage (json) {
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch (err) {
    console.error('[FTB] saveData failed:', err);
    showToast('Storage Full', 'Could not save — device storage is full. Try removing large photos from entries.', 'error');
  }
}

async function persistRestaurants (generation = _dataGeneration) {
  const db = await openPhotoDb();
  if (generation !== _dataGeneration || window._ftbAccountSwitching) return;
  // Until stored photos are back in memory, the list still holds references;
  // saving them as-is is fine, but new data URLs must be offloaded too.
  const { json, pending } = serializeRestaurants(!!db);
  if (db && pending.size) {
    try {
      await photoDbOp('readwrite', store => pending.forEach((v, k) => store.put(v, k)));
      pending.forEach((_, k) => _storedPhotoRefs.add(k));
    } catch (err) {
      console.warn('[FTB] photo store write failed, keeping photos inline:', err);
      if (generation === _dataGeneration && !window._ftbAccountSwitching) writeRestaurantsToLocalStorage(serializeRestaurants(false).json);
      return;
    }
  }
  if (generation === _dataGeneration && !window._ftbAccountSwitching) writeRestaurantsToLocalStorage(json);
}

// Put stored photos back into the in-memory restaurants.
async function hydrateStoredPhotos () {
  const generation = _dataGeneration;
  const db = await openPhotoDb(); // also lets later saves offload photos
  if (generation !== _dataGeneration) return;
  const holders = [];
  const visit = obj => {
    if (obj && typeof obj.photo === 'string' && obj.photo.startsWith(PHOTO_REF)) holders.push(obj);
    (Array.isArray(obj?.media) ? obj.media : []).forEach(m => { if (typeof m?.photo === 'string' && m.photo.startsWith(PHOTO_REF)) holders.push(m); });
  };
  (state.restaurants || []).forEach(r => {
    visit(r);
    (r.visits || []).forEach(visit);
    (r.dishes || []).forEach(visit);
  });
  if (!holders.length || !db) { _photosHydrated = true; return; }
  _photosHydrated = false; // e.g. a sign-in merge brought references back; hold sync
  const refs = [...new Set(holders.map(h => h.photo))];
  const found = new Map();
  try {
    await photoDbOp('readonly', store => refs.forEach(ref => {
      const req = store.get(ref);
      req.onsuccess = () => { if (typeof req.result === 'string') found.set(ref, req.result); };
    }));
  } catch (err) {
    console.warn('[FTB] photo store read failed:', err);
  }
  if (generation !== _dataGeneration) return;
  holders.forEach(h => {
    const data = found.get(h.photo);
    if (data) {
      _storedPhotoRefs.add(h.photo);
      _photoRefCache.set(data, h.photo);
      h.photo = data;
    }
  });
  _photosHydrated = true;
  renderAll();
}

function photosReadyForSync () { return _photosHydrated; }

let _photoDbReady = false;
let _queuedSaves = 0;
let _dataGeneration = 0;

const ACCOUNT_LOCAL_KEYS = [
  STORAGE_KEY, SETTINGS_KEY, USER_KEY, 'ftb_deleted_v1', 'ftb_dishes_v1', 'ftb_menu_notes_v1',
  'ftb_dishes_merged_v1', 'ftb_friends_v1', 'ftb_friends_at_v1', 'ftb_friends_uid_v1',
  'ftb_invites_sent_v1', 'ftb_invite_code_v1', 'ftb_follow_noted_v1', 'ftb_followed_back_v1',
  'ftb_cub_chats_v1', 'ftb_cub_ask_skip_v1', 'ftb_waiting_spot_v1', SWIPE_PREFS_KEY,
  'ftb_bear_swipe_v2', DAILY_QUEST_KEY, 'ftb_challenges_v1', 'ftb_reminders', 'ftb_travel_v1',
  'ftb_crave_alerts_v1', 'ftb_near_alerts_v1', 'ftb_dinner_votes_v1', 'ftb_area_sent_v1',
  'ftb_collab_id_v1',
];
const APPEARANCE_KEYS = ['theme', 'themeChoice', 'themeManual', 'uiDensity', 'uiCorners', 'uiMotion',
  'onboardingDone', 'profileSetupDone', 'locationBannerDismissed', 'locationEnabled'];
// Belong to the phone, not the account: switching accounts never asks for location again.
const DEVICE_SETTING_KEYS = ['locationEnabled', 'locationBannerDismissed'];

function deviceAppearance () {
  let settings;
  try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch (err) {
    console.warn('[FTB] Saved appearance could not be read:', err);
    showToast('Settings need attention', 'Saved appearance settings could not be read. Your diary has not been deleted.', 'error');
    return {};
  }
  if (!settings || typeof settings !== 'object') return {};
  return Object.fromEntries(APPEARANCE_KEYS.filter(k => k in settings).map(k => [k, settings[k]]));
}

function captureAccountData () {
  flushDetailNotes();
  const owner = localStorage.getItem('ftb_data_owner_v1') || localStorage.getItem('ftb_uid_v1') || '';
  const legacy = !owner && !!localStorage.getItem('ftb_last_account_v1') && window._ftbDataOwner === undefined;
  const snapshotOwner = owner || (legacy ? `legacy:${localStorage.getItem('ftb_last_account_v1').trim().toLowerCase()}` : '');
  const snapshot = Object.fromEntries(ACCOUNT_LOCAL_KEYS.map(k => [k, localStorage.getItem(k)]));
  const diskSnapshot = { ...snapshot };
  if (window._ftbDataOwner === owner) {
    snapshot[STORAGE_KEY] = serializeRestaurants(false).json;
    snapshot[SETTINGS_KEY] = JSON.stringify(state.settings);
  }
  const appearance = deviceAppearance();
  return { owner, snapshotOwner, snapshot, diskSnapshot, appearance };
}

function clearAccountUI (appearance) {
  _dataGeneration++;
  Object.keys(sessionStorage).filter(k => k.startsWith('ftb_airec_') || k === 'ftb_owner_handoff')
    .forEach(k => sessionStorage.removeItem(k));
  window._ftbAccountSwitching = true;
  window._ftbDataOwner = null;
  state.restaurants = [];
  state.settings = appearance;
  state.detailId = state.editingId = null;
  state.dinnerRooms = {};
  state.activeDinnerRoomCode = '';
  state.swipeDeck = []; state.swipeLikes = [];
  state.selectedIds.clear();
  state.bulkMode = false;
  state.filter = { search: '', cuisine: '', price: '', sort: 'date-desc', tag: '', collection: '' };
  window.resetFriendsSession?.();
  setYourOrderPending([]);
  CubChats.resetSession();
  closeChat();
  _aiHistory.length = 0;
  document.getElementById('ai-chat-history')?.replaceChildren();
  setFormMedia([]);
  closeJustAte();
  window.Cub?.resetSession();
  window.StoryCard?.close();
  document.querySelector('#video-viewer .video-viewer-close')?.click();
  document.querySelectorAll('[role="dialog"]:not(#auth-overlay), .share-nudge, .photo-reveal, #save-diary-nudge')
    .forEach(el => el.classList.add('hidden'));
  updateProfileVisuals({ name: 'Foodie', avatar: DEFAULT_AVATAR });
  renderAll();
  NativeAlerts?.clear();
}

async function switchAccountData (uid, isCurrent, captured = captureAccountData(), email = '') {
  const { owner, snapshotOwner, snapshot, diskSnapshot, appearance } = captured;

  if (snapshotOwner) {
    const stored = await photoDbOp('readwrite', store => store.put(snapshot, snapshotOwner), 'accounts');
    if (!stored) throw new Error('Device storage is unavailable. Your saved diary was kept; reload to try again.');
  }
  if (!isCurrent()) return;
  let restored = uid && uid === owner ? snapshot : null;
  if (uid && uid !== owner) {
    let request;
    await photoDbOp('readonly', store => { request = store.get(uid); return request; }, 'accounts');
    restored = request?.result || null;
  }
  if (uid && !restored && email) {
    const legacyKey = `legacy:${email.trim().toLowerCase()}`;
    let request;
    await photoDbOp('readonly', store => { request = store.get(legacyKey); return request; }, 'accounts');
    restored = request?.result || null;
    if (restored && isCurrent()) {
      const saved = await photoDbOp('readwrite', store => { store.put(restored, uid); return store.delete(legacyKey); }, 'accounts');
      if (!saved) throw new Error('Could not migrate your saved diary. Reload to try again.');
    }
  }
  if (!isCurrent()) return;
  // Only a never-signed-in guest diary may be adopted by a new account.
  if (uid && !snapshotOwner && !restored && !localStorage.getItem('ftb_last_account_v1')) restored = snapshot;
  if (restored?.[STORAGE_KEY] && await openPhotoDb()) {
    const { json, pending } = serializeRestaurants(true, JSON.parse(restored[STORAGE_KEY]));
    if (pending.size) {
      await photoDbOp('readwrite', store => pending.forEach((value, ref) => store.put(value, ref)));
      pending.forEach((_, ref) => _storedPhotoRefs.add(ref));
    }
    restored = { ...restored, [STORAGE_KEY]: json };
  }
  if (!isCurrent()) return;
  const diskOwner = localStorage.getItem('ftb_data_owner_v1');
  try {
    ACCOUNT_LOCAL_KEYS.forEach(k => localStorage.removeItem(k));
    if (restored) Object.entries(restored).forEach(([k, value]) => { if (ACCOUNT_LOCAL_KEYS.includes(k) && value !== null) localStorage.setItem(k, value); });
    if (!restored) localStorage.setItem(SETTINGS_KEY, JSON.stringify(appearance));
    else {
      let s = {};
      try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { s = {}; }
      DEVICE_SETTING_KEYS.forEach(k => { if (k in appearance) s[k] = appearance[k]; });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    }
    localStorage.setItem('ftb_data_owner_v1', uid || '');
  } catch (err) {
    ACCOUNT_LOCAL_KEYS.forEach(k => localStorage.removeItem(k));
    Object.entries(diskSnapshot).forEach(([k, value]) => { if (value !== null) localStorage.setItem(k, value); });
    if (diskOwner === null) localStorage.removeItem('ftb_data_owner_v1');
    else localStorage.setItem('ftb_data_owner_v1', diskOwner);
    throw err;
  }
  window._ftbUid = uid || null;
  window._ftbDataOwner = uid || '';
  window._ftbAccountSwitching = false;
  window.resetFriendsSession?.();
  loadData();
  updateProfileVisuals(loadUserProfile() || { name: 'Foodie', avatar: DEFAULT_AVATAR });
  renderAll();
  // Sign-in has settled: a returning user whose avatar picker opened before
  // auth resolved goes to the diary; a genuine new user gets the picker.
  if (typeof recheckProfileSetup === 'function') recheckProfileSetup();
}

// Map tags saved from Discover ("steak_house", "mexican;pizza", "regional") read like a person wrote them.
function tidyCuisine (raw) {
  const s = String(raw ?? '').trim();
  if (!/[_;]/.test(s) && !/^[a-z]/.test(s) && !/^(regional|yes|restaurant)$/i.test(s)) return s;
  const first = s.split(';')[0].replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (['regional', 'yes', 'restaurant', 'food'].includes(first)) return '';
  return ({ 'steak house': 'steakhouse', 'coffee shop': 'coffee' }[first] || first).replace(/\b\w/g, c => c.toUpperCase());
}
function tidyCuisines () {
  let changed = false;
  (state.restaurants || []).forEach(r => { if (r && r.cuisine) { const c = tidyCuisine(r.cuisine); if (c !== r.cuisine) { r.cuisine = c; changed = true; } } });
  return changed;
}

function saveData () {
  if (window._ftbAccountSwitching) return;
  tidyCuisines();
  // Most saves have no new photo: write now, as before. A save with a new
  // photo, or any save while one is queued, goes through the chain in order
  // (each run re-reads the latest state).
  const { json, pending } = serializeRestaurants(_photoDbReady);
  if (!pending.size && !_queuedSaves) {
    writeRestaurantsToLocalStorage(json);
  } else {
    _queuedSaves++;
    const generation = _dataGeneration;
    const persist = () => persistRestaurants(generation);
    _saveChain = _saveChain.then(persist, persist).finally(() => { _queuedSaves--; });
  }
  updateTagSuggestions();
  NativeAlerts?.schedule();
  window.ftbAfterSave?.();
  setTimeout(checkAchievements, 0);
  setTimeout(renderWeeklyGoal, 0);
  setTimeout(maybeAskToSaveDiary, 1800);
  // Sync to Firestore if user is signed in (debounced)
  if (typeof fbDebouncedSync === 'function') fbDebouncedSync();
}

// Once someone has a few spots, offer a free account so the diary isn't
// stuck on one phone. Only right after they add a spot, at most every 5 days,
// and never again after three "Not now"s.
const SAVE_NUDGE_KEY = 'ftb_save_nudge_v1';
const SAVE_NUDGE_MIN_SPOTS = 3;
const SAVE_NUDGE_GAP = 5 * 86400000;
let _saveNudgeCount = null;
let _saveNudgeShown = false;

function getSaveNudgeLog () {
  try { return JSON.parse(localStorage.getItem(SAVE_NUDGE_KEY) || '{}') || {}; } catch { return {}; }
}

function noteSaveNudge (dismissed) {
  const log = getSaveNudgeLog();
  log.at = Date.now();
  if (dismissed) log.dismissed = (log.dismissed || 0) + 1;
  try { localStorage.setItem(SAVE_NUDGE_KEY, JSON.stringify(log)); } catch { /* private mode */ }
}

function maybeAskToSaveDiary () {
  const count = (state.restaurants || []).length;
  const grew = _saveNudgeCount !== null && count > _saveNudgeCount;
  _saveNudgeCount = count;
  if (!grew || _saveNudgeShown || count < SAVE_NUDGE_MIN_SPOTS) return;
  if (!window._ftbAuthReady || window._ftbUid || typeof openAuthModal !== 'function') return;
  if (document.body.classList.contains('overlay-open')) return;
  const welcome = document.getElementById('cub-welcome');
  if (welcome && !welcome.classList.contains('hidden')) return;
  const log = getSaveNudgeLog();
  if ((log.dismissed || 0) >= 3 || Date.now() - (log.at || 0) < SAVE_NUDGE_GAP) return;

  _saveNudgeShown = true;
  noteSaveNudge(false);
  let returning = false;
  try { returning = !!localStorage.getItem('ftb_uid_v1'); } catch { /* private mode */ }
  const card = document.createElement('div');
  card.id = 'save-diary-nudge';
  card.className = 'save-diary-nudge';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'save-diary-title');
  card.innerHTML = `
    <div class="sdn-icon" aria-hidden="true">🐻</div>
    <div class="sdn-body">
      <strong id="save-diary-title">Don't lose your ${count} spots</strong>
      <span>Right now they only live on this phone. ${returning ? 'Sign back in' : 'Make a free account'} and they're backed up for good.</span>
      <div class="sdn-actions">
        <button type="button" class="btn-primary btn-sm sdn-save">${returning ? 'Sign in' : 'Save my diary'}</button>
        <button type="button" class="btn-ghost btn-sm sdn-later">Not now</button>
      </div>
    </div>`;
  document.body.appendChild(card);
  if (typeof trackProductEvent === 'function') trackProductEvent('save_nudge_shown');
  const close = () => card.remove();
  card.querySelector('.sdn-save').addEventListener('click', () => {
    close();
    if (typeof trackProductEvent === 'function') trackProductEvent('save_nudge_accepted');
    openAuthModal();
    if (!returning && typeof _setAuthMode === 'function') _setAuthMode('signup');
  });
  card.querySelector('.sdn-later').addEventListener('click', () => { noteSaveNudge(true); close(); });
}

/* Read an image file as a data URL, downscaled/compressed so a single phone
   photo can't blow past the ~5 MB localStorage quota. */
// Food photos are stored as data URLs on the restaurant, so keep them light
// (about 60-90 KB): browser storage is ~5 MB and a synced doc caps at 1 MB.
const FOOD_PHOTO_MAX_DIM = 800;
const FOOD_PHOTO_QUALITY = 0.7;

// Opens the camera/library picker and resolves with a compressed data URL,
// or '' if nothing was picked. No `capture` attribute, so phones offer both
// "Take Photo" and "Photo Library".
async function pickFoodPhoto (source = 'library') {
  const media = await pickFoodMedia(source);
  return media?.photo || '';
}

function readImageFileCompressed (file, maxDim = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = ev => {
      const img = new Image();
      img.onerror = () => reject(new Error('Not a valid image'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { reject(e); }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Tombstones for deleted restaurants so cloud sync can't resurrect them
   and deletions propagate to Firestore. */
const DELETED_IDS_KEY = 'ftb_deleted_v1';
function getDeletedRestaurantIds () {
  try { return JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]') || []; } catch { return []; }
}
function recordRestaurantDeletion (ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return;
  try {
    const cur = new Set(getDeletedRestaurantIds());
    list.forEach(id => cur.add(id));
    localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...cur].slice(-500)));
  } catch { /* non-fatal */ }
  if (typeof fbDeleteRestaurantsCloud === 'function' && window._ftbUid) {
    fbDeleteRestaurantsCloud(window._ftbUid, list);
  }
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
  queueUsageCount(name);
}

// Event counts (names only, no payloads) go to /api/track so usage is
// visible somewhere other than each phone. Batched, and flushed with
// sendBeacon when the page is hidden so closing the app doesn't lose them.
let _usageCounts = {};
let _usageFlushTimer = null;
const USAGE_REPORTING = !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.protocol === 'https:';

function queueUsageCount (name) {
  if (!USAGE_REPORTING || !/^[a-z][a-z0-9_]{2,47}$/.test(name)) return;
  _usageCounts[name] = (_usageCounts[name] || 0) + 1;
  clearTimeout(_usageFlushTimer);
  _usageFlushTimer = setTimeout(flushUsageCounts, 20000);
}

// GET one of our paid lookups (place info, photos), signed in (api/_guard.js).
async function apiGet (url) {
  const headers = typeof ftbApiHeaders === 'function' ? await ftbApiHeaders() : {};
  return fetch(url, { headers });
}

function flushUsageCounts () {
  clearTimeout(_usageFlushTimer);
  if (!Object.keys(_usageCounts).length) return;
  const body = JSON.stringify({ counts: _usageCounts });
  _usageCounts = {};
  try {
    if (!navigator.sendBeacon?.('/api/track', body)) {
      fetch('/api/track', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* best effort */ }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUsageCounts(); });

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
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
// Local calendar date (YYYY-MM-DD). toISOString() is UTC, which in the US
// stamped evening dinners with tomorrow's date.
function iso (offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
// Illustrated bear avatars, drawn as inline SVG so they look the same on every
// phone. Profiles saved before these existed hold short text codes ('FTB',
// 'CHEF', ...); normalizeAvatar maps those to a bear.
const BEAR_AVATARS = {
  'bear-chef':   { fur: '#9a6236', ear: '#d9a36f', muzzle: '#f1d2a8', bg: '#7a4f2c', acc: 'chef' },
  'bear-crown':  { fur: '#c98a4b', ear: '#f0c18a', muzzle: '#f7e1bf', bg: '#5b3f8c', acc: 'crown' },
  'bear-shades': { fur: '#6b4a2e', ear: '#a8784e', muzzle: '#e2c29b', bg: '#d76b3f', acc: 'shades' },
  'bear-pizza':  { fur: '#8b5a2b', ear: '#c79262', muzzle: '#efcfa3', bg: '#c84b3c', acc: 'pizza' },
  'bear-donut':  { fur: '#c98a4b', ear: '#f0c18a', muzzle: '#f7e1bf', bg: '#3e7fa3', acc: 'donut' },
  'bear-taco':   { fur: '#6b4a2e', ear: '#a8784e', muzzle: '#e2c29b', bg: '#e2a93b', acc: 'taco' },
  'bear-bow':    { fur: '#b07a4a', ear: '#e6b384', muzzle: '#f5dcb8', bg: '#e48aa6', acc: 'bow' },
  'bear-beanie': { fur: '#3b2f2a', ear: '#6e5a4f', muzzle: '#c9a98a', bg: '#4f8a5b', acc: 'beanie' },
  'bear-phones': { fur: '#8b5a2b', ear: '#c79262', muzzle: '#efcfa3', bg: '#22313f', acc: 'phones' },
  'bear-party':  { fur: '#c98a4b', ear: '#f0c18a', muzzle: '#f7e1bf', bg: '#7a4fb0', acc: 'party' },
  'panda':       { fur: '#f4f1ec', ear: '#2b2b2b', muzzle: '#ffffff', bg: '#6aa26b', acc: 'panda' },
  'polar':       { fur: '#f3eee6', ear: '#d9cfc1', muzzle: '#ffffff', bg: '#4a90b8', acc: 'scarf' },
};
// Photo bears eating, in the logo's style (assets/avatars, made with Gemini).
const PHOTO_AVATARS = ['tacos', 'pizza', 'burger', 'sushi', 'ramen', 'bbq', 'donut', 'icecream', 'pancakes', 'hotdog', 'wings', 'honey', 'popcorn', 'croissant', 'salmon', 'birthday'];
const photoAvatarSrc = id => `assets/avatars/bear-${String(id).slice(4)}.jpg`;
const AVATAR_OPTIONS = [...PHOTO_AVATARS.map(f => `pic-${f}`), ...Object.keys(BEAR_AVATARS)];
const DEFAULT_AVATAR = 'bear-chef';
const LEGACY_AVATARS = { FTB: 'bear-chef', VIP: 'bear-crown', DINE: 'bear-pizza', CHEF: 'bear-chef', TABLE: 'bear-taco', CITY: 'bear-shades', DATE: 'bear-bow', GOLD: 'bear-crown', CLUB: 'bear-party', FINE: 'bear-donut', PLUS: 'bear-beanie', NYX: 'bear-phones' };

function normalizeAvatar (id) {
  if (BEAR_AVATARS[id]) return id;
  if (typeof id === 'string' && id.startsWith('pic-') && PHOTO_AVATARS.includes(id.slice(4))) return id;
  return LEGACY_AVATARS[id] || DEFAULT_AVATAR;
}

// Extras drawn over the face; panda patches go under the eyes instead.
function bearAccessory (a) {
  switch (a.acc) {
    case 'chef': return '<path d="M19 15h26v7H19z" fill="#fff"/><circle cx="23" cy="11" r="6" fill="#fff"/><circle cx="32" cy="8" r="7" fill="#fff"/><circle cx="41" cy="11" r="6" fill="#fff"/><path d="M19 20h26" stroke="#e3e3e3" stroke-width="1.5"/>';
    case 'crown': return '<path d="M20 17l3-10 5 6 4-8 4 8 5-6 3 10z" fill="#f2c23a" stroke="#c9952a" stroke-width="1"/><circle cx="32" cy="7" r="1.6" fill="#e2574c"/>';
    case 'shades': return '<rect x="18" y="27" width="12" height="7" rx="3" fill="#1b1b1b"/><rect x="34" y="27" width="12" height="7" rx="3" fill="#1b1b1b"/><path d="M30 29.5h4" stroke="#1b1b1b" stroke-width="2"/><path d="M20 29l3-1" stroke="#fff" stroke-width="1" opacity=".6"/>';
    case 'pizza': return '<path d="M46 60l11-19c-6-3-13-3-19 0z" fill="#f2c56b"/><path d="M38 41c6-3 13-3 19 0l-1.5 2.5c-5-2.4-11-2.4-16 0z" fill="#c98a4b"/><circle cx="47" cy="47" r="2" fill="#c84b3c"/><circle cx="50" cy="52" r="1.6" fill="#c84b3c"/><circle cx="44" cy="51" r="1.4" fill="#c84b3c"/>';
    case 'donut': return `<circle cx="50" cy="51" r="9" fill="#e7a45a"/><circle cx="50" cy="51" r="7" fill="#f08fb0"/><circle cx="50" cy="51" r="2.6" fill="${a.bg}"/><path d="M46 47l1 1M53 47l-1 1.5M54 53l-1.5-.5M47 55l1-1" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`;
    case 'taco': return '<path d="M38 58a11 11 0 0 1 22 0z" fill="#f2c56b"/><path d="M40 57c2-4 5-6 9-6s7 2 9 6" fill="none" stroke="#5aa346" stroke-width="2.4"/><circle cx="45" cy="54" r="1.3" fill="#d84a3a"/><circle cx="52" cy="53" r="1.3" fill="#d84a3a"/>';
    case 'bow': return '<path d="M47 13l-7-5v10z" fill="#e2457a"/><path d="M47 13l7-5v10z" fill="#e2457a"/><circle cx="47" cy="13" r="2.4" fill="#c22e62"/>';
    case 'beanie': return '<path d="M13 26a19 16 0 0 1 38 0z" fill="#e2574c"/><rect x="12" y="23" width="40" height="6" rx="3" fill="#c23f36"/><circle cx="32" cy="9" r="4" fill="#fff"/>';
    case 'phones': return '<path d="M12 33a20 20 0 0 1 40 0" fill="none" stroke="#1f1f1f" stroke-width="4"/><rect x="8" y="30" width="8" height="12" rx="3" fill="#e2574c"/><rect x="48" y="30" width="8" height="12" rx="3" fill="#e2574c"/>';
    case 'party': return '<path d="M32 2l8 17H24z" fill="#f2c23a"/><path d="M28 10l7 4M26 15l11 3" stroke="#e2457a" stroke-width="2"/><circle cx="32" cy="2.5" r="2.4" fill="#4fb3e8"/>';
    case 'scarf': return '<path d="M14 50c10 5 26 5 36 0v6c-10 5-26 5-36 0z" fill="#e2574c"/><path d="M40 54l3 9h-6z" fill="#c23f36"/>';
    default: return '';
  }
}

function avatarSvg (id) {
  const key = normalizeAvatar(id);
  if (key.startsWith('pic-')) return `<img class="bear-avatar bear-avatar-pic" src="${photoAvatarSrc(key)}" alt="Bear avatar" loading="lazy" decoding="async" />`;
  const a = BEAR_AVATARS[key];
  const dark = '#2a1d16';
  const panda = a.acc === 'panda';
  const earOuter = panda ? a.ear : a.fur;
  const earInner = panda ? '#444' : a.ear;
  const patches = panda
    ? '<ellipse cx="24.5" cy="31.5" rx="5" ry="4.2" fill="#2b2b2b" transform="rotate(-20 24.5 31.5)"/><ellipse cx="39.5" cy="31.5" rx="5" ry="4.2" fill="#2b2b2b" transform="rotate(20 39.5 31.5)"/>'
    : '';
  return `<svg class="bear-avatar" viewBox="0 0 64 64" role="img" aria-label="Bear avatar"><circle cx="32" cy="32" r="32" fill="${a.bg}"/>`
    + `<circle cx="17" cy="20" r="8.5" fill="${earOuter}"/><circle cx="47" cy="20" r="8.5" fill="${earOuter}"/>`
    + `<circle cx="17" cy="20" r="4.2" fill="${earInner}"/><circle cx="47" cy="20" r="4.2" fill="${earInner}"/>`
    + `<circle cx="32" cy="35" r="20" fill="${a.fur}"/>${patches}`
    + `<ellipse cx="32" cy="42.5" rx="10" ry="7.5" fill="${a.muzzle}"/>`
    + `<circle cx="24.5" cy="31" r="3" fill="#fff"/><circle cx="39.5" cy="31" r="3" fill="#fff"/><circle cx="25" cy="31.5" r="1.9" fill="${dark}"/><circle cx="40" cy="31.5" r="1.9" fill="${dark}"/>`
    + `<circle cx="20" cy="39" r="2.6" fill="#f08a8a" opacity=".45"/><circle cx="44" cy="39" r="2.6" fill="#f08a8a" opacity=".45"/>`
    + `<ellipse cx="32" cy="39" rx="3.6" ry="2.6" fill="${dark}"/><path d="M28.5 44.5q3.5 3 7 0" fill="none" stroke="${dark}" stroke-width="1.6" stroke-linecap="round"/>`
    + `${bearAccessory(a)}</svg>`;
}

function renderAvatarInto (el, id) {
  if (el) el.innerHTML = avatarSvg(id);
}
const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const THEME_PRESETS = {
  dark:     { mode: 'dark',  accent: 'midnight' },
  light:    { mode: 'light', accent: 'honey' },
  forest:   { mode: 'dark',  accent: 'forest' },
  ocean:    { mode: 'dark',  accent: 'ocean' },
  sunset:   { mode: 'dark',  accent: 'sunset' },
  midnight: { mode: 'dark',  accent: 'midnight' },
  berry:    { mode: 'dark',  accent: 'berry' },
  mint:     { mode: 'light', accent: 'mint' },
  neon:     { mode: 'dark',  accent: 'neon' },
};
const UI_DENSITY = new Set(['cozy', 'compact']);
const UI_CORNERS = new Set(['rounded', 'sharp']);
const UI_MOTION = new Set(['playful', 'reduced']);

function loadUserProfile () {
  if (window._ftbAccountSwitching) return null;
  const owner = localStorage.getItem('ftb_data_owner_v1') || localStorage.getItem('ftb_uid_v1');
  // Before sign-in resolves the uid is still unknown: don't treat the saved
  // profile as someone else's just because we don't know who is signed in
  // yet. Once auth settles the uid is set (or null) and the check applies.
  if (owner && window._ftbUid !== undefined && owner !== window._ftbUid) return null;
  try {
    const profile = JSON.parse(localStorage.getItem(USER_KEY)) || null;
    if (!profile) return null;
    if (profile.avatar === '') profile.avatar = DEFAULT_AVATAR;
    return profile;
  } catch {
    return null;
  }
}
function saveUserProfile (profile, { fromCloud = false } = {}) {
  if (window._ftbAccountSwitching) return;
  const saved = fromCloud ? profile : { ...profile, updatedAt: Date.now() };
  localStorage.setItem(USER_KEY, JSON.stringify(saved));
  if (!fromCloud && window._ftbUid && typeof fbSaveProfileCloud === 'function') {
    fbSaveProfileCloud(window._ftbUid, saved);
  }
}

function persistAppearanceProfile () {
  const base = loadUserProfile() || { name: 'Foodie', avatar: DEFAULT_AVATAR, joinDate: iso() };
  const appearance = {
    themeChoice: state.settings.themeChoice || 'dark',
    themeMode: state.settings.theme || 'dark',
    themeManual: state.settings.themeManual === true,
    uiDensity: UI_DENSITY.has(state.settings.uiDensity) ? state.settings.uiDensity : 'cozy',
    uiCorners: UI_CORNERS.has(state.settings.uiCorners) ? state.settings.uiCorners : 'rounded',
    uiMotion: UI_MOTION.has(state.settings.uiMotion) ? state.settings.uiMotion : 'playful',
  };
  saveUserProfile({ ...base, visualUpdatedAt: base.visualUpdatedAt ?? base.updatedAt ?? 0, appearance });
}

// Re-decide the profile setup once sign-in has settled. A returning user
// whose picker opened before auth resolved is sent to the diary; a genuine
// new user is shown the picker. Never re-opens the picker while it is
// already open, so what the user typed isn't wiped. The picker is only
// offered on the first decision of the session (a fresh open) — an account
// switch later must not pop it open.
let _profileSetupDecided = false;
function recheckProfileSetup (openIfMissing = true) {
  const overlay = document.getElementById('profile-setup-overlay');
  const profile = loadUserProfile();
  if (profile) {
    if (overlay) overlay.classList.add('hidden');
    updateProfileVisuals(profile);
    _profileSetupDecided = true;
    return;
  }
  if (!openIfMissing) return;
  if (overlay && !overlay.classList.contains('hidden')) { _profileSetupDecided = true; return; }
  // Sign-in hasn't settled yet (returning user, uid still unknown): don't
  // trap them on the avatar picker. Auth re-checks once the account is
  // restored.
  if (!window._ftbAuthReady || window._ftbAccountSwitching || window._ftbUid === undefined) return;
  if (_profileSetupDecided) return;
  _profileSetupDecided = true;
  const ob = document.getElementById('onboarding-overlay');
  if (ob) ob.classList.add('hidden');
  state.settings.onboardingDone = true;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* private mode */ }
  openProfileSetup();
}

function initUserProfile () {
  recheckProfileSetup();
}

function updateHeaderAvatar (emoji) {
  const el = document.getElementById('header-avatar');
  if (!el) return;
  const profile = loadUserProfile() || {};
  if (profile.photo) {
    el.innerHTML = `<img src="${escHtml(profile.photo)}" alt="Profile" class="account-avatar-photo" />`;
  } else {
    renderAvatarInto(el, emoji || profile.avatar);
  }
}

function updateProfileVisuals (profile = null) {
  const p = profile || loadUserProfile() || { avatar: DEFAULT_AVATAR };
  const normalizedAvatar = p.avatar === '' ? DEFAULT_AVATAR : (p.avatar || DEFAULT_AVATAR);

  const accountAvatar = document.getElementById('account-avatar-display');
  if (accountAvatar) {
    if (p.photo) {
      accountAvatar.innerHTML = `<img src="${escHtml(p.photo)}" alt="Profile" class="account-avatar-photo account-avatar-photo-lg" />`;
    } else {
      renderAvatarInto(accountAvatar, normalizedAvatar);
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
  if (choice === 'auto') {
    state.settings.themeManual = false;
    state.settings.themeChoice = 'auto';
    applyAutoThemeByClock({ persist: opts.persist !== false });
    scheduleNextAutoThemeTick();
    if (opts.persist !== false) persistAppearanceProfile();
    return;
  }
  const markManual = opts.manual !== false;
  const shouldPersist = opts.persist !== false;
  const preset = THEME_PRESETS[choice] || THEME_PRESETS.dark;
  document.body.classList.toggle('light-mode', preset.mode === 'light');
  document.body.dataset.themeAccent = preset.accent;
  state.settings.theme = preset.mode;
  state.settings.themeChoice = THEME_PRESETS[choice] ? choice : 'dark';
  if (markManual) state.settings.themeManual = true;
  if (shouldPersist) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    persistAppearanceProfile();
  }
  syncThemeMetaColor();
}

function syncThemeMetaColor () {
  const light = document.body.classList.contains('light-mode');
  document.documentElement.style.colorScheme = light ? 'light' : 'dark';
  const toggle = document.getElementById('theme-toggle-btn');
  if (toggle) {
    const label = light ? 'Switch to dark theme' : 'Switch to light theme';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.setAttribute('aria-pressed', String(!light));
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const background = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  if (background) meta.setAttribute('content', background);
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
  let selected = normalizeAvatar(currentAvatar);
  grid.innerHTML = AVATAR_OPTIONS.map(e =>
    `<button class="avatar-option${e === selected ? ' selected' : ''}" data-emoji="${e}" type="button" aria-label="Choose this bear">${avatarSvg(e)}</button>`
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
  renderAvatarInto(avatarDisplay, chosenAvatar);
  buildAvatarGrid('avatar-emoji-grid', chosenAvatar, emoji => {
    chosenAvatar = emoji;
    const d = document.getElementById('setup-avatar-display');
    renderAvatarInto(d, emoji);
  });
  const nameInput = document.getElementById('setup-name');
  if (nameInput) nameInput.focus();

  const doSave = () => {
    const name = (document.getElementById('setup-name')?.value || '').trim() || 'Foodie';
    const profile = { name, avatar: chosenAvatar, joinDate: new Date().toISOString(), visualUpdatedAt: Date.now() };
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

// The owner's own account sees a way into the owner portal (owner.html; the server checks too).
const OWNER_EMAIL = 'cmc@conniemichelleconsulting.com';
// Opening it from the app hands over this sign-in, so the portal never asks again.
async function openOwnerPortal () {
  try {
    const user = typeof _auth !== 'undefined' ? _auth?.currentUser : null;
    if (user) sessionStorage.setItem('ftb_owner_handoff', JSON.stringify({ token: await user.getIdToken(true), email: user.email, at: Date.now() }));
  } catch { /* the portal can still sign in itself */ }
  location.href = '/owner.html';
}
window.openOwnerPortal = openOwnerPortal;
document.addEventListener('click', e => {
  const link = e.target.closest('#account-owner-row, #settings-owner-row');
  if (!link) return;
  e.preventDefault();
  openOwnerPortal();
});

function openAccountModal () {
  const overlay = document.getElementById('account-overlay');
  if (!overlay) return;
  document.getElementById('account-owner-row')?.classList.toggle('hidden', String(window._ftbUserEmail || '').toLowerCase() !== OWNER_EMAIL);
  // Gifts are sold on the website only (the Android app follows Google Play's billing rules).
  document.getElementById('account-gift-row')?.classList.toggle('hidden', !!window.Capacitor?.isNativePlatform?.());
  const profile = loadUserProfile() || { name: 'Foodie', avatar: DEFAULT_AVATAR, joinDate: new Date().toISOString() };
  const normalizedAvatar = profile.avatar === '' ? DEFAULT_AVATAR : (profile.avatar || DEFAULT_AVATAR);

  const avatarEl = document.getElementById('account-avatar-display');
  const nameEl   = document.getElementById('account-name-display');
  const sinceEl  = document.getElementById('account-since-display');
  const statsEl  = document.getElementById('account-stats-row');

  if (avatarEl) {
    if (profile.photo) {
      avatarEl.innerHTML = `<img src="${escHtml(profile.photo)}" alt="Profile" class="account-avatar-photo account-avatar-photo-lg" />`;
    } else {
      renderAvatarInto(avatarEl, normalizedAvatar);
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
  if (btn('account-nearalerts-row'))    btn('account-nearalerts-row').onclick    = openNearAlerts;
  renderNearAlertsRow();

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

let _profileEditSession = 0;
function openEditProfile () {
  closeAccountModal();
  const overlay = document.getElementById('edit-profile-overlay');
  if (!overlay) return;
  const profile = loadUserProfile() || { name: 'Foodie', avatar: DEFAULT_AVATAR };
  let chosenAvatar = normalizeAvatar(profile.avatar);
  let chosenPhoto = profile.photo || '';
  const generation = _dataGeneration;
  const editSession = ++_profileEditSession;
  const uid = window._ftbUid;
  const isCurrent = () => generation === _dataGeneration && uid === window._ftbUid
    && editSession === _profileEditSession && !window._ftbAccountSwitching;
  let photoBusy = false;
  const saveButton = document.getElementById('edit-profile-save-btn');
  saveButton.disabled = false;
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
      renderAvatarInto(avatarEl, chosenAvatar);
    }
  };

  setEditPhotoState();

  buildAvatarGrid('edit-avatar-grid', chosenAvatar, emoji => {
    chosenAvatar = emoji;
    if (!chosenPhoto) renderAvatarInto(document.getElementById('edit-avatar-display'), emoji);
  });

  const photoInput = document.getElementById('edit-photo-input');
  const photoUploadBtn = document.getElementById('edit-photo-upload-btn');
  const photoRemoveBtn = document.getElementById('edit-photo-remove-btn');

  if (photoUploadBtn && photoInput) {
    photoUploadBtn.onclick = () => photoInput.click();
  }
  if (photoRemoveBtn) {
    photoRemoveBtn.disabled = false;
    photoRemoveBtn.onclick = () => {
      chosenPhoto = '';
      if (photoInput) photoInput.value = '';
      setEditPhotoState();
    };
  }
  if (photoInput) {
    if (photoUploadBtn) photoUploadBtn.disabled = false;
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
      photoBusy = true;
      saveButton.disabled = true;
      if (photoUploadBtn) photoUploadBtn.disabled = true;
      if (photoRemoveBtn) photoRemoveBtn.disabled = true;
      try {
        const dataUrl = await readImageFileCompressed(file, 512, .85);
        if (!isCurrent() || overlay.classList.contains('hidden')) return;
        chosenPhoto = dataUrl;
        setEditPhotoState();
      } catch (err) {
        if (isCurrent()) {
          console.warn('[FTB] Profile photo processing failed:', err);
          showToast('Could not load profile photo', 'Your previous photo is unchanged. Try another image.', 'error');
        }
      } finally {
        photoBusy = false;
        if (isCurrent()) {
          saveButton.disabled = false;
          if (photoUploadBtn) photoUploadBtn.disabled = false;
          if (photoRemoveBtn) photoRemoveBtn.disabled = false;
        }
      }
    };
  }

  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  document.getElementById('edit-profile-save-btn').onclick = () => {
    if (!isCurrent() || photoBusy) return;
    const name = document.getElementById('edit-name').value.trim() || profile.name || 'Foodie';
    const updated = { ...(loadUserProfile() || profile), name, avatar: chosenAvatar, photo: chosenPhoto || '', visualUpdatedAt: Date.now() };
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
  document.getElementById('settings-owner-row')?.classList.toggle('hidden', String(window._ftbUserEmail || '').toLowerCase() !== OWNER_EMAIL);

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
    if (state.settings.themeChoice === 'auto') {
      themeSel.value = 'auto';
    } else {
      themeSel.value = state.settings.themeChoice || (state.settings.theme === 'light' ? 'light' : 'dark');
    }
  }
  if (densitySel) densitySel.value = UI_DENSITY.has(state.settings.uiDensity) ? state.settings.uiDensity : 'cozy';
  if (cornersSel) cornersSel.value = UI_CORNERS.has(state.settings.uiCorners) ? state.settings.uiCorners : 'rounded';
  if (motionSel) motionSel.value = UI_MOTION.has(state.settings.uiMotion) ? state.settings.uiMotion : 'playful';
  if (nearbyRadiusSel) nearbyRadiusSel.value = String(Math.max(1, Math.min(100, Number(state.settings.nearbyRadiusMiles) || 25)));
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
    const nearbyRadius = Math.max(1, Math.min(100, Number(nearbyRadiusSel?.value) || 25));
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
      renderTodayStatusRow();
      // Decision Mode ignores distance without location, so refresh an open shortlist.
      if (!document.getElementById('decision-mode-overlay')?.classList.contains('hidden')) runDecisionMode();
      showToast('Location enabled', 'You\'ll get a nudge when you\'re near spots on your list!', 'success');
      renderNearAlertsRow();
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
      // A fix from the last few minutes is close enough to search nearby.
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, maximumAge: 300000, timeout: 12000 });
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
      // A fix can arrive after the first request timed out; finish turning
      // location on and load nearby places when it does.
      const firstFix = !state.locationEnabled;
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      if (firstFix) {
        state.locationEnabled = true;
        updateLocationBtn();
        hideBanner('location-banner');
        loadHomeDiscovery();
      }
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
  showToast('Location Off', 'Location tracking disabled.', 'info');
  renderNearAlertsRow();
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

// Craving alerts fire at most once a day per spot, remembered across reloads.
const CRAVE_ALERTS_KEY = 'ftb_crave_alerts_v1';
function getCraveAlertLog () {
  try { return JSON.parse(localStorage.getItem(CRAVE_ALERTS_KEY)) || {}; } catch { return {}; }
}

// The closest spot within range that has a dish you've been wanting.
function findNearbyCraving () {
  const today = iso();
  const log = getCraveAlertLog();
  let best = null;
  state.restaurants.forEach(r => {
    if (!isAvailableSpot(r) || !r.lat || !r.lng || log[r.id] === today) return;
    const crave = dishesOf(r).find(d => d.verdict === 'want');
    if (!crave) return;
    const d = haversine(state.userLat, state.userLng, r.lat, r.lng);
    if (d <= NOTIFY_RADIUS && (!best || d < best.d)) best = { r, crave, d };
  });
  return best;
}

// When each spot last alerted (or was dismissed). Kept across app opens, so
// a place you live near doesn't pop up every time you open the app.
const NEAR_ALERTS_KEY = 'ftb_near_alerts_v1';
function getNearAlertLog () {
  try { return JSON.parse(localStorage.getItem(NEAR_ALERTS_KEY)) || {}; } catch { return {}; }
}
function noteNearAlert (id, until) {
  const log = getNearAlertLog();
  log[id] = until;
  try { localStorage.setItem(NEAR_ALERTS_KEY, JSON.stringify(log)); } catch { /* storage full */ }
}

// Nearby alerts are on unless switched off in My Account.
function nearAlertsOn () {
  return state.settings.nearAlerts !== false;
}

// How far away a Want to Try spot can be and still alert, chosen in My
// Account. Visited spots and cravings stay at NOTIFY_RADIUS.
const NEAR_ALERT_MILES = [1, 5, 10, 25, 50];
const NEAR_ALERT_DEFAULT_MILES = 10;
const NEAR_ALERT_GAP = 30 * 60 * 1000; // a wide radius holds many spots: one alert per half hour
function nearAlertMiles () {
  const m = Number(state.settings.nearAlertMiles);
  return NEAR_ALERT_MILES.includes(m) ? m : NEAR_ALERT_DEFAULT_MILES;
}

function checkProximity () {
  if (!state.locationEnabled || !nearAlertsOn()) return;
  const now = Date.now();
  const craving = findNearbyCraving();
  if (craving) {
    const log = getCraveAlertLog();
    log[craving.r.id] = iso();
    try { localStorage.setItem(CRAVE_ALERTS_KEY, JSON.stringify(log)); } catch { /* storage full */ }
    state.notifiedAt[craving.r.id] = now;
    showProximityAlert(craving.r, craving.d, craving.crave);
    sendBrowserNotification(craving.r, craving.d, craving.crave);
    trackProductEvent('craving_alert_shown', { restaurantId: craving.r.id, meters: Math.round(craving.d) });
  }
  if (craving) return;
  // Otherwise at most one alert: the closest saved spot that isn't resting.
  // A Want to Try spot always wins over a place you have already been.
  const quietUntil = getNearAlertLog();
  if ((quietUntil._last || 0) > now - NEAR_ALERT_GAP) return;
  const wantRadius = nearAlertMiles() * 1609.344;
  let near = null;
  const better = (a, b) => !b || (a.want !== b.want ? a.want : a.d < b.d);
  state.restaurants.forEach(r => {
    if (!isAvailableSpot(r) || !r.lat || !r.lng || (quietUntil[r.id] || 0) > now || (state.notifiedAt[r.id] || 0) > now - NOTIFY_COOLDOWN) return;
    const d = haversine(state.userLat, state.userLng, r.lat, r.lng);
    const cand = { r, d, want: r.status === 'want-to-try' };
    if (d <= (cand.want ? wantRadius : NOTIFY_RADIUS) && better(cand, near)) near = cand;
  });
  if (!near) return;
  state.notifiedAt[near.r.id] = now;
  noteNearAlert(near.r.id, now + NOTIFY_COOLDOWN);
  noteNearAlert('_last', now);
  showProximityAlert(near.r, near.d);
  sendBrowserNotification(near.r, near.d);
}

function showProximityAlert (r, distM, crave = null) {
  const alert = document.getElementById('proximity-alert');
  alert.dataset.rid = r.id;
  alert.classList.toggle('craving', !!crave);
  document.getElementById('proximity-icon').textContent = crave ? '😋' : cuisineEmoji(r.cuisine);
  document.getElementById('proximity-name').textContent = crave ? `${crave.name} is ${fmtDist(distM)} away` : r.name;
  document.getElementById('proximity-msg').textContent = crave
    ? `At ${r.name}. It's on your Crave List.`
    : `${r.status === 'want-to-try' ? 'On your Want to Try list.' : 'Previously visited.'} ${fmtDist(distM)} away`;

  const dirBtn = document.getElementById('proximity-directions');
  dirBtn.onclick = () => openDirections(r);
  const content = document.getElementById('proximity-content');
  content.style.cursor = 'pointer';
  content.onclick = () => { alert.classList.add('hidden'); openDetailModal(r.id); };

  alert.classList.remove('hidden');
  clearTimeout(alert._timeout);
  alert._timeout = setTimeout(() => alert.classList.add('hidden'), 15000);
}

// Phones only show notifications through the service worker: on Android
// `new Notification()` throws, so that path is just the desktop fallback.
async function sendBrowserNotification (r, distM, crave = null) {
  // The Android app (2.3.0+) posts a real Android notification; the web view can't.
  const nativeNotify = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.NearbyAlerts?.notify : null;
  if (nativeNotify && window.Capacitor.isPluginAvailable?.('NearbyAlerts')) {
    const title = crave ? `${crave.name} is ${fmtDist(distM)} away` : `${r.name} is ${fmtDist(distM)} away`;
    const text = crave ? `At ${r.name}. It's on your Crave List.` : r.status === 'want-to-try' ? "It's on your Want to Try list. Tap to see it." : 'You have been here before.';
    try { await window.Capacitor.Plugins.NearbyAlerts.notify({ id: r.id, title, text }); return; } catch { /* an older app: no notify */ }
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const tag = `ftb-${r.id}`;
  // The old GitHub bear-icon.png doesn't exist; use the bundled icon.
  const icon = new URL('icon-192.png', location.href).href;
  const title = crave ? 'Your craving is nearby' : r.status === 'want-to-try' ? `${r.name} is ${fmtDist(distM)} away` : `Feed The Bear: ${r.name}`;
  const body = crave
    ? `${crave.name} at ${r.name} · ${fmtDist(distM)} away`
    : r.status === 'want-to-try' ? 'It is on your Want to Try list. Tap to see it.' : `Previously visited. ${fmtDist(distM)} away`;
  const opts = { body, tag, icon, badge: icon, data: { url: new URL(`app.html?spot=${encodeURIComponent(r.id)}`, location.href).href, spot: r.id } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) { await reg.showNotification(title, opts); return; }
  } catch { /* fall back below */ }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); openDetailModal(r.id); n.close(); };
  } catch { /* this browser cannot show notifications from a page */ }
}

// Spots saved without a map pin can't alert or be judged near or far;
// look them up once, Want to Try spots first.
let _pinLookupRunning = false;
async function pinWantToTrySpots () {
  if (_pinLookupRunning) return;
  _pinLookupRunning = true;
  const missing = state.restaurants.filter(r => !(r.lat && r.lng) && r.address)
    .sort((a, b) => (b.status === 'want-to-try') - (a.status === 'want-to-try'));
  for (const r of missing.slice(0, 25)) {
    await geocodeAddress(r.id, r.address);
    await new Promise(res => setTimeout(res, 1100)); // Nominatim allows one request a second
  }
  _pinLookupRunning = false;
}

const milesLabel = m => `${m} mile${m === 1 ? '' : 's'}`;

function renderNearAlertsRow () {
  const el = document.getElementById('account-nearalerts-state');
  if (!el) return;
  const on = nearAlertsOn() && state.settings.locationEnabled;
  // In the Android app, notifications are Android's (NativeAlerts), not the page's.
  const native = !!NativeAlerts?.available();
  const blocked = !native && 'Notification' in window && Notification.permission === 'denied';
  el.textContent = !on ? 'Off. Tap to get a heads-up near spots you want to try.'
    : native && NativeAlerts.closedToo() ? `On, within ${milesLabel(nearAlertMiles())}, even when the app is closed.`
    : native ? `On, within ${milesLabel(nearAlertMiles())}, while the app is open.${state.settings.nearAlertsClosed === false || !NativeAlerts.canClose() ? '' : " Tap to get them when it's closed too."}`
    : blocked ? `On, within ${milesLabel(nearAlertMiles())}. Phone notifications are blocked in settings.`
    : `On, within ${milesLabel(nearAlertMiles())}, while Feed The Bear is open.`;
}

// The row opens a chooser: Off, or how far away a spot can be.
function openNearAlerts () {
  const on = nearAlertsOn() && state.settings.locationEnabled;
  document.querySelectorAll('#nearalerts-choices [data-miles]').forEach(b => {
    const m = b.dataset.miles === 'off' ? 'off' : Number(b.dataset.miles);
    b.classList.toggle('active', on ? m === nearAlertMiles() : m === 'off');
    b.onclick = () => { closeNearAlerts(); setNearAlerts(m); };
  });
  const note = document.getElementById('nearalerts-note');
  const native = NativeAlerts.available();
  if (note) note.textContent = native
    ? (NativeAlerts.closedToo() ? 'Works even when the app is closed.' : 'Works while the app is open.')
    : 'Works while Feed The Bear is open on your phone.';
  // Android: alerts while open need nothing extra; "even when closed" needs
  // background location, so it's asked for only when chosen.
  const when = document.getElementById('nearalerts-when');
  when?.classList.toggle('hidden', !native || !NativeAlerts.canClose());
  when?.querySelectorAll('[data-when]').forEach(b => {
    b.classList.toggle('active', (b.dataset.when === 'closed') === (state.settings.nearAlertsClosed === true));
    b.onclick = () => {
      state.settings.nearAlertsClosed = b.dataset.when === 'closed';
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
      trackProductEvent(state.settings.nearAlertsClosed ? 'near_alerts_closed' : 'near_alerts_open_only');
      closeNearAlerts();
      if (state.settings.nearAlertsClosed) NativeAlerts.askBackground();
      else showToast('Alerts while the app is open', 'No background location needed. You can switch any time.', 'success');
      NativeAlerts.schedule();
      renderNearAlertsRow();
    };
  });
  document.getElementById('nearalerts-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeNearAlerts () {
  document.getElementById('nearalerts-overlay')?.classList.add('hidden');
  if (document.getElementById('account-overlay')?.classList.contains('hidden')) maybeHideOverlay();
}

async function setNearAlerts (miles) {
  if (miles === 'off') {
    state.settings.nearAlerts = false;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    renderNearAlertsRow();
    NativeAlerts.schedule();
    showToast('Nearby alerts off', 'You will not get a heads-up near your Want to Try spots.', 'info');
    return;
  }
  state.settings.nearAlerts = true;
  state.settings.nearAlertMiles = miles;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* older browsers */ }
  }
  if (!state.locationEnabled) enableLocation();
  else checkProximity();
  pinWantToTrySpots();
  renderNearAlertsRow();
  NativeAlerts.schedule();
  if (NativeAlerts.available() && state.settings.nearAlertsClosed === true) setTimeout(() => NativeAlerts.askBackground(), 1200);
  const want = state.restaurants.filter(r => r.status === 'want-to-try');
  const pinned = want.filter(r => r.lat && r.lng).length;
  showToast('Nearby alerts on', want.length
    ? `We will tell you when you are within ${milesLabel(miles)} of a Want to Try spot (${pinned} of ${want.length} have a map pin so far).`
    : 'Add spots to your Want to Try list and we will tell you when you are close.', 'success');
}

/* ── Android app: tell people when the app itself is out of date ──
   Almost everything updates by itself (the app loads this website). Only
   Android features, like notifications, need a new install. When this site
   expects one the installed app doesn't have, a banner sends people to the
   app on Google Play. (It used to offer the GitHub build, which can't install
   over the Play app.) List only what the version on Google Play has: the
   Play version 2.1.0 has no ContactPicker, so asking for it showed every
   Play user an update they couldn't get. Add 'ShareSheet' once 2.2.0 is live. */
const ANDROID_APP_URL = 'https://play.google.com/store/apps/details?id=com.feedthebear.app';
const ANDROID_APP_NEEDS = ['PushNotifications'];

function checkAndroidAppVersion () {
  const cap = window.Capacitor;
  if (!IS_ANDROID_APP) return;
  const has = name => (typeof cap.isPluginAvailable === 'function' ? cap.isPluginAvailable(name) : !!cap.Plugins?.[name]);
  if (ANDROID_APP_NEEDS.every(has) || document.getElementById('app-update-banner')) return;
  try { if (localStorage.getItem('ftb_app_update_later') === new Date().toDateString()) return; } catch { /* private mode */ }
  const bar = document.createElement('div');
  bar.id = 'app-update-banner';
  bar.className = 'app-update-banner';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<span>📲 A new version of Feed The Bear is on Google Play.</span>
    <button type="button" class="btn-primary btn-sm app-update-go">Update</button>
    <button type="button" class="app-update-later" aria-label="Later">✕</button>`;
  document.body.appendChild(bar);
  bar.querySelector('.app-update-go').onclick = () => {
    trackProductEvent('android_update_tapped');
    const browser = cap.Plugins?.Browser;
    if (browser?.open) browser.open({ url: ANDROID_APP_URL }).catch(() => window.open(ANDROID_APP_URL, '_blank'));
    else window.open(ANDROID_APP_URL, '_blank');
  };
  bar.querySelector('.app-update-later').onclick = () => {
    try { localStorage.setItem('ftb_app_update_later', new Date().toDateString()); } catch { /* private mode */ }
    bar.remove();
  };
}
window.addEventListener('load', () => setTimeout(checkAndroidAppVersion, 2500));

/* ── Android app: alerts even when the app is closed ─────────
   In the Android app (native/), the Want to Try spots and the chosen
   distance are handed to Android geofencing (NearbyAlerts plugin), which
   wakes the app near a spot. On the website none of this runs. */
// var, not const: saveData can run during start-up before this line.
var NativeAlerts = (() => {
  const plugin = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.NearbyAlerts : null);
  let lastSig = '';
  let timer = null;
  let background = false;
  // The Google Play build has no background location (older installs don't report it).
  let supported = true;

  async function sync () {
    const p = plugin();
    if (!p) return;
    // Geofences wake the app when it's closed, which needs background
    // location: only when they chose "even when the app is closed".
    const on = supported && nearAlertsOn() && !!state.settings.locationEnabled && state.settings.nearAlertsClosed !== false;
    const here = Number.isFinite(state.userLat) && Number.isFinite(state.userLng);
    // Android allows 100 geofences: keep the closest Want to Try spots.
    const spots = state.restaurants
      .filter(isAvailableSpot)
      .filter(r => r.status === 'want-to-try' && r.lat != null && r.lng != null && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)))
      .map(r => ({ id: r.id, name: String(r.name || '').slice(0, 80), lat: Number(r.lat), lng: Number(r.lng), d: here ? haversine(state.userLat, state.userLng, Number(r.lat), Number(r.lng)) : 0 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 100)
      .map(({ d, ...spot }) => spot);
    const radiusMeters = Math.round(nearAlertMiles() * 1609.344);
    const sig = JSON.stringify([on, radiusMeters, spots.map(x => `${x.id}:${x.lat}:${x.lng}`)]);
    if (sig === lastSig) return;
    lastSig = sig;
    try { await p.setSpots({ enabled: on, radiusMeters, spots }); } catch { lastSig = ''; }
  }

  async function refresh () {
    const p = plugin();
    if (!p) return;
    try {
      const st = await p.status();
      background = !!st.background;
      supported = st.backgroundSupported !== false;
      // An app that can now alert when closed (2.3.0): offer it once to anyone
      // who has alerts on, unless they chose "only while open".
      if (supported && !background && nearAlertsOn() && state.settings.locationEnabled && state.settings.nearAlertsClosed !== false) {
        let asked = false;
        try { asked = !!localStorage.getItem('ftb_bg_asked_v1'); localStorage.setItem('ftb_bg_asked_v1', '1'); } catch { asked = true; }
        if (!asked) setTimeout(() => NativeAlerts.askBackground(), 2500);
      }
    } catch { /* plugin missing */ }
    renderNearAlertsRow();
  }

  return {
    available: () => !!plugin(),
    closedToo: () => background,
    canClose: () => supported,
    schedule () {
      if (!plugin()) return;
      clearTimeout(timer);
      timer = setTimeout(sync, 1500);
    },
    async clear () {
      clearTimeout(timer);
      lastSig = '';
      const p = plugin();
      if (!p) return;
      try { await p.setSpots({ enabled: false, radiusMeters: 1609, spots: [] }); }
      catch (err) { console.warn('[FTB] Could not clear account location alerts:', err); }
    },
    refresh,
    // Explain first (Google Play requires it), then ask for "Allow all the time".
    askBackground () {
      if (!plugin() || background || !supported) return;
      document.getElementById('bg-location-overlay')?.classList.remove('hidden');
      document.body.classList.add('overlay-open');
    },
    async allowBackground () {
      const p = plugin();
      closeBgLocation();
      if (!p) return;
      try {
        await p.requestLocation();
        await p.requestNotifications();
        const st = await p.requestBackground(); // Android 11+ opens the app's settings page
        background = !!st?.background;
        if (!background) showToast('One more step', 'Choose "Allow all the time" under Location, then come back.', 'info');
      } catch (err) {
        showToast('Location is off', 'Allow location for Feed The Bear to get nearby alerts.', 'error');
      }
      lastSig = '';
      sync();
      renderNearAlertsRow();
    },
  };
})();

// Android app: roughly where you are and your Want to Try pins, once a day,
// so the server can send the weekly "near you" nudge and contests in your
// state (api/nudges.js) when the app is closed.
async function shareNudgeArea () {
  if (!window.FriendPings?.area || !Number.isFinite(state.userLat) || !window._ftbUid) return;
  const today = new Date().toDateString();
  try { if (localStorage.getItem('ftb_area_sent_v1') === today) return; } catch { return; }
  const st = typeof myStateCode === 'function' ? await myStateCode().catch(() => '') : '';
  const want = state.restaurants
    .filter(isAvailableSpot)
    .filter(r => r.status === 'want-to-try' && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)) && r.lat !== null)
    .slice(0, 100).map(r => ({ n: String(r.name || '').slice(0, 60), lat: Number(r.lat), lng: Number(r.lng) }));
  if (await window.FriendPings.area({ lat: state.userLat, lng: state.userLng, state: st, miles: nearAlertMiles(), want })) {
    try { localStorage.setItem('ftb_area_sent_v1', today); } catch { /* storage full */ }
  }
}

function closeBgLocation () {
  document.getElementById('bg-location-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function openSpotFromLink (id) {
  if (!id || !state.restaurants.some(r => r.id === id)) return;
  setTimeout(() => openDetailModal(id), 300);
}

/* ════════════════════════════════════════════════════════════
   RENDERING
   ════════════════════════════════════════════════════════════ */
function matchesRestaurantSearch (restaurant, query) {
  const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const fields = [restaurant.name, restaurant.cuisine, restaurant.notes, restaurant.address,
    ...(restaurant.tags || []), ...dishesOf(restaurant).map(d => d.name)].map(normalize);
  return terms.length > 0 && terms.every(term => fields.some(field => field.includes(term)));
}

function getFiltered () {
  let list = [...state.restaurants];

  // View filter. Map and Stats are screens, not statuses: they show everything
  // (filtering by status 'map' left the map with no pins at all).
  if (state.currentView === 'visited' || state.currentView === 'want-to-try') {
    list = list.filter(r => r.status === state.currentView);
  }
  // Search
  if (state.filter.search) {
    list = list.filter(r => matchesRestaurantSearch(r, state.filter.search));
  }
  // Cuisine
  if (state.filter.cuisine) {
    const want = cuisineFilterKey(state.filter.cuisine);
    list = list.filter(r => cuisineFilterKey(r.cuisine) === want);
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
  // Your rating counts first, Google's fills in when you haven't rated;
  // unrated spots always sort last so "lowest rated" means something.
  const bestRating = r => Number(r.myRating) || Number(r.googleRating) || 0;
  const byRating = dir => (a, b) => {
    const ra = bestRating(a), rb = bestRating(b);
    if (!ra !== !rb) return ra ? -1 : 1;
    return dir * (ra - rb) || dir * ((a.googleRating || 0) - (b.googleRating || 0)) || a.name.localeCompare(b.name);
  };
  switch (state.filter.sort) {
    case 'best-desc':
      list.sort(byRating(-1)); break;
    case 'best-asc':
      list.sort(byRating(1)); break;
    case 'name-asc':
      list.sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'name-desc':
      list.sort((a,b) => b.name.localeCompare(a.name)); break;
    case 'my-rating-desc':
      list.sort((a,b) => (b.myRating||0) - (a.myRating||0)); break;
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

// Suggestions (For You, Open Now, picks) skip spots too far to go to today,
// like a place you tried once on a trip. Lists and the diary still show them.
const SUGGEST_MAX_METERS = 30 * 1609.344;
function isAvailableSpot (r) {
  return !!r && r.permanentlyClosed !== true;
}

function nearEnoughToSuggest (r) {
  if (!isAvailableSpot(r)) return false;
  if (!state.locationEnabled || !r.lat || !r.lng) return true; // distance unknown
  return distOf(r) <= SUGGEST_MAX_METERS;
}

function prefersReducedMotion () {
  return state.settings?.uiMotion === 'reduced' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Header counts tick up to their new value and pop, so adding a place feels
// like it landed. The first paint just sets the number.
function setStatNumber (id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = Number(el.dataset.n);
  el.dataset.n = String(value);
  if (!Number.isFinite(prev) || prev === value || prefersReducedMotion()) { el.textContent = value; return; }
  const start = performance.now();
  const step = t => {
    const k = Math.min(1, (t - start) / 450);
    el.textContent = Math.round(prev + (value - prev) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.remove('stat-pop'); void el.offsetWidth; el.classList.add('stat-pop');
}

function renderStats () {
  const all = state.restaurants;
  const visited = all.filter(r => r.status === 'visited');
  const want    = all.filter(r => r.status === 'want-to-try');
  // Your own ratings; Google's only stand in until you've rated something.
  const mine    = all.filter(r => r.myRating > 0);
  const rated   = mine.length ? mine : all.filter(r => r.googleRating > 0);
  const avg     = rated.length
    ? (rated.reduce((s,r) => s + (mine.length ? r.myRating : r.googleRating), 0) / rated.length).toFixed(1)
    : null;

  setStatNumber('stat-total', all.length);
  setStatNumber('stat-visited', visited.length);
  setStatNumber('stat-want', want.length);
  document.getElementById('stat-avg').textContent     = avg || '-';
  document.getElementById('stat-avg-stars').textContent = avg ? '★' : '';
  document.getElementById('stats-bar')?.classList.toggle('hidden', all.length === 0);
}

// "ice_cream;coffee_shop" (OpenStreetMap) and "Ice Cream" (saved) compare equal.
function cuisineFilterKey (raw) {
  return String(raw || '').split(';')[0].replace(/_/g, ' ').trim().toLowerCase();
}
function cuisineFilterLabel (key) {
  return String(key || '').replace(/\b\w/g, c => c.toUpperCase());
}

// The filter used to list only cuisines from your saved spots, so with one
// American spot it offered only "American". List what's near you too, with
// counts, and filter both your list and Near You Now.
function renderCuisineFilter () {
  const sel = document.getElementById('filter-cuisine');
  const current = state.filter.cuisine || sel.value;
  const count = list => list.reduce((m, k) => { if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const saved = count(state.restaurants.map(r => cuisineFilterKey(r.cuisine)));
  const nearby = count((_homeDiscCache?.elements || []).map(el => cuisineFilterKey(el.tags?.cuisine)));
  const sorted = obj => Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  while (sel.options.length > 1) sel.remove(1);
  sel.querySelectorAll('optgroup').forEach(g => g.remove());
  const group = (label, entries) => {
    if (!entries.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    entries.forEach(([key, n]) => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${cuisineFilterLabel(key)} (${n})`;
      g.appendChild(o);
    });
    sel.appendChild(g);
  };
  group('Your spots', sorted(saved));
  group('Near you', sorted(nearby).filter(([key]) => !saved[key]));
  sel.value = [...sel.options].some(o => o.value === current) ? current : '';
  if (sel.value !== current) state.filter.cuisine = sel.value;
}

function renderCards () {
  if (state.currentView === 'map') return;
  const grid   = document.getElementById('restaurant-grid');
  const empty  = document.getElementById('empty-state');
  const noRes  = document.getElementById('no-results');
  const list   = getFiltered();
  // Home shows your saved cards only while you search or filter (Lists has them all).
  const f = state.filter || {};
  document.body.dataset.view = state.currentView;
  document.body.classList.toggle('home-filtering', !!(f.search || f.cuisine || f.price || f.tag || f.collection));

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
    if (isListView(state.currentView)) grid.innerHTML = listEmptyHtml(state.currentView);
    else empty.classList.remove('hidden');
    return;
  }
  if (list.length === 0) {
    const filtering = state.filter.search || state.filter.cuisine || state.filter.price || state.filter.collection;
    if (isListView(state.currentView) && !filtering) { grid.innerHTML = listEmptyHtml(state.currentView); return; }
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
  renderDuplicateBanner(grid);
  fillSpotPhotos(list);
}

/* Spots you haven't photographed (most Want to Try ones) get the
   restaurant's own photo, looked up a few at a time and kept on the spot.
   Google photo links can expire, so they're looked up again after a month. */
const SPOT_PHOTO_TTL = 30 * 86400000;
const _spotPhotoTried = new Set();
let _spotPhotoRunning = false;

// Lookups nobody asked for (photos, place checks) stop at a daily number per
// device, so a big list fills in over a few days instead of in one Google bill.
const BACKGROUND_LOOKUPS_PER_DAY = 40;
function takeBackgroundLookup () {
  const key = `ftb_bg_lookups_${new Date().toDateString()}`;
  try {
    const used = Number(localStorage.getItem(key)) || 0;
    if (used >= BACKGROUND_LOOKUPS_PER_DAY) return false;
    localStorage.setItem(key, String(used + 1));
  } catch { /* private mode: the server's own limit still applies */ }
  return true;
}

async function fillSpotPhotos (list) {
  if (_spotPhotoRunning || navigator.onLine === false) return;
  const todo = list.filter(r => r.name && !_spotPhotoTried.has(r.id) &&
    !pickRealRestaurantPhoto({ savedRestaurant: { photo: r.photo } }).url &&
    !(r.placePhoto && Date.now() - (r.placePhotoAt || 0) < SPOT_PHOTO_TTL)).slice(0, 8);
  if (!todo.length) return;
  _spotPhotoRunning = true;
  let found = false;
  let capped = false;
  try {
    for (const r of todo) {
      if (!takeBackgroundLookup()) { capped = true; break; }
      _spotPhotoTried.add(r.id);
      const url = await getOrFetchPlacePhoto({ name: r.name, lat: r.lat ?? undefined, lon: r.lng ?? undefined, address: r.address, website: r.website });
      // Look up by id again: the list may have been replaced while we waited.
      const spot = state.restaurants.find(x => x.id === r.id);
      if (!spot || !url) continue;
      spot.placePhoto = url;
      spot.placePhotoAt = Date.now();
      found = true;
    }
  } finally {
    _spotPhotoRunning = false;
  }
  if (found) { saveData(); renderCards(); } else if (!capped) fillSpotPhotos(list);
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

  card.innerHTML = `
    <div class="card-checkbox${state.selectedIds.has(r.id) ? ' checked' : ''}" title="Select"></div>
    <div class="card-photo">
      ${hasPhoto
        ? `<img src="${escHtml(photoSrc)}" alt="${escHtml(r.name)}" loading="lazy" onload="this.classList.add('loaded')" />`
        : stockDishPhotoHtml(r)}
      <div class="card-img-overlay"></div>
      <span class="card-status-badge ${r.status === 'want-to-try' ? 'want' : 'visited'}">
        ${r.status === 'want-to-try' ? 'Want to Try' : 'Been There'}
      </span>
      <button class="card-favorite-btn ${r.isFavorite ? 'active' : ''}" data-action="toggle-favorite" aria-pressed="${r.isFavorite ? 'true' : 'false'}" aria-label="${r.isFavorite ? 'Favorite. Tap to remove' : 'Add to favorites'}">
        ${r.isFavorite ? '★ Favorite' : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>'}
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
      ${cardOrderLine(r)}
      ${cardExtrasHtml(r)}
      <div class="card-highlights">
        ${r.placeSuggest ? '<span class="card-highlight card-place-check">📍 Right place?</span>' : ''}
        ${openChipHtml(r)}
        ${distStr ? `<span class="card-highlight neutral">📍 ${distStr}</span>` : ''}
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          Edit
        </button>
        <button class="card-action-btn delete-card" data-action="delete" type="button" aria-label="Delete ${escHtml(r.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>
          Delete
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
        // A little burst of stars when something becomes a favorite.
        if (state.restaurants[i].isFavorite && window.MicroInteractions && !prefersReducedMotion()) {
          const b = e.target.closest('[data-action]').getBoundingClientRect();
          MicroInteractions.createParticleBurst(b.left + b.width / 2, b.top + b.height / 2, '#f0b850');
        }
        hapticTap(state.restaurants[i].isFavorite ? 'medium' : 'light');
        saveData();
        renderCards();
      }
      return;
    }
    if (action === 'open-link')    { e.stopPropagation(); return; } // the <a> opens it
    if (action === 'directions')   { e.stopPropagation(); openDirections(r);      return; }
    if (action === 'website')       { e.stopPropagation(); openWebsite(r);         return; }
    if (action === 'edit')          { e.stopPropagation(); openEditModal(r.id);    return; }
    if (action === 'delete')        { e.stopPropagation(); deleteSavedRestaurant(r.id); return; }
    if (action === 'open')          { e.stopPropagation(); openDetailModal(r.id);  return; }
    if (action === 'mark-visited')  { e.stopPropagation(); markVisited(r.id);      return; }
    hapticTap('light');
    openDetailModal(r.id);
  });
  card.addEventListener('keydown', e => {
    if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetailModal(r.id); }
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

function visitsTileHtml (r) {
  const visits = Array.isArray(r?.visits) ? r.visits : [];
  const last = visits.map(v => v.date).filter(Boolean).sort().pop() || r?.dateVisited || '';
  if (!last) {
    return `<label>Your Visits</label><div style="color:var(--text-dim);font-size:.85rem">Not yet</div>`;
  }
  const count = Math.max(visits.length, 1);
  return `<label>Your Visits</label>
    <div style="font-size:1.2rem;font-weight:800;color:var(--text)">${count}×</div>
    <div style="color:var(--text-dim);font-size:.75rem">Last ${escHtml(fmtDate(last))}</div>`;
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

/* ── Stand-in dish photos ────────────────────────────────────
   A spot with no photo of its own gets a photo of a dish it likely serves,
   from the Bear Swipe library, always labeled so it never passes as the
   restaurant's own picture. A saved dish wins over the cuisine. */
const STOCK_CUISINE = {
  Burgers: 'American', 'Fast Food': 'American', Diner: 'American', Wings: 'American', 'Soul Food': 'Southern',
  Sushi: 'Japanese', Ramen: 'Japanese', Pasta: 'Italian', 'Dim Sum': 'Chinese', Tapas: 'Spanish',
  'Pub/Bar': 'British', Irish: 'British', 'Salad/Healthy': 'Healthy', Vegan: 'Healthy', 'Bakery/Cafe': 'Bakery',
  Brunch: 'Breakfast', Lebanese: 'Middle Eastern', Peruvian: 'Latin American', Brazilian: 'Latin American',
  Colombian: 'Latin American', Ethiopian: 'African', 'Ice Cream': 'Dessert', Desserts: 'Dessert',
};
const STOCK_KEYWORD = { Steakhouse: /steak/i, Burgers: /burger/i, Sushi: /sushi|nigiri|maki|sashimi/i, Ramen: /ramen/i, Wings: /wings/i, Pizza: /pizza/i };
let _stockPhotos = null;
let _stockLoading = false;

function loadStockPhotos () {
  if (_stockPhotos || _stockLoading || !window.BearSwipe?.loadPhotos) return;
  _stockLoading = true;
  window.BearSwipe.loadPhotos().then(list => {
    _stockPhotos = Array.isArray(list) ? list : [];
    if (_stockPhotos.length) renderCards();
  }).catch(() => { _stockPhotos = []; });
}

function stockDishPhoto (r) {
  if (!_stockPhotos) { loadStockPhotos(); return null; }
  if (!_stockPhotos.length || !r) return null;
  const seed = [...String(r.id || r.name)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const pickFrom = list => {
    if (!list.length) return null;
    const leads = list.filter(x => x.lead);
    const pool = leads.length ? leads : list;
    return pool[seed % pool.length];
  };
  for (const d of dishesOf(r)) {
    const key = dishKey(d.name);
    const hit = _stockPhotos.find(x => dishKey(x.dish) === key);
    if (hit) return { photo: hit, label: d.name };
  }
  const cuisine = String(r.cuisine || '').trim();
  if (!cuisine) return null;
  const kw = STOCK_KEYWORD[cuisine];
  const byKeyword = kw ? pickFrom(_stockPhotos.filter(x => kw.test(x.dish))) : null;
  if (byKeyword) return { photo: byKeyword, label: `Typical ${cuisine}` };
  const lib = STOCK_CUISINE[cuisine] || cuisine;
  const byCuisine = pickFrom(_stockPhotos.filter(x => String(x.cuisine).toLowerCase() === lib.toLowerCase()));
  return byCuisine ? { photo: byCuisine, label: `Typical ${cuisine}` } : null;
}

function stockDishPhotoHtml (r) {
  const stock = stockDishPhoto(r);
  if (!stock) {
    return `<div class="card-photo-empty"><span class="card-photo-empty-emoji" aria-hidden="true">${cuisineEmoji(r.cuisine)}</span><span class="card-photo-empty-text">${r.status === 'visited' ? 'Add your photo' : escHtml(r.cuisine || 'Saved spot')}</span></div>`;
  }
  return `<img class="card-photo-stock" src="${escHtml(stock.photo.url)}" alt="${escHtml(stock.photo.dish)}" loading="lazy" onload="this.classList.add('loaded')" />
    <span class="card-stock-tag" title="Photo: ${escHtml(stock.photo.credit || 'Wikimedia Commons')}">📷 ${escHtml(stock.label)}${r.status === 'visited' ? ' · add yours' : ''}</span>`;
}

/* ── Place info: Google rating, price, hours, open now ────── */
// Looked up through /api/place-info and kept on the spot for a week.
const PLACE_INFO_TTL = 7 * 86400000;
const _placeInfoTried = new Set();
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function refreshPlaceInfo (r) {
  if (!r || !r.name || _placeInfoTried.has(r.id) || navigator.onLine === false) return false;
  if (r.placeInfoAt && Date.now() - r.placeInfoAt < PLACE_INFO_TTL) return false;
  _placeInfoTried.add(r.id);
  try {
    const q = new URLSearchParams({ name: r.name });
    if (r.address) q.set('address', r.address);
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (r.lat != null && r.lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      q.set('lat', lat.toFixed(3));
      q.set('lng', lng.toFixed(3));
    }
    const resp = await apiGet(`/api/place-info?${q.toString()}`);
    if (!resp.ok) return false;
    const info = await resp.json();
    r.placeInfoAt = Date.now();
    if (info.found) {
      if (info.rating) { r.googleRating = info.rating; r.googleReviews = info.reviews || 0; }
      if (info.priceLevel && !r.priceRange) r.priceRange = info.priceLevel;
      r.hours = Array.isArray(info.hours) ? info.hours : [];
      r.periods = Array.isArray(info.periods) ? info.periods : [];
      if (info.phone && !r.phone) r.phone = info.phone;
      if (info.website && !r.website) r.website = info.website;
      if (info.mapsUrl) r.mapsUrl = info.mapsUrl;
      if (info.placeId) r.placeId = info.placeId;
      // Fill in where it is when we didn't know yet.
      if (info.address && !r.address) r.address = info.address;
      if (Number.isFinite(info.lat) && Number.isFinite(info.lng) && !(Number.isFinite(r.lat) && Number.isFinite(r.lng))) { r.lat = info.lat; r.lng = info.lng; }
    }
    saveData();
    return !!info.found;
  } catch {
    return false;
  }
}

function fmtClock ({ hour = 0, minute = 0 } = {}) {
  const h = hour % 12 || 12;
  return `${h}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour < 12 ? 'AM' : 'PM'}`;
}

// Open or closed right now, from Google's weekly periods (day 0 = Sunday).
function openStatus (r, now = new Date()) {
  if (r?.permanentlyClosed === true) return { open: false, permanent: true, text: 'Permanently closed' };
  const periods = Array.isArray(r?.periods) ? r.periods.filter(p => p && p.open) : [];
  if (!periods.length) return null;
  if (periods.length === 1 && !periods[0].close) return { open: true, text: 'Open 24 hours' };
  const WEEK = 7 * 1440;
  const mins = d => d.day * 1440 + d.hour * 60 + (d.minute || 0);
  const t = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  let next = null;
  for (const p of periods) {
    if (!p.close) continue;
    const o = mins(p.open);
    let c = mins(p.close);
    if (c <= o) c += WEEK;
    for (const shift of [0, -WEEK]) {
      if (t >= o + shift && t < c + shift) {
        const left = c + shift - t;
        return { open: true, soon: left <= 60, text: left <= 60 ? `Closes soon · ${fmtClock(p.close)}` : `Open · closes ${fmtClock(p.close)}` };
      }
    }
    const until = ((o - t) % WEEK + WEEK) % WEEK;
    if (!next || until < next.until) next = { until, p };
  }
  if (!next) return null;
  const day = next.p.open.day;
  const when = day === now.getDay() && next.until < 1440 ? fmtClock(next.p.open)
    : day === (now.getDay() + 1) % 7 ? `tomorrow ${fmtClock(next.p.open)}`
    : `${WEEKDAY_SHORT[day]} ${fmtClock(next.p.open)}`;
  return { open: false, text: `Closed · opens ${when}` };
}

function openChipHtml (r) {
  const st = openStatus(r);
  if (!st) return '';
  return `<span class="card-highlight ${st.open ? (st.soon ? 'open-soon' : 'open-now') : 'closed-now'}">${escHtml(st.text)}</span>`;
}

function fillDetailFacts (r) {
  const dim = text => `<div style="color:var(--text-dim);font-size:.85rem">${text}</div>`;
  const looking = !r.placeInfoAt && !_placeInfoTried.has(r.id) ? 'Looking it up…' : 'Not available';
  document.getElementById('detail-google-rating').innerHTML =
    r.googleRating ? googleStarsLgHtml(r.googleRating, r.googleReviews) : `<label>Google Rating</label>${dim(looking)}`;
  document.getElementById('detail-price').innerHTML =
    `<label>Price Range</label><div style="font-size:1.2rem;color:var(--gold);font-weight:700">${priceDollars(r.priceRange) || dim('Unknown')}</div>`;
  // Nothing to show: drop the empty box instead of a "Not available" / "Unknown" tile.
  document.getElementById('detail-google-rating').closest('.detail-rating-block')?.classList.toggle('hidden', !r.googleRating && looking === 'Not available');
  document.getElementById('detail-price').closest('.detail-rating-block')?.classList.toggle('hidden', !priceDollars(r.priceRange));

  let box = document.getElementById('detail-hours');
  if (!box) {
    box = document.createElement('div');
    box.id = 'detail-hours';
    box.className = 'detail-hours';
    document.getElementById('detail-meta')?.insertAdjacentElement('afterend', box);
  }
  renderDetailLocation(r, box);
  const st = openStatus(r);
  const today = (new Date().getDay() + 6) % 7; // Google lists Monday first
  const links = [
    r.phone ? `<a class="detail-hours-link" href="tel:${escHtml(r.phone.replace(/[^\d+]/g, ''))}">📞 ${escHtml(r.phone)}</a>` : '',
    r.mapsUrl ? `<a class="detail-hours-link" href="${escHtml(r.mapsUrl)}" target="_blank" rel="noopener">⭐ Google reviews</a>` : '',
  ].join('');
  if (!st && !links) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `
    ${st ? `<details class="detail-hours-toggle">
      <summary><span class="detail-open-dot ${st.open ? (st.soon ? 'soon' : 'open') : 'closed'}" aria-hidden="true"></span>${escHtml(st.text)}</summary>
      ${st.permanent ? '<p>Your visits, ratings and photos are kept. This place is excluded from suggestions.</p>' : `<ul>${(r.hours || []).map((h, i) => `<li class="${i === today ? 'today' : ''}">${escHtml(h)}</li>`).join('')}</ul>`}
    </details>` : ''}
    ${links ? `<div class="detail-hours-links">${links}</div>` : ''}`;
}

// Where it is: a small map, the address, and one tap to directions.
function renderDetailLocation (r, after) {
  let el = document.getElementById('detail-location');
  if (!el) {
    el = document.createElement('section');
    el.id = 'detail-location';
    el.className = 'detail-location';
    el.setAttribute('aria-label', 'Location');
    after.insertAdjacentElement('afterend', el);
  }
  const hasPin = Number.isFinite(r.lat) && Number.isFinite(r.lng);
  const dist = distOf(r);
  const d = .006;
  const map = hasPin
    ? `<iframe class="dl-map" title="Map of ${escHtml(r.name)}" loading="lazy" referrerpolicy="no-referrer"
         src="https://www.openstreetmap.org/export/embed.html?bbox=${r.lng - d},${r.lat - d * .6},${r.lng + d},${r.lat + d * .6}&amp;layer=mapnik&amp;marker=${r.lat},${r.lng}"></iframe>`
    : '';
  const looking = !r.placeInfoAt && !_placeInfoTried.has(r.id);
  el.innerHTML = `${map}
    <div class="dl-body">
      <div class="dl-addr">📍 ${r.address ? escHtml(r.address) : `<span class="dl-dim">${looking ? 'Finding the address…' : 'No address saved yet'}</span>`}${Number.isFinite(dist) ? ` <span class="dl-dim">· ${fmtDist(dist)} away</span>` : ''}</div>
      <div class="dl-actions">
        <button type="button" class="btn-secondary btn-sm dl-maps">${hasPin || r.address ? 'Open in Google Maps' : 'Find it on Google Maps'}</button>
      </div>
      <div class="dl-check hidden" aria-live="polite"></div>
    </div>`;
  el.querySelector('.dl-maps')?.addEventListener('click', () => {
    if (r.mapsUrl) window.open(r.mapsUrl, '_blank', 'noopener'); else openMapsSearch(r);
  });
  renderPlaceCheck(r, el.querySelector('.dl-check'));
  if (!r.placeChecked && !r.placeSuggest) checkSpotPlace(r).then(changed => { if (changed && state.detailId === r.id) renderPlaceCheck(r, el.querySelector('.dl-check')); });
}

/* ── Is this the right place? ─────────────────────────────────
   Spots saved by name alone can end up linked to the wrong restaurant.
   Each spot is checked once against Google's best match for its name: the
   same place (or right next to where it's pinned) is confirmed quietly;
   anything else asks on the spot's page, and its card gets a small flag. */
const _placeCheckTried = new Set();

function placeNameTokens (s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t && !['the', 'and', 'restaurant', 'cafe', 'bar', 'grill', 'kitchen', 'co'].includes(t));
}

async function checkSpotPlace (r) {
  if (!r?.name || r.placeChecked || r.placeSuggest || _placeCheckTried.has(r.id) || navigator.onLine === false) return false;
  _placeCheckTried.add(r.id);
  const pinned = Number.isFinite(r.lat) && Number.isFinite(r.lng);
  const lat = pinned ? r.lat : state.userLat;
  const lng = pinned ? r.lng : state.userLng;
  const at = Number.isFinite(lat) ? `&lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}` : '';
  let top = null;
  try {
    const resp = await apiGet(`/api/place-info?mode=search&q=${encodeURIComponent(r.name)}${at}`);
    if (!resp.ok) return false;
    top = ((await resp.json())?.places || []).find(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng)) || null;
  } catch { return false; }
  const spot = state.restaurants.find(x => x.id === r.id);
  if (!spot || !top) return false;
  // A different restaurant with a similar search isn't a suggestion worth making.
  const want = placeNameTokens(spot.name);
  const got = placeNameTokens(top.name);
  const overlap = want.length ? want.filter(t => got.includes(t)).length / want.length : 0;
  const near = pinned && haversine(spot.lat, spot.lng, top.lat, top.lng) < 150;
  if ((top.placeId && top.placeId === spot.placeId) || near) {
    spot.placeChecked = true;
    if (!spot.placeId && top.placeId) spot.placeId = top.placeId;
  } else if (overlap >= 0.5) {
    spot.placeSuggest = { placeId: top.placeId || '', name: top.name, address: top.address || '', lat: top.lat, lng: top.lng,
      rating: top.rating || 0, reviews: top.reviews || 0, priceLevel: top.priceLevel || 0 };
  } else {
    return false;
  }
  if (spot !== r) Object.assign(r, { placeChecked: spot.placeChecked, placeSuggest: spot.placeSuggest, placeId: spot.placeId });
  saveData();
  return true;
}

// Links a spot to a Google place: where it is, its rating, and fresh hours and photo.
function linkSpotToPlace (r, p) {
  Object.assign(r, {
    name: p.name || r.name, address: p.address || r.address, lat: p.lat, lng: p.lng, placeId: p.placeId || '',
    placeChecked: true, placeSuggest: null, updatedAt: Date.now(),
    placeInfoAt: 0, hours: [], periods: [], phone: '', mapsUrl: '', placePhoto: '', placePhotoAt: 0,
  });
  if (p.rating) { r.googleRating = p.rating; r.googleReviews = p.reviews || 0; }
  if (p.priceLevel && !r.priceRange) r.priceRange = p.priceLevel;
  _placeInfoTried.delete(r.id);
  _spotPhotoTried.delete(r.id);
}

function renderPlaceCheck (r, box) {
  if (!box) return;
  const s = r.placeSuggest;
  if (!s) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const dist = Number.isFinite(state.userLat) ? fmtDist(haversine(state.userLat, state.userLng, s.lat, s.lng)) : '';
  box.classList.remove('hidden');
  box.innerHTML = `<div class="dl-check-q">Is this the right place?</div>
    <div class="dl-check-place"><strong>${escHtml(s.name)}</strong><span>${escHtml([s.rating ? `★ ${s.rating.toFixed(1)}` : '', s.address, dist ? `${dist} away` : ''].filter(Boolean).join(' · '))}</span></div>
    <div class="dl-check-actions">
      <button type="button" class="btn-primary btn-sm dl-check-yes">Yes, use this one</button>
      <button type="button" class="btn-ghost btn-sm dl-check-search">Search for it</button>
      <button type="button" class="btn-ghost btn-sm dl-check-keep">Keep mine</button>
    </div>`;
  box.querySelector('.dl-check-yes').onclick = () => {
    linkSpotToPlace(r, s);
    saveData();
    renderAll();
    openDetailModal(r.id);
    showToast('Linked', `${r.name} is now linked to the right place.`, 'success');
    refreshPlaceInfo(r).then(found => { if (found) { renderAll(); if (state.detailId === r.id && !document.getElementById('detail-overlay').classList.contains('hidden')) fillDetailFacts(r); } });
  };
  box.querySelector('.dl-check-keep').onclick = () => {
    r.placeChecked = true;
    r.placeSuggest = null;
    saveData();
    renderCards();
    renderPlaceCheck(r, box);
  };
  box.querySelector('.dl-check-search').onclick = () => {
    closeDetailModal();
    openEditModal(r.id);
    searchFormPlaces();
  };
}

// After launch, check a few saved spots that haven't been checked yet.
async function checkSpotPlaces () {
  const todo = (state.restaurants || []).filter(r => r.name && !r.placeChecked && !r.placeSuggest).slice(0, 10);
  let flagged = false;
  for (const r of todo) {
    if (!takeBackgroundLookup()) break;
    if (await checkSpotPlace(r) && r.placeSuggest) flagged = true;
    await new Promise(res => setTimeout(res, 800));
  }
  if (flagged) renderCards();
}
window.addEventListener('load', () => setTimeout(checkSpotPlaces, 9000));

/* Back online: send what was saved while offline (the banner itself is
   initOfflineIndicator). */
window.addEventListener('online', () => {
  try { if (typeof fbDebouncedSync === 'function') fbDebouncedSync(); } catch { /* next save will sync */ }
});

/* ── "Enjoying Feed The Bear?" ───────────────────────────────
   Asked right after a good moment (a new 5-star visit, a 4-5 star Just Ate,
   a finished Bear Swipe round), once they've opened the app a few times and
   saved a few spots; at most every 4 months, and never again after they
   answer. Happy: rate it on Google Play (in the Android app), or share it.
   Not happy: a private note to the owner (api/feedback.js), not a public review. */
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.feedthebear.app';

/* Stay current: the Android app keeps running in the background, so coming
   back to it never reloads. When a newer version is live (sw.js names it),
   refresh: quietly if nothing is open, else Byte Cub offers an Update button.
   APP_BUILD must match CACHE in sw.js (tests/version.test.js checks). */
const APP_BUILD = 'ftb-v187';
let _freshCheckedAt = 0;
async function checkForNewBuild () {
  if (Date.now() - _freshCheckedAt < 5 * 60 * 1000 || !navigator.onLine) return;
  _freshCheckedAt = Date.now();
  let live = '';
  try { live = ((await (await fetch(`/sw.js?v=${Date.now()}`, { cache: 'no-store' })).text()).match(/ftb-v\d+/) || [''])[0]; } catch { return; }
  if (!live || live === APP_BUILD) return;
  try { if (sessionStorage.getItem('ftb_reloaded_for') === live) return; sessionStorage.setItem('ftb_reloaded_for', live); } catch { /* private mode */ }
  try { (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* fine */ }
  const busy = document.body.classList.contains('overlay-open') || document.querySelector('[role="dialog"]:not(.hidden), .fft-overlay, input:focus, textarea:focus');
  if (!busy) { location.reload(); return; }
  showToast('A fresh version is ready', 'Tap Update to get the latest.', 'info', { label: 'Update', run: () => location.reload() });
}
window.checkForNewBuild = checkForNewBuild;
setTimeout(checkForNewBuild, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForNewBuild(); });
const RATE_ASK_KEY = 'ftb_rate_ask_v1';
const RATE_ASK_EVERY = 120 * 864e5;

function loadRateAsk () { try { return JSON.parse(localStorage.getItem(RATE_ASK_KEY) || '{}') || {}; } catch { return {}; } }
function saveRateAsk (s) { try { localStorage.setItem(RATE_ASK_KEY, JSON.stringify(s)); } catch { /* storage full */ } }
function fiveStarVisits () { return (state.restaurants || []).reduce((n, r) => n + (r.visits || []).filter(v => Number(v.rating) === 5).length, 0); }

function maybeAskForRating () {
  const s = loadRateAsk();
  const five = fiveStarVisits();
  // Only a 5-star visit logged from now on counts, not the ones already there.
  if (s.five === undefined || five < s.five) { s.five = five; saveRateAsk(s); return; }
  if (five === s.five) return;
  s.five = five;
  saveRateAsk(s);
  noteGoodMoment();
}
// Something went well: ask now, if it's time.
function noteGoodMoment () {
  const s = loadRateAsk();
  const ready = !s.answered && !(s.at && Date.now() - s.at < RATE_ASK_EVERY)
    && (loadProductEvents().counts.app_opened || 0) >= 3 && (state.restaurants || []).length >= 3;
  if (!ready) return false;
  s.at = Date.now();
  saveRateAsk(s);
  setTimeout(() => whenCubQuiet(showRatePrompt), 1200);
  return true;
}
window.noteGoodMoment = noteGoodMoment;

function showRatePrompt () {
  if (document.getElementById('rate-prompt')) return;
  const box = document.createElement('div');
  box.id = 'rate-prompt';
  box.className = 'rate-prompt';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Enjoying Feed The Bear?');
  const answer = mood => { const st = loadRateAsk(); st.answered = mood; saveRateAsk(st); trackProductEvent(`rate_prompt_${mood}`); };
  const close = () => box.remove();
  const step = html => { box.innerHTML = `<button type="button" class="rate-close" aria-label="Close">✕</button>${html}`; box.querySelector('.rate-close').onclick = close; };
  step(`<div class="rate-title">Enjoying Feed The Bear?</div>
    <div class="rate-actions"><button type="button" class="btn-primary rate-love">Love it 🐻</button><button type="button" class="btn-ghost rate-meh">Not really</button></div>`);
  box.querySelector('.rate-love').onclick = () => {
    answer('love');
    const inApp = IS_ANDROID_APP;
    step(IS_IOS_APP
      ? `<div class="rate-title">That makes the bear happy!</div>
      <p class="rate-sub">Would you give us a quick rating on the App Store? It's the biggest help a small app can get.</p>
      <div class="rate-actions"><button type="button" class="btn-primary rate-ios">★ Rate Feed The Bear</button><button type="button" class="btn-ghost rate-share">Share instead</button></div>`
      : inApp
      ? `<div class="rate-title">That makes the bear happy!</div>
      <p class="rate-sub">Would you give us a quick rating on Google Play? It's the biggest help a small app can get.</p>
      <div class="rate-actions"><button type="button" class="btn-primary rate-play">★ Rate on Google Play</button><button type="button" class="btn-ghost rate-share">Share instead</button></div>`
      : `<div class="rate-title">That makes the bear happy!</div>
      <p class="rate-sub">Know someone who'd love it too? Sharing is the best thank-you.</p>
      <div class="rate-actions"><button type="button" class="btn-primary rate-share">Share Feed The Bear</button></div>`);
    box.querySelector('.rate-ios')?.addEventListener('click', () => {
      trackProductEvent('rate_app_store_opened');
      window.Capacitor?.Plugins?.ExternalLink?.requestReview?.().catch(() => {});
      close();
    });
    box.querySelector('.rate-play')?.addEventListener('click', () => {
      trackProductEvent('rate_play_opened');
      window.open(PLAY_URL, '_blank');
      close();
    });
    box.querySelector('.rate-share').onclick = async () => {
      const data = { title: 'Feed The Bear', text: 'I keep every restaurant I want to try in Feed The Bear. You should too:', url: 'https://www.feed-the-bear.com' };
      try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(`${data.text} ${data.url}`); showToast('Link copied', 'Paste it to a friend.', 'success'); } } catch { /* closed the share sheet */ }
      close();
    };
  };
  box.querySelector('.rate-meh').onclick = () => {
    answer('meh');
    step(`<div class="rate-title">Sorry about that. What should we fix?</div>
      <textarea class="form-input rate-text" rows="3" maxlength="2000" placeholder="Anything: a bug, something confusing, what you wish it did"></textarea>
      <div class="rate-actions"><button type="button" class="btn-primary rate-send">Send to the team</button></div>`);
    box.querySelector('.rate-send').onclick = async () => {
      const text = box.querySelector('.rate-text').value.trim();
      if (text.length < 3) { box.querySelector('.rate-text').focus(); return; }
      try {
        const headers = { 'Content-Type': 'application/json', ...(typeof ftbApiHeaders === 'function' ? await ftbApiHeaders() : {}) };
        const resp = await fetch('/api/feedback', { method: 'POST', headers, body: JSON.stringify({ text, mood: 'meh' }) });
        if (!resp.ok) throw new Error('send failed');
        showToast('Thank you', 'The team reads every note.', 'success');
        close();
      } catch {
        showToast('Could not send', 'Please try again in a moment.', 'error');
      }
    };
  };
  document.body.appendChild(box);
  trackProductEvent('rate_prompt_shown');
}

/* ── Duplicate spots ──────────────────────────────────────────
   The same restaurant saved twice ("Bacanora" from a search, "Bacanora PHX"
   from a TikTok) splits its visits and dishes across two cards. Pairs that
   are clearly one place get a "same place?" banner on the list; merging
   keeps everything from both. "Not the same" is remembered. */
function duplicateKey (a, b) { return [a.id, b.id].sort().join('|'); }

function looksLikeSamePlace (a, b) {
  if (a.placeId && a.placeId === b.placeId) return true;
  const na = normalizeName(a.name || ''), nb = normalizeName(b.name || '');
  if (!na || !nb) return false;
  const pinned = Number.isFinite(a.lat) && Number.isFinite(a.lng) && Number.isFinite(b.lat) && Number.isFinite(b.lng);
  const close = pinned && haversine(a.lat, a.lng, b.lat, b.lng) < 200;
  // Same name: the same place unless we know they're far apart (two locations of a chain).
  if (na === nb) return !pinned || close;
  // "Bacanora" and "Bacanora PHX": every word of the shorter name is in the longer one, and they're side by side.
  const ta = placeNameTokens(a.name), tb = placeNameTokens(b.name);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return close && short.length > 0 && short.every(t => long.includes(t));
}

function findDuplicateSpots () {
  const skip = new Set(state.settings.notDuplicates || []);
  const list = state.restaurants || [];
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (!skip.has(duplicateKey(list[i], list[j])) && looksLikeSamePlace(list[i], list[j])) pairs.push([list[i], list[j]]);
    }
  }
  return pairs;
}

// Folds `b` into `a` (the one saved first) and removes `b`. Nothing is lost.
function mergeSpots (a, b) {
  const rank = { again: 4, ok: 3, want: 2, skip: 1 };
  const [keep, drop] = String(a.dateAdded || '') <= String(b.dateAdded || '') ? [a, b] : [b, a];
  const visitKey = v => `${v.date}|${v.note || ''}|${v.dish || ''}`;
  const visits = [...(keep.visits || [])];
  (drop.visits || []).forEach(v => { if (!visits.some(x => visitKey(x) === visitKey(v))) visits.push(v); });
  const dishes = [...dishesOf(keep)];
  dishesOf(drop).forEach(d => {
    const same = dishes.find(x => dishKey(x.name) === dishKey(d.name));
    if (!same) dishes.push(d);
    else if ((rank[d.verdict] || 0) > (rank[same.verdict] || 0)) Object.assign(same, { verdict: d.verdict, rating: Math.max(same.rating || 0, d.rating || 0) });
  });
  const links = [...linksOf(keep)];
  linksOf(drop).forEach(l => { if (!links.some(x => x.url === l.url)) links.push(l); });
  const linked = keep.placeId ? keep : drop.placeId ? drop : keep;
  Object.assign(keep, {
    visits, dishes, links,
    tags: [...new Set([...(keep.tags || []), ...(drop.tags || [])])],
    status: keep.status === 'visited' || drop.status === 'visited' ? 'visited' : keep.status,
    myRating: Math.max(keep.myRating || 0, drop.myRating || 0),
    dateVisited: [keep.dateVisited, drop.dateVisited].filter(Boolean).sort().pop() || null,
    isFavorite: !!(keep.isFavorite || drop.isFavorite),
    photo: keep.photo || drop.photo || '',
    notes: [keep.notes, drop.notes].filter(Boolean).filter((n, i, all) => all.indexOf(n) === i).join('\n\n'),
    collectionId: keep.collectionId || drop.collectionId || null,
    name: linked.name, address: linked.address || keep.address || drop.address,
    lat: Number.isFinite(linked.lat) ? linked.lat : keep.lat ?? drop.lat, lng: Number.isFinite(linked.lng) ? linked.lng : keep.lng ?? drop.lng,
    placeId: linked.placeId || '', placeChecked: !!(keep.placeChecked || drop.placeChecked), placeSuggest: null,
    updatedAt: Date.now(),
  });
  state.restaurants = state.restaurants.filter(r => r.id !== drop.id);
  // Like a delete: otherwise the cloud copy of the merged-away spot comes back
  // on the next sync and the same pair is asked about again.
  recordRestaurantDeletion(drop.id);
  return keep;
}

function renderDuplicateBanner (grid) {
  const pairs = findDuplicateSpots();
  const [pair] = pairs;
  if (!pair) return;
  const [a, b] = pair;
  // How many extra copies there are (three of one place is two merges, not three pairs).
  const group = {};
  const root = id => (group[id] && group[id] !== id ? (group[id] = root(group[id])) : id);
  pairs.forEach(([x, y]) => { group[x.id] = root(x.id); group[y.id] = root(y.id); if (group[x.id] !== group[y.id]) group[root(y.id)] = root(x.id); });
  const extras = Object.keys(group).length - new Set(Object.keys(group).map(root)).size;
  const bar = document.createElement('div');
  bar.className = 'dupe-banner';
  bar.innerHTML = `<div class="dupe-q">Same place saved twice?${extras > 1 ? ` <span class="dupe-count">1 of ${extras}</span>` : ''}</div>
    <div class="dupe-names"><strong>${escHtml(a.name)}</strong> and <strong>${escHtml(b.name)}</strong>${a.address || b.address ? `<span>${escHtml(a.address || b.address)}</span>` : ''}</div>
    <div class="dupe-actions">
      <button type="button" class="btn-primary btn-sm dupe-merge">Merge them</button>
      <button type="button" class="btn-ghost btn-sm dupe-keep">They're different</button>
      ${extras > 1 ? `<button type="button" class="btn-ghost btn-sm dupe-merge-all">Merge all ${extras}</button>` : ''}
    </div>`;
  bar.querySelector('.dupe-merge').onclick = () => {
    const kept = mergeSpots(a, b);
    trackProductEvent('spots_merged');
    saveData();
    renderAll();
    showToast('Merged', `${kept.name} now has everything from both.`, 'success');
  };
  bar.querySelector('.dupe-merge-all')?.addEventListener('click', () => {
    // One pair at a time: a merge can change what the next pair is.
    let merged = 0;
    for (let next = findDuplicateSpots()[0]; next && merged < 200; next = findDuplicateSpots()[0]) { mergeSpots(next[0], next[1]); merged++; }
    trackProductEvent('spots_merged', { all: merged });
    saveData();
    renderAll();
    showToast('All merged', `${merged} duplicate${merged === 1 ? '' : 's'} folded together. Nothing was lost.`, 'success');
  });
  bar.querySelector('.dupe-keep').onclick = () => {
    state.settings.notDuplicates = [...(state.settings.notDuplicates || []), duplicateKey(a, b)].slice(-200);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
    renderCards();
  };
  grid.prepend(bar);
}

// After launch, quietly look up a few saved spots that have no info yet.
async function fillMissingPlaceInfo () {
  const todo = (state.restaurants || []).filter(r => !r.placeInfoAt && r.name).slice(0, 6);
  let changed = false;
  for (const r of todo) {
    if (await refreshPlaceInfo(r)) changed = true;
    await new Promise(res => setTimeout(res, 1200));
  }
  if (changed) renderCards();
}
window.addEventListener('load', () => setTimeout(fillMissingPlaceInfo, 5000));

/* ── Detail Modal ─────────────────────────────────────────── */
function deleteSavedRestaurant (id) {
  const r = state.restaurants.find(x => x.id === id);
  if (!r) {
    showToast('Place no longer saved', 'Refresh your list before trying again.', 'info');
    return;
  }
  if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
  state.restaurants = state.restaurants.filter(x => x.id !== id);
  state.selectedIds.delete(id);
  recordRestaurantDeletion([id]);
  saveData();
  renderAll();
  if (state.detailId === id) closeDetailModal();
  showToast('Deleted', `"${r.name}" removed from your list.`, 'info');
}

function openDetailModal (id) {
  flushDetailNotes();
  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;
  state.detailId = id;
  // A menu scan belongs to the spot it was taken at.
  const scan = document.getElementById('menu-scan-result');
  if (scan) { scan.classList.add('hidden'); scan.innerHTML = ''; }
  document.querySelector('.menu-scan-badge')?.classList.toggle('hidden', hasGrizzly());

  const [c1, c2] = cuisineGrad(r.cuisine);
  const hero = document.getElementById('detail-hero');
  if (r.photo || r.placePhoto) {
    const safePhoto = safeUrl(r.photo || r.placePhoto);
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

  fillDetailFacts(r);
  refreshPlaceInfo(r).then(() => {
    if (state.detailId === r.id) fillDetailFacts(r);
  });

  // The star row below already shows your rating; this tile shows your history.
  document.getElementById('detail-my-rating').innerHTML = visitsTileHtml(r);

  const notesEdit = document.getElementById('detail-notes-edit');
  if (notesEdit) notesEdit.value = r.notes || '';
  const notesSaved = document.getElementById('detail-notes-saved');
  if (notesSaved) notesSaved.textContent = '';
  renderDetailQuickCapture(r);

  const dist = distOf(r);
  const meta = [];
  if (dist < Infinity) meta.push(`📍 ${fmtDist(dist)} away`);
  meta.push(`📅 Added ${fmtDate(r.dateAdded)}`);
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
          <span class="visit-date">${v.date ? fmtDate(v.date) : 'Date not recorded'}</span>
          ${v.rating ? `<span class="visit-stars">${'\u2605'.repeat(v.rating)}</span>` : ''}
          ${v.note ? `<span class="visit-note">${escHtml(v.note)}</span>` : ''}
        </div>`).join('')
    : '<div class="visit-log-empty">No visits logged yet.</div>';

  document.getElementById('detail-checkin-btn').onclick = () => {
    const form = document.getElementById('detail-checkin-form');
    const isVisible = !form.classList.contains('hidden');
    form.classList.toggle('hidden', isVisible);
    if (!isVisible) {
      form.querySelector('.checkin-note').value = '';
      setCheckinStars(0);
      form.querySelector('.checkin-note').focus();
    }
  };

  document.getElementById('detail-checkin-submit').onclick = () => {
    const form = document.getElementById('detail-checkin-form');
    const note   = form.querySelector('.checkin-note').value.trim();
    const rating = parseInt(form.dataset.rating || '0') || 0;
    const visitEntry = { date: iso(), note, rating };
    const idx = state.restaurants.findIndex(x => x.id === id);
    if (idx !== -1) {
      if (!state.restaurants[idx].visits) state.restaurants[idx].visits = [];
      state.restaurants[idx].visits.push(visitEntry);
      state.restaurants[idx].status = 'visited';
      state.restaurants[idx].dateVisited = state.restaurants[idx].dateVisited || iso();
      if (rating) state.restaurants[idx].myRating = rating;
      state.restaurants[idx].updatedAt = Date.now();
      form.classList.add('hidden');
      saveData();
      renderAll();
      openDetailModal(id);
      showToast('✅ Checked In!', `Visit logged for ${state.restaurants[idx].name}`, 'success');
      celebrateMilestones();
    }
  };

  document.getElementById('detail-checkin-cancel').onclick = () => {
    document.getElementById('detail-checkin-form').classList.add('hidden');
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
  document.getElementById('detail-together-btn').onclick = () => askFriendToGo(r);
  renderDetailFriends(r);
  renderDetailLinks(r);
  document.getElementById('detail-book-btn').onclick = () => openPartnerSheet('book', r);
  document.getElementById('detail-order-btn').onclick = () => openPartnerSheet('order', r);
  document.getElementById('detail-edit-btn').onclick = () => { closeDetailModal(); openEditModal(r.id); };
  const closedBtn = document.getElementById('detail-closed-btn');
  closedBtn.textContent = isAvailableSpot(r) ? 'Mark permanently closed' : 'Mark reopened';
  closedBtn.setAttribute('aria-pressed', String(!isAvailableSpot(r)));
  closedBtn.onclick = () => {
    const closed = isAvailableSpot(r);
    if (closed && !confirm(`Mark "${r.name}" permanently closed? Your visits, ratings and photos stay saved, but it will no longer be suggested.`)) return;
    r.permanentlyClosed = closed;
    r.updatedAt = Date.now();
    localStorage.removeItem('ftb_area_sent_v1');
    saveData();
    NativeAlerts.schedule();
    shareNudgeArea();
    renderAll();
    openDetailModal(id);
    showToast(closed ? 'Marked permanently closed' : 'Marked reopened',
      closed ? 'Your history is kept. This place will not be suggested.' : 'This place can appear in suggestions again.', 'info');
  };
  document.getElementById('detail-delete-btn').onclick = () => deleteSavedRestaurant(id);

  const yoInput = document.getElementById('your-order-input');
  if (yoInput) yoInput.value = '';
  setYourOrderPending([]);
  renderYourOrder(id);

  document.getElementById('detail-overlay').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  // Reset check-in form so it starts collapsed on each open
  const checkinForm = document.getElementById('detail-checkin-form');
  if (checkinForm) {
    checkinForm.classList.add('hidden');
    checkinForm.dataset.rating = '0';
    const note = checkinForm.querySelector('.checkin-note');
    if (note) note.value = '';
    setCheckinStars(0);
  }
  // Phase 9 — load cuisine photo + hide stale AI summary
  loadDetailPhoto(r);
  const aiSumEl = document.getElementById('detail-ai-summary');
  if (aiSumEl) aiSumEl.classList.add('hidden');
}

function closeDetailModal () {
  flushDetailNotes();
  document.getElementById('detail-overlay').classList.add('hidden');
  maybeHideOverlay();
}

/* ── Detail Quick Capture: set rating / status / price inline ── */
function renderDetailQuickCapture (r) {
  const stars = document.querySelectorAll('#dq-stars .dq-star');
  stars.forEach(b => {
    b.classList.toggle('on', parseInt(b.dataset.val) <= (r.myRating || 0));
    b.setAttribute('aria-pressed', String(parseInt(b.dataset.val) === (r.myRating || 0)));
  });
  document.querySelectorAll('#dq-status .dq-seg-btn').forEach(b => {
    const selected = b.dataset.status === r.status;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('#dq-price .dq-seg-btn').forEach(b => {
    const selected = parseInt(b.dataset.price) === (r.priceRange || 0);
    b.classList.toggle('active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
}

/* Patch a restaurant in place, persist, and refresh the open detail + lists
   without closing the modal. */
function patchRestaurant (id, patch) {
  if (window._ftbAccountSwitching) return null;
  const i = state.restaurants.findIndex(x => x.id === id);
  if (i === -1) return null;
  Object.assign(state.restaurants[i], patch, { updatedAt: Date.now() });
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
      stars.classList.remove('just-set'); void stars.offsetWidth; stars.classList.add('just-set');
      if (val === 5) launchConfetti(1200);
      renderAll();
    });
  }

  const statusSeg = document.getElementById('dq-status');
  if (statusSeg) {
    statusSeg.addEventListener('click', e => {
      const btn = e.target.closest('[data-status]');
      if (!btn || !state.detailId) return;
      const status = btn.dataset.status;
      if (state.restaurants.find(x => x.id === state.detailId)?.status === status) return;
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
      renderAll();
    });
  }

  // Editable notes - autosave on input (debounced) + on blur
  const notes = document.getElementById('detail-notes-edit');
  if (notes) {
    let t = null;
    notes.addEventListener('input', () => {
      if (!state.detailId || window._ftbAccountSwitching) return;
      _pendingDetailNotes = { id: state.detailId, value: notes.value.trim(), generation: _dataGeneration };
      clearTimeout(_detailNotesTimer);
      _detailNotesTimer = setTimeout(() => {
        const id = _pendingDetailNotes?.id;
        if (!flushDetailNotes() || state.detailId !== id) return;
        const saved = document.getElementById('detail-notes-saved');
        if (saved) {
          saved.textContent = 'Saved ✓'; clearTimeout(t);
          t = setTimeout(() => { if (state.detailId === id) saved.textContent = ''; }, 1600);
        }
      }, 600);
    });
    notes.addEventListener('blur', flushDetailNotes);
  }
}

let _pendingDetailNotes = null;
let _detailNotesTimer = null;
function flushDetailNotes () {
  clearTimeout(_detailNotesTimer);
  const pending = _pendingDetailNotes;
  _pendingDetailNotes = null;
  if (!pending || pending.generation !== _dataGeneration || window._ftbAccountSwitching) return false;
  return !!patchRestaurant(pending.id, { notes: pending.value });
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
/* Place search on the form's name field: the same Google search as Add a
   spot. Picking a result links the spot to that place (address, location,
   ratings); typing without picking just renames it. */
let _formPlace = null;
let _formPlaceTimer = null;
let _formPlaceSeq = 0;
let _formPlaceResults = [];
let _formMedia = [];

function setFormMedia (media = []) {
  media = mergeFoodMedia([], media);
  _formMedia = media;
  const preview = document.getElementById('form-media-preview');
  if (preview) {
    preview.classList.toggle('hidden', !media.length);
    preview.innerHTML = media.length ? pendingMediaHtml(media) : '';
  }
  if (media.length) document.getElementById('form-photo').value = media[0].photo;
}

function clearFormPlaceSearch () {
  clearTimeout(_formPlaceTimer);
  _formPlaceSeq++;
  _formPlaceResults = [];
  const box = document.getElementById('form-name-suggs');
  if (box) { box.innerHTML = ''; box.classList.add('hidden'); }
}

function searchFormPlaces () {
  const q = document.getElementById('form-name').value.trim();
  clearFormPlaceSearch();
  if (q.length < 3) return;
  const seq = _formPlaceSeq;
  _formPlaceTimer = setTimeout(async () => {
    const at = Number.isFinite(state.userLat) ? `&lat=${state.userLat.toFixed(2)}&lng=${state.userLng.toFixed(2)}` : '';
    let places = [];
    try {
      const resp = await apiGet(`/api/place-info?mode=search&q=${encodeURIComponent(q)}${at}`);
      if (resp.ok) places = (await resp.json())?.places || [];
    } catch { /* offline: the name still saves as typed */ }
    if (seq !== _formPlaceSeq || document.getElementById('modal-overlay').classList.contains('hidden')) return;
    _formPlaceResults = places.filter(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!_formPlaceResults.length) return;
    const box = document.getElementById('form-name-suggs');
    box.innerHTML = _formPlaceResults.map((p, i) => {
      const dist = Number.isFinite(state.userLat) ? fmtDist(haversine(state.userLat, state.userLng, p.lat, p.lng)) : '';
      const meta = [p.rating ? `★ ${p.rating.toFixed(1)}` : '', p.address, dist].filter(Boolean).join(' · ');
      return `<button type="button" class="qa-sugg" data-i="${i}"><strong>${escHtml(p.name)}</strong>${meta ? `<span>${escHtml(meta)}</span>` : ''}</button>`;
    }).join('');
    box.classList.remove('hidden');
  }, 500);
}

function pickFormPlace (p) {
  _formPlace = p;
  document.getElementById('form-name').value = p.name;
  document.getElementById('form-address').value = p.address || '';
  if (p.rating) {
    document.getElementById('form-google-rating').value = p.rating;
    document.getElementById('form-google-reviews').value = p.reviews || '';
  }
  const cuisine = document.getElementById('form-cuisine');
  // "Mexican Restaurant" -> "Mexican"; a plain "Restaurant" says nothing.
  const kind = String(p.kind || '').replace(/\s*(restaurant|food|place)$/i, '').replace(/^(restaurant|food)$/i, '').trim();
  if (!cuisine.value.trim() && kind) cuisine.value = kind;
  const price = document.getElementById('form-price');
  if (p.priceLevel && !Number(price.value)) price.value = p.priceLevel;
  clearFormPlaceSearch();
}

function openAddModal () {
  invalidateFoodMedia();
  setFormMedia([]);
  state.editingId = null;
  _pendingAddPrefill = null;
  _formPlace = null;
  clearFormPlaceSearch();
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
  invalidateFoodMedia();
  setFormMedia([]);
  const r = state.restaurants.find(x => x.id === id);
  if (!r) return;
  state.editingId = id;
  state.formRating = r.myRating || 0;
  _formPlace = null;
  clearFormPlaceSearch();

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
  invalidateFoodMedia();
  clearFormPlaceSearch();
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

function setCheckinStars (n) {
  const form = document.getElementById('detail-checkin-form');
  if (!form) return;
  form.dataset.rating = n;
  form.querySelectorAll('.checkin-star').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.val) <= n);
  });
}

function handleFormSubmit (e) {
  e.preventDefault();
  if (foodMediaBusy() || window._ftbAccountSwitching) { showToast('Please wait', 'Finish adding media before saving.', 'info'); return; }
  const name = document.getElementById('form-name').value.trim();
  if (!name) { showToast('Missing Name', 'Please enter a restaurant name.', 'error'); return; }

  const status = document.querySelector('input[name="form-status"]:checked')?.value || 'want-to-try';
  const isNew  = !state.editingId;

  // Free plan: cap at FREE_RESTAURANT_LIMIT spots
  if (isNew && typeof isPremium === 'function' && !isPremium() && state.restaurants.length >= FREE_RESTAURANT_LIMIT) {
    showToast('Cub limit reached', `Cub includes up to ${FREE_RESTAURANT_LIMIT} spots. Upgrade to Grizzly for unlimited saves.`, 'info');
    showGrizzlyUpsell('limit');
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
    updatedAt:     Date.now(),
    dateVisited:   status === 'visited'
      ? (document.getElementById('form-date-visited').value ||
         state.restaurants.find(r => r.id === state.editingId)?.dateVisited || (isNew && _pendingAddPrefill?.quickUnknownDate ? null : now))
      : null,
  };
  if (_formMedia.length) setMediaOn(entry, _formMedia);

  if (isNew && _pendingAddPrefill && normalizeName(_pendingAddPrefill.name || name) === normalizeName(name)) {
    if (_pendingAddPrefill.sourceUrl && safeUrl(_pendingAddPrefill.sourceUrl)) {
      entry.links = [{ url: String(_pendingAddPrefill.sourceUrl).slice(0, 500), added: now }];
    }
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

  // A place picked from the search (and not renamed after): link to it.
  const picked = _formPlace && normalizeName(_formPlace.name) === normalizeName(name) ? _formPlace : null;
  if (picked) {
    entry.lat = picked.lat;
    entry.lng = picked.lng;
    entry.placeId = picked.placeId || '';
    // Hours, phone and Maps link were for whatever it matched before; look them up again.
    Object.assign(entry, { placeInfoAt: 0, hours: [], periods: [], phone: '', mapsUrl: '', placePhoto: '', placePhotoAt: 0, placeChecked: true, placeSuggest: null });
    _placeInfoTried.delete(entry.id);
    _spotPhotoTried.delete(entry.id);
  }

  if (state.editingId) {
    // Preserve lat/lng from original
    const orig = state.restaurants.find(r => r.id === state.editingId);
    if (!picked) {
      entry.lat = orig?.lat || null;
      entry.lng = orig?.lng || null;
    }
    entry.visits = orig?.visits || [];
    // Keep everything the form doesn't edit (dishes, favorite, photos, ...).
    state.restaurants = state.restaurants.map(r => r.id === state.editingId ? { ...orig, ...entry } : r);
    showToast('Updated', `"${name}" was refreshed in your list.`, 'success');
  } else {
    entry.visits = [];
    if (status === 'visited' && _formMedia.length) {
      const visit = { date: entry.dateVisited, rating: entry.myRating, dish: '', note: '' };
      setMediaOn(visit, _formMedia);
      entry.visits.push(visit);
    }
    state.restaurants.unshift(entry);
    showToast('Saved', `"${name}" is now on your list.`, 'success');
  }

  if (isNew && _pendingAddPrefill?.quickDish) {
    upsertDish(entry, { name: _pendingAddPrefill.quickDish,
      verdict: status === 'visited' ? _pendingAddPrefill.quickVerdict : 'want',
      media: _formMedia, date: status === 'visited' ? entry.dateVisited || '' : iso() });
    if (entry.visits[0]) entry.visits[0].dish = _pendingAddPrefill.quickDish;
  }

  // Geocode in background if address provided
  if (picked) {
    const saved = state.restaurants.find(r => r.id === entry.id);
    refreshPlaceInfo(saved).then(found => { if (found) renderAll(); });
  } else if (address) geocodeAddress(entry.id, address);

  saveData();
  renderAll();
  closeModal();
  if (isNew && typeof offerShareMeal === 'function') offerShareMeal({ r: state.restaurants.find(r => r.id === entry.id), photo: entry.photo, video: entry.video || '', media: mediaOf(entry), note: entry.notes });
  _pendingAddPrefill = null;
  _formPlace = null;
}

/* ── Geocode via Nominatim (free, no API key) ─────────────── */
async function geocodeAddress (id, address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'FeedTheBear/1.0 (github.com/cmc-creator/Feed-The-Bear)' } });
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

function buildGooglePlaceSearchUrl (place) {
  const dest = buildDirectionsDestination(place);
  if (!dest) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`;
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
  if (r.lat && r.lng) {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`, '_blank', 'noopener');
  } else if (r.address) {
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

/* ── Book a table / Order delivery ────────────────────────── */
// Each service's own search for this spot. Once an affiliate program approves
// the app, put its code in PARTNER_REFS, in either form the program gives:
//   - a tracking link with {url} where the page goes (Impact, CJ, Partnerize):
//       'https://ubereats.example-network.com/c/123/456?u={url}'
//   - extra query text added to the page's own link: 'ref=feedthebear'
// Set in the owner portal (owner.js 'partners'), fetched at most every few hours.
const PARTNER_REFS = { opentable: '', resy: '', yelp: '', doordash: '', ubereats: '', grubhub: '', shop: '' };
(function loadPartnerRefs () {
  const KEY = 'ftb_partner_refs_v1';
  const apply = refs => {
    Object.keys(PARTNER_REFS).forEach(k => { if (typeof refs?.[k] === 'string') PARTNER_REFS[k] = refs[k]; });
    // The merch shop (owner portal): a Bear Shop row in Account once it's set.
    const row = document.getElementById('account-shop-row');
    if (row) { row.classList.toggle('hidden', !/^https:\/\//.test(PARTNER_REFS.shop)); if (PARTNER_REFS.shop) row.href = PARTNER_REFS.shop; }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) apply(saved.refs);
    if (saved && Date.now() - saved.at < 6 * 3600 * 1000) return;
  } catch { /* bad value */ }
  setTimeout(() => fetch('/api/owner?partners=1').then(r => (r.ok ? r.json() : null)).then(d => {
    if (!d?.partners) return;
    apply(d.partners);
    try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), refs: d.partners })); } catch { /* storage full */ }
  }).catch(() => {}), 4000);
})();
function partnerUrl (key, url) {
  const code = String(PARTNER_REFS[key] || '').trim();
  if (!code) return url;
  if (code.includes('{url}')) return code.replace('{url}', encodeURIComponent(url));
  return url + (url.includes('?') ? '&' : '?') + code.replace(/^[?&]/, '');
}
function partnerLinks (kind, r) {
  const name = encodeURIComponent(r.name || '');
  const city = String(r.address || '').split(',').slice(-3, -1).join(',').trim();
  const where = encodeURIComponent(city || r.address || '');
  const near = Number.isFinite(Number(r.lat)) && r.lat != null ? `&latitude=${Number(r.lat)}&longitude=${Number(r.lng)}` : '';
  if (kind === 'book') {
    return [
      { key: 'opentable', label: 'OpenTable', url: partnerUrl('opentable', `https://www.opentable.com/s?term=${name}${near}`) },
      { key: 'resy', label: 'Resy', url: partnerUrl('resy', `https://resy.com/search?query=${name}`) },
      { key: 'yelp', label: 'Yelp', url: partnerUrl('yelp', `https://www.yelp.com/search?find_desc=${name}&find_loc=${where}`) },
      r.phone ? { key: 'call', label: 'Call them', url: `tel:${String(r.phone).replace(/[^\d+]/g, '')}`, note: r.phone } : null,
    ].filter(Boolean);
  }
  return [
    { key: 'doordash', label: 'DoorDash', url: partnerUrl('doordash', `https://www.doordash.com/search/store/${name}/`) },
    { key: 'ubereats', label: 'Uber Eats', url: partnerUrl('ubereats', `https://www.ubereats.com/search?q=${name}`) },
    { key: 'grubhub', label: 'Grubhub', url: partnerUrl('grubhub', `https://www.grubhub.com/search?queryText=${name}`) },
  ];
}

function openPartnerSheet (kind, r) {
  if (!r?.name) return;
  const links = partnerLinks(kind, r);
  document.getElementById('partner-title').textContent = kind === 'book' ? `Book ${r.name}` : `Order from ${r.name}`;
  document.getElementById('partner-sub').textContent = kind === 'book'
    ? 'Pick where to reserve. Not every spot takes reservations online.'
    : 'Pick an app. Not every spot delivers, so the app may show similar places.';
  const box = document.getElementById('partner-links');
  box.innerHTML = links.map(l => `<a href="${escHtml(l.url)}" target="_blank" rel="noopener" data-partner="${l.key}">${escHtml(l.label)}${l.note ? `<span>${escHtml(l.note)}</span>` : '<span>›</span>'}</a>`).join('');
  box.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    trackProductEvent('partner_click', { kind, partner: a.dataset.partner });
    setTimeout(closePartnerSheet, 200);
  }));
  document.getElementById('partner-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closePartnerSheet () {
  document.getElementById('partner-overlay')?.classList.add('hidden');
  if (document.getElementById('detail-overlay')?.classList.contains('hidden')) maybeHideOverlay();
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
  showToast('Reminder Set!', `We'll remind you on ${when.toLocaleDateString()} at ${when.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`, 'success');
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
  state.mapLeaflet.on('zoomend', drawMapPins);
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
  state.mapPins = [];
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
  state.mapPins = mapRows.map(r => ({ r, marker: buildMapMarker(r) }));
  const bounds = mapRows.map(r => [r.lat, r.lng]);
  if (bounds.length === 1) {
    state.mapLeaflet.setView(bounds[0], 14, { animate: false });
  } else {
    state.mapLeaflet.fitBounds(bounds, { padding: [50, 50], animate: false });
  }
  drawMapPins();
  setTimeout(() => { state.mapLeaflet.invalidateSize(); drawMapPins(); }, 150);
}

// Pins closer than this on screen merge into one numbered pin, so two spots
// on the same block don't hide each other. Tapping it zooms in to split them.
const MAP_GROUP_PX = 44;
function drawMapPins () {
  const map = state.mapLeaflet;
  if (!map || !state.mapPins) return;
  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];
  const zoom = map.getZoom();
  const groups = [];
  state.mapPins.forEach(pin => {
    const pt = map.project([pin.r.lat, pin.r.lng], zoom);
    const g = groups.find(x => x.pt.distanceTo(pt) < MAP_GROUP_PX);
    if (g) g.pins.push(pin); else groups.push({ pt, pins: [pin] });
  });
  groups.forEach(g => {
    if (g.pins.length === 1) {
      const m = g.pins[0].marker.addTo(map);
      m.spotCount = 1;
      state.mapMarkers.push(m);
      return;
    }
    const n = g.pins.length;
    const visited = g.pins.every(p => !p.r._nearbyElement && p.r.status === 'visited');
    const icon = L.divIcon({
      className: '',
      html: `<div class="map-group-pin${visited ? ' visited' : ''}" aria-label="${n} places">${n}</div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -26],
    });
    const lls = g.pins.map(p => [p.r.lat, p.r.lng]);
    const center = lls.reduce((a, b) => [a[0] + b[0] / n, a[1] + b[1] / n], [0, 0]);
    const m = L.marker(center, { icon, keyboard: true, title: `${n} places` }).addTo(map);
    m.spotCount = n;
    m.on('click', () => {
      const b = L.latLngBounds(lls);
      const sameSpot = b.getNorthEast().equals(b.getSouthWest(), 1e-5);
      if (!sameSpot && map.getZoom() < map.getMaxZoom() - 1) {
        map.fitBounds(b, { padding: [70, 70], maxZoom: map.getMaxZoom() });
        return;
      }
      // Too close to split by zooming: list them instead.
      const rows = g.pins.map(p => (p.r._nearbyElement
        ? `<div class="map-group-row"><span>${cuisineEmoji(p.r.cuisine)}</span><b>${escHtml(p.r.name)}</b></div>`
        : `<button type="button" class="map-group-row" onclick="window.__ftbOpenDetail('${escJsArg(p.r.id)}')"><span>${cuisineEmoji(p.r.cuisine)}</span><b>${escHtml(p.r.name)}</b><i>Details ›</i></button>`)).join('');
      m.bindPopup(`<div class="map-group-list">${rows}</div>`, { maxWidth: 260 }).openPopup();
    });
    state.mapMarkers.push(m);
  });
}

function buildMapMarker (r) {
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
        ? `<button onclick="openAddModalPreFilled('${escJsArg(r.name || '')}','${escJsArg(r.cuisine || '')}',{name:'${escJsArg(r.name || '')}',address:'${escJsArg(r.address || '')}',website:'${escJsArg(r.website || '')}',lat:${Number.isFinite(r.lat) ? Number(r.lat) : 'null'},lon:${Number.isFinite(r.lng) ? Number(r.lng) : 'null'}})" style="flex:1;padding:5px 8px;background:#E8B15A;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Save</button>`
        : `<button onclick="window.__ftbOpenDetail('${r.id}')" style="flex:1;padding:5px 8px;background:#E8B15A;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Details</button>`}
      ${(r.address || (Number.isFinite(r.lat) && Number.isFinite(r.lng))) ? `<button onclick="window.__ftbDirections('${r.id}')" style="flex:1;padding:5px 8px;background:#9B7BE0;color:#fff;border:none;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer">Directions</button>` : ''}
    </div>
  </div>`;
  return L.marker([r.lat, r.lng], { icon })
    .bindPopup(popup, { maxWidth: 250, closeButton: true });
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
function openAddPlace () {
  if (window.Cub) window.Cub.openAdd(); else openAddModal();
}

// The gold + button: save a place, or log a meal you just had (Just Ate is
// off the lean home, so it lives here, one tap away).
function closeAddChoice () {
  const el = document.getElementById('add-choice');
  if (!el) return;
  el.classList.add('closing');
  setTimeout(() => el.remove(), 180);
}
function openAddChoice () {
  if (document.getElementById('add-choice')) { closeAddChoice(); return; }
  const el = document.createElement('div');
  el.id = 'add-choice';
  el.className = 'add-choice';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Add');
  el.innerHTML = `<div class="add-choice-sheet">
    <button type="button" class="add-choice-btn add-choice-place"><span class="add-choice-icon" aria-hidden="true">📍</span><span><strong>Add a place</strong><small>Somewhere to try, or one you love</small></span></button>
    <button type="button" class="add-choice-btn add-choice-ate"><span class="add-choice-icon" aria-hidden="true">🍽️</span><span><strong>I just ate</strong><small>Log it in 10 seconds</small></span></button>
  </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) closeAddChoice(); });
  el.querySelector('.add-choice-place').addEventListener('click', () => { el.remove(); trackProductEvent('add_choice_place'); openAddPlace(); });
  el.querySelector('.add-choice-ate').addEventListener('click', () => { el.remove(); trackProductEvent('add_choice_ate'); openJustAte(); });
  el.querySelector('.add-choice-place').focus();
}
window.openAddChoice = openAddChoice;

function renderAll () {
  // A soft ring on the Add button until someone has saved a few places.
  const spotCount = (state.restaurants || []).length;
  document.body.classList.toggle('add-hint', spotCount < 3);
  // Today's pick doesn't wait for nearby results (Grizzly's AI pick does).
  try { if (!usesAiDailyPick()) showLocalDailyPick(); } catch (err) { console.warn('[FTB] daily pick:', err); }
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
  // grizzly.js can still be loading on a slow connection.
  [function renderGrizzlyUi () { window.renderGrizzlyUi?.(); }, function renderBearChallenges () { window.renderFoodChallengesHome?.(); }, maybeAskForRating, renderTodayStatusRow, renderWeeklyGoal, renderOpenNowHome, renderCraveHome, renderFriendsFeedHome, renderForYouHome, renderWeeklyRecapHome, renderMoodPicksHome]
  .forEach(fn => { try { fn(); } catch (err) { console.error(`${fn.name} failed:`, err); window.ftbReportError?.(err?.message || err, fn.name); } });
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
/* Every message comes from Byte Cub: one speech bubble with his face, one at
   a time. A burst waits its turn (errors go first, repeats are dropped); a new
   one cuts the current short once it has been up a moment, so nothing piles
   up on screen. Optional `action` = { label, run } adds a button. */
const _cubSay = { queue: [], el: null, shownAt: 0, timer: null };
function showToast (title, msg, type = 'default', action = null) {
  const item = { title: String(title || '').replace(/\s+/g, ' ').trim(), msg: String(msg || '').replace(/\s+/g, ' ').trim(), type, action };
  if (!item.title && !item.msg) return;
  const same = x => x && x.title === item.title && x.msg === item.msg;
  if ((_cubSay.el?.isConnected && same(_cubSay.el._item)) || _cubSay.queue.some(same)) return;
  if (type === 'error') _cubSay.queue.unshift(item); else _cubSay.queue.push(item);
  if (_cubSay.queue.length > 4) _cubSay.queue.splice(_cubSay.queue.findIndex(x => x.type !== 'error'), 1);
  if (!_cubSay.el?.isConnected) { _nextCubSay(); return; }
  // Something is up: let it stay a moment, then make room.
  clearTimeout(_cubSay.timer);
  _cubSay.timer = setTimeout(_dismissCubSay, type === 'error' ? 0 : Math.max(0, 1100 - (Date.now() - _cubSay.shownAt)));
}
function _dismissCubSay () {
  clearTimeout(_cubSay.timer);
  const el = _cubSay.el;
  _cubSay.el = null;
  if (el?.isConnected) { el.classList.add('removing'); setTimeout(() => el.remove(), 220); }
  setTimeout(_nextCubSay, el?.isConnected ? 160 : 0);
}
function _nextCubSay () {
  if (_cubSay.el?.isConnected) return;
  const item = _cubSay.queue.shift();
  const container = document.getElementById('toast-container');
  document.body.classList.toggle('cub-talking', !!item);
  if (!item || !container) return;
  const el = document.createElement('div');
  el.className = `toast cub-say ${item.type}`;
  el.setAttribute('role', item.type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<img class="cub-say-face" src="assets/cub-avatar.jpg" alt="" aria-hidden="true" />
  <div class="toast-body">
    ${item.title ? `<div class="toast-title">${escHtml(item.title)}</div>` : ''}
    ${item.msg ? `<div class="toast-msg">${escHtml(item.msg)}</div>` : ''}
    ${item.action?.label ? `<button type="button" class="btn-sm btn-orange cub-say-act">${escHtml(item.action.label)}</button>` : ''}
  </div>
  <button class="toast-close" aria-label="Dismiss">✕</button>`;
  el._item = item;
  el.querySelector('.toast-close').onclick = e => { e.stopPropagation(); _dismissCubSay(); };
  el.querySelector('.cub-say-act')?.addEventListener('click', e => { e.stopPropagation(); _dismissCubSay(); try { item.action.run(); } catch (err) { console.warn(err); } });
  // Tapping the bubble itself dismisses it.
  el.addEventListener('click', e => { if (!e.target.closest('a, button')) _dismissCubSay(); });
  container.replaceChildren(el);
  _cubSay.el = el;
  _cubSay.shownAt = Date.now();
  const read = Math.min(4000, (item.title.length + item.msg.length) * 35);
  _cubSay.timer = setTimeout(_cubSayTimeUp, (item.type === 'error' ? 5000 : 3000) + read + (item.action ? 4000 : 0));
}
// A share card or rate prompt hides Byte Cub's bubble; keep it until that
// closes, then give it a few seconds so the message is actually seen.
const CUB_HUSH = '#rate-prompt, .share-nudge, #save-diary-nudge, .photo-reveal, .ff-overlay';
function _cubSayTimeUp () {
  const el = _cubSay.el;
  if (el?.isConnected && !el.classList.contains('error') && document.querySelector(CUB_HUSH)) {
    el._held = true;
    _cubSay.timer = setTimeout(_cubSayTimeUp, 700);
    return;
  }
  if (el?._held) { el._held = false; _cubSay.shownAt = Date.now(); _cubSay.timer = setTimeout(_dismissCubSay, 3500); return; }
  _dismissCubSay();
}
// Floating prompts (rate us, share nudges) wait until Byte Cub is quiet.
function whenCubQuiet (fn, tries = 20) {
  const busy = _cubSay.el?.isConnected || _cubSay.queue.length || document.querySelector(CUB_HUSH);
  if (!busy || tries <= 0) { fn(); return; }
  setTimeout(() => whenCubQuiet(fn, tries - 1), 1500);
}
window.whenCubQuiet = whenCubQuiet;

/* ════════════════════════════════════════════════════════════
   CHAT BUDDY - BYTE CUB
   ════════════════════════════════════════════════════════════ */
const GREETINGS = [
  "Hey! I'm Byte Cub, your food assistant. Tell me where you ate (\"I went to Tacos Chiwas, had the birria, 5 stars\") and I'll log it, or ask me to save a place, pick dinner, or show your lists.",
  "Hi foodie! Try \"add Bacanora to my want to try\", \"what should I eat tonight?\" or \"I had lunch at Pizzeria Bianco, 4 stars\". I'll take care of it.",
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
  const rows = (Array.isArray(_homeDiscCache?.elements) ? _homeDiscCache.elements : []).filter(isCredibleFoodVenue);
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
    priceRange: 0,
    website: cleanVenueWebsite(tags.website || tags['contact:website'] || tags.url || ''),
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
  .filter(isAvailableSpot)
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
  const unvisited = state.restaurants.filter(r => isAvailableSpot(r) && r.status === 'want-to-try' && r.googleRating > 0);
  if (!unvisited.length) {
  const top = state.restaurants.filter(isAvailableSpot).sort((a,b) => (b.googleRating||0) - (a.googleRating||0)).slice(0,3);
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
  const cheap = state.restaurants.filter(r => isAvailableSpot(r) && r.priceRange === 1);
  if (!cheap.length) return `No budget spots on your list yet. Add some $ restaurants and I'll help you find a bargain! `;
  const items = cheap.slice(0,4).map(r =>
  `<span class="chip-link" data-id="${r.id}">${cuisineEmoji(r.cuisine)} ${r.name} ($)</span>`
  ).join('');
  return `Budget eats on your list! \n${items}`;
}

function fancyResponse () {
  const fancy = state.restaurants.filter(r => isAvailableSpot(r) && r.priceRange >= 3);
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
  isAvailableSpot(r) && (r.cuisine||'').toLowerCase() === cuisine.toLowerCase()
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
  (!isAvailableSpot(r) ? 'Permanently closed. Your history is kept.\n' : '') +
  (r.googleRating ? `⭐ Google: ${r.googleRating}/5\n` : '') +
  (r.myRating ? `⭐ Your rating: ${r.myRating}/5\n` : '') +
  (r.address ? ` ${r.address}${distStr}\n` : '') +
  (r.priceRange ? ` ${priceDollars(r.priceRange)}\n` : '') +
  (r.tags?.length ? ` Tags: ${r.tags.join(', ')}\n` : '') +
  (r.notes ? `\n "${r.notes}"` : '') +
  `\n\n<span class="chip-link" data-id="${r.id}">View full details</span>`;
}

function surpriseMeResponse () {
  const available = state.restaurants.filter(isAvailableSpot);
  const unvisited = available.filter(r => r.status === 'want-to-try');
  const pool = unvisited.length ? unvisited : available;
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
  'What should I eat tonight?',
  'Show my want to try',
  'Show where I have been',
  'Surprise me!',
  'Date night ideas',
  'Invite a friend',
];

function randomFrom (arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ── Chat UI ──────────────────────────────────────────────── */
// Byte Cub is the cub; you are your profile photo or bear.
function setChatAvatar (el, role) {
  if (role === 'bot') {
  el.innerHTML = '<img src="assets/cub-avatar.jpg" alt="Byte Cub" />';
  return;
  }
  const profile = loadUserProfile() || {};
  if (profile.photo) el.innerHTML = `<img src="${escHtml(profile.photo)}" alt="You" />`;
  else renderAvatarInto(el, profile.avatar);
}

function addChatMsg (text, role = 'bot') {
  const messages = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  setChatAvatar(avatar, role);

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
  setChatAvatar(avatar, 'bot');

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

/* ── Byte Cub, the assistant ─────────────────────────────────────
   Understands everyday asks and does them: "I went to Tacos Chiwas, had
   the birria, 5 stars" logs it; "add Bacanora to my want to try" saves
   it; "what should I eat?" picks; "show my want to try" opens the list.
   Anything else goes to the AI (Grizzly) or the built-in answers. */
let _cubChatHistory = [];

// Bot message with tappable buttons: [{ label, run, primary }]
function cubSay (text, buttons = []) {
  addChatMsg(text, 'bot');
  _cubChatHistory.push({ role: 'assistant', text });
  CubChats.record('b', text);
  if (!buttons.length) return;
  const row = document.createElement('div');
  row.className = 'chat-actions';
  buttons.forEach(b => {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = b.primary ? 'btn-primary btn-sm' : 'btn-secondary btn-sm';
  el.textContent = b.label;
  el.addEventListener('click', () => {
    row.querySelectorAll('button').forEach(x => { x.disabled = true; });
    b.run();
  });
  row.appendChild(el);
  });
  const messages = document.getElementById('chat-messages');
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

const MEAL_WORDS = /^(breakfast|brunch|lunch|dinner|drinks|dessert|coffee|food|a bite|something)\b/i;

function starsFromText (t) {
  const n = t.match(/\b([1-5])(?:\s*\/\s*5|\s*out of\s*5)?\s*(?:stars?|★)/i) || t.match(/\b([1-5])\s*(?:out of\s*5|\/\s*5)\b/i);
  if (n) return Number(n[1]);
  if (/\b(loved|amazing|incredible|perfect|best|10\/10|obsessed)\b/i.test(t)) return 5;
  if (/\b(great|really good|delicious|so good)\b/i.test(t)) return 4;
  if (/\b(good|solid|nice)\b/i.test(t)) return 4;
  if (/\b(ok|okay|fine|meh|alright|average)\b/i.test(t)) return 3;
  if (/\b(bad|disappointing|not great|didn'?t like|overrated)\b/i.test(t)) return 2;
  if (/\b(terrible|awful|gross|worst)\b/i.test(t)) return 1;
  return 0;
}

// "Tacos Chiwas and had the birria, 5 stars" -> "Tacos Chiwas"
function placeFromText (rest) {
  return String(rest)
  .split(/\s*(?:,|\.(?:\s|$)|!|\?|\s-\s|\s+[1-5]\s*(?:stars?|\/|out of)|\s+and\s+(?:had|got|ordered|tried|it|we|i)\b|\s+(?:had|got|ordered|it was|it's|was|for (?:dinner|lunch|breakfast|brunch)|last night|today|yesterday|tonight|this (?:morning|afternoon|evening))\b)/i)[0]
  .replace(/^(?:the\s+)/i, m => (/^the\s+[a-z]/i.test(rest) ? m : ''))
  .replace(/["“”]/g, '').trim().slice(0, 80);
}

// The first "had the X" / "got the X" that is a dish, not "had dinner at …".
function dishFromText (t) {
  const re = /\b(?:had|got|ordered|tried|ate)\s+(?:the\s+|a\s+|an\s+|some\s+)?([^,.!?]+?)(?=\s*(?:,|\.|!|\?|$|\s+and\b|\s+it\b|\s+which\b|\s+(?:[1-5])\s*(?:stars?|\/)))/gi;
  for (const m of t.matchAll(re)) {
  const dish = m[1].trim();
  if (dish && !MEAL_WORDS.test(dish) && !/^at\b|\bat\s/i.test(dish) && dish.length <= 60) return dish;
  }
  return '';
}

function parseCubCommand (text) {
  const t = text.trim();
  const low = t.toLowerCase();
  if (/\b(?:eating|food|bear)\s+(?:contests?|competitions?|challenges?)\b/.test(low)) return { kind: 'contests' };
  if (/\b(show|open|see|view|go to|pull up)\b.*\b(want[- ]to[- ]try|wish ?list|to[- ]try)\b/.test(low)) return { kind: 'list', view: 'want-to-try' };
  if (/\b(show|open|see|view|pull up)\b.*\b(been there|visited|places i('ve| have) (been|eaten)|where i('ve| have) (been|eaten))\b/.test(low)) return { kind: 'list', view: 'visited' };
  if (/\b(show|open|see)\b.*\bmy lists?\b/.test(low)) return { kind: 'list', view: 'lists' };
  const noteMatch = t.match(/\b(?:and\s+)?(?:note|remember)(?:\s+that)?\s+(.+)$/i);
  const note = noteMatch ? noteMatch[1].trim() : '';
  const request = noteMatch ? t.slice(0, noteMatch.index).replace(/[,\s]+$/, '') : t;
  let m = request.match(/\b(?:add|save|put|move|mark)\s+(.+?)\s+(?:to|on|in|as)\s+(?:my\s+)?(?:visited|visitied|been[- ]there)(?:\s+list)?[.!]?\s*$/i);
  if (m) {
    const name = placeFromText(m[1]).replace(/^the\s+/i, '');
    if (name.length >= 2) return { kind: 'log', name, dish: dishFromText(request), stars: starsFromText(request), note };
  }
  m = request.match(/\b(?:went to|ate at|eaten at|been to|visited|tried|stopped at|stopped by|had (?:breakfast|brunch|lunch|dinner|drinks|dessert|coffee) at|grabbed (?:breakfast|brunch|lunch|dinner|food|a bite) at)\s+(.+)/i)
  || request.match(/\blog\s+(?:(?:a\s+)?(?:visit|meal)\s+(?:to|at|for)\s+)?(.+)/i);
  if (m) {
  const name = placeFromText(m[1]);
  if (name.length >= 2) return { kind: 'log', name, dish: dishFromText(request), stars: starsFromText(request), note };
  }
  m = request.match(/\b(?:add|save|put)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+)?(?:want[- ]to[- ]try|list|wish ?list|to[- ]try)/i)
  || request.match(/\bi\s+want to try\s+(.+)/i) || request.match(/^(?:can you\s+)?(?:please\s+)?(?:add|save)\s+(.+)/i);
  if (m) {
  const name = placeFromText(m[1]);
  if (name.length >= 2) return { kind: 'want', name, note };
  }
  const food = foodToFind(t);
  if (food) return { kind: 'find', food };
  if (/\b(what|where)\b.*\b(eat|go|dinner|lunch|breakfast|brunch|tonight)\b|\bpick (?:for me|something|a place)\b|\bi'?m hungry\b|\bhelp me (?:decide|choose)\b/.test(low)) return { kind: 'pick' };
  if (/\binvite\b/.test(low)) return { kind: 'invite' };
  if (/\b(dinner vote|group vote|vote)\b/.test(low)) return { kind: 'vote' };
  if (/\bimport\b/.test(low)) return { kind: 'import' };
  return null;
}

// "places to get subs near me", "where can I get pho", "find me tacos nearby"
// → "subs" / "pho" / "tacos". '' when it isn't a search for real places.
const NEAR_WORDS = /\b(?:near(?:by| me| here)|around (?:me|here)|close (?:by|to me)|in (?:the|my) area|in town)\b/i;
function foodToFind (t) {
  const low = t.toLowerCase().replace(/[?.!]+$/, '');
  const asks = NEAR_WORDS.test(low)
  || /\bwhere (?:can|could|should|do) (?:i|we) (?:get|find|grab|buy)\b/.test(low)
  || /\b(?:find|search for|look for|looking for|show me|recommend|suggest)\b.*\b(?:places?|spots?|restaurants?|shops?)\b/.test(low)
  || /\bfind me\b/.test(low);
  if (!asks) return '';
  const food = low
  .replace(NEAR_WORDS, ' ')
  .replace(/\b(?:can|could|would) you\b|\bplease\b|\b(?:i|we) (?:want|need|feel like|am craving|'?m craving)\b|\bi'?m (?:looking|craving)\b/g, ' ')
  .replace(/\bwhere (?:can|could|should|do) (?:i|we) (?:get|find|grab|buy)\b/g, ' ')
  .replace(/\b(?:show|find|search|look(?:ing)?|recommend|suggest|give|tell)(?: me| us)?(?: for)?\b/g, ' ')
  .replace(/\b(?:is|are) there\b|\bwhat(?:'?s| is)\b|\bwhats\b|\b(?:anything|something|to eat|eat)\b/g, ' ')
  .replace(/\b(?:some|any|good|great|best|the|a|an|me|us|of|my|nice|cheap|local)\b/g, ' ')
  .replace(/\b(?:places?|spots?|restaurants?|shops?|options?|joints?)\b(?:\s+(?:to|for|that|which|with|where))?(?:\s+(?:get|eat|grab|have|serve|serves|sell|sells|has|find))?/g, ' ')
  .replace(/\b(?:to|for)\s+(?:get|eat|grab|have)\b/g, ' ')
  .replace(/[^\p{L}\p{N}&' -]/gu, ' ')
  .replace(/\s+/g, ' ').trim()
  .replace(/^(?:for|to|get|eat)\s+/, '').trim();
  if (/\b(?:my|saved|list|been there|want to try)\b/.test(food)) return '';
  return food.length >= 2 && food !== 'food' ? food.slice(0, 60) : 'restaurants';
}

// Real places near you for a food ("subs"), whether or not you've saved any.
async function cubFindNearby (food) {
  showTyping();
  const here = await ensureLocationForDiscovery() && Number.isFinite(state.userLat);
  if (!here) {
    hideTyping();
    cubSay("I couldn't get your location just now. Make sure location is allowed for Feed The Bear, then tap below.",
      [{ label: '📍 Try again', primary: true, run: () => cubFindNearby(food) }]);
    return;
  }
  const found = await searchRealPlaces(food.length < 3 ? `${food} restaurant` : food);
  hideTyping();
  const places = found
    .map(p => ({ ...p, m: Number.isFinite(p.lat) ? haversine(state.userLat, state.userLng, p.lat, p.lng) : null }))
    .filter(p => p.m == null || p.m < 40000)
    .sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity));
  trackProductEvent('cub_find_nearby', { results: places.length });
  if (!places.length) {
    cubSay(`I couldn't find ${food} near you. Try another word, like "sandwiches" or "pizza".`);
    return;
  }
  const lines = places.map((p, i) => {
  const bits = [p.m != null ? fmtDist(p.m) : '', p.rating ? `★ ${p.rating.toFixed(1)}` : '', p.address.split(',')[0]].filter(Boolean);
  return `${i + 1}. **${p.name}**${bits.length ? `: ${bits.join(' · ')}` : ''}`;
  });
  cubSay(`Closest spots for ${food} near you:\n${lines.join('\n')}\n\nTap one to save it to Want to Try.`,
    places.slice(0, 4).map((p, i) => ({ label: `🔖 ${p.name}`, primary: i === 0, run: () => {
      const r = savedSpotNamed(p.name, p);
      if (r) { cubSay(`**${r.name}** is already saved.`, [{ label: 'Open it', primary: true, run: () => { closeChat(); openDetailModal(r.id); } }]); return; }
      const spot = createSpotFrom({ found: p, status: 'want-to-try' });
      if (spot) { saveData(); renderAll(); cubAddWant(spot); }
    } })));
}

function savedSpotNamed (name, place = null) {
  const key = normalizeName(name);
  const matches = state.restaurants.filter(r => normalizeName(r.name) === key);
  if (place?.placeId) {
    const exact = matches.find(r => r.placeId === place.placeId);
    if (exact) return exact;
  }
  if (place?.address) return matches.find(r => normalizeName(r.address) === normalizeName(place.address)) || null;
  return matches.length === 1 ? matches[0] : null;
}

// Creates a spot from a real place (or just a name). Respects the Cub limit.
function createSpotFrom ({ found = null, name = '', status = 'want-to-try' }) {
  const atLimit = typeof isPremium === 'function' && !isPremium() && state.restaurants.length >= FREE_RESTAURANT_LIMIT;
  const today = iso();
  const kind = String(found?.kind || '').replace(/\s*(restaurant|food|place)$/i, '').replace(/^(restaurant|food)$/i, '');
  const r = {
  id: uid(), name: String(found?.name || name).slice(0, 80), cuisine: kind.slice(0, 40), priceRange: found?.priceLevel || 0,
  address: found?.address || '', lat: Number.isFinite(found?.lat) ? found.lat : null, lng: Number.isFinite(found?.lng) ? found.lng : null,
  placeId: found?.placeId || '', website: '', photo: '', googleRating: found?.rating || 0, googleReviews: found?.reviews || 0, myRating: 0, notes: '', tags: [],
  collectionId: null, priority: '', status, dateAdded: today, dateVisited: status === 'visited' ? today : null,
  updatedAt: Date.now(), visits: [], links: [],
  };
  // Over the free limit: it waits and is saved the moment they go Grizzly.
  if (atLimit) { holdSpotForGrizzly(r); return null; }
  state.restaurants.unshift(r);
  return r;
}

function cubSaveNote (r, note = '') {
  if (!note) return;
  r.notes = [r.notes, note].filter(Boolean).join('\n');
}

function cubLogVisit (r, { dish = '', stars = 0, note = '' } = {}) {
  if (!Array.isArray(r.visits)) r.visits = [];
  r.visits.push({ date: iso(), note, rating: stars, dish, photo: '' });
  cubSaveNote(r, note);
  r.status = 'visited';
  r.dateVisited = r.dateVisited || iso();
  if (stars) r.myRating = stars;
  r.updatedAt = Date.now();
  if (dish) upsertDish(r, { name: dish, verdict: stars >= 4 ? 'again' : stars && stars <= 2 ? 'skip' : 'ok', rating: stars || undefined });
  saveData();
  renderAll();
  trackProductEvent('cub_logged_visit', { hasDish: !!dish, stars });
  const bits = [stars ? '★'.repeat(stars) : '', dish ? `the ${dish}` : ''].filter(Boolean).join(' and ');
  cubSay(`Done! **${r.name}**${r.address ? ` (${r.address})` : ''} is on your Been There list${bits ? ` with ${bits}` : ''}.${note ? `\nSaved note: ${note}` : ''} 🐻`, [
  { label: '📸 Add photos', primary: true, run: () => { closeChat(); openDetailModal(r.id); } },
  ...(stars ? [] : [{ label: '⭐ Rate it', run: () => cubAskStars(r) }]),
  { label: 'See Been There', run: () => { closeChat(); setView('visited'); } },
  ]);
  if (typeof celebrateMilestones === 'function') celebrateMilestones();
}

function cubAskStars (r) {
  cubSay(`How many stars for ${r.name}?`, [1, 2, 3, 4, 5].map(n => ({
  label: '★'.repeat(n), run: () => {
    r.myRating = n;
    const v = (r.visits || []).at(-1);
    if (v) v.rating = n;
    r.updatedAt = Date.now();
    saveData(); renderAll();
    cubSay(`Got it: ${'★'.repeat(n)} for ${r.name}.`);
  },
  })));
}

function cubAddWant (r) {
  trackProductEvent('cub_added_want', {});
  cubSay(`Saved **${r.name}** to your Want to Try list${r.address ? ` (${r.address})` : ''}. 🔖`, [
  { label: 'See Want to Try', primary: true, run: () => { closeChat(); setView('want-to-try'); } },
  { label: 'Open it', run: () => { closeChat(); openDetailModal(r.id); } },
  ]);
}

// Finds the place you mean: one of yours, or real ones to choose from.
async function cubResolve (name, onPick) {
  const generation = _dataGeneration;
  const choose = onPick;
  onPick = value => { if (generation === _dataGeneration && !window._ftbAccountSwitching) choose(value); };
  const query = name.replace(/^the\s+/i, '').trim();
  const branch = query.match(/^(.+?)\s+(?:on|at|in|near)\s+(.+)$/i);
  const key = normalizeName(branch ? branch[1] : query);
  const locationKey = branch ? normalizeName(branch[2]) : '';
  const matchesBranch = p => !locationKey || normalizeName(`${p.name} ${p.address || ''}`).includes(locationKey);
  const saved = state.restaurants.filter(r => normalizeName(r.name) === key && matchesBranch(r));
  if (saved.length === 1) { onPick({ r: saved[0] }); return; }
  if (saved.length > 1) {
    cubSay('You have more than one saved location. Which one?', saved.map(r => ({
      label: `${r.name}${r.address ? ` · ${r.address}` : ' · address not saved'}`,
      run: () => onPick({ r }),
    })));
    return;
  }
  showTyping();
  const found = (await searchRealPlaces(query)).filter(p => normalizeName(p.name).includes(key) && matchesBranch(p));
  if (generation !== _dataGeneration) return;
  hideTyping();
  if (!found.length) {
  cubSay(`I couldn't verify "${name}" on the map. I won't substitute another location. Want me to save it with just the name?`, [
    { label: `Yes, use "${name}"`, primary: true, run: () => onPick({ name }) },
  ]);
  return;
  }
  if (found.length === 1) {
  const f = found[0];
  cubSay(`Is it **${f.name}**${f.address ? `, ${f.address}` : ''}?`, [
    { label: 'Yes', primary: true, run: () => {
      const r = savedSpotNamed(f.name, f);
      onPick(r ? { r } : { found: f });
    } },
    ...(found.length > 1 ? [{ label: 'No, show others', run: () => cubChoose(found.slice(1), name, onPick) }] : [{ label: `No, just "${name}"`, run: () => onPick({ name }) }]),
  ]);
  return;
  }
  cubChoose(found, name, onPick);
}

function cubChoose (found, name, onPick) {
  cubSay('Which one?', [
  ...found.slice(0, 4).map(f => ({ label: `${f.name}${f.address ? ` · ${f.address}` : ''}`, run: () => {
    const r = savedSpotNamed(f.name, f);
    onPick(r ? { r } : { found: f });
  } })),
  { label: `Just "${name}"`, run: () => onPick({ name }) },
  ]);
}

async function handleCubCommand (cmd) {
  if (cmd.kind === 'contests') {
    cubSay('Open Bear Challenges on Home, or its shortcut in Play / Discover. You can browse restaurant challenges, upcoming competitions, source links and your saved events, or filter by state and city.', [
      { label: 'Open eating competitions', primary: true, run: () => { closeChat(); openFoodEvents(); } },
    ]);
    return;
  }
  if (cmd.kind === 'list') {
  cubSay(cmd.view === 'visited' ? 'Here are the places you have been.' : cmd.view === 'want-to-try' ? 'Here is your Want to Try list.' : 'Here are your lists.');
  setTimeout(() => { closeChat(); setView(cmd.view); }, 500);
  return;
  }
  if (cmd.kind === 'log') {
  await cubResolve(cmd.name, ({ r, found, name }) => {
    const spot = r || createSpotFrom({ found, name, status: 'visited' });
    if (spot) cubLogVisit(spot, cmd);
  });
  return;
  }
  if (cmd.kind === 'want') {
  await cubResolve(cmd.name, ({ r, found, name }) => {
    if (r) {
      if (cmd.note) { cubSaveNote(r, cmd.note); r.updatedAt = Date.now(); saveData(); renderAll(); }
      cubSay((r.status === 'visited' ? `You've already been to **${r.name}**! It's on your Been There list.` : `**${r.name}** is already on your Want to Try list.`) + (cmd.note ? `\nSaved note: ${cmd.note}` : ''), [
        { label: 'Open it', primary: true, run: () => { closeChat(); openDetailModal(r.id); } },
      ]);
      return;
    }
    const spot = createSpotFrom({ found, name, status: 'want-to-try' });
    if (spot) { cubSaveNote(spot, cmd.note); saveData(); renderAll(); cubAddWant(spot); }
  });
  return;
  }
  if (cmd.kind === 'pick') {
  const saved = _decisionModeState;
  _decisionModeState = { mood: mealtimeOf() === 'dinner' ? 'comfort' : 'quick', budget: 0, miles: 10, party: 2, with: [] };
  let top = [];
  try { top = buildDecisionModeShortlist().filter(x => nearEnoughToSuggest(x.r)); } finally { _decisionModeState = saved; }
  if (!top.length) {
    cubSay('Save a few places first and I can pick for you. Want to add one?', [{ label: '＋ Add a place', primary: true, run: () => { closeChat(); openAddPlace(); } }]);
    return;
  }
  cubSay(`My picks for ${MEALTIME_LABEL[mealtimeOf()]}:\n${top.map((x, i) => `${i + 1}. **${x.r.name}**: ${x.reasons.filter(r => !/fast decision pick|balanced overall/.test(r)).slice(0, 2).join(', ') || x.r.cuisine || 'a good fit'}`).join('\n')}`,
    [...top.map((x, i) => ({ label: x.r.name, primary: i === 0, run: () => { closeChat(); openDetailModal(x.r.id); } })),
      { label: 'Put them to a vote', run: () => { closeChat(); openDinnerRooms(top.map(x => x.r.id)); } }]);
  return;
  }
  if (cmd.kind === 'find') { await cubFindNearby(cmd.food); return; }
  if (cmd.kind === 'invite') { cubSay('Sending an invite. They will see your picks and can follow you.'); inviteFriend(); return; }
  if (cmd.kind === 'vote') { closeChat(); openDinnerRooms(); return; }
  if (cmd.kind === 'import') { closeChat(); showImportBookmarks(); }
}

/* Byte Cub asked you something ("What did you order at Bacanora?"), so the
   next thing you type is the answer, not a new request. */
let _cubAwaiting = null; // { kind: 'dish', rid, want }

function askDishInChat (rid) {
  const r = state.restaurants.find(x => x.id === rid);
  if (!r) return;
  const want = r.status !== 'visited';
  openChat();
  _cubAwaiting = { kind: 'dish', rid, want };
  cubSay(want
    ? `Heard what to order at ${r.name}? Type the dish and I'll put it on your Crave List.`
    : `What did you order at ${r.name}? Type the dish (or a few, with commas) and I'll remember it.`, [
    { label: 'Not sure', run: () => { _cubAwaiting = null; skipCubAsk(rid); cubSay('No problem! Ask me anything else.'); } },
  ]);
}
window.askDishInChat = askDishInChat;

// "Not sure": don't ask about that place again (cub.js pickTip reads this).
function skipCubAsk (rid) {
  try {
    const list = JSON.parse(localStorage.getItem('ftb_cub_ask_skip_v1') || '[]');
    localStorage.setItem('ftb_cub_ask_skip_v1', JSON.stringify([...new Set([...(Array.isArray(list) ? list : []), rid])].slice(-200)));
  } catch { /* private mode */ }
}

function answerCubQuestion (text) {
  const ask = _cubAwaiting;
  _cubAwaiting = null;
  const r = state.restaurants.find(x => x.id === ask.rid);
  if (!r) return false;
  if (/^(no|nope|nah|not sure|idk|i don'?t (know|remember)|nothing|skip|never ?mind|cancel)\b/i.test(text)) {
    skipCubAsk(r.id);
    cubSay('No problem! Ask me anything else.');
    return true;
  }
  const dishes = text.replace(/^(i (had|ordered|got|tried)|we (had|got)|the|they have|heard( about)?|try)\s+/i, '')
    .split(/\s*(?:,|\band\b|&|\+)\s*/i).map(s => s.replace(/[.!]+$/, '').replace(/^(a|an|the|some)\s+/i, '').trim()).filter(s => s && s.length <= 60).slice(0, 5);
  if (!dishes.length) return false;
  dishes.forEach(name => upsertDish(r, { name, verdict: ask.want ? 'want' : 'ok' }));
  r.updatedAt = Date.now();
  saveData();
  renderAll();
  trackProductEvent('cub_dish_answered', { count: dishes.length, want: ask.want });
  const list = dishes.join(', ');
  if (ask.want) {
    cubSay(`Saved! ${list} ${dishes.length === 1 ? 'is' : 'are'} on your Crave List for ${r.name}.`, [
      { label: `Open ${r.name}`, primary: true, run: () => { closeChat(); openDetailModal(r.id); } },
    ]);
    return true;
  }
  const verdictButtons = dish => ['again', 'ok', 'skip'].map(v => ({
    label: DISH_VERDICT_LABEL[v], primary: v === 'again',
    run: () => { upsertDish(r, { name: dish, verdict: v }); r.updatedAt = Date.now(); saveData(); renderAll(); cubSay(v === 'again' ? 'Noted. A keeper!' : v === 'skip' ? "Noted. I'll steer you away from it." : 'Noted.'); },
  }));
  cubSay(`Got it: ${list} at ${r.name}. ${dishes.length === 1 ? 'Would you order it again?' : 'Saved them all.'}`,
    dishes.length === 1 ? verdictButtons(dishes[0]) : [{ label: `Open ${r.name}`, run: () => { closeChat(); openDetailModal(r.id); } }]);
  return true;
}

async function sendChat (message) {
  if (window._ftbAccountSwitching) return;
  const generation = _dataGeneration;
  const input = document.getElementById('chat-input');
  const text = (typeof message === 'string' ? message : input.value).trim();
  if (!text) return;
  input.value = '';
  addChatMsg(text, 'user');
  _cubChatHistory.push({ role: 'user', text });
  CubChats.record('u', text);

  // An answer to Byte Cub's question, unless it's clearly a new question or request.
  if (_cubAwaiting) {
    if (/\?\s*$/.test(text) || parseCubCommand(text)) _cubAwaiting = null;
    else if (answerCubQuestion(text)) return;
  }

  const cmd = parseCubCommand(text);
  if (cmd) { trackProductEvent('cub_command', { kind: cmd.kind }); await handleCubCommand(cmd); return; }

  // A place you saved, by name: open it.
  const named = savedSpotNamed(text);
  if (named) {
  cubSay(restaurantDetailResponse(named), [{ label: `Open ${named.name}`, primary: true, run: () => { closeChat(); openDetailModal(named.id); } }]);
  return;
  }

  showTyping();
  if (window.AI?.hasAccess?.()) {
    try {
      const area = await userAreaName();
      if (generation !== _dataGeneration) return;
      const reply = await AI.chat(text, _cubChatHistory.slice(-12), state.restaurants, area);
      if (generation !== _dataGeneration) return;
      hideTyping();
      // He asks the app to search real places near you rather than asking where you are.
      const find = String(reply).match(/\[\[\s*FIND:\s*([^\]]{2,60})\]\]/i);
      if (find) { await cubFindNearby(find[1].trim().toLowerCase()); return; }
      if (!String(reply).trim()) throw new Error('Byte Cub returned an empty answer.');
      cubSay(reply);
      return;
    } catch (err) {
      if (generation !== _dataGeneration) return;
      console.warn('[FTB] Byte Cub chat failed:', err);
      hideTyping();
      cubSay("I couldn't reach the AI just now. Here's what I can tell from your saved list:\n\n" + chatResponse(text));
      return;
    }
  }
  setTimeout(() => { if (generation === _dataGeneration) { hideTyping(); cubSay(chatResponse(text)); } }, 350);
}

function openChat () {
  document.getElementById('chat-panel').classList.remove('hidden');
  document.getElementById('ui-overlay').classList.remove('hidden');
  document.body.classList.add('chat-open');
  document.getElementById('chat-input').focus();

  // Your last conversation is still here; otherwise a fresh hello.
  const messages = document.getElementById('chat-messages');
  if (!messages.children.length && !CubChats.restore()) {
  addChatMsg(randomFrom(GREETINGS), 'bot');
  renderQuickReplies();
  }
}

/* ── Byte Cub chat history ──────────────────────────────────────
   Every chat is kept: on this phone (the newest 10 in full) and, signed in,
   on your account (api/chats.js, the newest 30), so "Past chats" can pick
   any of them up again on any device and Byte Cub remembers what was said. */
const CubChats = (() => {
  const KEY = 'ftb_cub_chats_v1';
  const LOCAL_FULL = 10, KEEP = 30, MAX_MSGS = 80, MAX_TEXT = 1500;
  let saveTimer = null;

  function load () {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
    if (!d || typeof d !== 'object' || !d.chats || typeof d.chats !== 'object') d = { uid: '', current: '', chats: {} };
    // Chats from a different account on this phone aren't yours.
    if (d.uid && window._ftbUid && d.uid !== window._ftbUid) d = { uid: window._ftbUid, current: '', chats: {} };
    return d;
  }
  function store (d) {
    d.uid = window._ftbUid || d.uid || '';
    const list = Object.values(d.chats).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, KEEP);
    d.chats = {};
    list.forEach((c, i) => { d.chats[c.id] = i < LOCAL_FULL || c.id === d.current ? c : { ...c, messages: null }; });
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage full: the account copy still has it */ }
  }
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => (b % 36).toString(36)).join('') + Date.now().toString(36);
  const titleOf = c => (c.messages || []).find(m => m.r === 'u')?.t.slice(0, 60) || 'Chat with Byte Cub';

  async function api (method, { query = '', body = null } = {}) {
    if (!window._ftbUid) return null;
    const headers = { 'Content-Type': 'application/json', ...(typeof ftbApiHeaders === 'function' ? await ftbApiHeaders() : {}) };
    const resp = await fetch(`/api/chats${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return resp.ok ? resp.json().catch(() => ({})) : null;
  }

  function record (r, t) {
    const text = String(t ?? '').trim().slice(0, MAX_TEXT);
    if (!text) return;
    const d = load();
    let c = d.current && d.chats[d.current];
    if (!c || !Array.isArray(c.messages)) { c = { id: newId(), title: '', updatedAt: 0, messages: [] }; d.current = c.id; }
    c.messages = [...c.messages, { r, t: text, at: Date.now() }].slice(-MAX_MSGS);
    c.updatedAt = Date.now();
    c.title = titleOf(c);
    c.count = c.messages.length;
    d.chats[c.id] = c;
    store(d);
    // A chat with only Byte Cub talking isn't worth keeping on the account yet.
    if (c.messages.some(m => m.r === 'u')) {
      clearTimeout(saveTimer);
      const generation = _dataGeneration;
      saveTimer = setTimeout(() => {
        if (generation !== _dataGeneration) return;
        api('POST', { body: { id: c.id, title: c.title, messages: c.messages } })
          .catch(err => console.warn('[FTB] Chat backup failed:', err));
      }, 1500);
    }
  }

  function show (c) {
    const box = document.getElementById('chat-messages');
    box.innerHTML = '';
    document.getElementById('chat-suggestions').innerHTML = '';
    _cubChatHistory = [];
    _cubAwaiting = null;
    (c.messages || []).forEach(m => {
      addChatMsg(m.t, m.r === 'u' ? 'user' : 'bot');
      _cubChatHistory.push({ role: m.r === 'u' ? 'user' : 'assistant', text: m.t });
    });
  }

  // Opening the chat: your last conversation, if there is one.
  function restore () {
    const d = load();
    const c = d.current && d.chats[d.current];
    if (!c || !Array.isArray(c.messages) || !c.messages.some(m => m.r === 'u')) return false;
    show(c);
    return true;
  }

  function startNew () {
    const d = load();
    d.current = '';
    store(d);
    closeHistory();
    document.getElementById('chat-messages').innerHTML = '';
    _cubChatHistory = [];
    _cubAwaiting = null;
    addChatMsg(randomFrom(GREETINGS), 'bot');
    renderQuickReplies();
    document.getElementById('chat-input')?.focus();
  }

  function when (ms) {
    const d = new Date(ms);
    const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
    if (days <= 0) return `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function drawList (note = '') {
    const d = load();
    const el = document.getElementById('chat-history-list');
    const list = Object.values(d.chats).filter(c => (c.count || c.messages?.length)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    el.innerHTML = list.length
      ? list.map(c => `<div class="chat-history-row${c.id === d.current ? ' current' : ''}">
          <button type="button" class="chat-history-open" data-id="${escHtml(c.id)}">
            <strong>${escHtml(c.title || 'Chat with Byte Cub')}</strong>
            <span>${escHtml(when(c.updatedAt || 0))} · ${c.count || c.messages?.length || 0} messages${c.id === d.current ? ' · open now' : ''}</span>
          </button>
          <button type="button" class="icon-btn chat-history-del" data-id="${escHtml(c.id)}" aria-label="Delete this chat">✕</button>
        </div>`).join('')
      : `<div class="chat-history-empty">${note || 'No past chats yet. Tell Byte Cub where you ate, or ask him anything, and the chat is kept here.'}</div>`;
  }

  async function showHistory () {
    const generation = _dataGeneration;
    document.getElementById('chat-history').classList.remove('hidden');
    document.getElementById('chat-panel').classList.add('history-open');
    drawList(window._ftbUid ? 'Looking for your chats…' : '');
    try {
      const data = await api('GET');
      if (generation !== _dataGeneration) return;
      if (Array.isArray(data?.chats)) {
        const d = load();
        data.chats.forEach(s => {
          if (!/^[a-z0-9]{8,32}$/.test(s.id || '')) return;
          const mine = d.chats[s.id];
          if (!mine || (s.updatedAt || 0) > (mine.updatedAt || 0)) d.chats[s.id] = { id: s.id, title: String(s.title || ''), updatedAt: Number(s.updatedAt) || 0, count: Number(s.count) || 0, messages: null };
        });
        store(d);
      }
    } catch { /* show what this phone has */ }
    if (!document.getElementById('chat-history').classList.contains('hidden')) drawList();
  }
  function closeHistory () {
    document.getElementById('chat-history')?.classList.add('hidden');
    document.getElementById('chat-panel')?.classList.remove('history-open');
  }

  async function openById (id) {
    const generation = _dataGeneration;
    const d = load();
    let c = d.chats[id];
    if (!c) return;
    if (!Array.isArray(c.messages)) {
      const data = await api('GET', { query: `?id=${encodeURIComponent(id)}` }).catch(() => null);
      if (generation !== _dataGeneration) return;
      if (!data?.chat) { showToast("Couldn't open that chat", 'Check your connection and try again.', 'error'); return; }
      c = { ...c, ...data.chat, count: data.chat.messages.length };
    }
    const fresh = load();
    fresh.chats[id] = c;
    fresh.current = id;
    store(fresh);
    closeHistory();
    show(c);
    cubSayQuiet('Picking up where we left off. What else?');
    document.getElementById('chat-input')?.focus();
  }
  // A note from Byte Cub that isn't saved into the chat itself.
  function cubSayQuiet (text) { addChatMsg(text, 'bot'); }

  function remove (id) {
    const d = load();
    delete d.chats[id];
    const wasCurrent = d.current === id;
    if (wasCurrent) d.current = '';
    store(d);
    api('POST', { body: { action: 'delete', id } }).catch(() => {});
    drawList();
    if (wasCurrent) document.getElementById('chat-messages').innerHTML = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('chat-history-btn')?.addEventListener('click', () => {
      if (document.getElementById('chat-history').classList.contains('hidden')) showHistory(); else closeHistory();
    });
    document.getElementById('chat-history-back')?.addEventListener('click', () => {
      closeHistory();
      if (!document.getElementById('chat-messages').children.length && !restore()) startNew();
    });
    document.getElementById('chat-new-btn')?.addEventListener('click', startNew);
    document.getElementById('chat-history-list')?.addEventListener('click', e => {
      const del = e.target.closest('.chat-history-del');
      if (del) { remove(del.dataset.id); return; }
      const open = e.target.closest('.chat-history-open');
      if (open) openById(open.dataset.id);
    });
  });

  function resetSession () {
    clearTimeout(saveTimer);
    _cubChatHistory = [];
    _cubAwaiting = null;
    closeHistory();
    document.getElementById('chat-messages')?.replaceChildren();
    document.getElementById('chat-history-list')?.replaceChildren();
    document.getElementById('chat-suggestions')?.replaceChildren();
  }

  return { record, restore, startNew, showHistory, closeHistory, openById, resetSession };
})();
window.CubChats = CubChats;

function closeChat () {
  document.getElementById('chat-panel').classList.add('hidden');
  document.body.classList.remove('chat-open');
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

/* Escape a value for use inside a single-quoted JS string literal that lives
   in an inline HTML event attribute (e.g. onclick="fn('HERE')").
   Order matters: JS-escape first, then HTML-escape the result, because the
   browser HTML-decodes the attribute before the JS parser sees it. */
function escJsArg (s) {
  return escHtml(String(s ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/'/g, "\\'")
  .replace(/\r?\n/g, '\\n'));
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
  if (!['https:', 'http:'].includes(parsed.protocol)) return '';
  return parsed.href.replace(/["'()\\]/g, '');
  } catch { return ''; }
}

function fmtDate (str) {
  if (!str) return '';
  try {
  // A bare YYYY-MM-DD parses as UTC midnight, which shows the previous day
  // west of UTC. Read it as a local date instead.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return str; }
}

function hideBanner (id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// While a search is typed, home sections step aside so the matches show
// right under the search bar instead of far below them.
function renderSearchMode () {
  const q = String(state.filter.search || '').trim();
  const main = document.getElementById('main-content');
  if (!main) return;
  const on = !!q && !['map', 'stats'].includes(state.currentView);
  main.classList.toggle('is-searching', on);
  let bar = document.getElementById('search-summary');
  if (!on) { bar?.remove(); document.getElementById('search-nearby-results')?.remove(); BackNav.layer('search', false); return; }
  if (!bar) {
  bar = document.createElement('div');
  bar.id = 'search-summary';
  bar.className = 'search-summary';
  main.prepend(bar);
  }
  const n = getFiltered().length;
  const nearby = _nearbyCards.filter(card => !card.isSaved && matchesRestaurantSearch(card, q)
    && (!state.filter.cuisine || cuisineFilterKey(card.cuisine) === cuisineFilterKey(state.filter.cuisine)));
  let results = document.getElementById('search-nearby-results');
  if (nearby.length) {
    if (!results) { results = document.createElement('section'); results.id = 'search-nearby-results'; bar.after(results); }
    results.innerHTML = `<h2>Nearby matches · not saved</h2><div class="search-nearby-grid">${nearby.map(renderNearbyVisualCard).join('')}</div>`;
    wireNearbyCardLinks(results);
  } else { results?.remove(); }
  bar.innerHTML = `<span>${n ? `${n} spot${n === 1 ? '' : 's'} match` : nearby.length ? `${nearby.length} nearby spot${nearby.length === 1 ? '' : 's'} match` : 'Nothing matches'} “${escHtml(q)}”</span>
  ${n ? '' : `<button type="button" class="btn-ghost btn-sm" data-act="nearby">Search nearby</button>`}
  <button type="button" class="btn-ghost btn-sm" data-act="clear">Clear</button>`;
  bar.querySelector('[data-act=clear]').onclick = () => { clearSearch(); };
  const near = bar.querySelector('[data-act=nearby]');
  if (near) near.onclick = () => { const term = q; clearSearch(); openDiscoverSearch(term); };
  window.scrollTo({ top: 0 });
  BackNav.layer('search', true);
}

function clearSearch () {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  state.filter.search = '';
  updateClearBtn();
  renderCards();
  renderSearchMode();
}

// Discover with the search box filled in (for spots you haven't saved).
function openDiscoverSearch (term) {
  return discoverNearby({ query: term });
}

function initDialogFocus () {
  const origins = new Map();
  let top = null;
  let lastFocused = document.activeElement;
  const visible = el => el.isConnected && el.getClientRects().length && !el.closest('.hidden') && getComputedStyle(el).visibility !== 'hidden';
  const controls = dialog => [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
    .filter(el => !el.matches(':disabled') && el.tabIndex >= 0 && visible(el));
  const refresh = (origin = document.activeElement) => {
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(visible)
      .sort((a, b) => (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0));
    dialogs.forEach(dialog => { if (!origins.has(dialog)) origins.set(dialog, origin); });
    const next = dialogs.at(-1) || null;
    if (next !== top) {
      const previous = top;
      top = next;
      if (top) top.tabIndex = -1;
      const trigger = previous && !dialogs.includes(previous) ? origins.get(previous) : null;
      if (trigger && visible(trigger) && (!top || top.contains(trigger))) trigger.focus({ preventScroll: true });
      else if (top && !top.contains(document.activeElement)) {
        (controls(top)[0] || top).focus({ preventScroll: true });
      }
    }
    for (const dialog of origins.keys()) if (!dialogs.includes(dialog)) origins.delete(dialog);
  };
  new MutationObserver(() => refresh()).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('focusin', e => {
    const previous = lastFocused;
    lastFocused = e.target;
    refresh(previous);
    if (top && visible(top) && !top.contains(document.activeElement)) (controls(top)[0] || top).focus({ preventScroll: true });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.defaultPrevented || !top || !visible(top)) return;
    const items = controls(top);
    if (!items.length) { e.preventDefault(); top.focus(); return; }
    if (!top.contains(document.activeElement) || (e.shiftKey && document.activeElement === items[0])) {
      e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus();
    } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
      e.preventDefault(); items[0].focus();
    }
  });
  refresh();
}

/* ── Phone Back button ────────────────────────────────────────
   While any panel, non-Home tab or search is open, the app keeps exactly
   one extra history step. Back uses it up: the top thing closes, and the
   step is put back if more is still open. Home with nothing open: Back
   leaves the app as usual. One step at most, so Back can never overshoot
   out of the app however many panels close at once. */
const BackNav = (() => {
  const OVERLAYS = '.modal-overlay, #chat-panel';
  const stack = []; // { kind: 'overlay', el } | { kind: 'view' } | { kind: 'search' }
  let armed = false;       // our history step is in place
  let backPending = false; // we asked to remove it ourselves
  let ready = false;

  function arm () {
  if (armed || backPending || !stack.length) return;
  try { history.pushState({ ftbBack: 1 }, ''); armed = true; } catch { /* sandboxed */ }
  }
  function push (entry) {
  stack.push(entry);
  arm();
  }
  // Closed by a tap, not by Back: once nothing is open, remove our step.
  function drop (match) {
  const i = stack.findIndex(match);
  if (i === -1) return;
  stack.splice(i, 1);
  if (!stack.length && armed && !backPending) {
    backPending = true;
    history.back();
  }
  }

  function closeOverlay (el) {
  const btn = [...el.querySelectorAll('[id$="close-btn"], [id$="-close"], .qa-close, .modal-close, [aria-label="Close"]')]
    .find(b => b.offsetParent !== null && b.closest(OVERLAYS) === el);
  if (btn) btn.click();
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); maybeHideOverlay(); }
  }

  function onPop () {
  armed = false;
  if (backPending) { backPending = false; arm(); return; } // our own clean-up (re-arm if something opened meanwhile)
  const top = stack.pop();
  if (top) {
    if (top.kind === 'overlay') closeOverlay(top.el);
    else if (top.kind === 'view') setView('all');
    else if (top.kind === 'search') clearSearch();
  }
  arm();
  }

  function watchOverlays () {
  const isOpen = el => !el.classList.contains('hidden');
  const seen = new Map();
  document.querySelectorAll(OVERLAYS).forEach(el => seen.set(el, isOpen(el)));
  new MutationObserver(records => {
    records.forEach(r => {
      const el = r.target;
      if (!el.matches?.(OVERLAYS)) return;
      const was = seen.get(el) || false;
      const now = isOpen(el);
      seen.set(el, now);
      if (now && !was) push({ kind: 'overlay', el });
      else if (!now && was) drop(e => e.kind === 'overlay' && e.el === el);
    });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  // Panels the app adds later (the Cub's quick add sheet, etc.)
  new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => {
    if (n.nodeType === 1 && n.matches(OVERLAYS)) seen.set(n, !n.classList.contains('hidden'));
  }))).observe(document.body, { childList: true });
  }

  return {
  init () {
    if (ready) return;
    ready = true;
    window.addEventListener('popstate', onPop);
    watchOverlays();
  },
  // A tab other than Home, or a search, counts as one step.
  layer (kind, on) {
    if (!ready) return;
    const has = stack.some(e => e.kind === kind);
    if (on && !has) push({ kind });
    else if (!on && has) drop(e => e.kind === kind);
  },
  depth: () => stack.length,
  };
})();

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
// Captured early so initInstallPrompt can use it even if the event fires
// before init runs. The bottom #install-banner is the only install UI; an
// older top banner used to show at the same time.
let _pwaPromptEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaPromptEvent = e;
});

/* ════════════════════════════════════════════════════════════
   LIGHT / DARK THEME TOGGLE
   ════════════════════════════════════════════════════════════ */
function initTheme () {
  const appearance = loadUserProfile()?.appearance || {};
  const hasLocalChoice = !!state.settings.themeChoice;
  if (!state.settings.themeChoice && appearance.themeChoice) state.settings.themeChoice = appearance.themeChoice;
  if (!state.settings.theme && appearance.themeMode) state.settings.theme = appearance.themeMode;
  if (!state.settings.uiDensity && appearance.uiDensity) state.settings.uiDensity = appearance.uiDensity;
  if (!state.settings.uiCorners && appearance.uiCorners) state.settings.uiCorners = appearance.uiCorners;
  if (!state.settings.uiMotion && appearance.uiMotion) state.settings.uiMotion = appearance.uiMotion;

  // Older automatic themes saved "light" without a manual choice. Only an
  // explicit Auto or chosen theme may override the dark first-run default.
  const manualChoice = state.settings.themeManual === true || (!hasLocalChoice && !!appearance.themeChoice && appearance.themeManual !== false);
  const initialChoice = state.settings.themeChoice === 'auto' ? 'auto' : manualChoice ? (state.settings.themeChoice || (state.settings.theme === 'light' ? 'light' : 'dark')) : 'dark';
  applyThemeChoice(initialChoice, { manual: true, persist: true });
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
  { title: 'Welcome to Feed The Bear', desc: 'Let\u2019s put some food in your den! Save standout spots, track visits, and keep every great find in one place.' },
  { title: 'Capture Places Instantly', desc: 'Add restaurants in seconds, or paste a Google Maps URL to auto-fill details and save time.' },
  { title: 'Discover Around You', desc: 'Use Map view and Nearby Discovery to find what is close now, then save your favorites with one tap.' },
  { title: 'See Your Food Story', desc: 'Stats turns your history into insight: top cuisines, ratings, trends, and your strongest picks.' },
  { title: 'Let Byte Cub Curate', desc: 'Ask for smart recommendations, tie breakers, and refined shareable cards.' },
];
let _onboardingStep = 0;
let _onboardingAfterSignIn = false;
function showOnboarding () {
  if (state.settings.onboardingDone) return;
  // Not over a shared spot or a link that opened something (it asks next time).
  const q = new URLSearchParams(location.search);
  if (['text', 'title', 'url', 'spot', 'action', 'share-target'].some(k => q.has(k))) return;
  // Not before sign-in: an account signing in on a new phone already set up.
  // Not before we know who's here (sign-in restoring), and not under the sign-in sheet.
  if (typeof _gateOn === 'function' && _gateOn() && !window._ftbUid && (!window._ftbAuthReady || _signInRequired())) { _onboardingAfterSignIn = true; return; }
  // The sign-in sheet is up (a new phone): setup waits for "Try it first" or sign-in.
  if (!document.getElementById('auth-overlay')?.classList.contains('hidden')) { _onboardingAfterSignIn = true; return; }
  // The cub's hands-on welcome; the old slides stay as a fallback.
  if (window.Cub?.welcome?.()) return;
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
// Signed in (firebase.js): an account that already has spots or a profile
// skips setup; a new one gets it now if it was waiting for sign-in.
function onboardingAfterSignIn (existing) {
  if (state.settings.onboardingDone) return;
  if (existing) {
    window.Cub?.endWelcome?.();
    dismissOnboarding();
    maybeHideOverlay();
    return;
  }
  if (_onboardingAfterSignIn) { _onboardingAfterSignIn = false; setTimeout(showOnboarding, 400); }
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
let _discRenderLimit = 24;   // how many of the filtered results are currently shown ("Load More" bumps this)
const DISC_PAGE_SIZE = 24;

async function discoverNearby ({ query = '' } = {}) {
  if (!(await ensureLocationForDiscovery())) return;

  const overlay = document.getElementById('nearby-overlay');
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  document.getElementById('disc-search').value = query;

  // Update location label
  const locLabel = document.getElementById('disc-location-label');
  if (locLabel) locLabel.textContent = '📍 Near your current location';

  const discRadius = document.getElementById('disc-radius');
  if (discRadius) {
  const wanted = Math.round(getNearbyRadiusMeters());
  const opts = [...discRadius.options].map(o => Number(o.value)).filter(n => Number.isFinite(n));
  let best = opts[0], bestDiff = Infinity;
  opts.forEach(v => {
    const d = Math.abs(v - wanted);
    if (d < bestDiff) { best = v; bestDiff = d; }
  });
  if (Number.isFinite(best)) discRadius.value = String(best);
  }

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

  document.getElementById('disc-search')?.addEventListener('input', () => {
  _discRenderLimit = DISC_PAGE_SIZE;
  _discApplyFilters();
  });
  document.getElementById('disc-sort')?.addEventListener('change', e => {
  _discSort = e.target.value;
  _discRenderLimit = DISC_PAGE_SIZE;
  _discApplyFilters();
  });
  document.getElementById('disc-radius')?.addEventListener('change', () => {
  const meters = Number(document.getElementById('disc-radius')?.value);
  if (Number.isFinite(meters) && meters > 0) {
    state.settings.nearbyRadiusMiles = Math.max(1, Math.min(100, Math.round((meters / 1609.34) * 10) / 10));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }
  _discFetch();
  });
  document.getElementById('disc-refresh-btn')?.addEventListener('click', () => _discFetch());

  // Chip clicks (delegate since chips are dynamic)
  document.getElementById('disc-cuisine-chips')?.addEventListener('click', e => {
  const chip = e.target.closest('.disc-chip');
  if (!chip) return;
  _discActiveCuisine = chip.dataset.cuisine;
  document.querySelectorAll('#disc-cuisine-chips .disc-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  _discRenderLimit = DISC_PAGE_SIZE;
  _discApplyFilters();
  });

  // "Load More" (delegate since the button is re-rendered with the results list)
  document.getElementById('nearby-results')?.addEventListener('click', e => {
  if (!e.target.closest('[data-disc-load-more]')) return;
  _discRenderLimit += DISC_PAGE_SIZE;
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
  const radius = parseInt(document.getElementById('disc-radius')?.value) || 16093;

  try {
  const q = `[out:json][timeout:20];(node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"](around:${radius},${lat},${lng});way["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"](around:${radius},${lat},${lng}););out center 250;`;
  const elementsRaw = await fetchOverpassElements(q, {
    timeoutMs: 18000,
    nominatimFallback: true,
    lat,
    lng,
    radiusMeters: radius,
    limit: 250,
  });

  const savedNames = new Set(state.restaurants.map(r => normalizeName(r.name)));
  const myCuisines = {};
  state.restaurants.filter(r => r.myRating >= 4 && r.cuisine).forEach(r => {
    const c = (r.cuisine || '').toLowerCase();
    myCuisines[c] = (myCuisines[c] || 0) + (r.myRating || 3);
  });

  _discAllResults = (elementsRaw || [])
    .filter(isCredibleFoodVenue)
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
        website: cleanVenueWebsite(tags.website || ''),
        phone:   tags.phone || '',
        saved:   savedNames.has(normalizeName(tags.name)),
      };
    })
    .sort((a, b) => a.dist - b.dist);   // default: nearest first

  if (!_discAllResults.length) {
    resultsEl.innerHTML = `<div class="disc-empty">
      <div class="disc-empty-icon" aria-hidden="true">🐻</div>
      <div class="disc-empty-title">No spots found nearby</div>
      <div class="disc-empty-sub">Try increasing the radius above.</div>
    </div>`;
    return;
  }

  // Build cuisine chip list from results
  _discBuildChips(_discAllResults, chipWrap);

  _discActiveCuisine = 'all';
  _discSort = document.getElementById('disc-sort')?.value || 'distance';
  _discRenderLimit = DISC_PAGE_SIZE;
  _discApplyFilters();

    // Track successful nearby search
    if (window.Analytics) {
      Analytics.track('nearby_search_success', {
        resultCount: _discAllResults.length,
        radius,
        lat,
        lng
      });
    }

  } catch (err) {
    console.error('[Nearby] Error fetching restaurants:', err);

    // Track error in analytics
    if (window.Analytics) {
      Analytics.track('nearby_search_error', {
        error: err?.message || 'Unknown error',
        errorType: err?.name || 'Error',
        lat,
        lng,
        radius
      });
    }

    resultsEl.innerHTML = `<div class="disc-empty">
      <div class="disc-empty-icon" aria-hidden="true">🐻</div>
      <div class="disc-empty-title">${err?.name === 'AbortError' ? 'Search took too long' : 'Could not find nearby restaurants'}</div>
      <div class="disc-empty-sub">The bear is having trouble sniffing out restaurants. Check your connection and try again!</div>
      <button class="btn-primary" style="margin-top:16px" onclick="_discFetch()">Try Again</button>
    </div>`;

    // Show toast for better visibility
    if (window.showToast) {
      showToast('Nearby Search', err?.name === 'AbortError' ? 'Search timeout - try a smaller radius' : 'Could not load restaurants. Try again!', 'error');
    }
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

  // A craving word ("american", from Bear Swipe) also finds burgers, BBQ, diners…
  const craving = CRAVING_MATCH[query];
  let results = _discAllResults.filter(r => {
  if (cuisine !== 'all' && r.cuisine !== cuisine && r.amenity !== cuisine) return false;
  if (craving && craving.test(`${r.cuisine} ${r.name}`.toLowerCase())) return true;
  if (query && !matchesRestaurantSearch({ ...r, address: `${r.street || ''} ${r.city || ''}` }, query)) return false;
  return true;
  });

  if (sort === 'distance') {
  results = results.slice().sort((a, b) => a.dist - b.dist);
  } else if (sort === 'match') {
  results = results.slice().sort((a, b) => b.matchScore - a.matchScore);
  } else if (sort === 'type') {
  results = results.slice().sort((a, b) => a.amenity.localeCompare(b.amenity) || a.dist - b.dist);
  }

  const shown = results.slice(0, Math.max(DISC_PAGE_SIZE, _discRenderLimit));

  if (metaEl) {
  metaEl.textContent = results.length
    ? `${shown.length} of ${results.length} spot${results.length !== 1 ? 's' : ''} shown`
    : '';
  }

  const resultsEl = document.getElementById('nearby-results');
  if (!results.length) {
  resultsEl.innerHTML = `<div class="disc-empty">
    <div class="disc-empty-icon" aria-hidden="true">🐻</div>
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

  const remaining = results.length - shown.length;
  const loadMoreHtml = remaining > 0
  ? `<button type="button" class="disc-load-more-btn" data-disc-load-more="1">Load ${Math.min(DISC_PAGE_SIZE, remaining)} more (${remaining} left in this radius)</button>`
  : '';

  resultsEl.innerHTML = shown.map(r => {
  const emoji    = cuisineEmoji(r.cuisine) || amenityEmoji[r.amenity] || '';
  const typeLabel = r.cuisine
    ? (r.cuisine.charAt(0).toUpperCase() + r.cuisine.slice(1))
    : (amenityLabel[r.amenity] || 'Restaurant');
  const distStr  = r.dist < Infinity ? fmtDist(r.dist) : '';
  const isMatch  = r.cuisine && myCuisines.has(r.cuisine.toLowerCase());

  const safeName    = escJsArg(r.name);
  const safeCuisine = escJsArg(r.cuisine);
  const saveAddress = [String(r.street || '').trim(), String(r.city || '').trim()].filter(Boolean).join(', ');
  const safeAddress = escJsArg(saveAddress);
  const safeWebsite = escJsArg(r.website || '');

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
  }).join('') + loadMoreHtml;
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
// A spot's Share: the same Story-sized card as "what to order" and the other
// stories (story-card.js), with the spot's photo, your stars and the dish to
// get, and a link back to the app (your invite when signed in) in the message.
async function shareCard (r) {
  const goTo = goToDishOf(r) || dishesOf(r).find(d => d.verdict === 'want');
  const visited = r.status === 'visited';
  const area = String(r.address || '').split(',').slice(-2, -1)[0]?.trim() || '';
  const uidRef = window._ftbUid && /^[A-Za-z0-9]{10,64}$/.test(window._ftbUid) ? window._ftbUid : '';
  const link = uidRef ? `https://www.feed-the-bear.com/app.html?ref=${uidRef}` : 'https://www.feed-the-bear.com';
  const text = `${visited ? 'Eating at' : 'Next up:'} ${r.name}${goTo ? ` (the ${goTo.name}!)` : ''}. I keep all my spots on Feed The Bear: ${link}`;
  trackProductEvent('spot_card_shared', { photo: !!window.StoryCard?.photosFor(r).length });
  if (window.StoryCard?.openStory) {
  try {
    await StoryCard.openStory({
      kind: 'spot',
      kicker: visited ? 'Been there' : 'On my list',
      title: r.name,
      sub: [r.cuisine, priceDollars(r.priceRange), area].filter(Boolean).join(' · '),
      stars: r.myRating || 0,
      photo: StoryCard.photosFor(r)[0] || '',
      photos: StoryCard.photosFor(r),
      media: mediaOf(r),
      place: r.name,
      location: r.address || area,
      sections: goTo ? [{ label: goTo.verdict === 'want' ? 'Dying to try' : 'Get the', items: [goTo.name], tone: 'gold' }] : [],
      footer: visited ? 'Remember every great bite' : 'Never lose a place to try',
    }, text, `${r.name}-feed-the-bear`);
    return;
  } catch (err) {
    console.warn('[FTB] spot story failed:', err);
    showToast('Could not make place card', err.message || 'Try attaching your photo again.', 'error');
    return;
  }
  }
  try {
  if (navigator.share) await navigator.share({ title: r.name, text });
  else { await navigator.clipboard.writeText(text); showToast('Copied', 'Paste it to a friend.', 'success'); }
  } catch { /* closed the share sheet */ }
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
  recordRestaurantDeletion([...state.selectedIds]);
  state.restaurants = state.restaurants.filter(r => !state.selectedIds.has(r.id));
  saveData(); toggleBulkMode(); renderAll();
  showToast('Deleted', `${n} restaurant${n>1?'s':''} removed.`, 'info');
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
  showToast('Tagged!', `"${t}" added to ${state.selectedIds.size} restaurants.`, 'success');
}
function bulkExport () {
  const sel = state.restaurants.filter(r => state.selectedIds.has(r.id));
  if (!sel.length) return;
  const blob = new Blob([JSON.stringify(sel, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download=`ftb-export-${iso()}.json`; a.click(); URL.revokeObjectURL(url);
  showToast('Exported!', `${sel.length} restaurants saved.`, 'success');
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
  showToast('Moved!', col ? `Added to "${col.name}".` : 'Removed from all lists.', 'success');
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
    // The list's creator (firestore.rules: only the creator may delete
    // the list). Stamped once here and never changed afterwards.
    createdBy: window._ftbUid || null,
  };
  }
  const meta = map[collectionId];
  if (!Array.isArray(meta.collaborators)) meta.collaborators = [];
  if (!Array.isArray(meta.activity)) meta.activity = [];
  if (!meta.ownerName) meta.ownerName = getActorName();
  // Lists shared before createdBy existed gain a creator the next time
  // their owner syncs (the meta lives in the owner's own settings).
  if (!meta.createdBy && window._ftbUid) meta.createdBy = window._ftbUid;
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
  createdBy: meta.createdBy || undefined,
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
  if (Array.isArray(data.collaborators)) meta.collaborators = sanitizeCollaborators(data.collaborators);
  if (Array.isArray(data.activity)) meta.activity = sanitizeSharedActivity(data.activity);
  meta.updatedAt = Number(data.updatedAt) || Date.now();
}

// Shared list docs are written by every collaborator, so treat them as untrusted.
function sanitizeCollaborators (list) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  return list.slice(0, 50).map(c => ({
  id: str(c?.id, 64).replace(/[^\w-]/g, ''),
  name: str(c?.name, 40),
  role: ['owner', 'editor', 'viewer'].includes(c?.role) ? c.role : 'viewer',
  updatedAt: Number(c?.updatedAt) || 0,
  })).filter(c => c.id);
}
function sanitizeSharedActivity (list) {
  return list.slice(0, 10).map(a => ({
  id: String(a?.id ?? '').slice(0, 64),
  text: String(a?.text ?? '').slice(0, 160),
  ts: Number(a?.ts) || 0,
  })).filter(a => a.text);
}

function refreshSharedRealtimeSubscriptions () {
  Object.values(_sharedRealtimeUnsubs).forEach(unsub => { try { unsub(); } catch {} });
  Object.keys(_sharedRealtimeUnsubs).forEach(k => delete _sharedRealtimeUnsubs[k]);
  if (!window._ftbUid || typeof fbSharedListSubscribe !== 'function') return;
  const uid = window._ftbUid;
  const generation = _dataGeneration;

  Object.entries(getSharedListsMap()).forEach(([cid, meta]) => {
  const cloudId = getSharedCloudId(cid);
  _sharedRealtimeUnsubs[cid] = fbSharedListSubscribe(cloudId, data => {
    if (!data || uid !== window._ftbUid || generation !== _dataGeneration) return;
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
  showToast('List Created!', `"${name}" ready.`, 'success');
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
      <select class="shared-collab-role" data-collab="${escHtml(c.id)}">
        <option value="owner" ${c.role === 'owner' ? 'selected' : ''}>Owner</option>
        <option value="editor" ${c.role === 'editor' ? 'selected' : ''}>Editor</option>
        <option value="viewer" ${c.role === 'viewer' ? 'selected' : ''}>Viewer</option>
      </select>
      <button class="shared-collab-remove" data-collab="${escHtml(c.id)}" type="button">Remove</button>
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
  with: [],
};

function resetDecisionModeState () {
  _decisionModeState = {
  mood: 'quick',
  budget: 0,
  miles: 5,
  party: 2,
  with: [],
  };
}

function syncDecisionModeChips () {
  document.querySelectorAll('.decision-chip[data-group][data-value]').forEach(btn => {
  const group = btn.dataset.group;
  const value = btn.dataset.value;
  const current = _decisionModeState[group];
  const on = Array.isArray(current) ? current.includes(value) : String(current) === String(value);
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  });
}

/* ── Decision context: what time it is and what it's like out ── */
function mealtimeOf (now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 5 && h < 10.5) return 'breakfast';
  if (h >= 10.5 && h < 15) return 'lunch';
  if (h >= 15 && h < 21) return 'dinner';
  return 'late';
}
const MEALTIME_LABEL = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', late: 'late-night bite' };

const WEATHER_TTL_MS = 30 * 60 * 1000;
let _dmWeather = null; // { at, lat, lng, tempF, wet, snow }

// Current weather from Open-Meteo (free, no key). Cached for half an hour;
// any failure just means picks ignore the weather.
async function fetchDecisionWeather () {
  if (!state.locationEnabled || !Number.isFinite(state.userLat) || !Number.isFinite(state.userLng)) return null;
  const near = _dmWeather && Math.abs(_dmWeather.lat - state.userLat) < 0.1 && Math.abs(_dmWeather.lng - state.userLng) < 0.1;
  if (near && Date.now() - _dmWeather.at < WEATHER_TTL_MS) return _dmWeather;
  try {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.userLat.toFixed(2)}&longitude=${state.userLng.toFixed(2)}&current=temperature_2m,precipitation,weather_code&temperature_unit=fahrenheit`;
  const resp = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined });
  if (!resp.ok) return null;
  const cur = (await resp.json())?.current;
  if (!cur || !Number.isFinite(cur.temperature_2m)) return null;
  const code = Number(cur.weather_code) || 0;
  _dmWeather = {
    at: Date.now(), lat: state.userLat, lng: state.userLng,
    tempF: Math.round(cur.temperature_2m),
    snow: (code >= 71 && code <= 77) || code === 85 || code === 86,
    wet: (cur.precipitation || 0) > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95,
  };
  return _dmWeather;
  } catch { return null; }
}

function weatherFeel (w) {
  if (!w) return '';
  if (w.snow) return 'snowy';
  if (w.wet) return 'rainy';
  if (w.tempF <= 50) return 'chilly';
  if (w.tempF >= 90) return 'hot';
  return '';
}

function renderDecisionContext () {
  const el = document.getElementById('decision-mode-context');
  if (!el) return;
  const now = new Date();
  const day = now.toLocaleDateString(undefined, { weekday: 'long' });
  const w = _dmWeather && Date.now() - _dmWeather.at < WEATHER_TTL_MS ? _dmWeather : null;
  const openCount = state.restaurants.filter(r => openStatus(r, now)?.open).length;
  el.textContent = [
  `${day} ${MEALTIME_LABEL[mealtimeOf(now)]}`,
  w ? `${w.tempF}°F${weatherFeel(w) ? `, ${weatherFeel(w)}` : ''}` : '',
  openCount ? `${openCount} of your spots open now` : '',
  ].filter(Boolean).join(' · ');
}

// Friends you follow, as "Eating with" chips; their tastes join the scoring.
function renderDecisionWithChips () {
  const group = document.getElementById('decision-mode-with');
  const wrap = document.getElementById('decision-with-chips');
  if (!group || !wrap) return;
  const friends = getFriends().slice(0, 8);
  group.classList.toggle('hidden', !friends.length);
  wrap.innerHTML = friends.map(f => `<button class="decision-chip" data-group="with" data-value="${escHtml(f.key)}" type="button" aria-pressed="false">${escHtml(f.name || 'Friend')}</button>`).join('');
}

// How the friends at the table feel about a spot: +/- score and a reason.
function companionFit (r, keys = []) {
  if (!keys.length) return { score: 0, reason: '' };
  const spot = normalizeName(r.name || '');
  let score = 0;
  let reason = '';
  getFriends().filter(f => keys.includes(f.key)).forEach(f => {
  const pick = (f.data?.picks || []).find(p => normalizeName(p.n) === spot);
  const want = (f.data?.w || []).find(x => normalizeName(x.at) === spot);
  if (want) { score += 1.6; reason = reason || `${f.name} wants to try the ${want.d}`; }
  if (!pick) return;
  if (pick.r >= 4) { score += 1.4; reason = reason || `${f.name} loves it here`; }
  else if (pick.r && pick.r <= 2) { score -= 2.5; }
  if ((pick.g || []).length) score += 0.4;
  });
  return { score, reason };
}

function lastVisitOf (r) {
  const dates = (r.visits || []).map(v => v.date).filter(Boolean);
  if (r.dateVisited) dates.push(r.dateVisited);
  return dates.sort().pop() || '';
}

function setDecisionModeConstraint (group, value) {
  if (!group) return;
  if (group === 'with') {
  const key = String(value || '');
  const list = _decisionModeState.with;
  _decisionModeState.with = list.includes(key) ? list.filter(k => k !== key) : [...list, key];
  // Picking friends sets the party size to match, you included.
  const size = _decisionModeState.with.length + 1;
  if (_decisionModeState.with.length) _decisionModeState.party = size >= 4 ? 4 : size;
  } else if (group === 'mood') {
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
  renderDecisionWithChips();
  syncDecisionModeChips();
  renderDecisionContext();
  fetchDecisionWeather().then(w => { if (w) renderDecisionContext(); });
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
  const now = new Date();
  const meal = mealtimeOf(now);
  const w = _dmWeather && Date.now() - _dmWeather.at < WEATHER_TTL_MS ? _dmWeather : null;
  const feel = weatherFeel(w);
  const today = iso();

  const swipe = swipeCraving();

  const scored = state.restaurants.filter(isAvailableSpot).map(r => {
  const distance = distOf(r);
  let score = scoreMoodPick(r, mood);
  const cuisineLc = String(r.cuisine || '').toLowerCase();
  const contextReasons = [];

  // What Bear Swipe just said you're craving comes first.
  if (swipe && matchesCraving(cuisineLc, swipe.cuisine)) { score += 3; contextReasons.push(`you're craving ${swipe.cuisine}`); }

  // Closed spots sink; known-open ones get a nudge.
  const st = openStatus(r, now);
  if (st && !st.open) score -= 4;
  else if (st?.open) { score += st.soon ? 0.3 : 1; if (!st.soon) contextReasons.push('open now'); }

  if (meal === 'breakfast' && /(breakfast|brunch|cafe|coffee|bakery|diner)/.test(cuisineLc)) { score += 1.6; contextReasons.push('a breakfast spot'); }
  else if (meal === 'breakfast' && /(steak|bar|pub)/.test(cuisineLc)) score -= 1.2;
  else if (meal === 'late' && /(pizza|burger|fast food|taco|mexican|bar|pub|diner)/.test(cuisineLc)) { score += 1.1; contextReasons.push('good late at night'); }

  if (feel === 'rainy' || feel === 'snowy' || feel === 'chilly') {
    if (/(ramen|pho|soup|indian|italian|bbq|korean|comfort|soul|chinese|vietnamese)/.test(cuisineLc)) { score += 0.9; contextReasons.push(`warm food for a ${feel} day`); }
    if (Number.isFinite(distance) && distance > 8000) score -= 0.8;
  } else if (feel === 'hot' && /(sushi|poke|salad|healthy|mediterranean|greek|ice cream|vietnamese|hawaiian)/.test(cuisineLc)) {
    score += 0.8; contextReasons.push('light food for the heat');
  }

  // Just went? Give it a rest. A proven favorite you haven't had in a month? Bring it back.
  const last = lastVisitOf(r);
  const daysAgo = last ? Math.round((Date.parse(today) - Date.parse(last)) / 864e5) : null;
  if (daysAgo !== null && daysAgo <= 1) score -= 2.5;
  else if (daysAgo !== null && daysAgo <= 3) score -= 1.5;
  else if (daysAgo !== null && daysAgo >= 30 && (r.myRating >= 4 || goToDishOf(r)?.verdict === 'again')) { score += 0.6; contextReasons.push(`haven't been in ${daysAgo >= 60 ? 'months' : 'a while'}`); }

  const companions = companionFit(r, _decisionModeState.with);
  score += companions.score;
  if (companions.reason) contextReasons.unshift(companions.reason);

  if (budget > 0) {
    if ((r.priceRange || 0) > budget) score -= 3.2;
    if ((r.priceRange || 0) > 0 && (r.priceRange || 0) <= budget) score += 0.9;
  }

  if (Number.isFinite(distance)) {
    if (distance <= maxMeters) score += 1.2;
    else score -= Math.min(2.4, (distance - maxMeters) / 2200);
  }

  // A dish you've been craving, or a proven go-to, is the best tie-breaker.
  const crave = dishesOf(r).find(d => d.verdict === 'want');
  const goTo = goToDishOf(r);
  if (crave) score += 1.4;
  else if (goTo && goTo.verdict === 'again') score += 0.7;
  const friendTip = friendTipsFor(r).find(t => t.get.length);
  if (friendTip) score += 0.5;

  const cuisine = cuisineLc;
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
  if (crave) reasons.push(`you've been wanting the ${crave.name}`);
  else if (goTo && goTo.verdict === 'again') reasons.push(`your go-to: ${goTo.name}`);
  else if (friendTip) reasons.push(`${friendTip.name} says get the ${friendTip.get[0]}`);
  reasons.push(...contextReasons.slice(0, 1));
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
    closed: !!(st && !st.open),
  };
  });

  // Spots known to be closed only fill in when there aren't three others.
  scored.sort((a, b) => b.score - a.score);
  return [...scored.filter(x => !x.closed), ...scored.filter(x => x.closed)].slice(0, 3);
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

  // Without location the distance chips do nothing, so say so instead of
  // quietly ranking a far-away spot as the winner.
  const locationNotice = state.locationEnabled ? '' : `<div class="decision-location-notice">
    <span>Distance isn't counted yet. Turn on location so your ${Number(_decisionModeState.miles || 5)} mi limit applies.</span>
    <button class="btn-secondary btn-sm decision-location-btn" type="button">Use My Location</button>
  </div>`;

  out.innerHTML = locationNotice + shortlist.map((item, idx) => {
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
      ${idx === 0 ? `<button class="btn-secondary btn-sm decision-result-action" data-action="book" data-id="${r.id}" type="button">🍽️ Book</button>
      <button class="btn-secondary btn-sm decision-result-action" data-action="order" data-id="${r.id}" type="button">🛵 Order</button>` : ''}
      <button class="btn-secondary btn-sm decision-result-action" data-action="backup" data-id="${r.id}" type="button">Save Backup</button>
      <button class="btn-ghost btn-sm decision-result-action" data-action="menu" data-id="${r.id}" ${canMenu ? '' : 'disabled'} type="button">View Menu</button>
      <button class="btn-ghost btn-sm decision-result-action" data-action="directions" data-id="${r.id}" ${canDirections ? '' : 'disabled'} type="button">Directions</button>
    </div>
  </article>`;
  }).join('') + (shortlist.length >= 2
  ? `<button class="btn-secondary decision-vote-btn" type="button" data-ids="${escHtml(shortlist.map(x => x.r.id).join(','))}">Can't agree? Put these ${shortlist.length} to a group vote</button>`
  : '');
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

  if (action === 'book' || action === 'order') {
  openPartnerSheet(action, r);
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
  const available = state.restaurants.filter(isAvailableSpot);
  const plannerPool = available.length ? available : nearbyFallback;

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

  const pool = state.restaurants.filter(isAvailableSpot)
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

/* ── Dinner Vote ──────────────────────────────────────────
   Pick 2-6 spots, share vote.html?v=CODE, friends vote yes/no without the
   app. Rooms live on the server (api/vote.js); recent ones are listed here. */
const DV_MAX = 6;
const DV_RECENT_KEY = 'ftb_dinner_votes_v1';
const _dvSelected = new Set();

function _dvRecent () {
  try { return JSON.parse(localStorage.getItem(DV_RECENT_KEY)) || []; } catch { return []; }
}
function _dvLink (code) {
  return `https://www.feed-the-bear.com/vote.html?v=${code}`;
}

// Good candidates first: Want to Try and favorites close enough to go to tonight.
function _dvCandidates () {
  const score = r => (r.status === 'want-to-try' ? 3 : 0) + (r.isFavorite ? 2 : 0) + (r.myRating || 0) / 2 - (Number.isFinite(distOf(r)) ? distOf(r) / 16093 : 0);
  return state.restaurants.filter(nearEnoughToSuggest).sort((a, b) => score(b) - score(a)).slice(0, 30);
}

// `presetIds` (e.g. Decision Mode's top 3) are pre-picked; otherwise the best candidates.
function openDinnerRooms (presetIds = null) {
  if (grizzlyLocked('vote')) return;
  _dvSelected.clear();
  const preset = Array.isArray(presetIds) ? presetIds.filter(id => state.restaurants.some(r => r.id === id && isAvailableSpot(r))).slice(0, DV_MAX) : [];
  if (preset.length) preset.forEach(id => _dvSelected.add(id));
  else _dvCandidates().slice(0, 3).forEach(r => _dvSelected.add(r.id));
  renderDinnerVote();
  document.getElementById('dinner-rooms-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeDinnerRooms () {
  document.getElementById('dinner-rooms-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function renderDinnerVote () {
  const picker = document.getElementById('dv-picker');
  if (!picker) return;
  const candidates = _dvCandidates();
  // Pre-picked spots stay visible even if they wouldn't make the candidate list.
  const extra = [..._dvSelected].filter(id => !candidates.some(r => r.id === id))
  .map(id => state.restaurants.find(r => r.id === id)).filter(Boolean);
  const list = [...extra, ...candidates];
  picker.innerHTML = list.length
  ? list.map(r => `<button type="button" class="dv-pick${_dvSelected.has(r.id) ? ' on' : ''}" data-id="${escHtml(r.id)}" aria-pressed="${_dvSelected.has(r.id)}">
      <span class="dv-check" aria-hidden="true">${_dvSelected.has(r.id) ? '✓' : ''}</span>
      <span class="dv-name">${escHtml(r.name)}</span>
      <small>${escHtml([r.cuisine, r.status === 'want-to-try' ? 'Want to Try' : r.myRating ? `${r.myRating}★` : '', Number.isFinite(distOf(r)) ? fmtDist(distOf(r)) : ''].filter(Boolean).join(' · '))}</small>
    </button>`).join('')
  : '<div class="for-you-empty">Save a few spots first, then start a vote.</div>';
  picker.querySelectorAll('.dv-pick').forEach(b => b.addEventListener('click', () => {
  const id = b.dataset.id;
  if (_dvSelected.has(id)) _dvSelected.delete(id);
  else if (_dvSelected.size >= DV_MAX) { showToast(`Up to ${DV_MAX} spots`, 'Unpick one first.', 'info'); return; }
  else _dvSelected.add(id);
  renderDinnerVote();
  }));
  const start = document.getElementById('dv-start');
  if (start) {
  start.disabled = _dvSelected.size < 2;
  start.textContent = _dvSelected.size < 2 ? 'Pick at least 2 spots' : `Start the vote (${_dvSelected.size} spots)`;
  }
  const recent = _dvRecent().filter(v => Date.parse(v.expiresAt) > Date.now());
  const box = document.getElementById('dv-recent');
  if (box) {
  box.innerHTML = recent.length
    ? `<h3>Your votes</h3>${recent.map(v => `<a class="dv-recent" href="${escHtml(_dvLink(v.code))}" target="_blank" rel="noopener">${escHtml(v.title)}<span>See results ›</span></a>`).join('')}`
    : '';
  }
}

async function startDinnerVote () {
  if (grizzlyLocked('vote')) return;
  const spots = [..._dvSelected].map(id => state.restaurants.find(r => r.id === id)).filter(Boolean);
  if (spots.length < 2) return;
  const btn = document.getElementById('dv-start');
  btn.disabled = true;
  btn.textContent = 'Starting…';
  try {
  const resp = await fetch('/api/vote', {
    method: 'POST',
    // Starting a vote is checked on the server (Grizzly).
    headers: { 'Content-Type': 'application/json', ...(typeof ftbApiHeaders === 'function' ? await ftbApiHeaders() : {}) },
    body: JSON.stringify({
      action: 'create',
      host: (loadUserProfile()?.name || '').slice(0, 30),
      options: spots.map(r => ({ name: r.name, cuisine: r.cuisine || '', address: r.address || '', lat: r.lat ?? null, lng: r.lng ?? null, rating: r.myRating || r.googleRating || 0 })),
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.code) throw new Error(data.error || 'Could not start the vote.');
  const recent = _dvRecent();
  recent.unshift({ code: data.code, title: spots.map(r => r.name).slice(0, 3).join(', ') + (spots.length > 3 ? '…' : ''), expiresAt: new Date(Date.now() + 3 * 864e5).toISOString() });
  try { localStorage.setItem(DV_RECENT_KEY, JSON.stringify(recent.slice(0, 10))); } catch { /* storage full */ }
  trackProductEvent('dinner_vote_started', { options: spots.length });
  await shareDinnerVote(data.code);
  renderDinnerVote();
  } catch (err) {
  showToast('Vote not started', err.message || 'Please try again.', 'error');
  renderDinnerVote();
  }
}

async function shareDinnerVote (code) {
  const url = _dvLink(code);
  const text = 'Where should we eat? Vote yes or no on each spot (takes 10 seconds):';
  try {
  if (navigator.share) { await navigator.share({ title: 'Dinner Vote', text, url }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  try {
  await navigator.clipboard.writeText(`${text} ${url}`);
  showToast('Vote link copied', 'Paste it in your group chat. Results update as friends vote.', 'success');
  } catch {
  prompt('Copy the vote link:', url);
  }
}

function openShareHighlights () {
  document.getElementById('share-highlights-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeShareHighlights () {
  document.getElementById('share-highlights-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

async function exportHighlightCard (kind = 'weekly') {
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
  const picks = state.restaurants.filter(isAvailableSpot)
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

  ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.font = '500 24px Poppins, system-ui';
  ctx.fillText(`Feed The Bear · ${new Date().toLocaleDateString()}`, 92, H - 178);
  // Your link and a Google Play badge (story-card.js), so the card brings people in.
  if (window.StoryCard?.brand) {
    window.StoryCard.brand(ctx, { x: 92, y: H - 112, w: W - 184, link: await window.StoryCard.shareLink(), s: 0.85, font: 'Poppins, system-ui', gold: '#FFD166' });
  } else {
    ctx.fillStyle = '#FFD166';
    ctx.font = '600 30px Poppins, system-ui';
    ctx.fillText('feed-the-bear.com', 92, H - 112);
  }

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
  const lists = state.settings.collections || [];
  lists.forEach(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=c.name; sel.appendChild(o); });
  // Without lists of your own (like "Date night") there's nothing to pick, so it isn't asked.
  document.getElementById('form-collection-group')?.classList.toggle('hidden', !lists.length);
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
  BackNav.layer('view', state.currentView !== 'all');
  renderSearchMode();
  });

  // Add button
  // New spots go through the cub's Quick Add; the full form is behind "More details".
  const openQuickAdd = () => (window.Cub ? window.Cub.openAdd() : openAddModal());
  document.getElementById('add-btn')?.addEventListener('click', openQuickAdd);
  document.getElementById('empty-add-btn')?.addEventListener('click', openQuickAdd);
  document.getElementById('empty-import-btn')?.addEventListener('click', () => showImportBookmarks());
  document.getElementById('header-invite-btn')?.addEventListener('click', () => { hapticTap('light'); inviteFriend(); });
  document.getElementById('header-friends-btn')?.addEventListener('click', () => { hapticTap('light'); openFoodieFriends(); });
  document.getElementById('chat-hide-cub-btn')?.addEventListener('click', () => { closeChat(); window.Cub?.hide?.(); });
  // Links on a spot (detail page)
  const addDetailLink = () => {
  const input = document.getElementById('detail-link-input');
  const r = state.restaurants.find(x => x.id === state.detailId);
  if (!input || !r) return;
  if (!addLinkTo(r, input.value)) { showToast('Paste a web link', 'Something starting with https://', 'info'); input.focus(); return; }
  input.value = '';
  saveData();
  renderDetailLinks(r);
  renderCards();
  trackProductEvent('link_added', { kind: linkKind(r.links[0].url).label });
  showToast('Link saved', `${linkKind(r.links[0].url).label} link added to ${r.name}.`, 'success');
  };
  document.getElementById('detail-link-add-btn')?.addEventListener('click', addDetailLink);
  document.getElementById('detail-link-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addDetailLink(); } });
  document.getElementById('detail-links-list')?.addEventListener('click', e => {
  const btn = e.target.closest('.detail-link-remove[data-url]');
  const r = state.restaurants.find(x => x.id === state.detailId);
  if (!btn || !r) return;
  r.links = linksOf(r).filter(l => l.url !== btn.dataset.url);
  r.updatedAt = Date.now();
  saveData();
  renderDetailLinks(r);
  renderCards();
  });
  document.getElementById('list-header')?.addEventListener('click', e => {
  const tab = e.target.closest('.list-tab[data-list]');
  if (tab) { hapticTap('light'); setView(tab.dataset.list); }
  });
  document.getElementById('restaurant-grid')?.addEventListener('click', e => {
  const b = e.target.closest('[data-list-empty]');
  if (!b) return;
  if (b.dataset.listEmpty === 'add') openAddPlace();
  else if (b.dataset.listEmpty === 'import') showImportBookmarks();
  else if (b.dataset.listEmpty === 'justate') openJustAte();
  });
  document.getElementById('home-add-bar')?.addEventListener('click', () => { hapticTap('medium'); openAddPlace(); });

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

  // Check-in inline form star picker
  document.addEventListener('click', e => {
  const btn = e.target.closest('.checkin-star');
  if (!btn) return;
  const val = parseInt(btn.dataset.val);
  const form = btn.closest('#detail-checkin-form');
  const current = parseInt(form?.dataset.rating || '0');
  setCheckinStars(current === val ? 0 : val);
  });

  // Filters
  document.getElementById('search-input').addEventListener('input', e => {
  state.filter.search = e.target.value;
  updateClearBtn();
  renderCards();
  renderSearchMode();
  });
  document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') e.target.blur(); // close the phone keyboard to see results
  });
  document.getElementById('filter-cuisine').addEventListener('change', e => {
  state.filter.cuisine = e.target.value;
  updateClearBtn();
  renderCards();
  if (_homeDiscCache) renderHomeDiscovery(_homeDiscCache);
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
  const alert = document.getElementById('proximity-alert');
  alert.classList.add('hidden');
  if (alert.dataset.rid) noteNearAlert(alert.dataset.rid, Date.now() + NOTIFY_SNOOZE);
  });

  // Chat
  document.getElementById('chat-toggle-btn').addEventListener('click', openChat);
  document.getElementById('chat-close-btn').addEventListener('click', closeChat);
  document.getElementById('chat-send-btn').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });
  initChatMic();

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

  const attachFormMedia = async (source = 'library') => {
    const media = await pickFoodMediaList(FOOD_MEDIA_MAX - _formMedia.length, source);
    if (media.length) setFormMedia(mergeFoodMedia(_formMedia, media));
  };
  addFoodCaptureActions(document.getElementById('form-media-preview'), attachFormMedia);
  document.getElementById('form-photo-file').addEventListener('change', async e => {
    const files = [...(e.target.files || [])].slice(0, FOOD_MEDIA_MAX);
    if (!files.length) return;
    const context = _mediaContext;
    _foodMediaJobs++;
    refreshMediaBusy();
    try {
      const media = [];
      for (const file of files) {
        const item = await mediaFromFile(file);
        if (item) media.push(item);
      }
      if (context === _mediaContext && media.length) setFormMedia(mergeFoodMedia(_formMedia, media));
    } finally { _foodMediaJobs--; refreshMediaBusy(); e.target.value = ''; }
  });
  document.getElementById('form-photo').addEventListener('input', () => {
    if (_formMedia.length && document.getElementById('form-photo').value !== _formMedia[0].photo) setFormMedia([]);
  });
  document.getElementById('form-media-preview').addEventListener('click', e => {
    const rm = e.target.closest('.pm-remove');
    if (!rm) return;
    const media = _formMedia.filter((_, i) => i !== Number(rm.dataset.idx));
    if (!media.length) document.getElementById('form-photo').value = '';
    setFormMedia(media);
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
  if (btn.id === 'mobile-add-btn')  { hapticTap('medium'); openAddChoice(); return; }
  if (btn.id === 'mobile-play-btn') { openMobileHub(); return; }
  if (!btn.dataset.view) return;
  hapticTap('light');
  // Tapping the tab you're already on scrolls back to the top.
  if (btn.dataset.view === state.currentView && window.scrollY > 0) {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return;
  }
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
      state.filter.sort = 'best-desc';
      document.getElementById('sort-select').value = 'best-desc';
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
    if (window.closeTopFoodChallenge?.(e)) return;
    closeMobileHub();
    closeJustAte();
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
  document.getElementById('import-notes-file')?.addEventListener('change', e => {
  importNoteFiles(e.target.files);
  e.target.value = '';
  });
  document.getElementById('import-preview').addEventListener('change', e => {
  const box = e.target.closest('input[type="checkbox"][data-idx]');
  if (!box || !_importParsed[box.dataset.idx]) return;
  _importParsed[box.dataset.idx].on = box.checked;
  renderImportPreview();
  });

  // Phase 6 - Add to Calendar
  document.getElementById('detail-calendar-btn').addEventListener('click', () => {
  if (state.detailId) addToGoogleCalendar(state.detailId);
  });

  // Phase 7 - Voice
  // No speech recognition (e.g. the Android app's web view): hide the mic.
  if (!speechRecognitionClass()) {
  const mic = document.getElementById('search-voice-btn');
  if (mic) mic.classList.add('hidden');
  }
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

  // Reminders are scheduled from openDetailModal via scheduleReminder()
  // (do not attach a second click handler here — it double-fires toasts).

  // Phase 7 - Auto-Tags (form field hooks)
  ['form-name','form-cuisine','form-notes'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', computeAutoTags);
  });

  // Phase 7 - Escape closes new modals (comment only - actual close calls below in Escape handler)
  document.getElementById('form-name').addEventListener('input', computeAutoTags);
  document.getElementById('form-name').addEventListener('input', searchFormPlaces);
  document.getElementById('form-name-suggs').addEventListener('click', e => {
  const btn = e.target.closest('.qa-sugg');
  if (btn) pickFormPlace(_formPlaceResults[Number(btn.dataset.i)]);
  });

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
  document.getElementById('recipe-close-btn').addEventListener('click', closeRecipeModal);
  document.getElementById('recipe-overlay').addEventListener('click', e => { if (e.target.id === 'recipe-overlay') closeRecipeModal(); });
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
  // Your Order: log a dish with one tap, or press Enter for the default
  // (want to try for a place you haven't been, fine otherwise).
  document.querySelector('#your-order .your-order-verdicts')?.addEventListener('click', e => {
  const btn = e.target.closest('.yo-btn[data-verdict]');
  if (btn) logYourOrder(btn.dataset.verdict);
  });
  document.getElementById('your-order-share')?.addEventListener('click', shareYourOrder);
  document.getElementById('menu-scan-btn')?.addEventListener('click', () => {
  if (grizzlyLocked('menu')) return;
  document.getElementById('menu-scan-file').click();
  });
  document.getElementById('menu-scan-file')?.addEventListener('change', e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) scanMenu(file);
  });

  // Just Ate
  document.getElementById('home-quick-justate-btn')?.addEventListener('click', () => { hapticTap('medium'); openJustAte(); });
  document.getElementById('just-ate-close-btn')?.addEventListener('click', closeJustAte);
  document.getElementById('just-ate-overlay')?.addEventListener('click', e => { if (e.target.id === 'just-ate-overlay') closeJustAte(); });
  document.getElementById('just-ate-place')?.addEventListener('input', () => {
  _justAte.placeId = null; _justAte.found = null;
  renderJustAtePlaces();
  searchJustAtePlaces();
  });
  document.getElementById('just-ate-places')?.addEventListener('click', e => {
  const btn = e.target.closest('.ja-place');
  if (!btn) return;
  const r = btn.dataset.id ? state.restaurants.find(x => x.id === btn.dataset.id) : null;
  const real = btn.dataset.g != null ? _justAte.results[Number(btn.dataset.g)] : null;
  _justAte.placeId = r?.id || null;
  _justAte.found = real || null;
  if (r || real) document.getElementById('just-ate-place').value = (r || real).name;
  // Rated it before? Start from that rating.
  if (r?.myRating && !_justAte.stars) setJustAteStars(r.myRating);
  renderJustAtePlaces();
  });
  document.getElementById('just-ate-stars')?.addEventListener('click', e => {
  const b = e.target.closest('.ja-star[data-n]');
  if (!b) return;
  hapticTap('light');
  setJustAteStars(Number(b.dataset.n) === _justAte.stars ? 0 : Number(b.dataset.n));
  });
  document.getElementById('just-ate-verdicts')?.addEventListener('click', e => {
  const btn = e.target.closest('.yo-btn[data-verdict]');
  if (!btn) return;
  _justAte.verdict = btn.dataset.verdict;
  document.querySelectorAll('#just-ate-verdicts .yo-btn').forEach(b => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  });
  document.getElementById('just-ate-dish')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); if (!document.getElementById('just-ate-save').disabled) saveJustAte(); }
  });
  document.getElementById('just-ate-save')?.addEventListener('click', saveJustAte);
  const attachJustAteMedia = async (source = 'library') => {
  const room = FOOD_MEDIA_MAX - _justAte.media.length;
  if (room <= 0) { showToast(`Up to ${FOOD_MEDIA_MAX} per meal`, 'Remove one to add another.', 'info'); return; }
  const picked = await pickFoodMediaList(room, source);
  if (picked.length) setJustAteMedia(mergeFoodMedia(_justAte.media, picked));
  };
  document.getElementById('just-ate-photo')?.addEventListener('click', () => attachJustAteMedia());
  addFoodCaptureActions(document.getElementById('just-ate-photo'), attachJustAteMedia);
  document.getElementById('just-ate-photo-preview')?.addEventListener('click', e => {
  const rm = e.target.closest('.pm-remove');
  if (rm) setJustAteMedia(_justAte.media.filter((_, i) => i !== Number(rm.dataset.idx)));
  });
  document.getElementById('just-ate-tags')?.addEventListener('click', e => toggleJustAteTag(e.target.closest('.ja-tag')));
  document.getElementById('your-order-input')?.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const r = state.restaurants.find(x => x.id === state.detailId);
  logYourOrder(r?.status === 'want-to-try' ? 'want' : 'ok');
  });
  const attachOrderMedia = async (source = 'library') => {
  const room = FOOD_MEDIA_MAX - _yoPendingMedia.length;
  if (room <= 0) { showToast(`Up to ${FOOD_MEDIA_MAX} per dish`, 'Remove one to add another.', 'info'); return; }
  const picked = await pickFoodMediaList(room, source);
  if (!picked.length) return;
  setYourOrderPending(mergeFoodMedia(_yoPendingMedia, picked));
  document.getElementById('your-order-input')?.focus();
  };
  document.getElementById('your-order-photo')?.addEventListener('click', () => attachOrderMedia());
  addFoodCaptureActions(document.getElementById('your-order-pending'), attachOrderMedia);
  document.getElementById('your-order-pending')?.addEventListener('click', e => {
  const rm = e.target.closest('.pm-remove');
  if (rm) setYourOrderPending(_yoPendingMedia.filter((_, i) => i !== Number(rm.dataset.idx)));
  });
  document.getElementById('your-order-list')?.addEventListener('click', async e => {
  const r = state.restaurants.find(x => x.id === state.detailId);
  if (!r) return;
  const view = e.target.closest('.yo-dish-photo[data-view]');
  if (view) {
    const vd = dishesOf(r).find(x => x.id === view.dataset.view);
    if (vd?.video) { playFoodVideo(vd.video, `${vd.name} · ${r.name}`); return; }
    const photos = dishPhotosOf(r);
    if (typeof openPhotoGallery === 'function') openPhotoGallery(photos, Math.max(0, photos.findIndex(p => p.id === view.dataset.view)));
    return;
  }
  const photoFor = e.target.closest('.yo-photo-btn[data-photo-for]');
  if (photoFor) {
    // Adds to the dish's photos; the oldest drop off past the limit.
    const d = dishesOf(r).find(x => x.id === photoFor.dataset.photoFor);
    const picked = d ? await pickFoodMediaList(FOOD_MEDIA_MAX, photoFor.dataset.source || 'library') : [];
    if (!picked.length) return;
    setMediaOn(d, [...picked, ...mediaOf(d)]);
    r.updatedAt = Date.now();
    saveData();
    renderYourOrder(r.id);
    photoReveal(picked[0].photo, d.name);
    return;
  }
  const move = e.target.closest('.yo-move');
  const remove = e.target.closest('.yo-remove');
  if (move) {
    const d = dishesOf(r).find(x => x.id === move.dataset.id);
    if (d) upsertDish(r, { name: d.name, verdict: move.dataset.move });
  } else if (remove) {
    removeDish(r, remove.dataset.remove);
  } else {
    const nameBtn = e.target.closest('.yo-dish-name');
    const row = nameBtn?.closest('.yo-dish');
    if (row) nameBtn.setAttribute('aria-expanded', String(row.classList.toggle('open')));
    return;
  }
  renderYourOrder(r.id);
  renderAll();
  });

  // Phase 8 - Visit Debrief
  document.getElementById('detail-debrief-btn').addEventListener('click', () => { if (state.detailId) openVisitDebrief(state.detailId); });
  document.getElementById('debrief-save-btn').addEventListener('click', saveDebrief);
  document.getElementById('debrief-skip-btn').addEventListener('click', closeDebrief);
  document.getElementById('debrief-overlay').addEventListener('click', e => { if (e.target === document.getElementById('debrief-overlay')) closeDebrief(); });

  // Phase 8 - Year in Review
  document.getElementById('review-close-btn').addEventListener('click', closeYearReview);
  document.getElementById('review-share-btn').addEventListener('click', shareYearReview);
  document.getElementById('review-overlay').addEventListener('click', e => { if (e.target === document.getElementById('review-overlay')) closeYearReview(); });
  document.getElementById('review-prev-year').addEventListener('click', () => { _reviewYear--; document.getElementById('review-year-label').textContent = _reviewYear; renderYearReview(); });
  document.getElementById('review-next-year').addEventListener('click', () => { _reviewYear++; document.getElementById('review-year-label').textContent = _reviewYear; renderYearReview(); });

  // Phase 8 - Foodie Friends
  document.getElementById('friends-close-btn').addEventListener('click', closeFoodieFriends);
  document.getElementById('friends-overlay').addEventListener('click', e => { if (e.target === document.getElementById('friends-overlay')) closeFoodieFriends(); });
  document.getElementById('friends-load-btn').addEventListener('click', loadFriendProfile);
  document.getElementById('friends-list')?.addEventListener('click', e => {
  const btn = e.target.closest('.friend-remove[data-key]');
  if (!btn) return;
  unfollowFriend(btn.dataset.key);
  renderFriendsList();
  });
  document.getElementById('friends-link-input').addEventListener('keydown', e => { if (e.key === 'Enter') loadFriendProfile(); });
  document.getElementById('friends-qr-btn')?.addEventListener('click', () => showFollowQr());
  document.getElementById('friends-find-form')?.addEventListener('submit', e => {
  e.preventDefault();
  findFriendByHandle(document.getElementById('friends-find-input').value);
  });
  document.getElementById('friends-copy-btn').addEventListener('click', async () => {
  if (!ensureInviteName()) return;
  const link = buildInviteLink();
  startSharingLive();
  try { await navigator.clipboard.writeText(link); showToast('Link copied', 'Paste it in a text to a friend.', 'success'); }
  catch { window.prompt('Copy your link:', link); }
  });
  document.getElementById('friends-invite-btn')?.addEventListener('click', inviteFriend);
  document.getElementById('ff-open-friends')?.addEventListener('click', openFoodieFriends);
  document.getElementById('ff-plan-date')?.addEventListener('click', () => openFoodiePlan());

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
  const txt = `🎯 My Cuisine Bingo: ${filled}/${total} cuisines explored! #FeedTheBear`;
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
  const txt = `🌍 I've tasted ${countries.size} countries & ${Object.keys(cuisineVisits).length} cuisines! #FeedTheBear`;
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
  if (_homeDiscCache) renderHomeDiscovery(_homeDiscCache);
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
  BackNav.init();
  initDialogFocus();
  const layoutOffsets = new Map([
    ['.app-header', '--header-offset'],
    ['#stats-bar', '--stats-offset'],
    ['.filter-bar', '--filter-offset'],
  ].map(([selector, name]) => [document.querySelector(selector), name]));
  const layoutObserver = new ResizeObserver(entries => {
    entries.forEach(({ target }) => document.documentElement.style.setProperty(layoutOffsets.get(target), `${target.getBoundingClientRect().height}px`));
  });
  layoutOffsets.forEach((name, element) => layoutObserver.observe(element));
  if (NativeAlerts.available()) {
  NativeAlerts.refresh();
  NativeAlerts.schedule();
  // Back from Android's settings page after choosing "Allow all the time".
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { NativeAlerts.refresh(); NativeAlerts.schedule(); } });
  }
  document.getElementById('bg-location-allow')?.addEventListener('click', () => NativeAlerts.allowBackground());
  document.getElementById('bg-location-later')?.addEventListener('click', () => {
  state.settings.nearAlertsClosed = false;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
  closeBgLocation();
  NativeAlerts.schedule();
  renderNearAlertsRow();
  });
  // A tapped "near a spot" notification opens that spot.
  openSpotFromLink(new URLSearchParams(window.location.search).get('spot'));
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'OPEN_SPOT') openSpotFromLink(e.data.id); });
  if (state.settings.locationEnabled) setTimeout(pinWantToTrySpots, 8000);
  document.getElementById('nearalerts-close')?.addEventListener('click', closeNearAlerts);
  document.getElementById('partner-close')?.addEventListener('click', closePartnerSheet);
  document.getElementById('partner-overlay')?.addEventListener('click', e => { if (e.target.id === 'partner-overlay') closePartnerSheet(); });
  document.getElementById('nearalerts-overlay')?.addEventListener('click', e => { if (e.target.id === 'nearalerts-overlay') closeNearAlerts(); });
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
      // After sign-in has settled: contests coming up, and the daily nudges' area.
      setTimeout(() => { window.checkFoodEventHeadsUp?.(); shareNudgeArea(); }, 6000);
    },
    err => {
      state.locationEnabled = false;
      if (err?.code === 1) {
        // Permission revoked: clear the saved flag so the banner offers it again.
        state.settings.locationEnabled = false;
        setLocationBannerCooldown();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      }
      // A slow GPS fix (common indoors) used to switch location off for good
      // and leave "Finding restaurants near you" up forever. Keep the setting,
      // show the saved-spots fallback, and keep watching for a fix.
      updateLocationBanner();
      renderNearbyHomeFallback(err);
      if (err?.code !== 1) startWatching();
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
  );
  }
  updateTagSuggestions();
  updateAppBadge();
  renderAll();
  showOnboarding();
  // One "open" per browser session, so the usage dashboard has a baseline.
  try {
  if (!sessionStorage.getItem('ftb_open_counted')) {
    sessionStorage.setItem('ftb_open_counted', '1');
    trackProductEvent(state.restaurants.length ? 'app_opened' : 'app_opened_new');
  }
  } catch { /* private mode */ }
  checkIncomingChallenge();
  trackReferralOpen();
  updateChallengeBtnBadge();
  checkWeeklySuggestion();
  checkGuestProfile();
  handleWebShareTarget();
  handleLaunchActions();
  // Old Dinner Room links (?room=) open the new Dinner Vote.
  if (new URLSearchParams(window.location.search).has('room')) openDinnerRooms();
  // Post-render: add compare checkboxes if mode was active
  if (_compareMode) addCompareCheckboxes();
  // Wire home discovery buttons
  document.getElementById('nearby-home-more-btn')?.addEventListener('click', discoverNearby);
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
  document.getElementById('home-quick-nearby-btn')?.addEventListener('click', () => { hapticTap('medium'); discoverNearby(); });
  document.getElementById('home-quick-plan-btn')?.addEventListener('click', () => { hapticTap('medium'); openSmartPlanner(); });
  document.getElementById('home-quick-share-btn')?.addEventListener('click', () => { hapticTap('medium'); openShareHighlights(); });
  document.getElementById('home-quick-itinerary-btn')?.addEventListener('click', () => { hapticTap('medium'); openSmartItinerary(); });
  document.getElementById('home-quick-rooms-btn')?.addEventListener('click', () => { hapticTap('medium'); openDinnerRooms(); });
  document.getElementById('ai-rec-banner')?.addEventListener('click', e => {
  if (!e.target.closest('#ai-rec-refresh-btn') && !grizzlyLocked('pick')) openAiRecPick();
  });
  document.getElementById('ai-rec-refresh-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  if (grizzlyLocked('pick')) return;
  if (!usesAiDailyPick()) { showLocalDailyPick({ reroll: true }); return; }
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
  // Username & public page live in Settings too (friends.js renders them).
  document.getElementById('account-handle-row')?.addEventListener('click', () => { closeAccountModal(); setTimeout(openHandleSettings, 150); });
  document.getElementById('handle-close-btn')?.addEventListener('click', closeHandleSettings);
  document.getElementById('handle-overlay')?.addEventListener('click', e => { if (e.target.id === 'handle-overlay') closeHandleSettings(); });
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
  if (e.target.closest('.decision-location-btn')) { enableLocation(); return; }
  const voteBtn = e.target.closest('.decision-vote-btn');
  if (voteBtn) {
    trackProductEvent('decision_to_vote', { options: voteBtn.dataset.ids.split(',').length });
    closeDecisionMode();
    setTimeout(() => openDinnerRooms(voteBtn.dataset.ids.split(',')), 120);
    return;
  }
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
  document.getElementById('dv-start')?.addEventListener('click', startDinnerVote);
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
  const nowWeek  = isoWeek(iso());
  const lastWeek = isoWeek(iso(-7));
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
  if (moods.includes('adventurous') && ['thai', 'indian', 'korean', 'ethiopian', 'vietnamese', 'peruvian', 'japanese', 'chinese'].some(x => cuisine.includes(x))) s += 1.7;
  if (moods.includes('late-night') && ['mexican', 'pizza', 'american', 'thai', 'korean', 'bbq', 'chinese'].some(x => cuisine.includes(x))) s += 1.7;
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
    + '<button class="btn-sm btn-orange" onclick="openAddModalPreFilled(\'' + escJsArg(p.name || '') + '\',\'' + escJsArg(p.cuisine || '') + '\',{name:\'' + escJsArg(p.name || '') + '\',address:\'' + escJsArg(p.address || '') + '\',website:\'' + escJsArg(p.website || '') + '\',lat:' + (Number.isFinite(p.lat) ? Number(p.lat) : 'null') + ',lon:' + (Number.isFinite(p.lon) ? Number(p.lon) : 'null') + '})">+ Save Spot</button>'
    + (mapsDest ? '<a class="btn-sm btn-secondary" style="text-decoration:none;display:inline-flex;align-items:center" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(mapsDest) + '&travelmode=driving" target="_blank" rel="noopener"> Directions</a>' : '')
    + '</div>';
  res.classList.remove('hidden');
  return;
  }

  const all = state.restaurants.filter(isAvailableSpot);
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
  if (moods.includes('adventurous') && ['Thai','Indian','Korean','Ethiopian','Vietnamese','Peruvian','Japanese','Chinese'].includes(r.cuisine)) s += 2;
  if (moods.includes('late-night') && ['Mexican','Pizza','American','Thai','Korean','BBQ','Chinese'].includes(r.cuisine)) s += 2;
  if (moods.includes('quick')   && r.priceRange <= 2) s += 1;
  if (moods.includes('surprise')) s += Math.random() * 2;
  return { r, s };
  });
  scored.sort((a,b) => b.s - a.s);
  const p = scored[0].r;
  const stars = p.myRating > 0 ? '★'.repeat(p.myRating) : '';
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
  + '<div class="pr-stat"><div class="val">'+avgRating+(avgRating!=='-'?' ★':'')+'</div><div class="lbl">Avg Rating</div></div>'
  + '<div class="pr-stat"><div class="val">'+currentStreak+' wk</div><div class="lbl">Current Streak</div></div>'
  + '<div class="pr-stat"><div class="val">'+longestStreak+' wk</div><div class="lbl">Best Streak</div></div>'
  + '</div></div>'
  + (topPicks.length ? '<div class="pr-section"><h2>Top Rated Visits</h2>'
    + topPicks.map((r,i) => '<div class="pr-pick"><div class="rank">#'+(i+1)+'</div><div><div class="name">'+escHtml(r.name)+'</div>'+(r.address?'<div class="addr">'+escHtml(r.address)+'</div>':'')+'</div><div class="stars">'+'★'.repeat(r.myRating)+'</div></div>').join('')
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
    '<div class="challenge-pick-item"><span class="cp-rank">#'+(i+1)+'</span><span class="cp-emoji">'+cuisineEmoji(r.cuisine)+'</span><span class="cp-name">'+escHtml(r.name)+'</span><span class="cp-stars">'+'★'.repeat(r.myRating)+'</span></div>'
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
  btn.textContent = '✓ Copied!';
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
    + picks.map((p,i) => '<div class="challenge-pick-item"><span class="cp-rank">#'+(i+1)+'</span><span class="cp-name">'+escHtml(p.n)+'</span><span class="cp-stars">'+'★'.repeat(p.s)+'</span></div>').join('')
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
  // A spot with no name (old or half-saved data) must not crash whole screens.
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g,'').trim();
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
  showToast('Milestone!', 'You have ' + hit + ' total check-in' + (hit>1?'s':'') + '! Keep exploring!', 'success');
  }
  // streak milestone
  if (next.length > prev.length) {
  const { currentStreak } = calcStreaks();
  if ([3,5,10,20].includes(currentStreak)) {
    launchConfetti(2500);
    showToast('Streak ' + currentStreak + '!', currentStreak + '-week streak! You are a foodie legend.', 'success');
  }
  }
}

/* ------------------------------------------------------------
   PHASE 6 • AUTO DARK / LIGHT MODE
   ------------------------------------------------------------ */

let _autoThemeTimer = null;

// Dark is the default at every hour. Following the phone is opt-in.
function getAutoThemePresetByHour (hour = new Date().getHours()) {
  const part = hour >= 6 && hour < 11 ? 'morning' : hour >= 11 && hour < 17 ? 'day' : hour >= 17 && hour < 22 ? 'evening' : 'late-night';
  return { mode: 'dark', accent: 'midnight', part };
}

// Auto follows the phone's light/dark setting: warm Honey in light mode,
// gold-on-dark in dark mode. The clock only names the part of the day.
const _darkSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
function getAutoThemePreset () {
  const { part } = getAutoThemePresetByHour();
  return _darkSchemeQuery?.matches
  ? { mode: 'dark', accent: 'midnight', part }
  : { mode: 'light', accent: 'honey', part };
}

function applyAutoThemeByClock (opts = {}) {
  if (state.settings.themeManual || state.settings.themeChoice !== 'auto') return;
  const preset = getAutoThemePreset();
  const partChanged = state.settings.theme !== preset.mode;

  document.body.classList.toggle('light-mode', preset.mode === 'light');
  document.body.dataset.themeAccent = preset.accent;
  syncThemeMetaColor();

  state.settings.theme = preset.mode;
  state.settings.themeChoice = 'auto';
  state.settings.autoThemePart = preset.part;

  if (opts.persist) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }
  if (partChanged && opts.announce) {
  showToast('Theme', preset.mode === 'dark' ? 'Dark mode, to match your phone.' : 'Light mode, to match your phone.', 'info');
  }
}

// Switch the moment the phone flips between light and dark.
_darkSchemeQuery?.addEventListener?.('change', () => {
  if (state.settings.themeChoice === 'auto') applyAutoThemeByClock({ persist: true, announce: false });
});

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
  if (state.settings.themeChoice === 'auto') {
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
    + '<div><div class="lb-stars">' + '★'.repeat(r.myRating) + '</div>'
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
  // First run (or an older profile): stamps you already had aren't news.
  if (!Array.isArray(state.settings.passportUnlocked)) {
  state.settings.passportUnlocked = [...triedSet];
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
  }
  const prevUnlocked = new Set(state.settings.passportUnlocked);

  let html = '';
  let newUnlocks = 0;
  ALL_CUISINES.forEach(([name, emoji]) => {
  const key = name.toLowerCase();
  const count = visited.filter(r => (r.cuisine||'').toLowerCase() === key).length;
  const unlocked = triedSet.has(key);
  const isNew = unlocked && !prevUnlocked.has(key);
  if (isNew) newUnlocks++;
  html += '<div class="passport-stamp ' + (unlocked ? 'unlocked' : 'locked') + (isNew ? ' new-unlock' : '') + '" title="' + (count > 0 ? count + ' visit' + (count>1?'s':'') : 'Not tried yet') + '">'
    + '<span class="ps-emoji">' + (unlocked ? (emoji || cuisineEmoji(name)) : '🔒') + '</span>'
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
  showToast('Passport Stamped!', newUnlocks + ' new cuisine' + (newUnlocks>1?'s':'') + ' unlocked!', 'success');
  }
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

// Parsed rows waiting in the preview: { name, note, address, website, checked, dupe, on }
let _importParsed = [];

function showImportBookmarks (prefill = '') {
  _importParsed = [];
  document.getElementById('import-paste-area').value = typeof prefill === 'string' ? prefill : '';
  document.getElementById('import-preview').innerHTML = '';
  document.getElementById('import-file-names').textContent = '';
  document.getElementById('import-confirm-btn').disabled = true;
  document.getElementById('import-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
  if (typeof prefill === 'string' && prefill.trim()) parseImportText();
}
function closeImportBookmarks () {
  document.getElementById('import-overlay').classList.add('hidden');
  maybeHideOverlay();
}

const IMPORT_TICKED = /^(?:☑|✅|✔️?|✓|\[[xX✓]\])\s*/;
const IMPORT_BULLET = /^(?:☐|⬜|□|▢|◻️?|\[\s?\]|[-*•·▪◦‣–—>]|\d{1,3}[.)]|[a-zA-Z][.)](?=\s))\s*/;
// A first line like "Restaurants to try:" or "Food list" is a note title, not a place.
const IMPORT_TITLE = /^(?:my\s+)?(?:(?:restaurants?|places?|spots?|food|eats?|foodie|dining|brunch|dinner|lunch|bars?|coffee|date\s+nights?)(?:\s+(?:to\s+(?:try|go|eat|visit)|list|wishlist|bucket\s*list|ideas|spots|places))?|(?:to\s+try|want\s+to\s+try|try\s+list|bucket\s*list|wishlist)(?:\s+.*)?)\s*:?$/i;
const IMPORT_URL = /https?:\/\/\S+/gi;

// One line of a notes list to a place, or null if it isn't one.
function parseImportLine (line) {
  let s = String(line || '').replace(/[​﻿]/g, '').trim();
  if (!s) return null;
  let checked = false;
  for (let i = 0; i < 3; i++) {
  if (IMPORT_TICKED.test(s)) { checked = true; s = s.replace(IMPORT_TICKED, ''); continue; }
  if (IMPORT_BULLET.test(s)) { s = s.replace(IMPORT_BULLET, ''); continue; }
  break;
  }
  // Strike-through ~~done~~ in Markdown notes also means been there.
  if (/^~~.+~~$/.test(s)) { checked = true; s = s.slice(2, -2); }
  const website = (s.match(IMPORT_URL) || [])[0] || '';
  s = s.replace(IMPORT_URL, '').replace(/\s{2,}/g, ' ').trim();
  if (!s || s.length > 120 || /^#/.test(s) || /:$/.test(s)) return null;

  // "Name - note", "Name: note", "Name (note)"
  let name = s;
  let note = '';
  const dash = s.match(/^(.+?)\s+[-–—|]\s+(.+)$/) || s.match(/^([^:]{2,60}):\s+(.+)$/);
  if (dash) { name = dash[1]; note = dash[2]; }
  else {
  const paren = s.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (paren) { name = paren[1]; note = paren[2]; }
  }
  // "Name, 105 Hudson St, New York": the rest is an address when it has a street number.
  let address = '';
  const comma = name.match(/^([^,]+),\s*(.+)$/);
  if (comma) {
  if (/\d/.test(comma[2])) { name = comma[1]; address = comma[2]; }
  else if (!note) { name = comma[1]; note = comma[2]; }
  }
  name = name.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim().slice(0, 80);
  if (name.length < 2 || !/[\p{L}\p{N}]/u.test(name)) return null;
  return { name, note: note.trim().slice(0, 300), address: address.trim().slice(0, 200), website, checked };
}

// Google Maps Takeout "Saved Places" GeoJSON, Keep Takeout notes, or plain arrays.
function placesFromJson (data) {
  const out = [];
  const items = Array.isArray(data) ? data : (Array.isArray(data?.features) ? data.features : [data]);
  items.forEach(item => {
  if (!item || typeof item !== 'object') return;
  const props = item.properties || item;
  // Google Keep: { title, textContent, listContent: [{ text, isChecked }] }
  if (Array.isArray(props.listContent) || typeof props.textContent === 'string') {
    if (props.isTrashed) return;
    (props.listContent || []).forEach(li => {
      const p = parseImportLine(li?.text);
      if (p) out.push({ ...p, checked: p.checked || !!li?.isChecked });
    });
    String(props.textContent || '').split(/\r?\n/).forEach(l => { const p = parseImportLine(l); if (p) out.push(p); });
    return;
  }
  const name = props.Title || props.title || props.name || props.Name || props.location?.name || '';
  const address = props.Location?.Address || props.location?.address || props.address || props.Address || '';
  if (name) out.push({ name: String(name).slice(0, 80), note: String(props.Note || props.note || props.Comment || '').slice(0, 300), address: String(address).slice(0, 200), website: props.google_maps_url || props.url || '', checked: false });
  });
  return out;
}

// Pasted or file text to places. Whole-text JSON first, then line by line.
function parseImportSource (raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  if (/^[[{]/.test(text)) {
  try { return placesFromJson(JSON.parse(text)); } catch { /* not one JSON document */ }
  }
  const lines = text.split(/\r?\n/);
  // Skip a note's title line (and a CSV header) at the top.
  while (lines.length && (!lines[0].trim() || IMPORT_TITLE.test(lines[0].trim()) || /^(name|title|place)\s*(,|$)/i.test(lines[0].trim()))) lines.shift();
  const out = [];
  lines.forEach(line => {
  const t = line.trim().replace(/,$/, '');
  if (/^[{]/.test(t)) {
    try { out.push(...placesFromJson(JSON.parse(t))); return; } catch { /* fall through */ }
  }
  if (IMPORT_TITLE.test(t)) return;
  const p = parseImportLine(line);
  if (p) out.push(p);
  });
  return out;
}

// A note file to plain text. Keep's Takeout HTML lists each item in a <li>.
async function textFromNoteFile (file) {
  const raw = await file.text();
  if (!/\.html?$/i.test(file.name) && !/^\s*<(?:!doctype|html)/i.test(raw)) {
  // Samsung Notes and others name the file after the note; drop that title line.
  const base = file.name.replace(/\.[^.]+$/, '').trim().toLowerCase();
  const lines = raw.split(/\r?\n/);
  const first = lines.findIndex(l => l.trim());
  if (first >= 0 && lines[first].trim().toLowerCase() === base) lines.splice(first, 1);
  return lines.join('\n');
  }
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  doc.querySelectorAll('script, style, title, .heading, .title, .meta-icons, .chips').forEach(el => el.remove());
  doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  doc.querySelectorAll('li, p, div, h1, h2, h3, tr').forEach(el => el.append('\n'));
  // Keep marks ticked list items with a "checked" class on the bullet's parent.
  doc.querySelectorAll('li.listitem.checked, li.checked').forEach(li => li.prepend('☑ '));
  return doc.body?.textContent || '';
}

async function importNoteFiles (files) {
  const list = [...(files || [])];
  if (!list.length) return;
  const texts = [];
  for (const f of list) {
  try { texts.push(await textFromNoteFile(f)); } catch { showToast('Could not read file', f.name, 'error'); }
  }
  const area = document.getElementById('import-paste-area');
  // JSON files stay whole so they parse as JSON, one file per block.
  area.value = [area.value.trim(), ...texts.map(t => t.trim())].filter(Boolean).join('\n\n');
  document.getElementById('import-file-names').textContent = list.map(f => f.name).join(', ');
  parseImportText();
}

function parseImportText () {
  const raw = document.getElementById('import-paste-area').value;
  // Several pasted/loaded JSON files are split on blank lines between them.
  const blocks = raw.split(/\n\s*\n(?=\s*[[{])/);
  const seen = new Set();
  _importParsed = [];
  blocks.flatMap(parseImportSource).forEach(p => {
  const key = normalizeName(p.name);
  if (!key || seen.has(key)) return;
  seen.add(key);
  const dupe = findDuplicates(p.name).length > 0;
  _importParsed.push({ ...p, dupe, on: !dupe });
  });
  renderImportPreview();
}

function renderImportPreview () {
  const preview = document.getElementById('import-preview');
  const btn = document.getElementById('import-confirm-btn');
  if (!_importParsed.length) {
  preview.innerHTML = '<div class="import-empty">No places found yet. Put one place per line.</div>';
  btn.disabled = true;
  btn.textContent = 'Import';
  return;
  }
  const picked = _importParsed.filter(p => p.on);
  const toVisited = picked.filter(p => p.checked).length;
  preview.innerHTML = `<div class="import-count">Found ${_importParsed.length} place${_importParsed.length === 1 ? '' : 's'}. Untick any you don't want.</div>`
  + _importParsed.map((p, i) => `<label class="import-row${p.dupe ? ' is-dupe' : ''}">
      <input type="checkbox" data-idx="${i}" ${p.on ? 'checked' : ''} />
      <span class="import-row-main"><span class="import-row-name">${escHtml(p.name)}</span>
        ${p.note || p.address ? `<span class="import-row-addr">${escHtml([p.note, p.address].filter(Boolean).join(' · ').slice(0, 80))}</span>` : ''}</span>
      ${p.dupe ? '<span class="import-tag">Already saved</span>' : p.checked ? '<span class="import-tag been">Been there</span>' : ''}
    </label>`).join('');
  btn.disabled = !picked.length;
  btn.textContent = !picked.length ? 'Import'
  : `Import ${picked.length}${toVisited ? ` (${toVisited} to Visited)` : ''}`;
}

function confirmImport () {
  let picked = _importParsed.filter(p => p.on);
  if (!picked.length) return;
  // Cub keeps a spot limit; import what fits and pitch Grizzly for the rest.
  let leftOut = 0;
  if (typeof isPremium === 'function' && !isPremium()) {
  const room = Math.max(0, FREE_RESTAURANT_LIMIT - state.restaurants.length);
  leftOut = Math.max(0, picked.length - room);
  picked = picked.slice(0, room);
  }
  const now = iso();
  picked.forEach(p => {
  const entry = {
    id: uid(), name: p.name, cuisine: '', priceRange: 0,
    address: p.address || '', lat: null, lng: null,
    website: p.website || '', photo: '', googleRating: 0, googleReviews: 0,
    myRating: 0, notes: p.note || '', tags: [], collectionId: null,
    status: p.checked ? 'visited' : 'want-to-try', dateAdded: now, dateVisited: null, visits: [],
    updatedAt: Date.now(),
  };
  state.restaurants.unshift(entry);
  if (p.address) geocodeAddress(entry.id, p.address);
  });
  if (picked.length) { saveData(); renderAll(); }
  closeImportBookmarks();
  const wants = picked.filter(p => !p.checked).length;
  const been = picked.length - wants;
  trackProductEvent('list_imported', { added: picked.length, visited: been, leftOut });
  if (picked.length) {
  showToast('Imported!', [wants && `${wants} to Want to Try`, been && `${been} to Visited`].filter(Boolean).join(', ') + '.', 'success');
  launchConfetti(2000);
  }
  if (leftOut) {
  showToast('Cub limit reached', `${leftOut} more didn't fit. Grizzly saves unlimited spots.`, 'info');
  showGrizzlyUpsell('limit');
  }
}

/* ------------------------------------------------------------
   PHASE 6 • AI WEEKLY SUGGESTION
   ------------------------------------------------------------ */

function checkWeeklySuggestion () {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const last = state.settings.lastWeeklySuggest || 0;
  const now  = Date.now();
  // At most once a week.
  if (now - last < WEEK_MS) return;

  const wantToTry = state.restaurants.filter(r => r.status === 'want-to-try' && nearEnoughToSuggest(r));
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
  + '<div class="wsb-text">' + weeklyPickSentence(suggestion, favCuisine) + '</div>'
  + '</div>'
  + '<button class="btn-sm btn-orange wsb-view" type="button">View</button>'
  + '<button class="wsb-dismiss" type="button" aria-label="Dismiss">✕</button>';
  // The whole banner opens the pick; only ✕ dismisses.
  banner.addEventListener('click', e => {
  banner.remove();
  if (!e.target.closest('.wsb-dismiss')) openDetailModal(suggestion.id);
  });
  // Byte Cub says it, instead of another banner on the screen.
  const plain = document.createElement('div');
  plain.innerHTML = weeklyPickSentence(suggestion, favCuisine);
  whenCubQuiet(() => showToast("Byte Cub's pick of the week", plain.textContent, 'info', { label: 'See it', run: () => openDetailModal(suggestion.id) }));
}

function weeklyPickSentence (pick, favCuisine) {
  const name = '<strong>' + escHtml(pick.name) + '</strong>';
  const cuisine = escHtml(pick.cuisine || '');
  if (cuisine && favCuisine && pick.cuisine === favCuisine) return `Try ${name} this week. It's ${cuisine}, and you love ${cuisine}!`;
  if (cuisine && favCuisine) return `Try ${name} this week. It's ${cuisine}, a nice break from all that ${escHtml(favCuisine)}.`;
  return `Try ${name} this week. It's been waiting on your Want to Try list.`;
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

// The browser's speech recognition, or in the Android app (whose web view has
// none) the phone's own, through SpeechPlugin.java in the same shape.
function speechRecognitionClass () {
  const native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.Speech : null;
  if (native?.start) return NativeSpeechRecognition;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
class NativeSpeechRecognition {
  constructor () { this.lang = 'en-US'; this.interimResults = false; this._ended = false; }
  _results (text, isFinal) {
    const r = [{ transcript: text }]; r.isFinal = isFinal;
    return { results: [r] };
  }
  async start () {
    const plugin = window.Capacitor.Plugins.Speech;
    this._sub = await plugin.addListener('partial', d => {
      if (this.interimResults && d?.text && !this._ended) this.onresult?.(this._results(d.text, false));
    });
    try {
      const { text } = await plugin.start({ lang: this.lang });
      if (!this._ended && text) this.onresult?.(this._results(text, true));
      else if (!this._ended) this.onerror?.({ error: 'no-speech' });
    } catch (err) {
      if (!this._ended) this.onerror?.({ error: err?.code || 'no-speech' });
    }
    this._end();
  }
  stop () { window.Capacitor.Plugins.Speech.stop().catch(() => {}); }
  abort () { window.Capacitor.Plugins.Speech.abort().catch(() => {}); this._end(); }
  _end () {
    if (this._ended) return;
    this._ended = true;
    this._sub?.remove?.();
    this.onend?.();
  }
}

function setVoiceButtonsListening (isListening) {
  document.querySelectorAll('#search-voice-btn, #voice-btn').forEach(el => {
  if (isListening) el.classList.add('listening');
  else el.classList.remove('listening');
  });
}

function startVoiceAdd () {
  const SpeechRecognition = speechRecognitionClass();
  if (!SpeechRecognition) {
  showToast('Not Supported', 'Voice input is not supported in this browser. Try Chrome.', 'error');
  return;
  }
  const overlay = document.getElementById('voice-overlay');
  const status = document.getElementById('voice-status');
  const transcript = document.getElementById('voice-transcript');
  if (_voiceRecognition) { stopVoice(); return; }
  overlay.classList.remove('hidden');
  setVoiceButtonsListening(true);
  status.textContent = 'Listening...';
  transcript.textContent = 'Say a spot or dish to search, or "add [name]" to save one';

  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let failed = false;

  rec.onresult = e => {
  const text = Array.from(e.results).map(r => r[0].transcript).join('');
  transcript.textContent = '"' + text + '"';
  if (e.results[e.results.length - 1].isFinal) {
    stopVoice();
    parseVoiceInput(text);
  }
  };
  // Keep the card up long enough to read what went wrong.
  rec.onerror = e => {
  if (e.error === 'aborted') return;
  failed = true;
  status.textContent = VOICE_ERRORS[e.error] || "Couldn't hear that. Try again.";
  transcript.textContent = '';
  setTimeout(() => { if (_voiceRecognition === rec) stopVoice(); }, 2500);
  };
  rec.onend = () => { if (!failed && _voiceRecognition === rec) stopVoice(); };
  _voiceRecognition = rec;
  try { rec.start(); } catch (_) { stopVoice(); }
}
const VOICE_ERRORS = {
  'not-allowed': 'Microphone blocked. Allow it for this site in your browser settings.',
  'service-not-allowed': 'Microphone blocked. Allow it for this site in your browser settings.',
  'no-speech': "Didn't hear anything. Tap the mic and try again.",
  'audio-capture': 'No microphone found.',
  'network': 'Voice needs an internet connection.'
};
// Talk to Byte Cub: words fill the chat box as you speak, then send.
// Hidden where the browser has no speech recognition.
let _chatRecognition = null;
function initChatMic () {
  const btn = document.getElementById('chat-mic-btn');
  if (!btn) return;
  const SpeechRecognition = speechRecognitionClass();
  if (!SpeechRecognition) { btn.classList.add('hidden'); return; }
  btn.addEventListener('click', () => {
  if (_chatRecognition) { _chatRecognition.stop(); return; }
  const input = document.getElementById('chat-input');
  const rec = new SpeechRecognition();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = e => {
    input.value = Array.from(e.results).map(r => r[0].transcript).join('');
    if (e.results[e.results.length - 1].isFinal) { rec.stop(); sendChat(); }
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      showToast('Microphone blocked', 'Allow microphone access for this site to talk to Byte Cub.', 'error');
    }
  };
  const placeholder = input.placeholder;
  rec.onend = () => { _chatRecognition = null; btn.classList.remove('listening'); input.placeholder = placeholder; };
  _chatRecognition = rec;
  btn.classList.add('listening');
  input.placeholder = 'Listening…';
  try { rec.start(); } catch (_) { rec.onend(); }
  });
}
function stopVoice () {
  // abort, not stop: a cancelled listen shouldn't still search or add.
  if (_voiceRecognition) { try { _voiceRecognition.abort(); } catch(_){} _voiceRecognition = null; }
  document.getElementById('voice-overlay').classList.add('hidden');
  setVoiceButtonsListening(false);
}
function parseVoiceInput (text) {
  text = text.trim().replace(/[.?!]+$/, '');
  if (!text) { showToast('Couldn\'t hear that', 'Please try again.', 'error'); return; }
  // "add nobu on 105 hudson street"
  const addMatch = text.match(/^add\s+(.+?)(?:\s+(?:on|at|in)\s+(.+))?$/i);
  if (!addMatch) {
  // Anything else is a search, same as typing it.
  const search = document.getElementById('search-input');
  search.value = text.replace(/^(?:please\s+)?(?:find|search(?:\s+for)?|look\s+for|show\s+me)\s+/i, '').replace(/\s+near\s+me$/i, '').trim() || text;
  search.dispatchEvent(new Event('input', { bubbles: true }));
  return;
  }
  const name    = addMatch[1].trim();
  const address = (addMatch[2] || '').trim();
  // Open add modal pre-filled
  openAddModal();
  document.getElementById('form-name').value = name;
  if (address) document.getElementById('form-address').value = address;
  showToast('Voice Captured!', '"' + name + '"' + (address ? ' at ' + address : '') + ' · review and save.', 'success');
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
  showToast('Reminder!', 'Time for your visit to "' + r.name + '"!', 'success');
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
  if (status) status.innerHTML = '<span style="color:var(--green)">✓ Reminder set for '
    + new Date(ts).toLocaleString() + '</span>';
  showToast('✓ Reminder Set!', '"' + r.name + '" on ' + new Date(ts).toLocaleDateString(), 'success');
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

// Every food photo: dish, visit, and cover shots, newest first. A photo
// shared by a dish and its visit (Just Ate) shows once, as the dish.
function collectFoodPhotos () {
  const seen = new Set();
  const out = [];
  const add = (src, name, id, date, type, video = '') => {
  const safe = safeUrl(src || '');
  if (!safe || seen.has(safe)) return;
  seen.add(safe);
  out.push({ src: safe, name, id, date: date || '', type, video });
  };
  (state.restaurants || []).forEach(r => {
  dishesOf(r).forEach(d => mediaOf(d).forEach(m => add(m.photo, `${d.name} · ${r.name}`, r.id, d.date, 'dish', m.video)));
  (r.visits || []).forEach(v => mediaOf(v).forEach(m => add(m.photo, `${v.dish || r.name}${v.dish ? ` · ${r.name}` : ''} - ${fmtDate(v.date)}`, r.id, v.date, 'visit', m.video)));
  add(r.photo, r.name, r.id, r.dateVisited || r.dateAdded, 'cover');
  });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function openGallery () {
  _galleryPhotos = collectFoodPhotos();
  const grid = document.getElementById('gallery-grid');
  if (!_galleryPhotos.length) {
  grid.innerHTML = '<div class="gallery-empty">No photos yet. Tap <strong>Just Ate</strong> and snap your next plate.</div>';
  } else {
  grid.innerHTML = _galleryPhotos.map((p,i) =>
    '<div class="gallery-item" data-idx="' + i + '">'
    + '<img src="' + escHtml(p.src) + '" alt="' + escHtml(p.name) + '" loading="lazy" />'
    + '<div class="gallery-item-name">' + escHtml(p.name) + '</div>'
    + (p.video ? '<span class="video-badge" aria-label="Video">▶</span>' : '')
    + (p.type === 'visit' ? '<div class="gallery-type-badge">Visit</div>' : '')
    + '</div>'
  ).join('');
  grid.querySelectorAll('.gallery-item[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      const p = _galleryPhotos[parseInt(el.dataset.idx)];
      if (p?.video) playFoodVideo(p.video, p.name); else openLightbox(parseInt(el.dataset.idx));
    });
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
  { label: 'My Rating', fn: r => r.myRating ? '★'.repeat(r.myRating) : '-', num: r => r.myRating||0 },
  { label: 'Google ★',  fn: r => r.googleRating ? r.googleRating + ' / 5' : '-', num: r => r.googleRating||0 },
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
  showToast('Budget Saved!', 'Monthly budget set to $' + state.settings.monthlyBudget, 'success');
  if (state.currentView === 'stats') renderBudgetChart();
}
function renderBudgetChart () {
  const el = document.getElementById('chart-budget');
  if (!el) return;
  const { monthlyBudget = 0, avgSpend = 35 } = state.settings;
  if (!monthlyBudget) {
  el.innerHTML = '<div class="budget-setup">No budget set. <a onclick="openBudget()">Set your monthly budget →</a></div>';
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
           : ' · <span style="color:var(--green)">$' + remaining.toFixed(0) + ' remaining ✓</span>')
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
  + '<button class="cal-nav" id="cal-prev">‹</button>'
  + '<span class="cal-month-label">' + monthName + '</span>'
  + '<button class="cal-nav" id="cal-next">›</button>'
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
   PHASE 7 • WEB SHARE TARGET HANDLER
   ------------------------------------------------------------ */

function looksLikeSharedUrl (value) {
  return /https?:\/\//i.test(String(value || '')) || /(?:maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(String(value || ''));
}

const SOCIAL_SHARE_RE = /tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|x\.com|twitter\.com|threads\.net|yelp\.com/i;

function handleWebShareTarget () {
  const params = new URLSearchParams(window.location.search);
  const title = params.get('title') || '';
  const url   = params.get('url')   || '';
  const text  = params.get('text')  || '';
  const reserved = params.has('action') || params.has('upgrade') || params.has('session_id') || params.has('room') || params.has('landing');
  // A list shared from Keep, Samsung Notes, etc.: several lines, mostly not links.
  const isList = !reserved && !url && !SOCIAL_SHARE_RE.test(text)
  && text.split(/\r?\n/).filter(l => l.trim()).length >= 2 && parseImportSource(text).length >= 2;
  if (isList) {
  history.replaceState(null, '', window.location.pathname);
  trackProductEvent('list_shared_in', {});
  showImportBookmarks(text);
  return;
  }
  const isShare = params.has('share-target') || ((!reserved) && (title || url || looksLikeSharedUrl(text)));
  // Nothing shared just now: pick up a shared post the page lost (reloaded) before saving.
  if (!isShare) { if (!reserved) window.Cub?.resumeShare?.(); return; }
  const sharedUrl = url || (looksLikeSharedUrl(text) ? text.trim().split(/\s+/).find(looksLikeSharedUrl) || '' : '');
  if (!title && !sharedUrl && !text) return;
  history.replaceState(null,'', window.location.pathname);
  // A TikTok/Instagram/YouTube post: the Cub reads it and finds the restaurant.
  const shared = [sharedUrl, text, title].filter(Boolean).join(' ');
  if (window.Cub && SOCIAL_SHARE_RE.test(shared)) {
  window.Cub.openAdd(shared);
  return;
  }
  // From a city guide's Save (share-target=1): the exact name, and its address.
  const fromGuide = params.get('share-target') === '1';
  const name = (fromGuide ? title.trim() : title.replace(/\s*[-|].*$/, '').trim()) || (text && !looksLikeSharedUrl(text) ? text.trim() : '') || 'Shared Place';
  openAddModal();
  document.getElementById('form-name').value = name;
  const addr = (params.get('addr') || '').trim().slice(0, 200);
  if (addr) document.getElementById('form-address').value = addr;
  if (sharedUrl) {
  document.getElementById('form-website').value = sharedUrl;
  if (looksLikeSharedUrl(sharedUrl)) {
    document.getElementById('form-maps-url').value = sharedUrl;
    if (/maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(sharedUrl)) parseMapsUrl(sharedUrl);
  }
  }
  showToast('Shared!', '"' + name + '" opened for review · fill in details and save!', 'success');
}

function handleLaunchActions () {
  const params = new URLSearchParams(window.location.search);
  const action = (params.get('action') || '').toLowerCase();
  if (!action) return;
  history.replaceState(null, '', window.location.pathname + window.location.hash);
  if (action === 'add') {
  openAddModal();
  return;
  }
  // A friend's "make your Bear Cave page" link: pick a username, once signed in.
  if (action === 'page') {
  let tries = 0;
  const open = () => {
    if (window._ftbUid && typeof openHandleSettings === 'function') { openHandleSettings(); trackProductEvent('bear_cave_invite_opened'); }
    else if (++tries < 120) setTimeout(open, 1000);
  };
  setTimeout(open, 800);
  return;
  }
  if (action === 'discover' || action === 'nearby') {
  discoverNearby();
  }
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
  cb.textContent = _compareIds.has(id) ? '✓' : '+';
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
  { label: 'Action: Just Ate', hint: 'Log a meal in 10 seconds', keys: 'just ate log meal dish check in visit', run: () => openJustAte() },
  { label: 'Action: Decision Mode', hint: 'Top 3 in under a minute', keys: 'decision mode winner shortlist quick', run: openDecisionMode },
  { label: 'Action: Smart Planner', hint: 'Build tonight plan', keys: 'planner plan tonight', run: openSmartPlanner },
  { label: 'Action: Smart Itinerary', hint: 'Generate multi-stop route', keys: 'itinerary route crawl', run: openSmartItinerary },
  { label: 'Action: Dinner Vote', hint: 'Friends vote on where to eat', keys: 'room rooms vote group social friends', run: openDinnerRooms },
  { label: 'Action: Share Highlights', hint: 'Generate social card', keys: 'share highlight recap card', run: openShareHighlights },
  { label: 'Action: Discover Nearby', hint: 'Find local spots', keys: 'nearby discover find local', run: openDiscover },
  { label: 'Action: Craving Engine', hint: 'Get recommendation now', keys: 'craving recommend', run: openCravingEngine },
  { label: 'Action: Theme Toggle', hint: 'Switch dark/light', keys: 'theme dark light', run: toggleThemeFromPalette },
  { label: 'Action: Theme Auto', hint: "Match your phone's light or dark mode", keys: 'theme auto ambient phone system day night dark light', run: () => setAutoAmbientTheme(true) },
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
// Arrows, not bare names: some tools live in friends.js / play.js /
// insights.js, which load after this file.
const TOOL_ACTIONS = {
  'just-ate':         () => openJustAte(),
  'decision':         () => openDecisionMode(),
  'tonight':          () => document.getElementById('tonight-btn').click(),
  'command':          () => openCommandPalette(),
  'craving':          () => openCravingEngine(),
  'itinerary':        () => openSmartItinerary(),
  'rooms':            () => openDinnerRooms(),
  'discover':         () => openDiscover(),
  'challenge':        () => openChallenges(),
  'gallery':          () => openGallery(),
  'compare':          () => toggleCompareMode(),
  'budget':           () => openBudget(),
  // From a restaurant: its dishes. From the menu: every dish you've rated.
  'dishes':           () => { if (state.detailId && !document.getElementById('detail-overlay')?.classList.contains('hidden')) openDishTracker(state.detailId); else openDishLeaderboard(); },
  'review':           () => (hasGrizzly() ? openYearReview() : showGrizzlyUpsell('review')),
  'profile':          () => openFoodieProfile(),
  'friends':          () => openFoodieFriends(),
  'stats2':           () => openStats2(),
  'stats-view':       () => setView('stats'),
  'ai-panel':         () => openAiPanel(),
  'route':            () => openRoutePlanner(),
  'export2':          () => openExport2(),
  'push':             () => requestPushPermission(),
  'open-now':         () => openOpenNow(),
  'travel':           () => openTravelMode(),
  'swipe':            () => openSwipeDeck(),
  'spin':             () => openSpinWheel(),
  'achievements':     () => openAchievements(),
  'digest':           () => openMonthlyDigest(),
  'duel':             () => openDuel(),
  'bingo':            () => openBingo(),
  'fortune':          () => openFortune(),
  'moodcal':          () => openMoodCal(),
  'feedbear':         () => openFeedBearGame(),
  'foodfight':        () => openFoodFight(),
  'burgerbar':        () => openBurgerBar(),
  'foodmatch':        () => openFoodMatch(),
  'passport':         () => openPassport(),
  'worldmap':         () => openWorldMap(),
  'visitlog':         () => openVisitLog(),
  'spend':            () => openSpendTracker(),
  'beenawhile':       () => openBeenaWhile(),
  'mealplanner':      () => openMealPlanner(),
  'groupvote':        () => openDinnerRooms(),
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
// Grouped by what you're trying to do, most common first. The two everyday
// actions lead; the many "pick for me" games sit together under one heading.
// Six favorites up top, themed rows you swipe sideways, and utilities
// folded under "More tools". Overlapping tools only show up in search.
const HUB_SECTIONS = [
  { title: 'Games', layout: 'featured', items: [
  ['foodfight','🍕','Food Fight'], ['burgerbar','🍔','Bear Burger Bar'],
  ['foodmatch','🃏','Food Match'], ['feedbear','🐻','Feed the Bear'],
  ]},
  { title: 'Start here', layout: 'featured', items: [
  ['just-ate','📸','Just Ate'], ['swipe','👆','Swipe to Decide'],
  ['tonight','🌙',"Tonight's Pick"], ['open-now','🟢','Open Now'],
  ['friends','👯','Friends'], ['spin','🎡','Spin the Wheel'],
  ]},
  { title: "Can't decide?", items: [
  ['decision','🏆','Decision Mode'], ['duel','⚔️','Restaurant Duel'],
  ['craving','😋','Craving Engine'], ['fortune','🥠','Fortune Cookie'],
  ['discover','🔎','Smart Discovery'],
  ]},
  { title: 'Eat with your crew', items: [
  ['groupvote','🗳️','Group Vote'], ['rooms','🍽️','Dinner Rooms'], ['profile','🐻','My Profile'],
  ]},
  { title: 'Your food life', items: [
  ['review','🎉','Year in Review'], ['wrap','🎁','Monthly Wrap'],
  ['passport','🛂','Passport'], ['gallery','🖼️','Photo Gallery'],
  ['visitlog','📖','Visit Log'], ['moodcal','📅','Mood Calendar'],
  ['beenawhile','⏰','Been a While'], ['stats-view','📈','My Stats'], ['stats2','📊','Deep Stats'],
  ]},
  { title: 'Games & rewards', items: [
  ['challenge','🎯','Challenges'], ['achievements','🏅','Achievements'],
  ['bingo','🎱','Cuisine Bingo'],
  ]},
  { title: 'Plan a food day', items: [
  ['itinerary','🗺️','Smart Itinerary'], ['mealplanner','🥗','Meal Planner'], ['travel','✈️','Trip Guides'],
  ]},
  { title: 'More tools', layout: 'more', items: [
  ['ai-panel','🤖','Byte Cub'], ['collections','📋','My Lists'],
  ['budget','💰','Budget'], ['spend','🧾','Spend Tracker'], ['compare','⚖️','Compare'],
  ['location','📍','Location'], ['bulk','☑️','Bulk Select'], ['command','⌘','Command Palette'],
  ['export2','🛂','Export Passport'], ['pdf','📄','Export PDF'],
  ['export','💾','Export JSON'], ['import','📥','Import JSON'],
  ['import-bookmarks','🔖','Import Lists (Notes, Maps)'],
  ]},
  { title: 'Also try', layout: 'search', items: [
  ['digest','🗞️','Monthly Digest'], ['worldmap','🌍','Cuisine Map'], ['route','🛣️','Route Planner'],
  ]},
];

// [one-line pitch, preview style]
const HUB_INFO = {
  'just-ate':    ['Snap it, rate it, done in 10 seconds', 'photo'],
  decision:      ['Your top 3 in under a minute', 'podium'],
  'open-now':    ['Places serving right now', 'photo'],
  discover:      ['New spots picked for your taste', 'photo'],
  swipe:         ['Swipe your saved spots to a winner', 'stack'],
  spin:          ['Let fate pick dinner', 'wheel'],
  duel:          ['Two spots enter. One wins.', 'vs'],
  craving:       ['Tell the bear your mood', 'chips'],
  tonight:       ['One perfect pick for tonight', 'spotlight'],
  fortune:       ['Crack open a food fortune', 'cookie'],
  friends:       ['See what your friends order', 'friends'],
  groupvote:     ['Everyone votes, the bear decides', 'bars'],
  rooms:         ['Plan dinner with your crew', 'friends'],
  profile:       ['Your taste, shareable', 'photo'],
  itinerary:     ['A multi-stop food crawl', 'route'],
  route:         ['Map a food trip', 'route'],
  mealplanner:   ['Byte Cub plans your week', 'photo'],
  travel:        ['Eat like a local anywhere', 'globe'],
  gallery:       ['Every plate you snapped', 'photo'],
  visitlog:      ['Your food diary', 'photo'],
  passport:      ['Stamp every cuisine', 'stamp'],
  worldmap:      ['Where your taste has traveled', 'globe'],
  moodcal:       ['How your meals made you feel', 'grid'],
  beenawhile:    ['Old favorites missing you', 'photo'],
  review:        ['Your year in food', 'photo'],
  wrap:          ['Your month, wrapped', 'photo'],
  digest:        ['This month at a glance', 'bars'],
  'stats-view':  ['Your counts, streaks and passport', 'bars'],
  stats2:        ['Deep dive into your habits', 'bars'],
  challenge:     ['Food quests with rewards', 'trophy'],
  achievements:  ['Badges you have earned', 'trophy'],
  bingo:         ['Fill the cuisine card', 'grid'],
  feedbear:      ['Catch food, dodge pests', 'bear'],
  foodfight:     ['Toss food to hungry bears', 'bear'],
  burgerbar:     ['Build each bear an order', 'stack'],
  foodmatch:     ['Flip cards, find the food pairs', 'podium'],
};

function hubPreviewHtml (style) {
  const food = n => Array.from({ length: n }, () => '<img data-food alt="" loading="lazy" />').join('');
  switch (style) {
  case 'stack':     return `<div class="hp hp-stack">${food(3)}</div>`;
  case 'vs':        return `<div class="hp hp-vs">${food(2)}<b>VS</b></div>`;
  case 'wheel':     return '<div class="hp hp-wheel"><i></i><b></b></div>';
  case 'chips':     return '<div class="hp hp-chips"><span>Spicy</span><span>Cheesy</span><span>Fresh</span><span>Sweet</span></div>';
  case 'spotlight': return `<div class="hp hp-spot">${food(1)}<b>★</b></div>`;
  case 'cookie':    return '<div class="hp hp-cookie"><svg viewBox="0 0 64 40" aria-hidden="true"><path d="M4 30 Q32 -6 60 30 Q46 22 32 30 Q18 22 4 30Z" fill="#e7b46a" stroke="#a46a2a" stroke-width="2"/></svg><span>Good food finds you</span></div>';
  case 'podium':    return `<div class="hp hp-podium">${food(3)}</div>`;
  case 'friends':   return `<div class="hp hp-friends">${food(3)}</div>`;
  case 'bars':      return '<div class="hp hp-bars"><i style="height:45%"></i><i style="height:80%"></i><i style="height:60%"></i><i style="height:95%"></i></div>';
  case 'route':     return '<div class="hp hp-route"><svg viewBox="0 0 100 50" aria-hidden="true"><path d="M8 40 C 30 5, 50 50, 92 12" fill="none" stroke="#e7c48a" stroke-width="3" stroke-dasharray="5 5"/><circle cx="8" cy="40" r="5" fill="#a8d5a2"/><circle cx="50" cy="30" r="5" fill="#e7c48a"/><circle cx="92" cy="12" r="5" fill="#ff8a7a"/></svg></div>';
  case 'globe':     return '<div class="hp hp-globe"><i></i></div>';
  case 'stamp':     return '<div class="hp hp-stamp"><span>EAT<br/>WORLD</span></div>';
  case 'grid':      return `<div class="hp hp-grid">${Array.from({ length: 15 }, (_, i) => `<i class="${[0, 2, 6, 7, 11, 13].includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;
  case 'trophy':    return '<div class="hp hp-trophy"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h20v8a10 10 0 0 1-20 0z" fill="#e7c48a"/><path d="M14 9H7a7 7 0 0 0 7 9M34 9h7a7 7 0 0 1-7 9" fill="none" stroke="#e7c48a" stroke-width="3"/><rect x="21" y="24" width="6" height="8" fill="#c99a4f"/><rect x="14" y="32" width="20" height="6" rx="2" fill="#a8d5a2"/></svg></div>';
  case 'bear':      return '<div class="hp hp-bear"><img src="icon-192.png" alt="" /></div>';
  default:          return `<div class="hp hp-photo">${food(1)}</div>`;
  }
}

// A small live stat on cards where one is meaningful.
function hubStat (action) {
  try {
  const visitedCuisines = new Set(state.restaurants.filter(r => r.status === 'visited').map(r => cuisineFilterKey(r.cuisine)).filter(Boolean));
  switch (action) {
    case 'gallery': { const n = collectFoodPhotos().length; return n ? `${n} photo${n === 1 ? '' : 's'}` : ''; }
    case 'visitlog': { const n = state.restaurants.reduce((s, r) => s + (r.visits || []).length, 0); return n ? `${n} visit${n === 1 ? '' : 's'}` : ''; }
    case 'passport': case 'worldmap': return visitedCuisines.size ? `${visitedCuisines.size} cuisine${visitedCuisines.size === 1 ? '' : 's'}` : '';
    case 'bingo': return `${Math.min(24, visitedCuisines.size)}/24`;
    case 'friends': { const n = getFriends().length; return n ? `${n} friend${n === 1 ? '' : 's'}` : ''; }
    case 'duel': case 'spin': { const n = state.restaurants.length; return n >= 2 ? `${n} spots` : 'Add 2 spots'; }
    default: return '';
  }
  } catch { return ''; }
}

// A food photo that fails to load (Wikimedia throttling, offline) is swapped
// for a bundled one of the same dish where possible; any other broken image is
// hidden, so no screen shows the browser's broken-image icon and alt text.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.hasAttribute('onerror') || img.classList.contains('bs-photo')) return;
  const isFood = img.matches('img[data-food], .card-photo img, .hp img, .for-you-thumb');
  if (isFood && !img.dataset.localFallback && typeof BEAR_SWIPE_LOCAL_FOOD_IMAGES !== 'undefined') {
  img.dataset.localFallback = '1';
  // A saved spot's card: a bundled photo of its cuisine.
  const spot = state.restaurants?.find(r => r.id === img.closest('[data-id]')?.dataset.id);
  const key = resolveExactLocalDishKey(img.alt || '');
  const all = Object.values(BEAR_SWIPE_LOCAL_FOOD_IMAGES);
  img.src = spot ? localNearbyFoodPhoto(spot.cuisine, '', spot.id)
    : (key && BEAR_SWIPE_LOCAL_FOOD_IMAGES[key]) || all[Math.floor(Math.random() * all.length)];
  return;
  }
  img.classList.add('img-failed');
}, true);

// Fill [data-food] previews with random real dish photos.
function fillHubFoodPhotos (root) {
  const imgs = [...root.querySelectorAll('img[data-food]')];
  if (!imgs.length) return;
  const fallback = Object.values(BEAR_SWIPE_LOCAL_FOOD_IMAGES || {});
  const apply = urls => imgs.forEach(img => { img.src = urls[Math.floor(Math.random() * urls.length)]; });
  const photos = window.BearSwipe?.loadPhotos?.();
  if (!photos) { if (fallback.length) apply(fallback); return; }
  photos.then(list => {
  const urls = list.filter(p => p.lead).map(p => p.url);
  apply(urls.length ? urls : fallback);
  });
}

function renderMobileHub (filter = '') {
  const body = document.getElementById('mobile-hub-body');
  if (!body) return;
  const q = filter.trim().toLowerCase();
  const showContests = /\b(?:contests?|competitions?|(?:food|bear) challenges?)\b/.test(q);
  const lock = action => (GRIZZLY_TOOLS.has(action) && !hasGrizzly() ? '<span class="hub-lock">GRIZZLY</span>' : '');
  const card = ([action, , label]) => {
  const [sub, style] = HUB_INFO[action] || ['', 'photo'];
  const stat = hubStat(action);
  return `<button class="hub-card" data-tool="${action}">${lock(action)}
    ${hubPreviewHtml(style)}
    <span class="hub-card-text"><span class="hub-card-title">${label}</span>
      <span class="hub-card-sub">${escHtml(sub)}</span>
      ${stat ? `<span class="hub-card-stat">${escHtml(stat)}</span>` : ''}</span>
  </button>`;
  };
  const tile = ([action, emoji, label]) => `<button class="hub-tile" data-tool="${action}">${lock(action)}
  <span class="hub-tile-emoji" aria-hidden="true">${emoji}</span><span class="hub-tile-label">${label}</span></button>`;
  const html = HUB_SECTIONS.map(sec => {
  const items = sec.items.filter(([action, , label]) => !q || label.toLowerCase().includes(q) || (HUB_INFO[action]?.[0] || '').toLowerCase().includes(q));
  if (!items.length || (sec.layout === 'search' && !q)) return '';
  if (q) {
    // Searching: one flat grid, no folding.
    return `<div class="hub-section"><div class="hub-section-title">${sec.title}</div>
      <div class="hub-grid">${items.map(tile).join('')}</div></div>`;
  }
  if (sec.layout === 'more') {
    return `<details class="hub-section hub-more"><summary class="hub-section-title">${sec.title} <span class="hub-more-count">${items.length}</span></summary>
      <div class="hub-grid">${items.map(tile).join('')}</div></details>`;
  }
  const rowClass = sec.layout === 'featured' ? 'hub-cards' : 'hub-cards hub-row';
  return `<div class="hub-section">
    <div class="hub-section-title">${sec.title}</div>
    <div class="${rowClass}">${items.map(card).join('')}</div>
  </div>`;
  }).join('');
  body.innerHTML = html || (showContests ? '' : '<p class="hub-empty">No tools match “' + escHtml(filter) + '”.</p>');
  fillHubFoodPhotos(body);
  if (!q || showContests) window.renderFoodEventsHub?.(body);
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
  document.getElementById('hub-contests-btn')?.addEventListener('click', () => {
    window.openFoodEvents?.();
  });
  document.getElementById('mobile-hub-search')?.addEventListener('input', e => renderMobileHub(e.target.value));
  document.getElementById('mobile-hub-body')?.addEventListener('click', e => {
  const tile = e.target.closest('.hub-tile, .hub-card');
  if (!tile) return;
  const action = tile.dataset.tool;
  closeMobileHub();
  runToolAction(action);
  });
}

/* Switch the main list/map/stats view from any control (nav, stat chips). */
const LIST_VIEWS = ['want-to-try', 'visited'];
const isListView = view => LIST_VIEWS.includes(view);

function setView (view) {
  // "lists" opens My Lists on the tab you used last (Want to Try at first).
  if (view === 'lists') view = LIST_VIEWS.includes(state.settings.lastList) ? state.settings.lastList : 'want-to-try';
  // A soft rise-in when switching between List, Map and Stats (CSS, instant state).
  const changed = view !== state.currentView;
  if (changed) {
  const main = document.getElementById('main-content');
  main?.classList.remove('view-enter'); void main?.offsetWidth; main?.classList.add('view-enter');
  }
  document.querySelectorAll('.nav-btn, .mobile-nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-view="${view}"]`)?.classList.add('active');
  document.querySelector(`.mobile-nav-btn[data-view="${isListView(view) ? 'lists' : view}"]`)?.classList.add('active');
  state.currentView = view;
  document.body.dataset.view = view;
  if (isListView(view) && state.settings.lastList !== view) {
  state.settings.lastList = view;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
  }
  renderListHeader();
  if (view === 'map') { showMapView(); }
  else if (view === 'stats') { showStatsView(); }
  else { hideMapView(); hideStatsView(); renderCards(); }
  // My Lists starts at the top, where the tabs are.
  if (changed && isListView(view)) window.scrollTo({ top: 0 });
  BackNav.layer('view', view !== 'all');
  renderSearchMode();
}

// The Want to Try / Been There tabs on My Lists, with live counts.
function renderListHeader () {
  const header = document.getElementById('list-header');
  if (!header) return;
  const on = isListView(state.currentView);
  header.classList.toggle('hidden', !on);
  const count = s => state.restaurants.filter(r => r.status === s).length;
  const want = document.getElementById('list-count-want');
  const been = document.getElementById('list-count-visited');
  if (want) want.textContent = count('want-to-try');
  if (been) been.textContent = count('visited');
  header.querySelectorAll('.list-tab').forEach(t => {
  const active = t.dataset.list === state.currentView;
  t.classList.toggle('active', active);
  t.setAttribute('aria-selected', String(active));
  });
}

// An empty list says what goes there and how to fill it.
function listEmptyHtml (view) {
  return view === 'want-to-try'
  ? `<div class="list-empty"><div class="list-empty-icon" aria-hidden="true">🔖</div>
      <h3>Nothing on your Want to Try list yet</h3>
      <p>Save places you've heard about: from a TikTok, a friend, a sign you drove past.</p>
      <button type="button" class="btn-primary" data-list-empty="add">＋ Add a place</button>
      <button type="button" class="btn-ghost" data-list-empty="import">Import a list from your notes</button></div>`
  : `<div class="list-empty"><div class="list-empty-icon" aria-hidden="true">🍽️</div>
      <h3>No places you've been yet</h3>
      <p>Log a meal with photos, videos and notes, and it lands here.</p>
      <button type="button" class="btn-primary" data-list-empty="justate">📸 Log a meal</button></div>`;
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
}
function closeCravingEngine () {
  document.getElementById('craving-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function runCravingEngine () {
  const moods   = [..._cravingMoods];
  const freetext = document.getElementById('craving-freetext').value.toLowerCase();
  const savedCandidates = state.restaurants.filter(r => isAvailableSpot(r) && (r.status === 'want-to-try' || r.status === 'visited'));
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
  const rating  = winner.myRating ? '★'.repeat(winner.myRating) : (winner.status === 'want-to-try' ? ' Want to Try' : '');

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
      ? `openAddModalPreFilled('${escJsArg(winner.name || '')}','${escJsArg(winner.cuisine || '')}',{name:'${escJsArg(winner.name || '')}',address:'${escJsArg(winner.address || '')}',website:'${escJsArg(winner.website || '')}',lat:${Number.isFinite(winner.lat) ? Number(winner.lat) : 'null'},lon:${Number.isFinite(winner.lng) ? Number(winner.lng) : 'null'}});closeCravingEngine()`
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


function getDishes () {
  try { return JSON.parse(localStorage.getItem(DISHES_KEY)) || {}; } catch(_) { return {}; }
}
function saveDishes (data) { localStorage.setItem(DISHES_KEY, JSON.stringify(data)); }

function getMenuNotes () {
  try { return JSON.parse(localStorage.getItem(MENU_NOTES_KEY)) || {}; } catch (_) { return {}; }
}
function saveMenuNotes (data) { localStorage.setItem(MENU_NOTES_KEY, JSON.stringify(data)); }

/* ── Your Order: one dish memory per restaurant ─────────────────
   Dishes live on the restaurant (r.dishes) so they sync with it.
   verdict: 'again' | 'ok' | 'skip' | 'want'                        */
const DISHES_MERGED_KEY = 'ftb_dishes_merged_v1';
const DISH_VERDICTS = ['again', 'ok', 'skip', 'want'];
const DISH_VERDICT_LABEL = { again: 'Order again', ok: 'Fine', skip: 'Skip', want: 'Next time' };

function dishesOf (r) { return Array.isArray(r?.dishes) ? r.dishes : []; }
function dishKey (name) { return String(name || '').trim().toLowerCase(); }

function verdictFromRating (rating = 0) {
  if (rating >= 4) return 'again';
  if (rating > 0 && rating <= 2) return 'skip';
  return 'ok';
}

// Adds a dish or updates the one with the same name, so re-logging a dish
// changes its verdict instead of creating duplicates.
// `media` (list of { photo, video? }) adds photos ahead of the dish's existing ones.
function upsertDish (r, { name, verdict, rating, note, photo, video, media, date } = {}) {
  const clean = String(name || '').trim().slice(0, 80);
  if (!r || !clean) return null;
  if (!Array.isArray(r.dishes)) r.dishes = [];
  let dish = r.dishes.find(d => dishKey(d.name) === dishKey(clean));
  if (!dish) {
  dish = { id: uid(), name: clean, verdict: 'ok', rating: 0, note: '', date: date === undefined ? iso() : date };
  r.dishes.push(dish);
  }
  if (Number.isFinite(rating) && rating > 0) dish.rating = Math.min(5, Math.round(rating));
  if (DISH_VERDICTS.includes(verdict)) dish.verdict = verdict;
  else if (Number.isFinite(rating) && rating > 0) dish.verdict = verdictFromRating(rating);
  if (note != null) dish.note = String(note).slice(0, 200);
  if (photo) { dish.photo = photo; if (video) dish.video = video; else delete dish.video; }
  if (Array.isArray(media) && media.length) setMediaOn(dish, [...media, ...mediaOf(dish)]);
  if (date !== undefined) dish.date = date;
  else if (dish.verdict !== 'want') dish.date = iso();
  r.updatedAt = Date.now();
  saveData();
  return dish;
}

// One line on a list card: what to get here, or what you came to try.
function cardOrderLine (r) {
  // Searching for a dish shows that dish and your verdict on it.
  const q = dishKey(state.filter?.search);
  const hit = q ? dishesOf(r).find(d => dishKey(d.name).includes(q)) : null;
  if (hit) {
  const label = { again: 'Get', ok: 'Had', skip: 'Skip', want: 'Try' }[hit.verdict] || 'Had';
  return `<div class="card-order ${hit.verdict}"><span class="card-order-label">${label}</span> ${escHtml(hit.name)}</div>`;
  }
  const goTo = goToDishOf(r);
  if (goTo) return `<div class="card-order"><span class="card-order-label">Get</span> ${escHtml(goTo.name)}</div>`;
  const crave = dishesOf(r).find(d => d.verdict === 'want');
  if (crave) return `<div class="card-order want"><span class="card-order-label">Try</span> ${escHtml(crave.name)}</div>`;
  // Never ordered here yourself: lean on what friends say to get.
  const friendPick = friendTipsFor(r).length ? orderPicksFor(r).get[0] : null;
  if (friendPick) return `<div class="card-order friends"><span class="card-order-label">Friends</span> ${escHtml(friendPick.name)}</div>`;
  return '';
}

function removeDish (r, dishId) {
  if (!r || !Array.isArray(r.dishes)) return;
  r.dishes = r.dishes.filter(d => d.id !== dishId);
  r.updatedAt = Date.now();
  saveData();
}

// Best dish to recommend at a spot: an "order again" first, then the
// highest-rated one you didn't dislike.
function goToDishOf (r) {
  const rank = { again: 2, ok: 1 };
  return dishesOf(r)
  .filter(d => rank[d.verdict])
  .sort((a, b) => rank[b.verdict] - rank[a.verdict] || (b.rating || 0) - (a.rating || 0))[0] || null;
}

// Dish Tracker and Menu Notes each kept dishes in a device-only store.
// Fold both into r.dishes once, keeping the legacy stores untouched.
function mergeLegacyDishStores () {
  if (localStorage.getItem(DISHES_MERGED_KEY) === '1') return false;
  const byId = new Map((state.restaurants || []).map(r => [String(r.id), r]));
  const toItems = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
  let changed = false;
  const take = (restaurantId, item, verdict, rating) => {
  const r = byId.get(String(restaurantId));
  const name = String(item?.name || '').trim().slice(0, 80);
  if (!r || !name) return;
  if (!Array.isArray(r.dishes)) r.dishes = [];
  if (r.dishes.some(d => dishKey(d.name) === dishKey(name))) return;
  r.dishes.push({ id: item.id || uid(), name, verdict, rating: rating || 0, note: String(item.note || '').slice(0, 200), date: item.date || iso() });
  r.updatedAt = Date.now();
  changed = true;
  };
  Object.entries(getDishes()).forEach(([rid, items]) =>
  toItems(items).forEach(d => take(rid, d, verdictFromRating(d.rating), d.rating)));
  Object.entries(getMenuNotes()).forEach(([rid, items]) =>
  toItems(items).forEach(n => take(rid, n, (n.reaction === 'liked' || n.favorite) ? 'again' : n.reaction === 'disliked' ? 'skip' : 'ok', 0)));
  localStorage.setItem(DISHES_MERGED_KEY, '1');
  return changed;
}

/* Dishes Google reviewers recommend, for Best bet. Grizzly, once a month per
   spot: the AI picks dishes out of a few review texts, and only names that
   really appear in those reviews are kept (counted by how many mention them). */
const REVIEW_DISHES_TTL = 30 * 86400000;
const _reviewDishesTried = new Set();

async function loadReviewDishes (r) {
  if (!r?.placeId || !hasGrizzly() || !window.AI || _reviewDishesTried.has(r.id) || navigator.onLine === false) return false;
  if (r.reviewDishesAt && Date.now() - r.reviewDishesAt < REVIEW_DISHES_TTL) return false;
  _reviewDishesTried.add(r.id);
  try {
  const resp = await apiGet(`/api/place-info?mode=reviews&id=${encodeURIComponent(r.placeId)}`);
  if (!resp.ok) return false;
  const texts = ((await resp.json())?.reviews || []).map(x => String(x.text || '')).filter(Boolean);
  let dishes = [];
  if (texts.length) {
    const reply = await AI.call(`These are Google reviews of ${r.name}. List the specific dishes or drinks the reviewers recommend, using the exact words from the reviews. Reply with only a JSON array of up to 5 short dish names, or [] if none.\n\n${texts.map((t, i) => `Review ${i + 1}: ${t}`).join('\n\n')}`);
    let names = [];
    try { names = JSON.parse(String(reply || '').match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch { names = []; }
    const lower = texts.map(t => t.toLowerCase());
    dishes = (Array.isArray(names) ? names : [])
      .map(n => String(n || '').trim().slice(0, 50))
      .filter(n => n.length > 2)
      .map(n => ({ name: n, n: lower.filter(t => t.includes(n.toLowerCase())).length }))
      .filter(d => d.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
  }
  const spot = state.restaurants.find(x => x.id === r.id);
  if (!spot) return false;
  spot.reviewDishes = dishes;
  spot.reviewDishesAt = Date.now();
  saveData();
  return dishes.length > 0;
  } catch {
  return false;
  }
}

/* ── Scan the menu (Grizzly) ─────────────────────────────────
   A photo of a menu goes to Byte Cub with what you like (dishes you'd order
   again or skip, favorite cuisines, Bear Swipe tastes); back come up to five
   dishes printed on that menu, each with a reason, and any to skip. One tap
   puts a pick on this spot's Crave List. */
function shrinkImageToJpeg (file, max = 1400) {
  return new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    resolve(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
  img.src = url;
  });
}

function tasteProfileText () {
  const again = [], skip = [], cuisines = {};
  (state.restaurants || []).forEach(r => {
  dishesOf(r).forEach(d => { if (d.verdict === 'again') again.push(d.name); else if (d.verdict === 'skip') skip.push(d.name); });
  if (r.cuisine && (r.myRating >= 4 || r.status === 'visited')) cuisines[r.cuisine] = (cuisines[r.cuisine] || 0) + (r.myRating || 3);
  });
  let swipe = {};
  try { swipe = JSON.parse(localStorage.getItem('ftb_bear_swipe_v2') || '{}').tastes || {}; } catch { /* none yet */ }
  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  return [
  again.length && `Dishes they'd order again: ${again.slice(0, 12).join(', ')}`,
  skip.length && `Dishes they didn't like: ${skip.slice(0, 8).join(', ')}`,
  top(cuisines).length && `Favorite cuisines: ${top(cuisines).join(', ')}`,
  top(swipe).length && `Bear Swipe says they love: ${top(swipe).join(', ')}`,
  ].filter(Boolean).join('\n') || 'No taste history yet: pick the dishes this place is best known for.';
}

async function scanMenu (file) {
  const r = state.restaurants.find(x => x.id === state.detailId);
  const box = document.getElementById('menu-scan-result');
  if (!r || !box) return;
  box.classList.remove('hidden');
  box.innerHTML = '<div class="menu-scan-wait">Byte Cub is reading the menu… 🐻</div>';
  trackProductEvent('menu_scanned');
  try {
  const photo = await shrinkImageToJpeg(file);
  const prompt = `This is a photo of the menu at ${r.name}${r.cuisine ? ` (${r.cuisine})` : ''}. Pick what this person should order, based on their taste:
${tasteProfileText()}

Reply with only JSON, no other text:
{"picks":[{"dish":"the name exactly as printed on the menu","why":"one short reason tied to their taste"}],"skip":[{"dish":"exact name","why":"short reason"}]}
Up to 5 picks and up to 2 skips. Only dishes printed on this menu. If the photo isn't a readable menu, reply {"error":"not a menu"}.`;
  const reply = await AI.callVision(prompt, photo, 'image/jpeg', { maxTokens: 700, temperature: 0.4 });
  let data = {};
  try { data = JSON.parse(String(reply || '').match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { data = {}; }
  const clean = list => (Array.isArray(list) ? list : []).map(x => ({ dish: String(x?.dish || '').trim().slice(0, 80), why: String(x?.why || '').trim().slice(0, 160) })).filter(x => x.dish);
  const picks = clean(data.picks).slice(0, 5);
  const skips = clean(data.skip).slice(0, 2);
  if (!picks.length) {
    box.innerHTML = `<div class="menu-scan-wait">${data.error ? "That doesn't look like a menu I can read. Try a closer, straight-on photo." : "I couldn't make out the dishes. Try a closer, brighter photo."}</div>`;
    return;
  }
  box.innerHTML = `<div class="menu-scan-title">Byte Cub's picks for you</div>
    ${picks.map((p, i) => `<div class="menu-scan-pick"><div><strong>${escHtml(p.dish)}</strong>${p.why ? `<span>${escHtml(p.why)}</span>` : ''}</div>
      <button type="button" class="btn-ghost btn-sm menu-scan-add" data-i="${i}">+ Crave List</button></div>`).join('')}
    ${skips.length ? `<div class="menu-scan-skip">Maybe skip: ${skips.map(s => `<strong>${escHtml(s.dish)}</strong>${s.why ? ` (${escHtml(s.why)})` : ''}`).join('; ')}</div>` : ''}`;
  box.querySelectorAll('.menu-scan-add').forEach(b => { b.onclick = () => {
    const p = picks[Number(b.dataset.i)];
    upsertDish(r, { name: p.dish, verdict: 'want', note: p.why });
    renderYourOrder(r.id);
    b.textContent = '✓ Added';
    b.disabled = true;
  }; });
  } catch (err) {
  box.innerHTML = "<div class=\"menu-scan-wait\">Byte Cub couldn't read that just now. Please try again in a moment.</div>";
  console.warn('[FTB] menu scan failed:', err);
  }
}

function renderYourOrder (restaurantId) {
  const listEl = document.getElementById('your-order-list');
  if (!listEl) return;
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (r) loadReviewDishes(r).then(found => { if (found && state.detailId === restaurantId) renderYourOrder(restaurantId); });
  const dishes = dishesOf(r);
  const counts = {};
  dishes.forEach(d => { counts[d.verdict] = (counts[d.verdict] || 0) + 1; });
  const sub = document.getElementById('your-order-sub');
  if (sub) sub.textContent = [counts.again && `${counts.again} to get again`, counts.want && `${counts.want} to try`].filter(Boolean).join(' · ');
  document.getElementById('your-order-share')?.classList.toggle('hidden', !dishes.length);

  if (!dishes.length) {
  listEl.innerHTML = bestBetHtml(r) + friendTipsHtml(r) + `<div class="your-order-empty">${r?.status === 'want-to-try'
    ? 'Heard about a must-order dish here? Save it so you remember when you go.'
    : 'What did you order? Log it so next time you know exactly what to get.'}</div>`;
  return;
  }
  // The single best dish at this spot, called out at the top so it's
  // unmissable: the top-rated "order again" dish, with its stars and note.
  const goTo = goToDishOf(r);
  const topHtml = goTo ? `<div class="yo-top-dish"><span class="yo-top-dish-label">⭐ Order this again</span><strong>${escHtml(goTo.name)}</strong>${goTo.rating ? ` <span class="yo-dish-stars" aria-label="${goTo.rating} stars">${'★'.repeat(goTo.rating)}</span>` : ''}${goTo.note ? `<div class="yo-top-dish-note">${escHtml(goTo.note)}</div>` : ''}<button type="button" class="btn-sm btn-secondary yo-cook" onclick="cookDishAtHome('${r.id}','${goTo.id}')">🍳 Cook it at home</button></div>` : '';
  listEl.innerHTML = bestBetHtml(r) + topHtml + ['again', 'want', 'ok', 'skip'].filter(g => counts[g]).map(g => `
  <div class="yo-group yo-group-${g}">
    <div class="yo-group-label">${DISH_VERDICT_LABEL[g]}</div>
    ${dishes.filter(d => d.verdict === g).map(d => `
      <div class="yo-dish${d.photo ? ' has-photo' : ''}">
        <div class="yo-dish-row">
          ${safeUrl(d.photo || '') ? `<button type="button" class="yo-dish-photo${d.video ? ' is-video' : ''}" data-view="${escHtml(d.id)}" aria-label="${d.video ? 'Play video' : 'View photos'} of ${escHtml(d.name)}"><img src="${escHtml(safeUrl(d.photo))}" alt="" loading="lazy" />${d.video ? '<span class="video-badge small" aria-hidden="true">▶</span>' : ''}${mediaOf(d).length > 1 ? `<span class="yo-media-count" aria-hidden="true">+${mediaOf(d).length - 1}</span>` : ''}</button>` : ''}
          <button type="button" class="yo-dish-name" aria-expanded="false">${escHtml(d.name)}${d.rating ? ` <span class="yo-dish-stars" aria-label="${d.rating} stars">${'★'.repeat(d.rating)}</span>` : ''}</button>
        </div>
        ${d.note ? `<div class="yo-dish-note">${escHtml(d.note)}</div>` : ''}
        <span class="yo-dish-actions">
          <div class="food-capture-buttons">
            <button type="button" class="yo-move yo-photo-btn" data-photo-for="${escHtml(d.id)}" data-source="library">${d.photo ? 'Add more photos/videos' : 'Add photos/videos'}</button>
            <button type="button" class="yo-move yo-photo-btn" data-photo-for="${escHtml(d.id)}" data-source="photo">Take photo</button>
            <button type="button" class="yo-move yo-photo-btn" data-photo-for="${escHtml(d.id)}" data-source="video">Record video</button>
          </div>
          ${DISH_VERDICTS.filter(v => v !== g).map(v => `<button type="button" class="yo-move" data-move="${v}" data-id="${escHtml(d.id)}">${DISH_VERDICT_LABEL[v]}</button>`).join('')}
          <button type="button" class="yo-remove" data-remove="${escHtml(d.id)}" aria-label="Remove ${escHtml(d.name)}">✕</button>
        </span>
      </div>`).join('')}
  </div>`).join('') + friendTipsHtml(r);
}

/* ── Food photos: snap first, name it, done ─────────────────── */
let _yoPendingMedia = [];

// Photos/clips picked before the dish is named. Pass [] to clear.
function setYourOrderPending (list = []) {
  _yoPendingMedia = mergeFoodMedia([], list);
  const box = document.getElementById('your-order-pending');
  if (!box) return;
  box.classList.toggle('hidden', !_yoPendingMedia.length);
  box.innerHTML = _yoPendingMedia.length ? pendingMediaHtml(_yoPendingMedia, 'Now name the dish and tap how it was.') : '';
}

// All dish photos at a spot, in Your Order order, for the swipeable viewer.
function dishPhotosOf (r) {
  return dishesOf(r).flatMap(d => mediaOf(d).filter(m => safeUrl(m.photo)).map(m => ({ id: d.id, url: m.photo, alt: `${d.name} at ${r.name}` })));
}

// A quick Polaroid that drops in when a photo is saved.
function photoReveal (dataUrl, caption = '') {
  const src = safeUrl(dataUrl);
  if (!src) return;
  document.querySelector('.photo-reveal')?.remove();
  const el = document.createElement('div');
  el.className = 'photo-reveal';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="photo-reveal-card"><img src="${escHtml(src)}" alt="" /><div class="photo-reveal-caption">${escHtml(caption)}</div></div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 1600);
  setTimeout(() => el.remove(), 2100);
}

/* ── Just Ate: log a meal in about ten seconds ──────────────── */
// `found`: a real restaurant picked from search (Google), used when it isn't saved yet.
let _justAte = { placeId: null, verdict: null, media: [], stars: 0, found: null, results: [] };
let _justAteSearchTimer = null;
let _justAteSearchSeq = 0;

// Neighborhood, city and state where you are now ("Arcadia, Phoenix, Arizona"),
// for Byte Cub to talk about. Looked up once per ~1 km moved; '' when unknown.
let _areaName = { key: '', name: '' };
async function userAreaName () {
  if (!Number.isFinite(state.userLat)) return '';
  const key = `${state.userLat.toFixed(2)},${state.userLng.toFixed(2)}`;
  if (_areaName.key === key) return _areaName.name;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${state.userLat.toFixed(3)}&lon=${state.userLng.toFixed(3)}`,
      { headers: { 'Accept-Language': 'en' }, signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const a = (await resp.json())?.address || {};
    const name = [a.neighbourhood || a.suburb, a.city || a.town || a.village || a.county, a.state]
      .filter(Boolean).filter((x, i, all) => all.indexOf(x) === i).join(', ').slice(0, 120);
    _areaName = { key, name };
    return name;
  } catch { return ''; }
}

// Real restaurants matching what's typed (our Google Places search). [] when unavailable.
async function searchRealPlaces (q) {
  const at = Number.isFinite(state.userLat) ? `&lat=${state.userLat.toFixed(2)}&lng=${state.userLng.toFixed(2)}` : '';
  try {
  const resp = await apiGet(`/api/place-info?mode=search&q=${encodeURIComponent(q)}${at}`);
  if (!resp.ok) return [];
  const list = (await resp.json())?.places;
  return Array.isArray(list) ? list.filter(p => p && p.name) : [];
  } catch { return []; }
}

function searchJustAtePlaces () {
  clearTimeout(_justAteSearchTimer);
  const q = (document.getElementById('just-ate-place')?.value || '').trim();
  if (q.length < 3) { _justAte.results = []; renderJustAtePlaces(); return; }
  const seq = ++_justAteSearchSeq;
  _justAteSearchTimer = setTimeout(async () => {
  const found = await searchRealPlaces(q);
  if (seq !== _justAteSearchSeq) return;
  const saved = new Set(state.restaurants.map(r => normalizeName(r.name)));
  _justAte.results = found.filter(p => !saved.has(normalizeName(p.name))).slice(0, 5);
  renderJustAtePlaces();
  }, 450);
}

function setJustAteStars (n) {
  _justAte.stars = n;
  document.querySelectorAll('#just-ate-stars .ja-star').forEach(b => {
  b.classList.toggle('on', Number(b.dataset.n) <= n);
  b.setAttribute('aria-checked', String(Number(b.dataset.n) === n));
  });
}

function justAteSuggestions (query = '') {
  const q = dishKey(query);
  const list = state.restaurants || [];
  if (q) return list.filter(r => dishKey(r.name).includes(q)).slice(0, 6);
  // Nothing typed: nearest spots first, then the ones you touched most recently.
  return [...list]
  .sort((a, b) => (distOf(a) - distOf(b)) || (b.updatedAt || 0) - (a.updatedAt || 0))
  .slice(0, 6);
}

function renderJustAtePlaces () {
  const box = document.getElementById('just-ate-places');
  const input = document.getElementById('just-ate-place');
  if (!box || !input) return;
  const typed = input.value.trim();
  const picks = justAteSuggestions(typed);
  const exact = picks.some(r => dishKey(r.name) === dishKey(typed)) || dishKey(_justAte.found?.name) === dishKey(typed);
  const results = _justAte.results || [];
  box.innerHTML = picks.map(r => {
  const dist = distOf(r);
  return `<button type="button" class="ja-place${r.id === _justAte.placeId ? ' active' : ''}" data-id="${escHtml(r.id)}" aria-pressed="${r.id === _justAte.placeId}">
    <span class="ja-place-name">${escHtml(r.name)}</span><span class="ja-place-dist">${escHtml([r.status === 'want-to-try' ? 'On your list' : 'Saved', Number.isFinite(dist) ? fmtDist(dist) : ''].filter(Boolean).join(' · '))}</span>
  </button>`;
  }).join('') + results.map((p, i) => {
  const on = !!(_justAte.found && _justAte.found.placeId === p.placeId);
  return `<button type="button" class="ja-place ja-place-real${on ? ' active' : ''}" data-g="${i}" aria-pressed="${on}">
    <span class="ja-place-name">${escHtml(p.name)}</span><span class="ja-place-dist">${escHtml([p.rating ? `★ ${p.rating.toFixed(1)}` : '', p.address].filter(Boolean).join(' · '))}</span>
  </button>`;
  }).join('') + (typed && !exact
  ? `<button type="button" class="ja-place ja-place-new${_justAte.placeId === null && !_justAte.found ? ' active' : ''}" data-new="1">+ Use “${escHtml(typed)}”</button>`
  : '');
  syncJustAteSave();
}

function syncJustAteSave () {
  const btn = document.getElementById('just-ate-save');
  const typed = (document.getElementById('just-ate-place')?.value || '').trim();
  if (btn) btn.disabled = foodMediaBusy() || !!window._ftbAccountSwitching || !(_justAte.placeId || typed);
}

function openJustAte (restaurantId = null) {
  invalidateFoodMedia();
  const overlay = document.getElementById('just-ate-overlay');
  if (!overlay) return;
  const preset = restaurantId ? state.restaurants.find(r => r.id === restaurantId) : null;
  _justAte = { placeId: preset?.id || null, verdict: null, media: [], stars: 0, found: null, results: [] };
  document.getElementById('just-ate-place').value = preset?.name || '';
  const linkInput = document.getElementById('just-ate-link');
  if (linkInput) linkInput.value = '';
  setJustAteStars(preset?.myRating || 0);
  document.getElementById('just-ate-dish').value = '';
  document.getElementById('just-ate-note').value = '';
  document.querySelectorAll('#just-ate-tags .ja-tag').forEach(t => t.classList.remove('active'));
  setJustAteMedia([]);
  document.querySelectorAll('#just-ate-verdicts .yo-btn').forEach(b => {
  b.classList.remove('active'); b.setAttribute('aria-checked', 'false');
  });
  renderJustAtePlaces();
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  trackProductEvent('just_ate_opened', { hasPreset: !!preset });
  setTimeout(() => document.getElementById(preset ? 'just-ate-dish' : 'just-ate-place')?.focus(), 60);
}

function setJustAteMedia (list = []) {
  _justAte.media = mergeFoodMedia([], list);
  const n = _justAte.media.length;
  const preview = document.getElementById('just-ate-photo-preview');
  const label = document.getElementById('just-ate-photo-label');
  if (label) label.textContent = n ? `Add more (${n}/${FOOD_MEDIA_MAX})` : 'Add photos & videos';
  if (!preview) return;
  preview.classList.toggle('hidden', !n);
  preview.innerHTML = n ? pendingMediaHtml(_justAte.media) : '';
}

// Tapping a tag adds it to the note, tapping again takes it out.
function toggleJustAteTag (btn) {
  const noteEl = document.getElementById('just-ate-note');
  if (!noteEl || !btn) return;
  const tag = btn.textContent.trim();
  const parts = noteEl.value.split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);
  const i = parts.indexOf(tag);
  if (i === -1) parts.push(tag); else parts.splice(i, 1);
  noteEl.value = parts.join(' · ');
  btn.classList.toggle('active', i === -1);
}

function closeJustAte () {
  invalidateFoodMedia();
  document.getElementById('just-ate-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function saveJustAte () {
  if (foodMediaBusy() || window._ftbAccountSwitching) { showToast('Please wait', 'Finish adding media before saving.', 'info'); return; }
  const placeName = (document.getElementById('just-ate-place')?.value || '').trim();
  const dishName = (document.getElementById('just-ate-dish')?.value || '').trim();
  const note = (document.getElementById('just-ate-note')?.value || '').trim().slice(0, 300);
  const media = _justAte.media || [];
  const photo = media[0]?.photo || '';
  let r = state.restaurants.find(x => x.id === _justAte.placeId);
  // A typed name that matches a saved spot exactly counts as that spot.
  if (!r && placeName) r = state.restaurants.find(x => dishKey(x.name) === dishKey(placeName));
  const isNew = !r;
  if (isNew) {
  if (!placeName) return;
  if (typeof isPremium === 'function' && !isPremium() && state.restaurants.length >= FREE_RESTAURANT_LIMIT) {
    showToast('Cub limit reached', `Cub includes up to ${FREE_RESTAURANT_LIMIT} spots. Upgrade to Grizzly for unlimited saves.`, 'info');
    showGrizzlyUpsell('limit');
    return;
  }
  const today = iso();
  // A real restaurant picked from search brings its address, map pin, cuisine and Google rating.
  const f = _justAte.found && dishKey(_justAte.found.name) === dishKey(placeName) ? _justAte.found : null;
  const kind = String(f?.kind || '').replace(/\s*(restaurant|food|place)$/i, '').replace(/^(restaurant|food)$/i, '');
  r = {
    id: uid(), name: placeName.slice(0, 80), cuisine: kind.slice(0, 40), priceRange: f?.priceLevel || 0,
    address: f?.address || '', lat: Number.isFinite(f?.lat) ? f.lat : null, lng: Number.isFinite(f?.lng) ? f.lng : null,
    website: '', photo: '', googleRating: f?.rating || 0, googleReviews: f?.reviews || 0, myRating: 0, notes: '', tags: [],
    collectionId: null, priority: '', status: 'visited', dateAdded: today, dateVisited: today,
    updatedAt: Date.now(), visits: [],
  };
  state.restaurants.unshift(r);
  }

  if (!Array.isArray(r.visits)) r.visits = [];
  const stars = _justAte.stars || 0;
  const visit = { date: iso(), note, rating: stars, dish: dishName };
  if (stars) r.myRating = stars;
  addLinkTo(r, document.getElementById('just-ate-link')?.value || '');
  setMediaOn(visit, media);
  if (!visit.photo) visit.photo = '';
  r.visits.push(visit);
  r.status = 'visited';
  r.dateVisited = r.dateVisited || iso();
  // First photo of a spot becomes its cover so the list stops showing placeholders.
  if (photo && !r.photo) r.photo = photo;
  r.updatedAt = Date.now();
  // Rate the dish with the same stars: an explicit verdict tap wins,
  // otherwise the stars decide (4-5 = order again, 1-2 = skip).
  const dish = dishName ? upsertDish(r, { name: dishName, verdict: _justAte.verdict || undefined, rating: stars || undefined, media, note: note || null }) : null;
  if (!dishName) saveData();
  const verdict = dish?.verdict || 'ok';

  closeJustAte();
  renderAll();
  if (photo) photoReveal(photo, dishName || r.name);
  if (stars >= 4) noteGoodMoment();
  trackProductEvent('just_ate_logged', { restaurantId: r.id, isNew, hasDish: !!dishName, hasPhoto: !!photo, mediaCount: media.length, hasNote: !!note, verdict: dishName ? verdict : null });
  showToast(`${r.name} is on your Been There list`,
  [stars ? '★'.repeat(stars) : '', dishName ? `${DISH_VERDICT_LABEL[verdict]}: ${dishName}` : ''].filter(Boolean).join(' · ') || 'Find it any time under Lists.',
  'success');
  if (typeof celebrateMilestones === 'function') celebrateMilestones();
  offerShareMeal({ r, dish: dishName, verdict: dishName ? verdict : '', photo, video: media[0]?.video || '', media, note });
}

// "At The Mission get the guacamole, skip the churros" — the text a friend
// actually wants before they go.
function buildOrderShareText (r) {
  const names = v => dishesOf(r).filter(d => d.verdict === v).map(d => d.name);
  const lines = [`What to order at ${r.name}${r.cuisine ? ` (${r.cuisine})` : ''}:`];
  // Recommend only real winners; fall back to "fine" dishes when there are none.
  const get = names('again').length ? names('again') : names('ok').slice(0, 2);
  if (get.length) lines.push(`Get: ${get.join(', ')}`);
  if (names('want').length) lines.push(`On my list: ${names('want').join(', ')}`);
  if (names('skip').length) lines.push(`Skip: ${names('skip').join(', ')}`);
  if (r.address) lines.push(r.address);
  lines.push('', `Saved with Feed The Bear ${location.origin}/`);
  return lines.join('\n');
}

async function shareYourOrder () {
  const r = state.restaurants.find(x => x.id === state.detailId);
  if (!r || !dishesOf(r).length) return;
  const text = buildOrderShareText(r);
  trackProductEvent('share_order_clicked', { restaurantId: r.id, dishes: dishesOf(r).length });
  // A story-sized picture card; the plain-text share below is the fallback.
  if (window.StoryCard) {
  try { await StoryCard.open(r, text); return; } catch (err) { console.warn('[FTB] story card failed:', err); }
  }
  if (navigator.share) {
  try { await navigator.share({ title: `What to order at ${r.name}`, text }); return; }
  catch (err) { if (err?.name === 'AbortError') return; }
  }
  try {
  await navigator.clipboard.writeText(text);
  showToast('Copied!', 'Paste it to a friend who is going.', 'success');
  } catch {
  showToast('Could not share', 'Your browser blocked sharing here.', 'error');
  }
}

function logYourOrder (verdict) {
  if (foodMediaBusy() || window._ftbAccountSwitching) { showToast('Please wait', 'Finish adding media before saving.', 'info'); return; }
  const input = document.getElementById('your-order-input');
  const name = (input?.value || '').trim();
  if (!name) {
  input?.focus();
  showToast('What did you have?', 'Type the dish name first.', 'info');
  return;
  }
  const r = state.restaurants.find(x => x.id === state.detailId);
  const pending = _yoPendingMedia;
  const dish = upsertDish(r, { name, verdict, media: pending });
  if (!dish) return;
  input.value = '';
  if (pending.length) photoReveal(pending[0].photo, dish.name);
  setYourOrderPending([]);
  renderYourOrder(r.id);
  renderAll();
  const msg = verdict === 'want' ? `${dish.name} is on your Crave List for next time.`
  : verdict === 'again' ? `Saved: get the ${dish.name} again.`
  : verdict === 'skip' ? `Noted. You'll pass on the ${dish.name}.`
  : `${dish.name} logged.`;
  showToast(DISH_VERDICT_LABEL[verdict], msg, 'success');
}

function openDishTracker (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  state.detailId = restaurantId;
  document.getElementById('dish-title').textContent = '🍽️ Dish Tracker';
  document.getElementById('dish-restaurant-name').textContent = r.name;
  document.getElementById('dish-name-input').value = '';
  const dishNoteEl = document.getElementById('dish-note-input');
  if (dishNoteEl) dishNoteEl.value = '';
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

// "Cook it at home": Byte Cub writes a home-cook recipe for a dish you loved.
// The button is visible to everyone; only the recipe itself is Grizzly —
// it costs an AI call, and AI is a Grizzly perk.
async function cookDishAtHome (restaurantId, dishId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  const d = r && dishesOf(r).find(x => x.id === dishId);
  if (!r || !d) return;
  if (!AI.hasAccess()) { showGrizzlyUpsell('recipe'); return; }
  openRecipeModal(d, r);
  const body = document.getElementById('recipe-body');
  if (body) body.innerHTML = '<p class="recipe-loading">Byte Cub is writing your recipe… 🐻</p>';
  try {
    const prompt = `Write a practical home-cook recipe for "${d.name}", a ${r.cuisine || 'restaurant'} dish from ${r.name}${d.note ? ` (my note: ${d.note})` : ''}. Give ingredients with amounts, then numbered steps. Keep it doable in a home kitchen, under 300 words. Plain text, no markdown headings.`;
    const text = await AI.call(prompt, '', { maxTokens: 700, temperature: 0.7 });
    if (body) body.textContent = (text || '').trim() || 'Byte Cub came back empty-handed — try again in a moment.';
  } catch (err) {
    if (body) body.textContent = 'Could not fetch a recipe right now. Check your connection and try again.';
  }
}
function openRecipeModal (d, r) {
  document.getElementById('recipe-title').textContent = `🍳 ${d.name}`;
  document.getElementById('recipe-subtitle').textContent = `Cook it at home · ${r.name}`;
  document.getElementById('recipe-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function closeRecipeModal () {
  document.getElementById('recipe-overlay')?.classList.add('hidden');
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
  const note = (document.getElementById('dish-note-input')?.value || '').trim().slice(0, 200);
  const r = state.restaurants.find(x => x.id === state.detailId);
  if (!upsertDish(r, { name, rating: _dishRating, note: note || undefined })) return;
  document.getElementById('dish-name-input').value = '';
  const noteEl = document.getElementById('dish-note-input');
  if (noteEl) noteEl.value = '';
  _renderDishRatingPicker(0);
  renderDishList(state.detailId);
  renderYourOrder(state.detailId);
  showToast('✓ Dish saved!', name + ' added to your dish log.', 'success');
}
function deleteDish (restaurantId, dishId) {
  removeDish(state.restaurants.find(x => x.id === restaurantId), dishId);
  renderDishList(restaurantId);
  renderYourOrder(restaurantId);
}
function renderDishList (restaurantId) {
  const r = state.restaurants.find(x => x.id === restaurantId);
  const list = dishesOf(r).filter(d => d.verdict !== 'want')
  .sort((a, b) => (b.rating || 0) - (a.rating || 0) || String(b.date || '').localeCompare(String(a.date || '')));
  const el = document.getElementById('dish-list');
  if (!list.length) {
  el.innerHTML = '<div class="dish-empty">No dishes logged yet. Add your first one above!</div>';
  return;
  }
  const goTo = goToDishOf(r);
  el.innerHTML = list.map(d => `
  <div class="dish-item">
    <div class="dish-item-top">
      <div class="dish-item-name">${escHtml(d.name)}${d.id === goTo?.id ? ' <span class="dish-badge dish-badge-again">★ Order again</span>' : ''}${d.verdict === 'skip' ? ' <span class="dish-badge dish-badge-skip">Skip this</span>' : ''}</div>
      <div class="dish-item-stars">${d.rating ? '★'.repeat(d.rating) + '☆'.repeat(5-d.rating) : '☆'}</div>
      ${(d.verdict === 'again' || (d.rating || 0) >= 4) ? `<button class="dish-item-cook icon-btn" onclick="cookDishAtHome('${restaurantId}','${d.id}')" title="Cook it at home">🍳</button>` : ''}
      <button class="dish-item-delete icon-btn" onclick="deleteDish('${restaurantId}','${d.id}')" title="Remove">✕</button>
    </div>
    ${d.note ? `<div class="dish-item-note">${escHtml(d.note)}</div>` : ''}
    ${d.date ? `<div class="dish-item-date">${d.date}</div>` : ''}
  </div>
  `).join('');
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
const _parkedWebsiteKeys = new Set();
const _placePhotoMeta = new Map();

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

  const website = cleanVenueWebsite(card.website || '');
  if (website) params.set('website', website);

  let websiteParked = false;
  let websiteChecked = false;
  let resp = await apiGet(`/api/restaurant-image?${params.toString()}`);
  const restaurantImageIsJson = String(resp.headers.get('content-type') || '').includes('application/json');
  if (restaurantImageIsJson) {
  try {
    const data = await resp.json();
    websiteChecked = true;
    websiteParked = !!data?.websiteParked;
    const photoUrl = safeUrl(data?.photoUrl || '');
    if (resp.ok && isLikelyRealPlacePhotoUrl(photoUrl)) {
      return { photoUrl, websiteParked, websiteChecked };
    }
  } catch {
    websiteChecked = false;
  }
  }

  resp = await apiGet(`/api/place-photo?${params.toString()}`);
  if (resp.ok) {
  const data = await resp.json();
  const photoUrl = safeUrl(data?.photoUrl || '');
  if (isLikelyRealPlacePhotoUrl(photoUrl)) return { photoUrl, websiteParked, websiteChecked };
  }
  return { photoUrl: '', websiteParked, websiteChecked };
}

function isLikelyRealPlacePhotoUrl (url = '') {
  const safe = safeUrl(url || '');
  if (!safe) return false;
  const raw = safe.toLowerCase();

  // Avoid known non-photo assets that frequently come from meta tags.
  if (/(logo|icon|favicon|avatar|gravatar|sprite|placeholder|default[_-]?image|og-default|map[_-]?pin|marker)/i.test(raw)) {
  return false;
  }
  if (PARKED_DOMAIN_RE.test(raw)) return false;
  return true;
}

function hasReliableNearbyCardPhoto (card = {}) {
  const raw = String(card?.photoUrl || '').trim();
  const safe = safeUrl(raw);
  if (!safe) return false;

  // Local food assets are acceptable placeholders, but not "proper place" photos.
  if (/^(\.\/)?assets\/food\//i.test(raw)) return false;
  if (/unsplash\.com|loremflickr\.com|picsum\.photos/i.test(safe)) return false;

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
    let websiteParked = false;
    try {
      const api = await fetchPlacePhotoFromApi(card);
      url = api?.photoUrl || '';
      websiteParked = !!api?.websiteParked;
      _placePhotoMeta.set(key, {
        websiteParked,
        websiteChecked: !!api?.websiteChecked,
      });
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
    if (url && !isLikelyRealPlacePhotoUrl(url)) url = '';
    _placePhotoCache.set(key, url || '');
    if (websiteParked) _parkedWebsiteKeys.add(key);
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
  .slice(0, 24);

  if (!candidates.length) return;

  // Render each small batch immediately; slow later lookups must not hide
  // photos already found for the first visible restaurants.
  for (let i = 0; i < candidates.length; i += 3) {
  const batch = candidates.slice(i, i + 3);
  const results = await Promise.allSettled(
    batch.map(async card => ({ card, url: await getOrFetchPlacePhoto(card) }))
  );
  applyNearbyPhotoResults(results);
  }
}

function applyNearbyPhotoResults (results) {
  let changed = false;
  for (const r of results) {
  if (r.status !== 'fulfilled') continue;
  const { card, url } = r.value;
  const idx = _nearbyCards.findIndex(c => String(c.key) === String(card.key));
  if (idx < 0) continue;
  const next = { ..._nearbyCards[idx] };
  let cardChanged = false;
  const lookupKey = getPlacePhotoLookupKey(card);
  const meta = _placePhotoMeta.get(lookupKey) || {};
  if (_parkedWebsiteKeys.has(lookupKey) || meta.websiteParked) {
    next.website = '';
    next.websiteVerified = false;
    cardChanged = true;
  }
  if (url && isLikelyRealPlacePhotoUrl(url) && !hasReliableNearbyCardPhoto(_nearbyCards[idx])) {
    next.photoUrl = url;
    next.photoSource = 'place';
    cardChanged = true;
  }
  if (cardChanged) {
    _nearbyCards[idx] = next;
    changed = true;
  }
  }

  if (changed) {
  renderNearbyCardsFromState();
  syncSwipeDeckPhotosFromNearby();
  }
}

function getNearbyRadiusMiles () {
  return Math.max(1, Math.min(100, Number(state.settings.nearbyRadiusMiles) || 25));
}

function getNearbyRadiusMeters () {
  return getNearbyRadiusMiles() * 1609.34;
}

function getFilteredNearbyCards (cards = _nearbyCards, mode = _nearbyFilterMode) {
  if (!Array.isArray(cards) || !cards.length) return [];
  if (mode === 'trending') {
  return cards.filter(c => /Very Popular|Trending/i.test(String(c.popularity || '')));
  }
  if (mode === 'budget') {
  return cards.filter(c => {
    const price = verifiedPriceLevel(c.savedRestaurant, c.priceLevel);
    return price >= 1 && price <= 2;
  });
  }
  return cards;
}

function renderNearbyCardsFromState () {
  const list = document.getElementById('nearby-home-list');
  if (!list) return;
  const filtered = getFilteredNearbyCards();

  if (!filtered.length) {
  const msg = _nearbyFilterMode === 'budget'
    ? 'Budget needs a saved price on a nearby spot. Open All to browse everything around you.'
    : _nearbyFilterMode === 'trending'
      ? 'Trending needs a real public rating. Open All to see every nearby spot.'
      : 'No nearby cards to show yet.';
  list.innerHTML = `<div class="nearby-home-loading">${escHtml(msg)}</div>`;
  return;
  }

  list.innerHTML = `${_nearbyBannerMsg ? `<div class="nearby-home-loading">${escHtml(_nearbyBannerMsg)}</div>` : ''}` +
  filtered.map(card => renderNearbyVisualCard(card)).join('');

  wireNearbyCardLinks(list);
}

function wireNearbyCardLinks (root) {
  root.querySelectorAll('.nearby-home-card[data-card-link]').forEach(cardEl => {
  const link = cardEl.dataset.cardLink || '';
  if (!link) return;
  cardEl.style.cursor = 'pointer';
  cardEl.addEventListener('click', e => {
    if (e.target.closest('a, button')) return;
    window.open(link, '_blank', 'noopener');
  });
  cardEl.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.closest('a, button')) return;
    window.open(link, '_blank', 'noopener');
  });
  });
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
  if (/(cafe|coffee|tea|bakery|breakfast)/.test(raw)) return ['assets/food/eggs_benedict.jpg', 'assets/food/french_toast.jpg', 'assets/food/pancakes.jpg'];
  return [];
  };

  const assignDiverseNearbyFallbackPhotos = (rows = []) => {
  const used = new Set();
  return rows.map((card, idx) => {
    if (!card || typeof card !== 'object') return card;

    const existingRaw = String(card.photoUrl || '').trim();
    const existing = safeUrl(existingRaw);
    const hasLocalFoodAsset = /^(\.\/)?assets\/food\//i.test(existingRaw);
    const canKeepExisting = card.isSaved ? !!existing : hasReliableNearbyCardPhoto(card);

    if (canKeepExisting) {
      if (existing) used.add(existing);
      return card;
    }
    if (hasLocalFoodAsset && existing) {
      used.add(existing);
      return { ...card, photoUrl: existing, photoSource: 'local' };
    }

    const preferred = preferredNearbyFallbackByCuisine(card.cuisine || '', card.amenity || '')
      .map(u => safeUrl(u || ''))
      .filter(Boolean);
    const unused = preferred.filter(u => !used.has(u));
    const seed = `${card.key || idx}|${card.name || ''}|${card.cuisine || ''}`;
    const chosen = unused[0]
      || preferred[preferred.length ? (miniHash(seed) % preferred.length) : 0]
      || localNearbyFoodPhoto(card.cuisine || '', card.amenity || '', seed);
    if (chosen) used.add(chosen);
    return chosen ? { ...card, photoUrl: chosen, photoSource: 'local' } : card;
  });
  };

  _nearbyCards = assignDiverseNearbyFallbackPhotos(
  (Array.isArray(cards) ? cards : []).filter(card => isCredibleVenueName(card?.name))
  );
  _nearbyBannerMsg = String(opts.banner || '');
  renderNearbyCardsFromState();
  if (state.filter.search) renderSearchMode();
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

// Public Overpass servers come and go: in Oct 2026 overpass-api.de answered
// "at capacity" and kumi/private.coffee hung, and trying them one after
// another with long timeouts left "Finding restaurants" up for ~30s. Race
// them instead, bring in Nominatim early, and skip servers that just failed.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NEARBY_HEDGE_MS = 2500;            // start the next source if no answer by then
const OVERPASS_DOWN_MS = 10 * 60 * 1000; // skip a failed server for 10 minutes
const _overpassDownUntil = {};

// Starts task i at i * hedgeMs, or as soon as a running one fails; resolves
// with the first success and aborts the rest.
function firstSuccess (tasks, hedgeMs) {
  return new Promise((resolve, reject) => {
  const ctrls = [];
  const timers = [];
  let next = 0;
  let running = 0;
  let done = false;
  let lastErr = null;
  const stop = () => { done = true; timers.forEach(clearTimeout); ctrls.forEach(c => c.abort()); };
  const start = () => {
    if (done || next >= tasks.length) return;
    const ctrl = new AbortController();
    ctrls.push(ctrl);
    const task = tasks[next++];
    running++;
    task(ctrl.signal)
      .then(value => { if (!done) { stop(); resolve(value); } })
      .catch(err => {
        running--;
        if (done) return;
        lastErr = err;
        if (next < tasks.length) start();
        else if (running === 0) { stop(); reject(lastErr || new Error('Nearby lookup unavailable')); }
      });
  };
  start();
  for (let i = 1; i < tasks.length; i++) timers.push(setTimeout(start, i * hedgeMs));
  });
}

/* Overpass endpoint health tracking: deprioritize mirrors that failed recently
   so a dead/hung mirror doesn't eat the entire timeout budget. */
const OVERPASS_FAIL_KEY = 'ftb_overpass_failures_v1';
const OVERPASS_FAIL_TTL = 10 * 60 * 1000; // 10 minutes

function getOverpassFailures () {
  try { return JSON.parse(localStorage.getItem(OVERPASS_FAIL_KEY)) || {}; } catch (_) { return {}; }
}

function markOverpassEndpointHealthy (endpoint) {
  try {
    const fails = getOverpassFailures();
    if (fails[endpoint]) {
      delete fails[endpoint];
      localStorage.setItem(OVERPASS_FAIL_KEY, JSON.stringify(fails));
    }
  } catch (_) {}
}

function markOverpassEndpointFailed (endpoint) {
  try {
    const fails = getOverpassFailures();
    fails[endpoint] = Date.now();
    localStorage.setItem(OVERPASS_FAIL_KEY, JSON.stringify(fails));
  } catch (_) {}
}

function orderOverpassEndpoints (endpoints) {
  const fails = getOverpassFailures();
  const now = Date.now();
  const fresh = [], stale = [];
  for (const ep of endpoints) {
    const failedAt = Number(fails[ep] || 0);
    (failedAt && (now - failedAt) < OVERPASS_FAIL_TTL ? stale : fresh).push(ep);
  }
  return [...fresh, ...stale];
}

async function fetchOverpassElements (query, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || 6000;
  const ordered = orderOverpassEndpoints(opts.endpoints || OVERPASS_ENDPOINTS);
  const failures = getOverpassFailures();
  const healthy = ordered.filter(u => !(_overpassDownUntil[u] > Date.now()) && !(Number(failures[u]) + OVERPASS_FAIL_TTL > Date.now()));
  const endpoints = healthy.length ? healthy : ordered;

  const overpassTask = endpoint => async signal => {
  const ctrl = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  signal.addEventListener('abort', () => ctrl.abort());
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      if (resp.status === 429 || resp.status >= 500) _overpassDownUntil[endpoint] = Date.now() + OVERPASS_DOWN_MS;
      throw new Error(`Overpass ${resp.status}`);
    }
    const json = await resp.json();
    const elements = (json.elements || []).filter(isCredibleFoodVenue);
    if (!elements.length) throw new Error('Overpass empty');
    markOverpassEndpointHealthy(endpoint);
    return elements;
  } catch (err) {
    if (timedOut) _overpassDownUntil[endpoint] = Date.now() + OVERPASS_DOWN_MS;
    if (timedOut || err?.name !== 'AbortError') markOverpassEndpointFailed(endpoint);
    throw err;
  } finally {
    clearTimeout(t);
  }
  };

  const tasks = endpoints.map(overpassTask);
  const useNominatim = opts.nominatimFallback && Number.isFinite(opts.lat) && Number.isFinite(opts.lng);
  if (useNominatim) {
  // Second in line: it answers in about a second when Overpass is struggling.
  tasks.splice(1, 0, async signal => {
    const fallback = await fetchNominatimNearbyElements(
      opts.lat, opts.lng, Number(opts.radiusMeters) || 1609, Number(opts.limit) || 30, signal);
    if (!fallback.length) throw new Error('Nominatim empty');
    return fallback;
  });
  }
  return firstSuccess(tasks, NEARBY_HEDGE_MS);
}

async function fetchNominatimNearbyElements (lat, lng, radiusMeters = 1609, limit = 30, signal = undefined) {
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

  // Nominatim's usage policy allows one request per second, so space them out.
  const responses = await Promise.all(terms.map(async (term, i) => {
  if (i) await new Promise(r => setTimeout(r, i * 1000));
  if (signal?.aborted) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&bounded=1&extratags=1&addressdetails=1&limit=${Math.max(6, Math.ceil(limit / terms.length))}&viewbox=${encodeURIComponent(viewbox)}&q=${encodeURIComponent(term)}`;
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 10000);
    try {
      const resp = await fetch(url, {
        headers: { 'Accept-Language': 'en' },
        signal: ctrl.signal,
      });
      if (!resp.ok) return [];
      const json = await resp.json();
      return Array.isArray(json) ? json : [];
    } catch (err) {
      if (!signal?.aborted) console.warn('[Nearby] Nominatim request failed:', err);
      return [];
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }));

  const seen = new Set();
  const merged = [];
  responses.flat().forEach(item => {
  const nLat = Number(item.lat);
  const nLng = Number(item.lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return;

  const name = String(item.name || '').trim();
  if (!name) return;
  const amenityType = String(item.type || '').replace(/\s+/g, '_');
  const allowed = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream']);
  if (item.class && item.class !== 'amenity' && item.class !== 'shop') return;
  if (amenityType && !allowed.has(amenityType)) return;

  const key = `${normalizeName(name)}|${nLat.toFixed(5)}|${nLng.toFixed(5)}`;
  if (seen.has(key)) return;

  const tags = {
    name,
    amenity: amenityType || 'restaurant',
    cuisine: item.extratags?.cuisine || '',
    opening_hours: item.extratags?.opening_hours || '',
    website: cleanVenueWebsite(item.extratags?.website || ''),
    phone: item.extratags?.phone || '',
    'addr:street': item.address?.road || item.address?.pedestrian || item.address?.suburb || '',
    'addr:housenumber': item.address?.house_number || '',
    'addr:city': item.address?.city || item.address?.town || item.address?.village || item.address?.county || '',
  };
  if (!isCredibleVenueName(name, tags)) return;
  seen.add(key);

  merged.push({
    lat: nLat,
    lon: nLng,
    tags,
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
  } else if (mood === 'adventurous') {
  if (['thai', 'indian', 'korean', 'ethiopian', 'vietnamese', 'peruvian', 'japanese', 'chinese', 'filipino', 'malaysian'].some(c => cuisine.includes(c))) s += 1.8;
  if (r.status === 'want-to-try') s += 1.0;
  if ((r.googleReviews || 0) > 0 && (r.googleReviews || 0) < 200) s += 0.6;
  } else if (mood === 'late-night') {
  if (['mexican', 'pizza', 'american', 'thai', 'korean', 'bbq', 'chinese', 'indian'].some(c => cuisine.includes(c))) s += 1.8;
  if ((r.priceRange || 0) <= 2) s += 0.6;
  } else if (mood === 'budget') {
  if ((r.priceRange || 0) <= 2) s += 1.8;
  if ((r.priceRange || 0) <= 1) s += 0.6;
  } else if (mood === 'fancy') {
  if ((r.priceRange || 0) >= 3) s += 1.6;
  if ((r.googleRating || 0) >= 4.4) s += 1.2;
  } else if (mood === 'new') {
  if (r.status === 'want-to-try') s += 2.2;
  if (!(r.visits || []).length) s += 0.8;
  } else if (mood === 'surprise') {
  s += Math.random() * 2;
  }
  return s;
}

function renderMoodPicksHome (selectedMood = null) {
  const section = document.getElementById('mood-picks-home');
  const list = document.getElementById('mood-picks-list');
  const chipsWrap = document.getElementById('mood-picks-chips');
  if (!section || !list || !chipsWrap) return;

  if (state.restaurants.length < HOME_MIN_SPOTS_FOR_PICKS) {
  section.classList.add('hidden');
  return;
  }

  const activeChip = chipsWrap.querySelector('.home-mood-chip.active');
  const mood = selectedMood || activeChip?.dataset.mood || 'quick';
  chipsWrap.querySelectorAll('.home-mood-chip').forEach(ch => ch.classList.toggle('active', ch.dataset.mood === mood));

  const picks = state.restaurants.filter(nearEnoughToSuggest)
  .map(r => ({ ...r, _moodScore: scoreMoodPick(r, mood) }))
  .sort((a, b) => b._moodScore - a._moodScore)
  .slice(0, 3);

  section.classList.toggle('hidden', !picks.length);
  if (!picks.length) {
  list.innerHTML = '';
  return;
  }

  list.innerHTML = picks.map(r => {
  const meta = `${escHtml(r.cuisine || 'Restaurant')}${r.myRating ? ` • ${'★'.repeat(r.myRating)}` : ''}`;
  const dist = distOf(r);
  const distMeta = Number.isFinite(dist) ? ` • ${fmtDist(dist)} away` : '';
  const moodFit = Math.max(40, Math.min(98, Math.round(r._moodScore * 9.5)));
  const topDish = goToDishOf(r);
  return `<button class="mood-pick-card" type="button" data-id="${r.id}">
    <div class="mood-pick-top">
      <div class="mood-pick-name">${escHtml(r.name)}</div>
      <div class="mood-pick-fit">${moodFit}%</div>
    </div>
    <div class="mood-pick-meta">${meta}${distMeta}</div>
    ${topDish ? `<div class="mood-pick-dish">Get the ${escHtml(topDish.name)}</div>` : ''}
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

  if (state.restaurants.length < HOME_MIN_SPOTS_FOR_PICKS) {
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
  const topCuisine = Object.entries(cuisineHits).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  text.innerHTML = `<strong>${checkins}</strong> check-in${checkins === 1 ? '' : 's'} this week • <strong>${fav}</strong> favorite${fav === 1 ? '' : 's'}`
  + (topCuisine ? ` • <strong>${escHtml(topCuisine)}</strong> in the lead` : ' • Log a meal to start a streak');
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

// Dishes you rated 1-2 stars ("Skip") across every spot — the Never again list.
function getNeverAgainDishes () {
  const out = [];
  (state.restaurants || []).forEach(r => {
    dishesOf(r).forEach(d => {
      if (d.verdict === 'skip') out.push({ r, d });
    });
  });
  return out.sort((a, b) => String(b.d.date || '').localeCompare(String(a.d.date || '')));
}

function getDishLeaderboardData () {
  const map = {};
  const verdictScore = { again: 3, ok: 1, skip: -2 };
  (state.restaurants || []).forEach(r => {
  dishesOf(r).forEach(item => {
    const key = dishKey(item.name);
    if (!key || item.verdict === 'want' || item.verdict === 'skip') return;
    if (!map[key]) map[key] = { key, name: item.name, score: 0, count: 0, restaurants: new Set(), topRestaurantId: r.id };
    const row = map[key];
    row.count += 1;
    row.restaurants.add(r.id);
    row.score += (verdictScore[item.verdict] || 0) + (item.rating || 0);
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
    const badge = i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`;
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

  // Never again: every dish you rated 1-2 stars, with a way to take it off
  // the list if you change your mind (it keeps the dish, just un-skips it).
  const never = getNeverAgainDishes();
  if (never.length) {
  list.insertAdjacentHTML('beforeend', `<div class="dish-board-never"><div class="dish-board-never-title">🚫 Never again</div>${never.map(({ r, d }) => `
    <div class="dish-board-never-row">
      <div class="dish-board-never-main"><div class="dish-board-never-name">${escHtml(d.name)}</div><div class="dish-board-never-meta">${escHtml(r.name)}${d.rating ? ` · ${'★'.repeat(d.rating)}` : ''}${d.note ? ` · ${escHtml(d.note)}` : ''}</div></div>
      <button type="button" class="btn-sm btn-ghost dish-board-never-remove" data-r="${escHtml(r.id)}" data-d="${escHtml(d.id)}">Remove</button>
    </div>`).join('')}</div>`);
  list.querySelectorAll('.dish-board-never-remove').forEach(b => b.addEventListener('click', () => {
    const r = state.restaurants.find(x => x.id === b.dataset.r);
    const d = r && dishesOf(r).find(x => x.id === b.dataset.d);
    if (r && d) upsertDish(r, { name: d.name, verdict: 'ok' });
    openDishLeaderboard();
  }));
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

// Dishes marked "Next time" across every saved spot, nearest first.
// Your saved spots that are open right now: cravings first, then your
// want-to-try list, then favorites. Uses hours from Google place info.
function openNowPicks (now = new Date()) {
  const score = r => (dishesOf(r).some(d => d.verdict === 'want') ? 3 : 0)
  + (r.status === 'want-to-try' ? 2 : 0) + (r.isFavorite ? 1 : 0) + (r.myRating >= 4 ? 1 : 0);
  return (state.restaurants || [])
  .filter(nearEnoughToSuggest)
  .map(r => ({ r, st: openStatus(r, now) }))
  .filter(x => x.st?.open)
  .sort((a, b) => (score(b.r) - score(a.r)) || (distOf(a.r) - distOf(b.r)) || a.r.name.localeCompare(b.r.name));
}

function renderOpenNowHome () {
  const section = document.getElementById('open-now-home');
  const list = document.getElementById('open-now-home-list');
  if (!section || !list) return;
  const picks = openNowPicks();
  section.classList.toggle('hidden', !picks.length);
  if (!picks.length) return;
  const count = document.getElementById('open-now-home-count');
  if (count) count.textContent = `${picks.length} open`;
  list.innerHTML = picks.slice(0, 6).map(({ r, st }) => {
  const crave = dishesOf(r).find(d => d.verdict === 'want');
  const dist = distOf(r);
  const sub = [crave ? `Craving: ${crave.name}` : r.status === 'want-to-try' ? 'On your list' : r.isFavorite ? 'A favorite' : '',
    Number.isFinite(dist) ? fmtDist(dist) : ''].filter(Boolean).join(' · ');
  return `<button class="open-now-card" type="button" data-id="${escHtml(r.id)}">
    <span class="onc-name">${cuisineEmoji(r.cuisine)} ${escHtml(r.name)}</span>
    <span class="onc-status ${st.soon ? 'soon' : ''}">${escHtml(st.text)}</span>
    ${sub ? `<span class="onc-sub">${escHtml(sub)}</span>` : ''}
  </button>`;
  }).join('');
  list.querySelectorAll('.open-now-card').forEach(el => el.addEventListener('click', () => openDetailModal(el.dataset.id)));
}
// Opening and closing times pass while the app sits open.
setInterval(() => { if (!document.hidden) renderOpenNowHome(); }, 5 * 60 * 1000);

function renderCraveHome () {
  const section = document.getElementById('crave-home');
  const list = document.getElementById('crave-home-list');
  if (!section || !list) return;
  const all = (state.restaurants || []).filter(isAvailableSpot);
  if (!all.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const craves = [];
  all.forEach(r => dishesOf(r).forEach(d => {
  if (d.verdict === 'want') craves.push({ r, d, dist: distOf(r) });
  }));
  craves.sort((a, b) => (a.dist - b.dist) || String(a.d.name).localeCompare(String(b.d.name)));

  const count = document.getElementById('crave-home-count');
  if (count) count.textContent = craves.length ? `${craves.length} dish${craves.length === 1 ? '' : 'es'}` : '';
  if (!craves.length) {
  list.innerHTML = '<div class="crave-empty">Dishes you want to order next time. Heard about a great one? Open the spot, type it under Your Order and tap <strong>Next time</strong>.</div>';
  return;
  }
  list.innerHTML = craves.slice(0, 8).map(({ r, d, dist }) => `
  <button class="crave-card" type="button" data-id="${escHtml(r.id)}">
    <span class="crave-dish">${escHtml(d.name)}</span>
    <span class="crave-where">${escHtml(r.name)}${Number.isFinite(dist) ? ` · ${fmtDist(dist)}` : ''}</span>
  </button>`).join('');
  list.querySelectorAll('.crave-card[data-id]').forEach(el => {
  el.addEventListener('click', () => openDetailModal(el.dataset.id));
  });
}

function forYouReason (item) {
  const crave = dishesOf(item).find(d => d.verdict === 'want');
  if (crave) return `Craving: ${crave.name}`;
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
      <span class="daily-quest-pulse-core">🎯</span>
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
  if (all.length < HOME_MIN_SPOTS_FOR_PICKS) {
  section.classList.add('hidden');
  return;
  }

  const scored = all.filter(nearEnoughToSuggest).map(r => {
  const dishes = dishesOf(r);
  const likedCount = dishes.filter(d => d.verdict === 'again').length;
  const dislikedCount = dishes.filter(d => d.verdict === 'skip').length;
  // A dish you've been meaning to try is a strong reason to go back.
  const favDishCount = dishes.filter(d => d.verdict === 'want').length;
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

  // Every saved spot is far away (say, you're traveling): nothing to suggest.
  section.classList.toggle('hidden', !scored.length);
  if (!scored.length) {
  list.innerHTML = '';
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
  const sourceLabel = basePhoto.source === 'user' ? 'Your photo' : '';
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

function resolveExactLocalDishKey (term = '') {
  const raw = String(term || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const keys = Object.keys(BEAR_SWIPE_LOCAL_FOOD_IMAGES)
  .sort((a, b) => b.replace(/_/g, ' ').length - a.replace(/_/g, ' ').length);
  for (const key of keys) {
  const words = key.replace(/_/g, ' ');
  if (raw === key || raw === words || raw.includes(words)) return key;
  }

  if (/\b(gelato|ice cream|sorbet)\b/.test(raw)) return 'gelato';
  if (/\bcheesecake\b/.test(raw)) return 'cheesecake';
  if (/\bchurros?\b/.test(raw)) return 'churros';
  if (/\b(tiramisu|donuts?|pastry|cake slice|chocolate cake)\b/.test(raw)) return 'cheesecake';
  if (/\b(cheeseburger|smash ?burger)\b/.test(raw)) return 'burger';
  if (/\b(penne|vodka sauce|fettuccine|alfredo)\b/.test(raw)) return 'italian_pasta';
  if (/\b(spaghetti|carbonara|bolognese|ravioli)\b/.test(raw)) return 'pasta';
  if (/\b(brisket|ribs|pulled pork)\b/.test(raw)) return 'steak';
  return '';
}

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
  const exactKey = resolveExactLocalDishKey(raw || phrase);
  const exactUrl = exactKey ? BEAR_SWIPE_LOCAL_FOOD_IMAGES[exactKey] : '';
  const local = getLocalDishCandidates(raw || phrase, key);
  const cuisineFallback = (cuisineFallbackByKey[key] || cuisineFallbackByKey.default)
  .map(k => BEAR_SWIPE_LOCAL_FOOD_IMAGES[k])
  .filter(Boolean);
  const base = [exactUrl, ...local, ...cuisineFallback].filter(Boolean);
  const unique = [...new Set(base)];
  if (unique.length) return unique;
  return [...BEAR_SWIPE_LOCAL_FALLBACKS];
}

// Real, varied food photos for the mood swipe deck (the 49 local assets are
// 1-per-dish and repeat constantly with the deck's ~120 cards). Wikimedia
// Commons has thousands of tagged food photos and is free/CORS-open like the
// Wikipedia lookup already used for real venue photos, so each mood term gets
// its own pool instead of reusing the same static jpg.
const _moodPhotoCache = new Map();
const _moodPhotoPending = new Map();

function isLikelyRealFoodPhotoUrl (url = '') {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  if (/\.svg(?:\?|$)/i.test(u)) return false;
  if (/(logo|icon|favicon|placeholder|map[_-]?pin|marker|flag_of|coat_of_arms|seal_of|diagram|map_of)/i.test(u)) return false;
  return true;
}

async function fetchMoodFoodPhotosFromWiki (term = '') {
  const q = String(term || '').trim();
  if (!q) return [];
  try {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrsearch', `filetype:bitmap ${q} food`);
  url.searchParams.set('gsrlimit', '24');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url');
  url.searchParams.set('iiurlwidth', '900');
  url.searchParams.set('origin', '*');

  const resp = await fetch(url.toString());
  if (!resp.ok) return [];
  const json = await resp.json();
  const pages = Object.values(json?.query?.pages || {});
  const urls = pages
    .map(p => safeUrl(p?.imageinfo?.[0]?.thumburl || p?.imageinfo?.[0]?.url || ''))
    .filter(Boolean)
    .filter(isLikelyRealFoodPhotoUrl);
  return [...new Set(urls)];
  } catch {
  return [];
  }
}

function getOrFetchMoodPhotos (term = '') {
  const key = normalizeMoodTermKey(term);
  if (!key) return Promise.resolve([]);
  if (_moodPhotoCache.has(key)) return Promise.resolve(_moodPhotoCache.get(key) || []);
  if (_moodPhotoPending.has(key)) return _moodPhotoPending.get(key);

  const pending = fetchMoodFoodPhotosFromWiki(term)
  .then(urls => {
    _moodPhotoCache.set(key, urls);
    return urls;
  })
  .catch(() => {
    _moodPhotoCache.set(key, []);
    return [];
  })
  .finally(() => {
    _moodPhotoPending.delete(key);
  });

  _moodPhotoPending.set(key, pending);
  return pending;
}

// Kicks off (uncached) fetches for the upcoming few mood cards, and if the
// currently-visible card's term resolves, swaps its image in directly.
function prefetchMoodSwipePhotos (fromIdx = 0) {
  // Mood cards stay on curated local dish photos. Wikimedia Commons search
  // was swapping in watermarked / wrong-subject images (e.g. cheesecake
  // labeled Gelato) after the card rendered.
  void fromIdx;
}

function pickBearSwipePhotoUrl (item, idx = 0) {
  const isLocalFoodAsset = (u = '') => /assets\/food\/[a-z0-9_\-]+\.(?:jpg|jpeg|png|webp)$/i.test(String(u || ''));

  if (item?.source === 'mood') {
  const exactKey = resolveExactLocalDishKey(item.cuisine || item.cuisineLabel || item.name || '');
  const exactUrl = exactKey ? safeUrl(BEAR_SWIPE_LOCAL_FOOD_IMAGES[exactKey] || '') : '';
  if (exactUrl) return exactUrl;
  }

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
  return getMoodFoodImageCandidates(term, seed)[0] || 'feedbear.jpg';
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
  const exactKey = resolveExactLocalDishKey(item.term);
  const candidates = getMoodFoodImageCandidates(item.term, seed);
  const chosen = (exactKey && BEAR_SWIPE_LOCAL_FOOD_IMAGES[exactKey]) || candidates[0] || 'assets/food/pizza.jpg';
  const localKey = extractLocalFoodKeyFromUrl(chosen) || exactKey;
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
    photoFallbacks: [chosen],
    photoSource: 'local',
    dishKey: localKey,
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
  openAddModalPreFilled(item.name, item.cuisine, {
  name: item.name || '',
  address: item.address || '',
  website: item.website || '',
  lat: Number.isFinite(item.lat) ? Number(item.lat) : null,
  lon: Number.isFinite(item.lon ?? item.lng) ? Number(item.lon ?? item.lng) : null,
  });
}

function hideBearSwipeHome () {
  // Bear Swipe v2 brings its own dish photos, so it never depends on saved or nearby spots.
  if (window.BearSwipe) { window.BearSwipe.init(); return; }
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
  partyEl.innerHTML = `<video class="bear-swipe-party-video" autoplay loop controls playsinline webkit-playsinline muted aria-label="Dancing bear celebration" preload="metadata"><source src="assets/videos/dancingbear.webm" type="video/webm" /><source src="assets/videos/dancingbear.mp4" type="video/mp4" /></video><div class="bear-swipe-party-actions"><button class="bear-swipe-party-close icon-btn" type="button" aria-label="Close">✕</button></div><span class="bear-swipe-party-text">SNACK DANCE</span>`;
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

  const sameDish = item?.source === 'mood'
  ? [item.photoUrl, item.dishKey ? BEAR_SWIPE_LOCAL_FOOD_IMAGES[item.dishKey] : '']
  : [
    ...(Array.isArray(item.photoFallbacks) ? item.photoFallbacks : []),
    ...BEAR_SWIPE_LOCAL_FALLBACKS,
  ];
  const queue = sameDish.map(normalizeFallbackUrl).filter(Boolean);

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

  if (isMoodDeck) prefetchMoodSwipePhotos(idx);
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
  // Bear Swipe v2 (bear-swipe.js) owns the home card now.
  if (window.BearSwipe) { window.BearSwipe.init(); return; }
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
  // Bear Swipe v2 (bear-swipe.js) owns the home card now.
  if (window.BearSwipe) { window.BearSwipe.init(); return; }
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
  // Bear Swipe v2 (bear-swipe.js) owns the home card now.
  if (window.BearSwipe) { window.BearSwipe.init(); return; }
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
  // The strip keeps the 24 closest spots, which in a city are a mile or two
  // away. Querying the full 25-mile radius first was slow and is what busy
  // servers drop, so start close and widen only when that comes up short.
  const fetchWithin = r => fetchOverpassElements(
    `[out:json][timeout:20];(node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"](around:${r},${lat},${lng});way["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"](around:${r},${lat},${lng}););out center 80;`,
    { timeoutMs: 9000, nominatimFallback: true, lat, lng, radiusMeters: r, limit: 80 });
  const nearRadius = Math.min(radiusMeters, 4828);
  let elementsRaw = await fetchWithin(nearRadius).catch(err => { if (nearRadius >= radiusMeters) throw err; return []; });
  if (nearRadius < radiusMeters && (elementsRaw || []).filter(isCredibleFoodVenue).length < 8) {
    elementsRaw = await fetchWithin(radiusMeters).catch(err => { if (elementsRaw?.length) return elementsRaw; throw err; });
  }
  const raw = (elementsRaw || []).filter(isCredibleFoodVenue);
  const withDist = raw.map(el => {
    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    const d = (elLat != null && elLon != null) ? haversine(lat, lng, elLat, elLon) : Infinity;
    return { ...el, _dist: d };
  }).filter(el => Number.isFinite(el._dist) && el._dist <= radiusMeters)
    .sort((a, b) => a._dist - b._dist)
    .slice(0, 24);

  _homeDiscCache = { elements: withDist, lat, lng };
  _homeDiscCacheTime = Date.now();
  renderCuisineFilter(); // nearby cuisines join the filter
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
    const priceLevel = verifiedPriceLevel(r);
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
  elements = (elements || []).filter(isCredibleFoodVenue);
  const cuisineWanted = cuisineFilterKey(state.filter?.cuisine);
  if (cuisineWanted && elements.length) {
  const matching = elements.filter(el => cuisineFilterKey(el.tags?.cuisine) === cuisineWanted);
  if (!matching.length) {
    if (list) list.innerHTML = `<div class="nearby-home-loading">No ${escHtml(cuisineFilterLabel(cuisineWanted))} spots nearby yet. <button type="button" class="btn-ghost btn-sm" onclick="clearFilters()">Show all</button></div>`;
    return;
  }
  elements = matching;
  }
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
  const priceLevel = verifiedPriceLevel(savedRestaurant);
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
    website: cleanVenueWebsite(tags.website || tags['contact:website'] || tags.url || ''),
    priceLevel,
    popularity,
    isSaved,
    restaurantId: savedRestaurant?.id || '',
    savedRestaurant,
  };
  });
  setNearbyCards(cards.filter(card => isCredibleVenueName(card.name)));
}

// Today's pick for everyone: Decision Mode's scoring (meal time, open now,
// cravings, friends, weather) picks one saved spot and says why. Kept for the
// rest of the meal so it doesn't reshuffle on every render.
// `reroll` swaps in another of the top three (the refresh button).
// Bear Swipe's latest "Tonight you're craving …", good for a few hours.
const SWIPE_CRAVING_TTL = 6 * 3600000;
const CRAVING_MATCH = {
  american: /american|burger|diner|bbq|barbecue|steak|wings|chicken|sandwich|grill|southern|hot dog/,
  southern: /southern|soul|cajun|creole|fried chicken|bbq|barbecue/,
  bbq: /bbq|barbecue|smokehouse|brisket/,
  mexican: /mexican|taco|tex-?mex|burrito|taqueria|birria/,
  'latin american': /latin|peruvian|cuban|brazilian|colombian|salvadoran|venezuelan|argentin|mexican/,
  japanese: /japanese|sushi|ramen|izakaya|udon|teriyaki/,
  chinese: /chinese|dim sum|szechuan|sichuan|cantonese|dumpling/,
  vietnamese: /vietnamese|pho|banh mi/,
  indian: /indian|curry|nepal|pakistani|tandoor/,
  'middle eastern': /middle eastern|lebanese|mediterranean|falafel|shawarma|persian|kebab|halal/,
  greek: /greek|mediterranean|gyro/,
  turkish: /turkish|kebab|mediterranean/,
  italian: /italian|pizza|pasta/,
  pizza: /pizza|italian/,
  french: /french|bistro|crepe/,
  'eastern european': /eastern european|polish|russian|ukrainian|hungarian|georgian/,
  african: /african|ethiopian|nigerian|moroccan|somali/,
  seafood: /seafood|fish|oyster|poke|crab|lobster|shrimp/,
  breakfast: /breakfast|brunch|diner|pancake|waffle|cafe/,
  bakery: /bakery|pastry|donut|doughnut|bagel|bread/,
  dessert: /dessert|ice cream|gelato|bakery|donut|doughnut|frozen yogurt|sweets|cake/,
  drinks: /coffee|tea|boba|bar|juice|cafe|brewery/,
  healthy: /healthy|salad|poke|vegan|vegetarian|bowl/,
  sandwiches: /sandwich|deli|sub\b|hoagie/,
  steakhouse: /steak/,
};

function swipeCraving () {
  try {
  const c = JSON.parse(localStorage.getItem('ftb_bear_swipe_v2') || '{}').craving;
  if (c?.cuisine && Date.now() - (c.at || 0) < SWIPE_CRAVING_TTL) return c;
  } catch { /* private mode */ }
  return null;
}

function matchesCraving (cuisine, craving) {
  const key = String(craving || '').toLowerCase();
  const re = CRAVING_MATCH[key] || new RegExp(key.replace(/[^a-z ]/g, '') || '^$');
  return re.test(String(cuisine || '').toLowerCase());
}

// Your saved spots that fit a craving, open ones first, then nearest.
function savedCravingSpots (craving, limit = 3) {
  return (state.restaurants || []).filter(r => matchesCraving(r.cuisine, craving))
  .map(r => ({ r, st: openStatus(r), dist: distOf(r) }))
  .filter(x => !(x.st && !x.st.open))
  .sort((a, b) => (b.st?.open ? 1 : 0) - (a.st?.open ? 1 : 0) || a.dist - b.dist)
  .slice(0, limit)
  .map(({ r, st, dist }) => ({ id: r.id, name: r.name, cuisine: r.cuisine || '', status: st?.text || '', dist: Number.isFinite(dist) ? fmtDist(dist) : '' }));
}

// Bear Swipe just named a craving: Today's Pick follows it.
function onBearSwipeCraving () {
  if (usesAiDailyPick()) loadAiRec(_homeDiscCache || { elements: [] });
  else showLocalDailyPick();
}

function localDailyPick (now = new Date(), { reroll = false } = {}) {
  if ((state.restaurants || []).filter(nearEnoughToSuggest).length < 2) return null;
  const meal = mealtimeOf(now);
  const swipe = swipeCraving();
  const key = `ftb_daily_pick_${now.toDateString()}_${meal}${swipe ? `_${swipe.at}` : ''}`;
  let id = '';
  try { id = sessionStorage.getItem(key) || ''; } catch { /* private mode */ }
  let pick = id && !reroll ? state.restaurants.find(r => r.id === id) : null;
  let reasons = [];
  if (!pick) {
  const saved = _decisionModeState;
  _decisionModeState = { mood: meal === 'dinner' ? 'comfort' : 'quick', budget: 0, miles: 10, party: 2, with: [] };
  try {
    const shortlist = buildDecisionModeShortlist().filter(x => nearEnoughToSuggest(x.r));
    const pool = reroll ? shortlist.filter(x => x.r.id !== id) : shortlist;
    const top = reroll ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
    if (top) { pick = top.r; reasons = top.reasons; }
  } finally { _decisionModeState = saved; }
  if (!pick) return null;
  try { sessionStorage.setItem(key, pick.id); } catch { /* private mode */ }
  }
  const day = now.toLocaleDateString(undefined, { weekday: 'long' });
  const why = (reasons.length ? reasons : [pick.status === 'want-to-try' ? 'on your Want to Try list' : 'a spot you love'])
  .filter(r => !/fast decision pick|balanced overall/.test(r)).slice(0, 2).join(', ');
  return { r: pick, text: `${day} ${MEALTIME_LABEL[meal]}: ${pick.name}${why ? `. ${why.charAt(0).toUpperCase()}${why.slice(1)}.` : '.'}` };
}

function usesAiDailyPick () {
  return !!window.AI && typeof isPremium === 'function' && isPremium();
}

function showLocalDailyPick (opts) {
  const banner = document.getElementById('ai-rec-banner');
  const textEl = document.getElementById('ai-rec-text');
  if (!banner || !textEl) return false;
  const pick = localDailyPick(new Date(), opts);
  if (!pick) { banner.classList.add('hidden'); return false; }
  const label = banner.querySelector('.ai-rec-label');
  if (label) label.textContent = "Today's Pick";
  const locked = !hasGrizzly();
  banner.classList.toggle('is-locked', locked);
  textEl.textContent = locked ? 'The bear has a pick from your list for this meal. Tap to unlock it with Grizzly.' : pick.text;
  banner.classList.remove('hidden');
  return true;
}

async function loadAiRec (discData) {
  const generation = _dataGeneration;
  if (!window.AI || (typeof isPremium === 'function' && !isPremium())) { showLocalDailyPick(); return; }
  const banner = document.getElementById('ai-rec-banner');
  const textEl = document.getElementById('ai-rec-text');
  if (!banner || !textEl) return;

  // Cache per calendar day, and per Bear Swipe craving so a new one shows right away.
  const swipe = swipeCraving();
  const cacheKey = 'ftb_airec_' + new Date().toDateString() + (swipe ? `_${swipe.at}` : '');
  const cached   = sessionStorage.getItem(cacheKey);
  if (cached) { textEl.textContent = cached; banner.classList.remove('hidden'); return; }

  banner.classList.remove('hidden');
  textEl.textContent = 'Thinking…';
  try {
  const cravingSpots = swipe
    ? state.restaurants.filter(r => nearEnoughToSuggest(r) && matchesCraving(r.cuisine, swipe.cuisine)).slice(0, 5)
      .map(r => `${r.name} (${r.cuisine})`).join(', ')
    : '';
  const topSaved = state.restaurants
    .filter(r => r.myRating >= 4 && nearEnoughToSuggest(r))
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
${swipe ? `- They just played Bear Swipe and are craving ${swipe.cuisine} food right now. Recommend ${swipe.cuisine} food only${cravingSpots ? `, ideally one of their saved ${swipe.cuisine} spots: ${cravingSpots}` : ''}.
` : ''}Mention a specific place or cuisine name. Be warm and exciting.`;

  const rec = await AI.call(prompt);
  if (generation !== _dataGeneration) return;
  const clean = wholeSentences((rec || '').trim().split('\n')[0].replace(/^["']|["']$/g, ''));
  if (clean) { sessionStorage.setItem(cacheKey, clean); textEl.textContent = clean; }
  else if (!showLocalDailyPick()) banner.classList.add('hidden');
  } catch (err) {
    if (generation !== _dataGeneration) return;
    console.warn('[FTB] Daily recommendation failed:', err);
    if (!showLocalDailyPick()) banner.classList.add('hidden');
  }
}

// Never show a reply that stops mid-sentence: keep the complete sentences, or nothing.
function wholeSentences (text = '') {
  const t = String(text).trim();
  if (/[.!?…][)"'”’]*$/.test(t)) return t;
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
  return cut > 0 ? t.slice(0, cut + 1) : '';
}

// Tapping Byte Cub's pick opens the place it names, or Byte Cub to talk it over.
function openAiRecPick () {
  const text = (document.getElementById('ai-rec-text')?.textContent || '').toLowerCase();
  if (!text || text === 'thinking…') return;
  const saved = (state.restaurants || []).find(r => r.name && text.includes(r.name.toLowerCase()));
  if (saved) { openDetailModal(saved.id); return; }
  const near = (_nearbyCards || []).find(c => c.name && text.includes(c.name.toLowerCase()));
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${near.name} ${near.lat},${near.lon}`)}`, '_blank', 'noopener');
  return;
  }
  openAiPanel();
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
    const safeName = escJsArg(row.name || '');
    const safeCuisine = escJsArg(row.cuisine || '');
    const safeAddress = escJsArg(row.address || '');
    const safeWebsite = escJsArg(row.website || '');
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
  const elements = (elementsRaw || []).filter(isCredibleFoodVenue);

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
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ');
    const matchCuisines = Object.keys(myCuisines).filter(c => (tags.cuisine||'').toLowerCase().includes(c));
    const matchTag = matchCuisines.length ? `Similar to your ${matchCuisines[0]} saves` : '';
    const safeName = escJsArg(tags.name || 'Unknown');
    const safeCuisine = escJsArg(tags.cuisine ? tags.cuisine.replace(/_/g, ' ') : '');
    const safeAddress = escJsArg(address);
    const safeWebsite = escJsArg(cleanVenueWebsite(tags.website || tags['contact:website'] || ''));
    const elLat = Number.isFinite(el.lat ?? el.center?.lat) ? Number(el.lat ?? el.center?.lat) : null;
    const elLon = Number.isFinite(el.lon ?? el.center?.lon) ? Number(el.lon ?? el.center?.lon) : null;

    return `<div class="discover-item">
      <div class="discover-item-emoji">${emoji}</div>
      <div class="discover-item-body">
        <div class="discover-item-name">${name}</div>
        <div class="discover-item-meta">${cuisine ? cuisine + ' · ' : ''}${escHtml(type)}</div>
        ${address ? `<div class="discover-item-meta"> ${escHtml(address)}</div>` : ''}
        ${matchTag ? `<div class="discover-item-match">${escHtml(matchTag)}</div>` : ''}
      </div>
      <div class="discover-item-add">
        <button class="btn-sm btn-orange" onclick="openAddModalPreFilled('${safeName}','${safeCuisine}',{name:'${safeName}',address:'${safeAddress}',website:'${safeWebsite}',lat:${elLat == null ? 'null' : elLat},lon:${elLon == null ? 'null' : elLon}})">Add +</button>
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
  el.innerHTML = '<div class="challenges-empty">No challenges yet. <a onclick="switchChalTab(\'create\')">Create one →</a></div>';
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
        <button class="icon-btn" style="font-size:.7rem;padding:2px 6px" onclick="deleteChallenge(${idx})" title="Delete">✕</button>
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
  showToast('Challenge created!', name, 'success');
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
  showToast('Challenge joined!', ch.n, 'success');
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
   PHASE 9 •  AI ASSISTANT (Gemini-powered Byte Cub)
   ------------------------------------------------------------ */

const _aiHistory = [];

function ensureAiUpgradeAccess (featureName = 'Byte Cub AI') {
  if (hasGrizzly()) return true;
  showGrizzlyUpsell(featureName === 'Byte Cub AI' ? 'byte-cub' : 'general');
  return false;
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

// The developer key box is only for testing on a developer's own computer
// (ai.js ignores a key anywhere else); members never see it.
function _syncAiKeyUI () {
  const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const hasKey = AI.hasKey();
  document.getElementById('ai-key-setup')?.classList.toggle('hidden', !dev || hasKey);
  document.getElementById('ai-key-active')?.classList.toggle('hidden', !dev || !hasKey);
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
  if (window._ftbAccountSwitching) return;
  const generation = _dataGeneration;
  if (!userText.trim()) return;
  if (!ensureAiUpgradeAccess('Byte Cub AI')) return;
  _appendAiMsg('user', userText);
  document.getElementById('ai-chat-input').value = '';

  if (parseCubCommand(userText)) {
    _appendAiMsg('assistant', 'Opening the save and action controls in our chat.');
    closeAiPanel();
    openChat();
    await sendChat(userText);
    return;
  }

  if (!AI.hasAccess()) {
  const ruleResp = typeof chatResponse === 'function' ? chatResponse(userText) : "I need a Gemini API key to give smart answers!";
  _appendAiMsg('assistant', ruleResp);
  return;
  }

  const thinking = _showAiThinking();
  try {
  const area = await userAreaName();
  if (generation !== _dataGeneration) { thinking.remove(); return; }
  const reply = await AI.chat(userText, _aiHistory.slice(-12), state.restaurants, area);
  if (generation !== _dataGeneration) { thinking.remove(); return; }
  thinking.remove();
  // A search for real places runs in Byte Cub's chat, which shows them with save buttons.
  const find = String(reply).match(/\[\[\s*FIND:\s*([^\]]{2,60})\]\]/i);
  if (find) {
    _appendAiMsg('assistant', `Looking for ${find[1].trim()} near you…`);
    closeAiPanel();
    openChat();
    await cubFindNearby(find[1].trim().toLowerCase());
    return;
  }
  if (!String(reply).trim()) throw new Error('Byte Cub returned an empty answer.');
  _appendAiMsg('assistant', reply);
  } catch (err) {
  thinking.remove();
  if (generation !== _dataGeneration) return;
  console.warn('[FTB] Byte Cub AI panel failed:', err);
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
  if (!hasGrizzly()) { showGrizzlyUpsell('summary'); return; }
  const r  = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  const el = document.getElementById('detail-ai-summary');
  if (!el) return;
  el.classList.remove('hidden');

  if (!AI.hasAccess()) {
  el.innerHTML = grizzlyUnlockHtml('summary');
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
  if (!hasGrizzly()) { showGrizzlyUpsell('dishes'); return; }
  const r = state.restaurants.find(x => x.id === restaurantId);
  if (!r) return;
  const el = document.getElementById('detail-ai-summary');
  if (!el) return;
  el.classList.remove('hidden');

  if (!AI.hasAccess()) {
  el.innerHTML = grizzlyUnlockHtml('dishes');
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
  const wishlist = state.restaurants.filter(r => r.status === 'want-to-try' && r.lat && r.lng);
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
  document.getElementById('route-check-' + id).textContent = '✓';
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

function loadDetailPhoto (restaurant) {
  const el = document.getElementById('detail-photo-strip');
  if (!el) return;
  const ownPhoto = String(restaurant?.photo || restaurant?.photoUrl || '').trim();
  const seed = String(restaurant?.id || restaurant?.name || 'ftb');
  // Mood-term matching sent "Mexican" to a burger and "Japanese" to biryani.
  // Only show a stock dish when it matches the cuisine; otherwise show none.
  const cuisinePool = cuisineFoodPhotoPool(String(restaurant?.cuisine || '').toLowerCase());
  const src = ownPhoto || cuisinePool[miniHash(seed) % (cuisinePool.length || 1)] || '';
  if (!src) { el.style.display = 'none'; el.removeAttribute('src'); return; }
  el.alt = `${restaurant?.name || restaurant?.cuisine || 'Restaurant'} photo`;
  el.style.display = 'block';
  el.onerror = () => { el.style.display = 'none'; };
  el.src = src;
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
  const ratingStr = n => n ? '★'.repeat(n) + '☆'.repeat(5-n) : 'Unrated';

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
      ${r.myRating ? `<div style="color:#ff6b35;font-size:.82rem">${'★'.repeat(r.myRating)}</div>` : ''}
      ${r.notes ? `<div style="font-size:.75rem;color:#888;margin-top:4px">${escHtml(r.notes.slice(0,100))}</div>` : ''}
    </div>
    <span style="font-size:.7rem;padding:3px 8px;border-radius:10px;background:${r.status==='visited'?'#1a3a2a':r.status==='want-to-try'?'#1a1a3a':'#2a2a2a'};color:${r.status==='visited'?'#4caf50':r.status==='want-to-try'?'#7c83fd':'#888'}">${r.status}</span>
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

function installDismissed () {
  return !!localStorage.getItem('ftb_install_dismissed') || !!state.settings.pwaDismissed;
}

function initInstallPrompt () {
  // If already installed, do nothing
  if (_isInStandaloneMode()) return;

  // If beforeinstallprompt already fired before this function ran, use it now
  if (_pwaPromptEvent && !_deferredInstallPrompt) {
  _deferredInstallPrompt = _pwaPromptEvent;
  if (!installDismissed()) {
    setTimeout(showInstallBanner, 2000);
  }
  }

  // iOS: show manual instructions after 5s on first visit
  if (_isIos()) {
  if (!installDismissed()) {
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
  if (!installDismissed()) {
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
  const wishlistCount = state.restaurants.filter(r => r.status === 'want-to-try').length;
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
  showToast('Notifications on!', 'You\'ll get nudges when you haven\'t visited anywhere in a while.', 'success');
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
  showToast('Travel Mode Off', 'Back to real location', 'info');
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
  renderTripGuide(t);
}

/* ── Trip guide: everything you and your friends know about a city ── */
const TRIP_RADIUS_M = 40000;

function tripGuideFor (t) {
  const cityWord = String(t.city || '').split(',')[0].trim().toLowerCase();
  const inCity = (lat, lng, address) => (Number.isFinite(lat) && Number.isFinite(lng) && haversine(t.lat, t.lng, lat, lng) <= TRIP_RADIUS_M)
  || (cityWord.length > 2 && String(address || '').toLowerCase().includes(cityWord));
  const here = state.restaurants.filter(r => inCity(r.lat, r.lng, r.address));
  const loved = here.filter(r => r.status === 'visited' && (r.myRating >= 4 || goToDishOf(r)?.verdict === 'again'))
  .sort((a, b) => (b.myRating || 0) - (a.myRating || 0));
  const wants = here.filter(r => r.status === 'want-to-try');
  const mine = new Set(here.map(r => normalizeName(r.name)));
  const friends = [];
  getFriends().forEach(f => (f.data?.picks || []).forEach(p => {
  if (p.r >= 4 && inCity(NaN, NaN, p.a) && !mine.has(normalizeName(p.n)) && !friends.some(x => normalizeName(x.n) === normalizeName(p.n))) {
    friends.push({ ...p, by: f.name });
  }
  }));
  return { city: String(t.city).split(',')[0].trim(), loved, wants, friends };
}

function renderTripGuide (t) {
  const el = document.getElementById('travel-guide');
  if (!el) return;
  if (!t) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const g = tripGuideFor(t);
  const total = g.loved.length + g.wants.length + g.friends.length;
  el.classList.remove('hidden');
  const row = (name, sub) => `<li><strong>${escHtml(name)}</strong>${sub ? `<span>${escHtml(sub)}</span>` : ''}</li>`;
  el.innerHTML = `<div class="tg-head"><span>Your ${escHtml(g.city)} food guide</span>${total ? '<button type="button" class="btn-sm btn-primary tg-share">Share guide</button>' : ''}</div>`
  + (total ? '' : `<p class="tg-empty">Nothing saved in ${escHtml(g.city)} yet. Search nearby (Discovery is set to ${escHtml(g.city)} now) and save spots to build your guide.</p>`)
  + (g.loved.length ? `<div class="tg-sec">Places you love</div><ul>${g.loved.map(r => row(r.name, [r.myRating ? '★'.repeat(r.myRating) : '', goToDishOf(r) ? `get the ${goToDishOf(r).name}` : ''].filter(Boolean).join(' · '))).join('')}</ul>` : '')
  + (g.wants.length ? `<div class="tg-sec">On your list</div><ul>${g.wants.map(r => row(r.name, [r.cuisine, dishesOf(r).find(d => d.verdict === 'want')?.name ? `craving the ${dishesOf(r).find(d => d.verdict === 'want').name}` : ''].filter(Boolean).join(' · '))).join('')}</ul>` : '')
  + (g.friends.length ? `<div class="tg-sec">Friends' picks</div><ul>${g.friends.map(p => row(p.n, [`${p.by} ${'★'.repeat(p.r)}`, p.g?.[0] ? `get the ${p.g[0]}` : ''].filter(Boolean).join(' · '))).join('')}</ul>` : '');
  el.querySelector('.tg-share')?.addEventListener('click', () => shareTripGuide(g));
}

async function shareTripGuide (g) {
  const lines = [`My ${g.city} food guide 🐻`];
  if (g.loved.length) lines.push('', 'Places I love:', ...g.loved.map(r => `• ${r.name}${goToDishOf(r) ? ` (get the ${goToDishOf(r).name})` : ''}`));
  if (g.wants.length) lines.push('', 'On my list:', ...g.wants.map(r => `• ${r.name}`));
  if (g.friends.length) lines.push('', 'Friends recommend:', ...g.friends.map(p => `• ${p.n}${p.g?.[0] ? ` (get the ${p.g[0]})` : ''}`));
  lines.push('', 'Made with Feed The Bear https://www.feed-the-bear.com');
  const text = lines.join('\n');
  trackProductEvent('trip_guide_shared', { spots: g.loved.length + g.wants.length + g.friends.length });
  if (window.StoryCard) {
  try {
    await StoryCard.openStory({
      kind: 'trip', kicker: 'Food guide', title: g.city,
      photo: [...g.loved, ...g.wants].find(r => safeUrl(r.photo || ''))?.photo || '',
      stats: [{ n: g.loved.length, label: 'I love' }, { n: g.wants.length, label: 'to try' }, { n: g.friends.length, label: "friends' picks" }],
      sections: [
        { label: 'Must eat', items: g.loved.slice(0, 4).map(r => r.name), tone: 'gold' },
        { label: 'On my list', items: g.wants.slice(0, 3).map(r => r.name), tone: 'soft' },
        { label: 'Friends say', items: g.friends.slice(0, 3).map(p => p.n), tone: 'soft' },
      ],
    }, text, `${g.city}-food-guide`);
    return;
  } catch (err) { console.warn('[FTB] trip card failed:', err); }
  }
  try { await navigator.clipboard.writeText(text); showToast('Copied!', 'Your guide is ready to paste.', 'success'); } catch { /* blocked */ }
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
    <div class="digest-stat"><div class="digest-stat-val">${avgRating}</div><div class="digest-stat-label">Avg ★</div></div>
  </div>
  ${topRated ? `<div><div class="digest-top-label">Top spot this month</div><div class="digest-top-name">${cuisineEmoji(topRated.cuisine)} ${escHtml(topRated.name)} ${'★'.repeat(topRated.myRating)}</div></div>` : ''}
  ${estSpend > 0 ? `<div class="digest-sub">Estimated spend: ~$${estSpend}</div>` : ''}
  ${visited.length === 0 ? '<div style="color:rgba(255,255,255,.35);font-size:.82rem;margin-top:8px">No visits recorded for this month.</div>' : ''}
  `;
}

function shareDigest () {
  const visitedCount = state.restaurants.filter(r => {
  const d = r.dateVisited || r.dateAdded || '';
  return r.status === 'visited' && d.startsWith(_digestYear + '-' + String(_digestMonth + 1).padStart(2,'0'));
  }).length;
  const text = `🐻 Feed The Bear · ${_MONTH_NAMES[_digestMonth]} ${_digestYear} Digest\n` +
             `Visited: ${visitedCount} restaurant${visitedCount !== 1 ? 's' : ''}\n` +
             `Track yours at https://www.feed-the-bear.com/`;
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

  const query = `[out:json][timeout:20];(node["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"](around:${radius},${lat},${lng});way["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"](around:${radius},${lat},${lng}););out center 80;`;

  try {
  const elementsRaw = await fetchOverpassElements(query, {
    timeoutMs: 18000,
    nominatimFallback: true,
    lat,
    lng,
    radiusMeters: radius,
    limit: 80,
  });
  const elements = (elementsRaw || []).filter(isCredibleFoodVenue);

  if (!elements.length) {
    resultsEl.innerHTML = '<div class="open-now-loading">No places found nearby. Try increasing the radius.</div>';
    return;
  }

  const TYPE_EMOJI = { restaurant:'', cafe:'☕', fast_food:'', bar:'', pub:'' };
  const savedNames = new Set(state.restaurants.map(r => normalizeName(r.name)));

  const items = elements.map(el => {
    const tags       = el.tags || {};
    const isOpen     = _discIsOpenNow(tags.opening_hours);
    const alreadyIn  = savedNames.has(normalizeName(tags.name));
    return {
      tags,
      isOpen,
      alreadyIn,
      lat: Number.isFinite(el.lat ?? el.center?.lat) ? Number(el.lat ?? el.center?.lat) : null,
      lon: Number.isFinite(el.lon ?? el.center?.lon) ? Number(el.lon ?? el.center?.lon) : null,
    };
  }).sort((a,b) => (b.isOpen === true ? 1 : 0) - (a.isOpen === true ? 1 : 0))
    .slice(0, 20);

  if (!items.length) {
    resultsEl.innerHTML = '<div class="open-now-loading">No open places found right now. Try a larger radius.</div>';
    return;
  }

  resultsEl.innerHTML = items.map(({ tags, isOpen, alreadyIn, lat: elLat, lon: elLon }) => {
    const type = tags.amenity || 'restaurant';
    const emoji = TYPE_EMOJI[type] || '';
    const badge = isOpen === true ? 'Open' : isOpen === false ? 'Closed' : 'Hours unknown';
    const safeName = escJsArg(tags.name);
    const safeCuisine = escJsArg(tags.cuisine || '');
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ');
    const safeAddress = escJsArg(address);
    const safeWebsite = escJsArg(cleanVenueWebsite(tags.website || tags['contact:website'] || ''));
    return `<div class="open-now-item">
      <div class="open-now-item-emoji">${emoji}</div>
      <div style="flex:1;min-width:0">
        <div class="open-now-name">${escHtml(tags.name)}</div>
        <div class="open-now-meta">${tags.cuisine ? escHtml(tags.cuisine.replace(/_/g,' ')) + ' · ' : ''}${tags.opening_hours ? escHtml(tags.opening_hours.slice(0,50)) : 'Hours unknown'}</div>
      </div>
      <div class="open-now-badge">${badge}</div>
      ${!alreadyIn ? `<button class="btn-sm btn-orange" onclick="openAddModalPreFilled('${safeName}','${safeCuisine}',{name:'${safeName}',address:'${safeAddress}',website:'${safeWebsite}',lat:${elLat == null ? 'null' : elLat},lon:${elLon == null ? 'null' : elLon}})">+</button>` : ''}
    </div>`;
  }).join('');

  } catch(e) {
  resultsEl.innerHTML = '<div class="open-now-loading">Search failed. Check your connection and try again.</div>';
  }
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
  document.getElementById('vl-date').value = iso();
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
  if (!r.visits) r.visits = [];
  document.getElementById('visitlog-entries').classList.remove('hidden');
  _renderVisitLogList(r);
}
function _renderVisitLogList (r) {
  const listEl = document.getElementById('visitlog-list');
  if (!r.visits || !r.visits.length) {
  listEl.innerHTML = '<div style="color:var(--text2);font-size:.82rem;padding:8px 0">No visits logged yet.</div>';
  return;
  }
  listEl.innerHTML = r.visits.slice().reverse().map((v, i) => {
  const realIdx = r.visits.length - 1 - i;
  const stars = v.rating ? '⭐'.repeat(v.rating) : '';
  return `<div class="visitlog-entry">
    <div class="visitlog-entry-header">
      <span class="visitlog-entry-date">${v.date || ''}</span>
      ${v.spend ? `<span class="visitlog-entry-spend">$${parseFloat(v.spend).toFixed(2)}</span>` : ''}
      <button class="visitlog-entry-del" data-idx="${realIdx}" title="Delete">✕</button>
    </div>
    ${v.dish ? `<div class="visitlog-entry-dish"> ${escHtml(v.dish)}</div>` : ''}
    ${stars ? `<div class="visitlog-entry-stars">${stars}</div>` : ''}
    ${(v.note || v.notes) ? `<div class="visitlog-entry-notes">${escHtml(v.note || v.notes)}</div>` : ''}
  </div>`;
  }).join('');
  listEl.querySelectorAll('.visitlog-entry-del').forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.idx);
    r.visits.splice(idx, 1);
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
  if (!r.visits) r.visits = [];
  r.visits.push({ date, spend: spend ? parseFloat(spend) : null, dish, note: notes, rating: _vlStarVal || null, photo: '' });
  // A logged visit means the place was visited — keep status/stats coherent
  r.status = 'visited';
  if (!r.dateVisited || date > r.dateVisited) r.dateVisited = date;
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
  (r.visits || []).forEach(v => {
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
  .filter(isAvailableSpot)
  .filter(r => r.myRating >= 4 && (r.status === 'visited' || (r.visits && r.visits.length)))
  .map(r => {
    const lastLogDate = r.visits && r.visits.length
      ? r.visits.reduce((best, v) => (!best || v.date > best) ? v.date : best, null)
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
  listEl.innerHTML = candidates.map(({ r, ms }) => {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const ago = days > 365 ? `${Math.floor(days/365)}y ago` : `${days}d ago`;
  const emoji = cuisineEmoji(r.cuisine);
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
  if (!AI.hasAccess()) {
  const out = document.getElementById('mp-result');
  out.classList.remove('hidden');
  out.innerHTML = grizzlyUnlockHtml('mealplanner');
  return;
  }
  const days   = document.getElementById('mp-days').value;
  const budget = document.getElementById('mp-budget').value;
  const vibe   = document.getElementById('mp-vibe').value.trim();
  const btn    = document.getElementById('mp-generate-btn');
  const result = document.getElementById('mp-result');
  result.classList.remove('hidden');
  result.innerHTML = '<span class="ai-thinking-inline"><span></span><span></span><span></span></span> Planning your foodie week…';
  btn.disabled = true;
  const wantToTry = state.restaurants.filter(r => isAvailableSpot(r) && r.status === 'want-to-try').slice(0, 10).map(r => r.name + (r.cuisine ? ' (' + r.cuisine + ')' : '')).join(', ');
  const faves = state.restaurants.filter(r => isAvailableSpot(r) && r.myRating >= 4).slice(0, 8).map(r => r.name + (r.cuisine ? ' (' + r.cuisine + ')' : '')).join(', ');
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
  if (grizzlyLocked('vote')) return;
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
  const sorted = state.restaurants.filter(isAvailableSpot).sort((a, b) => (b.myRating || 0) - (a.myRating || 0)).slice(0, 30);
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
      <button class="btn-sm btn-orange" style="font-size:.72rem;padding:3px 10px" onclick="_castVote('${escJsArg(item.id)}', '${escJsArg(encoded)}')">Vote</button>
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
  {e:'🍝',n:'Italian'},{e:'🌮',n:'Mexican'},{e:'🍱',n:'Japanese'},{e:'🍛',n:'Indian'},
  {e:'🥡',n:'Chinese'},{e:'🥐',n:'French'},{e:'🫒',n:'Mediterranean'},{e:'🍔',n:'American'},
  {e:'🧆',n:'Middle Eastern'},{e:'🍜',n:'Thai'},{e:'🍲',n:'Korean'},{e:'🍜',n:'Vietnamese'},
  {e:'🥩',n:'Steakhouse'},{e:'🦞',n:'Seafood'},{e:'🍺',n:'Pub/Bar'},{e:'🥞',n:'Breakfast'},
  {e:'🍲',n:'Ethiopian'},{e:'🥨',n:'German'},{e:'🥘',n:'Spanish'},{e:'🐟',n:'Peruvian'},
  {e:'🥂',n:'Brunch'},{e:'🥟',n:'Dim Sum'},{e:'🍖',n:'BBQ'},{e:'🌱',n:'Vegan'},
  {e:'🍝',n:'Pasta'},{e:'🍟',n:'Fast Food'},{e:'🍍',n:'Hawaiian'},{e:'🥐',n:'Bakery/Cafe'},
  {e:'🥗',n:'Salad/Healthy'},{e:'🍗',n:'Soul Food'},{e:'🍖',n:'Brazilian'},{e:'🥙',n:'Greek'},
  {e:'🥙',n:'Turkish'},{e:'🍲',n:'Moroccan'},{e:'🧆',n:'Lebanese'},{e:'🍛',n:'Sri Lankan'},
  {e:'🍜',n:'Singaporean'},{e:'🍜',n:'Malaysian'},{e:'🍢',n:'Filipino'},{e:'🥟',n:'Nepalese'},
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
// The first day you ate at a spot: its earliest check-in, else dateVisited.
function firstVisitOf (r) {
  const dates = (r.visits || []).map(v => v.date).filter(Boolean);
  if (r.dateVisited) dates.push(r.dateVisited);
  return dates.sort()[0] || '';
}

// Monday of the week a YYYY-MM-DD date falls in, as a day number.
function weekNumberOf (dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d)) return NaN;
  return Math.floor((d.getTime() / 864e5 - ((d.getDay() + 6) % 7)) / 7);
}

// Weeks in a row you tried somewhere new. Still alive if the last new spot
// was this week or last week, so Monday doesn't wipe it out.
function explorerStats (now = new Date()) {
  const visited = state.restaurants.filter(r => r.status === 'visited');
  const firsts = visited.map(firstVisitOf).filter(Boolean);
  const weeks = [...new Set(firsts.map(weekNumberOf).filter(Number.isFinite))].sort((a, b) => b - a);
  const thisWeek = weekNumberOf(iso());
  let streak = 0;
  if (weeks.length && thisWeek - weeks[0] <= 1) {
  streak = 1;
  while (streak < weeks.length && weeks[streak - 1] - weeks[streak] === 1) streak++;
  }
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return {
  streak,
  newThisWeek: weeks[0] === thisWeek,
  newThisMonth: firsts.filter(d => d.slice(0, 7) === month).length,
  };
}

// The next cuisine to stamp: one already waiting on your Want to Try list
// (nearest first), else a daily pick from the cuisines you haven't tried.
function nextPassportStamp (earned) {
  const missing = _PASSPORT_CUISINES.filter(p => !earned.has(p.n.toLowerCase()));
  if (!missing.length) return null;
  const queued = state.restaurants
  .filter(r => r.status === 'want-to-try' && r.cuisine && missing.some(p => p.n.toLowerCase() === r.cuisine.toLowerCase()))
  .sort((a, b) => (Number.isFinite(distOf(a)) ? distOf(a) : Infinity) - (Number.isFinite(distOf(b)) ? distOf(b) : Infinity))[0];
  if (queued) return { cuisine: missing.find(p => p.n.toLowerCase() === queued.cuisine.toLowerCase()), spot: queued };
  return { cuisine: missing[miniHash(iso()) % missing.length], spot: null };
}

function renderPassportExplorer (earned) {
  const el = document.getElementById('passport-explorer');
  if (!el) return;
  const { streak, newThisWeek, newThisMonth } = explorerStats();
  const next = nextPassportStamp(earned);
  const streakText = streak
  ? `${streak} week${streak === 1 ? '' : 's'} in a row trying somewhere new${newThisWeek ? '' : '. Try a new spot this week to keep it going'}`
  : 'Try a new spot this week to start an explorer streak';
  el.innerHTML = `
  <div class="pe-row">
    <span class="pe-flame${streak >= 3 ? ' hot' : ''}" aria-hidden="true">${streak >= 3 ? '🔥' : '🧭'}</span>
    <div class="pe-text"><strong>${escHtml(streakText)}</strong>
      <span>${newThisMonth} new spot${newThisMonth === 1 ? '' : 's'} this month</span></div>
  </div>
  ${next ? `<div class="pe-next">
    <span class="pe-next-label">Next stamp</span>
    <span class="pe-next-what">${next.cuisine.e} ${escHtml(next.cuisine.n)}${next.spot ? `: ${escHtml(next.spot.name)} is on your list` : ''}</span>
    <button type="button" class="btn-secondary btn-sm" id="pe-next-btn">${next.spot ? 'Open' : 'Find one'}</button>
  </div>` : '<div class="pe-next"><span class="pe-next-what">Every stamp collected. Legendary bear.</span></div>'}`;
  document.getElementById('pe-next-btn')?.addEventListener('click', () => {
  closePassport();
  if (next.spot) openDetailModal(next.spot.id);
  else openDiscoverSearch(next.cuisine.n);
  });
}

function _renderPassport () {
  const visitedCuisines = {};
  // Stamps are for places you've eaten, not ones still on your list.
  state.restaurants.filter(r => r.status === 'visited').forEach(r => {
  if (r.cuisine) {
    visitedCuisines[r.cuisine] = (visitedCuisines[r.cuisine] || 0) + 1;
  }
  });
  const earnedCount = _PASSPORT_CUISINES.filter(p => visitedCuisines[p.n]).length;
  const totalCuisines = Object.keys(visitedCuisines).length;
  const visitedCount = state.restaurants.filter(r => r.status === 'visited').length;

  document.getElementById('passport-stats-row').innerHTML =
  `<div class="passport-stat"><div class="passport-stat-num">${earnedCount}</div><div class="passport-stat-label">Stamps earned</div></div>` +
  `<div class="passport-stat"><div class="passport-stat-num">${totalCuisines}</div><div class="passport-stat-label">Cuisines tried</div></div>` +
  `<div class="passport-stat"><div class="passport-stat-num">${visitedCount}</div><div class="passport-stat-label">Spots visited</div></div>`;
  renderPassportExplorer(new Set(Object.keys(visitedCuisines).map(c => c.toLowerCase())));

  // Show all passport stamps (earned first, then unearned)
  const allStamps = [
  ..._PASSPORT_CUISINES.filter(p => visitedCuisines[p.n]),
  ..._PASSPORT_CUISINES.filter(p => !visitedCuisines[p.n]),
  // Add user cuisines not in the list
  ...Object.keys(visitedCuisines)
    .filter(c => !_PASSPORT_CUISINES.find(p => p.n === c))
    .map(c => ({ e: cuisineEmoji(c), n: c }))
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
  const txt = `🛂 My Foodie Passport: ${earnedCount} cuisine stamps, ${totalCuisines} cuisines explored, ${visitedCount} spots visited. #FeedTheBear`;
  if (navigator.share) navigator.share({ title: 'My Foodie Passport', text: txt });
  else { navigator.clipboard?.writeText(txt); showToast('Copied!', 'Passport summary copied.', 'success'); }
  };
}

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
  const wantPhoto = confirm('Add photos or videos from this visit?');
  if (wantPhoto) {
  const visit = state.restaurants[idx].visits[state.restaurants[idx].visits.length - 1];
  pickFoodMediaList().then(picked => {
    if (!picked.length) return;
    setMediaOn(visit, [...mediaOf(visit), ...picked]);
    saveData();
    renderAll();
    openDetailModal(id);
    showToast(picked.length > 1 ? `${picked.length} added!` : 'Added!', 'Saved to this visit and your gallery.', 'success');
  });
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
  if (!isAvailableSpot(r) || !r.priority || r.status !== 'want-to-try') return '';
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
  const want = state.restaurants.filter(r => isAvailableSpot(r) && r.status === 'want-to-try');
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
  const want = state.restaurants.filter(r => isAvailableSpot(r) && r.status === 'want-to-try');
  const hot  = want.filter(r => r.priority === 'hot');
  const pool = hot.length ? hot : want;
  if (!pool.length) return `Your want-to-try list is empty - add some spots and come back! `;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return ` **Going tonight?** Here\'s my top pick:\n\n<span class="chip-link" data-id="${pick.id}">${cuisineEmoji(pick.cuisine)} **${pick.name}**</span>\n${pick.address ? ' ' + pick.address + '\n' : ''}${pick.googleRating ? '⭐ ' + pick.googleRating + '/5\n' : ''}\nSay "directions" to get there, or ask for another pick!`;
}
