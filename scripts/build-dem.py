# Real terrain for IZK: SRTM-derived AWS Terrain Tiles (terrarium PNG, public,
# https://registry.opendata.aws/terrain-tiles/ ; credit: Mapzen / AWS, SRTM/NASA).
# Writes src/data/durban-dem.bin (Int16, metres*4, row-major north->south)
# and src/data/durban-dem.json (grid meta).
import math, json, os, urllib.request, io, struct
from PIL import Image
import numpy as np
LON0, LON1, LAT0, LAT1 = 30.70, 31.15, -30.30, -29.55   # west, east, south, north
Z = 12
DLON, DLAT = 0.0008, 0.0007
def tile(lon, lat):
    n = 2 ** Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y
x0, y0 = tile(LON0, LAT1); x1, y1 = tile(LON1, LAT0)
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
W = (tx1 - tx0 + 1) * 256; H = (ty1 - ty0 + 1) * 256
mosaic = np.zeros((H, W), np.float32)
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        fn = f'/tmp/dem/{Z}_{tx}_{ty}.png'
        if not os.path.exists(fn):
            urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png', fn)
        a = np.asarray(Image.open(fn).convert('RGB')).astype(np.float32)
        h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = h
cols = int(round((LON1 - LON0) / DLON)) + 1
rows = int(round((LAT1 - LAT0) / DLAT)) + 1
out = np.zeros((rows, cols), np.float32)
for r in range(rows):
    lat = LAT1 - r * DLAT
    for c in range(cols):
        lon = LON0 + c * DLON
        px, py = tile(lon, lat)
        fx = (px - tx0) * 256 - 0.5; fy = (py - ty0) * 256 - 0.5
        ix, iy = int(fx), int(fy); u, v = fx - ix, fy - iy
        m = mosaic
        out[r, c] = (m[iy, ix] * (1 - u) + m[iy, ix + 1] * u) * (1 - v) + (m[iy + 1, ix] * (1 - u) + m[iy + 1, ix + 1] * u) * v
q = np.clip(np.round(out * 4), -32768, 32767).astype('<i2')
q.tofile('src/data/durban-dem.bin')
json.dump({'lon0': LON0, 'lat1': LAT1, 'dlon': DLON, 'dlat': DLAT, 'cols': cols, 'rows': rows, 'scale': 0.25,
           'source': 'AWS Terrain Tiles (Mapzen terrarium, SRTM) z12'}, open('src/data/durban-dem.json', 'w'))
print(cols, rows, out.min(), out.max())
for name, lon, lat in [('CBD', 31.0218, -29.8587), ('Berea', 31.0055, -29.862), ('Pinetown', 30.857, -29.815), ('Kloof', 30.83, -29.79), ('Umlazi', 30.89, -29.965), ('Amanzimtoti', 30.88, -30.05), ('uMngeni Blue Lagoon', 31.035, -29.81)]:
    c = int(round((lon - LON0) / DLON)); r = int(round((LAT1 - lat) / DLAT)); print(name, round(float(out[r, c]), 1))
