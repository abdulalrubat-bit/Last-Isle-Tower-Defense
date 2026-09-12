#!/usr/bin/env python3
"""Build assets/ from the original art.

    python3 tools/build-assets.py <source-dir> [--out assets] [--dry-run]

The pack this game came from shipped every UI sprite as a JPEG mislabelled
`data:image/png`, inlined as base64 into one 12.7MB HTML file. JPEG has no
alpha, so every button carried an opaque black square, and the CSS worked
around it with `mix-blend-mode:screen` on nearly every rule — which only
looks right over a dark background and washes out the colour.

This does three things instead:

  1. Alpha. Art that already has an alpha channel is used as-is. Art delivered
     flat on black is keyed: black surround to transparent, everything above
     the knee fully opaque, a short ramp across the antialiased edge. The
     tempting inverse — alpha = max(r,g,b), colour un-premultiplied — is only
     correct if every dark pixel really was semi-transparent, and it is not:
     it rendered the tray and the START button nearly invisible.
  2. Size. Each asset is capped near twice its largest on-screen size.
  3. Deduplication. The pack had six byte-identical copies of one 328KB
     background under six names.

Together: 12.7MB of inline base64 down to ~1.1MB of cacheable files.

With the original layered art, prefer exporting PNGs WITH alpha — then step 1
is a no-op and nothing is inferred.
"""
import argparse, hashlib, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

ap = argparse.ArgumentParser()
ap.add_argument('source', help='directory of original art')
ap.add_argument('--out', default=os.path.join(HERE, '..', 'assets'))
ap.add_argument('--manifest', default=os.path.join(HERE, 'assets.json'))
ap.add_argument('--dry-run', action='store_true')
ap.add_argument('--list', action='store_true',
                help='print what filenames each output accepts, and stop')
a = ap.parse_args()

spec = json.load(open(a.manifest))
os.makedirs(a.out, exist_ok=True)

# Black surround -> alpha. Below LO is gone, above HI is solid, between is the
# antialiased edge. LO is low on purpose so dark *art* stays opaque.
LO, HI = 10, 46

def key_black(im):
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            luma = max(r, g, b)
            if luma <= LO:
                px[x, y] = (0, 0, 0, 0)
            elif luma >= HI:
                px[x, y] = (r, g, b, 255)
            else:
                px[x, y] = (r, g, b, int(255 * (luma - LO) / (HI - LO)))
    return im

def fit(im, cap):
    w, h = im.size
    if max(w, h) <= cap:
        return im
    s = cap / max(w, h)
    return im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)

def find(src_name, out_name):
    """Accept either the original pack's filename or the game's own.

    You should not have to remember that the game's tower_bolt.png came from
    the pack's tower_lightning.png. Either spelling works, and so does any
    extension: hand it a .psd export named tower_bolt.png and it is found.
    """
    want = {os.path.splitext(src_name)[0], os.path.splitext(out_name)[0]}
    for f in sorted(os.listdir(a.source)):
        if os.path.splitext(f)[0] in want:
            return os.path.join(a.source, f)
    return None

seen, total, missing = {}, 0, []

if a.list:
    print(f'{"output file":<22} {"accepts either of":<46} cap')
    for group in ('opaque', 'sprite'):
        for src, (dst, cap) in spec[group].items():
            names = dst if src == dst else f'{src}  or  {dst}'
            print(f'{dst:<22} {names:<46} {cap}')
    print('\nAny extension works (.png .psd export .webp ...). Alpha is used '
          'as-is;\nart flat on black is keyed. Drop in as few or as many as '
          'you like:\nanything absent keeps the file the game already ships.')
    sys.exit(0)

for src, (dst, cap) in spec['opaque'].items():
    p = find(src, dst)
    if not p:
        missing.append(src); continue
    im = fit(Image.open(p).convert('RGB'), cap)
    out = os.path.join(a.out, dst)
    if not a.dry_run:
        im.save(out, 'JPEG', quality=84, optimize=True, progressive=True)
    n = os.path.getsize(out) if os.path.exists(out) else 0
    total += n
    print(f'{n:>8}  {str(im.size):<12} {dst}  (opaque)')

for src, (dst, cap) in spec['sprite'].items():
    p = find(src, dst)
    if not p:
        missing.append(src); continue
    digest = hashlib.md5(open(p, 'rb').read()).hexdigest()
    if digest in seen:
        print(f'{"":>8}  {"":<12} {dst}  -> duplicate of {seen[digest]}')
    seen.setdefault(digest, dst)

    im = Image.open(p)
    has_alpha = im.mode in ('RGBA', 'LA') or 'transparency' in im.info
    im = fit(im.convert('RGBA'), cap) if has_alpha else key_black(fit(im, cap))
    # Painted UI art survives 256 colours; full-depth RGBA of it is wasted bytes.
    if dst.startswith(('hdr_', 'card_', 'btn_', 'art_', 'bar_', 'skull',
                       'tray', 'window')):
        im = im.quantize(colors=256, method=Image.FASTOCTREE).convert('RGBA') \
               .quantize(colors=256, method=Image.FASTOCTREE)
    out = os.path.join(a.out, dst)
    if not a.dry_run:
        im.save(out, 'PNG', optimize=True)
    n = os.path.getsize(out) if os.path.exists(out) else 0
    total += n
    print(f'{n:>8}  {str(im.size):<12} {dst}  ({"alpha" if has_alpha else "keyed"})')

done = len(spec['opaque']) + len(spec['sprite']) - len(missing)
print(f'\nreplaced {done} file(s), {total:,} bytes ({total / 1048576:.2f} MB)')
if missing:
    # Not an error. Dropping in five files and leaving the other forty as they
    # are is the normal way to do this, so the run succeeds and says what it
    # left alone.
    print(f'\nkept the shipped version of {len(missing)} file(s) not found '
          f'in {a.source}:')
    for m in missing:
        print('  ' + m)
    print('\nRun with --list to see every filename this accepts.')
if not a.dry_run and done:
    print('\nNow: python3 tools/stamp-sw.py   (or the update will not reach '
          'installed players)')
