import * as THREE from '../../vendor/three/three.module.js';
import { toXZ, placeAt } from '../core/geo.js';
import { KERB_H, WALK_W, specFor } from './roads.js';
import { tiledSignMaterial } from './props.js';

// SA direction boards (SARTSM style), generated from the real road network:
//  - green freeway exit boards ~300 m before each OSM motorway exit, naming the
//    street the off-ramp reaches and the suburb it serves
//  - green route-confirmation boards along the N2 / N3 / M4 (route shield +
//    real destinations in the direction of travel)
//  - blue (or green, when a freeway branch is involved) junction boards ~100 m
//    before major junctions: one row per branch with arrow, real street name
//    (New (Old) names from OSM) and the destination that lies that way.
// Lean on the phone: boards are 3 instanced meshes (face, backing, posts); the
// faces share one 2048x1024 canvas atlas with 16 slots, only the nearest
// boards get a slot and get drawn. NOTE: loops only (no spread of big arrays).

const SLOTS_X = 4;
const SLOTS_Y = 4;
const SLOTS = SLOTS_X * SLOTS_Y;
const SW = 512;
const SH = 256;
const VIEW = 480; // m: boards drawn within this distance
const GRID = 400;
const REFILL_MOVE = 30;

// Real destinations used on boards (lon, lat). far = shown first when it fits.
const DESTS = [
  ['Durban CBD', 31.0218, -29.8587],
  ['Umhlanga', 31.0849, -29.7256],
  ['Pinetown', 30.857, -29.817],
  ['King Shaka Airport', 31.1197, -29.6144],
  ['Westville', 30.9246, -29.8357],
  ['Pietermaritzburg', 30.3794, -29.6006],
  ['Amanzimtoti', 30.8812, -30.0503],
  ['Umlazi', 30.88, -29.97],
  ['Chatsworth', 30.8853, -29.9122],
  ['Durban North', 31.03, -29.79],
  ['KwaMashu', 30.9806, -29.7466],
  ['Phoenix', 30.975, -29.7056],
  ['Bluff', 31.017, -29.933],
  ['Isipingo', 30.937, -29.993],
  ['Berea', 31.0, -29.85],
  ['Beachfront', 31.039, -29.86],
  ['Harbour', 31.035, -29.875],
  ['Ballito', 31.214, -29.539],
  ['Port Shepstone', 30.4549, -30.7414]
].map((d) => {
  const [x, z] = toXZ(d[1], d[2]);
  return { name: d[0], x, z };
});

function destsToward(x, z, dx, dz, n, minD = 1800, maxD = 1e9) {
  const c = [];
  for (const d of DESTS) {
    const vx = d.x - x;
    const vz = d.z - z;
    const L = Math.hypot(vx, vz);
    if (L < minD || L > maxD) continue;
    const cos = (vx * dx + vz * dz) / L;
    if (cos < 0.8) continue; // within ~37 degrees
    c.push({ name: d.name, L, cos });
  }
  c.sort((a, b) => b.cos - a.cos);
  const out = c.slice(0, n);
  out.sort((a, b) => b.L - a.L);
  return out.map((d) => d.name);
}

const SKIP_CLS = { track: 1, service: 1, path: 1, footway: 1, cycleway: 1, pedestrian: 1 };
function shortName(road) {
  const n = road.newName || road.name || road.ref || '';
  return /\d{3,}/.test(n) && !/^[NMR]\d/.test(n) ? '' : n;
}

// point `dist` m along a piece starting at the node end e
function alongFrom(e, dist) {
  const s = e.pc.s;
  if (e.atStart) {
    for (let i = 0; i < s.m; i++) if (s.ds[i] >= dist) return i;
    return s.m - 1;
  }
  const L = s.ds[s.m - 1];
  for (let i = s.m - 1; i >= 0; i--) if (L - s.ds[i] >= dist) return i;
  return 0;
}

export class DirSigns {
  constructor({ roads, features }) {
    this.roads = roads;
    this.group = new THREE.Group();
    this.group.name = 'direction-signs';
    this.boards = [];
    this.grid = new Map();
    this.lastFill = { x: 1e9, z: 1e9 };
    this.slotOf = new Map(); // board -> slot
    this.slotBoard = new Array(SLOTS).fill(null);
    try {
      this.#genExits(features || []);
      this.#genConfirm();
      this.#genJunctions();
    } catch (err) {
      console.warn('[IZK] direction signs failed', err);
    }
    for (const b of this.boards) {
      const k = Math.floor(b.x / GRID) * 100000 + Math.floor(b.z / GRID);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(b);
    }
    this.stats = { boards: this.boards.length };

    this.canvas = document.createElement('canvas');
    this.canvas.width = SW * SLOTS_X;
    this.canvas.height = SH * SLOTS_Y;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY; // GPU max (main.js)

    const faceGeo = new THREE.PlaneGeometry(1, 1);
    faceGeo.translate(0, 0, 0.07);
    this.tile = new Float32Array(SLOTS * 2);
    faceGeo.setAttribute('aTile', new THREE.InstancedBufferAttribute(this.tile, 2));
    const faceMat = tiledSignMaterial(this.tex, 1 / SLOTS_X, 1 / SLOTS_Y);
    faceMat.alphaTest = 0;
    faceMat.side = THREE.FrontSide;
    this.faces = new THREE.InstancedMesh(faceGeo, faceMat, SLOTS);
    const backGeo = new THREE.BoxGeometry(1, 1, 0.1);
    this.backs = new THREE.InstancedMesh(backGeo, new THREE.MeshLambertMaterial({ color: 0x6d7276 }), SLOTS);
    const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 6);
    postGeo.translate(0, 0.5, 0);
    this.posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x8f969b }), SLOTS * 2);
    for (const m of [this.faces, this.backs, this.posts]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  #add(b) {
    if (!b.rows.length) return;
    this.boards.push(b);
  }

  // a board at index i of piece pc, left of traffic travelling `dir`
  #board(pc, i, dir, kind, color, rows, extra = {}) {
    const s = pc.s;
    const j = Math.min(s.m - 1, i + 1) === i ? i - 1 : i + 1;
    let tx = (s.xs[j] - s.xs[i]) * (j > i ? 1 : -1) * dir;
    let tz = (s.zs[j] - s.zs[i]) * (j > i ? 1 : -1) * dir;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const fw = pc.road.rank >= 8 || pc.road.cls.endsWith('_link');
    const walk = !!specFor(pc.road.cls).walk;
    const w = fw ? 6.4 : 4.2;
    const h = w / 2;
    const off = pc.hw + (walk ? WALK_W * 0.6 : 1.2) + w * 0.5 + (fw ? 1.2 : 0.2);
    this.#add(Object.assign({
      x: s.xs[i] + tz * off,
      z: s.zs[i] - tx * off,
      y: s.ys[i] + (walk ? KERB_H : -0.1),
      yaw: Math.atan2(-tx, -tz),
      w,
      h,
      lift: fw ? 2.6 : 2.2,
      kind,
      color,
      rows
    }, extra));
  }

  // ---- 1. motorway exits --------------------------------------------------
  #genExits(features) {
    const nodes = [];
    for (const n of this.roads.rnodes.values()) {
      if (n.ends.length < 3) continue;
      let link = null;
      let main = null;
      for (const e of n.ends) {
        const c = e.pc.road.cls;
        if ((c === 'motorway_link' || c === 'trunk_link') && e.atStart) link = e;
        else if ((c === 'motorway' || c === 'trunk') && !e.atStart && e.pc.road.oneway) main = e;
      }
      if (link && main) nodes.push({ n, link, main });
    }
    for (const f of features) {
      if (f.k !== 'exit') continue;
      let best = null;
      let bd = 40;
      for (const c of nodes) {
        const d = Math.hypot(c.n.x - f.x, c.n.z - f.z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (!best || best.used) continue;
      best.used = true;
      // follow the off-ramp to where it meets the street network
      let pc = best.link.pc;
      for (let hop = 0; hop < 10; hop++) {
        let nxt = null;
        for (const e of pc.nB.ends) if (e.atStart && e.pc !== pc && e.pc.road.cls === pc.road.cls) nxt = e.pc;
        if (!nxt) break;
        pc = nxt;
      }
      const end = pc.nB;
      let street = null;
      for (const e of end.ends) {
        const r = e.pc.road;
        if (r.cls.endsWith('_link') || r.rank >= 9) continue;
        if (!shortName(r)) continue;
        if (!street || r.rank > street.rank) street = r;
      }
      const place = placeAt(end.x, end.z);
      const rows = [];
      const name = f.name || (street ? shortName(street) : '');
      if (name) rows.push({ text: name, sub: street && street.oldName && name === street.newName ? `(${street.oldName})` : '' });
      if (place && place.kind !== 'wild' && place.name !== name) rows.push({ text: place.name });
      if (!rows.length) continue;
      if (street && street.ref && street.ref !== name) rows[0].shield = street.ref.split(';')[0];
      // board ~300 m before the gore, walking back along the carriageway
      let e = best.main;
      let D = 300;
      for (let hop = 0; hop < 8 && e.pc.len < D + 10; hop++) {
        let prev = null;
        for (const p of e.pc.nA.ends) if (!p.atStart && p.pc !== e.pc && p.pc.road.cls === e.pc.road.cls) prev = p;
        if (!prev) break;
        D -= e.pc.len;
        e = prev;
      }
      if (e.pc.len < D) D = Math.max(20, e.pc.len - 10);
      const i = alongFrom(e, D);
      this.#board(e.pc, i, 1, 'exit', 'green', rows, { exitRef: f.ref || '' });
      // gore sign at the split itself
      const gi = alongFrom(best.main, Math.min(40, best.main.pc.len * 0.5));
      this.#board(best.main.pc, gi, 1, 'exit', 'green', [{ text: rows[0].text, arrow: 'upleft' }], { exitRef: f.ref || '', small: true });
    }
  }

  // ---- 2. freeway route confirmation --------------------------------------
  #genConfirm() {
    const SPACING = 2600;
    for (const pc of this.roads.pieces) {
      const r = pc.road;
      if (r.rank < 8 || !r.oneway || pc.elevated || !r.ref) continue;
      const ph = (r.ref.length * 733) % SPACING;
      const s = pc.s;
      for (let k = 1; k < s.m - 1; k++) {
        const d = pc.d0 + s.ds[k];
        const dp = pc.d0 + s.ds[k - 1];
        if (Math.floor((d + ph) / SPACING) === Math.floor((dp + ph) / SPACING)) continue;
        const dx = s.xs[Math.min(s.m - 1, k + 3)] - s.xs[k];
        const dz = s.zs[Math.min(s.m - 1, k + 3)] - s.zs[k];
        const L = Math.hypot(dx, dz) || 1;
        const names = destsToward(s.xs[k], s.zs[k], dx / L, dz / L, 2, 3000);
        if (!names.length) continue;
        const rows = [{ text: names[0], shield: r.ref.split(';')[0] }];
        if (names[1]) rows.push({ text: names[1] });
        this.#board(pc, k, 1, 'confirm', 'green', rows);
      }
    }
  }

  // ---- 3. major junction advance boards ------------------------------------
  #genJunctions() {
    for (const n of this.roads.rnodes.values()) {
      if (!n.junction || n.ends.length < 3) continue;
      let maxRank = 0;
      for (const e of n.ends) if (e.pc.road.rank > maxRank && !e.pc.road.cls.endsWith('_link')) maxRank = e.pc.road.rank;
      if (maxRank < 6 || maxRank >= 9) continue;
      for (const a of n.ends) {
        const pa = a.pc;
        const ra = pa.road;
        if (ra.rank < 6 || ra.rank >= 9 || pa.elevated || pa.len < 150) continue;
        if (ra.oneway && a.atStart) continue; // traffic leaves here
        const tx = -a.dx;
        const tz = -a.dz;
        const byDir = { left: null, ahead: null, right: null };
        let named = 0;
        for (const b of n.ends) {
          if (b === a) continue;
          const rb = b.pc.road;
          if (rb.oneway && !b.atStart) continue; // can't drive into it here
          if (SKIP_CLS[rb.cls] || rb.rank < 3) continue;
          const dot = b.dx * tx + b.dz * tz;
          const left = b.dx * tz - b.dz * tx;
          const dir = dot > 0.7 ? 'ahead' : left > 0 ? 'left' : 'right';
          if (dot < -0.6) continue; // U-turn
          const cur = byDir[dir];
          if (cur && cur.pc.road.rank >= rb.rank) continue;
          byDir[dir] = b;
        }
        const rows = [];
        let green = false;
        for (const dir of ['left', 'ahead', 'right']) {
          const b = byDir[dir];
          if (!b) continue;
          const rb = b.pc.road;
          const nm = shortName(rb);
          const sameRoad = nm && nm === shortName(ra);
          const i = alongFrom(b, Math.min(250, b.pc.len));
          const vx = b.pc.s.xs[i] - n.x;
          const vz = b.pc.s.zs[i] - n.z;
          const vl = Math.hypot(vx, vz) || 1;
          const dest = destsToward(n.x, n.z, vx / vl, vz / vl, 1, 1800, 16000)[0] || '';
          if (!nm && !dest) continue;
          if (rb.rank >= 8 || rb.cls.endsWith('_link')) green = true;
          const row = { arrow: dir, text: sameRoad ? dest || nm : nm || dest, sub: '' };
          if (!sameRoad && nm && dest) row.sub = dest;
          else if (!sameRoad && rb.oldName && nm === rb.newName) row.sub = `(${rb.oldName})`;
          if (rb.ref) row.shield = rb.ref.split(';')[0];
          if (!sameRoad) named++;
          rows.push(row);
        }
        if (named < 1 || rows.length < 2) continue;
        const i = alongFrom(a, 100);
        const dir = a.atStart ? -1 : 1;
        // travel direction along piece toward node: +1 if node is nB
        this.#board(pa, i, dir, 'junction', green ? 'green' : 'blue', rows);
      }
    }
  }

  // ---- drawing --------------------------------------------------------------
  #draw(slot, b) {
    const ctx = this.ctx;
    const x0 = (slot % SLOTS_X) * SW;
    const y0 = Math.floor(slot / SLOTS_X) * SH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, SW, SH);
    ctx.clip();
    ctx.fillStyle = b.color === 'green' ? '#0b6b3a' : '#1550a0';
    ctx.fillRect(x0, y0, SW, SH);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.strokeRect(x0 + 8, y0 + 8, SW - 16, SH - 16);
    let top = y0 + 18;
    if (b.kind === 'exit' && (b.exitRef || b.small)) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px Arial, sans-serif';
      const label = b.exitRef ? `EXIT ${b.exitRef}` : 'EXIT';
      const tw = ctx.measureText(label).width + 24;
      ctx.fillRect(x0 + SW - tw - 18, top, tw, 40);
      ctx.fillStyle = '#0b6b3a';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x0 + SW - tw - 6, top + 21);
      top += 44;
    }
    const n = b.rows.length;
    const rowH = Math.min(96, (y0 + SH - 18 - top) / n);
    for (let r = 0; r < n; r++) {
      const row = b.rows[r];
      const cy = top + rowH * (r + 0.5);
      let tx = x0 + 28;
      if (row.arrow) {
        this.#arrow(ctx, tx + 26, cy, row.arrow, Math.min(30, rowH * 0.36));
        tx += 66;
      }
      if (row.shield) {
        const fw = /^N/.test(row.shield);
        ctx.font = 'bold 30px Arial, sans-serif';
        const sw = ctx.measureText(row.shield).width + 18;
        ctx.fillStyle = fw ? '#ffd200' : '#ffffff';
        ctx.fillRect(tx, cy - 20, sw, 40);
        ctx.fillStyle = fw ? '#000000' : b.color === 'green' ? '#0b6b3a' : '#1550a0';
        ctx.textBaseline = 'middle';
        ctx.fillText(row.shield, tx + 9, cy + 1);
        tx += sw + 12;
      }
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      const maxW = x0 + SW - 24 - tx;
      const hasSub = !!row.sub && rowH >= 60;
      let fs = Math.min(46, rowH * (hasSub ? 0.46 : 0.58));
      ctx.font = `bold ${fs | 0}px Arial, sans-serif`;
      while (ctx.measureText(row.text).width > maxW && fs > 18) {
        fs -= 2;
        ctx.font = `bold ${fs | 0}px Arial, sans-serif`;
      }
      ctx.fillText(row.text, tx, hasSub ? cy - fs * 0.4 : cy + 1, maxW);
      if (hasSub) {
        ctx.font = `bold ${Math.max(18, fs * 0.72) | 0}px Arial, sans-serif`;
        ctx.fillText(row.sub, tx, cy + fs * 0.66, maxW);
      }
    }
    ctx.restore();
  }

  #arrow(ctx, x, y, dir, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir === 'left' ? -Math.PI / 2 : dir === 'right' ? Math.PI / 2 : dir === 'upleft' ? -Math.PI / 4 : 0);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.8, -s * 0.15);
    ctx.lineTo(s * 0.28, -s * 0.15);
    ctx.lineTo(s * 0.28, s);
    ctx.lineTo(-s * 0.28, s);
    ctx.lineTo(-s * 0.28, -s * 0.15);
    ctx.lineTo(-s * 0.8, -s * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---- streaming -----------------------------------------------------------
  update(camX, camZ) {
    if (Math.hypot(camX - this.lastFill.x, camZ - this.lastFill.z) < REFILL_MOVE) return;
    this.lastFill.x = camX;
    this.lastFill.z = camZ;
    const near = [];
    const g0x = Math.floor(camX / GRID);
    const g0z = Math.floor(camZ / GRID);
    const R = Math.ceil(VIEW / GRID);
    for (let gz = g0z - R; gz <= g0z + R; gz++) {
      for (let gx = g0x - R; gx <= g0x + R; gx++) {
        const l = this.grid.get(gx * 100000 + gz);
        if (!l) continue;
        for (const b of l) {
          const d = Math.hypot(b.x - camX, b.z - camZ);
          if (d < VIEW) near.push({ b, d });
        }
      }
    }
    near.sort((a, b) => a.d - b.d);
    if (near.length > SLOTS) near.length = SLOTS;
    const keep = new Set();
    for (const it of near) keep.add(it.b);
    for (let s = 0; s < SLOTS; s++) {
      const b = this.slotBoard[s];
      if (b && !keep.has(b)) {
        this.slotBoard[s] = null;
        this.slotOf.delete(b);
      }
    }
    let drew = false;
    for (const it of near) {
      if (this.slotOf.has(it.b)) continue;
      const s = this.slotBoard.indexOf(null);
      if (s < 0) break;
      this.slotBoard[s] = it.b;
      this.slotOf.set(it.b, s);
      this.#draw(s, it.b);
      drew = true;
    }
    if (drew) this.tex.needsUpdate = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    let pn = 0;
    for (const it of near) {
      const b = it.b;
      const s = this.slotOf.get(b);
      if (s === undefined) continue;
      const w = b.small ? b.w * 0.6 : b.w;
      const h = b.small ? b.h * 0.6 : b.h;
      q.setFromAxisAngle(up, b.yaw);
      const cy = b.y + b.lift + h / 2;
      p.set(b.x, cy, b.z);
      sc.set(w, h, 1);
      m.compose(p, q, sc);
      this.faces.setMatrixAt(n, m);
      sc.set(w + 0.12, h + 0.12, 1);
      m.compose(p, q, sc);
      this.backs.setMatrixAt(n, m);
      this.tile[n * 2] = (s % SLOTS_X) / SLOTS_X;
      this.tile[n * 2 + 1] = 1 - (Math.floor(s / SLOTS_X) + 1) / SLOTS_Y;
      n++;
      // two posts behind the board
      const rx = Math.cos(b.yaw);
      const rz = -Math.sin(b.yaw);
      const bx = -Math.sin(b.yaw) * 0.12;
      const bz = -Math.cos(b.yaw) * 0.12;
      for (const sg of [-0.33, 0.33]) {
        p.set(b.x + rx * w * sg + bx, b.y - 0.3, b.z + rz * w * sg + bz);
        sc.set(1, b.lift + h + 0.3, 1);
        m.compose(p, q, sc);
        this.posts.setMatrixAt(pn++, m);
      }
    }
    this.faces.count = n;
    this.backs.count = n;
    this.posts.count = pn;
    this.faces.instanceMatrix.needsUpdate = true;
    this.faces.geometry.attributes.aTile.needsUpdate = true;
    this.backs.instanceMatrix.needsUpdate = true;
    this.posts.instanceMatrix.needsUpdate = true;
  }
}
