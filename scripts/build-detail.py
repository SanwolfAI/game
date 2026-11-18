#!/usr/bin/env python3
"""Everything OSM maps on the ground that the game did not draw yet:
golf course parts (fairway, green, bunker, tee, rough, water hazard), race and
running tracks, sports pitches (with their sport), swimming pools, playgrounds,
car parks and cemeteries.
Input: Overpass `out tags geom` tile dumps (default ../work/od/*.json).
Output: src/data/durban-detail.json {v:1, f:[{t, s?, n?, c?, p:[x,z,x,z,...]}]}
  t  type code (see T below), s sport/surface, n name, c 1 = closed ring,
  p  flat world-metre coords (same projection as src/core/geo.js)."""
import json, math, sys, glob, os
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
files = sys.argv[1:] or sorted(glob.glob(os.path.join(os.path.dirname(__file__), '../../work/od/*.json')))
seen = set(); out = []
def typ(t):
    g = t.get('golf')
    if g in ('fairway', 'green', 'bunker', 'tee', 'rough', 'water_hazard', 'lateral_water_hazard', 'driving_range', 'cartpath', 'path'):
        return {'lateral_water_hazard': 'water_hazard', 'path': 'cartpath'}.get(g, g)
    l = t.get('leisure')
    if l == 'track': return 'track'
    if l in ('pitch', 'swimming_pool', 'playground', 'stadium', 'garden'): return l
    if t.get('landuse') == 'cemetery' or t.get('amenity') == 'grave_yard': return 'cemetery'
    if t.get('amenity') == 'parking': return 'parking'
    return None
for f in files:
    try: els = json.load(open(f)).get('elements', [])
    except Exception: continue
    for e in els:
        if e['type'] != 'way' or e['id'] in seen or 'geometry' not in e: continue
        seen.add(e['id']); t = e.get('tags', {}); k = typ(t)
        if not k: continue
        if k == 'parking' and t.get('parking') in ('underground', 'multi-storey', 'rooftop'): continue
        if k == 'swimming_pool' and t.get('indoor') == 'yes': continue
        g = e['geometry']; p = []
        for q in g:
            p += [round((q['lon'] - CLON) * MLON, 1), round(-(q['lat'] - CLAT) * MLAT, 1)]
        closed = len(g) > 3 and g[0]['lat'] == g[-1]['lat'] and g[0]['lon'] == g[-1]['lon']
        if k not in ('track', 'cartpath') and not closed: continue
        r = {'t': k, 'p': p}
        if e.get('holes'):
            r['h'] = [[v for q in hole for v in (round((q['lon'] - CLON) * MLON, 1), round(-(q['lat'] - CLAT) * MLAT, 1))] for hole in e['holes']]
        if closed: r['c'] = 1
        if t.get('area') == 'yes' or (k == 'track' and closed and t.get('sport') not in ('horse_racing', 'athletics', 'running', 'motor', 'karting', 'cycling')): r['a'] = 1
        s = t.get('sport') if k in ('pitch', 'track') else t.get('surface') if k == 'parking' else None
        if k == 'track' and t.get('surface'): s = (s or '') + '|' + t['surface']
        if s: r['s'] = s
        if t.get('name') and k in ('track', 'stadium', 'cemetery'): r['n'] = t['name']
        out.append(r)
dst = os.path.join(os.path.dirname(__file__), '../src/data/durban-detail.json')
json.dump({'v': 1, 'f': out}, open(dst, 'w'), separators=(',', ':'))
from collections import Counter
print(len(out), Counter(r['t'] for r in out), os.path.getsize(dst) // 1024, 'KB')
