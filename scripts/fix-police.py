#!/usr/bin/env python3
"""Tidy police station names in src/data/durban-grounds.json (OSM amenity=police):
drop the magistrates court, merge duplicates within 150 m, give unnamed and
road-named stations '<nearest suburb> Police Station'."""
import json, math
d = json.load(open('src/data/durban-grounds.json'))
g = json.load(open('src/data/durban-game.json'))
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
xz = lambda lon, lat: ((lon - CLON) * MLON, -(lat - CLAT) * MLAT)
subs = [(p['n'], xz(*p['c'])) for p in g['places'] if p['k'] in ('suburb', 'neighbourhood', 'quarter', 'town', 'village')]
def ctr(s):
    if s.get('c'): return s['c']
    p = s['p']; return (sum(a[0] for a in p) / len(p), sum(a[1] for a in p) / len(p))
keep, other = [], []
for s in d['sites']:
    (keep if s['k'] == 'police' else other).append(s)
out = []
for s in sorted(keep, key=lambda s: (not s.get('p'), not s['n'])):
    n = s['n']
    if 'magistrate' in n.lower(): continue
    c = ctr(s)
    if any(math.dist(c, ctr(o)) < 150 for o in out): continue
    if not n or n.startswith('165 Prince') or n in ('South African Police Service',) or n.endswith('Road'):
        sub = min(subs, key=lambda q: math.dist(q[1], c))[0]
        n = sub + ' Police Station'
    n = n.replace('Saps - ', '').replace('SAPS - ', '')
    if n in ('Umlazi', 'Ntuzuma'): n += ' SAPS'
    s['n'] = n; out.append(s)
d['sites'] = other + out
json.dump(d, open('src/data/durban-grounds.json', 'w'), separators=(',', ':'))
for s in out: print(s['n'], 'poly' if s.get('p') else 'point', [round(v) for v in ctr(s)])
