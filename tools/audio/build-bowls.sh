#!/usr/bin/env bash
# Build public/audio/bowls/*.webm|m4a from resources/*.wav (+ optional CC0 Freesound previews).
# Usage: tools/audio/build-bowls.sh            (env: RAW=~/assets-work/sounds/raw OUT=public/audio)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
RAW=${RAW:-$HOME/assets-work/sounds/raw}
OUT=${OUT:-$ROOT/public/audio}
. "$HERE/lib.sh"

# sample-peak ceiling before encoding; -1.3 dBFS keeps the *decoded* Opus/AAC true peak <= -1 dBTP
CEIL=${CEIL:--1.3}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT/bowls"

# id | source file | seconds to keep after onset (0 = all) | end fade seconds | group
# group "main" bowls define the common loudness target; "alt" (CC0 previews) are matched to it.
BOWLS=(
  "himalayan|$ROOT/resources/138666__cpt_asteroid__sound-bowl-foot-left-b2.wav|0|1.5|main"
  "resonant|$ROOT/resources/138667__cpt_asteroid__sound-bowl-belly-a2.wav|0|1.5|main"
  "bright|$ROOT/resources/138670__cpt_asteroid__sound-bowl-head-top-a3.wav|0|1.5|main"
  "deep|$ROOT/resources/138675__cpt_asteroid__sound-bowl-heart-c2.wav|0|2.0|main"
  "tingsha|$ROOT/resources/138676__cpt_asteroid__zimbel-d5.wav|0|1.0|main"
  "warm|$RAW/freesound-518702/preview-hq.mp3|32|3.0|alt"
  "soft|$RAW/freesound-749364/preview-hq.mp3|30|4.0|alt"
)

# 1. trim leading silence (keep 4 ms before the strike), 48 kHz mono, remove DC, cut/fade the tail.
for row in "${BOWLS[@]}"; do
  IFS='|' read -r id src keep fade group <<<"$row"
  [ -f "$src" ] || { echo "skip $id (missing $src)"; continue; }
  # silenceremove leaves the strike at t≈0-4 ms; a 2 ms fade-in avoids a click if the cut lands mid-wave
  "$FFMPEG" -v error -y -i "$src" -ac 1 -af "aresample=48000,highpass=f=20,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.004,afade=t=in:d=0.002" "$TMP/$id.trim.wav"
  if [ "$keep" != 0 ]; then
    "$FFMPEG" -v error -y -i "$TMP/$id.trim.wav" -af "atrim=end=$keep,asetpts=N/SR/TB" "$TMP/$id.cut.wav"
  else
    cp "$TMP/$id.trim.wav" "$TMP/$id.cut.wav"
  fi
  dur=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$TMP/$id.cut.wav")
  st=$(awk -v d="$dur" -v f="$fade" 'BEGIN{printf "%.4f", d-f}')
  "$FFMPEG" -v error -y -i "$TMP/$id.cut.wav" -af "afade=t=out:st=$st:d=$fade:curve=qsin" "$TMP/$id.pre.wav"
done

# 2. loudness: gain so max momentary loudness (400 ms) is equal across bowls, peak <= $CEIL dBFS.
# target = the highest loudness every "main" bowl can reach with its peak at the ceiling.
declare -A M PK
target=""
for row in "${BOWLS[@]}"; do
  IFS='|' read -r id src keep fade group <<<"$row"
  [ -f "$TMP/$id.pre.wav" ] || continue
  M[$id]=$(max_momentary "$TMP/$id.pre.wav")
  PK[$id]=$("$FFMPEG" -nostats -hide_banner -i "$TMP/$id.pre.wav" -af ebur128=peak=sample -f null - 2>&1 | awk '/Sample peak:/{s=1} s&&/Peak:/{print $2; exit}')
  if [ "$group" = main ]; then
    cap=$(awk -v ceil="$CEIL" -v m="${M[$id]}" -v p="${PK[$id]}" 'BEGIN{printf "%.2f", m + (ceil - p)}')
    if [ -z "$target" ] || awk -v c="$cap" -v t="$target" 'BEGIN{exit !(c<t)}'; then target=$cap; fi
  fi
done
echo "common max-momentary loudness target: $target LUFS"

for row in "${BOWLS[@]}"; do
  IFS='|' read -r id src keep fade group <<<"$row"
  [ -f "$TMP/$id.pre.wav" ] || continue
  gain=$(awk -v ceil="$CEIL" -v t="$target" -v m="${M[$id]}" -v p="${PK[$id]}" 'BEGIN{g=t-m; if (p+g > ceil) g=ceil-p; printf "%.2f", g}')
  "$FFMPEG" -v error -y -i "$TMP/$id.pre.wav" -af "volume=${gain}dB" -c:a pcm_s16le "$TMP/$id.final.wav"
  enc "$TMP/$id.final.wav" "$OUT/bowls/$id" 64 96
  echo "bowl $id: gain ${gain} dB (maxM ${M[$id]} -> $(max_momentary "$TMP/$id.final.wav") LUFS)"
done
