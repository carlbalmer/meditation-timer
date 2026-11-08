#!/bin/bash
# usage: PKG=<browser package> tools/qa/run-session.sh NAME END_SECONDS [WAKE_AT_SECONDS...]   (app page already open, settings chosen)
# taps Start, screen off + unplug + forced deep idle, wakes at the given seconds after the tap
# (screenshot + phone time), records the phone mic throughout (tools/mic-recorder must be installed),
# then lists the gong strikes it heard. BOWL=<id> if not himalayan; EXPECT=15,195 checks those times.
set -u
N=$1; END=$2; shift 2
D=${OUT:-/tmp/mt-qa}; mkdir -p $D; F=/sdcard/Android/data/dev.mt.rec/files
START_X=${START_X:-540}; START_Y=${START_Y:-1819}
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard; sleep 1
adb shell "am start -n dev.mt.rec/.Main --es cmd start --es name $N" >/dev/null; sleep 2
TAP=$(adb shell 'date +%s.%N; input tap '"$START_X $START_Y" | head -1)
echo "tap $TAP" > $D/$N.events
T0=$(date +%s.%N)
sleep 3; adb exec-out screencap -p > $D/$N-start.png
off() { adb shell dumpsys battery unplug; adb shell input keyevent KEYCODE_SLEEP; sleep 3; adb shell dumpsys deviceidle force-idle >/dev/null; }
off
for W in "$@"; do
  sleep $(awk -v t0=$T0 -v w=$W -v now=$(date +%s.%N) 'BEGIN{d=t0+w-now; print (d>0?d:0)}')
  adb shell dumpsys deviceidle unforce >/dev/null
  PT=$(adb shell 'input keyevent KEYCODE_WAKEUP; wm dismiss-keyguard; sleep 1.5; date +%s.%N; screencap -p /sdcard/mt-wake.png' | tail -1)
  adb pull /sdcard/mt-wake.png $D/$N-wake-$W.png >/dev/null
  echo "wake $W screenshot_at $PT" >> $D/$N.events
  off
done
sleep $(awk -v t0=$T0 -v w=$END -v now=$(date +%s.%N) 'BEGIN{d=t0+w-now; print (d>0?d:0)}')
adb shell dumpsys deviceidle unforce >/dev/null; adb shell dumpsys battery reset
adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard; sleep 2
adb exec-out screencap -p > $D/$N-end.png
adb shell "am start -n dev.mt.rec/.Main --es cmd stop" >/dev/null; sleep 2
adb pull $F/$N.pcm $D/ >/dev/null; adb shell cat $F/$N.log > $D/$N.reclog
# onsets as phone wall time relative to the tap
python3 -I - "$D/$N.reclog" "$TAP" <<'PY' > $D/$N.onsets.wall  # tap offset into the recording
import sys
log, tap = sys.argv[1], float(sys.argv[2])
pts = [(int(l.split()[1]) / 1000, int(l.split()[3])) for l in open(log) if l.startswith('t ')]
(t0, s0), (t1, s1) = pts[0], pts[-2] if len(pts) > 2 else pts[-1]
print(f"{tap - t0 + s0 / 16000:.3f}")
print(f"recorder: {(t1 - t0):.2f} s wall time for {(s1 - s0) / 16000:.2f} s of audio", file=sys.stderr)
PY
BOWL=${BOWL:-himalayan}; ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ONSET=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))['gongs'][sys.argv[2]]['onset'])" "$ROOT/src/sounds.json" "$BOWL")
echo "gong strikes heard by the phone mic, in seconds after the Start tap:"
${PYTHON:-$HOME/opt/evalenv/bin/python} -I "$(dirname "$0")/gongs.py" $D/$N.pcm "$ROOT/public/audio/session/$BOWL.mp3" "$ONSET" "$(cat $D/$N.onsets.wall)" "${EXPECT:-}" | tee $D/$N.gongs
cat $D/$N.events
