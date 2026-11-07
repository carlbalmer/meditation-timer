"""Render the animated (water) layer of a loop.
blender -b gorge.blend -P render_anim.py -- <camera> <out_dir> <first> <last> [pct] [spp] [phase_offset_frames_WF] [phase_offset_frames_BR]
Writes <out_dir>/f_####.png (16-bit, view transform applied). Frames are full-frame (no border):
static parts are later replaced by the high-quality plate through a soft water mask."""
import bpy, sys, time, os
a = sys.argv[sys.argv.index('--') + 1:]
cam, out, f0, f1 = a[0], a[1], int(a[2]), int(a[3])
pct = int(a[4]) if len(a) > 4 else 50
spp = int(a[5]) if len(a) > 5 else 64
s = bpy.context.scene
p = bpy.context.preferences.addons['cycles'].preferences
p.compute_device_type = 'OPTIX'; p.refresh_devices()
for d in p.devices: d.use = d.type == 'OPTIX'
c = s.cycles
c.device = 'GPU'; c.samples = spp; c.use_adaptive_sampling = True; c.adaptive_threshold = 0.02
c.use_denoising = True; c.denoiser = 'OPENIMAGEDENOISE'; c.denoising_use_gpu = True; c.denoising_quality = 'HIGH'
c.max_bounces = 8; c.diffuse_bounces = 2; c.glossy_bounces = 3; c.transmission_bounces = 8; c.transparent_max_bounces = 24; c.volume_bounces = 1
c.volume_step_rate = 4.0; c.caustics_reflective = False; c.caustics_refractive = False; c.blur_glossy = 1.0
c.seed = 0; c.use_animated_seed = False
s.render.use_persistent_data = True
s.camera = bpy.data.objects[cam]
s.render.resolution_percentage = pct
s.frame_start, s.frame_end = f0, f1
os.makedirs(out, exist_ok=True)
s.render.filepath = os.path.join(out, 'f_####')
ims = s.render.image_settings
ims.media_type = 'IMAGE'; ims.file_format = 'PNG'; ims.color_depth = '16'; ims.color_mode = 'RGB'
t = time.time()
bpy.ops.render.render(animation=True)
print('ANIM_TIME', cam, f0, f1, round(time.time() - t, 1), 'per frame', round((time.time() - t) / (f1 - f0 + 1), 1))
