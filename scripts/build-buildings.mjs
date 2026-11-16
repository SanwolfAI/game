// Packs the cached OSM building tiles (see fetch-buildings.mjs) into a compact
// binary file the game streams from: src/data/durban-buildings.bin, plus the
// green/land-use areas as src/data/durban-areas.json.
//
// Binary layout (little endian), buildings sorted by 250 m grid cell:
//   char[4] 'IZKB', u32 version=1, u32 count, u32 deltaCount
//   u8  kind[count]     (see KIND below)
//   u8  zone[count]     (land-use zone the centroid falls in, see ZONE)
//   u8  levels[count]   (OSM building:levels, 0 = unknown)
//   u8  npts[count]     (ring points, closing point dropped)
//   u16 heightDm[count] (OSM height in decimetres, 0 = unknown)
//   pad to 4 bytes
//   i32 start[count*2]  (first point x,z in decimetres, world metres = toXZ)
//   i16 delta[deltaCount*2] (following points, dm deltas)
import fs from 'node:fs';
import { toXZ } from '../src/core/geo.js';

const CACHE = process.env.OSM_TILE_CACHE || new URL('../../work/osm-tiles/', import.meta.url).pathname;
const OUT = new URL('../src/data/', import.meta.url).pathname;

export const KIND = {
  yes: 0, house: 1, apartments: 2, commercial: 3, industrial: 4, small: 5, civic: 6, terrace: 7, tank: 8, hotel: 9, roof: 10, construction: 11
};
const KIND_OF = {
  house: 'house', detached: 'house', semidetached_house: 'house', bungalow: 'house', hut: 'small', cabin: 'small',
  apartments: 'apartments', residential: 'apartments', dormitory: 'apartments', flats: 'apartments',
  commercial: 'commercial', office: 'commercial', retail: 'commercial', mall: 'commercial', supermarket: 'commercial', kiosk: 'small',
  hotel: 'hotel',
  industrial: 'industrial', warehouse: 'industrial', factory: 'industrial', manufacture: 'industrial', hangar: 'industrial', service: 'industrial',
  garage: 'small', garages: 'small', shed: 'small', carport: 'roof', roof: 'roof', greenhouse: 'small', stable: 'small', toilets: 'small',
  school: 'civic', university: 'civic', college: 'civic', hospital: 'civic', church: 'civic', mosque: 'civic', temple: 'civic', public: 'civic',
  government: 'civic', civic: 'civic', train_station: 'civic', transportation: 'civic', stadium: 'civic', grandstand: 'civic', kindergarten: 'civic',
  terrace: 'terrace', storage_tank: 'tank', silo: 'tank', construction: 'construction'
};
export const ZONE = { none: 0, industrial: 1, commercial: 2, retail: 3, port: 4, park: 5, school: 6, residential: 7, cemetery: 8 };

function readTiles(prefix) {
  const seen = new Set();
  const out = [];
  for (const f of fs.readdirSync(CACHE)) {
    if (!f.startsWith(prefix)) continue;
    for (const e of JSON.parse(fs.readFileSync(CACHE + f, 'utf8'))) {
      if (e.type !== 'way' || !e.geometry || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

function ringXZ(geom) {
  const pts = [];
  for (const g of geom) {
    if (!g) continue;
    const [x, z] = toXZ(g.lon, g.lat);
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - x) < 0.05 && Math.abs(last[1] - z) < 0.05) continue;
    pts.push([x, z]);
  }
  if (pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05) pts.pop();
  }
  return pts;
}

function area(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return s / 2;
}

// Ramer-Douglas-Peucker on a closed ring (iterative, no recursion).
function simplifyRing(pts, eps) {
  if (pts.length <= 4) return pts;
  const n = pts.length;
  const keep = new Uint8Array(n);
  // split at the point farthest from pts[0]
  let far = 0;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const pa = pts[a];
    const pb = pts[b % n];
    let best = -1;
    let bd = eps;
    for (let i = a + 1; i < b; i++) {
      const p = pts[i];
      const dx = pb[0] - pa[0];
      const dz = pb[1] - pa[1];
      const l = Math.hypot(dx, dz) || 1e-9;
      const d = Math.abs((p[0] - pa[0]) * dz - (p[1] - pa[1]) * dx) / l;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out.length >= 3 ? out : pts;
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---- areas ------------------------------------------------------------------
const AREA_KIND = (t) => {
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'recreation_ground' || t.leisure === 'playground' || t.landuse === 'village_green' || t.landuse === 'recreation_ground') return 'park';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.leisure === 'pitch' || t.leisure === 'stadium') return 'pitch';
  if (t.leisure === 'nature_reserve') return 'reserve';
  if (t.landuse === 'forest' || t.natural === 'wood') return 'wood';
  if (t.natural === 'scrub' || t.natural === 'heath') return 'scrub';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.natural === 'grassland') return 'grass';
  if (t.natural === 'wetland') return 'wetland';
  if (t.natural === 'sand' || t.natural === 'beach') return 'sand';
  if (t.landuse === 'farmland') return 'farmland';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (t.landuse === 'industrial' || t.landuse === 'railway' || t.landuse === 'brownfield' || t.landuse === 'construction') return 'industrial';
  if (t.landuse === 'port') return 'port';
  if (t.landuse === 'commercial') return 'commercial';
  if (t.landuse === 'retail') return 'retail';
  if (t.amenity === 'parking') return 'parking';
  if (t.amenity === 'school') return 'school';
  return null;
};

const areas = [];
for (const e of readTiles('area-')) {
  const k = AREA_KIND(e.tags || {});
  if (!k) continue;
  let ring = ringXZ(e.geometry);
  if (ring.length < 3) continue;
  const a = Math.abs(area(ring));
  if (a < 150) continue;
  ring = simplifyRing(ring, 1.0);
  areas.push({ k, a: Math.round(a), ring });
}
areas.sort((p, q) => q.a - p.a);
const areaJson = areas.map((r) => {
  const p = [];
  for (const [x, z] of r.ring) p.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
  return { k: r.k, a: r.a, p };
});
fs.writeFileSync(`${OUT}durban-areas.json`, JSON.stringify({ v: 1, areas: areaJson }));
console.log('areas', areas.length, (fs.statSync(`${OUT}durban-areas.json`).size / 1e6).toFixed(2), 'MB');

// zone lookup grid (smaller areas win: they are listed last)
const ZG = 200;
const zoneGrid = new Map();
for (const r of areas) {
  const zk = { industrial: 'industrial', port: 'port', commercial: 'commercial', retail: 'retail', park: 'park', school: 'school', cemetery: 'cemetery' }[r.k];
  if (!zk) continue;
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (const [x, z] of r.ring) {
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (z < minz) minz = z;
    if (z > maxz) maxz = z;
  }
  r.zone = ZONE[zk];
  r.bb = [minx, minz, maxx, maxz];
  for (let cz = Math.floor(minz / ZG); cz <= Math.floor(maxz / ZG); cz++) {
    for (let cx = Math.floor(minx / ZG); cx <= Math.floor(maxx / ZG); cx++) {
      const key = cx * 100000 + cz;
      let l = zoneGrid.get(key);
      if (!l) zoneGrid.set(key, (l = []));
      l.push(r);
    }
  }
}
function zoneAt(x, z) {
  const l = zoneGrid.get(Math.floor(x / ZG) * 100000 + Math.floor(z / ZG));
  if (!l) return 0;
  let best = 0;
  let bestA = Infinity;
  for (const r of l) {
    if (x < r.bb[0] || x > r.bb[2] || z < r.bb[1] || z > r.bb[3]) continue;
    if (r.a < bestA && pointInRing(x, z, r.ring)) {
      best = r.zone;
      bestA = r.a;
    }
  }
  return best;
}

// ---- buildings ----------------------------------------------------------------
const CELL = 250;
const list = [];
let skipped = 0;
for (const e of readTiles('bld-')) {
  const t = e.tags || {};
  if (t.building === 'ruins' || t.building === 'no' || t.building === 'collapsed' || t.building === 'demolished') continue;
  if (t.location === 'underground' || (t.layer && Number(t.layer) < 0)) continue;
  let ring = ringXZ(e.geometry);
  if (ring.length < 3) continue;
  let a = area(ring);
  if (Math.abs(a) < 12) {
    skipped++;
    continue;
  }
  if (a < 0) ring.reverse(); // store counter-clockwise in x/z (signed area > 0)
  ring = simplifyRing(ring, 0.35);
  if (ring.length > 255) ring = simplifyRing(ring, 1.5).slice(0, 255);
  a = Math.abs(area(ring));
  let cx = 0;
  let cz = 0;
  for (const p of ring) {
    cx += p[0];
    cz += p[1];
  }
  cx /= ring.length;
  cz /= ring.length;
  const kind = KIND[KIND_OF[t.building] || 'yes'];
  let h = parseFloat(t.height);
  if (!(h > 0)) h = 0;
  const lv = Math.min(255, Math.max(0, Math.round(parseFloat(t['building:levels']) || 0)));
  list.push({ ring, kind, zone: zoneAt(cx, cz), lv, h: Math.min(65535, Math.round(h * 10)), cell: Math.floor(cx / CELL) * 100000 + Math.floor(cz / CELL) });
}
list.sort((p, q) => p.cell - q.cell);
const count = list.length;
let deltaCount = 0;
for (const b of list) deltaCount += b.ring.length - 1;
let off = 16 + count * 6;
off = (off + 3) & ~3;
const size = off + count * 8 + deltaCount * 4;
const buf = Buffer.alloc(size);
buf.write('IZKB', 0, 'ascii');
buf.writeUInt32LE(1, 4);
buf.writeUInt32LE(count, 8);
buf.writeUInt32LE(deltaCount, 12);
let o = 16;
for (const b of list) buf.writeUInt8(b.kind, o++);
for (const b of list) buf.writeUInt8(b.zone, o++);
for (const b of list) buf.writeUInt8(b.lv, o++);
for (const b of list) buf.writeUInt8(b.ring.length, o++);
for (const b of list) {
  buf.writeUInt16LE(b.h, o);
  o += 2;
}
o = off;
for (const b of list) {
  buf.writeInt32LE(Math.round(b.ring[0][0] * 10), o);
  buf.writeInt32LE(Math.round(b.ring[0][1] * 10), o + 4);
  o += 8;
}
let clipped = 0;
for (const b of list) {
  let px = Math.round(b.ring[0][0] * 10);
  let pz = Math.round(b.ring[0][1] * 10);
  for (let i = 1; i < b.ring.length; i++) {
    const x = Math.round(b.ring[i][0] * 10);
    const z = Math.round(b.ring[i][1] * 10);
    let dx = x - px;
    let dz = z - pz;
    if (Math.abs(dx) > 32767 || Math.abs(dz) > 32767) clipped++;
    dx = Math.max(-32767, Math.min(32767, dx));
    dz = Math.max(-32767, Math.min(32767, dz));
    buf.writeInt16LE(dx, o);
    buf.writeInt16LE(dz, o + 2);
    o += 4;
    px += dx;
    pz += dz;
  }
}
fs.writeFileSync(`${OUT}durban-buildings.bin`, buf);
const kinds = {};
for (const b of list) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
const zones = {};
for (const b of list) zones[b.zone] = (zones[b.zone] || 0) + 1;
console.log('buildings', count, 'skipped tiny', skipped, 'points', count + deltaCount, 'clipped', clipped, (size / 1e6).toFixed(2), 'MB');
console.log('kinds', JSON.stringify(kinds), 'zones', JSON.stringify(zones));
