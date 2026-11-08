// Offline copy of the app: every built file is cached at install and served cache-first.
// A new version takes over at once; the page never reloads itself, so a running session
// (its track is already in memory) is never interrupted, and the next launch gets the update.
declare const self: ServiceWorkerGlobalScope;
declare const __VERSION__: string;
declare const __FILES__: string[];

const SCOPE = self.registration.scope;
const PREFIX = `meditation:${new URL(SCOPE).pathname}:`;
const CACHE = PREFIX + __VERSION__;

/** Earlier versions of this app in this scope (v1 `meditation-*`, v2 `shell-*` + `media`, older v3); other apps on the origin are left alone. */
async function stale(key: string): Promise<boolean> {
  if (key === CACHE) return false;
  if (key.startsWith(PREFIX)) return true;
  if (!/^(meditation-|shell-|media$)/.test(key)) return false;
  const [first] = await (await caches.open(key)).keys();
  return !first || first.url.startsWith(SCOPE);
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(__FILES__)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (await stale(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
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
