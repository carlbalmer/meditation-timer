#!/bin/bash
# Usage: run-variant.sh <query> <seconds-screen-off>
# Opens the test page in Vanadium, starts it, turns the screen off under simulated
# battery + forced Doze, waits, then wakes the phone and restores charging state.
set -u
Q=$1; OFF=${2:-420}
adb shell input keyevent 224; sleep 1; adb shell input swipe 540 2000 540 600 200; sleep 1
adb shell "am start -a android.intent.action.VIEW -d 'http://localhost:5180/?$Q' -p app.vanadium.browser" >/dev/null
sleep 5; adb shell input tap 540 1200; sleep 3
adb exec-out screencap -p > "started-${Q//[&=]/_}.png"
adb shell dumpsys battery unplug
adb shell input keyevent 223   # sleep (screen off)
sleep 5; adb shell dumpsys deviceidle force-idle
sleep "$OFF"
adb shell dumpsys media_session > "media-${Q//[&=]/_}.txt"; adb shell dumpsys deviceidle unforce; adb shell dumpsys battery reset
adb shell input keyevent 224; sleep 1; adb shell input swipe 540 2000 540 600 200; sleep 4
echo done "$Q"
