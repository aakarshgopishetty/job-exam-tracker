importScripts('core.js');

const CACHE = 'lastdate-v2';
const SHELL = ['./', 'index.html', 'core.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cached copy first, refreshed in the background. Fonts are cached the same way so the app looks right offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req)
      .then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; })
      .catch(() => hit || cache.match('index.html'));
    return hit || net;
  }));
});

const show = m => self.registration.showNotification(m.title, {
  body: m.body,
  icon: 'icon-192.png',
  badge: 'icon-192.png',
  tag: m.key,
  data: { jobId: m.jobId }
});

// Chrome on Android can wake an installed app now and then. Timing is up to the browser, so this is best effort.
self.addEventListener('periodicsync', e => {
  if (e.tag === 'check-reminders') e.waitUntil(LD.runDue(show));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.jobId;
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); c.postMessage({ open: id }); return; }
    }
    await clients.openWindow('./#open=' + encodeURIComponent(id || ''));
  })());
});