#!/usr/bin/env bash
# Build public/audio/water/<id>.webm|m4a: seamless 48 kHz stereo ambience loops from Freesound HQ previews.
# Usage: tools/audio/build-water.sh   (env: RAW=~/assets-work/sounds/raw OUT=public/audio LUFS=-24 TPMAX=-2)
#
# Loop construction (L = loop length, X = crossfade length): cut a source window of L+X seconds,
# fade its last X seconds OUT while fading its first X seconds IN with an equal-power (quarter-sine)
# crossfade, and put the result in the first X seconds of the loop:
#     loop = acrossfade( src[L, L+X] , src[0, L] , d = X , qsin/qsin )        (length L)
# Wrapping from loop end (= src[L-1]) to loop start (= src[L], the natural continuation) is then
# continuous, and the crossfade region itself is a constant-power blend of two uncorrelated water
# signals, so no level dip/bump is audible.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
RAW=${RAW:-$HOME/assets-work/sounds/raw}
OUT=${OUT:-$ROOT/public/audio}
LUFS=${LUFS:--24}
TPMAX=${TPMAX:--2}
. "$HERE/lib.sh"
mkdir -p "$OUT/water"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# id | Freesound id | start s | loop L s | crossfade X s | pre-filter chain (before windowing; may be empty)
LOOPS=(
  "waterfall|352846|0|90|10|highpass=f=35"
  "bridge|690325|142|90|10|highpass=f=50"
)

for row in "${LOOPS[@]}"; do
  IFS='|' read -r id fs ss L X pre <<<"$row"
  src="$RAW/freesound-$fs/preview-hq.mp3"
  [ -f "$src" ] || { echo "skip $id (missing $src)"; continue; }
  [ -n "$pre" ] && pre="$pre,"
  "$FFMPEG" -v error -y -i "$src" -filter_complex "
    [0:a]aresample=48000,aformat=channel_layouts=stereo,${pre}atrim=start=$ss:end=$(awk -v s="$ss" -v l="$L" -v x="$X" 'BEGIN{print s+l+x}'),asetpts=PTS-STARTPTS,asplit=2[a][b];
    [a]atrim=end=$L,asetpts=PTS-STARTPTS[body];
    [b]atrim=start=$L,asetpts=PTS-STARTPTS[tail];
    [tail][body]acrossfade=d=$X:c1=qsin:c2=qsin[out]" -map "[out]" -c:a pcm_f32le "$TMP/$id.loop.wav"
  read -r I TP < <(loud_stats "$TMP/$id.loop.wav")
  gain=$(awk -v t="$LUFS" -v i="$I" 'BEGIN{printf "%.2f", t-i}')
  limited=no
  if awk -v tp="$TP" -v g="$gain" -v max="$TPMAX" 'BEGIN{exit !(tp+g>max)}'; then
    # Peaky material (splashy brook): limit the brief plops instead of lowering the whole bed.
    # Limit on a 3x tiled copy and keep the middle copy so the limiter state is continuous across the seam.
    limited=yes
    ceil=$(awk -v c="$TPMAX" 'BEGIN{printf "%.2f", c-0.8}')   # sample-peak ceiling in dBFS, 0.8 dB margin for codec overshoot
    for _ in $(seq 8); do
      lim=$(awk -v c="$ceil" 'BEGIN{printf "%.4f", 10^(c/20)}')
      "$FFMPEG" -v error -y -stream_loop 2 -i "$TMP/$id.loop.wav" -af "volume=${gain}dB,alimiter=limit=$lim:attack=5:release=80:level=0,atrim=start=$L:end=$(awk -v l="$L" 'BEGIN{print 2*l}'),asetpts=PTS-STARTPTS" -c:a pcm_f32le "$TMP/$id.final.wav"
      read -r I2 TP2 < <(loud_stats "$TMP/$id.final.wav")
      # converge: lower the ceiling if true peak is over budget, raise the gain if the bed is too quiet
      if awk -v tp="$TP2" -v m="$TPMAX" 'BEGIN{exit !(tp>m-0.3)}'; then ceil=$(awk -v c="$ceil" -v tp="$TP2" -v m="$TPMAX" 'BEGIN{printf "%.2f", c-(tp-(m-0.3))-0.1}'); continue; fi
      awk -v i="$I2" -v t="$LUFS" 'BEGIN{exit !(i < t-0.15)}' || break
      gain=$(awk -v g="$gain" -v i="$I2" -v t="$LUFS" 'BEGIN{printf "%.2f", g+(t-i)}')
    done
    I=$I2; TP=$TP2
  else
    "$FFMPEG" -v error -y -i "$TMP/$id.loop.wav" -af "volume=${gain}dB" -c:a pcm_f32le "$TMP/$id.final.wav"
    read -r I TP < <(loud_stats "$TMP/$id.final.wav")
  fi
  enc "$TMP/$id.final.wav" "$OUT/water/$id" 96 128
  echo "water $id: freesound $fs @${ss}s L=${L}s X=${X}s  gain ${gain} dB limiter=$limited -> I=$I LUFS TP=$TP dBTP (pre-codec)"
done
