#!/usr/bin/env python3
"""Copy OSM surface into src/data/durban-game.json: u:1 on roads tagged
unpaved/gravel/dirt/ground/compacted/earth/sand/fine_gravel/grass
(source: src/data/durban-osm.json raw tags)."""
import json
U = {'unpaved', 'gravel', 'dirt', 'ground', 'compacted', 'earth', 'sand', 'fine_gravel', 'grass', 'mud'}
raw = json.load(open('src/data/durban-osm.json'))['roads']
un = {r['id'] for r in raw if r['tags'].get('surface') in U}
P = 'src/data/durban-game.json'
g = json.load(open(P))
n = 0
for r in g['roads']:
    if r['id'] in un:
        r['u'] = 1; n += 1
    else:
        r.pop('u', None)
json.dump(g, open(P, 'w'), separators=(',', ':'))
print('unpaved roads', n)
