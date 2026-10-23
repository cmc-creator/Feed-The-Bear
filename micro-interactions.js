/* ════════════════════════════════════════════════════════════
   Feed The Bear - Delightful Micro-Interactions
   The secret sauce that makes the app feel ALIVE
   ════════════════════════════════════════════════════════════ */

'use strict';

/**
 * MICRO-INTERACTIONS: Small details that make a huge UX difference
 * - Haptic feedback
 * - Sound effects (optional)
 * - Smooth animations
 * - Visual feedback
 * - Contextual celebrations
 */

// ─── HAPTIC FEEDBACK ──────────────────────────────────────────

/**
 * Enhanced haptic feedback with intensity levels
 */
function haptic(type = 'light') {
  if (!navigator.vibrate) return;

  const patterns = {
    tap: [5],
    light: [10],
    medium: [20],
    heavy: [30],
    success: [10, 50, 10],
    error: [50, 100, 50],
    notification: [10, 20, 10],
    selection: [5, 10, 5],
  };

  navigator.vibrate(patterns[type] || patterns.light);
}

// ─── BUTTON PRESS EFFECTS ──────────────────────────────────────

/**
 * Add satisfying press effect to any button
 */
function addButtonPressEffect(element) {
  if (!element) return;

  element.addEventListener('touchstart', () => {
    element.style.transform = 'scale(0.96)';
    haptic('tap');
  }, { passive: true });

  element.addEventListener('touchend', () => {
    element.style.transform = 'scale(1)';
  }, { passive: true });

  element.addEventListener('touchcancel', () => {
    element.style.transform = 'scale(1)';
  }, { passive: true });
}

/**
 * Add press effect to all buttons in the app
 */
function enhanceAllButtons() {
  const selectors = [
    '.btn-primary',
    '.btn-secondary',
    '.btn-orange',
    '.btn-ghost',
    '.btn-sm',
    '.decision-chip',
    '.home-quick-btn',
    '.icon-btn'
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(btn => {
      if (!btn.dataset.enhanced) {
        addButtonPressEffect(btn);
        btn.dataset.enhanced = 'true';
      }
    });
  });
}

// ─── CARD INTERACTIONS ──────────────────────────────────────────

/**
 * Add magnetic hover effect to cards
 */
function addCardMagneticEffect(card) {
  if (!card) return;

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const deltaX = (x - centerX) / centerX;
    const deltaY = (y - centerY) / centerY;

    // Subtle tilt effect
    card.style.transform = `perspective(1000px) rotateY(${deltaX * 3}deg) rotateX(${-deltaY * 3}deg) scale(1.02)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
}

/**
 * Enhance all restaurant cards
 */
function enhanceRestaurantCards() {
  document.querySelectorAll('.restaurant-card, .nearby-home-card, .decision-card').forEach(card => {
    if (!card.dataset.enhanced) {
      addCardMagneticEffect(card);
      card.dataset.enhanced = 'true';
    }
  });
}

// ─── SCROLL REVEALS ──────────────────────────────────────────

/**
 * Reveal elements as they scroll into view
 */
function initScrollReveals() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });

  document.querySelectorAll('[data-reveal]').forEach(el => {
    observer.observe(el);
  });
}

// ─── LOADING STATES ──────────────────────────────────────────

/**
 * Show skeleton loading for better perceived performance
 */
function showSkeletonLoader(container, count = 3) {
  if (!container) return;

  const skeletons = Array(count).fill(0).map((_, i) => `
    <div class="skeleton-card" style="animation-delay: ${i * 0.1}s">
      <div class="skeleton-image"></div>
      <div class="skeleton-content">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-subtitle"></div>
        <div class="skeleton-line skeleton-text"></div>
      </div>
    </div>
  `).join('');

  container.innerHTML = `<div class="skeleton-container">${skeletons}</div>`;
}

/**
 * Progressive image loading with blur-up effect
 */
function enhanceImageLoading(img) {
  if (!img || img.dataset.enhanced) return;

  img.dataset.enhanced = 'true';

  // Create low-res placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'image-placeholder';
  placeholder.style.backgroundImage = `url(${img.src})`;
  placeholder.style.filter = 'blur(20px)';

  img.parentElement.insertBefore(placeholder, img);
  img.style.opacity = '0';

  img.addEventListener('load', () => {
    img.style.opacity = '1';
    setTimeout(() => placeholder.remove(), 300);
  });
}

// ─── SUCCESS MICRO-CELEBRATIONS ──────────────────────────────

/**
 * Quick success indicator (checkmark animation)
 */
function showSuccessPulse(element) {
  if (!element) return;

  const checkmark = document.createElement('div');
  checkmark.className = 'success-pulse';
  checkmark.innerHTML = '✓';

  element.appendChild(checkmark);
  haptic('success');

  setTimeout(() => checkmark.remove(), 1000);
}

/**
 * Particle burst effect on important actions
 */
function createParticleBurst(x, y, color = 'var(--primary)') {
  const particles = 12;
  const container = document.createElement('div');
  container.className = 'particle-burst-container';
  container.style.position = 'fixed';
  container.style.left = x + 'px';
  container.style.top = y + 'px';
  container.style.pointerEvents = 'none';
  container.style.zIndex = '9999';

  for (let i = 0; i < particles; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.background = color;

    const angle = (360 / particles) * i;
    const velocity = 50 + Math.random() * 50;
    const tx = Math.cos(angle * Math.PI / 180) * velocity;
    const ty = Math.sin(angle * Math.PI / 180) * velocity;

    particle.style.setProperty('--tx', tx + 'px');
    particle.style.setProperty('--ty', ty + 'px');

    container.appendChild(particle);
  }

  document.body.appendChild(container);
  setTimeout(() => container.remove(), 1000);
}

// ─── NUMBER COUNTERS ──────────────────────────────────────────

/**
 * Animate numbers counting up (satisfying for stats)
 */
function animateCounter(element, start, end, duration = 1000) {
  if (!element) return;

  const startTime = Date.now();
  const difference = end - start;

  function update() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(start + (difference * eased));

    element.textContent = current;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = end;
    }
  }

  requestAnimationFrame(update);
}

// ─── FLOATING ACTION FEEDBACK ──────────────────────────────────

/**
 * Show floating "+1" style feedback
 */
function showFloatingFeedback(x, y, text, color = 'var(--primary)') {
  const feedback = document.createElement('div');
  feedback.className = 'floating-feedback';
  feedback.textContent = text;
  feedback.style.left = x + 'px';
  feedback.style.top = y + 'px';
  feedback.style.color = color;

  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 2000);
}

// ─── SWIPE GESTURES ──────────────────────────────────────────

/**
 * Add swipe-to-delete or swipe actions
 */
function addSwipeActions(element, onSwipeLeft, onSwipeRight) {
  if (!element) return;

  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    isDragging = true;
  }, { passive: true });

  element.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentX = e.touches[0].clientX;
    const diff = currentX - startX;

    // Visual feedback while swiping
    element.style.transform = `translateX(${diff}px)`;
    element.style.opacity = Math.max(0.5, 1 - Math.abs(diff) / 300);
  }, { passive: true });

  element.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;

    const diff = currentX - startX;
    element.style.transform = '';
    element.style.opacity = '';

    if (Math.abs(diff) > 100) {
      haptic('medium');
      if (diff < 0 && onSwipeLeft) onSwipeLeft();
      if (diff > 0 && onSwipeRight) onSwipeRight();
    }
  }, { passive: true });
}

// ─── PULL TO REFRESH ──────────────────────────────────────────

/**
 * Add pull-to-refresh gesture
 */
function initPullToRefreshFor(container, onRefresh) {
  if (!container) return;

  let startY = 0;
  let currentY = 0;
  let isPulling = false;

  const refreshIndicator = document.createElement('div');
  refreshIndicator.className = 'pull-refresh-indicator';
  refreshIndicator.innerHTML = '↓ Pull to refresh';
  refreshIndicator.style.display = 'none';
  container.prepend(refreshIndicator);

  container.addEventListener('touchstart', (e) => {
    if (container.scrollTop === 0) {
      startY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    if (diff > 0 && diff < 100) {
      refreshIndicator.style.display = 'block';
      refreshIndicator.style.opacity = diff / 100;
      refreshIndicator.style.transform = `translateY(${diff}px)`;
    }
  }, { passive: true });

  container.addEventListener('touchend', async () => {
    if (!isPulling) return;
    isPulling = false;

    const diff = currentY - startY;
    if (diff > 80) {
      refreshIndicator.innerHTML = '↻ Refreshing...';
      haptic('medium');

      if (onRefresh) await onRefresh();

      setTimeout(() => {
        refreshIndicator.style.display = 'none';
        refreshIndicator.innerHTML = '↓ Pull to refresh';
      }, 500);
    } else {
      refreshIndicator.style.display = 'none';
    }
  }, { passive: true });
}

// ─── SMART TOOLTIPS ──────────────────────────────────────────

/**
 * Show contextual tooltips on first use
 */
function showTooltip(element, text, position = 'top') {
  if (!element) return;

  const tooltip = document.createElement('div');
  tooltip.className = `smart-tooltip tooltip-${position}`;
  tooltip.textContent = text;

  const rect = element.getBoundingClientRect();
  tooltip.style.left = rect.left + (rect.width / 2) + 'px';
  tooltip.style.top = (position === 'top' ? rect.top - 10 : rect.bottom + 10) + 'px';

  document.body.appendChild(tooltip);

  setTimeout(() => tooltip.classList.add('visible'), 10);
  setTimeout(() => {
    tooltip.classList.remove('visible');
    setTimeout(() => tooltip.remove(), 300);
  }, 3000);
}

// ─── INITIALIZATION ──────────────────────────────────────────

/**
 * Initialize all micro-interactions
 */
function initMicroInteractions() {
  // Enhance buttons
  enhanceAllButtons();

  // Enhance cards
  enhanceRestaurantCards();

  // Scroll reveals
  initScrollReveals();

  // Re-enhance on DOM changes
  const observer = new MutationObserver(() => {
    enhanceAllButtons();
    enhanceRestaurantCards();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('[Micro-Interactions] Delightful interactions initialized ✨');
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMicroInteractions);
} else {
  initMicroInteractions();
}

// Expose globally
window.MicroInteractions = {
  haptic,
  showSuccessPulse,
  createParticleBurst,
  animateCounter,
  showFloatingFeedback,
  addSwipeActions,
  showSkeletonLoader,
  showTooltip,
  enhanceAllButtons,
  enhanceRestaurantCards,
};

console.log('[Micro-Interactions] Module loaded');
