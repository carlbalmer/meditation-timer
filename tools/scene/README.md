# Gorge scenes (pre-rendered)

Scripts that build and render the two app scenes (`waterfall`, `bridge`) and the camera-turn
clips into `public/scenes/**`. Everything is procedural Blender Python except a few CC0 Poly Haven
textures/models listed in `ASSETS.md`. Big binaries (`.blend`, textures, frames) live outside the
repo in `~/vms/blender/share/scene/` (mounted at `/mnt/host/scene` in the GPU VM).

| Script | Runs where | Purpose |
|---|---|---|
| `fetch_assets.py` | host | download Poly Haven assets to `scene/assets/<id>/`, write `ASSETS.md` |
| `build_scene.py` (+ `nodes.py`) | VM, Blender | build the whole gorge (terrain, gneiss walls, falls, pool, stream, bridge, trees, sky, cameras) → `gorge.blend` |
| `render_still.py` | VM | still (PNG + multilayer EXR with Mist/Depth/Object-Index passes) |
| `render_anim.py` | VM | animated water layer frames (half-res) |
| `render_turn.py` | VM | eased camera turn between the two views |
| `post.py` | VM (Blender python: numpy + OpenImageIO) | water mask, depth map, plate/water compositing, turn fades |
| `render_depth.py` | VM | clean Z pass with volumes hidden (for `depth.webp`) |
| `run_loop.sh` / `run_loop2.sh` | VM | plate → mask → depth → water frames → composite for one view (`run_loop2` reuses existing water frames, so a plate-only fix costs ~5 min) |
| `run_rest.sh`, `run_polish*.sh` | VM | the job chains used for this delivery (queue bridge after waterfall, polish passes, turns) |
| `encode.sh` | host | webp/AV1/H.264 encoding into `public/scenes/` |

## How the loops stay seamless
All water motion is driven by a periodic phase `(frame-1)/192` (node groups `PhaseWF`, `PhaseBR`).
Noise is sampled on circles in an extra dimension (`loop_noise`, `scroll_noise` in `build_scene.py`),
so frame 193 is identical to frame 1 — no crossfade needed. Rocks/camera are static; a high-sample
full-res plate is used everywhere except inside a feathered mask around water/mist (from the Object
Index pass), where the half-res animated frames are composited in.

## Rebuild / re-render
```bash
# host
python3 -I tools/scene/fetch_assets.py ~/vms/blender/share/scene
cp tools/scene/*.py tools/scene/*.sh ~/vms/blender/share/scene/scripts/
~/vms/blender/vm.sh start
VM="$HOME/vms/blender/vm.sh ssh"
$VM 'umask 000; cd /mnt/host/scene && blender -b --factory-startup -P scripts/build_scene.py -- /mnt/host/scene'
# loops (≈ 7 min plate + 192 half-res water frames each); output in scene/renders/
$VM 'ZMAX=30  bash /mnt/host/scene/scripts/run_loop2.sh waterfall CamWaterfall 384 50 64 192'
$VM 'ZMAX=250 bash /mnt/host/scene/scripts/run_loop2.sh bridge CamBridge 384 50 64 192'
# plate-only change (e.g. distant mountains): delete renders/<id>_plate.* and rerun run_loop2 — water frames are reused
# turn clips (60 frames each, half res, then faded into the full-res posters)
for p in "CamWaterfall CamBridge waterfall bridge" "CamBridge CamWaterfall bridge waterfall"; do set -- $p
  $VM "cd /mnt/host/scene && blender -b gorge.blend -P scripts/render_turn.py -- $1 $2 renders/turn_$3_$4 60 50 64 &&
       blender -b -P scripts/post.py -- turnfade renders/turn_$3_$4 renders/$3_plate.png renders/$4_plate.png renders/turn_$3_$4_comp 6"
done
# encode (host)
tools/scene/encode.sh loop waterfall; tools/scene/encode.sh loop bridge
tools/scene/encode.sh turn waterfall bridge; tools/scene/encode.sh turn bridge waterfall
```
`meta.json` per scene is hand-written (focus point = falls / arch, light = warm sun tint).
Use `nohup`/`tmux` inside the VM for long renders. Renders need ~3 GB of the 6 GB VRAM.
Never edit a `.sh` that a running job is executing (bash reads scripts incrementally).

## Costs (Quadro RTX 3000, OptiX, OIDN)
| Step | Time |
|---|---|
| build_scene.py | ~10 s |
| plate 1080×2400 @384 spp | waterfall ~7.5 min, bridge ~4–5 min |
| water frame 540×1200 @64 spp | waterfall ~21 s, bridge ~15 s (192 frames: ~68 / ~48 min) |
| composite 192 frames (CPU) | ~4–5 min |
| turn frame 540×1200 @64 spp + motion blur | ~25 s (60 frames: ~26 min per clip) |
| encode (host) | ~30 s per loop |
