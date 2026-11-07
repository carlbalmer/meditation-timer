# QA record (v2, 2026-11-07)

Device: Pixel 6a, GrapheneOS, Vanadium 155, over adb (`adb reverse`), production build via
`npm run preview`. Desktop checks in headless Chromium 156.

## Automated
- `npm test`: 32 tests. Pure session/scheduling logic, plus engine tests against a fake
  `AudioContext` that drives rendering, state events and decoding independently: render before
  the resume handler, cancel while suspended, explicit resume before the suspend event, failed
  resume, preview decode resolving after Start or after another preview, Skip/End within the
  drift tolerance of a deadline, idle rest during start-up, keep-alive ring-out. Each fix was
  mutation-checked: reverting it makes its test fail.
- `npm run build`: typecheck, Vite build, service worker.

## Real-time screen-off session (phone)
8 min, 15 s warm-up, water off, `himalayan` bowl. Started with a real tap; screen off,
`dumpsys battery unplug`, `dumpsys deviceidle force-idle`; woken after ~10 min. An AudioWorklet
meter injected over the DevTools protocol recorded when gong samples were rendered:

| Gong | Scheduled (audio clock) | Rendered | Page |
| --- | --- | --- | --- |
| Opening | 15.405 s | 15.408 s | hidden |
| Closing | 495.405 s | 495.408 s | hidden |

Audio clock vs wall clock stayed within 82 ms over 595 s (no stall); each gong rang out ~35 s;
the page was back on the setup screen after waking. Keep-alive median block level −62.6 dBFS.

## Browser checks
- Desktop (instrumented Web Audio): Start schedules opening and closing once; Skip stops both and
  reschedules once; repeated Skip/End are no-ops; End replaces the pending closing gong; Cancel
  silences everything; the bed's fade is re-timed each time.
- Offline: shell precached, scene/audio cached in the background, offline reload works, cached
  media answer `Range` requests with 206.
- Phone UI: setup, warm-up, reveal, meditation, End and return to setup checked on screenshots;
  scrim and countdown placement adjusted for legibility over the bright waterfall render.

## Not yet verified
- Loop video, camera-turn clips and the bridge scene (renders not delivered yet).
- Installed home-screen PWA (all checks ran in a browser tab).
- Real tilt on the phone (Vanadium blocks motion sensors by default; synthetic events only).
- A 20-minute session.
