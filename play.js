/* ════════════════════════════════════════════════════════════
   Feed The Bear - Play: achievements and XP, Swipe to Decide, Spin the Wheel, the Duel,
   Cuisine Bingo, fortune cookies, mood calendar, daily challenges, the bear game.
   Moved out of app.js as-is. Loads right after app.js (classic scripts
   share one global scope, and the app starts on DOMContentLoaded, after
   every script has run), so names here and in app.js work both ways.
   ════════════════════════════════════════════════════════════ */

'use strict';

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
  { id: 'first_visit',      icon: '🍴',  name: 'First Bite',       desc: 'Log your first visited restaurant',  xp: 20,  check: r => r.filter(x=>x.status==='visited').length >= 1 },
  { id: 'visits_5',         icon: '⭐',  name: 'Regular',           desc: '5 restaurants visited',              xp: 30,  check: r => r.filter(x=>x.status==='visited').length >= 5 },
  { id: 'visits_10',        icon: '⭐⭐',  name: 'Foodie',            desc: '10 restaurants visited',             xp: 50,  check: r => r.filter(x=>x.status==='visited').length >= 10 },
  { id: 'visits_25',        icon: '🏅',  name: 'Veteran',           desc: '25 restaurants visited',             xp: 100, check: r => r.filter(x=>x.status==='visited').length >= 25 },
  { id: 'visits_50',        icon: '👑',  name: 'Legend',            desc: '50 restaurants visited',             xp: 200, check: r => r.filter(x=>x.status==='visited').length >= 50 },
  { id: 'cuisines_5',       icon: '🌍',  name: 'Globe Trotter',     desc: '5 different cuisines explored',      xp: 40,  check: r => new Set(r.filter(x=>x.status==='visited').map(x=>(x.cuisine||'').toLowerCase()).filter(Boolean)).size >= 5 },
  { id: 'cuisines_10',      icon: '✈️', name: 'Culinary Tourist',  desc: '10 different cuisines explored',     xp: 80,  check: r => new Set(r.filter(x=>x.status==='visited').map(x=>(x.cuisine||'').toLowerCase()).filter(Boolean)).size >= 10 },
  { id: 'wishlist_10',      icon: '📝',  name: 'Dream List',        desc: '10 places on your wishlist',         xp: 25,  check: r => r.filter(x=>x.status==='want-to-try').length >= 10 },
  { id: 'first_5star',      icon: '⭐',  name: 'Perfection',        desc: 'Give a restaurant 5 stars',          xp: 30,  check: r => r.some(x=>x.myRating >= 5) },
  { id: 'photo_added',      icon: '📸',  name: 'Shutterbug',        desc: 'Add a photo to a restaurant',        xp: 15,  check: r => r.some(x=>x.photo) },
  { id: 'has_notes',        icon: '✍️',  name: 'Critic',            desc: 'Write notes on 5 restaurants',       xp: 20,  check: r => r.filter(x=>x.notes&&x.notes.length>10).length >= 5 },
  { id: 'cheap_gem',        icon: '💰',  name: 'Bargain Hunter',    desc: 'Rate a $ restaurant 4+ stars',       xp: 25,  check: r => r.some(x=>x.priceRange===1&&x.myRating>=4) },
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

// Returns the new level's name when this award levels you up.
function awardXp (amount, reason, { quiet = false } = {}) {
  const data = getXpData();
  const before = getLevelForXp(data.xp);
  data.xp += amount;
  const after = getLevelForXp(data.xp);
  saveXpData(data);
  const leveled = before.name !== after.name ? after.name : '';
  if (quiet) return leveled;

  const toast = document.createElement('div');
  toast.className = 'ach-xp-toast';
  toast.textContent = '+' + amount + ' XP · ' + reason;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
  if (leveled) showCelebrationMoment('Level Up!', `You are now: ${leveled}`, { durationMs: 2300, glow: true, confetti: true, confettiMs: 2400, haptic: 'medium' });
  return leveled;
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
    // One celebration for the whole batch: several badges can unlock at once
    // (say, after an update adds new ones), and a stack of popups is noise.
    let leveled = '';
    newUnlocks.forEach(def => { leveled = awardXp(def.xp, def.name, { quiet: true }) || leveled; });
    const names = newUnlocks.map(d => d.name);
    const title = newUnlocks.length === 1 ? 'Badge unlocked!' : `${newUnlocks.length} badges unlocked!`;
    const body = (names.length > 3 ? names.slice(0, 3).join(', ') + ` +${names.length - 3} more` : names.join(', '))
      + (leveled ? ` · You are now: ${leveled}` : '');
    showCelebrationMoment(title, body, { durationMs: 2600, glow: true, confetti: true, confettiMs: 2200, haptic: 'light' });
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
  if (grizzlyLocked('swipe')) return;
  _swipeDeck = [...state.restaurants]
    .filter(r => r.status === 'want-to-try')
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
    // The spot's real photo when we have one; otherwise its cuisine emoji.
    const photo = pickRealRestaurantPhoto({ savedRestaurant: r, cuisine: r.cuisine, amenity: 'restaurant', width: 800, height: 600, allowFallback: false }).url;
    const open = openStatus(r);
    card.classList.toggle('has-photo', !!photo);
    card.innerHTML = `
      <div class="swipe-label yes">PICK ✓</div>
      <div class="swipe-label no">SKIP ✕</div>
      ${photo
        ? `<div class="swipe-card-photo"><img src="${escHtml(photo)}" alt="" draggable="false" /></div>`
        : `<div class="swipe-card-emoji">${cuisineEmoji(r.cuisine)}</div>`}
      <div class="swipe-card-name">${escHtml(r.name)}</div>
      <div class="swipe-card-meta">${escHtml(`${cuisineEmoji(r.cuisine)} ${r.cuisine || ''}`.trim())}${r.priceRange ? ' · ' + '$'.repeat(r.priceRange) : ''}${r.googleRating ? ` · ⭐ ${r.googleRating}` : ''}</div>
      ${open ? `<div class="swipe-card-open ${open.open ? (open.soon ? 'soon' : 'open') : 'closed'}">${escHtml(open.text)}</div>` : ''}
      ${r.myRating ? `<div class="swipe-card-rating">${'★'.repeat(r.myRating)}</div>` : ''}
      ${r.address ? `<div class="swipe-card-meta" style="margin-top:4px">📍 ${escHtml(r.address)}</div>` : ''}
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

  // Tear down listeners left behind by the previous top card so window
  // handlers don't accumulate on every deck re-render (memory/CPU leak).
  if (window._ftbSwipeCleanup) { window._ftbSwipeCleanup(); window._ftbSwipeCleanup = null; }

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

  window._ftbSwipeCleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('mouseup', onEnd);
    window.removeEventListener('touchend', onEnd);
  };
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
  _spinItems = state.restaurants.filter(r => r.status === 'want-to-try' || r.status === 'visited');
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
      showToast('The wheel chose!', winner.name, 'success');
      awardXp(5, 'Spun the wheel');
    }
  }
  requestAnimationFrame(step);
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
  const rA = state.restaurants.find(r => r.id === idA);
  const rB = state.restaurants.find(r => r.id === idB);
  if (!rA || !rB) return;
  if (!AI.hasAccess()) {
    const out = document.getElementById('duel-result');
    out.classList.remove('hidden');
    out.innerHTML = freeDuelVerdict(rA, rB);
    trackProductEvent('duel_free_verdict', {});
    return;
  }
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
      const txt = `⚔️ Restaurant Duel: ${rA.name} vs ${rB.name}\n\n${text}`;
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
  {e:'🍝',n:'Italian'},{e:'🌮',n:'Mexican'},{e:'🍱',n:'Japanese'},{e:'🍛',n:'Indian'},
  {e:'🥡',n:'Chinese'},{e:'🥐',n:'French'},{e:'🫒',n:'Mediterranean'},{e:'🍔',n:'American'},
  {e:'🧆',n:'Middle Eastern'},{e:'🍜',n:'Thai'},{e:'🥩',n:'Steakhouse'},{e:'🦞',n:'Seafood'},
  {e:'🍜',n:'Vietnamese'},{e:'🥗',n:'Salad/Healthy'},{e:'🍺',n:'Pub/Bar'},{e:'🥞',n:'Breakfast'},
  {e:'🍲',n:'Korean'},{e:'🍲',n:'Ethiopian'},{e:'🥨',n:'German'},{e:'🐟',n:'Peruvian'},
  {e:'🥂',n:'Brunch'},{e:'🥟',n:'Dim Sum'},{e:'🍖',n:'BBQ'},{e:'🌱',n:'Vegan'},
  {e:'🥘',n:'Spanish'},{e:'🍝',n:'Pasta'},{e:'🍟',n:'Fast Food'},{e:'🍗',n:'Soul Food'},
  {e:'🍍',n:'Hawaiian'},{e:'🥐',n:'Bakery/Cafe'}
];
function _getBingoCard () {
  if (!state.settings.bingoCard) { _newBingoCard(); }
  return state.settings.bingoCard;
}
function _newBingoCard () {
  const userCuisines = [...new Set(state.restaurants.map(r => r.cuisine).filter(Boolean))];
  const poolNames = _BINGO_POOL.map(b => b.n);
  const extras = userCuisines.filter(c => !poolNames.includes(c)).slice(0, 5);
  const extraCells = extras.map(n => ({ e: cuisineEmoji(n), n }));
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
      <span class="bingo-cell-emoji">${cell.e || cuisineEmoji(cell.n)}</span>
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
  cookie.textContent = '🥠';
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
    if (AI.hasAccess() && state.restaurants.length > 0) {
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
      const txt = '🥠 My food fortune: ' + fortune;
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
  const ratingOn = {};
  state.restaurants.forEach(r => {
    const dates = (r.visits || []).length
      ? r.visits.map(v => ({ date: v.date, rating: v.rating || r.myRating || 0 }))
      : (r.dateVisited ? [{ date: r.dateVisited, rating: r.myRating || 0 }] : []);
    dates.forEach(({ date, rating }) => {
      if (!date) return;
      // "2026-10-21" is a calendar day, not UTC midnight.
      const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00') : new Date(date);
      if (d.getFullYear() !== y || d.getMonth() !== m) return;
      const day = d.getDate();
      if (!visitMap[day]) { visitMap[day] = []; ratingOn[day] = []; }
      if (!visitMap[day].includes(r)) visitMap[day].push(r);
      ratingOn[day].push(Number(rating) || 0);
    });
  });
  const dows = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html = dows.map(d => `<div class="moodcal-dow">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div class="moodcal-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const visits = visitMap[day] || [];
    const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === day;
    let dotHtml = '';
    if (visits.length) {
      const rs = ratingOn[day] || [];
      const avgRating = rs.length ? rs.reduce((s, n) => s + n, 0) / rs.length : 0;
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
  { e: '🧭', t: 'New territory', d: 'Visit a cuisine type you have never rated before.' },
  { e: '📸', t: 'Snap & rate', d: 'Add a photo to one of your saved restaurants today.' },
  { e: '⭐', t: 'Rate something', d: 'Rate a restaurant you visited but never scored.' },
  { e: '✍️', t: 'Leave a note', d: 'Add personal tasting notes to a restaurant with none.' },
  { e: '💎', t: 'Hidden gem', d: 'Find and add a restaurant with under 100 Google reviews.' },
  { e: '🌶️', t: 'Spice it up', d: 'Try or add a restaurant serving spicy cuisine.' },
  { e: '💰', t: 'Budget bite', d: 'Visit a $ price-range restaurant you have never tried.' },
  { e: '🥂', t: 'Special occasion', d: 'Book a fine dining ($$$+) spot for an upcoming occasion.' },
  { e: '🏆', t: 'Top the list', d: 'Rate a restaurant 5 stars and add a note on why.' },
  { e: '🔁', t: 'Return visit', d: 'Revisit a restaurant you rated 4+ stars over 3 months ago.' },
  { e: '🌍', t: 'World tour', d: 'Add a restaurant of a cuisine from a continent you have not tracked yet.' },
  { e: '👯', t: 'Squad goals', d: 'Plan a group outing to one of your want-to-try spots.' },
  { e: '🔎', t: 'Foodie detective', d: 'Find a restaurant in your city that opened in the last 6 months.' },
  { e: '🥗', t: 'Green & lean', d: 'Try a plant-based or vegan restaurant today.' },
  { e: '🥞', t: 'Breakfast club', d: 'Track a breakfast or brunch spot you love.' },
  { e: '🎡', t: 'Spin the wheel', d: 'Use Spin the Wheel to pick a restaurant and actually go.' },
  { e: '📖', t: 'Story time', d: 'Add a funny memory or story to a restaurant\'s notes.' },
  { e: '📅', t: 'Monthly review', d: 'Open Monthly Digest and reflect on last month\'s visits.' },
  { e: '💌', t: 'Share the love', d: 'Export your Food Passport and share it with a friend.' },
  { e: '🪣', t: 'Bucket list', d: 'Add 3 restaurants to your want-to-try list right now.' },
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
  showToast('Challenge complete!', `+25 XP · ${dc.streak} day streak!`, 'success');
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
  '🍔','🍕','🌮','🍟','🌭','🍗','🥩','🍣','🍜',
  '🍝','🥪','🌯','🥗','🍩','🍪','🧁','🍰','🥞',
  '🍦','🥨','🥟','🍤','🍓','🍎','🧀',
];
const _FTB_BONUS  = ['⭐','🍯','🐟'];  // +50 pts each
const _FTB_BAD    = ['🐝','🪳','🦟'];  // dodge! -1 life if caught

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
    ctx.fillText('🏆 Best: ' + g.hiScore, W / 2, H * 0.38);
  }

  /* food preview strip */
  const previews = ['🍔','🍕','🌮','🍣','🍩','🐝','⭐'];
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
    ctx.fillText('🏆 NEW HIGH SCORE!', W / 2, H * 0.5);
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

// A basic Duel verdict for everyone; Byte Cub's full fight card is the upsell.
function freeDuelVerdict (rA, rB) {
  const score = r => (r.myRating || 0) * 2 + (r.googleRating || 0) + dishesOf(r).filter(d => d.verdict === 'again').length * 1.5
    - dishesOf(r).filter(d => d.verdict === 'skip').length * 0.5 + Math.min(3, (r.visits || []).length) * 0.7 + (r.isFavorite ? 1.5 : 0);
  const [a, b] = [score(rA), score(rB)];
  const winner = a === b ? null : (a > b ? rA : rB);
  const why = r => {
    const goTo = goToDishOf(r);
    const bits = [];
    if (r.myRating) bits.push(`you rated it ${'★'.repeat(r.myRating)}`);
    if (goTo) bits.push(`your go-to is the ${goTo.name}`);
    if ((r.visits || []).length) bits.push(`${r.visits.length} visit${r.visits.length === 1 ? '' : 's'}`);
    return bits.join(', ') || 'no history yet';
  };
  return `<div class="duel-free"><div><strong>${escHtml(rA.name)}</strong>: ${escHtml(why(rA))}</div>
    <div><strong>${escHtml(rB.name)}</strong>: ${escHtml(why(rB))}</div>
    <div class="duel-winner">${winner ? `WINNER: ${escHtml(winner.name)}` : "It's a tie. Flip a fork."}</div></div>
    ${grizzlyUnlockHtml('duel')}`;
}

document.addEventListener('click', e => {
  if (e.target.closest('#grizzly-home .gz-snooze')) {
    try { localStorage.setItem(GRIZZLY_SNOOZE_KEY, String(Date.now() + 3 * 864e5)); } catch { /* storage blocked */ }
    trackProductEvent('grizzly_card_snoozed', {});
    renderGrizzlyUi();
    return;
  }
  const btn = e.target.closest('[data-upsell]');
  if (!btn) return;
  e.preventDefault();
  showGrizzlyUpsell(btn.dataset.upsell);
});

/* ════════════════════════════════════════════════════════════
   PHASE 11 • TASTE DNA + WEEKLY GOAL + ENHANCEMENTS
   ════════════════════════════════════════════════════════════ */
