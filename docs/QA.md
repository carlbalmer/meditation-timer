# QA: screen-off timing

How to rerun: see "Testing screen-off timing on a phone" in the README (`tools/mic-recorder`,
`tools/qa/run-session.sh`). Gong times are measured by the phone's own microphone (recorder
app, voice-recognition source: no echo cancellation; the unprocessed source isn't offered on
the Pixel 6a). They are in seconds after the Start tap and include the tap-to-play latency
(≈0.1–0.3 s). "Screen off" means: power key, battery reported unplugged
(`dumpsys battery unplug`), Doze forced (`dumpsys deviceidle force-idle`) for the whole
session except the wake-ups.

## 2026-11-08, Pixel 6a (GrapheneOS), production build over `adb reverse`

### Format experiments (static test MP3, gongs at 10 s and 190 s)

| Track between the gongs | Browser | Result |
|---|---|---|
| digital silence | Vanadium 155 tab | first gong on time; playback **stopped ~140 s after screen-off** (position frozen at 144 s), second gong never played |
| bed: brown noise < 60 Hz, −60 dBFS RMS | Vanadium tab | both gongs, **180.000 s apart** |
| same bed | Brave 1.99.55 tab | both gongs, **180.000 s apart**, track played to the end |

### The app (one stitched MP3 per session)

| Browser | Session | Opening gong | Closing gong | Countdown when woken (shown / expected) |
|---|---|---|---|---|
| Vanadium tab | 15 s + 3 min, himalayan | 15.14 | 195.14 | 1:34 / 1:34 (at 101.9 s) |
| Brave tab | 15 s + 3 min, himalayan | 15.13 | 195.13 | 2:14 / 2:14 (61.9 s), 0:44 / 0:44 (151.9 s) |
| Brave installed app | 15 s + 8 min, himalayan | 15.1 | 495.1 (noisy room; partials rise at 495.1–495.4) | 6:14 / 6:14 (121.9 s), 3:14 / 3:14 (301.9 s) |
| Brave installed app | 15 s + 20 min, himalayan | ≈15.1–15.5 | 1215.27 | 10:14 / 10:14 (601.9 s) |
| Brave installed app (after review fixes) | off + 1 min, bright | 0.28 | 60.28 | 0:29 / 0:29 (31.9 s) |

All sessions returned to the setup screen after the closing gong. No drift between track
position and wall clock was measurable (the v2 Web Audio clock drifted ~1 s in 20 min).

### Interactions (Brave installed app)

- The session appears as a media session ("Meditation", "8 min · warm-up 15 s", PLAYING).
- `cmd media_session dispatch pause` (what a call, another app or the lock-screen button does):
  countdown froze, "paused" + Resume shown; Resume continued from the same position.
- Another app taking audio focus (a laulo playback, by accident) paused the session the same way.
- Cancel during warm-up: setup screen, **one gong 0.35 s after the tap**.
- Update: a new build was picked up when the idle app came back to the foreground, without
  restarting it (build stamp in "Sound credits").

## Not covered yet

- A real lock by the power button on a really unplugged phone, without adb. In particular
  the user's Pixel 9 Pro with Brave (where v2 stopped 3–4 s after locking).
- Sessions longer than 20 minutes; low-battery / battery-saver mode (the wake lock may be denied;
  the track still keeps time).
- iOS / Safari.
