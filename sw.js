// Stafflo Service Worker — v554 (20/10 : vue équipe tout traduite, en arrière-plan — français et darija)
const CACHE = 'stafflo-v557';
const CORE = [
  './app.html',
  './fonts/tabler-icons.css',
  './fonts/tabler-icons.woff2',
  './fonts/CormorantGaramond-400-600.woff2',
  './fonts/CormorantGaramond-400-600-ext.woff2',
  './fonts/DMSans-400-600.woff2',
  './fonts/DMSans-400-600-ext.woff2',
  './fonts/Fraunces-300-700.woff2',
  './fonts/Fraunces-300-700-ext.woff2',
  './fonts/Fraunces-400i.woff2',
  './fonts/Fraunces-400i-ext.woff2',
  './fonts/Inter-400-700.woff2',
  './fonts/Inter-400-700-ext.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ✅ FIX: ignore anything that isn't http(s) — chrome-extension://, data:, blob:, etc.
  if (!url.startsWith('http')) return;

  // Only handle GET
  if (e.request.method !== 'GET') return;

  // livret.html is consulted rarely and always online — never cache it,
  // so it never serves a stale version to a client.
  if (url.includes('livret.html')) return;
  // Même règle pour planning.html : outil interne, toujours la dernière version.
  if (url.includes('planning.html')) return;
  // Fiche maison (villa-facts.js) : jamais en cache SW — un prix ou une règle
  // changé doit atteindre ARIA au prochain chargement. Hors ligne, l'app
  // tourne sans fiche (villaFactsActive() = false), sans erreur.
  if (url.includes('villa-facts.js')) return;
  // Moteur de la fiche (house-facts.js, sans données) : même règle — moteur et fiche en base
  // changent ensemble ; hors ligne, l'app tourne sans fiche, sans erreur.
  if (url.includes('house-facts.js')) return;
  // Espace Stafflo : toujours la dernière version, comme livret et planning.
  if (url.includes('espace.html')) return;
  // Vue équipe : données du jour, jamais en cache.
  if (url.includes('equipe.html') || url.includes('/functions/v1/staff-view')) return;

  // Skip external APIs — let them go directly to network
  const { hostname } = new URL(url);
  if (
    hostname.includes('supabase') ||
    hostname.includes('groq') ||
    hostname.includes('mistral') ||
    hostname.includes('deepseek') ||
    hostname.includes('googleapis') ||
    hostname.includes('openai')
  ) return;

  const isNav = e.request.mode === 'navigate' || url.includes('.html');

  e.respondWith(
    caches.match(e.request, isNav ? { ignoreSearch: true } : undefined).then(cached => {
      const fresh = fetch(e.request).then(res => {
        // Only cache successful same-origin or CDN responses
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      }).catch(() =>
        cached ||
        caches.match('./app.html').then(shell => shell || Response.error())
      );
      return cached || fresh;
    })
  );
});

// ── Alertes (Web Push envoyé par la fonction serveur push-notify) ──────────
// Le message est chiffré de bout en bout ; il contient seulement titre, texte,
// tag (une alerte par fil Airbnb) et l'adresse à ouvrir.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Stafflo', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: './assets/icon-192.png',
    badge: './assets/badge-96.png',
    data: { url: d.url || '/espace.html' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/espace.html', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.indexOf('espace.html') > -1 && 'focus' in c) { c.postMessage({ type: 'stafflo-reload' }); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
