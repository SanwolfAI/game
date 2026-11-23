import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

// Bus / taxi stop shelters at their real spots (src/data/durban-shelters.json,
// scripts/add-shelters.py: OSM bus stops with shelter=yes, public-transport
// shelters, a few seen on Mapillary street photos, the Red Hill shelter).
// Model: Grab3D "Bus Stop Shelter" (CC0), recoloured to the blue of the
// municipal shelters and cut to ~2k triangles (scripts/optimize-shelter.mjs).
// Each shelter stands on the pavement of the nearest road, open side facing
// the road. One InstancedMesh per model part (frame, bench, glass, light box)
// = 4 draw calls for every shelter; only shelters near the camera are drawn.
const URL = './src/assets/props/bus-shelter.glb';
const SHOW_R = 450; // metres
const SCALE = 1.1; // the real ones are ~3.5 m long, the model 3.1 m

export class Shelters {
  constructor(data, { roads, hf, buildings }) {
    this.roads = roads;
    this.hf = hf;
    this.buildings = buildings;
    this.group = new THREE.Group();
    this.group.name = 'shelters';
    this.sites = [];
    this.meshes = [];
    this.lastX = 1e9;
    this.lastZ = 1e9;
    for (const s of (data && data.shelters) || []) {
      try {
        const p = this.#place(s);
        if (p) this.sites.push(p);
      } catch (err) {
        console.warn('[IZK] shelter skipped', s.n, err);
      }
    }
  }

  // kerb-side spot on the nearest real road, on the side the stop is mapped
  #place(s) {
    const [ox, oz] = s.c;
    const nr = this.roads.nearestRoad(ox, oz, 60, (r) => !r.bridge && r.rank < 9);
    if (!nr) return null;
    const l = Math.hypot(nr.dirX, nr.dirZ) || 1;
    const ux = nr.dirX / l;
    const uz = nr.dirZ / l;
    let nx = -uz;
    let nz = ux;
    if ((ox - nr.x) * nx + (oz - nr.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const roadY = this.roads.surfaceAt(nr.x, nr.z, null).y;
    // half road + kerb/pavement strip + half the shelter depth
    let best = null;
    for (const along of [0, 4, -4, 8, -8]) {
      const off = nr.road.width / 2 + 1.4 + 0.95;
      const x = nr.x + ux * along + nx * off;
      const z = nr.z + uz * along + nz * off;
      if (this.hf.isWater && this.hf.isWater(x, z)) continue;
      if (this.buildings && this.buildings.blocked && this.buildings.blocked(x, z, 1.6)) continue;
      // not on top of another road (junction corners)
      const other = this.roads.nearestRoad(x, z, 12, (r) => r !== nr.road && !r.bridge);
      if (other && other.dist < other.road.width / 2 + 0.6) continue;
      best = { x, z };
      break;
    }
    if (!best) return null;
    const y = Math.max(this.hf.heightAt(best.x, best.z), roadY + 0.12);
    // model +z is the open front: face the road (-n)
    const yaw = Math.atan2(-nx, -nz);
    return { name: s.n, x: best.x, y, z: best.z, yaw };
  }

  async load() {
    if (!this.sites.length) return;
    const gltf = await new GLTFLoader().loadAsync(URL);
    gltf.scene.updateMatrixWorld(true);
    const parts = new Map(); // part -> { geos, mat }
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g0 = o.geometry;
      // split multi-material meshes by group
      const pieces = g0.groups && g0.groups.length > 1 ? g0.groups.map((gr) => ({ gr, mat: mats[gr.materialIndex] })) : [{ gr: null, mat: mats[0] }];
      for (const { gr, mat } of pieces) {
        let g = g0.clone();
        if (gr) {
          const idx = g0.index.array.slice(gr.start, gr.start + gr.count);
          g.setIndex(new THREE.BufferAttribute(idx, 1));
          g.clearGroups();
        }
        g.applyMatrix4(o.matrixWorld);
        const name = mat.name || '';
        const part = /glass/.test(name) ? 'glass' : /bench/.test(name) ? 'bench' : /info|light/.test(name) ? 'light' : 'body';
        const keep = part === 'body' || part === 'bench' ? ['position', 'normal', 'uv'] : ['position', 'normal'];
        for (const a of Object.keys(g.attributes)) if (!keep.includes(a)) g.deleteAttribute(a);
        g = g.index ? g.toNonIndexed() : g;
        g.scale(SCALE, SCALE, SCALE);
        if (!parts.has(part)) parts.set(part, { geos: [], src: mat });
        parts.get(part).geos.push(g);
      }
    });
    const n = this.sites.length;
    for (const [part, { geos, src }] of parts) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos);
      if (!geo) continue;
      let mat;
      if (part === 'glass') {
        mat = new THREE.MeshLambertMaterial({ color: 0xbfd4d8, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
      } else if (part === 'light') {
        mat = new THREE.MeshBasicMaterial({ color: 0xeef2ea });
      } else {
        const map = src.map || null;
        if (map) map.colorSpace = THREE.SRGBColorSpace;
        mat = new THREE.MeshLambertMaterial({ map, side: part === 'body' ? THREE.DoubleSide : THREE.FrontSide });
      }
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = `shelter-${part}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      if (part === 'glass') mesh.renderOrder = 2;
      this.group.add(mesh);
      this.meshes.push(mesh);
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
    let k = 0;
    for (const s of this.sites) {
      if (Math.abs(s.x - px) > SHOW_R || Math.abs(s.z - pz) > SHOW_R) continue;
      q.setFromAxisAngle(up, s.yaw);
      p.set(s.x, s.y, s.z);
      m.compose(p, q, one);
      for (const mesh of this.meshes) mesh.setMatrixAt(k, m);
      k++;
    }
    for (const mesh of this.meshes) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
