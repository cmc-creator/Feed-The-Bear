/* ════════════════════════════════════════════════════════════
   Feed The Bear - Analytics & Event Tracking
   ════════════════════════════════════════════════════════════ */

'use strict';

/**
 * Centralized analytics system for tracking user behavior and conversions.
 * Events are stored locally and can be synced to analytics platforms.
 */

const ANALYTICS_KEY = 'ftb_analytics_events_v1';
const MAX_STORED_EVENTS = 1000;

// Event queue for batch processing
let eventQueue = [];
let flushTimer = null;

/**
 * Track a product event
 * @param {string} eventName - Event identifier (e.g., 'decision_session_started')
 * @param {object} properties - Event properties
 */
function trackEvent(eventName, properties = {}) {
  const event = {
    name: eventName,
    timestamp: Date.now(),
    userId: window._ftbUid || 'anonymous',
    plan: window._ftbPlan || 'free',
    sessionId: getSessionId(),
    properties: {
      ...properties,
      // Auto-capture context
      url: window.location.pathname,
      referrer: document.referrer || '(direct)',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: navigator.userAgent,
    }
  };

  // Add to queue
  eventQueue.push(event);

  // Store locally
  storeEvent(event);

  // Also call existing app.js trackProductEvent if it exists
  if (typeof trackProductEvent === 'function') {
    trackProductEvent(eventName, properties);
  }

  // Flush to analytics platforms
  scheduleFlush();

  // Console logging in development
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log(`[Analytics] ${eventName}`, properties);
  }

  return event;
}

/**
 * Store event in localStorage
 */
function storeEvent(event) {
  try {
    const stored = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]');
    stored.push(event);

    // Keep only recent events
    const trimmed = stored.slice(-MAX_STORED_EVENTS);
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[Analytics] Failed to store event:', err);
  }
}

/**
 * Get or create session ID
 */
function getSessionId() {
  const SESSION_KEY = 'ftb_session_id';
  const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

  let session = null;
  try {
    session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {}

  const now = Date.now();
  if (!session || now - session.lastActivity > SESSION_DURATION) {
    session = {
      id: `sess_${now}_${Math.random().toString(36).substr(2, 9)}`,
      startedAt: now,
      lastActivity: now,
    };
  } else {
    session.lastActivity = now;
  }

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session.id;
}

/**
 * Schedule event flush to analytics platforms
 */
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushEvents, 2000); // Batch events every 2 seconds
}

/**
 * Flush events to analytics platforms
 */
function flushEvents() {
  if (!eventQueue.length) return;

  const batch = [...eventQueue];
  eventQueue = [];

  // Send to Google Analytics 4 if configured
  if (typeof gtag !== 'undefined') {
    batch.forEach(event => {
      gtag('event', event.name, event.properties);
    });
  }

  // Send to Firebase Analytics if configured
  if (window.firebase?.analytics) {
    try {
      const analytics = firebase.analytics();
      batch.forEach(event => {
        analytics.logEvent(event.name, event.properties);
      });
    } catch (err) {
      console.warn('[Analytics] Firebase Analytics error:', err);
    }
  }

  // Could also send to custom backend endpoint here
  // sendToBackend(batch);
}

/**
 * Get stored events for analysis
 */
function getStoredEvents(filter = {}) {
  try {
    const events = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]');

    let filtered = events;

    // Filter by event name
    if (filter.name) {
      filtered = filtered.filter(e => e.name === filter.name);
    }

    // Filter by date range
    if (filter.startDate) {
      filtered = filtered.filter(e => e.timestamp >= filter.startDate);
    }
    if (filter.endDate) {
      filtered = filtered.filter(e => e.timestamp <= filter.endDate);
    }

    // Filter by user
    if (filter.userId) {
      filtered = filtered.filter(e => e.userId === filter.userId);
    }

    return filtered;
  } catch {
    return [];
  }
}

/**
 * Calculate conversion metrics
 */
function getConversionMetrics() {
  const events = getStoredEvents();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Last 7 days
  const last7Days = events.filter(e => now - e.timestamp < 7 * day);

  // Count event types
  const eventCounts = {};
  last7Days.forEach(e => {
    eventCounts[e.name] = (eventCounts[e.name] || 0) + 1;
  });

  // Calculate key metrics
  const decisionSessions = eventCounts.decision_session_started || 0;
  const decisionsCompleted = eventCounts.decision_session_completed || 0;
  const upgradeOpened = eventCounts.upgrade_modal_opened || 0;
  const upgradeCTA = eventCounts.upgrade_cta_clicked || 0;
  const planPurchased = eventCounts.plan_purchased || 0;

  return {
    last7Days: {
      decisionSessions,
      decisionsCompleted,
      decisionCompletionRate: decisionSessions ? (decisionsCompleted / decisionSessions * 100).toFixed(1) + '%' : 'N/A',
      upgradeModalOpened: upgradeOpened,
      upgradeClicks: upgradeCTA,
      upgradeCTR: upgradeOpened ? (upgradeCTA / upgradeOpened * 100).toFixed(1) + '%' : 'N/A',
      conversions: planPurchased,
      conversionRate: upgradeCTA ? (planPurchased / upgradeCTA * 100).toFixed(1) + '%' : 'N/A',
    },
    eventCounts,
    totalEvents: events.length,
  };
}

/**
 * Clear old events (GDPR compliance)
 */
function clearOldEvents(daysToKeep = 90) {
  try {
    const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const events = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '[]');
    const filtered = events.filter(e => e.timestamp >= cutoff);
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(filtered));
    return events.length - filtered.length;
  } catch {
    return 0;
  }
}

// ─── PREDEFINED EVENT TRACKERS ────────────────────────────────

const Analytics = {
  // Core tracking
  track: trackEvent,
  getEvents: getStoredEvents,
  getMetrics: getConversionMetrics,
  clearOldEvents,

  // Decision Mode events
  decisionSessionStarted: (props) => trackEvent('decision_session_started', props),
  decisionSessionCompleted: (props) => trackEvent('decision_session_completed', props),
  decisionOptionSelected: (props) => trackEvent('decision_option_selected', props),

  // Restaurant actions
  nearbyCardSaved: (props) => trackEvent('nearby_card_saved', props),
  nearbyMenuOpened: (props) => trackEvent('nearby_menu_opened', props),
  nearbyWebsiteOpened: (props) => trackEvent('nearby_website_opened', props),
  nearbyDirectionsOpened: (props) => trackEvent('nearby_directions_opened', props),
  restaurantAdded: (props) => trackEvent('restaurant_added', props),
  restaurantEdited: (props) => trackEvent('restaurant_edited', props),
  restaurantDeleted: (props) => trackEvent('restaurant_deleted', props),
  restaurantVisited: (props) => trackEvent('restaurant_visited', props),
  restaurantRated: (props) => trackEvent('restaurant_rated', props),

  // Monetization events
  upgradeModalOpened: (props) => trackEvent('upgrade_modal_opened', props),
  upgradeCtaClicked: (props) => trackEvent('upgrade_cta_clicked', props),
  planPurchased: (props) => trackEvent('plan_purchased', props),

  // Sharing & Growth
  shareWinnerOpened: (props) => trackEvent('share_winner_opened', props),
  shareWinnerCompleted: (props) => trackEvent('share_winner_completed', props),
  referralLinkCopied: (props) => trackEvent('referral_link_copied', props),

  // Map & Discovery
  mapOpened: (props) => trackEvent('map_opened', props),
  mapLocationChanged: (props) => trackEvent('map_location_changed', props),
  nearbySearchPerformed: (props) => trackEvent('nearby_search_performed', props),

  // Bear Swipe
  swipeSessionStarted: (props) => trackEvent('swipe_session_started', props),
  swipeSessionCompleted: (props) => trackEvent('swipe_session_completed', props),
  restaurantSwiped: (props) => trackEvent('restaurant_swiped', props),

  // AI Features
  aiChatOpened: (props) => trackEvent('ai_chat_opened', props),
  aiMessageSent: (props) => trackEvent('ai_message_sent', props),
  aiRecommendationAccepted: (props) => trackEvent('ai_recommendation_accepted', props),

  // Collections & Tags
  collectionCreated: (props) => trackEvent('collection_created', props),
  tagAdded: (props) => trackEvent('tag_added', props),

  // Search & Filter
  searchPerformed: (props) => trackEvent('search_performed', props),
  filterApplied: (props) => trackEvent('filter_applied', props),

  // Auth & Account
  signupStarted: (props) => trackEvent('signup_started', props),
  signupCompleted: (props) => trackEvent('signup_completed', props),
  signinCompleted: (props) => trackEvent('signin_completed', props),
  signoutCompleted: (props) => trackEvent('signout_completed', props),

  // Engagement
  photoUploaded: (props) => trackEvent('photo_uploaded', props),
  noteAdded: (props) => trackEvent('note_added', props),
  dishAdded: (props) => trackEvent('dish_added', props),
};

// Expose globally
window.Analytics = Analytics;

// Flush on page unload
window.addEventListener('beforeunload', () => {
  flushEvents();
});

// Auto-cleanup old events monthly
if (Math.random() < 0.01) { // 1% chance per page load
  clearOldEvents(90);
}

console.log('[Analytics] Event tracking initialized');
