// Pure session timing. All times are wall-clock milliseconds; a session is fully
// described by when the opening and closing gongs sound.

export type Settings = { minutes: number; warmup: number };
export type Session = { id: number; startedAt: number; openAt: number; closeAt: number };
export type Phase = 'idle' | 'warmup' | 'meditation' | 'done';
export type Cue = { key: string; at: number };

export const MINUTES = { min: 1, max: 120 };
export const PRESETS = [8, 12, 20];
export const WARMUPS = [0, 15, 30, 45, 60];

export const clampMinutes = (value: number) =>
  Math.min(MINUTES.max, Math.max(MINUTES.min, Math.round(value)));

export const nextWarmup = (seconds: number) =>
  WARMUPS[(WARMUPS.indexOf(seconds) + 1) % WARMUPS.length];

export function phaseAt(session: Session | null, now: number): Phase {
  if (!session) return 'idle';
  if (now < session.openAt) return 'warmup';
  return now < session.closeAt ? 'meditation' : 'done';
}

export function start(id: number, settings: Settings, now: number): Session {
  const openAt = now + settings.warmup * 1000;
  return { id, startedAt: now, openAt, closeAt: openAt + settings.minutes * 60_000 };
}

export function skip(session: Session | null, now: number) {
  if (!session || phaseAt(session, now) !== 'warmup') return session;
  return { ...session, openAt: now, closeAt: now + session.closeAt - session.openAt };
}

export function end(session: Session | null, now: number) {
  if (!session || phaseAt(session, now) !== 'meditation') return session;
  return { ...session, closeAt: now };
}

export function cancel(session: Session | null, now: number) {
  return phaseAt(session, now) === 'warmup' ? null : session;
}

// The current phase's [start, end] in wall ms, or null when not running.
export function span(session: Session | null, now: number): [number, number] | null {
  const phase = phaseAt(session, now);
  if (phase === 'warmup') return [session!.startedAt, session!.openAt];
  if (phase === 'meditation') return [session!.openAt, session!.closeAt];
  return null;
}

export function cues(session: Session | null): Cue[] {
  if (!session) return [];
  return [
    { key: `${session.id}:open`, at: session.openAt },
    { key: `${session.id}:close`, at: session.closeAt },
  ];
}

export function formatClock(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
