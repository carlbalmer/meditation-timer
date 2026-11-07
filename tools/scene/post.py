"""Post-processing with numpy/OIIO (run with Blender's python):
  blender -b -P post.py -- mask   <plate.exr> <mask.png> [extra_ellipse cx cy rx ry]
  blender -b -P post.py -- depth  <plate.exr> <depth.png> <width>
  blender -b -P post.py -- comp   <plate.png> <mask.png> <frames_dir> <out_dir>
"""
import sys, os, glob, numpy as np, OpenImageIO as oiio
a = sys.argv[sys.argv.index('--') + 1:]
mode = a[0]

def read_layer(path, layer):
    inp = oiio.ImageInput.open(path); i = 0
    while inp.seek_subimage(i, 0):
        names = inp.spec().channelnames
        if any(layer in n for n in names):
            px = inp.read_image(i, 0, 0, len(names), oiio.FLOAT)
            inp.close(); return np.asarray(px)
        i += 1
    raise KeyError(layer)

def blur(img, r):
    buf = oiio.ImageBuf(np.ascontiguousarray(img.astype(np.float32)))
    k = oiio.ImageBufAlgo.make_kernel('gaussian', 2 * r + 1, 2 * r + 1)
    out = oiio.ImageBufAlgo.convolve(buf, k)
    return np.asarray(out.get_pixels(oiio.FLOAT)).reshape(img.shape)

def dilate(img, r):
    buf = oiio.ImageBuf(np.ascontiguousarray(img.astype(np.float32)))
    return np.asarray(oiio.ImageBufAlgo.dilate(buf, 2 * r + 1, 2 * r + 1).get_pixels(oiio.FLOAT)).reshape(img.shape)

def write(path, arr, fmt=oiio.UINT8):
    arr = np.ascontiguousarray(arr.astype(np.float32))
    if arr.ndim == 2: arr = arr[..., None]
    buf = oiio.ImageBuf(arr); buf.write(path, fmt)

if mode == 'mask':
    idx = read_layer(a[1], 'Object Index')[..., 0]
    m = (np.abs(idx - 1.0) < 0.5).astype(np.float32)
    h, w = m.shape
    if len(a) > 3:
        cx, cy, rx, ry = map(float, a[3:7])
        yy, xx = np.mgrid[0:h, 0:w]
        e = ((xx / w - cx) / rx) ** 2 + ((yy / h - cy) / ry) ** 2
        m = np.maximum(m, np.clip(1.5 - e, 0, 1))
    m = dilate(m, 10)
    m = np.clip(blur(m, 14), 0, 1)
    write(a[2], m[..., None])
    print('mask coverage', float(m.mean()))
elif mode == 'depth':
    z = read_layer(a[1], 'Depth')[..., 0]
    zmin = float(np.percentile(z, 0.5)); zmax = float(a[4]) if len(a) > 4 else 40.0
    d = 1.0 - np.clip((np.log(np.maximum(z, zmin)) - np.log(zmin)) / (np.log(zmax) - np.log(zmin)), 0, 1)
    d = blur(d[..., None], 2)[..., 0]
    w = int(a[3]); h = int(round(d.shape[0] * w / d.shape[1]))
    buf = oiio.ImageBufAlgo.resize(oiio.ImageBuf(np.ascontiguousarray(d[..., None].astype(np.float32))), roi=oiio.ROI(0, w, 0, h, 0, 1, 0, 1))
    buf.write(a[2], oiio.UINT8)
    print('depth', d.min(), d.max())
elif mode == 'comp':
    plate = np.asarray(oiio.ImageBuf(a[1]).get_pixels(oiio.FLOAT))[..., :3]
    mask = np.asarray(oiio.ImageBuf(a[2]).get_pixels(oiio.FLOAT))[..., :1]
    H, W = plate.shape[:2]
    os.makedirs(a[4], exist_ok=True)
    files = sorted(glob.glob(os.path.join(a[3], 'f_*.png')))
    for f in files:
        fr = oiio.ImageBuf(f)
        if fr.spec().width != W:
            fr = oiio.ImageBufAlgo.resize(fr, filtername='lanczos3', roi=oiio.ROI(0, W, 0, H, 0, 1, 0, 3))
        img = np.asarray(fr.get_pixels(oiio.FLOAT))[..., :3]
        out = plate * (1 - mask) + img * mask
        write(os.path.join(a[4], os.path.basename(f)), np.clip(out, 0, 1), oiio.UINT16)
    print('composited', len(files))

if mode == 'turnfade':
    # blend the first/last k frames of a turn clip into the full-res posters so the clip
    # starts and ends exactly on them:  turnfade <frames_dir> <posterA.png> <posterB.png> <out_dir> [k]
    fdir, pa, pb, odir = a[1], a[2], a[3], a[4]
    k = int(a[5]) if len(a) > 5 else 6
    A_ = np.asarray(oiio.ImageBuf(pa).get_pixels(oiio.FLOAT))[..., :3]
    B_ = np.asarray(oiio.ImageBuf(pb).get_pixels(oiio.FLOAT))[..., :3]
    H, W = A_.shape[:2]
    files = sorted(glob.glob(os.path.join(fdir, 'f_*.png'))); n = len(files)
    os.makedirs(odir, exist_ok=True)
    for i, f in enumerate(files):
        fr = oiio.ImageBufAlgo.resize(oiio.ImageBuf(f), filtername='lanczos3', roi=oiio.ROI(0, W, 0, H, 0, 1, 0, 3))
        img = np.asarray(fr.get_pixels(oiio.FLOAT))[..., :3]
        wa = max(0.0, 1 - i / k); wb = max(0.0, 1 - (n - 1 - i) / k)
        img = img * (1 - wa - wb) + A_ * wa + B_ * wb
        write(os.path.join(odir, os.path.basename(f)), np.clip(img, 0, 1), oiio.UINT16)
    print('turnfade', n)
