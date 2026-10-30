/* ════════════════════════════════════════════════════════════
   Feed The Bear - Firebase Auth + Firestore Sync + Monetization
   ════════════════════════════════════════════════════════════ */

'use strict';

// ─── CONFIG ──────────────────────────────────────────────────
// ⚠️  Firebase Console → Project Settings → Your apps → Web app → SDK snippet
// ⚠️  Stripe Dashboard → Developers → API keys → Publishable key
// ⚠️  Stripe Dashboard → Products → (your product) → Prices

const _FB_CONFIG = {
  apiKey:            'AIzaSyCqWTvEFYCEVjooO_eCVGNFsIeya17q3WQ',
  authDomain:        'feed-the-bear-app-2-102926.firebaseapp.com',
  projectId:         'feed-the-bear-app-2-102926',
  storageBucket:     'feed-the-bear-app-2-102926.firebasestorage.app',
  messagingSenderId: '565915716798',
  appId:             '1:565915716798:web:1b40da485d3d59c54622ef',
  measurementId:     'G-3B8CXBZCZ0',
};

const _STRIPE_PK = 'pk_live_51Tk95ILzFIsRCvKRhcGFReLfSCM0AkX6I2jyN7qjjHEPce8sycXOZVvCxxeNsT84yysNdxxzeiDFHXhyB45BewaK00ne0FeBR4';

const _PRICES = {
  monthly: 'price_1UW2DmLzFIsRCvKRfFexC3P8',
  yearly:  'price_1UW2F1LzFIsRCvKRvztAuCOE',
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

// ─── DELETE ACCOUNT ───────────────────────────────────────────
// Confirms who you are again, then the server deletes your data, any
// Grizzly subscription and the sign-in itself (api/delete-account.js).
function openDeleteAccount () {
  const user = _auth?.currentUser;
  if (!user) return;
  const el = id => document.getElementById(id);
  const usesPassword = user.providerData.some(p => p.providerId === 'password') && !user.providerData.some(p => p.providerId === 'google.com');
  el('delete-account-password-wrap').classList.toggle('hidden', !usesPassword);
  el('delete-account-password').value = '';
  el('delete-account-confirm').value = '';
  el('delete-account-go').disabled = true;
  el('delete-account-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeDeleteAccount () {
  document.getElementById('delete-account-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

async function _reauthForDelete (user) {
  if (user.providerData.some(p => p.providerId === 'google.com')) {
    await user.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
    return;
  }
  const password = document.getElementById('delete-account-password').value;
  if (!password) throw Object.assign(new Error('Enter your password to confirm it is you.'), { code: 'ftb/need-password' });
  await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
}

// ─── EMAIL, PASSWORD & PHONE ──────────────────────────────────
function _usesGoogle (user) {
  return user.providerData.some(p => p.providerId === 'google.com') && !user.providerData.some(p => p.providerId === 'password');
}

function openSecurity () {
  const user = _auth?.currentUser;
  if (!user) { openAuthModal(); return; }
  const el = id => document.getElementById(id);
  const google = _usesGoogle(user);
  el('security-email').textContent = user.email || 'No email on file';
  el('security-google-note').classList.toggle('hidden', !google);
  el('security-email-form').classList.toggle('hidden', google);
  el('security-current-wrap').classList.toggle('hidden', google);
  el('security-password-section').classList.toggle('hidden', google);
  ['security-new-email', 'security-new-password', 'security-current-password'].forEach(id => { el(id).value = ''; });
  el('security-phone').value = (typeof loadUserProfile === 'function' && loadUserProfile()?.phone) || '';
  el('security-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

function closeSecurity () {
  document.getElementById('security-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}

function _securityError (err) {
  const code = err?.code || '';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') return 'That current password is not right.';
  if (code === 'auth/invalid-email') return 'That email address does not look right.';
  if (code === 'auth/email-already-in-use') return 'Another account already uses that email.';
  if (code === 'auth/weak-password') return 'Use at least 6 characters.';
  if (code === 'auth/too-many-requests') return 'Too many tries. Wait a few minutes and try again.';
  if (code === 'auth/operation-not-allowed') return 'Email changes are turned off for this app right now.';
  return err?.message || 'Something went wrong. Please try again.';
}

async function _reauthWithCurrentPassword (user) {
  const current = document.getElementById('security-current-password').value;
  if (!current) throw Object.assign(new Error('Enter your current password first.'), { code: 'ftb/need-password' });
  await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, current));
}

async function _withBusy (btnId, busyText, fn) {
  const btn = document.getElementById(btnId);
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try { await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

function fbChangeEmail () {
  const user = _auth?.currentUser;
  if (!user) return;
  const next = document.getElementById('security-new-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { showToast('Check the email', 'Enter the new email address.', 'error'); return; }
  if (next.toLowerCase() === (user.email || '').toLowerCase()) { showToast('Same email', 'That is already your email.', 'info'); return; }
  return _withBusy('security-email-save', 'Sending…', async () => {
    try {
      await _reauthWithCurrentPassword(user);
      await user.verifyBeforeUpdateEmail(next);
      document.getElementById('security-new-email').value = '';
      showToast('Check your inbox', `We sent a link to ${next}. Tap it to finish changing your email.`, 'success');
    } catch (err) {
      showToast('Email not changed', _securityError(err), 'error');
    }
  });
}

function fbChangePassword () {
  const user = _auth?.currentUser;
  if (!user) return;
  const next = document.getElementById('security-new-password').value;
  if (next.length < 6) { showToast('Too short', 'Use at least 6 characters.', 'error'); return; }
  return _withBusy('security-password-save', 'Saving…', async () => {
    try {
      await _reauthWithCurrentPassword(user);
      await user.updatePassword(next);
      document.getElementById('security-new-password').value = '';
      document.getElementById('security-current-password').value = '';
      showToast('Password changed', 'Use your new password next time you sign in.', 'success');
    } catch (err) {
      showToast('Password not changed', _securityError(err), 'error');
    }
  });
}

function fbSendPasswordReset () {
  const user = _auth?.currentUser;
  if (!user?.email) return;
  return _withBusy('security-reset-email', 'Sending…', async () => {
    try {
      await _auth.sendPasswordResetEmail(user.email);
      showToast('Reset link sent', `Check ${user.email} for a link to set a new password.`, 'success');
    } catch (err) {
      showToast('Could not send it', _securityError(err), 'error');
    }
  });
}

function savePhone () {
  const raw = document.getElementById('security-phone').value.trim();
  const digits = raw.replace(/\D/g, '');
  if (raw && (digits.length < 7 || digits.length > 15)) { showToast('Check the number', 'That phone number does not look right.', 'error'); return; }
  const profile = (typeof loadUserProfile === 'function' && loadUserProfile()) || { name: 'Foodie', joinDate: new Date().toISOString() };
  saveUserProfile({ ...profile, phone: raw });
  showToast(raw ? 'Phone saved' : 'Phone removed', raw ? 'Your phone number is saved to your account.' : 'Your phone number was removed.', 'success');
}

function eraseLocalData () {
  try {
    Object.keys(localStorage).filter(k => k.startsWith('ftb_') || k.startsWith('ftb-')).forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch { /* storage blocked */ }
  try { indexedDB.deleteDatabase(typeof PHOTO_DB !== 'undefined' ? PHOTO_DB : 'ftb-photos'); } catch { /* not available */ }
}

async function fbDeleteAccount () {
  const user = _auth?.currentUser;
  if (!user) return;
  const btn = document.getElementById('delete-account-go');
  const eraseLocal = document.getElementById('delete-account-local').checked;
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await _reauthForDelete(user);
    const token = await user.getIdToken(true);
    const resp = await fetch('/api/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.message || body.error || 'Deleting your account failed. Please try again.');
    if (typeof trackProductEvent === 'function') trackProductEvent('account_deleted');
    try { await _auth.signOut(); } catch { /* already gone */ }
    window._ftbUid = null;
    window._ftbPlan = 'free';
    localStorage.removeItem('ftb_plan_v1');
    localStorage.removeItem('ftb_uid_v1');
    if (eraseLocal) eraseLocalData();
    closeDeleteAccount();
    showToast('Account deleted', eraseLocal ? 'Your account and this device are wiped clean.' : 'Your account is gone. Spots on this device were kept.', 'success');
    setTimeout(() => window.location.replace('app.html'), 1800);
  } catch (err) {
    const msg = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' ? 'That password is not right.'
      : err.code === 'auth/popup-closed-by-user' ? 'Confirm with Google to delete your account.'
      : err.message;
    showToast('Account not deleted', msg, 'error');
    btn.disabled = false;
  } finally {
    btn.textContent = 'Delete forever';
  }
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
  _capturePaidSession();
  _captureInviteRef();
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
      _checkInviteRewards();

      // A Stripe payment to finish (saved by _capturePaidSession, maybe on an earlier visit)
      const pendingSession = _getPendingSession();
      if (pendingSession) {
        const result = await _verifyAndActivatePlan(pendingSession, user.uid);
        if (result === 'grizzly') {
          _clearPendingSession();
          if (typeof renderGrizzlyUi === 'function') renderGrizzlyUi();
          updateAuthUI(user);
          if (typeof trackProductEvent === 'function') trackProductEvent('grizzly_upgraded');
          const trialEnd = window._ftbTrialEnd ? new Date(window._ftbTrialEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
          showToast(trialEnd ? 'Your free trial has started!' : 'Welcome to Grizzly!', trialEnd
            ? `Everything is unlocked. Nothing is charged until ${trialEnd}, and you can cancel any time in My Account.`
            : 'Unlimited restaurants, AI recs, and more are now unlocked.', 'success');
        } else if (result === 'wrong-account') {
          _clearPendingSession();
          showToast('Different account', 'That Grizzly payment belongs to another account. Sign in with the one you upgraded.', 'error');
        } else if (result === 'unpaid') {
          _clearPendingSession();
        } else {
          showToast('Payment received', "We're still turning on Grizzly. Reopen the app in a minute and it will finish.", 'info');
        }
      }
    } else {
      window._ftbUid  = null;
      window._ftbPlan = localStorage.getItem('ftb_plan_v1') || 'free';
      updateAuthUI(null);
      if (typeof refreshSharedRealtimeSubscriptions === 'function') refreshSharedRealtimeSubscriptions();
      // Back from Stripe but signed out here (e.g. it opened in a browser, not the app)
      if (_getPendingSession()) {
        showToast('Payment received!', 'Sign in to the account you upgraded to finish turning on Grizzly.', 'success');
        setTimeout(() => openAuthModal({ forUpgrade: true }), 400);
      }
    }
  });
}

// Stripe sends buyers back with ?upgrade=success&session_id=…; keep the id until
// a signed-in check succeeds so a sign-out, slow network or different window
// never loses a paid upgrade.
const PENDING_SESSION_KEY = 'ftb_pending_session_v1';
function _capturePaidSession () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('upgrade') !== 'success') return;
  const sessionId = params.get('session_id');
  if (sessionId && /^cs_[\w]+$/.test(sessionId)) {
    try { localStorage.setItem(PENDING_SESSION_KEY, sessionId); } catch { /* private mode */ }
  }
  history.replaceState({}, '', window.location.pathname);
}
function _getPendingSession () {
  try { return localStorage.getItem(PENDING_SESSION_KEY); } catch { return null; }
}
function _clearPendingSession () {
  try { localStorage.removeItem(PENDING_SESSION_KEY); } catch { /* private mode */ }
}

// Asks the server to confirm the Stripe payment and turn on Grizzly.
// Returns 'grizzly', 'wrong-account', 'unpaid' or 'retry'.
async function _verifyAndActivatePlan (sessionId, uid) {
  try {
    const resp = await fetch(`/api/verify-session?sessionId=${encodeURIComponent(sessionId)}&uid=${encodeURIComponent(uid)}`);
    const data = await resp.json().catch(() => ({}));
    if (data.plan === 'grizzly') {
      window._ftbPlan = 'grizzly';
      window._ftbTrialEnd = data.trialEnd || null;
      try { localStorage.removeItem(REF_KEY); } catch { /* private mode */ }
      localStorage.setItem('ftb_plan_v1', 'grizzly');
      // First cloud push now that sync is unlocked
      if (state?.restaurants?.length) fbSaveRestaurants(uid, state.restaurants);
      return 'grizzly';
    }
    if (resp.status === 403) return 'wrong-account';
    if (resp.status === 404 || (resp.status === 402 && data.payment_status === 'unpaid')) return 'unpaid';
    return 'retry';
  } catch (err) {
    console.warn('[FTB] Plan verification failed:', err);
    return 'retry';
  }
}

// ─── AUTH MODAL ───────────────────────────────────────────────
// forUpgrade: opened from the Grizzly upgrade, so it talks about upgrading, not "free".
const AUTH_SUB_DEFAULT = "It's free. Your spots, ratings and photos get backed up, so a new phone never means a lost food diary.";
const AUTH_SUB_UPGRADE = 'Sign in or create your account, and you will go straight to Grizzly checkout.';

function openAuthModal ({ forUpgrade = false } = {}) {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  overlay.dataset.purpose = forUpgrade ? 'upgrade' : '';
  const sub = overlay.querySelector('.auth-sub');
  if (sub) sub.textContent = forUpgrade ? AUTH_SUB_UPGRADE : AUTH_SUB_DEFAULT;
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
  const forUpgrade = el('auth-overlay')?.dataset.purpose === 'upgrade';
  if (el('auth-title'))      el('auth-title').textContent      = forUpgrade ? (isSignup ? 'Create your account for Grizzly' : 'Sign in to get Grizzly') : isSignup ? 'Create your profile' : 'Welcome back';
  if (el('auth-submit-btn')) el('auth-submit-btn').textContent  = isSignup ? 'Create Profile'   : 'Sign In';
  if (el('auth-toggle-text')) el('auth-toggle-text').innerHTML  = isSignup
    ? 'Already have an account? <button class="auth-link-btn" id="auth-mode-toggle">Sign in</button>'
    : `New here? <button class="auth-link-btn" id="auth-mode-toggle">${forUpgrade ? 'Create an account' : 'Sign up, it\'s free'}</button>`;
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
  _refreshTrialOffer();
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
  _renderTrialOffer();
}

// ─── FREE TRIAL & INVITES ─────────────────────────────────────
// New members get 7 days free (30 from a friend's invite link). The server
// decides who is eligible (api/create-checkout.js); signed out, we assume yes.
const REF_KEY = 'ftb_ref_v1';
let _trialOffer = { trial: true, days: 7 };

function _inviteRef () {
  try { return localStorage.getItem(REF_KEY) || ''; } catch { return ''; }
}

// app.html?ref=<uid> from a friend's invite: remember it until they upgrade.
function _captureInviteRef () {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (!ref || !/^[A-Za-z0-9]{10,64}$/.test(ref)) return;
  try { localStorage.setItem(REF_KEY, ref); } catch { /* private mode */ }
  params.delete('ref');
  const rest = params.toString();
  history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  setTimeout(() => showToast?.('A friend invited you!', 'You get 30 days of Grizzly free when you upgrade.', 'success'), 1500);
}

function _upgradeLabel () {
  return _trialOffer.trial ? `Start my ${_trialOffer.days}-day free trial` : 'Upgrade to Grizzly';
}

function _renderTrialOffer () {
  const el = id => document.getElementById(id);
  const btn = el('upgrade-cta-btn');
  if (!btn || btn.disabled) return;
  const yearly = btn.dataset.period !== 'monthly';
  btn.textContent = _upgradeLabel();
  if (el('upgrade-plan-badge')) el('upgrade-plan-badge').textContent = _trialOffer.trial ? `${_trialOffer.days} days free` : 'Most popular';
  if (el('upgrade-footer')) {
    el('upgrade-footer').textContent = _trialOffer.trial
      ? `Free for ${_trialOffer.days} days, then ${yearly ? '$53.89 a year' : '$4.99 a month'}. Cancel before then and you pay nothing. Billed securely by Stripe.`
      : 'Cancel anytime. Billed securely by Stripe. No hidden fees.';
  }
}

async function _refreshTrialOffer () {
  const user = _auth?.currentUser;
  const ref = _inviteRef();
  if (!user) { _trialOffer = { trial: true, days: ref ? 30 : 7 }; _renderTrialOffer(); return; }
  try {
    const q = new URLSearchParams({ uid: user.uid, email: user.email || '', ref });
    const data = await (await fetch(`/api/create-checkout?${q}`)).json();
    if (typeof data.trial === 'boolean') _trialOffer = { trial: data.trial, days: Number(data.days) || 7 };
  } catch { /* keep the last offer */ }
  _renderTrialOffer();
}

function _inviteLink () {
  const uid = _auth?.currentUser?.uid;
  return uid ? `https://www.feed-the-bear.com/app.html?ref=${encodeURIComponent(uid)}` : '';
}

async function shareInvite () {
  const url = _inviteLink();
  if (!url) { openAuthModal(); return; }
  const text = 'I track every restaurant I want to try with Feed The Bear. Join with my link and get 30 days of Grizzly free:';
  if (typeof trackProductEvent === 'function') trackProductEvent('invite_shared');
  try {
    if (navigator.share) { await navigator.share({ title: 'Feed The Bear', text, url }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Invite link copied', 'Paste it to a friend. You get a free month when they join Grizzly.', 'success');
  } catch {
    prompt('Copy your invite link:', url);
  }
}

// Signed-in account actions on the server (api/verify-session.js POST).
async function _accountAction (action) {
  const user = _auth?.currentUser;
  if (!user) throw new Error('Sign in first');
  const token = await user.getIdToken();
  const resp = await fetch('/api/verify-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// A free month from invites: show it, and drop back to free when it ends.
async function _checkInviteRewards () {
  try {
    const { ok, data } = await _accountAction('rewards');
    if (!ok) return;
    window._ftbRewardUntil = data.grizzlyUntil || null;
    window._ftbInvites = data.invites || 0;
    if (data.expired && window._ftbPlan === 'grizzly') {
      const snap = await _db.doc(`users/${_auth.currentUser.uid}/meta/profile`).get();
      window._ftbPlan = snap.data()?.plan || 'free';
      localStorage.setItem('ftb_plan_v1', window._ftbPlan);
      if (window._ftbPlan !== 'grizzly') showToast('Your free month ended', 'Thanks for spreading the word! Invite another friend for another month.', 'info');
    }
    updateAuthUI(_auth.currentUser);
  } catch { /* offline: try next time */ }
}

// ─── WEEKLY PICKS EMAIL (opt-in, api/digest.js) ──────────────
let _digestOn = null;
function _renderDigestRow () {
  const el = document.getElementById('account-digest-state');
  if (!el) return;
  el.textContent = _digestOn ? 'On. 3 spots from your list every Thursday. Tap to stop.' : 'Off. Tap for 3 spots from your list every Thursday.';
}

async function _loadDigestStatus () {
  const user = _auth?.currentUser;
  if (!user || _digestOn !== null) return;
  try {
    const token = await user.getIdToken();
    const resp = await fetch('/api/digest?status=1', { headers: { Authorization: `Bearer ${token}` } });
    if (resp.ok) _digestOn = !!(await resp.json()).on;
  } catch { /* offline */ }
  _renderDigestRow();
}

async function toggleDigest () {
  const user = _auth?.currentUser;
  if (!user) { openAuthModal(); return; }
  const next = !_digestOn;
  const row = document.getElementById('account-digest-row');
  if (row) row.disabled = true;
  try {
    const token = await user.getIdToken();
    const resp = await fetch('/api/digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ on: next }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Please try again.');
    _digestOn = data.on;
    _renderDigestRow();
    if (typeof trackProductEvent === 'function') trackProductEvent(data.on ? 'digest_on' : 'digest_off');
    showToast(data.on ? 'Weekly picks on' : 'Weekly picks off', data.on
      ? `Every Thursday we'll email ${user.email} a few spots from your list.`
      : 'No more weekly emails.', 'success');
  } catch (err) {
    showToast('Could not change it', err.message || 'Please try again.', 'error');
  } finally {
    if (row) row.disabled = false;
  }
}

async function openBilling () {
  const btn = document.getElementById('account-billing-row');
  if (btn) btn.disabled = true;
  try {
    const { ok, status, data } = await _accountAction('portal');
    if (ok && data.url) { window.location.href = data.url; return; }
    showToast('Nothing to manage', status === 404
      ? (window._ftbRewardUntil ? 'Your Grizzly is a free month from invites, so there is no bill.' : 'There is no subscription on this account.')
      : (data.error || 'Please try again.'), 'info');
  } catch (err) {
    showToast('Could not open billing', err.message || 'Please try again.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _handleUpgradeClick () {
  const user = _auth?.currentUser;
  if (!user) {
    // Remember the intent so signing in brings them straight back here.
    try { sessionStorage.setItem('ftb_pending_upgrade', document.getElementById('upgrade-cta-btn')?.dataset.period || 'yearly'); } catch { /* private mode */ }
    closeUpgradeModal();
    setTimeout(() => openAuthModal({ forUpgrade: true }), 200);
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
      body: JSON.stringify({ uid: user.uid, email: user.email, priceId, ref: _inviteRef() }),
    });
    const { url, error } = await resp.json();
    if (error) throw new Error(error);
    window.location.href = url;
  } catch (err) {
    showToast('Checkout failed', err.message || 'Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = _upgradeLabel(); }
  }
}

// ─── ACCOUNT PORTAL UI UPDATE ─────────────────────────────────
function updateAuthUI (user) {
  const el = id => document.getElementById(id);
  if (el('account-signin-row'))  el('account-signin-row').classList.toggle('hidden', !!user);
  if (el('account-signout-row')) el('account-signout-row').classList.toggle('hidden', !user);
  if (el('account-delete-row')) el('account-delete-row').classList.toggle('hidden', !user);
  if (el('account-security-row')) el('account-security-row').classList.toggle('hidden', !user);
  if (el('account-email-display')) {
    el('account-email-display').textContent = user?.email || '';
    el('account-email-display').classList.toggle('hidden', !user?.email);
  }
  if (el('account-upgrade-row')) el('account-upgrade-row').classList.toggle('hidden', isPremium());
  if (el('account-digest-row')) {
    el('account-digest-row').classList.toggle('hidden', !user?.email);
    if (user?.email) _loadDigestStatus();
  }
  if (!user) _digestOn = null;
  if (el('account-billing-row')) el('account-billing-row').classList.toggle('hidden', !user || !isPremium() || !!window._ftbRewardUntil);
  if (el('account-invite-state') && window._ftbInvites) {
    el('account-invite-state').textContent = `${window._ftbInvites} friend${window._ftbInvites === 1 ? '' : 's'} joined so far.`
      + (window._ftbRewardUntil ? ` Free Grizzly until ${new Date(window._ftbRewardUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.` : '');
  }
  if (el('account-sync-badge')) {
    const synced = !!user;
    el('account-sync-badge').textContent = synced ? '☁️ Cloud synced' : '📱 Device only';
    el('account-sync-badge').className   = 'account-sync-badge' + (synced ? ' badge-synced' : '');
  }
  if (el('account-plan-badge')) {
    const plan = window._ftbPlan || 'free';
    el('account-plan-badge').textContent = plan !== 'grizzly' ? 'Cub - Complimentary' : window._ftbRewardUntil ? 'Grizzly - free month' : 'Grizzly';
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
  document.getElementById('account-signin-row')?.addEventListener('click',  () => { closeAccountModal(); setTimeout(() => openAuthModal(), 150); });
  document.getElementById('account-signout-row')?.addEventListener('click', () => { closeAccountModal(); setTimeout(fbSignOut,          150); });
  document.getElementById('account-delete-row')?.addEventListener('click', () => { closeAccountModal(); setTimeout(openDeleteAccount, 150); });

  // Email, password & phone
  document.getElementById('account-security-row')?.addEventListener('click', () => { closeAccountModal(); setTimeout(openSecurity, 150); });
  document.getElementById('security-close')?.addEventListener('click', closeSecurity);
  document.getElementById('security-overlay')?.addEventListener('click', e => { if (e.target.id === 'security-overlay') closeSecurity(); });
  document.getElementById('security-email-save')?.addEventListener('click', fbChangeEmail);
  document.getElementById('security-password-save')?.addEventListener('click', fbChangePassword);
  document.getElementById('security-reset-email')?.addEventListener('click', fbSendPasswordReset);
  document.getElementById('security-phone-save')?.addEventListener('click', savePhone);

  // Delete account
  document.getElementById('delete-account-close')?.addEventListener('click', closeDeleteAccount);
  document.getElementById('delete-account-cancel')?.addEventListener('click', closeDeleteAccount);
  document.getElementById('delete-account-overlay')?.addEventListener('click', e => { if (e.target.id === 'delete-account-overlay') closeDeleteAccount(); });
  document.getElementById('delete-account-confirm')?.addEventListener('input', e => {
    document.getElementById('delete-account-go').disabled = e.target.value.trim().toUpperCase() !== 'DELETE';
  });
  document.getElementById('delete-account-go')?.addEventListener('click', fbDeleteAccount);
  document.getElementById('account-upgrade-row')?.addEventListener('click', () => { closeAccountModal(); setTimeout(openUpgradeModal,   150); });
  document.getElementById('account-invite-row')?.addEventListener('click', shareInvite);
  document.getElementById('account-billing-row')?.addEventListener('click', openBilling);
  document.getElementById('account-digest-row')?.addEventListener('click', toggleDigest);
});

// ─── KICK IT OFF ──────────────────────────────────────────────
if (_auth) initFirebaseAuth();
