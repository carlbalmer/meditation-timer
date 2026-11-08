# Meditation

A simple meditation timer. Pick the minutes, a warm-up and a gong, press Start. The settings
fade away and only the countdown and Cancel stay on a dark screen. A gong opens the meditation
after the warm-up, and another closes it.

Live at <https://carlbalmer.github.io/meditation-timer/> (every push to `main` deploys).

## How it keeps time with the screen off

Start builds the whole session as **one audio track** and plays it in an `<audio>` element:
warm-up, gong, meditation, gong. A 15 s warm-up with 8 minutes gives 15 s of bed, the gong,
8 minutes of bed, the gong. The browser plays it like music, screen on or off, locked or not,
and the gongs are simply where the track has them. No timers are involved.

- The track is stitched from pre-encoded MP3 frames (`src/track.ts`, pieces built by
  `tools/audio/`), so a 20-minute session is about 10 MB, built instantly.
- The "silence" is an inaudible bed (brown noise below 60 Hz at −60 dBFS). Chromium-based
  browsers pause media they consider silent a minute or two after the screen goes off.
- Everything on screen is computed from the track position (`src/session.ts`), so the
  countdown is right the moment the screen comes back on.
- While the screen is on, a screen wake lock keeps it on, and the session screen is black with
  dim white text.
- The session shows up as media on the lock screen (Media Session API). Pausing it there (or
  another app taking the audio, e.g. a call) pauses the timer; the app then shows Resume.
- Cancel stops the track and plays one gong.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173/meditation-timer/
npm test         # track layout, session status, prefs (node --test)
npm run build    # typecheck, build to dist/, generate the service worker
npm run preview  # serve dist/ (offline use, service worker)
```

The tailnet copy (`https://<host>.<tailnet>.ts.net:10443/meditation-timer/`, via `tailscale serve`
→ 127.0.0.1:4180) is the user service `meditation-preview`, a `vite preview` of this checkout's
`dist/`: `npm run build` updates it, and an installed app picks the new version up the next time
it is opened while idle.

On a phone over USB: `adb reverse tcp:5173 tcp:5173`, then open the dev URL (localhost is a
secure context, so the wake lock and service worker work).

**Testing screen-off timing on a phone** (`tools/qa/`, `tools/mic-recorder/`): the recorder is a
tiny Android app that records the phone's microphone (unprocessed or voice-recognition source,
so no echo cancellation removes the phone's own speaker) in a foreground service, screen off
included. Build and install it with `tools/mic-recorder/build.sh` and
`adb install -r -g tools/mic-recorder/out/rec.apk`. Then, with the app open on the phone and the
settings chosen, `tools/qa/run-session.sh NAME END_S [WAKE_AT_S...]` taps Start, turns the screen
off with the battery reported unplugged and Doze forced, wakes the phone at the given times
(screenshots of the countdown), and finally lists the gong strikes the mic heard
(`tools/qa/gongs.py`). Test timing on a production build only.

## Licences

Five bowl recordings by Cpt_Asteroid are CC BY-NC 4.0 (non-commercial); the other two are CC0.
Details in [public/audio/CREDITS.md](public/audio/CREDITS.md).
