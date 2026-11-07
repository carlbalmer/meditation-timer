"""Render a still from gorge.blend.
blender -b gorge.blend -P render_still.py -- <camera> <out.exr> [scale%] [samples] [frame]
Writes a multilayer EXR with Combined + Mist + IndexOB passes."""
import bpy, sys, time
a = sys.argv[sys.argv.index('--') + 1:]
cam, out = a[0], a[1]
pct = int(a[2]) if len(a) > 2 else 100
spp = int(a[3]) if len(a) > 3 else 256
frame = int(a[4]) if len(a) > 4 else 1
s = bpy.context.scene
p = bpy.context.preferences.addons['cycles'].preferences
p.compute_device_type = 'OPTIX'; p.refresh_devices()
for d in p.devices: d.use = d.type == 'OPTIX'
s.cycles.device = 'GPU'
s.camera = bpy.data.objects[cam]
s.frame_set(frame)
s.render.resolution_percentage = pct
c = s.cycles
c.samples = spp; c.use_adaptive_sampling = True; c.adaptive_threshold = 0.015
c.use_denoising = True
try:
    c.denoiser = 'OPENIMAGEDENOISE'; c.denoising_use_gpu = True; c.denoising_quality = 'HIGH'
except Exception as e: print('denoiser', e)
c.max_bounces = 8; c.diffuse_bounces = 3; c.glossy_bounces = 4; c.transmission_bounces = 8; c.transparent_max_bounces = 24; c.volume_bounces = 1
c.volume_step_rate = 4.0
c.caustics_reflective = False; c.caustics_refractive = False
c.blur_glossy = 1.0
c.texture_limit_render = '4096'
s.render.use_persistent_data = True
vl = s.view_layers[0]
vl.use_pass_mist = True; vl.use_pass_object_index = True; vl.use_pass_z = True
s.world.mist_settings.start = 0.5; s.world.mist_settings.depth = 60.0; s.world.mist_settings.falloff = 'QUADRATIC'
for i, ob in enumerate(s.objects):
    ob.pass_index = 1 if ob.name.startswith(('Falls', 'PoolWater', 'StreamWater', 'Mist')) else 0
t = time.time()
bpy.ops.render.render(write_still=False)
print('RENDER_TIME', cam, round(time.time() - t, 1))
rr = bpy.data.images['Render Result']
ims = s.render.image_settings
ims.media_type = 'IMAGE'; ims.file_format = 'PNG'; ims.color_depth = '16'; ims.color_mode = 'RGB'
rr.save_render(out + '.png', scene=s)
ims.media_type = 'MULTI_LAYER_IMAGE'; ims.file_format = 'OPEN_EXR_MULTILAYER'; ims.color_depth = '32'; ims.exr_codec = 'ZIP'
rr.save_render(out + '.exr', scene=s)
# screen-space box of the mist volume (for the animation mask)
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
import json
m = bpy.data.objects.get('Mist')
if m:
    pts = [world_to_camera_view(s, s.camera, m.matrix_world @ Vector(c)) for c in m.bound_box]
    xs = [p.x for p in pts if p.z > 0]; ys = [1 - p.y for p in pts if p.z > 0]
    if xs:
        json.dump({'mist_box': [min(xs), min(ys), max(xs), max(ys)]}, open(out + '.json', 'w'))
