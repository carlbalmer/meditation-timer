// A session is one audio track: bed, opening gong, bed, closing gong. It is built by
// concatenating MP3 frames (tools/audio/build-bowls.sh makes every piece out of identical
// 192-byte, 24 ms frames), so the browser plays it like any media file, screen on or off,
// and the gongs land wherever the track says, with no timers involved.

export const FRAME_SECONDS = 0.024;
export const FRAME_BYTES = 192;

export interface Gong {
  frames: number;
  /** seconds from the start of the gong piece to the strike */
  onset: number;
}

export type Segment = { kind: 'bed' | 'gong'; frames: number };

export interface Plan {
  segments: Segment[];
  /** track positions (s) of the opening and closing strikes */
  openAt: number;
  closeAt: number;
  /** track length (s) */
  duration: number;
}

/** Lay out a session: `warmup` seconds before the opening gong, `meditation` seconds between the gongs. */
export function planTrack(warmup: number, meditation: number, gong: Gong): Plan {
  const gap = Math.round(meditation / FRAME_SECONDS);
  if (gap < gong.frames) throw new Error(`meditation of ${meditation} s is shorter than the gong`);
  const lead = Math.max(0, Math.round((warmup - gong.onset) / FRAME_SECONDS));
  const segments: Segment[] = [
    { kind: 'bed', frames: lead },
    { kind: 'gong', frames: gong.frames },
    { kind: 'bed', frames: gap - gong.frames },
    { kind: 'gong', frames: gong.frames },
  ].filter(segment => segment.frames > 0) as Segment[];
  const openAt = lead * FRAME_SECONDS + gong.onset;
  return { segments, openAt, closeAt: openAt + gap * FRAME_SECONDS, duration: (lead + gap + gong.frames) * FRAME_SECONDS };
}

/** The track's bytes as parts for a Blob; bed frames are taken round-robin from the bed piece. */
export function trackParts(plan: Plan, bed: Uint8Array, gong: Uint8Array): Uint8Array<ArrayBuffer>[] {
  const bedFrames = bed.length / FRAME_BYTES;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let phase = 0;
  for (const segment of plan.segments) {
    if (segment.kind === 'gong') {
      parts.push(gong as Uint8Array<ArrayBuffer>);
      continue;
    }
    let left = segment.frames;
    while (left > 0) {
      const take = Math.min(left, bedFrames - phase);
      parts.push(bed.subarray(phase * FRAME_BYTES, (phase + take) * FRAME_BYTES) as Uint8Array<ArrayBuffer>);
      phase = (phase + take) % bedFrames;
      left -= take;
    }
  }
  return parts;
}

export function buildTrack(plan: Plan, bed: Uint8Array, gong: Uint8Array): Blob {
  return new Blob(trackParts(plan, bed, gong), { type: 'audio/mpeg' });
}
