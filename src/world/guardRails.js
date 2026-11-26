import * as THREE from '../../vendor/three/three.module.js';
import { toXZ } from '../core/geo.js';
import { specFor, WALK_W, CHUNK } from './roads.js';
import { GUARD_RAILS } from './guardRailData.js';

// Steel W-beam guard rails (SA "Armco"): galvanised W-profile beam on
// spacer blocks and I-posts every 2 m, turned-down ends.
// Where they go:
//  1. Real rails: OSM barrier=guard_rail ways and rails seen on Mapillary
//     street photos (guardRailData.js, built by scripts/build-guardrails.py).
//  2. By rule, where SANRAL / eThekwini put them:
//     - along raised approaches and embankments next to bridges (both sides),
//     - on the first 40 m of road leaving a bridge on arterials and freeways,
//     - on the outside of tight freeway / ramp curves,
//     - on freeways and rural main roads where the ground drops away steeply.
// Geometry is built per 400 m chunk near the camera (one merged mesh = one
// draw call per chunk) and thrown away again further out.

const STEP = 2; // post spacing (m)
const BUILD_IN = 640;
const DROP_OUT = 820;
const END = 4; // turned-down terminal length (m)
const FWY = { motorway: 1, trunk: 1, motorway_link: 1, trunk_link: 1 };
const LINK = { motorway_link: 1, trunk_link: 1, primary_link: 1, secondary_link: 1 };

// W-beam cross-section: u = toward traffic (m), v = height above the road.
const PROF = [
  [0.0, 0.43],
  [0.075, 0.465],
  [0.095, 0.52],
  [0.04, 0.595],
  [0.095, 0.67],
  [0.075, 0.725],
  [0.0, 0.76]
];
// 2D normals (pointing to +u) per profile vertex
const PN = PROF.map((p, i) => {
  let nu = 0;
  let nv = 0;
  for (const [a, b] of [[i - 1, i], [i, i + 1]]) {
    if (a < 0 || b >= PROF.length) continue;
    const du = PROF[b][0] - PROF[a][0];
    const dv = PROF[b][1] - PROF[a][1];
    const l = Math.hypot(du, dv) || 1;
    nu += dv / l;
    nv += -du / l;
  }
  const l = Math.hypot(nu, nv) || 1;
  return [nu / l, nv / l];
});

// guardrail_galv_512.jpg: galvanised-spangle texture drawn in code by
// scripts/build-guardrail-texture.py (CC0, this project).
let railTex = null;
function texture() {
  if (railTex) return railTex;
  railTex = new THREE.TextureLoader().load('./src/assets/textures/guardrail_galv_512.jpg');
  railTex.wrapS = railTex.wrapT = THREE.RepeatWrapping;
  railTex.colorSpace = THREE.SRGBColorSpace;
  railTex.anisotropy = 4;
  return railTex;
}

export class GuardRails {
  constructor(roads) {
    this.roads = roads;
    this.hf = roads.hf;
    this.group = new THREE.Group();
    this.group.name = 'guardRails';
    this.mat = new THREE.MeshLambertMaterial({ map: texture(), vertexColors: true, side: THREE.DoubleSide });
    this.lines = []; // { pts: Float32Array [x,y,z,nx,nz,...], n, src }
    this.chunks = new Map();
    this.grid = new Map();
    this.stats = { osm: 0, mapillary: 0, rule: 0, metres: 0 };
    const t0 = performance.now();
    try {
      this.#fromData();
    } catch (e) {
      console.warn('guard rails: data', e);
    }
    for (const L of this.lines) this.#index(L);
    // Rails by rule are worked out a few pieces per frame (nearest first) in
    // update(), so start-up stays quick on budget phones.
    this.queue = null;
    this.ms = performance.now() - t0;
  }

  #ruleStep(camX, camZ, ms) {
    if (!this.queue) {
      this.queue = this.roads.pieces
        .filter((pc) => !pc.bridge && pc.s && pc.s.m >= 2)
        .map((pc) => ({ pc, d: Math.hypot(pc.s.xs[0] - camX, pc.s.zs[0] - camZ) }))
        .sort((a, b) => b.d - a.d)
        .map((q) => q.pc); // nearest last (pop)
    }
    const t1 = performance.now() + ms;
    const n0 = this.lines.length;
    try {
      while (this.queue.length && performance.now() < t1) this.#rulePiece(this.queue.pop());
    } catch (e) {
      console.warn('guard rails: rules', e);
      this.queue.length = 0;
    }
    for (let k = n0; k < this.lines.length; k++) this.#index(this.lines[k]);
    if (!this.queue.length) this.queue = false;
  }

  // ---- real rails (OSM + Mapillary) -----------------------------------------
  #fromData() {
    const add = (ll, src) => {
      const xz = ll.map(([lo, la]) => toXZ(lo, la));
      const samples = resample(xz, STEP);
      if (samples.length < 3) return;
      const out = [];
      for (const [x, z] of samples) {
        const near = this.roads.nearestRoad(x, z, 30);
        const g = this.hf.heightAt(x, z);
        if (!near) {
          out.push([x, g + 0.25, z, 0, 0]);
          continue;
        }
        let ux = near.x - x;
        let uz = near.z - z;
        const d = Math.hypot(ux, uz) || 1;
        ux /= d;
        uz /= d;
        const r = near.road;
        const spec = specFor(r.cls);
        // keep the rail off the carriageway and its pavement
        const walk = spec.walk && !r.rural && !r.unpaved && !r.bridge ? WALK_W * 0.6 : 0;
        const minD = r.width / 2 + 0.45 + walk;
        let px = x;
        let pz = z;
        if (d < minD) {
          px = near.x - ux * minD;
          pz = near.z - uz * minD;
        }
        let y = Math.max(g + 0.25, this.roads.surfaceAt(near.x, near.z, g).y - 0.05);
        out.push([px, y, pz, ux, uz]);
      }
      // samples with no road in reach copy the nearest sample that has one
      // (both directions); a rail with no road near at all faces across its
      // own line, so it is never built with a zero facing
      for (let pass = 0; pass < 2; pass++) {
        const order = pass === 0 ? [...out.keys()] : [...out.keys()].reverse();
        let last = null;
        for (const i of order) {
          if (out[i][3] !== 0 || out[i][4] !== 0) last = out[i];
          else if (last) {
            out[i][3] = last[3];
            out[i][4] = last[4];
          }
        }
      }
      for (let i = 0; i < out.length; i++) {
        if (out[i][3] !== 0 || out[i][4] !== 0) continue;
        const a = out[Math.max(0, i - 1)];
        const b = out[Math.min(out.length - 1, i + 1)];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const l = Math.hypot(dx, dz) || 1;
        out[i][3] = -dz / l;
        out[i][4] = dx / l;
      }
      this.#push(out, src);
      this.stats[src]++;
    };
    for (const w of GUARD_RAILS.osm || []) add(w.p, 'osm');
    for (const w of GUARD_RAILS.mapillary || []) add(w.p, 'mapillary');
  }

  // ---- rails by rule ---------------------------------------------------------
  #rulePiece(pc) {
    const roads = this.roads;
    const hf = this.hf;
    {
      const road = pc.road;
      const spec = specFor(road.cls);
      if (road.unpaved || spec.lane || road.rank < 4) return;
      const fwy = !!FWY[road.cls];
      const link = !!LINK[road.cls];
      const touchA = pc.nA.ends.some((e) => e.pc.bridge);
      const touchB = pc.nB.ends.some((e) => e.pc.bridge);
      // only pieces a rule can apply to (keeps start-up quick on phones)
      if (!fwy && !link && !touchA && !touchB && !pc.elevated && !(road.rural && road.rank >= 5)) return;
      const walk = spec.walk && !pc.elevated && !road.rural && !roads.isCbdStreet(pc);
      const S = sampleOf(pc, STEP);
      const n = S.length;
      if (n < 4) return;
      const len0 = S[0].d;
      const len1 = S[n - 1].d;
      // curvature (turn to the left > 0) over +-10 m
      const W = 5;
      const turn = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = S[Math.max(0, i - W)];
        const b = S[Math.min(n - 1, i - 1 >= 0 ? i - 1 : 0)];
        const c = S[Math.min(n - 1, i + 1)];
        const e = S[Math.min(n - 1, i + W)];
        const h0 = Math.atan2(b.x - a.x, b.z - a.z);
        const h1 = Math.atan2(e.x - c.x, e.z - c.z);
        let dh = h1 - h0;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        const arc = Math.max(1, e.d - a.d);
        // heading measured from +z towards +x; left normal is (tz, -tx), so
        // a positive dh is a turn to the right in this frame.
        turn[i] = -dh / arc; // 1/R, + = left turn
      }
      for (const side of [1, -1]) {
        const want = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          const s = S[i];
          const nearJ = (pc.nA.junction && s.d - len0 < 12) || (pc.nB.junction && len1 - s.d < 12);
          if (nearJ && !(touchA || touchB)) continue;
          let ok = false;
          // 1. raised approach / embankment
          if (s.off > 1.1 && !nearJ) ok = true;
          // 2. first 40 m off a bridge (arterials and freeways)
          if (road.rank >= 5 && ((touchA && s.d - len0 < 40) || (touchB && len1 - s.d < 40))) ok = true;
          // 3. outside of tight freeway / ramp curves
          if (fwy || link) {
            const k = turn[i];
            const rMax = road.cls === 'motorway' || road.cls === 'trunk' ? 1 / 380 : 1 / 140;
            if (Math.abs(k) > rMax && (k > 0 ? side < 0 : side > 0)) ok = true;
          }
          // 4. steep drop beside freeways / rural main roads
          if (!ok && (fwy || (road.rural && road.rank >= 5))) {
            const ox = s.x + s.lx * (pc.hw + 6) * side;
            const oz = s.z + s.lz * (pc.hw + 6) * side;
            if (s.y - hf.heightAt(ox, oz) > 2.6) ok = true;
          }
          want[i] = ok ? 1 : 0;
        }
        // close short gaps, drop short runs
        let last = -99;
        for (let i = 0; i < n; i++) {
          if (!want[i]) continue;
          if (i - last > 1 && i - last <= 4) for (let j = last + 1; j < i; j++) want[j] = 1;
          last = i;
        }
        let i = 0;
        while (i < n) {
          if (!want[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < n && want[j + 1]) j++;
          if ((j - i) * STEP >= 14) this.#ruleRun(pc, S, i, j, side, walk, fwy);
          i = j + 1;
        }
      }
    }
  }

  #ruleRun(pc, S, i0, i1, side, walk, fwy) {
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const s = S[i];
      // on the shoulder edge of freeways and raised roads, beyond the kerb and
      // pavement on town roads
      const o = fwy || s.off > 0.6 ? pc.hw - 0.3 : pc.hw + 0.5 + (walk ? WALK_W + 0.2 : 0);
      const x = s.x + s.lx * o * side;
      const z = s.z + s.lz * o * side;
      // don't run across another carriageway (slip lanes, crossing streets)
      const other = this.roads.nearestRoad(x, z, 14, (r) => r !== pc.road);
      if (other && other.dist < other.road.width / 2 + 0.6) {
        if (out.length > 6) this.#push(out.splice(0), 'rule');
        else out.length = 0;
        continue;
      }
      const g = this.hf.heightAt(x, z);
      const y = o < pc.hw ? s.y - 0.02 : Math.max(s.y - 0.08, Math.min(s.y + 0.3, g + 0.25));
      // face toward the road
      const ll = Math.hypot(s.lx, s.lz) || 1;
      out.push([x, y, z, (-s.lx / ll) * side, (-s.lz / ll) * side]);
    }
    if (out.length > 6) this.#push(out, 'rule');
  }

  #push(pts, src) {
    const n = pts.length;
    const a = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) a.set(pts[i], i * 5);
    // short rails get short turned-down ends, so some of them is still solid
    const L = { pts: a, n, src, end: Math.min(END, ((n - 1) * STEP) / 4) };
    this.lines.push(L);
    if (src === 'rule') this.stats.rule++;
    this.stats.metres += (n - 1) * STEP;
    // chunk membership by sample
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(a[i * 5] / CHUNK) * 100000 + Math.floor(a[i * 5 + 2] / CHUNK);
      if (seen.has(k)) continue;
      seen.add(k);
      let c = this.chunks.get(k);
      if (!c) {
        c = { x: (Math.floor(a[i * 5] / CHUNK) + 0.5) * CHUNK, z: (Math.floor(a[i * 5 + 2] / CHUNK) + 0.5) * CHUNK, k, lines: [], mesh: null };
        this.chunks.set(k, c);
      }
      c.lines.push(L);
      if (c.mesh !== null) c.dirty = true; // built (or empty) before this line came
    }
  }

  #index(L) {
    const a = L.pts;
    for (let i = 0; i < L.n - 1; i++) {
      const fromEnd = Math.min(i, L.n - 2 - i) * STEP;
      if (fromEnd < L.end - 1) continue; // turned-down ends are drive-over
      const s = { x0: a[i * 5], z0: a[i * 5 + 2], x1: a[i * 5 + 5], z1: a[i * 5 + 7], y: a[i * 5 + 1] };
      const k = Math.floor((s.x0 + s.x1) / 40) * 100000 + Math.floor((s.z0 + s.z1) / 40);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(s);
    }
  }

  // ---- streaming ------------------------------------------------------------
  update(camX, camZ, budget = 1) {
    if (this.queue !== false) this.#ruleStep(camX, camZ, budget > 2 ? 1e9 : 3);
    let built = 0;
    for (const c of this.chunks.values()) {
      const d = Math.hypot(c.x - camX, c.z - camZ);
      if (c.dirty) {
        c.dirty = false;
        if (c.mesh) {
          this.group.remove(c.mesh);
          c.mesh.geometry.dispose();
        }
        c.mesh = null;
      }
      if (!c.mesh && d < BUILD_IN && built < budget) {
        c.mesh = this.#build(c);
        if (c.mesh) this.group.add(c.mesh);
        else c.mesh = false;
        built++;
      } else if (c.mesh && d > DROP_OUT) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh = null;
      }
    }
    return built;
  }

  #build(c) {
    const pos = [];
    const nor = [];
    const uv = [];
    const col = [];
    const idx = [];
    const v = (x, y, z, nx, ny, nz, u, w, k) => {
      pos.push(x, y, z);
      nor.push(nx, ny, nz);
      uv.push(u, w);
      col.push(k, k, k);
      return pos.length / 3 - 1;
    };
    const quad = (a, b, cc, d) => idx.push(a, b, cc, b, d, cc);
    const box = (cx, cy0, cy1, cz, fx, fz, hw, hd, k) => {
      // vertical box centred on (cx, cz): hw across (along f), hd along the rail
      const rx = -fz;
      const rz = fx;
      const corners = [
        [cx + fx * hw + rx * hd, cz + fz * hw + rz * hd],
        [cx + fx * hw - rx * hd, cz + fz * hw - rz * hd],
        [cx - fx * hw - rx * hd, cz - fz * hw - rz * hd],
        [cx - fx * hw + rx * hd, cz - fz * hw + rz * hd]
      ];
      const ns = [[fx, fz], [-rx, -rz], [-fx, -fz], [rx, rz]];
      for (let q = 0; q < 4; q++) {
        const p0 = corners[q];
        const p1 = corners[(q + 1) % 4];
        const [nx, nz] = q === 0 ? [fx, fz] : ns[q];
        const a = v(p0[0], cy0, p0[1], nx, 0, nz, 0, 0, k * 0.8);
        const b = v(p1[0], cy0, p1[1], nx, 0, nz, 0.06, 0, k * 0.8);
        const d0 = v(p0[0], cy1, p0[1], nx, 0, nz, 0, 0.4, k);
        const d1 = v(p1[0], cy1, p1[1], nx, 0, nz, 0.06, 0.4, k);
        quad(a, b, d0, d1);
      }
      const t = corners.map((p) => v(p[0], cy1, p[1], 0, 1, 0, 0, 0, k));
      quad(t[0], t[1], t[3], t[2]);
    };
    const inChunk = (x, z) => Math.floor(x / CHUNK) * 100000 + Math.floor(z / CHUNK) === c.k;
    for (const L of c.lines) {
      const a = L.pts;
      const n = L.n;
      // sample range inside this chunk (+1 overlap so beams join across chunks)
      let lo = -1;
      let hi = -1;
      for (let i = 0; i < n; i++) {
        if (inChunk(a[i * 5], a[i * 5 + 2])) {
          if (lo < 0) lo = i;
          hi = i;
        }
      }
      if (lo < 0) continue;
      const i1 = Math.min(n - 1, hi + 1);
      let prev = null;
      for (let i = lo; i <= i1; i++) {
        const x = a[i * 5];
        const y = a[i * 5 + 1];
        const z = a[i * 5 + 2];
        const fx = a[i * 5 + 3];
        const fz = a[i * 5 + 4];
        // turned-down, flared terminals
        const e = Math.min(i, n - 1 - i) * STEP;
        const f = e < L.end ? 1 - e / L.end : 0;
        const drop = f * f * 0.62;
        const flare = f * 0.35;
        const ids = [];
        for (let q = 0; q < PROF.length; q++) {
          const [pu, pv] = PROF[q];
          const [nu, nv] = PN[q];
          const u = pu - flare;
          ids.push(v(x + fx * u, y + pv - drop, z + fz * u, fx * nu, nv, fz * nu, (i * STEP) / 4, q / (PROF.length - 1) * 0.35, 1));
        }
        if (prev) for (let q = 0; q < PROF.length - 1; q++) quad(prev[q], ids[q], prev[q + 1], ids[q + 1]);
        prev = ids;
        // post + spacer block (skip the shared overlap sample: its chunk owns it)
        if (i <= hi && e >= 1.5) {
          const yb = y - 1.1;
          box(x - fx * 0.2, yb, y + 0.7, z - fz * 0.2, fx, fz, 0.075, 0.05, 0.78);
          box(x - fx * 0.07, y + 0.45, y + 0.7, z - fz * 0.07, fx, fz, 0.06, 0.045, 0.7);
        }
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat);
    m.name = 'guardRail';
    m.matrixAutoUpdate = false;
    return m;
  }

  // Solid for the player: push a circle (x, z, r) out of any rail.
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
          const l2 = dx * dx + dz * dz || 1;
          let t = ((x - s.x0) * dx + (z - s.z0) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = s.x0 + dx * t;
          const pz = s.z0 + dz * t;
          const d = Math.hypot(x - px, z - pz);
          const lim = r + 0.15;
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

// Resample a piece's centre line every `step` m: x, y, z, left vector, offset, distance.
function sampleOf(pc, step) {
  const s = pc.s;
  const out = [];
  const d0 = s.ds[0];
  const d1 = s.ds[s.m - 1];
  let k = 0;
  for (let d = d0; d <= d1 + 1e-6; d += step) {
    while (k < s.m - 2 && s.ds[k + 1] < d) k++;
    const L = s.ds[k + 1] - s.ds[k] || 1;
    const t = Math.min(1, Math.max(0, (d - s.ds[k]) / L));
    let lx = s.lx[k] + (s.lx[k + 1] - s.lx[k]) * t;
    let lz = s.lz[k] + (s.lz[k + 1] - s.lz[k]) * t;
    const ll = Math.hypot(lx, lz) || 1;
    lx /= ll;
    lz /= ll;
    out.push({
      x: s.xs[k] + (s.xs[k + 1] - s.xs[k]) * t,
      y: s.ys[k] + (s.ys[k + 1] - s.ys[k]) * t,
      z: s.zs[k] + (s.zs[k + 1] - s.zs[k]) * t,
      lx,
      lz,
      off: s.offs[k] + (s.offs[k + 1] - s.offs[k]) * t,
      d
    });
  }
  return out;
}

function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= L) {
      out.push([ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L]);
      d += step;
    }
    carry = L - (d - step);
  }
  const last = pts[pts.length - 1];
  const o = out[out.length - 1];
  if (Math.hypot(last[0] - o[0], last[1] - o[1]) > 0.5) out.push(last);
  return out;
}
