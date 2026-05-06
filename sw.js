/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Feed The Bear â€” Service Worker
   Offline-first cache strategy
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const CACHE  = 'ftb-v19';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './ai.js',
  './style.css',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for Nominatim geocoding; cache-first for everything else
  if (e.request.url.includes('nominatim.openstreetmap.org')) {
    e.respondWith(fetch(e.request).catch(() => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      if (resp.ok && e.request.method === 'GET') {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => {
      // Only return the app shell for page navigations, not for JS/CSS/image assets.
      // Returning HTML for a .js request causes a parse error and breaks the app.
      if (e.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      return new Response('/* offline */', { status: 503, headers: { 'Content-Type': 'application/javascript' } });
    }))
  );
});

/* â”€â”€ Push notification scheduling â”€â”€ */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(self.registration.scope));
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_REMINDER') {
    const { title, body, delay } = e.data;
    setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: 'data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 64 64\'><text y=\'52\' font-size=\'52\'>ðŸ»</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 64 64\'><text y=\'52\' font-size=\'52\'>ðŸ»</text></svg>',
        tag: 'ftb-reminder',
        requireInteraction: true,
      });
    }, delay);
  }
});




