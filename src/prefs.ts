import { clampMinutes, WARMUPS } from './session.ts';

export type Prefs = { minutes: number; warmup: number; water: boolean; bowl: string; scene: string };

export const DEFAULTS: Prefs = { minutes: 12, warmup: 15, water: true, bowl: 'himalayan', scene: 'waterfall' };
const KEY = 'meditation-prefs-v2';

export function parsePrefs(raw: string | null): Prefs {
  let saved: Partial<Record<keyof Prefs, unknown>> = {};
  try { saved = JSON.parse(raw ?? '{}') ?? {}; } catch { /* corrupt storage falls back to defaults */ }
  return {
    minutes: typeof saved.minutes === 'number' && Number.isFinite(saved.minutes) ? clampMinutes(saved.minutes) : DEFAULTS.minutes,
    warmup: WARMUPS.includes(saved.warmup as number) ? saved.warmup as number : DEFAULTS.warmup,
    water: typeof saved.water === 'boolean' ? saved.water : DEFAULTS.water,
    bowl: typeof saved.bowl === 'string' ? saved.bowl : DEFAULTS.bowl,
    scene: typeof saved.scene === 'string' ? saved.scene : DEFAULTS.scene,
  };
}

export function loadPrefs(): Prefs {
  try { return parsePrefs(localStorage.getItem(KEY)); } catch { return { ...DEFAULTS }; }
}

export function savePrefs(prefs: Prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage is optional */ }
}
