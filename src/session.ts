export type Settings = { minutes: number; warmup: number; sound: number };
export type Session = { phase: 'setup' | 'warmup' | 'meditation'; started: number; deadline: number; settings: Settings };
export type Action = 'start' | 'tick' | 'skip' | 'cancel' | 'end';
export type Result = { state: Session; cue?: 'opening' | 'closing'; interrupted?: boolean };
export const initialSession = (settings: Settings): Session => ({ phase: 'setup', started: 0, deadline: 0, settings: { ...settings } });
export function transition(state: Session, action: Action, now: number, settings = state.settings): Result {
  if (action === 'start' && state.phase === 'setup') return { state: { phase: 'warmup', started: now, deadline: now + settings.warmup * 1000, settings: { ...settings } } };
  if (action === 'cancel' && state.phase === 'warmup') return { state: initialSession(state.settings) };
  if (action === 'end' && state.phase === 'meditation') return { state: initialSession(state.settings), cue: 'closing' };
  if (state.phase === 'warmup' && (action === 'skip' || (action === 'tick' && now >= state.deadline))) {
    // A suspended page must never replay an opening and closing gong in a burst.
    if (action === 'tick' && now - state.deadline > 5000) return { state: initialSession(state.settings), interrupted: true };
    return { state: { ...state, phase: 'meditation', started: now, deadline: now + state.settings.minutes * 60000 }, cue: 'opening' };
  }
  if (state.phase === 'meditation' && action === 'tick' && now >= state.deadline) {
    const late = now - state.deadline > 5000;
    return { state: initialSession(state.settings), cue: late ? undefined : 'closing', interrupted: late };
  }
  return { state };
}
export const remaining = (state: Session, now: number) => Math.max(0, Math.ceil((state.deadline - now) / 1000));
