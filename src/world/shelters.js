import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

// Bus / taxi stop shelters at their real spots (src/data/durban-shelters.json,
// scripts/add-shelters.py: OSM bus stops with shelter=yes, public-transport
// shelters and stops where a Mapillary street photo shows a shelter, each
// checked against the photos; the Red Hill shelter).
// Two shelter types, modelled here in code from the street photos (CC0, this project):
//  'muni' eThekwini municipal shelter (Durban North, Phoenix, Berea Centre):
//         boxy, dark-blue square posts, flat blue roof overhanging on every side
//         with a curved front fascia, closed dark-grey back and end panels, a slim
//         ad / info light box at one end, steel bench, on a concrete pad.
//  'pm'   People Mover shelter (city loop): charcoal rounded-corner tube frames at
//         both ends, glass back and end, thin flat roof, the other end a green
//         leaf-graphic panel, steel bench and a timetable sheet.
// One merged vertex-coloured mesh per type (+ one glass mesh for 'pm'), drawn
// as InstancedMeshes = 3 draw calls for every shelter, ~900 triangles in all.
// Placement: on the pavement of the stop's own road (data 'rb' = road bearing
// from the photo, so a corner stop is not put on the side street), front at the
// kerb, then a clear gap of GAP m before any fence or wall: house fences are
// pushed back / cut there (buildings.addKeepOut), never inside an OSM compound.
// The shelter stands level at pavement height (road + kerb). Where the land
// behind is higher (data 'w', from the photo: Durban North) a retaining wall
// with a palisade on top and steps with handrails climb beside the shelter;
// the wall follows the road's slope.
// Only shelters near the camera are drawn. The back and end panels and walls
// are solid for the player, bikes and cars (collide(), chained into buildings.collide).
const SHOW_R = 450; // metres
const KERB_H = 0.16; // pavement above the road (roads.js)
const FRONT = 0.45; // kerb to the shelter front
const GAP = 0.9; // shelter back to the fence / wall
const D2R = Math.PI / 180;
const BRICK = 0xc29a7a;
const COPING = 0xb9b2a6;
const RAIL = 0xeeeeea;
const BANK = 0x7d9a4a;

const BLUE = 0x3a6cc4; // municipal shelter blue (posts, roof)
const BLUE_D = 0x24498f; // roof underside / fascia shade
const PANEL = 0x464c53; // dark-grey closed panels
const STEEL = 0x9aa0a6;
const POSTER = 0xe9e6da;
const POSTER_A = 0x2f6fb5;
const CONCRETE = 0xb3afa5;
const CHAR = 0x2b2f34; // People Mover frame charcoal
const LEAF = 0x3c9440;
const LEAF_L = 0x86c447;

// size and solid panels (local: +x along the kerb, +z the open front facing the road)
const TYPES = {
  muni: { L: 3.8, D: 1.6, solid: [[0, -0.78, 1.9, 0.08], [1.85, 0, 0.08, 0.8], [-1.85, 0.05, 0.16, 0.7]] },
  pm: { L: 3.3, D: 1.45, solid: [[0, -0.68, 1.65, 0.06], [1.62, -0.05, 0.06, 0.62], [-1.62, -0.05, 0.06, 0.62]] },
};

const _c = new THREE.Color();
function box(list, x, y, z, sx, sy, sz, color, rx = 0, ry = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.deleteAttribute('uv');
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  _c.setHex(color).convertSRGBToLinear();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  list.push(g);
}

// eThekwini municipal box shelter
function muniGeometry() {
  const o = [];
  const H = 2.45;
  box(o, 0, -0.2, -0.35, 4.6, 0.44, 2.9, CONCRETE); // paved bay: kerb to the gap before the fence
  for (const x of [-1.85, 1.85]) for (const z of [-0.75, 0.75]) box(o, x, H / 2, z, 0.1, H, 0.1, BLUE); // posts
  box(o, 0, H + 0.07, 0.12, 4.3, 0.14, 2.15, BLUE); // flat roof, overhangs all round
  box(o, 0, H - 0.01, 0.12, 4.1, 0.03, 1.95, BLUE_D); // soffit shade
  box(o, 0, H - 0.02, 1.22, 4.3, 0.24, 0.06, BLUE, -0.45); // curved front fascia (sloped strip)
  box(o, 0, H - 0.13, 1.27, 4.3, 0.05, 0.08, BLUE_D); // fascia lip
  box(o, 0, H + 0.06, -0.97, 4.3, 0.18, 0.05, BLUE); // back fascia
  box(o, 0, 1.25, -0.78, 3.6, 2.1, 0.05, PANEL); // closed back panel
  box(o, 0, 0.18, -0.78, 3.7, 0.08, 0.08, BLUE); // back rails
  box(o, 0, 2.32, -0.78, 3.7, 0.08, 0.08, BLUE);
  box(o, 1.85, 1.25, 0, 0.05, 2.1, 1.4, PANEL); // closed end panel
  box(o, 1.85, 2.32, 0, 0.08, 0.08, 1.5, BLUE);
  // ad / info light box at the other end, lit poster both faces
  box(o, -1.85, 1.22, 0.05, 0.26, 2.0, 1.32, BLUE);
  for (const s of [-1, 1]) {
    box(o, -1.85 + s * 0.135, 1.27, 0.05, 0.01, 1.66, 1.14, POSTER);
    box(o, -1.85 + s * 0.14, 1.72, 0.05, 0.01, 0.5, 1.14, POSTER_A);
  }
  // steel bench on the back panel
  box(o, 0.2, 0.46, -0.52, 2.3, 0.05, 0.4, STEEL);
  box(o, 0.2, 0.74, -0.73, 2.3, 0.26, 0.04, STEEL);
  for (const x of [-0.75, 1.15]) box(o, x, 0.24, -0.55, 0.06, 0.44, 0.34, STEEL);
  return mergeGeometries(o);
}

// rounded-rectangle tube loop in the y-z plane at x (People Mover end frame)
function loop(o, x, z0, z1, y0, y1, r, t, color) {
  const zc = (z0 + z1) / 2;
  const yc = (y0 + y1) / 2;
  box(o, x, yc, z0, t, y1 - y0 - 2 * r, t, color);
  box(o, x, yc, z1, t, y1 - y0 - 2 * r, t, color);
  box(o, x, y0, zc, t, t, z1 - z0 - 2 * r, color);
  box(o, x, y1, zc, t, t, z1 - z0 - 2 * r, color);
  // rounded corners: 3 straight segments per quarter circle
  const corners = [
    [z1 - r, y1 - r, 0],
    [z0 + r, y1 - r, Math.PI / 2],
    [z0 + r, y0 + r, Math.PI],
    [z1 - r, y0 + r, Math.PI * 1.5],
  ];
  for (const [cz, cy, a0] of corners) {
    for (let i = 0; i < 3; i++) {
      const a = a0 + (i * Math.PI) / 6;
      const b = a + Math.PI / 6;
      const pz = cz + r * Math.cos(a);
      const py = cy + r * Math.sin(a);
      const qz = cz + r * Math.cos(b);
      const qy = cy + r * Math.sin(b);
      const dz = qz - pz;
      const dy = qy - py;
      box(o, x, (py + qy) / 2, (pz + qz) / 2, t, t, Math.hypot(dz, dy) + t * 0.35, color, Math.atan2(-dy, dz));
    }
  }
}

// People Mover shelter: opaque parts + glass
function pmGeometry() {
  const o = [];
  const g = [];
  const H = 2.45;
  const X = 1.62;
  box(o, 0, -0.2, -0.33, 4.0, 0.44, 2.6, CONCRETE); // paved bay
  for (const x of [-X, X]) loop(o, x, -0.7, 0.7, 0.06, H, 0.32, 0.09, CHAR);
  box(o, 0, H, -0.7, 2 * X, 0.08, 0.08, CHAR); // top rails
  box(o, 0, H, 0.7, 2 * X, 0.08, 0.08, CHAR);
  box(o, 0, 0.3, -0.7, 2 * X, 0.07, 0.07, CHAR); // low back rail
  box(o, 0, H + 0.07, 0, 3.5, 0.05, 1.7, CHAR); // thin flat roof
  box(o, 0, H + 0.12, 0.84, 3.5, 0.08, 0.04, CHAR);
  box(g, 0, 1.36, -0.7, 2 * X - 0.1, 1.9, 0.02, 0); // glass back
  box(g, -X, 1.3, 0, 0.02, 1.75, 1.15, 0); // glass end
  // leaf-graphic end panel (green with lighter leaf strokes on both faces)
  box(o, X, 1.3, 0, 0.05, 1.75, 1.15, LEAF);
  for (const s of [-1, 1]) {
    box(o, X + s * 0.03, 1.55, -0.1, 0.01, 0.16, 0.9, LEAF_L, 0.6);
    box(o, X + s * 0.03, 1.15, 0.12, 0.01, 0.12, 0.7, LEAF_L, -0.5);
    box(o, X + s * 0.03, 0.8, -0.15, 0.01, 0.1, 0.5, LEAF_L, 0.4);
  }
  box(o, 0.85, 1.45, -0.68, 0.6, 0.8, 0.01, POSTER); // timetable sheet
  box(o, 0, 0.47, -0.45, 2.1, 0.05, 0.4, STEEL); // bench
  for (const x of [-0.8, 0.8]) box(o, x, 0.24, -0.5, 0.06, 0.45, 0.3, STEEL);
  return { solid: mergeGeometries(o), glass: mergeGeometries(g) };
}

export class Shelters {
  constructor(data, { roads, hf, buildings, grounds }) {
    this.roads = roads;
    this.hf = hf;
    this.buildings = buildings;
    this.grounds = grounds || null;
    this.group = new THREE.Group();
    this.group.name = 'shelters';
    this.sites = [];
    this.meshes = []; // { mesh, type }
    this.grid = new Map(); // 50 m cells -> solid panels / walls
    this.lastX = 1e9;
    this.lastZ = 1e9;
    this.skipped = [];
    for (const s of (data && data.shelters) || []) {
      try {
        const p = this.#place(s);
        if (p) this.sites.push(p);
        else {
          this.skipped.push(s.n || String(s.c));
          console.warn('[IZK] shelter skipped (no free kerb spot)', s.n || s.c);
        }
      } catch (err) {
        console.warn('[IZK] shelter skipped', s.n, err);
      }
    }
    for (const p of this.sites) {
      for (const [lx, lz, hx, hz] of TYPES[p.type].solid) this.#addSolid(p, lx, lz, hx, hz);
    }
    // keep house fences out of the shelter + gap (+ wall) strip
    if (buildings && buildings.addKeepOut) buildings.addKeepOut(this.sites.map((p) => p.zone));
  }

  // nearest drivable road; with a bearing, the nearest piece of road running
  // that way (probes across the expected road line, so one road that turns the
  // corner is still found on the right leg)
  #road(ox, oz, rb) {
    const ok = (r) => !r.bridge && r.rank < 9;
    const first = this.roads.nearestRoad(ox, oz, 60, ok);
    if (rb === undefined || rb === null) return first;
    const bx = Math.sin(rb * D2R);
    const bz = -Math.cos(rb * D2R);
    let best = null;
    for (const d of [0, 4, -4, 8, -8, 12, -12, 16, -16, 20, -20, 25, -25, 30, -30]) {
      const px = ox - bz * d;
      const pz = oz + bx * d;
      const nr = this.roads.nearestRoad(px, pz, 6, ok);
      if (!nr) continue;
      const l = Math.hypot(nr.dirX, nr.dirZ) || 1;
      if (Math.abs((nr.dirX * bx + nr.dirZ * bz) / l) < 0.85) continue;
      // distance from the stop to this road piece's line
      const dd = Math.abs(((ox - nr.x) * nr.dirZ - (oz - nr.z) * nr.dirX) / l);
      if (dd < 40 && (!best || dd < best.dd)) best = { ...nr, dd };
    }
    if (!best) return first;
    // project the stop onto that piece
    const l = Math.hypot(best.dirX, best.dirZ) || 1;
    const t = ((ox - best.x) * best.dirX + (oz - best.z) * best.dirZ) / (l * l);
    best.x += best.dirX * t;
    best.z += best.dirZ * t;
    best.dist = best.dd;
    return best;
  }

  #inGrounds(x, z) {
    const sites = this.grounds && this.grounds.sites;
    if (!sites) return false;
    for (const g of sites) {
      if (Math.abs(g.cx - x) > 400 || Math.abs(g.cz - z) > 400) continue;
      const r = g.ring;
      let inside = false;
      for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
        const [ax, az] = r[j];
        const [bx, bz] = r[k];
        if (bz > z !== az > z && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  // on the pavement of the stop's road, on the side the stop is mapped
  #place(s) {
    const type = TYPES[s.t] ? s.t : 'muni';
    const T = TYPES[type];
    const [ox, oz] = s.c;
    const nr = this.#road(ox, oz, s.rb);
    if (!nr) return null;
    const l = Math.hypot(nr.dirX, nr.dirZ) || 1;
    const ux = nr.dirX / l;
    const uz = nr.dirZ / l;
    let nx = -uz; // away from the road, towards the stop
    let nz = ux;
    if ((ox - nr.x) * nx + (oz - nr.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const hw = nr.road.width / 2;
    const off = hw + FRONT + T.D / 2;
    const back = T.D / 2 + GAP; // centre -> fence line
    const wall = s.w && s.w.h > 0.3 ? s.w : null;
    let best = null;
    for (const along of [0, 3, -3, 6, -6, 9, -9]) {
      const x = nr.x + ux * along + nx * off;
      const z = nr.z + uz * along + nz * off;
      if (this.hf.isWater && this.hf.isWater(x, z)) continue;
      // the shelter, and its gap behind, are clear of buildings and compounds
      const pts = [[0, 0], [-T.L / 2, back], [T.L / 2, back], [-T.L / 2, -T.D / 2], [T.L / 2, -T.D / 2]];
      let bad = false;
      for (const [a, b] of pts) {
        const px = x + ux * a + nx * b;
        const pz = z + uz * a + nz * b;
        if (this.buildings && this.buildings.blocked && this.buildings.blocked(px, pz, a === 0 && b === 0 ? 1.0 : 0.3)) bad = true;
        else if (this.#inGrounds(px, pz)) bad = true;
        if (bad) break;
      }
      if (bad) continue;
      // not on top of another road (junction corners)
      const other = this.roads.nearestRoad(x, z, 14, (r) => r !== nr.road && !r.bridge);
      if (other && other.dist < other.road.width / 2 + T.L / 2) continue;
      best = { x, z, along };
      break;
    }
    if (!best) return null;
    const rx = nr.x + ux * best.along;
    const rz = nr.z + uz * best.along;
    const roadY = this.roads.surfaceAt(rx, rz, null).y;
    const y = roadY + KERB_H; // level on the pavement
    // model +z is the open front: face the road (-n)
    const yaw = Math.atan2(-nx, -nz);
    const site = { od: +nr.dist.toFixed(1), along: best.along, hw, name: s.n, type, x: best.x, y, z: best.z, yaw, mx: Math.cos(yaw), mz: -Math.sin(yaw), nx, nz, rx, rz, wall };
    let hl = T.L / 2 + 1.2;
    let far = back;
    if (wall) {
      hl = T.L / 2 + 6.5;
      far = back + 0.3 + 2.8;
    }
    // keep-out strip for fences, in the fence's own terms: along +-hl, from the
    // road edge out to `far` behind the shelter centre
    site.zone = { x: best.x, z: best.z, ux, uz, nx, nz, hl, near: -(T.D / 2 + FRONT + 0.2), far };
    return site;
  }

  // oriented box in the site frame (lx along +u, lz towards the road = -n) for collide()
  #addSolid(p, lx, lz, hx, hz) {
    const c = Math.cos(p.yaw);
    const sn = Math.sin(p.yaw);
    // local (lx, lz) -> world: x = lx*cos + lz*sin, z = -lx*sin + lz*cos
    const b = { x: p.x + lx * c + lz * sn, z: p.z - lx * sn + lz * c, ux: c, uz: -sn, hx, hz, y: p.y };
    const k = Math.floor(b.x / 50) * 100000 + Math.floor(b.z / 50);
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(b);
  }

  // Retaining wall + palisade + steps behind a stop on a slope, built in the
  // site frame and following the road's height along the kerb.
  #wallGeometry(p) {
    const T = TYPES[p.type];
    const o = [];
    const h = Math.min(p.wall.h, 3);
    const wz = -(T.D / 2 + GAP + 0.15); // wall centre line (local z, behind = negative)
    // steps on the side the photo shows them
    const sbx = Math.sin(p.wall.sb * D2R);
    const sbz = -Math.cos(p.wall.sb * D2R);
    const side = p.mx * sbx + p.mz * sbz >= 0 ? 1 : -1; // model +x towards the steps?
    const s0 = T.L / 2 + 2.0;
    const s1 = s0 + 1.4;
    const a0 = -(T.L / 2 + 6);
    const a1 = T.L / 2 + 6.5;
    const yAt = (a) => {
      const x = p.rx + p.mx * a;
      const z = p.rz + p.mz * a;
      return this.roads.surfaceAt(x, z, null).y + KERB_H - p.y;
    };
    const pieces = [];
    for (const [u0, u1] of [[a0, s0], [s1, a1]]) {
      const k = Math.ceil((u1 - u0) / 1.5);
      for (let i = 0; i < k; i++) pieces.push([u0 + ((u1 - u0) * i) / k, u0 + ((u1 - u0) * (i + 1)) / k]);
    }
    for (const [a, b] of pieces) {
      const m = (a + b) / 2;
      const am = m * side; // along in model x
      const len = b - a;
      const y0 = yAt(am);
      box(o, am, y0 + h / 2 - 0.25, wz, len + 0.02, h + 0.5, 0.3, BRICK); // brick retaining wall
      box(o, am, y0 + h + 0.03, wz, len + 0.04, 0.06, 0.36, COPING);
      box(o, am, y0 + (h - 0.3) / 2, wz - 1.55, len + 0.02, h + 0.3, 2.8, BANK); // higher ground behind
      // white palisade on the wall: two rails and pales
      box(o, am, y0 + h + 0.25, wz, len, 0.05, 0.04, RAIL);
      box(o, am, y0 + h + 1.05, wz, len, 0.05, 0.04, RAIL);
      for (let q = a + 0.15; q < b; q += 0.3) box(o, q * side, y0 + h + 0.62, wz, 0.04, 1.2, 0.04, RAIL);
      this.#addSolid(p, am, wz, len / 2, 0.15);
    }
    // steps with white handrails, climbing through the notch to the higher ground
    const n = Math.max(3, Math.round(h / 0.17));
    const rise = h / n;
    const run = 0.3;
    const sm = ((s0 + s1) / 2) * side;
    const y0 = yAt(sm);
    for (let k = 0; k < n; k++) {
      box(o, sm, y0 + (rise * (k + 1)) / 2 - 0.1, wz + 0.15 - run * (k + 0.5), 1.4, rise * (k + 1) + 0.2, run, COPING);
    }
    const top = wz + 0.15 - run * n;
    box(o, sm, y0 + h - 0.05, top - 0.5, 1.4, 0.1, 1.0, COPING); // landing
    const slope = Math.atan2(h, run * n);
    const rl = Math.hypot(h, run * n);
    for (const e of [-0.7, 0.7]) {
      const ax = sm + e;
      box(o, ax, y0 + h / 2 + 0.9, wz + 0.15 - (run * n) / 2, 0.05, 0.05, rl, RAIL, slope);
      box(o, ax, y0 + 0.45, wz + 0.1, 0.05, 0.9, 0.05, RAIL);
      box(o, ax, y0 + h + 0.45, top, 0.05, 0.9, 0.05, RAIL);
    }
    const g = mergeGeometries(o);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    return g;
  }

  // Push a circle (x, z, r) out of the shelter panels: null when clear, else
  // { x, z, nx, nz } (same contract as buildings.collide / kasi.collide).
  collide(x, z, r) {
    const gx = Math.floor(x / 50);
    const gz = Math.floor(z / 50);
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gz - 1; b <= gz + 1; b++) {
        const l = this.grid.get(a * 100000 + b);
        if (!l) continue;
        for (const s of l) {
          const dx = x - s.x;
          const dz = z - s.z;
          const lu = dx * s.ux + dz * s.uz;
          const lv = dx * -s.uz + dz * s.ux;
          if (Math.abs(lu) > s.hx + r || Math.abs(lv) > s.hz + r) continue;
          const cu = Math.max(-s.hx, Math.min(s.hx, lu));
          const cv = Math.max(-s.hz, Math.min(s.hz, lv));
          let du = lu - cu;
          let dv = lv - cv;
          let fu = cu;
          let fv = cv;
          const d = Math.hypot(du, dv);
          if (d >= r) continue;
          if (d < 1e-4) {
            const pu = s.hx - Math.abs(lu);
            const pv = s.hz - Math.abs(lv);
            if (pu < pv) {
              du = Math.sign(lu) || 1;
              dv = 0;
              fu = du * s.hx;
            } else {
              du = 0;
              dv = Math.sign(lv) || 1;
              fv = dv * s.hz;
            }
          } else {
            du /= d;
            dv /= d;
          }
          const pu2 = fu + du * r;
          const pv2 = fv + dv * r;
          return { x: s.x + pu2 * s.ux - pv2 * s.uz, z: s.z + pu2 * s.uz + pv2 * s.ux, nx: du * s.ux - dv * s.uz, nz: du * s.uz + dv * s.ux };
        }
      }
    }
    return null;
  }

  async load() {
    if (!this.sites.length) return;
    const count = { muni: 0, pm: 0 };
    for (const s of this.sites) count[s.type]++;
    const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xc4d6da, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const add = (geo, mat, type, name) => {
      if (!geo || !count[type]) return;
      const mesh = new THREE.InstancedMesh(geo, mat, count[type]);
      mesh.name = name;
      mesh.count = 0;
      mesh.frustumCulled = false;
      if (mat === glassMat) mesh.renderOrder = 2;
      this.group.add(mesh);
      this.meshes.push({ mesh, type });
    };
    add(muniGeometry(), solidMat, 'muni', 'shelter-muni');
    const pm = pmGeometry();
    add(pm.solid, solidMat, 'pm', 'shelter-pm');
    add(pm.glass, glassMat, 'pm', 'shelter-pm-glass');
    // retaining walls + steps (a handful of stops): one static merged mesh
    const walls = [];
    for (const p of this.sites) if (p.wall) walls.push(this.#wallGeometry(p));
    if (walls.length) {
      const wm = new THREE.Mesh(walls.length === 1 ? walls[0] : mergeGeometries(walls), solidMat);
      wm.name = 'shelter-walls';
      this.group.add(wm);
    }
    this.lastX = 1e9;
  }

  update(px, pz) {
    if (!this.meshes.length) return;
    if (Math.abs(px - this.lastX) < 25 && Math.abs(pz - this.lastZ) < 25) return;
    this.lastX = px;
    this.lastZ = pz;
    const m = this._m || (this._m = new THREE.Matrix4());
    const q = this._q || (this._q = new THREE.Quaternion());
    const p = this._p || (this._p = new THREE.Vector3());
    const one = this._s || (this._s = new THREE.Vector3(1, 1, 1));
    const up = this._u || (this._u = new THREE.Vector3(0, 1, 0));
    const k = { muni: 0, pm: 0 };
    for (const s of this.sites) {
      if (Math.abs(s.x - px) > SHOW_R || Math.abs(s.z - pz) > SHOW_R) continue;
      q.setFromAxisAngle(up, s.yaw);
      p.set(s.x, s.y, s.z);
      m.compose(p, q, one);
      for (const { mesh, type } of this.meshes) if (type === s.type) mesh.setMatrixAt(k[type], m);
      k[s.type]++;
    }
    for (const { mesh, type } of this.meshes) {
      mesh.count = k[type];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
