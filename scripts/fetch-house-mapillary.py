# Sample Mapillary street photos on residential streets of each house-style
# area, so the looks in src/data/durban-house-styles.json can be re-checked
# (wall colour/finish, roof type and colour, boundary walls and fences).
#
# 1. For each area, find the 300 m squares with the most small OSM house
#    footprints (src/data/durban-buildings.bin, 25-350 m2).
# 2. Ask Mapillary for images in those squares and keep images with 5+ house
#    footprints within 30 m, at least 120 m apart (16 per area).
# 3. Download thumb_1024 to /tmp/mly-houses/<area>__<id>.jpg (NOT the repo:
#    photos are CC BY-SA and only derived attributes are committed) and write
#    /tmp/mly-houses/picks.json. Look at them and update the JSON by hand.
#
# Needs graph.mapillary.com with an "Authorization: OAuth MLY|..." header
# (injected by the Hark proxy; never commit a token).
# Run from the repo root: python3 scripts/fetch-house-mapillary.py
import json, math, os, struct, urllib.request, concurrent.futures as cf

C_LON, C_LAT = 31.0218, -29.8587
M_LON = 111320 * math.cos(math.radians(C_LAT))
M_LAT = 110574
to_xz = lambda lon, lat: ((lon - C_LON) * M_LON, -(lat - C_LAT) * M_LAT)
to_ll = lambda x, z: (C_LON + x / M_LON, C_LAT - z / M_LAT)
OUT = '/tmp/mly-houses'
os.makedirs(OUT, exist_ok=True)


def footprints():
    b = open('src/data/durban-buildings.bin', 'rb').read()
    assert b[:4] == b'IZKB'
    count, dc = struct.unpack_from('<II', b, 8)
    o = 16 + count * 3
    npts = b[o:o + count]
    o += count + count * 2
    o = (o + 3) & ~3
    start = struct.unpack_from(f'<{count * 2}i', b, o)
    o += count * 8
    delta = struct.unpack_from(f'<{dc * 2}h', b, o)
    out, d = [], 0
    for i in range(count):
        n = npts[i]
        x, z = start[2 * i], start[2 * i + 1]
        xs, zs = [x], [z]
        for k in range(1, n):
            x += delta[(d + k - 1) * 2]
            z += delta[(d + k - 1) * 2 + 1]
            xs.append(x)
            zs.append(z)
        d += n - 1
        a2 = sum(xs[k] * zs[(k + 1) % n] - xs[(k + 1) % n] * zs[k] for k in range(n))
        out.append((sum(xs) / n / 10, sum(zs) / n / 10, abs(a2) / 200))
    return out


def main():
    styles = json.load(open('src/data/durban-house-styles.json'))['areas']
    B = [b for b in footprints() if 25 < b[2] < 350]
    grid = {}
    for b in B:
        grid.setdefault((int(b[0] // 50), int(b[1] // 50)), []).append(b)

    def near(x, z, r=30):
        n = 0
        for gx in range(int((x - r) // 50), int((x + r) // 50) + 1):
            for gz in range(int((z - r) // 50), int((z + r) // 50) + 1):
                for b in grid.get((gx, gz), ()):
                    n += math.hypot(b[0] - x, b[1] - z) < r
        return n

    picks = {}
    for a in styles:
        ax, az = to_xz(a['lon'], a['lat'])
        cnt = {}
        for b in B:
            if math.hypot(b[0] - ax, b[1] - az) < a['r']:
                k = (int(b[0] // 300), int(b[1] // 300))
                cnt[k] = cnt.get(k, 0) + 1
        imgs = []
        for (gx, gz), _ in sorted(cnt.items(), key=lambda kv: -kv[1])[:8]:
            lo0, la1 = to_ll(gx * 300, gz * 300)
            lo1, la0 = to_ll(gx * 300 + 300, gz * 300 + 300)
            url = f'https://graph.mapillary.com/images?bbox={lo0:.5f},{la0:.5f},{lo1:.5f},{la1:.5f}&limit=800&fields=id,computed_geometry,geometry,compass_angle,captured_at,thumb_1024_url'
            try:
                imgs += json.load(urllib.request.urlopen(url, timeout=60))['data']
            except Exception as e:
                print(a['id'], 'query failed', e)
        scored = []
        for im in imgs:
            lon, lat = (im.get('computed_geometry') or im['geometry'])['coordinates']
            x, z = to_xz(lon, lat)
            scored.append((near(x, z), x, z, im))
        scored.sort(key=lambda s: -s[0])
        chosen = []
        for n, x, z, im in scored:
            if n < 5 or len(chosen) >= 16:
                break
            if all(math.hypot(x - c[1], z - c[2]) > 120 for c in chosen):
                chosen.append((n, x, z, im))
        picks[a['id']] = [{'id': im['id'], 'houses': n, 'x': round(x, 1), 'z': round(z, 1), 'compass': im.get('compass_angle'), 'url': im['thumb_1024_url']} for n, x, z, im in chosen]
        print(a['id'], len(chosen))

    def get(job):
        area, p = job
        path = f"{OUT}/{area}__{p['id']}.jpg"
        if not os.path.exists(path):
            urllib.request.urlretrieve(p['url'], path)
    with cf.ThreadPoolExecutor(8) as ex:
        list(ex.map(get, [(k, p) for k, v in picks.items() for p in v]))
    json.dump(picks, open(f'{OUT}/picks.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
