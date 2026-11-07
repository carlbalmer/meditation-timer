// Lock-screen presence for a running session.

const supported = 'mediaSession' in navigator;

export function showSession(title: string, artwork: string | null, startedAt: number, endsAt: number, onEnd: () => void) {
  if (!supported) return;
  const session = navigator.mediaSession;
  session.metadata = new MediaMetadata({
    title,
    artwork: artwork ? [{ src: artwork, sizes: '1080x2400', type: 'image/webp' }] : [],
  });
  session.playbackState = 'playing';
  const duration = Math.max(1, (endsAt - startedAt) / 1000);
  try {
    session.setPositionState({ duration, position: Math.min(duration, Math.max(0, (Date.now() - startedAt) / 1000)), playbackRate: 1 });
  } catch { /* position state is optional */ }
  for (const action of ['pause', 'play'] as const) session.setActionHandler(action, () => {});
  session.setActionHandler('stop', onEnd);
}

export function clearSession() {
  if (!supported) return;
  const session = navigator.mediaSession;
  session.metadata = null;
  session.playbackState = 'none';
  for (const action of ['pause', 'play', 'stop'] as const) session.setActionHandler(action, null);
  try { session.setPositionState(); } catch { /* optional */ }
}
