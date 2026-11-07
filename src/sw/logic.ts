// Service-worker logic with no global state, so it can be tested in Node.

export type ByteRange = { start: number; end: number };
export type Askable = { postMessage(message: unknown, transfer: Transferable[]): void };
export type MediaCache = Pick<Cache, 'match' | 'put'>;

// Parses a single-range `Range` header against a body of `size` bytes. Returns
// null when the header is absent or unsupported (serve the whole body).
export function byteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  if (match[2] && Number(match[2]) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 };
}

// Answers a request from a complete cached response, honouring `Range`.
export async function rangedResponse(request: Request, cached: Response) {
  const header = request.headers.get('range');
  if (!header) return cached;
  const blob = await cached.blob();
  const range = byteRange(header, blob.size);
  const type = cached.headers.get('content-type') ?? '';
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  if (!range) return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(blob.size) } });
  return new Response(blob.slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${blob.size}`,
    },
  });
}

// Only whole bodies are worth keeping; media elements fetch partial ranges.
export const cacheable = (request: Request, response: Response) => response.status === 200 && !request.headers.has('range');

// Caches every missing URL independently: one failure (network, quota) never
// stops the rest. Returns the URLs still missing, retried on the next launch.
export async function cacheEach(urls: readonly string[], cache: MediaCache, get: (url: string) => Promise<Response>) {
  const missing: string[] = [];
  for (const url of urls) {
    try {
      if (await cache.match(url)) continue;
      const response = await get(url);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      await cache.put(url, response);
    } catch {
      missing.push(url);
    }
  }
  return missing;
}

// Asks each window whether it is busy (starting or in a session). A window that
// does not answer in time is frozen, and a frozen page cannot be in a session.
export async function anyBusy(clients: readonly Askable[], timeoutMs: number) {
  const answers = await Promise.all(clients.map(client => new Promise<boolean>(resolve => {
    const channel = new MessageChannel();
    const finish = (busy: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(busy);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    channel.port1.onmessage = event => finish(event.data?.busy === true);
    client.postMessage({ query: 'busy' }, [channel.port2]);
  })));
  return answers.some(Boolean);
}
