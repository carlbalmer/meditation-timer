#!/usr/bin/env python3
"""Download the Poly Haven (CC0) assets used by the gorge scene and write ASSETS.md.
Usage: python3 fetch_assets.py <scene_dir>   (assets land in <scene_dir>/assets/<id>/)"""
import json, os, sys, urllib.request
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/vms/blender/share/scene')
UA = {'User-Agent': 'meditation-timer-scene/1.0'}
TEX = {  # id: purpose
    'lichen_rock': 'albedo detail, roughness and displacement for gneiss walls and boulders',
    'seaside_rock': 'downloaded, currently unused',
    'dry_river_pebbles': 'golden-brown pebble bed of pool and stream',
    'ganges_river_pebbles': 'grey gravel banks',
    'rock_wall_10': 'rubble stone of the arch bridge',
    'bark_willow': 'downloaded, currently unused (bark is procedural)',
    'forest_leaves_02': 'leaf litter on rim slopes and the bushy bank',
}
MODELS = {
    'shrub_04': 'fresh green shrubs',
    'dead_tree_trunk': 'bleached log leaning into the pool',
    'grass_medium_02': 'imported into the hidden Library collection, not rendered (hanging grass is procedural curves)',
    'moss_01': 'imported into the hidden Library collection, not rendered (moss is in the rock shader)',
}
MAPS = ['Diffuse', 'nor_gl', 'Rough', 'Displacement']
def get(url, path):
    if os.path.exists(path): return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r, open(path + '.part', 'wb') as f:
        f.write(r.read())
    os.rename(path + '.part', path)
def api(p):
    with urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/' + p, headers=UA)) as r:
        return json.load(r)
rows = []
for aid, why in list(TEX.items()) + list(MODELS.items()):
    files, info = api('files/' + aid), api('info/' + aid)
    d = os.path.join(ROOT, 'assets', aid)
    if aid in TEX:
        for m in MAPS:
            if m in files:
                u = files[m]['2k']['jpg']['url']; get(u, os.path.join(d, os.path.basename(u)))
    else:
        g = files['gltf']['2k']['gltf']; get(g['url'], os.path.join(d, os.path.basename(g['url'])))
        for rel, inc in g['include'].items(): get(inc['url'], os.path.join(d, rel))
    authors = ', '.join(info.get('authors', {}).keys())
    rows.append(f"| {info['name']} | `assets/{aid}/` | https://polyhaven.com/a/{aid} | {authors} | CC0 1.0 | {why} |")
    print('ok', aid)
with open(os.path.join(ROOT, 'ASSETS.md'), 'w') as f:
    f.write('# External assets used by the gorge scenes\n\nAll from Poly Haven (https://polyhaven.com), licence CC0 1.0 '
            '(https://polyhaven.com/license). Downloaded at 2k via https://api.polyhaven.com/files/<id> by `fetch_assets.py`.\n'
            'Everything else (gorge terrain, gneiss shader, water, waterfall, bridge, trees, sky) is procedural, made in the scripts.\n\n'
            '| Asset | Local dir | URL | Author(s) | Licence | Used for |\n|---|---|---|---|---|---|\n' + '\n'.join(rows) + '\n')
