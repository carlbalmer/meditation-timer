"""Clean depth pass (volumes hidden, few samples): blender -b gorge.blend -P render_depth.py -- <camera> <out_prefix>"""
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
s = bpy.context.scene
p = bpy.context.preferences.addons['cycles'].preferences
p.compute_device_type = 'OPTIX'; p.refresh_devices()
for d in p.devices: d.use = d.type == 'OPTIX'
s.cycles.device = 'GPU'; s.cycles.samples = 16; s.cycles.use_denoising = False; s.cycles.use_adaptive_sampling = False
s.camera = bpy.data.objects[a[0]]; s.render.resolution_percentage = 50
for o in s.objects:
    if o.name in ('Mist', 'Haze') or o.name.startswith('FallsSpray'):
        o.hide_render = True
s.view_layers[0].use_pass_z = True
s.render.filter_size = 1.5
s.frame_set(1)
bpy.ops.render.render(write_still=False)
ims = s.render.image_settings; ims.media_type = 'MULTI_LAYER_IMAGE'; ims.file_format = 'OPEN_EXR_MULTILAYER'; ims.color_depth = '32'
bpy.data.images['Render Result'].save_render(a[1] + '.exr', scene=s)
print('DEPTH_DONE')
