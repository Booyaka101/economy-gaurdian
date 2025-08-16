/* Economy Guardian Service Worker - improved offline + performance */
const VERSION = 'eg-sw-v2-20250816d';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const STATIC_ASSETS = [
  '/',
  '/top',
  '/ai',
  '/player',
  '/index.html',
  '/top.html',
  '/ai.html',
  '/player.html',
  '/styles.css',
  '/app.js',
  '/ai.js',
  '/player.js',
  // Early controllers needed for bootstrap and tooltips
  '/sw.controller.js',
  '/wowhead.controller.js',
  '/data/icons/eg.png',
  // Precache critical bootstrap JSON so Top works offline/bad network
  '/data/item-meta.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.addAll(STATIC_ASSETS.filter(Boolean));
      } catch {}
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (!k.startsWith(VERSION) ? caches.delete(k) : Promise.resolve())),
      );
      try {
        if (self.registration && self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
      } catch {}
      self.clients.claim();
    })(),
  );
});

// Allow app to trigger immediate activation
self.addEventListener('message', (event) => {
  if (event && event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isApiRequest(url) {
  const p = url.pathname;
  return (
    p.startsWith('/stats/') ||
    p.startsWith('/blizzard/') ||
    p.startsWith('/market/') ||
    p.startsWith('/ml/')
  );
}

async function trimCache(cacheName, maxEntries = 60) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) {
      return;
    }
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((req) => cache.delete(req).catch(() => {})));
  } catch {}
}

async function networkFirstWithTimeout(req, cacheName, pathKey, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fresh = await fetch(req, { signal: controller.signal });
    clearTimeout(id);
    const cache = await caches.open(cacheName);
    // Use pathKey for HTML navigations to avoid query-string duplication
    await cache.put(pathKey || req, fresh.clone());
    return fresh;
  } catch {
    clearTimeout(id);
    const cache = await caches.open(cacheName);
    const cached = await cache.match(pathKey || req);
    return (
      cached ||
      new Response('<h1>Offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html' } })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') {
    return;
  }

  // Network-first for navigations (HTML), with timeout and nav preload
  if (
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/top' ||
    url.pathname === '/ai' ||
    url.pathname === '/player'
  ) {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) {
            return preload;
          }
        } catch {}
        return networkFirstWithTimeout(req, STATIC_CACHE, url.pathname, 3500);
      })(),
    );
    return;
  }

  // Stale-while-revalidate for API-like GETs
  if (isApiRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const fetchAndUpdate = fetch(req)
          .then((resp) => {
            if (resp && resp.ok) {
              cache.put(req, resp.clone()).catch(() => {});
            }
            return resp;
          })
          .catch(() => null);
        const resp = cached || (await fetchAndUpdate);
        // Trim cache opportunistically
        trimCache(RUNTIME_CACHE, 80).catch(() => {});
        return (
          resp ||
          new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      })(),
    );
    return;
  }

  // Cache-first for static assets
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        if (cached) {
          return cached;
        }
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      })(),
    );
    return;
  }

  // Cache-first for static JSON under /data/ (e.g., item-meta, catalogs)
  if (url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        if (cached) {
          return cached;
        }
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch {
          // Minimal offline JSON fallback
          return new Response('{}', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      })(),
    );
    return;
  }
});
