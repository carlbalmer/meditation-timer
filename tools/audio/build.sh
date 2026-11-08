#!/usr/bin/env bash
# Rebuild public/audio/session/ and src/sounds.json from resources/*.wav and the CC0 previews (run fetch.sh first).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
"$HERE/build-bowls.sh"
echo; "$HERE/verify.sh"
