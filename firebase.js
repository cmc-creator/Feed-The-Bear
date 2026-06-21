/* ════════════════════════════════════════════════════════════
   Feed The Bear — Firebase Auth + Firestore Sync + Monetization
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
firebase.initializeApp(_FB_CONFIG);
const _auth = firebase.auth();
const _db   = firebase.firestore();

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

async function fbSaveRestaurants (uid, restaurants) {
  if (!uid || !restaurants || !restaurants.length) return;
  try {
    // Batch in chunks of 400 (Firestore limit is 500 per batch)
    for (let i = 0; i < restaurants.length; i += 400) {
      const batch = _db.batch();
      restaurants.slice(i, i + 400).forEach(r => {
        batch.set(_db.doc(`users/${uid}/restaurants/${r.id}`), r);
      });
      await batch.commit();
    }
  } catch (err) {
    console.warn('[FTB] Firestore save failed:', err);
  }
}

async function fbSaveProfileCloud (uid, profile) {
  if (!uid || !profile) return;
  try { await _db.doc(`users/${uid}/meta/profile`).set(profile, { merge: true }); } catch {}
}

// Called after every saveData() in app.js — debounced to avoid write storms
function fbDebouncedSync () {
  const uid = window._ftbUid;
  if (!uid) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => fbSaveRestaurants(uid, state.restaurants), 3000);
}

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

      // Sync restaurants — cloud wins if it has more data
      const { restaurants, cloudProfile } = await fbLoadUserData(user.uid);
      const local = state.restaurants || [];
      if (restaurants.length > local.length) {
        state.restaurants = restaurants;
        saveData();
        renderAll();
        showToast('☁️ Den synced!', `Loaded ${restaurants.length} spots from the cloud.`, 'success');
      } else if (local.length > 0) {
        fbSaveRestaurants(user.uid, local); // push local to cloud
      }

      // Merge profile (cloud wins for plan fields)
      if (cloudProfile) {
        const localProf = loadUserProfile() || {};
        saveUserProfile({ ...localProf, ...cloudProfile });
        updateHeaderAvatar(cloudProfile.avatar || localProf.avatar || '🐻');

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
          showToast('🐻 Welcome to Grizzly!', 'Unlimited restaurants, AI recs, and more. You\'re a true bear now!', 'success');
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

// Called after returning from Stripe — fetches plan from Vercel API
async function _verifyAndActivatePlan (sessionId, uid) {
  try {
    const resp = await fetch(`/api/verify-session?sessionId=${encodeURIComponent(sessionId)}&uid=${encodeURIComponent(uid)}`);
    const data = await resp.json();
    if (data.plan === 'grizzly') {
      window._ftbPlan = 'grizzly';
      localStorage.setItem('ftb_plan_v1', 'grizzly');
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
  if (el('auth-title'))      el('auth-title').textContent      = isSignup ? 'Join the pack 🐻' : 'Welcome back, bear 🐾';
  if (el('auth-submit-btn')) el('auth-submit-btn').textContent  = isSignup ? 'Create Account'   : 'Sign In';
  if (el('auth-toggle-text')) el('auth-toggle-text').innerHTML  = isSignup
    ? 'Already in the den? <button class="auth-link-btn" id="auth-mode-toggle">Sign in</button>'
    : 'New to the den? <button class="auth-link-btn" id="auth-mode-toggle">Sign up — it\'s free</button>';
  document.getElementById('auth-overlay').dataset.mode = mode;
  document.getElementById('auth-mode-toggle')?.addEventListener('click', () => _setAuthMode(isSignup ? 'signin' : 'signup'));
}

async function _handleAuthSubmit () {
  const overlay  = document.getElementById('auth-overlay');
  const mode     = overlay?.dataset.mode || 'signin';
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const btn      = document.getElementById('auth-submit-btn');
  if (!email || !password) { showToast('Missing info', 'Enter your email and password, bear.', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = 'Bear with us…';
  try {
    if (mode === 'signup') {
      await fbSignUpEmail(email, password);
    } else {
      await fbSignInEmail(email, password);
    }
    closeAuthModal();
    showToast('🐻 You\'re in!', 'Your den is now synced across all your devices.', 'success');
  } catch (err) {
    const msg =
      err.code === 'auth/wrong-password'        ? 'Wrong password — try again, bear.'    :
      err.code === 'auth/user-not-found'        ? 'No account found with that email.'    :
      err.code === 'auth/email-already-in-use'  ? 'That email is already in the den!'   :
      err.code === 'auth/weak-password'         ? 'Password needs at least 6 characters.' :
      err.message;
    showToast('Auth error 🐾', msg, 'error');
  } finally {
    btn.disabled = false;
    _setAuthMode(mode);
  }
}

async function _handleGoogleAuth () {
  const btn = document.getElementById('auth-google-btn');
  if (btn) { btn.disabled = true; btn.textContent = '🐻 Sniffing out your Google…'; }
  try {
    await fbSignInGoogle();
    closeAuthModal();
    showToast('🐻 You\'re in!', 'Synced with Google. Your den is ready!', 'success');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') showToast('Google Sign-In failed', err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🟠 Continue with Google'; }
  }
}

// ─── UPGRADE MODAL ────────────────────────────────────────────
function openUpgradeModal (highlightFeature) {
  const overlay = document.getElementById('upgrade-overlay');
  if (!overlay) return;
  const hl = document.getElementById('upgrade-feature-highlight');
  if (hl) {
    hl.textContent = highlightFeature ? `Unlock: ${highlightFeature}` : '';
    hl.classList.toggle('hidden', !highlightFeature);
  }
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  _setUpgradePlan('yearly'); // default to yearly (best value)
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
  if (el('upgrade-price-main')) el('upgrade-price-main').textContent = isYearly ? '$19.99' : '$2.99';
  if (el('upgrade-price-sub'))  el('upgrade-price-sub').textContent  = isYearly ? '/ year — save 44%!' : '/ month';
  if (el('upgrade-cta-btn'))    el('upgrade-cta-btn').dataset.period = period;
}

async function _handleUpgradeClick () {
  const user = _auth.currentUser;
  if (!user) {
    closeUpgradeModal();
    setTimeout(openAuthModal, 200);
    showToast('Sign in first 🐾', 'Create a free account, then upgrade to Grizzly.', 'info');
    return;
  }
  const btn    = document.getElementById('upgrade-cta-btn');
  const period = btn?.dataset.period || 'yearly';
  const priceId = period === 'yearly' ? _PRICES.yearly : _PRICES.monthly;
  if (btn) { btn.disabled = true; btn.textContent = '🐻 Heading to checkout…'; }
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
    showToast('Checkout failed 🐾', err.message || 'Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Upgrade to Grizzly 🐻'; }
  }
}

// ─── ACCOUNT PORTAL UI UPDATE ─────────────────────────────────
function updateAuthUI (user) {
  const el = id => document.getElementById(id);
  if (el('account-signin-row'))  el('account-signin-row').classList.toggle('hidden', !!user);
  if (el('account-signout-row')) el('account-signout-row').classList.toggle('hidden', !user);
  if (el('account-upgrade-row')) el('account-upgrade-row').classList.toggle('hidden', isPremium());
  if (el('account-sync-badge')) {
    el('account-sync-badge').textContent = user ? '☁️ Cloud synced' : '📱 Device only';
    el('account-sync-badge').className   = 'account-sync-badge' + (user ? ' badge-synced' : '');
  }
  if (el('account-plan-badge')) {
    const plan = window._ftbPlan || 'free';
    el('account-plan-badge').textContent = plan === 'grizzly' ? '🐻 Grizzly' : '🐾 Cub — Free';
    el('account-plan-badge').className   = 'account-plan-badge' + (plan === 'grizzly' ? ' badge-grizzly' : ' badge-cub');
  }
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
initFirebaseAuth();
