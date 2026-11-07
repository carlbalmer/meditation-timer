#!/bin/bash
# Host-side encoding of renders into the app's asset contract.
#   encode.sh loop <id>            -> public/scenes/<id>/{poster.webp,depth.webp,loop.webm,loop.mp4}
#   encode.sh turn <from> <to>     -> public/scenes/turn/<from>-to-<to>.{webm,mp4}
set -eu
FF=${FF:-$HOME/bin/ffmpeg}
R=${R:-$HOME/vms/blender/share/scene/renders}
OUT=${OUT:-$HOME/.t3/projects/meditation-timer/public/scenes}
CRF_AV1=${CRF_AV1:-40}; CRF_264=${CRF_264:-24}
q() { $FF -hide_banner -loglevel error -y "$@"; }
case $1 in
loop)
  ID=$2; D=$OUT/$ID; mkdir -p $D
  q -i $R/${ID}_plate.png -c:v libwebp -quality 84 -compression_level 6 $D/poster.webp
  q -i $R/${ID}_depth.png -vf format=gray -c:v libwebp -quality 90 $D/depth.webp
  q -framerate 24 -i $R/${ID}_comp/f_%04d.png -an -c:v libsvtav1 -preset 5 -crf $CRF_AV1 -g 96 -pix_fmt yuv420p10le -svtav1-params tune=0 $D/loop.webm
  q -framerate 24 -i $R/${ID}_comp/f_%04d.png -an -c:v libx264 -preset slow -crf $CRF_264 -g 48 -pix_fmt yuv420p -movflags +faststart $D/loop.mp4
  ls -la $D ;;
turn)
  F=$2; T=$3; D=$OUT/turn; mkdir -p $D
  q -framerate 24 -i $R/turn_${F}_${T}_comp/f_%04d.png -an -c:v libsvtav1 -preset 5 -crf $CRF_AV1 -g 60 -pix_fmt yuv420p10le $D/${F}-to-${T}.webm
  q -framerate 24 -i $R/turn_${F}_${T}_comp/f_%04d.png -an -c:v libx264 -preset slow -crf $CRF_264 -pix_fmt yuv420p -movflags +faststart $D/${F}-to-${T}.mp4
  ls -la $D ;;
esac
