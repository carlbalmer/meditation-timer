# Audio asset pipeline

Builds the pieces the app stitches each session's audio track from: `src/audio/*.mp3`
and their timing in `src/sounds.json`. Needs `ffmpeg`/`ffprobe` (with libmp3lame; `~/bin/ffmpeg`
is used if none is on `PATH`), `curl`, `awk`, `python3`.

```bash
tools/audio/fetch.sh    # download the CC0 Freesound previews to ~/assets-work/sounds/raw/freesound-<id>/ (RAW=… to change)
tools/audio/build.sh    # build src/audio/ + src/sounds.json, then print the loudness table
```

| script | purpose |
| --- | --- |
| `fetch.sh` | downloads each sound's page + HQ preview into its own directory; refuses anything that is not CC0 |
| `build-bowls.sh` | per bowl: trim leading silence, 48 kHz mono, smooth tail fade, match max-momentary loudness across bowls; then the session pieces (below) |
| `verify.sh` | duration / size / integrated loudness / true peak of the *decoded* pieces |

## Session pieces

The app builds one MP3 per session by concatenating frames (`src/track.ts`): bed, gong, bed, gong.
For that, every piece is a bare frame stream with identical frames: MPEG-1 Layer III, 48 kHz mono,
64 kb/s CBR, so 192 bytes per 24 ms frame, no ID3 tag, no Xing/LAME header and no bit reservoir
(`-reservoir 0`), so any frame can follow any other. `build-bowls.sh` checks the frame headers.

* `bed.mp3`: 12 s of brown noise between 20 and 60 Hz at −60 dBFS RMS, inaudible on a phone speaker.
  It runs under the whole session because Chromium-based browsers stop a page's media about a
  minute or two after the screen goes off when its output is quieter than about −72 dBFS (pure
  digital silence was paused ~140 s after screen-off on the Pixel 6a; with the bed, sessions run
  through). It is not a seamless loop; the seams are at −60 dBFS below 60 Hz.
* `<bowl>.mp3`: the bowl at −6 dB under the loudness-matched level, mixed over the bed, at most
  45 s long (longer bowls fade out over the last 6 s) so a gong fits into the shortest meditation
  (1 min). `src/sounds.json` gives its length in frames and `onset`, the time from the start of
  the piece to the strike in the decoded audio (≈27 ms of MP3 encoder delay; `warm` has a soft
  attack, 0.29 s).

## Notes

* Freesound originals need an API login, so the **public HQ previews (MP3, 128 kbps)** are the
  source for the two CC0 bowls. Swap in originals later by replacing `preview-hq.mp3`.
* The five Cpt_Asteroid bowls come from `resources/*.wav` and are **CC BY-NC 4.0**; `warm` and
  `soft` are the commercially safe CC0 alternatives. See `public/audio/CREDITS.md`.
