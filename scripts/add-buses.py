#!/usr/bin/env python3
"""Bus stations and depots from OSM amenity=bus_station (osmium export of the
Durban extract, work/bus/bs.geojsonseq) -> src/data/durban-buses.json.
k: 'coach' long-distance coach terminal (Intercape/Greyhound/Translux/SA Road
Link/Margate Coach cluster at Durban Station), 'coachstop' a coach stop
elsewhere, 'city' a city bus station or depot. 'Taxi to ...' points skipped.
Alice Street Bus Sheds (Durban Transport depot, 88 Johannes Nkosi St) is named
from its Google/OSM location since OSM tags it as 'Durban Metro Bus Service'."""
import json, math, sys
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
xz = lambda lon, lat: [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]
g = json.load(open('src/data/durban-game.json'))
subs = [(p['n'], xz(*p['c'])) for p in g['places'] if p['k'] in ('suburb', 'neighbourhood', 'quarter', 'town')]
feats = [json.loads(l.strip('\x1e')) for l in open(sys.argv[1])]
COACH = ('Intercape', 'Greyhound', 'Trans Lux', 'SA Road Link', 'Margate Coach Durban Station Stop')
out = []
coach = []
for f in feats:
    p = f['properties']; n = p.get('name') or ''
    if n.startswith('Taxi to'): continue
    gm = f['geometry']; t = gm['type']
    if t == 'Point':
        lon, lat = gm['coordinates']
        if n in COACH: coach.append((lon, lat)); continue
        k = 'coachstop' if n.startswith('Margate Coach') else 'city'
        out.append({'k': k, 'n': n.replace('Margate Coach ', 'Coach: '), 'c': xz(lon, lat)})
        continue
    if t == 'LineString': continue  # same ways come again as polygons
    ring = gm['coordinates'][0][0] if t == 'MultiPolygon' else gm['coordinates'][0]
    pts = [xz(a, b) for a, b in ring]
    cx = sum(q[0] for q in pts) / len(pts); cz = sum(q[1] for q in pts) / len(pts)
    if 'Margate' in n: out.append({'k': 'coachstop', 'n': n.replace('Margate Coach ', 'Coach: '), 'c': [round(cx, 1), round(cz, 1)]}); continue
    if not n or n == 'Durban Metro Bus Service':
        near = min(subs, key=lambda s: math.hypot(s[1][0] - cx, s[1][1] - cz))
        n = n or f'{near[0]} Bus Station'
    if n == 'Durban Metro Bus Service' and math.hypot(cx - xz(31.0140, -29.8530)[0], cz - xz(31.0140, -29.8530)[1]) < 200:
        n = 'Alice Street Bus Depot'
    n = n.replace('Warick', 'Warwick')
    if not n.endswith(('Station', 'Depot', 'Terminal')): n += ' Bus Station'
    out.append({'k': 'city', 'n': n, 'p': pts})
# merge sites with the same name within 150 m (OSM splits some into two areas)
merged = []
for s in out:
    c = s.get('c') or [sum(q[0] for q in s['p']) / len(s['p']), sum(q[1] for q in s['p']) / len(s['p'])]
    s['_c'] = c
    dup = next((m for m in merged if m['n'] == s['n'] and math.hypot(m['_c'][0] - c[0], m['_c'][1] - c[1]) < 150), None)
    if dup:
        if s.get('p') and dup.get('p') and len(s['p']) > len(dup['p']): dup['p'] = s['p']
        continue
    merged.append(s)
if coach:
    lon = sum(a for a, b in coach) / len(coach); lat = sum(b for a, b in coach) / len(coach)
    merged.insert(0, {'k': 'coach', 'n': 'Durban Station Coach Terminal', 'c': xz(lon, lat)})
for s in merged: s.pop('_c', None)
json.dump({'sites': merged}, open('src/data/durban-buses.json', 'w'), separators=(',', ':'))
for s in merged: print(s['k'], s['n'], s.get('c') or len(s['p']))
