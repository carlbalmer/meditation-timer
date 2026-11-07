#!/bin/bash
# Render plate + water loop for one view inside the VM.
#   run_loop.sh <id> <Camera> [plate_spp] [anim_pct] [anim_spp] [frames]
set -eu
umask 000
ID=$1; CAM=$2; PSPP=${3:-384}; APCT=${4:-50}; ASPP=${5:-64}; N=${6:-192}
S=/mnt/host/scene; R=$S/renders; B="blender -b $S/gorge.blend"
cd $S
echo "== plate $(date)"
[ -f $R/${ID}_plate.png ] || $B -P scripts/render_still.py -- $CAM $R/${ID}_plate 100 $PSPP 1 2>&1 | grep -E "RENDER_TIME|Error"
ELL=$(python3 -c "import json;b=json.load(open('$R/${ID}_plate.json'))['mist_box'];print((b[0]+b[2])/2,(b[1]+b[3])/2,(b[2]-b[0])/2,(b[3]-b[1])/2)" 2>/dev/null || echo "")
[ "$ID" = waterfall ] || ELL=""
blender -b -P scripts/post.py -- mask $R/${ID}_plate.exr $R/${ID}_mask.png $ELL 2>&1 | grep -E "mask|Error"
$B -P scripts/render_depth.py -- $CAM $R/${ID}_zpass 2>&1 | grep -E "DEPTH_DONE|Error"
blender -b -P scripts/post.py -- depth $R/${ID}_zpass.exr $R/${ID}_depth.png 540 ${ZMAX:-40} 2>&1 | grep -E "depth|Error"
echo "== anim $(date)"
if [ "$(ls $R/${ID}_frames 2>/dev/null | wc -l)" -ge "$N" ]; then echo "reusing existing water frames"; else
$B -P scripts/render_anim.py -- $CAM $R/${ID}_frames 1 $N $APCT $ASPP 2>&1 | grep -E "ANIM_TIME|Error|Fra:.*Finished" | tail -3; fi
echo "== comp $(date)"
blender -b -P scripts/post.py -- comp $R/${ID}_plate.png $R/${ID}_mask.png $R/${ID}_frames $R/${ID}_comp 2>&1 | grep -E "composited|Error"
echo "== done $(date)"
