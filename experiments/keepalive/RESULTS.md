# Screen-off keep-alive: results (2026-11-07)

Device: Pixel 6a, GrapheneOS, **Vanadium 155** (Chromium; the only browser on the phone, so the
app must target Vanadium, not Chrome). Harsh conditions: battery simulated unplugged
(`dumpsys battery unplug`), screen off, **Doze forced** (`dumpsys deviceidle force-idle`).
Test page: `index.html` here. A gong was scheduled with `start(when)` at T+150/240 s. An
AudioWorklet meter on the audio thread recorded when gong samples were actually rendered.
`run-variant.sh` drives the phone, `analyze.py` summarizes `log.jsonl`.

| Run | Output route | Keep-alive level | Screen off | Audio clock | Gong rendered | Page timers |
|---|---|---|---|---|---|---|
| B | Web Audio → destination | silent (gain 0) | 6 min | **stopped after ~60 s** (305 s lost) | **never** | frozen 306 s |
| C | Web Audio → destination | −60 dB gain | 6 min | exact (±0.00 s) | **at 240.000 s ✓** | never paused > 2.0 s |
| E | Web Audio → destination | −80 dB gain | 4 min | stopped after ~60 s | never | frozen 187 s |
| D | Web Audio → MediaStreamDestination → `<audio>` | −60 dB gain | 4 min | exact | **at 150.000 s ✓** | never paused > 2.0 s |
| A | Web Audio → destination (old page) | −60 dB gain | 7 min | exact over 421 s | (no meter yet) | — |

The test signal is brown-ish noise at about −6 dBFS RMS before the gain, so "−60 dB gain" ≈ **−66 dBFS RMS**.
"−80" ≈ −86 dBFS RMS. That fits Chromium's audibility threshold of about −72 dBFS: below it the
page counts as silent and gets frozen.
Log gaps seen on the server are only Doze withholding network; the page itself kept running.

## Decisions for the app
1. **Plain Web Audio to `ctx.destination` is enough.** The `<audio>`-element route works too but
   gave no benefit: neither route produced a lock-screen media notification (`dumpsys media_session`
   showed no Vanadium session). Keep Media Session metadata, but don't rely on it.
2. **Never output true silence during a session**, including the silent warm-up and any gap or fade.
   Run a keep-alive bed from Start until the closing gong has decayed, *underneath* the water
   (the water alone would also do, but one always-on bed is simpler and covers water-off,
   warm-up and fades).
3. **Keep-alive level: ≈ −60 dBFS RMS** (about 12 dB above the threshold). Measured on the signal
   before OS volume, so it works with media volume at 0. Make it as inaudible as possible:
   low-frequency content (e.g. brown noise low-passed below ~60 Hz, or a ~30 Hz sine) that
   phone speakers barely reproduce.
4. If the clock ever does stall (silence, interruption, audio focus loss), the gong plays late
   after resume. Reconcile against wall-clock time and drop stale cues rather than playing a
   late gong, as `schedule.ts` already does.
5. Stop the bed after the session so the context can idle and the page doesn't drain battery.

Still to verify with the real app: a full 20-minute session, screen off, unplugged, as an
installed home-screen app.
