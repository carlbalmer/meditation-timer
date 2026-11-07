#!/bin/bash
# Polish pass: bridge plate re-render (water frames reused), full waterfall loop, then turn clips.
set -u; umask 000
S=/mnt/host/scene; R=$S/renders
until grep -q "== done" $R/bridge_job.log 2>/dev/null; do sleep 20; done
mv $S/gorge_next.blend $S/gorge.blend
mkdir -p $R/old && mv $R/bridge_plate.* $R/bridge_mask.png $R/bridge_comp $R/old/ 2>/dev/null
ZMAX=250 bash $S/scripts/run_loop2.sh bridge CamBridge 384 50 64 192 > $R/bridge_polish.log 2>&1
mkdir -p $R/old_wf && mv $R/waterfall_plate.* $R/waterfall_mask.png $R/waterfall_frames $R/waterfall_comp $R/old_wf/ 2>/dev/null
ZMAX=30 bash $S/scripts/run_loop2.sh waterfall CamWaterfall 384 50 64 192 > $R/waterfall_polish.log 2>&1
cd $S
for p in "CamWaterfall CamBridge waterfall bridge" "CamBridge CamWaterfall bridge waterfall"; do set -- $p
  echo "== turn $3 $4 $(date)" >> $R/turn_job.log
  blender -b gorge.blend -P scripts/render_turn.py -- $1 $2 $R/turn_$3_$4 60 50 64 2>&1 | grep -E "TURN_TIME|Error" >> $R/turn_job.log
  blender -b -P scripts/post.py -- turnfade $R/turn_$3_$4 $R/$3_plate.png $R/$4_plate.png $R/turn_$3_$4_comp 6 2>&1 | grep -E "turnfade|Error" >> $R/turn_job.log
done
echo "== all done $(date)" >> $R/turn_job.log
