import * as THREE from '../../vendor/three/three.module.js';
import { trafficCarModel } from '../game/carModels.js';

// Hospital, clinic, police and fire-station grounds (src/data/durban-grounds.json,
// built by scripts/build-grounds.py from the real OSM site outlines).
// Each site gets a steel palisade fence along its real boundary (gaps where
// real roads enter), a gatehouse with a boom gate at the entrance facing the
// nearest street, and a parking row inside: SAPS vans at police stations
// (plus the national flag), ambulances and staff cars at hospitals and
// clinics, a fire engine bay at fire stations. Police stations OSM only maps
// as a point get a standard compound set back from their street.

const FENCE_H = 2.4;
const PALE_M = 2.0; // texture repeat length

function paliTexture(col) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = col;
  // rails
  g.fillRect(0, 20, 128, 6);
  g.fillRect(0, 100, 128, 6);
  // pales with the triple-point top SA palisade has
  for (let x = 2; x < 128; x += 16) {
    g.fillRect(x, 12, 9, 116);
    g.beginPath();
    g.moveTo(x, 12);
    g.lineTo(x + 1.5, 2);
    g.lineTo(x + 3, 9);
    g.lineTo(x + 4.5, 0);
    g.lineTo(x + 6, 9);
    g.lineTo(x + 7.5, 2);
    g.lineTo(x + 9, 12);
    g.fill();
  }
  // a little shading so it reads as steel
  g.globalCompositeOperation = 'source-atop';
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function saFlagTexture() {
  const W = 192;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#de3831';
  g.fillRect(0, 0, W, H / 2);
  g.fillStyle = '#002395';
  g.fillRect(0, H / 2, W, H / 2);
  const Y = (w, col) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(-4, -4);
    g.lineTo(W * 0.42, H / 2);
    g.lineTo(-4, H + 4);
    g.moveTo(W * 0.42, H / 2);
    g.lineTo(W + 2, H / 2);
    g.stroke();
  };
  Y(H * 0.42, '#ffffff');
  Y(H * 0.27, '#007a4d');
  g.fillStyle = '#ffb612';
  g.beginPath();
  g.moveTo(0, H * 0.2);
  g.lineTo(W * 0.3, H / 2);
  g.lineTo(0, H * 0.8);
  g.fill();
  g.fillStyle = '#000000';
  g.beginPath();
  g.moveTo(0, H * 0.28);
  g.lineTo(W * 0.235, H / 2);
  g.lineTo(0, H * 0.72);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Grounds {
  constructor(data, { roads, hf, buildings }) {
    this.roads = roads;
    this.hf = hf;
    this.buildings = buildings;
    this.group = new THREE.Group();
    this.group.name = 'grounds';
    this.sites = [];
    this.parked = []; // {type, x, z, yaw, paint}
    this.gates = [];
    this.flags = [];
    this.bays = [];
    const t0 = performance.now();
    for (const s of (data && data.sites) || []) {
      try {
        const ring = s.p ? s.p.map((p) => [p[0], p[1]]) : this.#compound(s.c);
        if (!ring) continue;
        this.#site(s.k, s.n, ring);
      } catch (err) {
        console.warn('[IZK] grounds site skipped', s.n, err);
      }
    }
    this.#buildFences();
    this.#buildGates();
    this.#buildParked();
    this.#buildFlags();
    this.ms = performance.now() - t0;
  }

  // standard police compound for a point-only station: 52 x 40 m set back
  // from its street, front fence parallel to the road
  #compound(c) {
    const near = this.roads.nearestRoad(c[0], c[1], 160, (r) => r.rank > 1 && !r.bridge);
    let dx = 0;
    let dz = 1;
    let cx = c[0];
    let cz = c[1];
    if (near) {
      const dl = Math.hypot(near.dirX, near.dirZ) || 1;
      dx = near.dirX / dl;
      dz = near.dirZ / dl;
      let nx = c[0] - near.x;
      let nz = c[1] - near.z;
      let nl = Math.hypot(nx, nz);
      if (nl < 0.5) {
        nx = dz;
        nz = -dx;
        nl = 1;
      }
      nx /= nl;
      nz /= nl;
      const off = near.road.width / 2 + 4 + 20; // pavement + half depth
      cx = near.x + nx * off;
      cz = near.z + nz * off;
    }
    const W = 26; // half width along road
    const D = 20; // half depth
    const px = dz;
    const pz = -dx;
    const ring = [
      [cx + dx * W + px * D, cz + dz * W + pz * D],
      [cx - dx * W + px * D, cz - dz * W + pz * D],
      [cx - dx * W - px * D, cz - dz * W - pz * D],
      [cx + dx * W - px * D, cz + dz * W - pz * D]
    ];
    if (ring.some((p) => this.hf.isWater(p[0], p[1]))) return null;
    return ring;
  }

  #site(kind, name, ring) {
    const n = ring.length;
    let cx = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p[0];
      cz += p[1];
    }
    cx /= n;
    cz /= n;
    // entrance: the boundary point nearest a usable street
    let best = null;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(L / 6));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        const near = this.roads.nearestRoad(x, z, 45, (r) => r.rank > 1 && !r.bridge);
        if (!near) continue;
        const d = near.dist - near.road.width / 2;
        if (!best || d < best.d) best = { d, i, t, x, z, near, L };
      }
    }
    const gate = best ? { seg: best.i, t: best.t, x: best.x, z: best.z, half: Math.min(4, best.L / 2 - 0.5) } : null;
    const site = { kind, name, ring, cx, cz, gate };
    this.sites.push(site);
    if (gate) {
      const a = ring[gate.seg];
      const b = ring[(gate.seg + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ux = (b[0] - a[0]) / L;
      const uz = (b[1] - a[1]) / L;
      // inward normal: towards the centre
      let nx = uz;
      let nz = -ux;
      if ((cx - gate.x) * nx + (cz - gate.z) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      gate.ux = ux;
      gate.uz = uz;
      gate.nx = nx;
      gate.nz = nz;
      this.gates.push(gate);
      // parking row along the fence beside the gate, one bay = 3 m
      const want = kind === 'police' ? 5 : kind === 'fire' ? 2 : kind === 'clinic' ? 4 : 7;
      let made = 0;
      for (let k = 0; k < 24 && made < want; k++) {
        const side = k % 2 ? -1 : 1;
        const along = side * (gate.half + 4 + Math.floor(k / 2) * 3);
        const x = gate.x + ux * along + nx * 7;
        const z = gate.z + uz * along + nz * 7;
        if (!this.#inside(ring, x, z) || this.hf.isWater(x, z)) continue;
        if (this.buildings && this.buildings.blocked && this.buildings.blocked(x, z, 2.6)) continue;
        const nr = this.roads.nearestRoad(x, z, 12);
        if (nr && nr.dist < nr.road.width / 2 + 2.5) continue;
        // nose to the fence, like real bays
        const yaw = Math.atan2(-nx, -nz);
        let type;
        let paint;
        if (kind === 'police') {
          type = 'saps';
          paint = null;
        } else if (kind === 'fire') {
          type = 'hilux';
          paint = 0xb71c1c;
        } else if (made < (kind === 'hospital' ? 2 : 1)) {
          type = 'quantum'; // ambulance
          paint = 0xf4f4f0;
        } else {
          type = ['polo', 'gusheshe', 'polo', 'hilux', 'quantum'][(k + Math.round(cx)) % 5];
          paint = [0xd8d8d4, 0x2d2f33, 0x8c1c1c, 0x1f3f73, 0xb9bcc0, 0xe9e5d8][(k * 7 + Math.round(cz)) % 6];
        }
        this.parked.push({ type, x, z, yaw, paint, y: this.hf.heightAt(x, z) });
        made++;
      }
      if (kind === 'police') {
        const fx = gate.x - ux * (gate.half + 2.5) + nx * 3;
        const fz = gate.z - uz * (gate.half + 2.5) + nz * 3;
        if (this.#inside(ring, fx, fz)) this.flags.push({ x: fx, z: fz, y: this.hf.heightAt(fx, fz), yaw: Math.atan2(ux, uz) });
      }
    }
  }

  #inside(ring, x, z) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  }

  #buildFences() {
    const pos = { police: [], other: [] };
    const uv = { police: [], other: [] };
    for (const site of this.sites) {
      const key = site.kind === 'police' ? 'police' : 'other';
      const P = pos[key];
      const U = uv[key];
      const ring = site.ring;
      const n = ring.length;
      let run = 0;
      for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.5) continue;
        const steps = Math.max(1, Math.ceil(L / 4));
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          const x0 = a[0] + (b[0] - a[0]) * t0;
          const z0 = a[1] + (b[1] - a[1]) * t0;
          const x1 = a[0] + (b[0] - a[0]) * t1;
          const z1 = a[1] + (b[1] - a[1]) * t1;
          const mx = (x0 + x1) / 2;
          const mz = (z0 + z1) / 2;
          const seg = (L * (t1 - t0));
          const u0 = run / PALE_M;
          run += seg;
          const u1 = run / PALE_M;
          // gate gap
          const g = site.gate;
          if (g && i === g.seg && Math.hypot(mx - g.x, mz - g.z) < g.half) continue;
          // gaps where a real road or lane crosses the boundary
          const nr = this.roads.nearestRoad(mx, mz, 14);
          if (nr && nr.dist < nr.road.width / 2 + 0.8) continue;
          if (this.hf.isWater(mx, mz)) continue;
          const y0 = this.hf.heightAt(x0, z0);
          const y1 = this.hf.heightAt(x1, z1);
          P.push(x0, y0, z0, x1, y1, z1, x1, y1 + FENCE_H, z1, x0, y0, z0, x1, y1 + FENCE_H, z1, x0, y0 + FENCE_H, z0);
          U.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
        }
      }
    }
    for (const key of ['police', 'other']) {
      if (!pos[key].length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos[key], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv[key], 2));
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({
        map: paliTexture(key === 'police' ? '#8f9496' : '#2f5d3a'),
        alphaTest: 0.5,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'palisade-' + key;
      this.group.add(mesh);
    }
    this.fenceQuads = (pos.police.length + pos.other.length) / 18;
  }

  #buildGates() {
    const gs = this.gates;
    if (!gs.length) return;
    const hut = new THREE.BoxGeometry(2.4, 2.6, 2.4);
    hut.translate(0, 1.3, 0);
    const roof = new THREE.BoxGeometry(3.0, 0.2, 3.0);
    roof.translate(0, 2.7, 0);
    const win = new THREE.BoxGeometry(2.45, 0.9, 1.6);
    win.translate(0, 1.6, 0);
    const post = new THREE.BoxGeometry(0.35, 1.1, 0.35);
    post.translate(0, 0.55, 0);
    const boom = new THREE.BoxGeometry(0.12, 0.12, 1);
    boom.translate(0, 1.0, 0.5);
    const parts = [
      [hut, new THREE.MeshLambertMaterial({ color: 0xe8e2d4 }), 'hut'],
      [roof, new THREE.MeshLambertMaterial({ color: 0x5b5e60 }), 'hut'],
      [win, new THREE.MeshLambertMaterial({ color: 0x1d2a33, emissive: 0x0b1a24 }), 'hut'],
      [post, new THREE.MeshLambertMaterial({ color: 0xf0c419 }), 'post'],
      [boom, new THREE.MeshLambertMaterial({ map: this.#stripeTex() }), 'boom']
    ];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const [geo, mat, what] of parts) {
      const mesh = new THREE.InstancedMesh(geo, mat, gs.length);
      gs.forEach((g, i) => {
        // hut just inside, beside the gap; boom spans the gap
        const yaw = Math.atan2(g.ux, g.uz);
        q.setFromAxisAngle(Y, yaw);
        s.set(1, 1, 1);
        if (what === 'hut') p.set(g.x + g.ux * (g.half + 2) + g.nx * 2, 0, g.z + g.uz * (g.half + 2) + g.nz * 2);
        else p.set(g.x + g.ux * g.half + g.nx * 0.5, 0, g.z + g.uz * g.half + g.nz * 0.5);
        if (what === 'boom') {
          q.setFromAxisAngle(Y, yaw + Math.PI);
          s.set(1, 1, g.half * 2);
        }
        p.y = this.hf.heightAt(p.x, p.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      });
      mesh.name = 'gate-' + what;
      this.group.add(mesh);
    }
  }

  #stripeTex() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#d32f2f';
      g.fillRect(0, i * 8, 4, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  #buildParked() {
    const by = new Map();
    for (const c of this.parked) {
      if (!by.has(c.type)) by.set(c.type, []);
      by.get(c.type).push(c);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    for (const [type, list] of by) {
      const model = trafficCarModel(type);
      if (!model) continue;
      for (const part of model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((c, i) => {
          q.setFromAxisAngle(Y, c.yaw);
          p.set(c.x, c.y, c.z);
          m.compose(p, q, one);
          mesh.setMatrixAt(i, m);
          if (part.paint) mesh.setColorAt(i, col.setHex(c.paint == null ? 0xf2f2f2 : c.paint));
        });
        mesh.name = 'grounds-parked-' + type;
        this.group.add(mesh);
      }
    }
  }

  #buildFlags() {
    if (!this.flags.length) return;
    const pole = new THREE.CylinderGeometry(0.06, 0.09, 8, 6);
    pole.translate(0, 4, 0);
    const flag = new THREE.PlaneGeometry(1.8, 1.2, 6, 1);
    // a gentle wave baked in
    const pa = flag.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setZ(i, Math.sin((pa.getX(i) + 0.9) * 2.6) * 0.12 * (pa.getX(i) + 0.9));
    flag.computeVertexNormals();
    flag.translate(0.98, 7.2, 0);
    const pm = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0xdedede }), this.flags.length);
    const fm = new THREE.InstancedMesh(flag, new THREE.MeshLambertMaterial({ map: saFlagTexture(), side: THREE.DoubleSide }), this.flags.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    this.flags.forEach((f, i) => {
      q.setFromAxisAngle(Y, f.yaw);
      p.set(f.x, f.y, f.z);
      m.compose(p, q, one);
      pm.setMatrixAt(i, m);
      fm.setMatrixAt(i, m);
    });
    pm.name = 'flagpoles';
    fm.name = 'flags';
    this.group.add(pm, fm);
  }

  // parked vehicles as solid obstacles for the player (x, z, radius)
  collide(x, z, r = 1.2) {
    for (const c of this.parked) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (r + 1.8) * (r + 1.8)) return c;
    }
    return null;
  }
}
