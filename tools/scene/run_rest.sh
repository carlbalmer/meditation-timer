#!/bin/bash
# After the waterfall loop: promote gorge_next.blend, render bridge loop, then both turn clips.
set -u; umask 000
S=/mnt/host/scene; R=$S/renders
until grep -q "== done" $R/waterfall_job.log; do sleep 20; done
[ -f $S/gorge_next.blend ] && mv $S/gorge_next.blend $S/gorge.blend
ZMAX=250 bash $S/scripts/run_loop.sh bridge CamBridge 384 50 64 192 > $R/bridge_job.log 2>&1
cd $S
for p in "CamWaterfall CamBridge waterfall bridge" "CamBridge CamWaterfall bridge waterfall"; do set -- $p
  echo "== turn $3 $4 $(date)" >> $R/turn_job.log
  blender -b gorge.blend -P scripts/render_turn.py -- $1 $2 $R/turn_$3_$4 60 50 64 2>&1 | grep -E "TURN_TIME|Error" >> $R/turn_job.log
  blender -b -P scripts/post.py -- turnfade $R/turn_$3_$4 $R/$3_plate.png $R/$4_plate.png $R/turn_$3_$4_comp 6 2>&1 | grep -E "turnfade|Error" >> $R/turn_job.log
done
echo "== all done $(date)" >> $R/turn_job.log
