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
        this.#site(s.k, s.n, ring, s.t);
      } catch (err) {
        console.warn('[IZK] grounds site skipped', s.n, err);
      }
    }
    this.#buildFences();
    this.#buildGates();
    this.#buildParked();
    this.#buildFlags();
    try {
      this.#buildSchoolBoards();
    } catch (err) {
      console.warn('[IZK] school boards skipped', err);
    }
    try {
      this.#buildSigns();
    } catch (err) {
      console.warn('[IZK] hospital signs skipped', err);
    }
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

  #site(kind, name, ring, sub) {
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
    const site = { kind, name, ring, cx, cz, gate, sub };
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
      const want = kind === 'police' ? 5 : kind === 'fire' ? 2 : kind === 'clinic' || kind === 'school' ? 4 : 7;
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
        } else if (kind !== 'school' && made < (kind === 'hospital' ? 2 : 1)) {
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

  // Hospital + clinic dressing in one merged mesh on one small atlas:
  // a blue name board inside the gate, a blue "H" road sign at the kerb
  // and, at hospitals, a white casualty canopy with a red EMERGENCY fascia
  // on the main block's side facing the gate.
  #buildSigns() {
    const list = this.sites.filter((st) => (st.kind === 'hospital' || st.kind === 'clinic') && st.gate);
    if (!list.length) return;
    const AW = 1024, SW = 256, SH = 64, COLS = 4;
    const c = document.createElement('canvas');
    c.width = AW;
    c.height = AW;
    const g = c.getContext('2d');
    const slotUV = (k, sq) => {
      const x = (k % COLS) * SW, y = Math.floor(k / COLS) * SH;
      const w = sq ? SH : SW;
      return [(x + 1) / AW, 1 - (y + SH - 1) / AW, (x + w - 1) / AW, 1 - (y + 1) / AW];
    };
    const slotXY = (k) => [(k % COLS) * SW, Math.floor(k / COLS) * SH];
    const BLUE = '#1d4f9e';
    const hMark = (x, y, sz) => {
      g.fillStyle = '#ffffff';
      g.fillRect(x, y, sz, sz);
      g.fillStyle = BLUE;
      const b = sz * 0.16;
      g.fillRect(x + sz * 0.22, y + sz * 0.18, b, sz * 0.64);
      g.fillRect(x + sz * 0.78 - b, y + sz * 0.18, b, sz * 0.64);
      g.fillRect(x + sz * 0.22, y + sz * 0.42, sz * 0.56, b);
    };
    const MAXN = 59;
    const names = list.slice(0, MAXN);
    names.forEach((st, k) => {
      const [x, y] = slotXY(k);
      g.fillStyle = BLUE;
      g.fillRect(x, y, SW, SH);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.strokeRect(x + 2, y + 2, SW - 4, SH - 4);
      hMark(x + 8, y + 10, 44);
      let name = (st.name || (st.kind === 'clinic' ? 'Clinic' : 'Hospital')).replace(/\s*-\s*Casualty$/i, '');
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      let fs = 22;
      g.font = `bold ${fs}px sans-serif`;
      const maxW = SW - 66;
      const words = name.split(' ');
      // one line if it fits, else two lines
      if (g.measureText(name).width <= maxW) {
        g.fillText(name, x + 60, y + SH / 2);
      } else {
        let l1 = '', l2 = '';
        for (const w of words) {
          if (!l2 && g.measureText((l1 + ' ' + w).trim()).width <= maxW) l1 = (l1 + ' ' + w).trim();
          else l2 = (l2 + ' ' + w).trim();
        }
        fs = 17;
        g.font = `bold ${fs}px sans-serif`;
        while (fs > 10 && Math.max(g.measureText(l1).width, g.measureText(l2).width) > maxW) {
          fs--;
          g.font = `bold ${fs}px sans-serif`;
        }
        g.fillText(l1, x + 60, y + SH / 2 - fs * 0.6);
        g.fillText(l2, x + 60, y + SH / 2 + fs * 0.6);
      }
      st.slot = k;
    });
    const H = 60, EMER = 61, GREY = 62, WHITEK = 63;
    {
      const [x, y] = slotXY(H);
      g.fillStyle = BLUE;
      g.fillRect(x, y, SH, SH);
      hMark(x + 8, y + 8, SH - 16);
    }
    {
      const [x, y] = slotXY(EMER);
      g.fillStyle = '#c62828';
      g.fillRect(x, y, SW, SH);
      g.fillStyle = '#ffffff';
      g.font = 'bold 34px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('EMERGENCY', x + SW / 2, y + SH / 2 + 1);
      g.textAlign = 'left';
    }
    {
      let [x, y] = slotXY(GREY);
      g.fillStyle = '#6d7276';
      g.fillRect(x, y, SW, SH);
      [x, y] = slotXY(WHITEK);
      g.fillStyle = '#f2f1ec';
      g.fillRect(x, y, SW, SH);
    }
    const P = [], N = [], U = [];
    const quad = (cx, cy, cz, _rx, _rz, w, h, fx, fy, fz, uv) => {
      // upright quad at centre, facing (fx, fz); right as seen by its viewer
      const rx = fz, rz = -fx;
      const hw = w / 2, hh = h / 2;
      const a = [cx - rx * hw, cy - hh, cz - rz * hw];
      const b = [cx + rx * hw, cy - hh, cz + rz * hw];
      const c2 = [cx + rx * hw, cy + hh, cz + rz * hw];
      const d = [cx - rx * hw, cy + hh, cz - rz * hw];
      for (const v of [a, b, c2, a, c2, d]) P.push(v[0], v[1], v[2]);
      for (let i = 0; i < 6; i++) N.push(fx, fy, fz);
      const [u0, v0, u1, v1] = uv;
      U.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    };
    const flat = (cx, cy, cz, ax, az, w, d, up, uv) => {
      // horizontal quad: w along (ax, az), d along its normal
      const bx = -az, bz = ax;
      const s2 = up ? 1 : -1;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [cx + ax * (w / 2) * i + bx * (d / 2) * j, cy, cz + az * (w / 2) * i + bz * (d / 2) * j]);
      const order = up ? [0, 3, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3];
      for (const k of order) P.push(pts[k][0], pts[k][1], pts[k][2]);
      for (let i = 0; i < 6; i++) N.push(0, s2, 0);
      const [u0, v0, u1, v1] = uv;
      for (let i = 0; i < 6; i++) U.push((u0 + u1) / 2, (v0 + v1) / 2);
    };
    const box = (cx, y0, cz, ax, az, w, d, h, uv) => {
      // upright box: w along (ax, az), d across
      const bx = -az, bz = ax, cy = y0 + h / 2;
      quad(cx + bx * (d / 2), cy, cz + bz * (d / 2), -ax, -az, w, h, bx, 0, bz, uv);
      quad(cx - bx * (d / 2), cy, cz - bz * (d / 2), ax, az, w, h, -bx, 0, -bz, uv);
      quad(cx + ax * (w / 2), cy, cz + az * (w / 2), bx, bz, d, h, ax, 0, az, uv);
      quad(cx - ax * (w / 2), cy, cz - az * (w / 2), -bx, -bz, d, h, -ax, 0, -az, uv);
      flat(cx, y0 + h, cz, ax, az, w, d, true, uv);
      flat(cx, y0, cz, ax, az, w, d, false, uv);
    };
    const grey = slotUV(GREY), white = slotUV(WHITEK);
    let canopies = 0;
    for (const st of list) {
      const gt = st.gate;
      const ox = -gt.nx, oz = -gt.nz; // outward, toward the street
      // name board just inside the fence beside the gate, facing the street
      if (st.slot != null) {
        const bx = gt.x + gt.ux * (gt.half + 7) + gt.nx * 1.4;
        const bz = gt.z + gt.uz * (gt.half + 7) + gt.nz * 1.4;
        const y = this.hf.heightAt(bx, bz);
        // right-hand direction for a viewer facing the board from the street
        const rx = oz, rz = -ox;
        quad(bx + ox * 0.06, y + 1.9, bz + oz * 0.06, -rx, -rz, 4, 1, ox, 0, oz, slotUV(st.slot));
        quad(bx - ox * 0.06, y + 1.9, bz - oz * 0.06, rx, rz, 4, 1, -ox, 0, -oz, grey);
        box(bx + rx * 1.7, y, bz + rz * 1.7, rx, rz, 0.12, 0.1, 2.4, grey);
        box(bx - rx * 1.7, y, bz - rz * 1.7, rx, rz, 0.12, 0.1, 2.4, grey);
      }
      // blue H road sign on the kerb outside, readable both ways along the street
      {
        const hx = gt.x - gt.ux * (gt.half + 6) + ox * 3.5;
        const hz = gt.z - gt.uz * (gt.half + 6) + oz * 3.5;
        const y = this.hf.heightAt(hx, hz);
        if (!this.roads.nearestRoad || !(() => { const r = this.roads.nearestRoad(hx, hz, 12); return r && r.dist < r.road.width / 2 + 0.3; })()) {
          box(hx, y, hz, gt.ux, gt.uz, 0.08, 0.08, 2.6, grey);
          const huv = slotUV(H, true);
          // faces +u and -u
          quad(hx + gt.ux * 0.05, y + 2.55, hz + gt.uz * 0.05, -gt.nx, -gt.nz, 0.8, 0.8, gt.ux, 0, gt.uz, huv);
          quad(hx - gt.ux * 0.05, y + 2.55, hz - gt.uz * 0.05, gt.nx, gt.nz, 0.8, 0.8, -gt.ux, 0, -gt.uz, huv);
        }
      }
      // casualty canopy on the biggest block, on its side facing the gate
      if (st.kind === 'hospital' && this.buildings && this.buildings.forEachIn) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const [x, z] of st.ring) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          z0 = Math.min(z0, z);
          z1 = Math.max(z1, z);
        }
        let best = null;
        this.buildings.forEachIn(x0, z0, x1, z1, (i, type, x, z, A) => {
          if (A > 300 && this.#inside(st.ring, x, z) && (!best || A > best.A)) best = { x, z, A };
        });
        if (best) {
          let dx = gt.x - best.x, dz = gt.z - best.z;
          const L = Math.hypot(dx, dz) || 1;
          dx /= L;
          dz /= L;
          // walk out from the block's centre to its wall facing the gate
          let edge = -1;
          for (let t = Math.min(L - 8, Math.sqrt(best.A) + 10); t > 0; t -= 0.5) {
            if (this.buildings.blocked(best.x + dx * t, best.z + dz * t, 0.3)) {
              edge = t;
              break;
            }
          }
          const reach = edge + 3.6;
          if (edge > 0 && reach < L - 5) {
            const cx = best.x + dx * reach, cz = best.z + dz * reach;
            if (!this.buildings.blocked(cx + dx * 1.5, cz + dz * 1.5, 2)) {
              const y = this.hf.heightAt(cx, cz);
              const ax = -dz, az = dx; // canopy width runs across the approach
              box(cx, y + 4.0, cz, ax, az, 10, 7, 0.4, white);
              quad(cx + dx * 3.52, y + 4.2, cz + dz * 3.52, -ax, -az, 10, 0.75, dx, 0, dz, slotUV(EMER));
              for (const sx of [-4.6, 4.6]) {
                const px = cx + ax * sx + dx * 3.1, pz = cz + az * sx + dz * 3.1;
                box(px, this.hf.heightAt(px, pz), pz, ax, az, 0.3, 0.3, 4.0 + y - this.hf.heightAt(px, pz), white);
              }
              canopies++;
              (this.canopyAt || (this.canopyAt = [])).push([cx, cz, dx, dz, y]);
            }
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    mesh.name = 'hospital-signs';
    this.group.add(mesh);
    this.signStats = { boards: names.length, canopies };
  }

  // School name boards. ~460 schools is too many names for one small
  // texture, so the 30 nearest named schools get their real name painted
  // into a 32-slot atlas (redrawn as you drive); the rest show "SCHOOL".
  #buildSchoolBoards() {
    const list = this.sites.filter((st) => st.kind === 'school' && st.gate);
    if (!list.length) return;
    const AW = 1024, SW = 256, SH = 64, COLS = 4, SLOTS = 30, GENERIC = 30, GREY = 31;
    const c = document.createElement('canvas');
    c.width = AW;
    c.height = 512;
    const g = c.getContext('2d');
    this.schoolCanvas = c;
    this.schoolCtx = g;
    const uvOf = (k) => {
      const x = (k % COLS) * SW, y = Math.floor(k / COLS) * SH;
      return [(x + 1) / AW, 1 - (y + SH - 1) / 512, (x + SW - 1) / AW, 1 - (y + 1) / 512];
    };
    this.schoolUV = uvOf;
    const COLORS = ['#7a1f2b', '#13315c', '#1f5c3a', '#4a2a6b', '#0f4c5c', '#8a4b0f'];
    this.schoolPaint = (k, st) => {
      const x = (k % COLS) * SW, y = Math.floor(k / COLS) * SH;
      let hsh = 0;
      for (const ch of st ? st.name : 'S') hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
      const col = st ? COLORS[hsh % COLORS.length] : '#13315c';
      g.fillStyle = col;
      g.fillRect(x, y, SW, SH);
      g.strokeStyle = '#f2d16b';
      g.lineWidth = 3;
      g.strokeRect(x + 3, y + 3, SW - 6, SH - 6);
      // crest: a small gold shield
      g.fillStyle = '#f2d16b';
      g.beginPath();
      g.moveTo(x + 12, y + 12);
      g.lineTo(x + 46, y + 12);
      g.lineTo(x + 46, y + 34);
      g.quadraticCurveTo(x + 46, y + 48, x + 29, y + 54);
      g.quadraticCurveTo(x + 12, y + 48, x + 12, y + 34);
      g.closePath();
      g.fill();
      g.fillStyle = col;
      g.fillRect(x + 27, y + 17, 4, 30);
      g.fillRect(x + 18, y + 25, 22, 4);
      g.fillStyle = '#ffffff';
      g.textBaseline = 'middle';
      const name = st ? st.name : 'SCHOOL';
      const maxW = SW - 64;
      let fs = 21;
      g.font = `bold ${fs}px sans-serif`;
      if (g.measureText(name).width <= maxW) {
        g.fillText(name, x + 56, y + SH / 2);
        return;
      }
      let l1 = '', l2 = '';
      for (const w of name.split(' ')) {
        if (!l2 && g.measureText((l1 + ' ' + w).trim()).width <= maxW) l1 = (l1 + ' ' + w).trim();
        else l2 = (l2 + ' ' + w).trim();
      }
      fs = 16;
      g.font = `bold ${fs}px sans-serif`;
      while (fs > 9 && Math.max(g.measureText(l1).width, g.measureText(l2).width) > maxW) {
        fs--;
        g.font = `bold ${fs}px sans-serif`;
      }
      g.fillText(l1, x + 56, y + SH / 2 - fs * 0.6);
      g.fillText(l2, x + 56, y + SH / 2 + fs * 0.6);
    };
    this.schoolPaint(GENERIC, null);
    {
      const x = (GREY % COLS) * SW, y = Math.floor(GREY / COLS) * SH;
      g.fillStyle = '#5f6468';
      g.fillRect(x, y, SW, SH);
    }
    const P = [], N = [], U = [];
    const quad = (cx, cy, cz, w, h, fx, fz, uv) => {
      const rx = fz, rz = -fx, hw = w / 2, hh = h / 2;
      const a = [cx - rx * hw, cy - hh, cz - rz * hw], b = [cx + rx * hw, cy - hh, cz + rz * hw];
      const c2 = [cx + rx * hw, cy + hh, cz + rz * hw], d = [cx - rx * hw, cy + hh, cz - rz * hw];
      const at = U.length;
      for (const v of [a, b, c2, a, c2, d]) P.push(v[0], v[1], v[2]);
      for (let i = 0; i < 6; i++) N.push(fx, 0, fz);
      const [u0, v0, u1, v1] = uv;
      U.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      return at;
    };
    const grey = uvOf(GREY), gen = uvOf(GENERIC);
    this.schoolBoards = [];
    for (const st of list) {
      const gt = st.gate;
      const ox = -gt.nx, oz = -gt.nz;
      const bx = gt.x + gt.ux * (gt.half + 6) + gt.nx * 1.4;
      const bz = gt.z + gt.uz * (gt.half + 6) + gt.nz * 1.4;
      const y = this.hf.heightAt(bx, bz);
      const rx = oz, rz = -ox;
      const at = quad(bx + ox * 0.06, y + 1.9, bz + oz * 0.06, 3.6, 0.9, ox, oz, gen);
      quad(bx - ox * 0.06, y + 1.9, bz - oz * 0.06, 3.6, 0.9, -ox, -oz, grey);
      for (const sd of [-1.55, 1.55]) {
        const px = bx + rx * sd, pz = bz + rz * sd;
        // two faces per post is enough at this size
        quad(px + ox * 0.05, y + 1.2, pz + oz * 0.05, 0.1, 2.4, ox, oz, grey);
        quad(px - ox * 0.05, y + 1.2, pz - oz * 0.05, 0.1, 2.4, -ox, -oz, grey);
      }
      if (st.name) this.schoolBoards.push({ st, at, x: bx, z: bz, slot: -1 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.schoolTex = tex;
    this.schoolGeo = geo;
    this.schoolSlots = new Array(SLOTS).fill(null);
    this.schoolT = -1e9;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    mesh.name = 'school-boards';
    this.group.add(mesh);
  }

  // keep the nearest named schools' boards showing their real names
  update(x, z) {
    if (!this.schoolBoards || !this.schoolBoards.length) return;
    const now = performance.now();
    if (now - this.schoolT < 1500) return;
    this.schoolT = now;
    const bs = this.schoolBoards;
    for (const b of bs) b.d = (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z);
    const near = bs.slice().sort((a, b) => a.d - b.d).slice(0, this.schoolSlots.length);
    const keep = new Set(near);
    const uv = this.schoolGeo.attributes.uv;
    const setUV = (b, k) => {
      const [u0, v0, u1, v1] = this.schoolUV(k);
      const q = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
      for (let i = 0; i < 12; i++) uv.array[b.at + i] = q[i];
    };
    let dirty = false;
    // free slots of boards that left the nearest set
    this.schoolSlots.forEach((b, k) => {
      if (b && !keep.has(b)) {
        b.slot = -1;
        setUV(b, 30);
        this.schoolSlots[k] = null;
        dirty = true;
      }
    });
    for (const b of near) {
      if (b.slot >= 0) continue;
      const k = this.schoolSlots.indexOf(null);
      if (k < 0) break;
      this.schoolSlots[k] = b;
      b.slot = k;
      this.schoolPaint(k, b.st);
      setUV(b, k);
      dirty = true;
    }
    if (dirty) {
      uv.needsUpdate = true;
      this.schoolTex.needsUpdate = true;
    }
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
