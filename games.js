/* ════════════════════════════════════════════════════════════
   Feed The Bear - Play: arcade games
   Food Match (find the pairs), Food Fight (toss food to hungry bears,
   not the raccoon) and Bear Burger Bar (build each bear's order).
   One overlay (#game-overlay) hosts whichever game is open. Best scores
   are kept on the phone; XP comes from play.js (awardXp) when it's there.
   Loads after app.js and play.js; app.js opens these from Play.
   ════════════════════════════════════════════════════════════ */

'use strict';

const GAME_BEST_KEY = 'ftb_game_best_v1';
const GAME_BEARS = ['tacos', 'pizza', 'sushi', 'burger', 'ramen', 'donut', 'icecream', 'bbq', 'pancakes', 'hotdog', 'wings', 'honey', 'popcorn', 'croissant', 'salmon', 'birthday'];
const bearPic = id => `assets/avatars/bear-${id}.jpg`;
const gameRand = n => Math.floor(Math.random() * n);
const gameShuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = gameRand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function gameBest (game) { try { return (JSON.parse(localStorage.getItem(GAME_BEST_KEY)) || {})[game] || 0; } catch { return 0; } }
// Saves a better score; true when it's a new best.
function noteGameBest (game, score, lowerWins = false) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(GAME_BEST_KEY)) || {}; } catch { /* bad value */ }
  const prev = all[game] || 0;
  const better = !prev || (lowerWins ? score < prev : score > prev);
  if (better) { all[game] = score; try { localStorage.setItem(GAME_BEST_KEY, JSON.stringify(all)); } catch { /* storage full */ } }
  return better && !!prev;
}

let _gameStop = null; // stops the running game's timers
function gameOverlay (title) {
  let ov = document.getElementById('game-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'game-overlay';
    ov.className = 'modal-overlay hidden';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'game-title');
    ov.innerHTML = '<div class="modal-card game-card"><div class="modal-header"><h2 id="game-title"></h2><button type="button" class="icon-btn" id="game-close-btn" aria-label="Close">✕</button></div><div id="game-body" class="game-body"></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#game-close-btn').addEventListener('click', closeGame);
  }
  ov.querySelector('#game-title').textContent = title;
  ov.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  return ov.querySelector('#game-body');
}
function closeGame () {
  if (_gameStop) { _gameStop(); _gameStop = null; }
  document.getElementById('game-overlay')?.classList.add('hidden');
  if (typeof maybeHideOverlay === 'function') maybeHideOverlay();
}

// The end screen every game shares.
function gameOver (body, { game, headline, line, score, lowerWins = false, again, share }) {
  const best = noteGameBest(game, score, lowerWins);
  const xp = typeof awardXp === 'function' ? awardXp(Math.max(5, Math.min(40, Math.round(score / (lowerWins ? 1 : 5)))), headline, { quiet: true }) : '';
  // Food Fight feeds the cave economy: a win (score 20+, the bears are
  // full) is +5 cave points once a day, and scoring 50+ is the daily
  // food-fight challenge for +10 once a day. Both go through
  // awardCaveFun so they can't be farmed in a loop.
  let fightAward = '';
  if (game === 'fight' && window._ftbUid && typeof awardCaveFun === 'function') {
    const win = score >= 20 ? awardCaveFun(5, 'fightWin') : null;
    const fifty = score >= 50 ? awardCaveFun(10, 'fight50') : null;
    const total = (win?.ok ? 5 : 0) + (fifty?.ok ? 10 : 0);
    if (total) fightAward = `<br>+${total} cave points!`;
  }
  if (typeof hapticTap === 'function') hapticTap('medium');
  if (typeof trackProductEvent === 'function') trackProductEvent('game_played', { game, best });
  body.insertAdjacentHTML('beforeend', `<div class="game-over" role="status">
    <div class="game-over-big">${escHtml(headline)}</div>
    <p>${line}${best ? '<br><strong>New best!</strong>' : ''}${fightAward}${xp ? `<br>You're now a ${escHtml(xp)}!` : ''}</p>
    <div class="game-over-actions"><button type="button" class="btn-primary game-again">Play again</button><button type="button" class="btn-ghost game-share">Challenge a friend</button></div></div>`);
  body.querySelector('.game-again').addEventListener('click', again);
  body.querySelector('.game-share').addEventListener('click', () => {
    navigator.share?.({ title: 'Feed The Bear', text: `${share} Think you can beat me? 🐻`, url: 'https://www.feed-the-bear.com/app.html' }).catch(() => {});
  });
  if (typeof showCelebrationMoment === 'function' && best) showCelebrationMoment('New best!', headline, { durationMs: 1600, confetti: true, confettiMs: 1600 });
}

/* ── Food Match ───────────────────────────────────────────── */
const MATCH_FOODS = ['🌮', '🍕', '🍣', '🍔', '🍜', '🍩', '🍦', '🥞', '🌭', '🍗', '🥐', '🍿', '🥟', '🍤', '🧁', '🥨'];
function openFoodMatch () {
  const body = gameOverlay('Food Match');
  if (_gameStop) _gameStop();
  const foods = gameShuffle(MATCH_FOODS).slice(0, 8);
  const cards = gameShuffle([...foods, ...foods]);
  let first = null, lock = false, moves = 0, found = 0, started = 0, secs = 0;
  const timer = setInterval(() => { if (started) { secs = Math.floor((Date.now() - started) / 1000); const t = body.querySelector('#match-time'); if (t) t.textContent = `${secs}s`; } }, 500);
  _gameStop = () => clearInterval(timer);
  const best = gameBest('match');
  body.innerHTML = `<div class="game-hud"><span>Moves <b id="match-moves">0</b></span><span>Time <b id="match-time">0s</b></span><span>Best <b>${best ? `${best} moves` : 'none yet'}</b></span></div>
    <p class="game-hint">Flip two cards. Find all 8 food pairs.</p>
    <div class="match-grid">${cards.map((f, i) => `<button type="button" class="match-card" data-i="${i}" aria-label="Card ${i + 1}"><span class="match-back"><img src="feedbear-sm.jpg" alt="" /></span><span class="match-face">${f}</span></button>`).join('')}</div>`;
  body.querySelector('.match-grid').addEventListener('click', e => {
    const btn = e.target.closest('.match-card');
    if (!btn || lock || btn.classList.contains('up')) return;
    if (!started) started = Date.now();
    btn.classList.add('up');
    btn.setAttribute('aria-label', cards[btn.dataset.i]);
    if (typeof hapticTap === 'function') hapticTap('light');
    if (!first) { first = btn; return; }
    moves++;
    body.querySelector('#match-moves').textContent = moves;
    if (cards[first.dataset.i] === cards[btn.dataset.i]) {
      first.classList.add('found'); btn.classList.add('found');
      first = null; found++;
      if (found === 8) {
        clearInterval(timer);
        secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        const stars = moves <= 12 ? '⭐⭐⭐' : moves <= 18 ? '⭐⭐' : '⭐';
        setTimeout(() => gameOver(body, { game: 'match', score: moves, lowerWins: true, headline: `${stars} All matched!`,
          line: `${moves} moves in ${secs} seconds.`, again: openFoodMatch, share: `I matched every food pair in Feed The Bear in ${moves} moves.` }), 450);
      }
    } else {
      lock = true;
      const a = first; first = null;
      setTimeout(() => { a.classList.remove('up'); btn.classList.remove('up'); a.setAttribute('aria-label', 'Card'); btn.setAttribute('aria-label', 'Card'); lock = false; }, 750);
    }
  });
}

/* ── Food Fight ───────────────────────────────────────────── */
const FIGHT_FOODS = ['🍕', '🌮', '🍩', '🍔', '🍗', '🥧', '🍰', '🌭', '🍣', '🍜', '🍦', '🧁', '🍪', '🍿', '🍟', '🥪', '🌯', '🥞', '🧇', '🧀', '🍳', '🥓', '🌽', '🍎', '🥨'];
function openFoodFight () {
  const body = gameOverlay('Food Fight');
  if (_gameStop) _gameStop();
  const ROUND = 30;
  let score = 0, combo = 0, left = ROUND, over = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  let tick = null;
  _gameStop = () => { over = true; clearInterval(tick); timers.forEach(clearTimeout); timers.clear(); };
  const best = gameBest('fight');
  body.innerHTML = `<div class="game-hud"><span>Score <b id="fight-score">0</b></span><span>Time <b id="fight-time">${ROUND}</b></span><span>Best <b>${best || 'none yet'}</b></span></div>
    <p class="game-hint">Toss food to the hungry bears before they duck! Don't feed the 🦝 raccoon. Score 50 today for +10 cave points.</p>
    <div class="fight-grid">${Array.from({ length: 9 }, (_, i) => `<div class="fight-hole" data-i="${i}"><div class="fight-table"></div></div>`).join('')}</div>
    <div class="fight-start"><button type="button" class="btn-primary" id="fight-go">Start</button></div>`;
  const holes = [...body.querySelectorAll('.fight-hole')];
  const pop = () => {
    if (over) return;
    const free = holes.filter(h => !h.querySelector('.fight-critter'));
    if (!free.length) return;
    const hole = free[gameRand(free.length)];
    const raccoon = Math.random() < 0.18;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `fight-critter${raccoon ? ' raccoon' : ''}`;
    el.setAttribute('aria-label', raccoon ? 'Raccoon' : 'Hungry bear');
    el.innerHTML = raccoon ? '<span class="fight-emoji">🦝</span>' : `<img src="${bearPic(GAME_BEARS[gameRand(GAME_BEARS.length)])}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fight-emoji',textContent:'🐻'}))" />`;
    hole.appendChild(el);
    const stay = Math.max(650, 1300 - (ROUND - left) * 22);
    later(() => { if (el.isConnected) { if (!raccoon) combo = 0; el.remove(); } }, stay);
  };
  const splat = (hole, text, good) => {
    const s = document.createElement('span');
    s.className = `fight-splat${good ? '' : ' bad'}`;
    s.textContent = text;
    hole.appendChild(s);
    later(() => s.remove(), 650);
  };
  body.querySelector('.fight-grid').addEventListener('pointerdown', e => {
    const c = e.target.closest('.fight-critter');
    if (!c || over) return;
    const hole = c.closest('.fight-hole');
    if (c.classList.contains('raccoon')) {
      score = Math.max(0, score - 3); combo = 0;
      splat(hole, '-3', false);
      if (typeof hapticTap === 'function') hapticTap('heavy');
    } else {
      combo++;
      const pts = combo >= 5 ? 3 : combo >= 3 ? 2 : 1;
      score += pts;
      splat(hole, `${FIGHT_FOODS[gameRand(FIGHT_FOODS.length)]} +${pts}`, true);
      if (typeof hapticTap === 'function') hapticTap('light');
    }
    c.remove();
    body.querySelector('#fight-score').textContent = score;
  });
  body.querySelector('#fight-go').addEventListener('click', () => {
    body.querySelector('.fight-start').remove();
    const step = () => {
      if (over) return;
      pop();
      if (Math.random() < Math.min(0.6, (ROUND - left) / 40)) later(pop, 180);
      later(step, Math.max(380, 800 - (ROUND - left) * 14));
    };
    step();
    tick = setInterval(() => {
      left--;
      body.querySelector('#fight-time').textContent = left;
      if (left <= 0) {
        _gameStop();
        holes.forEach(h => h.querySelectorAll('.fight-critter').forEach(c => c.remove()));
        gameOver(body, { game: 'fight', score, headline: score >= 40 ? '🏆 Food Fight Champion!' : score >= 20 ? '🐻 Bears are full!' : '🍽️ Round over',
          line: `You fed the bears <strong>${score}</strong> points of food.`, again: openFoodFight, share: `I scored ${score} in Feed The Bear's Food Fight.` });
      }
    }, 1000);
  });
}

/* ── Bear Burger Bar ──────────────────────────────────────── */
const BAR_ITEMS = {
  bun: ['🍞', 'Bun'], patty: ['🥩', 'Patty'], cheese: ['🧀', 'Cheese'], lettuce: ['🥬', 'Lettuce'], tomato: ['🍅', 'Tomato'],
  onion: ['🧅', 'Onion'], bacon: ['🥓', 'Bacon'], pickle: ['🥒', 'Pickle'], egg: ['🍳', 'Egg'], avocado: ['🥑', 'Avocado'],
};
const BAR_FILLINGS = ['patty', 'cheese', 'lettuce', 'tomato', 'onion', 'bacon', 'pickle', 'egg', 'avocado'];
const BAR_NAMES = ['Grizzly Gus', 'Honey Bea', 'Big Bruno', 'Cubby Lou', 'Kodiak Kate', 'Teddy T', 'Bearnice', 'Smokey Jo'];
function openBurgerBar () {
  const body = gameOverlay('Bear Burger Bar');
  if (_gameStop) _gameStop();
  const ROUND = 60;
  let left = ROUND, served = 0, score = 0, over = false, order = [], built = [];
  let tick = null;
  _gameStop = () => { over = true; clearInterval(tick); };
  const best = gameBest('bar');
  body.innerHTML = `<div class="game-hud"><span>Score <b id="bar-score">0</b></span><span>Time <b id="bar-time">${ROUND}</b></span><span>Best <b>${best || 'none yet'}</b></span></div>
    <div class="bar-customer"><img id="bar-bear" src="${bearPic('burger')}" alt="" onerror="this.style.visibility='hidden'" /><div class="bar-ticket"><div id="bar-who"></div><div id="bar-order" class="bar-order"></div></div></div>
    <div class="bar-plate" aria-live="polite"><div id="bar-stack" class="bar-stack"></div><div class="bar-dish">🍽️</div></div>
    <div class="bar-buttons">${Object.entries(BAR_ITEMS).map(([k, [e, n]]) => `<button type="button" class="bar-btn" data-k="${k}"><span>${e}</span>${n}</button>`).join('')}</div>
    <div class="fight-start"><button type="button" class="btn-primary" id="bar-go">Open the bar</button></div>`;
  const newOrder = () => {
    const n = Math.min(6, 2 + Math.floor(served / 2));
    order = ['bun', ...Array.from({ length: n }, () => BAR_FILLINGS[gameRand(BAR_FILLINGS.length)]), 'bun'];
    built = [];
    body.querySelector('#bar-bear').src = bearPic(GAME_BEARS[gameRand(GAME_BEARS.length)]);
    body.querySelector('#bar-who').textContent = `${BAR_NAMES[gameRand(BAR_NAMES.length)]} wants, bottom to top:`;
    body.querySelector('#bar-order').innerHTML = order.map((k, i) => `<span class="bar-need" data-i="${i}" title="${BAR_ITEMS[k][1]}">${BAR_ITEMS[k][0]}</span>`).join('');
    body.querySelector('#bar-stack').innerHTML = '';
  };
  body.querySelector('.bar-buttons').addEventListener('click', e => {
    const b = e.target.closest('.bar-btn');
    if (!b || over || !order.length) return;
    const k = b.dataset.k;
    const want = order[built.length];
    if (k !== want) {
      score = Math.max(0, score - 2);
      body.querySelector('#bar-score').textContent = score;
      const st = body.querySelector('#bar-stack');
      st.classList.remove('oops'); void st.offsetWidth; st.classList.add('oops');
      if (typeof hapticTap === 'function') hapticTap('heavy');
      return;
    }
    built.push(k);
    body.querySelector(`.bar-need[data-i="${built.length - 1}"]`)?.classList.add('done');
    body.querySelector('#bar-stack').insertAdjacentHTML('afterbegin', `<span>${BAR_ITEMS[k][0]}</span>`);
    if (typeof hapticTap === 'function') hapticTap('light');
    if (built.length === order.length) {
      served++;
      score += order.length * 2;
      body.querySelector('#bar-score').textContent = score;
      body.querySelector('#bar-who').textContent = 'Order up! 😋';
      order = [];
      setTimeout(() => { if (!over) newOrder(); }, 550);
    }
  });
  body.querySelector('#bar-go').addEventListener('click', () => {
    body.querySelector('.fight-start').remove();
    newOrder();
    tick = setInterval(() => {
      left--;
      body.querySelector('#bar-time').textContent = left;
      if (left <= 0) {
        _gameStop();
        gameOver(body, { game: 'bar', score, headline: served >= 8 ? '👨‍🍳 Head Chef!' : served >= 4 ? '🍔 Short-order star' : '🧑‍🍳 Kitchen closed',
          line: `You served <strong>${served}</strong> hungry bear${served === 1 ? '' : 's'} for <strong>${score}</strong> points.`, again: openBurgerBar, share: `I served ${served} bears at Feed The Bear's Burger Bar (${score} points).` });
      }
    }, 1000);
  });
}

window.openFoodMatch = openFoodMatch;
window.openFoodFight = openFoodFight;
window.openBurgerBar = openBurgerBar;
window.closeGame = closeGame;
