// The service worker, bundled by scripts/build-sw.mjs with the build's file lists.
import { anyBusy, cacheable, cacheEach, rangedResponse } from './logic.ts';

declare const self: ServiceWorkerGlobalScope;
declare const __VERSION__: string;
declare const __SHELL__: string[];
declare const __MEDIA__: string[];

const SHELL = `shell-${__VERSION__}`;
const MEDIA = 'media';
const BUSY_TIMEOUT_MS = 1000;
const scope = self.registration.scope;
const shellUrls = __SHELL__.map(path => new URL(path, scope).href);
const mediaUrls = new Set(__MEDIA__.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(shellUrls)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    const media = await caches.open(MEDIA);
    for (const request of await media.keys()) if (!mediaUrls.has(request.url)) await media.delete(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.activate) event.waitUntil(activateIfIdle());
  const urls: string[] = (event.data?.cache ?? []).map((url: string) => new URL(url, scope).href).filter((url: string) => mediaUrls.has(url));
  if (urls.length) event.waitUntil(caches.open(MEDIA).then(media => cacheEach(urls, media, url => fetch(url))));
});

// Takes over only when no window is starting or running a session.
async function activateIfIdle() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!(await anyBusy(windows, BUSY_TIMEOUT_MS))) await self.skipWaiting();
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  if (mediaUrls.has(request.url)) {
    event.respondWith((async () => {
      const media = await caches.open(MEDIA);
      const cached = await media.match(request.url);
      if (cached) return rangedResponse(request, cached);
      const response = await fetch(request);
      if (cacheable(request, response)) event.waitUntil(media.put(request.url, response.clone()).catch(() => {}));
      return response;
    })());
    return;
  }
  event.respondWith((async () => {
    const shell = await caches.open(SHELL);
    const cached = await shell.match(request.mode === 'navigate' ? scope : request, { ignoreVary: true });
    return cached ?? fetch(request);
  })());
});
