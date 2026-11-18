#!/usr/bin/env python3
"""Hospital / clinic / police / fire-station grounds from OSM.
Input: Overpass `out geom` dump of amenity=hospital|clinic|police|fire_station
ways + hospital|police relations (default ../work/osm-grounds.json).
Output: src/data/durban-grounds.json  {sites:[{k,n,p:[[x,z],...]}]} in world
metres (same projection as src/core/geo.js). Police stations that OSM only
maps as a point (src/data/durban-landmarks.json) get {k,n,c:[x,z]} and the
game builds a standard compound for them."""
import json, math, sys
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
xz = lambda lon, lat: [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]
src = sys.argv[1] if len(sys.argv) > 1 else '../work/osm-grounds.json'
sites = []
def area(p):
    return abs(sum(p[i][0] * p[i-1][1] - p[i-1][0] * p[i][1] for i in range(len(p)))) / 2
def join(ways):
    # stitch member ways into rings, return the largest
    ways = [w[:] for w in ways if len(w) > 1]; rings = []
    while ways:
        r = ways.pop(0)
        changed = True
        while changed and r[0] != r[-1]:
            changed = False
            for i, w in enumerate(ways):
                if w[0] == r[-1]: r += w[1:]
                elif w[-1] == r[-1]: r += w[::-1][1:]
                elif w[-1] == r[0]: r = w[:-1] + r
                elif w[0] == r[0]: r = w[::-1][:-1] + r
                else: continue
                ways.pop(i); changed = True; break
        rings.append(r)
    return max(rings, key=area) if rings else None
K = {'hospital': 'hospital', 'clinic': 'clinic', 'police': 'police', 'fire_station': 'fire'}
for e in json.load(open(src))['elements']:
    t = e['tags']; k = K.get(t.get('amenity'))
    if not k: continue
    if e['type'] == 'way':
        ring = [xz(g['lon'], g['lat']) for g in e['geometry']]
    else:
        ring = join([[xz(g['lon'], g['lat']) for g in m['geometry']] for m in e['members'] if m.get('role') == 'outer' and m.get('geometry')])
    if not ring or len(ring) < 4: continue
    if ring[0] != ring[-1]: ring.append(ring[0])
    a = area(ring)
    if a < 150 or a > 400000: continue
    sites.append({'k': k, 'n': t.get('name', ''), 'p': ring[:-1]})
lm = json.load(open('src/data/durban-landmarks.json'))['landmarks']
for l in lm:
    if l.get('k') != 'police': continue
    if any(s['k'] == 'police' and 'p' in s and min(math.hypot(px - l['x'], pz - l['z']) for px, pz in s['p']) < 150 for s in sites): continue
    sites.append({'k': 'police', 'n': l.get('n', ''), 'c': [round(l['x'], 1), round(l['z'], 1)]})
json.dump({'source': 'OpenStreetMap contributors (ODbL)', 'sites': sites}, open('src/data/durban-grounds.json', 'w'), separators=(',', ':'))
from collections import Counter
print(len(sites), Counter((s['k'], 'p' in s) for s in sites))
