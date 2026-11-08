# Audio credits

The bowls are played from `src/audio/<file>.mp3` (shortened to at most 45 s, −6 dB, over an inaudible
low-frequency bed; see `tools/audio/README.md`). Rebuild with `tools/audio/build.sh`. Sounds from Freesound were taken as the public HQ preview
(128 kbps MP3), since the original files need a Freesound login — a quality limit, not a licence one.

## Bowls

| file | title | author | source | licence | processing |
| --- | --- | --- | --- | --- | --- |
| `bowls/himalayan` | Sound-Bowl-foot-left--B2.wav | Cpt_Asteroid | https://freesound.org/s/138666/ | **[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)** (non-commercial) | leading silence trimmed (strike at ~4 ms), 48 kHz mono, 20 Hz highpass, 1.5 s end fade, loudness-matched (max momentary −11.3 LUFS), peak ≤ −1.3 dBFS |
| `bowls/resonant` | Sound-Bowl-belly--A2.wav | Cpt_Asteroid | https://freesound.org/s/138667/ | **CC BY-NC 4.0** | as above |
| `bowls/bright` | Sound-Bowl-head-top--A3.wav | Cpt_Asteroid | https://freesound.org/s/138670/ | **CC BY-NC 4.0** | as above |
| `bowls/deep` | Sound-Bowl-heart--C#2.wav | Cpt_Asteroid | https://freesound.org/s/138675/ | **CC BY-NC 4.0** | as above, 2 s end fade |
| `bowls/tingsha` | Zimbel--D#5.wav | Cpt_Asteroid | https://freesound.org/s/138676/ | **CC BY-NC 4.0** | as above, 1 s end fade |
| `bowls/warm` ★ | TIBETAN BOWL - 4 | SamuelGremaud | https://freesound.org/s/518702/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | first 32 s, trimmed/normalised as above, 3 s end fade; gain −0.4 dB (source is already near full scale, so it ends ~1 dB quieter than the others) |
| `bowls/soft` ★ | Singing bowl (hit) (soft mallet, Zoom H6) | Sanc000 | https://freesound.org/s/749364/ | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | first 30 s (noise floor after that), trimmed/normalised as above, 4 s end fade |

★ = CC0, safe for commercial use. The other five bowls are **NonCommercial**: do not ship them in a
commercial release; use `warm`/`soft` (or other CC0 sounds) instead. Attribution is required for the
CC BY-NC files (author + link above + licence). The CC0 files need no attribution; they are listed for transparency.

Raw downloads (kept outside the repo): `~/assets-work/sounds/raw/freesound-<id>/{page.html,preview-hq.mp3}`.
