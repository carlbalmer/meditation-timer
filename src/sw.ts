// Offline copy of the app, served cache-first. The shell (HTML, JS, CSS, icons) is cached at
// install; the audio is cached by the page itself as it loads it (src/caches.ts), so it is never
// downloaded twice. A new version takes over at once; the page reloads into it only when no
// session is running (src/main.ts).
import { audioCacheName, cachePrefix } from './caches.ts';

declare const self: ServiceWorkerGlobalScope;
declare const __VERSION__: string;
declare const __FILES__: string[];
declare const __AUDIO__: string[];

const SCOPE = self.registration.scope;
const PREFIX = cachePrefix(new URL(SCOPE).pathname);
const CACHE = PREFIX + __VERSION__;
const AUDIO = audioCacheName(new URL(SCOPE).pathname);

/** Earlier versions of this app in this scope (v1 `meditation-*`, v2 `shell-*` + `media`, older v3); other apps on the origin are left alone. */
async function stale(key: string): Promise<boolean> {
  if (key === CACHE || key === AUDIO) return false;
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
      const audio = await caches.open(AUDIO);
      const current = new Set(__AUDIO__.map(path => new URL(path, SCOPE).href));
      for (const request of await audio.keys()) if (!current.has(request.url)) await audio.delete(request);
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
      const hit =
        (await cache.match(request, { ignoreSearch: true, ignoreVary: true })) ??
        (await (await caches.open(AUDIO)).match(request, { ignoreVary: true }));
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
