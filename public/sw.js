/* Report Builder service worker: makes the app installable and usable offline.
 *
 * - The build (vite.config.ts) replaces PRECACHE_LIST and CACHE_VERSION below with the real file list,
 *   so every file of the app is stored on the first visit.
 * - Pages: network first, falling back to the stored copy when offline.
 * - Files of the app: stored copy first (their names change whenever their content changes).
 * - A new version waits until the user taps "Reload" in the app (the page sends SKIP_WAITING).
 * - Only same-origin GET requests are handled. No data from uploaded files is ever stored here.
 */

const PRECACHE_LIST = /*PRECACHE_LIST*/ [];
const CACHE_VERSION = /*CACHE_VERSION*/ 'dev';
const CACHE = `report-builder-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', ...PRECACHE_LIST].map((p) => new URL(p, self.registration.scope).href))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('report-builder-') && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((c) => c.put(new URL('./', self.registration.scope).href, copy));
          return response;
        })
        .catch(async () => (await caches.match(new URL('./', self.registration.scope).href)) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
