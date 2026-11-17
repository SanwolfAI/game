# Adds Durban CBD lanes and passages (OSM highway=pedestrian, alleys, named
# service lanes and named footways, plus service lanes in the CBD core) to
# src/data/durban-game.json as narrow paved roads. Idempotent: earlier lanes
# (flag "l": 1) are replaced. Run: python3 scripts/add-lanes.py [overpass.json]
import json, math, sys, urllib.request, urllib.parse

BBOX = (-29.885, 30.995, -29.835, 31.055)
CORE = (-29.868, 31.012, -29.845, 31.045)
Q = '[out:json][timeout:60];(way["highway"~"^(service|pedestrian|footway|living_street)$"](%s,%s,%s,%s););out tags geom;' % BBOX

if len(sys.argv) > 1:
    els = json.load(open(sys.argv[1]))['elements']
else:
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': Q}).encode(), headers={'User-Agent': 'IZK-game/1.0'})
    els = json.load(urllib.request.urlopen(req, timeout=120))['elements']

def length(g):
    return sum(math.hypot((g[i]['lon'] - g[i-1]['lon']) * 96500, (g[i]['lat'] - g[i-1]['lat']) * 110574) for i in range(1, len(g)))

rnd = lambda v: round(v * 1e5) / 1e5
lanes = []
for e in els:
    t = e.get('tags', {}); h = t.get('highway'); sv = t.get('service', ''); nm = t.get('name', '')
    if t.get('area') == 'yes' or (t.get('access') in ('private', 'no') and h != 'pedestrian'):
        continue
    g = e.get('geometry') or []
    if len(g) < 2 or length(g) < 8:
        continue
    lat = sum(p['lat'] for p in g) / len(g); lon = sum(p['lon'] for p in g) / len(g)
    core = CORE[0] < lat < CORE[2] and CORE[1] < lon < CORE[3]
    ok = (h in ('pedestrian', 'living_street') or sv == 'alley' or (h == 'service' and nm)
          or (h == 'footway' and nm and t.get('footway') != 'sidewalk')
          or (core and h == 'service' and sv == '' and length(g) > 25))
    if not ok:
        continue
    pts = []
    for p in g:
        q = [rnd(p['lon']), rnd(p['lat'])]
        if not pts or pts[-1] != q:
            pts.append(q)
    if len(pts) < 2:
        continue
    lanes.append({'id': e['id'], 'h': 'pedestrian' if h == 'footway' else h, 'n': nm, 'r': '', 'w': 0,
                  'o': 1 if t.get('oneway') in ('yes', '1') else 0, 'b': 1 if t.get('bridge') == 'yes' else 0, 'l': 1, 'p': pts})

path = 'src/data/durban-game.json'
data = json.load(open(path))
ids = {r['id'] for r in data['roads'] if not r.get('l')}
data['roads'] = [r for r in data['roads'] if not r.get('l')] + [r for r in lanes if r['id'] not in ids]
json.dump(data, open(path, 'w'), separators=(',', ':'))
print('lanes added', len(lanes))
