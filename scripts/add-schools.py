#!/usr/bin/env python3
"""Schools, colleges, universities and creches from the OSM PBF extract.
  osmium tags-filter -O -o /tmp/sch.pbf ../work/pbf/durban.osm.pbf nwr/amenity=school,college,university,kindergarten
  osmium export -O -f geojsonseq -o /tmp/sch.geojsonseq /tmp/sch.pbf
  python3 scripts/add-schools.py /tmp/sch.geojsonseq
Replaces the 'school' sites in src/data/durban-grounds.json (world metres)."""
import json, math, sys
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
xz = lambda lon, lat: [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]
def area(p):
    return abs(sum(p[i][0] * p[i-1][1] - p[i-1][0] * p[i][1] for i in range(len(p)))) / 2
src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/sch.geojsonseq'
out = []
for line in open(src):
    line = line.strip().lstrip('\x1e')
    if not line: continue
    f = json.loads(line)
    if f['geometry']['type'] != 'MultiPolygon': continue
    pr = f['properties']; am = pr.get('amenity')
    if am not in ('school', 'college', 'university', 'kindergarten'): continue
    best = None
    for poly in f['geometry']['coordinates']:
        ring = [xz(lon, lat) for lon, lat in poly[0]]
        if best is None or area(ring) > area(best): best = ring
    if not best or len(best) < 4: continue
    a = area(best)
    if a < 300 or a > (2000000 if am == 'university' else 400000): continue
    if best[0] == best[-1]: best = best[:-1]
    out.append({'k': 'school', 'n': pr.get('name', ''), 't': am, 'p': best})
p = 'src/data/durban-grounds.json'
d = json.load(open(p))
d['sites'] = [s for s in d['sites'] if s['k'] != 'school'] + out
json.dump(d, open(p, 'w'), separators=(',', ':'))
from collections import Counter
print(len(out), Counter(s['t'] for s in out), sum(1 for s in out if s['n']), 'named')
