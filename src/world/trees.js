import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32 } from '../core/utils.js';

// Leafy HD trees, built in code (no GLB): a textured bark trunk with a few
// branches, and a canopy of crossed alpha-cut "leaf clump" cards using one
// small CC0 photo-leaf atlas (src/assets/hd/foliage_atlas*.jpg, built by
// scripts/build-tree-atlas.py). Palms get drooping V-folded frond cards.
//
// Every species is ONE geometry (unit height, base at y = 0, the instance
// scale is the tree height in metres) sharing ONE material, so props.js keeps
// drawing each species as a single InstancedMesh: same placement, same draw
// calls as the old Kenney box trees, ~100-170 triangles a tree.
//
// Canopy normals point out from the canopy centre (not along the card), so a
// clump of flat cards lights like a soft ball of leaves instead of flat
// sheets, and the back of a card lights the same as its front.

const DIR = './src/assets/hd/';
const PAD = 3 / 1024;
// atlas regions [u0, v0, u1, v1] (three's UV: v = 0 at the bottom of the image)
const R_CLUMP = [0 + PAD, 0 + PAD, 0.5 - PAD, 1 - PAD];
const R_FROND = [0.5 + PAD, 0.5 + PAD, 1 - PAD, 1 - PAD];
const R_BARK = [0.5 + PAD, 0 + PAD, 0.75 - PAD, 0.5 - PAD];
const R_PALMBARK = [0.75 + PAD, 0 + PAD, 1 - PAD, 0.5 - PAD];

let material = null;

export function foliageMaterial() {
  if (material) return material;
  const loader = new THREE.TextureLoader();
  const map = loader.load(DIR + 'foliage_atlas.jpg');
  map.colorSpace = THREE.SRGBColorSpace;
  const alpha = loader.load(DIR + 'foliage_atlas_alpha.jpg');
  alpha.colorSpace = THREE.NoColorSpace;
  for (const t of [map, alpha]) {
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  material = new THREE.MeshLambertMaterial({ map, alphaMap: alpha, alphaTest: 0.42, vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = (sh) => {
    // both faces of a card share the canopy normal (no back-face flip)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
  };
  material.customProgramCacheKey = () => 'izk-foliage-v1';
  material.name = 'izk-foliage';
  return material;
}

// ---- geometry builder -------------------------------------------------------
class Builder {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
  }
  v(px, py, pz, nx, ny, nz, u, w, col) {
    this.p.push(px, py, pz);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.n.push(nx / l, ny / l, nz / l);
    this.uv.push(u, w);
    this.c.push(col[0], col[1], col[2]);
  }
  // quad a-b-c-d (counter-clockwise), uv corners from region
  quad(a, b, c, d, na, nb, nc, nd, uva, uvb, uvc, uvd, col) {
    const V = (P, N, T) => this.v(P[0], P[1], P[2], N[0], N[1], N[2], T[0], T[1], col);
    V(a, na, uva), V(b, nb, uvb), V(c, nc, uvc);
    V(a, na, uva), V(c, nc, uvc), V(d, nd, uvd);
  }
  // tapered tube from p0 to p1, bark region tiled `rep` times along it
  tube(p0, p1, r0, r1, seg, region, col, rep = 1) {
    const ax = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const len = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const d = ax.map((x) => x / len);
    const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let s = cross(d, ref);
    s = norm(s);
    const t = cross(d, s);
    const [u0, v0, u1, v1] = region;
    for (let k = 0; k < rep; k++) {
      const a0 = k / rep;
      const a1 = (k + 1) / rep;
      const q0 = lerp3(p0, p1, a0);
      const q1 = lerp3(p0, p1, a1);
      const ra = r0 + (r1 - r0) * a0;
      const rb = r0 + (r1 - r0) * a1;
      for (let i = 0; i < seg; i++) {
        const A = (i / seg) * Math.PI * 2;
        const B = ((i + 1) / seg) * Math.PI * 2;
        const ca = [Math.cos(A) * s[0] + Math.sin(A) * t[0], Math.cos(A) * s[1] + Math.sin(A) * t[1], Math.cos(A) * s[2] + Math.sin(A) * t[2]];
        const cb = [Math.cos(B) * s[0] + Math.sin(B) * t[0], Math.cos(B) * s[1] + Math.sin(B) * t[1], Math.cos(B) * s[2] + Math.sin(B) * t[2]];
        const ua = u0 + ((u1 - u0) * i) / seg;
        const ub = u0 + ((u1 - u0) * (i + 1)) / seg;
        this.quad(
          add(q0, ca, ra), add(q0, cb, ra), add(q1, cb, rb), add(q1, ca, rb),
          ca, cb, cb, ca,
          [ua, v0], [ub, v0], [ub, v1], [ua, v1],
          col
        );
      }
    }
  }
  // crossed leaf-clump cards around `c`, normals out from the canopy centre `o`
  clump(c, size, o, rng, col, flat = 0) {
    const yaw = rng() * Math.PI;
    const [u0, v0, u1, v1] = R_CLUMP;
    const h = size / 2;
    const cards = flat > 0.5 ? [[yaw, 0], [yaw + 1.2, 0], [yaw, 1]] : [[yaw, 0], [yaw + Math.PI / 2, 0], [yaw + 0.6, 1]];
    for (const [a, horiz] of cards) {
      const ex = [Math.cos(a) * h, 0, Math.sin(a) * h];
      // vertical card, or a near-horizontal one (tilted) for the top/flat crowns
      const tilt = horiz ? 0.25 + rng() * 0.3 : 0;
      const ey = horiz ? [-Math.sin(a) * h * Math.cos(tilt), h * Math.sin(tilt), Math.cos(a) * h * Math.cos(tilt)] : [0, h * (flat > 0.5 ? 0.7 : 1), 0];
      const P = (sx, sy) => [c[0] + ex[0] * sx + ey[0] * sy, c[1] + ex[1] * sx + ey[1] * sy, c[2] + ex[2] * sx + ey[2] * sy];
      const N = (q) => {
        const d = [q[0] - o[0], (q[1] - o[1]) * 1.3 + 0.12, q[2] - o[2]];
        return norm(d);
      };
      const a1 = P(-1, -1), b1 = P(1, -1), c1 = P(1, 1), d1 = P(-1, 1);
      // random 90-degree turn of the clump image per card hides repeats
      const T = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const r = Math.floor(rng() * 4);
      this.quad(a1, b1, c1, d1, N(a1), N(b1), N(c1), N(d1), T[r % 4], T[(r + 1) % 4], T[(r + 2) % 4], T[(r + 3) % 4], col);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---- species ------------------------------------------------------------------
// shape: trunk height (fork point), canopy centre y, canopy radii (xz, y),
// clump count and size, leaf tint, flat = umbrella crown (acacia)
const BROAD = {
  oak: { seed: 11, trunk: 0.42, cy: 0.64, rx: 0.36, ry: 0.27, n: 18, size: 0.3, tint: [1, 1, 1], branches: 3 },
  oakDark: { seed: 23, trunk: 0.4, cy: 0.63, rx: 0.34, ry: 0.28, n: 18, size: 0.3, tint: [0.78, 0.84, 0.78], branches: 3 },
  fat: { seed: 37, trunk: 0.3, cy: 0.58, rx: 0.42, ry: 0.34, n: 20, size: 0.33, tint: [1.05, 1.08, 0.95], branches: 3 },
  detailed: { seed: 41, trunk: 0.38, cy: 0.62, rx: 0.4, ry: 0.3, n: 22, size: 0.27, tint: [0.85, 0.92, 0.82], branches: 4, lumpy: 1 },
  plateau: { seed: 53, trunk: 0.62, cy: 0.86, rx: 0.58, ry: 0.09, n: 18, size: 0.32, tint: [1.08, 1.04, 0.82], branches: 4, flat: 1 },
  tall: { seed: 67, trunk: 0.3, cy: 0.6, rx: 0.2, ry: 0.36, n: 16, size: 0.23, tint: [0.82, 0.9, 0.8], branches: 2 },
  bush: { seed: 79, trunk: 0, cy: 0.48, rx: 0.5, ry: 0.36, n: 8, size: 0.6, tint: [0.92, 0.98, 0.86], branches: 0 }
};

function broadleaf(spec) {
  const rng = mulberry32(spec.seed * 7919);
  const B = new Builder();
  const white = [1, 1, 1];
  const o = [0, spec.cy, 0];
  // trunk + branches toward the canopy
  if (spec.trunk > 0) {
    const top = [0, spec.trunk, 0];
    B.tube([0, 0, 0], top, 0.034, 0.024, 6, R_BARK, white, 2);
    for (let i = 0; i < spec.branches; i++) {
      const a = (i / spec.branches) * Math.PI * 2 + rng() * 0.8;
      const end = [Math.cos(a) * spec.rx * 0.6, spec.cy + (spec.flat ? spec.ry * 0.5 : (rng() - 0.2) * spec.ry * 0.6), Math.sin(a) * spec.rx * 0.6];
      B.tube(top, end, 0.022, 0.008, 4, R_BARK, white, 1);
    }
    if (!spec.flat) B.tube(top, [0, spec.cy + spec.ry * 0.5, 0], 0.022, 0.01, 4, R_BARK, white, 1);
  }
  // leaf clumps over an ellipsoid shell (plus a couple inside for density)
  for (let i = 0; i < spec.n; i++) {
    let x, y, z;
    if (i < spec.n - 2) {
      // even-ish spread over the upper ~85% of a sphere
      const t = (i + 0.5) / (spec.n - 2);
      const phi = Math.acos(1 - 1.7 * t); // from top down
      const th = i * 2.39996 + rng() * 0.5;
      const r = spec.lumpy ? 0.75 + rng() * 0.35 : 0.82 + rng() * 0.18;
      x = Math.sin(phi) * Math.cos(th) * spec.rx * r;
      y = Math.cos(phi) * spec.ry * r;
      z = Math.sin(phi) * Math.sin(th) * spec.rx * r;
    } else {
      x = (rng() - 0.5) * spec.rx * 0.6;
      y = (rng() - 0.3) * spec.ry * 0.5;
      z = (rng() - 0.5) * spec.rx * 0.6;
    }
    const shade = 0.88 + rng() * 0.22;
    const col = [spec.tint[0] * shade, spec.tint[1] * shade, spec.tint[2] * shade];
    B.clump([x, spec.cy + y, z], spec.size * (0.85 + rng() * 0.3), o, rng, col, spec.flat || 0);
  }
  return B.geometry();
}

function palm(bend, seed) {
  const rng = mulberry32(seed);
  const B = new Builder();
  const barkCol = [1.35, 1.28, 1.15]; // the palm bark photo is dark
  // curved trunk in 6 pieces
  const top = 0.84;
  let prev = [0, 0, 0];
  const N = 6;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const p = [bend * t * t, top * t, 0];
    B.tube(prev, p, 0.024 - 0.008 * ((i - 1) / N), 0.024 - 0.008 * (i / N), 6, R_PALMBARK, barkCol, 1);
    prev = p;
  }
  const crown = prev;
  // fronds: V-folded strips that rise then droop
  const [u0, v0, u1, v1] = R_FROND;
  const vm = (v0 + v1) / 2;
  const F = 15;
  for (let f = 0; f < F; f++) {
    const yaw = (f / F) * Math.PI * 2 + rng() * 0.4;
    const young = f % 5 === 0;
    const L = (young ? 0.34 : 0.5) * (0.9 + rng() * 0.2);
    const W = L * 0.3;
    const dir = [Math.cos(yaw), 0, Math.sin(yaw)];
    const side = [-dir[2], 0, dir[0]];
    const pitch0 = young ? 1.0 : 0.45 + rng() * 0.3;
    const S = 4;
    let p = [crown[0], crown[1] + 0.01, crown[2]];
    let pitch = pitch0;
    const shade = 0.85 + rng() * 0.25;
    const col = [shade, shade, shade * 0.95];
    const fold = 0.45; // V fold: leaflets hang down from the midrib
    for (let s = 0; s < S; s++) {
      const seg = L / S;
      const fwd = [dir[0] * Math.cos(pitch), Math.sin(pitch), dir[2] * Math.cos(pitch)];
      const q = add(p, fwd, seg);
      const wa = W * (s === 0 ? 0.55 : 1) * (1 - 0.15 * s);
      const wb = W * (1 - 0.15 * (s + 1)) * (s === S - 1 ? 0.35 : 1);
      const ua = u0 + ((u1 - u0) * s) / S;
      const ub = u0 + ((u1 - u0) * (s + 1)) / S;
      const up = [0, 1, 0];
      for (const sg of [-1, 1]) {
        const ox = (w) => [side[0] * sg * w * Math.cos(fold), -w * Math.sin(fold), side[2] * sg * w * Math.cos(fold)];
        const pa = add(p, ox(wa), 1);
        const qa = add(q, ox(wb), 1);
        const nOut = norm([side[0] * sg * 0.4 + fwd[0] * 0.2, 1, side[2] * sg * 0.4 + fwd[2] * 0.2]);
        const ve = sg > 0 ? v1 : v0;
        B.quad(p, q, qa, pa, up, up, nOut, nOut, [ua, vm], [ub, vm], [ub, ve], [ua, ve], col);
      }
      p = q;
      pitch -= young ? 0.3 : 0.38 + rng() * 0.12;
    }
  }
  return B.geometry();
}

const cache = new Map();

/** Geometry for a species: oak, oakDark, fat, detailed, plateau, tall, bush, palm, palmBend. */
export function treeGeometry(kind) {
  let g = cache.get(kind);
  if (g) return g;
  if (kind === 'palm') g = palm(0.04, 101);
  else if (kind === 'palmBend') g = palm(0.2, 211);
  else if (BROAD[kind]) g = broadleaf(BROAD[kind]);
  else throw new Error('unknown tree ' + kind);
  // normalise to unit height (the instance scale is the height in metres)
  g.computeBoundingBox();
  const k = 1 / (g.boundingBox.max.y || 1);
  g.scale(k, k, k);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(kind, g);
  return g;
}

/** { geometry, material } like loadKitModel, scaled to `height` metres if given. */
export function treeModel(kind, height = 1) {
  const geometry = treeGeometry(kind).clone();
  if (height !== 1) geometry.scale(height, height, height);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, material: foliageMaterial(), size: geometry.boundingBox.getSize(new THREE.Vector3()) };
}
