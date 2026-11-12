/**
 * Aniyab service worker.
 *
 *  • precache the shell (app icons + offline page)
 *  • stale-while-revalidate for static assets (fonts, images, JS chunks)
 *  • NEVER cache /api/* — chat is a live SSE stream, and admin data must be fresh
 *  • navigations fall back to /offline when the network is gone
 */
const VERSION = 'aniyab-v2.0.0';
const SHELL = [
  '/offline',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  /\.(?:css|js|woff2?|png|jpe?g|svg|webp|avif|ico)$/.test(url.pathname) ||
  url.pathname.startsWith('/_next/static/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Live endpoints: always hit the network.
  if (url.pathname.startsWith('/api/')) return;

  // Page navigations: network-first, offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? caches.match('/offline')),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStatic(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
  }
});
