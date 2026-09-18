# Meditation timer

An installable meditation timer for quiet, foreground sessions. Choose a
duration, a warm-up, and a singing bowl or cymbal; the selected sound opens and
closes the meditation. Preferences stay in the browser on this device.

The app is a small Vite build using plain HTML, CSS, and TypeScript. It keeps
the session on one page and asks for a screen wake lock while warm-up or
meditation is active when the browser supports it. Keep the page visible: a
browser or operating system may suspend background pages, so a PWA cannot be
used as a guaranteed locked-screen alarm.

## Develop in WSL

The repository is set up at `/home/codex/meditation-timer`. The WSL Node.js
runtime is installed at `~/.local/node/bin`; use it explicitly in a shell where
that directory is not already on `PATH`:

```sh
cd ~/meditation-timer
export PATH="$HOME/.local/node/bin:$PATH"
npm install
npm run dev
```

Open the Vite URL in Brave. The development server binds to `0.0.0.0`, which
makes it reachable from Windows through `http://localhost:5173`.

Run the focused timing tests and production build with:

```sh
npm test
npm run build
npm run preview
```

The build writes the deployable static site to `dist/`. The service worker is
generated as part of the build and should be checked with the production
preview, because the Vite development server does not provide the deployed
service-worker behaviour.

## GitHub Pages

Every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
The workflow installs the locked dependencies, builds `dist/`, uploads it as a
Pages artifact, and deploys it with the official GitHub Pages actions. It also
supports a manual run from the Actions tab. The site is expected at
`https://carlbalmer.github.io/meditation-timer/` after Pages has been enabled
for the repository.

Before the first release, verify that a fresh production preview can load the
manifest, icons, service worker, and every bundled sound. Then test a short
warm-up and meditation in Brave, including preview playback, skip, cancel,
manual end, natural completion, refresh, and offline reload after the service
worker has cached the app. Keep the tab visible during timing tests.

## Sound credits

The bundled recordings are by [Cpt_Asteroid](https://freesound.org/people/Cpt_Asteroid/)
on Freesound and are released under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
Individual recording links and the noncommercial restriction are documented in
[`resources/LICENSE.txt`](resources/LICENSE.txt) and the in-app “About & sounds”
dialog. The recordings may be shared or remixed with attribution, but they are
not licensed for commercial use.
