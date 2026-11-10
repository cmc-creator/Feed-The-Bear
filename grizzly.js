/* ════════════════════════════════════════════════════════════
   Feed The Bear - Grizzly: the plan checks (hasGrizzly, grizzlyLocked),
   upgrade pitches, the free-spot count and the trial reminder.
   Moved out of app.js as-is. Loads right after app.js (classic scripts
   share one global scope, and the app starts on DOMContentLoaded, after
   every script has run), so names here and in app.js work both ways.
   ════════════════════════════════════════════════════════════ */

'use strict';

/* ── Grizzly upsells ─────────────────────────────────────────
   Locked features used to answer "AI unavailable" and stop. Each one now
   pitches what you'd get and opens the upgrade screen, and free users see
   where Grizzly lives (header pill, home card, badges on locked tools). */
const GRIZZLY_PITCH = {
  general:     { title: 'Go Grizzly', body: 'Unlimited spots, Byte Cub AI picks, Year in Review, and 15-second food videos.' },
  home:        { title: 'Feed the bear without limits', body: 'Unlimited spots, Byte Cub AI picks and dish tips, all your friends, Duel verdicts and Year in Review.' },
  duel:        { title: 'Let Byte Cub judge the showdown', body: 'A dramatic AI fight card that weighs vibe, value, and your notes, then crowns a winner you can share.' },
  mealplanner: { title: 'Plan your week of eating out', body: 'Byte Cub builds a day-by-day dining plan around your budget, cravings, and wish list.' },
  'byte-cub':  { title: 'Your personal food concierge', body: 'Ask Byte Cub anything: where to go tonight, what to order, date-night ideas, all from your own list.' },
  summary:     { title: 'Byte Cub sums up every spot', body: 'One tap for the vibe, what to order, and the best time to go.' },
  menu:        { title: 'Snap the menu, get your order', body: 'Take a photo of any menu and Byte Cub picks the dishes that fit your taste, with a reason for each.' },
  dishes:      { title: 'Know what to order before you go', body: 'Byte Cub picks the dishes worth ordering at each spot, tuned to your taste.' },
  smartfill:   { title: 'Let the cub do the typing', body: 'Byte Cub fills in cuisine, price, tags, and a short description for every spot you add.' },
  video:       { title: 'Save food videos', body: 'Catch the cheese pull, the sizzle, the steam. Grizzly saves 15-second videos with every dish you log.' },
  review:      { title: 'Your foodie Year in Review', body: 'Your top spots, cuisines, and streaks, wrapped up and ready to share.' },
  friends:     { title: 'Eat with all your friends', body: "Cub follows one friend. Grizzly follows everyone, and shows where they go and what they order." },
  vote:        { title: 'End the "where should we eat" debate', body: 'Start a Dinner Vote: friends tap yes or no on your picks, no app needed, and the bear names the winner.' },
  swipe:       { title: 'Find out what you are craving', body: 'Bear Swipe reads your swipes, names your craving, and finds it near you.' },
  pick:        { title: "Today's Pick, every meal", body: 'The bear picks a spot from your list for breakfast, lunch and dinner, and tells you why.' },
  // FREE_RESTAURANT_LIMIT lives in app.js, which loads before this file,
  // so read it when the pitch is shown, not while app.js is starting up.
  get limit () { return { title: 'Save every spot you love', body: `Cub holds ${FREE_RESTAURANT_LIMIT} spots (backed up and synced on every device). Grizzly is unlimited.` }; },
};
// Friends isn't here: a free account can open it to follow one friend (followFriend
// checks); inviting and following more are Grizzly.
const GRIZZLY_TOOLS = new Set(['ai-panel', 'mealplanner', 'review', 'swipe', 'rooms', 'groupvote']);
const GRIZZLY_SNOOZE_KEY = 'ftb_grizzly_card_snooze';

function hasGrizzly () { return typeof isPremium === 'function' && isPremium(); }

// Grizzly-only features: a free account gets the pitch instead. True when locked.
function grizzlyLocked (key) {
  if (hasGrizzly()) return false;
  showGrizzlyUpsell(key);
  return true;
}

function showGrizzlyUpsell (key = 'general') {
  const pitch = GRIZZLY_PITCH[key] || GRIZZLY_PITCH.general;
  if (key === 'limit') trackProductEvent('free_limit_hit');
  if (typeof openUpgradeModal === 'function') openUpgradeModal({ key, ...pitch });
}

// A spot saved past the free limit isn't lost: it waits here, the pitch names
// it, and it's saved the moment they go Grizzly (renderGrizzlyUi runs then).
const WAITING_SPOT_KEY = 'ftb_waiting_spot_v1';
function holdSpotForGrizzly (r, dish = null) {
  if (!r?.name) { showGrizzlyUpsell('limit'); return; }
  // Photos are too big to park in storage; the spot and its dish are what matter.
  const spot = { ...r, photo: /^https?:/i.test(r.photo || '') ? r.photo : '', visits: (r.visits || []).map(v => ({ ...v, photo: '', video: undefined })) };
  try { localStorage.setItem(WAITING_SPOT_KEY, JSON.stringify({ r: spot, dish, at: Date.now() })); } catch { /* private mode */ }
  trackProductEvent('free_limit_hit', { held: true });
  if (typeof openUpgradeModal === 'function') {
    openUpgradeModal({ key: 'limit', title: `Save ${r.name}?`,
      body: `You've used all ${FREE_RESTAURANT_LIMIT} free spots. Go Grizzly and ${r.name} is saved right away, plus every spot after it.` });
  }
}
function releaseWaitingSpot () {
  if (!hasGrizzly()) return;
  let held = null;
  try { held = JSON.parse(localStorage.getItem(WAITING_SPOT_KEY) || 'null'); localStorage.removeItem(WAITING_SPOT_KEY); } catch { return; }
  const r = held?.r;
  if (!r?.name || Date.now() - (held.at || 0) > 30 * 86400000) return;
  const key = typeof normalizeName === 'function' ? normalizeName(r.name) : r.name.toLowerCase();
  if ((state.restaurants || []).some(x => (typeof normalizeName === 'function' ? normalizeName(x?.name) : String(x?.name || '').toLowerCase()) === key)) return;
  r.updatedAt = Date.now();
  state.restaurants.unshift(r);
  if (held.dish?.name && typeof upsertDish === 'function') upsertDish(r, held.dish);
  else saveData();
  if (!Number.isFinite(r.lat) && r.address && typeof geocodeAddress === 'function') geocodeAddress(r.id, r.address);
  renderAll();
  trackProductEvent('waiting_spot_saved');
  showToast(`${r.name} saved`, 'It was waiting for you. Welcome to Grizzly!', 'success');
}

// The inline "unlock" card used where an AI result would appear.
function grizzlyUnlockHtml (key) {
  const pitch = GRIZZLY_PITCH[key] || GRIZZLY_PITCH.general;
  return `<div class="grizzly-unlock"><span class="gz-badge">GRIZZLY</span><strong>${escHtml(pitch.title)}</strong>
    <span>${escHtml(pitch.body)}</span><button type="button" class="btn-primary btn-sm" data-upsell="${escHtml(key)}">Unlock with Grizzly</button></div>`;
}

const GRIZZLY_CARD_MIN_SPOTS = 5;
// Taste-based modules need a few spots before they have anything to say.
const HOME_MIN_SPOTS_FOR_PICKS = 3;

// The spot count the free limit was last shown for (null until the first render).
let _limitShownFor = null;

/* Free-trial reminder: in the last 3 days of a trial, home says when it ends,
   what it turns into, and what they'd keep, with Manage subscription one tap
   away. Cancelled trials get "Keep Grizzly" instead. "Got it" hides it for the day. */
const TRIAL_REMINDER_DAYS = 3;

function renderTrialReminder () {
  const box = document.getElementById('trial-home');
  if (!box) return;
  const end = Date.parse(window._ftbTrialEnd || '');
  const days = Math.ceil((end - Date.now()) / 864e5);
  let dismissed = false;
  try { dismissed = localStorage.getItem('ftb_trial_reminder_seen') === new Date().toDateString(); } catch { /* private mode */ }
  if (!hasGrizzly() || !Number.isFinite(end) || days < 0 || days > TRIAL_REMINDER_DAYS || dismissed) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  // By calendar day, not hours: ending at 9am tomorrow is "tomorrow".
  const endDay = new Date(end).toDateString();
  const when = endDay === new Date().toDateString() ? 'today'
    : endDay === new Date(Date.now() + 864e5).toDateString() ? 'tomorrow'
    : new Date(end).toLocaleDateString('en-US', { weekday: 'long' });
  const cancelled = !!window._ftbCancelAtEnd;
  let rounds = 0;
  try { rounds = JSON.parse(localStorage.getItem('ftb_bear_swipe_v2') || '{}').rounds || 0; } catch { /* private mode */ }
  const spots = (state.restaurants || []).length;
  const friends = getFriends().length;
  const keep = [
    spots > FREE_RESTAURANT_LIMIT ? `all ${spots} spots (Cub holds ${FREE_RESTAURANT_LIMIT})` : 'unlimited spots',
    friends > FREE_FRIENDS ? `all ${friends} friends you follow` : 'following all your friends',
    rounds ? `Bear Swipe (${rounds} round${rounds === 1 ? '' : 's'} so far)` : 'Bear Swipe',
    "Today's Pick and Byte Cub",
  ];
  box.innerHTML = `
    <div class="gz-top"><span class="gz-badge">GRIZZLY</span></div>
    <div class="gz-title">${cancelled ? `Grizzly ends ${when}` : `Your free trial ends ${when}`}</div>
    <p class="trial-sub">${cancelled
      ? "You cancelled, so you won't be charged. After that you're on Cub, and you'd lose:"
      : "Your plan starts then, nothing to do. You'll keep:"}</p>
    <ul class="gz-perks">${keep.map(k => `<li>${escHtml(k)}</li>`).join('')}</ul>
    <div class="trial-actions">
      <button type="button" class="btn-primary trial-manage">${cancelled ? 'Keep Grizzly' : 'Manage subscription'}</button>
      <button type="button" class="btn-ghost trial-ok">Got it</button>
    </div>`;
  box.classList.remove('hidden');
  box.querySelector('.trial-manage').onclick = () => { trackProductEvent('trial_reminder_manage', { cancelled, days }); if (typeof openBilling === 'function') openBilling(); };
  box.querySelector('.trial-ok').onclick = () => {
    try { localStorage.setItem('ftb_trial_reminder_seen', new Date().toDateString()); } catch { /* private mode */ }
    renderTrialReminder();
  };
}

function renderGrizzlyUi () {
  const free = !hasGrizzly();
  if (!free) releaseWaitingSpot();
  const count = (state.restaurants || []).length;
  const left = FREE_RESTAURANT_LIMIT - count;
  document.getElementById('grizzly-pill')?.classList.toggle('hidden', !free);
  // Free accounts always see how many of their free spots they've used, under
  // Saved (the header has no room on phones), gold once 3 or fewer are left.
  const savedLabel = document.getElementById('stat-total-label');
  if (savedLabel) {
    savedLabel.textContent = free ? `of ${FREE_RESTAURANT_LIMIT} free` : 'Saved';
    savedLabel.closest('.stat-item')?.classList.toggle('near-limit', free && left <= 3);
  }
  // A heads-up when a save brings you close, so the limit is never a surprise.
  // One more than last time = you just saved one (a sync or first load jumps further).
  if (free && count === _limitShownFor + 1 && left >= 0 && left <= 3) {
    showToast(left ? `${left} free spot${left === 1 ? '' : 's'} left` : `That's all ${FREE_RESTAURANT_LIMIT} free spots`,
      left ? `Cub holds ${FREE_RESTAURANT_LIMIT}. Grizzly is unlimited.` : 'Grizzly keeps the den growing, with no limit.', 'info');
  }
  if (_limitShownFor === 0 && count === 1) trackProductEvent('first_spot_saved');
  _limitShownFor = count;
  try { renderTrialReminder(); } catch (err) { console.warn('[FTB] trial reminder:', err); }
  const card = document.getElementById('grizzly-home');
  if (card) {
    let snoozedUntil = 0;
    try { snoozedUntil = Number(localStorage.getItem(GRIZZLY_SNOOZE_KEY)) || 0; } catch { /* storage blocked */ }
    // Not before 5 spots (let new users fall for the app first). Near the
    // limit it always shows; otherwise it respects "Not now".
    const nearLimit = count >= FREE_RESTAURANT_LIMIT - 3;
    card.classList.toggle('hidden', !free || count < GRIZZLY_CARD_MIN_SPOTS || (!nearLimit && Date.now() < snoozedUntil));
    const pct = Math.min(100, Math.round((count / FREE_RESTAURANT_LIMIT) * 100));
    const meter = card.querySelector('.gz-meter span');
    if (meter) meter.style.width = `${pct}%`;
    card.classList.toggle('near-limit', nearLimit);
    const label = card.querySelector('.gz-meter-label');
    if (label) label.textContent = count >= FREE_RESTAURANT_LIMIT
      ? `You've used all ${FREE_RESTAURANT_LIMIT} free spots. Grizzly keeps the den growing.`
      : `${count} of ${FREE_RESTAURANT_LIMIT} free spots used`;
  }
}
