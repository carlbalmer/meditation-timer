export const WARMUPS = [0, 15, 30, 45, 60] as const;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 90;

export interface Prefs {
  minutes: number;
  warmup: number;
  bowl: string;
}

const KEY = 'meditation-timer';

export function parsePrefs(raw: string | null, bowls: readonly string[]): Prefs {
  const fallback: Prefs = { minutes: 12, warmup: 15, bowl: bowls[0] };
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(raw ?? '{}') ?? {};
  } catch {}
  const minutes = Number(stored.minutes);
  return {
    minutes: Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : fallback.minutes,
    warmup: WARMUPS.includes(stored.warmup as never) ? (stored.warmup as number) : fallback.warmup,
    bowl: bowls.includes(stored.bowl as string) ? (stored.bowl as string) : fallback.bowl,
  };
}

export function loadPrefs(bowls: readonly string[]): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY), bowls);
  } catch {
    return parsePrefs(null, bowls);
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}
