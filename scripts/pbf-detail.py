#!/usr/bin/env python3
"""Pull ground features out of a Geofabrik .osm.pbf (no Overpass needed).
usage: python3 scripts/pbf-detail.py <file.osm.pbf> <out.json> [w s e n]
Writes Overpass-style JSON ({elements:[{type:'way',id,tags,geometry:[{lat,lon}]}]})
that scripts/build-detail.py reads. Multipolygons come through as their outer
rings (one element per ring)."""
import sys, json, osmium
src, dst = sys.argv[1], sys.argv[2]
W, S, E, N = (float(v) for v in sys.argv[3:7]) if len(sys.argv) > 6 else (30.70, -30.30, 31.15, -29.55)
LEIS = {'track', 'stadium', 'swimming_pool', 'playground', 'pitch', 'garden', 'sports_centre'}
def want(t):
    if 'golf' in t: return True
    if t.get('leisure') in LEIS: return True
    if t.get('landuse') == 'cemetery' or t.get('amenity') in ('grave_yard', 'parking'): return True
    if t.get('sport') in ('horse_racing', 'athletics', 'running', 'motor'): return True
    return False
def inb(lon, lat): return W <= lon <= E and S <= lat <= N
out = []
class H(osmium.SimpleHandler):
    def way(self, w):
        t = {k: v for k, v in w.tags}
        if not (t.get('leisure') == 'track' or t.get('golf') in ('cartpath', 'path') or (t.get('sport') == 'horse_racing' and not w.is_closed())):
            return
        try: g = [{'lat': n.location.lat, 'lon': n.location.lon} for n in w.nodes]
        except osmium.InvalidLocationError: return
        if g and inb(g[0]['lon'], g[0]['lat']):
            out.append({'type': 'way', 'id': w.id, 'tags': t, 'geometry': g})
    def area(self, a):
        t = {k: v for k, v in a.tags}
        if not want(t): return
        if a.from_way() and (t.get('leisure') == 'track' or t.get('golf') in ('cartpath', 'path')): return
        try:
            for i, ring in enumerate(a.outer_rings()):
                g = [{'lat': n.lat, 'lon': n.lon} for n in ring]
                if not g or not inb(g[0]['lon'], g[0]['lat']): continue
                tt = dict(t)
                if not a.from_way(): tt['area'] = 'yes'
                el = {'type': 'way', 'id': (a.orig_id() * 10 + i) * (1 if a.from_way() else -1), 'tags': tt, 'geometry': g}
                holes = [[{'lat': n.lat, 'lon': n.lon} for n in inner] for inner in a.inner_rings(ring)]
                if holes: el['holes'] = holes
                out.append(el)
        except Exception:
            pass
H().apply_file(src, locations=True, idx='flex_mem')
json.dump({'elements': out}, open(dst, 'w'), separators=(',', ':'))
print(len(out), 'elements')
