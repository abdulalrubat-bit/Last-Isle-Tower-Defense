#!/usr/bin/env python3
"""Pack the asset pack's map layers into one atlas the terrain renderer can use.

    python3 tools/build-props.py ~/art/Tower_tileset/PNG

The pack ships each map as separate layers rather than as a flat picture:
a tileable ground texture, road pieces, and painted trees, bushes, stones and
decorations — four complete biome kits.

The road pieces are fixed corners and junctions, so they cannot follow an
arbitrary spline and are not used as tiles. What IS used is the texture inside
them: a patch is cut from the middle of the straight piece and pattern-filled
along the road path, which gives painted road on a road of any shape. The same
trick puts the ground texture down as a repeating fill instead of flat colour.

Everything lands in ONE atlas plus a generated manifest, because a hundred
loose props would be a hundred requests.

Output:
    assets/props.png     the atlas
    props-data.js        generated manifest — do not edit by hand
"""
import argparse, glob, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))

ap = argparse.ArgumentParser()
ap.add_argument('source', help="the pack's PNG dir, holding game_background_1..4")
ap.add_argument('--out', default=os.path.join(ROOT, 'assets'))
a = ap.parse_args()

# Pack folder -> the name levels use. The kits are not the biomes I had
# guessed from the composed backgrounds: folder 1 is a bone-strewn desert,
# 2 a starlit blue, 3 volcanic ash, 4 a mossy meadow.
BIOMES = [(1, 'desert'), (2, 'frost'), (3, 'ash'), (4, 'meadow')]

GROUND = 256          # ground tile, downscaled from the pack's 512
ROADTEX = 128         # square patch cut from the middle of a straight road

# Target height per prop class, in map pixels. Props are drawn small; the
# pack's 821x414 decor is paying for detail nobody can see on a 50px shrub.
CLASS_H = {'tree': 118, 'bush': 44, 'stone': 46, 'decor': 54}
# decor is a grab-bag — crates, bones, ruins, mushrooms, and in the frost kit a
# set of tall crystal growths. Anything taller than it is wide reads as
# scenery rather than litter and gets its own height, but that height stays
# UNDER the tree height: frost ships no trees, so at 150 its crystals became
# the tallest thing on the board and swamped it.
DECOR_TALL = 96


def load(bg, name):
    p = os.path.join(a.source, f'game_background_{bg}', 'layers', name)
    return Image.open(p) if os.path.exists(p) else None


def road_patch(bg):
    """A tileable square from inside a straight road piece.

    road_5 is the vertical straight: its middle is pure surface with none of
    the wavy dark border, which is drawn separately as a stroke.
    """
    im = load(bg, 'road_5.png') or load(bg, 'road_6.png')
    if im is None:
        return None
    im = im.convert('RGBA')
    w, h = im.size
    s = min(w, h) // 2
    box = ((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)
    return im.crop(box).resize((ROADTEX, ROADTEX), Image.LANCZOS).convert('RGB')


def road_colours(bg):
    """Sample the road's surface and its dark border straight from the art."""
    im = load(bg, 'road_6.png')
    if im is None:
        return ('#d9c08a', '#9a7c4e')
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    mid = px[w // 2, h // 2]
    # Walk down the centre column to the first solid pixel: that is the border.
    edge = mid
    for y in range(h):
        p = px[w // 2, y]
        if p[3] > 200:
            edge = p
            break
    hexa = lambda c: '#%02x%02x%02x' % c[:3]
    return (hexa(mid), hexa(edge))


def collect(bg):
    out = []
    for cls in ('tree', 'bush', 'stone', 'decor'):
        for p in sorted(glob.glob(os.path.join(
                a.source, f'game_background_{bg}', 'layers', f'{cls}_*.png'))):
            im = Image.open(p).convert('RGBA')
            b = im.getbbox()
            if not b:
                continue
            im = im.crop(b)
            target = CLASS_H[cls]
            if cls == 'decor' and im.height > im.width * 1.4:
                target = DECOR_TALL          # a pillar is scenery, not litter
            s = min(target / im.height, 2.0)
            im = im.resize((max(1, round(im.width * s)),
                            max(1, round(im.height * s))), Image.LANCZOS)
            out.append((cls, os.path.basename(p)[:-4], im))
    return out


# ---- lay everything out in one atlas -------------------------------------

cells, manifest = [], {}
for bg, name in BIOMES:
    entry = {'props': []}
    g = load(bg, 'land.png')
    if g:
        tile = g.convert('RGB').resize((GROUND, GROUND), Image.LANCZOS)
        cells.append(('ground:' + name, tile))
        # Mean luminance, so the renderer can darken a pale kit for road
        # contrast without crushing one that is already nearly black.
        px = tile.resize((32, 32)).load()
        tot = sum(0.299*px[x, y][0] + 0.587*px[x, y][1] + 0.114*px[x, y][2]
                  for x in range(32) for y in range(32))
        entry['lum'] = round(tot / (32*32*255), 3)
    r = road_patch(bg)
    if r:
        cells.append(('road:' + name, r))
    surf, edge = road_colours(bg)
    entry['road'] = surf
    entry['roadEdge'] = edge
    for cls, pname, im in collect(bg):
        cells.append((f'prop:{name}:{cls}:{pname}', im))
    manifest[name] = entry

# Shelf packing, tallest first. Good enough: this runs once, offline.
cells.sort(key=lambda c: -c[1].height)
W = 2048
x = y = shelf = 0
placed = {}
for key, im in cells:
    if x + im.width > W:
        x = 0
        y += shelf
        shelf = 0
    placed[key] = (x, y, im.width, im.height)
    x += im.width
    shelf = max(shelf, im.height)
H = y + shelf

atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
for key, im in cells:
    px, py, _, _ = placed[key]
    atlas.paste(im.convert('RGBA'), (px, py))

for key, (px, py, pw, ph) in placed.items():
    kind, rest = key.split(':', 1)
    if kind == 'ground':
        manifest[rest]['ground'] = [px, py, pw, ph]
    elif kind == 'road':
        manifest[rest]['roadTex'] = [px, py, pw, ph]
    else:
        biome, cls, _ = rest.split(':')
        manifest[biome]['props'].append({'cls': cls, 'r': [px, py, pw, ph]})

os.makedirs(a.out, exist_ok=True)
# The atlas is painted art with soft edges; a palette costs nothing visible
# and a great deal of file.
atlas = atlas.quantize(colors=256, method=Image.FASTOCTREE).convert('RGBA') \
             .quantize(colors=256, method=Image.FASTOCTREE)
atlas_path = os.path.join(a.out, 'props.png')
atlas.save(atlas_path, optimize=True)

data = os.path.join(ROOT, 'props-data.js')
with open(data, 'w') as f:
    f.write('/* GENERATED by tools/build-props.py — do not edit.\n'
            ' * Atlas rectangles for assets/props.png: per biome, a tileable\n'
            ' * ground patch, a road surface patch, and every painted prop.\n'
            ' */\n')
    f.write("'use strict';\nconst PROP_ATLAS = ")
    f.write(json.dumps(manifest, indent=1, sort_keys=True))
    f.write(';\n')

print(f'atlas  {atlas.size[0]}x{atlas.size[1]}  '
      f'{os.path.getsize(atlas_path):,} bytes -> {atlas_path}')
for name in sorted(manifest):
    m = manifest[name]
    n = len(m['props'])
    by = {}
    for p in m['props']:
        by[p['cls']] = by.get(p['cls'], 0) + 1
    print(f'  {name:<8} {n:>3} props  ' +
          '  '.join(f'{k}:{v}' for k, v in sorted(by.items())) +
          f"   road {m['road']} / {m['roadEdge']}")
print(f'manifest -> {data}')
print('\nThen: python3 tools/stamp-sw.py')
