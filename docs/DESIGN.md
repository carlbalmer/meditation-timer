> **Superseded (2026-11-07).** This describes v1 (ivory UI, foreground-only sessions with a screen
> wake lock). The current product and implementation are described in [OVERHAUL.md](OVERHAUL.md).

# Meditation timer: design and implementation plan

Status: implemented first version, 2026-09-17. Browser verification underway.
Repository: /home/codex/meditation-timer in Ubuntu WSL.

## Scope and accepted UI

One installable, offline-capable web page, built with plain HTML, CSS and TypeScript and hosted on GitHub Pages. Use Vite only for development and production builds; no UI framework, router, backend or database.

Follow the three approved mockups: warm ivory background, charcoal typography, bronze accents, circular timer and instrument image. Remove the sound waveform.

- Setup: whole-minute duration; vertical swipe on the number; circular drag (20 minutes per revolution); quick choices 5/8/15/20; swipe or arrow buttons to select a sound and preview it; warm-up chip with 30/45/60 seconds; separate Start button.
- Warm-up: silent countdown, Skip and Cancel.
- Meditation: remaining time and End session. Opening gong at meditation start and closing gong at completion.

Proposed defaults: 20 minutes and 45 seconds warm-up; remember the last duration, warm-up and sound locally. Skip starts meditation immediately. Cancel during warm-up is silent; End session during meditation plays the closing gong once. Return to setup on completion while letting the gong decay naturally. These end/cancel details are proposals where the earlier thread was not explicit.

## Three small modules

| Module | Owns | Seam |
| --- | --- | --- |
| app.ts + index.html + style.css | DOM, gestures, rendering, saved preferences, visibility and screen wake lock | Converts input into session actions; renders session state; calls audio |
| session.ts | Setup/warm-up/meditation phases, deadlines and one-time transitions | Plain functions receiving state, action and current time; return updated state and any gong cue |
| audio.ts | Loading recordings, one preview at a time, gong playback and cancellation | A few direct functions to prepare, preview, play and stop |

Dependencies: app calls session and audio; session knows nothing about the browser; audio knows nothing about the UI or session phases. Ordinary imports and function calls are enough. No event bus, class hierarchy, generic store or dependency-injection framework.

One small settings object and one session state are sufficient. Starting a session snapshots the selected settings. Remaining time is derived from deadlines, not decremented on each interval; browser callbacks only trigger reevaluation and repainting. Session transitions emit each gong cue once. A delayed callback must not replay a whole sequence of missed gongs.

The UI uses semantic HTML controls with CSS and an SVG ring. Gestures are extra input methods; keyboard and ordinary controls can perform the same actions. Use Pointer Events, responsive sizing, CSS custom properties and reduced-motion support where useful. Keep the three phases in one page rather than introducing navigation.

The sound catalogue is static data: name, note, audio file and source ID. Five supplied Cpt_Asteroid bowl/cymbal recordings are bundled with attribution and CC BY-NC 4.0 licence links. The illustration is a native SVG. Previews fade out after five seconds; session gongs decay naturally.

## Browser and installation boundary

A manifest and icons provide installation metadata; a small service worker caches the app and bundled assets for offline use. This is deployment plumbing, not another session component. Do not force an update during a meditation. Cache assets successfully before claiming offline readiness.

Prepare audio before starting a session, and unlock/resume playback from the user's Start or preview gesture. Failed loading/playback must be visible rather than silently running a session without a gong.

Request a screen wake lock during warm-up and meditation; release it afterwards and reacquire when returning to the foreground if appropriate. An installed PWA still cannot guarantee an on-time gong after the OS suspends it or the phone is locked. Service workers do not provide a reliable alarm clock. V1 therefore targets foreground sessions with the screen kept awake when supported. If locked-screen reliability is required, resolve that before committing to this delivery model.

On return from suspension, reconcile the deadlines and avoid stale opening/closing gongs in a burst; show that the session was interrupted if timely playback was lost. Reload restores preferences, not an automatically resumed meditation.

Build and test within WSL. Deploy only the generated static output through GitHub Actions, with asset paths, manifest and worker scope correct for /meditation-timer/. Keep secrets out of the public build.

## Implementation sequence

1. **Build and test in Brave.** Foreground operation with screen wake lock is accepted for v1. Develop and exercise complete sessions in Brave throughout implementation. Phone-specific installation, backgrounding and lock-screen checks are deferred; they do not block this implementation.
2. **Build one complete session.** Implement session logic, audio and basic accessible controls. Verify warm-up, skip, cancel, natural completion, manual end and rapid repeated input; use a controllable clock to check delayed callbacks and one-time gongs.
3. **Apply the approved UI.** Build the circular selector and gestures, sound selector/previews, warm-up chip and sparse running states. Add preference persistence, final licensed assets and responsive/accessibility polish.
4. **Add installation and offline use.** Manifest, icons and versioned caching; verify cold offline launch after caching, audio availability and safe updates.
5. **Ship and check the hosted app.** Type-check, test core flows, build and deploy to Pages. Verify project-path assets, installation, a real full-length session and mobile behaviour against the mockups.

Each step should leave a usable increment. Keep automated tests focused on session timing and critical browser flows; real-device checks are necessary for audio, installation and screen locking.

## References

- [Approved setup mockup](reference/01-setup.png) — omit waveform in implementation.
- [Approved warm-up mockup](reference/02-warm-up.png).
- [Approved active-session mockup](reference/03-active-session.png).
- [MDN: installable PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [MDN: background timer throttling](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)
- [MDN: service worker background lifetime](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [MDN: Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)
- [Vite: GitHub Pages deployment](https://vite.dev/guide/static-deploy#github-pages)

