#!/usr/bin/env python3
"""Builds the foliage atlas for the HD trees (src/world/trees.js).

Output (src/assets/hd/):
  foliage_atlas.jpg        1024x512 colour, JPG q82
  foliage_atlas_alpha.jpg  1024x512 alpha (used as alphaMap, green channel)

Layout (pixels, origin top-left):
  [0,512)    x [0,512)    broadleaf leaf clump (photo leaves composited)
  [512,1024) x [0,256)    palm frond, base on the left, tip on the right
  [512,768)  x [256,512)  bark (broadleaf trunks)
  [768,1024) x [256,512)  palm bark

Sources (all CC0):
  ambientCG LeafSet024 + LeafSet009 (1K-JPG): https://ambientcg.com/a/LeafSet024
  Poly Haven bark_brown_02, palm_bark diffuse 1k: https://polyhaven.com/a/bark_brown_02
Palm frond leaflets are drawn here (procedural).

Usage: python3 scripts/build-tree-atlas.py SRC_DIR
  SRC_DIR holds LeafSet024/, LeafSet009/ (unzipped) and bark_brown_02.jpg, palm_bark.jpg
"""
import math
import random
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/leaf'
OUT = 'src/assets/hd/'
rnd = random.Random(20261123)


def leaf_sprites(name, cols, rows):
    col = Image.open(f'{SRC}/{name}/{name}_1K-JPG_Color.jpg').convert('RGB')
    op = Image.open(f'{SRC}/{name}/{name}_1K-JPG_Opacity.jpg').convert('L')
    W, H = col.size
    out = []
    for r in range(rows):
        for c in range(cols):
            box = (c * W // cols, r * H // rows, (c + 1) * W // cols, (r + 1) * H // rows)
            a = op.crop(box)
            bb = a.point(lambda v: 255 if v > 100 else 0).getbbox()
            if not bb:
                continue
            a = a.crop(bb)
            rgb = col.crop(box).crop(bb)
            im = rgb.convert('RGBA')
            im.putalpha(a)
            out.append(im)
    return out


LEAVES = leaf_sprites('LeafSet024', 3, 3) + leaf_sprites('LeafSet009', 3, 2)
DARK = LEAVES[:9]  # beech-like, deep green: most of the clump


def tint(im, k, warm=0.0):
    r, g, b, a = im.split()
    r = r.point(lambda v: min(255, int(v * k * 0.78 * (1 + warm))))
    g = g.point(lambda v: min(255, int(v * k)))
    b = b.point(lambda v: min(255, int(v * k * 0.6 * (1 - warm * 1.5))))
    return Image.merge('RGBA', (r, g, b, a))


def clump(S=512):
    """A lumpy ball of overlapping leaves, darker inside/below, lit on top."""
    SS = S * 2
    canvas = Image.new('RGBA', (SS, SS), (0, 0, 0, 0))
    # lumpy outline: union of circles
    lobes = [(0.5, 0.52, 0.26)]
    for i in range(13):
        a = i / 13 * 6.283 + rnd.random() * 0.4
        d = 0.2 + rnd.random() * 0.12
        lobes.append((0.5 + math.cos(a) * d, 0.52 + math.sin(a) * d * 0.92, 0.08 + rnd.random() * 0.07))

    def inside(x, y):
        best = -1.0
        for cx, cy, r in lobes:
            v = 1 - math.hypot(x - cx, y - cy) / r
            best = max(best, v)
        return best  # >0 inside, 1 = centre of a lobe

    pts = []
    while len(pts) < 4200:
        x, y = rnd.random(), rnd.random()
        v = inside(x, y)
        # ragged edge: a few twigs of leaves poke out past the outline
        # sparse, ragged edge so the card outline never shows
        if v <= -0.35 or rnd.random() > min(1.0, 0.04 + max(v, 0.0) * 4.0) or (v <= 0 and rnd.random() < 0.6):
            continue
        v = max(v, 0.0)
        depth = rnd.random() * 0.6 + (1 - v) * 0.4  # outer leaves sit in front
        pts.append((depth, x, y, v))
    pts.sort()
    for depth, x, y, v in pts:
        src = rnd.choice(DARK)
        size = int(SS * (0.04 + rnd.random() * 0.03))
        w, h = src.size
        sc = size / max(w, h)
        im = src.resize((max(2, int(w * sc)), max(2, int(h * sc))), Image.LANCZOS)
        im = im.rotate(rnd.random() * 360, expand=True, resample=Image.BICUBIC)
        # light: top-left lit, bottom and inner leaves in shade
        light = 0.25 + 0.75 * depth ** 1.3 + 0.35 * (0.5 - y) - 0.12 * (x - 0.5)
        light = max(0.18, min(1.1, light)) * (0.85 + rnd.random() * 0.3)
        im = tint(im, light * 0.92, warm=(rnd.random() - 0.55) * 0.25)
        canvas.alpha_composite(im, (int(x * SS - im.width / 2), int(y * SS - im.height / 2)))
    return canvas.resize((S, S), Image.LANCZOS)


def frond(W=512, H=256):
    SS = 2
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, x1, cy = 8 * SS, (W - 6) * SS, H * SS / 2
    n = 58
    for side in (-1, 1):
        for i in range(n):
            t = i / (n - 1)
            bx = x0 + (x1 - x0) * t
            by = cy
            L = (H * SS * 0.47) * math.sin(math.pi * (0.12 + 0.88 * t)) ** 0.7 * (0.85 + rnd.random() * 0.25)
            ang = math.radians(38 + 18 * t)
            tx = bx + math.cos(ang) * L
            ty = by + side * math.sin(ang) * L
            wdt = (9 + 7 * (1 - t)) * SS
            nx, ny = -math.sin(ang) * side, math.cos(ang)
            g = int(70 + rnd.random() * 55 + 25 * (side > 0))
            colr = (int(g * 0.55), g, int(g * 0.25), 255)
            d.polygon([(bx - nx * wdt / 2, by - ny * wdt / 2 * side), (bx + nx * wdt / 2, by + ny * wdt / 2 * side), (tx, ty)], fill=colr)
    d.line([(x0, cy), (x1, cy)], fill=(120, 118, 60, 255), width=5 * SS)
    im = im.resize((W, H), Image.LANCZOS)
    return im


def bark(name, size=256):
    im = Image.open(f'{SRC}/{name}').convert('RGB').resize((size, size), Image.LANCZOS)
    im = im.convert('RGBA')
    return im


atlas = Image.new('RGBA', (1024, 512), (0, 0, 0, 0))
atlas.alpha_composite(clump(), (0, 0))
atlas.alpha_composite(frond(), (512, 0))
atlas.alpha_composite(bark('bark_brown_02.jpg'), (512, 256))
atlas.alpha_composite(bark('palm_bark.jpg'), (768, 256))

# colour: bleed leaf colour into transparent texels so mipmaps don't darken edges
rgb = Image.new('RGB', atlas.size, (52, 78, 30))
blur = atlas.filter(ImageFilter.GaussianBlur(6))
rgb.paste(blur.convert('RGB'), (0, 0), blur.split()[3].point(lambda v: 255 if v > 4 else 0))
rgb.paste(atlas.convert('RGB'), (0, 0), atlas.split()[3])
rgb.save(OUT + 'foliage_atlas.jpg', quality=82, optimize=True)
alpha = atlas.split()[3]
Image.merge('RGB', (alpha, alpha, alpha)).save(OUT + 'foliage_atlas_alpha.jpg', quality=88, optimize=True)
print('ok', len(LEAVES), 'leaf sprites')


def tuft(W=256, H=128):
    """Grass tuft card for the instanced tufts near the camera (procedural)."""
    SS = 3
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for i in range(110):
        bx = (0.06 + rnd.random() * 0.88) * W * SS
        h = (0.35 + rnd.random() * 0.63) * H * SS
        lean = (rnd.random() - 0.5) * 0.9 + (bx / (W * SS) - 0.5) * 0.8
        w = (2.2 + rnd.random() * 2.2) * SS
        g = 70 + rnd.random() * 70
        base = (int(g * 0.42), int(g * 0.8), int(g * 0.22), 255)
        tip = (int(g * 0.62 + 14), int(g * 1.12 + 18), int(g * 0.34), 255)
        segs = 8
        pts_l, pts_r = [], []
        for k in range(segs + 1):
            t = k / segs
            x = bx + lean * h * t * t
            y = H * SS - h * t
            ww = w * (1 - t) + 0.4
            pts_l.append((x - ww / 2, y))
            pts_r.append((x + ww / 2, y))
        # two-tone blade: darker base half, lighter tip half
        mid = segs // 2
        d.polygon(pts_l[: mid + 1] + pts_r[: mid + 1][::-1], fill=base)
        d.polygon(pts_l[mid:] + pts_r[mid:][::-1], fill=tip)
    return im.resize((W, H), Image.LANCZOS)


tf = tuft()
tf.save(OUT + 'grass_tuft.png', optimize=True)
print('tuft ok')
