/* ════════════════════════════════════════════════════════════
   Feed The Bear - Insights: monthly wrap, Year in Review, deep stats, Taste DNA and the
   weekly goal.
   Moved out of app.js as-is. Loads right after app.js (classic scripts
   share one global scope, and the app starts on DOMContentLoaded, after
   every script has run), so names here and in app.js work both ways.
   ════════════════════════════════════════════════════════════ */

'use strict';

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
  const visitStars = v => Number(v.rating || v.stars || v.r?.myRating || 0);
  const ratedThatMonth = allVisits.filter(v => visitStars(v) > 0);

  // Top cuisine
  const cuisineCounts = {};
  allVisits.forEach(v => { const c = v.r.cuisine||'Other'; cuisineCounts[c]=(cuisineCounts[c]||0)+1; });
  visitedThatMonth.forEach(r => { const c = r.cuisine||'Other'; cuisineCounts[c]=(cuisineCounts[c]||0)+1; });
  const topCuisine = Object.entries(cuisineCounts).sort(([,a],[,b])=>b-a)[0];

  // Best rated visit this month
  const bestVisit = [...allVisits].sort((a,b) => visitStars(b) - visitStars(a))[0];

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
    + '<div class="wrap-stat"><div class="ws-val">' + (ratedThatMonth.length > 0 ? (ratedThatMonth.reduce((s,v)=>s+visitStars(v),0)/ratedThatMonth.length).toFixed(1)+' ★' : '-') + '</div><div class="ws-lbl">Avg Rating</div></div>'
    + '</div>'
    + (topCuisine ? '<div class="wrap-top"><h4>Top Cuisine</h4><div class="wrap-top-item">' + cuisineEmoji(topCuisine[0]) + ' ' + escHtml(topCuisine[0]) + '<span class="wrap-badge">' + topCuisine[1] + 'x</span></div></div>' : '')
    + (bestVisit ? '<div class="wrap-top"><h4>Best Visit</h4><div class="wrap-top-item">' + cuisineEmoji(bestVisit.r.cuisine) + ' ' + escHtml(bestVisit.r.name) + ' <span class="wrap-badge">' + '★'.repeat(visitStars(bestVisit)) + '</span></div></div>' : '')
    + (totalVisits === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-dim)">No visits logged this month. Time to get out there! </div>' : '');

  // Disable next if we're at current month
  const nextBtn = document.getElementById('wrap-next-btn');
  if (nextBtn) nextBtn.disabled = _wrapOffset >= 0;
}
// One month in food: meals out, new spots, cuisines, best dish, favorite spot.
function wrapStats (offset = 0) {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const monthKey = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}`;
  const inMonth = date => String(date || '').slice(0, 7) === monthKey;
  const visitsBySpot = new Map();
  state.restaurants.forEach(r => {
    const n = (r.visits || []).filter(v => inMonth(v.date)).length || (!(r.visits || []).length && inMonth(r.dateVisited) ? 1 : 0);
    if (n) visitsBySpot.set(r, n);
  });
  const meals = [...visitsBySpot.values()].reduce((a, b) => a + b, 0);
  const newSpots = state.restaurants.filter(r => r.status === 'visited' && inMonth(firstVisitOf(r))).length;
  const cuisines = new Set([...visitsBySpot.keys()].map(r => r.cuisine).filter(Boolean));
  const topSpot = [...visitsBySpot.entries()].sort((a, b) => b[1] - a[1] || (b[0].myRating || 0) - (a[0].myRating || 0))[0]?.[0] || null;
  const bestDish = state.restaurants.flatMap(r => dishesOf(r).filter(x => x.verdict === 'again' && inMonth(x.date)).map(x => ({ x, r })))
    .sort((a, b) => (b.x.rating || 0) - (a.x.rating || 0))[0] || null;
  const photo = bestDish?.x.photo || [...visitsBySpot.keys()].flatMap(r => (r.visits || []).filter(v => inMonth(v.date) && v.photo).map(v => v.photo))[0] || topSpot?.photo || '';
  return { monthName: first.toLocaleString(undefined, { month: 'long' }), year: first.getFullYear(), meals, newSpots, cuisines: cuisines.size, topSpot, bestDish, photo };
}

async function shareWrap () {
  const s = wrapStats(_wrapOffset);
  if (!s.meals) { showToast('Nothing to wrap yet', `Log a meal in ${s.monthName} and your wrap fills in.`, 'info'); return; }
  const text = `My ${s.monthName} in food: ${s.meals} meal${s.meals === 1 ? '' : 's'} out, ${s.newSpots} new spot${s.newSpots === 1 ? '' : 's'}`
    + `${s.bestDish ? `, and the ${s.bestDish.x.name} at ${s.bestDish.r.name} was the best thing I ate` : ''}. Track yours with Feed The Bear https://www.feed-the-bear.com`;
  trackProductEvent('wrap_shared', { meals: s.meals });
  if (window.StoryCard) {
    try {
      await StoryCard.openStory({
        kind: 'wrap', kicker: `${s.monthName} ${s.year}`, title: 'My month in food', photo: s.photo,
        stats: [{ n: s.meals, label: s.meals === 1 ? 'meal out' : 'meals out' }, { n: s.newSpots, label: 'new spots' }, { n: s.cuisines, label: s.cuisines === 1 ? 'cuisine' : 'cuisines' }],
        sections: [
          s.bestDish ? { label: 'Best bite', items: [`${s.bestDish.x.name} · ${s.bestDish.r.name}`], tone: 'gold' } : null,
          s.topSpot ? { label: 'Most visited', items: [s.topSpot.name], tone: 'soft' } : null,
        ].filter(Boolean),
      }, text, `my-${s.monthName}-in-food`);
      return;
    } catch (err) { console.warn('[FTB] wrap card failed:', err); }
  }
  if (navigator.share) { navigator.share({ title: 'My Foodie Wrap', text }).catch(() => {}); }
  else { navigator.clipboard?.writeText(text); showToast('Copied!', 'Wrap text copied to clipboard', 'success'); }
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
    if (avgRating) slides.push(`<div class="review-slide"><div class="review-slide-emoji">⭐</div><div class="review-slide-title">Your Average Rating</div><div class="review-slide-value">${avgRating} / 5</div><div class="review-slide-sub">${avgRating>=4.5?'You have high standards!':avgRating>=3.5?'You eat well!':'Room to discover better spots'}</div></div>`);
    if (months[peakMonthIdx] > 0) slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">Most Active Month</div><div class="review-slide-value">${MONTH_NAMES[peakMonthIdx]}</div><div class="review-slide-sub">${months[peakMonthIdx]} meal${months[peakMonthIdx]!==1?'s':''} out that month</div></div>`);
    slides.push(`<div class="review-slide"><div class="review-slide-emoji"></div><div class="review-slide-title">Estimated Dining Spend</div><div class="review-slide-value">~$${estimatedSpend.toLocaleString()}</div><div class="review-slide-sub">Based on ${totalVisits} visits · $${state.settings.avgSpend||35}/avg</div></div>`);
    if (topRated.length) {
      const topRatedHtml = topRated.map(r=>`<li><span>${escHtml(r.name)}</span><span>${'★'.repeat(r.myRating)}</span></li>`).join('');
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
  const text = `📅 My ${yr} Foodie Year: ${yearVisits.length} meals out, ${new Set(yearVisits.map(r=>r.id)).size} restaurants. Track yours at Feed The Bear!`;
  if (navigator.share) navigator.share({ title: 'My Foodie Year ' + yr, text }).catch(()=>{});
  else { navigator.clipboard?.writeText(text); showToast('Copied!', 'Year in Review summary copied.', 'success'); }
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
  ctx.fillText('🧬 My Taste DNA', 50, 75);
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
    showToast('Taste DNA!', 'Your flavor profile card is ready!', 'success');
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
    showToast('Weekly Goal Set!', n + ' meal' + (n !== 1 ? 's' : '') + ' per week. Let\'s eat!', 'success');
  } else {
    showToast('Goal Cleared', 'Weekly goal widget hidden.', 'info');
  }
}
