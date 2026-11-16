# Packs the SADC sign PNGs (Wikimedia Commons, public domain) into one atlas
# so every small road sign in the game is a single instanced draw call.
# Order must match SIGN_TILES in src/world/props.js. Run: python3 scripts/build-sign-atlas.py
from PIL import Image
ORDER = ['r1', 'r2', 'w301', 'w306', 'w318', 'r201-40', 'r201-60', 'r201-80',
         'r201-100', 'r201-120', 'r3', 'r217', 'r213', 'r216', 'r309', 'w302',
         'w303', 'w307', 'w308', 'w332', 'w211', 'w309']
T, COLS, ROWS = 128, 8, 4
atlas = Image.new('RGBA', (T * COLS, T * ROWS), (0, 0, 0, 0))
for i, name in enumerate(ORDER):
    im = Image.open(f'src/assets/signs/{name}.png').convert('RGBA')
    s = (T - 4) / max(im.size)
    im = im.resize((max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s))), Image.LANCZOS)
    x = (i % COLS) * T + (T - im.size[0]) // 2
    y = (i // COLS) * T + (T - im.size[1]) // 2
    atlas.paste(im, (x, y), im)
atlas.save('src/assets/signs/atlas.png', optimize=True)
print(len(ORDER), 'tiles')
