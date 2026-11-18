#!/usr/bin/env python3
"""work/osm-harbour.json (Overpass: man_made=pier/breakwater/crane, beaches,
lighthouses around Durban) -> src/data/durban-harbour.json.
Coordinates in local metres (geo.js projection), rounded to 0.1 m."""
import json, math, sys
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
def xz(lon, lat): return [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]
src = sys.argv[1] if len(sys.argv) > 1 else 'work/osm-harbour.json'
out = sys.argv[2] if len(sys.argv) > 2 else 'game/src/data/durban-harbour.json'
els = json.load(open(src))['elements']
res = {'piers': [], 'breakwaters': [], 'beaches': [], 'lights': [], 'cranes': []}
for e in els:
    t = e.get('tags', {})
    if e['type'] == 'node':
        if t.get('man_made') == 'lighthouse': res['lights'].append({'n': t.get('name', ''), 'p': xz(e['lon'], e['lat'])})
        continue
    g = e.get('geometry') or []
    if len(g) < 2: continue
    pts = [xz(p['lon'], p['lat']) for p in g]
    mm = t.get('man_made'); nat = t.get('natural')
    if mm == 'pier': res['piers'].append({'n': t.get('name', ''), 'c': g[0] == g[-1], 'p': pts})
    elif mm == 'breakwater': res['breakwaters'].append(pts)
    elif mm == 'crane': res['cranes'].append(pts)
    elif nat == 'beach': res['beaches'].append({'n': t.get('name', ''), 'p': pts})
json.dump(res, open(out, 'w'), separators=(',', ':'))
print({k: len(v) for k, v in res.items()})
