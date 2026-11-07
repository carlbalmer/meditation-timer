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

## Review round 2 (scene, UI, service worker)
- `npm test`: 41 tests (adds `src/sw/logic.test.ts`: byte ranges and 416, runtime cacheability,
  per-file caching past network/HTTP/quota errors with retry, busy query incl. a silent window).
- Update handshake, headless Chromium against the production preview: with a session running in
  tab A, a new worker stayed waiting when idle tab B launched and when A itself asked; after A
  cancelled, B's request activated it and A reloaded. A `controllerchange` during a session
  deferred A's reload until 20 s after the session ended. A controlled page got
  `416 bytes */995060` for an unsatisfiable range and 206 slices from the cache.
- Phone (test copy of the app with generated turn clips, never in `public/scenes`):
  - three and two rapid swipes: saved scene and screen always agree (queued turn back);
  - screen off mid-crossfade: the incoming loop paused while hidden, only it resumed on return;
  - real clip: plays its full 2.5 s, outgoing scene hidden only after the clip presents frames;
  - truncated clip that never presents: crossfade after 1 s; corrupt clip: crossfade after
    1.5 s; clip that dies at 1.3 s: cut to the next scene; switching never wedged;
  - `WEBGL_lose_context`: canvas hidden at once (plain scene, no black), parallax back after restore;
  - bridge without a poster but with depth: parallax stays off; on for the waterfall loop;
  - toggling system animations with the page open flips parallax on/off without a reload.
- Headless: "Show controls" is the only control exposed while running; Tab reveals, controls
  stay while focused, hide 4 s after focus leaves; a tap still auto-hides.

## Installed home-screen app, 20-minute session (phone)
Installed via Vanadium "Install app" (opens as a standalone `WebappActivity`). 20 min, 15 s
warm-up, **water on**, `himalayan`. Started with a real tap; screen off, `dumpsys battery unplug`,
`dumpsys deviceidle force-idle` for 21.5 min. A test-only AudioWorklet meter (injected over the
DevTools protocol, not part of the app) logged one-shot source scheduling and the first rendered
samples:

| Gong | Scheduled (audio clock) | Rendered |
| --- | --- | --- |
| Opening | 15.557 s | 15.557 s |
| Closing | 1215.557 s | 1215.557 s |

The app was back on the setup screen after waking. The audio clock ran 1.05 s behind wall time
over the 21.5 min (≈0.08 %), so the closing gong sounds about a second after the countdown's
wall-clock end: harmless, noted.

## Final assets on the phone (installed app)
- Real camera-turn clip bridge→waterfall played in full (screen recording); controls stayed put.
- Under reduced motion (the phone's setting) scenes crossfade instead, as designed.
- Update after a deploy: the new worker activated while the app was in the background; a reload
  left pending by a busy moment now happens the next time the idle app is hidden, instead of
  ~20 s after reopening.

## Not yet verified
- Real tilt on the phone (Vanadium blocks motion sensors by default; synthetic events only).
- A 20-minute session.
