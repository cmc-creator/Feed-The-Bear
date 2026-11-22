/* NyxSurvive service worker - caches the app shell so the app
   installs and opens with zero connection. Data itself lives in
   localStorage and never passes through here. */
var NX_CACHE = "nyxsurvive-shell-v32";
var NX_SHELL = [
  "./",
  "index.html",
  "app.js",
  "nx-qr.js",
  "style.css",
  "manifest.json",
  "icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(NX_CACHE).then(function (cache) {
      return cache.addAll(NX_SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== NX_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  // Same-origin shell only. Cross-origin calls (NWS alerts, USGS) are
  // never cached here - the app keeps its own timestamped cache in
  // localStorage so stale data is always labeled honestly.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  // API responses are never cached: /api/config decides whether
  // accounts exist at all, and a stale cached answer (from before
  // the env vars were set) would strand the app in local-only
  // mode forever. Account data always goes to the network.
  if (new URL(event.request.url).pathname.indexOf("/api/") === 0) return;
  // Map packs are never cached here either (money build E):
  // IndexedDB is their one store of truth, so a downloaded
  // pack's lifecycle (download, delete) is never shadowed by
  // a stale service-worker copy. Pack fetches go to the
  // network; once downloaded, the app reads IndexedDB only.
  if (new URL(event.request.url).pathname.indexOf("/maps/") === 0) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(event.request).then(function (res) {
        var copy = res.clone();
        caches.open(NX_CACHE).then(function (cache) { cache.put(event.request, copy); });
        return res;
      }).catch(function () {
        return caches.match("index.html", { ignoreSearch: true });
      });
    })
  );
});
