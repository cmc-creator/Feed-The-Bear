/* ════════════════════════════════════════════════════════════
   Feed The Bear - Decision Mode (Phase 1)
   60-second decision flow to help users pick a restaurant fast
   ════════════════════════════════════════════════════════════ */

'use strict';

/**
 * Decision Mode State
 */
const decisionState = {
  sessionId: null,
  startTime: null,
  constraints: {
    mood: null,          // 'quick_bite', 'sit_down', 'fancy', 'comfort'
    budget: null,        // 1-4 ($, $$, $$$, $$$$)
    distance: null,      // 'walking', 'short_drive', 'any'
    partySize: null,     // number
    cuisine: null,       // cuisine preference
  },
  candidates: [],        // Filtered restaurants
  shortlist: [],         // Top 3 picks
  winner: null,          // Selected winner
};

/**
 * Start a decision session
 */
function startDecisionMode() {
  // Reset state
  decisionState.sessionId = `decision_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  decisionState.startTime = Date.now();
  decisionState.constraints = {
    mood: null,
    budget: null,
    distance: null,
    partySize: 1,
    cuisine: null,
  };
  decisionState.candidates = [];
  decisionState.shortlist = [];
  decisionState.winner = null;

  // Track event
  if (window.Analytics) {
    Analytics.decisionSessionStarted({
      sessionId: decisionState.sessionId,
      restaurantCount: state?.restaurants?.length || 0,
    });
  }

  // Show decision mode UI
  openDecisionModeModal();
}

/**
 * Set constraint value
 */
function setDecisionConstraint(key, value) {
  if (key in decisionState.constraints) {
    decisionState.constraints[key] = value;
    updateDecisionUI();
  }
}

/**
 * Calculate restaurant score based on constraints
 */
function scoreRestaurant(restaurant, userLocation = null) {
  let score = 0;
  const { constraints } = decisionState;

  // Base score from rating
  if (restaurant.rating) {
    score += restaurant.rating * 10;
  }

  // Mood matching
  if (constraints.mood) {
    const moodMatch = {
      quick_bite: ['cafe', 'fast_food', 'burgers', 'pizza', 'sandwich'],
      sit_down: ['restaurant', 'italian', 'japanese', 'mexican', 'chinese'],
      fancy: ['steakhouse', 'french', 'fine_dining', 'seafood'],
      comfort: ['american', 'bbq', 'pizza', 'burgers', 'italian'],
    };

    const cuisineKey = cuisineKey(restaurant.cuisine || restaurant.category || '');
    if (moodMatch[constraints.mood]?.some(c => cuisineKey.includes(c))) {
      score += 20;
    }
  }

  // Budget matching
  if (constraints.budget && restaurant.priceRange) {
    const priceDiff = Math.abs(restaurant.priceRange - constraints.budget);
    score += (4 - priceDiff) * 5; // Closer to budget = higher score
  }

  // Distance matching (if location available)
  if (constraints.distance && userLocation && restaurant.lat && restaurant.lng) {
    const dist = calculateDistance(
      userLocation.lat,
      userLocation.lng,
      restaurant.lat,
      restaurant.lng
    );

    const distanceBonus = {
      walking: dist < 1 ? 25 : dist < 2 ? 10 : 0,        // < 1 mile preferred
      short_drive: dist < 5 ? 20 : dist < 10 ? 10 : 0,   // < 5 miles preferred
      any: dist < 20 ? 10 : 5,                            // Anywhere nearby
    };

    score += distanceBonus[constraints.distance] || 0;
  }

  // Cuisine preference
  if (constraints.cuisine) {
    const cuisineKey = cuisineKey(restaurant.cuisine || restaurant.category || '');
    if (cuisineKey === constraints.cuisine.toLowerCase()) {
      score += 30;
    }
  }

  // Recency bonus (visited recently = lower score)
  if (restaurant.lastVisitedAt) {
    const daysSinceVisit = (Date.now() - restaurant.lastVisitedAt) / (1000 * 60 * 60 * 24);
    if (daysSinceVisit < 7) score -= 15;      // Visited this week
    else if (daysSinceVisit < 30) score -= 5; // Visited this month
  }

  // "Want to try" boost
  if (restaurant.status === 'want_to_try') {
    score += 15;
  }

  // Favorite boost
  if (restaurant.tags?.includes('favorite')) {
    score += 10;
  }

  return Math.max(0, score);
}

/**
 * Generate shortlist based on constraints
 */
function generateShortlist() {
  const restaurants = state?.restaurants || [];

  if (!restaurants.length) {
    showToast('No restaurants', 'Add some restaurants to your den first!', 'info');
    return;
  }

  // Get user location if available
  const userLocation = state?.lastKnownLocation || null;

  // Score all restaurants
  const scored = restaurants.map(r => ({
    restaurant: r,
    score: scoreRestaurant(r, userLocation),
  }));

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Filter out very low scores (< 10)
  const viable = scored.filter(s => s.score >= 10);

  if (!viable.length) {
    showToast('No matches', 'Try adjusting your preferences - no spots matched your criteria.', 'info');
    return;
  }

  // Top 3
  decisionState.candidates = scored.map(s => s.restaurant);
  decisionState.shortlist = viable.slice(0, 3).map(s => s.restaurant);

  // Update UI
  renderDecisionShortlist();

  // Track event
  if (window.Analytics) {
    Analytics.track('decision_shortlist_generated', {
      sessionId: decisionState.sessionId,
      candidateCount: decisionState.candidates.length,
      shortlistCount: decisionState.shortlist.length,
      constraints: { ...decisionState.constraints },
    });
  }
}

/**
 * Select winner
 */
function selectDecisionWinner(restaurant) {
  decisionState.winner = restaurant;

  const duration = Date.now() - decisionState.startTime;

  // Track completion
  if (window.Analytics) {
    Analytics.decisionSessionCompleted({
      sessionId: decisionState.sessionId,
      winnerId: restaurant.id,
      winnerName: restaurant.name,
      durationSeconds: Math.round(duration / 1000),
      shortlistPosition: decisionState.shortlist.findIndex(r => r.id === restaurant.id) + 1,
    });

    Analytics.decisionOptionSelected({
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      source: 'decision_mode',
    });
  }

  // Show winner UI
  renderDecisionWinner(restaurant);
}

/**
 * Helper: Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * UI Rendering Functions
 */

function openDecisionModeModal() {
  const modal = document.getElementById('decision-mode-modal');
  if (!modal) {
    console.warn('[Decision Mode] Modal not found - may need to add to HTML');
    return;
  }

  modal.classList.remove('hidden');
  document.body.classList.add('overlay-open');

  // Reset to constraints view
  showDecisionView('constraints');
}

function closeDecisionModeModal() {
  const modal = document.getElementById('decision-mode-modal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.classList.remove('overlay-open');
  }
}

function showDecisionView(view) {
  const views = ['constraints', 'shortlist', 'winner'];
  views.forEach(v => {
    const el = document.getElementById(`decision-view-${v}`);
    if (el) {
      el.classList.toggle('hidden', v !== view);
    }
  });
}

function updateDecisionUI() {
  const { constraints } = decisionState;

  // Update active states for constraint chips
  const chipGroups = {
    mood: ['quick_bite', 'sit_down', 'fancy', 'comfort'],
    budget: [1, 2, 3, 4],
    distance: ['walking', 'short_drive', 'any'],
  };

  Object.entries(chipGroups).forEach(([group, values]) => {
    values.forEach(val => {
      const chip = document.querySelector(`[data-constraint="${group}"][data-value="${val}"]`);
      if (chip) {
        chip.classList.toggle('active', constraints[group] === val);
      }
    });
  });

  // Update party size
  const partySizeInput = document.getElementById('decision-party-size');
  if (partySizeInput) {
    partySizeInput.value = constraints.partySize || 1;
  }

  // Enable/disable "Find My Match" button
  const findBtn = document.getElementById('decision-find-btn');
  if (findBtn) {
    const hasConstraints = constraints.mood || constraints.budget || constraints.distance;
    findBtn.disabled = !hasConstraints;
  }
}

function renderDecisionShortlist() {
  const container = document.getElementById('decision-shortlist-container');
  if (!container) return;

  container.innerHTML = '';

  if (!decisionState.shortlist.length) {
    container.innerHTML = `
      <div class="decision-empty">
        <div class="decision-empty-icon">🐻</div>
        <div class="decision-empty-text">No matches found. Try different preferences!</div>
      </div>
    `;
    return;
  }

  decisionState.shortlist.forEach((restaurant, index) => {
    const card = createDecisionCard(restaurant, index + 1);
    container.appendChild(card);
  });

  showDecisionView('shortlist');
}

function createDecisionCard(restaurant, position) {
  const card = document.createElement('div');
  card.className = 'decision-card';
  card.dataset.restaurantId = restaurant.id;

  const emoji = cuisineEmoji(restaurant.cuisine || restaurant.category);
  const rating = restaurant.rating ? `⭐ ${restaurant.rating}` : '';
  const price = restaurant.priceRange ? '$'.repeat(restaurant.priceRange) : '';
  const distance = restaurant.distance ? `📍 ${restaurant.distance.toFixed(1)} mi` : '';

  // Confidence indicators
  const hasPhoto = !!restaurant.photoUrl;
  const hasMenu = !!restaurant.menuUrl;
  const confidence = hasPhoto && hasMenu ? 'high' : hasPhoto || hasMenu ? 'medium' : 'low';

  card.innerHTML = `
    <div class="decision-card-position">#${position}</div>
    <div class="decision-card-emoji">${emoji}</div>
    <div class="decision-card-body">
      <div class="decision-card-name">${escapeHtml(restaurant.name)}</div>
      <div class="decision-card-meta">
        ${rating ? `<span>${rating}</span>` : ''}
        ${price ? `<span>${price}</span>` : ''}
        ${distance ? `<span>${distance}</span>` : ''}
      </div>
      <div class="decision-card-confidence confidence-${confidence}">
        ${hasPhoto ? '📸 ' : ''}${hasMenu ? '📋 ' : ''}
        ${confidence === 'high' ? 'High confidence' : confidence === 'medium' ? 'Good match' : 'Limited info'}
      </div>
    </div>
    <div class="decision-card-actions">
      <button class="btn-decision-choose" onclick="selectDecisionWinner(state.restaurants.find(r => r.id === '${restaurant.id}'))">
        Choose This
      </button>
      ${restaurant.menuUrl ? `<button class="btn-decision-menu" onclick="window.open('${escapeHtml(restaurant.menuUrl)}', '_blank')">Menu</button>` : ''}
      ${restaurant.lat && restaurant.lng ? `<button class="btn-decision-directions" onclick="openDirections(${restaurant.lat}, ${restaurant.lng}, '${escapeHtml(restaurant.name)}')">Directions</button>` : ''}
    </div>
  `;

  return card;
}

function renderDecisionWinner(restaurant) {
  const container = document.getElementById('decision-winner-container');
  if (!container) return;

  const emoji = cuisineEmoji(restaurant.cuisine || restaurant.category);
  const rating = restaurant.rating ? `⭐ ${restaurant.rating}` : '';
  const price = restaurant.priceRange ? '$'.repeat(restaurant.priceRange) : '';

  container.innerHTML = `
    <div class="decision-winner">
      <div class="decision-winner-badge">🏆 Tonight's Winner</div>
      <div class="decision-winner-emoji">${emoji}</div>
      <h2 class="decision-winner-name">${escapeHtml(restaurant.name)}</h2>
      <div class="decision-winner-meta">
        ${rating ? `<span>${rating}</span>` : ''}
        ${price ? `<span>${price}</span>` : ''}
        ${restaurant.cuisine ? `<span>${escapeHtml(formatCuisineLabel(restaurant.cuisine))}</span>` : ''}
      </div>
      ${restaurant.address ? `<div class="decision-winner-address">📍 ${escapeHtml(restaurant.address)}</div>` : ''}
      <div class="decision-winner-actions">
        ${restaurant.lat && restaurant.lng ? `
          <button class="btn btn-primary" onclick="openDirections(${restaurant.lat}, ${restaurant.lng}, '${escapeHtml(restaurant.name)}')">
            Get Directions
          </button>
        ` : ''}
        ${restaurant.menuUrl ? `
          <button class="btn btn-secondary" onclick="window.open('${escapeHtml(restaurant.menuUrl)}', '_blank')">
            View Menu
          </button>
        ` : ''}
        ${restaurant.website ? `
          <button class="btn btn-secondary" onclick="window.open('${escapeHtml(restaurant.website)}', '_blank')">
            Visit Website
          </button>
        ` : ''}
        <button class="btn btn-secondary" onclick="closeDecisionModeModal(); viewRestaurant('${restaurant.id}')">
          View Details
        </button>
      </div>
      <div class="decision-winner-footer">
        <button class="btn-text" onclick="showDecisionView('shortlist')">← See other options</button>
        <button class="btn-text" onclick="closeDecisionModeModal()">Done</button>
      </div>
    </div>
  `;

  showDecisionView('winner');
}

function openDirections(lat, lng, name) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(name)}`;
  window.open(url, '_blank');

  if (window.Analytics) {
    Analytics.nearbyDirectionsOpened({
      source: 'decision_mode',
      restaurantName: name,
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expose globally
window.startDecisionMode = startDecisionMode;
window.closeDecisionModeModal = closeDecisionModeModal;
window.setDecisionConstraint = setDecisionConstraint;
window.generateShortlist = generateShortlist;
window.selectDecisionWinner = selectDecisionWinner;

console.log('[Decision Mode] Initialized');
