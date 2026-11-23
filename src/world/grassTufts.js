import * as THREE from '../../vendor/three/three.module.js';
import { GFX } from '../core/gfx.js';
import { specFor, WALK_W } from './roads.js';

// Instanced grass tufts on open ground within ~30 m of the camera (Medium,
// High and HD tiers only; Low never builds them). One InstancedMesh, ONE draw
// call, up to 1400 tufts of 3 crossed alpha-cut cards. The ring is refilled
// (over ~5 frames) after the camera moves 9 m, from a fixed 1.5 m world grid with hashed jitter, so
// tufts never swim. Roads, pavements, buildings, water, the beach and the
// paved CBD stay clear. Tufts shrink to nothing toward the edge of the ring
// so there is no hard line where they stop.

const R = 30;
const CELL = 1.5;
const REFILL = 9;
const MAX = 1400;
const ROWS = 8; // grid rows per frame while refilling (40 rows a ring)

function hash(ix, iz, k) {
  let h = (ix * 374761393 + iz * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class GrassTufts {
  constructor({ hf, roads, buildings, detail }) {
    this.hf = hf;
    this.roads = roads;
    this.buildings = buildings;
    this.detail = detail;
    this.enabled = GFX.caps.tier !== 'low';
    this.group = new THREE.Group();
    this.group.name = 'grassTufts';
    this.last = { x: 1e9, z: 1e9 };
    this.job = null;
    this.bufM = null;
    this.bufC = null;
    if (!this.enabled) return;

    // 3 crossed cards, 0.75 m wide, 0.42 m tall, base at y = 0
    const g = new THREE.BufferGeometry();
    const pos = [];
    const nrm = [];
    const uv = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      const cx = Math.cos(a) * 0.375;
      const cz = Math.sin(a) * 0.375;
      const P = [[-cx, 0, -cz], [cx, 0, cz], [cx, 0.42, cz], [-cx, 0.42, -cz]];
      const T = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(P[k][0], P[k][1], P[k][2]);
        nrm.push(0, 1, 0); // lit like the ground it grows from
        uv.push(T[k][0], T[k][1]);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const map = new THREE.TextureLoader().load('./src/assets/hd/grass_tuft.png');
    map.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    };
    mat.customProgramCacheKey = () => 'izk-tuft-v1';
    this.mesh = new THREE.InstancedMesh(g, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'grassTufts';
    this.group.add(this.mesh);
  }

  #open(x, z) {
    const hf = this.hf;
    if (hf.isWater(x, z)) return false;
    if (Math.hypot(x, z) < 1300) return false; // paved CBD
    if (hf.signedCoastDistance(x, z) < 70) return false; // beach sand
    const nr = this.roads.nearestRoad(x, z, 16);
    if (nr) {
      const walk = specFor(nr.road.cls).walk && !nr.road.rural && !nr.road.unpaved;
      if (nr.dist < nr.road.width / 2 + (walk ? WALK_W + 0.6 : 1.2)) return false;
    }
    if (this.detail && this.detail.blocks && this.detail.blocks(x, z)) return false;
    if (this.buildings && this.buildings.blocked(x, z, 0.9)) return false;
    return true;
  }

  // full = true fills the whole ring now (loading screen); otherwise the
  // refill is spread over a few frames (ROWS per call) into a back buffer and
  // swapped in when done, so driving never hitches on it.
  update(camX, camZ, full = false) {
    if (!this.enabled) return;
    // a teleport (or a very fast camera) leaves an unfinished ring behind: restart
    if (this.job && Math.hypot(camX - this.job.x, camZ - this.job.z) > R * 0.5) this.job = null;
    if (!this.job) {
      if (Math.hypot(camX - this.last.x, camZ - this.last.z) < REFILL) return;
      this.last.x = camX;
      this.last.z = camZ;
      if (!this.bufM) {
        this.bufM = new Float32Array(MAX * 16);
        this.bufC = new Float32Array(MAX * 3);
      }
      this.job = { x: camX, z: camZ, iz: Math.floor((camZ - R) / CELL), n: 0 };
    }
    const J = this.job;
    const m = this.#m || (this.#m = new THREE.Matrix4());
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const i0 = Math.floor((J.x - R) / CELL);
    const i1 = Math.floor((J.x + R) / CELL);
    const k1 = Math.floor((J.z + R) / CELL);
    const stop = full ? k1 : Math.min(k1, J.iz + ROWS - 1);
    for (let iz = J.iz; iz <= stop && J.n < MAX; iz++) {
      for (let ix = i0; ix <= i1 && J.n < MAX; ix++) {
        if (hash(ix, iz, 1) > 0.85) continue;
        const x = (ix + hash(ix, iz, 2)) * CELL;
        const z = (iz + hash(ix, iz, 3)) * CELL;
        const d = Math.hypot(x - J.x, z - J.z);
        if (d > R) continue;
        if (!this.#open(x, z)) continue;
        const fade = Math.min(1, (R - d) / 8);
        const sc = (0.5 + hash(ix, iz, 4) * 0.55) * fade;
        q.setFromAxisAngle(up, hash(ix, iz, 5) * Math.PI);
        p.set(x, this.hf.heightAt(x, z) - 0.04, z);
        s.set(sc, sc * (0.75 + hash(ix, iz, 6) * 0.5), sc);
        m.compose(p, q, s);
        m.toArray(this.bufM, J.n * 16);
        const t = 0.5 + hash(ix, iz, 7) * 0.28;
        this.bufC[J.n * 3] = t * (0.92 + hash(ix, iz, 8) * 0.16);
        this.bufC[J.n * 3 + 1] = t;
        this.bufC[J.n * 3 + 2] = t * 0.95;
        J.n++;
      }
    }
    J.iz = stop + 1;
    if (J.iz > k1 || J.n >= MAX) {
      this.mesh.instanceMatrix.array.set(this.bufM.subarray(0, J.n * 16));
      this.mesh.instanceColor.array.set(this.bufC.subarray(0, J.n * 3));
      this.mesh.count = J.n;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      this.job = null;
    }
  }

  #m = null;
}
