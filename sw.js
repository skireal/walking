const CACHE_NAME = 'walker-app-cache-v2'; // Incremented cache version
const urlsToCache = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon-192.svg',
  './assets/icon-512.svg',
  'https://cdn.tailwindcss.com',
  'https://rsms.me/inter/inter.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching shell assets');
        return cache.addAll(urlsToCache).catch(error => {
            console.warn('SW cache.addAll failed for some initial assets:', error);
        });
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', event => {
  // We only want to cache GET requests.
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  // Strategy: Network falling back to cache.
  // We also update the cache with the fresh version from the network.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Responses must be valid to be cached.
        // We also avoid caching the dynamic map tiles.
        if (
          !response || 
          response.status !== 200 || 
          event.request.url.includes('cartocdn.com')
        ) {
          return response;
        }

        const responseToCache = response.clone();

        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });

        return response;
      })
      .catch(() => {
        // Network request failed, try to get it from the cache.
        console.log(`Network failed for ${event.request.url}, trying cache.`);
        return caches.match(event.request);
      })
  );
});