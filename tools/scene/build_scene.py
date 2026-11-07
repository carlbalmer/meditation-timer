"""Build the gorge scene (waterfall pool + downstream stream + arch bridge) procedurally.

Run inside the VM:  blender -b --factory-startup -P build_scene.py -- <scene_dir>
Writes <scene_dir>/gorge.blend. All geometry is generated here; external textures/models
come from <scene_dir>/assets (see fetch_assets.py / ASSETS.md).

World layout (metres, Z up): the stream flows towards -Y. Waterfall pool around (1, 5.6),
falls at x=FX on the back wall (y~11). The camera stands at the pool outlet near the origin.
Turning 180 deg looks downstream to the arch bridge at y~-24 and a lake far below.
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix, Quaternion, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nodes import NT, new_material, output  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = ARGS[0] if ARGS else '/mnt/host/scene'
OUTNAME = ARGS[1] if len(ARGS) > 1 else 'gorge.blend'
A = os.path.join(ROOT, 'assets')

FX = 2.6            # falls centre x
LOOP_FRAMES = 192   # 8 s at 24 fps
CAM_POS = (-0.3, -2.6, 2.0)
SUN_AZ = math.radians(212.0)   # sky convention: direction (sin, cos)
SUN_EL = math.radians(61.0)
SUN_DIR = Vector((math.sin(SUN_AZ) * math.cos(SUN_EL), math.cos(SUN_AZ) * math.cos(SUN_EL), math.sin(SUN_EL)))

SKY_STRENGTH = 0.35
SUN_ENERGY = 5.0
random.seed(7)

# ---------------------------------------------------------------- utilities

def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def fbm(x, y, z, octaves=4, lac=2.0, gain=0.5):
    s, a, f, norm = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        s += a * noise.noise(Vector((x * f, y * f, z * f)), noise_basis='PERLIN_NEW')
        norm += a; a *= gain; f *= lac
    return s / norm


def mesh_from_grid(name, verts, nu, nv, uvs=None, flip=False):
    """verts: list of (x,y,z) row-major [v][u]; builds quads."""
    me = bpy.data.meshes.new(name)
    faces = []
    for j in range(nv - 1):
        for i in range(nu - 1):
            a = j * nu + i
            q = (a, a + 1, a + nu + 1, a + nu)
            faces.append(q[::-1] if flip else q)
    me.from_pydata(verts, [], faces)
    if uvs is not None:
        uvl = me.uv_layers.new(name='UVMap')
        loops = me.loops
        vals = [0.0] * (len(loops) * 2)
        for li, lp in enumerate(loops):
            u, v = uvs[lp.vertex_index]
            vals[2 * li] = u; vals[2 * li + 1] = v
        uvl.data.foreach_set('uv', vals)
    me.shade_smooth() if hasattr(me, 'shade_smooth') else None
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def adaptive(ob, dicing=1.5, levels=6):
    m = ob.modifiers.new('subd', 'SUBSURF')
    m.subdivision_type = 'SIMPLE'
    m.levels = 0
    m.render_levels = levels
    try:
        m.use_adaptive_subdivision = True
        m.adaptive_pixel_size = dicing
    except Exception as e:
        print('adaptive subdivision unavailable', e)
    return m


def catmull(points, n_per):
    pts = [Vector(p) for p in points]
    out = []
    P = [pts[0] + (pts[0] - pts[1])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def resample(poly, step):
    """resample a dense polyline at ~uniform arc length; returns list of (pos2d, tangent2d, s)."""
    d = [0.0]
    for a, b in zip(poly, poly[1:]):
        d.append(d[-1] + (b - a).length)
    L = d[-1]
    n = max(2, int(L / step) + 1)
    res, j = [], 0
    for k in range(n):
        s = L * k / (n - 1)
        while j < len(d) - 2 and d[j + 1] < s:
            j += 1
        t = (s - d[j]) / max(1e-9, d[j + 1] - d[j])
        p = poly[j].lerp(poly[j + 1], t)
        tg = (poly[j + 1] - poly[j]).normalized()
        res.append((p, tg, s))
    return res

# ---------------------------------------------------------------- terrain shape

def stream_x(y):
    return 1.0 + (-y) * 0.075 + 0.7 * math.sin(-y * 0.17)


def stream_bed(y):
    z = -0.18 + 0.062 * y
    if y < -27.0:
        z -= 0.7 * (-27.0 - y) ** 1.6
    return z


def floor_z(x, y):
    n = fbm(x * 0.35, y * 0.35, 0.5, 3)
    bank = 0.25 + 0.22 * n + 0.04 * max(0.0, abs(x) - 2.0) ** 1.5
    z = bank
    # pool basin
    r = math.sqrt(((x - 1.0) / 4.4) ** 2 + ((y - 5.3) / 5.6) ** 2)
    if r < 1.25:
        rd = math.sqrt(((x - 0.4) / 3.4) ** 2 + ((y - 3.0) / 3.7) ** 2)
        pz = -0.12 - 0.25 * math.sqrt(max(0.0, 1 - min(r, 1.0) ** 2)) - 1.45 * max(0.0, 1 - rd * rd) ** 0.8 + 0.5 * max(0.0, r - 0.95)
        pz += 0.04 * fbm(x * 1.5, y * 1.5, 3.3, 3)
        z = min(z, pz)
    # downstream channel
    if y < 1.6:
        xs = stream_x(y)
        d = x - xs
        w = 1.35 + 0.45 * math.sin(y * 0.31) + 0.25 * max(0.0, -y - 15) / 10
        zb = stream_bed(y)
        if abs(d) < w:
            sz = zb - 0.28 * (1 - (d / w) ** 2)
        elif d < 0:   # -X side: gentle gravel bank, then a bushy slope
            sz = zb + 0.18 * ((-d - w) / 1.0) ** 1.2
            sz += 0.55 * max(0.0, -d - w - 2.0) ** 1.35 * smoothstep(-2.0, -7.0, y)
        else:          # +X side: rises to rock
            sz = zb + 0.45 * ((d - w) / 0.8) ** 1.5
        sz += 0.05 * fbm(x * 1.2, y * 1.2, 7.7, 3)
        fade = smoothstep(1.6, 0.2, y)
        z = min(z, sz * fade + z * (1 - fade)) if y > 0.2 else min(z, sz)
    if y < -27.0:
        z = min(z, stream_bed(y) + 0.5 + 0.05 * abs(x - stream_x(y)) ** 2)
        z -= 0.4 * (-27.0 - y) ** 1.4
    return z


def water_level(x, y):
    lv = -1e3
    r = math.sqrt(((x - 1.0) / 4.4) ** 2 + ((y - 5.3) / 5.6) ** 2)
    if r < 1.3 and y > -0.6:
        lv = 0.0
    if y < 0.6 and abs(x - stream_x(y)) < 6.0:
        sl = stream_bed(y) + 0.13
        if y > -0.5:
            sl = min(sl, -0.01)
        lv = max(lv, sl)
    return lv


def build_floor():
    xs = [-15 + 0.2 * i for i in range(151)]
    ys = [-46 + 0.2 * j for j in range(311)]
    verts = [(x, y, floor_z(x, y)) for y in ys for x in xs]
    uvs = [(x, y) for y in ys for x in xs]
    ob = mesh_from_grid('Floor', verts, len(xs), len(ys), uvs)
    wd = [max(-1.0, min(3.0, water_level(x, y) - z)) for (x, y, z) in verts]
    at = ob.data.attributes.new('wdepth', 'FLOAT', 'POINT')
    at.data.foreach_set('value', wd)
    return ob

# ---------------------------------------------------------------- walls

WALLS = {
    # name: (polyline, inward side +1 left-normal / -1 right-normal, rim(s, pos) function, seed)
    'WallLeft': ([(-4.6, 14.5), (-4.4, 9.5), (-4.7, 5.0), (-4.1, 1.0), (-4.9, -4.0), (-6.2, -10), (-7.6, -17), (-9.2, -24), (-10.5, -32), (-11.0, -44)], +1, 7.0),
    'WallRight': ([(6.6, 14.5), (6.0, 9.5), (5.6, 5.0), (4.6, 1.0), (4.9, -4.0), (5.8, -10), (6.8, -17), (7.4, -24), (8.0, -32), (8.6, -44)], -1, 11.0),
    'WallBack': ([(-6.0, 10.6), (-2.0, 11.0), (1.0, 11.0), (3.5, 11.3), (7.5, 10.4)], -1, 21.0),
}


def wall_rim(name, p):
    x, y = p.x, p.y
    if name == 'WallLeft':
        return 12.5 - 7.5 * smoothstep(4, -12, y) - 2.0 * smoothstep(-14, -30, y) + 3.5 * math.exp(-((y + 24.5) / 4.0) ** 2) + 1.2 * fbm(y * 0.08, 1, 2)
    if name == 'WallRight':
        return 11.0 - 3.0 * smoothstep(13, 9, y) - 1.0 * smoothstep(5, -12, y) + 0.8 * smoothstep(-16, -24, y) + 1.0 * fbm(y * 0.08, 3, 2)
    return 13.0 - 3.5 * smoothstep(1.0, 6.5, x) + 0.6 * fbm(x * 0.2, 5, 1)


def wall_offset(name, seed, s, z, pos):
    th = math.radians(68)
    a = s * math.cos(th) + z * math.sin(th)
    b = -s * math.sin(th) + z * math.cos(th)
    big = 1.3 * fbm(s * 0.06, z * 0.07, seed, 3)
    ridge = 0.6 * fbm(a * 0.45, b * 0.10, seed + 1.7, 4)
    slab = 0.45 * (1.0 - abs(noise.noise(Vector((a * 0.22, b * 0.07, seed + 5.1)))))
    # stepped facets: slabs breaking off along the foliation
    ca = a * 0.9 + 0.6 * fbm(a * 0.3, b * 0.3, seed + 3.3, 2)
    fa = ca - math.floor(ca)
    cell = noise.cell(Vector((math.floor(ca), math.floor(b * 0.35 + 0.3 * fbm(a, b * 0.2, seed, 2)), seed)))
    step = 0.16 * (cell - 0.5) + 0.06 * smoothstep(0.0, 0.4, fa)
    off = big + ridge + slab + step
    rim = wall_rim(name, pos)
    if z > rim:
        off -= 1.7 * (z - rim) + 0.4 * fbm(s * 0.3, z * 0.3, seed + 9, 2) * smoothstep(rim, rim + 1, z)
    if z < 0.5:
        off += 0.45 * (0.5 - z)
    if name == 'WallBack':
        x = pos.x
        g = math.exp(-((x - FX) / 0.85) ** 2)
        off -= 1.25 * g * smoothstep(-0.8, 0.8, z)          # chute groove behind the falls
        off += 0.6 * math.exp(-((x - FX - 1.9) / 1.2) ** 2) * smoothstep(-0.5, 2.0, z)  # sunlit slabs right of the falls
    return off


def wall_point(name, p, tg, side, s, z, seed):
    n = Vector((-tg.y, tg.x)) * side
    off = wall_offset(name, seed, s, z, p)
    return Vector((p.x + n.x * off, p.y + n.y * off, z)), n


def build_wall(name, poly, side, seed, step=0.2):
    dense = catmull([Vector(p) for p in poly], 24)
    samples = resample(dense, step)
    rims = [wall_rim(name, p) for p, _, _ in samples]
    zmax = max(rims) + 7.0
    nz = int((zmax + 3.0) / step) + 1
    verts, uvs = [], []
    for k in range(nz):
        z = -3.0 + k * step
        for p, tg, s in samples:
            v, _ = wall_point(name, p, tg, side, s, z, seed)
            verts.append(tuple(v)); uvs.append((s, z))
    ob = mesh_from_grid(name, verts, len(samples), nz, uvs)
    # make normals point into the gorge
    me = ob.data
    me.update()
    p0, tg0, s0 = samples[len(samples) // 2]
    inward = Vector((-tg0.y, tg0.x)) * side
    pidx = (nz // 2) * (len(samples) - 1) + len(samples) // 2
    if me.polygons[pidx].normal.to_2d().dot(inward) < 0:
        me.flip_normals()
    return ob, samples

# ---------------------------------------------------------------- materials

def phase_group(name):
    """Node group whose output is a loop phase in [0,1) driven by the frame."""
    g = bpy.data.node_groups.get(name)
    if g:
        return g
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    g.interface.new_socket('Phase', in_out='OUTPUT', socket_type='NodeSocketFloat')
    v = g.nodes.new('ShaderNodeValue'); v.name = 'phase'
    o = g.nodes.new('NodeGroupOutput')
    g.links.new(v.outputs[0], o.inputs[0])
    fc = v.outputs[0].driver_add('default_value')
    fc.driver.type = 'SCRIPTED'
    fc.driver.expression = f'(frame - 1) / {LOOP_FRAMES}'
    return g


def loop_noise(nt, vec2, phase, radius=1.0, cycles=1, scale=1.0, detail=3.0, rough=0.55, seed=0.0, color=False):
    """Noise that evolves over time and is exactly periodic in phase (circle in z/w)."""
    th = nt.mul(phase, 2 * math.pi * cycles)
    c = nt.math('COSINE', th); s = nt.math('SINE', th)
    sx = nt.sep(vec2)
    v = nt.comb(sx[0], sx[1], nt.madd(c, radius, seed))
    return nt.noise(v, scale=scale, detail=detail, rough=rough, w=nt.madd(s, radius, seed * 0.37), dims='4D', color=color)


def scroll_noise(nt, u, v, phase, speed_cycles, v_period, radius, u_scale, detail=3.0, rough=0.55, seed=0.0):
    """Noise scrolling along v, periodic in v (period v_period) and in phase."""
    ang = nt.mul(nt.sub(nt.mul(v, 1.0 / v_period), nt.mul(phase, speed_cycles)), 2 * math.pi)
    vec = nt.comb(nt.mul(u, u_scale), nt.mul(nt.math('COSINE', ang), radius), nt.mul(nt.math('SINE', ang), radius))
    return nt.noise(vec, scale=1.0, detail=detail, rough=rough, w=seed, dims='4D')


def tex(aid, kind):
    d = os.path.join(A, aid)
    for f in os.listdir(d):
        if kind in f:
            return os.path.join(d, f)
    raise FileNotFoundError(aid + kind)


def mat_gneiss(name='Gneiss', moss_region=True, wet_falls=True, bands_scale=1.0):
    m, nt = new_material(name)
    m.displacement_method = 'BOTH'
    co = nt.coords('Object')
    # gneiss foliation: warped scalar field t along a steep fold normal
    nfol = Vector((0.88, 0.28, 0.38)).normalized()
    warp1 = nt.noise(co, scale=0.09, detail=2, rough=0.5, distortion=1.2)
    warp2 = nt.noise(co, scale=0.45, detail=3, rough=0.55, distortion=0.6)
    warp3 = nt.noise(co, scale=0.2, detail=2, rough=0.5)
    t = nt.vmath('DOT_PRODUCT', co, tuple(nfol))
    t = nt.add(t, nt.mul(warp1, 2.8 * bands_scale))
    t = nt.add(t, nt.mul(warp2, 0.9))
    t = nt.add(t, nt.mul(nt.mul(warp3, warp3), 3.0))
    fq = nt.maprange(nt.noise(co, scale=0.07, detail=1), 0.35, 0.65, 1.0, 4.0)
    bands = nt.noise(None, scale=1.0, detail=4, rough=0.65, w=nt.mul(t, fq), dims='1D')
    fine = nt.noise(None, scale=1.0, detail=3, rough=0.6, w=nt.mul(t, nt.mul(fq, 12.0)), dims='1D')
    lam = nt.add(nt.mul(bands, 0.72), nt.mul(fine, 0.28))
    contrast = nt.maprange(nt.noise(co, scale=0.11, detail=2), 0.3, 0.7, 0.3, 1.15)
    lam = nt.madd(nt.sub(lam, 0.5), contrast, 0.5)
    col = nt.ramp(lam, [(0.36, (0.040, 0.037, 0.034)), (0.43, (0.085, 0.077, 0.068)), (0.50, (0.15, 0.137, 0.12)),
                        (0.555, (0.21, 0.195, 0.17)), (0.60, (0.33, 0.315, 0.28)), (0.655, (0.50, 0.48, 0.43))], interp='EASE')
    # micro texture from scanned rock (luminance only)
    det = nt.image(tex('lichen_rock', '_diff_'), nt.vmath('SCALE', co, scale=0.45), proj='BOX', blend=0.3)
    det_l = nt.node('ShaderNodeRGBToBW', {'Color': det}).outputs[0]
    col = nt.mix(0.75, col, nt.mix(1.0, col, nt.maprange(det_l, 0.0, 0.5, 0.55, 1.6), 'MULTIPLY'), 'MIX')
    patch = nt.noise(co, scale=0.35, detail=3, rough=0.6)
    col = nt.mix(nt.smooth(patch, 0.45, 0.65), col, nt.mix(1.0, col, (1.2, 1.05, 0.85), 'MULTIPLY'), 'MIX')
    col = nt.mix(nt.mul(nt.smooth(patch, 0.5, 0.3), 0.6), col, nt.mix(1.0, col, (0.8, 0.82, 0.85), 'MULTIPLY'), 'MIX')
    # ochre / rust streaks (iron staining) following some bands and running down
    rust_n = nt.noise(nt.vmath('MULTIPLY', co, (0.6, 0.6, 0.12)), scale=1.0, detail=4, rough=0.6)
    rust_m = nt.math('MULTIPLY', nt.smooth(rust_n, 0.58, 0.72), nt.smooth(bands, 0.45, 0.6))
    col = nt.mix(nt.mul(rust_m, 0.85), col, (0.30, 0.13, 0.04), 'MIX')
    # dark wet streaks (water seeping down)
    seep = nt.noise(nt.vmath('MULTIPLY', co, (1.4, 1.4, 0.3)), scale=1.0, detail=3, rough=0.5)
    seep_m = nt.smooth(seep, 0.5, 0.64)
    wet = seep_m
    if wet_falls:
        sx = nt.sep(co)
        dfx = nt.math('ABSOLUTE', nt.sub(sx[0], FX))
        near = nt.smooth(nt.add(dfx, nt.mul(nt.math('ABSOLUTE', nt.sub(sx[1], 10.6)), 0.6)), 3.4, 0.8)
        near = nt.mul(near, nt.smooth(sx[2], 10.0, 6.0))
        wet = nt.math('MAXIMUM', wet, near)
    wet = nt.math('MAXIMUM', wet, nt.mul(nt.smooth(nt.sep(co)[2], 1.4, 0.1), 0.9))
    col = nt.mix(nt.mul(wet, 0.7), col, nt.mix(1.0, col, (0.32, 0.32, 0.31), 'MULTIPLY'), 'MIX')
    rough_img = nt.image(tex('lichen_rock', '_rough_'), nt.vmath('SCALE', co, scale=0.45), 'Non-Color', 'BOX', 0.3)
    rough = nt.maprange(nt.sep(rough_img)[0] if False else nt.node('ShaderNodeRGBToBW', {'Color': rough_img}).outputs[0], 0, 1, 0.45, 0.85)
    rough = nt.mix(wet, rough, 0.18, dtype='FLOAT')
    # moss + litter on up-facing surfaces
    nrm = nt.geometry('Normal')
    nz = nt.sep(nrm)[2]
    up = nt.smooth(nz, 0.25, 0.7)
    mossn = nt.noise(co, scale=1.2, detail=5, rough=0.6)
    moss_m = nt.mul(up, nt.smooth(mossn, 0.42, 0.55))
    sx = nt.sep(co)
    if moss_region:
        region = nt.mul(nt.smooth(sx[0], 0.5, -2.5), nt.smooth(sx[2], 1.0, 3.5))
        steep_moss = nt.mul(nt.mul(region, nt.smooth(mossn, 0.53, 0.6)), nt.smooth(nz, -0.3, 0.1))
        moss_m = nt.math('MAXIMUM', nt.mul(moss_m, nt.add(0.25, region)), steep_moss)
    moss_col = nt.mix(nt.noise(co, scale=6.0, detail=2), (0.10, 0.22, 0.012), (0.26, 0.42, 0.03), 'MIX')
    # leaf litter / soil on gentle slopes high up (rim slopes)
    flat = nt.smooth(nz, 0.55, 0.8)
    litter = nt.image(tex('forest_leaves_02', '_diffuse_'), nt.vmath('SCALE', co, scale=0.6), proj='BOX', blend=0.3)
    col = nt.mix(flat, col, litter, 'MIX')
    col = nt.mix(moss_m, col, moss_col, 'MIX')
    rough = nt.mix(nt.math('MAXIMUM', moss_m, flat), rough, 0.85, dtype='FLOAT')
    bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': col, 'Roughness': rough, 'Specular IOR Level': 0.5})
    nt.set(bsdf.inputs['Sheen Weight'], nt.mul(moss_m, 0.6)); bsdf.inputs['Sheen Tint'].default_value = (0.6, 0.9, 0.4, 1)
    # displacement: protruding pale bands, rounded micro relief, moss cushions
    disp_img = nt.image(tex('lichen_rock', '_disp_'), nt.vmath('SCALE', co, scale=0.45), 'Non-Color', 'BOX', 0.3)
    disp_l = nt.node('ShaderNodeRGBToBW', {'Color': disp_img}).outputs[0]
    h = nt.add(nt.mul(bands, 0.008), nt.mul(disp_l, 0.06))
    h = nt.add(h, nt.mul(nt.noise(co, scale=2.5, detail=3), 0.03))
    cush = nt.voronoi(co, scale=9.0, feature='SMOOTH_F1', out='Distance')
    h = nt.add(h, nt.mul(moss_m, nt.maprange(cush, 0.0, 0.6, 0.05, 0.0)))
    disp = nt.node('ShaderNodeDisplacement', {'Height': h, 'Midlevel': 0.05, 'Scale': 1.0}, space='OBJECT')
    output(nt, bsdf, displacement=disp)
    try:
        m.max_vertex_displacement = 0.12
    except Exception:
        pass
    return m


def mat_boulder(name='Boulder', tint=(0.29, 0.29, 0.28)):
    m, nt = new_material(name)
    m.displacement_method = 'BOTH'
    co = nt.coords('Object')
    vec = nt.vmath('SCALE', co, scale=0.7)
    diff = nt.image(tex('lichen_rock', '_diff_'), vec, proj='BOX', blend=0.3)
    l = nt.node('ShaderNodeRGBToBW', {'Color': diff}).outputs[0]
    # faint gneiss swirl
    t = nt.add(nt.vmath('DOT_PRODUCT', co, (0.3, 0.8, 0.5)), nt.mul(nt.noise(co, scale=0.7, detail=2), 2.0))
    band = nt.noise(None, scale=1, detail=3, w=nt.mul(t, 5.0), dims='1D')
    base = nt.ramp(band, [(0.35, (tint[0] * 0.55, tint[1] * 0.55, tint[2] * 0.55)), (0.55, tint), (0.7, (tint[0] * 1.5, tint[1] * 1.5, tint[2] * 1.45))])
    col = nt.mix(1.0, base, nt.maprange(l, 0.0, 0.6, 0.55, 1.35), 'MULTIPLY')
    lich = nt.smooth(nt.noise(co, scale=3.0, detail=4), 0.6, 0.7)
    col = nt.mix(nt.mul(lich, 0.4), col, (0.45, 0.46, 0.38), 'MIX')
    # wet foot near water
    z = nt.sep(nt.coords('Generated'))[2]
    rough_i = nt.image(tex('lichen_rock', '_rough_'), vec, 'Non-Color', 'BOX', 0.3)
    bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': col, 'Roughness': nt.maprange(nt.node('ShaderNodeRGBToBW', {'Color': rough_i}).outputs[0], 0, 1, 0.5, 0.9)})
    dimg = nt.image(tex('lichen_rock', '_disp_'), vec, 'Non-Color', 'BOX', 0.3)
    disp = nt.node('ShaderNodeDisplacement', {'Height': nt.node('ShaderNodeRGBToBW', {'Color': dimg}).outputs[0], 'Midlevel': 0.5, 'Scale': 0.04}, space='OBJECT')
    output(nt, bsdf, displacement=disp)
    return m


def mat_pebbles(name='PebbleBed'):
    m, nt = new_material(name)
    m.displacement_method = 'BOTH'
    co = nt.coords('Object')
    vec = nt.vmath('SCALE', co, scale=1.0)
    diff = nt.image(tex('dry_river_pebbles', '_diff_'), vec, proj='BOX', blend=0.2)
    grey = nt.image(tex('ganges_river_pebbles', '_diff_'), nt.vmath('SCALE', co, scale=0.4), proj='BOX', blend=0.2)
    mixf = nt.smooth(nt.noise(co, scale=0.25, detail=2), 0.45, 0.6)
    col = nt.mix(mixf, diff, grey, 'MIX')
    col = nt.mix(1.0, col, (1.05, 0.9, 0.62), 'MULTIPLY')   # golden-brown under water
    # water depth from the floor attribute: algae + Beer-Lambert absorption (down and back up)
    wd = nt.math('MAXIMUM', nt.node('ShaderNodeAttribute', attribute_name='wdepth', attribute_type='GEOMETRY').outputs['Fac'], 0.0)
    col = nt.mix(nt.smooth(wd, 0.2, 0.9), col, nt.mix(1.0, col, (0.55, 0.62, 0.45), 'MULTIPLY'), 'MIX')
    tr = nt.node('ShaderNodeCombineXYZ')
    for i, k in enumerate((2.6, 1.15, 1.35)):
        nt.set(tr.inputs[i], nt.math('EXPONENT', nt.mul(wd, -2.0 * k)))
    teal = nt.node('ShaderNodeVectorMath', operation='MULTIPLY')
    nt.set(teal.inputs[0], nt.vmath('SUBTRACT', (1.0, 1.0, 1.0), tr.outputs[0])); teal.inputs[1].default_value = (0.006, 0.020, 0.019)
    col = nt.vmath('ADD', nt.vmath('MULTIPLY', col, tr.outputs[0]), teal.outputs['Vector'])
    z = nt.sep(co)[2]
    # animated caustics (periodic), only below the water line
    ph = nt.group(phase_group('PhaseWF')).outputs[0]
    cn = loop_noise(nt, nt.vmath('SCALE', co, scale=1.0), ph, radius=0.6, cycles=2, scale=2.2, detail=1.0, rough=0.4, seed=3.0)
    ridge = nt.math('POWER', nt.sub(1.0, nt.math('ABSOLUTE', nt.mul(nt.sub(cn, 0.5), 2.0))), 6.0)
    underwater = nt.smooth(wd, 0.02, 0.1)
    caust = nt.mul(nt.mul(ridge, nt.mul(underwater, nt.smooth(wd, 0.7, 0.25))), 1.2)
    col = nt.mix(1.0, col, nt.add(1.0, caust) if False else nt.comb(nt.add(1.0, caust), nt.add(1.0, caust), nt.add(1.0, nt.mul(caust, 0.85))), 'MULTIPLY')
    wetrough = nt.mix(underwater, 0.75, 0.35, dtype='FLOAT')
    bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': col, 'Roughness': wetrough})
    dimg = nt.image(tex('dry_river_pebbles', '_disp_'), vec, 'Non-Color', 'BOX', 0.2)
    flat = nt.smooth(wd, 0.75, 0.2)     # deep parts: smooth silty bottom
    hgt = nt.add(nt.mul(nt.sub(nt.node('ShaderNodeRGBToBW', {'Color': dimg}).outputs[0], 0.5), flat), 0.5)
    disp = nt.node('ShaderNodeDisplacement', {'Height': hgt, 'Midlevel': 0.5, 'Scale': 0.06}, space='OBJECT')
    output(nt, bsdf, displacement=disp)
    return m


def shader_group_from_material(mat, gname):
    """Convert a material's surface+displacement into a node group (outputs Shader, Disp)."""
    g = bpy.data.node_groups.new(gname, 'ShaderNodeTree')
    g.interface.new_socket('Shader', in_out='OUTPUT', socket_type='NodeSocketShader')
    g.interface.new_socket('Disp', in_out='OUTPUT', socket_type='NodeSocketVector')
    src = mat.node_tree
    mp = {}
    for n in src.nodes:
        if n.bl_idname == 'ShaderNodeOutputMaterial':
            continue
        c = g.nodes.new(n.bl_idname)
        for attr in ('operation', 'use_clamp', 'blend_type', 'data_type', 'clamp_result', 'noise_dimensions', 'noise_type',
                     'voronoi_dimensions', 'feature', 'distance', 'projection', 'projection_blend', 'interpolation', 'image',
                     'interpolation_type', 'clamp', 'space', 'node_tree', 'attribute_name', 'attribute_type'):
            if hasattr(n, attr):
                try:
                    setattr(c, attr, getattr(n, attr))
                except Exception:
                    pass
        if n.bl_idname == 'ShaderNodeValToRGB':
            cr, sr = c.color_ramp, n.color_ramp
            cr.interpolation = sr.interpolation
            while len(cr.elements) < len(sr.elements):
                cr.elements.new(0.5)
            for a, b in zip(cr.elements, sr.elements):
                a.position = b.position; a.color = b.color
        for i, s in enumerate(n.inputs):
            if hasattr(s, 'default_value') and hasattr(c.inputs[i], 'default_value'):
                try:
                    c.inputs[i].default_value = s.default_value
                except Exception:
                    pass
        mp[n.name] = c
    out = g.nodes.new('NodeGroupOutput')
    for l in src.links:
        if l.to_node.bl_idname == 'ShaderNodeOutputMaterial':
            idx = 0 if l.to_socket.name == 'Surface' else 1
            g.links.new(mp[l.from_node.name].outputs[l.from_socket.identifier], out.inputs[idx])
        else:
            fs = mp[l.from_node.name].outputs[[s.identifier for s in l.from_node.outputs].index(l.from_socket.identifier)]
            ts = mp[l.to_node.name].inputs[[s.identifier for s in l.to_node.inputs].index(l.to_socket.identifier)]
            g.links.new(fs, ts)
    return g


def mat_floor_combined():
    peb = mat_pebbles('_peb_src')
    rock = mat_gneiss('_rock_src', moss_region=False, wet_falls=False)
    gp = shader_group_from_material(peb, 'G_Pebbles')
    gr = shader_group_from_material(rock, 'G_Rock')
    m, nt = new_material('Floor')
    m.displacement_method = 'BOTH'
    co = nt.coords('Object')
    sx = nt.sep(co)
    a = nt.group(gp); b = nt.group(gr)
    # rock where the floor is high/steep or noise says slab; pebbles in water and on gravel banks
    nz = nt.sep(nt.geometry('Normal'))[2]
    slab = nt.smooth(nt.noise(co, scale=0.35, detail=3), 0.5, 0.58)
    high = nt.smooth(sx[2], 0.05, 0.35)
    steep = nt.smooth(nz, 0.8, 0.55)
    rockm = nt.math('MAXIMUM', nt.mul(slab, high), steep)
    gravel_bank = nt.mul(nt.smooth(nt.sub(sx[0], 0.0), 0.5, -1.5), nt.smooth(sx[1], 0.0, -3.0))
    rockm = nt.mul(rockm, nt.sub(1.0, nt.mul(gravel_bank, 0.8)))
    sh = nt.node('ShaderNodeMixShader'); nt.set(sh.inputs[0], rockm); nt.link(a.outputs[0], sh.inputs[1]); nt.link(b.outputs[0], sh.inputs[2])
    dsp = nt.mix(rockm, a.outputs[1], b.outputs[1], dtype='VECTOR')
    # leaf litter / soil on the bushy -X slope downstream
    lvec = nt.vmath('SCALE', co, scale=0.5)
    lit = nt.image(tex('forest_leaves_02', '_diffuse_'), lvec, proj='BOX', blend=0.2)
    lit = nt.mix(nt.smooth(nt.noise(co, scale=0.6, detail=3), 0.45, 0.6), lit, nt.mix(1.0, lit, (0.5, 0.55, 0.3), 'MULTIPLY'))
    lb = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': lit, 'Roughness': 0.85})
    lm = nt.mul(nt.mul(nt.smooth(sx[2], -0.1, 0.3), nt.smooth(sx[1], -3.0, -6.0)), nt.smooth(sx[0], 0.3, -1.8))
    sh2 = nt.node('ShaderNodeMixShader'); nt.set(sh2.inputs[0], lm); nt.link(sh.outputs[0], sh2.inputs[1]); nt.link(lb, sh2.inputs[2])
    output(nt, sh2, displacement=nt.mix(lm, dsp, (0, 0, 0), dtype='VECTOR'))
    bpy.data.materials.remove(peb); bpy.data.materials.remove(rock)
    return m


def mat_water(name, phase_name, flow=False):
    m, nt = new_material(name)
    co = nt.coords('Object')
    ph = nt.group(phase_group(phase_name)).outputs[0]
    sx = nt.sep(co)
    if flow:
        # ripples dragged downstream (-Y), periodic: v period 6 m, 1 period per loop -> 0.75 m/s
        n1 = scroll_noise(nt, nt.mul(sx[0], 1.0), nt.mul(sx[1], -1.0), ph, speed_cycles=1, v_period=6.0, radius=6.0 / (2 * math.pi) * 2.2, u_scale=2.2, detail=4, rough=0.55)
        n2 = scroll_noise(nt, nt.mul(sx[0], 1.0), nt.mul(sx[1], -1.0), ph, speed_cycles=2, v_period=3.0, radius=3.0 / (2 * math.pi) * 5.0, u_scale=5.0, detail=3, rough=0.5, seed=4.0)
        h = nt.add(nt.mul(n1, 0.7), nt.mul(n2, 0.3))
        bump_strength = 0.5
    else:
        n1 = loop_noise(nt, nt.vmath('SCALE', co, scale=1.0), ph, radius=0.8, cycles=1, scale=1.6, detail=3, rough=0.5)
        n2 = loop_noise(nt, nt.vmath('SCALE', co, scale=1.0), ph, radius=0.5, cycles=3, scale=5.0, detail=2, rough=0.5, seed=11.0)
        # rings spreading from the falls
        dist = nt.vmath('DISTANCE', co, (FX - 0.2, 9.6, 0.0))
        ring = nt.node('ShaderNodeTexWave', {'Vector': nt.comb(dist, 0, 0), 'Scale': 1.0, 'Distortion': 0.0}, wave_type='BANDS', bands_direction='X', wave_profile='SIN')
        nt.set(ring.inputs['Phase Offset'], nt.mul(ph, -2 * math.pi * 6))
        ring.inputs['Scale'].default_value = 0.35
        ringf = nt.mul(ring.outputs['Fac'], nt.smooth(dist, 7.0, 1.0))
        h = nt.add(nt.add(nt.mul(n1, 0.55), nt.mul(n2, 0.25)), nt.mul(ringf, 0.25))
        # calmer far from the falls (lower part of the frame)
        h = nt.mul(h, nt.maprange(dist, 1.5, 8.0, 1.0, 0.45))
        bump_strength = 0.35
    bump = nt.node('ShaderNodeBump', {'Height': h, 'Strength': bump_strength, 'Distance': 0.02})
    glass = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': (0.86, 0.95, 0.93), 'Roughness': 0.03, 'IOR': 1.333,
                                               'Transmission Weight': 1.0, 'Normal': bump.outputs[0]})
    # foam: near the falls impact (pool) or on steeper flowing parts (stream)
    if flow:
        steep = nt.smooth(nt.sep(nt.geometry('Normal'))[2], 0.995, 0.97)
        fn = scroll_noise(nt, sx[0], nt.mul(sx[1], -1.0), ph, speed_cycles=2, v_period=4.0, radius=4.0 / (2 * math.pi) * 3.0, u_scale=3.0, detail=5, rough=0.6, seed=8.0)
        foam = nt.mul(steep, nt.smooth(fn, 0.45, 0.62))
    else:
        dist = nt.vmath('DISTANCE', co, (FX - 0.1, 9.9, 0.0))
        fn = loop_noise(nt, nt.vmath('SCALE', co, scale=1.0), ph, radius=0.6, cycles=4, scale=3.0, detail=5, rough=0.6, seed=21.0)
        foam = nt.mul(nt.smooth(dist, 3.0, 0.5), nt.smooth(fn, 0.33, 0.6))
    foam_bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': (0.9, 0.93, 0.95), 'Roughness': 0.35, 'Subsurface Weight': 0.0})
    surf = nt.node('ShaderNodeMixShader'); nt.set(surf.inputs[0], nt.mul(foam, 0.9)); nt.link(glass, surf.inputs[1]); nt.link(foam_bsdf, surf.inputs[2])
    # transparent for shadow rays so the bed is lit (fake caustics are in the bed shader)
    lp = nt.node('ShaderNodeLightPath')
    tr = nt.node('ShaderNodeBsdfTransparent')
    fin = nt.node('ShaderNodeMixShader'); nt.link(lp.outputs['Is Shadow Ray'], fin.inputs[0]); nt.link(surf, fin.inputs[1]); nt.link(tr, fin.inputs[2])
    output(nt, fin)
    return m


def mat_falls(name, layer=0):
    m, nt = new_material(name)
    ph = nt.group(phase_group('PhaseWF')).outputs[0]
    uv = nt.sep(nt.node('ShaderNodeUVMap').outputs[0])
    u, v = uv[0], uv[1]               # u 0..1 across, v 0..1 top->bottom
    uc = nt.math('ABSOLUTE', nt.sub(nt.mul(u, 2.0), 1.0))
    if layer == 0:
        a = scroll_noise(nt, u, v, ph, speed_cycles=6, v_period=1.0, radius=1.1, u_scale=14.0, detail=4, rough=0.6)
        b = scroll_noise(nt, u, v, ph, speed_cycles=13, v_period=0.5, radius=0.9, u_scale=34.0, detail=3, rough=0.6, seed=5.0)
        dens = nt.add(nt.mul(a, 0.65), nt.mul(b, 0.35))
        # sheet is denser in the middle, frays at the edges and lower down
        edge = nt.smooth(uc, 1.0, nt.maprange(v, 0.0, 1.0, 0.45, 0.2))
        thr = nt.maprange(v, 0.0, 1.0, 0.36, 0.46)
        cov = nt.mul(nt.smooth(dens, thr, nt.add(thr, 0.12)), edge)
        # split into two streams over the upper part, meandering gap
        gc = nt.add(0.5, nt.mul(nt.math('SINE', nt.mul(v, 9.0)), 0.06))
        gap = nt.mul(nt.smooth(nt.math('ABSOLUTE', nt.sub(u, gc)), 0.11, 0.03), nt.smooth(v, 0.55, 0.2))
        cov = nt.mul(cov, nt.sub(1.0, gap))
        # ragged, broken lip
        lipn = nt.noise(nt.comb(nt.mul(u, 9.0), 0.0, 3.0), scale=1.0, detail=3)
        cov = nt.mul(cov, nt.smooth(v, nt.mul(lipn, 0.05), nt.add(nt.mul(lipn, 0.05), 0.025)))
        white = nt.maprange(dens, 0.35, 0.6, 0.75, 1.0)
    elif layer == 2:
        # thin aerated water skipping over the rock on both sides of the main sheet
        a = scroll_noise(nt, u, v, ph, speed_cycles=5, v_period=1.0, radius=1.6, u_scale=18.0, detail=5, rough=0.65, seed=13.0)
        b = scroll_noise(nt, u, v, ph, speed_cycles=11, v_period=0.5, radius=1.0, u_scale=40.0, detail=3, rough=0.6, seed=6.0)
        dens = nt.add(nt.mul(a, 0.6), nt.mul(b, 0.4))
        steps = nt.smooth(nt.noise(nt.comb(nt.mul(u, 3.0), nt.mul(v, 14.0), 1.0), scale=1.0, detail=2), 0.45, 0.62)
        cov = nt.mul(nt.mul(nt.smooth(dens, 0.5, 0.64), nt.smooth(uc, 1.0, 0.6)), nt.add(0.25, steps))
        cov = nt.mul(cov, nt.smooth(v, 0.02, 0.08))
        white = 1.0
    else:
        a = scroll_noise(nt, u, v, ph, speed_cycles=7, v_period=1.0, radius=1.4, u_scale=24.0, detail=5, rough=0.65, seed=9.0)
        b = scroll_noise(nt, u, v, ph, speed_cycles=15, v_period=0.5, radius=1.2, u_scale=60.0, detail=3, rough=0.6, seed=2.0)
        dens = nt.add(nt.mul(a, 0.5), nt.mul(b, 0.5))
        edge = nt.smooth(uc, 1.0, 0.3)
        cov = nt.mul(nt.mul(nt.smooth(dens, 0.52, 0.66), edge), nt.smooth(v, 0.1, 0.45))
        white = 1.0
    foam = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': (0.92, 0.95, 0.97), 'Roughness': 0.25,
                                              'Subsurface Weight': 0.0, 'Transmission Weight': 0.0})
    trans = nt.node('ShaderNodeBsdfTranslucent', {'Color': (0.85, 0.9, 0.92)})
    fs = nt.node('ShaderNodeMixShader', {0: 0.35}); nt.link(foam, fs.inputs[1]); nt.link(trans, fs.inputs[2])
    clear = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': (0.9, 0.96, 0.95), 'Roughness': 0.08, 'Transmission Weight': 1.0, 'IOR': 1.33})
    body = nt.node('ShaderNodeMixShader'); nt.set(body.inputs[0], white if not isinstance(white, float) else white); nt.link(clear, body.inputs[1]); nt.link(fs, body.inputs[2])
    tr = nt.node('ShaderNodeBsdfTransparent')
    fin = nt.node('ShaderNodeMixShader'); nt.set(fin.inputs[0], cov); nt.link(tr, fin.inputs[1]); nt.link(body, fin.inputs[2])
    output(nt, fin)
    return m


def mat_mist(name='Mist', density=3.5):
    m, nt = new_material(name)
    ph = nt.group(phase_group('PhaseWF')).outputs[0]
    co = nt.coords('Object')
    gen = nt.coords('Generated')
    d = nt.vmath('LENGTH', nt.vmath('MULTIPLY', nt.vmath('SUBTRACT', gen, (0.5, 0.6, 0.0)), (2.0, 2.2, 1.0)))
    fall = nt.smooth(d, 1.0, 0.15)
    n = loop_noise(nt, nt.vmath('SCALE', co, scale=1.0), ph, radius=0.5, cycles=1, scale=1.3, detail=3, rough=0.55, seed=4.0)
    dens = nt.mul(nt.mul(fall, nt.smooth(n, 0.38, 0.7)), density)
    vol = nt.node('ShaderNodeVolumePrincipled', {'Color': (0.92, 0.95, 1.0), 'Anisotropy': 0.55})
    nt.set(vol.inputs['Density'], dens)
    output(nt, volume=vol)
    return m


def mat_haze(name='Haze', density=0.0010):
    m, nt = new_material(name)
    vol = nt.node('ShaderNodeVolumePrincipled', {'Color': (0.92, 0.95, 1.0), 'Density': density, 'Anisotropy': 0.3})
    output(nt, volume=vol)
    return m


def mat_bark(name='Bark', tint=(0.16, 0.14, 0.12)):
    m, nt = new_material(name)
    co = nt.coords('Object')
    n = nt.noise(co, scale=8.0, detail=3)
    col = nt.mix(n, (tint[0] * 0.6, tint[1] * 0.6, tint[2] * 0.6), (tint[0] * 1.6, tint[1] * 1.6, tint[2] * 1.5))
    moss = nt.smooth(nt.noise(co, scale=1.5, detail=2), 0.6, 0.7)
    col = nt.mix(nt.mul(moss, 0.5), col, (0.18, 0.24, 0.05))
    bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': col, 'Roughness': 0.85})
    output(nt, bsdf)
    return m


def mat_leaf(name='Leaf', color=(0.32, 0.55, 0.08)):
    m, nt = new_material(name)
    oi = nt.node('ShaderNodeObjectInfo')
    rnd = nt.node('ShaderNodeAttribute', attribute_name='rnd', attribute_type='GEOMETRY')
    col = nt.mix(rnd.outputs['Fac'], color, (color[0] * 1.3, color[1] * 1.1, color[2] * 0.6))
    bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': col, 'Roughness': 0.5})
    trans = nt.node('ShaderNodeBsdfTranslucent', {'Color': col})
    mx = nt.node('ShaderNodeMixShader', {0: 0.4}); nt.link(bsdf, mx.inputs[1]); nt.link(trans, mx.inputs[2])
    # leaf silhouette via UV ellipse
    uv = nt.sep(nt.node('ShaderNodeUVMap').outputs[0])
    du = nt.mul(nt.sub(uv[0], 0.5), 2.0); dv = nt.mul(nt.sub(uv[1], 0.5), 2.0)
    r = nt.add(nt.mul(du, du), nt.mul(nt.mul(dv, dv), 0.0))
    shape = nt.math('LESS_THAN', nt.add(nt.mul(du, du), nt.mul(nt.mul(dv, dv), 1.0)), nt.sub(1.0, nt.mul(nt.math('ABSOLUTE', dv), 0.0)))
    alpha = shape
    tr = nt.node('ShaderNodeBsdfTransparent')
    fin = nt.node('ShaderNodeMixShader'); nt.set(fin.inputs[0], alpha); nt.link(tr, fin.inputs[1]); nt.link(mx, fin.inputs[2])
    output(nt, fin)
    return m


def mat_bridge():
    m, nt = new_material('BridgeStone')
    m.displacement_method = 'BOTH'
    co = nt.coords('Object')
    vec = nt.vmath('SCALE', co, scale=0.55)
    diff = nt.image(tex('rock_wall_10', '_diff_'), vec, proj='BOX', blend=0.15)
    col = nt.mix(1.0, diff, (0.62, 0.58, 0.55), 'MULTIPLY')
    moss = nt.mul(nt.smooth(nt.sep(nt.geometry('Normal'))[2], 0.3, 0.8), nt.smooth(nt.noise(co, scale=1.0, detail=3), 0.45, 0.55))
    col = nt.mix(moss, col, (0.12, 0.2, 0.03))
    rough = nt.image(tex('rock_wall_10', '_rough_'), vec, 'Non-Color', 'BOX', 0.15)
    bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': col, 'Roughness': nt.node('ShaderNodeRGBToBW', {'Color': rough}).outputs[0]})
    dimg = nt.image(tex('rock_wall_10', '_disp_'), vec, 'Non-Color', 'BOX', 0.15)
    disp = nt.node('ShaderNodeDisplacement', {'Height': nt.node('ShaderNodeRGBToBW', {'Color': dimg}).outputs[0], 'Midlevel': 0.5, 'Scale': 0.08}, space='OBJECT')
    output(nt, bsdf, displacement=disp)
    return m


def mat_distant(name, base, haze=(0.62, 0.72, 0.86), haze_dist=4000.0, emission=1.0):
    m, nt = new_material(name)
    cam = nt.node('ShaderNodeCameraData')
    d = cam.outputs['View Distance']
    f = nt.math('EXPONENT', nt.mul(d, -1.0 / haze_dist))
    fac = nt.sub(1.0, f)
    co = nt.coords('Object')
    n = nt.noise(co, scale=0.01, detail=6)
    col = nt.mix(n, (base[0] * 0.6, base[1] * 0.6, base[2] * 0.6), base)
    bsdf = nt.node('ShaderNodeBsdfDiffuse', {'Color': col})
    em = nt.node('ShaderNodeEmission', {'Color': haze, 'Strength': emission})
    mx = nt.node('ShaderNodeMixShader'); nt.set(mx.inputs[0], fac); nt.link(bsdf, mx.inputs[1]); nt.link(em, mx.inputs[2])
    output(nt, mx)
    return m


def mat_lake():
    m, nt = new_material('Lake')
    cam = nt.node('ShaderNodeCameraData')
    fac = nt.sub(1.0, nt.math('EXPONENT', nt.mul(cam.outputs['View Distance'], -1.0 / 5000.0)))
    gl = nt.node('ShaderNodeBsdfGlossy', {'Color': (0.5, 0.6, 0.7), 'Roughness': 0.15})
    dif = nt.node('ShaderNodeBsdfDiffuse', {'Color': (0.03, 0.06, 0.08)})
    w = nt.node('ShaderNodeMixShader', {0: 0.5}); nt.link(dif, w.inputs[1]); nt.link(gl, w.inputs[2])
    em = nt.node('ShaderNodeEmission', {'Color': (0.45, 0.58, 0.80), 'Strength': 0.9})
    mx = nt.node('ShaderNodeMixShader'); nt.set(mx.inputs[0], fac); nt.link(w, mx.inputs[1]); nt.link(em, mx.inputs[2])
    output(nt, mx)
    return m

# ---------------------------------------------------------------- objects

def boulder(name, loc, size, rot_z=0.0, seed=0, mat=None, flat=0.6, sub=4):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    for v in bm.verts:
        p = v.co.copy()
        n1 = fbm(p.x * 0.9 + seed, p.y * 0.9, p.z * 0.9, 3)
        n2 = fbm(p.x * 2.5, p.y * 2.5 + seed, p.z * 2.5, 2)
        r = 1.0 + 0.32 * n1 + 0.08 * n2
        p *= r
        # flatten bottom and cut facets
        if p.z < -0.3:
            p.z = -0.3 + (p.z + 0.3) * 0.3
        p.z *= flat
        v.co = p
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.scale = size
    ob.location = loc
    ob.rotation_euler = (random.uniform(-0.15, 0.15), random.uniform(-0.15, 0.15), rot_z)
    if mat:
        ob.data.materials.append(mat)
    adaptive(ob, 2.0)
    return ob


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    return new


def stash(objs, cname):
    col = bpy.data.collections.get(cname) or bpy.data.collections.new(cname)
    for o in objs:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    return col


def place_copy(src, loc, rot=(0, 0, 0), scale=1.0, name=None):
    ob = src.copy()
    ob.name = name or src.name + '_inst'
    ob.location = loc
    ob.rotation_euler = rot
    ob.scale = (scale, scale, scale) if not isinstance(scale, tuple) else scale
    bpy.context.scene.collection.objects.link(ob)
    return ob


SKIP = ('Coping', 'Tree', 'Falls', 'Pool', 'Stream', 'Bridge', 'Shrub', 'Tuft', 'Moss', 'Log', 'Mist', 'Haze', 'Boulder')


def raycast(origin, direction, maxd=100.0, skip=SKIP):
    dg = bpy.context.evaluated_depsgraph_get()
    o, d = Vector(origin), Vector(direction).normalized()
    for _ in range(20):
        hit, loc, nrm, idx, ob, mat = bpy.context.scene.ray_cast(dg, o, d, distance=maxd)
        if not hit:
            return None, None, None
        if not ob.name.startswith(skip):
            return loc, nrm, ob
        o = loc + d * 0.01
    return None, None, None

# ---------------------------------------------------------------- trees

def make_tree(name, base, height, seed, leafiness=0.0, bark=None, leaf_mat=None, lean=(0, 0), max_depth=4, spread=1.0):
    rng = random.Random(seed)
    splines, tips = [], []

    def grow(pos, d, length, radius, depth):
        nseg = max(3, int(length / (0.35 if depth < 2 else 0.18)))
        pts, rad = [pos.copy()], [radius]
        cur, dd = pos.copy(), d.copy()
        for i in range(nseg):
            jitter = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))) * (0.10 + 0.08 * depth)
            dd = (dd + jitter + Vector((0, 0, 0.05 if depth < 3 else -0.02))).normalized()
            cur = cur + dd * (length / nseg)
            pts.append(cur.copy())
            rad.append(radius * (1 - 0.55 * (i + 1) / nseg))
        splines.append((pts, rad))
        if depth >= max_depth or radius < 0.006:
            tips.append((cur.copy(), dd.copy()))
            if depth >= max_depth:
                return
        nchild = int((4 if depth == 0 else 5) * rng.uniform(0.7, 1.3) * (1.4 if depth >= 2 else 1.0))
        for k in range(nchild):
            t = rng.uniform(0.35 if depth == 0 else 0.15, 0.98)
            idx = min(len(pts) - 1, int(t * (len(pts) - 1)))
            p = pts[idx]
            perp = dd.orthogonal().normalized()
            perp.rotate(Quaternion(dd, rng.uniform(0, 2 * math.pi)))
            ang = math.radians(rng.uniform(28, 55) * spread)
            cd = (dd * math.cos(ang) + perp * math.sin(ang)).normalized()
            cd = (cd + Vector((0, 0, 0.25 if depth < 2 else 0.1))).normalized()
            grow(p, cd, length * rng.uniform(0.42, 0.62) * (1.15 - 0.4 * t), rad[idx] * rng.uniform(0.5, 0.7), depth + 1)
        if depth >= 2:
            tips.append((cur.copy(), dd.copy()))

    grow(Vector(base), Vector((lean[0], lean[1], 1.0)).normalized(), height * 0.55, height * 0.008 + 0.02, 0)
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 1
    cu.use_fill_caps = True
    for pts, rad in splines:
        sp = cu.splines.new('POLY')
        sp.points.add(len(pts) - 1)
        for pt, p, r in zip(sp.points, pts, rad):
            pt.co = (p.x, p.y, p.z, 1.0)
            pt.radius = max(r, 0.0018)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    if bark:
        ob.data.materials.append(bark)
    if leafiness > 0 and leaf_mat:
        verts, faces, uvs, rnds = [], [], [], []
        for (p, d) in tips:
            n = int(leafiness * rng.uniform(0.5, 1.5) * (1.6 if leafiness > 3 else 1.0))
            for k in range(n):
                c = p - d * rng.uniform(0.0, 0.25) + Vector((rng.gauss(0, 0.04), rng.gauss(0, 0.04), rng.gauss(0, 0.04)))
                s = rng.uniform(0.025, 0.05)
                ax = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
                ay = ax.cross(Vector((0, 0, 1))).normalized()
                if ay.length < 0.1:
                    ay = Vector((1, 0, 0))
                i0 = len(verts)
                for (a, b) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    verts.append(tuple(c + ax * a * s * 0.6 + ay * b * s))
                faces.append((i0, i0 + 1, i0 + 2, i0 + 3))
                uvs += [(0, 0), (1, 0), (1, 1), (0, 1)]
                rnds.append(rng.random())
        me = bpy.data.meshes.new(name + '_leaves')
        me.from_pydata(verts, [], faces)
        uvl = me.uv_layers.new(name='UVMap')
        uvl.data.foreach_set('uv', [c for uv in uvs for c in uv])
        at = me.attributes.new('rnd', 'FLOAT', 'FACE')
        at.data.foreach_set('value', rnds)
        lo = bpy.data.objects.new(name + '_leaves', me)
        bpy.context.scene.collection.objects.link(lo)
        lo.data.materials.append(leaf_mat)
    return ob


def mat_straw():
    m, nt = new_material('Straw')
    co = nt.coords('Object')
    n = nt.noise(co, scale=30.0, detail=1)
    col = nt.mix(n, (0.45, 0.37, 0.22), (0.78, 0.68, 0.46))
    bsdf = nt.node('ShaderNodeBsdfPrincipled', {'Base Color': col, 'Roughness': 0.55})
    tr = nt.node('ShaderNodeBsdfTranslucent', {'Color': col})
    mx = nt.node('ShaderNodeMixShader', {0: 0.3}); nt.link(bsdf, mx.inputs[1]); nt.link(tr, mx.inputs[2])
    output(nt, mx)
    return m


def make_hanging_grass(name, points, mat, seed=0):
    """Drooping clumps of dry grass (curves) growing from wall ledges."""
    rng = random.Random(seed)
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = 1.0; cu.bevel_resolution = 0
    for loc, nrm in points:
        size = rng.uniform(0.8, 1.8)
        n = int(110 * size)
        for k in range(n):
            st = loc + Vector((rng.gauss(0, 0.06), rng.gauss(0, 0.06), rng.gauss(0, 0.04))) * size
            d = (nrm * 0.8 + Vector((0, 0, 0.6)) + Vector((rng.gauss(0, 0.5), rng.gauss(0, 0.5), rng.gauss(0, 0.3)))).normalized()
            L = rng.uniform(0.25, 0.9) * size
            g = rng.uniform(0.25, 0.6)
            pts = [st.copy()]
            for i in range(8):
                d = (d + Vector((0, 0, -g))).normalized()
                st = st + d * (L / 8)
                pts.append(st.copy())
            sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
            for i, (pt, p) in enumerate(zip(sp.points, pts)):
                pt.co = (p.x, p.y, p.z, 1.0); pt.radius = 0.0022 * (1 - 0.7 * i / 8)
    ob = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


# ---------------------------------------------------------------- bridge

def build_bridge(mat, y0=-24.0, width=1.7):
    """Single steep arch from the +X rock (screen-left looking downstream) to the -X slope."""
    xl, xr = 9.5, -11.0          # deck ends (buried in terrain)
    sl, sr = 5.4, -6.8           # springing points of the intrados
    zl, zr = 3.6, 5.2            # springing heights
    crown_x, crown_z = -0.4, 9.6
    def intrados(x):
        # asymmetric ellipse-ish arch through springing points and crown
        if x >= crown_x:
            t = (x - crown_x) / (sl - crown_x); return zl + (crown_z - zl) * math.sqrt(max(0.0, 1 - t * t))
        t = (x - crown_x) / (sr - crown_x); return zr + (crown_z - zr) * math.sqrt(max(0.0, 1 - t * t))
    def deck(x):
        t = (x - crown_x)
        return crown_z + 1.05 - (0.028 * t * t if t > 0 else 0.045 * t * t)
    nx = 160
    xs = [xl + (xr - xl) * i / (nx - 1) for i in range(nx)]
    verts, faces = [], []
    ring = []
    for x in xs:
        top = deck(x)
        if sr <= x <= sl:
            bot = intrados(x)
        else:
            bot = top - 6.0          # abutment goes down into the rock
        # cross section: 4 corners (front-bot, front-top, back-top, back-bot) + parapet bump
        sec = [(x, y0 - width / 2, bot), (x, y0 - width / 2, top), (x, y0 - width / 2 + 0.25, top + 0.12),
               (x, y0 + width / 2 - 0.25, top + 0.12), (x, y0 + width / 2, top), (x, y0 + width / 2, bot)]
        ring.append(len(verts))
        verts += sec
    m = 6
    for i in range(nx - 1):
        a, b = ring[i], ring[i + 1]
        for k in range(m):
            k2 = (k + 1) % m
            faces.append((a + k, a + k2, b + k2, b + k))
    faces.append(tuple(ring[0] + k for k in range(m))[::-1])
    faces.append(tuple(ring[-1] + k for k in range(m)))
    me = bpy.data.meshes.new('Bridge')
    me.from_pydata(verts, [], faces)
    me.validate()
    ob = bpy.data.objects.new('Bridge', me)
    bpy.context.scene.collection.objects.link(ob)
    me.update()
    # ensure outward normals
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for v in me.vertices:
        c = v.co
        c += Vector((0.06 * fbm(c.x * 0.7, c.y * 0.7, c.z * 0.7, 2), 0.10 * fbm(c.x * 0.5, c.z * 0.5, 3.0, 3), 0.06 * fbm(c.x * 0.7, c.z * 0.7, 7.0, 2)))
    ob.data.materials.append(mat)
    adaptive(ob, 2.0)
    # rubble coping along both deck edges
    rng = random.Random(5)
    x = xl - 0.3
    k = 0
    while x > xr + 0.3:
        for side in (-1, 1):
            sz = rng.uniform(0.18, 0.3)
            boulder('Coping%03d' % k, (x, y0 + side * (width / 2 - 0.2), deck(x) + 0.12), (sz * 1.3, sz, sz * 0.8),
                    rng.uniform(0, 6.28), seed=k * 1.7, mat=mat, flat=0.9, sub=2)
            k += 1
        x -= rng.uniform(0.3, 0.45)
    return ob

# ---------------------------------------------------------------- main

def main():
    clean()
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.render.fps = 24
    scn.frame_start = 1
    scn.frame_end = LOOP_FRAMES

    # materials
    m_wall = mat_gneiss('Gneiss')
    m_floor = mat_floor_combined()
    m_bould = mat_boulder('Boulder')
    m_pool = mat_water('PoolWater', 'PhaseWF', flow=False)
    m_stream = mat_water('StreamWater', 'PhaseBR', flow=True)
    m_falls0 = mat_falls('Falls', 0)
    m_falls1 = mat_falls('FallsSpray', 1)
    m_falls2 = mat_falls('FallsHug', 2)
    m_mist = mat_mist()
    m_haze = mat_haze()
    m_bark = mat_bark()
    m_bark_pale = mat_bark('BarkPale', (0.3, 0.29, 0.27))
    m_bud = mat_leaf('Buds', (0.30, 0.42, 0.06))
    m_leaf = mat_leaf('YoungLeaves', (0.42, 0.66, 0.10))
    m_bridge = mat_bridge()

    # terrain
    fl = build_floor(); fl.data.materials.append(m_floor); adaptive(fl, 1.5)
    wall_samples = {}
    for i, (name, (poly, side, seed)) in enumerate(WALLS.items()):
        ob, samples = build_wall(name, poly, side, seed)
        ob.data.materials.append(m_wall)
        adaptive(ob, 1.5)
        wall_samples[name] = samples

    # waterfall sheets follow the back-wall chute
    samples = wall_samples['WallBack']
    si = min(range(len(samples)), key=lambda i: abs(samples[i][0].x - FX))
    p, tg, s = samples[si]
    rim = wall_rim('WallBack', p) + 0.6
    for layer, (mat, gap0, gap1, w0, w1) in enumerate(((m_falls0, 0.05, 0.6, 1.2, 2.8), (m_falls1, 0.3, 1.2, 1.5, 4.0), (m_falls2, 0.025, 0.12, 2.0, 3.2))):
        nv, nu = 140, 28
        verts, uvs = [], []
        raw = []
        for j in range(nv):
            z = rim - (rim + 0.15) * j / (nv - 1)
            raw.append(wall_point('WallBack', p, tg, -1, s, z, 21.0))
        for j in range(nv):
            v = j / (nv - 1)
            z = rim - (rim + 0.15) * v
            win = [raw[k] for k in range(max(0, j - 12), min(nv, j + 13))]
            c = sum((w[0] for w in win), Vector()) / len(win)
            c = Vector((c.x, c.y, z)); nrm = raw[j][1]
            # keep the sheet in front of the actual rock everywhere
            c += Vector((nrm.x, nrm.y, 0)) * max(0.0, max((raw[k][0] - c).to_2d().dot(nrm) for k in range(max(0, j - 3), min(nv, j + 4))))
            gap = gap0 + (gap1 - gap0) * v ** 2.4
            w = w0 + (w1 - w0) * v ** 1.3
            cen = c + Vector((nrm.x, nrm.y, 0)) * gap
            # lip at the top: water shoots slightly out over the edge
            for i in range(nu):
                u = i / (nu - 1)
                off = (u - 0.5) * w
                q = cen + Vector((tg.x, tg.y, 0)) * off
                verts.append(tuple(q)); uvs.append((u, v))
        ob = mesh_from_grid('Falls%d' % layer, verts, nu, nv, uvs)
        ob.data.materials.append(mat)
        ob.visible_shadow = layer != 1
    impact = wall_point('WallBack', p, tg, -1, s, 0.0, 21.0)[0] + Vector((0, -0.5, 0))

    # water surfaces
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0.5, 5.6, 0.0))
    pool = bpy.context.object; pool.name = 'PoolWater'; pool.scale = (14, 13.2, 1)
    bpy.ops.object.transform_apply(scale=True)
    pool.data.materials.append(m_pool)
    # stream surface following the bed
    ys = [0.6 - 0.25 * j for j in range(int(46.6 / 0.25))]
    xs_off = [-6 + 0.5 * i for i in range(25)]
    verts = []
    for y in ys:
        xs = stream_x(y)
        lvl = stream_bed(y) + 0.13
        if y > -0.5:
            lvl = min(lvl, -0.01)
        for o in xs_off:
            verts.append((xs + o, y, lvl))
    st = mesh_from_grid('StreamWater', verts, len(xs_off), len(ys), flip=True)
    st.data.materials.append(m_stream)

    # boulders: stepping stones bottom-left (waterfall view), big boulder (bridge view), stream rocks
    bdefs = [
        ((-4.2, 2.2, -0.35), (1.2, 0.9, 0.7), 0.3),
        ((-3.6, 5.2, -0.3), (0.9, 0.8, 0.6), 2.0),
        ((3.8, 1.6, -0.3), (1.0, 0.8, 0.6), 1.3), ((4.4, 8.5, -0.2), (1.2, 1.1, 1.0), 0.2),
        ((-2.9, -6.6, -0.3), (2.2, 1.8, 1.4), 0.7), ((-0.4, -2.7, -0.6), (1.1, 0.9, 0.95), 2.2), ((-1.3, -1.4, -0.3), (0.7, 0.6, 0.45), 1.2),
        ((-0.5, -5.2, -0.6), (0.9, 0.7, 0.5), 1.0), ((0.4, -6.5, -0.5), (0.5, 0.4, 0.35), 0.3),
        ((2.6, -9.0, -0.9), (0.8, 0.6, 0.45), 2.4), ((-1.4, -10.5, -0.8), (1.2, 1.0, 0.7), 1.7),
        ((3.7, -13.0, -1.0), (0.9, 0.8, 0.5), 0.6), ((1.0, -16.0, -1.2), (0.5, 0.4, 0.3), 2.0),
        ((-0.8, -18.0, -1.2), (1.1, 0.9, 0.6), 0.9), ((4.2, -19.5, -1.4), (0.6, 0.5, 0.35), 0.1),
        ((-3.8, -9.8, -0.2), (1.4, 1.1, 0.9), 2.9), ((-4.0, -13.5, 0.0), (1.6, 1.3, 1.1), 0.4),
    ]
    for i, (loc, size, rz) in enumerate(bdefs):
        boulder('Boulder%02d' % i, loc, size, rz, seed=i * 3.1, mat=m_bould)

    # imported vegetation / log
    shrubs = import_gltf(os.path.join(A, 'shrub_04', 'shrub_04_2k.gltf'))
    log = import_gltf(os.path.join(A, 'dead_tree_trunk', 'dead_tree_trunk_2k.gltf'))
    grass = import_gltf(os.path.join(A, 'grass_medium_02', 'grass_medium_02_2k.gltf'))
    moss = import_gltf(os.path.join(A, 'moss_01', 'moss_01_2k.gltf'))
    lib = stash([o for o in shrubs + log + grass + moss if o.type == 'MESH'], 'Library')
    bpy.context.scene.collection.children.link(lib)
    lib.hide_render = True
    for o in shrubs + log + grass + moss:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    for o in lib.objects:
        o.location = (0, 0, 0); o.rotation_euler = (0, 0, 0); o.scale = (1, 1, 1)
    print('LIB', [(o.name, tuple(round(d, 2) for d in o.dimensions)) for o in lib.objects])

    # bleach the log
    logs = [o for o in lib.objects if 'trunk' in o.name.lower()]
    for o in logs:
        for slot in o.material_slots:
            mt = slot.material
            if mt and mt.node_tree:
                bs = next((n for n in mt.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
                tx = next((l.from_node for l in mt.node_tree.links if l.to_node == bs and l.to_socket.name == 'Base Color'), None)
                if bs and tx:
                    nt = NT(mt.node_tree)
                    bw = nt.node('ShaderNodeRGBToBW', {'Color': tx.outputs[0]})
                    c = nt.mix(1.0, nt.maprange(bw.outputs[0], 0.0, 0.4, 0.2, 0.6), (0.78, 0.75, 0.70), 'MULTIPLY')
                    nt.link(c, bs.inputs['Base Color'])
    if logs:
        src = max(logs, key=lambda o: max(o.dimensions))
        dims = src.dimensions
        ax = max(range(3), key=lambda i: dims[i])
        axis = Vector([1 if i == ax else 0 for i in range(3)])
        for (a, b, nm) in (((-0.3, 7.6, -0.6), (-3.7, 9.4, 3.6), 'Log'), ((0.1, 7.9, -0.6), (-3.2, 9.9, 2.6), 'Log2')):
            A_, B_ = Vector(a), Vector(b)
            ob = place_copy(src, (A_ + B_) / 2, name=nm)
            q = axis.rotation_difference((B_ - A_).normalized())
            ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = q
            sc = (B_ - A_).length / dims[ax]
            ob.scale = (sc * (0.7 if nm == 'Log2' else 1.0),) * 3
            if nm == 'Log2':
                ob.scale = (sc * 0.75, sc * 0.75, sc * 0.75)

    # recolour grass to dry straw
    for o in lib.objects:
        if 'grass' in o.name.lower():
            for slot in o.material_slots:
                mt = slot.material
                bs = next((n for n in mt.node_tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
                tx = next((l.from_node for l in mt.node_tree.links if l.to_node == bs and l.to_socket.name == 'Base Color'), None)
                if bs and tx:
                    nt = NT(mt.node_tree)
                    bw = nt.node('ShaderNodeRGBToBW', {'Color': tx.outputs[0]})
                    c = nt.mix(1.0, nt.maprange(bw.outputs[0], 0.0, 0.3, 0.3, 1.0), (0.62, 0.52, 0.34), 'MULTIPLY')
                    nt.link(c, bs.inputs['Base Color'])
    grass_src = [o for o in lib.objects if 'grass' in o.name.lower()]
    shrub_src = [o for o in lib.objects if 'shrub' in o.name.lower()]
    moss_src = [o for o in lib.objects if 'moss' in o.name.lower()]

    # hanging dry grass tufts on the upper walls (waterfall view), via raycasts toward the walls
    rng = random.Random(3)
    placed = 0
    tuft_pts = []
    for k in range(400):
        if placed >= 45:
            break
        x = rng.uniform(-5.5, 6.5); z = rng.uniform(3.5, 13.0)
        if abs(x - FX) < 0.9:
            continue
        origin = Vector((x * 0.6, 3.0, z))
        target = Vector((x, 11.0, z - 1.0))
        loc, nrm, ob = raycast(origin, target - origin, 20)
        if loc is None or not ob.name.startswith('Wall'):
            continue
        if nrm.z < -0.2:
            continue
        tuft_pts.append((loc.copy(), nrm.copy()))
        placed += 1
    make_hanging_grass('HangingGrass', tuft_pts, mat_straw(), seed=5)
    print('tufts', placed)
    # moss cushions on the left wall ledges
    placed = 0
    for k in range(400):
        if True:
            break
        x = rng.uniform(-5.0, -0.5); z = rng.uniform(1.0, 11.0)
        origin = Vector((x * 0.3, 3.0, z)); target = Vector((x - 1.0, 10.5, z))
        loc, nrm, ob = raycast(origin, target - origin, 20)
        if loc is None or not ob.name.startswith('Wall') or nrm.z < 0.05:
            continue
        g = place_copy(rng.choice(moss_src), loc, name='Moss%02d' % placed)
        g.rotation_mode = 'QUATERNION'
        g.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(nrm) @ Quaternion((0, 0, 1), rng.uniform(0, 6.28))
        g.scale = (rng.uniform(0.4, 0.9),) * 3
        placed += 1
    # shrubs: waterfall view right edge, bridge view slope (screen-right = -X)
    shrub_spots = [((4.3, 1.0), 2.2), ((4.9, 3.6), 1.6), ((4.6, -1.0), 1.8), ((5.6, 6.6), 1.2),
                   ((-4.0, -6.5), 1.4), ((-5.0, -9.5), 1.8), ((-6.0, -12.0), 1.6), ((-5.3, -15.5), 1.5),
                   ((-6.5, -18.0), 1.9), ((-7.5, -21.0), 1.7), ((-3.6, -11.0), 1.1), ((-8.4, -25.0), 1.8),
                   ((-2.8, -7.5), 1.3), ((-3.2, -12.5), 1.5), ((-2.9, -16.5), 1.2), ((-3.6, -19.5), 1.6), ((-3.0, -23.0), 1.4), ((-4.4, -14.5), 1.3),
                   ((6.0, -21.0), 1.2), ((5.6, -14.0), 1.0), ((-6.0, -2.5), 1.3)]
    for i, ((x, y), sc) in enumerate(shrub_spots):
        loc, nrm, ob = raycast((x, y, 30), (0, 0, -1), 60)
        if loc is None or loc.z < 0.08:
            print('shrub skipped', x, y, loc)
            continue
        place_copy(shrub_src[i % len(shrub_src)], loc - Vector((0, 0, 0.1)), (0, 0, rng.uniform(0, 6.28)), sc * 2.6, name='Shrub%02d' % i)

    # trees (procedural, early spring)
    trng = random.Random(42)
    tree_defs = [
        # (x, y, height, seed, leafiness, leaf-material, stems)
        (9.5, 11.5, 8, 2, 1.5, m_bud, 1), (-6.0, 13.5, 9, 3, 1.0, m_bud, 1),
        # framing tree on the +X bank leaning over the stream (fresh leaves, top-left in bridge view)
        (4.2, -7.5, 9, 21, 7.0, m_leaf, 2), (6.8, -12.5, 10, 9, 6.0, m_leaf, 2), (8.6, -19.0, 10, 10, 6.0, m_leaf, 1),
        (8.0, -27.0, 8, 11, 4.0, m_leaf, 1),
        # bushy bare/budding trees on the -X slope (screen-right in bridge view)
        (-3.4, -9.0, 8, 4, 1.5, m_bud, 3), (-3.8, -13.5, 13, 5, 1.2, m_bud, 3), (-3.2, -18.0, 12, 6, 2.0, m_bud, 2),
        (-4.5, -21.5, 12, 7, 1.0, m_bud, 3), (-6.5, -26.0, 13, 8, 1.5, m_bud, 2), (-3.0, -26.0, 10, 13, 2.5, m_leaf, 2),
        (-5.5, -16.0, 14, 22, 1.0, m_bud, 2), (-4.6, -6.0, 7, 23, 3.0, m_leaf, 3), (-6.5, -11.5, 14, 24, 1.0, m_bud, 2),
        (-2.6, -15.5, 7, 25, 4.0, m_leaf, 3),
        # trees beyond the bridge, seen through the arch
        (2.5, -33.0, 13, 12, 1.0, m_bud, 1), (-2.5, -35.0, 15, 14, 1.0, m_bud, 1), (5.0, -37.0, 14, 15, 0.8, m_bud, 1),
        (-0.5, -31.0, 10, 16, 1.5, m_bud, 2), (7.0, -31.0, 10, 17, 3.0, m_leaf, 1), (-6.0, -33.0, 12, 18, 1.0, m_bud, 1),
    ]
    for i, (x, y, h, sd, lf, lm, stems) in enumerate(tree_defs):
        loc, nrm, ob = raycast((x, y, 60), (0, 0, -1), 200)
        if loc is None:
            continue
        for k in range(stems):
            lean = (trng.uniform(-0.35, 0.35), trng.uniform(-0.35, 0.35)) if stems > 1 else (trng.uniform(-0.15, 0.15), trng.uniform(-0.15, 0.15))
            if x > 3.5 and y < -5 and k == 0:
                lean = (-0.45, 0.1)   # lean over the stream
            make_tree('Tree%02d_%d' % (i, k), loc - Vector((0, 0, 0.2)) + Vector((trng.gauss(0, 0.25), trng.gauss(0, 0.25), 0)),
                      h * (1.0 if k == 0 else trng.uniform(0.6, 0.85)), sd * 10 + k, lf, m_bark, lm, lean=lean,
                      max_depth=5 if (lm is m_bud and y < -4) else 4)
    # big bare tree on the -X bank arching over the stream: fills the sky above the bridge
    loc, nrm, ob = raycast((-3.7, -8.0, 60), (0, 0, -1), 200)
    if loc is not None:
        make_tree('TreeArch', loc - Vector((0, 0, 0.2)), 14, 777, 1.2, m_bark, m_bud, lean=(0.3, -0.25), max_depth=5, spread=1.1)

    # bridge
    build_bridge(m_bridge)

    # mist and atmosphere volumes
    bpy.ops.mesh.primitive_cube_add(size=1, location=(impact.x, impact.y + 0.3, 1.6))
    mist = bpy.context.object; mist.name = 'Mist'; mist.scale = (5.0, 3.6, 3.6); mist.location.y -= 1.0
    mist.data.materials.append(m_mist)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -14, 9))
    haze = bpy.context.object; haze.name = 'Haze'; haze.scale = (34, 66, 16); haze.location.z = 5.0
    haze.data.materials.append(m_haze)


    # distant world: valley slopes, lake, mountains
    m_far_forest = mat_distant('FarForest', (0.07, 0.07, 0.05), haze=(0.45, 0.56, 0.75), haze_dist=3500.0, emission=0.9)
    m_mtn = mat_distant('Mountains', (0.06, 0.08, 0.10), haze=(0.40, 0.52, 0.75), haze_dist=14000.0, emission=0.9)
    m_lake = mat_lake()
    # valley below the gorge mouth
    vx = [-900 + 30 * i for i in range(61)]; vy = [-40 - 30 * j for j in range(60)]
    verts = []
    for y in vy:
        for x in vx:
            t = (-40 - y) / 1800.0
            z = -15 - 230 * min(1.0, t * 2.0) ** 0.7 + 40 * fbm(x * 0.004, y * 0.004, 1.0, 4) + 0.0004 * abs(x) ** 1.6
            verts.append((x, y, z))
    vo = mesh_from_grid('Valley', verts, len(vx), len(vy)); vo.data.materials.append(m_far_forest)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -6000, -240))
    lake = bpy.context.object; lake.name = 'Lake'; lake.scale = (30000, 12000, 1); lake.data.materials.append(m_lake)
    mx = [-12000 + 150 * i for i in range(161)]; my = [-7000 - 150 * j for j in range(60)]
    verts = []
    for y in my:
        for x in mx:
            ridge = 1 - abs(noise.noise(Vector((x * 0.00018, y * 0.00025, 2.0))))
            peak = 1500 * ridge ** 2.2 + 300 * fbm(x * 0.0012, y * 0.0012, 4.0, 5)
            z = -260 + peak * smoothstep(-7000, -9000, y)
            verts.append((x, y, z))
    mo = mesh_from_grid('Mountains', verts, len(mx), len(my)); mo.data.materials.append(m_mtn)

    # sun and sky
    w = bpy.data.worlds.new('Sky'); scn.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = NT(w.node_tree); nt.n.clear()
    sky = nt.node('ShaderNodeTexSky', sky_type='MULTIPLE_SCATTERING')
    sky.sun_elevation = SUN_EL; sky.sun_rotation = SUN_AZ; sky.sun_disc = False
    for k, v in (('air_density', 1.0), ('aerosol_density', 0.5), ('ozone_density', 1.5), ('altitude', 400.0)):
        try:
            setattr(sky, k, v)
        except Exception:
            pass
    hs = nt.node('ShaderNodeHueSaturation', {'Color': sky.outputs[0], 'Saturation': 1.45, 'Value': 0.92})
    lp = nt.node('ShaderNodeLightPath')
    skyc = nt.mix(lp.outputs['Is Camera Ray'], sky.outputs[0], hs.outputs[0])
    bg = nt.node('ShaderNodeBackground', {'Color': skyc, 'Strength': SKY_STRENGTH})
    o = nt.node('ShaderNodeOutputWorld'); nt.link(bg, o.inputs['Surface'])
    sun_d = bpy.data.lights.new('Sun', 'SUN'); sun_d.energy = SUN_ENERGY; sun_d.angle = math.radians(0.6); sun_d.color = (1.0, 0.96, 0.9)
    sun = bpy.data.objects.new('Sun', sun_d); scn.collection.objects.link(sun)
    sun.rotation_mode = 'QUATERNION'; sun.rotation_quaternion = SUN_DIR.to_track_quat('Z', 'Y')

    # cameras
    def camera(name, loc, yaw_deg, pitch_deg, lens):
        cd = bpy.data.cameras.new(name); cd.lens = lens; cd.sensor_width = 36; cd.sensor_fit = 'VERTICAL'; cd.sensor_height = 36
        cd.clip_start = 0.05; cd.clip_end = 30000
        ob = bpy.data.objects.new(name, cd); scn.collection.objects.link(ob)
        ob.location = loc
        ob.rotation_euler = (math.radians(90 + pitch_deg), 0, math.radians(yaw_deg))
        return ob
    camera('CamWaterfall', CAM_POS, -10.0, 2.5, 21.0)
    camera('CamBridge', CAM_POS, 182.0, 5.8, 24.0)
    scn.camera = bpy.data.objects['CamWaterfall']

    scn.render.resolution_x, scn.render.resolution_y = 1080, 2400
    scn.view_settings.view_transform = 'AgX'
    scn.view_settings.exposure = 0.3
    try:
        scn.view_settings.look = 'AgX - Punchy'
    except Exception:
        pass
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, OUTNAME), compress=True)
    print('SAVED', len(bpy.data.objects), 'objects')


main()
