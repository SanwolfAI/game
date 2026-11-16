// Shortest-path routing over the real road graph (road pieces split at shared
// OSM nodes, built in roads.js). One-way streets are respected. A* with a
// binary heap; the graph is built lazily on the first request.
// NOTE: loops only (no spread / recursion) — the Durban graph is large.

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Router {
  constructor(roads) {
    this.roads = roads;
    this.built = false;
  }

  #build() {
    const nodes = [];
    const index = new Map();
    const id = (n) => {
      let i = index.get(n);
      if (i === undefined) {
        i = nodes.length;
        index.set(n, i);
        nodes.push({ x: n.x, z: n.z, out: [] });
      }
      return i;
    };
    for (const pc of this.roads.pieces) {
      if (!pc.road) continue;
      const a = id(pc.nA);
      const b = id(pc.nB);
      if (a === b) continue;
      // car speed weighting: prefer main roads a little (time-like cost)
      const w = pc.len / Math.max(8, pc.road.speed);
      nodes[a].out.push({ to: b, pc, fwd: true, w });
      if (!pc.road.oneway) nodes[b].out.push({ to: a, pc, fwd: false, w });
    }
    this.nodes = nodes;
    this.index = index;
    this.grid = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n.out.length) continue;
      const k = Math.floor(n.x / 200) * 100000 + Math.floor(n.z / 200);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(i);
    }
    this.built = true;
  }

  #fromNode(e) {
    // edges store `to`; the from node is the other end of the piece
    const a = this.index.get(e.pc.nA);
    const b = this.index.get(e.pc.nB);
    return e.fwd ? a : b;
  }

  nearestNode(x, z, maxR = 600) {
    if (!this.built) this.#build();
    let best = -1;
    let bd = maxR;
    const gx = Math.floor(x / 200);
    const gz = Math.floor(z / 200);
    const R = Math.ceil(maxR / 200);
    for (let a = gz - R; a <= gz + R; a++) {
      for (let b = gx - R; b <= gx + R; b++) {
        const l = this.grid.get(b * 100000 + a);
        if (!l) continue;
        for (const i of l) {
          const n = this.nodes[i];
          const d = Math.hypot(n.x - x, n.z - z);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    return best;
  }

  // Route from (sx, sz) heading (fx, fz) to (tx, tz). Returns
  // { pts: [[x,z]...], cum: Float64Array, len, turns: [{ d, dir, name }] } or null.
  route(sx, sz, fx, fz, tx, tz) {
    if (!this.built) this.#build();
    const nodes = this.nodes;
    const goal = this.nearestNode(tx, tz, 800);
    if (goal < 0) return null;
    // start: both ends of the piece we are on (if known), else nearest node
    const starts = [];
    const surf = this.roads.surfaceAt(sx, sz, null);
    const pc = surf && surf.pc;
    if (pc && this.index.has(pc.nA) && this.index.has(pc.nB)) {
      const a = this.index.get(pc.nA);
      const b = this.index.get(pc.nB);
      const da = Math.hypot(nodes[a].x - sx, nodes[a].z - sz);
      const db = Math.hypot(nodes[b].x - sx, nodes[b].z - sz);
      // facing towards B? then reaching B is cheap, A needs a U-turn penalty
      const towardB = (nodes[b].x - sx) * fx + (nodes[b].z - sz) * fz > (nodes[a].x - sx) * fx + (nodes[a].z - sz) * fz;
      const v = Math.max(8, pc.road.speed);
      if (!pc.road.oneway || towardB) starts.push([b, db / v + (towardB ? 0 : 25)]);
      if (!pc.road.oneway || !towardB) starts.push([a, da / v + (towardB ? 25 : 0)]);
    }
    if (!starts.length) {
      const n = this.nearestNode(sx, sz, 600);
      if (n < 0) return null;
      starts.push([n, 0]);
    }
    const N = nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const prevEdge = new Array(N);
    const heap = new Heap();
    const gx = nodes[goal].x;
    const gz = nodes[goal].z;
    const H = (i) => Math.hypot(nodes[i].x - gx, nodes[i].z - gz) / 30; // admissible (30 m/s)
    for (const [s, c] of starts) {
      if (c < g[s]) {
        g[s] = c;
        heap.push(c + H(s), s);
      }
    }
    let found = false;
    let pops = 0;
    while (heap.size) {
      const u = heap.pop();
      if (u === goal) {
        found = true;
        break;
      }
      if (++pops > 400000) break;
      const gu = g[u];
      for (const e of nodes[u].out) {
        const ng = gu + e.w;
        if (ng < g[e.to]) {
          g[e.to] = ng;
          prev[e.to] = u;
          prevEdge[e.to] = e;
          heap.push(ng + H(e.to), e.to);
        }
      }
    }
    if (!found) return null;
    const chain = [];
    for (let v = goal; prev[v] >= 0; v = prev[v]) chain.push(prevEdge[v]);
    chain.reverse();
    // Start at the player's snapped spot on the current piece and follow the
    // piece's own geometry to the first node (no straight chord across blocks).
    const pts = [];
    const first = chain.length ? chain[0] : null;
    const startNode = first ? this.#fromNode(first) : goal;
    if (pc && (this.index.get(pc.nA) === startNode || this.index.get(pc.nB) === startNode)) {
      const p = pc.pts;
      let bi = 0;
      let bt = 0;
      let bd = Infinity;
      for (let i = 0; i < p.length - 1; i++) {
        const dx = p[i + 1][0] - p[i][0];
        const dz = p[i + 1][1] - p[i][1];
        const l2 = dx * dx + dz * dz || 1;
        let t = ((sx - p[i][0]) * dx + (sz - p[i][1]) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(sx - p[i][0] - dx * t, sz - p[i][1] - dz * t);
        if (d < bd) {
          bd = d;
          bi = i;
          bt = t;
        }
      }
      pts.push([p[bi][0] + (p[bi + 1][0] - p[bi][0]) * bt, p[bi][1] + (p[bi + 1][1] - p[bi][1]) * bt]);
      if (this.index.get(pc.nB) === startNode) for (let i = bi + 1; i < p.length; i++) pts.push(p[i]);
      else for (let i = bi; i >= 0; i--) pts.push(p[i]);
    } else pts.push([sx, sz]);
    const names = [];
    const nodeIdx = []; // index in pts where each edge ends
    for (const e of chain) {
      const p = e.pc.pts;
      if (e.fwd) for (let i = 0; i < p.length; i++) pts.push(p[i]);
      else for (let i = p.length - 1; i >= 0; i--) pts.push(p[i]);
      nodeIdx.push(pts.length - 1);
      names.push(e.pc.road.name || e.pc.road.ref || '');
    }
    pts.push([tx, tz]);
    // drop near-duplicate points
    const clean = [pts[0]];
    const remap = new Int32Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
      const l = clean[clean.length - 1];
      if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) > 0.5) clean.push(pts[i]);
      remap[i] = clean.length - 1;
    }
    const cum = new Float64Array(clean.length);
    for (let i = 1; i < clean.length; i++) cum[i] = cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]);
    // turns at piece joins where the heading changes a lot
    const turns = [];
    const heading = (i, back) => {
      // direction over ~12 m before (back) / after a point
      const p = clean[i];
      let j = i;
      if (back) {
        while (j > 0 && cum[i] - cum[j] < 12) j--;
        return [p[0] - clean[j][0], p[1] - clean[j][1]];
      }
      while (j < clean.length - 1 && cum[j] - cum[i] < 12) j++;
      return [clean[j][0] - p[0], clean[j][1] - p[1]];
    };
    for (let k = 0; k < nodeIdx.length - 1; k++) {
      const i = remap[nodeIdx[k]];
      if (i <= 0 || i >= clean.length - 1) continue;
      const a = heading(i, true);
      const b = heading(i, false);
      const ang = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
      // x east / z south: a positive cross product is a turn to the right
      const deg = (ang * 180) / Math.PI;
      if (Math.abs(deg) < 32) continue;
      const dir = Math.abs(deg) > 150 ? 'uturn' : deg > 0 ? 'right' : 'left';
      const name = names[k + 1];
      const last = turns[turns.length - 1];
      if (last && cum[i] - last.d < 15) continue;
      turns.push({ d: cum[i], dir, sharp: Math.abs(deg) > 110, name, x: clean[i][0], z: clean[i][1] });
    }
    return { pts: clean, cum, len: cum[cum.length - 1], turns, dest: { x: tx, z: tz } };
  }
}
