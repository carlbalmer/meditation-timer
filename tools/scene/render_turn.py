"""Render the camera-turn clip between two views.
blender -b gorge.blend -P render_turn.py -- <FromCam> <ToCam> <out_dir> [frames] [pct] [spp]
Eased yaw/pitch/lens interpolation (shortest yaw path), camera motion blur.
Water phases are offset so the first frame matches <from> loop frame 1 and the
last frame matches <to> loop frame 1 (both loops are periodic, phase 0 = frame 1)."""
import bpy, sys, math, os, time
a = sys.argv[sys.argv.index('--') + 1:]
fc, tc, out = a[0], a[1], a[2]
N = int(a[3]) if len(a) > 3 else 60
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
s.render.use_persistent_data = True
s.render.use_motion_blur = True; s.render.motion_blur_shutter = 0.5
A, B = bpy.data.objects[fc], bpy.data.objects[tc]
LOOP = 192
wf_first = fc == 'CamWaterfall'
for gname, starts in (('PhaseWF', wf_first), ('PhaseBR', not wf_first)):
    g = bpy.data.node_groups[gname]
    for d in g.animation_data.drivers:
        d.driver.expression = f'(frame - 1) / {LOOP}' if starts else f'(frame - {N}) / {LOOP}'
cd = A.data.copy(); cam = bpy.data.objects.new('CamTurn', cd); s.collection.objects.link(cam)
cam.location = A.location
ya, yb = A.rotation_euler.z, B.rotation_euler.z
dy = (yb - ya + math.pi) % (2 * math.pi) - math.pi
for f in range(1, N + 1):
    t = (f - 1) / (N - 1)
    e = t * t * t * (t * (6 * t - 15) + 10)          # smootherstep
    cam.rotation_euler = (A.rotation_euler.x + (B.rotation_euler.x - A.rotation_euler.x) * e, 0, ya + dy * e)
    cam.location = A.location.lerp(B.location, e)
    cd.lens = A.data.lens + (B.data.lens - A.data.lens) * e
    cam.keyframe_insert('rotation_euler', frame=f); cam.keyframe_insert('location', frame=f); cd.keyframe_insert('lens', frame=f)
for fcu in list(cam.animation_data.action.fcurves if hasattr(cam.animation_data.action, 'fcurves') else []):
    for k in fcu.keyframe_points: k.interpolation = 'LINEAR'
s.camera = cam
s.render.resolution_percentage = pct
s.frame_start, s.frame_end = 1, N
os.makedirs(out, exist_ok=True)
s.render.filepath = os.path.join(out, 'f_####')
ims = s.render.image_settings
ims.media_type = 'IMAGE'; ims.file_format = 'PNG'; ims.color_depth = '16'; ims.color_mode = 'RGB'
t0 = time.time()
bpy.ops.render.render(animation=True)
print('TURN_TIME', fc, tc, round(time.time() - t0, 1))
