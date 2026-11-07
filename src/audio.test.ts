// Engine tests against a fake AudioContext whose rendering, state-change
// events and decoding are each driven by the test, so races can be staged.
import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from './audio.ts';
import { cancel, cues, end, skip, start, type Session } from './session.ts';

type FakeBuffer = { duration: number; url?: string; getChannelData(channel: number): Float32Array };

class FakeParam {
  value = 1;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  cancelScheduledValues() { return this; }
}

class FakeNode {
  readonly context: FakeContext;
  constructor(context: FakeContext) {
    this.context = context;
  }
  connect<T>(node: T) { return node; }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  startAt = NaN;
  stopAt = Infinity;
  sounded = false;
  onended: (() => void) | null = null;
  start(when = 0) {
    this.startAt = when;
    this.context.sources.push(this);
  }
  stop(when = 0) {
    this.stopAt = when;
  }
}

class FakeContext extends EventTarget {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 4000;
  destination = new FakeNode(this);
  sources: FakeSource[] = [];
  sounded: { url: string; audio: number; wall: number }[] = [];
  resumable = true;
  decodes: { url: string; resolve(): void }[] = [];
  deferDecoding = false;
  private queued: string[] = [];

  createGain() { return new FakeGain(this); }
  createBufferSource() { return new FakeSource(this); }
  createBuffer(_channels: number, length: number, rate: number): FakeBuffer {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  decodeAudioData(data: { url: string }) {
    const buffer = { duration: 30, url: data.url, getChannelData: () => new Float32Array(0) };
    if (!this.deferDecoding) return Promise.resolve(buffer);
    return new Promise<FakeBuffer>(resolve => this.decodes.push({ url: data.url, resolve: () => resolve(buffer) }));
  }
  resume() {
    if (this.resumable) this.setState('running');
    return Promise.resolve();
  }
  suspend() {
    this.setState('suspended');
    return Promise.resolve();
  }
  // State changes take effect at once; their events wait for flush(), like a busy main thread.
  setState(state: AudioContextState) {
    this.state = state;
    this.queued.push(state);
  }
  flush() {
    for (const _ of this.queued.splice(0)) this.dispatchEvent(new Event('statechange'));
  }
  // Renders audio: a source sounds when the clock reaches its start before its stop.
  render(seconds: number) {
    if (this.state !== 'running') return;
    const until = this.currentTime + seconds;
    for (const source of this.sources) {
      const at = Math.max(source.startAt, this.currentTime);
      if (!source.sounded && source.startAt <= until && source.stopAt > at) {
        source.sounded = true;
        this.sounded.push({ url: source.buffer?.url ?? 'synth', audio: at, wall: wall + (at - this.currentTime) * 1000 });
      }
    }
    this.currentTime = until;
  }
}

let ctx: FakeContext;
let wall = 0;
let engine: AudioEngine;

const BOWL = 'bowl';
const settings = { minutes: 12, warmup: 15 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const gongs = () => ctx.sounded.filter(s => s.url === BOWL);
const advance = (ms: number) => {
  ctx.render(ms / 1000);
  wall += ms;
};

beforeEach(() => {
  wall = 1_000_000;
  mock.method(Date, 'now', () => wall);
  Object.assign(globalThis, {
    AudioContext: class { constructor() { return (ctx = new FakeContext()); } },
    fetch: async (url: string) => ({ ok: true, arrayBuffer: async () => ({ url }) }),
  });
  engine = new AudioEngine();
});

afterEach(() => mock.restoreAll());

// Mirrors main.ts: unlock, bed, decode, commit, sync.
async function begin(warmup = settings.warmup, minutes = settings.minutes) {
  assert.ok(await engine.unlock());
  ctx.flush();
  engine.startBed();
  engine.setGong(await engine.load(BOWL));
  const session = start(1, { minutes, warmup }, wall);
  engine.sync(cues(session), session.closeAt + 4000);
  return session;
}

const apply = (session: Session | null) => engine.sync(cues(session), session ? session.closeAt + 4000 : null);

test('a whole session sounds each gong once, on time', async () => {
  const s = await begin();
  advance(13 * 60_000);
  assert.deepEqual(gongs().map(g => g.wall), [s.openAt, s.closeAt]);
});

test('skip just before the warm-up ends moves the opening gong', async () => {
  let s: Session | null = await begin();
  advance(14_850);
  s = skip(s, wall);
  apply(s);
  advance(13 * 60_000);
  assert.equal(gongs().length, 2);
  assert.ok(gongs()[0].wall < 1_000_000 + 14_950, 'opening gong follows the skip, not the old deadline');
  assert.equal(gongs()[1].wall, s!.closeAt);
});

test('end just before natural completion sounds one closing gong now', async () => {
  let s: Session | null = await begin(0, 1);
  advance(59_900);
  s = end(s, wall);
  apply(s);
  advance(60_000);
  const closing = gongs().slice(1);
  assert.equal(closing.length, 1);
  assert.ok(closing[0].wall < 1_000_000 + 59_960);
});

test('cancel while suspended disarms the gongs before rendering resumes', async () => {
  let s: Session | null = await begin();
  advance(5_000);
  ctx.setState('suspended');
  wall += 3_000;
  s = cancel(s, wall);
  apply(s);
  ctx.setState('running');
  advance(20 * 60_000);
  ctx.flush();
  assert.deepEqual(gongs(), []);
  assert.equal(ctx.sources.filter(source => source.loop && source.stopAt > ctx.currentTime).length, 0, 'keep-alive stopped');
});

test('rendering before the resume handler never plays a stale gong', async () => {
  const s = await begin();
  advance(14_900);
  ctx.setState('suspended');
  ctx.flush();
  wall += 60_000;
  ctx.setState('running');
  advance(500);
  assert.deepEqual(gongs(), [], 'nothing armed while the handler has not run');
  ctx.flush();
  advance(13 * 60_000);
  assert.deepEqual(gongs().map(g => g.wall), [s.closeAt], 'missed opening dropped, closing on time');
});

test('an explicit resume disarms first, even before the suspend event is handled', async () => {
  const s = await begin();
  advance(14_900);
  ctx.setState('suspended');
  wall += 60_000;
  await engine.unlock();
  advance(500);
  assert.deepEqual(gongs(), []);
  ctx.flush();
  advance(13 * 60_000);
  assert.deepEqual(gongs().map(g => g.wall), [s.closeAt]);
});

test('a failed resume arms nothing; a later one reschedules', async () => {
  const s = await begin();
  advance(1_000);
  ctx.setState('suspended');
  ctx.flush();
  ctx.resumable = false;
  assert.equal(await engine.unlock(), false);
  wall += 5_000;
  ctx.resumable = true;
  await engine.unlock();
  ctx.flush();
  advance(13 * 60_000);
  assert.deepEqual(gongs().map(g => g.wall), [s.openAt, s.closeAt]);
});

test('a preview whose decode resolves after Start stays silent', async () => {
  assert.ok(await engine.unlock());
  ctx.flush();
  ctx.deferDecoding = true;
  const preview = engine.previewBowl('other-bowl');
  await tick();
  engine.stopPreview();
  engine.startBed();
  for (const decode of ctx.decodes) decode.resolve();
  await preview;
  advance(10_000);
  assert.deepEqual(ctx.sounded.filter(s => s.url === 'other-bowl'), []);
});

test('a newer preview supersedes one still decoding', async () => {
  assert.ok(await engine.unlock());
  ctx.flush();
  ctx.deferDecoding = true;
  const first = engine.previewBowl('first');
  await tick();
  const second = engine.previewBowl('second');
  await tick();
  for (const decode of ctx.decodes) decode.resolve();
  await Promise.all([first, second]);
  advance(1_000);
  assert.deepEqual(ctx.sounded.map(s => s.url), ['second']);
});

test('the idle rest never suspends while a session is being prepared', async () => {
  assert.ok(await engine.unlock());
  ctx.flush();
  engine.startBed();
  engine.rest();
  assert.equal(ctx.state, 'running');
});

test('the keep-alive runs until the closing gong has rung out', async () => {
  const s = await begin(0, 1);
  const keepAlive = ctx.sources.find(source => source.loop)!;
  assert.ok(keepAlive.stopAt >= (s.closeAt - 1_000_000) / 1000 + 30, 'outlasts the 30 s closing gong');
});

test('the keep-alive is not cut short once the closing gong is ringing', async () => {
  let s: Session | null = await begin(0, 1);
  advance(30_000);
  s = end(s, wall);
  apply(s);
  advance(1_000);
  apply(s);
  const keepAlive = ctx.sources.find(source => source.loop)!;
  assert.ok(keepAlive.stopAt >= (s!.closeAt - 1_000_000) / 1000 + 30);
});
