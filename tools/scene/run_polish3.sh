#!/bin/bash
# Take over from run_polish.sh after its bridge stage: bridge plate pass 2, waterfall loop, turn clips.
set -u; umask 000
S=/mnt/host/scene; R=$S/renders
until grep -q "== done" $R/bridge_polish.log 2>/dev/null; do sleep 2; done
tmux kill-session -t polish; pkill -f "render_still.py -- CamWaterfall"; sleep 3
cp -r $R/bridge_comp $R/bridge_comp_v2; cp $R/bridge_plate.png $R/bridge_plate_v2.png; cp $R/bridge_depth.png $R/bridge_depth_v2.png
echo "v2 saved" > $R/bridge_v2.ready
mv $S/gorge_next.blend $S/gorge.blend
rm -rf $R/bridge_plate.* $R/bridge_mask.png $R/bridge_comp
ZMAX=250 bash $S/scripts/run_loop2.sh bridge CamBridge 384 50 64 192 > $R/bridge_polish2.log 2>&1
rm -rf $R/waterfall_plate.* $R/waterfall_mask.png $R/waterfall_frames $R/waterfall_comp
ZMAX=30 bash $S/scripts/run_loop2.sh waterfall CamWaterfall 384 50 64 192 > $R/waterfall_polish.log 2>&1
cd $S
for p in "CamWaterfall CamBridge waterfall bridge" "CamBridge CamWaterfall bridge waterfall"; do set -- $p
  echo "== turn $3 $4 $(date)" >> $R/turn_job.log
  blender -b gorge.blend -P scripts/render_turn.py -- $1 $2 $R/turn_$3_$4 60 50 64 2>&1 | grep -E "TURN_TIME|Error" >> $R/turn_job.log
  blender -b -P scripts/post.py -- turnfade $R/turn_$3_$4 $R/$3_plate.png $R/$4_plate.png $R/turn_$3_$4_comp 6 2>&1 | grep -E "turnfade|Error" >> $R/turn_job.log
done
echo "== all done $(date)" >> $R/turn_job.log
