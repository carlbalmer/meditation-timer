// Offline copy of the app: every built file is cached at install and served cache-first.
// A new version takes over at once; the page never reloads itself, so a running session
// (its track is already in memory) is never interrupted, and the next launch gets the update.
declare const self: ServiceWorkerGlobalScope;
declare const __VERSION__: string;
declare const __FILES__: string[];

const CACHE = `meditation-${__VERSION__}`;
const OLD = (key: string) => key !== CACHE && (key.startsWith('meditation-') || key.startsWith('shell-') || key === 'media');

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(__FILES__)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(OLD).map(key => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      if (request.mode === 'navigate') {
        try {
          return await fetch(request);
        } catch {
          return (await cache.match('./')) ?? Response.error();
        }
      }
      return fetch(request);
    })(),
  );
});
export {};
