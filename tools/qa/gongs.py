"""Find gong strikes in a phone-mic recording.

usage: python gongs.py REC.pcm GONG.mp3 ONSET_S [OFFSET_S] [EXPECTED_S,...]
  REC.pcm   16 kHz mono s16le from tools/mic-recorder
  GONG.mp3  public/audio/session/<bowl>.mp3; ONSET_S its "onset" from src/sounds.json
  OFFSET_S  subtracted from the printed times (the Start tap's position in the recording)
  EXPECTED  strike times to check (after the offset): for each, the rise of the partials' energy
            within ±1.5 s, measured against the 2 s before; robust when the room is noisy

A bowl rings at a few fixed partials. The detector takes the strongest partials of the gong piece
and reports each sudden rise (>= 17 dB within 0.3 s) of energy in exactly those frequencies that
keeps ringing for 2 s, which speech and room noise don't produce. Times are when the strike reached the mic, ±10 ms.
Needs numpy and ffmpeg.
"""
import subprocess
import sys

import numpy as np

RATE = 16000
N = 2048  # FFT size (128 ms)
HOP = 160  # 10 ms
PARTIALS = 6
RISE_DB = 17


def decode(path: str, raw: bool) -> np.ndarray:
    args = ['ffmpeg', '-v', 'error']
    args += ['-f', 's16le', '-ar', str(RATE), '-ac', '1'] if raw else []
    args += ['-i', path, '-f', 's16le', '-ar', str(RATE), '-ac', '1', '-']
    return np.frombuffer(subprocess.run(args, check=True, capture_output=True).stdout, np.int16).astype(np.float64)


def power(x: np.ndarray) -> np.ndarray:
    frames = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP] * np.hanning(N)
    return np.abs(np.fft.rfft(frames, axis=1)) ** 2


def main() -> None:
    rec_path, gong_path, onset = sys.argv[1], sys.argv[2], float(sys.argv[3])
    offset = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    expected = [float(e) for e in sys.argv[5].split(',')] if len(sys.argv) > 5 and sys.argv[5] else []
    gong = decode(gong_path, False)
    ring = power(gong[int(onset * RATE) : int((onset + 3) * RATE)]).mean(axis=0)
    freqs = np.fft.rfftfreq(N, 1 / RATE)
    ring[(freqs < 200) | (freqs > 5000)] = 0  # phone speakers reproduce little below 200 Hz
    peaks = []
    for b in np.argsort(ring)[::-1]:
        if all(abs(b - p) > 4 for p in peaks):
            peaks.append(b)
        if len(peaks) == PARTIALS:
            break
    bins = sorted({b + d for p in peaks for d in (-1, 0, 1)})

    level = 10 * np.log10(power(decode(rec_path, True))[:, bins].sum(axis=1) + 1e-9)
    t = (np.arange(len(level)) * HOP + N / 2) / RATE  # frame centres
    back, near = int(2.0 * RATE / HOP), int(0.3 * RATE / HOP)
    found = []
    i = back
    while i < len(level):
        base = np.median(level[i - back : i - near])
        ringing = np.median(level[i + near : i + 8 * near]) - base if i + 8 * near < len(level) else 0
        if level[i] - base >= RISE_DB and ringing >= 6:
            j = i  # walk back to where the rise crossed halfway: the strike
            while j > i - near and level[j - 1] - base >= RISE_DB / 2:
                j -= 1
            found.append((t[j] - N / 2 / RATE * 0.5, level[i] - base))
            i += 10 * RATE // HOP  # one strike per 10 s
        else:
            i += 1
    print(f'partials (Hz): {", ".join(f"{freqs[p]:.0f}" for p in sorted(peaks))}')
    spec = power(decode(rec_path, True))
    per = [10 * np.log10(spec[:, [p - 1, p, p + 1]].sum(axis=1) + 1e-9) for p in peaks]
    for e in expected:
        c = int(((e + offset) * RATE - N / 2) / HOP)
        w = int(1.5 * RATE / HOP)
        if c - w - back < 0 or c + w + 8 * near >= len(level):
            print(f'expected {e:9.3f} s: outside the recording')
            continue
        best = None
        for p, lv in zip(peaks, per):
            base = np.percentile(lv[c - w - back : c - w], 20)
            window = lv[c - w : c + w] - base
            k = c - w + int(np.argmax(window))
            ring = np.median(lv[k + near : k + 8 * near]) - base
            if best is None or ring > best[2]:
                best = (p, k, ring)
        p, k, ring = best
        print(f'expected {e:9.3f} s: strongest partial {freqs[p]:.0f} Hz peaks at {t[k] - offset:9.3f} s and rings '
              f'{ring:+.0f} dB over the quiet level before ({"HEARD" if ring >= 20 else "unclear" if ring >= 10 else "NOT FOUND"})')
    for at, rise in found:
        print(f'gong at {at - offset:9.3f} s   rise {rise:.0f} dB')


if __name__ == '__main__':
    main()
