#!/usr/bin/env python3
"""Objective seamless-loop check. Usage: loopcheck.py <audio file> [more files]  (needs numpy; run with python3 -I)

Tiles the loop twice (loop || loop) and compares the seam at t=L with the rest of the signal:
  * level: 200 ms RMS across +-3 s of the seam vs. the file's median/spread of the same statistic elsewhere
  * click: largest |second difference| within +-20 ms of the seam vs. its distribution elsewhere (ratio)
  * spectrum: log-spectral distance between the 1 s before and 1 s after the seam, vs. the same distance
    for 1 s windows at 200 random other positions (percentile of the seam distance)
  * wrap step: |x[0]-x[-1]| in units of the typical |x[n+1]-x[n]|
Prints PASS/FAIL per criterion.
"""
import subprocess, sys
import numpy as np

SR = 48000
import os, shutil
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or os.path.expanduser("~/bin/ffmpeg")

def load(path):
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)

def logspec(seg):
    w = np.hanning(len(seg))
    S = np.abs(np.fft.rfft(seg * w[:, None], axis=0)).mean(1) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    # 1/3-octave-ish bands 50 Hz..16 kHz
    edges = 50 * 2 ** (np.arange(0, 8.4, 1 / 3))
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        m = (f >= a) & (f < b)
        out.append(10 * np.log10(S[m].sum() + 1e-18))
    return np.array(out)

def check(path):
    x = load(path)
    L = len(x)
    t = np.concatenate([x, x])  # seam at L
    m = t.mean(1)
    # level around the seam
    win = SR // 5
    def rms_at(c): return 20 * np.log10(np.sqrt(np.mean(m[c - win // 2:c + win // 2] ** 2)) + 1e-12)
    centres = np.arange(win, len(m) - win, win // 2)
    series = np.array([rms_at(c) for c in centres])
    near = np.abs(centres - L) < 3 * SR
    med = np.median(series)
    dev_seam = np.abs(series[near] - med).max()
    dev_else = np.abs(series[~near] - med)
    lvl_ok = dev_seam <= max(1.0, np.percentile(dev_else, 99))
    # click
    d2 = np.abs(np.diff(m, 2))
    zone = slice(L - SR // 50, L + SR // 50)
    c_seam = d2[zone].max()
    mask = np.ones(len(d2), bool); mask[L - SR:L + SR] = False
    c_else = d2[mask].max()
    click_ratio = c_seam / c_else
    # wrap step
    step = np.abs(x[0] - x[-1]).max()
    typ = np.abs(np.diff(x, axis=0)).mean()
    wrap = step / typ
    # spectrum
    A = logspec(t[L - SR:L]); B = logspec(t[L:L + SR])
    d_seam = np.sqrt(np.mean((A - B) ** 2))
    rng = np.random.default_rng(1)
    ds = []
    for _ in range(200):
        s = rng.integers(SR, len(t) - 2 * SR)
        if abs(s - L) < 2 * SR: continue
        ds.append(np.sqrt(np.mean((logspec(t[s - SR:s]) - logspec(t[s:s + SR])) ** 2)))
    pct = (np.array(ds) < d_seam).mean() * 100
    spec_ok = pct < 95
    print(f"{path}\n  loop {L/SR:.2f}s | level: max dev near seam {dev_seam:.2f} dB (elsewhere p99 {np.percentile(dev_else,99):.2f}, max {dev_else.max():.2f}) {'PASS' if lvl_ok else 'FAIL'}")
    print(f"  click: seam max|d2|/global max|d2| = {click_ratio:.2f} {'PASS' if click_ratio<=1.0 else 'FAIL'} | wrap step {wrap:.2f}x typical sample delta {'PASS' if wrap<3 else 'FAIL'}")
    print(f"  spectrum: 1s-before vs 1s-after LSD {d_seam:.2f} dB = {pct:.0f}th percentile of random same-size comparisons (median {np.median(ds):.2f}) {'PASS' if spec_ok else 'FAIL'}")
    return lvl_ok and click_ratio <= 1.0 and wrap < 3 and spec_ok

if __name__ == "__main__":
    ok = all([check(p) for p in sys.argv[1:]])
    sys.exit(0 if ok else 1)
