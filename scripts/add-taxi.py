#!/usr/bin/env python3
"""Taxi ranks (amenity=taxi) from the OSM PBF extract.
  osmium tags-filter -O -o /tmp/taxi.pbf ../work/pbf/durban.osm.pbf nwr/amenity=taxi
  osmium export -O -f geojsonseq -o /tmp/taxi.geojsonseq /tmp/taxi.pbf
  python3 scripts/add-taxi.py /tmp/taxi.geojsonseq
Writes 'taxi' sites {k,n,c:[x,z]} into src/data/durban-grounds.json; unnamed ranks
are named after the nearest suburb; ranks within 70 m merge (named one wins)."""
import json, math, sys
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
xz = lambda lon, lat: [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]
src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/taxi.geojsonseq'
pts = []
for line in open(src):
    line = line.strip().lstrip('\x1e')
    if not line: continue
    f = json.loads(line); g = f['geometry']; pr = f['properties']
    if pr.get('amenity') != 'taxi': continue
    c = g['coordinates']
    flat = []
    def walk(a):
        if isinstance(a[0], (int, float)): flat.append(a)
        else:
            for b in a: walk(b)
    walk(c)
    lon = sum(p[0] for p in flat) / len(flat); lat = sum(p[1] for p in flat) / len(flat)
    pts.append({'n': pr.get('name', ''), 'c': xz(lon, lat)})
game = json.load(open('src/data/durban-game.json'))
subs = [(p['n'], xz(*p['c'])) for p in game['places'] if p['k'] in ('suburb', 'neighbourhood', 'quarter', 'town', 'city', 'village')]
out = []
for p in sorted(pts, key=lambda p: not p['n']):
    if any(math.dist(p['c'], q['c']) < 70 for q in out): continue
    if not p['n'] or p['n'].lower().startswith(('no.', 'taxi to', 'minibuses')):
        near = min(subs, key=lambda s: math.dist(s[1], p['c']))[0] if subs else 'Local'
        p['n'] = (p['n'] + ' — ' if p['n'] else '') + near + ' Taxi Rank' if not p['n'] else p['n']
    if 'rank' not in p['n'].lower() and not p['n'].lower().startswith(('no.', 'taxi to', 'minibuses')): p['n'] += ' Taxi Rank'
    out.append({'k': 'taxi', 'n': p['n'], 'c': p['c']})
pth = 'src/data/durban-grounds.json'
d = json.load(open(pth))
d['sites'] = [s for s in d['sites'] if s['k'] != 'taxi'] + out
json.dump(d, open(pth, 'w'), separators=(',', ':'))
print(len(out)); [print(o['n'], o['c']) for o in out]
