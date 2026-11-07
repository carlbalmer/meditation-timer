// Maps wall-clock cues onto the audio clock. Given the sources still pending
// and the cues already consumed (sounded), decides which sources to stop and
// which to start so that every cue sounds exactly once, on time or not at all.

import type { Cue } from './session.ts';

export type Scheduled = { key: string; at: number; when: number };
export type Plan<T extends Scheduled> = {
  keep: T[];
  stop: T[];
  start: Scheduled[];
  started: T[];
  consumed: Set<string>;
};

export const LEAD = 0.05;
export const GRACE = 2;
export const TOLERANCE = 0.25;

// `pending` are sources not yet known to have started. While the context is
// not running its clock is meaningless, so every pending source is stopped and
// nothing new is armed; the next running reconcile reschedules from wall time.
export function reconcile<T extends Scheduled>(
  pending: T[],
  consumed: ReadonlySet<string>,
  cues: Cue[],
  audioNow: number,
  wallNow: number,
  running: boolean,
): Plan<T> {
  const live = new Set(cues.map(cue => cue.key));
  const plan: Plan<T> = { keep: [], stop: [], start: [], started: [], consumed: new Set([...consumed].filter(key => live.has(key))) };
  for (const source of pending) {
    if (source.when > audioNow) continue;
    plan.started.push(source);
    if (live.has(source.key)) plan.consumed.add(source.key);
  }
  const targets = new Map<string, Scheduled>();
  for (const cue of cues) {
    if (plan.consumed.has(cue.key)) continue;
    const when = audioNow + (cue.at - wallNow) / 1000;
    if (when >= audioNow - GRACE) targets.set(cue.key, { key: cue.key, at: cue.at, when: Math.max(when, audioNow + LEAD) });
  }
  for (const source of pending) {
    if (source.when <= audioNow) continue;
    const target = targets.get(source.key);
    if (running && target && target.at === source.at && Math.abs(target.when - source.when) <= TOLERANCE) {
      plan.keep.push(source);
      targets.delete(source.key);
    } else {
      plan.stop.push(source);
    }
  }
  if (running) plan.start.push(...targets.values());
  return plan;
}
