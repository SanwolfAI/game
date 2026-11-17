#!/usr/bin/env python3
"""Real Durban landmarks from OpenStreetMap (ODbL) for IZK.
Input: Overpass dumps work/lmA.json (amenities, out center) and work/lmB.json
(shops/stations/leisure/industrial, out geom). Output src/data/durban-landmarks.json:
  {k: category, n: name, x, z (world m, origin CBD), y?: polygon [[x,z]..] for fields}"""
import json, math, os
LON0, LAT0 = 31.0218, -29.8587
MX = 111320 * math.cos(math.radians(LAT0)); MZ = 110574
def xz(lon, lat): return [round((lon - LON0) * MX, 1), round(-(lat - LAT0) * MZ, 1)]
W = os.path.join(os.path.dirname(__file__), '..', '..', 'work')
A = json.load(open(os.path.join(W, 'lmA.json')))['elements']
B = json.load(open(os.path.join(W, 'lmB.json')))['elements']
CAT = {
 'hospital': 'hospital', 'clinic': 'clinic', 'school': 'school', 'college': 'campus', 'university': 'campus',
 'police': 'police', 'fuel': 'fuel', 'community_centre': 'hall', 'townhall': 'hall', 'library': 'library',
 'marketplace': 'market', 'bus_station': 'station', 'fire_station': 'fire',
 'mall': 'mall', 'department_store': 'mall', 'supermarket': 'shop', 'station': 'station',
 'stadium': 'stadium', 'pitch': 'field', 'sports_centre': 'sports', 'playground': 'playground', 'industrial': 'factory'}
out = []; seen = set()
for e in A + B:
    t = e.get('tags', {})
    raw = t.get('amenity') or t.get('shop') or t.get('leisure') or t.get('railway') or t.get('landuse')
    k = CAT.get(raw)
    if not k: continue
    if raw == 'station' and t.get('station') == 'subway': continue
    n = (t.get('name') or '').strip()
    if k == 'fuel' and not n: n = t.get('brand', '')
    item = {'k': k, 'n': n}
    g = e.get('geometry')
    if e['type'] == 'node': p = xz(e['lon'], e['lat'])
    elif 'center' in e: p = xz(e['center']['lon'], e['center']['lat'])
    elif g:
        pts = [xz(q['lon'], q['lat']) for q in g if q]
        p = [round(sum(a[0] for a in pts) / len(pts), 1), round(sum(a[1] for a in pts) / len(pts), 1)]
        if k in ('field', 'playground', 'stadium', 'sports') and e['type'] == 'way' and len(pts) >= 4:
            item['y'] = pts
            if t.get('sport'): item['s'] = t['sport'].split(';')[0]
    else: continue
    if not n and k not in ('field', 'playground'): continue
    key = (k, n, round(p[0] / 60), round(p[1] / 60))
    if n and key in seen: continue
    seen.add(key)
    item['x'], item['z'] = p
    out.append(item)
json.dump({'source': 'OpenStreetMap contributors (ODbL)', 'landmarks': out}, open(os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'durban-landmarks.json'), 'w'), separators=(',', ':'))
import collections; print(len(out), collections.Counter(o['k'] for o in out).most_common())
