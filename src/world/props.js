import * as THREE from '../../vendor/three/three.module.js';
import { loadKitModel } from './kitModels.js';
import { CHUNK, KERB_H, WALK_W, specFor } from './roads.js';
import { mulberry32 } from '../core/utils.js';
import { WORLD } from './worldLight.js';
import { glowTexture } from '../game/carLights.js';

// Streams instanced props around the camera, generated per 400 m road chunk
// from real data: trees in OSM parks/woods, garden trees beside houses,
// tree-lined suburban streets, palms on the beachfront, Kenney street lights
// along main roads (glowing at night with light pools on the road), SA
// traffic lights ("robots") at OSM signals, STOP / YIELD signs and zebra
// crossings. Each prop type is ONE InstancedMesh refilled when the camera
// moves, so draw calls stay flat no matter how much of Durban is loaded.
// NOTE: loops only (no spread of big arrays).

const GEN_RADIUS = 900; // generate chunks within this distance
const DROP_RADIUS = 1300; // forget generated chunks beyond this
const REFILL_MOVE = 35; // m of camera travel between instance refills

const NATURE = './src/assets/naturekit/';
const ROADKIT = './src/assets/roadkit/';

// type -> model file, max instances, draw radius
const TYPES = {
  oak: { file: NATURE + 'tree_oak.glb', h: 1, max: 900, radius: 700 },
  oakDark: { file: NATURE + 'tree_oak_dark.glb', h: 1, max: 900, radius: 700 },
  fat: { file: NATURE + 'tree_default.glb', h: 1, max: 900, radius: 700, leaf: '#58893a' },
  detailed: { file: NATURE + 'tree_detailed_dark.glb', h: 1, max: 600, radius: 650 },
  plateau: { file: NATURE + 'tree_plateau.glb', h: 1, max: 700, radius: 700, leaf: '#5d7f2e' },
  tall: { file: NATURE + 'tree_tall_dark.glb', h: 1, max: 500, radius: 600 },
  palm: { file: NATURE + 'tree_palmTall.glb', h: 1, max: 500, radius: 800, leaf: '#5f8f34' },
  palmBend: { file: NATURE + 'tree_palmBend.glb', h: 1, max: 300, radius: 800, leaf: '#55852f' },
  bush: { file: NATURE + 'plant_bushDetailed.glb', h: 1, max: 1200, radius: 260, leaf: '#4a7a2b' },
  lamp: { file: ROADKIT + 'light-curved.glb', scale: 12, max: 700, radius: 650, center: false },
  lamp2: { file: ROADKIT + 'light-curved-double.glb', scale: 12, max: 300, radius: 650, center: false },
  robot: { file: ROADKIT + 'traffic-light.glb', scale: 8, max: 500, radius: 500, center: false }
};
const TREE_TYPES = ['oak', 'oakDark', 'fat', 'detailed', 'plateau', 'tall'];

// Small SADC signs live in one 8x4 atlas (scripts/build-sign-atlas.py) so all
// of them are ONE instanced draw call. Order must match the atlas script.
const SIGN_TILES = ['stop', 'yield', 'signalsAhead', 'ped', 'rail', 'sl40', 'sl60', 'sl80', 'sl100', 'sl120', 'noEntry', 'noStopping', 'noUturn', 'noParking', 'taxi', 'stopAhead', 'yieldAhead', 'pedsAhead', 'children', 'humps', 'curves', 'cyclists'];
const SIGN_INDEX = {};
for (let i = 0; i < SIGN_TILES.length; i++) SIGN_INDEX[SIGN_TILES[i]] = i;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;
const MAX_SIGNS = 1400;

// Lambert material whose map is one tile of an atlas, picked per instance by
// the aTile attribute (tile origin in UV). Back faces render as bare grey metal;
// a little self-light keeps retro-reflective faces readable at night.
export function tiledSignMaterial(tex, tileW, tileH) {
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTile;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv = vec2(aTile.x + uv.x * ${tileW.toFixed(5)}, aTile.y + uv.y * ${tileH.toFixed(5)});`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.42, 0.43, 0.45);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (gl_FrontFacing) totalEmissiveRadiance += diffuseColor.rgb * 0.22;');
  };
  mat.customProgramCacheKey = () => 'tiledSign' + tileW + 'x' + tileH;
  return mat;
}

function pointInRing(x, z, p) {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2];
    const zi = p[i * 2 + 1];
    const xj = p[j * 2];
    const zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export class Props {
  constructor({ roads, hf, buildings, areas, features, coastXZ }) {
    this.roads = roads;
    this.hf = hf;
    this.buildings = buildings;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.chunks = new Map();
    this.meshes = {};
    this.lastFill = { x: 1e9, z: 1e9 };
    this.dirty = false;
    this.ready = false;
    this.stats = { instances: 0, chunks: 0 };
    this.time = 0;

    // areas by 400 m chunk
    this.areaGrid = new Map();
    for (const a of areas || []) {
      if (!['park', 'wood', 'scrub', 'golf', 'reserve', 'cemetery', 'grass', 'pitch', 'school', 'wetland'].includes(a.k)) continue;
      let minx = Infinity;
      let maxx = -Infinity;
      let minz = Infinity;
      let maxz = -Infinity;
      for (let i = 0; i < a.p.length; i += 2) {
        if (a.p[i] < minx) minx = a.p[i];
        if (a.p[i] > maxx) maxx = a.p[i];
        if (a.p[i + 1] < minz) minz = a.p[i + 1];
        if (a.p[i + 1] > maxz) maxz = a.p[i + 1];
      }
      const rec = { k: a.k, p: a.p, minx, maxx, minz, maxz };
      for (let cz = Math.floor(minz / CHUNK); cz <= Math.floor(maxz / CHUNK); cz++) {
        for (let cx = Math.floor(minx / CHUNK); cx <= Math.floor(maxx / CHUNK); cx++) {
          const k = cx * 100000 + cz;
          let l = this.areaGrid.get(k);
          if (!l) this.areaGrid.set(k, (l = []));
          l.push(rec);
        }
      }
    }
    // features by chunk
    this.featGrid = new Map();
    for (const f of features || []) {
      const k = Math.floor(f.x / CHUNK) * 100000 + Math.floor(f.z / CHUNK);
      let l = this.featGrid.get(k);
      if (!l) this.featGrid.set(k, (l = []));
      l.push(f);
    }
    // coastline points by chunk (beachfront palms)
    this.coastGrid = new Map();
    if (coastXZ) {
      for (let i = 1; i < coastXZ.length; i++) {
        const a = coastXZ[i - 1];
        const b = coastXZ[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.floor(len / 22));
        for (let s = 0; s < n; s++) {
          const x = a[0] + ((b[0] - a[0]) * s) / n;
          const z = a[1] + ((b[1] - a[1]) * s) / n;
          const k = Math.floor(x / CHUNK) * 100000 + Math.floor(z / CHUNK);
          let l = this.coastGrid.get(k);
          if (!l) this.coastGrid.set(k, (l = []));
          l.push(x, z, (b[0] - a[0]) / len, (b[1] - a[1]) / len);
        }
      }
    }

    // night glow: lamp heads (points) and light pools on the road (instanced quads)
    this.glowPos = new Float32Array(4000 * 3);
    this.glowCol = new Float32Array(4000 * 3);
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3));
    gGeo.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3));
    gGeo.setDrawRange(0, 0);
    this.glow = new THREE.Points(
      gGeo,
      new THREE.PointsMaterial({ map: glowTexture(), size: 5.5, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })
    );
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    this.group.add(this.glow);

    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(
      poolGeo,
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffc98a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }),
      900
    );
    this.pools.frustumCulled = false;
    this.pools.count = 0;
    this.pools.renderOrder = 2;
    this.group.add(this.pools);

    // signal heads: coloured glow per robot, phase changes every few seconds
    this.robots = [];
    this.rPos = new Float32Array(1500 * 3);
    this.rCol = new Float32Array(1500 * 3);
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.BufferAttribute(this.rPos, 3));
    rGeo.setAttribute('color', new THREE.BufferAttribute(this.rCol, 3));
    rGeo.setDrawRange(0, 0);
    this.rGlow = new THREE.Points(
      rGeo,
      new THREE.PointsMaterial({ map: glowTexture(), size: 1.3, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })
    );
    this.rGlow.frustumCulled = false;
    this.rGlow.renderOrder = 6;
    this.group.add(this.rGlow);

    // zebra crossings
    this.zebraMat = new THREE.MeshLambertMaterial({ color: 0xf2f2ee, emissive: 0x222222, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 });
    const zGeo = new THREE.PlaneGeometry(0.5, 1);
    zGeo.rotateX(-Math.PI / 2);
    this.zebra = new THREE.InstancedMesh(zGeo, this.zebraMat, 3000);
    this.zebra.count = 0;
    this.zebra.frustumCulled = false;
    this.group.add(this.zebra);

    // sign poles + faces
    const poleGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.6, 6);
    poleGeo.translate(0, 1.3, 0);
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x9aa0a4 }), MAX_SIGNS);
    this.poles.count = 0;
    this.poles.frustumCulled = false;
    this.group.add(this.poles);
    this.signFaces = null;
  }

  async load() {
    const jobs = [];
    for (const [name, t] of Object.entries(TYPES)) {
      jobs.push(
        loadKitModel(t.file, t.center === false ? { leaf: t.leaf } : { leaf: t.leaf, height: t.h })
          .then((m) => {
            if (t.scale) m.geometry.scale(t.scale, t.scale, t.scale);
            const mesh = new THREE.InstancedMesh(m.geometry, m.material, t.max);
            mesh.count = 0;
            mesh.frustumCulled = false;
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(t.max * 3).fill(1), 3);
            mesh.name = `props-${name}`;
            this.meshes[name] = mesh;
            this.group.add(mesh);
          })
          .catch((err) => console.warn('[IZK] prop model missing', t.file, err))
      );
    }
    jobs.push(
      new THREE.TextureLoader()
        .loadAsync('./src/assets/signs/atlas.png')
        .then((tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 2;
          const g = new THREE.PlaneGeometry(0.75, 0.75);
          g.translate(0, 2.35, 0.06);
          this.signTile = new Float32Array(MAX_SIGNS * 2);
          g.setAttribute('aTile', new THREE.InstancedBufferAttribute(this.signTile, 2));
          const mesh = new THREE.InstancedMesh(g, tiledSignMaterial(tex, 1 / ATLAS_COLS, 1 / ATLAS_ROWS), MAX_SIGNS);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.name = 'props-signs';
          this.signFaces = mesh;
          this.group.add(mesh);
        })
        .catch((err) => console.warn('[IZK] sign atlas missing', err))
    );
    await Promise.all(jobs);
    this.ready = true;
  }

  // ---- generation ----------------------------------------------------------------
  #free(x, z, r, roadPad = 1.5) {
    if (this.hf.isWater(x, z)) return false;
    const nr = this.roads.nearestRoad(x, z, 30);
    if (nr && nr.dist < nr.road.width / 2 + roadPad) return false;
    if (this.buildings && this.buildings.blocked(x, z, r)) return false;
    return true;
  }

  #gen(cx, cz) {
    const key = cx * 100000 + cz;
    const rng = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995);
    const inst = {}; // type -> [x, y, z, yaw, scale, r, g, b, ...]
    const add = (type, x, y, z, yaw, s, tint = 1) => {
      let l = inst[type];
      if (!l) inst[type] = l = [];
      l.push(x, y, z, yaw, s, tint);
    };
    const glow = []; // x, y, z, r, g, b
    const pools = []; // x, y, z, size
    const zebras = []; // x, y, z, yaw, len
    const signs = []; // type, x, y, z, yaw, scale
    const sign = (type, x, y, z, yaw, sc = 1) => signs.push(type, x, y, z, yaw, sc);
    // roadside sign at index k of a strip, on the left of traffic travelling
    // in direction dir (+1 = increasing index), facing that traffic
    const roadside = (pc, k, dir, type, sc = 1, extra = 0) => {
      const s = pc.s;
      const k2 = Math.min(s.m - 1, Math.max(0, k + (k + 1 < s.m ? 1 : -1)));
      let tx = (s.xs[k2] - s.xs[k]) * (k2 > k ? 1 : -1);
      let tz = (s.zs[k2] - s.zs[k]) * (k2 > k ? 1 : -1);
      const tl = Math.hypot(tx, tz) || 1;
      tx = (tx / tl) * dir;
      tz = (tz / tl) * dir;
      const hasWalk = !!specFor(pc.road.cls).walk;
      const off = pc.hw + (hasWalk ? WALK_W * 0.5 : 1.2) + extra;
      const x = s.xs[k] + tz * off;
      const z = s.zs[k] - tx * off;
      if (this.buildings && this.buildings.blocked(x, z, 0.4)) return;
      sign(type, x, s.ys[k] + (hasWalk ? KERB_H : -0.05), z, Math.atan2(-tx, -tz), sc);
    };
    // index along a strip that is `dist` m in from the given end
    const idxFrom = (s, atStart, dist) => {
      if (atStart) {
        for (let i = 0; i < s.m; i++) if (s.ds[i] >= dist) return i;
        return s.m - 1;
      }
      const L = s.ds[s.m - 1];
      for (let i = s.m - 1; i >= 0; i--) if (L - s.ds[i] >= dist) return i;
      return 0;
    };
    const robots = []; // x, y, z (head glow), phaseGroup
    const minx = cx * CHUNK;
    const minz = cz * CHUNK;
    const hf = this.hf;
    const tree = (x, z, big = 1) => {
      const t = TREE_TYPES[Math.floor(rng() * TREE_TYPES.length)];
      const h = (t === 'plateau' ? 7 : t === 'tall' ? 9 : 8) * (0.75 + rng() * 0.6) * big;
      add(t, x, hf.heightAt(x, z) - 0.2, z, rng() * 6.283, h, 0.82 + rng() * 0.3);
    };

    // 1. OSM green areas
    const areas = this.areaGrid.get(key) || [];
    for (const a of areas) {
      const density = { wood: 1600, reserve: 1100, scrub: 700, park: 420, golf: 260, cemetery: 200, grass: 90, wetland: 120, school: 120, pitch: 0 }[a.k] || 0;
      if (!density) continue;
      const bx0 = Math.max(minx, a.minx);
      const bz0 = Math.max(minz, a.minz);
      const bx1 = Math.min(minx + CHUNK, a.maxx);
      const bz1 = Math.min(minz + CHUNK, a.maxz);
      if (bx1 <= bx0 || bz1 <= bz0) continue;
      const n = Math.min(500, Math.round((((bx1 - bx0) * (bz1 - bz0)) / 1e6) * density));
      for (let i = 0; i < n; i++) {
        const x = bx0 + rng() * (bx1 - bx0);
        const z = bz0 + rng() * (bz1 - bz0);
        if (!pointInRing(x, z, a.p)) continue;
        if (!this.#free(x, z, 2.5, 3)) continue;
        if (a.k === 'scrub' || (a.k === 'wetland' && rng() < 0.7)) add('bush', x, hf.heightAt(x, z) - 0.1, z, rng() * 6.283, 2.2 + rng() * 2.2, 0.8 + rng() * 0.3);
        else tree(x, z, a.k === 'wood' || a.k === 'reserve' ? 1.15 : 1);
      }
    }

    // 2. Beachfront palms along the promenade
    const coast = this.coastGrid.get(key) || [];
    for (let i = 0; i < coast.length; i += 4) {
      const x0 = coast[i];
      const z0 = coast[i + 1];
      const tx = coast[i + 2];
      const tz = coast[i + 3];
      for (const off of [45, 70, 95]) {
        for (const sgn of [1, -1]) {
          const x = x0 + tz * off * sgn + tx * (rng() - 0.5) * 12;
          const z = z0 - tx * off * sgn + tz * (rng() - 0.5) * 12;
          const d = hf.signedCoastDistance(x, z);
          if (d < 30 || d > 120 || rng() < 0.35) continue;
          if (!this.#free(x, z, 2, 2)) continue;
          if (!hf.isSeaLevel(x, z)) add(rng() < 0.7 ? 'palm' : 'palmBend', x, hf.heightAt(x, z) - 0.2, z, rng() * 6.283, 8 + rng() * 5, 0.85 + rng() * 0.3);
        }
      }
    }

    // 3. Gardens: a tree or bush beside houses
    if (this.buildings) {
      this.buildings.forEachIn(minx, minz, minx + CHUNK, minz + CHUNK, (i, type, x, z, area) => {
        if (type !== 'house' && type !== 'rdp' && type !== 'flats' && type !== 'civic') return;
        const tries = type === 'house' ? 3 : 1;
        for (let t = 0; t < tries; t++) {
          if (rng() > (type === 'house' ? 0.7 : 0.45)) continue;
          const r = Math.sqrt(area) * 0.5 + 2.5 + rng() * 6;
          const a = rng() * 6.283;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          if (!this.#free(px, pz, 1.8, 2.5)) continue;
          if (rng() < 0.6) tree(px, pz, 0.85);
          else add('bush', px, hf.heightAt(px, pz) - 0.1, pz, rng() * 6.283, 2 + rng() * 1.6, 0.8 + rng() * 0.3);
        }
      });
    }

    // 4. Roadside: street lights on main roads, trees on suburban streets
    const rc = this.roads.chunks.get(key);
    if (rc) {
      for (const run of rc.runs) {
        const pc = run.pc;
        const road = pc.road;
        const s = pc.s;
        if (pc.elevated) continue;
        const rank = road.rank;
        const rural = road.rural || road.unpaved;
        const hasWalk = !!specFor(road.cls).walk && !rural;
        const lampSpacing = rural ? 55 : rank >= 9 ? 70 : rank >= 5 ? 34 : 0;
        const coastD = hf.signedCoastDistance(s.xs[run.i0], s.zs[run.i0]);
        const cbd = Math.hypot(s.xs[run.i0], s.zs[run.i0]) < 1300;
        const treeSpacing = rural ? 0 : !cbd && rank <= 6 && rank >= 2 ? (coastD < 220 ? 16 : 17) : 0;
        for (let k = run.i0; k <= run.i1; k++) {
          const d = pc.d0 + s.ds[k];
          const dPrev = k > run.i0 ? pc.d0 + s.ds[k - 1] : d - 0.001;
          const fromStart = s.ds[k];
          const fromEnd = s.ds[s.m - 1] - s.ds[k];
          if (fromStart < 9 || fromEnd < 9) continue;
          if (lampSpacing && Math.floor(d / lampSpacing) !== Math.floor(dPrev / lampSpacing)) {
            const idx = Math.floor(d / lampSpacing);
            const side = road.oneway ? 1 : idx % 2 ? 1 : -1;
            const off = pc.hw + (hasWalk ? WALK_W * 0.55 : 1.3);
            const x = s.xs[k] + s.lx[k] * off * side;
            const z = s.zs[k] + s.lz[k] * off * side;
            if (this.#free(x, z, 0.5, -0.6) && (!this.buildings || !this.buildings.blocked(x, z, 0.5))) {
              const nx = -s.lx[k] * side;
              const nz = -s.lz[k] * side;
              const yaw = Math.atan2(-nx, -nz);
              const y = s.ys[k] + (hasWalk ? KERB_H : -0.1);
              const dbl = rank >= 8 && !road.oneway;
              add(dbl ? 'lamp2' : 'lamp', x, y, z, yaw, 1, 1);
              const arm = 2.25;
              glow.push(x + nx * arm, y + 7.75, z + nz * arm, 1.0, 0.78, 0.48);
              pools.push(x + nx * arm, s.ys[k] + 0.06, z + nz * arm, 15);
              if (dbl) {
                glow.push(x - nx * arm, y + 7.75, z - nz * arm, 1.0, 0.78, 0.48);
              }
            }
          }
          if (treeSpacing && Math.floor(d / treeSpacing) !== Math.floor(dPrev / treeSpacing) && rng() < 0.72) {
            const side = rng() < 0.5 ? 1 : -1;
            const off = pc.hw + (hasWalk ? WALK_W + 1.4 : 2.6) + rng() * 1.2;
            const x = s.xs[k] + s.lx[k] * off * side;
            const z = s.zs[k] + s.lz[k] * off * side;
            if (this.#free(x, z, 1.5, 1.2)) {
              if (coastD < 220 && coastD > 0 && !hf.isSeaLevel(x, z)) add('palm', x, hf.heightAt(x, z) - 0.2, z, rng() * 6.283, 8 + rng() * 4, 0.9 + rng() * 0.2);
              else tree(x, z, 0.95);
            }
          }
          // speed limits: repeated along the road for both directions
          const slSpacing = rank >= 8 ? 900 : rank >= 5 ? 650 : 0;
          if (slSpacing && !road.cls.endsWith('_link')) {
            const ph = (road.id % 97) * 3.1;
            if (Math.floor((d + ph) / slSpacing) !== Math.floor((dPrev + ph) / slSpacing)) {
              const lim = road.cls === 'motorway' ? (Math.hypot(s.xs[k], s.zs[k]) < 5500 ? 'sl80' : 'sl100') : road.cls === 'trunk' ? 'sl80' : 'sl60';
              const sc = rank >= 8 ? 1.6 : 1.1;
              roadside(pc, k, 1, lim, sc, rank >= 8 ? 1.5 : 0);
              if (!road.oneway) roadside(pc, k, -1, lim, sc, rank >= 8 ? 1.5 : 0);
              else if (rank < 8 && rng() < 0.5) roadside(pc, k, 1, 'noUturn');
            }
          }
          // CBD kerbs: taxi bays and no-stopping on the busy roads
          if (cbd && rank >= 5 && rank <= 7 && Math.floor(d / 180) !== Math.floor(dPrev / 180)) {
            const r = rng();
            if (r < 0.28) roadside(pc, k, road.oneway || rng() < 0.5 ? 1 : -1, 'taxi');
            else if (r < 0.48) roadside(pc, k, road.oneway || rng() < 0.5 ? 1 : -1, 'noStopping');
            else if (r < 0.58) roadside(pc, k, road.oneway || rng() < 0.5 ? 1 : -1, 'noParking');
          }
          // winding roads: series-of-curves warning where the heading swings
          if (rank >= 4 && rank <= 8 && Math.floor(d / 120) !== Math.floor(dPrev / 120)) {
            let j = k;
            while (j < s.m - 1 && s.ds[j] - s.ds[k] < 90) j++;
            if (j > k + 1 && s.ds[j] - s.ds[k] >= 60) {
              const a0 = Math.atan2(s.xs[k + 1] - s.xs[k], s.zs[k + 1] - s.zs[k]);
              const a1 = Math.atan2(s.xs[j] - s.xs[j - 1], s.zs[j] - s.zs[j - 1]);
              let da = Math.abs(a1 - a0);
              if (da > Math.PI) da = 2 * Math.PI - da;
              if (da > 1.0) {
                roadside(pc, Math.max(run.i0, k - 1), 1, 'curves');
                if (!road.oneway) roadside(pc, j, -1, 'curves');
              }
            }
          }
          // residential: occasional speed humps and children-ahead signs
          if (rank === 3 && fromStart > 25 && Math.floor(d / 260) !== Math.floor(dPrev / 260)) {
            const r = rng();
            if (r < 0.1) roadside(pc, k, 1, 'humps');
            else if (r < 0.15) roadside(pc, k, -1, 'children');
          }
        }
      }

      // No entry where one-way streets leave a junction (seen from the junction)
      for (const node of rc.nodes) {
        if (node.ends.length < 3) continue;
        for (const e of node.ends) {
          const pc = e.pc;
          const road = pc.road;
          if (!road.oneway || e.atStart || pc.elevated || road.rank > 7 || road.cls.endsWith('_link') || pc.len < 25) continue;
          const s = pc.s;
          const i = idxFrom(s, false, (node.r || 6) + 3);
          const off = pc.hw + 0.8;
          const yaw = Math.atan2(-e.dx, -e.dz);
          // one sign, on the side a driver turning in from the junction sees first
          const sg = (node.key.length + node.ends.length) % 2 ? 1 : -1;
          sign('noEntry', s.xs[i] + e.dz * off * sg, s.ys[i] + KERB_H, s.zs[i] - e.dx * off * sg, yaw);
        }
      }

      // 5. Junction furniture from OSM features: robots, stop/yield signs
      const feats = this.featGrid.get(key) || [];
      for (const f of feats) {
        if (f.k === 'signals' || f.k === 'stop' || f.k === 'yield') {
          // nearest junction node in this or neighbouring chunks
          let best = null;
          let bd = 28;
          for (let gz = cz - 1; gz <= cz + 1; gz++) {
            for (let gx = cx - 1; gx <= cx + 1; gx++) {
              const c2 = this.roads.chunks.get(gx * 100000 + gz);
              if (!c2) continue;
              for (const node of c2.nodes) {
                const dd = Math.hypot(node.x - f.x, node.z - f.z);
                if (dd < bd) {
                  bd = dd;
                  best = node;
                }
              }
            }
          }
          if (!best) continue;
          if (f.k === 'signals') {
            if (best._robots) continue;
            best._robots = true;
            // phase groups: arms roughly in line with the first arm share a group
            const e0 = best.ends[0];
            const sig = { x: best.x, z: best.z, r: best.r || 8, arms: [] };
            for (const e of best.ends) {
              const grp = Math.abs(e.dx * e0.dx + e.dz * e0.dz) > 0.6 ? 0 : 1;
              sig.arms.push({ dx: e.dx, dz: e.dz, grp });
            }
            this.#registerSignal(best.key, sig);
            let arm = 0;
            for (const e of best.ends) {
              const pc = e.pc;
              if (pc.elevated || pc.road.rank >= 9) continue;
              // one-way pieces only get a robot where traffic arrives
              if (pc.road.oneway && e.atStart) continue;
              const s = pc.s;
              const i = e.atStart ? Math.min(1, s.m - 1) : Math.max(0, s.m - 2);
              const px = s.xs[i];
              const pz = s.zs[i];
              // left of the arriving traffic = (-dz, dx) where (dx,dz) points away from the node
              const lx = -e.dz;
              const lz = e.dx;
              const off = pc.hw + 0.7;
              const x = px + lx * off;
              const z = pz + lz * off;
              const y = s.ys[i] + KERB_H;
              // face the arriving traffic (looking away from the junction)
              const yaw = Math.atan2(e.dx, e.dz);
              add('robot', x, y, z, yaw, 1, 1);
              const grp = Math.abs(e.dx * e0.dx + e.dz * e0.dz) > 0.6 ? 0 : 1;
              robots.push(x + e.dx * 0.25, y + 3.55, z + e.dz * 0.25, grp, x, z, e.dx, e.dz);
              arm++;
              // robot-ahead warning on long fast approaches
              if (pc.len > 160 && pc.road.rank >= 5) {
                const j = idxFrom(s, e.atStart, 110);
                sign('signalsAhead', s.xs[j] + lx * off, s.ys[j] + KERB_H, s.zs[j] + lz * off, yaw, 1.15);
              }
            }
          } else {
            for (const e of best.ends) {
              const pc = e.pc;
              if (pc.road.rank > 4 || (pc.road.oneway && e.atStart)) continue;
              const s = pc.s;
              const i = e.atStart ? Math.min(1, s.m - 1) : Math.max(0, s.m - 2);
              const off = pc.hw + 0.8;
              const x = s.xs[i] - e.dz * off;
              const z = s.zs[i] + e.dx * off;
              sign(f.k, x, s.ys[i] + KERB_H, z, Math.atan2(e.dx, e.dz));
              // advance warning on longer approaches
              if (pc.len > 120 && pc.road.rank >= 3) {
                const j = idxFrom(s, e.atStart, 70);
                sign(f.k === 'stop' ? 'stopAhead' : 'yieldAhead', s.xs[j] - e.dz * off, s.ys[j] + KERB_H, s.zs[j] + e.dx * off, Math.atan2(e.dx, e.dz));
              }
              break;
            }
          }
        } else if (f.k === 'zebra' || f.k === 'crossing' || f.k === 'crossing_signals') {
          const nr = this.roads.nearestRoad(f.x, f.z, 12);
          if (!nr || nr.road.rank >= 9) continue;
          const dl = Math.hypot(nr.dirX, nr.dirZ) || 1;
          const yaw = Math.atan2(nr.dirX / dl, nr.dirZ / dl);
          const surf = this.roads.surfaceAt(nr.x, nr.z, null);
          zebras.push(nr.x, surf.y + 0.05, nr.z, yaw, nr.road.width - 0.6, nr.dirX / dl, nr.dirZ / dl);
          if (f.k !== 'crossing_signals' && rng() < 0.6) {
            const lx = nr.dirZ / dl;
            const lz = -nr.dirX / dl;
            const off = nr.road.width / 2 + 0.8;
            sign(rng() < 0.85 ? 'ped' : 'pedsAhead', nr.x + lx * off + (nr.dirX / dl) * 14, surf.y + KERB_H, nr.z + lz * off + (nr.dirZ / dl) * 14, yaw + Math.PI);
          }
        } else if (f.k === 'rail') {
          const nr = this.roads.nearestRoad(f.x, f.z, 12);
          if (!nr) continue;
          const dl = Math.hypot(nr.dirX, nr.dirZ) || 1;
          const dx = nr.dirX / dl;
          const dz = nr.dirZ / dl;
          for (const sgn of [1, -1]) {
            const x = nr.x - dx * 110 * sgn + -dz * sgn * (nr.road.width / 2 + 0.8);
            const z = nr.z - dz * 110 * sgn + dx * sgn * (nr.road.width / 2 + 0.8);
            sign('rail', x, this.roads.surfaceAt(x, z, null).y + 0.1, z, Math.atan2(dx * sgn, dz * sgn) + Math.PI);
          }
        }
      }
    }

    const chunk = { key, cx, cz, x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, inst, glow, pools, zebras, signs, robots };
    this.chunks.set(key, chunk);
    this.dirty = true;
    return chunk;
  }

  // ---- signal registry (AI traffic stops at red) --------------------------------
  #registerSignal(key, sig) {
    if (!this.signals) this.signals = new Map();
    if (!this.sigKeys) this.sigKeys = new Set();
    if (this.sigKeys.has(key)) return;
    this.sigKeys.add(key);
    const k = Math.floor(sig.x / 50) * 100000 + Math.floor(sig.z / 50);
    let l = this.signals.get(k);
    if (!l) this.signals.set(k, (l = []));
    l.push(sig);
  }

  // Current phase: 0 = group A green, 1 = A amber, 2 = B green, 3 = B amber.
  get phase() {
    const t = this.time % 34;
    return t < 14 ? 0 : t < 17 ? 1 : t < 31 ? 2 : 3;
  }

  static stateFor(grp, phase) {
    if (grp === 0) return phase === 0 ? 2 : phase === 1 ? 1 : 0;
    return phase === 2 ? 2 : phase === 3 ? 1 : 0;
  }

  // Signal a vehicle at (x, z) heading (fx, fz) is approaching within `ahead` m:
  // returns { state (0 red, 1 amber, 2 green), dist (to the junction edge) } or null.
  signalAhead(x, z, fx, fz, ahead = 30) {
    if (!this.signals) return null;
    const gx = Math.floor(x / 50);
    const gz = Math.floor(z / 50);
    let best = null;
    let bestD = Infinity;
    for (let a = gz - 1; a <= gz + 1; a++) {
      for (let b = gx - 1; b <= gx + 1; b++) {
        const l = this.signals.get(b * 100000 + a);
        if (!l) continue;
        for (const sg of l) {
          const dx = sg.x - x;
          const dz = sg.z - z;
          const along = dx * fx + dz * fz;
          if (along < 0 || along > ahead + sg.r) continue;
          const side = Math.abs(dx * fz - dz * fx);
          if (side > sg.r + 4) continue;
          if (along < bestD) {
            bestD = along;
            best = sg;
          }
        }
      }
    }
    if (!best) return null;
    // arm we arrive on: its outward direction points back at us (-f)
    let arm = null;
    let ad = -2;
    for (const a of best.arms) {
      const d = -(a.dx * fx + a.dz * fz);
      if (d > ad) {
        ad = d;
        arm = a;
      }
    }
    if (!arm || ad < 0.5) return null;
    return { state: Props.stateFor(arm.grp, this.phase), dist: bestD - best.r };
  }

  // ---- streaming ---------------------------------------------------------------
  update(camX, camZ, dt = 0, budget = 1) {
    if (!this.ready) return;
    this.time += dt;
    const g0x = Math.floor(camX / CHUNK);
    const g0z = Math.floor(camZ / CHUNK);
    const R = Math.ceil(GEN_RADIUS / CHUNK);
    let built = 0;
    // nearest-first generation
    for (let ring = 0; ring <= R && built < budget; ring++) {
      for (let gz = g0z - ring; gz <= g0z + ring && built < budget; gz++) {
        for (let gx = g0x - ring; gx <= g0x + ring && built < budget; gx++) {
          if (Math.max(Math.abs(gx - g0x), Math.abs(gz - g0z)) !== ring) continue;
          const key = gx * 100000 + gz;
          if (this.chunks.has(key)) continue;
          const d = Math.hypot((gx + 0.5) * CHUNK - camX, (gz + 0.5) * CHUNK - camZ);
          if (d > GEN_RADIUS) continue;
          this.#gen(gx, gz);
          built++;
        }
      }
    }
    for (const [key, c] of this.chunks) {
      if (Math.hypot(c.x - camX, c.z - camZ) > DROP_RADIUS) {
        for (const nd of this.roads.chunks.get(key)?.nodes || []) nd._robots = false;
        this.chunks.delete(key);
      }
    }
    if (this.dirty || Math.hypot(camX - this.lastFill.x, camZ - this.lastFill.z) > REFILL_MOVE) this.#fill(camX, camZ);
    this.#night(dt);
  }

  #fill(camX, camZ) {
    this.dirty = false;
    this.lastFill.x = camX;
    this.lastFill.z = camZ;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const counts = {};
    let total = 0;
    for (const name of Object.keys(this.meshes)) counts[name] = 0;
    let gi = 0;
    let pi = 0;
    let zi = 0;
    let poleI = 0;
    this.robots.length = 0;
    for (const c of this.chunks.values()) {
      const cd = Math.hypot(c.x - camX, c.z - camZ) - CHUNK * 0.71;
      for (const [name, list] of Object.entries(c.inst)) {
        const mesh = this.meshes[name];
        if (!mesh) continue;
        const t = TYPES[name];
        if (cd > t.radius) continue;
        const r2 = t.radius * t.radius;
        for (let i = 0; i < list.length; i += 6) {
          if (counts[name] >= t.max) break;
          const dx = list[i] - camX;
          const dz = list[i + 2] - camZ;
          if (dx * dx + dz * dz > r2) continue;
          e.set(0, list[i + 3], 0);
          q.setFromEuler(e);
          p.set(list[i], list[i + 1], list[i + 2]);
          const s = list[i + 4];
          sc.set(s, s, s);
          m.compose(p, q, sc);
          const k = counts[name]++;
          mesh.setMatrixAt(k, m);
          const tint = list[i + 5];
          col.setRGB(tint, tint, tint);
          mesh.setColorAt(k, col);
        }
      }
      if (cd < 650) {
        for (let i = 0; i < c.glow.length && gi < 4000; i += 6) {
          this.glowPos[gi * 3] = c.glow[i];
          this.glowPos[gi * 3 + 1] = c.glow[i + 1];
          this.glowPos[gi * 3 + 2] = c.glow[i + 2];
          this.glowCol[gi * 3] = c.glow[i + 3];
          this.glowCol[gi * 3 + 1] = c.glow[i + 4];
          this.glowCol[gi * 3 + 2] = c.glow[i + 5];
          gi++;
        }
        for (let i = 0; i < c.pools.length && pi < 900; i += 4) {
          const dx = c.pools[i] - camX;
          const dz = c.pools[i + 2] - camZ;
          if (dx * dx + dz * dz > 420 * 420) continue;
          p.set(c.pools[i], c.pools[i + 1], c.pools[i + 2]);
          q.identity();
          sc.set(c.pools[i + 3], 1, c.pools[i + 3]);
          m.compose(p, q, sc);
          this.pools.setMatrixAt(pi++, m);
        }
      }
      if (cd < 450) {
        for (let i = 0; i < c.zebras.length; i += 7) {
          const x = c.zebras[i];
          const y = c.zebras[i + 1];
          const z = c.zebras[i + 2];
          const yaw = c.zebras[i + 3];
          const len = c.zebras[i + 4];
          const dx = c.zebras[i + 5];
          const dz = c.zebras[i + 6];
          // stripes across the road: bars 0.5 m wide along travel, 3 m long across
          const n = Math.max(2, Math.floor(len / 1.0));
          e.set(0, yaw, 0);
          q.setFromEuler(e);
          for (let b = 0; b < n && zi < 3000; b++) {
            const off = -len / 2 + (b + 0.5) * (len / n);
            // across-road offset uses the left normal (dz, -dx)
            p.set(x + dz * off, y, z - dx * off);
            sc.set(1, 1, 3);
            m.compose(p, q, sc);
            this.zebra.setMatrixAt(zi++, m);
          }
        }
        const mesh = this.signFaces;
        for (let i = 0; mesh && i < c.signs.length; i += 6) {
          if (poleI >= MAX_SIGNS) break;
          const t = SIGN_INDEX[c.signs[i]];
          if (t === undefined) continue;
          const dx = c.signs[i + 1] - camX;
          const dz = c.signs[i + 3] - camZ;
          const big = c.signs[i + 5] > 1.3;
          if (dx * dx + dz * dz > (big ? 420 * 420 : 260 * 260)) continue;
          e.set(0, c.signs[i + 4], 0);
          q.setFromEuler(e);
          p.set(c.signs[i + 1], c.signs[i + 2], c.signs[i + 3]);
          const s = c.signs[i + 5];
          sc.set(s, s, s);
          m.compose(p, q, sc);
          mesh.setMatrixAt(poleI, m);
          this.signTile[poleI * 2] = (t % ATLAS_COLS) / ATLAS_COLS;
          this.signTile[poleI * 2 + 1] = 1 - (Math.floor(t / ATLAS_COLS) + 1) / ATLAS_ROWS;
          this.poles.setMatrixAt(poleI++, m);
        }
        for (let i = 0; i < c.robots.length; i += 8) this.robots.push(c.robots.slice(i, i + 8));
      }
    }
    for (const [name, mesh] of Object.entries(this.meshes)) {
      mesh.count = counts[name];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      total += counts[name];
    }
    if (this.signFaces) {
      this.signFaces.count = poleI;
      this.signFaces.instanceMatrix.needsUpdate = true;
      this.signFaces.geometry.attributes.aTile.needsUpdate = true;
    }
    this.poles.count = poleI;
    this.poles.instanceMatrix.needsUpdate = true;
    this.glowCount = gi;
    this.glow.geometry.attributes.position.needsUpdate = true;
    this.glow.geometry.attributes.color.needsUpdate = true;
    this.pools.count = pi;
    this.pools.instanceMatrix.needsUpdate = true;
    this.zebra.count = zi;
    this.zebra.instanceMatrix.needsUpdate = true;
    this.stats.instances = total;
    this.stats.chunks = this.chunks.size;
    this.#robotGlow(true);
  }

  // Signal phases: arms alternate between two groups, 14 s green, 3 s amber.
  #robotGlow(force) {
    const phase = this.phase;
    if (!force && phase === this.lastPhase) return;
    this.lastPhase = phase;
    let gi = 0;
    for (const r of this.robots) {
      if (gi >= 1500) break;
      const grp = r[3];
      let state; // 0 red 1 amber 2 green
      if (grp === 0) state = phase === 0 ? 2 : phase === 1 ? 1 : 0;
      else state = phase === 2 ? 2 : phase === 3 ? 1 : 0;
      const yOff = state === 0 ? 0.3 : state === 1 ? 0 : -0.3;
      this.rPos[gi * 3] = r[0];
      this.rPos[gi * 3 + 1] = r[1] + yOff;
      this.rPos[gi * 3 + 2] = r[2];
      const c = state === 0 ? [1, 0.1, 0.06] : state === 1 ? [1, 0.55, 0.04] : [0.1, 1, 0.3];
      this.rCol[gi * 3] = c[0];
      this.rCol[gi * 3 + 1] = c[1];
      this.rCol[gi * 3 + 2] = c[2];
      gi++;
    }
    this.rGlow.geometry.setDrawRange(0, gi);
    this.rGlow.geometry.attributes.position.needsUpdate = true;
    this.rGlow.geometry.attributes.color.needsUpdate = true;
  }

  #night() {
    this.#robotGlow(false);
    const n = WORLD.night.value;
    const lampsOn = n > 0.2;
    this.glow.visible = lampsOn;
    this.glow.geometry.setDrawRange(0, this.glowCount || 0);
    this.glow.material.opacity = Math.min(1, n * 1.3);
    this.rGlow.material.size = lampsOn ? 2.2 : 1.3;
    this.pools.visible = lampsOn;
    this.pools.material.opacity = 0.55 * Math.min(1, n * 1.3);
  }
}
