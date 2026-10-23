/* ════════════════════════════════════════════════════════════
   Feed The Bear - Trust Layer (Phase 2)
   Data quality, relevance scoring, and photo validation
   ════════════════════════════════════════════════════════════ */

'use strict';

/**
 * Photo source quality scoring
 */
const PHOTO_SOURCE_SCORES = {
  restaurant_provided: 100,
  google_place_photo: 80,
  user_uploaded: 90,
  cuisine_generic: 40,
  placeholder: 0,
};

/**
 * Cuisine-to-food keyword mapping for image relevance
 */
const CUISINE_FOOD_KEYWORDS = {
  mexican: ['taco', 'burrito', 'enchilada', 'quesadilla', 'salsa', 'guacamole', 'nachos', 'fajita'],
  italian: ['pizza', 'pasta', 'spaghetti', 'lasagna', 'risotto', 'ravioli', 'tiramisu'],
  japanese: ['sushi', 'ramen', 'tempura', 'teriyaki', 'miso', 'udon', 'sashimi', 'bento'],
  chinese: ['dumpling', 'noodle', 'fried rice', 'spring roll', 'dim sum', 'wonton'],
  indian: ['curry', 'naan', 'tandoori', 'biryani', 'samosa', 'tikka', 'dal'],
  thai: ['pad thai', 'curry', 'tom yum', 'spring roll', 'satay', 'mango sticky rice'],
  american: ['burger', 'fries', 'wings', 'bbq', 'steak', 'sandwich'],
  cafe: ['coffee', 'latte', 'cappuccino', 'espresso', 'pastry', 'croissant', 'muffin'],
  breakfast: ['eggs', 'pancake', 'waffle', 'bacon', 'toast', 'omelette'],
  bbq: ['ribs', 'brisket', 'pulled pork', 'smoked', 'barbecue'],
  seafood: ['fish', 'shrimp', 'lobster', 'crab', 'salmon', 'tuna'],
  pizza: ['pizza', 'slice', 'pepperoni', 'margherita'],
  burgers: ['burger', 'cheeseburger', 'patty', 'bun'],
  sushi: ['sushi', 'roll', 'nigiri', 'sashimi', 'tuna', 'salmon'],
};

/**
 * Blocked domains for parked/expired sites
 */
const BLOCKED_DOMAINS = [
  'expireddomains.net',
  'hugedomains.com',
  'sedo.com',
  'afternic.com',
  'dan.com',
  'parkingcrew.net',
  'bodis.com',
  'parked.com',
  'domainmarket.com',
  'undeveloped.com',
];

/**
 * Score photo relevance to cuisine
 */
function scorePhotoRelevance(photoUrl, altText, cuisine) {
  if (!photoUrl || !cuisine) return 50; // Neutral score

  let score = 50;
  const cuisineKey = String(cuisine).toLowerCase().trim();
  const keywords = CUISINE_FOOD_KEYWORDS[cuisineKey] || [];

  if (!keywords.length) return 60; // Unknown cuisine, slight boost

  // Check URL for food keywords
  const urlLower = photoUrl.toLowerCase();
  const altLower = (altText || '').toLowerCase();
  const combined = `${urlLower} ${altLower}`;

  let matches = 0;
  keywords.forEach(keyword => {
    if (combined.includes(keyword)) {
      matches++;
      score += 10;
    }
  });

  // Check for generic restaurant/building images (lower score)
  const genericKeywords = ['exterior', 'building', 'storefront', 'sign', 'logo'];
  const hasGeneric = genericKeywords.some(k => combined.includes(k));
  if (hasGeneric && matches === 0) {
    score -= 20;
  }

  // Bonus for having multiple matches
  if (matches >= 2) score += 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Validate photo source quality
 */
function validatePhotoSource(photoUrl, metadata = {}) {
  if (!photoUrl) {
    return {
      isValid: false,
      score: 0,
      source: 'none',
      issues: ['No photo provided'],
    };
  }

  const issues = [];
  let source = 'unknown';
  let score = 50; // Default

  // Detect source
  if (metadata.uploadedByUser) {
    source = 'user_uploaded';
    score = PHOTO_SOURCE_SCORES.user_uploaded;
  } else if (photoUrl.includes('googleusercontent') || photoUrl.includes('maps.googleapis')) {
    source = 'google_place_photo';
    score = PHOTO_SOURCE_SCORES.google_place_photo;
  } else if (metadata.fromRestaurant) {
    source = 'restaurant_provided';
    score = PHOTO_SOURCE_SCORES.restaurant_provided;
  } else if (photoUrl.includes('placeholder') || photoUrl.includes('default')) {
    source = 'placeholder';
    score = PHOTO_SOURCE_SCORES.placeholder;
    issues.push('Placeholder image detected');
  }

  // Check for watermarks
  const watermarkKeywords = ['watermark', 'shutterstock', 'getty', 'istockphoto'];
  if (watermarkKeywords.some(k => photoUrl.toLowerCase().includes(k))) {
    score -= 30;
    issues.push('Stock photo or watermark detected');
  }

  // Check URL validity
  try {
    const url = new URL(photoUrl);
    if (BLOCKED_DOMAINS.some(d => url.hostname.includes(d))) {
      score = 0;
      issues.push('Blocked domain - parked/expired site');
    }
  } catch {
    score -= 20;
    issues.push('Invalid URL format');
  }

  return {
    isValid: score > 30,
    score,
    source,
    issues,
  };
}

/**
 * Generate fallback photo for cuisine
 */
function getFallbackPhotoForCuisine(cuisine) {
  const fallbacks = {
    mexican: '/assets/cuisine-fallbacks/mexican.jpg',
    italian: '/assets/cuisine-fallbacks/italian.jpg',
    japanese: '/assets/cuisine-fallbacks/japanese.jpg',
    chinese: '/assets/cuisine-fallbacks/chinese.jpg',
    indian: '/assets/cuisine-fallbacks/indian.jpg',
    thai: '/assets/cuisine-fallbacks/thai.jpg',
    american: '/assets/cuisine-fallbacks/american.jpg',
    cafe: '/assets/cuisine-fallbacks/cafe.jpg',
    pizza: '/assets/cuisine-fallbacks/pizza.jpg',
    burgers: '/assets/cuisine-fallbacks/burgers.jpg',
    sushi: '/assets/cuisine-fallbacks/sushi.jpg',
    bbq: '/assets/cuisine-fallbacks/bbq.jpg',
    seafood: '/assets/cuisine-fallbacks/seafood.jpg',
  };

  const cuisineKey = String(cuisine).toLowerCase().trim();
  return fallbacks[cuisineKey] || '/assets/cuisine-fallbacks/default.jpg';
}

/**
 * Enrich menu URL from website
 */
function enrichMenuUrl(website, restaurantName) {
  if (!website) return null;

  try {
    const url = new URL(website);

    // Check for blocked domains
    if (BLOCKED_DOMAINS.some(d => url.hostname.includes(d))) {
      return null;
    }

    // Common menu paths
    const menuPaths = ['/menu', '/our-menu', '/menus', '/food'];

    // Try to find menu page
    for (const path of menuPaths) {
      const menuUrl = `${url.origin}${path}`;
      return menuUrl; // Return first candidate (could validate with fetch in future)
    }

    // If no menu path found, return base website
    return website;
  } catch {
    return null;
  }
}

/**
 * Check if website is parked/expired
 */
function isParkedDomain(url) {
  if (!url) return false;

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check blocked domains
    if (BLOCKED_DOMAINS.some(d => hostname.includes(d))) {
      return true;
    }

    // Check URL path/query for parking indicators
    const fullUrl = url.toLowerCase();
    const parkingIndicators = [
      'domain for sale',
      'buy this domain',
      'premium domain',
      'parked domain',
      'expired domain',
      'afternic',
      'sedo.com',
      'godaddy.com/domain',
    ];

    return parkingIndicators.some(indicator => fullUrl.includes(indicator));
  } catch {
    return false;
  }
}

/**
 * Determine best photo to display based on source hierarchy
 */
function selectBestPhoto(restaurant) {
  const candidates = [];

  // User uploaded (highest priority)
  if (restaurant.userPhotoUrl) {
    candidates.push({
      url: restaurant.userPhotoUrl,
      source: 'user_uploaded',
      score: PHOTO_SOURCE_SCORES.user_uploaded,
    });
  }

  // Restaurant provided
  if (restaurant.restaurantPhotoUrl) {
    candidates.push({
      url: restaurant.restaurantPhotoUrl,
      source: 'restaurant_provided',
      score: PHOTO_SOURCE_SCORES.restaurant_provided,
    });
  }

  // Google place photo (validate first)
  if (restaurant.photoUrl) {
    const validation = validatePhotoSource(restaurant.photoUrl, {});
    if (validation.isValid) {
      const relevanceScore = scorePhotoRelevance(
        restaurant.photoUrl,
        restaurant.photoAlt,
        restaurant.cuisine
      );
      candidates.push({
        url: restaurant.photoUrl,
        source: validation.source,
        score: (validation.score + relevanceScore) / 2, // Average quality and relevance
      });
    }
  }

  // Cuisine fallback
  if (restaurant.cuisine) {
    candidates.push({
      url: getFallbackPhotoForCuisine(restaurant.cuisine),
      source: 'cuisine_generic',
      score: PHOTO_SOURCE_SCORES.cuisine_generic,
    });
  }

  // Select best candidate
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  // Default placeholder
  return {
    url: '/assets/placeholder-restaurant.jpg',
    source: 'placeholder',
    score: 0,
  };
}

/**
 * Validate and enrich restaurant data
 */
function enrichRestaurantData(restaurant) {
  const enriched = { ...restaurant };

  // Select best photo
  const bestPhoto = selectBestPhoto(restaurant);
  enriched.displayPhotoUrl = bestPhoto.url;
  enriched.photoSource = bestPhoto.source;
  enriched.photoQualityScore = bestPhoto.score;

  // Enrich menu URL
  if (!enriched.menuUrl && enriched.website) {
    enriched.menuUrl = enrichMenuUrl(enriched.website, enriched.name);
  }

  // Validate website
  if (enriched.website && isParkedDomain(enriched.website)) {
    enriched.websiteParked = true;
    enriched.website = null; // Remove parked domain
  }

  // Calculate overall trust score
  enriched.trustScore = calculateTrustScore(enriched);

  return enriched;
}

/**
 * Calculate overall trust score (0-100)
 */
function calculateTrustScore(restaurant) {
  let score = 50; // Base score

  // Photo quality
  if (restaurant.photoQualityScore) {
    score += (restaurant.photoQualityScore - 50) * 0.3;
  }

  // Has menu
  if (restaurant.menuUrl) score += 10;

  // Has website (not parked)
  if (restaurant.website && !restaurant.websiteParked) score += 10;

  // Has rating
  if (restaurant.rating) score += 10;

  // Has address
  if (restaurant.address) score += 5;

  // Has coordinates
  if (restaurant.lat && restaurant.lng) score += 5;

  // User has visited
  if (restaurant.lastVisitedAt) score += 10;

  // User has notes
  if (restaurant.notes && restaurant.notes.length > 20) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Get trust badge for display
 */
function getTrustBadge(trustScore) {
  if (trustScore >= 80) {
    return { label: 'High confidence', class: 'trust-high', icon: '✓' };
  } else if (trustScore >= 60) {
    return { label: 'Good match', class: 'trust-medium', icon: '~' };
  } else if (trustScore >= 40) {
    return { label: 'Limited info', class: 'trust-low', icon: '!' };
  } else {
    return { label: 'Low confidence', class: 'trust-very-low', icon: '?' };
  }
}

/**
 * Batch enrich all restaurants
 */
function enrichAllRestaurants(restaurants) {
  return restaurants.map(r => enrichRestaurantData(r));
}

// Expose globally
window.TrustLayer = {
  scorePhotoRelevance,
  validatePhotoSource,
  getFallbackPhotoForCuisine,
  enrichMenuUrl,
  isParkedDomain,
  selectBestPhoto,
  enrichRestaurantData,
  enrichAllRestaurants,
  calculateTrustScore,
  getTrustBadge,
};

console.log('[Trust Layer] Data quality validation initialized');
