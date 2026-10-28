/* ════════════════════════════════════════════════════════════
   Feed The Bear - Firebase Auth + Firestore Sync + Monetization
   ════════════════════════════════════════════════════════════ */

'use strict';

// ─── CONFIG ──────────────────────────────────────────────────
// ⚠️  Firebase Console → Project Settings → Your apps → Web app → SDK snippet
// ⚠️  Stripe Dashboard → Developers → API keys → Publishable key
// ⚠️  Stripe Dashboard → Products → (your product) → Prices

const _FB_CONFIG = {
  apiKey:            'AIzaSyDH4b9L-CmVsyl2xn2K6peQ3CRmeM6VKI4',
  authDomain:        'feedthebear-3ab9c.firebaseapp.com',
  projectId:         'feedthebear-3ab9c',
  storageBucket:     'feedthebear-3ab9c.firebasestorage.app',
  messagingSenderId: '143862557009',
  appId:             '1:143862557009:web:f9605b80e2344c0d9e4b70',
  measurementId:     'G-2R1LWK111N',
};

const _STRIPE_PK = 'pk_live_51Tk95ILzFIsRCvKRhcGFReLfSCM0AkX6I2jyN7qjjHEPce8sycXOZVvCxxeNsT84yysNdxxzeiDFHXhyB45BewaK00ne0FeBR4';

const _PRICES = {
  monthly: 'price_1Tk9n0LzFIsRCvKRQpBwQRjN',
  yearly:  'price_1Tk9ntLzFIsRCvKRgn4KnUZm',
};

// ─── INIT ─────────────────────────────────────────────────────
let _auth = null;
let _db = null;
try {
  firebase.initializeApp(_FB_CONFIG);
  _auth = firebase.auth();
  _db = firebase.firestore();
} catch (err) {
  console.error('[FTB] Firebase init failed - auth/sync disabled but UI stays functional:', err);
}

let _syncTimer = null;

// ─── PREMIUM CHECK ────────────────────────────────────────────
function isPremium () {
  const plan = window._ftbPlan || localStorage.getItem('ftb_plan_v1') || 'free';
  return !!window._ftbUid && plan === 'grizzly';
}

const FREE_RESTAURANT_LIMIT = 15;

function requiresPremium (featureName, fn) {
  if (isPremium()) { fn(); return; }
  openUpgradeModal(featureName);
}

// ─── AUTH FUNCTIONS ───────────────────────────────────────────
async function fbSignInGoogle () {
  const provider = new firebase.auth.GoogleAuthProvider();
  return _auth.signInWithPopup(provider);
}

async function fbSignInEmail (email, password) {
  return _auth.signInWithEmailAndPassword(email, password);
}

async function fbSignUpEmail (email, password) {
  return _auth.createUserWithEmailAndPassword(email, password);
}

async function fbSignOut () {
  await _auth.signOut();
  window._ftbUid  = null;
  window._ftbPlan = 'free';
  localStorage.removeItem('ftb_plan_v1');
  localStorage.removeItem('ftb_uid_v1');
  closeAuthModal?.();
  closeAccountModal?.();
  showToast?.('Signed out', 'You are now signed out. Your theme and local settings were kept.', 'info');
}

// ─── FIRESTORE SYNC ───────────────────────────────────────────
async function fbLoadUserData (uid) {
  try {
    const [restSnap, profileSnap] = await Promise.all([
      _db.collection(`users/${uid}/restaurants`).get(),
      _db.doc(`users/${uid}/meta/profile`).get(),
    ]);
    const restaurants  = restSnap.docs.map(d => d.data());
    const cloudProfile = profileSnap.exists ? profileSnap.data() : null;
    return { restaurants, cloudProfile };
  } catch (err) {
    console.warn('[FTB] Firestore load failed:', err);
    return { restaurants: [], cloudProfile: null };
  }
}

// Firestore rejects documents over 1 MiB, and one oversized doc fails the
// whole batch, silently stopping sync. Photos are data URLs, so trim the
// largest ones from the cloud copy until it fits; they stay on the device.
const FB_DOC_BUDGET = 900 * 1024;
function cloudSafeRestaurant (r) {
  // "idb:" photo references point into this device's IndexedDB and mean
  // nothing elsewhere; never upload them.
  const json = JSON.stringify(r);
  const hasLocalRefs = json.includes('"idb:');
  if (json.length <= FB_DOC_BUDGET && !hasLocalRefs) return r;
  const copy = JSON.parse(json);
  if (hasLocalRefs) {
    const clear = o => { if (typeof o?.photo === 'string' && o.photo.startsWith('idb:')) o.photo = ''; };
    clear(copy);
    (copy.visits || []).forEach(clear);
    (copy.dishes || []).forEach(clear);
  }
  const slots = [];
  const add = (obj, key) => { if (typeof obj?.[key] === 'string' && obj[key].startsWith('data:')) slots.push({ obj, key, size: obj[key].length }); };
  add(copy, 'photo');
  (copy.visits || []).forEach(v => add(v, 'photo'));
  (copy.dishes || []).forEach(d => add(d, 'photo'));
  slots.sort((a, b) => b.size - a.size);
  for (const s of slots) {
    if (JSON.stringify(copy).length <= FB_DOC_BUDGET) break;
    s.obj[s.key] = '';
  }
  return copy;
}

// When a newer cloud copy wins a merge, put back photos that
// cloudSafeRestaurant trimmed but this device still has.
function restoreTrimmedPhotos (cloud, local) {
  if (!cloud.photo && local.photo) cloud.photo = local.photo;
  const fill = (cloudList, localList, keyOf) => {
    if (!Array.isArray(cloudList) || !Array.isArray(localList)) return;
    const byKey = new Map(localList.map(x => [keyOf(x), x]));
    cloudList.forEach(x => { const l = byKey.get(keyOf(x)); if (l && !x.photo && l.photo) x.photo = l.photo; });
  };
  fill(cloud.visits, local.visits, v => `${v.date}|${v.dish || ''}|${v.note || ''}`);
  fill(cloud.dishes, local.dishes, d => d.id);
}

async function fbSaveRestaurants (uid, restaurants) {
  if (!uid || !restaurants || !restaurants.length) return;
  // Wait until stored photos are back in memory so the cloud gets photos, not references.
  if (typeof photosReadyForSync === 'function' && !photosReadyForSync()) {
    setTimeout(() => fbSaveRestaurants(uid, state.restaurants), 2000);
    return;
  }
  try {
    // Batch in chunks of 400 (Firestore limit is 500 per batch)
    for (let i = 0; i < restaurants.length; i += 400) {
      const batch = _db.batch();
      restaurants.slice(i, i + 400).forEach(r => {
        batch.set(_db.doc(`users/${uid}/restaurants/${r.id}`), cloudSafeRestaurant(r));
      });
      await batch.commit();
    }
  } catch (err) {
    console.warn('[FTB] Firestore save failed:', err);
  }
}

async function fbSaveProfileCloud (uid, profile) {
  if (!uid || !profile) return;
  // Billing fields are server-owned (see firestore.rules) — never send them
  // from the client or the whole write gets rejected.
  const { plan, stripeCustomerId, stripeSessionId, upgradedAt, ...safe } = profile;
  try { await _db.doc(`users/${uid}/meta/profile`).set(safe, { merge: true }); } catch {}
}

// Delete restaurant docs from Firestore so deletions propagate across devices
async function fbDeleteRestaurantsCloud (uid, ids) {
  if (!uid || !_db || !Array.isArray(ids) || !ids.length) return;
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = _db.batch();
      ids.slice(i, i + 400).forEach(id => batch.delete(_db.doc(`users/${uid}/restaurants/${id}`)));
      await batch.commit();
    }
  } catch (err) {
    console.warn('[FTB] Firestore delete failed:', err);
  }
}
window.fbDeleteRestaurantsCloud = fbDeleteRestaurantsCloud;

// Called after every saveData() in app.js - debounced to avoid write storms.
// Every signed-in account is backed up; Grizzly sells unlimited spots and AI.
function fbDebouncedSync () {
  const uid = window._ftbUid;
  if (!uid) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    fbSaveRestaurants(uid, state.restaurants);
    fbPublishFriendProfile();
  }, 3000);
}

// ─── LIVE FRIEND PROFILES ─────────────────────────────────────
// Once you've shared your profile link, friends who follow it read
// profiles/{shareId} for your latest visits and orders. The share id is
// the random part of your link; only people with the link can read it.
let _lastPublishedProfile = '';
async function fbPublishFriendProfile () {
  const uid = window._ftbUid;
  if (!uid || !_db || typeof buildLiveProfile !== 'function') return;
  const doc = buildLiveProfile();
  if (!doc) return;
  const json = JSON.stringify(doc);
  if (json === _lastPublishedProfile) return;
  try {
    await _db.doc(`profiles/${doc.id}`).set({ ...doc, uid, updatedAt: Date.now() });
    _lastPublishedProfile = json;
  } catch (err) {
    console.warn('[FTB] profile publish failed:', err.code || err);
  }
}

async function fbUnpublishFriendProfile (id) {
  _lastPublishedProfile = '';
  if (!_db || !window._ftbUid || !id) return;
  try { await _db.doc(`profiles/${id}`).delete(); } catch (err) { console.warn('[FTB] profile unpublish failed:', err.code || err); }
}

async function fbFetchFriendProfiles (ids) {
  if (!_db || !ids.length) return [];
  return Promise.all(ids.map(id => _db.doc(`profiles/${id}`).get()
    .then(snap => (snap.exists ? snap.data() : null))
    .catch(() => null)));
}
window.fbPublishFriendProfile = fbPublishFriendProfile;
window.fbUnpublishFriendProfile = fbUnpublishFriendProfile;
window.fbFetchFriendProfiles = fbFetchFriendProfiles;

// ─── SHARED LISTS REALTIME ───────────────────────────────────
function fbSharedListUpsert (sharedId, payload) {
  if (!window._ftbUid || !sharedId || !payload) return Promise.resolve();
  return _db.collection('sharedLists').doc(sharedId).set({
    ...payload,
    cloudId: sharedId,
    updatedBy: window._ftbUid,
    updatedAt: Date.now(),
  }, { merge: true }).catch(err => console.warn('[FTB] shared upsert failed:', err));
}

function fbSharedListDelete (sharedId) {
  if (!window._ftbUid || !sharedId) return Promise.resolve();
  return _db.collection('sharedLists').doc(sharedId).delete().catch(err => console.warn('[FTB] shared delete failed:', err));
}

function fbSharedListSubscribe (sharedId, onData) {
  if (!sharedId || typeof onData !== 'function') return () => {};
  return _db.collection('sharedLists').doc(sharedId).onSnapshot(
    snap => {
      if (!snap.exists) return;
      onData({ id: snap.id, ...snap.data() });
    },
    err => console.warn('[FTB] shared subscribe failed:', err),
  );
}

window.fbSharedListUpsert = fbSharedListUpsert;
window.fbSharedListDelete = fbSharedListDelete;
window.fbSharedListSubscribe = fbSharedListSubscribe;

// ─── AUTH STATE OBSERVER ──────────────────────────────────────
function initFirebaseAuth () {
  _auth.onAuthStateChanged(async user => {
    window._ftbAuthReady = true;
    if (user) {
      window._ftbUid       = user.uid;
      window._ftbUserEmail = user.email;

      // Load plan from Firestore
      try {
        const snap = await _db.doc(`users/${user.uid}/meta/profile`).get();
        const data = snap.exists ? snap.data() : {};
        window._ftbPlan = data.plan || 'free';
        localStorage.setItem('ftb_plan_v1', window._ftbPlan);
        localStorage.setItem('ftb_uid_v1',  user.uid);
      } catch { window._ftbPlan = 'free'; }
      if (typeof renderGrizzlyUi === 'function') renderGrizzlyUi();

      // They tapped Upgrade before signing in: bring them straight back.
      let pendingUpgrade = null;
      try { pendingUpgrade = sessionStorage.getItem('ftb_pending_upgrade'); sessionStorage.removeItem('ftb_pending_upgrade'); } catch { /* private mode */ }
      if (pendingUpgrade && window._ftbPlan !== 'grizzly') {
        setTimeout(() => openUpgradeModal({ key: 'resume', period: pendingUpgrade, title: "You're in! One tap to Grizzly",
          body: 'Unlimited spots, Byte Cub AI picks, Year in Review, and 15-second food videos.' }), 700);
      }

      // Restore restaurants on sign-in for ALL users (never lock anyone out
      // of data they previously synced). Ongoing background sync/uploads stay
      // Grizzly-only via fbDebouncedSync.
      // Merge by id (newest updatedAt wins) instead of the old "whichever
      // side has more wins", which resurrected deleted spots and let a
      // stale device overwrite newer edits.
      const { restaurants, cloudProfile } = await fbLoadUserData(user.uid);
      {
        let local = state.restaurants || [];
        if (!local.length) {
          // Auth state can resolve before app.js finishes loading local data —
          // read localStorage directly so a slow start doesn't wipe local spots.
          try { local = JSON.parse(localStorage.getItem('ftb_restaurants_v2') || '[]') || []; } catch { local = []; }
        }
        const deletedIds = new Set((typeof getDeletedRestaurantIds === 'function') ? getDeletedRestaurantIds() : []);
        const ts = v => (typeof v === 'number' ? v : (Date.parse(v) || 0));
        const byId = new Map();
        restaurants.forEach(r => { if (r && r.id && !deletedIds.has(r.id)) byId.set(r.id, r); });
        local.forEach(r => {
          if (!r || !r.id || deletedIds.has(r.id)) return;
          const cloud = byId.get(r.id);
          if (!cloud || ts(r.updatedAt) >= ts(cloud.updatedAt)) byId.set(r.id, r);
          else restoreTrimmedPhotos(cloud, r);
        });
        const merged = [...byId.values()];
        const gained = merged.length - local.length;
        state.restaurants = merged;
        // A list read straight from localStorage carries photo references; restore them.
        if (typeof hydrateStoredPhotos === 'function') hydrateStoredPhotos();
        saveData(); // persists locally + (Grizzly) debounced push of merged set
        renderAll();
        if (deletedIds.size) fbDeleteRestaurantsCloud(user.uid, [...deletedIds]);
        if (gained > 0) {
          showToast('☁️ Den synced!', `Loaded ${gained} spot${gained === 1 ? '' : 's'} from the cloud.`, 'success');
        }
      }

      // Merge profile (cloud wins for plan fields)
      if (cloudProfile) {
        const localProf = loadUserProfile() || {};
        saveUserProfile({ ...localProf, ...cloudProfile });
        updateHeaderAvatar(cloudProfile.avatar || localProf.avatar || 'FTB');

        const appearance = cloudProfile.appearance || null;
        if (appearance && typeof applyThemeChoice === 'function') {
          if (appearance.themeChoice) state.settings.themeChoice = appearance.themeChoice;
          if (appearance.themeMode) state.settings.theme = appearance.themeMode;
          if (appearance.uiDensity) state.settings.uiDensity = appearance.uiDensity;
          if (appearance.uiCorners) state.settings.uiCorners = appearance.uiCorners;
          if (appearance.uiMotion) state.settings.uiMotion = appearance.uiMotion;

          const settingsKey = (typeof SETTINGS_KEY !== 'undefined') ? SETTINGS_KEY : 'ftb_settings_v1';
          localStorage.setItem(settingsKey, JSON.stringify(state.settings));
          applyThemeChoice(state.settings.themeChoice || (state.settings.theme === 'light' ? 'light' : 'dark'));
          if (typeof applyPersonalizationSettings === 'function') applyPersonalizationSettings();
        }
      } else {
        const localProf = loadUserProfile();
        if (localProf) fbSaveProfileCloud(user.uid, localProf);
      }

      updateAuthUI(user);
      if (typeof refreshSharedRealtimeSubscriptions === 'function') refreshSharedRealtimeSubscriptions();

      // Handle ?upgrade=success redirect back from Stripe
      const params = new URLSearchParams(window.location.search);
      if (params.get('upgrade') === 'success') {
        const sessionId = params.get('session_id');
        if (sessionId) await _verifyAndActivatePlan(sessionId, user.uid);
        history.replaceState({}, '', window.location.pathname);
        if (isPremium()) {
          if (typeof trackProductEvent === 'function') trackProductEvent('grizzly_upgraded');
          showToast('Welcome to Grizzly!', 'Unlimited restaurants, AI recs, and more are now unlocked.', 'success');
        }
      }
    } else {
      window._ftbUid  = null;
      window._ftbPlan = localStorage.getItem('ftb_plan_v1') || 'free';
      updateAuthUI(null);
      if (typeof refreshSharedRealtimeSubscriptions === 'function') refreshSharedRealtimeSubscriptions();
    }
  });
}

// Called after returning from Stripe - fetches plan from Vercel API
async function _verifyAndActivatePlan (sessionId, uid) {
  try {
    const resp = await fetch(`/api/verify-session?sessionId=${encodeURIComponent(sessionId)}&uid=${encodeURIComponent(uid)}`);
    const data = await resp.json();
    if (data.plan === 'grizzly') {
      window._ftbPlan = 'grizzly';
      localStorage.setItem('ftb_plan_v1', 'grizzly');
      // First cloud push now that sync is unlocked
      if (state?.restaurants?.length) fbSaveRestaurants(uid, state.restaurants);
    }
  } catch (err) {
    console.warn('[FTB] Plan verification failed:', err);
  }
}

// ─── AUTH MODAL ───────────────────────────────────────────────
function openAuthModal () {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _setAuthMode('signin');
}

function closeAuthModal () {
  document.getElementById('auth-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function _setAuthMode (mode) {
  const isSignup = mode === 'signup';
  const el = id => document.getElementById(id);
  if (el('auth-title'))      el('auth-title').textContent      = isSignup ? 'Create your profile' : 'Welcome back';
  if (el('auth-submit-btn')) el('auth-submit-btn').textContent  = isSignup ? 'Create Profile'   : 'Sign In';
  if (el('auth-toggle-text')) el('auth-toggle-text').innerHTML  = isSignup
    ? 'Already have an account? <button class="auth-link-btn" id="auth-mode-toggle">Sign in</button>'
    : 'New here? <button class="auth-link-btn" id="auth-mode-toggle">Sign up, it\'s free</button>';
  document.getElementById('auth-overlay').dataset.mode = mode;
  document.getElementById('auth-mode-toggle')?.addEventListener('click', () => _setAuthMode(isSignup ? 'signin' : 'signup'));
}

async function _handleAuthSubmit () {
  const overlay  = document.getElementById('auth-overlay');
  const mode     = overlay?.dataset.mode || 'signin';
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const btn      = document.getElementById('auth-submit-btn');
  if (!email || !password) { showToast('Missing info', 'Enter your email and password.', 'error'); return; }
  if (mode === 'signup' && password.length < 8) {
    showToast('Password too short', 'Use at least 8 characters.', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Signing you in...';
  try {
    if (mode === 'signup') {
      await fbSignUpEmail(email, password);
    } else {
      await fbSignInEmail(email, password);
    }
    closeAuthModal();
    showToast(
      'You are in',
      'Your food diary is backed up. Sign in on any device to see it.',
      'success'
    );
  } catch (err) {
    const msg =
      err.code === 'auth/wrong-password'        ? 'Wrong password. Please try again.'    :
      err.code === 'auth/user-not-found'        ? 'No account found with that email.'    :
      err.code === 'auth/email-already-in-use'  ? 'That email is already in use.'   :
      err.code === 'auth/weak-password'         ? 'Password needs at least 8 characters.' :
      err.message;
    showToast('Auth error', msg, 'error');
  } finally {
    btn.disabled = false;
    _setAuthMode(mode);
  }
}

async function _handleGoogleAuth () {
  const btn = document.getElementById('auth-google-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting Google...'; }
  try {
    await fbSignInGoogle();
    closeAuthModal();
    showToast('You are in', 'Your food diary is backed up. Sign in on any device to see it.', 'success');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') showToast('Google Sign-In failed', err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Continue with Google'; }
  }
}

// ─── UPGRADE MODAL ────────────────────────────────────────────
// Accepts a feature name, or a pitch { title, body, period } so each locked
// feature can sell what you'd get instead of a generic "Upgrade" screen.
function openUpgradeModal (highlightFeature) {
  const overlay = document.getElementById('upgrade-overlay');
  if (!overlay) return;
  const pitch = highlightFeature && typeof highlightFeature === 'object' ? highlightFeature : null;
  const title = document.getElementById('upgrade-title');
  if (title) title.textContent = pitch?.title || 'Upgrade to Grizzly';
  const hl = document.getElementById('upgrade-feature-highlight');
  const text = pitch ? pitch.body : (typeof highlightFeature === 'string' && highlightFeature ? `Unlock: ${highlightFeature}` : '');
  if (hl) {
    hl.textContent = text || '';
    hl.classList.toggle('hidden', !text);
  }
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _setUpgradePlan(pitch?.period || 'yearly'); // default to yearly (best value)
  if (typeof trackProductEvent === 'function') trackProductEvent('upgrade_modal_opened', { feature: pitch?.key || String(highlightFeature || 'general').slice(0, 40) });
}

function closeUpgradeModal () {
  document.getElementById('upgrade-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function _setUpgradePlan (period) {
  const el = id => document.getElementById(id);
  const isYearly = period === 'yearly';
  el('upgrade-monthly-btn')?.classList.toggle('active', !isYearly);
  el('upgrade-yearly-btn')?.classList.toggle('active',  isYearly);
  if (el('upgrade-price-main')) el('upgrade-price-main').textContent = isYearly ? '$53.89' : '$4.99';
  if (el('upgrade-price-sub'))  el('upgrade-price-sub').textContent  = isYearly ? '/ year • about $4.49/mo (10% off)' : '/ month';
  if (el('upgrade-cta-btn'))    el('upgrade-cta-btn').dataset.period = period;
}

async function _handleUpgradeClick () {
  const user = _auth?.currentUser;
  if (!user) {
    // Remember the intent so signing in brings them straight back here.
    try { sessionStorage.setItem('ftb_pending_upgrade', document.getElementById('upgrade-cta-btn')?.dataset.period || 'yearly'); } catch { /* private mode */ }
    closeUpgradeModal();
    setTimeout(openAuthModal, 200);
    showToast('One quick step', "Create a free account and you'll come right back to upgrade.", 'info');
    return;
  }
  if (typeof trackProductEvent === 'function') trackProductEvent('upgrade_cta_clicked', { period: document.getElementById('upgrade-cta-btn')?.dataset.period || 'yearly' });
  const btn    = document.getElementById('upgrade-cta-btn');
  const period = btn?.dataset.period || 'yearly';
  const priceId = period === 'yearly' ? _PRICES.yearly : _PRICES.monthly;
  if (btn) { btn.disabled = true; btn.textContent = 'Opening secure checkout...'; }
  try {
    const resp = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: user.uid, email: user.email, priceId }),
    });
    const { url, error } = await resp.json();
    if (error) throw new Error(error);
    window.location.href = url;
  } catch (err) {
    showToast('Checkout failed', err.message || 'Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Upgrade to Grizzly'; }
  }
}

// ─── ACCOUNT PORTAL UI UPDATE ─────────────────────────────────
function updateAuthUI (user) {
  const el = id => document.getElementById(id);
  if (el('account-signin-row'))  el('account-signin-row').classList.toggle('hidden', !!user);
  if (el('account-signout-row')) el('account-signout-row').classList.toggle('hidden', !user);
  if (el('account-upgrade-row')) el('account-upgrade-row').classList.toggle('hidden', isPremium());
  if (el('account-sync-badge')) {
    const synced = !!user;
    el('account-sync-badge').textContent = synced ? '☁️ Cloud synced' : '📱 Device only';
    el('account-sync-badge').className   = 'account-sync-badge' + (synced ? ' badge-synced' : '');
  }
  if (el('account-plan-badge')) {
    const plan = window._ftbPlan || 'free';
    el('account-plan-badge').textContent = plan === 'grizzly' ? 'Grizzly' : 'Cub - Complimentary';
    el('account-plan-badge').className   = 'account-plan-badge' + (plan === 'grizzly' ? ' badge-grizzly' : ' badge-cub');
  }
  if (typeof renderGrizzlyUi === 'function') renderGrizzlyUi();
}

// ─── WIRE UP LISTENERS ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Auth modal
  document.getElementById('auth-overlay')?.addEventListener('click',   e => { if (e.target.id === 'auth-overlay') closeAuthModal(); });
  document.getElementById('auth-close-btn')?.addEventListener('click', closeAuthModal);
  document.getElementById('auth-google-btn')?.addEventListener('click', _handleGoogleAuth);
  document.getElementById('auth-submit-btn')?.addEventListener('click', _handleAuthSubmit);
  document.getElementById('auth-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') _handleAuthSubmit(); });

  // Upgrade modal
  document.getElementById('upgrade-overlay')?.addEventListener('click',    e => { if (e.target.id === 'upgrade-overlay') closeUpgradeModal(); });
  document.getElementById('upgrade-close-btn')?.addEventListener('click',  closeUpgradeModal);
  document.getElementById('upgrade-monthly-btn')?.addEventListener('click', () => _setUpgradePlan('monthly'));
  document.getElementById('upgrade-yearly-btn')?.addEventListener('click',  () => _setUpgradePlan('yearly'));
  document.getElementById('upgrade-cta-btn')?.addEventListener('click',    _handleUpgradeClick);

  // Account portal additional rows
  document.getElementById('account-signin-row')?.addEventListener('click',  () => { closeAccountModal(); setTimeout(openAuthModal, 150); });
  document.getElementById('account-signout-row')?.addEventListener('click', () => { closeAccountModal(); setTimeout(fbSignOut,          150); });
  document.getElementById('account-upgrade-row')?.addEventListener('click', () => { closeAccountModal(); setTimeout(openUpgradeModal,   150); });
});

// ─── KICK IT OFF ──────────────────────────────────────────────
if (_auth) initFirebaseAuth();
