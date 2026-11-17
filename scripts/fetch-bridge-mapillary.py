# Fetch Mapillary image points (GPS altitude, position, sequence) around every
# OSM bridge way in durban-game.json. Output: /tmp/mly-bridges.json
# Needs network access to graph.mapillary.com with an Authorization: OAuth MLY|... header
# (injected by the Hark proxy; never commit a token).
import json, urllib.request, concurrent.futures as cf, os
g = json.load(open('src/data/durban-game.json'))
br = [r for r in g['roads'] if r.get('b')]
F = 'id,sequence,computed_geometry,geometry,altitude,compass_angle'
def fetch(r):
    lo = [p[0] for p in r['p']]; la = [p[1] for p in r['p']]
    pad = 0.0006
    bb = f"{min(lo)-pad:.5f},{min(la)-pad:.5f},{max(lo)+pad:.5f},{max(la)+pad:.5f}"
    url = f"https://graph.mapillary.com/images?bbox={bb}&limit=2000&fields={F}"
    for _ in range(3):
        try:
            d = json.load(urllib.request.urlopen(url, timeout=60))['data']
            return r['id'], [[x['sequence'], *(x.get('computed_geometry') or x['geometry'])['coordinates'], x.get('altitude'), x.get('compass_angle')] for x in d]
        except Exception as e:
            err = e
    return r['id'], None
out = {}
with cf.ThreadPoolExecutor(8) as ex:
    for k, v in ex.map(fetch, br):
        out[k] = v
json.dump(out, open('/tmp/mly-bridges.json', 'w'))
print(len(out), sum(1 for v in out.values() if v), sum(len(v) for v in out.values() if v))
