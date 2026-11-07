// Generates dist/sw.js: precaches the app shell, and caches the rendered
// scenes and sounds in the background when the page asks for them.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { mediaVersions, MEDIA_DIRS } from './media.mjs';

const entries = await readdir('dist', { recursive: true, withFileTypes: true });
const shell = entries
  .filter(entry => entry.isFile())
  .map(entry => `${entry.parentPath}/${entry.name}`.slice('dist/'.length))
  .filter(path => path !== 'sw.js' && !MEDIA_DIRS.some(dir => path.startsWith(`${dir}/`)))
  .sort();
const media = Object.entries(await mediaVersions('dist')).map(([path, version]) => `${path}?v=${version}`);

const hash = createHash('sha256');
for (const path of shell) hash.update(await readFile(`dist/${path}`));
hash.update(media.join());
const version = hash.digest('hex').slice(0, 12);

await writeFile('dist/sw.js', `const SHELL = 'shell-${version}';
const MEDIA = 'media';
const scope = self.registration.scope;
const SHELL_URLS = ${JSON.stringify(['./', ...shell.filter(path => path !== 'index.html')])}.map(path => new URL(path, scope).href);
const MEDIA_URLS = new Set(${JSON.stringify(media)}.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_URLS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    const media = await caches.open(MEDIA);
    for (const request of await media.keys()) if (!MEDIA_URLS.has(request.url)) await media.delete(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.activate) return void self.skipWaiting();
  const urls = (event.data?.cache ?? []).map(url => new URL(url, scope).href).filter(url => MEDIA_URLS.has(url));
  event.waitUntil((async () => {
    const media = await caches.open(MEDIA);
    for (const url of urls) {
      if (await media.match(url)) continue;
      const response = await fetch(url).catch(() => null);
      if (response?.ok) await media.put(url, response);
    }
  })());
});

async function ranged(request, response) {
  const match = /bytes=(\\d+)-(\\d*)/.exec(request.headers.get('range') ?? '');
  if (!match) return response;
  const blob = await response.blob();
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1;
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? '',
      'Content-Length': String(end - start + 1),
      'Content-Range': \`bytes \${start}-\${end}/\${blob.size}\`,
    },
  });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  if (MEDIA_URLS.has(request.url)) {
    event.respondWith(caches.open(MEDIA).then(async media => {
      const cached = await media.match(request.url);
      return cached ? ranged(request, cached) : fetch(request);
    }));
    return;
  }
  event.respondWith((async () => {
    const shell = await caches.open(SHELL);
    const cached = await shell.match(request.mode === 'navigate' ? scope : request, { ignoreVary: true });
    return cached ?? fetch(request);
  })());
});
`);
console.log(`sw.js ${version}: ${shell.length} shell files, ${media.length} media files`);
