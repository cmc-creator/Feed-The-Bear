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
const _authPersistenceReady = _auth
  ? _auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).then(() => null, err => {
    console.error('[FTB] Persistent sign-in unavailable:', err);
    return err;
  }) : Promise.resolve(new Error('Sign-in is unavailable. Reload and try again.'));

async function ensureAuthPersistence () {
  const error = await _authPersistenceReady;
  if (error) throw new Error('Could not keep you signed in on this device. Allow site storage/cookies, then reload and try again.');
}
let _authGeneration = 0;
let _accountSwitchChain = Promise.resolve();
let _sessionTask = Promise.resolve();
let _signingOut = false;

function setBackupStatus (status, message = '') {
  window._ftbBackupStatus = status;
  let el = document.getElementById('backup-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'backup-status';
    el.className = 'backup-status hidden';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span></span><button type="button" class="btn-sm">Retry backup</button>';
    document.querySelector('main')?.prepend(el);
    el.querySelector('button').onclick = () => {
      if (_auth?.currentUser) _sessionTask = handleFirebaseUser(_auth.currentUser);
      else openAuthModal();
    };
  }
  el.classList.toggle('hidden', status !== 'error' && status !== 'loading');
  el.querySelector('span').textContent = message;
  el.querySelector('button').classList.toggle('hidden', status !== 'error');
}

// ─── PREMIUM CHECK ────────────────────────────────────────────
function isPremium () {
  const plan = window._ftbPlan || localStorage.getItem('ftb_plan_v1') || 'free';
  return !!window._ftbUid && plan === 'grizzly';
}

// FREE_RESTAURANT_LIMIT is declared in app.js (loads first) so no script
// can run before it exists.

function requiresPremium (featureName, fn) {
  if (isPremium()) { fn(); return; }
  openUpgradeModal(featureName);
}

// ─── AUTH FUNCTIONS ───────────────────────────────────────────
// Email verification (2026-11-10): a new email/password account confirms its
// inbox, but the diary opens right away — verification happens in the
// background. Bots were signing up with random emails and each one could burn
// paid place lookups, so paid lookups and cloud sync stay gated until the
// inbox is confirmed (api/_guard.js, api/save-spots.js). Google accounts are
// verified by Google. Accounts created before the cutoff never had
// verification, so they keep working exactly as before.
const EMAIL_VERIFY_CUTOFF = Date.parse('2026-11-10T21:00:00Z');

function _needsEmailVerification (user) {
  if (!user || user.emailVerified) return false;
  if ((user.providerData || []).some(p => p.providerId === 'google.com' || p.providerId === 'apple.com')) return false;
  const created = Date.parse(user.metadata?.creationTime || '') || 0;
  return created >= EMAIL_VERIFY_CUTOFF;
}

// Show the sign-in sheet in "check your email" mode. It's a reminder, not a
// wall: the diary is open behind it, and the member can continue into it and
// verify later ("Continue to my diary").
function _showVerifyEmail (user) {
  window._ftbNeedsVerification = true;
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  const em = document.getElementById('auth-verify-email');
  if (em) em.textContent = user?.email || '';
  _setAuthMode('verify');
  overlay.classList.add('auth-required');
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
}

// The verify screen is a reminder, not a wall: let them into the diary and
// verify in the background. Paid lookups and cloud sync stay gated until they
// confirm. The reminder shows again on the next sign-in until then.
function _continueToDiaryUnverified () {
  window._ftbVerifyDismissed = true;
  closeAuthModal();
  showToast('Verify your email when you can', 'Confirm your inbox to back up your spots and unlock place lookups.', 'info');
}

// Tell the owner a real member joined — once per account, and only once the
// inbox is confirmed, so bot signups never spam it.
function _sendJoinedEmail (user) {
  if (!user) return;
  try {
    const key = 'ftb_joined_' + user.uid;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch { /* storage unavailable: send anyway */ }
  user.getIdToken().then(t => fetch('/api/push', { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'joined' }) })).catch(() => {});
}

// "I've verified — continue": reload the account and open the diary if confirmed.
async function _checkVerification () {
  const user = _auth?.currentUser;
  if (!user) return;
  const btn = document.getElementById('auth-verify-check');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    await user.reload();
    if (_needsEmailVerification(user)) {
      _authError('Not verified yet — tap the link in the email we sent (check spam too), then try again.');
    } else {
      window._ftbNeedsVerification = false;
      window._ftbVerifyDismissed = false;
      // They confirmed after signing up: tell the owner they joined.
      _sendJoinedEmail(user);
      closeAuthModal();
      _sessionTask = handleFirebaseUser(user);
    }
  } catch (err) {
    _authError(err.message || 'Could not check. Try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "I've verified — continue"; }
  }
}

async function _resendVerification () {
  const user = _auth?.currentUser;
  if (!user) return;
  const btn = document.getElementById('auth-verify-resend');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await user.sendEmailVerification();
    showToast('Email sent', `We sent a new link to ${user.email}. Check your inbox (and spam).`, 'success');
  } catch (err) {
    showToast('Could not send it', err.message || 'Try again in a minute.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Resend the email'; }
  }
}

// Leave the verify screen to use a different account.
async function _signOutFromVerify () {
  window._ftbNeedsVerification = false;
  await fbSignOut();
}

async function fbSignInGoogle () {
  await ensureAuthPersistence();
  const provider = new firebase.auth.GoogleAuthProvider();
  // Always ask which Google account: a phone signed in to several picks one
  // silently, and the wrong one is a different (free) Feed The Bear account.
  provider.setCustomParameters({ prompt: 'select_account' });
  return _auth.signInWithPopup(provider);
}

async function fbSignInEmail (email, password) {
  await ensureAuthPersistence();
  return _auth.signInWithEmailAndPassword(email, password);
}

async function fbSignUpEmail (email, password) {
  await ensureAuthPersistence();
  const cred = await _auth.createUserWithEmailAndPassword(email, password);
  // New accounts confirm their inbox in the background — the diary opens
  // right away. If the email can't be sent, the verify screen lets them
  // resend it.
  try { await cred.user.sendEmailVerification(); } catch (err) { console.warn('[FTB] Verification email failed:', err.message); }
  return cred;
}

async function fbSignOut () {
  _signingOut = true;
  window._ftbVerifyDismissed = false;
  try {
    await _auth.signOut();
    if (window._ftbUid) _sessionTask = handleFirebaseUser(null);
    await _sessionTask;
    showToast('Signed out', 'Your diary is hidden until you sign back into this account. Your theme was kept.', 'info');
  } catch (err) {
    console.error('[FTB] Sign-out failed:', err);
    showToast('Could not sign out', 'Please try again. Your saved diary has not been deleted.', 'error');
  } finally { _signingOut = false; }
}

// ─── DELETE ACCOUNT ───────────────────────────────────────────
// Confirms who you are again, then the server deletes your data, any
// Grizzly subscription and the sign-in itself (api/delete-account.js).
function openDeleteAccount () {
  const user = _auth?.currentUser;
  if (!user) return;
  const el = id => document.getElementById(id);
  const usesPassword = user.providerData.some(p => p.providerId === 'password') && !user.providerData.some(p => p.providerId === 'google.com' || p.providerId === 'apple.com');
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
  if (user.providerData.some(p => p.providerId === 'apple.com') && window.Capacitor?.Plugins?.AppleSignIn) {
    const { credential, code } = await _appleCredential();
    await user.reauthenticateWithCredential(credential);
    // Apple asks apps to cut the Sign in with Apple link when the account goes.
    if (code) { try { await _auth.revokeAccessToken?.(code); } catch (err) { console.warn('[FTB] Apple revoke failed:', err?.message); } }
    return;
  }
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

async function eraseLocalData () {
  Object.keys(localStorage).filter(k => k.startsWith('ftb_') || k.startsWith('ftb-')).forEach(k => localStorage.removeItem(k));
  sessionStorage.clear();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(typeof PHOTO_DB !== 'undefined' ? PHOTO_DB : 'ftb-photos');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Feed The Bear tabs, then clear this device data in browser settings.'));
  });
}

async function fbDeleteAccount () {
  const user = _auth?.currentUser;
  if (!user) return;
  const generation = _authGeneration;
  let accountDeleted = false;
  const btn = document.getElementById('delete-account-go');
  const eraseLocal = document.getElementById('delete-account-local').checked;
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await _reauthForDelete(user);
    const token = await user.getIdToken(true);
    await _saveChain;
    const keptDiary = eraseLocal ? null : localStorage.getItem(STORAGE_KEY);
    if (generation !== _authGeneration || _auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Reopen Delete account to confirm the current account.');
    const resp = await fetch('/api/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.message || body.error || 'Deleting your account failed. Please try again.');
    accountDeleted = true;
    if (typeof trackProductEvent === 'function') trackProductEvent('account_deleted');
    if (generation !== _authGeneration || _auth.currentUser?.uid !== user.uid) {
      if (eraseLocal) await photoDbOp('readwrite', store => store.delete(user.uid), 'accounts');
      showToast('Account deleted', 'The deleted account is gone. Your current account was left unchanged.', 'info');
      return;
    }
    await _auth.signOut();
    if (window._ftbUid) _sessionTask = handleFirebaseUser(null);
    await _sessionTask;
    if (_auth.currentUser) {
      showToast('Account deleted', 'Your current account was left unchanged.', 'info');
      return;
    }
    window._ftbUid = null;
    window._ftbPlan = 'free';
    localStorage.removeItem('ftb_plan_v1');
    localStorage.removeItem('ftb_uid_v1');
    localStorage.removeItem(LAST_ACCOUNT_KEY);
    if (eraseLocal) await eraseLocalData();
    else {
      const removed = await photoDbOp('readwrite', store => store.delete(user.uid), 'accounts');
      if (!removed) throw new Error('Device storage is unavailable. Reload before using your kept diary.');
      localStorage.setItem(STORAGE_KEY, keptDiary || '[]');
      localStorage.setItem('ftb_data_owner_v1', '');
      window._ftbDataOwner = '';
      loadData();
      renderAll();
    }
    closeDeleteAccount();
    showToast('Account deleted', eraseLocal ? 'Your account and this device are wiped clean.' : 'Your spots were kept as a signed-out diary. Your profile, friends and chats were removed.', 'success');
    setTimeout(() => window.location.replace('app.html'), 1800);
  } catch (err) {
    console.error('[FTB] Account deletion or device cleanup failed:', err);
    const msg = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' ? 'That password is not right.'
      : err.code === 'auth/popup-closed-by-user' ? 'Confirm with Google to delete your account.'
      : err.message;
    showToast(accountDeleted ? 'Account deleted; device cleanup needs attention' : 'Account not deleted', msg, 'error');
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
    throw err;
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
  const trim = o => {
    o.trimmedPhotoRef = o.photo.startsWith('idb:') ? o.photo : photoRefFor(o.photo);
    o.photo = '';
  };
  if (hasLocalRefs) {
    const clear = o => {
      if (typeof o?.photo === 'string' && o.photo.startsWith('idb:')) trim(o);
      (Array.isArray(o?.media) ? o.media : []).forEach(m => { if (typeof m?.photo === 'string' && m.photo.startsWith('idb:')) trim(m); });
    };
    clear(copy);
    (copy.visits || []).forEach(clear);
    (copy.dishes || []).forEach(clear);
  }
  const slots = [];
  const add = (obj, key, extra = false) => { if (typeof obj?.[key] === 'string' && obj[key].startsWith('data:')) slots.push({ obj, key, extra, size: obj[key].length }); };
  const addAll = o => { (Array.isArray(o?.media) ? o.media : []).forEach(m => add(m, 'photo', true)); add(o, 'photo'); };
  addAll(copy);
  (copy.visits || []).forEach(addAll);
  (copy.dishes || []).forEach(addAll);
  // Extra photos are trimmed first so the main photo on a dish or visit survives longest.
  slots.sort((a, b) => b.extra - a.extra || b.size - a.size);
  for (const s of slots) {
    if (JSON.stringify(copy).length <= FB_DOC_BUDGET) break;
    trim(s.obj);
  }
  return copy;
}

// When a newer cloud copy wins a merge, put back photos that
// cloudSafeRestaurant trimmed but this device still has.
function restoreTrimmedPhotos (cloud, local) {
  let ambiguous = false;
  const restore = (target, source) => {
    const originals = [source, ...(Array.isArray(source.media) ? source.media : [])].filter(m => m?.photo);
    const fillPhoto = (item, main = false) => {
      if (!item || item.photo || !Object.hasOwn(item, 'photo')) return;
      const original = item.trimmedPhotoRef
        ? originals.find(m => m.video === item.video
          && (m.photo.startsWith('idb:') ? m.photo : photoRefFor(m.photo)) === item.trimmedPhotoRef)
        : item.video ? originals.find(m => m.video === item.video)
          : main && !source.video ? source : null;
      if (original?.photo) {
        item.photo = original.photo;
        delete item.trimmedPhotoRef;
      } else if (!item.trimmedPhotoRef && !item.video && originals.length) {
        ambiguous = true;
      }
    };
    fillPhoto(target, true);
    (Array.isArray(target.media) ? target.media : []).forEach(item => fillPhoto(item));
  };
  restore(cloud, local);
  const fill = (cloudList, localList, keyOf) => {
    if (!Array.isArray(cloudList) || !Array.isArray(localList)) return;
    const byKey = new Map(localList.map(x => [keyOf(x), x]));
    cloudList.forEach(x => {
      const l = byKey.get(keyOf(x));
      if (!l) return;
      restore(x, l);
    });
  };
  fill(cloud.visits, local.visits, v => `${v.date}|${v.dish || ''}|${v.note || ''}`);
  fill(cloud.dishes, local.dishes, d => d.id);
  if (ambiguous) {
    console.warn('[FTB] Older cloud photo slots lack identity; skipped unsafe positional restore.');
    showToast('Some older photos need checking', 'An older backup could not identify every photo safely. Check this place on the device where you added its photos.', 'info');
  }
}

// The server dropping over-limit saves gets an upsell, not just a console
// line — but only once per over-limit episode, not on every background sync
// while the list stays over the limit.
let _limitUpsellShown = false;
function _showLimitUpsell (limit) {
  if (_limitUpsellShown) return;
  _limitUpsellShown = true;
  const n = Number(limit) || 25;
  showToast('Cub limit reached', `Cub includes up to ${n} spots. Upgrade to Grizzly for unlimited saves.`, 'info');
  if (typeof showGrizzlyUpsell === 'function') showGrizzlyUpsell('limit');
  else if (typeof openUpgradeModal === 'function') openUpgradeModal({ key: 'limit', title: 'Save every spot you love', body: `Cub holds ${n} spots (backed up and synced on every device). Grizzly is unlimited.` });
}

async function fbSaveRestaurants (uid, restaurants) {
  const generation = _authGeneration;
  if (!uid || uid !== window._ftbUid || window._ftbAccountSwitching || window._ftbSyncBlocked || !restaurants?.length) return;
  // Wait until stored photos are back in memory so the cloud gets photos, not references.
  if (typeof photosReadyForSync === 'function' && !photosReadyForSync()) {
    setTimeout(() => { if (generation === _authGeneration && uid === window._ftbUid) fbSaveRestaurants(uid, state.restaurants); }, 2000);
    return;
  }
  // Spots go through the server (api/save-spots.js), which enforces the
  // free 25-spot limit. Direct client writes to the restaurant collection
  // are blocked by firestore.rules, so the limit can't be bypassed.
  const user = _auth?.currentUser;
  if (!user) return;
  // Unverified accounts keep spots on this device only — cloud sync waits
  // until the inbox is confirmed (api/save-spots.js refuses them too).
  // Local saves still work, and the next sync after verification pushes them.
  if (_needsEmailVerification(user)) return;
  let token;
  try { token = await user.getIdToken(); } catch { return; }
  let totalSkipped = 0;
  let lastLimit = null;
  try {
    // Send in chunks of 50 so no request body gets huge (spots carry photos).
    for (let i = 0; i < restaurants.length; i += 50) {
      if (generation !== _authGeneration || uid !== window._ftbUid || window._ftbAccountSwitching) return;
      const chunk = restaurants.slice(i, i + 50).map(r => cloudSafeRestaurant(r));
      const resp = await fetch('/api/save-spots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ spots: chunk }),
      });
      if (!resp.ok) throw new Error(`save-spots ${resp.status}`);
      const data = await resp.json().catch(() => ({}));
      if (data.skipped > 0) {
        totalSkipped += data.skipped;
        if (data.limit) lastLimit = data.limit;
        console.warn('[FTB] Some spots were not saved (free limit):', data.skipped);
      }
    }
    // Over-limit saves the client check missed get an upsell, not silence.
    if (totalSkipped > 0) _showLimitUpsell(lastLimit);
    else _limitUpsellShown = false;
    if (generation === _authGeneration && uid === window._ftbUid && window._ftbBackupStatus !== 'error') setBackupStatus('synced');
  } catch (err) {
    console.warn('[FTB] Firestore save failed:', err);
    if (generation === _authGeneration && uid === window._ftbUid) setBackupStatus('error', 'Your spots are saved on this device, but cloud backup failed. Check your connection and retry.');
  }
}

async function fbSaveProfileCloud (uid, profile) {
  const generation = _authGeneration;
  if (!uid || uid !== window._ftbUid || window._ftbAccountSwitching || window._ftbSyncBlocked || !profile) return;
  // Billing fields are server-owned (see firestore.rules) — never send them
  // from the client or the whole write gets rejected. Friends sync on their
  // own (fbSaveFriendsCloud), so a stale copy here can't overwrite them.
  const { plan, stripeCustomerId, stripeSessionId, upgradedAt, friends, friendsAt, profileShareId, ...safe } = profile;
  // The public cave page reads the points total from this doc when the
  // live profile's copy is stale, so keep it here too — but only when
  // the total is really above zero: a failed count must never wipe a
  // stored total.
  try {
    if (typeof cavePoints === 'function') {
      const total = Math.max(0, Math.floor(Number(cavePoints().total) || 0));
      if (total > 0) safe.pts = total;
    }
  } catch { /* points stay as they were */ }
  try { await _db.doc(`users/${uid}/meta/profile`).set(safe, { merge: true }); }
  catch (err) {
    console.warn('[FTB] Profile backup failed:', err);
    if (generation === _authGeneration && uid === window._ftbUid) setBackupStatus('error', 'Your profile is saved on this device, but its cloud backup failed. Retry when connected.');
  }
}

// ─── FRIENDS YOU FOLLOW ───────────────────────────────────────
// Kept on meta/profile so they follow you to every device. Whichever side
// changed the list last wins, so an unfollow on one phone sticks everywhere.
let _friendsSyncTimer = null;
function fbSaveFriendsCloud () {
  const uid = window._ftbUid;
  if (!uid || !_db || typeof getFriends !== 'function') return;
  clearTimeout(_friendsSyncTimer);
  const generation = _authGeneration;
  _friendsSyncTimer = setTimeout(() => {
    if (generation !== _authGeneration || uid !== window._ftbUid || window._ftbSyncBlocked) return;
    const friends = getFriends().map(({ recent, liveAt, ...f }) => f);
    _db.doc(`users/${uid}/meta/profile`).set({
      friends, friendsAt: friendsUpdatedAt() || Date.now(),
      ...(state.settings.profileShareId ? { profileShareId: state.settings.profileShareId } : {}),
    }, { merge: true }).catch(err => console.warn('[FTB] friends sync failed:', err.code || err));
    FriendPings.syncFollows();
  }, 1500);
}
window.fbSaveFriendsCloud = fbSaveFriendsCloud;

function _mergeFriendsFromCloud (cloud) {
  if (typeof getFriends !== 'function') return;
  // One share id per person, so a friend's follow works from any of your devices.
  if (cloud?.profileShareId && (!state.settings.profileShareId || !state.settings.shareLive)) {
    state.settings.profileShareId = String(cloud.profileShareId).slice(0, 40);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
  }
  const cloudAt = Number(cloud?.friendsAt) || 0;
  let localAt = friendsUpdatedAt();
  // The list on this phone only counts if it's this account's. One left from
  // another account, or an empty one, never replaces what the account has.
  let localOwner = '';
  try { localOwner = localStorage.getItem('ftb_friends_uid_v1') || ''; } catch { /* private mode */ }
  const cloudHas = Array.isArray(cloud?.friends) && cloud.friends.length > 0;
  if ((localOwner && localOwner !== window._ftbUid) || (!getFriends().length && cloudHas)) localAt = 0;
  try { localStorage.setItem('ftb_friends_uid_v1', window._ftbUid || ''); } catch { /* private mode */ }
  if (localOwner && localOwner !== window._ftbUid && !cloudHas) {
    // Signed in to a different account with no friends yet: start it clean.
    try { localStorage.setItem(FRIENDS_KEY, '[]'); localStorage.setItem(FRIENDS_AT_KEY, '0'); } catch { /* storage full */ }
  }
  if (Array.isArray(cloud?.friends) && (cloudAt > localAt || (localAt === 0 && cloudHas))) {
    const list = cloud.friends.slice(0, 50).filter(f => f && f.key && f.data).map(f => {
      const data = sanitizeFriendData(f.data);
      return { key: String(f.key).slice(0, 80), name: String(f.name || data.u || 'Friend').slice(0, 30), data, savedAt: Number(f.savedAt) || 0 };
    });
    try {
      localStorage.setItem(FRIENDS_KEY, JSON.stringify(list));
      localStorage.setItem(FRIENDS_AT_KEY, String(cloudAt));
    } catch { /* storage full */ }
    if (typeof refreshFriendsLive === 'function') refreshFriendsLive(true);
    if (typeof renderAll === 'function') renderAll();
  } else if (localAt > cloudAt || (!cloud?.profileShareId && state.settings.profileShareId)) {
    fbSaveFriendsCloud();
  }
}

// Delete restaurant docs from Firestore so deletions propagate across devices
async function fbDeleteRestaurantsCloud (uid, ids) {
  if (!uid || uid !== window._ftbUid || window._ftbSyncBlocked || !Array.isArray(ids) || !ids.length) return;
  const generation = _authGeneration;
  // Deletions go through the server too (api/save-spots.js), since direct
  // client writes to the restaurant collection are blocked by firestore.rules.
  const user = _auth?.currentUser;
  if (!user) return;
  // Unverified accounts keep deletions on this device only — the tombstones
  // in localStorage are retried after verification.
  if (_needsEmailVerification(user)) return;
  let token;
  try { token = await user.getIdToken(); } catch { return; }
  try {
    for (let i = 0; i < ids.length; i += 400) {
      if (generation !== _authGeneration || uid !== window._ftbUid) return;
      const resp = await fetch('/api/save-spots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ removeIds: ids.slice(i, i + 400) }),
      });
      if (!resp.ok) throw new Error(`save-spots ${resp.status}`);
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
  if (!uid || window._ftbAccountSwitching || window._ftbSyncBlocked) return;
  clearTimeout(_syncTimer);
  const generation = _authGeneration;
  _syncTimer = setTimeout(() => {
    if (generation !== _authGeneration || uid !== window._ftbUid) return;
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
  const generation = _authGeneration;
  const uid = window._ftbUid;
  if (!uid || window._ftbAccountSwitching || window._ftbSyncBlocked || !_db || typeof buildLiveProfile !== 'function') return;
  const doc = buildLiveProfile();
  if (!doc) return;
  const json = JSON.stringify(doc);
  if (json === _lastPublishedProfile) return;
  try {
    await _db.doc(`profiles/${doc.id}`).set({ ...doc, uid, updatedAt: Date.now() });
    if (generation === _authGeneration && uid === window._ftbUid) { _lastPublishedProfile = json; FriendPings.notify(doc.id); }
  } catch (err) {
    // The phone's share id belongs to another account (signed in with a
    // different one on this phone). Friends could never see this account or
    // its follows, so it gets its own id.
    // Checked in the background so a follow never waits on it.
    if (err.code === 'permission-denied' && !_profileIdReplaced) _replaceForeignProfileId(doc.id, uid);
    console.warn('[FTB] profile publish failed:', err.code || err);
  }
}
let _profileIdReplaced = false;
async function _replaceForeignProfileId (id, uid) {
  _profileIdReplaced = true;
  const owner = await _db.doc(`profiles/${id}`).get().then(s => s.data()?.uid).catch(() => null);
  if (!owner || owner === uid || window._ftbUid !== uid) return;
  state.settings.profileShareId = '';
  if (typeof getProfileShareId === 'function') getProfileShareId();
  try { localStorage.removeItem('ftb_follow_noted_v1'); } catch { /* storage blocked */ }
  _lastPublishedProfile = '';
  await fbPublishFriendProfile();
  window.noteExistingFollows?.();
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
// ─── SIGNED LOOKUPS (api/_guard.js) ──────────────────────────
// Place, photo and link lookups cost money, so the server only answers
// signed-in members. Right after launch sign-in may still be restoring:
// wait a few seconds for it rather than send an anonymous request.
async function ftbApiHeaders () {
  for (let i = 0; i < 40 && !window._ftbAuthReady; i++) await new Promise(r => setTimeout(r, 100));
  const user = _auth?.currentUser;
  if (!user) return {};
  const generation = _authGeneration;
  try {
    const token = await user.getIdToken();
    if (generation !== _authGeneration || _auth.currentUser?.uid !== user.uid) throw new Error('The account changed while preparing this request.');
    return { 'X-FTB-Token': token };
  } catch (err) {
    console.warn('[FTB] Could not verify the current sign-in:', err);
    if (generation === _authGeneration) setBackupStatus('error', 'Could not verify your sign-in. Check your connection, retry, or sign in again.');
    throw err;
  }
}
window.ftbApiHeaders = ftbApiHeaders;

// ─── FRIEND NOTIFICATIONS (Android app, api/push.js) ──────────
// In the Android app, a phone that allowed notifications registers with the
// server along with who you follow; when a friend logs a visit, a dish or a
// new spot, the server pings their followers. The website does none of this.
var FriendPings = (() => {
  const plugin = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.PushNotifications : null);
  const ASKED_KEY = 'ftb_push_asked';
  let listening = false;
  let lastFollows = '';

  async function call (action, data = {}) {
    const user = _auth?.currentUser;
    if (!user) return null;
    try {
      const resp = await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ action, ...data }),
      });
      return resp.ok ? resp.json() : null;
    } catch { return null; }
  }

  function listen (p) {
    if (listening) return;
    listening = true;
    // iPhones hand over Apple's own token (api/_push.js sends those to Apple).
    const tokenFor = value => (window.Capacitor?.getPlatform?.() === 'ios' ? `apns:${value}` : value);
    p.addListener('registration', ({ value }) => { call('register', { token: tokenFor(value) }); syncFollows(true); });
    p.addListener('registrationError', err => console.warn('[FTB] push registration failed:', err?.error || err));
    // Tapping one opens what it's about: contests in Play, your Want to Try
    // list (api/nudges.js), or Friends.
    p.addListener('pushNotificationActionPerformed', a => {
      const open = a?.notification?.data?.open;
      setTimeout(() => {
        if (open === 'owner') (window.openOwnerPortal || (() => { location.href = '/owner.html'; }))();
        else if (open === 'add') (window.Cub?.openAdd || window.openAddModal)?.();
        else if (open === 'contests') window.openFoodEvents?.();
        else if (open === 'want') window.setView?.('want-to-try');
        else if (open === 'foodfight') window.checkFoodFight?.({ force: true });
        else window.openFoodieFriends?.();
      }, 400);
    });
    // While the app is open Android doesn't show it, so say it in the app.
    p.addListener('pushNotificationReceived', n => {
      if (n?.data?.open === 'foodfight') { window.checkFoodFight?.({ force: true }); return; }
      if (typeof showToast === 'function') showToast(n.title || 'Feed The Bear', n.body || '', 'info');
      if (typeof refreshFriendsLive === 'function') refreshFriendsLive(true);
    });
  }

  // Signed in on the phone: register quietly if notifications are already
  // allowed. Already following friends (a reinstall, a new phone)? Ask once now,
  // since there may never be a new follow to ask after.
  async function start () {
    const p = plugin();
    if (!p || !_auth?.currentUser) return;
    const generation = _authGeneration;
    listen(p);
    try {
      const permission = await p.checkPermissions();
      if (generation !== _authGeneration || !_auth?.currentUser) return;
      if (permission.receive === 'granted') await p.register();
      // Wait for the friends list to sync down from the account first.
      else setTimeout(() => { if (getFriends().length && localStorage.getItem(ASKED_KEY) !== '1') offer(); }, 6000);
    } catch (err) { console.warn('[FTB] push start failed:', err); }
  }

  // After following someone: ask once, then register.
  async function offer () {
    const p = plugin();
    if (!p || !_auth?.currentUser) return;
    listen(p);
    try {
      let perm = (await p.checkPermissions()).receive;
      if (perm !== 'granted' && localStorage.getItem(ASKED_KEY) !== '1') {
        localStorage.setItem(ASKED_KEY, '1');
        perm = (await p.requestPermissions()).receive;
      }
      if (perm === 'granted') await p.register();
      else syncFollows();
    } catch (err) { console.warn('[FTB] push offer failed:', err); }
  }

  // Who you follow, so their posts can reach this phone.
  function syncFollows (force = false) {
    if (!plugin() || typeof getFriends !== 'function') return;
    const ids = getFriends().map(f => f.data?.id).filter(Boolean);
    const sig = ids.join(',');
    if (!force && sig === lastFollows) return;
    lastFollows = sig;
    call('follows', { ids });
  }

  // You just posted: the server decides if it's news and pings followers (from any device).
  function notify (id) { if (id) call('notify', { id }); }

  async function stop () {
    lastFollows = '';
    const p = plugin();
    if (!p) return;
    try { await p.unregister(); }
    catch (err) { console.warn('[FTB] Could not stop account notifications:', err); }
  }

  // Roughly where you are and your Want to Try pins, for the daily nudges.
  async function area (data) {
    if (!plugin()) return false;
    await start();
    return !!(await call('area', data))?.ok;
  }

  return { start, offer, syncFollows, notify, stop, area };
})();
window.FriendPings = FriendPings;

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
  window.addEventListener('online', () => {
    if (_auth?.currentUser && window._ftbBackupStatus === 'error') _sessionTask = handleFirebaseUser(_auth.currentUser);
  });
  _capturePaidSession();
  _captureInviteRef();
  _finishNativeSignIn();
  _auth.onAuthStateChanged(user => {
    _sessionTask = handleFirebaseUser(user);
  }, err => {
    console.error('[FTB] Auth observer failed:', err);
    setBackupStatus('error', 'Could not restore your sign-in. Reload or sign in again.');
  });
}

async function handleFirebaseUser (user) {
  const generation = ++_authGeneration;
  const isCurrent = () => generation === _authGeneration;
  const wasSignedIn = !!window._ftbUid;
  const captured = captureAccountData();
  window._ftbUid = null;
  window._ftbPlan = 'free';
  window._ftbUserEmail = null;
  window._ftbTrialEnd = null;
  window._ftbCancelAtEnd = false;
  window._ftbSyncBlocked = true;
  clearTimeout(_syncTimer);
  clearTimeout(_friendsSyncTimer);
  _lastPublishedProfile = '';
  _profileIdReplaced = false;
  _restoreTried = '';
  window._ftbAuthReady = true;
  if (typeof refreshSharedRealtimeSubscriptions === 'function') refreshSharedRealtimeSubscriptions();
  const hasOwnedData = !!captured.snapshotOwner;
  try {
    if (user || hasOwnedData) {
      clearAccountUI(captured.appearance);
      setBackupStatus('loading', user ? 'Restoring your diary...' : 'Securing your diary...');
      _accountSwitchChain = _accountSwitchChain.catch(err => console.warn('[FTB] Previous account transition failed:', err))
        .then(() => { if (isCurrent()) return switchAccountData(user?.uid || '', isCurrent, captured, user?.email || ''); });
      await _accountSwitchChain;
      if (!isCurrent()) return;
    }
    window._ftbAuthReady = true;
    if (user) {
      window._ftbUid       = user.uid;
      window._ftbUserEmail = user.email;
      // Next time this phone is signed out, the sheet opens on Sign in with the email filled.
      try { localStorage.setItem(LAST_ACCOUNT_KEY, user.email || '1'); } catch { /* private mode */ }
      // A new email account that hasn't confirmed its inbox can still use
      // the diary — verification happens in the background. The verify
      // screen appears as a reminder on each sign-in until they confirm,
      // and the "joined" email to the owner waits until then too.
      if (_needsEmailVerification(user)) {
        window._ftbNeedsVerification = true;
        // The reminder shows once per sign-in; dismissing it ("Continue to
        // my diary") keeps it away until the next sign-in.
        if (!window._ftbVerifyDismissed) _showVerifyEmail(user);
      } else {
        window._ftbNeedsVerification = false;
        window._ftbVerifyDismissed = false;
      }
      // A brand-new account (signed in for the first time just now), counted once for the funnel.
      try {
        const m = user.metadata || {};
        const fresh = Math.abs(Date.parse(m.creationTime) - Date.parse(m.lastSignInTime)) < 120000;
        if (fresh && localStorage.getItem('ftb_counted_signup') !== user.uid) {
          localStorage.setItem('ftb_counted_signup', user.uid);
          if (typeof trackProductEvent === 'function') trackProductEvent('account_created');
          // Tells the owner (push and/or email, api/push.js 'joined') — only
          // once the inbox is confirmed. _checkVerification sends it for
          // members who verify after signing up.
          if (!_needsEmailVerification(user)) _sendJoinedEmail(user);
        }
      } catch { /* analytics only */ }

      // Load plan from Firestore
      try {
        const snap = await _db.doc(`users/${user.uid}/meta/profile`).get();
        if (!isCurrent()) return;
        const data = snap.exists ? snap.data() : {};
        window._ftbPlan = data.plan || 'free';
        // Trial end and cancellation, for the reminder near the end (app.js renderTrialReminder).
        window._ftbTrialEnd = data.trialEndsAt || null;
        window._ftbCancelAtEnd = !!data.cancelAtPeriodEnd;
        localStorage.setItem('ftb_plan_v1', window._ftbPlan);
        localStorage.setItem('ftb_uid_v1',  user.uid);
      } catch (err) {
        if (!isCurrent()) return;
        console.warn('[FTB] Plan load failed:', err);
        // Offline (or a blip): keep the plan this phone last saw, so Grizzly
        // doesn't turn into Cub in a basement with no signal.
        window._ftbPlan = localStorage.getItem('ftb_uid_v1') === user.uid ? (localStorage.getItem('ftb_plan_v1') || 'free') : 'free';
      }
      if (typeof renderGrizzlyUi === 'function') renderGrizzlyUi();
      FriendPings.start();
      // Paid, but this account doesn't show it (e.g. the account was re-created):
      // the server finds the subscription by your email and moves it here.
      if (window._ftbPlan !== 'grizzly') _restoreGrizzly(user);

      // They tapped Upgrade before signing in: bring them straight back.
      let pendingUpgrade = null;
      try { pendingUpgrade = sessionStorage.getItem('ftb_pending_upgrade'); sessionStorage.removeItem('ftb_pending_upgrade'); } catch { /* private mode */ }
      if (pendingUpgrade && window._ftbPlan !== 'grizzly') {
        setTimeout(() => { if (isCurrent()) openUpgradeModal({ key: 'resume', period: pendingUpgrade, title: "You're in! One tap to Grizzly",
          body: 'Unlimited spots, Byte Cub AI picks, Year in Review, and 15-second food videos.' }); }, 700);
      }

      // Restore restaurants on sign-in for ALL users (never lock anyone out
      // of data they previously synced). Background backup is included for all accounts.
      // Merge by id (newest updatedAt wins) instead of the old "whichever
      // side has more wins", which resurrected deleted spots and let a
      // stale device overwrite newer edits.
      const { restaurants, cloudProfile } = await fbLoadUserData(user.uid);
      if (!isCurrent()) return;
      window._ftbSyncBlocked = false;
      // Unverified: nothing has synced yet (cloud sync waits for
      // verification), so don't claim it has.
      if (_needsEmailVerification(user)) setBackupStatus('idle');
      else setBackupStatus('synced');
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
        saveData();
        renderAll();
        if (deletedIds.size) fbDeleteRestaurantsCloud(user.uid, [...deletedIds]);
        // A brand-new account always gets the cub's welcome, even if something
        // (a trial, an invite reward) already wrote its profile.
        const bornAt = Date.parse(user.metadata?.creationTime || '') || 0;
        const brandNew = bornAt && Date.now() - bornAt < 30 * 60 * 1000 && !restaurants.length;
        if (typeof onboardingAfterSignIn === 'function') onboardingAfterSignIn(!brandNew && (restaurants.length > 0 || !!cloudProfile));
        if (gained > 0) {
          showToast('☁️ Den synced!', `Loaded ${gained} spot${gained === 1 ? '' : 's'} from the cloud.`, 'success');
        }
      }

      _mergeFriendsFromCloud(cloudProfile);
      // Let the people you follow see you under "Following you" (once each).
      setTimeout(() => { if (!isCurrent()) return; window.loadFollowing?.(); window.loadFollowers?.(); window.noteExistingFollows?.(); window.noteInviteJoined?.(); window.myShareLink?.(); window.checkFoodFight?.({ force: true }); }, 5000);
      // Opened an invite before signing in: follow them and show their spots now.
      setTimeout(() => { if (isCurrent()) window.resumePendingInvite?.(); }, 600);

      // Merge profile (cloud wins for plan fields)
      if (cloudProfile) {
        const localProf = loadUserProfile() || {};
        const { friends, friendsAt, profileShareId, ...cloudRest } = cloudProfile;
        const localNewer = Number(localProf.updatedAt || 0) > Number(cloudProfile.updatedAt || 0);
        const mergedProfile = localNewer ? { ...cloudRest, ...localProf, plan: cloudProfile.plan } : { ...localProf, ...cloudRest };
        // Default/partial legacy cloud profiles are not an explicit photo removal.
        const localVisualAt = Number(localProf.visualUpdatedAt ?? localProf.updatedAt ?? 0);
        const cloudVisualAt = Number(cloudRest.visualUpdatedAt ?? cloudRest.updatedAt ?? 0);
        const localHasVisual = !!localProf.photo || (localProf.avatar && localProf.avatar !== DEFAULT_AVATAR);
        const cloudHasVisual = !!cloudRest.photo || (cloudRest.avatar && cloudRest.avatar !== DEFAULT_AVATAR);
        let visual = cloudRest;
        if (localProf.photo && !cloudRest.photo && !cloudRest.visualUpdatedAt) visual = localProf;
        else if (cloudRest.photo && !localProf.photo && !localProf.visualUpdatedAt) visual = cloudRest;
        else if ((localHasVisual || localProf.visualUpdatedAt) && localVisualAt > cloudVisualAt) visual = localProf;
        else if (!cloudHasVisual && !cloudRest.visualUpdatedAt) visual = localProf;
        const keepLocalVisual = visual === localProf;
        for (const key of ['photo', 'avatar', 'visualUpdatedAt']) {
          if (key in visual) mergedProfile[key] = visual[key];
        }
        saveUserProfile(mergedProfile, { fromCloud: true });
        if (localNewer || keepLocalVisual) fbSaveProfileCloud(user.uid, mergedProfile);
        updateProfileVisuals(mergedProfile);

        const appearance = mergedProfile.appearance || null;
        if (appearance && typeof applyThemeChoice === 'function') {
          if (appearance.themeChoice) state.settings.themeChoice = appearance.themeChoice;
          if (appearance.themeMode) state.settings.theme = appearance.themeMode;
          if (appearance.uiDensity) state.settings.uiDensity = appearance.uiDensity;
          if (appearance.uiCorners) state.settings.uiCorners = appearance.uiCorners;
          if (appearance.uiMotion) state.settings.uiMotion = appearance.uiMotion;

          const settingsKey = (typeof SETTINGS_KEY !== 'undefined') ? SETTINGS_KEY : 'ftb_settings_v1';
          localStorage.setItem(settingsKey, JSON.stringify(state.settings));
          applyThemeChoice(appearance.themeManual === false && appearance.themeChoice !== 'auto' ? 'dark' : state.settings.themeChoice || (state.settings.theme === 'light' ? 'light' : 'dark'), { persist: false });
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
        if (!isCurrent()) return;
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
      window._ftbPlan = 'free';
      window._ftbNeedsVerification = false;
      localStorage.removeItem('ftb_plan_v1');
      localStorage.removeItem('ftb_uid_v1');
      setBackupStatus('idle');
      await FriendPings.stop();
      if (!isCurrent()) return;
      updateAuthUI(null);
      if (wasSignedIn && !_signingOut) showToast('Please sign in again', 'Your session ended. Your diary is kept for this account and is hidden until you sign back in.', 'info');
      // Sign-in settled with no account: a guest whose avatar picker opened
      // before auth resolved goes to the diary (don't open the picker here —
      // the sign-in sheet is the new-guest flow).
      if (typeof recheckProfileSetup === 'function') recheckProfileSetup(false);
      if (typeof refreshSharedRealtimeSubscriptions === 'function') refreshSharedRealtimeSubscriptions();
      // Back from Stripe but signed out here (e.g. it opened in a browser, not the app)
      if (_getPendingSession()) {
        showToast('Payment received!', 'Sign in to the account you upgraded to finish turning on Grizzly.', 'success');
        setTimeout(() => { if (isCurrent()) openAuthModal({ forUpgrade: true }); }, 400);
      } else if (_signInRequired()) {
        openAuthModal();
      } else if (_tryingFirst() && _gateOn()) {
        // A new phone (or a reinstall): sign in, or try it first.
        let seen = false;
        try { seen = !!sessionStorage.getItem('ftb_try_seen'); } catch { /* private mode */ }
        if (!seen) openAuthModal({ tryFirst: true });
        else if (typeof onboardingAfterSignIn === 'function') onboardingAfterSignIn(false);
      }
    }
  } catch (err) {
    if (!isCurrent()) return;
    console.error('[FTB] Account restore failed:', err);
    updateAuthUI(user);
    setBackupStatus('error', window._ftbAccountSwitching ? err.message : 'Your local diary is available, but cloud backup could not be restored. Check your connection and retry.');
    showToast('Backup needs attention', 'Your saved data has not been deleted. Use Retry backup when connected.', 'error');
  }
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
  const generation = _authGeneration;
  try {
    const resp = await fetch(`/api/verify-session?sessionId=${encodeURIComponent(sessionId)}&uid=${encodeURIComponent(uid)}`);
    const data = await resp.json().catch(() => ({}));
    if (generation !== _authGeneration || window._ftbUid !== uid) return 'retry';
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
    if (resp.status === 404 || (resp.status === 402 && ['unpaid', 'ended'].includes(data.payment_status))) return 'unpaid';
    return 'retry';
  } catch (err) {
    console.warn('[FTB] Plan verification failed:', err);
    return 'retry';
  }
}

// ─── AUTH MODAL ───────────────────────────────────────────────
// forUpgrade: opened from the Grizzly upgrade, so it talks about upgrading, not "free".
const AUTH_SUB_DEFAULT = "It's free. Back up your spots, ratings and notes. Photos sync within backup limits; large photo collections and video clips may remain only on this device.";
const AUTH_SUB_UPGRADE = 'Sign in or create your account, and you will go straight to Grizzly checkout.';

// The app needs an account. Signed out, the sign-in sheet stays up and can't
// be closed; spots already on this device move into the account on sign-in.
// The local test server (tests/) skips it unless a test sets ftb_test_auth_gate.
function _signInRequired () {
  if (_auth?.currentUser) return false;
  return _gateOn() && !_tryingFirst();
}
// Accounts are required on the site; the local test server skips it unless a test sets ftb_test_auth_gate.
function _gateOn () {
  if (location.hostname !== '127.0.0.1') return true;
  try { return !!localStorage.getItem('ftb_test_auth_gate'); } catch { return false; }
}

// New visitors try it first: up to TRY_SPOTS saved spots before an account is
// needed (the sheet then opens and stays). A phone that has signed in before,
// or someone arriving from an invite, signs in from the start.
const TRY_SPOTS = 3;
function _tryingFirst () {
  try {
    if (_lastAccount()) return false;
    if (localStorage.getItem('ftb_ref_v1') || (typeof window.pendingInviteName === 'function' && window.pendingInviteName())) return false;
    const q = new URLSearchParams(location.search);
    if (/profile=/.test(location.hash) || q.has('ref') || q.has('i') || q.has('accept') || /invite/.test(location.pathname)) return false;
    return (JSON.parse(localStorage.getItem('ftb_restaurants_v2') || '[]') || []).length < TRY_SPOTS;
  } catch { return false; }
}
// After each save (app.js saveData): the 3rd spot asks for the free account.
window.ftbAfterSave = function () {
  if (!window._ftbAuthReady || _auth?.currentUser) return;
  const overlay = document.getElementById('auth-overlay');
  if (!_signInRequired() || !overlay?.classList.contains('hidden')) return;
  if (typeof trackProductEvent === 'function') trackProductEvent('try_limit_signup');
  setTimeout(openAuthModal, 900);
};

function _requiredAuthSub () {
  let invited = false, hasSpots = false;
  try {
    invited = !!localStorage.getItem(REF_KEY);
    hasSpots = JSON.parse(localStorage.getItem('ftb_restaurants_v2') || '[]').length > 0;
  } catch { /* storage blocked */ }
  const by = typeof window.pendingInviteName === 'function' ? window.pendingInviteName() : '';
  if (by) {
    return `${by} invited you! Create your free account and you'll follow ${by} and see their favorite spots.`
      + (invited ? ' You also get 30 days of Grizzly free.' : '');
  }
  if (_lastAccount()) return 'Welcome back! Sign in to see your spots.';
  if (invited) return 'A friend invited you! Create your free account, then get 30 days of Grizzly free.';
  if (hasSpots) return 'Create your free account to keep going. The spots on this phone come with you.';
  return 'Create your free account to start saving the places you want to eat.';
}

function openAuthModal ({ forUpgrade = false, tryFirst = false } = {}) {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  overlay.classList.toggle('auth-try', tryFirst);
  const required = _signInRequired();
  overlay.dataset.purpose = forUpgrade ? 'upgrade' : '';
  overlay.classList.toggle('auth-required', required);
  const sub = overlay.querySelector('.auth-sub');
  if (sub) sub.textContent = forUpgrade ? AUTH_SUB_UPGRADE : required ? _requiredAuthSub() : AUTH_SUB_DEFAULT;
  overlay.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  // Someone who has signed in on this phone before is signing back in, not starting over.
  const last = _lastAccount();
  const emailInput = document.getElementById('auth-email');
  if (emailInput && !emailInput.value && last.includes('@')) emailInput.value = last;
  _setAuthMode(required && !forUpgrade && !last ? 'signup' : 'signin');
}

const LAST_ACCOUNT_KEY = 'ftb_last_account_v1';
function _lastAccount () {
  try { return localStorage.getItem(LAST_ACCOUNT_KEY) || ''; } catch { return ''; }
}

async function _handleForgotPassword () {
  const email = document.getElementById('auth-email')?.value.trim();
  if (!email) { _authError('Type your email above, then tap Forgot password again.'); return; }
  try {
    await _auth.sendPasswordResetEmail(email);
    _authError(`Sent! Check ${email} for a link to set a new password (look in spam too). Then come back and sign in.`);
  } catch (err) {
    _authError(err.code === 'auth/invalid-email' ? 'That email does not look right.' : (err.message || 'Could not send it. Try again.'));
  }
}

function closeAuthModal () {
  const overlay = document.getElementById('auth-overlay');
  // An unverified account stays on the verify screen unless they chose
  // "Continue to my diary" — then the reminder is dismissed for this
  // sign-in (it shows again next time until they verify).
  if (window._ftbNeedsVerification && !window._ftbVerifyDismissed) return;
  if (overlay?.classList.contains('auth-required') && _signInRequired()) return;
  overlay?.classList.remove('auth-required');
  overlay?.classList.add('hidden');
  maybeHideOverlay();
  // Closed without signing in (a new visitor trying it first): setup can start.
  if (!_auth?.currentUser && typeof onboardingAfterSignIn === 'function') onboardingAfterSignIn(false);
}

function _setAuthMode (mode) {
  const el = id => document.getElementById(id);
  const overlay = el('auth-overlay');
  if (!overlay) return;
  overlay.dataset.mode = mode;
  // The verify panel shows only in verify mode (the .hidden class controls it).
  const verifyPanel = el('auth-verify');
  if (verifyPanel) verifyPanel.classList.toggle('hidden', mode !== 'verify');
  // Verify mode: hide the sign-in form (style.css) and show the verify panel.
  if (mode === 'verify') {
    if (el('auth-title')) el('auth-title').textContent = 'Check your email';
    return;
  }
  const isSignup = mode === 'signup';
  const forUpgrade = overlay.dataset.purpose === 'upgrade';
  if (el('auth-title'))      el('auth-title').textContent      = forUpgrade ? (isSignup ? 'Create your account for Grizzly' : 'Sign in to get Grizzly') : isSignup ? 'Create your profile' : 'Welcome back';
  if (el('auth-submit-btn')) el('auth-submit-btn').textContent  = isSignup ? 'Create Profile'   : 'Sign In';
  if (el('auth-toggle-text')) el('auth-toggle-text').innerHTML  = isSignup
    ? 'Already have an account? <button class="auth-link-btn" id="auth-mode-toggle">Sign in</button>'
    : `New here? <button class="auth-link-btn" id="auth-mode-toggle">${forUpgrade ? 'Create an account' : 'Sign up, it\'s free'}</button>`;
  document.getElementById('auth-mode-toggle')?.addEventListener('click', () => _setAuthMode(isSignup ? 'signin' : 'signup'));
  document.querySelectorAll('#auth-overlay .auth-tab').forEach(tab => {
    const on = tab.dataset.authMode === mode;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.onclick = () => { _authError(''); _setAuthMode(tab.dataset.authMode); };
  });
  el('auth-password')?.setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
}

async function _handleAuthSubmit () {
  const overlay  = document.getElementById('auth-overlay');
  const mode     = overlay?.dataset.mode || 'signin';
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const btn      = document.getElementById('auth-submit-btn');
  _authError('');
  if (!email || !password) { _authError('Enter your email and password.'); return; }
  if (mode === 'signup' && password.length < 8) { _authError('Your password needs at least 8 characters.'); return; }

  btn.disabled    = true;
  btn.textContent = 'Signing you in...';
  let nextMode = mode;
  let justSignedUp = false;
  try {
    if (mode === 'signup') {
      try {
        await fbSignUpEmail(email, password);
        justSignedUp = true;
      } catch (err) {
        // Already has an account: sign them in with what they typed instead of an error.
        if (err.code !== 'auth/email-already-in-use') throw err;
        nextMode = 'signin';
        await fbSignInEmail(email, password);
      }
    } else {
      await fbSignInEmail(email, password);
    }
    // A brand-new email account confirms its inbox first; the sheet switches
    // to the verify screen instead of "You are in".
    if (justSignedUp && _needsEmailVerification(_auth.currentUser)) {
      _showVerifyEmail(_auth.currentUser);
    } else {
      closeAuthModal();
      showToast(
        'You are in',
        'Your diary is opening. Backup status will appear if anything needs attention.',
        'success'
      );
    }
  } catch (err) {
    const BAD_LOGIN = ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found', 'auth/email-already-in-use'];
    if (BAD_LOGIN.includes(err.code)) {
      btn.textContent = 'Checking…';
      const why = await _signInHelp(email);
      if (why === 'none') {
        _authError(`There's no account for ${email}. Check the spelling, or create one.`, { label: 'Create account', run: () => { _setAuthMode('signup'); _authError(''); } });
      } else if (why === 'google') {
        nextMode = 'signin';
        _authError(`${email} signs in with Google, not a password.`, { label: 'Continue with Google', run: _handleGoogleAuth });
      } else if (why === 'password') {
        nextMode = 'signin';
        _authError(`Wrong password for ${email}. Try again, or reset it.`, { label: 'Reset my password', run: _handleForgotPassword });
      } else {
        _authError("That email and password don't match. If you signed up with Google, use Continue with Google.");
      }
    } else {
      _authError(
        err.code === 'auth/invalid-email'          ? 'That email does not look right.'
        : err.code === 'auth/weak-password'        ? 'Your password needs at least 8 characters.'
        : err.code === 'auth/too-many-requests'    ? 'Too many tries. Wait a minute, or reset your password.'
        : err.code === 'auth/network-request-failed' ? 'No connection. Check your internet and try again.'
        : (err.message || 'Something went wrong. Try again.'));
    }
  } finally {
    btn.disabled = false;
    _setAuthMode(nextMode);
  }
}

// Errors show inside the sign-in sheet (it covers everything, toasts included),
// with one button for the fix when there is one.
function _authError (text, action = null) {
  const box = document.getElementById('auth-error');
  if (!box) { if (text) showToast("Couldn't sign in", text, 'error'); return; }
  box.textContent = text;
  box.classList.toggle('hidden', !text);
  if (text && action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'auth-error-btn';
    b.textContent = action.label;
    b.addEventListener('click', () => action.run());
    box.appendChild(b);
  }
  if (text) box.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

// Sign-in help (api/signin-help.js) always answers 'unknown' now, so a
// failed sign-in gets the one generic hint below instead of revealing
// whether the email has an account or how it signs in.
async function _signInHelp (email) {
  try {
    const resp = await fetch('/api/signin-help', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    return resp.ok ? (await resp.json()).status || '' : '';
  } catch { return ''; }
}

// ─── ANDROID APP: GOOGLE SIGN-IN IN CHROME ────────────────────
// Google refuses to sign in inside an app's web view, so the Android app
// (native/) opens native-signin.html in Chrome. Only a SHA-256 challenge
// leaves the app; the verifier stays here, and the server only hands out a
// sign-in token for it (api/verify-session.js native-start / native-finish).
const NATIVE_VERIFIER_KEY = 'ftb_native_verifier_v1';
const _isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();
const _b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function _nativeGoogleSignIn () {
  await ensureAuthPersistence();
  const verifier = _b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = _b64url(new Uint8Array(digest));
  try { localStorage.setItem(NATIVE_VERIFIER_KEY, verifier); }
  catch (err) {
    console.warn('[FTB] Could not save native sign-in verifier:', err);
    throw new Error('Allow site storage for Feed The Bear, then try Google sign-in again.');
  }
  const url = `https://www.feed-the-bear.com/native-signin.html?c=${challenge}`;
  // The iPhone app signs in with Google in Safari itself.
  const safari = window.Capacitor?.Plugins?.ExternalLink;
  const browser = window.Capacitor?.Plugins?.Browser;
  if (safari) await safari.open({ url });
  else if (browser) await browser.open({ url });
  else window.open(url, '_blank', 'noopener');
}

// Back from Chrome, the app opens app.html#native-signin-done. If app.html was
// already open that only changes the #hash (no reload), so this also runs on
// hashchange, not just at startup.
let _nativeFinishing = false;
window.addEventListener('hashchange', () => _finishNativeSignIn());
async function _finishNativeSignIn () {
  if (location.hash !== '#native-signin-done' || _nativeFinishing) return;
  _nativeFinishing = true;
  try { await _finishNativeSignInNow(); } finally { _nativeFinishing = false; }
}
async function _finishNativeSignInNow () {
  history.replaceState(null, '', location.pathname + location.search);
  try { window.Capacitor?.Plugins?.Browser?.close?.(); } catch { /* already closed */ }
  let verifier = null;
  try { verifier = localStorage.getItem(NATIVE_VERIFIER_KEY); localStorage.removeItem(NATIVE_VERIFIER_KEY); } catch { /* private mode */ }
  if (!verifier) { showToast('Sign-in did not finish', 'Please tap Continue with Google again.', 'error'); return; }
  try {
    const resp = await fetch('/api/verify-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'native-finish', verifier }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.token) throw new Error(data.error || 'Please try again.');
    await ensureAuthPersistence();
    await _auth.signInWithCustomToken(data.token);
    closeAuthModal?.();
    showToast('You are in', 'Your diary is opening. Backup status will appear if anything needs attention.', 'success');
  } catch (err) {
    showToast('Sign-in did not finish', err.message || 'Please try again.', 'error');
  }
}

// ─── IPHONE APP: SIGN IN WITH APPLE ───────────────────────────
// Apple's own sheet (native/ios FTBPlugins.swift), then Firebase with its token.
// Firebase gets the raw nonce; Apple got its SHA-256, so the token can't be replayed.
async function _appleCredential () {
  const plugin = window.Capacitor?.Plugins?.AppleSignIn;
  if (!plugin) throw new Error('Sign in with Apple works in the iPhone app.');
  const raw = _b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const res = await plugin.signIn({ nonce: hash });
  const credential = new firebase.auth.OAuthProvider('apple.com').credential({ idToken: res.idToken, rawNonce: raw });
  return { credential, code: res.authorizationCode || '', name: res.name || '' };
}

async function _handleAppleAuth () {
  const btn = document.getElementById('auth-apple-btn');
  if (btn) btn.disabled = true;
  try {
    await ensureAuthPersistence();
    const { credential, name } = await _appleCredential();
    const cred = await _auth.signInWithCredential(credential);
    // Apple only shares the name the very first time.
    if (name && !cred.user.displayName) await cred.user.updateProfile({ displayName: name }).catch(() => {});
    closeAuthModal();
    showToast('You are in', 'Your diary is opening. Backup status will appear if anything needs attention.', 'success');
  } catch (err) {
    if (err?.code === 'canceled' || /cancel/i.test(err?.message || '')) return;
    const msg = err?.code === 'auth/account-exists-with-different-credential'
      ? 'That email already has a Feed The Bear account. Sign in with Google or your email and password instead.'
      : err?.code === 'auth/operation-not-allowed' ? 'Sign in with Apple is not switched on yet. Please use Google or email for now.'
      : (err?.message || 'Please try again.');
    showToast('Apple sign-in did not finish', msg, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _handleGoogleAuth () {
  const btn = document.getElementById('auth-google-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting Google...'; }
  try {
    if (_isNativeApp()) { await _nativeGoogleSignIn(); return; }
    await fbSignInGoogle();
    closeAuthModal();
    showToast('You are in', 'Your diary is opening. Backup status will appear if anything needs attention.', 'success');
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

// In the Play app, Google's alternative billing: its one-time notice, then a
// token that lets the server report the Stripe sale to Google (api/_play.js).
// '' outside the Play app (website, sideloaded app, older app versions);
// false if they backed out of Google's notice.
async function _playBillingToken () {
  const plugin = _isNativeApp() ? window.Capacitor.Plugins?.PlayBilling : null;
  if (!plugin?.checkoutToken) return '';
  try {
    const res = await plugin.checkoutToken();
    return res?.token || '';
  } catch (err) {
    if (err?.code === 'canceled' || /canceled/.test(err?.message || '')) return false;
    return '';
  }
}

// app.html?ref=<uid> from a friend's invite: remember it until they upgrade.
// A VIP discount link (app.html?promo=CODE, made in the owner portal): kept
// for checkout, and the Grizzly screen opens with the discount mentioned.
const PROMO_KEY = 'ftb_vip_promo_v1';
function _vipPromo () {
  try { return localStorage.getItem(PROMO_KEY) || ''; } catch { return ''; }
}
(function _capturePromo () {
  const params = new URLSearchParams(location.search);
  const code = String(params.get('promo') || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return;
  try { localStorage.setItem(PROMO_KEY, code); } catch { /* private mode */ }
  params.delete('promo');
  const rest = params.toString();
  history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  setTimeout(() => {
    if (typeof showToast === 'function') showToast('VIP discount ready', `Your code ${code} is applied when you upgrade to Grizzly.`, 'success');
    if (window._ftbPlan !== 'grizzly' && typeof openUpgradeModal === 'function') openUpgradeModal({ key: 'vip', title: 'Your VIP discount is ready', body: `Code ${code} comes off at checkout. Unlimited spots, Byte Cub AI picks and more.` });
  }, 2500);
})();

function _captureInviteRef () {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (!ref || !/^[A-Za-z0-9]{10,64}$/.test(ref)) return;
  try { localStorage.setItem(REF_KEY, ref); } catch { /* private mode */ }
  params.delete('ref');
  const rest = params.toString();
  // Keep the #profile= part: it's the inviter's picks for the welcome preview.
  history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  // The profile preview already says who invited them and about the free month.
  if (!window.location.hash.startsWith('#profile=')) {
    setTimeout(() => showToast?.('A friend invited you!', 'You get 30 days of Grizzly free when you upgrade.', 'success'), 1500);
  }
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
  if (el('upgrade-plan-badge')) el('upgrade-plan-badge').textContent = _trialOffer.trial ? `${_trialOffer.days} days free` : 'Everything unlocked';
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
  // Same link as Invite in Friends: your picks to follow plus the free month.
  if (typeof inviteFriend === 'function') { await inviteFriend({ ref: _auth.currentUser.uid }); return; }
  const text = 'I track every restaurant I want to try with Feed The Bear. Join with my link and get 30 days of Grizzly free:';
  if (typeof trackProductEvent === 'function') trackProductEvent('invite_shared');
  try {
    if (navigator.share) { await navigator.share({ title: 'Feed The Bear', text, url }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Invite link copied', 'Paste it to a friend. You get a free month when they subscribe to Grizzly.', 'success');
  } catch {
    prompt('Copy your invite link:', url);
  }
}

// Signed-in account actions on the server (api/verify-session.js POST).
let _restoreTried = '';
async function _restoreGrizzly (user, { quiet = false } = {}) {
  if (!user || (_restoreTried === user.uid && quiet !== 'force')) return false;
  _restoreTried = user.uid;
  const generation = _authGeneration;
  try {
    const { ok, data } = await _accountAction('restore');
    if (generation !== _authGeneration || !ok || data.plan !== 'grizzly' || window._ftbUid !== user.uid) return false;
    window._ftbPlan = 'grizzly';
    window._ftbTrialEnd = data.trialEnd || null;
    try { localStorage.setItem('ftb_plan_v1', 'grizzly'); } catch { /* private mode */ }
    if (typeof renderGrizzlyUi === 'function') renderGrizzlyUi();
    updateAuthUI(user);
    if (typeof closeUpgradeModal === 'function') closeUpgradeModal();
    if (data.vip) showToast("You're a VIP 🐻", 'Grizzly is on the house. Everything is unlocked.', 'success');
    else if (data.restored) showToast('Your Grizzly is back', `Found your subscription for ${user.email}. Everything is unlocked.`, 'success');
    return true;
  } catch { return false; }
}

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
    let { ok, status, data } = await _accountAction('portal');
    // No subscription linked here yet: look for one under this email, then try again.
    if (status === 404 && await _restoreGrizzly(_auth?.currentUser, { quiet: 'force' })) ({ ok, status, data } = await _accountAction('portal'));
    if (ok && data.url) { _openPaymentPage(data.url); return; }
    if (status !== 404) { showToast('Could not open billing', data.error || 'Please try again.', 'error'); return; }
    // Say which account this is and why there's no bill, so a paid account
    // signed in under another email is easy to spot.
    const email = window._ftbUserEmail || 'this account';
    const grizzly = window._ftbPlan === 'grizzly';
    const msg = grizzly && window._ftbRewardUntil ? `${email} has Grizzly as a free month from invites, so there's no bill to manage.`
      : grizzly && window._ftbTrialEnd ? `${email} is on a free Grizzly trial, so there's no bill yet.`
      : grizzly ? `${email} has Grizzly without a card on file, so there's no bill to manage.`
      : `${email} is on the free Cub plan, with no subscription. If you paid for Grizzly, it's on a different account: sign out, then sign in with the email your receipt went to.`;
    showToast(grizzly ? 'No bill on this account' : 'No subscription on this account', msg, 'info');
  } catch (err) {
    showToast('Could not open billing', err.message || 'Please try again.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// The iPhone app: Stripe pages open in Safari (Apple's rules for paying
// outside the app); everywhere else they open right here.
function _openPaymentPage (url) {
  const safari = window.Capacitor?.getPlatform?.() === 'ios' ? window.Capacitor.Plugins?.ExternalLink : null;
  if (!safari) { window.location.href = url; return false; }
  safari.open({ url }).catch(() => { window.location.href = url; });
  return true;
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
    const playToken = await _playBillingToken();
    if (playToken === false) { if (btn) { btn.disabled = false; btn.textContent = _upgradeLabel(); } return; }
    const resp = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ uid: user.uid, email: user.email, priceId, ref: _inviteRef(), ...(playToken ? { playToken } : {}), ...(_vipPromo() ? { promo: _vipPromo() } : {}), ...(window.FTB_IOS_APP ? { ios: true } : {}) }),
    });
    const { url, error } = await resp.json();
    if (error) throw new Error(error);
    if (_openPaymentPage(url)) {
      if (btn) { btn.disabled = false; btn.textContent = _upgradeLabel(); }
      closeUpgradeModal();
      showToast('Finish in Safari', 'Checkout opened in Safari. When you are done, tap Back to Feed The Bear.', 'info');
    }
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
  // New visitors: close the sheet and look around (the 3rd saved spot asks again).
  document.getElementById('auth-try-first')?.addEventListener('click', () => {
    try { sessionStorage.setItem('ftb_try_seen', '1'); } catch { /* private mode */ }
    if (typeof trackProductEvent === 'function') trackProductEvent('try_first');
    closeAuthModal();
    if (typeof onboardingAfterSignIn === 'function') onboardingAfterSignIn(false);
  });
  document.getElementById('auth-google-btn')?.addEventListener('click', _handleGoogleAuth);
  // Apple requires Sign in with Apple next to Google in the iPhone app.
  const appleBtn = document.getElementById('auth-apple-btn');
  if (appleBtn && window.Capacitor?.Plugins?.AppleSignIn) appleBtn.classList.remove('hidden');
  appleBtn?.addEventListener('click', _handleAppleAuth);
  document.getElementById('auth-submit-btn')?.addEventListener('click', _handleAuthSubmit);
  document.getElementById('auth-forgot-btn')?.addEventListener('click', _handleForgotPassword);
  document.getElementById('auth-verify-resend')?.addEventListener('click', _resendVerification);
  document.getElementById('auth-verify-check')?.addEventListener('click', _checkVerification);
  document.getElementById('auth-verify-later')?.addEventListener('click', _continueToDiaryUnverified);
  document.getElementById('auth-verify-signout')?.addEventListener('click', _signOutFromVerify);
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
