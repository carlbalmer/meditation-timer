import type { Plan } from './track.ts';

export type Phase = 'warmup' | 'meditation' | 'done';

/** Where a session is, read from the track position: the gongs sound at these positions, so the display follows them. */
export function status(position: number, plan: Plan): { phase: Phase; remaining: number } {
  if (position < plan.openAt) return { phase: 'warmup', remaining: plan.openAt - position };
  if (position < plan.closeAt) return { phase: 'meditation', remaining: plan.closeAt - position };
  return { phase: 'done', remaining: 0 };
}

/** 754.2 → "12:35", 59.01 → "1:00", 0 → "0:00" (rounds up, so the display reaches 0:00 with the gong). */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds - 1e-6));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
