#!/usr/bin/env python3
"""Bus / taxi stop shelters -> src/data/durban-shelters.json (drawn by src/world/shelters.js).

Sources:
 - OSM (Overpass, (c) OpenStreetMap contributors, ODbL): highway=bus_stop + shelter=yes,
   and amenity=shelter + shelter_type=public_transport. Query (bbox of the game map):
     [out:json];(node["highway"="bus_stop"](-30.11,30.80,-29.63,31.08);
                 nwr["amenity"="shelter"](-30.11,30.80,-29.63,31.08););out center tags;
 - Every stop was checked against the nearest Mapillary street photos (CC BY-SA, 2017-2020,
   checked by eye, no photos stored). PHOTO: OSM id -> Mapillary image id that shows the
   shelter. SEEN: stops OSM does not tag shelter=yes where a photo clearly shows one.
   REMOVED: OSM shelters a photo shows are not there (or are not kerb shelters).
 - Red Hill shelter on the north corridor (named by the owner, src/game/fares.js).
Shelter types (field 't'), from the photos:
  'muni' eThekwini municipal shelter: boxy, dark-blue steel posts and a flat blue roof that
         overhangs all round with a curved front fascia, closed dark-grey back and end panels,
         a slim ad/info light box at one end, steel bench (Durban North, Phoenix, Berea Centre).
  'pm'   People Mover (IRPTN) shelter: charcoal rounded-corner tube frames at both ends,
         glass back and end, thin flat roof, one end a green leaf-graphic panel (city loop).
Placement (src/world/shelters.js): on the pavement at the kerb of the stop's road, a clear gap
before any fence or wall behind it (house fences are pushed back / cut there).
Only stops within 60 m of a game road are kept (the shelter is snapped to the kerb
at runtime). Shelters closer than 12 m to each other are merged.
usage: python3 scripts/add-shelters.py overpass.json"""
import json, math, sys
CLON, CLAT = 31.0218, -29.8587
MLON = 111320 * math.cos(math.radians(CLAT)); MLAT = 110574
xz = lambda lon, lat: [round((lon - CLON) * MLON, 1), round(-(lat - CLAT) * MLAT, 1)]

# OSM element id -> Mapillary image id that shows the shelter
PHOTO = {
    2998142814: '2827642110693857',   # Durban North, reference for the blue municipal type
    2998142813: '302268748029247',    # Durban North, across the road
    7321621462: '508207160318195',    # Suncoast (People Mover)
    7363009119: '311796606988357',    # Florence Nzama
    7363419249: '316142523218277',    # Mills
    7363419266: '646898392847017',    # Brook
    7363431891: '284953309928965',    # ML Sultan
    7372682302: '522668872074074',    # Joe Slovo
    7372682310: '209560660974624',    # Farewell
}
# bus stops without shelter=yes where a photo clearly shows a shelter
SEEN = {
    7981039043: '380316993229030',    # Phoenix: blue box municipal shelter
    7981039044: '948186932683536',    # Phoenix: dark box shelter at the kerb
    5764244257: '468843037665984',    # Berea Centre: blue curved-roof municipal shelter
    7372682292: '5465033370233968',   # Dr Yussuf Dadoo: People Mover shelter, leaf panel
    2799532699: '527467091586764',    # Bell: People Mover glass shelter
    7309102352: '897560974157976',    # KE Masinga (beachfront): People Mover canopy
}
# OSM shelters that are not (kerb) shelters on the photos
REMOVED = {
    2579511267: 'Mapillary 520972192238718 (2019): bus stop sign only, no shelter',
    2579511273: 'Mapillary 305386281037348 (2019): verge and house, no shelter',
    7513639516: 'Mapillary 553807112274978 (2019): bus stop sign pole only, no shelter',
    14351890546: 'Bridge City is a Go!Durban trunk stop: those are long enclosed median stations '
                 '(Civic, Beviss, Henwood, Regent, Malandela, Queen Nandi photos), not kerb shelters',
    1322148812: 'south Durban amenity=shelter building beside the railway, behind a freeway wall (photo 370750454347264)',
    1322152241: 'railway platform shelter building behind the freeway wall, not on a road (photo 290496736144089)',
    1322152252: 'railway platform shelter building behind the freeway wall, not on a road',
}
# Optional 'rb' (compass bearing of the stop's road) for a corner stop the nearest-road snap gets
# wrong. None needed now: the Mapillary dashcams here are often side-facing (Durban North: camera
# looks 111 deg while driving 21 deg up Adelaide Tambo Drive), so photo headings are not road headings.
ROAD_BEARING = {}
# retaining wall behind the stop where the land behind is higher (photo): wall height (m) and the
# compass direction from the shelter to the steps that climb through it (Durban North, east kerb of
# Adelaide Tambo Drive: brick wall ~1.2 m with a white palisade on top, the shelter ~1 m in front of it,
# steps with white handrails just south of the shelter; photo 2827642110693857 looks east)
WALLS = {2998142814: {'h': 1.2, 'sb': 201}}
EXTRA = [{'n': 'Red Hill shelter', 'c': [99.3, -8819.0], 's': 'owner', 't': 'muni'}]

g = json.load(open('src/data/durban-game.json'))
cell = {}
for r in g['roads']:
    if r['h'] in ('footway', 'path', 'service', 'track', 'steps', 'cycleway', 'pedestrian'): continue
    P = [xz(*p) for p in r['p']]
    for a, b in zip(P, P[1:]):
        cell.setdefault((int(a[0] // 100), int(a[1] // 100)), []).append((a, b))
def road_dist(x, z):
    best = 1e9
    cx, cz = int(x // 100), int(z // 100)
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for a, b in cell.get((cx + i, cz + j), []):
                dx, dz = b[0] - a[0], b[1] - a[1]; L = dx * dx + dz * dz or 1
                t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L))
                best = min(best, math.hypot(a[0] + t * dx - x, a[1] + t * dz - z))
    return best

out = []
for e in json.load(open(sys.argv[1]))['elements']:
    t = e.get('tags', {})
    if e['id'] in REMOVED: continue
    lat = e.get('lat') or e['center']['lat']; lon = e.get('lon') or e['center']['lon']
    if t.get('highway') == 'bus_stop' and (t.get('shelter') == 'yes' or e['id'] in SEEN):
        s = 'osm' if t.get('shelter') == 'yes' else 'mapillary'
    elif t.get('amenity') == 'shelter' and t.get('shelter_type') == 'public_transport':
        s = 'osm'
    else:
        continue
    c = xz(lon, lat)
    if road_dist(*c) > 60:
        if e['id'] in SEEN or e['id'] in PHOTO: print('  (off the game roads)', e['id'], t.get('name', ''))
        continue
    if any(math.hypot(o['c'][0] - c[0], o['c'][1] - c[1]) < 12 for o in out): continue
    o = {'n': t.get('name', ''), 'c': c, 's': s,
         't': 'pm' if t.get('network') == 'PeopleMover' or t.get('operator') == 'PeopleMover' else 'muni'}
    ph = PHOTO.get(e['id']) or SEEN.get(e['id'])
    if ph: o['p'] = ph
    if e['id'] in ROAD_BEARING: o['rb'] = ROAD_BEARING[e['id']]
    if e['id'] in WALLS: o['w'] = WALLS[e['id']]
    out.append(o)
for x in EXTRA:
    if not any(math.hypot(o['c'][0] - x['c'][0], o['c'][1] - x['c'][1]) < 12 for o in out): out.append(x)
json.dump({'shelters': out}, open('src/data/durban-shelters.json', 'w'), separators=(',', ':'))
print(len(out), 'shelters', sum(o['t'] == 'pm' for o in out), 'People Mover')
for o in out: print(o['s'], o['t'], o['n'] or '-', o['c'], o.get('p', ''))
