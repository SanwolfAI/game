#!/usr/bin/env python3
"""Bus / taxi stop shelters -> src/data/durban-shelters.json (drawn by src/world/shelters.js).

Sources:
 - OSM (Overpass, (c) OpenStreetMap contributors, ODbL): highway=bus_stop + shelter=yes,
   and amenity=shelter + shelter_type=public_transport. Query (bbox of the game map):
     [out:json];(node["highway"="bus_stop"](-30.11,30.80,-29.63,31.08);
                 nwr["amenity"="shelter"](-30.11,30.80,-29.63,31.08););out center tags;
 - Bus stops OSM does not tag with shelter=yes but where a Mapillary street photo
   (CC BY-SA) clearly shows a shelter: MAPILLARY_SEEN below (OSM node -> photo id).
 - Red Hill shelter on the north corridor (named by the owner, src/game/fares.js).
Only stops within 60 m of a game road are kept (the shelter is snapped to the kerb
at runtime). Shelters closer than 12 m to each other are merged.
usage: python3 scripts/add-shelters.py overpass.json"""
import json, math, sys
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
xz = lambda lon, lat: [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]

# OSM bus_stop node id -> Mapillary image id showing the shelter (Phoenix area, checked by eye)
# (2998142814 Durban North, shelter=yes, is the reference photo for the blue municipal style: 2827642110693857)
MAPILLARY_SEEN = {7981039043: '485985166176182', 7981039044: '3895993910521973'}
EXTRA = [{'n': 'Red Hill shelter', 'c': [99.3, -8819.0], 's': 'owner'}]

g = json.load(open('src/data/durban-game.json'))
cell = {}
for r in g['roads']:
    if r['h'] in ('footway', 'path', 'service', 'track', 'steps', 'cycleway', 'pedestrian'): continue
    P = [xz(*p) for p in r['p']]
    for a, b in zip(P, P[1:]):
        cell.setdefault((int(a[0] // 100), int(a[1] // 100)), []).append((a, b))
def road_dist(x, z):
    best = 1e9
    cx, cz = int(x // 100), int(z // 100)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for a, b in cell.get((cx + i, cz + j), []):
                dx, dz = b[0] - a[0], b[1] - a[1]; L = dx * dx + dz * dz or 1
                t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L))
                best = min(best, math.hypot(a[0] + t * dx - x, a[1] + t * dz - z))
    return best

out = []
for e in json.load(open(sys.argv[1]))['elements']:
    t = e.get('tags', {})
    lat = e.get('lat') or e['center']['lat']; lon = e.get('lon') or e['center']['lon']
    if t.get('highway') == 'bus_stop' and (t.get('shelter') == 'yes' or e['id'] in MAPILLARY_SEEN):
        s = 'osm' if t.get('shelter') == 'yes' else 'mapillary'
    elif t.get('amenity') == 'shelter' and t.get('shelter_type') == 'public_transport':
        s = 'osm'
    else:
        continue
    c = xz(lon, lat)
    if road_dist(*c) > 60: continue
    if any(math.hypot(o['c'][0] - c[0], o['c'][1] - c[1]) < 12 for o in out): continue
    out.append({'n': t.get('name', ''), 'c': c, 's': s})
for x in EXTRA:
    if not any(math.hypot(o['c'][0] - x['c'][0], o['c'][1] - x['c'][1]) < 12 for o in out): out.append(x)
json.dump({'shelters': out}, open('src/data/durban-shelters.json', 'w'), separators=(',', ':'))
print(len(out), 'shelters')
for o in out: print(o['s'], o['n'] or '-', o['c'])
