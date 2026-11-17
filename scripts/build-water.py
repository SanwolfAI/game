#!/usr/bin/env python3
"""Rivers, canals and inland water for IZK from OpenStreetMap (ODbL).
Input: Overpass JSON dumps /tmp/ww.json (waterway river|stream|canal ways, geom)
and /tmp/wa.json (natural=water areas). Output: src/data/durban-water.json
  rivers: [{n: name, w: width m, p: [[lon,lat],...]}]
  areas:  [{n, k: kind, p: [[lon,lat],...]}]
Only rivers and canals (no small streams) plus river/lake/reservoir areas >= 2000 m2."""
import json, math
def r5(v): return round(v, 5)
ww = json.load(open('/tmp/ww.json'))['elements']
wa = json.load(open('/tmp/wa.json'))['elements']
DEFAULT_W = {'river': 16, 'canal': 7}
BIG = {'Umgeni River': 45, 'uMngeni River': 45, 'Umbilo River': 14, 'Mhlatuzana River': 14, 'Palmiet River': 10, 'Mlazi': 30, 'Umhlanga River': 12}
rivers = []
for e in ww:
    t = e.get('tags', {})
    k = t.get('waterway')
    if k not in DEFAULT_W: continue
    g = e.get('geometry') or []
    if len(g) < 2: continue
    w = DEFAULT_W[k]
    n = t.get('name', '')
    if n in BIG: w = BIG[n]
    try:
        if 'width' in t: w = max(3, min(80, float(t['width'].split()[0])))
    except ValueError: pass
    if t.get('tunnel') or t.get('layer', '0').startswith('-') or t.get('location') == 'underground':
        continue  # culverted / underground: not visible
    rivers.append({'n': n, 'w': w, 'k': k, 'p': [[r5(q['lon']), r5(q['lat'])] for q in g]})
def area(pts):
    a = 0
    for i in range(len(pts)):
        x0, y0 = pts[i - 1]; x1, y1 = pts[i]
        a += (x0 * 96600) * (y1 * 110600) - (x1 * 96600) * (y0 * 110600)
    return abs(a) / 2
areas = []
for e in wa:
    t = e.get('tags', {})
    k = t.get('water') or ('river' if t.get('waterway') == 'riverbank' else 'water')
    if k in ('wastewater', 'basin'): continue
    g = e.get('geometry') or []
    if e['type'] != 'way' or len(g) < 4: continue
    p = [[r5(q['lon']), r5(q['lat'])] for q in g]
    if area(p) < 2000: continue
    areas.append({'n': t.get('name', ''), 'k': k, 'p': p})
out = {'source': 'OpenStreetMap contributors (ODbL), via Overpass', 'rivers': rivers, 'areas': areas}
json.dump(out, open('src/data/durban-water.json', 'w'), separators=(',', ':'))
print(len(rivers), 'rivers/canals', len(areas), 'areas', round(sum(len(r['p']) for r in rivers)/1000,1), 'k pts')
