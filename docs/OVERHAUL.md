# Overhaul: scene-based meditation timer

Status: prototype in progress (2026-11-07). Replaces the v1 design in DESIGN.md.

## Product

Opening the app puts you *in a place*: a pre-rendered scene of a real mountain gorge, as if
in a video game. You pick a time, press Start, and every control fades away; only the
countdown remains. The scene must feel rendered live, but interaction is always optional:
nothing fancy may stand between opening the app and pressing Start (two taps or fewer).

Same flow as v1: duration → optional warm-up (silent) → opening gong → meditation →
closing gong.

### Setup screen (all on top of the full-bleed scene, almost no text)
- Duration: one large number with a small "min". Presets 8 · 12 · 20 (default 12).
  Vertical swipe on the number adjusts by 1 (range 1–120).
- Warm-up: one chip, tap cycles Off → 15 → 30 → 45 → 60 s (default 15).
- Water sound: icon toggle (on by default).
- Bowl: small icon; tap cycles through the bowls and previews the sound.
- Scene: horizontal swipe turns the camera around (waterfall ⇄ bridge). Two tiny dots.
- Start. A tiny info icon opens credits. No subtitles, no explanatory copy.
- Remember all choices locally.

### Running
- Start: controls fade, camera eases in slightly, scene dims a little.
- Warm-up: small, light countdown. Meditation: the remaining time only.
- Tap anywhere reveals controls for ~4 s (warm-up: Skip, Cancel; meditation: End).
- End/natural completion: closing gong, camera eases back, controls return.

### "Feels live" layers
1. Pre-rendered seamless video loop per scene (water motion).
2. Live 2D effects on random timing so it never visibly repeats: mist drift, light-shaft
   breathing, occasional leaf/dust motes. Cheap canvas/WebGL, low frame rate.
3. Tilt parallax from the device orientation sensor using a rendered depth map (a few px).
During meditation: parallax off, effects slower and sparser, all rendering paused while hidden.

## Timing that survives screen-off (Android Chrome, installed PWA)
- Gongs are scheduled on the Web Audio clock (`AudioBufferSourceNode.start(when)`) the
  moment the session starts; skip/end/cancel cancel and reschedule. Page timers only
  repaint the countdown; remaining time is derived from the audio clock / start time.
- Audio plays continuously during a session so the page is never frozen: the water loop,
  or a faint keep-alive signal when water is off. Exact keep-alive method (plain Web Audio
  vs. routed through an `<audio>` element via MediaStreamDestination, signal level) is
  determined by the on-device test in `experiments/keepalive/` — see its RESULTS.md.
- Media Session metadata/position so the lock screen shows the session.
- Screen wake lock is *not* required; the user may turn the screen off.

## Asset contract (paths under `public/`)

```
scenes/<id>/poster.webp      still frame, portrait, 1080×2400 (9:20), used until video plays
scenes/<id>/loop.webm        seamless loop, AV1, ≤ 4 MB, 6–10 s, no audio
scenes/<id>/loop.mp4         same loop, H.264 fallback
scenes/<id>/depth.webp       grayscale depth for parallax, white = near, same framing, may be lower res
scenes/<id>/meta.json        { "loopSeconds": n, "focusX": 0–1, "focusY": 0–1, "light": [r,g,b] }
scenes/turn/<from>-to-<to>.webm|.mp4   camera turn between scenes, ~2.5 s
audio/water/<id>.webm|.m4a   seamless ambience loop per scene (Opus / AAC), 60–120 s
audio/bowls/<id>.webm|.m4a   bowl/chime strikes (Opus / AAC), trimmed, normalized
audio/CREDITS.md             source, author, licence for every sound
```
Scene ids: `waterfall`, `bridge`. Rendering sources live outside the repo in
`~/vms/blender/share/` (VM with the NVIDIA GPU, see ~/vms/blender/vm.sh).
Until real renders exist the app must work with placeholder posters (any image or gradient).

## Stack
Vite + TypeScript, no UI framework. Static build to GitHub Pages under `/meditation-timer/`,
service worker for offline. Android Chrome (Pixel 6a) is the primary target.

## Implementation (v2)

### Modules (`src/`)
| Module | Owns |
| --- | --- |
| `session.ts` | Pure session model: `{ startedAt, openAt, closeAt }` in wall-clock ms; phase is derived from the clock; `start/skip/end/cancel` are pure and no-ops outside their phase; `cues()` lists the two gongs. |
| `schedule.ts` | Pure `reconcile()`: maps wall-clock cues onto the audio clock given the sources still pending and the cues already consumed. Each cue sounds once: a moved deadline always re-arms (the 250 ms drift tolerance only applies to an unchanged deadline), cues more than 2 s stale are dropped, and while the context is not running every pending source is stopped and nothing is armed. |
| `audio.ts` | `AudioEngine`: one `AudioContext` (`latencyHint: 'playback'`), decoded buffers, gongs via `reconcile` (re-run on every state change and before any explicit `resume()`), the session bed (keep-alive plus optional water, fade-out scheduled on the audio clock), token-guarded previews, and `rest()` which suspends the idle device to save battery. |
| `output.ts` | The measured keep-alive signal: low-passed noise at about −60 dBFS RMS that runs under the water for the whole session (see `experiments/keepalive/RESULTS.md`). |
| `media-session.ts` | Lock-screen metadata, artwork and position state. |
| `assets.ts` | Resolves the asset contract to versioned URLs (`?v=<hash>`) from the build-time media manifest, picks AV1/H.264 and Opus/AAC, lists bowls. Missing files resolve to `null`. |
| `scene/scene.ts` | Poster → loop video → camera-turn clips with no black frames, zoom/dim per mode, one timer-paced frame loop (12 fps on setup, 8 fps in session, 24 fps only while the parallax canvas shows tilt or the moving loop) that stops entirely while hidden. Scene changes go to the latest requested scene (requests during a turn are queued, so the saved preference always matches the screen). A turn clip covers the outgoing scene only once it presents frames; a clip that is not ready, errors or stalls falls back to a crossfade or cuts to the next scene after a bounded wait, and the transition state is reset in `finally`. Which videos should play is tracked explicitly: hiding pauses every video, returning resumes only those. |
| `scene/effects.ts` | 2D canvas atmosphere: mist banks, breathing light shafts, motes, all on random timing; a calm mode for reduced motion. |
| `scene/parallax.ts` | WebGL depth-map displacement (≤7 CSS px, canvas capped at 2× DPR) driven by `deviceorientation` (mouse on desktop). Setup screen only. Enabled only with a decoded frame (the playing loop or a loaded poster) and a depth map; on WebGL context loss the canvas is hidden at once and all GPU resources are rebuilt on restore. |
| `ui.ts` | DOM, gestures, keyboard, credits rendering. While running, a transparent "Show controls" button over the countdown gives keyboard and screen-reader users the same reveal as a tap; revealed controls stay while they hold focus. |
| `sw/worker.ts`, `sw/logic.ts` | The service worker, bundled by `scripts/build-sw.mjs` (esbuild) with the build's file lists. `logic.ts` holds the testable parts: byte ranges (206, or 416 with `bytes */size`), per-file media caching, and the busy query sent to every window before an update takes over. |
| `prefs.ts` | Validated local preferences. |
| `main.ts` | Wiring. `update()` is the only place that reconciles audio and repaints; page timers only call it. |

### Timing
At Start the engine resumes the context and immediately starts the bed: the keep-alive signal
(`output.ts`, ≈ −60 dBFS RMS below 60 Hz) runs from then until the closing gong has rung out, with
water layered on top when enabled. Bowl and water decode with a 4 s limit (fallback: a synthesized
bowl, no water); the context is checked again and only then is the session committed and both
gongs scheduled with `start(when)`. Bowls play at −12 dB so they sit above the −24 LUFS water.

Skip/End/Cancel produce a new session value and call `update()`, which runs `reconcile()` once:
stale sources are `stop()`ped, replacements started. `update()` also runs on every repaint, on
`visibilitychange` and on every `AudioContext` state change. When the context is suspended or
interrupted, pending gongs are stopped at once, and again just before the app resumes it, so a
resumed clock can never render a stale gong; on resume they are re-armed from wall-clock time and
anything missed by more than 2 s is dropped. A resume that fails during a session is retried on
every visit and touch. Previews carry a request token, so one still decoding when Start is pressed
(or another bowl is chosen) never sounds.

Measured on the Pixel 6a (Vanadium 155, `experiments/keepalive/RESULTS.md`): plain Web Audio to
`destination` keeps the page and clock alive with the screen off and Doze forced, as long as the
output never drops below ≈ −72 dBFS. No lock-screen media notification appears in either output
route; Media Session metadata is still set.

### Reduced motion
The user's phone has system animations off, and the app should still feel alive. Under
`prefers-reduced-motion: reduce` the gentle ambient motion stays: the water loop video, slow
mist (half speed) and light-shaft breathing, with only a very rare mote. What is dropped: the
camera zoom-in at Start, tilt parallax, and camera-turn clips (scenes crossfade instead).
Changes to the setting apply live, without a reload.

### Performance (Pixel 6a, Vanadium 155, production build, poster only)
CPU of all Vanadium processes, % of one core, 20–30 s samples via `/proc/<pid>/stat`:

| State | CPU |
| --- | --- |
| Idle tab (about:blank) | 2 % |
| Setup, effects off entirely | 3 % |
| Setup, 12 fps effects | 27–28 % |
| Setup, parallax on, phone still | 29 % |
| Setup, phone continuously tilting (24 fps parallax) | 45 % |
| Session, screen on (8 fps effects) | 25 % |
| Session, screen off (audio only, water on) | 8.5 % (GPU process 0 %) |

Findings that shaped the code: a per-vsync `requestAnimationFrame` loop costs ~30 % on its own
(every tick composites a frame), so the loop is timer-paced; each composited frame costs
≈ 1.5 % per fps, while canvas resolution made no measurable difference; an infinite CSS
animation (the former "breathing" Start ring) forced 60 Hz compositing (+26 %) and was removed.

With the waterfall loop video (1080×2400, 24 fps), reduced motion as on the phone: setup 54–58 %,
session with the screen on 58 %, setup with the video paused 35 %. H.264 and AV1 cost the same
(hardware decode); the cost is compositing 24 frames per second. Drawing the effects on the
video's own frames (`requestVideoFrameCallback`) saved only 2–4 % and was not kept. The lever
left is the loop's frame rate. Screen-off sessions are unaffected (all rendering stops).

### Device notes (Pixel 6a)
- The phone has system animations off (all animation scales 0), which Chromium reports as
  `prefers-reduced-motion: reduce`; see Reduced motion above.
- Vanadium blocks motion sensors per site by default (`deviceorientation` reports `null`), so
  parallax stays off unless motion sensors are allowed for the site. The parallax path itself
  was verified on the phone's GPU with synthetic orientation events.

### Assets and offline
`scripts/media.mjs` hashes everything under `public/scenes` and `public/audio`. Vite exposes it
as `virtual:media` (the app knows what exists, so missing renders cost no 404s and fall back to
CSS gradient posters, no video, a synthesized bowl and a silent keep-alive). `scripts/build-sw.mjs`
writes `sw.js`: the shell is precached on install; after load the page asks the worker to cache
the media variants this browser actually uses, one at a time. Cached media answer `Range`
requests with 206 slices (416 for unsatisfiable ranges). Each media file is cached
independently, so one failure or a quota error never stops the rest; complete 200 responses
fetched at runtime are cached too, and whatever is still missing is retried on every launch.

A new version waits. The page asks for activation at launch and when the idle app is hidden;
the waiting worker then asks every window (`clients.matchAll`, a `MessageChannel` per window,
1 s timeout; a frozen window cannot be in a session) whether it is busy — starting, in a session,
or with audio still ringing — and calls `skipWaiting()` only if none is. A window that is busy
anyway when the controller changes reloads only once its audio is idle again.

Shell lookups use `ignoreVary`: Chromium sends `Origin` on the `crossorigin`
script/style requests, so a server's `Vary: Origin` would otherwise make every lookup miss and
fall through to a network copy that no longer exists after a deploy (verified on the phone).
