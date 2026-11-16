import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';
import { toXZ } from '../core/geo.js';

// ---------------------------------------------------------------------------
// Road classes. Widths come from OSM `lanes` (field `w`) x lane width, plus
// shoulders; untagged roads use sensible South African defaults.
// NOTE: never spread big arrays into calls (min/max/push) or recurse deeply here: the
// Durban network is large and Android WebViews have small call stacks.
const CLASS_SPEC = {
  motorway: { laneW: 3.7, lanes: 2, shoulderL: 2.4, shoulderR: 0.8, speed: 30, rank: 9, color: 0x3b3b40, tint: 0.78, major: true, edges: true },
  trunk: { laneW: 3.6, lanes: 2, shoulderL: 1.6, shoulderR: 0.6, speed: 25, rank: 8, color: 0x45454b, tint: 0.82, major: true, edges: true },
  primary: { laneW: 3.5, lanes: 2, shoulderL: 0.5, shoulderR: 0.3, speed: 22, rank: 7, color: 0x4e4e54, tint: 0.86, major: true, edges: true, walk: true },
  secondary: { laneW: 3.4, lanes: 2, shoulderL: 0.4, shoulderR: 0.3, speed: 18, rank: 6, color: 0x585860, tint: 0.9, major: true, edges: true, walk: true },
  tertiary: { laneW: 3.3, lanes: 2, shoulderL: 0.3, shoulderR: 0.3, speed: 15, rank: 5, color: 0x5f5f5c, tint: 0.95, major: true, edges: false, walk: true },
  residential: { laneW: 3.0, lanes: 2, shoulderL: 0.25, shoulderR: 0.25, speed: 11, rank: 3, color: 0x6f6f6a, tint: 1.04, major: false, walk: true },
  unclassified: { laneW: 3.0, lanes: 2, shoulderL: 0.25, shoulderR: 0.25, speed: 11, rank: 3, color: 0x6a6a64, tint: 1.04, major: false, walk: false },
  living_street: { laneW: 2.8, lanes: 2, shoulderL: 0.2, shoulderR: 0.2, speed: 7, rank: 2, color: 0x66645e, tint: 1.1, major: false, walk: true },
  motorway_link: { laneW: 3.7, lanes: 1, shoulderL: 1.4, shoulderR: 0.6, speed: 18, rank: 6, color: 0x4a4a50, tint: 0.8, major: false, edges: true },
  trunk_link: { laneW: 3.6, lanes: 1, shoulderL: 1.0, shoulderR: 0.5, speed: 15, rank: 5, color: 0x4e4e54, tint: 0.84, major: false, edges: true },
  primary_link: { laneW: 3.5, lanes: 1, shoulderL: 0.6, shoulderR: 0.4, speed: 13, rank: 4, color: 0x55555b, tint: 0.88, major: false, edges: true },
  secondary_link: { laneW: 3.4, lanes: 1, shoulderL: 0.5, shoulderR: 0.4, speed: 12, rank: 4, color: 0x5a5a60, tint: 0.9, major: false, edges: true },
  tertiary_link: { laneW: 3.3, lanes: 1, shoulderL: 0.4, shoulderR: 0.3, speed: 10, rank: 3, color: 0x60605c, tint: 0.95, major: false }
};
const DEFAULT_SPEC = { laneW: 3.2, lanes: 1, shoulderL: 0.4, shoulderR: 0.4, speed: 12, rank: 3, color: 0x55555a, tint: 0.95, major: false };

export function specFor(cls) {
  return CLASS_SPEC[cls] || DEFAULT_SPEC;
}

// Compatibility table (minimap, city): width is the typical untagged width.
export const ROAD_CLASS = {};
for (const [k, s] of Object.entries(CLASS_SPEC)) {
  ROAD_CLASS[k] = { width: s.lanes * s.laneW + s.shoulderL + s.shoulderR, speed: s.speed, color: s.color, major: s.major };
}
const LINK_CLASS = { width: 6, speed: 14, color: 0x55555a, major: false };

export function roadClass(cls) {
  return ROAD_CLASS[cls] || LINK_CLASS;
}

const KEY_SCALE = 4; // 4 m node snapping for the traffic graph (unchanged from Horus)
export const ROAD_LIFT = 0.3; // asphalt sits this far above the terrain
const MARK_LIFT = 0.035; // paint above asphalt
export const KERB_H = 0.16;
export const WALK_W = 1.9;
export const CHUNK = 400; // render chunk size (m)
const DETAIL_IN = 520; // build markings/sidewalks within this distance
const DETAIL_OUT = 760; // dispose them beyond this
const ROAD_FAR = 4200; // hide arterial asphalt beyond this (fog covers it)
const MINOR_FAR = 2000; // hide residential asphalt beyond this
const MESH_CELL = 800; // asphalt mesh cell size (m)
const G_BRIDGE = 0.12; // max bridge ramp grade
const G_APPROACH = 0.08; // embankment grade on approach roads
const TEX_SCALE = 1 / 5; // texture repeats every 5 m

function sampleHeight(hf, x, z) {
  // Max of the physics heightfield and the rendered (decimated, triangulated)
  // terrain so roads never sink under the visible ground.
  const h1 = hf.heightAt(x, z);
  const step = hf.renderStep || 1;
  if (step <= 1) return h1;
  const cell = hf.cell * step;
  const cols = Math.floor((hf.cols - 1) / step) + 1;
  const rows = Math.floor((hf.rows - 1) / step) + 1;
  const fx = clamp((x - hf.minX) / cell, 0, cols - 1.001);
  const fz = clamp((z - hf.minZ) / cell, 0, rows - 1.001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const H = (a, b) => hf.height[hf.idx(Math.min(a * step, hf.cols - 1), Math.min(b * step, hf.rows - 1))];
  let h2;
  if (tx + tz <= 1) {
    const ha = H(ix, iz);
    h2 = ha + (H(ix + 1, iz) - ha) * tx + (H(ix, iz + 1) - ha) * tz;
  } else {
    const hc = H(ix + 1, iz + 1);
    h2 = hc + (H(ix, iz + 1) - hc) * (1 - tx) + (H(ix + 1, iz) - hc) * (1 - tz);
  }
  return h1 > h2 ? h1 : h2;
}

function loadTexture(url, aniso) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Growable typed buffers (avoid giant JS arrays + spread).
class Buf {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  get count() {
    return this.pos.length / 3;
  }
  v(x, y, z, u, w, r, g, b) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    this.col.push(r, g, b);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) {
    // a-b along one edge, c-d along the next; CCW seen from +Y when a=left0,b=right0,c=left1,d=right1
    this.idx.push(a, b, c, b, d, c);
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  toGeometry(normals = true) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.count;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (normals) g.computeVertexNormals();
    else {
      const nrm = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) nrm[i * 3 + 1] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    }
    g.computeBoundingSphere();
    return g;
  }
}

export class RoadNetwork {
  constructor(data, hf) {
    this.hf = hf;
    this.roads = [];
    this.rail = [];
    this.group = new THREE.Group();
    this.group.name = 'roads';

    for (const r of data.roads) {
      const spec = specFor(r.h);
      const pts = [];
      for (const p of r.p) {
        const q = toXZ(p[0], p[1]);
        const last = pts[pts.length - 1];
        if (last && Math.abs(last[0] - q[0]) < 0.05 && Math.abs(last[1] - q[1]) < 0.05) continue;
        pts.push(q);
      }
      if (pts.length < 2) continue;
      const cum = new Float64Array(pts.length);
      for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const oneway = !!r.o;
      const tagged = Number(r.w) > 0;
      let lanes = tagged ? Math.min(8, Math.round(Number(r.w))) : spec.lanes;
      if (!tagged && !oneway && spec.lanes === 1) lanes = 2; // two-way links
      if (!tagged && oneway && spec.lanes === 2 && spec.rank < 8) lanes = r.h === 'residential' || r.h === 'living_street' ? 1 : 2;
      let shoulder = spec.shoulderL + spec.shoulderR;
      if (!oneway) shoulder = spec.shoulderR * 2 + (spec.rank >= 8 ? spec.shoulderL : 0);
      // Gameplay floor: keep narrow OSM ways drivable (car is ~1.8 m wide).
      const width = Math.max(lanes * spec.laneW + shoulder, oneway ? 4.4 : 6.2);
      this.roads.push({
        id: r.id,
        cls: r.h,
        name: r.n || '',
        ref: r.r || '',
        oneway,
        bridge: !!r.b,
        lanes,
        laneW: spec.laneW,
        width,
        speed: spec.speed,
        major: spec.major,
        rank: spec.rank,
        pts,
        cum,
        len: cum[pts.length - 1],
        raw: r.p,
        id2: this.roads.length,
        prof: null
      });
    }

    for (const r of data.rail || []) {
      const pts = r.p.map((p) => toXZ(p[0], p[1]));
      if (pts.length > 1) this.rail.push({ pts, name: r.n || '' });
    }

    this.#buildGraph();
    this.#buildIndex();
    this.#buildRender();
    for (const road of this.roads) road.raw = null;
  }

  // ---- traffic graph (endpoint graph, as in the Horus version) -------------
  #buildGraph() {
    const nodes = [];
    const nodeMap = new Map();
    const key = (x, z) => `${Math.round(x / KEY_SCALE)},${Math.round(z / KEY_SCALE)}`;
    const nodeAt = (x, z) => {
      const k = key(x, z);
      let id = nodeMap.get(k);
      if (id === undefined) {
        id = nodes.length;
        nodes.push({ id, x, z, edges: [] });
        nodeMap.set(k, id);
      }
      return id;
    };
    this.nodeMap = nodeMap;
    this.nodes = nodes;
    this.edges = [];
    for (const road of this.roads) {
      const a = road.pts[0];
      const b = road.pts[road.pts.length - 1];
      const from = nodeAt(a[0], a[1]);
      const to = nodeAt(b[0], b[1]);
      if (from === to) continue;
      const edge = { id: this.edges.length, road, from, to, forward: true, reverse: !road.oneway, len: road.len };
      this.edges.push(edge);
      nodes[from].edges.push(edge.id);
      nodes[to].edges.push(edge.id);
      road.edgeIds = road.edgeIds || [];
      road.edgeIds.push(edge.id);
    }
  }

  #buildIndex() {
    this.cell = 250;
    this.grid = new Map();
    const key = (cx, cz) => cx * 100000 + cz;
    for (const road of this.roads) {
      let minx = Infinity;
      let maxx = -Infinity;
      let minz = Infinity;
      let maxz = -Infinity;
      for (const p of road.pts) {
        if (p[0] < minx) minx = p[0];
        if (p[0] > maxx) maxx = p[0];
        if (p[1] < minz) minz = p[1];
        if (p[1] > maxz) maxz = p[1];
      }
      const cx0 = Math.floor(minx / this.cell);
      const cx1 = Math.floor(maxx / this.cell);
      const cz0 = Math.floor(minz / this.cell);
      const cz1 = Math.floor(maxz / this.cell);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = key(cx, cz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(road);
        }
      }
    }
    this.gridKey = key;

    // Fine segment grid (50 m) for fast nearest-road queries.
    const SG = 50;
    this.segCell = SG;
    this.segGrid = new Map();
    for (const road of this.roads) {
      const pts = road.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0];
        const az = pts[i][1];
        const bx = pts[i + 1][0];
        const bz = pts[i + 1][1];
        const cx0 = Math.floor(Math.min(ax, bx) / SG);
        const cx1 = Math.floor(Math.max(ax, bx) / SG);
        const cz0 = Math.floor(Math.min(az, bz) / SG);
        const cz1 = Math.floor(Math.max(az, bz) / SG);
        const long = (cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 6;
        for (let cz = cz0; cz <= cz1; cz++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            if (long) {
              // only cells the segment actually passes near
              const mx = (cx + 0.5) * SG;
              const mz = (cz + 0.5) * SG;
              if (segDist(mx, mz, ax, az, bx, bz) > SG * 0.75) continue;
            }
            const k = cx * 100000 + cz;
            let list = this.segGrid.get(k);
            if (!list) this.segGrid.set(k, (list = []));
            list.push(road, i);
          }
        }
      }
    }
  }

  // ---- render network: split ways at shared OSM nodes, build junctions -----
  #buildRender() {
    const hf = this.hf;
    // 1. Count how many ways use each exact OSM coordinate.
    const useCount = new Map();
    for (const road of this.roads) {
      let prev = '';
      for (const p of road.raw) {
        const k = p[0] + ',' + p[1];
        if (k === prev) continue;
        prev = k;
        useCount.set(k, (useCount.get(k) || 0) + 1);
      }
    }

    // 2. Cut each way into pieces between junction vertices.
    const rnodes = new Map();
    const nodeFor = (k, x, z) => {
      let n = rnodes.get(k);
      if (!n) {
        n = { key: k, x, z, ends: [], off: 0, y: 0, junction: false };
        rnodes.set(k, n);
      }
      return n;
    };
    const pieces = [];
    for (const road of this.roads) {
      // map raw indices to deduplicated pts indices
      const keys = [];
      let prev = '';
      for (const p of road.raw) {
        const k = p[0] + ',' + p[1];
        if (k === prev) continue;
        prev = k;
        keys.push(k);
      }
      // pts may have dropped near-duplicates (<5 cm); align by walking both.
      const n = road.pts.length;
      const kk = keys.length === n ? keys : null;
      let start = 0;
      for (let i = 1; i < n; i++) {
        const isJ = i === n - 1 || (kk && useCount.get(kk[i]) > 1);
        if (!isJ) continue;
        const pts = road.pts.slice(start, i + 1);
        const len = road.cum[i] - road.cum[start];
        if (len > 0.3) {
          const kA = kk ? kk[start] : `${road.pts[start][0].toFixed(1)},${road.pts[start][1].toFixed(1)}`;
          const kB = kk ? kk[i] : `${road.pts[i][0].toFixed(1)},${road.pts[i][1].toFixed(1)}`;
          const piece = {
            road,
            pts,
            d0: road.cum[start],
            len,
            hw: road.width / 2,
            bridge: road.bridge,
            nA: nodeFor(kA, pts[0][0], pts[0][1]),
            nB: nodeFor(kB, pts[pts.length - 1][0], pts[pts.length - 1][1]),
            trimA: 0,
            trimB: 0,
            C: 0,
            s: null
          };
          pieces.push(piece);
        }
        start = i;
      }
    }
    for (const pc of pieces) {
      const a = pc.pts[0];
      const a1 = pc.pts[1];
      const la = Math.hypot(a1[0] - a[0], a1[1] - a[1]) || 1;
      pc.nA.ends.push({ pc, atStart: true, dx: (a1[0] - a[0]) / la, dz: (a1[1] - a[1]) / la });
      const m = pc.pts.length;
      const b = pc.pts[m - 1];
      const b1 = pc.pts[m - 2];
      const lb = Math.hypot(b1[0] - b[0], b1[1] - b[1]) || 1;
      pc.nB.ends.push({ pc, atStart: false, dx: (b1[0] - b[0]) / lb, dz: (b1[1] - b[1]) / lb });
    }
    this.pieces = pieces;
    this.rnodes = rnodes;

    this.#computeElevation(pieces, rnodes);
    this.#computeJoins(rnodes);
    for (const pc of pieces) this.#samplePiece(pc);
    for (const node of rnodes.values()) this.#finishNode(node);
    this.#buildProfiles(pieces);
    this.#buildSurfaceIndex(pieces, rnodes);
    this.#buildMeshes(pieces, rnodes);
  }

  #computeElevation(pieces, rnodes) {
    const hf = this.hf;
    // Rail segment grid for crossing detection.
    const railGrid = new Map();
    const RC = 100;
    for (const line of this.rail) {
      for (let i = 1; i < line.pts.length; i++) {
        const a = line.pts[i - 1];
        const k = Math.floor(a[0] / RC) * 100000 + Math.floor(a[1] / RC);
        let l = railGrid.get(k);
        if (!l) railGrid.set(k, (l = []));
        l.push(a, line.pts[i]);
      }
    }
    const nearRail = (x, z) => {
      const cx = Math.floor(x / RC);
      const cz = Math.floor(z / RC);
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          const l = railGrid.get(gx * 100000 + gz);
          if (!l) continue;
          for (let i = 0; i < l.length; i += 2) {
            if (segDist(x, z, l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]) < 5) return true;
          }
        }
      }
      return false;
    };

    // Clearance per bridge piece.
    const bridges = pieces.filter((p) => p.bridge);
    for (const pc of bridges) {
      let C = 3.0;
      const steps = Math.max(1, Math.floor(pc.len / 6));
      for (let s = 1; s < steps; s++) {
        const d = (s / steps) * pc.len;
        if (d < 5 || d > pc.len - 5) continue;
        const [x, z] = pointOnPolyline(pc.pts, d);
        const under = this.nearestRoad(x, z, 30, (r) => !r.bridge && r !== pc.road);
        if (under && under.dist < under.road.width / 2 + 1.5) {
          C = 7.0;
          break;
        }
        if (nearRail(x, z)) {
          C = 7.0;
          break;
        }
        if (hf.isWater(x, z)) C = Math.max(C, 4.5);
      }
      pc.C = C;
    }
    // Bridge chains share one clearance (union-find over shared nodes).
    const parent = new Map();
    const find = (p) => {
      let r = p;
      while (parent.get(r) !== r) r = parent.get(r);
      let q = p;
      while (parent.get(q) !== r) {
        const nx = parent.get(q);
        parent.set(q, r);
        q = nx;
      }
      return r;
    };
    for (const pc of bridges) parent.set(pc, pc);
    for (const node of rnodes.values()) {
      let first = null;
      for (const e of node.ends) {
        if (!e.pc.bridge) continue;
        if (!first) first = e.pc;
        else parent.set(find(e.pc), find(first));
      }
    }
    const chainC = new Map();
    for (const pc of bridges) {
      const r = find(pc);
      chainC.set(r, Math.max(chainC.get(r) || 0, pc.C));
    }
    for (const pc of bridges) pc.C = chainC.get(find(pc));

    // Node offsets.
    for (const node of rnodes.values()) {
      let nb = 0;
      let C = 0;
      for (const e of node.ends) {
        if (e.pc.bridge) {
          nb++;
          if (e.pc.C > C) C = e.pc.C;
        }
      }
      if (!nb) continue;
      if (nb === node.ends.length) node.off = node.ends.length >= 2 ? C : 0;
      else node.off = C * 0.5;
      node.fixed = true;
    }
    // Propagate embankment ramps through short approach pieces.
    for (let it = 0; it < 4; it++) {
      for (const node of rnodes.values()) {
        if (node.fixed) continue;
        let best = 0;
        for (const e of node.ends) {
          if (e.pc.bridge) continue;
          const other = e.atStart ? e.pc.nB : e.pc.nA;
          const v = other.off - G_APPROACH * e.pc.len;
          if (v > best) best = v;
        }
        node.off = best;
      }
    }
  }

  // Offset above ground at distance d along the (untrimmed) piece.
  #offsetAt(pc, d) {
    const oA = pc.nA.off;
    const oB = pc.nB.off;
    if (pc.bridge) {
      const v = Math.min(pc.C, oA + G_BRIDGE * d, oB + G_BRIDGE * (pc.len - d));
      return v > 0 ? v : 0;
    }
    if (oA <= 0 && oB <= 0) return 0;
    const v = Math.max(oA - G_APPROACH * d, oB - G_APPROACH * (pc.len - d));
    return v > 0 ? v : 0;
  }

  #computeJoins(rnodes) {
    for (const node of rnodes.values()) {
      const ends = node.ends;
      for (const e of ends) e.ang = Math.atan2(e.dz, e.dx);
      ends.sort((a, b) => a.ang - b.ang);
      if (ends.length === 2) {
        const [a, b] = ends;
        const dot = a.dx * b.dx + a.dz * b.dz; // -1 = straight through
        const wd = Math.abs(a.pc.hw - b.pc.hw);
        if (dot < -0.5 && wd < 1.6) {
          node.miter = true;
          let mx = a.dx + b.dx;
          let mz = a.dz + b.dz;
          let ml = Math.hypot(mx, mz);
          if (ml < 0.05) {
            mx = -a.dz;
            mz = a.dx;
            ml = 1;
          }
          node.mx = mx / ml;
          node.mz = mz / ml;
          continue;
        }
      }
      if (ends.length < 2) continue;
      node.junction = true;
      // Trim each arm back until it clears its neighbours' carriageways.
      for (const e of ends) {
        let t = 0.5;
        for (const o of ends) {
          if (o === e) continue;
          const cos = clamp(e.dx * o.dx + e.dz * o.dz, -1, 1);
          const sin = Math.sqrt(1 - cos * cos);
          if (cos < -0.966) continue; // nearly opposite: straight continuation
          const need = (o.pc.hw + e.pc.hw * Math.max(0, cos)) / Math.max(sin, 0.26);
          if (need > t) t = need;
        }
        t += 1.2;
        // Shallow merges (slip roads) would need very long trims that cut the
        // curve off; cap them and let the ranked ribbons overlap instead.
        let maxHw = 0;
        for (const o of ends) if (o !== e && o.pc.hw > maxHw) maxHw = o.pc.hw;
        const maxT = Math.min(e.pc.len * 0.45, maxHw * 1.6 + e.pc.hw + 3);
        if (t > maxT) t = maxT;
        if (e.atStart) e.pc.trimA = t;
        else e.pc.trimB = t;
      }
    }
  }

  // Trim, resample by terrain error, and compute per-sample frames.
  #samplePiece(pc) {
    const hf = this.hf;
    let pts = pc.pts;
    let dStart = 0;
    if (pc.trimA > 0) {
      pts = cutStart(pts, pc.trimA);
      dStart = pc.trimA;
    }
    if (pc.trimB > 0) pts = cutEnd(pts, pc.len - dStart - pc.trimB);
    const elevated = pc.bridge || pc.nA.off > 0 || pc.nB.off > 0;
    const maxSeg = elevated ? 6 : 48;
    const xs = [];
    const zs = [];
    const ds = [];
    let d = dStart;
    xs.push(pts[0][0]);
    zs.push(pts[0][1]);
    ds.push(d);
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0];
      const az = pts[i - 1][1];
      const bx = pts[i][0];
      const bz = pts[i][1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      // iterative refinement: pick subdivision count so linear interpolation
      // of the terrain stays within 8 cm (no recursion).
      let n = Math.max(1, Math.ceil(L / maxSeg));
      if (!elevated) {
        for (let guard = 0; guard < 6; guard++) {
          let worst = 0;
          const h0 = sampleHeight(hf, ax, az);
          let hp = h0;
          for (let k = 1; k <= n; k++) {
            const t1 = k / n;
            const hk = sampleHeight(hf, ax + (bx - ax) * t1, az + (bz - az) * t1);
            const tm = (k - 0.5) / n;
            const hm = sampleHeight(hf, ax + (bx - ax) * tm, az + (bz - az) * tm);
            const err = Math.abs(hm - (hp + hk) / 2);
            if (err > worst) worst = err;
            hp = hk;
          }
          if (worst < 0.08 || L / n < 4) break;
          n *= 2;
        }
      }
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        xs.push(ax + (bx - ax) * t);
        zs.push(az + (bz - az) * t);
        ds.push(d + L * t);
      }
      d += L;
    }
    const m = xs.length;
    const ys = new Float32Array(m);
    const offs = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const g = Math.max(sampleHeight(hf, xs[i], zs[i]), pc.bridge ? 1.0 : -0.2);
      offs[i] = this.#offsetAt(pc, ds[i]);
      // Higher classes sit a few mm higher so unconnected overlaps never z-fight.
      ys[i] = g + ROAD_LIFT + offs[i] + pc.road.rank * 0.012;
    }
    // Frames: left vector (already miter-scaled) per sample.
    const lx = new Float32Array(m);
    const lz = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const i0 = i > 0 ? i - 1 : 0;
      const i1 = i < m - 1 ? i + 1 : m - 1;
      let tx;
      let tz;
      let sx = 0;
      let sz = 0;
      if (i > 0 && i < m - 1) {
        const ax = xs[i] - xs[i0];
        const az = zs[i] - zs[i0];
        const bx = xs[i1] - xs[i];
        const bz = zs[i1] - zs[i];
        const la = Math.hypot(ax, az) || 1;
        const lb = Math.hypot(bx, bz) || 1;
        tx = ax / la + bx / lb;
        tz = az / la + bz / lb;
        sx = bx / lb;
        sz = bz / lb;
      } else {
        tx = xs[i1] - xs[i0];
        tz = zs[i1] - zs[i0];
      }
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      let L1 = tz;
      let L2 = -tx;
      if (i > 0 && i < m - 1) {
        const dot = L1 * sz + L2 * -sx;
        const sc = 1 / Math.max(0.5, Math.abs(dot));
        L1 *= sc;
        L2 *= sc;
      }
      lx[i] = L1;
      lz[i] = L2;
    }
    pc.s = { xs, zs, ds, ys, offs, lx, lz, m };
    pc.elevated = elevated && (offs[0] > 0.05 || offs[m - 1] > 0.05 || maxOf(offs) > 0.05);
  }

  // Shared end frames for miter joins and junction polygons.
  #finishNode(node) {
    const ends = node.ends;
    if (node.miter) {
      // average the two end heights and force identical corners
      let ySum = 0;
      for (const e of ends) ySum += e.atStart ? e.pc.s.ys[0] : e.pc.s.ys[e.pc.s.m - 1];
      const y = ySum / ends.length;
      for (const e of ends) {
        const s = e.pc.s;
        const i = e.atStart ? 0 : s.m - 1;
        const pdx = e.atStart ? e.dx : -e.dx; // piece direction at this end
        const pdz = e.atStart ? e.dz : -e.dz;
        const Lx = pdz;
        const Lz = -pdx;
        let dot = node.mx * Lx + node.mz * Lz;
        if (Math.abs(dot) < 0.4) dot = dot < 0 ? -0.4 : 0.4;
        s.lx[i] = node.mx / dot;
        s.lz[i] = node.mz / dot;
        s.xs[i] = node.x;
        s.zs[i] = node.z;
        s.ys[i] = y;
      }
      node.y = y;
      return;
    }
    if (!node.junction) {
      node.y = ends.length ? (ends[0].atStart ? ends[0].pc.s.ys[0] : ends[0].pc.s.ys[ends[0].pc.s.m - 1]) : 0;
      return;
    }
    // Junction polygon corners, sorted by angle around the node.
    const corners = [];
    let ySum = 0;
    for (const e of ends) {
      const s = e.pc.s;
      const i = e.atStart ? 0 : s.m - 1;
      const hw = e.pc.hw;
      const y = s.ys[i];
      ySum += y;
      const lxv = s.lx[i];
      const lzv = s.lz[i];
      corners.push({ x: s.xs[i] + lxv * hw, z: s.zs[i] + lzv * hw, y, e, side: 1 });
      corners.push({ x: s.xs[i] - lxv * hw, z: s.zs[i] - lzv * hw, y, e, side: -1 });
    }
    node.y = ySum / ends.length;
    for (const c of corners) c.a = Math.atan2(c.z - node.z, c.x - node.x);
    corners.sort((a, b) => a.a - b.a);
    node.corners = corners;
    let r = 0;
    for (const c of corners) {
      const d = Math.hypot(c.x - node.x, c.z - node.z);
      if (d > r) r = d;
    }
    node.r = r;
  }

  #buildProfiles(pieces) {
    // Absolute surface heights along each road (only roads with elevation).
    const byRoad = new Map();
    for (const pc of pieces) {
      if (!pc.elevated) continue;
      let l = byRoad.get(pc.road);
      if (!l) byRoad.set(pc.road, (l = []));
      l.push(pc);
    }
    for (const [road, list] of byRoad) {
      list.sort((a, b) => a.d0 - b.d0);
      const d = [];
      const y = [];
      for (const pc of list) {
        const s = pc.s;
        for (let i = 0; i < s.m; i++) {
          d.push(pc.d0 + s.ds[i]);
          y.push(s.ys[i]);
        }
      }
      road.prof = { d: Float64Array.from(d), y: Float32Array.from(y), pieces: list };
    }
  }

  // Fine grid of drivable segments for height queries (vehicles, people).
  #buildSurfaceIndex(pieces, rnodes) {
    const SC = 32;
    this.sCell = SC;
    const grid = new Map();
    const add = (cx, cz, item) => {
      const k = cx * 100000 + cz;
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(item);
    };
    for (const pc of pieces) {
      const s = pc.s;
      for (let i = 1; i < s.m; i++) {
        const seg = { pc, i };
        const r = pc.hw + 1;
        const x0 = Math.min(s.xs[i - 1], s.xs[i]) - r;
        const x1 = Math.max(s.xs[i - 1], s.xs[i]) + r;
        const z0 = Math.min(s.zs[i - 1], s.zs[i]) - r;
        const z1 = Math.max(s.zs[i - 1], s.zs[i]) + r;
        for (let cz = Math.floor(z0 / SC); cz <= Math.floor(z1 / SC); cz++) {
          for (let cx = Math.floor(x0 / SC); cx <= Math.floor(x1 / SC); cx++) add(cx, cz, seg);
        }
      }
    }
    for (const node of rnodes.values()) {
      if (!node.junction) continue;
      const item = { node };
      const r = node.r + 0.5;
      for (let cz = Math.floor((node.z - r) / SC); cz <= Math.floor((node.z + r) / SC); cz++) {
        for (let cx = Math.floor((node.x - r) / SC); cx <= Math.floor((node.x + r) / SC); cx++) add(cx, cz, item);
      }
    }
    this.sGrid = grid;
  }

  // ---- meshes ---------------------------------------------------------------
  #buildMeshes(pieces, rnodes) {
    const maxAniso = 4;
    this.mats = {
      asphalt: new THREE.MeshLambertMaterial({ map: loadTexture('./src/assets/textures/asphalt_02_diff_1k.jpg', maxAniso), vertexColors: true }),
      concrete: new THREE.MeshLambertMaterial({ map: loadTexture('./src/assets/textures/concrete_pavement_diff_1k.jpg', maxAniso), vertexColors: true, side: THREE.DoubleSide }),
      paint: new THREE.MeshLambertMaterial({
        vertexColors: true,
        emissive: 0x222222,
        polygonOffset: true,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: -4
      }),
      pier: new THREE.MeshLambertMaterial({ color: 0x9a968e })
    };

    this.chunks = new Map();
    const chunkAt = (x, z) => {
      const cx = Math.floor(x / CHUNK);
      const cz = Math.floor(z / CHUNK);
      const k = cx * 100000 + cz;
      let c = this.chunks.get(k);
      if (!c) {
        c = { cx, cz, x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, runs: [], nodes: [], detail: null };
        this.chunks.set(k, c);
      }
      return c;
    };
    // Asphalt/structure meshes use bigger cells (fewer draw calls); minor
    // roads get their own mesh so they can be culled nearer than arterials.
    this.cells = new Map();
    const cellAt = (x, z) => {
      const cx = Math.floor(x / MESH_CELL);
      const cz = Math.floor(z / MESH_CELL);
      const k = cx * 100000 + cz;
      let c = this.cells.get(k);
      if (!c) {
        c = { x: (cx + 0.5) * MESH_CELL, z: (cz + 0.5) * MESH_CELL, major: new Buf(), minor: new Buf(), struct: new Buf(), meshes: [] };
        this.cells.set(k, c);
      }
      return c;
    };

    const asph = new THREE.Color();
    const earth = new THREE.Color(0x6d7550);
    const fascia = new THREE.Color(0xb7b2a8);
    for (const pc of pieces) {
      const s = pc.s;
      const spec = specFor(pc.road.cls);
      const tint = spec.tint;
      asph.setRGB(tint, tint, tint * 0.98);
      const hw = pc.hw;
      // strip runs per chunk
      let i = 0;
      while (i < s.m - 1) {
        const c = chunkAt((s.xs[i] + s.xs[i + 1]) / 2, (s.zs[i] + s.zs[i + 1]) / 2);
        let j = i + 1;
        while (j < s.m - 1) {
          const k2 = Math.floor((s.xs[j] + s.xs[j + 1]) / 2 / CHUNK) * 100000 + Math.floor((s.zs[j] + s.zs[j + 1]) / 2 / CHUNK);
          if (k2 !== c.cx * 100000 + c.cz) break;
          j++;
        }
        c.runs.push({ pc, i0: i, i1: j });
        // asphalt ribbon
        const cell = cellAt((s.xs[i] + s.xs[j]) / 2, (s.zs[i] + s.zs[j]) / 2);
        const B = pc.road.rank >= 5 ? cell.major : cell.minor;
        let pl = -1;
        let pr = -1;
        for (let k = i; k <= j; k++) {
          const x = s.xs[k];
          const z = s.zs[k];
          const y = s.ys[k];
          const v = (pc.d0 + s.ds[k]) * TEX_SCALE;
          const l = B.v(x + s.lx[k] * hw, y, z + s.lz[k] * hw, 0, v, asph.r, asph.g, asph.b);
          const r = B.v(x - s.lx[k] * hw, y, z - s.lz[k] * hw, hw * 2 * TEX_SCALE, v, asph.r, asph.g, asph.b);
          if (pl >= 0) B.quad(pl, pr, l, r);
          pl = l;
          pr = r;
        }
        // side skirts / embankments / bridge fascia for elevated pieces
        if (pc.elevated) {
          const S = cell.struct;
          for (const side of [1, -1]) {
            let pa = -1;
            let pb = -1;
            for (let k = i; k <= j; k++) {
              const x = s.xs[k] + s.lx[k] * hw * side;
              const z = s.zs[k] + s.lz[k] * hw * side;
              const y = s.ys[k];
              const v = (pc.d0 + s.ds[k]) * TEX_SCALE;
              let a;
              let b;
              if (pc.bridge) {
                a = S.v(x, y, z, 0, v, fascia.r, fascia.g, fascia.b);
                b = S.v(x, y - 1.3, z, 0.26, v, fascia.r * 0.8, fascia.g * 0.8, fascia.b * 0.8);
              } else {
                const off = s.offs[k];
                const out = off * 1.7 + 0.4;
                a = S.v(x, y, z, 0, v, earth.r, earth.g, earth.b);
                b = S.v(x + s.lx[k] * out * side, y - off - 0.6, z + s.lz[k] * out * side, out * TEX_SCALE, v, earth.r * 0.85, earth.g * 0.85, earth.b * 0.85);
              }
              if (pa >= 0) {
                if (side > 0) S.quad(pa, pb, a, b);
                else S.quad(pb, pa, b, a);
              }
              pa = a;
              pb = b;
            }
            if (pc.bridge) this.#parapet(S, pc, i, j, side);
          }
          if (pc.bridge) {
            // underside
            let pl2 = -1;
            let pr2 = -1;
            for (let k = i; k <= j; k++) {
              const y = s.ys[k] - 1.3;
              const l = S.v(s.xs[k] + s.lx[k] * hw, y, s.zs[k] + s.lz[k] * hw, 0, 0, fascia.r * 0.7, fascia.g * 0.7, fascia.b * 0.7);
              const r = S.v(s.xs[k] - s.lx[k] * hw, y, s.zs[k] - s.lz[k] * hw, 0, 0, fascia.r * 0.7, fascia.g * 0.7, fascia.b * 0.7);
              if (pl2 >= 0) S.quad(pr2, pl2, r, l);
              pl2 = l;
              pr2 = r;
            }
          }
        }
        i = j;
      }
    }

    // Junction polygons (fan from the node centre, corners share road-end vertices).
    for (const node of rnodes.values()) {
      if (!node.junction || !node.corners) continue;
      const c = chunkAt(node.x, node.z);
      c.nodes.push(node);
      let tint = 0;
      let maxRank = 0;
      for (const e of node.ends) {
        tint = Math.max(tint, 1 / specFor(e.pc.road.cls).tint);
        if (e.pc.road.rank > maxRank) maxRank = e.pc.road.rank;
      }
      const ncell = cellAt(node.x, node.z);
      const B = maxRank >= 5 ? ncell.major : ncell.minor;
      const t = 1 / tint;
      const ctr = B.v(node.x, node.y, node.z, node.x * TEX_SCALE, node.z * TEX_SCALE, t, t, t * 0.98);
      const n = node.corners.length;
      const ids = new Array(n);
      for (let k = 0; k < n; k++) {
        const q = node.corners[k];
        ids[k] = B.v(q.x, q.y, q.z, q.x * TEX_SCALE, q.z * TEX_SCALE, t, t, t * 0.98);
      }
      for (let k = 0; k < n; k++) {
        const a = node.corners[k];
        const b = node.corners[(k + 1) % n];
        let da = b.a - a.a;
        if (k === n - 1) da += Math.PI * 2;
        if (da <= 0 || da >= Math.PI * 0.999) continue;
        // triangle (centre, b, a) is CCW seen from +Y in this x/z (z south) frame
        B.tri(ctr, ids[(k + 1) % n], ids[k]);
      }
      // "Throats": where an arm curves inside the trimmed zone the fan misses
      // part of it, so lay the trimmed centre-line strip a hair below the fan
      // with identical (world) UVs and tint, which makes any overlap invisible.
      for (const e of node.ends) {
        const pc = e.pc;
        const trim = e.atStart ? pc.trimA : pc.trimB;
        if (trim < 2) continue;
        let tp = e.atStart ? cutEnd(pc.pts, trim) : cutStart(pc.pts, pc.len - trim).reverse();
        if (tp.length < 2) continue;
        const s2 = pc.s;
        const yEnd = e.atStart ? s2.ys[0] : s2.ys[s2.m - 1];
        const hw = pc.hw;
        const m = tp.length;
        let acc = 0;
        let total = 0;
        for (let q = 1; q < m; q++) total += Math.hypot(tp[q][0] - tp[q - 1][0], tp[q][1] - tp[q - 1][1]);
        let pl = -1;
        let pr = -1;
        for (let q = 0; q < m; q++) {
          if (q > 0) acc += Math.hypot(tp[q][0] - tp[q - 1][0], tp[q][1] - tp[q - 1][1]);
          const qa = tp[Math.max(0, q - 1)];
          const qb = tp[Math.min(m - 1, q + 1)];
          let tx = qb[0] - qa[0];
          let tz = qb[1] - qa[1];
          const tl = Math.hypot(tx, tz) || 1;
          tx /= tl;
          tz /= tl;
          const y = node.y + (yEnd - node.y) * (total > 0 ? acc / total : 1) - 0.006;
          const x = tp[q][0];
          const z = tp[q][1];
          const lxq = x + tz * hw;
          const lzq = z - tx * hw;
          const rxq = x - tz * hw;
          const rzq = z + tx * hw;
          const l = B.v(lxq, y, lzq, lxq * TEX_SCALE, lzq * TEX_SCALE, t, t, t * 0.98);
          const r = B.v(rxq, y, rzq, rxq * TEX_SCALE, rzq * TEX_SCALE, t, t, t * 0.98);
          if (pl >= 0) B.quad(pl, pr, l, r);
          pl = l;
          pr = r;
        }
      }
    }

    // Bridge piers (instanced boxes), only where there is room on the ground.
    const piers = [];
    for (const pc of pieces) {
      if (!pc.bridge) continue;
      const s = pc.s;
      let next = 14;
      for (let k = 1; k < s.m; k++) {
        if (s.ds[k] < next) continue;
        next = s.ds[k] + 26;
        if (s.offs[k] < 2.2) continue;
        const x = s.xs[k];
        const z = s.zs[k];
        const g = this.hf.heightAt(x, z);
        const top = s.ys[k] - 1.3;
        if (top - g < 1.5) continue;
        const under = this.nearestRoad(x, z, 25, (r) => !r.bridge && r !== pc.road);
        const offsets = pc.hw > 6 ? [-pc.hw * 0.55, pc.hw * 0.55] : [0];
        for (const o of offsets) {
          const px = x + s.lx[k] * o;
          const pz = z + s.lz[k] * o;
          if (under) {
            const u = this.nearestRoad(px, pz, 25, (r) => !r.bridge && r !== pc.road);
            if (u && u.dist < u.road.width / 2 + 1) continue;
          }
          piers.push(px, g - 0.5, pz, top - g + 0.5, Math.atan2(s.lx[k], s.lz[k]));
        }
      }
    }
    if (piers.length) {
      const count = piers.length / 5;
      const geo = new THREE.BoxGeometry(1.4, 1, 1.4);
      geo.translate(0, 0.5, 0);
      const mesh = new THREE.InstancedMesh(geo, this.mats.pier, count);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const p = new THREE.Vector3();
      const sc = new THREE.Vector3();
      for (let k = 0; k < count; k++) {
        p.set(piers[k * 5], piers[k * 5 + 1], piers[k * 5 + 2]);
        q.setFromAxisAngle(up, piers[k * 5 + 4]);
        sc.set(1, piers[k * 5 + 3], 1);
        m4.compose(p, q, sc);
        mesh.setMatrixAt(k, m4);
      }
      mesh.name = 'bridgePiers';
      this.group.add(mesh);
    }

    for (const c of this.cells.values()) {
      for (const [key, mat, far] of [['major', this.mats.asphalt, ROAD_FAR], ['minor', this.mats.asphalt, MINOR_FAR], ['struct', this.mats.concrete, ROAD_FAR]]) {
        const g = c[key].toGeometry(key === 'struct');
        c[key] = null;
        if (!g) continue;
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = key === 'struct' ? 'roadStructures' : 'roads';
        mesh.matrixAutoUpdate = false;
        mesh.userData.far = far;
        c.meshes.push(mesh);
        this.group.add(mesh);
      }
    }

    this.#buildRail();
    this.detailGroup = new THREE.Group();
    this.detailGroup.name = 'roadDetail';
    this.group.add(this.detailGroup);
  }

  #parapet(S, pc, i, j, side) {
    const s = pc.s;
    const hw = pc.hw;
    const col = 0.82;
    let p0 = -1;
    let p1 = -1;
    let p2 = -1;
    for (let k = i; k <= j; k++) {
      const x = s.xs[k];
      const z = s.zs[k];
      const y = s.ys[k];
      const v = (pc.d0 + s.ds[k]) * TEX_SCALE;
      const inner = hw - 0.05;
      const outer = hw + 0.35;
      const ix = x + s.lx[k] * inner * side;
      const iz = z + s.lz[k] * inner * side;
      const ox = x + s.lx[k] * outer * side;
      const oz = z + s.lz[k] * outer * side;
      const a = S.v(ix, y - 0.02, iz, 0, v, col, col, col);
      const b = S.v(ix, y + 0.95, iz, 0.2, v, col, col, col);
      const c = S.v(ox, y + 0.95, oz, 0.27, v, col, col, col);
      if (p0 >= 0) {
        if (side > 0) {
          S.quad(p1, p0, b, a);
          S.quad(p2, p1, c, b);
        } else {
          S.quad(p0, p1, a, b);
          S.quad(p1, p2, b, c);
        }
      }
      p0 = a;
      p1 = b;
      p2 = c;
    }
  }

  #buildRail() {
    const railPositions = [];
    const railIndices = [];
    for (const line of this.rail) {
      const start = railPositions.length / 3;
      for (let i = 0; i < line.pts.length; i++) {
        const p = line.pts[i];
        const a = line.pts[Math.max(0, i - 1)];
        const b = line.pts[Math.min(line.pts.length - 1, i + 1)];
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const y = this.hf.heightAt(p[0], p[1]) + 0.3;
        railPositions.push(p[0] - dz * 2.2, y, p[1] + dx * 2.2, p[0] + dz * 2.2, y, p[1] - dx * 2.2);
      }
      for (let i = 0; i < line.pts.length - 1; i++) {
        const a = start + i * 2;
        railIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    if (railPositions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
      geo.setIndex(railIndices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: 0x6b6157 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'rail';
      this.group.add(mesh);
    }
  }

  // ---- per-frame streaming of detail (markings, kerbs, sidewalks) ----------
  update(camX, camZ, budget = 2) {
    let built = 0;
    for (const c of this.cells.values()) {
      const d = Math.hypot(c.x - camX, c.z - camZ) - MESH_CELL * 0.7;
      for (const m of c.meshes) m.visible = d < m.userData.far;
    }
    for (const c of this.chunks.values()) {
      const d = Math.hypot(c.x - camX, c.z - camZ);
      if (!c.detail && d < DETAIL_IN && built < budget) {
        this.#buildDetail(c);
        built++;
      } else if (c.detail && d > DETAIL_OUT) {
        for (const m of c.detail) {
          this.detailGroup.remove(m);
          m.geometry.dispose();
        }
        c.detail = null;
      }
    }
    return built;
  }

  #buildDetail(c) {
    const paint = new Buf();
    const walk = new Buf();
    const WHITE = [0.95, 0.95, 0.92];
    const YELLOW = [1.0, 0.8, 0.12];
    const kerbCol = 0.9;
    const walkCol = 0.82;

    const stripe = (pc, i0, i1, off, half, col, dash, gap, solidFn) => {
      const s = pc.s;
      for (let k = i0; k < i1; k++) {
        const dA = pc.d0 + s.ds[k];
        const dB = pc.d0 + s.ds[k + 1];
        const segL = dB - dA;
        if (segL < 0.01) continue;
        const emit = (fa, fb) => {
          if (fb - fa < 0.05) return;
          const ta = (fa - dA) / segL;
          const tb = (fb - dA) / segL;
          const ax = s.xs[k] + (s.xs[k + 1] - s.xs[k]) * ta;
          const az = s.zs[k] + (s.zs[k + 1] - s.zs[k]) * ta;
          const ay = s.ys[k] + (s.ys[k + 1] - s.ys[k]) * ta + MARK_LIFT;
          const bx = s.xs[k] + (s.xs[k + 1] - s.xs[k]) * tb;
          const bz = s.zs[k] + (s.zs[k + 1] - s.zs[k]) * tb;
          const by = s.ys[k] + (s.ys[k + 1] - s.ys[k]) * tb + MARK_LIFT;
          const lax = s.lx[k] + (s.lx[k + 1] - s.lx[k]) * ta;
          const laz = s.lz[k] + (s.lz[k + 1] - s.lz[k]) * ta;
          const lbx = s.lx[k] + (s.lx[k + 1] - s.lx[k]) * tb;
          const lbz = s.lz[k] + (s.lz[k + 1] - s.lz[k]) * tb;
          const a0 = paint.v(ax + lax * (off + half), ay, az + laz * (off + half), 0, 0, col[0], col[1], col[2]);
          const a1 = paint.v(ax + lax * (off - half), ay, az + laz * (off - half), 0, 0, col[0], col[1], col[2]);
          const b0 = paint.v(bx + lbx * (off + half), by, bz + lbz * (off + half), 0, 0, col[0], col[1], col[2]);
          const b1 = paint.v(bx + lbx * (off - half), by, bz + lbz * (off - half), 0, 0, col[0], col[1], col[2]);
          paint.quad(a0, a1, b0, b1);
        };
        if (!dash) {
          emit(dA, dB);
          continue;
        }
        const period = dash + gap;
        let p = Math.floor(dA / period) * period;
        for (; p < dB; p += period) {
          const fa = Math.max(dA, p);
          const fb = Math.min(dB, p + dash);
          if (fb > fa) emit(fa, fb);
        }
        if (solidFn) {
          // overlay solid parts (no-overtaking zones near junctions)
          const [sa, sb] = solidFn();
          for (const [lo, hi] of [sa, sb]) {
            const fa = Math.max(dA, lo);
            const fb = Math.min(dB, hi);
            if (fb > fa) emit(fa, fb);
          }
        }
      }
    };

    for (const run of c.runs) {
      const pc = run.pc;
      const road = pc.road;
      const spec = specFor(road.cls);
      const hw = pc.hw;
      const s = pc.s;
      const freeway = spec.rank >= 8 || road.cls === 'motorway_link' || road.cls === 'trunk_link';
      const dash = freeway ? 4 : 3;
      const gap = freeway ? 8 : 6;
      const laneW = road.laneW;
      const marked = spec.major || spec.edges || road.lanes >= 3 || road.cls.endsWith('_link');

      if (marked) {
        const dLo = pc.d0 + (pc.nA.junction ? pc.trimA : 0);
        const dHi = pc.d0 + pc.len - (pc.nB.junction ? pc.trimB : 0);
        const solidZones = () => [
          pc.nA.junction ? [dLo, dLo + 15] : [0, -1],
          pc.nB.junction ? [dHi - 15, dHi] : [0, -1]
        ];
        if (road.oneway) {
          // carriageway: left (+) edge yellow, right (-) edge white, lane dashes between
          const leftEdge = hw - spec.shoulderL;
          const rightEdge = -hw + spec.shoulderR;
          if (spec.edges) {
            stripe(pc, run.i0, run.i1, leftEdge - 0.08, 0.08, YELLOW, 0, 0);
            stripe(pc, run.i0, run.i1, rightEdge + 0.08, 0.075, WHITE, 0, 0);
          }
          for (let l = 1; l < road.lanes; l++) {
            const o = leftEdge - l * laneW;
            if (o > rightEdge + 0.5) stripe(pc, run.i0, run.i1, o, 0.075, WHITE, dash, gap);
          }
        } else {
          const half = road.lanes / 2;
          const perSide = Math.max(1, Math.floor(half));
          // centre line: dashed on 2-lane roads (solid near junctions), solid on 4+ lane roads
          if (road.lanes >= 4) {
            stripe(pc, run.i0, run.i1, 0.12, 0.06, WHITE, 0, 0);
            stripe(pc, run.i0, run.i1, -0.12, 0.06, WHITE, 0, 0);
          } else {
            stripe(pc, run.i0, run.i1, 0, 0.075, WHITE, dash, gap, solidZones);
          }
          for (let l = 1; l < perSide; l++) {
            stripe(pc, run.i0, run.i1, l * laneW, 0.075, WHITE, dash, gap);
            stripe(pc, run.i0, run.i1, -l * laneW, 0.075, WHITE, dash, gap);
          }
          if (spec.edges) {
            stripe(pc, run.i0, run.i1, hw - spec.shoulderR - 0.08, 0.08, YELLOW, 0, 0);
            stripe(pc, run.i0, run.i1, -hw + spec.shoulderR + 0.08, 0.08, YELLOW, 0, 0);
          }
        }
      }

      // Stop lines where a minor road meets a bigger one.
      for (const atStart of [true, false]) {
        if (atStart ? run.i0 !== 0 : run.i1 !== s.m - 1) continue;
        const node = atStart ? pc.nA : pc.nB;
        if (!node.junction) continue;
        let maxOther = 0;
        for (const e of node.ends) if (e.pc !== pc && e.pc.road.rank > maxOther) maxOther = e.pc.road.rank;
        if (maxOther <= road.rank || node.ends.length < 3) continue;
        if (road.oneway && atStart) continue; // traffic leaves the junction here
        const k = atStart ? 0 : s.m - 1;
        const kk = atStart ? 1 : s.m - 2;
        // approaching traffic's left = piece-left when arriving at B, piece-right at A
        const lo = road.oneway ? -hw + 0.3 : atStart ? -hw + 0.3 : 0.15;
        const hi = road.oneway ? hw - 0.3 : atStart ? -0.15 : hw - 0.3;
        const dirx = s.xs[kk] - s.xs[k];
        const dirz = s.zs[kk] - s.zs[k];
        const dl = Math.hypot(dirx, dirz) || 1;
        const back = 0.9;
        const x = s.xs[k] + (dirx / dl) * back;
        const z = s.zs[k] + (dirz / dl) * back;
        const y = s.ys[k] + MARK_LIFT;
        const tx = (dirx / dl) * 0.25;
        const tz = (dirz / dl) * 0.25;
        const L1 = s.lx[k];
        const L2 = s.lz[k];
        const a0 = paint.v(x + L1 * hi - tx, y, z + L2 * hi - tz, 0, 0, WHITE[0], WHITE[1], WHITE[2]);
        const a1 = paint.v(x + L1 * lo - tx, y, z + L2 * lo - tz, 0, 0, WHITE[0], WHITE[1], WHITE[2]);
        const b0 = paint.v(x + L1 * hi + tx, y, z + L2 * hi + tz, 0, 0, WHITE[0], WHITE[1], WHITE[2]);
        const b1 = paint.v(x + L1 * lo + tx, y, z + L2 * lo + tz, 0, 0, WHITE[0], WHITE[1], WHITE[2]);
        if (atStart) paint.quad(a1, a0, b1, b0);
        else paint.quad(a0, a1, b0, b1);
      }

      // Kerbs + sidewalks on town roads (not on bridges or embankments).
      if (spec.walk && !pc.elevated && !pc.bridge) {
        for (const side of [1, -1]) {
          // split the strip wherever it would overlap another carriageway
          let k0 = -1;
          for (let k = run.i0; k <= run.i1; k++) {
            const px = s.xs[k] + s.lx[k] * (hw + WALK_W * 0.6) * side;
            const pz = s.zs[k] + s.lz[k] * (hw + WALK_W * 0.6) * side;
            const ok = !this.#coveredByOther(px, pz, pc);
            if (ok && k0 < 0) k0 = k;
            if ((!ok || k === run.i1) && k0 >= 0) {
              const k1 = ok ? k : k - 1;
              if (k1 > k0) this.#sidewalkStrip(walk, pc, k0, k1, side, kerbCol, walkCol);
              k0 = -1;
            }
          }
        }
      }
    }

    // Sidewalk corners around junctions.
    for (const node of c.nodes) this.#junctionCorners(walk, node, walkCol);

    const meshes = [];
    const pg = paint.toGeometry(false);
    if (pg) {
      const m = new THREE.Mesh(pg, this.mats.paint);
      m.name = 'roadMarkings';
      m.matrixAutoUpdate = false;
      meshes.push(m);
    }
    const wg = walk.toGeometry(true);
    if (wg) {
      const m = new THREE.Mesh(wg, this.mats.concrete);
      m.name = 'sidewalks';
      m.matrixAutoUpdate = false;
      meshes.push(m);
    }
    for (const m of meshes) this.detailGroup.add(m);
    c.detail = meshes;
  }

  // Is (x, z) on the carriageway of a different piece? (uses the 32 m surface grid)
  #coveredByOther(x, z, self, self2 = null) {
    const SC = this.sCell;
    const list = this.sGrid.get(Math.floor(x / SC) * 100000 + Math.floor(z / SC));
    if (!list) return false;
    for (const item of list) {
      if (item.node || item.pc === self || item.pc === self2 || item.pc.road === self.road) continue;
      const s = item.pc.s;
      const i = item.i;
      if (segDist(x, z, s.xs[i - 1], s.zs[i - 1], s.xs[i], s.zs[i]) < item.pc.hw + 0.4) return true;
    }
    return false;
  }

  #sidewalkStrip(B, pc, i0, i1, side, kerbCol, walkCol) {
    const s = pc.s;
    const hw = pc.hw;
    let prev = null;
    for (let k = i0; k <= i1; k++) {
      const x = s.xs[k];
      const z = s.zs[k];
      const y = s.ys[k];
      const L1 = s.lx[k] * side;
      const L2 = s.lz[k] * side;
      const v = (pc.d0 + s.ds[k]) * TEX_SCALE;
      const e0 = hw;
      const e1 = hw + 0.18;
      const e2 = hw + WALK_W;
      const e3 = hw + WALK_W + 0.25;
      const ids = [
        B.v(x + L1 * e0, y - 0.02, z + L2 * e0, 0, v, kerbCol * 0.8, kerbCol * 0.8, kerbCol * 0.8),
        B.v(x + L1 * e0, y + KERB_H, z + L2 * e0, 0.04, v, kerbCol, kerbCol, kerbCol),
        B.v(x + L1 * e1, y + KERB_H, z + L2 * e1, 0.08, v, kerbCol, kerbCol, kerbCol),
        B.v(x + L1 * e2, y + KERB_H, z + L2 * e2, WALK_W * TEX_SCALE, v, walkCol, walkCol, walkCol * 0.97),
        B.v(x + L1 * e3, y - 0.45, z + L2 * e3, (WALK_W + 0.3) * TEX_SCALE, v, walkCol * 0.7, walkCol * 0.7, walkCol * 0.7)
      ];
      if (prev) {
        for (let q = 0; q < 4; q++) {
          if (side > 0) B.quad(prev[q + 1], prev[q], ids[q + 1], ids[q]);
          else B.quad(prev[q], prev[q + 1], ids[q], ids[q + 1]);
        }
      }
      prev = ids;
    }
  }

  #junctionCorners(B, node, walkCol) {
    const cs = node.corners;
    if (!cs) return;
    const n = cs.length;
    for (let k = 0; k < n; k++) {
      const a = cs[k];
      const b = cs[(k + 1) % n];
      if (a.e === b.e) continue;
      let da = b.a - a.a;
      if (k === n - 1) da += Math.PI * 2;
      if (da <= 0 || da > Math.PI * 0.75) continue;
      const pa = a.e.pc;
      const pb = b.e.pc;
      const sa = specFor(pa.road.cls);
      const sb = specFor(pb.road.cls);
      if (!sa.walk || !sb.walk || pa.elevated || pb.elevated) continue;
      // outward directions = away from the node centre, perpendicular-ish to each arm
      const oa = outward(a, node);
      const ob = outward(b, node);
      const mx = (a.x + oa[0] * WALK_W + b.x + ob[0] * WALK_W) / 2;
      const mz = (a.z + oa[1] * WALK_W + b.z + ob[1] * WALK_W) / 2;
      if (this.#coveredByOther(mx, mz, pa, pb)) continue;
      // outward vectors must not cross (would fold the corner into a wedge)
      const cross = (b.x - a.x) * (ob[1] - oa[1]) - (b.z - a.z) * (ob[0] - oa[0]);
      void cross;
      const ax2 = a.x + oa[0] * WALK_W;
      const az2 = a.z + oa[1] * WALK_W;
      const bx2 = b.x + ob[0] * WALK_W;
      const bz2 = b.z + ob[1] * WALK_W;
      if (Math.hypot(bx2 - ax2, bz2 - az2) > Math.hypot(b.x - a.x, b.z - a.z) + WALK_W * 3) continue;
      if (segmentsCross(a.x, a.z, ax2, az2, b.x, b.z, bx2, bz2)) continue;
      const y = Math.min(a.y, b.y);
      const pts = [
        [a.x, a.y - 0.02, a.z],
        [a.x, a.y + KERB_H, a.z],
        [a.x + oa[0] * WALK_W, a.y + KERB_H, a.z + oa[1] * WALK_W],
        [a.x + oa[0] * (WALK_W + 0.25), a.y - 0.45, a.z + oa[1] * (WALK_W + 0.25)]
      ];
      const ptsB = [
        [b.x, b.y - 0.02, b.z],
        [b.x, b.y + KERB_H, b.z],
        [b.x + ob[0] * WALK_W, b.y + KERB_H, b.z + ob[1] * WALK_W],
        [b.x + ob[0] * (WALK_W + 0.25), b.y - 0.45, b.z + ob[1] * (WALK_W + 0.25)]
      ];
      void y;
      const ia = pts.map((p, q) => B.v(p[0], p[1], p[2], p[0] * TEX_SCALE, p[2] * TEX_SCALE, q === 0 ? 0.72 : walkCol, q === 0 ? 0.72 : walkCol, q === 0 ? 0.72 : walkCol));
      const ib = ptsB.map((p, q) => B.v(p[0], p[1], p[2], p[0] * TEX_SCALE, p[2] * TEX_SCALE, q === 0 ? 0.72 : walkCol, q === 0 ? 0.72 : walkCol, q === 0 ? 0.72 : walkCol));
      for (let q = 0; q < 3; q++) B.quad(ia[q + 1], ia[q], ib[q + 1], ib[q]);
      // fill the inner triangle between both arms' outer corners and the kerb
      B.tri(ia[2], ib[2], ia[1]);
    }
  }

  // ---- queries --------------------------------------------------------------

  // Nearest road query used for the driving assist and for placing props.
  nearestRoad(x, z, radius = 60, filter = null) {
    const cs = this.segCell;
    const cr = Math.ceil(radius / cs);
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    let best = null;
    let bestD = radius * radius;
    for (let gz = cz - cr; gz <= cz + cr; gz++) {
      for (let gx = cx - cr; gx <= cx + cr; gx++) {
        const list = this.segGrid.get(gx * 100000 + gz);
        if (!list) continue;
        for (let n = 0; n < list.length; n += 2) {
          const road = list[n];
          if (filter && !filter(road)) continue;
          const i = list[n + 1];
          const pts = road.pts;
          const ax = pts[i][0];
          const az = pts[i][1];
          const dx = pts[i + 1][0] - ax;
          const dz = pts[i + 1][1] - az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + dx * t;
          const pz = az + dz * t;
          const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
          if (d2 < bestD) {
            bestD = d2;
            best = { road, x: px, z: pz, t: (i + t) / (pts.length - 1), dist: Math.sqrt(d2), dirX: dx, dirZ: dz };
          }
        }
      }
    }
    return best;
  }

  // Drivable surface height at (x, z). `prevY` keeps a vehicle on the layer it
  // is on: under a bridge you stay on the ground, on the deck you follow it.
  // Returns { y, onRoad, deck, lateral, hw } (object reused between calls).
  surfaceAt(x, z, prevY = null) {
    const out = this._surf || (this._surf = { y: 0, onRoad: false, deck: false, lateral: 0, hw: 0, pc: null });
    const ground = this.hf.heightAt(x, z);
    const SC = this.sCell;
    const list = this.sGrid.get(Math.floor(x / SC) * 100000 + Math.floor(z / SC));
    let bestY = ground;
    let bestScore = Infinity;
    let found = false;
    let nearRoad = false;
    let walkY = -Infinity;
    out.deck = false;
    out.pc = null;
    out.lateral = 0;
    out.hw = 0;
    const consider = (y, deck, pc, lat) => {
      let score;
      if (prevY === null) score = y; // lowest layer when unknown
      else if (y > prevY + 1.4) return;
      else score = Math.abs(y - prevY);
      if (score < bestScore) {
        bestScore = score;
        bestY = y;
        found = true;
        out.deck = deck;
        out.pc = pc;
        out.lateral = lat;
        out.hw = pc ? pc.hw : 0;
      }
    };
    if (list) {
      for (const item of list) {
        if (item.node) {
          const nd = item.node;
          if (Math.hypot(x - nd.x, z - nd.z) <= nd.r) consider(nd.y, nd.off > 1, null, 0);
          continue;
        }
        const pc = item.pc;
        const s = pc.s;
        const i = item.i;
        const ax = s.xs[i - 1];
        const az = s.zs[i - 1];
        const dx = s.xs[i] - ax;
        const dz = s.zs[i] - az;
        const l2 = dx * dx + dz * dz;
        if (l2 < 1e-6) continue;
        const t = ((x - ax) * dx + (z - az) * dz) / l2;
        if (t < -0.02 || t > 1.02) continue;
        const tc = t < 0 ? 0 : t > 1 ? 1 : t;
        const l = Math.sqrt(l2);
        const lat = ((x - ax) * dz - (z - az) * dx) / l; // + = left
        const alat = Math.abs(lat);
        if (alat < pc.hw + 3) nearRoad = true;
        const y = s.ys[i - 1] + (s.ys[i] - s.ys[i - 1]) * tc;
        if (alat > pc.hw) {
          if (!pc.elevated && alat < pc.hw + WALK_W + 0.2 && specFor(pc.road.cls).walk) walkY = Math.max(walkY, y + KERB_H);
          if (alat > pc.hw + (pc.elevated ? 0.2 : 0.05)) continue;
        }
        consider(y, pc.bridge || s.offs[i] > 1, pc, lat);
      }
    }
    // Ground option (off-road / under bridges).
    const gY = walkY > -Infinity && !found ? walkY : nearRoad ? ground + ROAD_LIFT * 0.5 : ground;
    if (prevY === null ? !found : Math.abs(gY - prevY) < bestScore && gY <= prevY + 1.4) {
      bestY = gY;
      found = false;
      out.deck = false;
      out.pc = null;
    }
    out.y = bestY;
    out.onRoad = found;
    return out;
  }

  surfaceHeightAt(x, z, prevY = null) {
    return this.surfaceAt(x, z, prevY).y;
  }

  // Back-compat alias of the API introduced on main.
  deckHeightAt(x, z, prevY) {
    return this.surfaceAt(x, z, prevY ?? null).y;
  }

  // Height of the road surface at `dist` metres along `road` (traffic AI).
  roadHeightAt(road, dist, x, z) {
    const p = road.prof;
    if (p) {
      const d = p.d;
      const n = d.length;
      if (dist >= d[0] && dist <= d[n - 1]) {
        let lo = 0;
        let hi = n - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (d[mid] <= dist) lo = mid;
          else hi = mid;
        }
        const span = d[hi] - d[lo];
        if (span < 40) {
          const t = span > 0 ? (dist - d[lo]) / span : 0;
          return p.y[lo] + (p.y[hi] - p.y[lo]) * t;
        }
      }
    }
    return sampleHeight(this.hf, x, z) + ROAD_LIFT;
  }

  // Lateral offset (+ = left of travel) for a lane, SA keep-left.
  laneOffset(road, rng = Math.random) {
    if (road.oneway) {
      const spec = specFor(road.cls);
      const lane = Math.floor(rng() * road.lanes);
      return road.width / 2 - spec.shoulderL - road.laneW * (lane + 0.5);
    }
    const perSide = Math.max(1, Math.floor(road.lanes / 2));
    const lane = Math.floor(rng() * perSide);
    return road.laneW * (lane + 0.5);
  }

  // Node lookup used by the traffic AI.
  nodeByPos(x, z) {
    const id = this.nodeMap.get(`${Math.round(x / KEY_SCALE)},${Math.round(z / KEY_SCALE)}`);
    return id === undefined ? null : this.nodes[id];
  }

  randomEdge(rng) {
    return this.edges[Math.floor(rng() * this.edges.length)];
  }
}

// ---- helpers ----------------------------------------------------------------
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

function maxOf(arr) {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

function pointOnPolyline(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + L >= d) {
      const t = L > 0 ? (d - acc) / L : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    acc += L;
  }
  const p = pts[pts.length - 1];
  return [p[0], p[1]];
}

function cutStart(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + L > d) {
      const t = L > 0 ? (d - acc) / L : 0;
      const p = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      const out = [p];
      for (let k = i; k < pts.length; k++) out.push(pts[k]);
      return out;
    }
    acc += L;
  }
  return pts.slice(-2);
}

function cutEnd(pts, keep) {
  let acc = 0;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + L >= keep) {
      const t = L > 0 ? (keep - acc) / L : 0;
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      return out;
    }
    out.push(pts[i]);
    acc += L;
  }
  return out;
}

function segmentsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const o = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(ax, az, bx, bz, cx, cz);
  const d2 = o(ax, az, bx, bz, dx, dz);
  const d3 = o(cx, cz, dx, dz, ax, az);
  const d4 = o(cx, cz, dx, dz, bx, bz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function outward(corner, node) {
  // Direction from the arm's centre line towards this corner (perpendicular to
  // the arm), so the sidewalk corner continues the arm's sidewalk.
  const s = corner.e.pc.s;
  const i = corner.e.atStart ? 0 : s.m - 1;
  let ox = s.lx[i] * corner.side;
  let oz = s.lz[i] * corner.side;
  const l = Math.hypot(ox, oz) || 1;
  ox /= l;
  oz /= l;
  void node;
  return [ox, oz];
}
