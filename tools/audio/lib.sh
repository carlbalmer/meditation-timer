# Shared helpers for build.sh (sourced). Requires ffmpeg/ffprobe.
FFMPEG=${FFMPEG:-$(command -v ffmpeg || echo "$HOME/bin/ffmpeg")}
FFPROBE=${FFPROBE:-$(command -v ffprobe || echo "$HOME/bin/ffprobe")}

# max momentary (400 ms) loudness in LUFS of a file
max_momentary() {
  "$FFMPEG" -nostats -hide_banner -v info -i "$1" -af ebur128=framelog=info -f null - 2>&1 |
    sed -n 's/^\[Parsed_ebur128.*t: *[0-9.]* .*M: *\(-\?[0-9.]*\) S:.*/\1/p' |
    sort -g | tail -1
}
# integrated loudness (LUFS) and true peak (dBTP): echo "I TP"
loud_stats() {
  "$FFMPEG" -nostats -hide_banner -i "$1" -af ebur128=peak=true -f null - 2>&1 |
    awk '/Summary/{s=1} s&&/^ *I:/{i=$2} s&&/Peak:/{p=$2} END{print i, p}'
}
