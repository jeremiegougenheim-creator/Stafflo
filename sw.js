// Stafflo Service Worker — v231 (onboarding V2: prompt FR anti-invention, confirmation villa+staff, cfg write)
const CACHE = 'stafflo-v231';
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

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        // Only cache successful same-origin or CDN responses
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
