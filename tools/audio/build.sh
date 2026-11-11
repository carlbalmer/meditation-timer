#!/usr/bin/env bash
# Rebuild src/audio/ and src/sounds.json from resources/*.wav.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
"$HERE/build-bowls.sh"
echo; "$HERE/verify.sh"
