const CACHE = 'deadline-board-v1';
const SHELL = ['/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first for API calls (always fresh data), cache-first for the app shell.
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// This is what makes reminders show up even when the tab isn't open
// (as long as the browser/OS has the service worker registered).
self.addEventListener('push', (event) => {
  let data = { title: 'Deadline Board', body: 'You have an upcoming deadline.' };
  try {
    data = event.data.json();
  } catch (e) {
    /* keep default */
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/index.html'));
});
