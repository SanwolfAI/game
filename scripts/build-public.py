#!/usr/bin/env python3
"""Malls, their car parks and parks from OpenStreetMap (ODbL) for IZK.
Input: Overpass `out tags geom` dumps in ../pubosm/ (next to the repo):
  malls.json   way/relation shop=mall + shop=department_store
  aisles.json  way service=parking_aisle
  parks.json   way/relation leisure=park
plus src/data/durban-detail.json (amenity=parking polygons, t='parking') and
src/data/durban-grounds.json (hospital / clinic outlines).
Overpass (maps.mail.ru mirror worked when overpass-api.de did not):
  [out:json][timeout:90];(way["shop"="mall"](-30.30,30.70,-29.55,31.15);relation["shop"="mall"](...);way["shop"="department_store"](...););out tags geom;
  [out:json][timeout:90];way["service"="parking_aisle"](-30.30,30.70,-29.55,31.15);out tags geom;
  [out:json][timeout:50];(way["leisure"="park"](...);relation["leisure"="park"](...););out tags geom;
Output src/data/durban-public.json:
  {source, malls:[{n, p:[[x,z]..]}], lots:[{p:[[x,z]..], a:[[[x,z]..]..], k:'mall'|'hospital'|'clinic', s:index}],
   parks:[{n, p:[[x,z]..]}]}   world metres, same projection as src/core/geo.js."""
import json, math, os
LON0, LAT0 = 31.0218, -29.8587
MX = 111320 * math.cos(math.radians(LAT0)); MZ = 110574
def xz(q): return [round((q['lon'] - LON0) * MX, 1), round(-(q['lat'] - LAT0) * MZ, 1)]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, '..')
SRC = os.environ.get('PUBOSM', os.path.join(REPO, '..', 'pubosm'))
def load(f):
    return json.load(open(os.path.join(SRC, f)))['elements']

def area(r):
    a = 0
    for i in range(len(r)):
        x0, z0 = r[i]; x1, z1 = r[(i + 1) % len(r)]
        a += x0 * z1 - x1 * z0
    return abs(a) / 2
def cen(r): return [sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)]
def inside(r, x, z):
    c = False; j = len(r) - 1
    for i in range(len(r)):
        xi, zi = r[i]; xj, zj = r[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi: c = not c
        j = i
    return c
def seg_d(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]; L = dx * dx + dz * dz or 1
    t = max(0, min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L))
    return math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz)
def ring_d(r, x, z):
    if inside(r, x, z): return 0
    return min(seg_d(x, z, r[i], r[(i + 1) % len(r)]) for i in range(len(r)))
def rings_of(e):
    """outer rings of a way or a multipolygon relation (ways joined end to end)"""
    if e['type'] == 'way':
        g = e.get('geometry') or []
        if len(g) >= 4 and g[0] == g[-1]: return [[xz(q) for q in g[:-1]]]
        return []
    segs = [[xz(q) for q in m['geometry']] for m in e.get('members', []) if m.get('role') in ('outer', '') and m.get('geometry')]
    out = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s[:-1] + cur
                elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
                else: continue
                segs.pop(i); changed = True; break
        if len(cur) >= 4 and cur[0] == cur[-1]: out.append(cur[:-1])
    return out

# ---- malls --------------------------------------------------------------------
LM = json.load(open(os.path.join(REPO, 'src/data/durban-landmarks.json')))['landmarks']
lm_malls = [l for l in LM if l['k'] == 'mall' and l['n']]
malls = []
for e in load('malls.json'):
    t = e.get('tags', {})
    for r in rings_of(e):
        A = area(r)
        if A < 1500: continue
        n = (t.get('name') or '').strip()
        c = cen(r)
        if not n:
            best = None
            for l in lm_malls:
                d = ring_d(r, l['x'], l['z'])
                if d < 120 and (not best or d < best[0]): best = (d, l['n'])
            if best and best[1] != 'Edgars': n = best[1]
        malls.append({'n': n, 'p': r, 'A': A})
# drop rings nested in a bigger mall ring (department stores inside a centre)
malls.sort(key=lambda m: -m['A'])
keep = []
for m in malls:
    c = cen(m['p'])
    host = next((k for k in keep if inside(k['p'], c[0], c[1])), None)
    if host:
        if not host['n'] and m['n']: host['n'] = m['n']
        continue
    keep.append(m)
malls = keep

# ---- car parks next to malls and hospitals -----------------------------------
DET = json.load(open(os.path.join(REPO, 'src/data/durban-detail.json')))['f']
lots_src = []
for f in DET:
    if f['t'] != 'parking' or f.get('c') != 1: continue
    p = f['p']; r = [[p[i], p[i + 1]] for i in range(0, len(p), 2)]
    if len(r) > 3 and r[0] == r[-1]: r = r[:-1]
    if len(r) < 3 or area(r) < 150: continue
    s = (f.get('s') or '')
    if any(w in s for w in ('gravel', 'dirt', 'grass', 'ground')): continue
    lots_src.append(r)
GR = json.load(open(os.path.join(REPO, 'src/data/durban-grounds.json')))['sites']
hosp = [(i, s) for i, s in enumerate(GR) if s['k'] in ('hospital', 'clinic') and s.get('p')]
lots = []
used = set()
for mi, m in enumerate(malls):
    for li, r in enumerate(lots_src):
        if li in used: continue
        c = cen(r)
        if ring_d(m['p'], c[0], c[1]) < 70 or any(inside(r, *q) for q in m['p'][::3]):
            lots.append({'p': r, 'k': 'mall', 's': mi}); used.add(li)
for gi, s in hosp:
    for li, r in enumerate(lots_src):
        if li in used: continue
        c = cen(r)
        if ring_d(s['p'], c[0], c[1]) < 15:
            lots.append({'p': r, 'k': s['k'], 's': gi}); used.add(li)
# real parking aisles (service=parking_aisle) inside each lot
AIS = []
for e in load('aisles.json'):
    g = e.get('geometry') or []
    if len(g) >= 2: AIS.append([xz(q) for q in g])
for L in lots:
    r = L['p']
    xs = [p[0] for p in r]; zs = [p[1] for p in r]
    bb = (min(xs) - 5, min(zs) - 5, max(xs) + 5, max(zs) + 5)
    a = []
    for w in AIS:
        if not any(bb[0] < x < bb[2] and bb[1] < z < bb[3] for x, z in w): continue
        if sum(1 for x, z in w if ring_d(r, x, z) < 4) >= max(1, len(w) // 2): a.append(w)
    L['a'] = a

# ---- parks --------------------------------------------------------------------
parks = []
for e in load('parks.json'):
    t = e.get('tags', {})
    if t.get('access') == 'private': continue
    for r in rings_of(e):
        A = area(r)
        if A < 300 or A > 3e6: continue
        parks.append({'n': (t.get('name') or '').strip(), 'p': r})

for m in malls: m.pop('A', None)
out = {'source': 'OpenStreetMap contributors (ODbL)', 'malls': malls, 'lots': lots, 'parks': parks}
dst = os.path.join(REPO, 'src/data/durban-public.json')
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print('malls', len(malls), sum(1 for m in malls if m['n']), 'lots', len(lots), 'mall lots', sum(1 for l in lots if l['k'] == 'mall'),
      'with aisles', sum(1 for l in lots if l['a']), 'parks', len(parks), sum(1 for p in parks if p['n']), os.path.getsize(dst), 'bytes')
