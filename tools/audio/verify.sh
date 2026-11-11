#!/usr/bin/env bash
# Print duration, size, integrated loudness, LRA, true peak and sample peak (decoded!) for every file under src/audio.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
. "$HERE/lib.sh"
printf '%-24s %9s %8s %8s %6s %8s %6s\n' file bytes dur_s LUFS_I LRA TP_dBTP "max_M"
for f in "$ROOT"/src/audio/*.mp3; do
  [ -f "$f" ] || continue
  d=$("$FFMPEG" -nostats -hide_banner -i "$f" -f null - -progress pipe:1 2>/dev/null | awk -F= '/^out_time=/{t=$2} END{split(t,a,":"); printf "%.2f", a[1]*3600+a[2]*60+a[3]}')
  s=$("$FFMPEG" -nostats -hide_banner -i "$f" -af ebur128=peak=true -f null - 2>&1 | awk '/Summary/{s=1} s&&/^ *I:/{i=$2} s&&/LRA:/{l=$2} s&&/Peak:/{p=$2} END{print i, l, p}')
  m=$(max_momentary "$f")
  printf '%-24s %9d %8.2f %8s %6s %8s %6s\n' "${f#$ROOT/}" "$(stat -c %s "$f")" "$d" $s "$m"
done
