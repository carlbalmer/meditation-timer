#!/usr/bin/env bash
# Download the raw sources used by build.sh into $RAW/freesound-<id>/ (one new directory per sound).
# Freesound's original files need an API login, so the public HQ previews (128 kbps MP3) are used
# for this prototype. The licence on each sound page is checked to be CC0 before the audio is fetched.
# Downloads are treated as untrusted data: they are only ever read by ffmpeg, never executed.
# Usage: tools/audio/fetch.sh [freesound-id ...]   (default: the sounds used by the build)
set -euo pipefail
RAW=${RAW:-$HOME/assets-work/sounds/raw}
IDS=("$@")
[ ${#IDS[@]} -gt 0 ] || IDS=(352846 690325 518702 749364)   # waterfall, bridge, bowl "warm", bowl "soft"
for id in "${IDS[@]}"; do
  d=$RAW/freesound-$id
  [ -e "$d" ] && { echo "skip $id (exists)"; continue; }
  mkdir -p "$d"
  curl -fsSL -m 60 -A "Mozilla/5.0" "https://freesound.org/s/$id/" -o "$d/page.html"
  grep -q 'href="http://creativecommons.org/publicdomain/zero/1.0/"' "$d/page.html" || { echo "ERROR: $id is not CC0 - refusing" >&2; exit 1; }
  url=$(grep -o "https://cdn.freesound.org/previews/[^\"']*-hq\.mp3" "$d/page.html" | head -1)
  curl -fsSL -m 300 -A "Mozilla/5.0" "$url" -o "$d/preview-hq.mp3"
  echo "$id $url $(sha256sum "$d/preview-hq.mp3" | cut -d' ' -f1)"
done
