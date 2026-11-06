/* ════════════════════════════════════════════════════════════
   Feed The Bear - Foodie Friends: your shareable profile, following friends, their live
   activity and the friends feed.
   Moved out of app.js as-is. Loads right after app.js (classic scripts
   share one global scope, and the app starts on DOMContentLoaded, after
   every script has run), so names here and in app.js work both ways.
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ------------------------------------------------------------
   PHASE 7 • PUBLIC FOODIE PROFILE + QR CODE
   ------------------------------------------------------------ */

// The shareable profile: your top spots with what to order and what to skip,
// plus your Crave List, all inside the link (no account or server needed).
function buildProfileData () {
  const dishNames = (r, verdict, n) => dishesOf(r).filter(d => d.verdict === verdict).slice(0, n).map(d => String(d.name).slice(0, 40));
  const picks = [...state.restaurants]
    .filter(r => r.myRating > 0 || dishesOf(r).some(d => d.verdict === 'again'))
    .sort((a, b) => (b.myRating || 0) - (a.myRating || 0))
    .slice(0, 15)
    .map(r => {
      const pick = { n: r.name, c: r.cuisine || '', r: r.myRating || 0, a: (r.address || '').slice(0, 60) };
      // Data-URL photos are far too big for a link, and cutting one breaks it.
      const photo = safeUrl(r.photo || '');
      if (/^https?:/i.test(photo) && photo.length <= 300) pick.p = photo;
      const get = dishNames(r, 'again', 3);
      const skip = dishNames(r, 'skip', 2);
      if (get.length) pick.g = get;
      if (skip.length) pick.s = skip;
      return pick;
    });
  const craves = [];
  state.restaurants.forEach(r => dishesOf(r).forEach(d => {
    if (d.verdict === 'want' && craves.length < 10) craves.push({ d: String(d.name).slice(0, 40), at: String(r.name).slice(0, 60) });
  }));
  return { v: 2, id: getProfileShareId(), u: shownName().slice(0, 30), picks, w: craves, ts: Date.now() };
}

// The name friends see: the one you typed, else your Google first name.
// "Foodie" is only the placeholder, and showed every friend as "Foodie".
function shownName () {
  const profile = (typeof loadUserProfile === 'function' && loadUserProfile()) || {};
  const typed = String(profile.name || '').trim();
  if (typed && typed.toLowerCase() !== 'foodie') return typed;
  let google = '';
  try { google = String(firebase.auth().currentUser?.displayName || '').trim().split(/\s+/)[0]; } catch { /* signed out */ }
  return google || typed;
}

function getProfileShareId () {
  if (!state.settings.profileShareId) {
    state.settings.profileShareId = uid();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
  }
  return state.settings.profileShareId;
}

function profileHasContent (data) {
  return !!(data?.picks?.length || data?.w?.length);
}

function encodeProfileLink (data) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  return window.location.href.split('?')[0].split('#')[0] + '#profile=' + encoded;
}

/* ── Friends' feed: what the people you follow ate lately ──
   After you share your link, your latest activity is published (signed-in
   only) so followers see it live. Friends' data is untrusted: re-shaped,
   clipped and escaped like profile links. */
const FRIENDS_LIVE_EVERY = 30 * 60 * 1000;
let _friendsLiveAt = 0;

function buildRecentActivity () {
  const items = [];
  const day = v => String(v || '').slice(0, 10);
  (state.restaurants || []).forEach(r => {
    const base = { n: String(r.name || '').slice(0, 60), c: String(r.cuisine || '').slice(0, 40), a: String(r.address || '').slice(0, 60) };
    if (!base.n) return;
    const visits = Array.isArray(r.visits) ? r.visits : [];
    visits.forEach(v => { if (v.date) items.push({ ...base, k: 'visit', r: Math.round(Number(v.rating) || 0), at: day(v.date) }); });
    if (!visits.length && r.dateVisited) items.push({ ...base, k: 'visit', r: r.myRating || 0, at: day(r.dateVisited) });
    dishesOf(r).forEach(d => {
      if (d.verdict === 'again' && d.date) items.push({ ...base, k: 'dish', d: String(d.name).slice(0, 40), at: day(d.date) });
    });
    if (r.status === 'want-to-try' && r.dateAdded) items.push({ ...base, k: 'save', at: day(r.dateAdded) });
  });
  return items.filter(i => /^\d{4}-\d{2}-\d{2}$/.test(i.at)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
}

// What friends who follow your link can see, or null while you're not sharing.
function buildLiveProfile () {
  if (!state.settings.shareLive || !state.settings.profileShareId) return null;
  const { ts, ...profile } = buildProfileData();
  const me = (typeof loadUserProfile === 'function' && loadUserProfile()) || {};
  return { id: profile.id, u: profile.u, av: normalizeAvatar(me.avatar), profile, recent: buildRecentActivity() };
}

function startSharingLive () {
  if (state.settings.shareLive) return;
  state.settings.shareLive = true;
  getProfileShareId();
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
  if (typeof fbPublishFriendProfile === 'function') fbPublishFriendProfile();
  renderFriendsLiveNote();
}

function stopSharingLive () {
  state.settings.shareLive = false;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* storage full */ }
  if (typeof fbUnpublishFriendProfile === 'function') fbUnpublishFriendProfile(state.settings.profileShareId);
  renderFriendsLiveNote();
  showToast('Sharing paused', "Friends keep what they already have, but won't see new visits.", 'info');
}

function renderFriendsLiveNote () {
  const el = document.getElementById('friends-live-note');
  if (!el) return;
  if (!state.settings.shareLive) { el.innerHTML = ''; return; }
  el.innerHTML = window._ftbUid
    ? 'Friends with your link see your latest visits. <button type="button" class="auth-link-btn" id="friends-stop-live">Stop sharing</button>'
    : 'Sign in so friends see your new visits as they happen. <button type="button" class="auth-link-btn" id="friends-live-signin">Sign in</button>';
  el.querySelector('#friends-stop-live')?.addEventListener('click', stopSharingLive);
  el.querySelector('#friends-live-signin')?.addEventListener('click', () => { closeFoodieFriends(); setTimeout(() => openAuthModal(), 150); });
}

// Friends see your name on the invite, so ask for one the first time.
function ensureInviteName () {
  const profile = (typeof loadUserProfile === 'function' && loadUserProfile()) || {};
  // "Foodie" is the placeholder every new profile starts with, not a real name.
  const current = String(profile.name || '').trim();
  if (current && current.toLowerCase() !== 'foodie') return true;
  const known = shownName();
  if (known && known.toLowerCase() !== 'foodie') { saveUserProfile({ ...profile, name: known }); return true; }
  const name = String(window.prompt('What name should your friends see on your invite?') || '').trim().slice(0, 30);
  if (!name) return false;
  saveUserProfile({ ...profile, name });
  return true;
}

// The one invite link: your picks to follow (or just your name, before you've
// rated anything), plus your free-month invite code when you're signed in.
// It goes through invite.html, whose link preview says "You're invited".
// Just enough to follow you (your share id and name): short enough for a QR
// code a phone camera reads easily. Your picks arrive live once they follow.
function buildFollowLink (ref = window._ftbUid || '') {
  const profile = (typeof loadUserProfile === 'function' && loadUserProfile()) || {};
  const data = { v: 2, id: getProfileShareId(), u: String(profile.name || '').slice(0, 30), picks: [], w: [], ts: Date.now() };
  const link = encodeProfileLink(data).replace(/\/app\.html#profile=/, '/invite.html#profile=');
  return ref && /^[A-Za-z0-9]{10,64}$/.test(ref) ? link.replace('#profile=', `?ref=${ref}#profile=`) : link;
}

// Draws `text` as a QR code on `canvas` (qrcodejs renders into a div first).
function drawQr (canvas, text) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!window.QRCode) return false;
  try {
    const tmp = document.createElement('div');
    new QRCode(tmp, { text, width: canvas.width, height: canvas.height, colorDark: '#1b130b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    const img = tmp.querySelector('img');
    const paint = src => { const i = new Image(); i.onload = () => ctx.drawImage(i, 0, 0, canvas.width, canvas.height); i.src = src; };
    const qrCanvas = tmp.querySelector('canvas');
    if (qrCanvas) ctx.drawImage(qrCanvas, 0, 0, canvas.width, canvas.height);
    else if (img?.src) paint(img.src);
    else setTimeout(() => { const later = tmp.querySelector('img'); if (later?.src) paint(later.src); }, 200);
    return true;
  } catch { return false; }
}

// Friends: a QR code a friend scans with their camera to follow you.
// Free for everyone, like inviting: more people on Feed The Bear.
function showFollowQr () {
  if (!ensureInviteName()) return;
  startSharingLive();
  const box = document.getElementById('friends-qr');
  if (!box) return;
  box.classList.remove('hidden');
  const ok = drawQr(document.getElementById('friends-qr-canvas'), buildFollowLink());
  box.querySelector('.friends-qr-note').textContent = ok
    ? "Point a friend's phone camera at this. They follow you (and get 30 days of Grizzly free)."
    : "The QR code couldn't load. Use Invite a friend to send your link instead.";
  trackProductEvent('friend_qr_shown');
}

function buildInviteLink (ref = window._ftbUid || '') {
  const link = encodeProfileLink(buildProfileData()).replace(/\/app\.html#profile=/, '/invite.html#profile=');
  return ref && /^[A-Za-z0-9]{10,64}$/.test(ref) ? link.replace('#profile=', `?ref=${ref}#profile=`) : link;
}

// Invites you've sent (newest first). Each has its own random code, so the
// server can say when it was opened and who joined; the name you gave it
// ("Mom", from your contacts or typed) never leaves this phone.
const INVITES_SENT_KEY = 'ftb_invites_sent_v1';
function getSentInvites () {
  try {
    const list = JSON.parse(localStorage.getItem(INVITES_SENT_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    // Older entries were just the date.
    return list.map(e => (typeof e === 'string' ? { at: e, code: '', name: '' } : e))
      .filter(e => e && typeof e.at === 'string')
      .map(e => ({ at: e.at, code: /^[a-z0-9]{16,32}$/.test(e.code || '') ? e.code : '', name: String(e.name || '').slice(0, 40) }));
  } catch { return []; }
}
function noteInviteSent (entry = {}) {
  const item = { at: new Date().toISOString(), code: entry.code || '', name: entry.name || '' };
  try { localStorage.setItem(INVITES_SENT_KEY, JSON.stringify([item, ...getSentInvites()].slice(0, 50))); } catch { /* private mode */ }
  if (!document.getElementById('friends-overlay')?.classList.contains('hidden')) renderFriendsList();
}
function fmtInviteDate (iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sent';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function newInviteCode () {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => abc[b % abc.length]).join('');
}

// Picking someone from the phone's contacts: just their name, no permission
// prompt. The Android app uses the system picker (ContactPickerPlugin.java);
// Chrome on Android has navigator.contacts. Elsewhere you type the name.
function contactPicker () {
  const native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins?.ContactPicker : null;
  if (native) return async () => String((await native.pick())?.name || '');
  if (navigator.contacts?.select && 'ContactsManager' in window) {
    return async () => String((await navigator.contacts.select(['name'], { multiple: false }))?.[0]?.name?.[0] || '');
  }
  return null;
}

// "Who's this invite for?" Resolves to the name ('' to skip it), or null if closed.
function askInviteRecipient () {
  return new Promise(resolve => {
    document.getElementById('invite-who')?.remove();
    const pick = contactPicker();
    const el = document.createElement('div');
    el.id = 'invite-who';
    el.className = 'modal-overlay invite-who';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'invite-who-title');
    el.innerHTML = `<form class="invite-who-card">
      <button type="button" class="invite-who-close icon-btn" aria-label="Close">✕</button>
      <h3 id="invite-who-title">Who's this invite for?</h3>
      <p class="invite-who-hint">So you can see when they open it and join. Only you see this name.</p>
      ${pick ? '<button type="button" class="btn-secondary invite-who-contacts">📇 Pick from contacts</button>' : ''}
      <input class="form-input invite-who-name" type="text" maxlength="40" placeholder="Their name" autocomplete="off" aria-label="Their name" />
      <button type="submit" class="btn-primary invite-who-send">Send invite</button>
      <button type="button" class="invite-who-skip">Skip</button>
    </form>`;
    document.body.appendChild(el);
    const input = el.querySelector('.invite-who-name');
    const done = val => { el.remove(); resolve(val); };
    el.querySelector('form').addEventListener('submit', e => { e.preventDefault(); done(input.value.trim().slice(0, 40)); });
    el.querySelector('.invite-who-skip').addEventListener('click', () => done(''));
    el.querySelector('.invite-who-close').addEventListener('click', () => done(null));
    el.addEventListener('click', e => { if (e.target === el) done(null); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
    el.querySelector('.invite-who-contacts')?.addEventListener('click', async () => {
      try {
        const name = (await pick()).trim();
        if (name) { input.value = name.slice(0, 40); el.querySelector('.invite-who-send').focus(); }
      } catch { input.focus(); }
    });
    if (!pick) setTimeout(() => input.focus(), 60);
  });
}

// `ref` is your account id for the free-month reward (firebase.js passes it).
// Anyone can invite, free or Grizzly (following more than one friend is Grizzly).
async function inviteFriend ({ ref = window._ftbUid || '' } = {}) {
  if (!ensureInviteName()) return;
  const who = await askInviteRecipient();
  if (who === null) return;
  const data = buildProfileData();
  // Signed in: a code of its own, so this invite can be followed up.
  const code = window._ftbUid ? newInviteCode() : '';
  let url = buildInviteLink(ref);
  if (code) {
    handleApi('POST', { body: { action: 'invite', code } }).catch(() => {});
    const [base, hash] = url.split('#');
    url = `${base}${base.includes('?') ? '&' : '?'}i=${code}${hash ? `#${hash}` : ''}`;
  }
  const hasPicks = profileHasContent(data);
  const hi = who ? `Hey ${who.split(/\s+/)[0]}! ` : '';
  // Says what the app is and exactly what tapping the link does.
  const text = hi + "I'm using Feed the Bear to save places to eat and what to order there. "
    + (hasPicks
      ? 'Tap my link to join free. You\'ll follow me and can add any of my spots to your list with one tap.'
      : 'Tap my link to join free and follow me, so we can share spots.')
    + (ref ? ' (You get 30 days of Grizzly free with it.)' : '');
  startSharingLive();
  trackProductEvent('friend_invite', { withProfile: hasPicks, withRef: !!ref, named: !!who, tracked: !!code });
  try {
    if (navigator.share) { await navigator.share({ title: 'Feed the Bear', text, url }); noteInviteSent({ code, name: who }); return; }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  noteInviteSent({ code, name: who });
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Invite copied', 'Paste it in a text to a friend.', 'success');
  } catch {
    // No share sheet and no clipboard (older Android app): show it to copy by hand.
    window.prompt('Copy your invite and send it to a friend:', `${text} ${url}`);
  }
}

// Opened from an invite (app.html?i=<code>): tell the inviter it was opened,
// and keep the code so it can be marked joined once they sign in.
const INVITE_CODE_KEY = 'ftb_invite_code_v1';
(function captureInviteCode () {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('i') || '';
    if (!/^[a-z0-9]{16,32}$/.test(code)) return;
    params.delete('i');
    const rest = params.toString();
    history.replaceState(history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    if (getSentInvites().some(e => e.code === code)) return; // your own link
    localStorage.setItem(INVITE_CODE_KEY, code);
    fetch('/api/handle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inviteOpened', code }) }).catch(() => {});
  } catch { /* private mode */ }
})();
// Came from someone's public page (app.html?src=<handle>, api/creator.js):
// counted as a join on their page once they sign in.
const PAGE_SRC_KEY = 'ftb_page_src_v1';
(function capturePageSource () {
  try {
    const params = new URLSearchParams(window.location.search);
    const src = String(params.get('src') || '').toLowerCase();
    if (!params.has('src')) return;
    params.delete('src');
    const rest = params.toString();
    history.replaceState(history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    if (/^[a-z0-9_]{3,20}$/.test(src)) localStorage.setItem(PAGE_SRC_KEY, src); // HANDLE_RE isn't defined yet here
  } catch { /* private mode */ }
})();
async function notePageJoined () {
  let handle = '';
  try { handle = localStorage.getItem(PAGE_SRC_KEY) || ''; } catch { return; }
  if (!handle || !window._ftbUid) return;
  try {
    const { ok, status } = await handleApi('POST', { body: { action: 'pageJoined', handle } });
    if (ok || (status >= 200 && status < 500 && status !== 429)) localStorage.removeItem(PAGE_SRC_KEY);
  } catch { /* next time */ }
}

async function noteInviteJoined () {
  notePageJoined();
  let code = '';
  try { code = localStorage.getItem(INVITE_CODE_KEY) || ''; } catch { return; }
  if (!code || !window._ftbUid) return;
  try {
    startSharingLive();
    if (typeof fbPublishFriendProfile === 'function') await fbPublishFriendProfile();
    const { ok, status } = await handleApi('POST', { body: { action: 'inviteJoined', code, me: getProfileShareId() } });
    if (ok || status === 400) localStorage.removeItem(INVITE_CODE_KEY);
  } catch { /* next time */ }
}
window.noteInviteJoined = noteInviteJoined;

let _inviteStatus = {};
// Every invite you sent is on the server, so they show on any phone you sign
// in on, not just the one that sent them (that phone also remembers who for).
let _serverInvites = [];
async function loadInviteStatus () {
  if (!window._ftbUid) return;
  try {
    const { ok, status, data } = await handleApi('GET', { query: '?invites=1' });
    if (!ok || !Array.isArray(data.invites)) { noteFriendsError('your invites', status, data); return; }
    clearFriendsError('your invites');
    _inviteStatus = Object.fromEntries(data.invites.map(r => [r.code, r]));
    _serverInvites = data.invites
      .filter(r => r && /^[a-z0-9]{16,32}$/.test(r.code || ''))
      .map(r => ({ at: String(r.at || ''), code: r.code, name: '' }));
    if (!document.getElementById('friends-overlay')?.classList.contains('hidden')) renderFriendsList();
  } catch { noteFriendsError('your invites', 0, {}); }
}

function sanitizeRecent (list) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  return (Array.isArray(list) ? list : []).slice(0, 15).map(x => ({
    k: ['visit', 'dish', 'save'].includes(x?.k) ? x.k : '',
    n: str(x?.n, 60), c: str(x?.c, 40), a: str(x?.a, 60), d: str(x?.d, 40),
    r: Math.max(0, Math.min(5, Math.round(Number(x?.r) || 0))),
    at: /^\d{4}-\d{2}-\d{2}$/.test(str(x?.at, 10)) ? str(x.at, 10) : '',
  })).filter(x => x.k && x.n && x.at);
}

// Pull followed friends' live profiles (at most every 30 minutes).
async function refreshFriendsLive (force = false) {
  if (typeof fbFetchFriendProfiles !== 'function') return;
  if (!force && Date.now() - _friendsLiveAt < FRIENDS_LIVE_EVERY) return;
  const friends = getFriends().filter(f => f.data?.id);
  if (!friends.length) return;
  _friendsLiveAt = Date.now();
  const docs = await fbFetchFriendProfiles(friends.map(f => f.data.id));
  let changed = false;
  const list = getFriends();
  docs.forEach((doc, i) => {
    if (!doc) return;
    const entry = list.find(f => f.key === friends[i].key);
    if (!entry) return;
    const data = sanitizeFriendData({ ...(doc.profile || {}), id: friends[i].data.id, u: doc.u || entry.name });
    entry.data = data;
    entry.name = data.u || entry.name;
    entry.recent = sanitizeRecent(doc.recent);
    entry.av = typeof doc.av === 'string' ? doc.av.slice(0, 20) : '';
    entry.liveAt = Date.now();
    changed = true;
  });
  if (changed) {
    saveFriends(list, { touch: false });
    renderFriendsFeedHome();
    if (!document.getElementById('friends-overlay')?.classList.contains('hidden')) renderFriendsList();
  }
}
window.addEventListener('load', () => setTimeout(() => refreshFriendsLive(), 3000));

function feedAgo (day) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y) return '';
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(y, m - 1, d).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function friendsFeedItems () {
  const items = [];
  getFriends().forEach(f => {
    const who = { name: f.name || 'Friend', av: f.av || '' };
    if (Array.isArray(f.recent) && f.recent.length) {
      f.recent.forEach(x => items.push({ ...x, who }));
    } else {
      // Not live yet: show their go-to orders from the link they shared.
      (f.data?.picks || []).slice(0, 3).forEach(p => items.push({ k: p.g?.length ? 'dish' : 'visit', n: p.n, c: p.c, a: p.a, d: p.g?.[0] || '', r: p.r, at: '', who }));
    }
  });
  return items.sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 6);
}

function renderFriendsFeedHome () {
  const section = document.getElementById('friends-feed-home');
  const list = document.getElementById('ff-list');
  if (!section || !list) return;
  // Only when friends have something to show; inviting is the small header button.
  const items = (state.restaurants || []).length ? friendsFeedItems() : [];
  // The friend with the most spots you don't have yet: one tap to see and add them.
  const best = getFriends().map(f => ({ f, n: friendNewSpots(f).length })).sort((a, b) => b.n - a.n)[0];
  // The moss Friends button in the header gets a dot when there's something new.
  const dot = document.getElementById('header-friends-dot');
  if (dot) {
    const fresh = best?.n || 0;
    dot.classList.toggle('hidden', !fresh);
    document.getElementById('header-friends-btn')?.setAttribute('aria-label', fresh ? `Friends: ${best.f.name} has ${fresh} new spot${fresh === 1 ? '' : 's'}` : 'Friends');
  }
  const nudge = best && best.n ? `<div class="ff-new">
      <span>${escHtml(best.f.name)} has <strong>${best.n} spot${best.n === 1 ? '' : 's'}</strong> you don't have yet.</span>
      <button type="button" class="btn-sm btn-orange ff-new-see">See ${best.n === 1 ? 'it' : 'them'}</button>
    </div>` : '';
  section.classList.toggle('hidden', !items.length && !nudge);
  if (!items.length && !nudge) { list.innerHTML = ''; return; }
  const mine = new Map((state.restaurants || []).map(r => [normalizeName(r.name), r]));
  list.innerHTML = nudge + items.map((x, i) => {
    const who = `<strong>${escHtml(x.who.name)}</strong>`;
    const at = `<strong>${escHtml(x.n)}</strong>`;
    const stars = x.r ? ` <span class="ff-stars">${'★'.repeat(x.r)}</span>` : '';
    const line = x.k === 'dish' && x.d ? `${who} would get the <strong>${escHtml(x.d)}</strong> again at ${at}`
      : x.k === 'save' ? `${who} wants to try ${at}`
      : `${who} ate at ${at}${stars}`;
    const have = mine.get(normalizeName(x.n));
    return `<div class="ff-item">
      <span class="ff-avatar" aria-hidden="true">${avatarSvg(x.who.av)}</span>
      <span class="ff-text">${line}<span class="ff-meta">${escHtml([cuisineEmoji(x.c) + ' ' + (x.c || ''), feedAgo(x.at)].map(s => s.trim()).filter(Boolean).join(' · '))}</span></span>
      ${have ? `<button type="button" class="btn-ghost btn-sm ff-view" data-id="${escHtml(have.id)}">View</button>`
        : `<button type="button" class="btn-sm btn-orange ff-save" data-i="${i}">＋ Save</button>`}
    </div>`;
  }).join('');
  list.querySelectorAll('.ff-view').forEach(b => b.addEventListener('click', () => openDetailModal(b.dataset.id)));
  list.querySelectorAll('.ff-save').forEach(b => b.addEventListener('click', () => saveFromFriend(items[Number(b.dataset.i)])));
  list.querySelector('.ff-new-see')?.addEventListener('click', () => openFriendSpots(best.f.data));
}

// `quiet`: no redraw or toast (adding several at once). Returns the new spot.
function saveFromFriend (x, { quiet = false, bulk = false } = {}) {
  if (!x?.n) return null;
  if (onMyList(x.n)) return null;
  const atLimit = typeof isPremium === 'function' && !isPremium() && state.restaurants.length >= FREE_RESTAURANT_LIMIT;
  if (atLimit && bulk) { showGrizzlyUpsell('limit'); return null; }
  const today = iso();
  const r = {
    id: uid(), name: x.n.slice(0, 80), cuisine: x.c || '', priceRange: 0, address: x.a || '', lat: null, lng: null,
    website: '', photo: '', googleRating: 0, googleReviews: 0, myRating: 0,
    notes: `${x.who.name} recommended it.`, tags: ['From a friend'], collectionId: null, priority: '',
    status: 'want-to-try', dateAdded: today, dateVisited: null, updatedAt: Date.now(), visits: [],
  };
  if (atLimit) { holdSpotForGrizzly(r, x.d ? { name: x.d, verdict: 'want' } : null); return null; }
  state.restaurants.unshift(r);
  if (x.d) upsertDish(r, { name: x.d, verdict: 'want' });
  else saveData();
  if (r.address && typeof geocodeAddress === 'function') geocodeAddress(r.id, r.address);
  trackProductEvent('friend_spot_saved');
  if (quiet) return r;
  renderAll();
  showToast(`${r.name} saved`, x.d ? `On your list, with the ${x.d} to try.` : 'On your Want to Try list.', 'success');
  return r;
}

/* ── Friends: follow someone's profile link, see their orders ──
   Profile links come from anyone, so everything is re-shaped and clipped
   here and escaped wherever it's shown. */
const FRIENDS_KEY = 'ftb_friends_v1';

function sanitizeFriendData (raw) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  const list = (v, n, len) => (Array.isArray(v) ? v : []).slice(0, n).map(x => str(x, len)).filter(Boolean);
  const picks = (Array.isArray(raw?.picks) ? raw.picks : []).slice(0, 20).map(p => ({
    n: str(p?.n, 80), c: str(p?.c, 40), a: str(p?.a, 60),
    r: Math.max(0, Math.min(5, Math.round(Number(p?.r) || 0))),
    p: /^https?:/i.test(safeUrl(p?.p || '')) ? safeUrl(p.p).slice(0, 300) : '',
    g: list(p?.g, 3, 40), s: list(p?.s, 2, 40),
  })).filter(p => p.n);
  const w = (Array.isArray(raw?.w) ? raw.w : []).slice(0, 10).map(x => ({ d: str(x?.d, 40), at: str(x?.at, 60) })).filter(x => x.d);
  return { id: str(raw?.id, 40), u: str(raw?.u, 30), picks, w, ts: Number(raw?.ts) || 0 };
}

function decodeProfileLink (input = '') {
  let encoded = String(input).trim();
  const m = encoded.match(/#profile=(.+)$/);
  if (m) encoded = m[1];
  const data = sanitizeFriendData(JSON.parse(decodeURIComponent(escape(atob(encoded)))));
  // An invite from someone who hasn't rated anything yet still names them,
  // so they can be followed and their picks arrive later.
  if (!profileHasContent(data) && !(data.id && data.u)) throw new Error('empty');
  return data;
}

function getFriends () {
  try { const list = JSON.parse(localStorage.getItem(FRIENDS_KEY)); return Array.isArray(list) ? list : []; } catch { return []; }
}
// Who you follow is backed up to your account (firebase.js), so it's there on
// every device you sign in on. `touch: false` is for refreshing friends' data,
// which isn't a change to who you follow.
const FRIENDS_AT_KEY = 'ftb_friends_at_v1';
function saveFriends (list, { touch = true } = {}) {
  try {
    localStorage.setItem(FRIENDS_KEY, JSON.stringify(list.slice(0, 50)));
    if (touch) localStorage.setItem(FRIENDS_AT_KEY, String(Date.now()));
  } catch { /* storage full */ }
  if (touch && typeof fbSaveFriendsCloud === 'function') fbSaveFriendsCloud();
}
function friendsUpdatedAt () {
  try { return Number(localStorage.getItem(FRIENDS_AT_KEY)) || 0; } catch { return 0; }
}
function friendKey (data) { return data.id ? `id:${data.id}` : `name:${String(data.u || '').toLowerCase()}`; }
function isFollowing (data) { return getFriends().some(f => f.key === friendKey(data)); }

// Free accounts can follow one friend (usually whoever invited them), so an
// invite works without paying; following more people is Grizzly.
// FREE_FRIENDS itself is declared in app.js (loads first).

// Following again with a newer link updates that friend's profile.
function followFriend (data, { quiet = false } = {}) {
  if (data.id && data.id === state.settings.profileShareId) {
    showToast("That's your link", 'Send it to a friend so they can follow you.', 'info');
    return null;
  }
  const list = getFriends();
  const entry = { key: friendKey(data), name: data.u || 'Friend', data, savedAt: Date.now() };
  const i = list.findIndex(f => f.key === entry.key);
  if (i < 0 && list.length >= FREE_FRIENDS && grizzlyLocked('friends')) return null;
  if (i >= 0) list[i] = entry; else list.unshift(entry);
  saveFriends(list);
  if (i < 0) noteFollow(data.id);
  trackProductEvent('friend_followed', { updated: i >= 0 });
  if (!quiet) showToast(i >= 0 ? `Updated ${entry.name}` : `Following ${entry.name}`,
    window._ftbUid ? 'Their go-to orders now show on matching restaurants, and they can follow you back.' : 'Their go-to orders now show on matching restaurants.', 'success');
  renderAll();
  // Android app: offer a ping when they eat somewhere new (asks once).
  if (i < 0) window.FriendPings?.offer();
  return entry;
}

function unfollowFriend (key) {
  const gone = getFriends().find(f => f.key === key);
  saveFriends(getFriends().filter(f => f.key !== key));
  if (gone?.data?.id) noteFollow(gone.data.id, 'unfollowed');
  renderAll();
}

/* ── Followers: who follows you ──
   Following is one-way, so when a friend joins from your invite and follows
   you, the server notes it (api/handle.js) and Friends shows them under
   "Following you" with a Follow back button. Your profile goes live when you
   follow someone, so they can see you back. */
const FOLLOW_NOTED_KEY = 'ftb_follow_noted_v1';
function followNoted () {
  try { return new Set(JSON.parse(localStorage.getItem(FOLLOW_NOTED_KEY)) || []); } catch { return new Set(); }
}
async function noteFollow (id, action = 'followed') {
  if (!id || !window._ftbUid || !/^[a-z0-9]{8,40}$/.test(String(id))) return false;
  try {
    startSharingLive();
    if (typeof fbPublishFriendProfile === 'function') await fbPublishFriendProfile();
    const { ok } = await handleApi('POST', { body: { action, id, me: getProfileShareId() } });
    if (ok) {
      const noted = followNoted();
      if (action === 'followed') noted.add(id); else noted.delete(id);
      localStorage.setItem(FOLLOW_NOTED_KEY, JSON.stringify([...noted].slice(-100)));
    }
    return ok;
  } catch { return false; }
}
// Friends followed before followers existed (or on another device) are noted
// once, so the people you follow see you under "Following you".
let _notingFollows = false;
async function noteExistingFollows () {
  if (_notingFollows || !window._ftbUid) return;
  _notingFollows = true;
  try {
    const noted = followNoted();
    for (const f of getFriends()) {
      if (f.data?.id && !noted.has(f.data.id)) await noteFollow(f.data.id);
    }
  } finally { _notingFollows = false; }
}

// Put back anyone you follow who is missing from this account's list (the
// server's followers lists are the record that can't be lost in a sync).
let _restoringFollows = false;
async function loadFollowing () {
  if (!window._ftbUid || _restoringFollows) return;
  _restoringFollows = true;
  try {
    const { ok, status, data } = await handleApi('GET', { query: '?following=1' });
    if (!ok || !Array.isArray(data.following)) { noteFriendsError('who you follow', status, data); return; }
    clearFriendsError('who you follow');
    const have = new Set(getFriends().map(f => f.data?.id).filter(Boolean));
    const missing = data.following
      .map(f => ({ id: String(f?.id || '').slice(0, 40), u: String(f?.u || 'Friend').slice(0, 30) }))
      .filter(f => /^[a-z0-9]{8,40}$/.test(f.id) && !have.has(f.id) && f.id !== getProfileShareId());
    if (!missing.length) return;
    const now = Date.now();
    saveFriends([...getFriends(), ...missing.map(f => ({
      key: `id:${f.id}`, name: f.u, data: { id: f.id, u: f.u, picks: [], w: [], ts: 0 }, savedAt: now,
    }))]);
    const noted = followNoted();
    missing.forEach(f => noted.add(f.id));
    try { localStorage.setItem(FOLLOW_NOTED_KEY, JSON.stringify([...noted].slice(-100))); } catch { /* storage full */ }
    await refreshFriendsLive(true);
    renderAll();
    if (!document.getElementById('friends-overlay')?.classList.contains('hidden')) renderFriendsList();
  } catch { noteFriendsError('who you follow', 0, {}); } finally { _restoringFollows = false; }
}
window.loadFollowing = loadFollowing;

let _followers = null;
async function loadFollowers () {
  if (!window._ftbUid) { _followers = []; return; }
  try {
    const { ok, status, data } = await handleApi('GET', { query: '?followers=1' });
    if (!ok) noteFriendsError('who follows you', status, data);
    else clearFriendsError('who follows you');
    _followers = ok && Array.isArray(data.followers) ? data.followers.slice(0, 200).map(f => ({
      id: String(f?.id || '').slice(0, 40), u: String(f?.u || 'Friend').slice(0, 30),
    })).filter(f => /^[a-z0-9]{8,40}$/.test(f.id)) : [];
  } catch { _followers = []; noteFriendsError('who follows you', 0, {}); }
  followBackNew();
  if (!document.getElementById('friends-overlay')?.classList.contains('hidden')) renderFriendsList();
}

// Accepting your invite (following you) makes you friends both ways: on
// Grizzly each new follower is followed back once. Unfollowing them sticks.
const FOLLOWED_BACK_KEY = 'ftb_followed_back_v1';
function followBackNew () {
  let done;
  try { done = new Set(JSON.parse(localStorage.getItem(FOLLOWED_BACK_KEY)) || []); } catch { done = new Set(); }
  const following = new Set(getFriends().map(f => f.data?.id).filter(Boolean));
  let changed = false;
  for (const f of _followers || []) {
    if (done.has(f.id)) continue;
    if (!following.has(f.id)) {
      // Free accounts follow one friend, so they choose who with Follow back.
      if (!hasGrizzly()) continue;
      if (!followFriend({ id: f.id, u: f.u, picks: [], w: [], ts: 0 }, { quiet: true })) continue;
      following.add(f.id);
      showToast(`You and ${f.u} are friends`, `${f.u} accepted your invite, so you follow each other now.`, 'success');
    }
    done.add(f.id);
    changed = true;
  }
  if (changed) {
    try { localStorage.setItem(FOLLOWED_BACK_KEY, JSON.stringify([...done].slice(-200))); } catch { /* storage full */ }
    refreshFriendsLive(true);
  }
}

/* What the Friends screen knows, said at the top: which account, how much
   loaded, and any part that failed (with Try again), so nothing fails quietly. */
const _friendsErrors = {};
function noteFriendsError (what, status, data) {
  _friendsErrors[what] = status === 401 ? 'your sign-in expired, so sign out and back in'
    : status ? `${data?.error || 'server error'} (${status})` : 'no connection';
  renderFriendsStatus();
}
function clearFriendsError (what) { delete _friendsErrors[what]; renderFriendsStatus(); }
function renderFriendsStatus () {
  const el = document.getElementById('friends-status');
  if (!el) return;
  if (!window._ftbUid) {
    el.innerHTML = `<div class="friends-load-error">You're not signed in here, so your friends and invites can't load. <button type="button" class="btn-sm btn-orange friends-status-signin">Sign in</button></div>`;
    el.querySelector('.friends-status-signin').onclick = () => { closeFoodieFriends(); openAuthModal(); };
    return;
  }
  const errs = Object.entries(_friendsErrors);
  const following = getFriends().length;
  const invites = _serverInvites.length;
  el.innerHTML = `<div class="friends-who">Signed in as <strong>${escHtml(window._ftbUserEmail || 'you')}</strong>`
    + (_followers === null ? ' · loading…' : ` · following ${following} · ${(_followers || []).length} follow you · ${invites} invite${invites === 1 ? '' : 's'} sent`) + '</div>'
    + (errs.length ? `<div class="friends-load-error">Couldn't load ${escHtml(errs.map(([w, m]) => `${w}: ${m}`).join('; '))}. <button type="button" class="btn-sm btn-orange friends-status-retry">Try again</button></div>` : '');
  el.querySelector('.friends-status-retry')?.addEventListener('click', () => { Object.keys(_friendsErrors).forEach(k => delete _friendsErrors[k]); openFoodieFriends(); });
}

// What your friends say about one spot: their rating, orders, and cravings.
function friendTipsFor (r) {
  const key = normalizeName(r?.name || '');
  if (!key) return [];
  return getFriends().map(f => {
    const pick = (f.data?.picks || []).find(p => normalizeName(p.n) === key);
    const wants = (f.data?.w || []).filter(x => normalizeName(x.at) === key).map(x => x.d);
    if (!pick && !wants.length) return null;
    return { name: f.name, rating: pick?.r || 0, get: pick?.g || [], skip: pick?.s || [], wants };
  }).filter(Boolean);
}

function friendTipsHtml (r) {
  const tips = friendTipsFor(r);
  if (!tips.length) return '';
  return `<div class="yo-friends"><div class="yo-group-label">Friends say</div>${tips.map(t => {
    const bits = [];
    if (t.get.length) bits.push(`get the ${t.get.map(escHtml).join(', ')}`);
    if (t.skip.length) bits.push(`skip the ${t.skip.map(escHtml).join(', ')}`);
    if (t.wants.length) bits.push(`wants to try the ${t.wants.map(escHtml).join(', ')}`);
    if (!bits.length && t.rating) bits.push('loves it here');
    return `<div class="yo-friend"><strong>${escHtml(t.name)}</strong>${t.rating ? ` <span class="yo-dish-stars">${'★'.repeat(t.rating)}</span>` : ''}: ${bits.join(' · ')}</div>`;
  }).join('')}</div>`;
}

/* ── Links on a spot: the TikTok you found it on, reviews, the menu ── */
const LINK_KINDS = [
  [/tiktok\.com/i, 'TikTok', '🎵'], [/instagram\.com/i, 'Instagram', '📸'], [/youtube\.com|youtu\.be/i, 'YouTube', '▶️'],
  [/yelp\.com/i, 'Yelp', '⭐'], [/facebook\.com|fb\.watch/i, 'Facebook', '👍'], [/(?:^|\.)x\.com|twitter\.com/i, 'X', '✖️'],
  [/threads\.net/i, 'Threads', '🧵'], [/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i, 'Google Maps', '📍'],
  [/tripadvisor\./i, 'Tripadvisor', '🦉'], [/opentable\.|resy\.com/i, 'Reservations', '🍽️'],
];
const LINKS_MAX = 12;

function linkKind (url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* bad url */ }
  const hit = LINK_KINDS.find(([re]) => re.test(host) || re.test(url));
  return hit ? { label: hit[1], icon: hit[2] } : { label: host || 'Link', icon: /menu/i.test(url) ? '📋' : '🔗' };
}

function linksOf (r) { return Array.isArray(r?.links) ? r.links.filter(l => l && safeUrl(l.url)) : []; }

// Adds a link once (same URL twice is ignored). Returns false if it isn't a web link.
function addLinkTo (r, raw) {
  const url = String(raw || '').trim().match(/https?:\/\/\S+/i)?.[0] || '';
  if (!r || !/^https?:\/\//i.test(safeUrl(url))) return false;
  if (!Array.isArray(r.links)) r.links = [];
  if (!r.links.some(l => l.url === url)) r.links.unshift({ url: url.slice(0, 500), added: iso() });
  r.links = r.links.slice(0, LINKS_MAX);
  r.updatedAt = Date.now();
  return true;
}

function linkChipsHtml (r, max = 4) {
  const links = linksOf(r);
  if (!links.length) return '';
  return `<div class="link-chips">${links.slice(0, max).map(l => {
    const k = linkKind(l.url);
    return `<a class="link-chip" href="${escHtml(safeUrl(l.url))}" target="_blank" rel="noopener" data-action="open-link">${k.icon} ${escHtml(k.label)}</a>`;
  }).join('')}${links.length > max ? `<span class="link-chip more">+${links.length - max}</span>` : ''}</div>`;
}

function renderDetailLinks (r) {
  const list = document.getElementById('detail-links-list');
  if (!list) return;
  const links = linksOf(r);
  list.innerHTML = links.length
    ? links.map(l => {
        const k = linkKind(l.url);
        return `<div class="detail-link-row"><a href="${escHtml(safeUrl(l.url))}" target="_blank" rel="noopener">${k.icon} <strong>${escHtml(k.label)}</strong> <span>${escHtml(l.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</span></a>
          <button type="button" class="icon-btn detail-link-remove" data-url="${escHtml(l.url)}" aria-label="Remove link">✕</button></div>`;
      }).join('')
    : '<div class="detail-links-empty">Where did you hear about it? Save the TikTok, Instagram post, review or menu here.</div>';
}

// Your photos and videos from visits and dishes, newest first, for cards.
function spotMediaOf (r) {
  const items = [];
  (r.visits || []).forEach(v => mediaOf(v).forEach(m => items.push({ ...m, date: v.date || '' })));
  dishesOf(r).forEach(d => mediaOf(d).forEach(m => items.push({ ...m, date: d.date || '' })));
  const seen = new Set();
  return items.filter(m => safeUrl(m.photo) && !seen.has(m.photo) && seen.add(m.photo))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// What a card shows beyond the name: your photos, a bit of your notes, your links.
function cardExtrasHtml (r) {
  const media = spotMediaOf(r);
  const strip = media.length
    ? `<div class="card-media-strip">${media.slice(0, 4).map((m, i) => `<span class="cms-item"><img src="${escHtml(safeUrl(m.photo))}" alt="" loading="lazy" />${m.video ? '<span class="video-badge small" aria-hidden="true">▶</span>' : ''}${i === 3 && media.length > 4 ? `<span class="cms-more">+${media.length - 4}</span>` : ''}</span>`).join('')}</div>`
    : '';
  const note = String(r.notes || '').trim();
  return strip
    + (note ? `<div class="card-note">“${escHtml(note.length > 110 ? `${note.slice(0, 107)}…` : note)}”</div>` : '')
    + linkChipsHtml(r);
}

/* ── Who's been here: friends at the top of a spot, and "Go with a friend" ── */
function renderDetailFriends (r) {
  const el = document.getElementById('detail-friends');
  if (!el) return;
  const tips = friendTipsFor(r);
  el.classList.toggle('hidden', !tips.length);
  if (!tips.length) { el.innerHTML = ''; return; }
  const been = tips.filter(t => t.rating || t.get.length || t.skip.length);
  const wants = tips.filter(t => !been.includes(t) && t.wants.length);
  const names = list => list.map(t => escHtml(t.name));
  const join = list => list.length <= 2 ? list.join(' and ') : `${list.slice(0, 2).join(', ')} and ${list.length - 2} more`;
  const lines = [];
  if (been.length) lines.push(`<strong>${join(names(been))}</strong> ${been.length === 1 ? 'has' : 'have'} been here${been.length === 1 && been[0].rating ? ` <span class="yo-dish-stars">${'★'.repeat(been[0].rating)}</span>` : ''}`);
  if (wants.length) lines.push(`<strong>${join(names(wants))}</strong> ${wants.length === 1 ? 'wants' : 'want'} to try it too`);
  el.innerHTML = `<div class="df-avatars" aria-hidden="true">${tips.slice(0, 3).map(t => `<span>${escHtml((t.name || '?').charAt(0).toUpperCase())}</span>`).join('')}</div>
    <div class="df-text">${lines.join('<br>')}</div>
    <button type="button" class="btn-sm btn-primary df-go">Go together</button>`;
  el.querySelector('.df-go').addEventListener('click', () => askFriendToGo(r, tips[0]?.name));
}

// A ready-to-send "want to go?" with the spot, a friend's tip, and a map link.
async function askFriendToGo (r, friendName = '') {
  const tip = orderPicksFor(r).get[0];
  const map = buildGoogleDirectionsUrl({ name: r.name, address: r.address || '', lat: r.lat, lon: r.lng }) || '';
  const text = [
    `${friendName ? `${friendName}, want` : 'Want'} to go to ${r.name} together?${r.cuisine ? ` (${r.cuisine})` : ''}`,
    tip ? `I hear the ${tip.name} is the move.` : '',
    map,
  ].filter(Boolean).join(' ');
  trackProductEvent('go_together', { restaurantId: r.id, withFriend: !!friendName });
  try {
    if (navigator.share) { await navigator.share({ title: `Let's go to ${r.name}`, text }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); showToast('Copied!', 'Paste it to a friend.', 'success'); }
  catch { window.prompt('Send this to a friend:', text); }
}

/* ── Share moments: right after you log a meal ── */
function offerShareMeal ({ r, dish = '', verdict = '', photo = '', note = '' }) {
  if (!window.StoryCard || (!photo && !dish)) return;
  document.querySelector('.share-nudge')?.remove();
  const el = document.createElement('div');
  el.className = 'share-nudge';
  el.setAttribute('role', 'status');
  el.innerHTML = `${safeUrl(photo) ? `<img src="${escHtml(safeUrl(photo))}" alt="" />` : '<span class="sn-emoji" aria-hidden="true">📸</span>'}
    <span class="sn-text"><strong>Share this meal?</strong><span>Make a Story card for Instagram, TikTok and more</span></span>
    <button type="button" class="btn-sm btn-primary sn-go">Share</button>
    <button type="button" class="sn-x" aria-label="Not now">✕</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const hide = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); };
  const timer = setTimeout(hide, 9000);
  el.querySelector('.sn-x').addEventListener('click', () => { clearTimeout(timer); hide(); });
  el.querySelector('.sn-go').addEventListener('click', async () => {
    clearTimeout(timer); hide();
    trackProductEvent('share_meal_clicked', { hasPhoto: !!photo });
    const kicker = verdict === 'again' ? 'Order this again' : verdict === 'skip' ? 'Skip this one' : 'Just ate';
    const text = `${dish ? `${dish} at ${r.name}` : `Just ate at ${r.name}`}${verdict === 'again' ? ' — 10/10 would order again' : ''}. Saved with Feed The Bear https://www.feed-the-bear.com`;
    try {
      await StoryCard.openStory({
        kind: 'meal', kicker, title: dish || r.name, sub: dish ? `at ${r.name}` : (r.cuisine || ''), photo,
        stars: r.myRating || 0,
        sections: note ? [{ label: 'Note to self', items: [note], tone: 'soft' }] : [],
      }, text, `${r.name}-${dish || 'meal'}`);
    } catch (err) { console.warn('[FTB] meal card failed:', err); }
  });
}

// Your verdicts and your friends' tips tallied into one answer per dish.
// An "order again" outweighs a friend's "get", and any skip pulls a dish down.
function orderPicksFor (r) {
  const tally = new Map();
  const vote = (name, pts, who, skip = false) => {
    const key = dishKey(name);
    if (!key) return;
    const t = tally.get(key) || { name: String(name).trim(), score: 0, fans: [], skippers: [] };
    t.score += pts;
    if (skip) { if (!t.skippers.includes(who)) t.skippers.push(who); }
    else if (pts > 0 && !t.fans.includes(who)) t.fans.push(who);
    tally.set(key, t);
  };
  dishesOf(r).forEach(d => {
    if (d.verdict === 'again') vote(d.name, 3, 'you');
    else if (d.verdict === 'ok') vote(d.name, (d.rating || 0) >= 4 ? 1.5 : 0.5, 'you');
    else if (d.verdict === 'skip') vote(d.name, -3, 'you', true);
  });
  friendTipsFor(r).forEach(t => {
    t.get.forEach(n => vote(n, 2, t.name));
    t.skip.forEach(n => vote(n, -2, t.name, true));
    t.wants.forEach(n => vote(n, 0.5, t.name));
  });
  // What Google reviewers keep recommending (Grizzly; loadReviewDishes).
  (r?.reviewDishes || []).forEach(d => vote(d.name, Math.min(2, d.n * 0.75), `${d.n} review${d.n > 1 ? 's' : ''}`));
  const all = [...tally.values()];
  return {
    get: all.filter(t => t.score > 0 && t.fans.length).sort((a, b) => b.score - a.score || b.fans.length - a.fans.length),
    skip: all.filter(t => t.score < 0).sort((a, b) => a.score - b.score),
  };
}

function whoSaid (names) {
  if (names.length <= 2) return names.join(' + ');
  return `${names.slice(0, 2).join(', ')} + ${names.length - 2} more`;
}

// The one-line answer to "what should I get here?". Only shown once friends
// or reviewers weigh in; your own verdicts alone are already grouped right below it.
function bestBetHtml (r) {
  if (!friendTipsFor(r).length && !(r?.reviewDishes || []).length) return '';
  const { get, skip } = orderPicksFor(r);
  if (!get.length && !skip.length) return '';
  const top = get[0];
  const also = get.slice(1, 3);
  return `<div class="yo-best-bet" id="yo-best-bet">
    ${top ? `<div class="ybb-top"><span class="ybb-label">Best bet</span> <strong>${escHtml(top.name)}</strong> <span class="ybb-who">${escHtml(whoSaid(top.fans))}</span></div>` : ''}
    ${also.length ? `<div class="ybb-also">Also good: ${also.map(t => escHtml(t.name)).join(', ')}</div>` : ''}
    ${skip.length ? `<div class="ybb-skip">Heads up: skip the ${skip.slice(0, 2).map(t => `${escHtml(t.name)} <span class="ybb-who">(${escHtml(whoSaid(t.skippers))})</span>`).join(', ')}</div>` : ''}
  </div>`;
}
function openFoodieProfile () {
  const data = buildProfileData();
  if (!profileHasContent(data)) {
    showToast('Nothing to share yet', 'Rate a spot or log a dish first to build your profile.', 'error');
    return;
  }
  const url = encodeProfileLink(data);
  document.getElementById('profile-link').value = url;

  // The QR code carries the short follow link (the full profile is usually
  // too long for a camera to read); the picks arrive live once they follow.
  startSharingLive();
  const qrOk = drawQr(document.getElementById('profile-qr'), buildFollowLink());
  document.getElementById('profile-qr-wrap')?.classList.toggle('hidden', !qrOk);

  // Profile preview
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('profile-preview').innerHTML = data.picks.map((p,i) =>
    '<div class="profile-preview-item">'
    + '<span class="pp-rank">' + (medals[i]||'') + '</span>'
    + '<span class="pp-name">' + escHtml(p.n) + '</span>'
    + (p.c ? '<span style="font-size:.72rem;color:var(--text-dim)">' + escHtml(p.c) + '</span>' : '')
    + '<span class="pp-stars">' + '★'.repeat(p.r) + '</span>'
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

// Opened a friend's link (#profile=). Signed out, the sign-in sheet comes
// first (and says who invited them), so the link waits here until they're in.
// From an invite (?accept / ?i=), accepting it follows the friend for them.
const PENDING_INVITE_KEY = 'ftb_pending_invite_v1';
function pendingInvite () {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_INVITE_KEY) || 'null');
    return p?.data && Date.now() - (p.at || 0) < 7 * 86400000 ? p : null;
  } catch { return null; }
}
window.pendingInviteName = () => pendingInvite()?.data?.u || '';

function checkGuestProfile () {
  const hash = window.location.hash;
  if (!hash.startsWith('#profile=')) { resumePendingInvite(); return; }
  let data;
  try { data = decodeProfileLink(hash); } catch { return; /* invalid link: ignore */ }
  const params = new URLSearchParams(window.location.search);
  const accept = params.has('accept') || params.has('i');
  try {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ data, accept, at: Date.now() }));
    if (data.u) localStorage.setItem('ftb_invited_by_v1', data.u);
  } catch { /* private mode: shown right away below if we can */ }
  params.delete('accept');
  const rest = params.toString();
  history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  if (!pendingInvite()) { _guestShow(data, { accept }); return; }
  resumePendingInvite();
}

function resumePendingInvite () {
  const p = pendingInvite();
  if (!p) return;
  if (typeof _signInRequired === 'function' && _signInRequired()) {
    // The sign-in sheet is up: make sure it names who invited them.
    const sub = document.querySelector('#auth-overlay.auth-required .auth-sub');
    if (sub && typeof _requiredAuthSub === 'function') sub.textContent = _requiredAuthSub();
    return;
  }
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch { /* private mode */ }
  _guestShow(sanitizeFriendData(p.data), { accept: !!p.accept });
}
window.resumePendingInvite = resumePendingInvite;

function _guestShow (data, { accept = false } = {}) {
  if (data.id && data.id === state.settings.profileShareId) return; // your own link
  // Accepting an invite follows them, unless that needs Grizzly (then they get the button).
  const premium = typeof isPremium === 'function' && isPremium();
  if (accept && !isFollowing(data) && (premium || getFriends().length < FREE_FRIENDS)) followFriend(data, { quiet: true });
  if (isFollowing(data)) refreshFriendsLive(true);
  openFriendSpots(data, { invited: accept });
}

// A friend's spots in one list: their top picks, then what they've been up to.
// Any spot can be missing a name (old data, a half-saved add): never crash on it.
const spotKey = name => normalizeName(String(name ?? ''));
function friendSpotItems (data, recent = []) {
  const seen = new Set();
  const out = [];
  const add = x => {
    if (!x) return;
    const k = spotKey(x.n);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(x);
  };
  (data?.picks || []).forEach(p => add({ n: p.n, c: p.c, a: p.a, r: p.r, p: p.p, g: p.g || [], d: p.g?.[0] || '' }));
  (recent || []).forEach(x => add({ n: x.n, c: x.c, a: x.a, r: x.r, p: '', g: x.d ? [x.d] : [], d: x.d || '' }));
  return out;
}
function onMyList (name) {
  const k = spotKey(name);
  return !!k && (state.restaurants || []).some(r => r && spotKey(r.name) === k);
}
function friendNewSpots (entry) {
  return friendSpotItems(entry?.data, entry?.recent).filter(x => !onMyList(x.n));
}

// "Connie's spots": add any of them to your Want to Try with one tap, or all at once.
function openFriendSpots (data, { invited = false } = {}) {
  if (!data) return;
  const overlay = document.getElementById('guest-profile-overlay');
  const list = document.getElementById('guest-profile-list');
  if (!overlay || !list) return;
  const who = data.u || 'Your friend';
  const entry = getFriends().find(f => f.key === friendKey(data));
  const items = friendSpotItems(entry?.data?.picks?.length ? entry.data : data, entry?.recent);
  let ref = false;
  try { ref = !!localStorage.getItem('ftb_ref_v1'); } catch { /* private mode */ }
  const medals = ['🥇', '🥈', '🥉'];

  const draw = () => {
    const following = isFollowing(data);
    const fresh = items.filter(x => !onMyList(x.n));
    document.getElementById('guest-profile-name').textContent = invited ? `${who} invited you 🐻` : `${who}'s spots`;
    document.getElementById('guest-profile-sub').textContent = (following
      ? (items.length
        ? `You're following ${who}. Tap ＋ Add on any spot to put it on your Want to Try list.`
        : `You're following ${who}.`)
      : `Follow ${who} to see where they eat and what they order.`)
      + (invited && ref ? ' You also get 30 days of Grizzly free.' : '');
    list.innerHTML = !items.length
      ? `<div class="guest-empty">${escHtml(who)} is just getting started. As they save spots, they'll show up on your home screen under Friends' Feed, ready to add to your list.</div>`
      : items.map((p, i) => {
        const have = onMyList(p.n);
        const photo = safeUrl(p.p || '');
        return `<div class="guest-item">
          <div class="guest-item-photo">${/^https?:/i.test(photo) ? `<img src="${escHtml(photo)}" alt="" />` : (cuisineEmoji(p.c) || '🍽️')}</div>
          <div class="guest-item-body">
            <div class="guest-item-name">${medals[i] && p.r ? medals[i] + ' ' : ''}${escHtml(p.n)}</div>
            <div class="guest-item-meta">${escHtml(p.c || 'Restaurant')}${p.a ? ' · ' + escHtml(p.a.slice(0, 40)) : ''}${p.r ? ` <span class="guest-item-stars">${'★'.repeat(p.r)}</span>` : ''}</div>
            ${p.g.length ? `<div class="guest-item-order">Get: ${p.g.map(escHtml).join(', ')}</div>` : ''}
          </div>
          ${have
            ? '<span class="guest-have">✓ On your list</span>'
            : `<button type="button" class="btn-sm btn-orange guest-add" data-i="${i}">＋ Add</button>`}
        </div>`;
      }).join('');
    list.querySelectorAll('.guest-add').forEach(b => b.addEventListener('click', () => {
      if (saveFromFriend({ ...items[Number(b.dataset.i)], who: { name: who } }, { quiet: true })) {
        renderAll();
        draw();
      }
    }));
    const followBtn = document.getElementById('guest-profile-follow');
    followBtn.classList.toggle('hidden', following);
    followBtn.textContent = `Follow ${who}`;
    followBtn.disabled = false;
    followBtn.onclick = () => { if (followFriend(data)) { refreshFriendsLive(true); draw(); } };
    const allBtn = document.getElementById('guest-profile-addall');
    allBtn.classList.toggle('hidden', fresh.length < 2);
    allBtn.textContent = `＋ Add all ${fresh.length} to my Want to Try`;
    allBtn.onclick = () => {
      let added = 0;
      for (const x of fresh) {
        if (!saveFromFriend({ ...x, who: { name: who } }, { quiet: true, bulk: true })) break;
        added++;
      }
      if (added) {
        renderAll();
        showToast(`Added ${added} spot${added === 1 ? '' : 's'} from ${who}`, 'They\'re on your Want to Try list.', 'success');
        trackProductEvent('friend_spots_added_all', { count: added });
      }
      draw();
    };
    document.getElementById('guest-profile-close').textContent = invited && !(state.restaurants || []).length ? "Let's go" : 'Done';
  };
  draw();
  overlay.classList.remove('hidden');
  document.body.classList.add('guest-open');
  overlay.scrollTop = 0;
  trackProductEvent('friend_spots_opened', { invited, count: items.length });
  document.getElementById('guest-profile-close').onclick = () => {
    overlay.classList.add('hidden');
    document.body.classList.remove('guest-open');
    // The Cub welcome underneath was drawn before we knew the inviter's name.
    const hi = document.querySelector('#cub-welcome[data-step="hi"] .cw-body');
    if (hi && data.u) hi.textContent = hi.textContent.replace(/^A friend invited you!/, `${data.u} invited you!`);
    renderFriendsFeedHome();
    if (!document.getElementById('friends-overlay')?.classList.contains('hidden')) renderFriendsList();
  };
}
window.openFriendSpots = openFriendSpots;

/* ------------------------------------------------------------
   PHASE 8 • ❤ FOODIE FRIENDS
   ------------------------------------------------------------ */

/* ── Friends screen: what's going on ─────────────────────────
   Friends' latest bites up top, a 30-day "who ate out most" board, and a
   card per friend: taste match, their best picks, places you both want or
   they loved from your list, and their Bear Cave page (or a nudge to make one). */
let _friendPages = {};      // share id → public username
let _friendPagesFor = '';
async function loadFriendPages () {
  const ids = getFriends().map(f => f.data?.id).filter(Boolean);
  const sig = ids.join(',');
  if (!window._ftbUid || !ids.length || sig === _friendPagesFor) return;
  _friendPagesFor = sig;
  try {
    const { ok, data } = await handleApi('GET', { query: `?pagesOf=${encodeURIComponent(sig)}` });
    if (ok && data.pages) { _friendPages = data.pages; renderFriendsList(); }
  } catch { _friendPagesFor = ''; }
}

const fxCuisine = c => String(c || '').toLowerCase().trim();
// How much your tastes overlap: cuisines you've both rated well, plus any
// restaurant you both love. null until each of you has a few to compare.
function tasteMatch (f) {
  const mine = new Set((state.restaurants || []).filter(r => r.status === 'visited' && (r.myRating || 0) >= 3).map(r => fxCuisine(r.cuisine)).filter(Boolean));
  const picks = f.data?.picks || [];
  const theirs = new Set(picks.filter(p => (p.r || 0) >= 3).map(p => fxCuisine(p.c)).filter(Boolean));
  if (mine.size < 2 || theirs.size < 2) return null;
  const both = [...mine].filter(c => theirs.has(c)).length;
  const myLoves = new Set((state.restaurants || []).filter(r => (r.myRating || 0) >= 4).map(r => normalizeName(r.name)));
  const sameSpots = picks.filter(p => (p.r || 0) >= 4 && myLoves.has(normalizeName(p.n))).length;
  return Math.min(99, Math.round(100 * both / Math.min(mine.size, theirs.size) * 0.85 + sameSpots * 8));
}

// Spots on your Want to Try list that this friend rated 4+, or wants too.
function friendOverlap (f) {
  const want = (state.restaurants || []).filter(r => r.status === 'want-to-try');
  const byName = new Map(want.map(r => [normalizeName(r.name), r]));
  const loved = (f.data?.picks || []).filter(p => (p.r || 0) >= 4 && byName.has(normalizeName(p.n))).map(p => ({ r: byName.get(normalizeName(p.n)), stars: p.r }));
  const theyWant = new Set([...(f.data?.w || []).map(w => w.at), ...(f.recent || []).filter(x => x.k === 'save').map(x => x.n)].filter(Boolean).map(normalizeName));
  const both = want.filter(r => theyWant.has(normalizeName(r.name)) && !loved.some(l => l.r.id === r.id));
  return { loved, both };
}

// Places eaten in the last 30 days: you and each friend (from their live activity).
function friendsBoard () {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const count = list => new Set(list.filter(x => (x.k === 'visit' || x.k === 'dish') && String(x.at || '') >= since).map(x => normalizeName(x.n))).size;
  const rows = getFriends().map(f => ({ name: f.name, av: f.av, n: count(f.recent || []) }));
  const mineVisits = new Set();
  (state.restaurants || []).forEach(r => {
    const dates = [...(r.visits || []).map(v => v.date), r.dateVisited].filter(Boolean).map(d => String(d).slice(0, 10));
    if (dates.some(d => d >= since)) mineVisits.add(r.id);
  });
  const me = (typeof loadUserProfile === 'function' && loadUserProfile()) || {};
  rows.push({ name: 'You', av: me.avatar, n: mineVisits.size, me: true });
  return rows.filter(r => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
}

function friendsPulseHtml (feed) {
  const mine = new Map((state.restaurants || []).map(r => [normalizeName(r.name), r]));
  const feedHtml = feed.length ? `<div class="friends-section-title">Lately</div><div class="fx-feed">${feed.map((x, i) => {
    const who = `<strong>${escHtml(x.who.name)}</strong>`;
    const at = `<strong>${escHtml(x.n)}</strong>`;
    const line = x.k === 'dish' && x.d ? `${who} would get the <strong>${escHtml(x.d)}</strong> again at ${at}`
      : x.k === 'save' ? `${who} wants to try ${at}`
      : `${who} ate at ${at}${x.r ? ` <span class="ff-stars">${'★'.repeat(x.r)}</span>` : ''}`;
    const have = mine.get(normalizeName(x.n));
    return `<div class="ff-item"><span class="ff-avatar" aria-hidden="true">${avatarSvg(x.who.av)}</span>
      <span class="ff-text">${line}<span class="ff-meta">${escHtml([`${cuisineEmoji(x.c)} ${x.c || ''}`.trim(), feedAgo(x.at)].filter(Boolean).join(' · '))}</span></span>
      ${have ? `<button type="button" class="btn-ghost btn-sm fx-view" data-id="${escHtml(have.id)}">View</button>`
        : `<button type="button" class="btn-sm btn-orange fx-save" data-i="${i}">＋ Save</button>`}</div>`;
  }).join('')}</div>` : '';
  const board = friendsBoard();
  const boardHtml = board.length > 1 ? `<div class="friends-section-title">Who ate out most · 30 days</div><ol class="fx-board">${board.map((r, i) => `
    <li class="${r.me ? 'fx-me' : ''}"><span class="fx-rank">${['🥇', '🥈', '🥉'][i] || i + 1}</span><span class="ff-avatar" aria-hidden="true">${avatarSvg(r.av)}</span>
      <span class="fx-board-name">${escHtml(r.name)}</span><span class="fx-board-n">${r.n} place${r.n === 1 ? '' : 's'}</span></li>`).join('')}</ol>` : '';
  return feedHtml + boardHtml;
}

function friendCardHtml (f, { waiting = false } = {}) {
  const picks = [...(f.data?.picks || [])].sort((a, b) => (b.r || 0) - (a.r || 0));
  const orders = picks.reduce((n, p) => n + (p.g?.length || 0), 0);
  const match = tasteMatch(f);
  const fresh = friendNewSpots(f).length;
  const { loved, both } = friendOverlap(f);
  const page = f.data?.id ? _friendPages[f.data.id] : '';
  const first = String(f.name || 'Friend').split(/\s+/)[0];
  const top = picks.slice(0, 3).map(p => `<li><span aria-hidden="true">${cuisineEmoji(p.c)}</span> ${escHtml(p.n)}${p.r ? ` <span class="ff-stars">${'★'.repeat(p.r)}</span>` : ''}${p.g?.[0] ? `<small>get the ${escHtml(p.g[0])}</small>` : ''}</li>`).join('');
  const overlap = loved[0]
    ? `<div class="fx-overlap">💛 ${escHtml(first)} gave <strong>${escHtml(loved[0].r.name)}</strong> ${'★'.repeat(loved[0].stars)}. It's on your list.
        <button type="button" class="btn-sm btn-orange fx-plan" data-key="${escHtml(f.key)}" data-id="${escHtml(loved[0].r.id)}">Plan it</button></div>`
    : both[0]
      ? `<div class="fx-overlap">🤝 You both want to try <strong>${escHtml(both[0].name)}</strong>.
        <button type="button" class="btn-sm btn-orange fx-plan" data-key="${escHtml(f.key)}" data-id="${escHtml(both[0].id)}">Plan it</button></div>`
      : '';
  return `<div class="fx-card">
    <div class="fx-head"><span class="fx-avatar" aria-hidden="true">${avatarSvg(f.av)}</span>
      <span class="fx-who"><strong>${escHtml(f.name)}</strong>
        <span>${picks.length} spot${picks.length === 1 ? '' : 's'} · ${orders} go-to order${orders === 1 ? '' : 's'}${(f.data?.w || []).length ? ` · ${(f.data.w).length} craving${f.data.w.length === 1 ? '' : 's'}` : ''}</span>
        ${waiting ? '<span class="friend-sent">Sent · waiting for them to follow back</span>' : ''}</span>
      ${match !== null ? `<span class="fx-match" title="How much your tastes overlap"><b>${match}%</b>taste match</span>` : ''}
      <button type="button" class="friend-remove icon-btn" data-key="${escHtml(f.key)}" aria-label="Unfollow ${escHtml(f.name)}">✕</button></div>
    ${top ? `<ul class="fx-picks">${top}</ul>` : `<p class="fx-quiet">${escHtml(first)} hasn't rated any spots yet.</p>`}
    ${overlap}
    <div class="fx-actions">
      <button type="button" class="btn-sm ${fresh ? 'btn-orange' : 'btn-ghost'} friend-spots" data-key="${escHtml(f.key)}">${fresh ? `${fresh} new spot${fresh === 1 ? '' : 's'}` : 'All their spots'}</button>
      ${page ? `<a class="btn-sm btn-ghost fx-page" href="/@${encodeURIComponent(page)}" target="_blank" rel="noopener">🐻 Bear Cave</a>`
        : f.data?.id ? `<button type="button" class="btn-sm btn-ghost fx-page-invite" data-key="${escHtml(f.key)}">Invite to make a Bear Cave page</button>` : ''}
    </div>
  </div>`;
}

// Ask a friend to claim their Bear Cave page: the link opens username setup.
async function inviteToBearCave (f) {
  const first = String(f?.name || '').split(/\s+/)[0];
  const url = 'https://www.feed-the-bear.com/app.html?action=page';
  const text = `${first ? `Hey ${first}! ` : ''}Your Feed The Bear spots deserve a home 🐻 Claim your Bear Cave page: one link (feed-the-bear.com/@you) with your top spots and what to order there, for your bio or to send around. Pick your username here:`;
  trackProductEvent('bear_cave_invite_sent');
  try {
    if (navigator.share) { await navigator.share({ title: 'Your Bear Cave page', text, url }); return; }
  } catch (err) { if (err?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); showToast('Copied', 'Paste it to them in a text.', 'success'); }
  catch { window.prompt('Send this to them:', `${text} ${url}`); }
}

function renderFriendsList () {
  const el = document.getElementById('friends-list');
  if (!el) return;
  renderFriendsStatus();
  const friends = getFriends();
  const following = new Set(friends.map(f => f.data?.id).filter(Boolean));
  const followers = _followers || [];
  const followersHtml = followers.length
    ? `<div class="friends-section-title">Following you (${followers.length})</div>` + followers.map((f, i) => `<div class="friend-row">
          <span class="friend-info"><strong>${escHtml(f.u)}</strong><span>${following.has(f.id) ? 'You follow each other' : 'Follows you'}</span></span>
          ${following.has(f.id)
            ? '<span class="friend-mutual" aria-label="You follow each other">✓</span>'
            : `<button type="button" class="btn-sm btn-orange friend-follow-back" data-i="${i}">Follow back</button>`}
        </div>`).join('')
    : '';
  // Someone you follow who hasn't followed back yet: your follow is "sent".
  const followerIds = new Set(followers.map(f => f.id));
  const followingHtml = friends.length
    ? `<div class="friends-section-title">Following (${friends.length})</div>` + friends.map(f => {
        try { return friendCardHtml(f, { waiting: _followers !== null && f.data?.id && !followerIds.has(f.data.id) }); }
        catch (err) { console.warn('[FTB] friend card:', err); return ''; }
      }).join('')
    : '';
  let feed = [];
  try { feed = friends.length ? friendsFeedItems() : []; } catch { feed = []; }
  let pulseHtml = '';
  try { pulseHtml = friends.length ? friendsPulseHtml(feed) : ''; } catch (err) { console.warn('[FTB] friends pulse:', err); }
  // Invites you sent: who it was for (kept on this phone) and how far it got.
  const local = getSentInvites();
  const localCodes = new Set(local.map(e => e.code).filter(Boolean));
  const invites = [...local, ..._serverInvites.filter(e => !localCodes.has(e.code))]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const shown = invites.slice(0, 15);
  const invitesHtml = invites.length
    ? `<div class="friends-section-title">Sent invites (${invites.length})</div>` + shown.map((e, i) => {
        const st = (e.code && _inviteStatus[e.code]) || {};
        const name = e.name || (st.joined ? st.u : '') || 'Invite';
        const when = fmtInviteDate(e.at);
        const line = st.joined
          ? `Joined${e.name && st.u ? ` as ${escHtml(st.u)}` : ''} · sent ${escHtml(when.toLowerCase())}`
          : st.opened ? `Opened the link · hasn't joined yet · sent ${escHtml(when.toLowerCase())}`
            : `Sent ${escHtml(when.toLowerCase())}${e.code ? ' · not opened yet' : ''}`;
        const badge = st.joined
          ? (following.has(st.id)
              ? '<span class="friend-mutual" aria-label="You follow them">✓</span>'
              : `<button type="button" class="btn-sm btn-orange friend-invite-follow" data-i="${i}">Follow back</button>`)
          : `<span class="invite-status invite-status-${st.opened ? 'opened' : 'sent'}">${st.opened ? 'Opened' : 'Sent'}</span>`;
        return `<div class="friend-row friend-invite-row">
          <span class="friend-info"><strong>${escHtml(name)}</strong><span>${line}</span></span>
          ${badge}
        </div>`;
      }).join('')
      + (invites.length > shown.length ? `<div class="friends-empty">and ${invites.length - shown.length} more</div>` : '')
    : '';
  el.innerHTML = pulseHtml + followingHtml + followersHtml + invitesHtml || (_followers === null && window._ftbUid
    ? '<div class="friends-empty">Loading your friends…</div>'
    : '<div class="friends-empty">No friends yet. Send an invite: when a friend joins from it, they show up here and you can follow each other.</div>'
      // Friends belong to an account: an empty list usually means a different (or new) one.
      + (window._ftbUserEmail
        ? `<div class="friends-empty friends-account">Signed in as <strong>${escHtml(window._ftbUserEmail)}</strong>. Had friends before? They're on the account you used then. Sign out (Account) and sign in with that one.</div>`
        : ''));
  el.querySelectorAll('.friend-spots').forEach(b => b.addEventListener('click', () => {
    const f = getFriends().find(x => x.key === b.dataset.key);
    if (f) openFriendSpots(f.data);
  }));
  el.querySelectorAll('.fx-save').forEach(b => b.addEventListener('click', () => { saveFromFriend(feed[Number(b.dataset.i)]); renderFriendsList(); }));
  el.querySelectorAll('.fx-view').forEach(b => b.addEventListener('click', () => { closeFoodieFriends(); openDetailModal(b.dataset.id); }));
  el.querySelectorAll('.fx-plan').forEach(b => b.addEventListener('click', () => {
    const f = getFriends().find(x => x.key === b.dataset.key);
    const r = (state.restaurants || []).find(x => x.id === b.dataset.id);
    if (r) askFriendToGo(r, String(f?.name || '').split(/\s+/)[0]);
  }));
  el.querySelectorAll('.fx-page-invite').forEach(b => b.addEventListener('click', () => inviteToBearCave(getFriends().find(x => x.key === b.dataset.key))));
  loadFriendPages();
  el.querySelectorAll('.friend-follow-back').forEach(b => b.addEventListener('click', () => {
    const f = followers[Number(b.dataset.i)];
    if (f && followFriend({ id: f.id, u: f.u, picks: [], w: [] })) {
      renderFriendsList();
      refreshFriendsLive(true);
      trackProductEvent('friend_followed_back');
    }
  }));
  el.querySelectorAll('.friend-invite-follow').forEach(b => b.addEventListener('click', () => {
    const st = _inviteStatus[shown[Number(b.dataset.i)]?.code];
    if (st?.id && followFriend({ id: st.id, u: st.u || 'Friend', picks: [], w: [] })) {
      renderFriendsList();
      refreshFriendsLive(true);
      trackProductEvent('friend_followed_back', { from: 'invite' });
    }
  }));
}

function openFoodieFriends () {
  // Open to everyone: a free account can follow one friend (followFriend
  // checks), so it needs this screen to find them. Inviting stays Grizzly.
  // Each part draws on its own: one bad record must never blank the whole screen.
  for (const step of [renderFriendsStatus, renderFriendsList, loadFollowers, loadInviteStatus, loadFollowing, noteExistingFollows, renderMyHandle, renderFriendsLiveNote, () => refreshFriendsLive(true)]) {
    try {
      const out = step();
      if (out && typeof out.catch === 'function') out.catch(err => console.warn('[FTB] friends:', err));
    } catch (err) { console.warn('[FTB] friends:', err); window.reportError?.(err); }
  }
  const found = document.getElementById('friends-find-result');
  if (found) found.innerHTML = '';
  document.getElementById('friends-link-input').value = '';
  document.getElementById('friends-result').classList.add('hidden');
  document.getElementById('friends-result').innerHTML = '';
  document.getElementById('friends-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open');
}
function openHandleSettings () {
  document.getElementById('handle-overlay')?.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  renderMyHandle();
}
function closeHandleSettings () {
  document.getElementById('handle-overlay')?.classList.add('hidden');
  maybeHideOverlay();
}
window.openHandleSettings = openHandleSettings;
window.closeHandleSettings = closeHandleSettings;

function closeFoodieFriends () {
  document.getElementById('friends-overlay').classList.add('hidden');
  maybeHideOverlay();
}

function loadFriendProfile () {
  const rawInput = document.getElementById('friends-link-input').value.trim();
  if (!rawInput) { showToast('Paste a link', 'Paste your friend\'s profile link first.', 'error'); return; }
  
  try {
    renderFriendComparison(decodeProfileLink(rawInput));
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

  const who = friendData.u || 'Your friend';
  let html = `<div class="friends-result">
    <div class="friend-follow-row"><strong>${escHtml(who)}</strong>
      <button type="button" class="btn-sm btn-orange friend-follow-btn">${isFollowing(friendData) ? 'Update' : 'Follow'}</button></div>`;

  const orders = friendData.picks.filter(p => p.g?.length);
  if (orders.length) {
    html += `<div class="friends-section-title">Their go-to orders</div>`;
    html += orders.slice(0, 6).map(p => `<div class="friends-overlap-item"><strong>${escHtml(p.n)}</strong>: get the ${p.g.map(escHtml).join(', ')}${p.s?.length ? ` · skip the ${p.s.map(escHtml).join(', ')}` : ''}</div>`).join('');
  }
  const myCraves = new Set();
  state.restaurants.forEach(r => dishesOf(r).forEach(d => { if (d.verdict === 'want') myCraves.add(dishKey(d.name)); }));
  const bothCrave = (friendData.w || []).filter(x => myCraves.has(dishKey(x.d)));
  if (bothCrave.length) {
    html += `<div class="friends-section-title">You both want to try</div>`;
    html += bothCrave.map(x => `<div class="friends-overlap-item">${escHtml(x.d)}${x.at ? ` · ${escHtml(x.at)}` : ''}</div>`).join('');
  } else if ((friendData.w || []).length) {
    html += `<div class="friends-section-title">On their Crave List</div>`;
    html += friendData.w.slice(0, 5).map(x => `<div class="friends-overlap-item">${escHtml(x.d)}${x.at ? ` · ${escHtml(x.at)}` : ''}</div>`).join('');
  }

  // Overlap section
  if (overlap.length) {
    html += `<div class="friends-overlap">
      <div class="friends-overlap-title">❤ You both love these (${overlap.length})</div>
      ${overlap.map(p => `<div class="friends-overlap-item">${cuisineEmoji(p.c)} ${escHtml(p.n)} · you: ${'★'.repeat(p.r)}</div>`).join('')}
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
        <div class="friends-pick-stars">${'★'.repeat(p.r)}</div>
        <button class="btn-sm btn-orange" onclick="openAddModalPreFilled('${escJsArg(p.n)}','${escJsArg(p.c||'')}')">Add +</button>
      </div>`).join('');
  }
  html += '</div>';

  const resultEl = document.getElementById('friends-result');
  resultEl.innerHTML = html;
  resultEl.classList.remove('hidden');
  resultEl.querySelector('.friend-follow-btn')?.addEventListener('click', e => {
    if (followFriend(friendData)) { e.target.textContent = 'Following'; e.target.disabled = true; renderFriendsList(); }
  });
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

/* ── Usernames (api/handle.js) ───────────────────────────────
   Opt-in: you're findable only once you pick a username. Search is an exact
   match, so nobody can browse who's on the app. */
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
let _myHandle = null;
let _myHandleFor = '';

async function handleApi (method, { query = '', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(typeof ftbApiHeaders === 'function' ? await ftbApiHeaders() : {}) };
  const resp = await fetch(`/api/handle${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// The link printed on share images: your public page when it's on, else the site.
async function myShareLink () {
  const site = 'feed-the-bear.com';
  if (!window._ftbUid) return site;
  if (_myHandleFor !== window._ftbUid || _myHandle === null) {
    try {
      const { ok, data } = await handleApi('GET', { query: '?mine=1' });
      if (ok) {
        _myHandleFor = window._ftbUid;
        _myHandle = data.handle || '';
        _myPage = { public: !!data.public, views: Number(data.views) || 0, joins: Number(data.joins) || 0, earnedCents: Number(data.earnedCents) || 0, owedCents: Number(data.owedCents) || 0 };
      }
    } catch { /* offline: the site */ }
  }
  return _myHandle && _myPage?.public ? `${site}/@${_myHandle}` : site;
}
window.myShareLink = myShareLink;

// Your username and public page show in Friends and in Settings (Account).
async function renderMyHandle () {
  const boxes = ['friends-handle', 'settings-handle'].map(id => document.getElementById(id)).filter(Boolean);
  if (!boxes.length) return;
  if (!window._ftbUid) {
    boxes.forEach(box => { box.innerHTML = '<div class="my-page"><strong>Sign in to pick your username</strong><span>Your username and public page belong to your account.</span></div>'; });
    return;
  }
  if (_myHandleFor !== window._ftbUid) { _myHandle = null; _myHandleFor = window._ftbUid; }
  let failed = '';
  if (_myHandle === null) {
    boxes.forEach(box => { if (!box.innerHTML.trim()) box.innerHTML = '<span class="my-handle-loading">Loading your username…</span>'; });
    try {
      const { ok, status, data } = await handleApi('GET', { query: '?mine=1' });
      if (!ok) throw new Error(data.error || `error ${status}`);
      _myHandle = data.handle || '';
      _myPage = { public: !!data.public, views: Number(data.views) || 0, joins: Number(data.joins) || 0, earnedCents: Number(data.earnedCents) || 0, owedCents: Number(data.owedCents) || 0 };
    } catch (err) { failed = err.message || 'no connection'; }
  }
  boxes.forEach(box => {
    if (failed) {
      box.innerHTML = `<div class="friends-load-error">Your username didn't load (${escHtml(failed)}). <button type="button" class="link-btn my-handle-retry">Try again</button></div>`;
      box.querySelector('.my-handle-retry').onclick = () => renderMyHandle();
      return;
    }
    box.innerHTML = (_myHandle
      ? `Friends can find you as <strong>@${escHtml(_myHandle)}</strong> · <button type="button" class="link-btn friends-handle-edit">Change</button>`
      : `<button type="button" class="btn-sm btn-orange friends-handle-edit">Pick your username</button> <span class="my-handle-hint">so friends can find you and you get a page link for TikTok.</span>`)
      + myPageHtml();
    box.querySelector('.friends-handle-edit').onclick = () => editMyHandle(box);
    wireMyPage(box);
  });
}

/* ── Your public page (api/creator.js): feed-the-bear.com/@you ──
   For a TikTok or Instagram bio. Off until you turn it on. */
let _myPage = { public: false, views: 0, joins: 0 };
function myPageUrl () { return `https://www.feed-the-bear.com/@${_myHandle}`; }
function myPageHtml () {
  const intro = '<strong>Your public page</strong><span>Put a link in your TikTok or Instagram bio. Anyone can see your top spots and what to order, then join free and follow you. When someone who joined goes Grizzly, you get a free month.</span>';
  if (!_myHandle) return `<div class="my-page">${intro}<span class="my-page-note">Pick your username first (button above), then you can turn your page on.</span></div>`;
  if (!_myPage.public) {
    return `<div class="my-page">${intro}
      <button type="button" class="btn-sm btn-orange my-page-on">Turn on my page</button></div>`;
  }
  const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;
  return `<div class="my-page is-on">
      <strong>Your public page is on</strong>
      <a class="my-page-link" href="${escHtml(myPageUrl())}" target="_blank" rel="noopener">feed-the-bear.com/@${escHtml(_myHandle)}</a>
      <span class="my-page-stats">${n(_myPage.views, 'visit', 'visits')} · ${n(_myPage.joins, 'person joined', 'people joined')}</span>
      <span class="my-page-earn">${_myPage.earnedCents
        ? `💰 You've earned <b>$${(_myPage.earnedCents / 100).toFixed(2)}</b>${_myPage.owedCents ? ` ($${(_myPage.owedCents / 100).toFixed(2)} on its way)` : ''}`
        : '💰 Earn 20% of what anyone who joins from your link pays for Grizzly, for as long as they stay.'}</span>
      <div class="my-page-actions">
        <button type="button" class="btn-sm btn-orange my-page-copy">Copy link</button>
        <button type="button" class="btn-sm btn-ghost my-page-share">Share</button>
        <button type="button" class="btn-sm btn-ghost my-page-off">Turn off</button>
      </div>
    </div>`;
}
function wireMyPage (box) {
  const setPublic = async on => {
    if (on) {
      if (!ensureInviteName()) return;
      // The page shows your live profile, so it needs to be published.
      startSharingLive();
      if (typeof fbPublishFriendProfile === 'function') await fbPublishFriendProfile();
    }
    const { ok, data } = await handleApi('POST', { body: { action: 'publicPage', on } });
    if (!ok) { showToast('Could not do that', data.error || 'Please try again.', 'error'); return; }
    _myPage.public = !!data.public;
    trackProductEvent(on ? 'public_page_on' : 'public_page_off');
    if (on) showToast('Your page is live', 'Copy the link and put it in your bio.', 'success');
    renderMyHandle();
  };
  box.querySelector('.my-page-on')?.addEventListener('click', () => setPublic(true));
  box.querySelector('.my-page-off')?.addEventListener('click', () => setPublic(false));
  box.querySelector('.my-page-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(myPageUrl()); showToast('Link copied', 'Paste it in your TikTok or Instagram bio.', 'success'); }
    catch { window.prompt('Copy your page link:', myPageUrl()); }
    trackProductEvent('public_page_copied');
  });
  box.querySelector('.my-page-share')?.addEventListener('click', async () => {
    trackProductEvent('public_page_shared');
    if (!navigator.share) { box.querySelector('.my-page-copy')?.click(); return; }
    try { await navigator.share({ title: 'My food spots', text: 'Where I eat and what to order:', url: myPageUrl() }); }
    catch { /* closed the share sheet */ }
  });
}

function editMyHandle (box = document.getElementById('friends-handle')) {
  box.innerHTML = `<form class="friends-find-row friends-handle-form">
      <input class="form-input" placeholder="your_name" value="${escHtml(_myHandle || '')}" maxlength="20" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Your username" />
      <button type="submit" class="btn-sm btn-orange">Save</button>
    </form><div class="friends-handle-msg"></div>`;
  const input = box.querySelector('input');
  input.focus();
  box.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const handle = input.value.trim().replace(/^@/, '').toLowerCase();
    const msg = box.querySelector('.friends-handle-msg');
    if (!HANDLE_RE.test(handle)) { msg.textContent = 'Use 3 to 20 letters, numbers or _.'; return; }
    if (!ensureInviteName()) return;
    // Your username points at your live profile, so followers get your picks.
    startSharingLive();
    const me = (typeof loadUserProfile === 'function' && loadUserProfile()) || {};
    const { ok, data } = await handleApi('POST', { body: { action: 'claim', handle, id: getProfileShareId(), name: me.name || '' } });
    if (!ok) { msg.textContent = data.error || 'Could not save that. Please try again.'; return; }
    _myHandle = data.handle;
    trackProductEvent('username_claimed');
    showToast('Username saved', `Friends can find you as @${_myHandle}.`, 'success');
    renderMyHandle();
  };
}

async function findFriendByHandle (raw) {
  const box = document.getElementById('friends-find-result');
  const handle = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  if (!box) return;
  if (!HANDLE_RE.test(handle)) { box.textContent = 'Usernames are 3 to 20 letters, numbers or _.'; return; }
  box.textContent = 'Looking…';
  const { ok, data } = await handleApi('GET', { query: `?q=${encodeURIComponent(handle)}` });
  if (!ok) { box.textContent = data.error || 'Could not look that up right now.'; return; }
  if (!data.found) { box.textContent = data.self ? "That's you!" : `No one is using @${handle} yet. Check the spelling, or send them your QR code.`; return; }
  const friend = { id: data.id, u: data.u, picks: [], w: [] };
  const already = isFollowing(friend);
  box.innerHTML = `<div class="friends-find-hit"><strong>${escHtml(data.u)}</strong> <span>@${escHtml(handle)}</span>
    <button type="button" class="btn-sm btn-primary friends-find-follow"${already ? ' disabled' : ''}>${already ? 'Following' : 'Follow'}</button></div>`;
  box.querySelector('.friends-find-follow').onclick = e => {
    if (followFriend(friend)) {
      e.target.textContent = 'Following';
      e.target.disabled = true;
      trackProductEvent('friend_found_by_username');
      renderFriendsList();
      refreshFriendsLive(true);
    }
  };
}
