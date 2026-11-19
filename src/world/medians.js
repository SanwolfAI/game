import * as THREE from '../../vendor/three/three.module.js';

// Central median barriers, only where we have evidence they exist:
//  - N2 and N3 freeways: concrete (New Jersey / F-shape) median barrier
//    (SANRAL N2/N3 upgrade: "median consisting of a concrete barrier";
//    Bheko: concrete in the middle of the N3 to EB Cloete).
//  - M7, M13, M19 freeway sections: steel Armco guardrail median
//    (The Witness, Nov 2021: "along routes such as the M7, M13 and M19,
//    kilometres of Armco barriers" on the centre median).
// OSM has no barrier=jersey_barrier ways in Durban, so the barrier is placed
// midway between the two one-way carriageways of the same route where they
// run side by side (inner edges less than ~14 m apart). Nothing elsewhere.
const RULES = [
  { refs: ['N3', 'N2'], classes: ['motorway'], kind: 'concrete' },
  { refs: ['M7', 'M13', 'M19'], classes: ['motorway', 'trunk'], kind: 'armco' },
  // Umgeni Road (Bheko 19 Nov): raised kerbed pavement island down the middle
  // with the street lights standing on it. Surface sections only.
  { names: ['Umgeni Road'], classes: ['trunk', 'primary', 'secondary'], kind: 'island' }
];
const STEP = 6;
const MAX_GAP = 14;

function ruleFor(road) {
  if (!road.oneway) return null;
  for (const r of RULES) if (r.names && r.classes.includes(road.cls) && road.name && r.names.some((n) => road.name.startsWith(n))) return { rule: r, name: r.names.find((n) => road.name.startsWith(n)) };
  if (!road.ref) return null;
  const refs = road.ref.split(';');
  for (const r of RULES) {
    if (!r.refs || !r.classes.includes(road.cls)) continue;
    for (const ref of refs) if (r.refs.includes(ref)) return { rule: r, ref };
  }
  return null;
}

function alongOf(road, t) {
  const n = road.pts.length;
  const f = t * (n - 1);
  const i = Math.min(n - 2, Math.max(0, Math.floor(f)));
  const fr = f - i;
  return road.cum[i] + (road.cum[i + 1] - road.cum[i]) * fr;
}

export class Medians {
  constructor(roads) {
    this.roads = roads;
    this.group = new THREE.Group();
    this.group.name = 'medians';
    this.segs = { concrete: [], armco: [], island: [] };
    this.grid = new Map();
    const t0 = performance.now();
    for (const road of roads.roads) {
      const m = ruleFor(road);
      if (!m) continue;
      this.#trace(road, m);
    }
    this.#build();
    this.ms = performance.now() - t0;
  }

  #trace(road, m) {
    const pts = road.pts;
    const same = m.name ? (r) => r !== road && r.oneway && !!r.name && r.name.startsWith(m.name) : (r) => r !== road && r.oneway && r.ref && r.ref.split(';').includes(m.ref);
    let prev = null;
    for (let d = STEP * 0.5; d < road.len; d += STEP) {
      // point + heading at distance d
      let i = 0;
      while (i < pts.length - 2 && road.cum[i + 1] < d) i++;
      const sl = road.cum[i + 1] - road.cum[i] || 1;
      const t = (d - road.cum[i]) / sl;
      const ax = pts[i][0];
      const az = pts[i][1];
      const hx = (pts[i + 1][0] - ax) / sl;
      const hz = (pts[i + 1][1] - az) / sl;
      // emit from one carriageway only (the opposite one heads the other way)
      if (hx < -1e-6 || (Math.abs(hx) <= 1e-6 && hz < 0)) {
        prev = null;
        continue;
      }
      const x = ax + (pts[i + 1][0] - ax) * t;
      const z = az + (pts[i + 1][1] - az) * t;
      const near = this.roads.nearestRoad(x, z, road.width / 2 + MAX_GAP + 14, same);
      let ok = false;
      if (near) {
        const l = Math.hypot(near.dirX, near.dirZ) || 1;
        const dot = (near.dirX * hx + near.dirZ * hz) / l;
        const gap = near.dist - road.width / 2 - near.road.width / 2;
        if (dot < -0.8 && gap > -0.5 && gap < MAX_GAP) {
          // midpoint between the inner edges
          const ux = (near.x - x) / (near.dist || 1);
          const uz = (near.z - z) / (near.dist || 1);
          const mid = road.width / 2 + Math.max(0, gap) / 2;
          const mx = x + ux * mid;
          const mz = z + uz * mid;
          const yA = this.roads.roadHeightAt(road, d, x, z);
          const yB = this.roads.roadHeightAt(near.road, alongOf(near.road, near.t), near.x, near.z);
          if (Math.abs(yA - yB) < 1.2) {
            const y = Math.min(yA, yB);
            if (prev) this.#seg(m.rule.kind, prev[0], prev[1], prev[2], mx, mz, y, Math.max(1.2, gap));
            prev = [mx, mz, y];
            ok = true;
          }
        }
      }
      if (!ok) prev = null;
    }
  }

  #seg(kind, x0, z0, y0, x1, z1, y1, w = 0.6) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5 || len > STEP * 2.2) return;
    const s = { kind, x0, z0, x1, z1, y: (y0 + y1) / 2, len, w };
    this.segs[kind].push(s);
    const cx = Math.floor((x0 + x1) / 2 / 20);
    const cz = Math.floor((z0 + z1) / 2 / 20);
    const k = cx * 100000 + cz;
    let l = this.grid.get(k);
    if (!l) this.grid.set(k, (l = []));
    l.push(s);
  }

  #build() {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const place = (mesh, list, yOff, extra = 0.04) => {
      list.forEach((s, k) => {
        p.set((s.x0 + s.x1) / 2, s.y + yOff, (s.z0 + s.z1) / 2);
        q.setFromAxisAngle(up, Math.atan2(s.x1 - s.x0, s.z1 - s.z0));
        sc.set(s.kind === 'island' ? s.w : 1, 1, s.len + extra);
        m4.compose(p, q, sc);
        mesh.setMatrixAt(k, m4);
      });
      mesh.name = mesh.name || 'median';
      this.group.add(mesh);
    };
    // concrete F-shape: wide foot, narrow top, ~0.9 m tall (unit length along z)
    const C = this.segs.concrete;
    if (C.length) {
      const shape = new THREE.Shape();
      shape.moveTo(-0.3, 0);
      shape.lineTo(0.3, 0);
      shape.lineTo(0.24, 0.08);
      shape.lineTo(0.1, 0.32);
      shape.lineTo(0.08, 0.86);
      shape.lineTo(-0.08, 0.86);
      shape.lineTo(-0.1, 0.32);
      shape.lineTo(-0.24, 0.08);
      shape.lineTo(-0.3, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
      geo.translate(0, 0, -0.5);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xd9d3c3 }), C.length);
      mesh.name = 'medianConcrete';
      place(mesh, C, -0.02);
    }
    // Armco: galvanised W-beam each side on short posts
    const A = this.segs.armco;
    if (A.length) {
      const beam = new THREE.BoxGeometry(0.62, 0.32, 1);
      // two faces (one per carriageway) with a gap for the posts
      const g2 = new THREE.BoxGeometry(0.06, 0.32, 1);
      const left = g2.clone();
      left.translate(-0.24, 0.6, 0);
      const right = g2.clone();
      right.translate(0.24, 0.6, 0);
      const merged = mergeTwo(left, right);
      beam.dispose();
      const metal = new THREE.MeshLambertMaterial({ color: 0xaeb4b8 });
      const mesh = new THREE.InstancedMesh(merged, metal, A.length);
      mesh.name = 'medianArmco';
      place(mesh, A, 0);
      const post = new THREE.BoxGeometry(0.12, 0.75, 0.12);
      post.translate(0, 0.375, 0);
      const posts = new THREE.InstancedMesh(post, new THREE.MeshLambertMaterial({ color: 0x7d8286 }), A.length);
      posts.name = 'medianPosts';
      A.forEach((s, k) => {
        p.set(s.x0, s.y, s.z0);
        q.identity();
        sc.set(1, 1, 1);
        m4.compose(p, q, sc);
        posts.setMatrixAt(k, m4);
      });
      this.group.add(posts);
    }
    // Umgeni Road island: kerbed concrete strip with lights every ~36 m
    const I = this.segs.island;
    if (I.length) {
      const geo = new THREE.BoxGeometry(1, 0.2, 1);
      geo.translate(0, 0.1, 0);
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xbdb9b0 }), I.length);
      mesh.name = 'medianIsland';
      place(mesh, I, 0, 0.3);
      const lamps = I.filter((s, k) => k % 6 === 0);
      const pole = new THREE.CylinderGeometry(0.09, 0.14, 10, 6);
      pole.translate(0, 5, 0);
      const arm = new THREE.BoxGeometry(3.6, 0.1, 0.1);
      arm.translate(0, 9.8, 0);
      const poles = new THREE.InstancedMesh(mergeTwo(pole, arm), new THREE.MeshLambertMaterial({ color: 0x8e9398 }), lamps.length);
      poles.name = 'medianLampPoles';
      const head = new THREE.BoxGeometry(0.7, 0.14, 0.3);
      const hl = head.clone();
      hl.translate(-1.7, 9.68, 0);
      const hr = head.clone();
      hr.translate(1.7, 9.68, 0);
      const heads = new THREE.InstancedMesh(mergeTwo(hl, hr), new THREE.MeshLambertMaterial({ color: 0x555a5e, emissive: 0xffd9a0, emissiveIntensity: 0.0 }), lamps.length);
      heads.name = 'medianLampHeads';
      this.lampHeads = heads;
      lamps.forEach((s, k) => {
        p.set(s.x0, s.y + 0.2, s.z0);
        // arms reach across both carriageways
        q.setFromAxisAngle(up, Math.atan2(s.x1 - s.x0, s.z1 - s.z0));
        sc.set(1, 1, 1);
        m4.compose(p, q, sc);
        poles.setMatrixAt(k, m4);
        heads.setMatrixAt(k, m4);
      });
      this.group.add(poles, heads);
    }
    this.count = C.length + A.length + I.length;
  }

  // Solid for the player: push a circle (x, z, r) out of any barrier.
  collide(x, z, r) {
    const cx = Math.floor(x / 20);
    const cz = Math.floor(z / 20);
    for (let a = cx - 1; a <= cx + 1; a++) {
      for (let b = cz - 1; b <= cz + 1; b++) {
        const l = this.grid.get(a * 100000 + b);
        if (!l) continue;
        for (const s of l) {
          const dx = s.x1 - s.x0;
          const dz = s.z1 - s.z0;
          const l2 = dx * dx + dz * dz;
          let t = ((x - s.x0) * dx + (z - s.z0) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = s.x0 + dx * t;
          const pz = s.z0 + dz * t;
          const d = Math.hypot(x - px, z - pz);
          const lim = r + (s.kind === 'island' ? s.w / 2 : 0.3);
          if (d < lim && d > 1e-4) {
            const nx = (x - px) / d;
            const nz = (z - pz) / d;
            return { x: px + nx * lim, z: pz + nz * lim, nx, nz, y: s.y };
          }
        }
      }
    }
    return null;
  }
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array;
  const pb = b.attributes.position.array;
  const na = a.attributes.normal.array;
  const nb = b.attributes.normal.array;
  const pos = new Float32Array(pa.length + pb.length);
  pos.set(pa, 0);
  pos.set(pb, pa.length);
  const nor = new Float32Array(na.length + nb.length);
  nor.set(na, 0);
  nor.set(nb, na.length);
  const ia = a.index.array;
  const ib = b.index.array;
  const idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia, 0);
  const off = pa.length / 3;
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + off;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
