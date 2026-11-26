#!/usr/bin/env python3
"""Build src/world/guardRailData.js: real-world W-beam guard rails.

Sources
 1. OpenStreetMap barrier=guard_rail ways inside the game area. Overpass is
    often unreachable from the build box, so this reads a Geofabrik extract:
      python3 scripts/build-guardrails.py <south-africa-latest.osm.pbf>
    (needs `pip install osmium`; two quick C++-filtered passes, ~25 s).
    Without an extract the OSM rails already in guardRailData.js are kept.
 2. Rails seen on Mapillary street photos that OSM does not have yet (Mapillary
    map_features / detections only carry point objects, no guard-rail class,
    so these are read off the photos by hand). Each one names its photo.
Everything else (bridge approaches, embankments, freeway curves, steep
drop-offs) is placed by rule at runtime in src/world/guardRails.js.
"""
import sys, json, math, re

W, S, E, N = 30.80, -30.11, 31.08, -29.63

# Seen on Mapillary, not in OSM. [lon, lat] polylines, rail side as drawn.
MAPILLARY = [
    {
        'name': 'Zulu Road / Ntombela Road, KwaMashu',
        'photos': ['318544953002856', '201917148280487'],
        # SW verge of Zulu Road, opposite the Ntombela Road T-junction,
        # running ~24 m north-west in front of the houses.
        'p': [[30.989422, -29.739357], [30.989329, -29.739285], [30.989236, -29.739214]],
    },
]

# Freeway verge rails seen on Mapillary photos: the rail runs along the left
# (kerb-side) edge of the carriageway the photo was taken on, from `back` m
# behind the camera to `fwd` m ahead of it (as far as it can be seen).
VERGE = [
    {'name': 'N3 eastbound, Westville (left verge)', 'photo': '794089158164095', 'at': [30.9531, -29.8404], 'heading': 95, 'ref': 'N3', 'back': 10, 'fwd': 160},
    {'name': 'N3 westbound, Westville (left verge)', 'photo': '296730148573623', 'at': [30.921045, -29.843975], 'heading': 310, 'ref': 'N3', 'back': 20, 'fwd': 140},
    {'name': 'M4 Ruth First Highway northbound (left verge)', 'photo': '277494250700356', 'at': [31.03041, -29.836835], 'heading': 16, 'ref': 'M4', 'back': 10, 'fwd': 120},
    {'name': 'M4 Leo Boyd Highway, Umhlanga (left verge)', 'photo': '139647661515326', 'at': [31.05158, -29.77702], 'heading': 42, 'ref': 'M4', 'back': 10, 'fwd': 100},
]
MX = 111320 * math.cos(math.radians(-29.8587))
MY = 110574

def verge_rails(game):
    out = []
    for v in VERGE:
        lo0, la0 = v['at']
        best = None
        for r in game['roads']:
            if v['ref'] not in (r.get('r') or '').split(';') or r.get('b'):
                continue
            p = r['p']
            for i in range(len(p) - 1):
                ax, ay = (p[i][0] - lo0) * MX, (p[i][1] - la0) * MY
                bx, by = (p[i + 1][0] - lo0) * MX, (p[i + 1][1] - la0) * MY
                dx, dy = bx - ax, by - ay
                L2 = dx * dx + dy * dy or 1
                t = max(0, min(1, -(ax * dx + ay * dy) / L2))
                d = math.hypot(ax + dx * t, ay + dy * t)
                hd = math.degrees(math.atan2(dx, dy)) % 360
                if abs((hd - v['heading'] + 180) % 360 - 180) > 35:
                    continue
                if best is None or d < best[0]:
                    best = (d, r, i, t)
        if not best or best[0] > 25:
            print('no road for', v['name']); continue
        _, r, i, t = best
        # polyline in metres along the way (forward = way direction)
        P = [((q[0] - lo0) * MX, (q[1] - la0) * MY) for q in r['p']]
        cum = [0]
        for k in range(1, len(P)): cum.append(cum[-1] + math.dist(P[k - 1], P[k]))
        d0 = cum[i] + (cum[i + 1] - cum[i]) * t
        lanes = int(r.get('w') or 2)
        off = (lanes * 3.7 + 3.2) / 2 + 0.6  # carriageway half width + clearance
        pts = []
        d = max(0, d0 - v['back'])
        while d <= min(cum[-1], d0 + v['fwd']):
            k = 0
            while k < len(P) - 2 and cum[k + 1] < d: k += 1
            L = cum[k + 1] - cum[k] or 1
            f = (d - cum[k]) / L
            x = P[k][0] + (P[k + 1][0] - P[k][0]) * f
            y = P[k][1] + (P[k + 1][1] - P[k][1]) * f
            tx, ty = (P[k + 1][0] - P[k][0]) / L, (P[k + 1][1] - P[k][1]) / L
            # left of travel (x east, y north): (-ty, tx)
            x += -ty * off; y += tx * off
            pts.append([round(lo0 + x / MX, 6), round(la0 + y / MY, 6)])
            d += 8
        if len(pts) > 1:
            out.append({'name': v['name'], 'photos': [v['photo']], 'p': pts})
    return out

def osm_rails(pbf):
    import osmium
    ways, need = [], set()
    fp = osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(osmium.filter.TagFilter(('barrier', 'guard_rail')))
    for w in fp:
        ns = [n.ref for n in w.nodes]
        ways.append((w.id, ns)); need.update(ns)
    loc = {}
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(need)):
        loc[n.id] = [round(n.location.lon, 6), round(n.location.lat, 6)]
    out = []
    for wid, ns in ways:
        g = [loc[i] for i in ns if i in loc]
        if len(g) > 1 and any(W <= a <= E and S <= b <= N for a, b in g):
            out.append({'id': wid, 'p': g})
    return out

def main():
    if len(sys.argv) > 1:
        osm = osm_rails(sys.argv[1])
    else:  # no extract given: keep the OSM rails already in the data file
        old = open('src/world/guardRailData.js').read()
        osm = json.loads(re.search(r'GUARD_RAILS = (\{.*\});', old, re.S).group(1))['osm']
    mly = []
    for m in MAPILLARY:
        p = []
        for q in m['p']:
            if not p or p[-1] != q: p.append(q)
        if len(p) > 1: mly.append({'name': m['name'], 'photos': m['photos'], 'p': p})
    mly += verge_rails(json.load(open('src/data/durban-game.json')))
    js = ('// Generated by scripts/build-guardrails.py - real guard rails.\n'
          '// osm: OpenStreetMap barrier=guard_rail (ODbL). mapillary: rails seen on\n'
          '// Mapillary street photos (CC-BY-SA), photo ids kept for checking.\n'
          'export const GUARD_RAILS = ' + json.dumps({'osm': osm, 'mapillary': mly}, separators=(',', ':')) + ';\n')
    open('src/world/guardRailData.js', 'w').write(js)
    print(len(osm), 'osm rails,', len(mly), 'mapillary rails')

main()
