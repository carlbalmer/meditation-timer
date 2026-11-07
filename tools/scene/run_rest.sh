#!/bin/bash
# After the waterfall loop: promote gorge_next.blend (polished build), render the bridge loop set.
set -u; umask 000
S=/mnt/host/scene; R=$S/renders
until grep -q "== done" $R/waterfall_job.log; do sleep 20; done
until [ -f $S/gorge_next.ready ]; do sleep 20; done
mv $S/gorge_next.blend $S/gorge.blend; rm -f $S/gorge_next.ready
ZMAX=250 bash $S/scripts/run_loop.sh bridge CamBridge 384 50 64 192 > $R/bridge_job.log 2>&1
