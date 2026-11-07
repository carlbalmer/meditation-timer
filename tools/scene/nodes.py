"""Tiny helpers to build shader node trees from Python with less boilerplate."""
import bpy, math


class NT:
    def __init__(self, tree):
        self.t = tree
        self.n = tree.nodes
        self.l = tree.links

    def node(self, typ, inputs=None, **props):
        nd = self.n.new(typ)
        for k, v in props.items():
            setattr(nd, k, v)
        for k, v in (inputs or {}).items():
            self.set(nd.inputs[k] if not isinstance(k, int) else nd.inputs[k], v)
        return nd

    def set(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket) or (hasattr(v, 'is_output') and hasattr(v, 'node')):
            self.l.new(v, sock)
        elif isinstance(v, bpy.types.Node):
            self.l.new(v.outputs[0], sock)
        else:
            if isinstance(v, (tuple, list)) and len(v) == 3 and len(sock.default_value) == 4:
                v = (*v, 1.0)
            sock.default_value = v

    def link(self, a, b):
        if isinstance(a, bpy.types.Node):
            a = a.outputs[0]
        self.l.new(a, b)


    # --- math helpers -------------------------------------------------
    def math(self, op, a, b=None, c=None, clamp=False):
        nd = self.n.new('ShaderNodeMath')
        nd.operation = op
        nd.use_clamp = clamp
        for i, v in enumerate((a, b, c)):
            if v is not None:
                self.set(nd.inputs[i], v)
        return nd.outputs[0]

    def add(self, a, b): return self.math('ADD', a, b)
    def sub(self, a, b): return self.math('SUBTRACT', a, b)
    def mul(self, a, b): return self.math('MULTIPLY', a, b)
    def madd(self, a, b, c): return self.math('MULTIPLY_ADD', a, b, c)

    def vmath(self, op, a, b=None, scale=None):
        nd = self.n.new('ShaderNodeVectorMath')
        nd.operation = op
        if a is not None: self.set(nd.inputs[0], a)
        if b is not None: self.set(nd.inputs[1], b)
        if scale is not None: self.set(nd.inputs['Scale'], scale)
        return nd.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else nd.outputs['Vector']

    def sep(self, v):
        nd = self.n.new('ShaderNodeSeparateXYZ'); self.set(nd.inputs[0], v)
        return nd.outputs

    def comb(self, x, y, z):
        nd = self.n.new('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y, z)): self.set(nd.inputs[i], v)
        return nd.outputs[0]

    def mix(self, fac, a, b, blend='MIX', dtype='RGBA', clamp=False):
        nd = self.n.new('ShaderNodeMix'); nd.data_type = dtype
        if dtype == 'RGBA':
            nd.blend_type = blend; nd.clamp_result = clamp
        suf = {'RGBA': 'Color', 'FLOAT': 'Float', 'VECTOR': 'Vector'}[dtype]
        ins = {s.identifier: s for s in nd.inputs}
        outs = {s.identifier: s for s in nd.outputs}
        self.set(ins['Factor_Float'], fac)
        self.set(ins['A_' + suf], a)
        self.set(ins['B_' + suf], b)
        return outs['Result_' + suf]

    def ramp(self, fac, stops, interp='LINEAR'):
        nd = self.n.new('ShaderNodeValToRGB')
        cr = nd.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > len(stops):
            cr.elements.remove(cr.elements[-1])
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for el, (pos, col) in zip(cr.elements, stops):
            el.position = pos
            if not isinstance(col, (tuple, list)):
                col = (col, col, col)
            el.color = (*col[:3], 1.0) if len(col) == 3 else col
        self.set(nd.inputs[0], fac)
        return nd.outputs[0]

    def smooth(self, x, lo, hi):
        nd = self.n.new('ShaderNodeMapRange'); nd.interpolation_type = 'SMOOTHSTEP'; nd.clamp = True
        self.set(nd.inputs['Value'], x); self.set(nd.inputs['From Min'], lo); self.set(nd.inputs['From Max'], hi)
        return nd.outputs['Result']

    def maprange(self, x, a, b, c, d, clamp=True):
        nd = self.n.new('ShaderNodeMapRange'); nd.clamp = clamp
        self.set(nd.inputs['Value'], x)
        for k, v in zip(('From Min', 'From Max', 'To Min', 'To Max'), (a, b, c, d)):
            self.set(nd.inputs[k], v)
        return nd.outputs['Result']

    def noise(self, vec, scale=1.0, detail=4.0, rough=0.5, w=None, dims='3D', distortion=0.0, ntype='FBM', lac=2.0, color=False):
        nd = self.n.new('ShaderNodeTexNoise'); nd.noise_dimensions = dims; nd.noise_type = ntype
        if vec is not None: self.set(nd.inputs['Vector'], vec)
        if w is not None: self.set(nd.inputs['W'], w)
        self.set(nd.inputs['Scale'], scale); self.set(nd.inputs['Detail'], detail)
        self.set(nd.inputs['Roughness'], rough); self.set(nd.inputs['Distortion'], distortion)
        self.set(nd.inputs['Lacunarity'], lac)
        return nd.outputs['Color' if color else 'Fac']

    def voronoi(self, vec, scale=1.0, feature='F1', dist='EUCLIDEAN', out='Distance', rand=1.0, w=None, dims='3D'):
        nd = self.n.new('ShaderNodeTexVoronoi'); nd.voronoi_dimensions = dims; nd.feature = feature; nd.distance = dist
        if vec is not None: self.set(nd.inputs['Vector'], vec)
        if w is not None: self.set(nd.inputs['W'], w)
        self.set(nd.inputs['Scale'], scale); self.set(nd.inputs['Randomness'], rand)
        return nd.outputs[out]

    def coords(self, kind='Object'):
        return self.node('ShaderNodeTexCoord').outputs[kind]

    def geometry(self, out):
        return self.node('ShaderNodeNewGeometry').outputs[out]

    def image(self, path, vec, colorspace='sRGB', proj='BOX', blend=0.25, out='Color'):
        img = bpy.data.images.load(path, check_existing=True)
        img.colorspace_settings.name = colorspace
        nd = self.n.new('ShaderNodeTexImage'); nd.image = img; nd.projection = proj; nd.projection_blend = blend
        nd.interpolation = 'Cubic' if colorspace == 'Non-Color' else 'Linear'
        self.set(nd.inputs['Vector'], vec)
        return nd.outputs[out]

    def group(self, tree, **inputs):
        nd = self.n.new('ShaderNodeGroup'); nd.node_tree = tree
        for k, v in inputs.items(): self.set(nd.inputs[k], v)
        return nd


def new_material(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    m.node_tree.nodes.clear()
    return m, NT(m.node_tree)


def output(nt, surface=None, volume=None, displacement=None):
    o = nt.node('ShaderNodeOutputMaterial')
    if surface is not None: nt.set(o.inputs['Surface'], surface)
    if volume is not None: nt.set(o.inputs['Volume'], volume)
    if displacement is not None: nt.set(o.inputs['Displacement'], displacement)
    return o
