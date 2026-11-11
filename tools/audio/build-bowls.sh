#!/usr/bin/env bash
# Build the session audio (src/audio/*.mp3 + src/sounds.json) from resources/*.wav.
# Usage: tools/audio/build-bowls.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
. "$HERE/lib.sh"

# sample-peak ceiling before encoding; -1.3 dBFS keeps the *decoded* Opus/AAC true peak <= -1 dBTP
CEIL=${CEIL:--1.3}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# id | source file | seconds to keep after onset (0 = all) | end fade seconds
BOWLS=(
  "himalayan|$ROOT/resources/138666__cpt_asteroid__sound-bowl-foot-left-b2.wav|0|1.5"
  "resonant|$ROOT/resources/138667__cpt_asteroid__sound-bowl-belly-a2.wav|0|1.5"
  "bright|$ROOT/resources/138670__cpt_asteroid__sound-bowl-head-top-a3.wav|0|1.5"
  "deep|$ROOT/resources/138675__cpt_asteroid__sound-bowl-heart-c2.wav|0|2.0"
  "tingsha|$ROOT/resources/138676__cpt_asteroid__zimbel-d5.wav|0|1.0"
)

# 1. trim leading silence (keep 4 ms before the strike), 48 kHz mono, remove DC, cut/fade the tail.
for row in "${BOWLS[@]}"; do
  IFS='|' read -r id src keep fade <<<"$row"
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
# target = the highest loudness every bowl can reach with its peak at the ceiling.
declare -A M PK
target=""
for row in "${BOWLS[@]}"; do
  IFS='|' read -r id src keep fade <<<"$row"
  [ -f "$TMP/$id.pre.wav" ] || continue
  M[$id]=$(max_momentary "$TMP/$id.pre.wav")
  PK[$id]=$("$FFMPEG" -nostats -hide_banner -i "$TMP/$id.pre.wav" -af ebur128=peak=sample -f null - 2>&1 | awk '/Sample peak:/{s=1} s&&/Peak:/{print $2; exit}')
  cap=$(awk -v ceil="$CEIL" -v m="${M[$id]}" -v p="${PK[$id]}" 'BEGIN{printf "%.2f", m + (ceil - p)}')
  if [ -z "$target" ] || awk -v c="$cap" -v t="$target" 'BEGIN{exit !(c<t)}'; then target=$cap; fi
done
echo "common max-momentary loudness target: $target LUFS"

for row in "${BOWLS[@]}"; do
  IFS='|' read -r id src keep fade <<<"$row"
  [ -f "$TMP/$id.pre.wav" ] || continue
  gain=$(awk -v ceil="$CEIL" -v t="$target" -v m="${M[$id]}" -v p="${PK[$id]}" 'BEGIN{g=t-m; if (p+g > ceil) g=ceil-p; printf "%.2f", g}')
  "$FFMPEG" -v error -y -i "$TMP/$id.pre.wav" -af "volume=${gain}dB" -c:a pcm_s16le "$TMP/$id.final.wav"
  echo "bowl $id: gain ${gain} dB (maxM ${M[$id]} -> $(max_momentary "$TMP/$id.final.wav") LUFS)"
done

# 3. session pieces: the app builds each session's track by concatenating MP3 frames (see src/track.ts),
#    so every piece is a bare frame stream (no ID3, no Xing/LAME header, no bit reservoir) with
#    identical frames: MPEG-1 Layer III, 48 kHz mono, 64 kb/s CBR = 192 bytes per 24 ms frame.
#    Everything carries the keep-alive bed: brown noise below 60 Hz at about -60 dBFS RMS, above
#    Chromium's ~-72 dBFS audibility threshold so the browser keeps playing with the screen off
#    (pure digital silence was paused about 140 s after the screen went off; docs/project_log).
SESSION="$ROOT/src/audio"; mkdir -p "$SESSION"
GONG_GAIN=${GONG_GAIN:--6}   # dB under the loudness-matched bowls
MAX_GONG=${MAX_GONG:-45}     # s; a gong block must fit into the shortest meditation (1 min)
TAIL_FADE=6                  # s; fade used when a bowl is cut to MAX_GONG
BED_SECONDS=12
mp3() { "$FFMPEG" -v error -y -i "$1" -c:a libmp3lame -b:a 64k -reservoir 0 -ar 48000 -ac 1 -write_xing 0 -id3v2_version 0 -f mp3 "$2"; }
check_frames() { # every 192-byte frame starts with the same header
  python3 -I - "$1" <<'PY'
import sys
b = open(sys.argv[1], 'rb').read()
assert len(b) % 192 == 0, f"{sys.argv[1]}: {len(b)} bytes is not a whole number of 192-byte frames"
heads = {b[i:i+3] for i in range(0, len(b), 192)}
assert len(heads) == 1 and next(iter(heads))[:2] in (b'\xff\xfb', b'\xff\xfa'), f"{sys.argv[1]}: frame headers {heads}"
print(len(b) // 192)
PY
}
bed() { # bed <seconds> <out.wav>: seeded brown noise, 20-60 Hz, normalised to -60 dBFS RMS
  "$FFMPEG" -v error -y -f lavfi -i "anoisesrc=color=brown:r=48000:d=$1:a=1:seed=7,lowpass=f=60,lowpass=f=60,highpass=f=20" -ac 1 -c:a pcm_s16le "$TMP/bedraw.wav"
  local rms; rms=$("$FFMPEG" -hide_banner -i "$TMP/bedraw.wav" -af astats -f null - 2>&1 | awk -F': ' '/RMS level dB/{print $2; exit}')
  "$FFMPEG" -v error -y -i "$TMP/bedraw.wav" -af "volume=$(awk -v r="$rms" 'BEGIN{printf "%.2f", -60 - r}')dB" -c:a pcm_s16le "$2"
}
onset() { # seconds to the first decoded sample above -26 dBFS (the strike; the bed is ~-60 dBFS)
  "$FFMPEG" -v error -i "$1" -f s16le -ac 1 -ar 48000 - | python3 -I -c '
import sys, array
a = array.array("h"); a.frombytes(sys.stdin.buffer.read())
print(f"{next(i for i, x in enumerate(a) if abs(x) > 1640) / 48000:.4f}")'
}

bed "$BED_SECONDS" "$TMP/bed.wav"; mp3 "$TMP/bed.wav" "$SESSION/bed.mp3"
manifest="{\"frameBytes\":192,\"frameSeconds\":0.024,\"bed\":{\"frames\":$(check_frames "$SESSION/bed.mp3")},\"gongs\":{"
sep=""
for row in "${BOWLS[@]}"; do
  IFS='|' read -r id src keep fade <<<"$row"
  [ -f "$TMP/$id.final.wav" ] || continue
  dur=$("$FFPROBE" -v error -show_entries format=duration -of csv=p=0 "$TMP/$id.final.wav")
  len=$(awk -v d="$dur" -v m="$MAX_GONG" 'BEGIN{printf "%.3f", d < m ? d : m}')
  cut="atrim=end=$len"
  awk -v d="$dur" -v m="$MAX_GONG" 'BEGIN{exit !(d > m)}' && cut="$cut,afade=t=out:st=$((MAX_GONG - TAIL_FADE)):d=$TAIL_FADE:curve=qsin"
  bed "$len" "$TMP/bed-$id.wav"
  "$FFMPEG" -v error -y -i "$TMP/$id.final.wav" -i "$TMP/bed-$id.wav" -filter_complex "[0:a]$cut,volume=${GONG_GAIN}dB[g];[g][1:a]amix=inputs=2:normalize=0:duration=longest" -c:a pcm_s16le "$TMP/$id.block.wav"
  mp3 "$TMP/$id.block.wav" "$SESSION/$id.mp3"
  frames=$(check_frames "$SESSION/$id.mp3"); at=$(onset "$SESSION/$id.mp3")
  manifest="$manifest$sep\"$id\":{\"frames\":$frames,\"onset\":$at}"; sep=","
  echo "session/$id.mp3: $frames frames ($(awk -v f="$frames" 'BEGIN{printf "%.2f", f*0.024}') s), strike at $at s"
done
echo "$manifest}}" | python3 -I -c 'import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))' > "$ROOT/src/sounds.json"
echo "wrote src/sounds.json"
