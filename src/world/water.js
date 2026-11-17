import * as THREE from '../../vendor/three/three.module.js';
import { toXZ } from '../core/geo.js';

// Rivers, canals and inland water from OpenStreetMap (src/data/durban-water.json,
// built by scripts/build-water.py). Flat ribbons laid on the ground with a
// muddy bank strip; one draw call for water, one for banks. Only waterways
// that OSM maps above ground (culverts / underground sections are skipped).
export class Water {
  constructor(data, hf) {
    this.group = new THREE.Group();
    this.group.name = 'inlandWater';
    if (!data) return;
    this.hf = hf;
    const W = { pos: [], uv: [], idx: [] };
    const B = { pos: [], uv: [], idx: [] };
    let pts = 0;
    for (const r of data.rivers || []) {
      const xz = r.p.map(([lon, lat]) => toXZ(lon, lat));
      pts += xz.length;
      this.#ribbon(W, xz, r.w, 0.14);
      this.#ribbon(B, xz, r.w + 5, 0.07);
    }
    for (const a of data.areas || []) {
      const xz = a.p.map(([lon, lat]) => toXZ(lon, lat));
      this.#area(W, xz, 0.14);
    }
    const loader = new THREE.TextureLoader();
    const nrm = loader.load('./src/assets/textures/waternormals.jpg');
    nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
    nrm.repeat.set(1, 1);
    this.nrm = nrm;
    const waterMat = new THREE.MeshPhongMaterial({
      color: 0x41736f,
      specular: 0x9fb8b8,
      shininess: 60,
      emissive: 0x0d2224,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4
    });
    const bankMat = new THREE.MeshLambertMaterial({
      color: 0x6b5a3e,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2
    });
    const wm = new THREE.Mesh(build(W), waterMat);
    wm.name = 'rivers';
    wm.renderOrder = 1;
    const bm = new THREE.Mesh(build(B), bankMat);
    bm.name = 'riverBanks';
    this.group.add(bm, wm);
    this.stats = { rivers: (data.rivers || []).length, areas: (data.areas || []).length, pts };
  }

  #y(x, z) {
    return this.hf.heightAt(x, z);
  }

  #ribbon(G, xz, width, lift) {
    const n = xz.length;
    if (n < 2) return;
    const hw = width / 2;
    let base = G.pos.length / 3;
    let along = 0;
    // resample long segments so the ribbon follows the ground
    const P = [];
    for (let i = 0; i < n - 1; i++) {
      const [ax, az] = xz[i];
      const [bx, bz] = xz[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.ceil(l / 20));
      for (let j = 0; j < k; j++) P.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]);
    }
    P.push(xz[n - 1]);
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i];
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(P.length - 1, i + 1)];
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const lx = dz;
      const lz = -dx;
      if (i > 0) along += Math.hypot(x - P[i - 1][0], z - P[i - 1][1]);
      // water lies flat across: lowest of the two banks and the centre
      const y = Math.min(this.#y(x, z), this.#y(x + lx * hw, z + lz * hw), this.#y(x - lx * hw, z - lz * hw)) + lift;
      G.pos.push(x + lx * hw, y, z + lz * hw, x - lx * hw, y, z - lz * hw);
      G.uv.push(0, along / 24, width / 24, along / 24);
      if (i > 0) {
        const v = base + (i - 1) * 2;
        G.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
    base += P.length * 2;
  }

  #area(G, xz, lift) {
    if (xz.length < 4) return;
    const ring = xz.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z));
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(ring, []);
    } catch {
      return;
    }
    let y = Infinity;
    for (const v of ring) y = Math.min(y, this.#y(v.x, v.y));
    if (!Number.isFinite(y)) return;
    const base = G.pos.length / 3;
    for (const v of ring) {
      G.pos.push(v.x, y + lift, v.y);
      G.uv.push(v.x / 24, v.y / 24);
    }
    for (const t of tris) G.idx.push(base + t[0], base + t[2], base + t[1]);
  }

  update(dt) {
    if (this.nrm) {
      this.nrm.offset.y -= dt * 0.04;
      this.nrm.offset.x += dt * 0.01;
    }
  }
}

function build(G) {
  // make every triangle face up (front side, lit from above)
  const P = G.pos;
  const I = G.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    const ux = P[b] - P[a];
    const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a];
    const vz = P[c + 2] - P[a + 2];
    // y of (u x v) = uz*vx - ux*vz; up-facing when positive
    if (uz * vx - ux * vz < 0) {
      const tmp = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = tmp;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
  g.setIndex(G.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(G.idx, 1) : new THREE.Uint16BufferAttribute(G.idx, 1));
  g.computeVertexNormals();
  // flat water: force up normals (triangle winding varies between areas)
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  g.computeBoundingSphere();
  return g;
}
