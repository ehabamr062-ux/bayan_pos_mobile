const CACHE_NAME = 'bayan-mobile-v5.1.25';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './css/mobile_fashion.css',
  './js/idb_store.js',
  './js/mobile_fashion.js',
  './fonts/cairo.css',
  './lib/html2canvas.min.js',
  './lib/jsQR.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (url.includes('supabase.co') || url.includes('realtime')) return;
  // Stale-While-Revalidate للفتح الفوري بدون انتظار الشبكة
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

















