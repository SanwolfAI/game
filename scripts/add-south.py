#!/usr/bin/env python3
"""Merge major roads + all ramps for the south (M4/N2 Prospecton interchange,
Isipingo, Mlazi, Amanzimtoti) into src/data/durban-game.json.
Input: Overpass dump (out geom) of motorway..tertiary(+links) in
bbox -30.105,30.83,-29.94,30.99 -> path given as argv[1].
Same conversion as scripts/build-data.mjs (round 1e-5, RDP)."""
import json, sys
src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/south.json'
P = 'src/data/durban-game.json'
g = json.load(open(P))
have = {r['id'] for r in g['roads']}

def rdp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1; L = dx*dx + dy*dy
        md, mi = 0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            if L == 0: d = (x-x1)**2 + (y-y1)**2
            else:
                t = max(0, min(1, ((x-x1)*dx + (y-y1)*dy) / L))
                d = (x-(x1+t*dx))**2 + (y-(y1+t*dy))**2
            if d > md: md, mi = d, i
        if md > tol*tol and mi > 0:
            keep[mi] = True; st += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]

add = []
for e in json.load(open(src))['elements']:
    if e.get('type') != 'way' or e['id'] in have: continue
    t = e['tags']; hw = t['highway']
    pts = []
    for p in e['geometry']:
        q = [round(p['lon'], 5), round(p['lat'], 5)]
        if not pts or pts[-1] != q: pts.append(q)
    if len(pts) < 2: continue
    tol = 0.000012 if hw in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary') else 0.000022
    r = {'id': e['id'], 'h': hw, 'n': t.get('name') or t.get('ref') or ''}
    if t.get('old_name') and t.get('old_name') != t.get('name'): r['on'] = t['old_name']
    r.update({'r': t.get('ref', ''), 'w': int(t['lanes']) if t.get('lanes', '').isdigit() else 0,
              'o': 1 if t.get('oneway') in ('yes', '1') else 0, 'b': 1 if t.get('bridge') == 'yes' else 0})
    try:
        if t.get('bridge') == 'yes' and int(t.get('layer', '0')) > 1: r['L'] = int(t['layer'])
    except ValueError: pass
    r['p'] = rdp(pts, tol)
    add.append(r)
g['roads'] += add
json.dump(g, open(P, 'w'), separators=(',', ':'))
print('added', len(add), 'roads; total', len(g['roads']))
