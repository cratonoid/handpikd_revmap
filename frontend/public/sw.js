// Service worker for the installable admin app (see public/admin.webmanifest
// and components/pwa-register.tsx, which registers this with scope /admin).
//
// Deliberately does NOT cache pages or API responses: admin screens show live
// business data (orders, stock, invoices), and a stale cached copy that looks
// current is worse than an honest "you're offline". The only thing cached is
// the offline page itself, served when a navigation fails for lack of network.
const CACHE = "handpikd-admin-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Drops caches from older versions of this file when CACHE is bumped.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
