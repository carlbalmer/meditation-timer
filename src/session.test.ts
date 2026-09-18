import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSession, transition, remaining } from './session.ts';
const settings = { minutes: 1, warmup: 30, sound: 2 };
test('silent warm-up, opening gong, closing gong each once', () => {
  const warmup = transition(initialSession(settings), 'start', 1000);
  assert.equal(warmup.state.phase, 'warmup'); assert.equal(warmup.cue, undefined);
  assert.equal(remaining(warmup.state, 1500), 30);
  const meditation = transition(warmup.state, 'tick', 31000);
  assert.equal(meditation.cue, 'opening'); assert.equal(meditation.state.deadline, 91000);
  assert.equal(transition(meditation.state, 'tick', 31000).cue, undefined);
  const complete = transition(meditation.state, 'tick', 91000);
  assert.equal(complete.cue, 'closing'); assert.equal(complete.state.phase, 'setup');
  assert.equal(transition(complete.state, 'tick', 92000).cue, undefined);
});
test('skip starts full duration; cancellation is silent; manual end sounds once', () => {
  const warmup = transition(initialSession(settings), 'start', 1000).state;
  const cancelled = transition(warmup, 'cancel', 2000);
  assert.equal(cancelled.state.phase, 'setup'); assert.equal(cancelled.cue, undefined);
  const skipped = transition(warmup, 'skip', 2000);
  assert.equal(skipped.state.deadline, 62000); assert.equal(skipped.cue, 'opening');
  const ended = transition(skipped.state, 'end', 3000);
  assert.equal(ended.cue, 'closing'); assert.equal(transition(ended.state, 'end', 4000).cue, undefined);
});
test('suspension skips stale gong transitions and reports interruption', () => {
  const warmup = transition(initialSession(settings), 'start', 1000).state;
  const lateWarmup = transition(warmup, 'tick', 100000);
  assert.equal(lateWarmup.state.phase, 'setup'); assert.equal(lateWarmup.interrupted, true); assert.equal(lateWarmup.cue, undefined);
  const meditation = transition(warmup, 'skip', 2000).state;
  const lateEnd = transition(meditation, 'tick', 70000);
  assert.equal(lateEnd.interrupted, true); assert.equal(lateEnd.cue, undefined);
});
test('running settings are snapshotted and repeated start cannot reset session', () => {
  const selected = { ...settings };
  const warmup = transition(initialSession(selected), 'start', 1000, selected).state;
  selected.minutes = 20;
  assert.equal(warmup.settings.minutes, 1);
  assert.equal(transition(warmup, 'start', 2000).state, warmup);
});
test('actions outside their phases are harmless and cannot emit gongs', () => {
  const setup = initialSession(settings);
  for (const action of ['skip', 'cancel', 'end', 'tick'] as const) {
    const result = transition(setup, action, 100000);
    assert.equal(result.state, setup); assert.equal(result.cue, undefined);
  }
  const warmup = transition(setup, 'start', 1000).state;
  assert.equal(transition(warmup, 'end', 2000).state, warmup);
  const meditation = transition(warmup, 'skip', 2000).state;
  for (const action of ['skip', 'cancel', 'start'] as const) {
    const result = transition(meditation, action, 3000);
    assert.equal(result.state, meditation); assert.equal(result.cue, undefined);
  }
});
