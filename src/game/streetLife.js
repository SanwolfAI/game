import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';
import { toXZ } from '../core/geo.js';
import { WALK_W } from '../world/roads.js';
import { buildVehicleMesh } from './models.js';
import { trafficCarModel } from './carModels.js';
import { crashSound, honkFar } from './audio.js';
import { WORLD } from '../world/worldLight.js';
import { blobMaterial, blobGeometry } from '../world/blobShadow.js';

// Street life: busy pavements the way Durban's CBD really is (West St, Dr
// Pixley KaSeme, Anton Lembede, Warwick). Walkers on the pavements, hawkers
// under gazebos selling veg and clothes, barbers cutting hair under a tent,
// people smoking and drinking, groups waiting at corners, women carrying
// loads on their heads, and cars parked along the kerb facing the flow of
// traffic. Parked cars reshuffle (new cars, new gaps) once you're away.
// Everything is instanced: a handful of draw calls for hundreds of people.

// Busy zones (lon, lat, radius m, intensity). CBD box handled separately.
const HUBS = [
  [31.0085, -29.8570, 450, 1.0], // Warwick Junction / Berea station
  [30.8580, -29.8170, 420, 0.65], // Pinetown CBD
  [30.8885, -29.9660, 380, 0.6], // Umlazi Mega City
  [30.9395, -29.9940, 380, 0.55], // Isipingo
  [30.9700, -29.7505, 380, 0.55], // Bridge City / KwaMashu
  [31.0505, -29.8475, 320, 0.45], // beachfront promenade
  [30.9970, -29.8090, 300, 0.4] // Springfield / Avonmore shops
];
const CBD_LON = [31.0050, 31.0390];
const CBD_LAT = [-29.8665, -29.8455];
const BASE = 0.08; // quiet suburb pavements

const R_BUILD = 230; // rebuild slots within this radius
const R_MOVE = 70; // rebuild after moving this far
const MAX_WALK = 300;
const MAX_STAND = 260;
const MAX_STALL = 160;
const MAX_UMB = 40;
const MAX_RACK = 60;
const MAX_BARB = 14;
const MAX_PARK = 140;
const MAX_HEAD = 60;
const MAX_HAND = 120;

const WALK_CLS = { primary: 1, secondary: 1, tertiary: 0.9, residential: 0.5, living_street: 0.7, unclassified: 0.4, pedestrian: 1.2 };
const PARK_CLS = { primary: 1, secondary: 1, tertiary: 1, residential: 1, unclassified: 1 };

const SKIN = ['#4a2c1d', '#5b3624', '#6e4129', '#3b2316', '#7d4c2f', '#8d5a39', '#c08a64', '#e0b48f'].map((h) => new THREE.Color(h));
const SHIRT = ['#f2f2f0', '#1d1f22', '#b8282b', '#1f4f9a', '#e8c12a', '#2f7d45', '#6b6f75', '#d9672b', '#7a2f8f', '#c4c8cc', '#0d6b7a', '#f4a6b8', '#3b3b3b', '#ffffff'].map((h) => new THREE.Color(h));
const PANTS = ['#22262c', '#2d3e5c', '#3a3a3a', '#1a1a1a', '#5c4a35', '#c9c0a8', '#3d4f2f', '#24324d'].map((h) => new THREE.Color(h));
const HAIR = ['#120d0a', '#1a1410', '#0b0b0b', '#2a1d14'].map((h) => new THREE.Color(h));
const DOEK = ['#c0262c', '#e0a21a', '#1f6fb5', '#2f8d4a', '#7a2f8f', '#e86a1a'].map((h) => new THREE.Color(h));
const CANOPY = ['#f4f4f2', '#c62a2a', '#1f56a8', '#2f8a4a', '#e8b51a', '#f4f4f2', '#1c1c1c'].map((h) => new THREE.Color(h));
const UMB = ['#d8282e', '#1f56a8', '#f0c31a', '#2f8a4a', '#ffffff'].map((h) => new THREE.Color(h));
const PRODUCE = ['#c4231d', '#e8781a', '#3f8f2a', '#7d5a32', '#f2d23a', '#6a2a6a', '#9cc23a', '#d9b48a'].map((h) => new THREE.Color(h));
const CLOTH = ['#1d1f22', '#f2f2f0', '#b8282b', '#1f4f9a', '#e8c12a', '#2f7d45', '#d9672b', '#7a2f8f', '#f4a6b8', '#5c4a35'].map((h) => new THREE.Color(h));
const PAINTS = ['#f2f2f0', '#c9ccd0', '#1d1f22', '#8c1d1d', '#1f3f7a', '#d8d2c0', '#5a6066', '#9a9ea3', '#2c5a3a', '#f2f2f0', '#e8e6df'].map((h) => new THREE.Color(h));
// Only the real (Sketchfab) car models park: the procedural boxes look wrong
// standing still up close. More models join this list as they arrive.
const PARK_TYPES = [
  ['gusheshe', 0.62],
  ['quantum', 0.38]
];

function hash(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function pick(arr, r) {
  return arr[Math.floor(r * arr.length) % arr.length];
}

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function at(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) geo.rotateX(rx).rotateY(ry).rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

function inst(geo, mat, n, colors = false) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (colors) {
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  m.count = 0;
  return m;
}

// ---- human body parts (pivots at joints so limbs swing) ---------------------
function bodyParts() {
  const torso = new THREE.CylinderGeometry(0.2, 0.15, 0.62, 8, 1);
  torso.scale(1, 1, 0.62);
  torso.translate(0, 0.31, 0); // pivot at hip
  const pelvis = new THREE.CylinderGeometry(0.155, 0.16, 0.16, 8, 1);
  pelvis.scale(1, 1, 0.65);
  const hips = mergeGeometries([at(pelvis, 0, -0.04, 0)]);
  const head = new THREE.SphereGeometry(0.112, 10, 8);
  head.scale(0.92, 1.12, 1.0);
  head.translate(0, 0.16, 0.0);
  const neck = new THREE.CylinderGeometry(0.05, 0.055, 0.1, 6);
  neck.translate(0, 0.03, 0);
  const headG = mergeGeometries([colored(head, '#ffffff'), colored(neck, '#ffffff')]);
  const hair = new THREE.SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  hair.scale(0.95, 0.9, 1.04);
  hair.translate(0, 0.19, -0.01);
  const leg = new THREE.CapsuleGeometry(0.072, 0.72, 3, 7);
  leg.translate(0, -0.43, 0); // pivot at hip
  const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.24);
  shoe.translate(0, -0.84, 0.05);
  const legG = mergeGeometries([colored(leg, '#ffffff'), colored(shoe, '#262626')]);
  const arm = new THREE.CapsuleGeometry(0.052, 0.52, 3, 6);
  arm.translate(0, -0.29, 0); // pivot at shoulder
  const sleeve = new THREE.CylinderGeometry(0.066, 0.06, 0.2, 6);
  sleeve.translate(0, -0.08, 0);
  const skirt = new THREE.CylinderGeometry(0.17, 0.27, 0.55, 9, 1, true);
  skirt.translate(0, -0.3, 0);
  return { torso, hips, head: headG, hair, leg: legG, arm, sleeve, skirt };
}

// ---- props -------------------------------------------------------------------
function gazeboFrame() {
  const parts = [];
  for (const [x, z] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]]) {
    parts.push(colored(at(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 5), x, 1.15, z), '#9aa0a6'));
  }
  return mergeGeometries(parts);
}
function gazeboTop() {
  const roof = new THREE.ConeGeometry(1.75, 0.55, 4, 1, true);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 2.55, 0);
  const valance = new THREE.CylinderGeometry(1.64, 1.64, 0.22, 4, 1, true);
  valance.rotateY(Math.PI / 4);
  valance.translate(0, 2.2, 0);
  const g = mergeGeometries([roof, valance]);
  return g;
}
function tableGeo() {
  const top = colored(at(new THREE.BoxGeometry(1.8, 0.06, 0.8), 0, 0.78, 0), '#c8b89a');
  const parts = [top];
  for (const [x, z] of [[-0.82, -0.32], [0.82, -0.32], [-0.82, 0.32], [0.82, 0.32]]) parts.push(colored(at(new THREE.BoxGeometry(0.04, 0.78, 0.04), x, 0.39, z), '#555'));
  // crates under and on the table
  parts.push(colored(at(new THREE.BoxGeometry(0.5, 0.3, 0.38), -0.55, 0.15, 0.1), '#8a6a42'));
  parts.push(colored(at(new THREE.BoxGeometry(0.5, 0.3, 0.38), 0.45, 0.15, -0.05), '#2f6db0'));
  return mergeGeometries(parts);
}
function produceGeo() {
  // a mound of fruit/veg: several lumps, tinted per instance
  const parts = [];
  const lumps = [[-0.6, 0], [-0.2, 0.05], [0.2, -0.04], [0.6, 0.02], [-0.4, -0.18], [0.4, 0.18], [0, 0.2], [0, -0.2]];
  for (let i = 0; i < lumps.length; i++) {
    const s = new THREE.SphereGeometry(0.16 + (i % 3) * 0.02, 7, 5);
    s.scale(1, 0.75, 1);
    parts.push(at(s, lumps[i][0], 0.88 + (i % 2) * 0.04, lumps[i][1]));
  }
  return mergeGeometries(parts);
}
function rackGeo() {
  const parts = [];
  parts.push(at(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 5), -0.75, 0.85, 0));
  parts.push(at(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 5), 0.75, 0.85, 0));
  parts.push(at(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 5), 0, 1.68, 0, 0, 0, Math.PI / 2));
  parts.push(at(new THREE.BoxGeometry(1.6, 0.03, 0.4), 0, 0.03, 0));
  return mergeGeometries(parts);
}
function garmentGeo() {
  const shirt = new THREE.BoxGeometry(0.42, 0.62, 0.05);
  shirt.translate(0, 1.33, 0);
  const sl = new THREE.BoxGeometry(0.62, 0.16, 0.05);
  sl.translate(0, 1.56, 0);
  return mergeGeometries([shirt, sl]);
}
function umbrellaPole() {
  return mergeGeometries([colored(at(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 5), 0, 1.1, 0), '#ddd'), colored(at(new THREE.CylinderGeometry(0.2, 0.25, 0.12, 8), 0, 0.06, 0), '#333')]);
}
function umbrellaTop() {
  const c = new THREE.ConeGeometry(1.35, 0.45, 10, 1, true);
  c.translate(0, 2.35, 0);
  return c;
}
function barberGeo() {
  // chair, mirror on a stand, small table with clippers and a speaker
  const p = [];
  p.push(colored(at(new THREE.BoxGeometry(0.5, 0.08, 0.5), 0, 0.48, 0), '#1c1c1c'));
  p.push(colored(at(new THREE.BoxGeometry(0.5, 0.6, 0.07), 0, 0.8, -0.24), '#1c1c1c'));
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) p.push(colored(at(new THREE.BoxGeometry(0.04, 0.46, 0.04), x, 0.23, z), '#888'));
  p.push(colored(at(new THREE.BoxGeometry(0.04, 1.6, 0.04), 0, 0.8, 1.05), '#777'));
  p.push(colored(at(new THREE.BoxGeometry(0.5, 0.65, 0.03), 0, 1.45, 1.05), '#bcd7e6'));
  p.push(colored(at(new THREE.BoxGeometry(0.45, 0.05, 0.35), 0.75, 0.7, 0.6), '#d0d0d0'));
  p.push(colored(at(new THREE.BoxGeometry(0.05, 0.7, 0.05), 0.75, 0.35, 0.6), '#666'));
  p.push(colored(at(new THREE.BoxGeometry(0.22, 0.32, 0.2), 0.8, 0.88, 0.6), '#151515'));
  return mergeGeometries(p);
}
function chairGeo() {
  const p = [];
  p.push(at(new THREE.BoxGeometry(0.44, 0.05, 0.42), 0, 0.44, 0));
  p.push(at(new THREE.BoxGeometry(0.44, 0.42, 0.05), 0, 0.68, -0.2, -0.12));
  for (const [x, z] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) p.push(at(new THREE.BoxGeometry(0.035, 0.44, 0.035), x, 0.22, z));
  return mergeGeometries(p);
}
function headLoadGeo() {
  // bundle carried on the head (basket / wrapped load)
  const b = new THREE.CylinderGeometry(0.24, 0.18, 0.22, 9);
  b.translate(0, 0, 0);
  return b;
}
function bottleGeo() {
  const b = new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6);
  const n = new THREE.CylinderGeometry(0.014, 0.03, 0.08, 6);
  n.translate(0, 0.14, 0);
  return mergeGeometries([b, n]);
}

// ---- real people: CC-BY figures baked into pose frames ----------------------
// scripts: work/bake/bake.html poses the rigged Sketchfab figures (walk cycle,
// standing, seated, arm up, arms forward) and bakes each pose to a static
// mesh with one texture atlas per figure (src/assets/people/). Each pose is an
// InstancedMesh, so the nearest people are real figures for a few draw calls.
const NEAR = 70;
const NEAR_R = 60;
let REAL = null;

export async function loadPeople(base = './src/assets/people/') {
  try {
    const meta = await (await fetch(base + 'people.json')).json();
    const buf = await (await fetch(base + 'people.bin')).arrayBuffer();
    const figs = [];
    for (const f of meta.figs) {
      const uv16 = new Uint16Array(buf, f.uvOff, f.nv * 2);
      const uvf = new Float32Array(f.nv * 2);
      for (let i = 0; i < uvf.length; i++) uvf[i] = uv16[i] / 65535;
      const uv = new THREE.BufferAttribute(uvf, 2);
      const idxArr = f.idx32 ? new Uint32Array(buf, f.idxOff, f.ni) : new Uint16Array(buf, f.idxOff, f.ni);
      const index = new THREE.BufferAttribute(idxArr, 1);
      const tex = await new THREE.TextureLoader().loadAsync(base + f.name + '.webp');
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
      const geos = {};
      f.frames.forEach((name, k) => {
        const p16 = new Int16Array(buf, f.frameOff[k], f.nv * 3);
        const pf = new Float32Array(p16.length);
        for (let i = 0; i < pf.length; i++) pf[i] = p16[i] / 1000;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pf, 3));
        g.setAttribute('uv', uv);
        g.setIndex(index);
        g.computeVertexNormals();
        geos[name] = g;
      });
      figs.push({ name: f.name, geos, mat, frames: f.frames });
    }
    REAL = figs;
  } catch (err) {
    console.warn('[IZK] real people not loaded', err);
  }
  return REAL;
}

export class StreetLife {
  constructor(roads, hf, buildings, rng) {
    this.roads = roads;
    this.hf = hf;
    this.buildings = buildings;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'streetLife';
    this.hour = 12;
    this.epoch = 1;
    this.parkMemo = new Map();

    const cbd0 = toXZ(CBD_LON[0], CBD_LAT[1]);
    const cbd1 = toXZ(CBD_LON[1], CBD_LAT[0]);
    this.cbd = [Math.min(cbd0[0], cbd1[0]), Math.min(cbd0[1], cbd1[1]), Math.max(cbd0[0], cbd1[0]), Math.max(cbd0[1], cbd1[1])];
    this.hubs = HUBS.map(([lon, lat, r, k]) => {
      const p = toXZ(lon, lat);
      return { x: p[0], z: p[1], r, k };
    });

    // per-road bounding boxes for fast range queries
    for (const r of roads.roads) {
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (const p of r.pts) {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < z0) z0 = p[1];
        if (p[1] > z1) z1 = p[1];
      }
      r.bb = [x0, z0, x1, z1];
    }
    this.#markParking();

    // ---- meshes ----
    const lam = (opts) => new THREE.MeshLambertMaterial(opts);
    const B = bodyParts();
    const P = (MAX_WALK + MAX_STAND);
    this.P = P;
    this.mTorso = inst(B.torso, lam({}), P, true);
    this.mHips = inst(B.hips, lam({}), P, true);
    this.mHead = inst(B.head, lam({ vertexColors: true }), P, true);
    this.mHair = inst(B.hair, lam({}), P, true);
    this.mLegL = inst(B.leg, lam({ vertexColors: true }), P, true);
    this.mLegR = inst(B.leg, lam({ vertexColors: true }), P, true);
    this.mArmL = inst(B.arm, lam({}), P, true);
    this.mArmR = inst(B.arm, lam({}), P, true);
    this.mSlvL = inst(B.sleeve, lam({}), P, true);
    this.mSlvR = inst(B.sleeve, lam({}), P, true);
    this.mSkirt = inst(B.skirt, lam({ side: THREE.DoubleSide }), P, true);
    this.mShadow = inst(blobGeometry(0.8, 0.8, 0.05), blobMaterial(), P + NEAR);
    this.people = [this.mTorso, this.mHips, this.mHead, this.mHair, this.mLegL, this.mLegR, this.mArmL, this.mArmR, this.mSlvL, this.mSlvR, this.mSkirt];

    this.mFrame = inst(gazeboFrame(), lam({ vertexColors: true }), MAX_STALL);
    this.mTop = inst(gazeboTop(), lam({ side: THREE.DoubleSide }), MAX_STALL + MAX_BARB, true);
    this.mFrame2 = inst(gazeboFrame(), lam({ vertexColors: true }), MAX_BARB);
    this.mTable = inst(tableGeo(), lam({ vertexColors: true }), MAX_STALL);
    this.mProduce = inst(produceGeo(), lam({}), MAX_STALL, true);
    this.mRack = inst(rackGeo(), lam({ color: 0x9a9ea3 }), MAX_RACK);
    this.mGarment = inst(garmentGeo(), lam({}), MAX_RACK * 5, true);
    this.mUmbPole = inst(umbrellaPole(), lam({ vertexColors: true }), MAX_UMB);
    this.mUmbTop = inst(umbrellaTop(), lam({ side: THREE.DoubleSide }), MAX_UMB, true);
    this.mBarber = inst(barberGeo(), lam({ vertexColors: true }), MAX_BARB);
    this.mChair = inst(chairGeo(), lam({}), MAX_STALL + MAX_BARB, true);
    this.mLoad = inst(headLoadGeo(), lam({}), MAX_HEAD, true);
    this.mBottle = inst(bottleGeo(), lam({ color: 0x5a3a12 }), MAX_HAND);
    this.mGlow = inst(new THREE.SphereGeometry(0.02, 4, 3), new THREE.MeshBasicMaterial({ color: 0xff6a1a, toneMapped: false }), MAX_HAND);
    const drum = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 10, 1, true);
    drum.translate(0, 0.44, 0);
    this.mDrum = inst(drum, lam({ color: 0x6b3a22, side: THREE.DoubleSide }), 24);
    const flame = new THREE.ConeGeometry(0.26, 0.55, 7);
    flame.translate(0, 1.12, 0);
    this.mFlame = inst(flame, new THREE.MeshBasicMaterial({ color: 0xff7a1a, toneMapped: false, transparent: true, opacity: 0.85 }), 24);
    this.group.add(this.mDrum, this.mFlame);
    this.props = [this.mFrame, this.mTop, this.mFrame2, this.mTable, this.mProduce, this.mRack, this.mGarment, this.mUmbPole, this.mUmbTop, this.mBarber, this.mChair, this.mLoad, this.mBottle, this.mGlow];
    for (const m of this.people) this.group.add(m);
    this.group.add(this.mShadow);
    // real figures (nearest people)
    this.real = [];
    if (REAL) {
      for (const f of REAL) {
        const byFrame = {};
        for (const name of f.frames) {
          const m = inst(f.geos[name], f.mat, NEAR);
          this.group.add(m);
          byFrame[name] = m;
        }
        this.real.push({ name: f.name, byFrame, counts: {} });
      }
    }
    for (const m of this.props) this.group.add(m);

    // parked cars: one instanced set per type, using the traffic models
    this.parkMeshes = new Map();
    for (const [id] of PARK_TYPES) {
      const model = trafficCarModel(id);
      const parts = [];
      if (model) {
        for (const part of model.parts) {
          const mesh = inst(part.geometry, part.material, MAX_PARK);
          if (part.paint) {
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARK * 3), 3);
            mesh.userData.paint = true;
          }
          parts.push(mesh);
        }
      } else {
        const proto = buildVehicleMesh(id);
        parts.push(inst(proto.geometry, proto.material, MAX_PARK));
      }
      for (const m of parts) this.group.add(m);
      this.parkMeshes.set(id, parts);
    }

    this.walkers = [];
    this.standers = [];
    this.stalls = [];
    this.parked = [];
    this.slots = [];
    this.cx = Infinity;
    this.cz = Infinity;
    this.t = 0;
    this.frame = 0;
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._one = new THREE.Vector3(1, 1, 1);
    this._Y = new THREE.Vector3(0, 1, 0);
  }

  // ---- zones -----------------------------------------------------------------
  intensity(x, z) {
    const c = this.cbd;
    let k = BASE;
    const dx = Math.max(c[0] - x, 0, x - c[2]);
    const dz = Math.max(c[1] - z, 0, z - c[3]);
    const d = Math.hypot(dx, dz);
    if (d < 350) k = Math.max(k, 1 - d / 350);
    for (const h of this.hubs) {
      const e = Math.hypot(x - h.x, z - h.z);
      if (e < h.r) k = Math.max(k, h.k * (1 - (e / h.r) * 0.7));
    }
    return k;
  }

  // CBD kerbside parking on multi-lane streets: the kerb lane becomes a
  // parking lane, so traffic keeps out of it (roads.lanesPerDir honours this).
  #markParking() {
    for (const r of this.roads.roads) {
      if (!PARK_CLS[r.cls] || r.bridge || r.len < 30) continue;
      const mx = (r.bb[0] + r.bb[2]) / 2;
      const mz = (r.bb[1] + r.bb[3]) / 2;
      const k = this.intensity(mx, mz);
      if (k < 0.5) continue;
      if (r.oneway && r.lanes >= 3) r.parking = r.lanes >= 4 ? 2 : 1;
      else if (!r.oneway && r.lanes >= 4) r.parking = 1;
    }
  }

  // ---- geometry along a road ---------------------------------------------------
  #pointAt(road, s) {
    const pts = road.pts;
    const cum = road.cum;
    let lo = 0;
    let hi = pts.length - 1;
    s = Math.max(0, Math.min(road.len, s));
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const seg = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / seg;
    const o = this._pt || (this._pt = { x: 0, z: 0, fx: 0, fz: 1 });
    o.x = a[0] + (b[0] - a[0]) * t;
    o.z = a[1] + (b[1] - a[1]) * t;
    o.fx = (b[0] - a[0]) / seg;
    o.fz = (b[1] - a[1]) / seg;
    return o;
  }

  // A 40 m stretch of pavement that is one long run of joined gazebos.
  #market(road, s, side, k) {
    if (k < 0.6 || !WALK_CLS[road.cls] || WALK_CLS[road.cls] < 0.9) return false;
    return hash(road.id2, Math.floor(s / 40), side + 101) < 0.22 * k;
  }

  #y(x, z) {
    return this.roads.surfaceHeightAt ? this.roads.surfaceHeightAt(x, z, null) : this.hf.heightAt(x, z);
  }

  #blocked(x, z, r) {
    if (this.hf.isWater(x, z)) return true;
    return this.buildings && this.buildings.blocked ? this.buildings.blocked(x, z, r) : false;
  }

  // ---- rebuild slots around the player ------------------------------------------
  #rebuild(px, pz) {
    this.cx = px;
    this.cz = pz;
    this.epoch++;
    const R = R_BUILD;
    const day = this.hour >= 6 && this.hour < 18.5;
    const evening = this.hour >= 17 || this.hour < 2;
    const stalls = [];
    const drums = [];
    const standers = [];
    const parked = [];
    const slots = [];
    const keepPark = new Map();
    for (const [key, v] of this.parkMemo) if (Math.hypot(v.x - px, v.z - pz) < 120) keepPark.set(key, v);

    for (const road of this.roads.roads) {
      const bb = road.bb;
      if (bb[0] > px + R || bb[2] < px - R || bb[1] > pz + R || bb[3] < pz - R) continue;
      if (road.bridge) continue;
      const wk = WALK_CLS[road.cls];
      const hw = road.width / 2;
      // parked cars
      if (road.parking) {
        const sides = road.oneway ? (road.parking === 2 ? [0, road.lanes - 1] : [0]) : [0];
        for (let s = 14; s < road.len - 14; s += 6.2) {
          const p = this.#pointAt(road, s);
          if (Math.hypot(p.x - px, p.z - pz) > R) continue;
          for (let dir = 1; dir >= (road.oneway ? 1 : -1); dir -= 2) {
            for (const li of sides) {
              const key = road.id2 * 4096 + Math.round(s / 6.2) * 4 + (dir > 0 ? 0 : 2) + (li ? 1 : 0);
              let car = keepPark.get(key);
              if (!car) {
                const r1 = this.rng();
                if (r1 < 0.22) continue; // a gap
                const off = this.roads.laneOffsetAt(road, li, true);
                const fx = p.fx * dir;
                const fz = p.fz * dir;
                const lat = off + Math.sign(off) * 0.35;
                const x = p.x + fz * lat;
                const z = p.z - fx * lat;
                let type = 'polo';
                let acc = 0;
                const r2 = this.rng();
                for (const [id, w] of PARK_TYPES) {
                  acc += w;
                  if (r2 <= acc) {
                    type = id;
                    break;
                  }
                }
                car = { key, x, z, fx, fz, y: this.#y(x, z), type, paint: pick(PAINTS, this.rng()), dx: 0, dz: 0, yaw: Math.atan2(fx, fz), alarm: 0 };
              }
              parked.push(car);
            }
          }
        }
      }
      if (!wk) continue;
      // market rows: gazebos joined edge to edge along a whole stretch
      if (wk >= 0.9) {
        for (let side = -1; side <= 1; side += 2) {
          for (let b0 = 0; b0 < road.len; b0 += 40) {
            const mid = this.#pointAt(road, Math.min(road.len, b0 + 20));
            if (Math.hypot(mid.x - px, mid.z - pz) > R) continue;
            const k = this.intensity(mid.x, mid.z);
            if (!this.#market(road, b0 + 1, side, k) || !day) continue;
            for (let s = Math.max(8, b0 + 2); s < Math.min(road.len - 8, b0 + 40); s += 2.45) {
              if (stalls.length >= MAX_STALL + MAX_RACK) break;
              const p = this.#pointAt(road, s);
              const lx = p.fz * side;
              const lz = -p.fx * side;
              const x = p.x + lx * (hw + 1.3);
              const z = p.z + lz * (hw + 1.3);
              if (this.#blocked(x + lx * 0.9, z + lz * 0.9, 0.5)) continue;
              const h = hash(road.id2, Math.round(s * 10), side + 55);
              stalls.push({ kind: h < 0.72 ? 'stall' : 'rack', joined: true, x, z, y: this.#y(x, z), yaw: Math.atan2(lx, lz), h: hash(road.id2, b0, side + 77) * 0.3 + h * 0.7, lx, lz, fx: p.fx, fz: p.fz, canopy: hash(road.id2, b0, side + 9) });
            }
          }
        }
      }
      // pavement slots every 5 m, both sides
      for (let s = 8; s < road.len - 8; s += 5) {
        const p = this.#pointAt(road, s);
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d > R) continue;
        const k = this.intensity(p.x, p.z) * wk;
        if (k < 0.05) continue;
        for (let side = -1; side <= 1; side += 2) {
          const lx = p.fz * side;
          const lz = -p.fx * side;
          const h = hash(road.id2, Math.round(s), side + 7);
          slots.push({ road, s, side, k });
          if (!day && !evening) continue;
          // fixed features (same spot every visit)
          const ox = hw + WALK_W - 0.35;
          if (day && k > 0.45 && h < 0.075 * k && stalls.length < MAX_STALL + MAX_UMB + MAX_RACK + MAX_BARB && !this.#market(road, s, side, k)) {
            const x = p.x + lx * (hw + 1.3);
            const z = p.z + lz * (hw + 1.3);
            if (this.#blocked(x + lx * 0.9, z + lz * 0.9, 0.6)) continue;
            // single sellers: own table, umbrella, rack, goods on a mat, or a barber
            const kind = h < 0.022 * k ? 'stall' : h < 0.034 * k ? 'mat' : h < 0.046 * k ? 'rack' : h < 0.06 * k ? 'umb' : 'barber';
            stalls.push({ kind, x, z, y: this.#y(x, z), yaw: Math.atan2(lx, lz), h, lx, lz, fx: p.fx, fz: p.fz });
            continue;
          }
          // groups: smokers, drinkers, corner chats
          const g = hash(road.id2, Math.round(s), side + 31);
          const groupP = (day ? 0.035 : 0.05) * k;
          if (g < groupP) {
            const x = p.x + lx * (hw + ox * 0 + WALK_W - 0.5);
            const z = p.z + lz * (hw + WALK_W - 0.5);
            if (this.#blocked(x, z, 0.4)) continue;
            const n = 2 + Math.floor(hash(road.id2, Math.round(s), 3) * (evening ? 4 : 3));
            const night = this.hour >= 19 || this.hour < 5;
            if (night && g < groupP * 0.45 && drums.length < 24) {
              // izinyoka / phara round a fire drum
              drums.push({ x, z, y: this.#y(x, z) });
              const m = 2 + Math.floor(hash(road.id2, Math.round(s), 4) * 3);
              for (let i = 0; i < m; i++) {
                const a = (i / m) * Math.PI * 2 + g * 5;
                const qx = x + Math.cos(a) * 0.95;
                const qz = z + Math.sin(a) * 0.95;
                const r = hash(road.id2, Math.round(s) + i, 13);
                const ph = this.#person(qx, qz, Math.atan2(x - qx, z - qz), i % 2 ? 'smoke' : 'phara', r);
                ph.ragged = true;
                standers.push(ph);
              }
              continue;
            }
            if (night && g < groupP * 0.7) {
              // night-shift security guard on a door
              const r = hash(road.id2, Math.round(s), 17);
              const gd = this.#person(x, z, Math.atan2(-lx, -lz), 'wait', r);
              gd.worker = true;
              standers.push(gd);
              continue;
            }
            const act = evening && g < groupP * 0.5 ? 'drink' : g < groupP * 0.35 ? 'smoke' : 'chat';
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + g * 9;
              const qx = x + Math.cos(a) * 0.62 + p.fx * (i - n / 2) * 0.15;
              const qz = z + Math.sin(a) * 0.62 + p.fz * (i - n / 2) * 0.15;
              const r = hash(road.id2, Math.round(s) + i, 11);
              standers.push(this.#person(qx, qz, Math.atan2(x - qx, z - qz), i === 0 && act === 'chat' ? 'smoke' : act, r));
            }
          }
        }
      }
    }

    // junction corners in busy areas: people waiting to cross
    for (const node of this.roads.nodes) {
      if (node.edges.length < 3) continue;
      if (Math.abs(node.x - px) > 160 || Math.abs(node.z - pz) > 160) continue;
      const k = this.intensity(node.x, node.z);
      if (k < 0.5 || (!day && !evening)) continue;
      const h = hash(node.id, 5, 5);
      if (h > 0.6 * k) continue;
      // corners: between consecutive arms, approx at 45° offsets
      for (let c = 0; c < 4; c++) {
        if (hash(node.id, c, 9) > 0.55 * k) continue;
        const a = (c + 0.5) * (Math.PI / 2) + h;
        const cx = node.x + Math.cos(a) * 9;
        const cz = node.z + Math.sin(a) * 9;
        if (this.#blocked(cx, cz, 0.5)) continue;
        const n = 3 + Math.floor(hash(node.id, c, 2) * 6);
        for (let i = 0; i < n; i++) {
          const r = hash(node.id, c * 16 + i, 4);
          const qx = cx + (r - 0.5) * 2.4;
          const qz = cz + (hash(node.id, c * 16 + i, 6) - 0.5) * 2.4;
          if (this.#blocked(qx, qz, 0.25)) continue;
          standers.push(this.#person(qx, qz, Math.atan2(node.x - qx, node.z - qz), r < 0.15 ? 'phone' : 'wait', r));
        }
      }
    }

    // people at the stalls (vendors, customers, barbers and clients)
    for (const st of stalls) {
      const r = st.h * 97 % 1;
      const back = 0.75;
      const vx = st.x + st.lx * back;
      const vz = st.z + st.lz * back;
      if (st.kind === 'barber') {
        standers.push(this.#person(st.x - st.lx * 0.05, st.z - st.lz * 0.05, st.yaw + Math.PI, 'seated', r, st.y + 0.0));
        standers.push(this.#person(st.x + st.lx * 0.55, st.z + st.lz * 0.55, st.yaw + Math.PI, 'cut', (r * 7) % 1));
        if (r < 0.6) standers.push(this.#person(st.x + st.fx * 1.4, st.z + st.fz * 1.4, st.yaw + 2.2, 'seated', (r * 13) % 1, st.y, true));
      } else if (st.kind === 'mat') {
        standers.push(this.#person(vx + st.lx * 0.2, vz + st.lz * 0.2, st.yaw + Math.PI, 'seated', r, st.y - 0.12, false));
      } else {
        if (st.joined && r > 0.8) continue; // a few stalls are minded by the neighbour
        standers.push(this.#person(vx, vz, st.yaw + Math.PI, r < 0.3 ? 'seated' : 'sell', r, st.y, r < 0.3));
        const nc = Math.floor(r * 3);
        for (let i = 0; i < nc; i++) {
          const o = (i - 0.5) * 0.8;
          standers.push(this.#person(st.x - st.lx * 0.9 + st.fx * o, st.z - st.lz * 0.9 + st.fz * o, st.yaw, 'browse', (r * (11 + i)) % 1));
        }
      }
    }

    this.stalls = stalls;
    this.drums = drums;
    standers.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    this.standers = standers.slice(0, MAX_STAND);
    parked.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    this.parked = parked.slice(0, MAX_PARK);
    this.parkMemo = new Map();
    for (const c of this.parked) this.parkMemo.set(c.key, c);
    this.slots = slots;
    // drop walkers that are far, the rest keep walking
    this.walkers = this.walkers.filter((w) => Math.hypot(w.x - px, w.z - pz) < R);
    this.#writeStatic();
  }

  #person(x, z, yaw, act, r, y = null, chair = false) {
    const female = r < 0.48;
    const skirt = female && (r * 31) % 1 < 0.45;
    return {
      x,
      z,
      y: y === null ? this.#y(x, z) : y,
      yaw,
      act,
      chair,
      phase: r * 50,
      scale: (female ? 0.93 : 1.0) + ((r * 17) % 1) * 0.08,
      skin: pick(SKIN, (r * 7.3) % 1),
      shirt: pick(SHIRT, (r * 13.7) % 1),
      pants: pick(PANTS, (r * 19.1) % 1),
      hair: female && (r * 5.3) % 1 < 0.4 ? pick(DOEK, (r * 3.1) % 1) : pick(HAIR, (r * 2.9) % 1),
      doek: female && (r * 5.3) % 1 < 0.4,
      female,
      skirt,
      long: (r * 23) % 1 < 0.35,
      load: female && act === 'walk' && (r * 41) % 1 < 0.18,
      bag: (r * 29) % 1
    };
  }

  // ---- walkers ---------------------------------------------------------------
  #spawnWalker(px, pz) {
    const slots = this.slots;
    if (!slots.length) return null;
    for (let tries = 0; tries < 8; tries++) {
      const sl = slots[Math.floor(this.rng() * slots.length)];
      if (this.rng() > sl.k) continue;
      const p = this.#pointAt(sl.road, sl.s);
      const dp = Math.hypot(p.x - px, p.z - pz);
      if (dp < 25 && this.rng() < 0.7) continue;
      if (dp > 140 && this.rng() < 0.6) continue;
      const r = this.rng();
      const w = this.#person(p.x, p.z, 0, 'walk', r);
      w.road = sl.road;
      w.s = sl.s;
      w.side = sl.side;
      w.dir = this.rng() < 0.5 ? 1 : -1;
      w.off = sl.road.width / 2 + 0.45 + this.rng() * (WALK_W - 0.9);
      w.speed = 1.0 + this.rng() * 0.6;
      if (this.hour >= 19 || this.hour < 5) {
        // night: shift workers heading to/from work, and phara drifting slowly
        if (this.rng() < 0.45) w.worker = true;
        else {
          w.ragged = true;
          w.speed = 0.55 + this.rng() * 0.3;
        }
      }
      w.yt = 0;
      w.flee = 0;
      return w;
    }
    return null;
  }

  #nextRoad(w) {
    const road = w.road;
    const end = w.dir > 0 ? road.pts[road.pts.length - 1] : road.pts[0];
    const node = this.roads.nodeByPos(end[0], end[1]);
    if (node && node.edges.length > 1) {
      for (let t = 0; t < 4; t++) {
        const e = this.roads.edges[node.edges[Math.floor(this.rng() * node.edges.length)]];
        if (!e || e.road === road || !WALK_CLS[e.road.cls] || e.road.bridge) continue;
        const nr = e.road;
        const atStart = Math.hypot(nr.pts[0][0] - end[0], nr.pts[0][1] - end[1]) < Math.hypot(nr.pts[nr.pts.length - 1][0] - end[0], nr.pts[nr.pts.length - 1][1] - end[1]);
        w.road = nr;
        w.dir = atStart ? 1 : -1;
        w.s = atStart ? 0.5 : nr.len - 0.5;
        w.off = nr.width / 2 + 0.45 + this.rng() * (WALK_W - 0.9);
        if (this.rng() < 0.5) w.side = -w.side;
        return;
      }
    }
    w.dir = -w.dir; // dead end: turn round
  }

  // How packed the streets should be here right now (0..1): CBD by day is full.
  busyAt(x, z, hour) {
    const k = this.intensity(x, z);
    const dayK = hour >= 6.5 && hour < 18 ? 1 : hour >= 5.5 && hour < 20 ? 0.5 : 0.1;
    return Math.min(1, k * dayK);
  }

  // ---- per-frame ---------------------------------------------------------------
  update(dt, px, pz, hour, player = null, onCrash = null) {
    this.hour = hour;
    this.px = px;
    this.pz = pz;
    this.t += dt;
    this.frame++;
    const phase = hour >= 19 || hour < 5 ? 2 : hour >= 18.5 || hour < 6 ? 1 : 0;
    if (phase !== this.dayPhase) {
      this.dayPhase = phase;
      this.cx = Infinity;
    }
    if (Math.hypot(px - this.cx, pz - this.cz) > R_MOVE) this.#rebuild(px, pz);
    const k = this.intensity(px, pz);
    const day = hour >= 6 && hour < 19;
    const nightK = day ? 1 : hour >= 19 && hour < 23 ? 0.45 : 0.15;
    const target = Math.min(MAX_WALK, Math.round(MAX_WALK * Math.min(1, k * 1.1) * nightK) + 10);
    // spawn a few per frame toward the target
    for (let n = 0; n < 40 && this.walkers.length < target; n++) {
      const w = this.#spawnWalker(px, pz);
      if (w) this.walkers.push(w);
      else break;
    }
    if (this.walkers.length > target + 20) this.walkers.length = target;

    const P = player;
    const pv = P ? Math.abs(P.speed || 0) : 0;
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      w.s += w.dir * w.speed * dt * (w.flee > 0 ? 2.6 : 1);
      if (w.s < 0 || w.s > w.road.len) this.#nextRoad(w);
      const p = this.#pointAt(w.road, w.s);
      const fx = p.fx * w.dir;
      const fz = p.fz * w.dir;
      const lx = p.fz * w.side;
      const lz = -p.fx * w.side;
      let off = w.off;
      if (w.flee > 0) w.flee -= dt;
      w.x = p.x + lx * off;
      w.z = p.z + lz * off;
      // dive out of the way of a car on the pavement
      if (P && pv > 2) {
        const dx = w.x - P.x;
        const dz = w.z - P.z;
        if (dx * dx + dz * dz < 16) {
          w.off = Math.min(w.road.width / 2 + WALK_W + 1.2, w.off + 1.4);
          w.flee = 1.2;
        }
      }
      w.yaw = Math.atan2(fx, fz);
      if (((this.frame + i) & 15) === 0 || w.yt === 0) {
        w.y = this.#y(w.x, w.z);
        w.yt = 1;
      }
      w.phase += w.speed * dt * (w.flee > 0 ? 9 : 5.2);
      if (Math.hypot(w.x - px, w.z - pz) > R_BUILD + 20) this.walkers.splice(i, 1);
    }

    this.#collideParked(P, onCrash);
    this.#writePeople();
    // cigarette glow follows the night
    this.mGlow.visible = WORLD.night ? WORLD.night.value > 0.2 : false;
    this.mFlame.material.opacity = 0.65 + Math.sin(this.t * 17) * 0.12 + Math.sin(this.t * 31) * 0.08;
  }

  // ---- parked car collisions (player) -------------------------------------------
  #collideParked(P, onCrash) {
    if (!P) return;
    const fx = Math.sin(P.yaw);
    const fz = Math.cos(P.yaw);
    let moved = false;
    for (const c of this.parked) {
      const ox = c.x + c.dx;
      const oz = c.z + c.dz;
      if (Math.abs(ox - P.x) > 6 || Math.abs(oz - P.z) > 6) continue;
      // three circles along the player car against the parked car's box
      for (let k = -1; k <= 1; k++) {
        const qx = P.x + fx * k * 1.5;
        const qz = P.z + fz * k * 1.5;
        const rx = qx - ox;
        const rz = qz - oz;
        const along = rx * c.fx + rz * c.fz;
        const across = rx * c.fz - rz * c.fx;
        const ha = 2.2;
        const hc = 0.9;
        const r = 0.95;
        const ca = Math.max(-ha, Math.min(ha, along));
        const cc = Math.max(-hc, Math.min(hc, across));
        const dA = along - ca;
        const dC = across - cc;
        const d = Math.hypot(dA, dC);
        if (d >= r) continue;
        let nx;
        let nz;
        let pen;
        if (d > 1e-4) {
          nx = (dA * c.fx + dC * c.fz) / d;
          nz = (dA * c.fz - dC * c.fx) / d;
          pen = r - d;
        } else {
          const sx = ha - Math.abs(along);
          const sc = hc - Math.abs(across);
          if (sc < sx) {
            const sg = Math.sign(across) || 1;
            nx = c.fz * sg;
            nz = -c.fx * sg;
            pen = sc + r;
          } else {
            const sg = Math.sign(along) || 1;
            nx = c.fx * sg;
            nz = c.fz * sg;
            pen = sx + r;
          }
        }
        P.x += nx * pen;
        P.z += nz * pen;
        const vn = (fx * nx + fz * nz) * (P.speed || 0);
        if (vn < -0.5) {
          const impact = -vn;
          P.speed *= 0.35;
          if (P.speed > 0 && fx * nx + fz * nz < -0.7) P.speed = -impact * 0.15;
          c.dx -= nx * Math.min(0.6, impact * 0.04);
          c.dz -= nz * Math.min(0.6, impact * 0.04);
          if (impact > 1.5) {
            crashSound(Math.min(1, impact / 18), 0);
            c.alarm = 6;
            if (onCrash) onCrash(impact, c);
          }
          moved = true;
        }
        break;
      }
    }
    // car alarms
    for (const c of this.parked) {
      if (c.alarm > 0) {
        const prev = c.alarm;
        c.alarm -= 1 / 60;
        if (Math.floor(prev * 2) !== Math.floor(c.alarm * 2)) honkFar(Math.hypot(c.x - P.x, c.z - P.z) + 2, 1.25, false);
      }
    }
    if (moved) this.#writeParked();
  }

  // ---- writing instances ---------------------------------------------------------
  #writeStatic() {
    const m = this._m;
    const q = this._q;
    const p = this._p;
    const one = this._one;
    let nStall = 0;
    let nTop = 0;
    let nF2 = 0;
    let nRack = 0;
    let nG = 0;
    let nU = 0;
    let nB = 0;
    let nC = 0;
    for (const st of this.stalls) {
      q.setFromAxisAngle(this._Y, st.yaw);
      p.set(st.x, st.y, st.z);
      m.compose(p, q, one);
      const r = st.h * 131 % 1;
      if (st.kind === 'stall' && nStall < MAX_STALL) {
        this.mFrame.setMatrixAt(nStall, m);
        this.mTable.setMatrixAt(nStall, m);
        this.mProduce.setMatrixAt(nStall, m);
        this.mProduce.setColorAt(nStall, pick(PRODUCE, r));
        nStall++;
        this.mTop.setMatrixAt(nTop, m);
        this.mTop.setColorAt(nTop++, pick(CANOPY, st.joined ? (st.canopy + (st.h < 0.2 ? 0.5 : 0)) % 1 : (r * 7) % 1));
      } else if (st.kind === 'mat' && nStall < MAX_STALL) {
        // goods laid out on a cloth on the pavement
        this._s.set(0.9, 0.22, 1.1);
        m.compose(p, q, this._s);
        this.mTable.setMatrixAt(nStall, m);
        this.mProduce.setMatrixAt(nStall, m);
        this.mProduce.setColorAt(nStall, pick(PRODUCE, (r * 3) % 1));
        this._s.set(0, 0, 0);
        m.compose(p, q, this._s);
        this.mFrame.setMatrixAt(nStall, m);
        this._s.set(1, 1, 1);
        nStall++;
      } else if (st.kind === 'rack' && st.joined && nRack < MAX_RACK && nStall < MAX_STALL) {
        this.mFrame.setMatrixAt(nStall, m);
        this._s.set(0, 0, 0);
        m.compose(p, q, this._s);
        this.mTable.setMatrixAt(nStall, m);
        this.mProduce.setMatrixAt(nStall, m);
        this._s.set(1, 1, 1);
        nStall++;
        q.setFromAxisAngle(this._Y, st.yaw);
        m.compose(p, q, one);
        this.mTop.setMatrixAt(nTop, m);
        this.mTop.setColorAt(nTop++, pick(CANOPY, (st.canopy + (st.h < 0.2 ? 0.5 : 0)) % 1));
        q.setFromAxisAngle(this._Y, st.yaw + Math.PI / 2);
        m.compose(p, q, one);
        this.mRack.setMatrixAt(nRack++, m);
        for (let g = 0; g < 5; g++) {
          this._p.set(st.x + st.fx * (g - 2) * 0.3, st.y, st.z + st.fz * (g - 2) * 0.3);
          m.compose(this._p, q, one);
          this.mGarment.setMatrixAt(nG, m);
          this.mGarment.setColorAt(nG++, pick(CLOTH, (r * (g + 3) * 5.7) % 1));
        }
      } else if (st.kind === 'rack' && nRack < MAX_RACK) {
        // rack along the pavement, under an umbrella
        q.setFromAxisAngle(this._Y, st.yaw + Math.PI / 2);
        m.compose(p, q, one);
        this.mRack.setMatrixAt(nRack++, m);
        for (let g = 0; g < 5; g++) {
          this._p.set(st.x + st.fx * (g - 2) * 0.3, st.y, st.z + st.fz * (g - 2) * 0.3);
          m.compose(this._p, q, one);
          this.mGarment.setMatrixAt(nG, m);
          this.mGarment.setColorAt(nG++, pick(CLOTH, (r * (g + 3) * 5.7) % 1));
        }
        if (nU < MAX_UMB) {
          this._p.set(st.x + st.lx * 0.5, st.y, st.z + st.lz * 0.5);
          m.compose(this._p, q, one);
          this.mUmbPole.setMatrixAt(nU, m);
          this.mUmbTop.setMatrixAt(nU, m);
          this.mUmbTop.setColorAt(nU++, pick(UMB, (r * 3) % 1));
        }
      } else if (st.kind === 'umb' && nU < MAX_UMB) {
        this.mUmbPole.setMatrixAt(nU, m);
        this.mUmbTop.setMatrixAt(nU, m);
        this.mUmbTop.setColorAt(nU++, pick(UMB, r));
        // a small table of goods under the umbrella (sweets, airtime, fruit)
        if (nStall < MAX_STALL) {
          this._p.set(st.x - st.lx * 0.3, st.y, st.z - st.lz * 0.3);
          this._s.set(0.5, 1, 0.7);
          m.compose(this._p, q, this._s);
          this.mTable.setMatrixAt(nStall, m);
          this.mProduce.setMatrixAt(nStall, m);
          this.mProduce.setColorAt(nStall, pick(PRODUCE, (r * 5) % 1));
          // no frame for this one: park the frame instance out of sight
          this._s.set(0, 0, 0);
          m.compose(this._p, q, this._s);
          this.mFrame.setMatrixAt(nStall, m);
          this._s.set(1, 1, 1);
          nStall++;
        }
      } else if (st.kind === 'barber' && nB < MAX_BARB) {
        q.setFromAxisAngle(this._Y, st.yaw + Math.PI);
        m.compose(p, q, one);
        this.mBarber.setMatrixAt(nB, m);
        q.setFromAxisAngle(this._Y, st.yaw);
        m.compose(p, q, one);
        this.mFrame2.setMatrixAt(nF2++, m);
        this.mTop.setMatrixAt(nTop, m);
        this.mTop.setColorAt(nTop++, pick(CANOPY, (r * 11) % 1));
        nB++;
      }
    }
    // chairs for seated people
    for (const s of this.standers) {
      if (s.act !== 'seated' || !s.chair || nC >= MAX_STALL + MAX_BARB) continue;
      q.setFromAxisAngle(this._Y, s.yaw);
      p.set(s.x, s.y, s.z);
      m.compose(p, q, one);
      this.mChair.setMatrixAt(nC, m);
      this.mChair.setColorAt(nC++, (s.phase | 0) % 2 ? new THREE.Color('#e8e8e4') : new THREE.Color('#c0262c'));
    }
    const set = (mesh, n) => {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    set(this.mFrame, nStall);
    set(this.mTable, nStall);
    set(this.mProduce, nStall);
    set(this.mTop, nTop);
    set(this.mFrame2, nF2);
    set(this.mRack, nRack);
    set(this.mGarment, nG);
    set(this.mUmbPole, nU);
    set(this.mUmbTop, nU);
    set(this.mBarber, nB);
    set(this.mChair, nC);
    let nD = 0;
    for (const d of this.drums || []) {
      q.identity();
      p.set(d.x, d.y, d.z);
      m.compose(p, q, one);
      this.mDrum.setMatrixAt(nD, m);
      this.mFlame.setMatrixAt(nD++, m);
    }
    set(this.mDrum, nD);
    set(this.mFlame, nD);
    this.#writeParked();
  }

  #writeParked() {
    const counts = new Map();
    for (const [id] of PARK_TYPES) counts.set(id, 0);
    const m = this._m;
    const q = this._q;
    for (const c of this.parked) {
      const parts = this.parkMeshes.get(c.type);
      if (!parts) continue;
      const i = counts.get(c.type);
      q.setFromAxisAngle(this._Y, c.yaw);
      this._p.set(c.x + c.dx, c.y, c.z + c.dz);
      m.compose(this._p, q, this._one);
      for (const mesh of parts) {
        mesh.setMatrixAt(i, m);
        if (mesh.userData.paint) mesh.setColorAt(i, c.paint);
      }
      counts.set(c.type, i + 1);
    }
    for (const [id, parts] of this.parkMeshes) {
      for (const mesh of parts) {
        mesh.count = counts.get(id) || 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  #writePeople() {
    let n = 0;
    let nLoad = 0;
    let nBot = 0;
    let nGlow = 0;
    const t = this.t;
    const day = this.hour >= 6 && this.hour < 18.5;
    const all = this.walkers;
    const real = this.real;
    let nReal = 0;
    if (real.length) for (const f of real) for (const k in f.byFrame) f.counts[k] = 0;
    const cx = this.px === undefined ? 0 : this.px;
    const cz = this.pz === undefined ? 0 : this.pz;
    const writeReal = (h) => {
      // pick figure (stable per person) and pose frame
      let fi;
      const r = (h.phase * 0.618) % 1;
      if (h.worker) fi = 3;
      else if (h.female) fi = r < 0.5 ? 0 : 2;
      else fi = r < 0.78 ? 1 : 3;
      fi = Math.min(fi, real.length - 1);
      const f = real[fi];
      let frame = 'stand';
      switch (h.act) {
        case 'walk': {
          const c = ((h.phase / (Math.PI * 2)) % 1 + 1) % 1;
          frame = 'walk' + Math.floor(c * 6);
          break;
        }
        case 'seated':
          frame = 'seated';
          break;
        case 'smoke':
          frame = (t * 0.35 + h.phase) % 1 < 0.25 ? 'armup' : 'stand';
          break;
        case 'drink':
          frame = (t * 0.25 + h.phase) % 1 < 0.2 ? 'armup' : 'stand2';
          break;
        case 'phone':
          frame = 'armup';
          break;
        case 'phara':
          frame = 'stand2';
          break;
        case 'cut':
          frame = 'cut';
          break;
        case 'sell':
          frame = Math.sin(t * 0.9 + h.phase) > 0.7 ? 'cut' : 'stand';
          break;
        default:
          frame = r < 0.5 ? 'stand' : 'stand2';
      }
      const mesh = f.byFrame[frame] || f.byFrame.stand;
      const i = f.counts[frame] || 0;
      if (i >= NEAR) return false;
      const sc = h.scale * 0.97;
      this._q.setFromAxisAngle(this._Y, h.yaw);
      this._s.set((h.phase * 7.7) % 1 < 0.5 ? -sc : sc, sc, sc);
      this._p.set(h.x, h.y, h.z);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(i, this._m);
      f.counts[frame] = i + 1;
      if (h.load && nLoad < MAX_HEAD) {
        this._s.set(sc, sc, sc);
        this._p.set(h.x, h.y + 1.86 * sc, h.z);
        this._m.compose(this._p, this._q, this._s);
        this.mLoad.setMatrixAt(nLoad, this._m);
        this.mLoad.setColorAt(nLoad++, h.hair);
      }
      return true;
    };
    let nSh = 0;
    const write = (h) => {
      if (nSh < this.mShadow.instanceMatrix.count && h.y != null) {
        this._p.set(h.x, h.y, h.z);
        this._m2.compose(this._p, this._q2.identity(), this._one);
        this.mShadow.setMatrixAt(nSh++, this._m2);
      }
      if (real.length && nReal < NEAR && Math.abs(h.x - cx) < NEAR_R && Math.abs(h.z - cz) < NEAR_R && writeReal(h)) {
        nReal++;
        return;
      }
      if (n >= this.P) return;
      let swing = 0;
      let armL = 0;
      let armR = 0;
      let armLz = 0.06;
      let armRz = -0.06;
      let legL = 0;
      let legR = 0;
      let hipY = 0.93;
      let lean = 0;
      let bob = 0;
      const ph = h.phase;
      switch (h.act) {
        case 'walk':
          swing = Math.sin(ph);
          legL = swing * 0.45;
          legR = -swing * 0.45;
          armL = -swing * 0.38;
          armR = swing * 0.38;
          bob = Math.abs(Math.cos(ph)) * 0.035;
          lean = 0.05;
          if (h.load) {
            armR = -2.9; // hand up, steadying the load
            armRz = -0.25;
          } else if (h.bag > 0.75) armL = 0.05;
          break;
        case 'seated':
          hipY = 0.5;
          legL = -1.45;
          legR = -1.4;
          armL = -0.5;
          armR = -0.5;
          break;
        case 'smoke': {
          const cyc = (t * 0.35 + ph) % 1;
          armR = cyc < 0.25 ? -2.3 : -0.5;
          armRz = -0.35;
          legL = 0.05;
          break;
        }
        case 'drink': {
          const cyc = (t * 0.25 + ph) % 1;
          armR = cyc < 0.2 ? -2.6 : -0.8;
          armRz = -0.25;
          lean = cyc < 0.2 ? -0.08 : 0;
          break;
        }
        case 'cut':
          armL = -1.2 + Math.sin(t * 2 + ph) * 0.1;
          armR = -1.35 + Math.sin(t * 7 + ph) * 0.15;
          armLz = 0.3;
          armRz = -0.3;
          lean = 0.18;
          break;
        case 'sell':
          armR = Math.sin(t * 0.9 + ph) > 0.7 ? -1.4 : -0.1;
          armL = -0.2;
          break;
        case 'browse':
          lean = 0.12;
          armR = -0.7;
          break;
        case 'phara':
          lean = 0.3;
          armL = -0.6;
          armR = -0.6;
          break;
        case 'phone':
          armR = -2.5;
          armRz = -0.45;
          lean = 0.04;
          break;
        default:
          armL = Math.sin(t * 0.7 + ph) * 0.05;
          armR = -armL;
          bob = Math.sin(t * 1.3 + ph) * 0.005;
      }
      const sc = h.scale;
      const cy = Math.cos(h.yaw);
      const sy = Math.sin(h.yaw);
      // body frame
      const q = this._q;
      this._e.set(lean, h.yaw, 0, 'YXZ');
      q.setFromEuler(this._e);
      const hy = h.y + (hipY + bob) * sc;
      this._s.set(sc, sc, sc);
      this._p.set(h.x, hy, h.z);
      this._m.compose(this._p, q, this._s);
      const torso = this._m;
      this.mTorso.setMatrixAt(n, torso);
      this.mTorso.setColorAt(n, h.shirt);
      this.mHips.setMatrixAt(n, torso);
      this.mHips.setColorAt(n, h.skirt ? h.shirt : h.pants);
      // head: above torso (0.66 m up the leaning torso)
      const up = 0.66 * sc;
      const hx = h.x + sy * Math.sin(lean) * up;
      const hz = h.z + cy * Math.sin(lean) * up;
      this._p.set(hx, hy + Math.cos(lean) * up, hz);
      this._m2.compose(this._p, q, this._s);
      this.mHead.setMatrixAt(n, this._m2);
      this.mHead.setColorAt(n, h.skin);
      this.mHair.setMatrixAt(n, this._m2);
      this.mHair.setColorAt(n, h.hair);
      if (h.load && nLoad < MAX_HEAD) {
        this._p.set(hx, hy + Math.cos(lean) * up + 0.36 * sc, hz);
        this._m2.compose(this._p, q, this._s);
        this.mLoad.setMatrixAt(nLoad, this._m2);
        this.mLoad.setColorAt(nLoad++, h.hair);
      }
      // legs from the hips
      const leg = (mesh, side, ang) => {
        this._e.set(ang, h.yaw, 0, 'YXZ');
        this._q2.setFromEuler(this._e);
        this._p.set(h.x + cy * side * 0.085 * sc, hy - 0.04 * sc, h.z - sy * side * 0.085 * sc);
        this._m2.compose(this._p, this._q2, this._s);
        mesh.setMatrixAt(n, this._m2);
        mesh.setColorAt(n, h.skirt ? h.skin : h.pants);
      };
      leg(this.mLegL, 1, legL);
      leg(this.mLegR, -1, legR);
      if (h.skirt) {
        this.mSkirt.setMatrixAt(n, torso);
        this.mSkirt.setColorAt(n, h.pants === PANTS[5] ? h.shirt : pick(CLOTH, (h.phase * 0.37) % 1));
      } else {
        this._s.set(0, 0, 0);
        this._m2.compose(this._p, q, this._s);
        this.mSkirt.setMatrixAt(n, this._m2);
        this._s.set(sc, sc, sc);
      }
      // arms from the shoulders
      const sh = 0.6 * sc;
      const arm = (mesh, slv, side, ang, roll) => {
        this._e.set(ang + lean, h.yaw, roll * side, 'YXZ');
        this._q2.setFromEuler(this._e);
        this._p.set(h.x + cy * side * 0.235 * sc + sy * Math.sin(lean) * sh, hy + Math.cos(lean) * sh, h.z - sy * side * 0.235 * sc + cy * Math.sin(lean) * sh);
        this._m2.compose(this._p, this._q2, this._s);
        mesh.setMatrixAt(n, this._m2);
        mesh.setColorAt(n, h.long ? h.shirt : h.skin);
        slv.setMatrixAt(n, this._m2);
        slv.setColorAt(n, h.shirt);
        return this._m2;
      };
      arm(this.mArmL, this.mSlvL, 1, armL, armLz);
      const hand = arm(this.mArmR, this.mSlvR, -1, armR, -armRz);
      if ((h.act === 'drink' || h.act === 'smoke') && nBot < MAX_HAND) {
        // object in the right hand: hand is ~0.58 m down the arm
        this._p.set(0, -0.6, 0.02).applyMatrix4(hand);
        if (h.act === 'drink') {
          this._m2.compose(this._p, this._q2, this._one);
          this.mBottle.setMatrixAt(nBot++, this._m2);
        } else if (nGlow < MAX_HAND) {
          this._m2.compose(this._p, this._q2, this._one);
          this.mGlow.setMatrixAt(nGlow++, this._m2);
        }
      }
      n++;
    };
    for (const h of this.standers) {
      if (!day && (h.act === 'sell' || h.act === 'browse' || h.act === 'cut' || (h.act === 'seated' && h.chair))) continue;
      write(h);
    }
    for (const w of all) write(w);
    for (const f of real) {
      for (const k in f.byFrame) {
        const m = f.byFrame[k];
        m.count = f.counts[k] || 0;
        m.visible = m.count > 0;
        if (m.count) m.instanceMatrix.needsUpdate = true;
      }
    }
    this.mShadow.count = nSh;
    this.mShadow.instanceMatrix.needsUpdate = true;
    for (const mesh of this.people) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.mLoad.count = nLoad;
    this.mLoad.instanceMatrix.needsUpdate = true;
    if (this.mLoad.instanceColor) this.mLoad.instanceColor.needsUpdate = true;
    this.mBottle.count = nBot;
    this.mBottle.instanceMatrix.needsUpdate = true;
    this.mGlow.count = nGlow;
    this.mGlow.instanceMatrix.needsUpdate = true;
    // stalls pack up at night
    const showStalls = day;
    for (const mm of [this.mFrame, this.mTable, this.mProduce, this.mRack, this.mGarment, this.mUmbPole, this.mUmbTop, this.mBarber, this.mFrame2, this.mTop, this.mChair]) mm.visible = showStalls;
  }
}
