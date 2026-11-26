// Concrete road bridges, as built on Durban's freeways and arterials
// (SANRAL / eThekwini standard details):
//  - F-shape concrete safety parapets on both deck edges (vertical toe,
//    55-degree lower face, near-vertical upper face, ~0.85 m tall),
//  - a deep edge beam (fascia) under each parapet,
//  - precast beams (girders) under the deck slab,
//  - piers: round columns under a crosshead beam, kept off any road below,
//  - abutments: a concrete end wall under each end of the deck with wing
//    walls running back into the approach embankment.
// Everything is written into the road network's per-cell "structure" buffers
// (concrete texture, vertex colours), so bridges add no extra draw calls.

const TEX = 1 / 5; // texture repeats every 5 m (same as the road strips)
const SLAB = 0.3; // deck slab depth below the road surface
const BEAM_D = 1.25; // girder depth below the slab
const EDGE_D = 0.95; // edge beam depth below the road surface
const PAR_H = 0.85; // parapet height
const TOE = 0.05; // parapet toe sits this far inside the carriageway edge
const BACK = 0.45; // parapet / edge beam outer face, outside the carriageway edge

// F-shape profile from the traffic side: [u (outward from toe), v (up)]
const F_SHAPE = [
  [0.0, 0.0],
  [0.0, 0.075],
  [0.18, 0.255],
  [0.26, PAR_H],
  [TOE + BACK, PAR_H]
];

const C_PARAPET = 0.86;
const C_EDGE = 0.8;
const C_UNDER = 0.58;
const C_BEAM = 0.66;
const C_PIER = 0.74;
const C_ABUT = 0.72;

// How deep the whole deck is (surface to girder soffit): piers and crossheads
// hang below this.
export function deckDepth(pc) {
  return pc.s && maxOf(pc.s.offs) > 2.2 ? SLAB + BEAM_D : EDGE_D;
}

// Deck edges, parapets, slab soffit and girders for samples i..j of a bridge
// piece, into structure buffer B.
export function bridgeRun(B, pc, i, j) {
  const s = pc.s;
  const hw = pc.hw;
  // generic: lay a strip between two lines across samples i..j
  const ribbon = (a, b, col, wA, wB) => {
    let pa = -1;
    let pb = -1;
    for (let k = i; k <= j; k++) {
      const v = (pc.d0 + s.ds[k]) * TEX;
      const A = a(k);
      const Bp = b(k);
      const ia = B.v(A[0], A[1], A[2], v, wA, col, col, col * 0.98);
      const ib = B.v(Bp[0], Bp[1], Bp[2], v, wB, col, col, col * 0.98);
      if (pa >= 0) B.idx.push(pa, pb, ia, pb, ib, ia);
      pa = ia;
      pb = ib;
    }
  };
  // point at lateral offset u (signed, + = left) and height dy above the deck surface
  const at = (u, dy) => (k) => [s.xs[k] + s.lx[k] * u, s.ys[k] + dy, s.zs[k] + s.lz[k] * u];

  const high = maxOf(s.offs) > 2.2; // a real span over something (not a culvert)
  for (const side of [1, -1]) {
    const u0 = (hw - TOE) * side;
    // F-shape parapet, traffic face
    for (let q = 0; q < F_SHAPE.length - 1; q++) {
      const [ua, va] = F_SHAPE[q];
      const [ub, vb] = F_SHAPE[q + 1];
      ribbon(at(u0 + ua * side, va - 0.02), at(u0 + ub * side, vb - 0.02), C_PARAPET * (q === 3 ? 1.04 : 1), va * TEX, vb * TEX);
    }
    // outer face of parapet + edge beam (one tall fascia)
    const uo = (hw + BACK) * side;
    ribbon(at(uo, PAR_H - 0.02), at(uo, -EDGE_D), C_EDGE, 0, (PAR_H + EDGE_D) * TEX);
    // edge beam soffit (drip) back under the deck
    const ui = (hw - 0.35) * side;
    ribbon(at(uo, -EDGE_D), at(ui, -EDGE_D), C_UNDER, 0, 0.8 * TEX);
    // inner face of the edge beam up to the slab soffit
    if (high) ribbon(at(ui, -EDGE_D), at(ui, -SLAB), C_UNDER, 0, (EDGE_D - SLAB) * TEX);
  }
  // slab soffit between the edge beams
  ribbon(at(hw - 0.35, high ? -SLAB : -EDGE_D), at(-(hw - 0.35), high ? -SLAB : -EDGE_D), C_UNDER, 0, (hw * 2 - 0.7) * TEX);
  if (!high) return;
  // precast girders, ~3 m apart across the deck
  const span = hw * 2 - 1.6;
  const n = Math.max(2, Math.round(span / 3) + 1);
  for (let g = 0; g < n; g++) {
    const uc = -span / 2 + (span * g) / (n - 1);
    const w = 0.22;
    const wf = 0.36;
    const y1 = -SLAB - BEAM_D + 0.22;
    const y2 = -SLAB - BEAM_D;
    ribbon(at(uc + w, -SLAB), at(uc + w, y1), C_BEAM, 0, (y1 + SLAB) * TEX);
    ribbon(at(uc - w, y1), at(uc - w, -SLAB), C_BEAM, 0, (y1 + SLAB) * TEX);
    ribbon(at(uc + w, y1), at(uc + wf, y1), C_BEAM, 0, 0.05);
    ribbon(at(uc - wf, y1), at(uc - w, y1), C_BEAM, 0, 0.05);
    ribbon(at(uc + wf, y1), at(uc + wf, y2), C_BEAM * 0.95, 0, 0.05);
    ribbon(at(uc - wf, y2), at(uc - wf, y1), C_BEAM * 0.95, 0, 0.05);
    ribbon(at(uc + wf, y2), at(uc - wf, y2), C_BEAM * 0.8, 0, 0.15);
  }
}

// Piers, crossheads and abutments for every bridge piece. bufAt(x, z) returns
// the structure buffer of the mesh cell at that spot.
export function bridgeSupports(roads, pieces, bufAt) {
  const hf = roads.hf;
  let piers = 0;
  let abutments = 0;
  const underRoad = (pc, x, z, pad) => {
    const u = roads.nearestRoad(x, z, 25, (r) => !r.bridge && r !== pc.road);
    return !!(u && u.dist < u.road.width / 2 + pad);
  };
  for (const pc of pieces) {
    if (!pc.bridge || !pc.s) continue;
    const s = pc.s;
    const depth = deckDepth(pc);
    const high = depth > EDGE_D;
    // ---- piers ----------------------------------------------------------
    if (high) {
      const len = s.ds[s.m - 1] - s.ds[0];
      const spans = Math.max(1, Math.round(len / 28));
      const step = len / spans;
      for (let p = 1; p < spans; p++) {
        const d = s.ds[0] + step * p;
        const f = frameAt(s, d);
        const g = hf.heightAt(f.x, f.z);
        const soffit = f.y - depth;
        if (soffit - g < 1.6) continue;
        // columns across the deck, skipping any that would stand on a road
        const hw = pc.hw;
        const offs = hw > 9 ? [-0.62, 0, 0.62] : hw > 5 ? [-0.5, 0.5] : [0];
        const cols = [];
        for (const o of offs) {
          const u = o * hw;
          const cx = f.x + f.lx * u;
          const cz = f.z + f.lz * u;
          if (underRoad(pc, cx, cz, 1.2)) continue;
          cols.push([cx, cz]);
        }
        if (!cols.length) continue;
        const B = bufAt(f.x, f.z);
        const capH = 1.1;
        const capBot = soffit - capH;
        // crosshead (box across the deck, under the girders)
        box(B, f.x, capBot, soffit, f.z, f.lx, f.lz, hw + 0.2, 0.75, C_PIER);
        for (const [cx, cz] of cols) {
          const gy = hf.heightAt(cx, cz) - 0.4;
          column(B, cx, cz, gy, capBot + 0.05, hw > 5 ? 0.8 : 0.65, C_PIER);
        }
        piers++;
      }
    }
    // ---- abutments at the ends of a bridge chain --------------------------
    for (const end of [0, 1]) {
      const node = end === 0 ? pc.nA : pc.nB;
      if (node.ends.some((e) => e.pc !== pc && e.pc.bridge)) continue; // deck continues
      const k = end === 0 ? 0 : s.m - 1;
      const k2 = end === 0 ? Math.min(s.m - 1, 1) : Math.max(0, s.m - 2);
      let tx = s.xs[k2] - s.xs[k];
      let tz = s.zs[k2] - s.zs[k];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl; // into the bridge
      const ll = Math.hypot(s.lx[k], s.lz[k]) || 1;
      const lx = s.lx[k] / ll;
      const lz = s.lz[k] / ll;
      const y = s.ys[k];
      const x0 = s.xs[k] + tx * 0.4;
      const z0 = s.zs[k] + tz * 0.4;
      const top = y - depth;
      const W = pc.hw + BACK;
      // only where there is a visible gap under the deck end
      let gap = 0;
      for (const u of [-W, 0, W]) gap = Math.max(gap, top - hf.heightAt(x0 + lx * u, z0 + lz * u));
      if (gap < 0.5) continue;
      const B = bufAt(x0, z0);
      // front wall (faces into the span) from the deck soffit down to the ground
      const n = Math.max(2, Math.ceil((W * 2) / 3));
      let pa = -1;
      let pb = -1;
      for (let q = 0; q <= n; q++) {
        const u = -W + (2 * W * q) / n;
        const x = x0 + lx * u;
        const z = z0 + lz * u;
        const g = hf.heightAt(x, z) - 0.5;
        const a = B.v(x, top, z, u * TEX, 0, C_ABUT, C_ABUT, C_ABUT * 0.98);
        const b = B.v(x, Math.min(g, top - 0.2), z, u * TEX, (top - g) * TEX, C_ABUT * 0.85, C_ABUT * 0.85, C_ABUT * 0.83);
        if (pa >= 0) B.idx.push(pa, pb, a, pb, b, a);
        pa = a;
        pb = b;
      }
      // bearing shelf lip
      box(B, x0 + tx * 0.35, top - 0.35, top, z0 + tz * 0.35, lx, lz, W, 0.35, C_ABUT * 1.05);
      // wing walls: back into the embankment, flared out 20 degrees
      for (const side of [1, -1]) {
        const ax = x0 + lx * W * side;
        const az = z0 + lz * W * side;
        const fl = 0.36; // tan(20 deg)
        let dx = -tx + lx * side * fl;
        let dz = -tz + lz * side * fl;
        const dl = Math.hypot(dx, dz);
        dx /= dl;
        dz /= dl;
        const L = Math.min(12, Math.max(4, gap * 1.6));
        let qa = -1;
        let qb = -1;
        let qc = -1;
        const steps = 4;
        for (let q = 0; q <= steps; q++) {
          const t = q / steps;
          const x = ax + dx * L * t;
          const z = az + dz * L * t;
          const g = hf.heightAt(x, z);
          const yt = Math.max(g + 0.3, y + 0.15 - (y + 0.15 - (g + 0.3)) * t * t);
          const a = B.v(x, yt, z, L * t * TEX, 0, C_ABUT, C_ABUT, C_ABUT * 0.98);
          const b = B.v(x, g - 0.5, z, L * t * TEX, (yt - g + 0.5) * TEX, C_ABUT * 0.85, C_ABUT * 0.85, C_ABUT * 0.83);
          // wall top (0.4 m thick), outward
          const c = B.v(x + lx * side * 0.4, yt, z + lz * side * 0.4, L * t * TEX, 0.08, C_ABUT, C_ABUT, C_ABUT);
          if (qa >= 0) {
            B.idx.push(qa, qb, a, qb, b, a);
            B.idx.push(qa, a, qc, a, c, qc);
          }
          qa = a;
          qb = b;
          qc = c;
        }
      }
      abutments++;
    }
  }
  return { piers, abutments };
}

// Position / left vector / height at distance d along a sampled piece.
function frameAt(s, d) {
  let k = 0;
  while (k < s.m - 2 && s.ds[k + 1] < d) k++;
  const L = s.ds[k + 1] - s.ds[k] || 1;
  const t = Math.min(1, Math.max(0, (d - s.ds[k]) / L));
  let lx = s.lx[k] + (s.lx[k + 1] - s.lx[k]) * t;
  let lz = s.lz[k] + (s.lz[k + 1] - s.lz[k]) * t;
  const ll = Math.hypot(lx, lz) || 1;
  lx /= ll;
  lz /= ll;
  return {
    x: s.xs[k] + (s.xs[k + 1] - s.xs[k]) * t,
    y: s.ys[k] + (s.ys[k + 1] - s.ys[k]) * t,
    z: s.zs[k] + (s.zs[k + 1] - s.zs[k]) * t,
    lx,
    lz
  };
}

// Axis-aligned-to-the-road box: centre (cx, cz), from y0 to y1, half-width hw
// along the left vector (lx, lz), half-depth hd along the road.
function box(B, cx, y0, y1, cz, lx, lz, hw, hd, col) {
  const tx = -lz;
  const tz = lx;
  const P = [
    [cx + lx * hw + tx * hd, cz + lz * hw + tz * hd],
    [cx - lx * hw + tx * hd, cz - lz * hw + tz * hd],
    [cx - lx * hw - tx * hd, cz - lz * hw - tz * hd],
    [cx + lx * hw - tx * hd, cz + lz * hw - tz * hd]
  ];
  const lens = [hw * 2, hd * 2, hw * 2, hd * 2];
  for (let q = 0; q < 4; q++) {
    const a = P[q];
    const b = P[(q + 1) % 4];
    const w = (y1 - y0) * TEX;
    const i0 = B.v(a[0], y1, a[1], 0, 0, col, col, col * 0.98);
    const i1 = B.v(b[0], y1, b[1], lens[q] * TEX, 0, col, col, col * 0.98);
    const i2 = B.v(a[0], y0, a[1], 0, w, col * 0.8, col * 0.8, col * 0.78);
    const i3 = B.v(b[0], y0, b[1], lens[q] * TEX, w, col * 0.8, col * 0.8, col * 0.78);
    B.idx.push(i0, i2, i1, i1, i2, i3);
  }
  const b0 = P.map((p) => B.v(p[0], y0, p[1], p[0] * TEX, p[1] * TEX, col * 0.7, col * 0.7, col * 0.7));
  B.idx.push(b0[0], b0[1], b0[2], b0[0], b0[2], b0[3]);
  const t0 = P.map((p) => B.v(p[0], y1, p[1], p[0] * TEX, p[1] * TEX, col, col, col));
  B.idx.push(t0[0], t0[2], t0[1], t0[0], t0[3], t0[2]);
}

// Round (12-sided) column from y0 to y1.
function column(B, cx, cz, y0, y1, r, col) {
  const N = 12;
  const circ = 2 * Math.PI * r;
  const h = (y1 - y0) * TEX;
  let pa = -1;
  let pb = -1;
  for (let q = 0; q <= N; q++) {
    const a = (q / N) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const u = (q / N) * circ * TEX;
    // light the column a touch by facing (fake ambient occlusion on one side)
    const k = col * (0.9 + 0.1 * Math.cos(a - 0.6));
    const t = B.v(x, y1, z, u, 0, k, k, k * 0.98);
    const b = B.v(x, y0, z, u, h, k * 0.82, k * 0.82, k * 0.8);
    if (pa >= 0) B.idx.push(pa, pb, t, pb, b, t);
    pa = t;
    pb = b;
  }
}

function maxOf(arr) {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}
