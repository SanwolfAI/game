import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32 } from '../core/utils.js';

// Township ("kasi") street dressing for Umlazi and KwaMashu.
//  - Container spaza shops: 6 m (some 12 m) shipping containers with a cut
//    serving hatch behind burglar bars, a painted sign and an iron awning.
//    Research (19 Nov 2026): eThekwini trader notices list container parks,
//    news reports describe spaza owners in KwaMashu/Inanda/Ntuzuma using
//    shipping containers, and KwaMashu Mapillary street photos (2019) show
//    the kiosks standing on street corners. So: corners of township streets
//    and along the main township roads, never on the road or in a house.
//  - Wooden electricity poles with a crossarm and three wires along the
//    township streets (seen on every KwaMashu Mapillary photo).
// OSM has no container or pole data here, so placement is rule-based but
// seeded, so every player gets the same township.
// Loops only, no array spreads (Android WebView stack).

// world metres: [x, z, radius]
const ZONES = [
  { name: 'Umlazi', x: -13200, z: 11200, r: 3600 },
  { name: 'KwaMashu', x: -5480, z: -12900, r: 2400 }
];
const SHOW = 750; // m: cells within this of the camera are drawn
const CELL = 500;

const PAINT = ['#c8262b', '#1f5fa8', '#2d8a3e', '#f2c21b', '#f4f1ea', '#e0671f', '#7a1f2b', '#9aa3a8', '#1c8c9c', '#5b3a8c'].map((h) => new THREE.Color(h));
const SIGNS = ['SPAZA SHOP', 'TUCK SHOP', 'AIRTIME & DATA', 'BARBER SHOP', 'KOTA & CHIPS', 'PHONE REPAIRS', 'SALON', 'GENERAL DEALER'];
const SIGN_BG = ['#c8262b', '#f2c21b', '#1f5fa8', '#111111', '#e0671f', '#2d8a3e', '#d63384', '#f4f1ea'];
const SIGN_FG = ['#ffffff', '#111111', '#ffffff', '#f2c21b', '#ffffff', '#ffffff', '#ffffff', '#c8262b'];

// atlas: 4 x 4 tiles of 128 px
const T = 4;
function tile(i) {
  const u0 = (i % T) / T;
  const v1 = 1 - Math.floor(i / T) / T;
  return [u0 + 0.004, v1 - 1 / T + 0.004, u0 + 1 / T - 0.004, v1 - 0.004];
}
const TILE = { side: 0, hatch: 1, doors: 2, roof: 3, wood: 4, wire: 5, brick: 6, sign0: 8 };

function makeAtlas() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * T;
  const g = c.getContext('2d');
  const at = (i) => [(i % T) * S, Math.floor(i / T) * S];
  // corrugated side (light, tinted by paint)
  const ribs = (x0, y0, w, h, n) => {
    g.fillStyle = '#e8e8e8';
    g.fillRect(x0, y0, w, h);
    for (let k = 0; k < n; k++) {
      const x = x0 + (k * w) / n;
      g.fillStyle = '#ffffff';
      g.fillRect(x, y0, w / n / 3, h);
      g.fillStyle = '#b9b9b9';
      g.fillRect(x + (w / n) * 0.62, y0, w / n / 4, h);
    }
    // rust / dirt streaks
    g.fillStyle = 'rgba(120,70,40,0.18)';
    for (let k = 0; k < 9; k++) g.fillRect(x0 + Math.random() * w, y0 + h * 0.7, 2 + Math.random() * 4, h * 0.3);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x0, y0 + h - 8, w, 8);
  };
  let [x, y] = at(TILE.side);
  ribs(x, y, S, S, 22);
  // front with serving hatch + burglar bars
  [x, y] = at(TILE.hatch);
  ribs(x, y, S, S, 22);
  g.fillStyle = '#2a2420';
  g.fillRect(x + 20, y + 30, 88, 52); // opening
  // shelves with stock
  const stock = ['#f2c21b', '#c8262b', '#1f5fa8', '#2d8a3e', '#ffffff', '#e0671f'];
  for (let r = 0; r < 3; r++) {
    g.fillStyle = '#6b4a2f';
    g.fillRect(x + 20, y + 44 + r * 14, 88, 2);
    for (let k = 0; k < 14; k++) {
      g.fillStyle = stock[(k * 7 + r * 3) % stock.length];
      g.fillRect(x + 22 + k * 6, y + 34 + r * 14, 4, 9);
    }
  }
  g.fillStyle = '#5b3d27';
  g.fillRect(x + 16, y + 80, 96, 6); // counter
  g.strokeStyle = '#d9d9d9';
  g.lineWidth = 2;
  for (let k = 0; k <= 11; k++) {
    g.beginPath();
    g.moveTo(x + 20 + k * 8, y + 30);
    g.lineTo(x + 20 + k * 8, y + 82);
    g.stroke();
  }
  for (let k = 0; k <= 3; k++) {
    g.beginPath();
    g.moveTo(x + 20, y + 30 + k * 17);
    g.lineTo(x + 108, y + 30 + k * 17);
    g.stroke();
  }
  // door end with lock bars
  [x, y] = at(TILE.doors);
  ribs(x, y, S, S, 16);
  g.fillStyle = '#8c8c8c';
  g.fillRect(x + S / 2 - 1, y, 2, S);
  for (const fx of [0.18, 0.36, 0.64, 0.82]) g.fillRect(x + S * fx, y + 6, 3, S - 12);
  // iron roof sheet
  [x, y] = at(TILE.roof);
  g.fillStyle = '#a9adb0';
  g.fillRect(x, y, S, S);
  for (let k = 0; k < 16; k++) {
    g.fillStyle = k % 2 ? '#c4c7c9' : '#8e9396';
    g.fillRect(x + k * 8, y, 3, S);
  }
  g.fillStyle = 'rgba(140,80,40,0.25)';
  g.fillRect(x, y + S * 0.6, S, S * 0.4);
  // creosote wood (poles)
  [x, y] = at(TILE.wood);
  g.fillStyle = '#5a4532';
  g.fillRect(x, y, S, S);
  for (let k = 0; k < 30; k++) {
    g.fillStyle = k % 2 ? 'rgba(30,20,10,0.35)' : 'rgba(120,95,70,0.3)';
    g.fillRect(x + Math.random() * S, y, 1 + Math.random() * 2, S);
  }
  // wire (dark)
  [x, y] = at(TILE.wire);
  g.fillStyle = '#1a1a1a';
  g.fillRect(x, y, S, S);
  // brick plinth
  [x, y] = at(TILE.brick);
  g.fillStyle = '#8a8178';
  g.fillRect(x, y, S, S);
  g.fillStyle = '#6d655d';
  for (let r = 0; r < 8; r++) g.fillRect(x, y + r * 16, S, 2);
  // signs: hand-painted boards
  for (let i = 0; i < SIGNS.length; i++) {
    [x, y] = at(TILE.sign0 + i);
    g.fillStyle = SIGN_BG[i];
    g.fillRect(x, y, S, S);
    g.fillStyle = SIGN_FG[i];
    const words = SIGNS[i].split(' ');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 30px sans-serif';
    if (words.length === 1) g.fillText(words[0], x + S / 2, y + S / 2, S - 10);
    else {
      g.fillText(words[0], x + S / 2, y + S * 0.33, S - 10);
      g.font = 'bold 26px sans-serif';
      g.fillText(words.slice(1).join(' '), x + S / 2, y + S * 0.7, S - 10);
    }
    g.strokeStyle = SIGN_FG[i];
    g.lineWidth = 4;
    g.strokeRect(x + 4, y + 4, S - 8, S - 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

// growable mesh buffer
class Buf {
  constructor() {
    this.p = [];
    this.n = [];
    this.u = [];
    this.c = [];
  }
  quad(a, b, cc, d, nrm, uv, col) {
    // a b c d counter-clockwise seen from the front
    const P = this.p;
    const N = this.n;
    const U = this.u;
    const C = this.c;
    const tri = [a, b, cc, a, cc, d];
    const tuv = [
      [uv[0], uv[1]],
      [uv[2], uv[1]],
      [uv[2], uv[3]],
      [uv[0], uv[1]],
      [uv[2], uv[3]],
      [uv[0], uv[3]]
    ];
    for (let k = 0; k < 6; k++) {
      P.push(tri[k][0], tri[k][1], tri[k][2]);
      N.push(nrm[0], nrm[1], nrm[2]);
      U.push(tuv[k][0], tuv[k][1]);
      C.push(col.r, col.g, col.b);
    }
  }
  geometry() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE = new THREE.Color(1, 1, 1);

// oriented box: centre (cx, cz), half sizes along u (hx) and v (hz), y0..y1.
// faces: [front(+v), back(-v), right(+u), left(-u), top] tiles
function box(B, cx, cz, ux, uz, hx, hz, y0, y1, tiles, col, colTop = col) {
  const vx = -uz;
  const vz = ux;
  const P = (su, sv, y) => [cx + ux * hx * su + vx * hz * sv, y, cz + uz * hx * su + vz * hz * sv];
  // front: faces +v
  if (tiles[0] === TILE.hatch) {
    // plain corrugated | serving hatch (about 2.4 m) | plain corrugated
    const m = Math.min(1, 1.2 / hx);
    const flip = (uv) => [uv[2], uv[1], uv[0], uv[3]];
    B.quad(P(1, 1, y0), P(m, 1, y0), P(m, 1, y1), P(1, 1, y1), [vx, 0, vz], tile(TILE.side), col);
    B.quad(P(m, 1, y0), P(-m, 1, y0), P(-m, 1, y1), P(m, 1, y1), [vx, 0, vz], flip(tile(TILE.hatch)), col);
    B.quad(P(-m, 1, y0), P(-1, 1, y0), P(-1, 1, y1), P(-m, 1, y1), [vx, 0, vz], tile(TILE.side), col);
  } else if (tiles[0] !== null) {
    const uv = tile(tiles[0]);
    B.quad(P(1, 1, y0), P(-1, 1, y0), P(-1, 1, y1), P(1, 1, y1), [vx, 0, vz], [uv[2], uv[1], uv[0], uv[3]], col);
  }
  if (tiles[1] !== null) B.quad(P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1), [-vx, 0, -vz], tile(tiles[1]), col);
  if (tiles[2] !== null) B.quad(P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1), [ux, 0, uz], tile(tiles[2]), col);
  if (tiles[3] !== null) B.quad(P(-1, 1, y0), P(-1, -1, y0), P(-1, -1, y1), P(-1, 1, y1), [-ux, 0, -uz], tile(tiles[3]), col);
  if (tiles[4] !== null) B.quad(P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1), [0, 1, 0], tile(tiles[4]), colTop);
}

export class Kasi {
  constructor({ roads, hf, buildings }) {
    this.roads = roads;
    this.hf = hf;
    this.buildings = buildings;
    this.group = new THREE.Group();
    this.group.name = 'kasi';
    this.spazas = []; // {x, z, ux, uz, hx, hz, y}
    this.poles = [];
    this.grid = new Map();
    this.cells = new Map();
    const t0 = performance.now();
    const rng = mulberry32(19112026);
    this.#placeSpazas(rng);
    this.#placePoles(rng);
    this.#build(rng);
    this.ms = performance.now() - t0;
  }

  #zone(x, z) {
    for (const Z of ZONES) if ((x - Z.x) * (x - Z.x) + (z - Z.z) * (z - Z.z) < Z.r * Z.r) return Z;
    return null;
  }

  #free(x, z, ux, uz, hx, hz) {
    const hf = this.hf;
    if (hf.isWater && hf.isWater(x, z)) return false;
    // no road within the footprint (+ kerb room)
    const near = this.roads.nearestRoad(x, z, 30);
    if (near && near.dist - near.road.width / 2 < Math.max(hx, hz) * 0.55 + 1.2) return false;
    // not inside or touching a house
    const vx = -uz;
    const vz = ux;
    const pts = [
      [0, 0],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1]
    ];
    for (const [su, sv] of pts) {
      const px = x + ux * hx * su + vx * hz * sv;
      const pz = z + uz * hx * su + vz * hz * sv;
      if (this.buildings && this.buildings.blocked(px, pz, 0.8)) return false;
    }
    for (const s of this.spazas) if (Math.abs(s.x - x) < 9 && Math.abs(s.z - z) < 9) return false;
    return true;
  }

  // put a container beside road `road` at its end `end` (0 start / 1 end),
  // `along` metres in from the junction, on side +1/-1
  #tryAt(road, along, side, rng) {
    const pts = road.pts;
    // find point + direction `along` metres along the road
    let i = 0;
    while (i < pts.length - 2 && road.cum[i + 1] < along) i++;
    const seg = Math.max(1e-3, road.cum[i + 1] - road.cum[i]);
    const t = Math.min(1, Math.max(0, (along - road.cum[i]) / seg));
    const ax = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
    const az = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    let ux = pts[i + 1][0] - pts[i][0];
    let uz = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    const big = rng() < 0.18;
    const hx = big ? 6.1 : 3.03;
    const hz = 1.22;
    // v = (-uz, ux) is the container's front normal; front must face the road
    const nx = -uz * side;
    const nz = ux * side;
    const off = road.width / 2 + 2.4 + hz + 0.9; // pavement / verge, then the box
    const x = ax + nx * off;
    const z = az + nz * off;
    // orientation: front normal (−nx,−nz) points back at the road
    const fx = -nx;
    const fz = -nz;
    const cux = fz; // u such that v = (-uz,ux) = front
    const cuz = -fx;
    if (!this.#free(x, z, cux, cuz, hx, hz)) return false;
    this.spazas.push({ x, z, ux: cux, uz: cuz, hx, hz, big, paint: Math.floor(rng() * PAINT.length), sign: Math.floor(rng() * SIGNS.length) });
    // sometimes a second one beside it (rows of containers are common)
    if (rng() < 0.3) {
      const x2 = x + cux * (hx * 2 + 0.6);
      const z2 = z + cuz * (hx * 2 + 0.6);
      if (this.#free(x2, z2, cux, cuz, 3.03, hz)) this.spazas.push({ x: x2, z: z2, ux: cux, uz: cuz, hx: 3.03, hz, big: false, paint: Math.floor(rng() * PAINT.length), sign: Math.floor(rng() * SIGNS.length) });
    }
    return true;
  }

  #placeSpazas(rng) {
    const R = this.roads;
    // 1) street corners: road ends meeting at a junction of 3+ ways
    for (const node of R.nodes || []) {
      if (!node.edges || node.edges.length < 3) continue;
      if (!this.#zone(node.x, node.z)) continue;
      if (rng() > 0.42) continue;
      const e = R.edges[node.edges[Math.floor(rng() * node.edges.length)]];
      const road = e.road;
      if (road.rank < 2 || road.rank > 7 || road.bridge || road.len < 26) continue;
      const fromStart = e.from === node.id;
      const along = 9 + rng() * 6;
      const side = rng() < 0.5 ? 1 : -1;
      this.#tryAt(road, fromStart ? along : road.len - along, side, rng);
    }
    // 2) along the main township roads (taxi routes), every ~110 m on a coin flip
    for (const road of R.roads) {
      if (road.rank < 5 || road.rank > 7 || road.bridge) continue;
      const mid = road.pts[Math.floor(road.pts.length / 2)];
      if (!this.#zone(mid[0], mid[1])) continue;
      for (let s = 40; s < road.len - 40; s += 110) {
        if (rng() < 0.45) continue;
        const p = road.pts[Math.min(road.pts.length - 1, Math.floor((s / road.len) * (road.pts.length - 1)))];
        if (!this.#zone(p[0], p[1])) continue;
        this.#tryAt(road, s + rng() * 30, rng() < 0.5 ? 1 : -1, rng);
      }
    }
    for (const s of this.spazas) {
      // ground: sit on the highest corner, brick plinth under the low side
      let lo = Infinity;
      let hi = -Infinity;
      for (const [su, sv] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1]
      ]) {
        const h = this.hf.renderedHeightAt(s.x + s.ux * s.hx * su - s.uz * s.hz * sv, s.z + s.uz * s.hx * su + s.ux * s.hz * sv);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      s.lo = lo - 0.3;
      s.y = hi + 0.2;
      const k = Math.floor(s.x / 50) * 100000 + Math.floor(s.z / 50);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(s);
    }
  }

  #placePoles(rng) {
    // wooden poles every ~38 m on one side of township streets
    for (const road of this.roads.roads) {
      if (road.rank < 3 || road.rank > 6 || road.bridge || road.len < 40) continue;
      const mid = road.pts[Math.floor(road.pts.length / 2)];
      if (!this.#zone(mid[0], mid[1])) continue;
      const side = road.id2 % 2 ? 1 : -1;
      let prev = null;
      for (let s = 6 + rng() * 10; s < road.len - 4; s += 44 + rng() * 8) {
        let i = 0;
        while (i < road.pts.length - 2 && road.cum[i + 1] < s) i++;
        const seg = Math.max(1e-3, road.cum[i + 1] - road.cum[i]);
        const t = (s - road.cum[i]) / seg;
        const p0 = road.pts[i];
        const p1 = road.pts[i + 1];
        let ux = p1[0] - p0[0];
        let uz = p1[1] - p0[1];
        const l = Math.hypot(ux, uz) || 1;
        ux /= l;
        uz /= l;
        const off = road.width / 2 + 1.1;
        const x = p0[0] + (p1[0] - p0[0]) * t - uz * off * side;
        const z = p0[1] + (p1[1] - p0[1]) * t + ux * off * side;
        if (!this.#zone(x, z) || (this.buildings && this.buildings.blocked(x, z, 0.3))) {
          prev = null;
          continue;
        }
        const y = this.hf.renderedHeightAt(x, z);
        const pole = { x, z, y, ux, uz, h: 8.2 + rng() * 0.8, lean: (rng() - 0.5) * 0.06, prev };
        this.poles.push(pole);
        prev = pole;
      }
    }
  }

  #cellOf(x, z) {
    const k = Math.floor(x / CELL) * 100000 + Math.floor(z / CELL);
    let c = this.cells.get(k);
    if (!c) {
      c = { B: new Buf(), cx: (Math.floor(x / CELL) + 0.5) * CELL, cz: (Math.floor(z / CELL) + 0.5) * CELL, mesh: null };
      this.cells.set(k, c);
    }
    return c;
  }

  #build() {
    const mat = new THREE.MeshLambertMaterial({ map: makeAtlas(), vertexColors: true, side: THREE.DoubleSide });
    this.material = mat;
    const t = TILE;
    for (const s of this.spazas) {
      const B = this.#cellOf(s.x, s.z).B;
      const paint = PAINT[s.paint];
      const ux = s.ux;
      const uz = s.uz;
      const vx = -uz;
      const vz = ux;
      // brick plinth on slopes
      if (s.y - s.lo > 0.35) box(B, s.x, s.z, ux, uz, s.hx + 0.05, s.hz + 0.05, s.lo, s.y, [t.brick, t.brick, t.brick, t.brick, null], WHITE);
      const y1 = s.y + 2.59;
      // body: hatch front, plain back, door end / plain end, roof
      box(B, s.x, s.z, ux, uz, s.hx, s.hz, s.y, y1, [t.hatch, t.side, t.doors, t.side, t.side], paint, paint.clone().multiplyScalar(0.85));
      if (s.big) {
        // 12 m: a second hatch on the other half of the front
        const o = s.hx / 2;
        box(B, s.x + ux * o + vx * 0.02, s.z + uz * o + vz * 0.02, ux, uz, s.hx / 2 - 0.4, s.hz, s.y, y1, [t.hatch, null, null, null, null], paint);
      }
      // sign board on the roof edge
      const sx = s.x + vx * (s.hz - 0.05);
      const sz = s.z + vz * (s.hz - 0.05);
      box(B, sx, sz, ux, uz, Math.min(1.6, s.hx - 0.3), 0.04, y1, y1 + 0.75, [t.sign0 + s.sign, t.wood, t.wood, t.wood, t.wood], WHITE);
      // iron awning over the hatch, sloping out, on two poles
      const aw = Math.min(2.2, s.hx - 0.2);
      const out = 1.5;
      const ya = s.y + 2.45;
      const yb = s.y + 2.1;
      const fx = s.x + vx * s.hz;
      const fz = s.z + vz * s.hz;
      const A = [fx + ux * aw, ya, fz + uz * aw];
      const Bq = [fx - ux * aw, ya, fz - uz * aw];
      const Cq = [fx - ux * aw + vx * out, yb, fz - uz * aw + vz * out];
      const D = [fx + ux * aw + vx * out, yb, fz + uz * aw + vz * out];
      B.quad(Bq, A, D, Cq, [0, 1, 0], tile(t.roof), WHITE);
      B.quad(A, Bq, Cq, D, [0, -1, 0], tile(t.roof), new THREE.Color(0.8, 0.8, 0.8));
      for (const sgn of [1, -1]) {
        const px = fx + ux * (aw - 0.1) * sgn + vx * (out - 0.1);
        const pz = fz + uz * (aw - 0.1) * sgn + vz * (out - 0.1);
        const gy = this.hf.renderedHeightAt(px, pz);
        box(B, px, pz, ux, uz, 0.04, 0.04, Math.min(gy, s.y), yb, [t.wood, t.wood, t.wood, t.wood, null], WHITE);
      }
    }
    for (const p of this.poles) {
      const B = this.#cellOf(p.x, p.z).B;
      const top = p.y + p.h;
      box(B, p.x, p.z, p.ux, p.uz, 0.11, 0.11, p.y - 0.2, top, [t.wood, t.wood, t.wood, t.wood, t.wood], WHITE);
      // crossarm across the road direction
      const vx = -p.uz;
      const vz = p.ux;
      box(B, p.x, p.z, vx, vz, 0.8, 0.05, top - 0.55, top - 0.45, [t.wood, t.wood, t.wood, t.wood, t.wood], WHITE);
      if (!p.prev) continue;
      const q = p.prev;
      const qt = q.y + q.h;
      // three wires with a little sag (two segments each)
      for (const o of [-0.7, 0, 0.7]) {
        const a = [q.x + vx * o, qt - 0.45, q.z + vz * o];
        const b = [p.x + vx * o, top - 0.45, p.z + vz * o];
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.6, (a[2] + b[2]) / 2];
        this.#wire(B, a, m);
        this.#wire(B, m, b);
      }
    }
    for (const c of this.cells.values()) {
      const g = c.B.geometry();
      c.B = null;
      if (!g) continue;
      c.mesh = new THREE.Mesh(g, mat);
      c.mesh.matrixAutoUpdate = false;
      c.mesh.visible = false;
      this.group.add(c.mesh);
    }
  }

  #wire(B, a, b) {
    const w = 0.025;
    B.quad([a[0], a[1] - w, a[2]], [b[0], b[1] - w, b[2]], [b[0], b[1] + w, b[2]], [a[0], a[1] + w, a[2]], [0, 1, 0], tile(TILE.wire), WHITE);
  }

  update(camX, camZ) {
    const lim = SHOW + CELL;
    for (const c of this.cells.values()) {
      if (!c.mesh) continue;
      c.mesh.visible = Math.abs(c.cx - camX) < lim && Math.abs(c.cz - camZ) < lim;
    }
  }

  // solid containers and poles for cars and people
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
          const cu = Math.max(-s.hx, Math.min(s.hx, lu));
          const cv = Math.max(-s.hz, Math.min(s.hz, lv));
          let du = lu - cu;
          let dv = lv - cv;
          let fu = cu;
          let fv = cv;
          const d = Math.hypot(du, dv);
          if (d >= r) continue;
          if (d < 1e-4) {
            // inside: push out through the nearest face
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
          const nx = du * s.ux - dv * s.uz;
          const nz = du * s.uz + dv * s.ux;
          const pu2 = fu + du * r;
          const pv2 = fv + dv * r;
          return { x: s.x + pu2 * s.ux - pv2 * s.uz, z: s.z + pu2 * s.uz + pv2 * s.ux, nx, nz, y: s.y };
        }
      }
    }
    return null;
  }
}
