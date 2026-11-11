# Audio credits

The gongs are built from the original WAVs in `resources/` by `tools/audio/build.sh` into
`src/audio/<file>.mp3` (details in `tools/audio/README.md`).

## Bowls

| file | title | author | source | licence | processing |
| --- | --- | --- | --- | --- | --- |
| `src/audio/himalayan.mp3` | Sound-Bowl-foot-left--B2.wav | Cpt_Asteroid | https://freesound.org/s/138666/ | **[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)** (non-commercial) | leading silence trimmed, 48 kHz mono, 20 Hz highpass, 1.5 s end fade, loudness-matched (max momentary −11.3 LUFS, peak ≤ −1.3 dBFS), then −6 dB, mixed over a −60 dBFS noise bed below 60 Hz, 64 kb/s mono MP3; cut to 45 s with a 6 s fade (46.6 s original) |
| `src/audio/resonant.mp3` | Sound-Bowl-belly--A2.wav | Cpt_Asteroid | https://freesound.org/s/138667/ | **CC BY-NC 4.0** | as above, no cut |
| `src/audio/bright.mp3` | Sound-Bowl-head-top--A3.wav | Cpt_Asteroid | https://freesound.org/s/138670/ | **CC BY-NC 4.0** | as above, no cut |
| `src/audio/deep.mp3` | Sound-Bowl-heart--C#2.wav | Cpt_Asteroid | https://freesound.org/s/138675/ | **CC BY-NC 4.0** | as above, 2 s end fade; cut to 45 s with a 6 s fade (72.0 s original) |
| `src/audio/tingsha.mp3` | Zimbel--D#5.wav | Cpt_Asteroid | https://freesound.org/s/138676/ | **CC BY-NC 4.0** | as above, 1 s end fade, no cut |

All five bowls are **NonCommercial**: do not ship them in a commercial release. CC BY-NC 4.0 requires
crediting the author, linking the sound and the licence, and saying that it was modified; the app's
"Sound credits" (`index.html`) does that.
