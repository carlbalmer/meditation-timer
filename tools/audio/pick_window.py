#!/usr/bin/env python3
"""Find the steadiest, event-free stretch of a recording for loop building.
Usage: pick_window.py <file> <window_seconds> [step_seconds=1]   (needs numpy; run with python3 -I)
Cost per window = std of 1 s loudness + 0.15*(#50 ms events >5 dB above their local median)
                  + 2*|loudness trend| (dB over the window) + 0.1*max |1s deviation from window median|.
Prints the 5 best start times.
"""
import os, shutil, subprocess, sys
import numpy as np
SR = 48000
path, W = sys.argv[1], float(sys.argv[2])
step = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
raw = subprocess.run([os.environ.get("FFMPEG") or shutil.which("ffmpeg") or os.path.expanduser("~/bin/ffmpeg"), "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
n = len(x)
if n / SR < W:
    sys.exit(f"file only {n/SR:.1f}s")
h = SR // 20; k = n // h
e = 20 * np.log10(np.sqrt((x[:k * h].reshape(k, h) ** 2).mean(1)) + 1e-9)       # 50 ms
med = np.array([np.median(e[max(0, i - 20):i + 21]) for i in range(k)])
ev = (e - med) > 5
s1 = 20 * np.log10(np.sqrt((x[:(n // SR) * SR].reshape(-1, SR) ** 2).mean(1)) + 1e-9)  # 1 s
res = []
for st in np.arange(0, n / SR - W + 1e-9, step):
    a, b = int(st), int(st + W)
    seg = s1[a:b]
    if len(seg) < 3: continue
    tr = np.polyfit(np.arange(len(seg)), seg, 1)[0] * len(seg)
    cost = seg.std() + 0.15 * ev[int(st * 20):int((st + W) * 20)].sum() + 2 * abs(tr) / 3 + 0.1 * np.abs(seg - np.median(seg)).max()
    res.append((cost, st, seg.std(), int(ev[int(st * 20):int((st + W) * 20)].sum()), tr))
res.sort()
for c, st, sd, nev, tr in res[:5]:
    print(f"start {st:6.1f}s  cost {c:5.2f}  std1s {sd:4.2f} dB  events {nev:3d}  trend {tr:+.2f} dB")
