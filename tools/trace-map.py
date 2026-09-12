#!/usr/bin/env python3
"""Derive a map's enemy path and build pads from the map art itself.

    python3 tools/trace-map.py assets/map2.jpg --out map2

Hand-placed waypoints drift off the road the moment the art changes, and
hand-placed pads end up on huts and in ponds. This reads the road straight out
of the image by colour-keying the sand, reports where the road actually is, and
proposes pads that sit on the verge.

It prints a column profile first: for each x, the y-bands that are road. Read
that to work out the route, then pass your waypoints back in with --path to
have them checked (the centreline must be ~100% on road) and to get pads.

Pad distance is the single most important number in the balance. Pads 92-168px
off the centreline gave a 190-range tower a ~160px slice of road and two shots
per passing enemy, which made hard unwinnable for geometric reasons. 66-118px
is the band that works.
"""
import argparse, json, math, sys
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('image')
ap.add_argument('--out', help='write <out>.json next to the image')
ap.add_argument('--path', help='JSON list of [x,y] waypoints to verify and pad')
ap.add_argument('--near', type=float, default=66.0, help='min pad distance from road')
ap.add_argument('--far', type=float, default=118.0, help='max pad distance from road')
ap.add_argument('--sep', type=float, default=128.0, help='min distance between pads')
ap.add_argument('--pads', type=int, default=12)
ap.add_argument('--exclude', default='[]',
                help='JSON list of [x0,y0,x1,y1] boxes towers may not occupy')
ap.add_argument('--overlay', help='write an overlay PNG for eyeballing')
a = ap.parse_args()

im = Image.open(a.image).convert('RGB')
W, H = im.size
px = im.load()

def is_road(x, y):
    r, g, b = px[x, y]
    return r > 175 and g > 150 and b < 165 and r >= g and (r - b) > 45

def is_water(x, y):
    r, g, b = px[x, y]
    return b > 140 and b > r + 35 and b > g + 15

if not a.path:
    print(f'{a.image}: {W}x{H}\nroad bands by column (x: [(y0,y1), ...]):')
    for x in range(0, W, 32):
        runs, start = [], None
        for y in range(H):
            on = is_road(x, y)
            if on and start is None:
                start = y
            elif not on and start is not None:
                if y - start > 25:
                    runs.append((start, y))
                start = None
        if start is not None and H - start > 25:
            runs.append((start, H))
        print(f'  {x:>5}: {runs}')
    print('\nWork out the route from those bands, then re-run with '
          '--path \'[[0,680],[210,680],...]\'')
    sys.exit(0)

PATH = json.loads(a.path)
EXCLUDE = json.loads(a.exclude)

def dist_to_path(x, y):
    best = 1e9
    for i in range(len(PATH) - 1):
        ax, ay = PATH[i]; bx, by = PATH[i + 1]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0 if L == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L))
        best = min(best, math.hypot(x - (ax + dx * t), y - (ay + dy * t)))
    return best

# 1. The centreline must lie on road, or enemies walk through the scenery.
off = tot = 0
for i in range(len(PATH) - 1):
    ax, ay = PATH[i]; bx, by = PATH[i + 1]
    n = max(1, int(math.hypot(bx - ax, by - ay) / 4))
    for k in range(n):
        t = k / n
        x = min(W - 1, max(0, int(ax + (bx - ax) * t)))
        y = min(H - 1, max(0, int(ay + (by - ay) * t)))
        tot += 1
        if not is_road(x, y):
            off += 1
print(f'centreline on road: {100 * (tot - off) / tot:.1f}%  ({off}/{tot} off)')
if off / tot > 0.02:
    print('  ^ fix the waypoints before going further.')

path_len = sum(math.hypot(PATH[i+1][0]-PATH[i][0], PATH[i+1][1]-PATH[i][1])
               for i in range(len(PATH) - 1))
print(f'path length: {path_len:.0f}px')

# 2. Pads: on the verge, on buildable ground, spread out, nearest-first.
def blocked(x, y):
    for (x0, y0, x1, y1) in EXCLUDE:
        if x0 < x < x1 and y0 < y < y1:
            return True
    for oy in range(-38, 39, 9):
        for ox in range(-38, 39, 9):
            xx = min(W - 1, max(0, x + ox)); yy = min(H - 1, max(0, y + oy))
            if is_road(xx, yy) or is_water(xx, yy):
                return True
    return False

cands = []
for y in range(110, H - 80, 12):
    for x in range(60, W - 60, 12):
        d = dist_to_path(x, y)
        if a.near < d < a.far and not blocked(x, y):
            cands.append((x, y, d))

pads = []
for x, y, d in sorted(cands, key=lambda c: c[2]):
    if all(math.hypot(x - p[0], y - p[1]) > a.sep for p in pads):
        pads.append((x, y))
    if len(pads) >= a.pads:
        break
pads.sort()
print(f'pads ({len(pads)}): {[list(p) for p in pads]}')

for R in (175, 190, 225):
    on = tot = 0
    for i in range(len(PATH) - 1):
        ax, ay = PATH[i]; bx, by = PATH[i + 1]
        n = max(1, int(math.hypot(bx - ax, by - ay) / 5))
        for k in range(n):
            t = k / n; x = ax + (bx - ax) * t; y = ay + (by - ay) * t
            tot += 1
            if any(math.hypot(x - p[0], y - p[1]) <= R for p in pads):
                on += 1
    print(f'  route covered at range {R}: {100 * on / tot:.0f}%')

if a.out:
    with open(a.out + '.json', 'w') as f:
        json.dump({'path': PATH, 'pads': [list(p) for p in pads]}, f, indent=1)
    print(f'wrote {a.out}.json')

if a.overlay:
    from PIL import ImageDraw
    ov = im.copy(); dr = ImageDraw.Draw(ov, 'RGBA')
    dr.line([tuple(p) for p in PATH], fill=(255, 40, 40, 255), width=7)
    for p in PATH:
        dr.ellipse([p[0]-5, p[1]-5, p[0]+5, p[1]+5], fill=(255, 255, 0, 255))
    for i, (x, y) in enumerate(pads):
        dr.ellipse([x-40, y-40, x+40, y+40], fill=(0, 120, 255, 90),
                   outline=(255, 255, 255, 255), width=4)
        dr.text((x-4, y-6), str(i), fill=(255, 255, 255, 255))
    ov.save(a.overlay)
    print(f'wrote {a.overlay} — look at it before trusting any of the above')
