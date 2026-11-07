#!/usr/bin/env bash
# Rebuild public/audio/{water,bowls} from the raw downloads (run fetch.sh first) and resources/*.wav.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
"$HERE/build-water.sh"
"$HERE/build-bowls.sh"
echo; "$HERE/verify.sh"
