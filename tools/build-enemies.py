#!/usr/bin/env python3
"""Build enemy sprite sheets from the asset pack's animation folders.

    python3 tools/build-enemies.py ~/art/Tower_5/PNG

The pack ships ten enemy types, each with seven animations of twenty frames —
1400 loose PNGs. The game uses four types and two animations, packed one sheet
per animation, because eighty loose frames is eighty requests.

Three things this does that matter:

  1. ONE bounding box per animation. Trimming each frame to its own content
     makes the sprite jitter as it plays, because the trim moves under it.
  2. Palette quantisation. These are painted sprites drawn at 110-250px;
     full-depth RGBA of them is mostly wasted bytes. 2.28MB -> 257KB.
  3. Frame subsampling. Twenty frames at 92ms is a two-second walk cycle; ten
     reads the same and halves the file.

Pick different types by editing PICK. The numbers are the pack's own folder
names; run with --contact to render a sheet of all ten and choose by eye.
"""
import argparse, glob, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

ap = argparse.ArgumentParser()
ap.add_argument('source', help="the pack's PNG dir, containing folders 1..10")
ap.add_argument('--out', default=os.path.normpath(os.path.join(HERE, '..', 'assets')))
ap.add_argument('--contact', action='store_true',
                help='render every type to a contact sheet and stop')
a = ap.parse_args()

# kind -> pack type number. Chosen so no two silhouettes can be confused:
# goblin, scorpion, ogre, horned demon.
PICK = {'grunt': 3, 'runner': 1, 'brute': 10, 'boss': 8}
# Sheet frame height, about 1.6x the height the game draws the kind at.
HEIGHT = {'grunt': 132, 'runner': 110, 'brute': 180, 'boss': 250}
ANIMS = {'walk': (10, 192), 'die': (8, 128)}      # frames, palette size

def frames_for(no, anim):
    return sorted(glob.glob(os.path.join(a.source, str(no),
                                         f'{no}_enemies_1_{anim}_*.png')))

if a.contact:
    from PIL import ImageDraw
    cells, CELL = [], 230
    for n in range(1, 11):
        fs = frames_for(n, 'walk')
        if fs: cells.append((n, Image.open(fs[len(fs)//2]).convert('RGBA')))
    sheet = Image.new('RGBA', (CELL*5, CELL*((len(cells)+4)//5)), (70,110,60,255))
    d = ImageDraw.Draw(sheet)
    for i, (n, im) in enumerate(cells):
        s = min((CELL-30)/im.width, (CELL-46)/im.height)
        r = im.resize((int(im.width*s), int(im.height*s)), Image.LANCZOS)
        sheet.alpha_composite(r, ((i%5)*CELL+(CELL-r.width)//2,
                                  (i//5)*CELL+(CELL-40-r.height)//2+10))
        d.text(((i%5)*CELL+8, (i//5)*CELL+CELL-32), f'type {n}  {im.size[0]}x{im.size[1]}',
               fill=(255,255,255,255))
    p = os.path.join(a.out, '..', 'enemy-types.png')
    sheet.save(p)
    print(f'wrote {os.path.normpath(p)} — pick four and edit PICK in this file')
    sys.exit(0)

total, made = 0, []
for kind, no in PICK.items():
    for anim, (nframes, colours) in ANIMS.items():
        fs = frames_for(no, anim)
        if not fs:
            print(f'  no {anim} frames for type {no} ({kind})'); continue
        fs = fs[::max(1, len(fs)//nframes)][:nframes]
        ims = [Image.open(f).convert('RGBA') for f in fs]

        box = None
        for im in ims:
            b = im.getbbox()
            if b:
                box = b if box is None else (min(box[0],b[0]), min(box[1],b[1]),
                                             max(box[2],b[2]), max(box[3],b[3]))
        ims = [im.crop(box) for im in ims]

        w, h = ims[0].size
        s = HEIGHT[kind] / h
        fw, fh = max(1, round(w*s)), max(1, round(h*s))
        out = Image.new('RGBA', (fw*len(ims), fh), (0,0,0,0))
        for i, im in enumerate(ims):
            out.alpha_composite(im.resize((fw, fh), Image.LANCZOS), (i*fw, 0))
        out = out.quantize(colors=colours, method=Image.FASTOCTREE).convert('RGBA') \
                 .quantize(colors=colours, method=Image.FASTOCTREE)

        name = f'enemy_{kind}_{anim}.png'
        out.save(os.path.join(a.out, name), optimize=True)
        n = os.path.getsize(os.path.join(a.out, name))
        total += n
        made.append((kind, anim, len(ims), fw, fh, n))
        print(f'{name:<26} {len(ims):>3} frames  {fw}x{fh}  {n:>7} bytes')

print(f'\ntotal {total:,} bytes ({total/1024:.0f} KB)')
print('\nENEMY_ART in game.js must match these frame counts:')
for kind in PICK:
    w = next((m for m in made if m[0]==kind and m[1]=='walk'), None)
    d = next((m for m in made if m[0]==kind and m[1]=='die'), None)
    if w:
        print(f"  {kind}: {{ walk:'enemy_{kind}_walk.png', die:'enemy_{kind}_die.png', "
              f"walkN:{w[2]}, dieN:{d[2] if d else 0} }},")
print('\nThen: python3 tools/stamp-sw.py')
