# Audio asset pipeline

Rebuilds everything in `public/audio/` (water loops + bowl strikes). Needs `ffmpeg`/`ffprobe`
(with libopus + aac; `~/bin/ffmpeg` is used if none is on `PATH`), `curl`, `awk`. The two
Python checks additionally need `numpy` (`python3 -I tools/audio/loopcheck.py …`).

```bash
tools/audio/fetch.sh        # download the CC0 Freesound previews to ~/assets-work/sounds/raw/freesound-<id>/ (RAW=… to change)
tools/audio/build.sh        # build water + bowls into public/audio/, then print the loudness table
tools/audio/loopcheck.py public/audio/water/*.webm public/audio/water/*.m4a   # seam checks (PASS/FAIL)
```

| script | purpose |
| --- | --- |
| `fetch.sh` | downloads each sound's page + HQ preview into its own directory; refuses anything that is not CC0 |
| `build-water.sh` | 90 s seamless loops: highpass, 10 s equal-power (quarter-sine) tail→head crossfade, 48 kHz stereo, −24 LUFS integrated (linear gain; a look-ahead limiter on the splashy `bridge` source keeps true peak ≤ −2 dBTP), Opus 96 kb/s + AAC 128 kb/s |
| `build-bowls.sh` | trims leading silence (strike at ≤ ~4 ms), 48 kHz mono, 2 ms fade-in, smooth tail fade, matches max-momentary loudness across bowls, sample peak ≤ −1.3 dBFS (so the *decoded* codec output stays ≤ −1 dBTP), Opus 64 kb/s + AAC 96 kb/s |
| `verify.sh` | duration / size / integrated loudness / true peak of the *decoded* files |
| `loopcheck.py` | objective seam check: level dip/bump, click, spectral continuity at the loop point |
| `pick_window.py` | finds the steadiest event-free window in a long recording (how the loop start offsets were chosen) |

Source windows are set in the `LOOPS` table at the top of `build-water.sh`
(`id | Freesound id | start | loop length | crossfade | prefilter`) and in `BOWLS` in `build-bowls.sh`.

## Notes

* Freesound originals need an API login, so the **public HQ previews (MP3, 128 kbps)** are the source
  for the water loops and the two CC0 bowls. Swap in originals later by replacing `preview-hq.mp3`
  with the original (the scripts read any ffmpeg-decodable file under that name).
* The five Cpt_Asteroid bowls come from `resources/*.wav` and are **CC BY-NC 4.0**; ids
  `warm` and `soft` are the commercially safe CC0 alternatives. See `public/audio/CREDITS.md`.
* Opus (`.webm`) and AAC (`.m4a`) have no audible priming gap in browsers: decoded durations equal
  the source durations (checked by `verify.sh`); the loops are exactly 90.00 s.

## Candidates evaluated (all CC0, Freesound; steadiness = std of 1 s loudness over the chosen window)

Water — waterfall: 352846 Kamjanka (chosen; 0.15 dB, no events, soft spectrum, centroid 1.7 kHz),
828407 Loup of Fintry plunge pool (0.11 dB but bright/hissier: 6–12 kHz −8 dB vs −14 dB re total and
heavy < 100 Hz rumble), 569316 (0.8 dB, 1 dB/min upward drift), 442433 (0.24 dB but only 64 s),
609162 (55 dB level range), 474699/650699/855647 (wind/transients). Bridge: 690325 Kervijen babbling creek
(chosen; no other noise, 295 s so the cleanest 100 s window could be selected, 0.72 dB, only gurgle-level
events), 703167 (0.71 dB but only 102 s and closer/duller), 637939 (dual mono, low tone), 465619 (21+ events),
488323 (mono, close-up turbulence), 615250/726422/484732 (low-frequency rumble, birds, vinyl noise).
