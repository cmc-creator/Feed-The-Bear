/* ════════════════════════════════════════════════════════════
   Feed The Bear - Enhanced Photo Gallery Experience
   Make restaurant photos feel AMAZING
   ════════════════════════════════════════════════════════════ */

'use strict';

/**
 * PHOTO GALLERY: Instagram-worthy photo browsing
 * - Fullscreen lightbox
 * - Swipe navigation
 * - Pinch to zoom
 * - Share directly from gallery
 * - Add photos from camera/library
 */

let currentGallery = [];
let currentIndex = 0;
let zoomLevel = 1;
let isDragging = false;
let startX = 0;
let startY = 0;

// ─── LIGHTBOX GALLERY ──────────────────────────────────────────

/**
 * Open fullscreen photo gallery
 */
function openPhotoGallery(photos, startIndex = 0) {
  if (!photos || !photos.length) return;

  currentGallery = photos;
  currentIndex = startIndex;
  zoomLevel = 1;

  const overlay = document.getElementById('photo-gallery-overlay');
  if (!overlay) {
    createGalleryOverlay();
  }

  renderGalleryPhoto();
  document.getElementById('photo-gallery-overlay').classList.remove('hidden');
  document.body.classList.add('overlay-open', 'gallery-open');

  // Track analytics
  if (window.Analytics) {
    Analytics.track('photo_gallery_opened', {
      photoCount: photos.length,
      startIndex
    });
  }
}

/**
 * Close photo gallery
 */
function closePhotoGallery() {
  document.getElementById('photo-gallery-overlay')?.classList.add('hidden');
  document.body.classList.remove('gallery-open');
  setTimeout(() => document.body.classList.remove('overlay-open'), 300);

  zoomLevel = 1;
  currentGallery = [];
  currentIndex = 0;
}

/**
 * Create gallery overlay HTML
 */
function createGalleryOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'photo-gallery-overlay';
  overlay.className = 'photo-gallery-overlay hidden';
  overlay.innerHTML = `
    <div class="photo-gallery-container">
      <!-- Header -->
      <div class="photo-gallery-header">
        <button class="photo-gallery-close" onclick="closePhotoGallery()" aria-label="Close gallery">
          ✕
        </button>
        <div class="photo-gallery-counter">
          <span id="photo-gallery-current">1</span> / <span id="photo-gallery-total">1</span>
        </div>
        <button class="photo-gallery-share" onclick="shareCurrentPhoto()" aria-label="Share photo">
          ↗
        </button>
      </div>

      <!-- Main photo -->
      <div class="photo-gallery-main" id="photo-gallery-main">
        <button class="photo-gallery-nav photo-gallery-prev" onclick="prevPhoto()" aria-label="Previous photo">
          ‹
        </button>
        <div class="photo-gallery-photo-container" id="photo-gallery-photo-container">
          <img id="photo-gallery-photo" class="photo-gallery-photo" alt="Restaurant photo" />
        </div>
        <button class="photo-gallery-nav photo-gallery-next" onclick="nextPhoto()" aria-label="Next photo">
          ›
        </button>
      </div>

      <!-- Thumbnail strip -->
      <div class="photo-gallery-thumbnails" id="photo-gallery-thumbnails"></div>

      <!-- Actions -->
      <div class="photo-gallery-actions">
        <button class="photo-gallery-action-btn" onclick="downloadCurrentPhoto()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          <span>Save</span>
        </button>
        <button class="photo-gallery-action-btn" onclick="addPhotoToRestaurant()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M12 8v8M8 12h8"/>
          </svg>
          <span>Add Photo</span>
        </button>
        <button class="photo-gallery-action-btn" onclick="setAsMainPhoto()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <span>Set Main</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setupGalleryGestures();
}

/**
 * Render current photo
 */
function renderGalleryPhoto() {
  if (!currentGallery.length) return;

  const photo = currentGallery[currentIndex];
  const photoEl = document.getElementById('photo-gallery-photo');
  const counterCurrent = document.getElementById('photo-gallery-current');
  const counterTotal = document.getElementById('photo-gallery-total');
  const thumbnails = document.getElementById('photo-gallery-thumbnails');

  // Update main photo
  photoEl.src = photo.url || photo;
  photoEl.alt = photo.alt || 'Restaurant photo';

  // Update counter
  counterCurrent.textContent = currentIndex + 1;
  counterTotal.textContent = currentGallery.length;

  // Update thumbnails
  if (thumbnails) {
    thumbnails.innerHTML = currentGallery.map((p, i) => `
      <div class="photo-gallery-thumb ${i === currentIndex ? 'active' : ''}"
           onclick="goToPhoto(${i})"
           style="background-image: url('${p.url || p}')">
      </div>
    `).join('');
  }

  // Show/hide nav buttons
  document.querySelector('.photo-gallery-prev').style.opacity = currentIndex > 0 ? '1' : '0.3';
  document.querySelector('.photo-gallery-next').style.opacity = currentIndex < currentGallery.length - 1 ? '1' : '0.3';

  // Reset zoom
  zoomLevel = 1;
  photoEl.style.transform = 'scale(1)';
}

/**
 * Navigate to specific photo
 */
function goToPhoto(index) {
  if (index < 0 || index >= currentGallery.length) return;
  currentIndex = index;
  renderGalleryPhoto();

  if (window.MicroInteractions) {
    MicroInteractions.haptic('light');
  }
}

/**
 * Next photo
 */
function nextPhoto() {
  if (currentIndex < currentGallery.length - 1) {
    currentIndex++;
    renderGalleryPhoto();

    if (window.MicroInteractions) {
      MicroInteractions.haptic('light');
    }
  }
}

/**
 * Previous photo
 */
function prevPhoto() {
  if (currentIndex > 0) {
    currentIndex--;
    renderGalleryPhoto();

    if (window.MicroInteractions) {
      MicroInteractions.haptic('light');
    }
  }
}

// ─── GESTURES ──────────────────────────────────────────

/**
 * Setup swipe and pinch gestures
 */
function setupGalleryGestures() {
  const container = document.getElementById('photo-gallery-photo-container');
  const photoEl = document.getElementById('photo-gallery-photo');
  if (!container || !photoEl) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let initialDistance = 0;

  // Swipe to navigate
  container.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;

    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialDistance = Math.sqrt(dx * dx + dy * dy);
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    // Pinch to zoom
    if (e.touches.length === 2 && initialDistance) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      zoomLevel = Math.min(Math.max((distance / initialDistance) * zoomLevel, 1), 4);
      photoEl.style.transform = `scale(${zoomLevel})`;
    }
  });

  container.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1 && !initialDistance) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;

      // Horizontal swipe
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          prevPhoto();
        } else {
          nextPhoto();
        }
      }
    }

    initialDistance = 0;
  }, { passive: true });

  // Double tap to zoom
  let lastTap = 0;
  photoEl.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      // Double tap
      if (zoomLevel > 1) {
        zoomLevel = 1;
      } else {
        zoomLevel = 2;
      }
      photoEl.style.transform = `scale(${zoomLevel})`;
      photoEl.style.transition = 'transform 0.3s ease';
      setTimeout(() => {
        photoEl.style.transition = '';
      }, 300);
    }
    lastTap = now;
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('gallery-open')) return;

    if (e.key === 'ArrowLeft') prevPhoto();
    if (e.key === 'ArrowRight') nextPhoto();
    if (e.key === 'Escape') closePhotoGallery();
  });
}

// ─── ACTIONS ──────────────────────────────────────────

/**
 * Share current photo
 */
async function shareCurrentPhoto() {
  const photo = currentGallery[currentIndex];
  const url = photo.url || photo;

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Check out this restaurant!',
        text: 'Found on Feed The Bear',
        url: url
      });

      if (window.Analytics) {
        Analytics.track('photo_shared', { source: 'gallery' });
      }
    } catch (err) {
      console.log('Share cancelled');
    }
  } else {
    // Fallback: copy link
    navigator.clipboard.writeText(url);
    if (window.showToast) {
      showToast('Link copied!', 'Photo URL copied to clipboard', 'success');
    }
  }
}

/**
 * Download current photo
 */
async function downloadCurrentPhoto() {
  const photo = currentGallery[currentIndex];
  const url = photo.url || photo;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `restaurant-photo-${Date.now()}.jpg`;
    a.click();

    URL.revokeObjectURL(blobUrl);

    if (window.showToast) {
      showToast('Saved!', 'Photo downloaded successfully', 'success');
    }

    if (window.Analytics) {
      Analytics.track('photo_downloaded', { source: 'gallery' });
    }
  } catch (err) {
    if (window.showToast) {
      showToast('Error', 'Could not download photo', 'error');
    }
  }
}

/**
 * Add new photo to restaurant
 */
function addPhotoToRestaurant() {
  // Create file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;

  input.onchange = (e) => {
    const files = Array.from(e.target.files);

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const newPhoto = {
          url: event.target.result,
          alt: file.name,
          userUploaded: true,
          timestamp: Date.now()
        };

        currentGallery.push(newPhoto);

        if (window.showToast) {
          showToast('Photo added!', 'Added to your gallery', 'success');
        }

        if (window.MicroInteractions) {
          MicroInteractions.haptic('success');
        }

        if (window.Analytics) {
          Analytics.photoUploaded({ source: 'gallery' });
        }

        // Re-render
        renderGalleryPhoto();
      };

      reader.readAsDataURL(file);
    });
  };

  input.click();
}

/**
 * Set current photo as main restaurant photo
 */
function setAsMainPhoto() {
  const photo = currentGallery[currentIndex];

  // Move to first position
  currentGallery.splice(currentIndex, 1);
  currentGallery.unshift(photo);
  currentIndex = 0;

  renderGalleryPhoto();

  if (window.showToast) {
    showToast('Main photo set!', 'This photo is now the cover image', 'success');
  }

  if (window.MicroInteractions) {
    MicroInteractions.haptic('success');
  }

  if (window.Analytics) {
    Analytics.track('main_photo_changed', { source: 'gallery' });
  }
}

// ─── ENHANCED PHOTO CARDS ──────────────────────────────────────────

/**
 * Make restaurant photo cards clickable to open gallery
 */
function enhancePhotoCards() {
  document.querySelectorAll('[data-photo-gallery]').forEach(element => {
    if (element.dataset.enhanced) return;

    element.style.cursor = 'pointer';
    element.addEventListener('click', () => {
      const photos = JSON.parse(element.dataset.photoGallery || '[]');
      const startIndex = parseInt(element.dataset.photoIndex || '0');

      openPhotoGallery(photos, startIndex);
    });

    element.dataset.enhanced = 'true';
  });
}

// Auto-enhance on load
document.addEventListener('DOMContentLoaded', enhancePhotoCards);

// Re-enhance on DOM changes
const photoObserver = new MutationObserver(enhancePhotoCards);
photoObserver.observe(document.body, { childList: true, subtree: true });

// Expose globally
window.PhotoGallery = {
  open: openPhotoGallery,
  close: closePhotoGallery,
  next: nextPhoto,
  prev: prevPhoto,
  goTo: goToPhoto,
};

console.log('[Photo Gallery] Enhanced photo experience loaded');
