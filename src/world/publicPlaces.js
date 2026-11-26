import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';
import { Flat, minRect, flatMaterial } from './osmDetail.js';

// Public places, built from real OpenStreetMap outlines (ODbL):
//  - fuel stations: a concrete forecourt to the road, a canopy with a coloured
//    fascia (plain colours, no brand logos), pump islands, a shop and a price
//    board (landmarks k='fuel', placed like landmarkLayer did)
//  - mall car parks (src/data/durban-public.json lots, real service=parking_aisle
//    lines): painted bays both sides of every aisle, back lines, aisle arrows,
//    double-head light poles
//  - HD mall fronts on the real mall outlines (durban-public.json malls): glass
//    shopfronts with mullions, a canopy and paved walkway along every wall,
//    big entrances with the mall's name, planters, bins and benches
//  - parks (durban-public.json parks): benches, bins and planters
//  - school grounds without a mapped pitch (durban-grounds.json schools): a grass
//    field with lines and small goals in the open part of the grounds
//  - hospitals and clinics (durban-grounds.json): a white roadside sign with a
//    GREEN cross (generic first-aid / pharmacy style, not the Red Cross emblem)
//    and HOSPITAL / CLINIC, planters and a bench
//  - sports grounds: floodlight masts and a small stand at big soccer / rugby
//    pitches next to OSM sports clubs and stadiums
// Props: src/assets/props/public-props.glb (Poly Haven CC0 bench, planter, bin;
// scripts/optimize-public-props.mjs). Everything else is modelled here in code.
//
// Budget phones: work is done lazily per 1 km cell when the camera comes near,
// one cell per frame. Ground paint is draped on the terrain and merged per cell
// (osmDetail's Flat, same material). Repeated props are InstancedMeshes (one draw
// call per kind for the whole map), refilled only after the camera moved 30 m.

const CELL = 1000;
const BUILD_R = 1700; // build a cell when its centre is this close
const SHOW_FLAT = 1600;
const SHOW_MALL = 1600;
const MOVE = 30;
const D2R = Math.PI / 180;

const C = (h) => new THREE.Color(h);
const COL = {
  bay: C('#f2f2ee'),
  bayY: C('#f2c230'),
  slab: C('#b9b6ae'),
  slabOil: C('#a7a49c'),
  paving: C('#cfc8b8'),
  pavingD: C('#b8b0a0'),
  grass: C('#55903b'),
  white: C('#f4f4f0'),
  sand: C('#c9ad7c')
};

// plain fascia colours for fuel canopies (no brand colours on purpose)
const FASCIA = ['#2f7d43', '#1e5aa8', '#c8372d', '#e8a90f', '#13807a', '#5b3a8e', '#d9661a'].map((h) => C(h).convertSRGBToLinear());

// ------------------------------------------------------------------ helpers
const _c = new THREE.Color();
// Malls you can walk into (src/world/mallInteriors.js): their first entrance
// gets open sliding doors instead of a closed glass front.
export const OPEN_MALLS = new Set(['Gateway Theatre of Shopping', 'Galleria Mall']);

// vertex-coloured box, rotated by yaw about its own centre then placed
function box(list, x, y, z, sx, sy, sz, color, yaw = 0, rx = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.deleteAttribute('uv');
  if (rx) g.rotateX(rx);
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  _c.set(color).convertSRGBToLinear();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  list.push(g);
}

// a textured quad: centre, size, yaw (its face looks along +z rotated by yaw), uv rect
function quad(list, x, y, z, w, h, yaw, u0, v0, u1, v1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
  uv.setXY(0, u0, v1);
  uv.setXY(1, u1, v1);
  uv.setXY(2, u0, v0);
  uv.setXY(3, u1, v0);
  g.rotateY(yaw);
  g.translate(x, y, z);
  list.push(g);
}

const merge = (list) => (list.length ? (list.length === 1 ? list[0] : mergeGeometries(list, false)) : null);

function inRing(r, x, z) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function areaOf(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}
function centreOf(r) {
  let x = 0;
  let z = 0;
  for (const p of r) {
    x += p[0];
    z += p[1];
  }
  return [x / r.length, z / r.length];
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
const v2 = (r) => r.map((p) => new THREE.Vector2(p[0], p[1]));
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ instanced pools
// One InstancedMesh per kind for the whole map; instances are kept in 250 m
// buckets and only those within `r` of the camera are copied in on refresh.
const BUCKET = 250;
class Pool {
  constructor(name, geo, mat, r, colored = false) {
    this.name = name;
    this.geo = geo;
    this.mat = mat;
    this.r = r;
    this.colored = colored;
    this.buckets = new Map();
    this.total = 0;
    this.mesh = null;
  }
  add(m4, color = null) {
    const x = m4.elements[12];
    const z = m4.elements[14];
    const k = Math.floor(x / BUCKET) * 100000 + Math.floor(z / BUCKET);
    let b = this.buckets.get(k);
    if (!b) {
      b = { m: [], c: [] };
      this.buckets.set(k, b);
    }
    for (let i = 0; i < 16; i++) b.m.push(m4.elements[i]);
    if (this.colored) b.c.push(color ? color.r : 1, color ? color.g : 1, color ? color.b : 1);
    this.total++;
  }
  refresh(group, x, z) {
    if (!this.total) return;
    // count what is in range first so the mesh is only (re)made when it must grow
    const g0x = Math.floor((x - this.r) / BUCKET);
    const g1x = Math.floor((x + this.r) / BUCKET);
    const g0z = Math.floor((z - this.r) / BUCKET);
    const g1z = Math.floor((z + this.r) / BUCKET);
    let n = 0;
    for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) n += (this.buckets.get(gx * 100000 + gz)?.m.length || 0) / 16;
    if (!this.mesh || this.mesh.instanceMatrix.count < n) {
      if (this.mesh) {
        group.remove(this.mesh);
        this.mesh.dispose();
      }
      const cap = Math.max(16, Math.ceil(n * 1.5));
      this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
      this.mesh.name = 'public-' + this.name;
      this.mesh.frustumCulled = false;
      if (this.colored) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      group.add(this.mesh);
    }
    const M = this.mesh.instanceMatrix.array;
    const Cc = this.colored ? this.mesh.instanceColor.array : null;
    let k = 0;
    const r2 = this.r * this.r;
    for (let gz = g0z; gz <= g1z; gz++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        const b = this.buckets.get(gx * 100000 + gz);
        if (!b) continue;
        for (let i = 0, j = 0; i < b.m.length; i += 16, j += 3) {
          const dx = b.m[i + 12] - x;
          const dz = b.m[i + 14] - z;
          if (dx * dx + dz * dz > r2) continue;
          for (let e = 0; e < 16; e++) M[k * 16 + e] = b.m[i + e];
          if (Cc) {
            Cc[k * 3] = b.c[j];
            Cc[k * 3 + 1] = b.c[j + 1];
            Cc[k * 3 + 2] = b.c[j + 2];
          }
          k++;
        }
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (Cc) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ prop geometry (code-modelled)
function lampGeometry() {
  const o = [];
  box(o, 0, 0.25, 0, 0.5, 0.5, 0.5, '#9a978f'); // concrete foot
  box(o, 0, 4.75, 0, 0.18, 9, 0.18, '#7d8288'); // pole
  for (const s of [-1, 1]) {
    box(o, s * 1.1, 9.1, 0, 2.2, 0.1, 0.1, '#7d8288');
    box(o, s * 2.1, 9.0, 0, 0.8, 0.22, 0.38, '#5d6268');
    box(o, s * 2.1, 8.88, 0, 0.66, 0.03, 0.28, '#fff6d8'); // lamp glass
  }
  return merge(o);
}

// full-size goal (7.32 x 2.44 m) with a net frame; schools scale it down
function goalGeometry() {
  const o = [];
  const W = '#f6f6f2';
  const N = '#c9ccd0';
  for (const s of [-1, 1]) {
    box(o, 0, 1.22, s * 3.66, 0.12, 2.44, 0.12, W);
    box(o, -0.9, 1.0, s * 3.66, 0.05, 2.0, 0.05, N);
    box(o, -0.45, 2.42, s * 3.66, 0.95, 0.04, 0.04, N);
    box(o, -0.9, 0.03, s * 3.66, 0.04, 0.04, 0.04, N);
    // side net panel (thin, slightly see-through grey)
    box(o, -0.45, 1.2, s * 3.66, 0.9, 2.3, 0.01, '#e4e6e8');
  }
  box(o, 0, 2.44, 0, 0.12, 0.12, 7.44, W); // crossbar
  box(o, -0.9, 2.0, 0, 0.05, 0.05, 7.32, N);
  box(o, -0.9, 0.03, 0, 0.05, 0.05, 7.32, N);
  box(o, -0.95, 1.0, 0, 0.01, 2.0, 7.3, '#e4e6e8'); // back net
  return merge(o);
}

function mastGeometry() {
  const o = [];
  box(o, 0, 0.4, 0, 1.2, 0.8, 1.2, '#9a978f');
  box(o, 0, 11, 0, 0.55, 22, 0.55, '#8b9096');
  box(o, 0, 22.4, 0, 3.6, 2.2, 0.35, '#4b5056'); // lamp frame, faces +z
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) box(o, -1.1 + i * 1.1, 21.9 + j * 1.0, 0.2, 0.9, 0.8, 0.05, '#fff7dc');
  return merge(o);
}

// 20 m spectator stand, seats facing +z
function standGeometry() {
  const o = [];
  for (let i = 0; i < 4; i++) {
    box(o, 0, 0.3 + i * 0.45, -i * 0.8, 20, 0.6 + i * 0.9, 0.8, '#b7b2a8');
    box(o, 0, 0.66 + i * 0.9, -i * 0.8 + 0.1, 19.6, 0.12, 0.4, i % 2 ? '#2f6db5' : '#d9a520');
  }
  for (const x of [-9.8, 9.8]) box(o, x, 3, -1.6, 0.2, 6, 0.2, '#6d7278');
  box(o, 0, 6.0, -1.4, 20.4, 0.15, 4.4, '#e9e9e4', 0, -0.12); // roof
  return merge(o);
}

// Forecourt body (local: +x toward the road, z along it), vertex coloured.
function fuelGeometry() {
  const o = [];
  const H = 5.4;
  for (const x of [-3.5, 3.5]) for (const z of [-6, 0, 6]) {
    box(o, x, H / 2, z, 0.55, H, 0.55, '#d9dadc');
    box(o, x, 0.5, z, 0.75, 1.0, 0.75, '#4a4f55'); // column foot guard
  }
  box(o, 0, H + 0.08, 0, 10.6, 0.06, 18.6, '#f7f7f2'); // canopy soffit
  for (const x of [-2.2, 2.2]) for (let z = -7.5; z <= 7.5; z += 3) box(o, x, H + 0.04, z, 1.2, 0.04, 0.6, '#fffbe6'); // down lights
  // pump islands across the canopy (cars pull in along the road)
  for (const z of [-5.5, 0, 5.5]) {
    box(o, 0, 0.12, z, 7.6, 0.24, 1.3, '#c9c6bd');
    box(o, 3.85, 0.3, z, 0.25, 0.6, 1.1, '#e2b82f'); // bump bollard ends
    box(o, -3.85, 0.3, z, 0.25, 0.6, 1.1, '#e2b82f');
    for (const x of [-1.6, 1.6]) {
      box(o, x, 1.1, z, 1.2, 1.9, 0.55, '#3a4149'); // dispenser
      box(o, x, 1.55, z, 0.9, 0.55, 0.57, '#e9eef0'); // display both faces
      box(o, x, 1.9, z, 1.25, 0.25, 0.6, '#f4f4f0');
      box(o, x - 0.65, 1.0, z, 0.08, 0.9, 0.12, '#1d1f22'); // hose
    }
  }
  box(o, -3.0, 0.5, -8.8, 0.6, 1.0, 0.6, '#c8372d'); // fire bucket stand
  return merge(o);
}
function fasciaGeometry() {
  const o = [];
  box(o, 0, 5.4 + 0.55, 0, 10.8, 1.05, 18.8, '#ffffff');
  return merge(o);
}
function fuelShopGeometry() {
  const o = [];
  box(o, 0, 2.1, 0, 8, 4.2, 15, '#ecebe6');
  box(o, 4.02, 1.6, 1.5, 0.06, 2.6, 9, '#2e4a5e'); // glass shop front
  box(o, 4.05, 1.25, -4.5, 0.06, 2.3, 1.6, '#3b4046'); // door
  box(o, 4.6, 3.6, 0, 1.4, 0.25, 15.4, '#f7f7f2'); // canopy over the front
  box(o, 0, 4.35, 0, 8.4, 0.3, 15.4, '#d0d0cb'); // roof band
  box(o, 0, 0.12, 6.8, 2.2, 0.24, 0.7, '#3b4046'); // air & water point
  box(o, 0, 0.75, 6.8, 0.4, 1.3, 0.4, '#2f7d43');
  return merge(o);
}
function priceBoardPostGeometry() {
  const o = [];
  box(o, 0, 0.3, 0, 2.6, 0.6, 0.6, '#9a978f');
  box(o, -0.9, 2.6, 0, 0.3, 4.2, 0.3, '#6d7278');
  box(o, 0.9, 2.6, 0, 0.3, 4.2, 0.3, '#6d7278');
  box(o, 0, 4.0, 0, 2.3, 2.6, 0.22, '#1c1f22');
  box(o, 0, 5.55, 0, 2.5, 0.5, 0.3, '#ffffff');
  return merge(o);
}

// care sign: plinth + posts (vertex colours); the board faces come from the atlas
function careSignPostGeometry() {
  const o = [];
  box(o, 0, 0.25, 0, 3.4, 0.5, 0.7, '#a9a59b');
  for (const x of [-1.45, 1.45]) box(o, x, 1.5, 0, 0.16, 2.2, 0.16, '#5d6268');
  box(o, 0, 1.9, 0, 3.1, 1.75, 0.16, '#ffffff');
  return merge(o);
}

// ------------------------------------------------------------------ textures
function fuelTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  // top half: white fascia lettering on transparent
  g.clearRect(0, 0, 1024, 256);
  g.fillStyle = '#ffffff';
  g.font = 'bold 120px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FUEL  •  SHOP', 512, 128);
  // bottom half: price board (generic, no brand)
  g.fillStyle = '#16191c';
  g.fillRect(0, 256, 1024, 256);
  g.font = 'bold 54px Arial, sans-serif';
  g.textAlign = 'left';
  const rows = [['PETROL 93', '23.45'], ['PETROL 95', '23.60'], ['DIESEL', '21.98']];
  rows.forEach(([a, b], i) => {
    g.fillStyle = '#f4f4f0';
    g.fillText(a, 40, 300 + i * 78);
    g.fillStyle = '#ff9d1c';
    g.font = 'bold 64px "Courier New", monospace';
    g.fillText(b, 640, 302 + i * 78);
    g.font = 'bold 54px Arial, sans-serif';
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  return t;
}

// green cross sign: left half HOSPITAL, right half CLINIC
function careTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  const one = (x0, word, sub) => {
    g.fillStyle = '#ffffff';
    g.fillRect(x0, 0, 512, 256);
    g.fillStyle = '#1a8a3e';
    g.fillRect(x0, 220, 512, 36);
    // green cross
    const cx = x0 + 100;
    const cy = 110;
    g.fillStyle = '#1a8a3e';
    g.fillRect(cx - 22, cy - 66, 44, 132);
    g.fillRect(cx - 66, cy - 22, 132, 44);
    g.fillStyle = '#1b2733';
    g.font = 'bold 64px Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(word, x0 + 190, 92, 310);
    g.font = 'bold 34px Arial, sans-serif';
    g.fillStyle = '#1a8a3e';
    g.fillText(sub, x0 + 192, 160, 300);
  };
  one(0, 'HOSPITAL', 'Emergency 24 hours');
  one(512, 'CLINIC', 'Open every day');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  return t;
}

// mall name boards: 2 columns x 18 rows of 512 x 56 px
const NAME_ROWS = 18;
function nameAtlas(names) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#23272c';
  g.fillRect(0, 0, 1024, 1024);
  const H = 1024 / NAME_ROWS;
  names.forEach((n, i) => {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * H;
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let fs = 40;
    g.font = `bold ${fs}px Arial, sans-serif`;
    while (g.measureText(n).width > 480 && fs > 18) {
      fs -= 2;
      g.font = `bold ${fs}px Arial, sans-serif`;
    }
    g.fillText(n, x + 256, y + H / 2 + 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  return t;
}
function nameUV(i) {
  const H = 1 / NAME_ROWS;
  const x = (i % 2) * 0.5;
  const r = Math.floor(i / 2);
  return [x + 0.004, 1 - (r + 1) * H + 0.004, x + 0.496, 1 - r * H - 0.004];
}

// ------------------------------------------------------------------ main class
export class PublicPlaces {
  /**
   * @param {object} data durban-public.json {malls, lots, parks}
   * @param {object} o { hf, roads, buildings, detail (OsmDetail), grounds (durban-grounds.json), fuel ([{x,z,n}]), sports ([{x,z}]) }
   */
  constructor(data, { hf, roads, buildings = null, detail = null, grounds = null, fuel = [], sports = [] }) {
    this.hf = hf;
    this.roads = roads;
    this.buildings = buildings;
    this.detail = detail;
    this.group = new THREE.Group();
    this.group.name = 'publicPlaces';
    this.cells = new Map();
    this.block = new Map(); // 20 m grid: school fields keep trees off
    this.stats = { lots: 0, bays: 0, malls: 0, fronts: 0, entrances: 0, parks: 0, benches: 0, schools: 0, fields: 0, care: 0, fuel: 0, sports: 0 };
    this.flatMat = detail?.flatMat || flatMaterial();
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glassMat = new THREE.MeshLambertMaterial({ color: 0x9fb8c4, emissive: 0x1c2a33, transparent: true, opacity: 0.55, depthWrite: false });
    this.pools = {};
    this.entrances = []; // mall entrances {mall, x, y, z, nx, nz, dx, dz} (mallInteriors.js walks in here)
    this.lastX = 1e9;
    this.lastZ = 1e9;
    this.first = true;
    const t0 = performance.now();
    const malls = (data && data.malls) || [];
    const lots = (data && data.lots) || [];
    const parks = (data && data.parks) || [];
    this.mallNames = [];
    malls.forEach((m, i) => {
      if (m.p.length < 3) return;
      const name = (m.n || '').trim() || 'SHOPPING CENTRE';
      let slot = this.mallNames.indexOf(name);
      if (slot < 0 && this.mallNames.length < NAME_ROWS * 2) {
        slot = this.mallNames.length;
        this.mallNames.push(name);
      }
      const [x, z] = centreOf(m.p);
      this.#cell(x, z).malls.push({ i, ring: m.p, name, slot: Math.max(0, slot), lots: [] });
    });
    for (const l of lots) {
      if (!l.p || l.p.length < 3) continue;
      const [x, z] = centreOf(l.p);
      this.#cell(x, z).lots.push(l);
      if (l.k === 'mall' && malls[l.s]) malls[l.s].lotRings = (malls[l.s].lotRings || []).concat([l.p]);
    }
    for (const c of this.cells.values()) for (const m of c.malls) m.lots = malls[m.i].lotRings || [];
    for (const p of parks) {
      if (!p.p || p.p.length < 3) continue;
      const [x, z] = centreOf(p.p);
      this.#cell(x, z).parks.push(p);
    }
    // schools without a mapped pitch inside; hospitals and clinics
    const pitchGrid = new Map();
    for (const p of detail?.pitches || []) {
      const k = Math.floor(p.x / 200) * 100000 + Math.floor(p.z / 200);
      (pitchGrid.get(k) || pitchGrid.set(k, []).get(k)).push(p);
    }
    const hasPitch = (ring) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of ring) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      for (let gx = Math.floor(x0 / 200); gx <= Math.floor(x1 / 200); gx++) {
        for (let gz = Math.floor(z0 / 200); gz <= Math.floor(z1 / 200); gz++) {
          for (const p of pitchGrid.get(gx * 100000 + gz) || []) if (inRing(ring, p.x, p.z)) return true;
        }
      }
      return false;
    };
    for (const s of grounds?.sites || []) {
      if (!s.p || s.p.length < 3) continue;
      const [x, z] = centreOf(s.p);
      if (s.k === 'school') {
        const ar = Math.abs(areaOf(s.p));
        if (ar < 2500 || ar > 400000 || hasPitch(s.p)) continue;
        this.#cell(x, z).schools.push(s);
      } else if (s.k === 'hospital' || s.k === 'clinic') this.#cell(x, z).care.push(s);
    }
    for (const f of fuel) this.#cell(f.x, f.z).fuel.push(f);
    // big soccer / rugby pitches near a sports club or stadium get floodlights + a stand
    const sportPts = sports.slice();
    for (const p of detail?.pitches || []) {
      const r = p.r;
      if (!r || r.len < 85 || r.wid < 45 || !/soccer|rugby|football|^$/.test(p.s)) continue;
      if (!sportPts.some((q) => Math.abs(q.x - p.x) < 300 && Math.abs(q.z - p.z) < 300)) continue;
      this.#cell(p.x, p.z).sports.push(p);
    }
    this.ms = performance.now() - t0;
  }

  #cell(x, z) {
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    const k = gx * 100000 + gz;
    let c = this.cells.get(k);
    if (!c) {
      c = { k, cx: (gx + 0.5) * CELL, cz: (gz + 0.5) * CELL, malls: [], lots: [], parks: [], schools: [], care: [], fuel: [], sports: [], built: false, flats: [], mallMeshes: [] };
      this.cells.set(k, c);
    }
    return c;
  }

  // ---- assets -------------------------------------------------------------
  async load(url = './src/assets/props/public-props.glb') {
    const P = this.pools;
    const S = this.solidMat;
    P.lamp = new Pool('lamp', lampGeometry(), S, 700);
    P.goal = new Pool('goal', goalGeometry(), S, 600);
    P.mast = new Pool('mast', mastGeometry(), S, 1400);
    P.stand = new Pool('stand', standGeometry(), S, 900);
    P.fuel = new Pool('fuel', fuelGeometry(), S, 900);
    P.fascia = new Pool('fascia', fasciaGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff }), 1400, true);
    P.fuelShop = new Pool('fuelShop', fuelShopGeometry(), S, 900);
    P.priceBoard = new Pool('priceBoard', priceBoardPostGeometry(), S, 700);
    P.careSign = new Pool('careSign', careSignPostGeometry(), S, 600);
    const ft = fuelTexture();
    const textMat = new THREE.MeshLambertMaterial({ map: ft, transparent: true, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const boardMat = new THREE.MeshLambertMaterial({ map: ft, emissive: 0xffffff, emissiveMap: ft, emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    {
      const o = [];
      // fascia lettering on both long sides (faces +x / -x) and the road end
      quad(o, 5.42, 5.95, 0, 12, 1.0, Math.PI / 2, 0, 0.5, 1, 1);
      quad(o, -5.42, 5.95, 0, 12, 1.0, -Math.PI / 2, 0, 0.5, 1, 1);
      P.fuelText = new Pool('fuelText', merge(o), textMat, 900);
      const b = [];
      quad(b, 0, 4.0, 0.12, 2.2, 2.5, 0, 0, 0, 1, 0.5);
      quad(b, 0, 4.0, -0.12, 2.2, 2.5, Math.PI, 0, 0, 1, 0.5);
      P.priceFace = new Pool('priceFace', merge(b), boardMat, 700);
    }
    {
      const ct = careTexture();
      const m = new THREE.MeshLambertMaterial({ map: ct, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      for (const [k, u0, u1] of [['hosp', 0, 0.5], ['clinic', 0.5, 1]]) {
        const o = [];
        quad(o, 0, 1.9, 0.085, 3.0, 1.5, 0, u0, 0, u1, 1);
        quad(o, 0, 1.9, -0.085, 3.0, 1.5, Math.PI, u0, 0, u1, 1);
        P['care_' + k] = new Pool('care_' + k, merge(o), m, 600);
      }
    }
    this.nameMat = new THREE.MeshLambertMaterial({ map: nameAtlas(this.mallNames), emissive: 0xffffff, emissiveIntensity: 0.25 });
    this.nameMat.emissiveMap = this.nameMat.map;
    // Poly Haven CC0 bench / planter / bin (one shared atlas material)
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        const mat = new THREE.MeshLambertMaterial({ map: o.material.map || null, color: 0xffffff });
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        if (!this.propMat) this.propMat = mat;
        const name = (o.name || o.parent?.name || '').toLowerCase();
        for (const k of ['bench', 'planter', 'bin']) if (name.includes(k) && !P[k]) P[k] = new Pool(k, g, this.propMat, k === 'planter' ? 500 : 350);
      });
    } catch (err) {
      console.warn('[IZK] public props glb not loaded', err);
    }
    // stand-ins if the glb could not load
    if (!P.bench) {
      const o = [];
      box(o, 0, 0.45, 0, 1.7, 0.06, 0.45, '#8a5a3a');
      box(o, 0, 0.8, -0.2, 1.7, 0.35, 0.05, '#8a5a3a');
      for (const x of [-0.75, 0.75]) box(o, x, 0.22, 0, 0.06, 0.45, 0.45, '#3a3d42');
      P.bench = new Pool('bench', merge(o), S, 350);
    }
    if (!P.planter) {
      const o = [];
      box(o, 0, 0.35, 0, 1.7, 0.7, 0.8, '#9a978f');
      box(o, 0, 0.75, 0, 1.5, 0.3, 0.6, '#4e7d34');
      P.planter = new Pool('planter', merge(o), S, 500);
    }
    if (!P.bin) {
      const o = [];
      box(o, 0, 0.45, 0, 0.6, 0.9, 0.6, '#3e5d46');
      P.bin = new Pool('bin', merge(o), S, 350);
    }
  }

  // place a shared prop (bench, planter, bin, lamp...) from another module
  putProp(kind, x, z, yaw, y = null) {
    this.#put(kind, x, z, yaw, { y });
    this.lastX = 1e9; // refill on the next update
  }

  // trees keep off the school fields this module paints
  blocks(x, z) {
    return this.block.has(Math.floor(x / 20) * 100000 + Math.floor(z / 20));
  }

  // ---- placing --------------------------------------------------------------
  #y(x, z) {
    return this.hf.renderedHeightAt ? this.hf.renderedHeightAt(x, z) : this.hf.heightAt(x, z);
  }
  #free(x, z, r) {
    return !(this.buildings && this.buildings.blocked(x, z, r));
  }
  #offRoad(x, z, gap) {
    const n = this.roads.nearestRoad(x, z, 30);
    return !n || n.dist > n.road.width / 2 + gap;
  }
  // matrix: position on the ground, yaw, optional scale
  #m(x, z, yaw, sx = 1, sy = 1, sz = 1, y = null) {
    const m = this._m || (this._m = new THREE.Matrix4());
    const q = this._q || (this._q = new THREE.Quaternion());
    const p = this._p || (this._p = new THREE.Vector3());
    const s = this._s || (this._s = new THREE.Vector3());
    const up = this._u || (this._u = new THREE.Vector3(0, 1, 0));
    q.setFromAxisAngle(up, yaw);
    p.set(x, y === null ? this.#y(x, z) : y, z);
    s.set(sx, sy, sz);
    return m.compose(p, q, s);
  }
  #put(kind, x, z, yaw, opts = {}) {
    const P = this.pools[kind];
    if (!P) return;
    P.add(this.#m(x, z, yaw, opts.sx || 1, opts.sy || 1, opts.sz || 1, opts.y ?? null), opts.color || null);
  }

  #build(c) {
    c.built = true;
    const base = new Flat(); // grass, slabs, paving
    const paint = new Flat(); // lines
    for (const l of c.lots) this.#lot(l, paint);
    for (const f of c.fuel) this.#fuel(f, base, paint);
    for (const m of c.malls) this.#mall(m, base, c);
    for (const p of c.parks) this.#park(p);
    for (const s of c.schools) this.#school(s, base, paint);
    for (const s of c.care) this.#care(s);
    for (const s of c.sports) this.#sport(s);
    [
      [base, 0.13],
      [paint, 0.22]
    ].forEach(([F, lift], i) => {
      const g = F.build(this.hf, lift);
      if (!g) return;
      const mesh = new THREE.Mesh(g, this.flatMat);
      mesh.name = 'publicFlat';
      mesh.renderOrder = -0.35 + i * 0.01;
      mesh.receiveShadow = true;
      c.flats.push(mesh);
      this.group.add(mesh);
    });
  }

  // ---- car parks: bays along the real aisles ---------------------------------
  #lot(l, paint) {
    const ring = l.p;
    let aisles = (l.a || []).filter((a) => a.length >= 2);
    if (!aisles.length) {
      // no aisles mapped: rows along the long side of the lot
      const r = minRect(v2(ring));
      if (!r || r.wid < 14 || r.len < 15) return;
      aisles = [];
      for (let v = -r.wid / 2 + 8; v < r.wid / 2 - 5; v += 17) {
        const P = (u) => [r.cx + u * r.ux - v * r.uz, r.cz + u * r.uz + v * r.ux];
        aisles.push([P(-r.len / 2 + 3), P(r.len / 2 - 3)]);
      }
    }
    const segs = [];
    for (const a of aisles) for (let i = 0; i + 1 < a.length; i++) segs.push([a[i][0], a[i][1], a[i + 1][0], a[i + 1][1]]);
    const clear = (x, z, self) => {
      for (const s of segs) if (s !== self && segDist(x, z, s[0], s[1], s[2], s[3]) < 2.8) return false;
      return true;
    };
    const W = COL.bay;
    let n = 0;
    for (const s of segs) {
      const [ax, az, bx, bz] = s;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 6) continue;
      const dx = (bx - ax) / L;
      const dz = (bz - az) / L;
      const nx = -dz;
      const nz = dx;
      for (const side of [-1, 1]) {
        let prev = null;
        for (let t = 1.5; t <= L - 1.5; t += 2.5) {
          const px = ax + dx * t;
          const pz = az + dz * t;
          const x0 = px + nx * side * 3.1;
          const z0 = pz + nz * side * 3.1;
          const x1 = px + nx * side * 8.1;
          const z1 = pz + nz * side * 8.1;
          const xm = (x0 + x1) / 2;
          const zm = (z0 + z1) / 2;
          const ok = inRing(ring, x0, z0) && inRing(ring, x1, z1) && clear(x1, z1, s) && clear(xm, zm, s) && this.#free(xm, zm, 0.8);
          if (!ok) {
            prev = null;
            continue;
          }
          paint.line(x0, z0, x1, z1, 0.12, W);
          if (prev) paint.line(prev[0], prev[1], x1, z1, 0.12, W); // back line
          prev = [x1, z1];
          n++;
          // a light pole at every 12th bay, at the back
          if (n % 12 === 0 && this.#free(x1 + nx * side * 0.6, z1 + nz * side * 0.6, 0.6)) this.#put('lamp', x1 + nx * side * 0.6, z1 + nz * side * 0.6, Math.atan2(dx, dz) + Math.PI / 2);
        }
      }
      // direction arrows down the aisle middle
      for (let t = 10; t < L - 8; t += 28) {
        const px = ax + dx * t;
        const pz = az + dz * t;
        if (!inRing(ring, px, pz)) continue;
        paint.line(px - dx * 1.6, pz - dz * 1.6, px + dx * 0.6, pz + dz * 0.6, 0.18, W);
        paint.tri(px + dx * 1.6, pz + dz * 1.6, px + dx * 0.4 + nx * 0.6, pz + dz * 0.4 + nz * 0.6, px + dx * 0.4 - nx * 0.6, pz + dz * 0.4 - nz * 0.6, W, 0);
      }
    }
    this.stats.lots++;
    this.stats.bays += n;
  }

  // ---- fuel station forecourts ---------------------------------------------
  #fuel(f, base, paint) {
    const near = this.roads.nearestRoad(f.x, f.z, 70, (r) => r.rank > 1 && !r.bridge);
    if (!near) return;
    const dl = Math.hypot(near.dirX, near.dirZ) || 1;
    const ax = near.dirX / dl; // along the road
    const az = near.dirZ / dl;
    // which side of the road the station is on
    let sx = -az;
    let sz = ax;
    if ((f.x - near.x) * sx + (f.z - near.z) * sz < 0) {
      sx = -sx;
      sz = -sz;
    }
    const edge = near.road.width / 2 + 2.5;
    let off = edge + 9;
    // step back from buildings
    const at = (o) => [near.x + sx * o, near.z + sz * o];
    for (let k = 0; k < 4; k++) {
      const [cx, cz] = at(off);
      if (this.#free(cx, cz, 6) && this.#free(cx + sx * 14, cz + sz * 14, 3)) break;
      off += 4;
    }
    const [cx, cz] = at(off);
    if (this.hf.isWater(cx, cz)) return;
    // another road through the forecourt? skip
    const other = this.roads.nearestRoad(cx, cz, 9, (r) => r !== near.road);
    if (other && other.dist < other.road.width / 2 + 4) return;
    // model: local +x toward the road, +z along it. L(u, v): u metres away from the road, v along it
    const yaw = Math.atan2(sz, -sx);
    const L = (u, v) => [cx + sx * u + ax * v, cz + sz * u + az * v];
    // concrete slab from the road edge back past the shop
    const q = [L(edge - off, -17), L(edge - off, 17), L(20, 17), L(20, -17)];
    const Q = (k) => q[k];
    base.quad(Q(0)[0], Q(0)[1], Q(1)[0], Q(1)[1], Q(2)[0], Q(2)[1], Q(3)[0], Q(3)[1], COL.slab);
    // darker oil-stained lanes along the pump islands, painted arrows in / out
    for (const v of [-2.8, 2.8, 8.2, -8.2]) {
      const [a, b] = L(-4.5, v);
      const [c2, d] = L(4.5, v);
      paint.line(a, b, c2, d, 2.0, COL.slabOil);
    }
    for (const v of [-13, 13]) {
      const [a, b] = L(edge - off + 1.5, v);
      const [c2, d] = L(edge - off + 5.5, v);
      paint.line(a, b, c2, d, 0.2, COL.bay);
    }
    const y = Math.max(this.#y(cx, cz), this.#y(...L(4, 0)), this.#y(...L(-4, 0))) + 0.05;
    const col = FASCIA[Math.abs(Math.round(f.x * 7 + f.z * 3)) % FASCIA.length];
    this.#put('fuel', cx, cz, yaw, { y });
    this.#put('fascia', cx, cz, yaw, { y, color: col });
    this.#put('fuelText', cx, cz, yaw, { y });
    const [hx, hz] = L(13.5, 0);
    if (this.#free(hx, hz, 4)) this.#put('fuelShop', hx, hz, yaw, { y: Math.max(y, this.#y(hx, hz)) });
    const [bx, bz] = L(edge - off + 2.2, 15.5);
    this.#put('priceBoard', bx, bz, yaw + Math.PI / 2);
    this.#put('priceFace', bx, bz, yaw + Math.PI / 2);
    this.stats.fuel++;
  }

  // ---- mall fronts ------------------------------------------------------------
  #mall(m, base, cell) {
    const ring = m.ring;
    const n = ring.length;
    const solid = [];
    const glass = [];
    const signs = [];
    const chunks = [];
    for (let i = 0; i < n; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % n];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 6) continue;
      const dx = (bx - ax) / L;
      const dz = (bz - az) / L;
      const k = Math.ceil((L - 1) / 12);
      for (let j = 0; j < k; j++) {
        const t0 = 0.5 + ((L - 1) * j) / k;
        const t1 = 0.5 + ((L - 1) * (j + 1)) / k;
        const mx = ax + dx * (t0 + t1) / 2;
        const mz = az + dz * (t0 + t1) / 2;
        // outward normal = the side that is NOT inside a building
        let nx = dz;
        let nz = -dx;
        let wall = false;
        for (const s of [1, -1]) {
          const ix = mx - nx * s * 1.5;
          const iz = mz - nz * s * 1.5;
          const ox = mx + nx * s * 2.5;
          const oz = mz + nz * s * 2.5;
          if (!this.#free(ix, iz, 0.3) && this.#free(ox, oz, 0.6) && !this.hf.isWater(ox, oz)) {
            nx *= s;
            nz *= s;
            wall = true;
            break;
          }
        }
        if (!wall) continue;
        // is the open ground in front a car park of this mall, or a road?
        const fx = mx + nx * 10;
        const fz = mz + nz * 10;
        const lot = m.lots.some((r) => inRing(r, fx, fz));
        chunks.push({ mx, mz, dx, dz, nx, nz, len: t1 - t0, edge: L, lot, i });
      }
    }
    if (!chunks.length) return;
    this.stats.malls++;
    for (const ch of chunks) {
      const { mx, mz, dx, dz, nx, nz, len } = ch;
      const y = this.#y(mx + nx * 1.5, mz + nz * 1.5);
      const yaw = Math.atan2(nx, nz); // local z outward, local x along the wall
      const at = (u, v) => [mx + dx * u + nx * v, mz + dz * u + nz * v];
      // paved walkway, darker edge kerb
      const p = [at(-len / 2, 0), at(len / 2, 0), at(len / 2, 4.2), at(-len / 2, 4.2)];
      base.quad(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1], COL.paving, 0);
      const e = [at(-len / 2, 4.2), at(len / 2, 4.2)];
      base.line(e[0][0], e[0][1], e[1][0], e[1][1], 0.35, COL.pavingD);
      // shopfront glass, mullions, kick plate, canopy
      const [gx, gz] = at(0, 0.12);
      box(glass, gx, y + 1.75, gz, len - 0.2, 2.9, 0.06, '#ffffff', yaw);
      box(solid, gx, y + 0.17, gz, len, 0.34, 0.16, '#41464c', yaw);
      box(solid, gx, y + 3.25, gz, len, 0.2, 0.18, '#41464c', yaw);
      for (let u = -len / 2; u <= len / 2 + 0.01; u += len / Math.max(1, Math.round(len / 2.6))) {
        const [ux, uz] = at(u, 0.14);
        box(solid, ux, y + 1.7, uz, 0.1, 3.1, 0.14, '#3a3f45', yaw);
      }
      const [cx, cz] = at(0, 1.45);
      box(solid, cx, y + 3.55, cz, len + 0.05, 0.32, 2.7, '#ecebe6', yaw);
      const [lx, lz] = at(0, 2.75);
      box(solid, lx, y + 3.55, lz, len + 0.05, 0.42, 0.1, '#c9cbcd', yaw); // canopy edge
      this.stats.fronts++;
    }
    // entrances: longest wall edges facing a car park first, at least 45 m apart
    const want = chunks.length > 40 ? 4 : chunks.length > 12 ? 2 : 1;
    const ranked = chunks.filter((ch) => ch.len > 7.5).sort((a, b) => (b.lot ? 1000 : 0) + b.edge - ((a.lot ? 1000 : 0) + a.edge));
    const ents = [];
    for (const ch of ranked) {
      if (ents.length >= want) break;
      if (ents.some((e) => Math.hypot(e.mx - ch.mx, e.mz - ch.mz) < 45)) continue;
      ents.push(ch);
    }
    const [u0, v0, u1, v1] = nameUV(m.slot);
    for (const ch of ents) {
      const { mx, mz, dx, dz, nx, nz } = ch;
      const open = OPEN_MALLS.has((m.name || '').trim()) && ch === ents[0];
      const y = this.#y(mx + nx * 2, mz + nz * 2);
      const yaw = Math.atan2(nx, nz);
      const at = (u, v) => [mx + dx * u + nx * v, mz + dz * u + nz * v];
      for (const s of [-1, 1]) {
        const [px, pz] = at(s * 5.2, 2.2);
        box(solid, px, y + 3.9, pz, 1.1, 7.8, 1.1, '#d8d2c4', yaw);
        const [qx, qz] = at(s * 5.2, 2.2);
        box(solid, qx, y + 0.2, qz, 1.3, 0.4, 1.3, '#a9a59b', yaw);
      }
      this.entrances.push({ mall: (m.name || '').trim(), x: mx, y, z: mz, nx, nz, dx, dz, len: ch.edge, open });
      const [hx, hz] = at(0, 1.5);
      box(solid, hx, y + 7.2, hz, 11.6, 1.9, 2.8, '#2c3035', yaw); // header box
      const [rx, rz] = at(0, 1.4);
      box(solid, rx, y + 8.25, rz, 12.2, 0.2, 3.4, '#ecebe6', yaw); // roof lip
      const [sx2, sz2] = at(0, 2.92);
      quad(signs, sx2, y + 7.2, sz2, 10.6, 1.25, yaw, u0, v0, u1, v1);
      if (open) {
        // walk-in mall: the sliding doors stand open (5.2 m gap), glass above and to the sides
        for (const s of [-1, 1]) {
          const [gx, gz] = at(s * 3.75, 0.3);
          box(glass, gx, y + 3.1, gz, 1.5, 6.0, 0.08, '#ffffff', yaw);
          const [fx, fz] = at(s * 2.9, 0.36);
          box(solid, fx, y + 1.6, fz, 0.14, 3.2, 0.14, '#2a2e33', yaw);
        }
        const [gx, gz] = at(0, 0.3);
        box(glass, gx, y + 4.7, gz, 5.8, 2.8, 0.08, '#ffffff', yaw);
      } else {
        const [gx, gz] = at(0, 0.3);
        box(glass, gx, y + 3.1, gz, 9.0, 6.0, 0.08, '#ffffff', yaw); // tall glass entrance
        for (const u of [-2.2, 0, 2.2]) {
          const [fx, fz] = at(u, 0.36);
          box(solid, fx, y + 1.6, fz, 0.12, 3.2, 0.12, '#2a2e33', yaw);
        }
      }
      const [tx, tz] = at(0, 0.38);
      box(solid, tx, y + 3.2, tz, 9.0, 0.16, 0.16, '#2a2e33', yaw);
      // planters, bins, benches in front
      const face = Math.atan2(nx, nz);
      for (const s of [-1, 1]) {
        const [px, pz] = at(s * 7.2, 4.0);
        if (this.#free(px, pz, 0.8)) this.#put('planter', px, pz, face + Math.PI / 2);
        const [bx, bz] = at(s * 3.4, 4.4);
        if (this.#free(bx, bz, 0.4)) this.#put('bin', bx, bz, face);
        const [cx, cz] = at(s * 9.8, 3.6);
        if (this.#free(cx, cz, 0.8)) this.#put('bench', cx, cz, face);
      }
      this.stats.entrances++;
    }
    const add = (list, mat, name) => {
      const g = merge(list);
      if (!g) return;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      if (mat === this.glassMat) mesh.renderOrder = 2;
      this.group.add(mesh);
      cell.mallMeshes.push(mesh);
    };
    add(solid, this.solidMat, 'mallFront');
    add(glass, this.glassMat, 'mallGlass');
    add(signs, this.nameMat, 'mallSign');
  }

  // ---- parks -----------------------------------------------------------------
  #park(p) {
    const ring = p.p;
    const ar = Math.abs(areaOf(ring));
    if (ar < 300) return;
    const [cx, cz] = centreOf(ring);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const want = Math.max(2, Math.min(14, Math.round(ar / 1800)));
    const R = rng(Math.round(cx * 13 + cz * 7));
    let placed = 0;
    for (let tries = 0; tries < want * 8 && placed < want; tries++) {
      const x = x0 + R() * (x1 - x0);
      const z = z0 + R() * (z1 - z0);
      if (!inRing(ring, x, z) || this.hf.isWater(x, z)) continue;
      if (this.detail && this.detail.blocks(x, z)) continue;
      if (!this.#offRoad(x, z, 3) || !this.#free(x, z, 2)) continue;
      // bench looks toward the middle of the park (or a random way in big ones)
      const face = ar < 40000 ? Math.atan2(cx - x, cz - z) : R() * Math.PI * 2;
      this.#put('bench', x, z, face);
      if (placed % 2 === 0) this.#put('bin', x + Math.cos(face) * 1.4, z - Math.sin(face) * 1.4, face);
      placed++;
    }
    // a pair of planters where the park meets its nearest street
    let best = null;
    for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 24))) {
      const [x, z] = ring[i];
      const nr = this.roads.nearestRoad(x, z, 25, (r) => !r.bridge);
      if (nr && (!best || nr.dist < best.d)) best = { x, z, d: nr.dist, nr };
    }
    if (best) {
      const ux = cx - best.x;
      const uz = cz - best.z;
      const L = Math.hypot(ux, uz) || 1;
      const px = best.x + (ux / L) * 4;
      const pz = best.z + (uz / L) * 4;
      const face = Math.atan2(ux, uz);
      for (const s of [-1, 1]) {
        const qx = px + Math.cos(face) * 2.2 * s;
        const qz = pz - Math.sin(face) * 2.2 * s;
        if (inRing(ring, qx, qz) && this.#offRoad(qx, qz, 1.5) && this.#free(qx, qz, 1)) this.#put('planter', qx, qz, face + Math.PI / 2);
      }
    }
    this.stats.parks++;
    this.stats.benches += placed;
  }

  // ---- school fields ------------------------------------------------------------
  #school(s, base, paint) {
    const ring = s.p;
    const r = minRect(v2(ring));
    if (!r) return;
    const [scx, scz] = centreOf(ring);
    const sizes = [[90, 55, 1], [64, 40, 0.8], [44, 28, 0.62]];
    const P = (cx, cz, u, v) => [cx + u * r.ux - v * r.uz, cz + u * r.uz + v * r.ux];
    const fits = (cx, cz, L, W) => {
      const hs = [];
      for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const [x, z] = P(cx, cz, (a * L) / 2, (b * W) / 2);
        if (!inRing(ring, x, z) || this.hf.isWater(x, z)) return false;
        if (!this.#free(x, z, a || b ? 1.5 : 4) || !this.#offRoad(x, z, 2)) return false;
        if (this.detail && this.detail.blocks(x, z)) return false;
        hs.push(this.#y(x, z));
      }
      // must also be clear between the samples (classroom blocks are small)
      for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        const [x, z] = P(cx, cz, (a * L) / 2, (b * W) / 2);
        if (!this.#free(x, z, 3)) return false;
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const h of hs) {
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      return hi - lo < 2.5 + L * 0.02;
    };
    let pick = null;
    for (const [L, W, sc] of sizes) {
      if (L > r.len - 4 || W > r.wid - 4) continue;
      const cands = [];
      for (let u = -r.len / 2 + L / 2 + 2; u <= r.len / 2 - L / 2 - 2; u += 8) {
        for (let v = -r.wid / 2 + W / 2 + 2; v <= r.wid / 2 - W / 2 - 2; v += 8) {
          const [x, z] = P(r.cx, r.cz, u, v);
          cands.push([x, z, Math.hypot(x - scx, z - scz)]);
        }
      }
      cands.sort((a, b) => b[2] - a[2]); // fields are usually at the back, away from the buildings in the middle
      for (const [x, z] of cands.slice(0, 60)) {
        if (fits(x, z, L, W)) {
          pick = { x, z, L, W, sc };
          break;
        }
      }
      if (pick) break;
    }
    if (!pick) return;
    const { x, z, L, W, sc } = pick;
    const Q = (u, v) => P(x, z, u, v);
    const c = [Q(-L / 2 - 3, -W / 2 - 3), Q(L / 2 + 3, -W / 2 - 3), Q(L / 2 + 3, W / 2 + 3), Q(-L / 2 - 3, W / 2 + 3)];
    base.quad(c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1], COL.grass, 1);
    // worn goal mouths
    for (const s2 of [-1, 1]) {
      const g = [Q(s2 * (L / 2 - 6), -5), Q(s2 * L / 2, -5), Q(s2 * L / 2, 5), Q(s2 * (L / 2 - 6), 5)];
      base.quad(g[0][0], g[0][1], g[1][0], g[1][1], g[2][0], g[2][1], g[3][0], g[3][1], COL.sand, 0);
    }
    const w = 0.12;
    const seg = (u0, v0, u1, v1) => {
      const [a, b] = Q(u0, v0);
      const [c2, d] = Q(u1, v1);
      paint.line(a, b, c2, d, w, COL.bay);
    };
    const rect = (u0, v0, u1, v1) => {
      seg(u0, v0, u1, v0);
      seg(u1, v0, u1, v1);
      seg(u1, v1, u0, v1);
      seg(u0, v1, u0, v0);
    };
    rect(-L / 2, -W / 2, L / 2, W / 2);
    seg(0, -W / 2, 0, W / 2);
    const [mx, mz] = Q(0, 0);
    paint.circle(mx, mz, 9.15 * sc, w, COL.bay, 24);
    const bd = 16.5 * sc;
    const bw = Math.min(W / 2 - 1, 20 * sc);
    for (const s2 of [-1, 1]) {
      rect(s2 * L / 2, -bw, s2 * (L / 2 - bd), bw);
      rect(s2 * L / 2, -9 * sc, s2 * (L / 2 - 5.5 * sc), 9 * sc);
      const [gx, gz] = Q(s2 * (L / 2), 0);
      // goal frame faces the field; small (5 x 2 m) at schools
      this.#put('goal', gx, gz, Math.atan2(s2 * r.uz, -s2 * r.ux), { sz: 5 / 7.32, sy: 2 / 2.44 });
    }
    // trees keep off it
    for (let gx = Math.floor((x - L / 2 - 10) / 20); gx <= Math.floor((x + L / 2 + 10) / 20); gx++) {
      for (let gz = Math.floor((z - L / 2 - 10) / 20); gz <= Math.floor((z + L / 2 + 10) / 20); gz++) {
        const px = gx * 20 + 10 - x;
        const pz = gz * 20 + 10 - z;
        const u = px * r.ux + pz * r.uz;
        const v = -px * r.uz + pz * r.ux;
        if (Math.abs(u) < L / 2 + 6 && Math.abs(v) < W / 2 + 6) this.block.set(gx * 100000 + gz, 1);
      }
    }
    this.stats.fields++;
  }

  // ---- hospitals and clinics -------------------------------------------------------
  #care(s) {
    const ring = s.p;
    let best = null;
    const step = Math.max(1, Math.floor(ring.length / 40));
    for (let i = 0; i < ring.length; i += step) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const x = (ax + bx) / 2;
      const z = (az + bz) / 2;
      const nr = this.roads.nearestRoad(x, z, 40, (r) => r.rank > 0 && !r.bridge);
      if (!nr) continue;
      const score = nr.dist - nr.road.rank * 4;
      if (!best || score < best.score) best = { x, z, nr, score };
    }
    if (!best) return;
    const [cx, cz] = centreOf(ring);
    let ux = cx - best.x;
    let uz = cz - best.z;
    const L = Math.hypot(ux, uz) || 1;
    ux /= L;
    uz /= L;
    // inside the fence, set back a little, facing the road
    let px = best.x + ux * 3.5;
    let pz = best.z + uz * 3.5;
    for (let k = 0; k < 4 && !(this.#free(px, pz, 2) && this.#offRoad(px, pz, 2)); k++) {
      px += ux * 2.5;
      pz += uz * 2.5;
    }
    if (!this.#free(px, pz, 1.6)) return;
    // board faces the road: +z of the sign toward the road
    const yaw = Math.atan2(-ux, -uz);
    this.#put('careSign', px, pz, yaw);
    this.#put(s.k === 'hospital' ? 'care_hosp' : 'care_clinic', px, pz, yaw);
    // planters either side, a bench behind
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    for (const sg of [-1, 1]) {
      const qx = px + ax * 2.9 * sg;
      const qz = pz + az * 2.9 * sg;
      if (this.#free(qx, qz, 1)) this.#put('planter', qx, qz, yaw);
    }
    const bx = px + ux * 6 + ax * 3;
    const bz = pz + uz * 6 + az * 3;
    if (this.#free(bx, bz, 1) && inRing(ring, bx, bz)) this.#put('bench', bx, bz, yaw);
    this.stats.care++;
  }

  // ---- sports grounds: floodlights + a stand ----------------------------------------
  #sport(p) {
    const r = p.r;
    const P = (u, v) => [r.cx + u * r.ux - v * r.uz, r.cz + u * r.uz + v * r.ux];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const [x, z] = P(a * (r.len / 2 + 4), b * (r.wid / 2 + 5));
      if (!this.#free(x, z, 1.5) || !this.#offRoad(x, z, 2)) continue;
      // lamps point at the centre spot
      this.#put('mast', x, z, Math.atan2(r.cx - x, r.cz - z));
    }
    for (const sg of [1, -1]) {
      const [x, z] = P(0, sg * (r.wid / 2 + 6.5));
      if (this.#free(x, z, 6) && this.#free(...P(9, sg * (r.wid / 2 + 6.5)), 2) && this.#free(...P(-9, sg * (r.wid / 2 + 6.5)), 2) && this.#offRoad(x, z, 6)) {
        this.#put('stand', x, z, Math.atan2(r.cx - x, r.cz - z));
        break;
      }
    }
    this.stats.sports++;
  }

  // ---- per frame ----------------------------------------------------------------
  update(camX, camZ) {
    if (!this.pools.lamp) return; // load() not done
    // build the nearest unbuilt cell in range (all of them on the first call)
    let todo = this.first ? Infinity : 1;
    this.first = false;
    let changed = false;
    while (todo-- > 0) {
      let best = null;
      let bd = BUILD_R;
      for (const c of this.cells.values()) {
        if (c.built) continue;
        const d = Math.hypot(c.cx - camX, c.cz - camZ);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (!best) break;
      try {
        this.#build(best);
      } catch (err) {
        console.warn('[IZK] public places cell skipped', err);
        best.built = true;
      }
      changed = true;
    }
    if (changed || Math.abs(camX - this.lastX) > MOVE || Math.abs(camZ - this.lastZ) > MOVE) {
      this.lastX = camX;
      this.lastZ = camZ;
      for (const c of this.cells.values()) {
        if (!c.built) continue;
        const d = Math.max(Math.abs(c.cx - camX), Math.abs(c.cz - camZ)) - CELL / 2;
        for (const m of c.flats) m.visible = d < SHOW_FLAT;
        for (const m of c.mallMeshes) m.visible = d < SHOW_MALL;
      }
      for (const P of Object.values(this.pools)) P.refresh(this.group, camX, camZ);
    }
  }
}
