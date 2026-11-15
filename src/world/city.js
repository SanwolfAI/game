import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { clamp } from '../core/utils.js';

// Simple spatial hash used for building collision lookups.
export class SpatialHash {
  constructor(cell = 40) {
    this.cell = cell;
    this.map = new Map();
  }

  key(cx, cz) {
    return cx * 100000 + cz;
  }

  insert(x, z, r) {
    const c0 = Math.floor((x - r) / this.cell);
    const c1 = Math.floor((x + r) / this.cell);
    const r0 = Math.floor((z - r) / this.cell);
    const r1 = Math.floor((z + r) / this.cell);
    for (let cz = r0; cz <= r1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        const k = this.key(cx, cz);
        let list = this.map.get(k);
        if (!list) this.map.set(k, (list = []));
        list.push({ x, z, r });
      }
    }
  }

  query(x, z, radius) {
    const out = [];
    const c0 = Math.floor((x - radius) / this.cell);
    const c1 = Math.floor((x + radius) / this.cell);
    const r0 = Math.floor((z - radius) / this.cell);
    const r1 = Math.floor((z + radius) / this.cell);
    const seen = new Set();
    for (let cz = r0; cz <= r1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        const list = this.map.get(this.key(cx, cz));
        if (!list) continue;
        for (const item of list) {
          if (seen.has(item)) continue;
          seen.add(item);
          out.push(item);
        }
      }
    }
    return out;
  }
}

function boxAt(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (color) {
    const c = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  g.translate(x, y, z);
  return g;
}

// Triangular prism used for pitched roofs.
function prism(w, h, d, x, y, z) {
  const hw = w / 2;
  const hd = d / 2;
  const v = [
    -hw, 0, -hd, hw, 0, -hd, 0, h, -hd,
    -hw, 0, hd, 0, h, hd, hw, 0, hd
  ];
  const idx = [
    0, 1, 2,
    3, 5, 4,
    0, 3, 4, 0, 4, 1,
    2, 1, 5, 2, 5, 3,
    0, 2, 3
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.translate(x, y, z);
  return g;
}

const COLLIDABLE = [];

export class City {
  constructor(hf, roadNet, rng) {
    this.hf = hf;
    this.roads = roadNet;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.hash = new SpatialHash(40);
    this.colliders = [];
    this.buildings = [];
    this.spots = [];
  }

  #slopeOk(x, z) {
    const h = this.hf.heightAt(x, z);
    const h1 = this.hf.heightAt(x + 12, z);
    const h2 = this.hf.heightAt(x, z + 12);
    return Math.abs(h1 - h) < 6 && Math.abs(h2 - h) < 6;
  }

  #free(x, z, r) {
    const near = this.hash.query(x, z, r + 6);
    for (const c of near) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < c.r + r) return false;
    }
    return true;
  }

  #addCollider(x, z, r) {
    this.colliders.push({ x, z, r });
    this.hash.insert(x, z, r);
  }

  addCollider(x, z, r) {
    this.#addCollider(x, z, r);
  }

  #roadsIn(x, z, r, classes) {
    const cs = this.roads.cell;
    const list = new Set();
    const cr = Math.ceil(r / cs);
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    for (let gz = cz - cr; gz <= cz + cr; gz++) {
      for (let gx = cx - cr; gx <= cx + cr; gx++) {
        const cell = this.roads.grid.get(this.roads.gridKey(gx, gz));
        if (!cell) continue;
        for (const road of cell) {
          if (classes && !classes.includes(road.cls)) continue;
          list.add(road);
        }
      }
    }
    return [...list];
  }

  build(districts) {
    for (const d of districts) {
      switch (d.kind) {
        case 'cbd':
          this.#buildTowers(d);
          break;
        case 'hotels':
          this.#buildHotels(d);
          break;
        case 'township':
          // Township road-network test phase: keep the real road layout open
          // and drivable, but do not generate houses or shops yet.
          break;
        case 'informal':
          // Shack construction is deliberately deferred to the later township
          // detailing stage; the corrugated-metal assets are already in the repo.
          break;
        case 'suburb':
          this.#buildSuburbHomes(d);
          break;
      }
    }
    // Roadside 3D props and vegetation are handled by dedicated instanced
    // systems so the older placeholder lamps and trees are not duplicated.
    this.#commitInstances();
    return this.group;
  }

  #makeInstanced(geometry, material, count, colored) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.count = 0;
    mesh.frustumCulled = true;
    if (colored) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    }
    this.group.add(mesh);
    return mesh;
  }

  #commitInstances() {
    for (const mesh of this.group.children) {
      if (mesh.isInstancedMesh) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    }
  }

  #buildTowers(d) {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const mesh = this.#makeInstanced(boxGeo, mat, d.buildings.count, true);
    const roads = this.#roadsIn(d.x, d.z, d.r, ['secondary', 'primary', 'tertiary', 'trunk', 'residential', 'unclassified']);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let count = 0;
    for (const road of roads) {
      const spacing = d.buildings.gap;
      for (let i = 1; i < road.pts.length; i++) {
        const a = road.pts[i - 1];
        const b = road.pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen < 1) continue;
        const steps = Math.max(1, Math.floor(segLen / spacing));
        for (let sIdx = 0; sIdx < steps; sIdx++) {
          const t = (sIdx + 0.5) / steps;
          const px = a[0] + (b[0] - a[0]) * t;
          const pz = a[1] + (b[1] - a[1]) * t;
          if (count >= d.buildings.count) break;
          let dx = b[0] - a[0];
          let dz = b[1] - a[1];
          const dl = Math.hypot(dx, dz) || 1;
          dx /= dl;
          dz /= dl;
          const lx = -dz;
          const lz = dx;
          for (const side of [1, -1]) {
            if (count >= d.buildings.count) break;
            const setback = 3 + this.rng() * 6;
            const w = 16 + this.rng() * 26;
            const dp = 14 + this.rng() * 24;
            const cx = px + lx * side * (road.width / 2 + setback + dp / 2);
            const cz = pz + lz * side * (road.width / 2 + setback + dp / 2);
            if (Math.hypot(cx - d.x, cz - d.z) > d.r) continue;
            if (this.hf.isWater(cx, cz)) continue;
            if (this.hf.signedCoastDistance(cx, cz) < 60) continue;
            if (!this.#slopeOk(cx, cz)) continue;
            if (!this.#free(cx, cz, Math.max(w, dp) * 0.45)) continue;
            const h = d.buildings.min + this.rng() * (d.buildings.max - d.buildings.min);
            const yaw = Math.atan2(dx, dz) + (this.rng() - 0.5) * 0.12;
            e.set(0, yaw, 0);
            q.setFromEuler(e);
            v.set(cx, this.hf.heightAt(cx, cz) + h / 2 - 0.4, cz);
            s.set(w, h, dp);
            m.compose(v, q, s);
            mesh.setMatrixAt(count, m);
            col.set(d.palette[Math.floor(this.rng() * d.palette.length)]);
            mesh.setColorAt(count, col);
            count++;
            this.#addCollider(cx, cz, Math.max(w, dp) * 0.42);
            this.buildings.push({ x: cx, z: cz, h, w, dp });
          }
        }
      }
    }
    mesh.count = count;
  }

  #buildHotels(d) {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const mesh = this.#makeInstanced(boxGeo, mat, d.buildings.count, true);
    const roads = this.#roadsIn(d.x, d.z, d.r, null);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let count = 0;
    for (const road of roads) {
      for (let i = 1; i < road.pts.length; i++) {
        const a = road.pts[i - 1];
        const b = road.pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen < 1 || count >= d.buildings.count) continue;
        const t = 0.5;
        const px = a[0] + (b[0] - a[0]) * t;
        const pz = a[1] + (b[1] - a[1]) * t;
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const lx = -dz;
        const lz = dx;
        for (const side of [1, -1]) {
          if (count >= d.buildings.count) break;
          const cx = px + lx * side * (road.width / 2 + 10 + 14);
          const cz = pz + lz * side * (road.width / 2 + 10 + 14);
          if (this.hf.isWater(cx, cz)) continue;
          const dcoast = this.hf.signedCoastDistance(cx, cz);
          if (dcoast < 20 || dcoast > 260) continue;
          if (!this.#free(cx, cz, 18)) continue;
          const w = 26 + this.rng() * 20;
          const dp = 24 + this.rng() * 18;
          const h = d.buildings.min + this.rng() * (d.buildings.max - d.buildings.min);
          const yaw = Math.atan2(dx, dz);
          e.set(0, yaw, 0);
          q.setFromEuler(e);
          v.set(cx, this.hf.heightAt(cx, cz) + h / 2 - 0.4, cz);
          s.set(w, h, dp);
          m.compose(v, q, s);
          mesh.setMatrixAt(count, m);
          col.set(d.palette[Math.floor(this.rng() * d.palette.length)]);
          mesh.setColorAt(count, col);
          count++;
          this.#addCollider(cx, cz, Math.max(w, dp) * 0.42);
        }
      }
    }
    mesh.count = count;
  }

  // RDP houses: rows of small brick units with pitched roofs.
  #buildRdp(d) {
    const body = boxAt(1, 1, 1, 0, 0, 0, '#ffffff');
    const roof = prism(1, 1, 1, 0, 0, 0);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const bodyMesh = this.#makeInstanced(body, mat, d.buildings.count, true);
    const roofMesh = this.#makeInstanced(roof, new THREE.MeshLambertMaterial({ color: 0x7a4a3c }), d.buildings.count, false);

    const roads = this.#roadsIn(d.x, d.z, d.r, ['residential', 'tertiary', 'unclassified', 'living_street', 'secondary']);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let count = 0;
    for (const road of roads) {
      for (let i = 1; i < road.pts.length && count < d.buildings.count; i++) {
        const a = road.pts[i - 1];
        const b = road.pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen < 2) continue;
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const lx = -dz;
        const lz = dx;
        const side = this.rng() > 0.5 ? 1 : -1;
        const rowStart = 0.15 + this.rng() * 0.6;
        const units = 3 + Math.floor(this.rng() * 5);
        const unitW = 5.6;
        for (let u = 0; u < units && count < d.buildings.count; u++) {
          const along = rowStart + u * (unitW + 0.4);
          if (along > segLen) break;
          const px = a[0] + dx * along;
          const pz = a[1] + dz * along;
          const depth = 8;
          const cx = px + lx * side * (road.width / 2 + 3 + depth / 2);
          const cz = pz + lz * side * (road.width / 2 + 3 + depth / 2);
          if (Math.hypot(cx - d.x, cz - d.z) > d.r) continue;
          if (this.hf.isWater(cx, cz)) continue;
          if (!this.#slopeOk(cx, cz)) continue;
          if (!this.#free(cx, cz, 4.2)) continue;
          const h = d.buildings.min + this.rng() * (d.buildings.max - d.buildings.min);
          const yaw = Math.atan2(dx, dz);
          e.set(0, yaw, 0);
          q.setFromEuler(e);
          const ground = this.hf.heightAt(cx, cz);
          v.set(cx, ground + h / 2, cz);
          s.set(unitW, h, depth);
          m.compose(v, q, s);
          bodyMesh.setMatrixAt(count, m);
          col.set(d.palette[Math.floor(this.rng() * d.palette.length)]);
          bodyMesh.setColorAt(count, col);
          v.set(cx, ground + h, cz);
          s.set(unitW + 0.7, 1.9, depth + 0.7);
          m.compose(v, q, s);
          roofMesh.setMatrixAt(count, m);
          count++;
          this.#addCollider(cx, cz, 3.4);
        }
      }
    }
    bodyMesh.count = count;
    roofMesh.count = count;
  }

  // Zinc shacks: corrugated iron units packed into informal settlements.
  #buildShacks(d) {
    const body = boxAt(1, 1, 1, 0, 0, 0, '#ffffff');
    const roof = boxAt(1, 0.12, 1, 0, 0, 0, '#6e7276');
    const bodyMesh = this.#makeInstanced(body, new THREE.MeshLambertMaterial({ vertexColors: true }), d.buildings.count, true);
    const roofMesh = this.#makeInstanced(roof, new THREE.MeshLambertMaterial({ color: 0x8b9094 }), d.buildings.count, false);
    const roads = this.#roadsIn(d.x, d.z, d.r, ['residential', 'tertiary', 'unclassified', 'living_street']);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let count = 0;
    for (const road of roads) {
      for (let i = 1; i < road.pts.length && count < d.buildings.count; i++) {
        const a = road.pts[i - 1];
        const b = road.pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen < 2) continue;
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const lx = -dz;
        const lz = dx;
        const side = this.rng() > 0.5 ? 1 : -1;
        const units = 2 + Math.floor(this.rng() * 4);
        for (let u = 0; u < units && count < d.buildings.count; u++) {
          const along = 2 + this.rng() * Math.max(1, segLen - 4);
          const px = a[0] + dx * along;
          const pz = a[1] + dz * along;
          const depth = 5 + this.rng() * 4;
          const cx = px + lx * side * (road.width / 2 + 2 + depth / 2 + this.rng() * 6);
          const cz = pz + lz * side * (road.width / 2 + 2 + depth / 2 + this.rng() * 6);
          if (Math.hypot(cx - d.x, cz - d.z) > d.r * 1.15) continue;
          if (this.hf.isWater(cx, cz)) continue;
          if (!this.#slopeOk(cx, cz)) continue;
          if (!this.#free(cx, cz, 2.6)) continue;
          const w = 3 + this.rng() * 2.4;
          const h = 2.3 + this.rng() * 0.9;
          const yaw = Math.atan2(dx, dz) + (this.rng() - 0.5) * 0.5;
          e.set(0, yaw, 0);
          q.setFromEuler(e);
          const ground = this.hf.heightAt(cx, cz);
          v.set(cx, ground + h / 2, cz);
          s.set(w, h, depth);
          m.compose(v, q, s);
          bodyMesh.setMatrixAt(count, m);
          col.set(d.palette[Math.floor(this.rng() * d.palette.length)]);
          bodyMesh.setColorAt(count, col);
          v.set(cx, ground + h + 0.06, cz);
          s.set(w + 0.6, 1, depth + 0.6);
          m.compose(v, q, s);
          roofMesh.setMatrixAt(count, m);
          count++;
          this.#addCollider(cx, cz, 2.2);
        }
      }
    }
    bodyMesh.count = count;
    roofMesh.count = count;
  }

  #buildSuburbHomes(d) {
    const body = boxAt(1, 1, 1, 0, 0, 0, '#ffffff');
    const roof = prism(1, 1, 1, 0, 0, 0);
    const bodyMesh = this.#makeInstanced(body, new THREE.MeshLambertMaterial({ vertexColors: true }), d.buildings.count, true);
    const roofMesh = this.#makeInstanced(roof, new THREE.MeshLambertMaterial({ color: 0x8c4a3a }), d.buildings.count, false);
    const roads = this.#roadsIn(d.x, d.z, d.r, ['residential', 'tertiary', 'unclassified', 'living_street']);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    let count = 0;
    for (const road of roads) {
      for (let i = 1; i < road.pts.length && count < d.buildings.count; i++) {
        const a = road.pts[i - 1];
        const b = road.pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen < 4) continue;
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const lx = -dz;
        const lz = dx;
        const side = this.rng() > 0.5 ? 1 : -1;
        const cx = a[0] + dx * (segLen * 0.5) + lx * side * (road.width / 2 + 4 + 6);
        const cz = a[1] + dz * (segLen * 0.5) + lz * side * (road.width / 2 + 4 + 6);
        if (Math.hypot(cx - d.x, cz - d.z) > d.r) continue;
        if (this.hf.isWater(cx, cz)) continue;
        if (!this.#slopeOk(cx, cz)) continue;
        if (!this.#free(cx, cz, 6)) continue;
        const w = 9 + this.rng() * 6;
        const dp = 8 + this.rng() * 5;
        const h = d.buildings.min + this.rng() * (d.buildings.max - d.buildings.min);
        const yaw = Math.atan2(dx, dz);
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        const ground = this.hf.heightAt(cx, cz);
        v.set(cx, ground + h / 2, cz);
        s.set(w, h, dp);
        m.compose(v, q, s);
        bodyMesh.setMatrixAt(count, m);
        col.set(d.palette[Math.floor(this.rng() * d.palette.length)]);
        bodyMesh.setColorAt(count, col);
        v.set(cx, ground + h, cz);
        s.set(w + 0.8, 2.4, dp + 0.8);
        m.compose(v, q, s);
        roofMesh.setMatrixAt(count, m);
        count++;
        this.#addCollider(cx, cz, 4.5);
      }
    }
    bodyMesh.count = count;
    roofMesh.count = count;
  }

  // Spaza shops and shisanyama braai stalls.
  #buildShops(d) {
    const shopGeo = mergeGeometries([
      boxAt(1, 1, 1, 0, 0, 0, '#e8e0cf'),
      boxAt(0.9, 0.35, 1.02, 0, 0.55, 0, '#2f7d4f')
    ]);
    const signGeo = mergeGeometries([
      boxAt(1.4, 0.8, 0.12, 0, 0, 0, '#d94f3d'),
      boxAt(1.4, 0.14, 0.16, 0, 0.42, 0, '#f2d64b')
    ]);
    const stallGeo = mergeGeometries([
      boxAt(3.4, 0.12, 2.6, 0, 2.3, 0, '#8a6a45'),
      boxAt(0.12, 2.3, 0.12, -1.6, 1.15, -1.2, '#6d5236'),
      boxAt(0.12, 2.3, 0.12, 1.6, 1.15, -1.2, '#6d5236'),
      boxAt(0.12, 2.3, 0.12, -1.6, 1.15, 1.2, '#6d5236'),
      boxAt(0.12, 2.3, 0.12, 1.6, 1.15, 1.2, '#6d5236'),
      boxAt(3.4, 0.9, 0.1, 0, 1.0, -1.2, '#b8763f'),
      boxAt(3.4, 0.14, 0.14, 0, 1.85, -1.25, '#c0392b')
    ]);

    const shopCount = Math.floor(d.buildings.count * 0.12);
    const stallCount = Math.floor(d.buildings.count * 0.09);
    const shopMesh = this.#makeInstanced(shopGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), shopCount, false);
    const signMesh = this.#makeInstanced(signGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), shopCount, true);
    const stallMesh = this.#makeInstanced(stallGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), stallCount, true);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();
    const roads = this.#roadsIn(d.x, d.z, d.r, ['residential', 'tertiary', 'unclassified', 'secondary', 'primary', 'living_street']);
    let si = 0;
    let ti = 0;
    for (const road of roads) {
      for (let i = 1; i < road.pts.length; i++) {
        if (si >= shopCount && ti >= stallCount) break;
        const a = road.pts[i - 1];
        const b = road.pts[i];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (segLen < 3) continue;
        if (this.rng() > 0.25) continue;
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const lx = -dz;
        const lz = dx;
        const side = this.rng() > 0.5 ? 1 : -1;
        const along = this.rng() * segLen;
        const px = a[0] + dx * along;
        const pz = a[1] + dz * along;
        const off = road.width / 2 + 4.5;
        const cx = px + lx * side * off;
        const cz = pz + lz * side * off;
        if (Math.hypot(cx - d.x, cz - d.z) > d.r) continue;
        if (this.hf.isWater(cx, cz)) continue;
        if (!this.#free(cx, cz, 3)) continue;
        const yaw = Math.atan2(dx, dz);
        e.set(0, yaw, 0);
        q.setFromEuler(e);
        const ground = this.hf.heightAt(cx, cz);
        if (si < shopCount) {
          v.set(cx, ground + 1.6, cz);
          s.set(5, 3.2, 4);
          m.compose(v, q, s);
          shopMesh.setMatrixAt(si, m);
          v.set(cx, ground + 3.6, cz);
          s.set(1, 1, 1);
          m.compose(v, q, s);
          signMesh.setMatrixAt(si, m);
          col.setHSL(this.rng(), 0.75, 0.45);
          signMesh.setColorAt(si, col);
          si++;
          this.#addCollider(cx, cz, 2.6);
        } else if (ti < stallCount) {
          v.set(cx, ground, cz);
          s.set(1, 1, 1);
          m.compose(v, q, s);
          stallMesh.setMatrixAt(ti, m);
          col.setHSL(0.09, 0.35, 0.42 + this.rng() * 0.2);
          stallMesh.setColorAt(ti, col);
          ti++;
        }
      }
    }
    shopMesh.count = si;
    signMesh.count = si;
    stallMesh.count = ti;
  }

  #buildStreetFurniture(districts) {
    // Street lights along arterial roads.
    const lampGeo = mergeGeometries([
      boxAt(0.18, 7.5, 0.18, 0, 3.75, 0, '#6b6b68'),
      boxAt(0.16, 0.16, 2.1, 0, 7.4, -1.05, '#6b6b68'),
      boxAt(0.55, 0.22, 0.9, 0, 7.2, -2.0, '#f0e6c8')
    ]);
    const lampMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const maxLamps = 700;
    const lampMesh = this.#makeInstanced(lampGeo, lampMat, maxLamps, false);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    let li = 0;
    for (const road of this.roads.roads) {
      if (!road.major || li >= maxLamps) continue;
      if (this.rng() > 0.55) continue;
      const p = road.pts[Math.floor(road.pts.length / 2)];
      let dx = 0;
      let dz = 1;
      if (road.pts.length > 1) {
        const a = road.pts[0];
        const b = road.pts[road.pts.length - 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        dx = (b[0] - a[0]) / l;
        dz = (b[1] - a[1]) / l;
      }
      const lx = -dz;
      const lz = dx;
      const side = this.rng() > 0.5 ? 1 : -1;
      const cx = p[0] + lx * side * (road.width / 2 + 1.2);
      const cz = p[1] + lz * side * (road.width / 2 + 1.2);
      if (this.hf.isWater(cx, cz)) continue;
      e.set(0, Math.atan2(dx, dz), 0);
      q.setFromEuler(e);
      v.set(cx, this.hf.heightAt(cx, cz), cz);
      s.set(1, 1, 1);
      m.compose(v, q, s);
      lampMesh.setMatrixAt(li++, m);
    }
    lampMesh.count = li;

    // Trees: palms along the beachfront, indigenous trees inland.
    const treeGeo = mergeGeometries([
      boxAt(0.35, 4.2, 0.35, 0, 2.1, 0, '#7a5c3c'),
      boxAt(3.6, 2.6, 3.6, 0, 5.4, 0, '#4d7a3a')
    ]);
    const palmGeo = mergeGeometries([
      boxAt(0.3, 6.5, 0.3, 0, 3.25, 0, '#8a6b45'),
      boxAt(4.4, 0.35, 0.9, 0, 6.4, 0.9, '#4f8a3f'),
      boxAt(4.4, 0.35, 0.9, 0, 6.4, -0.9, '#4f8a3f'),
      boxAt(0.9, 0.35, 4.4, 1.9, 6.4, 0, '#4f8a3f'),
      boxAt(0.9, 0.35, 4.4, -1.9, 6.4, 0, '#4f8a3f')
    ]);
    const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const maxTrees = 900;
    const treeMesh = this.#makeInstanced(treeGeo, treeMat, maxTrees, true);
    const palmMesh = this.#makeInstanced(palmGeo, treeMat, 400, true);
    let ti = 0;
    let pi = 0;
    for (const d of districts) {
      const roads = this.#roadsIn(d.x, d.z, d.r, null);
      for (const road of roads) {
        if (ti >= maxTrees && pi >= 400) break;
        if (this.rng() > 0.12) continue;
        const p = road.pts[Math.floor(this.rng() * road.pts.length)];
        let dx = 0;
        let dz = 1;
        const a = road.pts[0];
        const b = road.pts[road.pts.length - 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        dx = (b[0] - a[0]) / l;
        dz = (b[1] - a[1]) / l;
        const lx = -dz;
        const lz = dx;
        const side = this.rng() > 0.5 ? 1 : -1;
        const cx = p[0] + lx * side * (road.width / 2 + 3 + this.rng() * 6);
        const cz = p[1] + lz * side * (road.width / 2 + 3 + this.rng() * 6);
        if (this.hf.isWater(cx, cz)) continue;
        const coast = this.hf.signedCoastDistance(cx, cz);
        if (coast < 30) continue;
        e.set(0, this.rng() * Math.PI, 0);
        q.setFromEuler(e);
        v.set(cx, this.hf.heightAt(cx, cz), cz);
        s.set(1, 1, 1);
        m.compose(v, q, s);
        if (coast < 220 && pi < 400) {
          palmMesh.setMatrixAt(pi++, m);
          palmMesh.setColorAt(pi - 1, new THREE.Color().setHSL(0.28, 0.45, 0.4 + this.rng() * 0.15));
        } else if (ti < maxTrees) {
          treeMesh.setMatrixAt(ti++, m);
          treeMesh.setColorAt(ti - 1, new THREE.Color().setHSL(0.26 + this.rng() * 0.06, 0.42, 0.32 + this.rng() * 0.18));
        }
      }
    }
    treeMesh.count = ti;
    palmMesh.count = pi;
  }
}

export { COLLIDABLE };
