// Stafflo Service Worker v1.0
// Offline-first caching strategy

const CACHE_NAME = 'stafflo-v1';
const ASSETS_TO_CACHE = [
  '/Stafflo/app.html',
  '/Stafflo/manifest.json',
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500;600&display=swap',
];

// ── INSTALL: cache core assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching core assets');
        return cache.addAll(ASSETS_TO_CACHE.map(url => new Request(url, {mode: 'no-cors'})));
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache failed:', err))
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for API, cache-first for assets ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always network for API calls
  if (url.hostname.includes('supabase') ||
      url.hostname.includes('groq') ||
      url.hostname.includes('openweathermap') ||
      url.hostname.includes('aviationstack') ||
      url.hostname.includes('exchangerate') ||
      url.hostname.includes('googleapis.com/v1beta') ||
      url.hostname.includes('anthropic')) {
    return; // Let browser handle API calls normally
  }

  // Cache-first for fonts and static assets
  if (url.hostname.includes('fonts.gstatic') || url.hostname.includes('fonts.googleapis')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Network-first for HTML (always get latest version)
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
});

// ── BACKGROUND SYNC (future: sync CRM when back online) ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-crm') {
    console.log('[SW] Background sync: CRM');
  }
});

// ── PUSH NOTIFICATIONS (future: alert on new booking) ──
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    self.registration.showNotification(data.title || 'Stafflo', {
      body: data.body || 'New notification',
      icon: '/Stafflo/icon-192.png',
      badge: '/Stafflo/icon-192.png',
      tag: 'stafflo-notification',
      data: { url: data.url || '/Stafflo/app.html' }
    });
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/Stafflo/app.html')
  );
});
