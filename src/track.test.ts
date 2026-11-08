import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_BYTES, FRAME_SECONDS, planTrack, trackParts } from './track.ts';
import { clock, status } from './session.ts';
import { parsePrefs } from './prefs.ts';

const gong = { frames: 1000, onset: 0.027 };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('gongs land at warm-up and warm-up + meditation, to within one frame', () => {
  const plan = planTrack(15, 480, gong);
  assert.ok(Math.abs(plan.openAt - 15) <= FRAME_SECONDS / 2);
  close(plan.closeAt - plan.openAt, 480);
  close(plan.duration, plan.closeAt - gong.onset + gong.frames * FRAME_SECONDS);
  assert.deepEqual(plan.segments.map(s => s.kind), ['bed', 'gong', 'bed', 'gong']);
});

test('no warm-up starts with the gong', () => {
  const plan = planTrack(0, 60, gong);
  close(plan.openAt, gong.onset);
  close(plan.closeAt, gong.onset + 60);
  assert.deepEqual(plan.segments.map(s => s.kind), ['gong', 'bed', 'gong']);
});

test('a meditation shorter than the gong is refused', () => {
  assert.throws(() => planTrack(15, 20, gong));
});

test('track bytes: whole frames, the bed cycles, gongs where planned', () => {
  const bed = new Uint8Array(7 * FRAME_BYTES).map((_, i) => Math.floor(i / FRAME_BYTES)); // frame k filled with k
  const g = new Uint8Array(gong.frames * FRAME_BYTES).fill(200);
  const plan = planTrack(1, 60, gong);
  const bytes = Buffer.concat(trackParts(plan, bed, g));
  const frames = plan.segments.reduce((n, s) => n + s.frames, 0);
  assert.equal(bytes.length, frames * FRAME_BYTES);
  const lead = plan.segments[0].frames;
  for (let k = 0; k < lead; k++) assert.equal(bytes[k * FRAME_BYTES], k % 7);
  assert.equal(bytes[lead * FRAME_BYTES], 200);
  assert.equal(bytes[(lead + gong.frames) * FRAME_BYTES], lead % 7); // the bed continues where it left off
  assert.equal(bytes[(frames - 1) * FRAME_BYTES], 200);
});

test('status follows the track position', () => {
  const plan = planTrack(15, 480, gong);
  assert.deepEqual(status(0, plan), { phase: 'warmup', remaining: plan.openAt });
  assert.equal(status(plan.openAt, plan).phase, 'meditation');
  close(status(plan.openAt + 100, plan).remaining, 380);
  assert.equal(status(plan.closeAt, plan).phase, 'done');
});

test('clock rounds up', () => {
  assert.equal(clock(754.2), '12:35');
  assert.equal(clock(59.01), '1:00');
  assert.equal(clock(60), '1:00');
  assert.equal(clock(0.0000001), '0:00');
  assert.equal(clock(-3), '0:00');
});

test('prefs are validated', () => {
  const bowls = ['a', 'b'];
  assert.deepEqual(parsePrefs(null, bowls), { minutes: 12, warmup: 15, bowl: 'a' });
  assert.deepEqual(parsePrefs('{"minutes":20,"warmup":0,"bowl":"b"}', bowls), { minutes: 20, warmup: 0, bowl: 'b' });
  assert.deepEqual(parsePrefs('{"minutes":0.5,"warmup":7,"bowl":"x"}', bowls), { minutes: 12, warmup: 15, bowl: 'a' });
  assert.deepEqual(parsePrefs('not json', bowls), { minutes: 12, warmup: 15, bowl: 'a' });
});
