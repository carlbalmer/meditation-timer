#!/bin/bash
# Resume after the VM loss: waterfall water frames 138-192, composite, then turn clips.
set -u; umask 000
S=/mnt/host/scene; R=$S/renders; B="blender -b $S/gorge.blend"
cd $S
echo "== anim resume $(date)" >> $R/waterfall_polish.log
$B -P scripts/render_anim.py -- CamWaterfall $R/waterfall_frames 138 192 50 64 2>&1 | grep -E "ANIM_TIME|Error" >> $R/waterfall_polish.log
echo "== comp $(date)" >> $R/waterfall_polish.log
blender -b -P scripts/post.py -- comp $R/waterfall_plate.png $R/waterfall_mask.png $R/waterfall_frames $R/waterfall_comp 2>&1 | grep -E "composited|Error" >> $R/waterfall_polish.log
echo "== done $(date)" >> $R/waterfall_polish.log
for p in "CamWaterfall CamBridge waterfall bridge" "CamBridge CamWaterfall bridge waterfall"; do set -- $p
  echo "== turn $3 $4 $(date)" >> $R/turn_job.log
  blender -b gorge.blend -P scripts/render_turn.py -- $1 $2 $R/turn_$3_$4 60 50 64 2>&1 | grep -E "TURN_TIME|Error" >> $R/turn_job.log
  blender -b -P scripts/post.py -- turnfade $R/turn_$3_$4 $R/$3_plate.png $R/$4_plate.png $R/turn_$3_$4_comp 6 2>&1 | grep -E "turnfade|Error" >> $R/turn_job.log
done
echo "== all done $(date)" >> $R/turn_job.log
