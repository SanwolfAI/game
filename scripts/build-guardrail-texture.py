#!/usr/bin/env python3
"""Draw src/assets/textures/guardrail_galv_512.jpg: galvanised steel with zinc
"spangle" crystals, faint rolling lines and weathering stains.

Made entirely in code for this game (CC0, this project). Needs only Pillow.
Tileable (all noise wraps at the edges). Run from the repo root:
    python3 scripts/build-guardrail-texture.py
"""
import math
import random
from PIL import Image, ImageFilter

S = 512
CELL = 24  # spangle grid cell (px); one crystal seed per cell
rnd = random.Random(20261126)

# --- spangle crystals: tileable Voronoi, each crystal its own grey ---------
n = S // CELL
seeds = {}
for gy in range(n):
    for gx in range(n):
        seeds[(gx, gy)] = (
            (gx + rnd.random()) * CELL,
            (gy + rnd.random()) * CELL,
            rnd.gauss(0, 1),
        )

img = Image.new("L", (S, S))
px = img.load()
for y in range(S):
    cy = y // CELL
    for x in range(S):
        cx = x // CELL
        best = 1e9
        best2 = 1e9
        tone = 0.0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                gx = (cx + dx) % n
                gy = (cy + dy) % n
                sx, sy, t = seeds[(gx, gy)]
                # unwrap the seed next to this pixel (tiling)
                ox = sx + ((cx + dx) - gx) * CELL
                oy = sy + ((cy + dy) - gy) * CELL
                d = (x - ox) ** 2 + (y - oy) ** 2
                if d < best:
                    best2 = best
                    best = d
                    tone = t
                elif d < best2:
                    best2 = d
        v = 172 + tone * 10
        # thin dark crystal borders
        edge = math.sqrt(best2) - math.sqrt(best)
        if edge < 1.2:
            v -= 10 * (1.2 - edge)
        px[x, y] = max(0, min(255, int(v)))

# --- rolling lines (horizontal, faint) ------------------------------------
lines = [rnd.gauss(0, 3) for _ in range(S)]
for y in range(S):
    for x in range(S):
        px[x, y] = max(0, min(255, int(px[x, y] + lines[y] + rnd.gauss(0, 2.5))))

# --- weathering: soft tileable blotches -----------------------------------
blot = Image.new("L", (S, S), 0)
bp = blot.load()
for _ in range(70):
    bx, by, r = rnd.random() * S, rnd.random() * S, 8 + rnd.random() * 22
    a = 25 + rnd.random() * 35
    for yy in range(int(by - r), int(by + r) + 1):
        for xx in range(int(bx - r), int(bx + r) + 1):
            d = math.hypot(xx - bx, yy - by) / r
            if d < 1:
                X, Y = xx % S, yy % S
                bp[X, Y] = min(255, int(bp[X, Y] + a * (1 - d) ** 2))
blot = blot.filter(ImageFilter.GaussianBlur(4))

base = img.filter(ImageFilter.GaussianBlur(0.5)).convert("RGB")
out = base.load()
bl = blot.load()
for y in range(S):
    for x in range(S):
        r, g, b = out[x, y]
        k = bl[x, y] / 255
        # cool zinc grey, stains slightly brown and darker
        r = r * (1 - 0.25 * k) + 120 * 0.25 * k
        g = g * (1 - 0.28 * k) + 108 * 0.28 * k
        b = b * (1 - 0.33 * k) + 96 * 0.33 * k
        out[x, y] = (int(r * 0.97), int(g * 0.99), int(min(255, b * 1.04)))

base.save("src/assets/textures/guardrail_galv_512.jpg", quality=86, optimize=True)
print("wrote src/assets/textures/guardrail_galv_512.jpg")
