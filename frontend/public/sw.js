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

// Phone alerts (backend/app/services/push.py): a push carries
// {title, body, link}. Showing a notification for every push is required
// (pushes were subscribed with userVisibleOnly).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Handpikd", {
      body: data.body || "",
      icon: "/pwa/icon-192.png",
      badge: "/pwa/icon-192.png",
      data: { link: data.link || "/admin" },
    }),
  );
});

// Tapping one opens its link, reusing an open window of the app if there is
// one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL((event.notification.data && event.notification.data.link) || "/admin", self.location.origin);
  if (link.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).pathname.startsWith("/admin"));
      if (open) return open.navigate(link.href).then((client) => (client || open).focus());
      return self.clients.openWindow(link.href);
    }),
  );
});
