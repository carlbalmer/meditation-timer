import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancel, clampMinutes, cues, end, formatClock, nextWarmup, phaseAt, skip, span, start, type Session } from './session.ts';
import { GRACE, LEAD, reconcile, TOLERANCE, type Scheduled } from './schedule.ts';

const settings = { minutes: 12, warmup: 15 };

// A minimal pure model of the engine: a clock that can drift from the wall
// clock, and a record of every source ever armed so duplicates are visible.
function rig(wallStart = 1_000_000) {
  let wall = wallStart;
  let audio = 10;
  let running = true;
  let pending: Scheduled[] = [];
  let consumed = new Set<string>();
  const started: Scheduled[] = [];
  const stopped: Scheduled[] = [];
  return {
    get wall() { return wall; },
    set running(value: boolean) { running = value; },
    advance(ms: number, audioFrozen = false) { wall += ms; if (!audioFrozen) audio += ms / 1000; },
    sync(session: Session | null) {
      const plan = reconcile(pending, consumed, cues(session), audio, wall, running);
      stopped.push(...plan.stop);
      started.push(...plan.start);
      pending = [...plan.keep, ...plan.start];
      consumed = plan.consumed;
      return plan;
    },
    // Wall time at which each armed, never-stopped source sounds.
    sounded(key: string) {
      return started.filter(s => s.key === key && !stopped.includes(s)).map(s => wall + (s.when - audio) * 1000);
    },
  };
}

test('phases follow the clock', () => {
  const s = start(1, settings, 0);
  assert.equal(phaseAt(null, 0), 'idle');
  assert.equal(phaseAt(s, 14_999), 'warmup');
  assert.equal(phaseAt(s, 15_000), 'meditation');
  assert.equal(phaseAt(s, 15_000 + 12 * 60_000), 'done');
  assert.deepEqual(span(s, 5_000), [0, 15_000]);
  assert.deepEqual(span(s, 75_000), [15_000, 15_000 + 12 * 60_000]);
  assert.equal(span(s, 10 ** 9), null);
  assert.equal(span(null, 0), null);
});

test('warm-up off opens immediately', () => {
  const s = start(1, { minutes: 8, warmup: 0 }, 500);
  assert.equal(phaseAt(s, 500), 'meditation');
  assert.equal(s.closeAt, 500 + 8 * 60_000);
});

test('skip keeps the duration and only applies during warm-up', () => {
  const s = start(1, settings, 0);
  const skipped = skip(s, 4_000)!;
  assert.deepEqual(skipped, { id: 1, startedAt: 0, openAt: 4_000, closeAt: 4_000 + 12 * 60_000 });
  assert.equal(skip(skipped, 5_000), skipped);
  assert.equal(skip(null, 0), null);
});

test('end and cancel only apply in their phase', () => {
  const s = start(1, settings, 0);
  assert.equal(end(s, 1_000), s);
  assert.equal(cancel(s, 1_000), null);
  assert.equal(cancel(s, 20_000), s);
  assert.deepEqual(end(s, 20_000), { ...s, closeAt: 20_000 });
  const done = end(s, 20_000)!;
  assert.equal(end(done, 21_000), done);
});

test('settings helpers', () => {
  assert.equal(clampMinutes(0), 1);
  assert.equal(clampMinutes(400), 120);
  assert.equal(clampMinutes(12.4), 12);
  assert.equal(nextWarmup(0), 15);
  assert.equal(nextWarmup(60), 0);
  assert.equal(nextWarmup(7), 0);
  assert.equal(formatClock(12 * 60_000), '12:00');
  assert.equal(formatClock(59_001), '1:00');
  assert.equal(formatClock(1), '0:01');
});

test('start schedules both gongs on the audio clock once', () => {
  const r = rig();
  const s = start(1, settings, r.wall);
  r.sync(s);
  assert.equal(r.sync(s).start.length, 0, 'repeated sync is idempotent');
  r.advance(13 * 60_000);
  r.sync(s);
  assert.deepEqual(r.sounded('1:open'), [s.openAt]);
  assert.deepEqual(r.sounded('1:close'), [s.closeAt]);
});

test('skip reschedules the pair exactly once', () => {
  const r = rig();
  let s: Session | null = start(1, settings, r.wall);
  r.sync(s);
  r.advance(5_000);
  s = skip(s, r.wall);
  r.sync(s);
  r.advance(10);
  s = skip(s, r.wall);
  r.sync(s);
  r.advance(13 * 60_000);
  r.sync(s);
  assert.equal(r.sounded('1:open').length, 1);
  assert.ok(Math.abs(r.sounded('1:open')[0] - (s!.openAt + LEAD * 1000)) < 1);
  assert.deepEqual(r.sounded('1:close'), [s!.closeAt]);
});

test('end replaces the pending closing gong and never replays the opening', () => {
  const r = rig();
  let s: Session | null = start(1, { minutes: 8, warmup: 0 }, r.wall);
  r.sync(s);
  r.advance(60_000);
  s = end(s, r.wall);
  r.sync(s);
  r.advance(1);
  r.sync(s);
  r.advance(10 * 60_000);
  r.sync(s);
  assert.equal(r.sounded('1:open').length, 1);
  assert.equal(r.sounded('1:close').length, 1);
  assert.ok(r.sounded('1:close')[0] < s!.closeAt + 100);
});

test('end racing natural completion sounds one closing gong', () => {
  const r = rig();
  let s: Session | null = start(1, { minutes: 1, warmup: 0 }, r.wall);
  r.sync(s);
  r.advance(60_000 + 20);
  s = end(s, r.wall);
  r.sync(s);
  assert.equal(r.sounded('1:close').length, 1);
});

test('cancel during warm-up silences everything', () => {
  const r = rig();
  let s: Session | null = start(1, settings, r.wall);
  r.sync(s);
  r.advance(3_000);
  s = cancel(s, r.wall);
  r.sync(s);
  r.advance(20 * 60_000);
  r.sync(s);
  assert.deepEqual(r.sounded('1:open'), []);
  assert.deepEqual(r.sounded('1:close'), []);
});

test('a new session does not disturb the previous ringing gong', () => {
  const r = rig();
  let s: Session | null = start(1, { minutes: 1, warmup: 0 }, r.wall);
  r.sync(s);
  r.advance(60_500);
  s = start(2, settings, r.wall);
  const plan = r.sync(s);
  assert.equal(plan.stop.length, 0);
  assert.equal(r.sounded('1:close').length, 1);
});

test('a frozen audio clock is re-mapped instead of sounding late', () => {
  const r = rig();
  const s = start(1, { minutes: 8, warmup: 30 }, r.wall);
  r.sync(s);
  r.advance(10_000);
  r.advance(60_000, true);
  r.sync(s);
  r.advance(9 * 60_000);
  r.sync(s);
  assert.deepEqual(r.sounded('1:open'), [], 'opening gong missed during the freeze is dropped');
  assert.deepEqual(r.sounded('1:close'), [s.closeAt]);
});

test('late page callbacks never replay stale gongs', () => {
  const r = rig();
  const s = start(1, { minutes: 1, warmup: 15 }, r.wall);
  r.advance(5 * 60_000);
  r.sync(s);
  assert.deepEqual(r.sounded('1:open'), []);
  assert.deepEqual(r.sounded('1:close'), []);
});

test('a cue slightly late still sounds once, promptly', () => {
  const r = rig();
  const s = start(1, { minutes: 1, warmup: 0 }, r.wall);
  r.advance((GRACE * 1000) / 2);
  r.sync(s);
  r.sync(s);
  assert.equal(r.sounded('1:open').length, 1);
});

test('skip just before the warm-up ends still moves both gongs', () => {
  const r = rig();
  let s: Session | null = start(1, settings, r.wall);
  r.sync(s);
  r.advance(15_000 - (TOLERANCE * 1000) / 2);
  s = skip(s, r.wall);
  const plan = r.sync(s);
  assert.equal(plan.stop.length, 2);
  r.advance(13 * 60_000);
  r.sync(s);
  assert.equal(r.sounded('1:open').length, 1);
  assert.ok(r.sounded('1:open')[0] < settings.warmup * 1000 + 1_000_000 - 50);
  assert.deepEqual(r.sounded('1:close'), [s!.closeAt]);
});

test('end just before natural completion replaces the closing gong', () => {
  const r = rig();
  let s: Session | null = start(1, { minutes: 1, warmup: 0 }, r.wall);
  r.sync(s);
  r.advance(60_000 - 100);
  s = end(s, r.wall);
  r.sync(s);
  r.advance(1_000);
  r.sync(s);
  assert.equal(r.sounded('1:close').length, 1);
  assert.ok(Math.abs(r.sounded('1:close')[0] - (s!.closeAt + LEAD * 1000)) < 1);
});

test('a suspended context disarms every pending gong and arms nothing', () => {
  const r = rig();
  const s = start(1, settings, r.wall);
  r.sync(s);
  r.running = false;
  const plan = r.sync(s);
  assert.equal(plan.stop.length, 2);
  assert.equal(plan.start.length, 0);
  r.advance(30_000, true);
  r.running = true;
  r.sync(s);
  assert.deepEqual(r.sounded('1:open'), [], 'opening gong missed while suspended is dropped');
  assert.equal(r.sounded('1:close').length, 1);
});

test('consumed cues stay consumed after their source is forgotten', () => {
  const pending: Scheduled[] = [{ key: '1:open', at: 0, when: 5 }];
  const first = reconcile(pending, new Set(), [{ key: '1:open', at: 0 }], 5.5, 500, true);
  assert.deepEqual([...first.consumed], ['1:open']);
  const again = reconcile([], first.consumed, [{ key: '1:open', at: 0 }], 5.6, 600, true);
  assert.equal(again.start.length, 0);
});
