import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyBusy, byteRange, cacheable, cacheEach, rangedResponse, type Askable } from './logic.ts';

test('byte ranges follow the header', () => {
  assert.equal(byteRange(null, 100), null);
  assert.equal(byteRange('bytes=0-1,5-6', 100), null, 'multi-range falls back to the whole body');
  assert.equal(byteRange('bytes=-', 100), null);
  assert.equal(byteRange('bytes=9-3', 100), null, 'invalid range is ignored');
  assert.deepEqual(byteRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=-30', 100), { start: 70, end: 99 });
  assert.deepEqual(byteRange('bytes=-300', 100), { start: 0, end: 99 });
});

test('unsatisfiable ranges are reported', () => {
  assert.equal(byteRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(byteRange('bytes=150-200', 100), 'unsatisfiable');
  assert.equal(byteRange('bytes=-0', 100), 'unsatisfiable');
  assert.equal(byteRange('bytes=0-', 0), 'unsatisfiable');
});

const body = () => new Response(new Uint8Array(100).map((_, i) => i), { headers: { 'Content-Type': 'video/webm' } });
const get = (range?: string) => new Request('https://x/a.webm', range ? { headers: { range } } : {});

test('cached media answers ranges with 206 slices', async () => {
  const response = await rangedResponse(get('bytes=10-19'), body());
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal(response.headers.get('content-length'), '10');
  assert.equal(response.headers.get('content-type'), 'video/webm');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});

test('an unsatisfiable range gets a well-formed 416', async () => {
  const response = await rangedResponse(get('bytes=200-'), body());
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */100');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('requests without a usable range get the whole body', async () => {
  assert.equal((await rangedResponse(get(), body())).status, 200);
  const ignored = await rangedResponse(get('bytes=9-3'), body());
  assert.equal(ignored.status, 200);
  assert.equal((await ignored.arrayBuffer()).byteLength, 100);
});

test('only complete responses are cached at runtime', () => {
  assert.ok(cacheable(get(), new Response('x', { status: 200 })));
  assert.ok(!cacheable(get('bytes=0-'), new Response('x', { status: 200 })));
  assert.ok(!cacheable(get(), new Response('x', { status: 206 })));
  assert.ok(!cacheable(get(), new Response('x', { status: 404 })));
});

test('caching continues past failures and reports what is missing', async () => {
  const stored = new Map<string, Response>([['a', new Response('a')]]);
  const cache = {
    match: async (url: RequestInfo | URL) => stored.get(String(url)),
    put: async (url: RequestInfo | URL, response: Response) => {
      if (String(url) === 'quota') throw new DOMException('full', 'QuotaExceededError');
      stored.set(String(url), response);
    },
  };
  const fetched: string[] = [];
  const fetchUrl = async (url: string) => {
    fetched.push(url);
    if (url === 'offline') throw new TypeError('Failed to fetch');
    return new Response(url, { status: url === 'gone' ? 404 : 200 });
  };
  const missing = await cacheEach(['a', 'offline', 'gone', 'quota', 'b'], cache, fetchUrl);
  assert.deepEqual(missing, ['offline', 'gone', 'quota']);
  assert.deepEqual(fetched, ['offline', 'gone', 'quota', 'b'], 'already cached files are not fetched again');
  assert.ok(stored.has('b'));
  assert.deepEqual(await cacheEach(['a', 'b'], cache, fetchUrl), [], 'a later launch retries only what is missing');
});

const client = (answer: (port: MessagePort) => void): Askable => ({
  postMessage: (_message, [port]) => answer(port as MessagePort),
});

test('activation waits while any window is busy', async () => {
  const idle = client(port => port.postMessage({ busy: false }));
  const busy = client(port => port.postMessage({ busy: true }));
  assert.equal(await anyBusy([], 50), false);
  assert.equal(await anyBusy([idle], 50), false);
  assert.equal(await anyBusy([idle, busy], 50), true);
});

test('a window that never answers counts as idle', async () => {
  const frozen = client(() => {});
  const started = Date.now();
  assert.equal(await anyBusy([frozen], 50), false);
  assert.ok(Date.now() - started < 1000);
});
