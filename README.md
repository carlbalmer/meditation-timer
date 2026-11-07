# Meditation

A meditation timer that puts you in a place: a rendered mountain gorge, live mist and light,
and almost nothing else on screen. Pick a duration, press Start, and everything fades away
but the countdown. Gongs are scheduled on the Web Audio clock, so a session keeps time with
the screen off.

Live at <https://carlbalmer.github.io/meditation-timer/> (every push to `main` deploys).

## Use
- **Duration**: swipe the number up/down, or tap 8 · 12 · 20. Arrow keys work too.
- **Warm-up** (ring): tap to cycle off / 15 / 30 / 45 / 60 s.
- **Water**: toggle the ambience. **Bowl**: tap to hear the next bowl.
- **Scene**: swipe sideways to turn the camera around.
- **Running**: tap anywhere for Skip / Cancel (warm-up) or End.

## Develop
```sh
npm install
npm run dev      # http://localhost:5173/meditation-timer/
npm test         # session + scheduling logic (node --test)
npm run build    # typecheck, build to dist/, generate the service worker
npm run preview  # serve dist/ to check the service worker and offline use
```
On a phone over USB: `adb reverse tcp:5173 tcp:5173`, then open the dev URL (localhost is a
secure context, so audio, sensors and service workers behave as in production).

Design, asset contract and module overview: [docs/OVERHAUL.md](docs/OVERHAUL.md).
Rendered scenes come from `tools/scene/`, sounds from `tools/audio/`; credits are in
[public/audio/CREDITS.md](public/audio/CREDITS.md) and in the app's info sheet.

## Licences
Five bowl recordings by Cpt_Asteroid are CC BY-NC 4.0 (non-commercial); the rest of the audio
is CC0. Cormorant Garamond is under the SIL Open Font License ([src/fonts/OFL.txt](src/fonts/OFL.txt)).
