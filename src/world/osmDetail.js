import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

// Everything else OSM maps on the ground, drawn the way it really looks
// (src/data/durban-detail.json, built by scripts/build-detail.py):
//  golf: fairways with mowing stripes, greens with a flag, bunkers, tees,
//        rough, water hazards, cart paths
//  tracks: horse racing turf with white running rails (Greyville, Clairwood),
//          red athletics tracks with lane lines, dirt/motor tracks
//  pitches: grass with real line markings for soccer, rugby and cricket,
//           goals and H-posts, hard courts for tennis/netball/basketball
//  swimming pools, playgrounds, car parks and cemeteries (headstones).
// Flat parts are draped on the terrain and merged per 1 km cell; small
// standing things (rails, posts, goals, headstones, flags) are drawn only
// near the camera.

const CELL = 1000;
const SHOW_FLAT = 2600;
const SHOW_PROPS = 900;
const MAX_EDGE = 30; // m: drape triangles are split until no edge is longer

const C = (h) => new THREE.Color(h);
const COL = {
  fairway: C('#5a8a38'),
  green: C('#4f9a40'),
  tee: C('#56913c'),
  rough: C('#5f8a3a'),
  bunker: C('#e0d2a2'),
  water_hazard: C('#3d6f7c'),
  driving_range: C('#5a9840'),
  cartpath: C('#8d8a82'),
  turf: C('#52863a'),
  dirt: C('#9a7652'),
  tartan: C('#a8483a'),
  asphalt: C('#5e6063'),
  grass: C('#4f8536'),
  court_green: C('#3f7d5a'),
  court_blue: C('#3b6a95'),
  court_grey: C('#7c8187'),
  clay: C('#b0603e'),
  pool: C('#3aa7d6'),
  coping: C('#e8e4da'),
  sand: C('#cdb88a'),
  parking: C('#6c6e71'),
  gravel: C('#8f877a'),
  cemetery: C('#667d45'),
  garden: C('#5d9444'),
  white: C('#f2f2ee'),
  cricket: C('#b9a477')
};

// ---------------------------------------------------------------- geometry
function ringOf(p) {
  const pts = [];
  for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
  if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-4) pts.pop();
  return pts;
}

function areaOf(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return a / 2;
}

function inRing(pts, x, z) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

// minimum-area rectangle (rotating calipers over the convex hull)
function minRect(pts) {
  const hull = THREE.ShapeUtils.isClockWise(pts) ? pts.slice().reverse() : pts.slice();
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    let ux = b.x - a.x;
    let uz = b.y - a.y;
    const L = Math.hypot(ux, uz);
    if (L < 0.5) continue;
    ux /= L;
    uz /= L;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uz;
      const v = -p.x * uz + p.y * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const ar = (u1 - u0) * (v1 - v0);
    if (!best || ar < best.ar) {
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      best = { ar, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, len: u1 - u0, wid: v1 - v0 };
    }
  }
  if (best && best.wid > best.len) {
    const t = best.len;
    best.len = best.wid;
    best.wid = t;
    const ux = best.ux;
    best.ux = -best.uz;
    best.uz = ux;
  }
  return best;
}

// Collects flat triangles (x,z) + a colour + a stripe flag, then drapes them.
class Flat {
  constructor() {
    this.pos = [];
    this.col = [];
    this.str = [];
  }
  tri(ax, az, bx, bz, cx, cz, col, stripe, depth = 0) {
    const ab = (ax - bx) ** 2 + (az - bz) ** 2;
    const bc = (bx - cx) ** 2 + (bz - cz) ** 2;
    const ca = (cx - ax) ** 2 + (cz - az) ** 2;
    const m = Math.max(ab, bc, ca);
    if (m > MAX_EDGE * MAX_EDGE && depth < 14) {
      if (m === ab) {
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        this.tri(ax, az, mx, mz, cx, cz, col, stripe, depth + 1);
        this.tri(mx, mz, bx, bz, cx, cz, col, stripe, depth + 1);
      } else if (m === bc) {
        const mx = (bx + cx) / 2;
        const mz = (bz + cz) / 2;
        this.tri(ax, az, bx, bz, mx, mz, col, stripe, depth + 1);
        this.tri(ax, az, mx, mz, cx, cz, col, stripe, depth + 1);
      } else {
        const mx = (cx + ax) / 2;
        const mz = (cz + az) / 2;
        this.tri(ax, az, bx, bz, mx, mz, col, stripe, depth + 1);
        this.tri(mx, mz, bx, bz, cx, cz, col, stripe, depth + 1);
      }
      return;
    }
    this.pos.push(ax, az, bx, bz, cx, cz);
    for (let k = 0; k < 3; k++) {
      this.col.push(col.r, col.g, col.b);
      this.str.push(stripe);
    }
  }
  poly(pts, col, stripe = 0, holes = null) {
    if (pts.length < 3) return;
    let tris;
    const hs = (holes || []).filter((h) => h.length >= 3);
    let all = pts;
    for (const h of hs) all = all.concat(h);
    try {
      tris = THREE.ShapeUtils.triangulateShape(pts, hs);
    } catch {
      return;
    }
    for (const t of tris) {
      const a = all[t[0]];
      const b = all[t[1]];
      const c = all[t[2]];
      this.tri(a.x, a.y, b.x, b.y, c.x, c.y, col, stripe);
    }
  }
  // a quad given its 4 corners in order
  quad(x0, z0, x1, z1, x2, z2, x3, z3, col, stripe = 0) {
    this.tri(x0, z0, x1, z1, x2, z2, col, stripe);
    this.tri(x0, z0, x2, z2, x3, z3, col, stripe);
  }
  // a ribbon of width w along a polyline
  ribbon(pts, w, col, closed = false, stripe = 0) {
    const n = pts.length;
    if (n < 2) return;
    const h = w / 2;
    const off = [];
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const tx = b.x - a.x;
      const tz = b.y - a.y;
      const L = Math.hypot(tx, tz) || 1;
      off.push(-tz / L, tx / L);
    }
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      const a = pts[i];
      const b = pts[j];
      this.quad(a.x + off[i * 2] * h, a.y + off[i * 2 + 1] * h, b.x + off[j * 2] * h, b.y + off[j * 2 + 1] * h, b.x - off[j * 2] * h, b.y - off[j * 2 + 1] * h, a.x - off[i * 2] * h, a.y - off[i * 2 + 1] * h, col, stripe);
    }
  }
  // thin line on the ground (pitch markings)
  line(x0, z0, x1, z1, w, col) {
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    const nx = (-(z1 - z0) / L) * (w / 2);
    const nz = ((x1 - x0) / L) * (w / 2);
    this.quad(x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz, col);
  }
  circle(cx, cz, r, w, col, seg = 28, a0 = 0, a1 = Math.PI * 2) {
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + ((a1 - a0) * i) / seg;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
      this.line(cx + Math.cos(t0) * r, cz + Math.sin(t0) * r, cx + Math.cos(t1) * r, cz + Math.sin(t1) * r, w, col);
    }
  }
  build(hf, lift) {
    if (!this.pos.length) return null;
    const n = this.pos.length / 2;
    const P = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = this.pos[i * 2];
      const z = this.pos[i * 2 + 1];
      P[i * 3] = x;
      P[i * 3 + 1] = hf.renderedHeightAt(x, z) + lift;
      P[i * 3 + 2] = z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aStripe', new THREE.BufferAttribute(new Float32Array(this.str), 1));
    // ShapeUtils gives either winding: make every triangle face up
    for (let i = 0; i < n; i += 3) {
      const ax = P[i * 3];
      const az = P[i * 3 + 2];
      const cr = (P[i * 3 + 3] - ax) * (P[i * 3 + 8] - az) - (P[i * 3 + 5] - az) * (P[i * 3 + 6] - ax);
      if (cr > 0) {
        for (const att of [g.attributes.position, g.attributes.color]) {
          for (let k = 0; k < 3; k++) {
            const t = att.array[(i + 1) * 3 + k];
            att.array[(i + 1) * 3 + k] = att.array[(i + 2) * 3 + k];
            att.array[(i + 2) * 3 + k] = t;
          }
        }
        const s = g.attributes.aStripe.array;
        const t = s[i + 1];
        s[i + 1] = s[i + 2];
        s[i + 2] = t;
      }
    }
    g.computeVertexNormals();
    return g;
  }
}

// standing things are boxes merged per cell
class Solids {
  constructor() {
    this.geos = [];
  }
  box(x, y, z, sx, sy, sz, rot, col) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(rot);
    g.translate(x, y + sy / 2, z);
    g.deleteAttribute('uv');
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) {
      c[i] = col.r;
      c[i + 1] = col.g;
      c[i + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.geos.push(g);
  }
  // box between two ground points (a rail)
  beam(x0, y0, z0, x1, y1, z1, t, h, col) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.05) return;
    const g = new THREE.BoxGeometry(L, h, t);
    g.rotateZ(Math.atan2(y1 - y0, L));
    g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.deleteAttribute('uv');
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) {
      c[i] = col.r;
      c[i + 1] = col.g;
      c[i + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.geos.push(g);
  }
  build() {
    if (!this.geos.length) return null;
    const m = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    return m;
  }
}

function flatMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStripe;\nvarying float vStripe;\nvarying vec2 vWxz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripe = aStripe;\nvWxz = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vStripe;\nvarying vec2 vWxz;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vStripe > 0.5) { float s = step(0.5, fract(dot(vWxz, vec2(0.0707, 0.0707)))); diffuseColor.rgb *= 0.93 + 0.12 * s; }');
  };
  return m;
}

// ---------------------------------------------------------------- builder
export class OsmDetail {
  constructor(data, { hf, roads }) {
    this.hf = hf;
    this.roads = roads;
    this.group = new THREE.Group();
    this.group.name = 'osmDetail';
    this.cells = new Map();
    this.block = new Map(); // 20 m grid of ground that must stay clear of trees
    this.stats = {};
    this.flatMat = flatMaterial();
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const t0 = performance.now();
    const feats = (data?.f || []).slice();
    // big things first so small ones (greens on fairways) draw on top
    for (const f of feats) {
      f.pts = ringOf(f.p);
      f.holes = f.h ? f.h.map(ringOf) : null;
    }
    for (const f of feats) f.ar = f.c ? Math.abs(areaOf(f.pts)) : 0;
    const ORDER = { cemetery: 0, garden: 0, parking: 1, playground: 1, stadium: 0, rough: 1, driving_range: 1, track: 2, fairway: 2, pitch: 3, tee: 3, water_hazard: 3, bunker: 4, green: 4, cartpath: 5, swimming_pool: 5 };
    feats.sort((a, b) => (ORDER[a.t] ?? 3) - (ORDER[b.t] ?? 3) || b.ar - a.ar);
    const x0 = hf.minX;
    const z0 = hf.minZ;
    const x1 = hf.minX + (hf.cols - 1) * hf.cell;
    const z1 = hf.minZ + (hf.rows - 1) * hf.cell;
    for (const f of feats) {
      if (f.pts.length < 2) continue;
      const q = f.pts[0];
      if (q.x < x0 || q.x > x1 || q.y < z0 || q.y > z1 || hf.isWater(q.x, q.y)) continue;
      try {
        this.#feature(f);
        this.stats[f.t] = (this.stats[f.t] || 0) + 1;
      } catch (err) {
        console.warn('[IZK] detail skip', f.t, err);
      }
    }
    this.#finish();
    this.ms = performance.now() - t0;
  }

  #cell(x, z) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const k = cx * 100000 + cz;
    let c = this.cells.get(k);
    if (!c) {
      c = { cx: (cx + 0.5) * CELL, cz: (cz + 0.5) * CELL, flat: [new Flat(), new Flat(), new Flat()], solid: new Solids(), meshes: [], props: [] };
      this.cells.set(k, c);
    }
    return c;
  }

  #markBlock(pts, holes = null) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.y);
      z1 = Math.max(z1, p.y);
    }
    if ((x1 - x0) * (z1 - z0) > 4e6) return;
    for (let gx = Math.floor(x0 / 20); gx <= Math.floor(x1 / 20); gx++) {
      for (let gz = Math.floor(z0 / 20); gz <= Math.floor(z1 / 20); gz++) {
        const x = gx * 20 + 10;
        const z = gz * 20 + 10;
        if (inRing(pts, x, z) && !(holes && holes.some((h) => inRing(h, x, z)))) this.block.set(gx * 100000 + gz, 1);
      }
    }
  }

  // trees and bushes keep off fairways, greens, pitches, tracks, pools, car parks
  blocks(x, z) {
    return this.block.has(Math.floor(x / 20) * 100000 + Math.floor(z / 20));
  }

  #centre(pts) {
    let x = 0;
    let z = 0;
    for (const p of pts) {
      x += p.x;
      z += p.y;
    }
    return [x / pts.length, z / pts.length];
  }

  #feature(f) {
    const [mx, mz] = this.#centre(f.pts);
    const cell = this.#cell(mx, mz);
    const [L0, L1, L2] = cell.flat; // base, overlay, markings
    const pts = f.pts;
    const s = f.s || '';
    switch (f.t) {
      case 'fairway':
      case 'driving_range':
        L0.poly(pts, COL[f.t], 1, f.holes);
        this.#markBlock(pts);
        break;
      case 'rough':
        L0.poly(pts, COL.rough, 0);
        break;
      case 'tee':
        L1.poly(pts, COL.tee, 1);
        this.#markBlock(pts);
        break;
      case 'green':
        L1.poly(pts, COL.green, 1);
        this.#markBlock(pts);
        cell.props.push({ k: 'flag', x: mx, z: mz });
        break;
      case 'bunker':
        L1.poly(pts, COL.bunker);
        this.#markBlock(pts);
        break;
      case 'water_hazard':
        L1.poly(pts, COL.water_hazard);
        this.#markBlock(pts);
        break;
      case 'cartpath':
        L1.ribbon(pts, 2.4, COL.cartpath, !!f.c);
        break;
      case 'track':
        this.#track(f, cell);
        break;
      case 'pitch':
        this.#pitch(f, cell);
        break;
      case 'swimming_pool':
        L1.poly(pts, COL.pool);
        if (f.ar > 150) L1.ribbon(pts, 0.7, COL.coping, true);
        this.#markBlock(pts);
        break;
      case 'playground':
        L0.poly(pts, COL.sand);
        this.#markBlock(pts);
        if (f.ar > 60) cell.props.push({ k: 'swing', x: mx, z: mz, pts });
        break;
      case 'parking':
        if (f.ar > 60000) break; // giant mapped lots are usually already paved ground
        L0.poly(pts, /gravel|dirt|ground|grass/.test(s) ? COL.gravel : COL.parking);
        this.#markBlock(pts);
        break;
      case 'cemetery':
        L0.poly(pts, COL.cemetery, 0, f.holes);
        cell.props.push({ k: 'graves', pts, ar: f.ar });
        break;
      case 'garden':
        L0.poly(pts, COL.garden);
        break;
      default:
        break;
    }
  }

  #track(f, cell) {
    const [sport, surf = ''] = (f.s || '').split('|');
    const pts = f.pts;
    const horse = /horse/.test(sport);
    const run = /athletics|running/.test(sport) || /tartan|rubber/.test(surf);
    const col = horse ? (/dirt|sand|ground/.test(surf) ? COL.dirt : COL.turf) : run ? COL.tartan : /asphalt|paved/.test(surf) ? COL.asphalt : /grass/.test(surf) ? COL.turf : COL.dirt;
    if (f.a) {
      cell.flat[1].poly(pts, col, horse ? 1 : 0, f.holes);
      this.#markBlock(pts, f.holes);
      if (horse) {
        cell.props.push({ k: 'rail', pts, closed: true });
        for (const h of f.holes || []) cell.props.push({ k: 'rail', pts: h, closed: true });
      }
      return;
    }
    // a track mapped as its centre line: give it its real width
    const w = horse ? 24 : run ? 9.8 : sport === 'motor' ? 10 : 6;
    cell.flat[1].ribbon(pts, w, col, !!f.c, horse ? 1 : 0);
    if (run) {
      for (let l = 1; l < 8; l++) {
        const off = -w / 2 + l * (w / 8);
        cell.flat[2].ribbon(this.#offset(pts, off, !!f.c), 0.06, COL.white, !!f.c);
      }
    }
    if (horse) {
      cell.props.push({ k: 'rail', pts: this.#offset(pts, w / 2, !!f.c), closed: !!f.c });
      cell.props.push({ k: 'rail', pts: this.#offset(pts, -w / 2, !!f.c), closed: !!f.c });
    }
    // roughly block the band for trees
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this.block.set(Math.floor(p.x / 20) * 100000 + Math.floor(p.y / 20), 1);
    }
  }

  #offset(pts, d, closed) {
    const n = pts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const tx = b.x - a.x;
      const tz = b.y - a.y;
      const L = Math.hypot(tx, tz) || 1;
      out.push(new THREE.Vector2(pts[i].x - (tz / L) * d, pts[i].y + (tx / L) * d));
    }
    return out;
  }

  #pitch(f, cell) {
    const pts = f.pts;
    const s = f.s || '';
    const [L0, , L2] = cell.flat;
    let col = COL.grass;
    let stripe = 1;
    if (/tennis/.test(s)) {
      col = COL.court_green;
      stripe = 0;
    } else if (/basketball|netball|volleyball|multi|futsal|skate/.test(s)) {
      col = COL.court_grey;
      stripe = 0;
    }
    L0.poly(pts, col, stripe);
    this.#markBlock(pts);
    const r = minRect(pts);
    if (!r || r.len < 8 || r.wid < 5) return;
    const W = COL.white;
    const lw = 0.12;
    // pitch-local (u along the long side, v across) to world
    const P = (u, v) => [r.cx + u * r.ux - v * r.uz, r.cz + u * r.uz + v * r.ux];
    const seg = (u0, v0, u1, v1) => {
      const [a, b] = P(u0, v0);
      const [c, d] = P(u1, v1);
      L2.line(a, b, c, d, lw, W);
    };
    const rect = (u0, v0, u1, v1) => {
      seg(u0, v0, u1, v0);
      seg(u1, v0, u1, v1);
      seg(u1, v1, u0, v1);
      seg(u0, v1, u0, v0);
    };
    const hl = r.len / 2 - 1.5;
    const hw = r.wid / 2 - 1.5;
    if (/cricket/.test(s) && r.len < r.wid * 1.6) {
      // oval: only the brown 20 m strip in the middle with creases
      const [a, b] = P(-10.06, -1.5);
      const [c, d] = P(10.06, -1.5);
      const [e, g] = P(10.06, 1.5);
      const [h, i] = P(-10.06, 1.5);
      cell.flat[1].quad(a, b, c, d, e, g, h, i, COL.cricket);
      for (const u of [-8.84, 8.84]) seg(u, -1.5, u, 1.5);
      cell.props.push({ k: 'stumps', pts: [P(-10.06, 0), P(10.06, 0)], ux: r.ux, uz: r.uz });
      return;
    }
    if (/tennis/.test(s) && r.len < 45) {
      const cl = Math.min(11.885, hl);
      const cw = Math.min(5.485, hw);
      rect(-cl, -cw, cl, cw);
      seg(-cl, -cw * 0.75, cl, -cw * 0.75);
      seg(-cl, cw * 0.75, cl, cw * 0.75);
      seg(-6.4, 0, 6.4, 0);
      seg(-6.4, -cw * 0.75, -6.4, cw * 0.75);
      seg(6.4, -cw * 0.75, 6.4, cw * 0.75);
      cell.props.push({ k: 'net', a: P(0, -cw - 0.5), b: P(0, cw + 0.5) });
      return;
    }
    if (/basketball|netball/.test(s) && r.len < 45) {
      rect(-hl, -hw, hl, hw);
      seg(0, -hw, 0, hw);
      const [cx, cz] = P(0, 0);
      L2.circle(cx, cz, 1.8, lw, W, 20);
      for (const sg of [-1, 1]) {
        const [gx, gz] = P(sg * (hl - 0.2), 0);
        cell.props.push({ k: 'hoop', x: gx, z: gz, ux: r.ux * -sg, uz: r.uz * -sg });
      }
      return;
    }
    if (r.len < 40 || stripe === 0) {
      rect(-hl, -hw, hl, hw);
      return;
    }
    // soccer / rugby / generic field
    rect(-hl, -hw, hl, hw);
    seg(0, -hw, 0, hw);
    const rugby = /rugby/.test(s);
    if (rugby) {
      for (const sg of [-1, 1]) {
        seg(sg * (hl - 10), -hw, sg * (hl - 10), hw); // try line at 10 m in-goal
        seg(sg * (hl - 32), -hw, sg * (hl - 32), hw); // 22
        for (const v of [-hw + 5, -hw + 15, hw - 15, hw - 5]) seg(sg * 10 - 0.6, v, sg * 10 + 0.6, v);
        const [gx, gz] = P(sg * (hl - 10), 0);
        cell.props.push({ k: 'hposts', x: gx, z: gz, ux: r.ux, uz: r.uz });
      }
      return;
    }
    const [cx, cz] = P(0, 0);
    L2.circle(cx, cz, Math.min(9.15, hw * 0.4), lw, W, 32);
    const box = Math.min(40.3, r.wid * 0.6) / 2;
    const six = Math.min(18.3, r.wid * 0.3) / 2;
    for (const sg of [-1, 1]) {
      const e = sg * hl;
      rect(Math.min(e, e - sg * 16.5), -box, Math.max(e, e - sg * 16.5), box);
      rect(Math.min(e, e - sg * 5.5), -six, Math.max(e, e - sg * 5.5), six);
      const [gx, gz] = P(e, 0);
      cell.props.push({ k: 'goal', x: gx, z: gz, ux: r.ux * sg, uz: r.uz * sg });
    }
  }

  // ---- standing props near the camera
  #props(cell) {
    const S = cell.solid;
    const hf = this.hf;
    const y = (x, z) => hf.renderedHeightAt(x, z);
    const W = COL.white;
    const metal = C('#b8bcc0');
    const stone = [C('#9a9894'), C('#bdb9b0'), C('#6f6d6a'), C('#d8d4cc')];
    let graves = 0;
    for (const p of cell.props) {
      switch (p.k) {
        case 'flag': {
          S.box(p.x, y(p.x, p.z), p.z, 0.05, 2.3, 0.05, 0, W);
          S.box(p.x + 0.28, y(p.x, p.z) + 1.85, p.z, 0.55, 0.4, 0.02, 0, C('#d8262b'));
          break;
        }
        case 'rail': {
          // white plastic running rail on posts, 1.1 m high
          const pts = p.pts;
          const n = pts.length;
          const m = p.closed ? n : n - 1;
          for (let i = 0; i < m; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            const L = Math.hypot(b.x - a.x, b.y - a.y);
            const k = Math.max(1, Math.ceil(L / 4));
            for (let j = 0; j < k; j++) {
              const x0 = a.x + ((b.x - a.x) * j) / k;
              const z0 = a.y + ((b.y - a.y) * j) / k;
              const x1 = a.x + ((b.x - a.x) * (j + 1)) / k;
              const z1 = a.y + ((b.y - a.y) * (j + 1)) / k;
              const y0 = y(x0, z0);
              const y1 = y(x1, z1);
              S.box(x0, y0, z0, 0.08, 1.0, 0.08, 0, W);
              S.beam(x0, y0 + 1.05, z0, x1, y1 + 1.05, z1, 0.14, 0.14, W);
            }
          }
          break;
        }
        case 'goal': {
          const rot = -Math.atan2(p.uz, p.ux);
          const nx = -p.uz;
          const nz = p.ux;
          const gy = y(p.x, p.z);
          for (const sg of [-1, 1]) S.box(p.x + nx * 3.66 * sg, gy, p.z + nz * 3.66 * sg, 0.12, 2.44, 0.12, rot, W);
          S.box(p.x, gy + 2.38, p.z, 0.12, 0.12, 7.44, rot, W);
          S.box(p.x + p.ux * 1.5, gy + 2.3, p.z + p.uz * 1.5, 0.06, 0.06, 7.3, rot, metal);
          break;
        }
        case 'hposts': {
          const rot = -Math.atan2(p.uz, p.ux);
          const nx = -p.uz;
          const nz = p.ux;
          const gy = y(p.x, p.z);
          for (const sg of [-1, 1]) S.box(p.x + nx * 2.8 * sg, gy, p.z + nz * 2.8 * sg, 0.18, 11, 0.18, rot, W);
          S.box(p.x, gy + 3, p.z, 0.16, 0.16, 5.6, rot, W);
          for (const sg of [-1, 1]) S.box(p.x + nx * 2.8 * sg, gy, p.z + nz * 2.8 * sg, 0.5, 1.8, 0.5, rot, C('#1f5fae'));
          break;
        }
        case 'hoop': {
          const gy = y(p.x, p.z);
          const rot = -Math.atan2(p.uz, p.ux);
          S.box(p.x - p.ux * 1.0, gy, p.z - p.uz * 1.0, 0.15, 3.0, 0.15, rot, C('#3a3d42'));
          S.box(p.x - p.ux * 0.4, gy + 2.9, p.z - p.uz * 0.4, 0.05, 1.05, 1.8, rot, W);
          S.box(p.x, gy + 3.03, p.z, 0.45, 0.03, 0.45, rot, C('#d4502a'));
          break;
        }
        case 'net': {
          const [ax, az] = p.a;
          const [bx, bz] = p.b;
          S.beam(ax, y(ax, az) + 0.45, az, bx, y(bx, bz) + 0.45, bz, 0.03, 0.9, C('#2b2d30'));
          break;
        }
        case 'stumps': {
          for (const [sx, sz] of p.pts) {
            for (const o of [-0.11, 0, 0.11]) S.box(sx - p.uz * o, y(sx, sz), sz + p.ux * o, 0.04, 0.71, 0.04, 0, C('#efe7d0'));
          }
          break;
        }
        case 'swing': {
          const gy = y(p.x, p.z);
          for (const sg of [-1, 1]) S.box(p.x + sg * 1.6, gy, p.z, 0.1, 2.3, 1.4, 0, C('#c0392b'));
          S.box(p.x, gy + 2.25, p.z, 3.3, 0.1, 0.1, 0, C('#c0392b'));
          for (const o of [-0.7, 0.7]) S.box(p.x + o, gy + 0.45, p.z, 0.45, 0.05, 0.2, 0, C('#2c3e50'));
          S.box(p.x, gy, p.z + 3, 0.7, 1.4, 2.6, 0.2, C('#e1b12c'));
          break;
        }
        case 'graves': {
          // headstones in neat rows, about one per 9 m², capped per cell
          const pts = p.pts;
          const r = minRect(pts);
          if (!r) break;
          const want = Math.min(900, Math.round(p.ar / 9));
          let k = 0;
          for (let u = -r.len / 2 + 2; u < r.len / 2 - 2 && k < want && graves < 1600; u += 2.6) {
            for (let v = -r.wid / 2 + 2; v < r.wid / 2 - 2 && k < want && graves < 1600; v += 3.4) {
              const h = Math.sin(u * 12.9898 + v * 78.233) * 43758.5453;
              const rnd = h - Math.floor(h);
              if (rnd < 0.18) continue;
              const x = r.cx + u * r.ux - v * r.uz;
              const z = r.cz + u * r.uz + v * r.ux;
              if (!inRing(pts, x, z)) continue;
              const hh = 0.6 + rnd * 0.7;
              S.box(x, y(x, z) - 0.05, z, 0.12, hh, 0.6, -Math.atan2(r.uz, r.ux), stone[Math.floor(rnd * 4)]);
              k++;
              graves++;
            }
          }
          break;
        }
        default:
          break;
      }
    }
    const g = S.build();
    if (g) {
      const mesh = new THREE.Mesh(g, this.solidMat);
      mesh.name = 'detailProps';
      mesh.visible = false;
      cell.propMesh = mesh;
      this.group.add(mesh);
    }
    cell.props = null;
  }

  #finish() {
    const lifts = [0.1, 0.16, 0.2];
    let tris = 0;
    for (const c of this.cells.values()) {
      c.flat.forEach((F, i) => {
        const g = F.build(this.hf, lifts[i]);
        if (!g) return;
        tris += g.attributes.position.count / 3;
        const mesh = new THREE.Mesh(g, this.flatMat);
        mesh.name = 'detailFlat';
        mesh.renderOrder = -0.4 + i * 0.01;
        mesh.receiveShadow = true;
        c.meshes.push(mesh);
        this.group.add(mesh);
      });
      c.flat = null;
    }
    this.stats.flatTris = tris;
  }

  update(camX, camZ) {
    for (const c of this.cells.values()) {
      const d = Math.max(Math.abs(c.cx - camX), Math.abs(c.cz - camZ)) - CELL / 2;
      const showFlat = d < SHOW_FLAT;
      for (const m of c.meshes) m.visible = showFlat;
      const near = d < SHOW_PROPS;
      if (near && c.props) this.#props(c);
      if (c.propMesh) c.propMesh.visible = near;
    }
  }
}
