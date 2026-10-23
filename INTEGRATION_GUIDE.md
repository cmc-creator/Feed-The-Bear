# Quick Integration Guide 🚀

This guide shows exactly where to add code to integrate the new features into your existing app.

---

## 1. Add Decision Mode Button to Main UI

### Option A: Add to Home View (Recommended)
Find the main app container in `app.html` and add this button near the top:

```html
<!-- Add this where users first land in the app -->
<div class="decision-mode-cta-container">
  <button class="btn-primary btn-decision-cta" onclick="startDecisionMode()">
    <span class="decision-cta-icon">🎯</span>
    <div class="decision-cta-text">
      <strong>Can't Decide Where to Eat?</strong>
      <span>We'll pick for you in 60 seconds</span>
    </div>
  </button>
</div>
```

Add this CSS to `style.css`:
```css
.decision-mode-cta-container {
  margin: 20px 0;
  padding: 0 16px;
}

.btn-decision-cta {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: linear-gradient(135deg, var(--primary), var(--gold));
  box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.25);
  text-align: left;
}

.decision-cta-icon {
  font-size: 2.5rem;
  line-height: 1;
}

.decision-cta-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.decision-cta-text strong {
  font-size: 1.1rem;
  font-weight: 800;
}

.decision-cta-text span {
  font-size: 0.85rem;
  opacity: 0.9;
  font-weight: 500;
}
```

### Option B: Add to Navigation Menu
Find your navigation menu in `app.html` and add:

```html
<button class="nav-item" onclick="startDecisionMode()">
  🎯 Decision Mode
</button>
```

### Option C: Add to Empty State
When users have no restaurants or no filters active:

```html
<div class="empty-state">
  <p>No restaurants yet?</p>
  <button class="btn-secondary" onclick="startDecisionMode()">
    🎯 Help Me Decide
  </button>
</div>
```

---

## 2. Integrate Analytics Tracking

### In app.js - Find and Update These Functions

#### When Adding a Restaurant:
```javascript
// Find: function addRestaurant() or similar
function addRestaurant(data) {
  // ... existing code ...
  state.restaurants.push(restaurant);

  // ADD THIS:
  Analytics.restaurantAdded({
    source: 'manual',
    cuisine: restaurant.cuisine || 'unknown',
    hasPhoto: !!restaurant.photoUrl,
    hasRating: !!restaurant.rating
  });

  saveData();
}
```

#### When Searching Nearby:
```javascript
// Find: nearby search function
function searchNearby(lat, lng, radius) {
  // ADD THIS AT START:
  Analytics.nearbySearchPerformed({
    radius,
    userLocation: { lat, lng }
  });

  // ... existing search code ...
}
```

#### When Opening Upgrade Modal:
```javascript
// Find: openUpgradeModal() in firebase.js
function openUpgradeModal(highlightFeature) {
  // ADD THIS AT START:
  Analytics.upgradeModalOpened({
    feature: highlightFeature || 'general',
    trigger: 'user_action'
  });

  // ... existing code ...
  const overlay = document.getElementById('upgrade-overlay');
  // ...
}
```

#### When Clicking Upgrade CTA:
```javascript
// Find: _handleUpgradeClick() in firebase.js
async function _handleUpgradeClick() {
  const user = _auth?.currentUser;
  if (!user) {
    // ... existing code ...
  }

  const period = btn?.dataset.period || 'yearly';

  // ADD THIS:
  Analytics.upgradeCtaClicked({
    plan: period,
    priceId: period === 'yearly' ? _PRICES.yearly : _PRICES.monthly
  });

  // ... rest of existing code ...
}
```

#### When Purchase Completes:
```javascript
// Find: _verifyAndActivatePlan() in firebase.js
async function _verifyAndActivatePlan (sessionId, uid) {
  try {
    const resp = await fetch(`/api/verify-session?sessionId=${encodeURIComponent(sessionId)}&uid=${encodeURIComponent(uid)}`);
    const data = await resp.json();
    if (data.plan === 'grizzly') {
      window._ftbPlan = 'grizzly';
      localStorage.setItem('ftb_plan_v1', 'grizzly');

      // ADD THIS:
      Analytics.planPurchased({
        plan: 'grizzly',
        sessionId: sessionId
      });

      if (state?.restaurants?.length) fbSaveRestaurants(uid, state.restaurants);
    }
  } catch (err) {
    console.warn('[FTB] Plan verification failed:', err);
  }
}
```

#### When Rating a Restaurant:
```javascript
// Find: where restaurant.rating is set
function rateRestaurant(id, rating) {
  const restaurant = state.restaurants.find(r => r.id === id);
  if (restaurant) {
    restaurant.rating = rating;

    // ADD THIS:
    Analytics.restaurantRated({
      restaurantId: id,
      rating: rating,
      cuisine: restaurant.cuisine
    });

    saveData();
  }
}
```

#### When Opening Map:
```javascript
// Find: map opening function
function openMap() {
  // ADD THIS:
  Analytics.mapOpened({
    restaurantCount: state.restaurants.length
  });

  // ... existing code ...
}
```

---

## 3. Integrate Trust Layer

### Option A: Enrich All Restaurants on Load
In `app.js`, find where restaurants are loaded:

```javascript
// Find: function loadData() or similar
function loadData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      state.restaurants = JSON.parse(stored);

      // ADD THIS - Enrich on load:
      if (typeof TrustLayer !== 'undefined') {
        state.restaurants = TrustLayer.enrichAllRestaurants(state.restaurants);
      }
    }
  } catch (err) {
    console.warn('Failed to load data:', err);
  }
}
```

### Option B: Enrich Just Before Rendering
In `app.js`, find where restaurant cards are rendered:

```javascript
// Find: function renderRestaurantCard() or similar
function renderRestaurantCard(restaurant) {
  // ADD THIS AT START:
  const enriched = TrustLayer ? TrustLayer.enrichRestaurantData(restaurant) : restaurant;
  const trustBadge = TrustLayer ? TrustLayer.getTrustBadge(enriched.trustScore) : null;

  // REPLACE: restaurant.photoUrl with enriched.displayPhotoUrl
  // REPLACE: restaurant.menuUrl with enriched.menuUrl

  const card = document.createElement('div');
  card.className = 'restaurant-card';
  card.innerHTML = `
    <img src="${enriched.displayPhotoUrl || '/placeholder.jpg'}" alt="${escapeHtml(restaurant.name)}" />
    <div class="card-content">
      <h3>${escapeHtml(restaurant.name)}</h3>
      ${trustBadge ? `<span class="trust-badge ${trustBadge.class}">${trustBadge.icon} ${trustBadge.label}</span>` : ''}
      <!-- rest of card HTML -->
    </div>
  `;

  return card;
}
```

### Add Trust Badge CSS
Add to `style.css`:

```css
.trust-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 100px;
  font-size: 0.75rem;
  font-weight: 600;
}

.trust-high {
  background: rgba(76, 195, 138, 0.15);
  color: var(--green);
}

.trust-medium {
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--primary);
}

.trust-low {
  background: rgba(155, 123, 224, 0.15);
  color: var(--blue);
}

.trust-very-low {
  background: var(--surface2);
  color: var(--text-dim);
}
```

---

## 4. Add Loading States (Optional but Recommended)

### Skeleton Screen for Restaurant List
Add to `app.html`:

```html
<div id="restaurant-list-skeleton" class="skeleton-container hidden">
  <div class="skeleton-card"></div>
  <div class="skeleton-card"></div>
  <div class="skeleton-card"></div>
</div>
```

Add to `style.css`:

```css
.skeleton-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.skeleton-card {
  height: 120px;
  background: linear-gradient(
    90deg,
    var(--surface) 0%,
    var(--surface2) 50%,
    var(--surface) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: var(--radius-lg);
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Show/hide in JavaScript:
```javascript
// Before loading:
document.getElementById('restaurant-list-skeleton').classList.remove('hidden');
document.getElementById('restaurant-list').classList.add('hidden');

// After loading:
document.getElementById('restaurant-list-skeleton').classList.add('hidden');
document.getElementById('restaurant-list').classList.remove('hidden');
```

---

## 5. Test Everything

### Testing Checklist:

```bash
# 1. Open app in browser
# 2. Open DevTools Console
# 3. Test Decision Mode
startDecisionMode()
# - Click mood/budget/distance chips
# - Click "Find My Match"
# - Verify shortlist appears
# - Click "Choose This" on a restaurant

# 4. Test Analytics
Analytics.getMetrics()
# - Should see event counts
# - Check last7Days metrics

# 5. Test Trust Layer
TrustLayer.enrichRestaurantData(state.restaurants[0])
# - Should see trustScore, displayPhotoUrl, etc.

# 6. Check for errors
# - No red errors in console
# - All new files loaded successfully
```

---

## 6. Commit Your Changes

```bash
git add .
git commit -m "Add Decision Mode, Analytics, and Trust Layer

- Implement 60-second decision flow with constraint-based scoring
- Add complete analytics tracking system with 30+ event types
- Add trust layer for data quality validation and photo scoring
- Update service worker to cache new features
- Add comprehensive documentation

Addresses Hot Seller Roadmap Phase 1 and Phase 2"
git push
```

---

## Quick Reference Card

**Launch Decision Mode:**
```javascript
startDecisionMode()
```

**Track Event:**
```javascript
Analytics.track('event_name', { key: 'value' })
```

**Enrich Restaurant:**
```javascript
const enriched = TrustLayer.enrichRestaurantData(restaurant)
```

**View Metrics:**
```javascript
Analytics.getMetrics()
```

---

## Need Help?

1. Check [IMPROVEMENTS.md](IMPROVEMENTS.md) for full documentation
2. Look at inline code comments in each .js file
3. Test in browser console
4. Check Analytics.getMetrics() for debugging data

---

That's it! 🎉 Your app now has world-class decision-making, analytics, and data quality features.
