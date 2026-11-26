import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries, toCreasedNormals } from '../../vendor/three/BufferGeometryUtils.js';
import { blobMaterial, blobGeometry } from '../world/blobShadow.js';
import { WORLD } from '../world/worldLight.js';

// HD traffic cars, built in code (CC0, this project). No brand logos.
//
// Every car is ONE merged geometry with ONE material, so a whole type of
// traffic costs one draw call (plus the shared wheels and plates):
//  - smooth bodies: side profiles with rounded corners and wheel arches,
//    extruded with a bevel and smoothed with creased normals
//  - a per-vertex "surf" attribute says what each part is made of:
//    (paint mask, metalness, roughness, lamp glow). Paint takes the
//    per-car instance colour; glass, chrome, rubber and lamps do not.
//  - glass and chrome reflect the scene environment map
//  - lamps glow at night (emissive from the same vertex colour)
// Each type also has a light LOD (~1/4 of the triangles) for far cars.
// Number plates: KZN "ND 123-456" style (made-up numbers) from one atlas.

// [paint mask, metalness, roughness, lamp]
const PAINT = [1, 0.35, 0.3, 0];
const FIXED = [0, 0.3, 0.34, 0];
const GLASS = [0, 0.9, 0.04, 0];
const CHROME = [0, 1, 0.12, 0];
const PLASTIC = [0, 0, 0.62, 0];
const RUBBER = [0, 0, 0.9, 0];
const RIM = [0, 0.85, 0.28, 0];
const HEAD = [0, 0.5, 0.06, 1];
const TAIL = [0, 0.2, 0.18, 1];
const AMBER = [0, 0.2, 0.2, 0.35];
const DARK = [0, 0, 0.8, 0];

const C = {
  white: 0xffffff,
  glass: 0x2b3640,
  chrome: 0xd8dde2,
  black: 0x18191b,
  trim: 0x2a2c2f,
  tyre: 0x161718,
  rim: 0xb8bdc3,
  rimDark: 0x3a3d41,
  head: 0xf4f7fa,
  tail: 0xc0141a,
  amber: 0xff8a10,
  grille: 0x111214,
  under: 0x0d0e0f
};

// ---------------------------------------------------------------- geometry kit
class Kit {
  constructor() {
    this.list = [];
  }
  add(geo, hex, surf) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const c = new THREE.Color(hex);
    const col = new Float32Array(n * 3);
    const sf = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      sf[i * 4] = surf[0];
      sf[i * 4 + 1] = surf[1];
      sf[i * 4 + 2] = surf[2];
      sf[i * 4 + 3] = surf[3];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('surf', new THREE.BufferAttribute(sf, 4));
    this.list.push(g);
    return g;
  }
  box(w, h, d, x, y, z, hex, surf, rx = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return this.add(g, hex, surf);
  }
  // disc facing +z or -z (lamps)
  disc(r, x, y, z, hex, surf, face = 1, seg = 12) {
    const g = new THREE.CylinderGeometry(r, r, 0.04, seg);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z + face * 0.0);
    return this.add(g, hex, surf);
  }
  merged() {
    return mergeGeometries(this.list);
  }
}

// Shape in the side plane (X = vehicle z, Y = height) from a list of ops:
//  [z, y, cornerRadius]  or  ['arch', zCentre, yCentre, R]
function sideShape(ops) {
  const pts = [];
  // expand arches into points, keep corner radii
  for (const op of ops) {
    if (op[0] === 'arch') {
      const [, zc, yc, R] = op;
      const yb = Math.min(yc, pts.length ? pts[pts.length - 1].y : yc);
      pts.push({ z: zc - R, y: yb, r: 0 });
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI - (i / n) * Math.PI;
        pts.push({ z: zc + Math.cos(a) * R, y: yc + Math.sin(a) * R, r: 0 });
      }
      pts.push({ z: zc + R, y: yb, r: 0 });
    } else pts.push({ z: op[0], y: op[1], r: op[2] || 0 });
  }
  const s = new THREE.Shape();
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + N) % N];
    const b = pts[(i + 1) % N];
    if (p.r > 0) {
      const la = Math.hypot(a.z - p.z, a.y - p.y) || 1;
      const lb = Math.hypot(b.z - p.z, b.y - p.y) || 1;
      const ra = Math.min(p.r, la * 0.45);
      const rb = Math.min(p.r, lb * 0.45);
      const p0 = [p.z + ((a.z - p.z) / la) * ra, p.y + ((a.y - p.y) / la) * ra];
      const p1 = [p.z + ((b.z - p.z) / lb) * rb, p.y + ((b.y - p.y) / lb) * rb];
      if (i === 0) s.moveTo(p0[0], p0[1]);
      else s.lineTo(p0[0], p0[1]);
      s.quadraticCurveTo(p.z, p.y, p1[0], p1[1]);
    } else if (i === 0) s.moveTo(p.z, p.y);
    else s.lineTo(p.z, p.y);
  }
  s.closePath();
  return s;
}

// Extrude a side shape across the car (full width `width`, centred on x = 0).
function extrude(ops, width, bevel, segs, curveSegs, x = 0) {
  const shape = sideShape(ops);
  const b = Math.min(bevel, width * 0.3);
  const depth = Math.max(0.005, width - 2 * b);
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: b > 0 && segs > 0, bevelThickness: b, bevelSize: Math.min(b * 0.35, 0.025), bevelSegments: Math.max(1, segs), curveSegments: curveSegs, steps: 1 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // shape X -> vehicle +Z, extrusion -> vehicle X
  g.translate(x, 0, 0);
  g.deleteAttribute('uv');
  g = toCreasedNormals(g, (38 * Math.PI) / 180);
  return g;
}

// Thin flat panel on the car side (x = ±xs), from a side polygon.
function sidePanel(kit, pts, xs, t, hex, surf) {
  for (const s of [1, -1]) {
    const shape = sideShape(pts.map((p) => [p[0], p[1], 0]));
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    g.rotateY(-Math.PI / 2);
    g.translate(s * xs + (s > 0 ? t : 0), 0, 0);
    kit.add(g, hex, surf);
  }
}

// --------------------------------------------------------------------- wheels
// One road wheel of radius 1 (scaled per car): rounded tyre, five-spoke alloy.
// Axle along X, centred, outer face at +x (same convention as models.js).
export function hdWheelGeometry(detail = 1) {
  const kit = new Kit();
  const seg = detail ? 16 : 10;
  const prof = detail
    ? [[0.62, -0.28], [0.86, -0.3], [0.96, -0.27], [1.0, -0.18], [1.0, 0.18], [0.96, 0.27], [0.86, 0.3], [0.62, 0.28]]
    : [[0.62, -0.28], [0.97, -0.29], [1.0, 0.0], [0.97, 0.29], [0.62, 0.28]];
  const tyre = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), seg);
  tyre.rotateZ(-Math.PI / 2);
  kit.add(tyre, C.tyre, RUBBER);
  // rim lip + dark dish
  const lip = new THREE.LatheGeometry([new THREE.Vector2(0.62, 0.28), new THREE.Vector2(0.66, 0.29), new THREE.Vector2(0.63, 0.25)], seg);
  lip.rotateZ(-Math.PI / 2);
  kit.add(lip, C.rim, RIM);
  const dish = new THREE.CircleGeometry(0.61, seg);
  dish.rotateY(Math.PI / 2);
  dish.translate(0.21, 0, 0);
  kit.add(dish, C.rimDark, DARK);
  if (detail) {
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.BoxGeometry(0.05, 0.46, 0.13);
      sp.translate(0.24, 0.36, 0);
      sp.rotateX((k / 5) * Math.PI * 2);
      kit.add(sp, C.rim, RIM);
    }
  } else {
    const face = new THREE.CircleGeometry(0.5, 5);
    face.rotateY(Math.PI / 2);
    face.translate(0.235, 0, 0);
    kit.add(face, C.rim, RIM);
  }
  const hub = new THREE.CylinderGeometry(0.17, 0.19, 0.06, detail ? 10 : 6);
  hub.rotateZ(Math.PI / 2);
  hub.translate(0.25, 0, 0);
  kit.add(hub, C.chrome, CHROME);
  return kit.merged();
}

let wheelMat = null;
export function hdWheelMaterial() {
  if (!wheelMat) wheelMat = makeCarMaterial(false);
  return wheelMat;
}

function wheelX(spec) {
  return spec.W / 2 - 0.3 * spec.r - 0.03;
}

function bakeWheels(kit, spec, detail) {
  const g = hdWheelGeometry(detail);
  const r = spec.r;
  const xs = wheelX(spec);
  for (const z of [spec.zF, spec.zR]) {
    for (const s of [1, -1]) {
      const w = g.clone();
      w.scale(r, r, r);
      if (s < 0) w.rotateY(Math.PI);
      w.translate(s * xs, r, z);
      // re-apply colours/surf (cloned attributes are kept)
      kit.list.push(w);
    }
  }
}

// ---------------------------------------------------------------- car specs
// Real sizes (m). front = +Z.
const SPECS = {
  // VW Polo Vivo hatch (~3.97 x 1.68 x 1.46)
  polo: { L: 3.97, W: 1.68, r: 0.31, zF: 1.26, zR: -1.21, kind: 'hatch', plateF: 0.5, plateR: 0.72, paint: true },
  // BMW E30 2-door (~4.33 x 1.65 x 1.38), traffic version of the gusheshe
  gusheshe: { L: 4.33, W: 1.65, r: 0.31, zF: 1.31, zR: -1.26, kind: 'sedan', plateF: 0.42, plateR: 0.62, paint: true },
  // Toyota Hilux single-cab bakkie (~5.3 x 1.85 x 1.8)
  hilux: { L: 5.2, W: 1.84, r: 0.38, zF: 1.72, zR: -1.4, kind: 'bakkie', plateF: 0.52, plateR: 0.62, paint: true },
  // SAPS double-cab bakkie with canopy (white, blue band, light bar)
  saps: { L: 5.25, W: 1.86, r: 0.38, zF: 1.74, zR: -1.4, kind: 'police', plateF: 0.52, plateR: 0.62, paint: false },
  // Toyota Quantum minibus taxi (~5.38 x 1.88 x 2.28)
  quantum: { L: 5.38, W: 1.88, r: 0.36, zF: 1.78, zR: -1.42, kind: 'van', plateF: 0.48, plateR: 0.62, paint: true }
};
export function hdSpec(id) {
  return SPECS[id] || null;
}

function body(kit, ops, spec, P, lod) {
  kit.add(extrude(ops, spec.W, lod ? 0 : 0.07, lod ? 0 : 3, lod ? 3 : 8), C.white, P);
}

function greenhouse(kit, ops, w, lod) {
  kit.add(extrude(ops, w, lod ? 0 : 0.06, lod ? 0 : 2, lod ? 2 : 6), C.glass, GLASS);
}

function lampsFront(kit, spec, y, xs, hw, hh, round) {
  const z = spec.L / 2;
  for (const s of [1, -1]) {
    if (round) {
      kit.disc(0.085, s * (xs - 0.11), y, z + 0.01, C.head, HEAD, 1, 10);
      kit.disc(0.085, s * (xs + 0.11), y, z + 0.01, C.head, HEAD, 1, 10);
      kit.box(0.46, 0.2, 0.04, s * xs, y, z - 0.005, C.grille, PLASTIC);
    } else {
      kit.box(hw, hh, 0.06, s * xs, y, z - 0.01, C.head, HEAD);
      kit.box(hw + 0.04, hh + 0.04, 0.04, s * xs, y, z - 0.03, C.chrome, CHROME);
    }
    kit.box(0.12, 0.06, 0.05, s * (spec.W / 2 - 0.12), y - hh * 0.5 - 0.1, z - 0.01, C.amber, AMBER);
  }
}

function lampsRear(kit, spec, y, xs, hw, hh) {
  const z = -spec.L / 2 - 0.005;
  for (const s of [1, -1]) {
    kit.box(hw, hh, 0.06, s * xs, y, z, C.tail, TAIL);
    kit.box(hw * 0.3, hh * 0.45, 0.065, s * (xs - hw * 0.25), y - hh * 0.2, z, C.head, [0, 0.4, 0.1, 0]);
    kit.box(hw * 0.28, hh * 0.45, 0.065, s * (xs + hw * 0.32), y + hh * 0.2, z, C.amber, AMBER);
  }
}

function bumpers(kit, spec, yF, yR, h, col = C.black, surf = PLASTIC) {
  kit.box(spec.W + 0.02, h, 0.16, 0, yF, spec.L / 2 - 0.03, col, surf);
  kit.box(spec.W + 0.02, h, 0.16, 0, yR, -spec.L / 2 + 0.03, col, surf);
}

function mirrors(kit, spec, z, y, paintSurf) {
  for (const s of [1, -1]) {
    kit.box(0.06, 0.05, 0.05, s * (spec.W / 2 + 0.02), y - 0.02, z, C.black, PLASTIC);
    kit.box(0.08, 0.12, 0.15, s * (spec.W / 2 + 0.09), y, z - 0.02, C.white, paintSurf);
    kit.box(0.012, 0.1, 0.12, s * (spec.W / 2 + 0.13), y, z - 0.02, C.glass, GLASS);
  }
}

function doorLines(kit, spec, zs, y0, y1) {
  for (const s of [1, -1]) for (const z of zs) kit.box(0.012, y1 - y0, 0.012, s * (spec.W / 2 + 0.002), (y0 + y1) / 2, z, C.trim, DARK);
}

function handles(kit, spec, zs, y) {
  for (const s of [1, -1]) for (const z of zs) kit.box(0.02, 0.03, 0.16, s * (spec.W / 2 + 0.008), y, z, C.chrome, CHROME);
}

// ------------------------------------------------------------ per-type bodies
function buildHatch(kit, spec, lod) {
  const { L, W, r, zF, zR } = spec;
  const R = r + 0.06;
  const h = L / 2;
  const ops = [
    [-h, 0.42, 0.06], [-h + 0.05, 0.25, 0.04], ['arch', zR, r, R], ['arch', zF, r, R], [h - 0.06, 0.25, 0.04],
    [h, 0.42, 0.08], [h - 0.03, 0.66, 0.12], [h - 0.35, 0.84, 0.2], [0.88, 0.93, 0.1], [-h + 0.1, 0.97, 0.06], [-h - 0.01, 0.86, 0.08]
  ];
  body(kit, ops, spec, PAINT, lod);
  const gw = W - 0.16;
  const gh = [[0.9, 0.9, 0.02], [0.05, 1.42, 0.12], [-1.55, 1.44, 0.14], [-h + 0.02, 1.2, 0.08], [-h + 0.08, 0.92, 0.02]];
  greenhouse(kit, gh, gw, lod);
  // roof (paint) over the glass
  kit.add(extrude([[0.06, 1.38, 0], [-1.55, 1.39, 0], [-1.62, 1.47, 0.05], [0.12, 1.47, 0.05]], gw + 0.04, lod ? 0 : 0.03, lod ? 0 : 1, 2), C.white, PAINT);
  if (!lod) {
    // C pillar + B pillar
    sidePanel(kit, [[-0.95, 0.93], [-1.25, 1.42], [-1.6, 1.42], [-h + 0.08, 1.15], [-h + 0.1, 0.93]], gw / 2, 0.02, C.white, PAINT);
    sidePanel(kit, [[-0.18, 0.93], [-0.18, 1.42], [-0.26, 1.42], [-0.26, 0.93]], gw / 2, 0.025, C.black, PLASTIC);
    // A pillars
    sidePanel(kit, [[0.9, 0.92], [0.06, 1.44], [0.0, 1.42], [0.8, 0.92]], gw / 2, 0.02, C.white, PAINT);
    doorLines(kit, spec, [0.86, -0.22, -0.98], 0.32, 0.93);
    handles(kit, spec, [0.2, -0.55], 0.86);
    mirrors(kit, spec, 0.78, 1.0, PAINT);
    // side rubbing strip
    for (const s of [1, -1]) kit.box(0.02, 0.05, 1.8, s * (W / 2 + 0.005), 0.5, -0.05, C.black, PLASTIC);
    // grille + lower intake
    kit.box(0.9, 0.12, 0.04, 0, 0.66, h - 0.025, C.grille, PLASTIC);
    kit.box(1.0, 0.14, 0.04, 0, 0.36, h + 0.04, C.grille, PLASTIC);
    // rear wiper + hatch line
    kit.box(0.03, 0.015, 0.4, 0, 1.18, -h + 0.04, C.black, PLASTIC, -1.2);
  }
  lampsFront(kit, spec, 0.68, 0.56, 0.36, 0.14, false);
  lampsRear(kit, spec, 0.9, 0.62, 0.22, 0.2);
  bumpers(kit, spec, 0.4, 0.42, 0.24, C.white, PAINT);
  kit.box(W - 0.2, 0.08, 0.05, 0, 0.3, h + 0.04, C.black, PLASTIC);
  kit.box(W - 0.2, 0.08, 0.05, 0, 0.3, -h - 0.04, C.black, PLASTIC);
}

function buildSedan(kit, spec, lod) {
  const { L, W, r, zF, zR } = spec;
  const R = r + 0.05;
  const h = L / 2;
  const ops = [
    [-h, 0.38, 0.04], [-h + 0.05, 0.24, 0.03], ['arch', zR, r, R], ['arch', zF, r, R], [h - 0.05, 0.24, 0.03],
    [h, 0.4, 0.04], [h, 0.74, 0.06], [h - 0.1, 0.8, 0.06], [0.62, 0.9, 0.05], [-1.36, 0.92, 0.04], [-h + 0.05, 0.93, 0.05], [-h, 0.84, 0.04]
  ];
  body(kit, ops, spec, PAINT, lod);
  const gw = W - 0.14;
  const gh = [[0.66, 0.88, 0.02], [0.0, 1.34, 0.06], [-0.92, 1.35, 0.06], [-1.36, 0.92, 0.02]];
  greenhouse(kit, gh, gw, lod);
  kit.add(extrude([[0.01, 1.31, 0], [-0.93, 1.32, 0], [-0.96, 1.38, 0.03], [0.05, 1.37, 0.03]], gw + 0.04, lod ? 0 : 0.025, lod ? 0 : 1, 2), C.white, PAINT);
  if (!lod) {
    sidePanel(kit, [[-0.7, 0.92], [-0.86, 1.33], [-0.95, 1.33], [-1.3, 0.92]], gw / 2, 0.02, C.white, PAINT);
    sidePanel(kit, [[0.64, 0.9], [0.02, 1.34], [-0.04, 1.33], [0.56, 0.9]], gw / 2, 0.02, C.white, PAINT);
    sidePanel(kit, [[-0.42, 0.92], [-0.42, 1.33], [-0.47, 1.33], [-0.47, 0.92]], gw / 2, 0.025, C.black, PLASTIC);
    doorLines(kit, spec, [0.6, -0.5], 0.3, 0.9);
    handles(kit, spec, [-0.36], 0.84);
    mirrors(kit, spec, 0.52, 0.98, PAINT);
    for (const s of [1, -1]) {
      kit.box(0.02, 0.06, L - 0.9, s * (W / 2 + 0.006), 0.56, 0, C.black, PLASTIC);
      kit.box(0.012, 0.025, 1.95, s * (gw / 2 + 0.01), 0.92, -0.35, C.chrome, CHROME); // window chrome
    }
    // twin centre grille (plain, no badge)
    kit.box(0.13, 0.17, 0.04, 0.09, 0.62, h + 0.01, C.chrome, CHROME);
    kit.box(0.13, 0.17, 0.04, -0.09, 0.62, h + 0.01, C.chrome, CHROME);
    kit.box(0.1, 0.13, 0.045, 0.09, 0.62, h + 0.015, C.grille, PLASTIC);
    kit.box(0.1, 0.13, 0.045, -0.09, 0.62, h + 0.015, C.grille, PLASTIC);
  }
  lampsFront(kit, spec, 0.62, 0.48, 0.4, 0.17, !lod);
  lampsRear(kit, spec, 0.76, 0.56, 0.42, 0.15);
  kit.box(0.5, 0.15, 0.03, 0, 0.76, -h - 0.01, C.black, PLASTIC); // number panel between tail lamps
  bumpers(kit, spec, 0.42, 0.44, 0.15);
}

function cabAndBed(kit, spec, lod, double) {
  const { L, W, r, zF, zR } = spec;
  const R = r + 0.08;
  const h = L / 2;
  const belt = 1.12;
  const cabBack = double ? -1.0 : -0.25;
  const open = double !== 'police';
  const floor = 0.78;
  const ops = open
    ? [
        [-h, 0.5, 0.04], [-h + 0.04, 0.42, 0.02], ['arch', zR, r + 0.02, R], ['arch', zF, r + 0.02, R], [h - 0.1, 0.4, 0.04],
        [h, 0.56, 0.06], [h - 0.02, 0.92, 0.08], [h - 0.3, 1.08, 0.14], [1.2, belt, 0.06], [cabBack - 0.05, belt, 0.02], [cabBack - 0.05, floor, 0], [-h, floor, 0]
      ]
    : [
        [-h, 0.5, 0.04], [-h + 0.04, 0.42, 0.02], ['arch', zR, r + 0.02, R], ['arch', zF, r + 0.02, R], [h - 0.1, 0.4, 0.04],
        [h, 0.56, 0.06], [h - 0.02, 0.92, 0.08], [h - 0.3, 1.08, 0.14], [1.2, belt, 0.06], [-h + 0.02, belt, 0.04], [-h, 1.08, 0.03]
      ];
  body(kit, ops, spec, double === 'police' ? FIXED : PAINT, lod);
  const gw = W - 0.14;
  const gh = [[1.25, belt - 0.02, 0.02], [0.5, 1.74, 0.1], [cabBack + 0.03, 1.76, 0.06], [cabBack, belt - 0.02, 0.02]];
  greenhouse(kit, gh, gw, lod);
  const bodySurf = double === 'police' ? FIXED : PAINT;
  kit.add(extrude([[0.52, 1.7, 0], [cabBack, 1.71, 0], [cabBack, 1.8, 0.04], [0.56, 1.8, 0.04]], gw + 0.04, lod ? 0 : 0.03, lod ? 0 : 1, 2), C.white, bodySurf);
  // load bed: dark tub inset into the top of the rear body
  if (double === 'police') {
    // canopy over the bed, with dark side windows
    kit.add(extrude([[cabBack - 0.04, belt, 0], [cabBack - 0.04, 1.72, 0.04], [-h + 0.06, 1.7, 0.04], [-h + 0.04, belt, 0]], W - 0.1, lod ? 0 : 0.04, lod ? 0 : 1, 2), C.white, FIXED);
    if (!lod) sidePanel(kit, [[cabBack - 0.2, 1.22], [cabBack - 0.2, 1.58], [-h + 0.3, 1.58], [-h + 0.3, 1.22]], (W - 0.1) / 2, 0.02, C.glass, GLASS);
  } else {
    // open tub: dark floor, painted side walls and tailgate, top rails
    const tubLen = cabBack - 0.05 + h;
    const tubMid = (cabBack - 0.05 - h) / 2;
    kit.box(W - 0.12, 0.03, tubLen, 0, floor + 0.02, tubMid, C.trim, PLASTIC);
    for (const s of [1, -1]) {
      kit.box(0.07, belt - floor + 0.01, tubLen, s * (W / 2 - 0.035), (belt + floor) / 2, tubMid, C.white, PAINT);
      if (!lod) kit.box(0.09, 0.03, tubLen, s * (W / 2 - 0.045), belt + 0.01, tubMid, C.black, PLASTIC);
    }
    kit.box(W, belt - floor + 0.01, 0.06, 0, (belt + floor) / 2, -h + 0.03, C.white, PAINT); // tailgate
    kit.box(W - 0.1, belt - floor, 0.05, 0, (belt + floor) / 2, cabBack - 0.07, C.white, PAINT); // front wall
    if (!lod) {
      kit.box(W - 0.12, 0.04, 0.04, 0, belt + 0.3, cabBack - 0.08, C.black, PLASTIC); // headboard rail
      for (const s of [1, -1]) kit.box(0.04, 0.3, 0.04, s * (W / 2 - 0.1), belt + 0.15, cabBack - 0.08, C.black, PLASTIC);
    }
  }
  if (!lod) {
    sidePanel(kit, [[cabBack + 0.25, belt], [cabBack + 0.25, 1.74], [cabBack + 0.02, 1.75], [cabBack + 0.02, belt]], gw / 2, 0.02, C.white, bodySurf);
    sidePanel(kit, [[1.25, belt], [0.52, 1.76], [0.46, 1.74], [1.15, belt]], gw / 2, 0.02, C.white, bodySurf);
    if (double) sidePanel(kit, [[-0.38, belt], [-0.38, 1.74], [-0.46, 1.74], [-0.46, belt]], gw / 2, 0.025, C.black, PLASTIC);
    doorLines(kit, spec, double ? [1.2, -0.42, cabBack + 0.02] : [1.2, cabBack + 0.02], 0.46, belt);
    handles(kit, spec, double ? [-0.3, cabBack + 0.16] : [cabBack + 0.16], 1.02);
    mirrors(kit, spec, 1.15, 1.22, double === 'police' ? FIXED : PAINT);
    // grille, step bars
    kit.box(1.0, 0.3, 0.04, 0, 0.82, h - 0.01, C.grille, PLASTIC);
    kit.box(1.04, 0.035, 0.05, 0, 0.9, h + 0.01, C.chrome, CHROME);
    kit.box(1.04, 0.035, 0.05, 0, 0.76, h + 0.01, C.chrome, CHROME);
    for (const s of [1, -1]) kit.box(0.12, 0.05, 1.6, s * (W / 2 - 0.02), 0.4, (zF + zR) / 2 + 0.1, C.black, PLASTIC);
  }
  lampsFront(kit, spec, 0.86, 0.66, 0.3, 0.16, false);
  lampsRear(kit, spec, 0.92, W / 2 - 0.1, 0.12, 0.34);
  bumpers(kit, spec, 0.52, 0.5, 0.2, C.chrome, double === 'police' ? PLASTIC : CHROME);
  if (double === 'police') {
    // blue band + yellow/blue checks, "POLICE" is not drawn (plain shapes only)
    for (const s of [1, -1]) {
      kit.box(0.012, 0.2, L - 0.5, s * (W / 2 + 0.004), 0.82, 0, 0x1f4fa8, [0, 0.1, 0.4, 0]);
      for (let k = 0; k < 14; k++) kit.box(0.014, 0.07, 0.14, s * (W / 2 + 0.006), 0.66 + (k % 2) * 0.07, -1.0 + k * 0.14, k % 2 ? 0xf2c230 : 0x1f4fa8, [0, 0.1, 0.4, 0]);
    }
    // light bar on the cab roof
    kit.box(1.2, 0.1, 0.3, 0, 1.86, 0.0, C.black, PLASTIC);
    kit.box(0.5, 0.12, 0.26, -0.32, 1.95, 0.0, 0x2f6bff, [0, 0.2, 0.1, 0.8]);
    kit.box(0.5, 0.12, 0.26, 0.32, 1.95, 0.0, 0xff2a20, [0, 0.2, 0.1, 0.8]);
  }
}

function buildVan(kit, spec, lod) {
  const { L, W, r, zF, zR } = spec;
  const R = r + 0.07;
  const h = L / 2;
  const belt = 1.18;
  const roof = 2.2;
  const ops = [
    [-h, 0.5, 0.05], [-h + 0.05, 0.36, 0.03], ['arch', zR, r, R], ['arch', zF, r, R], [h - 0.08, 0.34, 0.04],
    [h, 0.5, 0.08], [h - 0.02, 0.98, 0.1], [h - 0.16, belt, 0.1], [-h + 0.02, belt, 0.03], [-h, 1.1, 0.03]
  ];
  body(kit, ops, spec, PAINT, lod);
  const gw = W - 0.1;
  const gh = [[h - 0.14, belt - 0.02, 0.02], [h - 0.62, 1.95, 0.12], [-h + 0.05, 1.98, 0.05], [-h + 0.02, belt - 0.02, 0.02]];
  greenhouse(kit, gh, gw, lod);
  // high roof
  kit.add(extrude([[h - 0.62, 1.9, 0], [-h + 0.03, 1.92, 0], [-h + 0.02, roof - 0.04, 0.06], [-h + 0.12, roof, 0.08], [h - 0.86, roof, 0.14], [h - 0.66, 1.95, 0.05]], W - 0.06, lod ? 0 : 0.05, lod ? 0 : 2, 3), C.white, PAINT);
  if (!lod) {
    // window pillars along the sides (paint), sliding door line
    const pz = [h - 0.85, 0.85, -0.05, -0.95, -1.85, -h + 0.12];
    for (const z of pz) sidePanel(kit, [[z + 0.06, belt], [z + 0.06, 1.97], [z - 0.06, 1.97], [z - 0.06, belt]], gw / 2, 0.02, C.white, PAINT);
    sidePanel(kit, [[h - 0.14, belt], [h - 0.62, 1.96], [h - 0.7, 1.96], [h - 0.26, belt]], gw / 2, 0.02, C.white, PAINT);
    doorLines(kit, spec, [h - 0.25, 1.05, 0.0, -h + 0.1], 0.4, belt);
    handles(kit, spec, [1.15, 0.12], 1.02);
    mirrors(kit, spec, h - 0.3, 1.28, PAINT);
    // sliding-door rail and roof rails
    for (const s of [1, -1]) {
      kit.box(0.02, 0.03, 1.9, s * (W / 2 + 0.006), belt - 0.06, -1.0, C.trim, DARK);
      kit.box(0.05, 0.05, 3.6, s * (W / 2 - 0.12), roof + 0.03, -0.4, C.black, PLASTIC);
    }
    kit.box(1.1, 0.26, 0.04, 0, 0.78, h + 0.01, C.grille, PLASTIC);
    kit.box(1.12, 0.03, 0.05, 0, 0.88, h + 0.02, C.chrome, CHROME);
  }
  lampsFront(kit, spec, 0.92, 0.66, 0.34, 0.16, false);
  lampsRear(kit, spec, 1.02, W / 2 - 0.1, 0.12, 0.4);
  bumpers(kit, spec, 0.48, 0.48, 0.22, C.trim, PLASTIC);
}

function buildCar(id, lod) {
  const spec = SPECS[id];
  const kit = new Kit();
  if (spec.kind === 'hatch') buildHatch(kit, spec, lod);
  else if (spec.kind === 'sedan') buildSedan(kit, spec, lod);
  else if (spec.kind === 'bakkie') cabAndBed(kit, spec, lod, false);
  else if (spec.kind === 'police') cabAndBed(kit, spec, lod, 'police');
  else buildVan(kit, spec, lod);
  // dark underside between the wheels
  kit.box(spec.W - 0.25, 0.1, spec.L - 0.6, 0, spec.r * 0.85, 0, C.under, DARK);
  return kit;
}

// --------------------------------------------------------------- material
// One shared material for all HD cars. Paint = vertex colour x instance colour
// (where surf.x = 1); metal/rough per vertex; lamps glow at night.
const LAMP = { value: 0 };
export function makeCarMaterial(lamps = true) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, envMapIntensity: 1.25 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLamp = LAMP;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 surf;\nvarying vec4 vSurf;')
      .replace(
        '#include <color_vertex>',
        `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, surf.x );
#endif
vSurf = surf;`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vSurf;\nuniform float uLamp;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurf.z;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.y;')
      .replace('#include <emissivemap_fragment>', lamps ? '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSurf.w * uLamp * 2.2;' : '#include <emissivemap_fragment>');
  };
  m.customProgramCacheKey = () => (lamps ? 'hdcar-l' : 'hdcar');
  return m;
}
// call once per frame (cheap): lamps follow the world night value
export function updateCarLamps() {
  const n = WORLD.night.value;
  LAMP.value = n > 0.15 ? Math.min(1, n * 1.3) : 0;
}

// ---------------------------------------------------------------- models
const cache = new Map();
let sharedMat = null;

// Traffic/parked model: { parts, size, trafficParts, lod, plates, hd: true }
//  parts:        body WITH baked wheels + plate quads + blob (parked cars, learners)
//  trafficParts: body without wheels (traffic adds spinning wheels) + blob
//  lod:          one light geometry (simple baked wheels) for far traffic
export function hdTrafficModel(id) {
  if (!SPECS[id]) return null;
  if (cache.has(id)) return cache.get(id);
  const spec = SPECS[id];
  if (!sharedMat) sharedMat = makeCarMaterial(true);
  const hiKit = buildCar(id, false);
  const hiNoWheels = hiKit.merged();
  bakeWheels(hiKit, spec, 1);
  const hiWithWheels = hiKit.merged();
  const loKit = buildCar(id, true);
  bakeWheels(loKit, spec, 0);
  const lo = loKit.merged();
  const box = new THREE.Box3().setFromBufferAttribute(hiWithWheels.attributes.position);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const blob = { geometry: blobGeometry(size.x * 1.25, size.z * 1.12, box.min.y + 0.04, ctr.x, ctr.z), material: blobMaterial(), paint: false, shadow: true };
  const plateGeo = platePartGeometry(plateOffsets(spec));
  const model = {
    hd: true,
    spec,
    size,
    parts: [{ geometry: hiWithWheels, material: sharedMat, paint: true }, { geometry: plateGeo, material: plateInstanceMaterial(), paint: false, plate: true }, blob],
    trafficParts: [{ geometry: hiNoWheels, material: sharedMat, paint: true }, blob],
    lod: { geometry: lo, material: sharedMat },
    wheels: [wheelX(spec), (spec.zF - spec.zR) / 2, spec.r, (spec.zF + spec.zR) / 2],
    plateOffsets: plateOffsets(spec)
  };
  model.tris = { hi: hiWithWheels.attributes.position.count / 3, traffic: hiNoWheels.attributes.position.count / 3, lod: lo.attributes.position.count / 3 };
  cache.set(id, model);
  return model;
}

// Player model (when no detailed glTF exists for the type): body + 4 wheel
// pivots named like the glTF ones so animateWheels() turns and steers them.
export function hdPlayerModel(id, paintHex) {
  const spec = SPECS[id];
  if (!spec) return null;
  const kit = buildCar(id, false);
  // fixed paint colour on a plain mesh (no instance colour)
  const col = kit.merged();
  const c = new THREE.Color(paintHex || 0xffffff);
  const ca = col.attributes.color.array;
  const sf = col.attributes.surf.array;
  for (let i = 0, n = col.attributes.position.count; i < n; i++) {
    if (sf[i * 4] > 0.5) {
      ca[i * 3] *= c.r;
      ca[i * 3 + 1] *= c.g;
      ca[i * 3 + 2] *= c.b;
    }
  }
  const root = new THREE.Group();
  root.add(new THREE.Mesh(col, makeCarMaterial(true)));
  const pm = new THREE.Mesh(platePartGeometry(plateOffsets(spec)), plateInstanceMaterial());
  root.add(pm);
  const wg = hdWheelGeometry(1);
  const wm = hdWheelMaterial();
  const xs = wheelX(spec);
  for (const [z, front] of [[spec.zF, true], [spec.zR, false]]) {
    for (const s of [1, -1]) {
      const steer = new THREE.Group();
      steer.name = front ? 'wheelSteer' : 'wheelFixed';
      steer.position.set(s * xs, spec.r, z);
      const spin = new THREE.Group();
      spin.name = 'wheelSpin';
      spin.userData.radius = spec.r;
      const w = new THREE.Mesh(wg, wm);
      w.scale.setScalar(spec.r);
      if (s < 0) w.rotation.y = Math.PI;
      spin.add(w);
      steer.add(spin);
      root.add(steer);
    }
  }
  const h = spec.L / 2;
  const lamps = { head: new THREE.Box3(new THREE.Vector3(-spec.W / 2 + 0.2, 0.6, h - 0.1), new THREE.Vector3(spec.W / 2 - 0.2, spec.kind === 'hatch' || spec.kind === 'sedan' ? 0.75 : 0.95, h)), tail: new THREE.Box3(new THREE.Vector3(-spec.W / 2 + 0.2, 0.7, -h), new THREE.Vector3(spec.W / 2 - 0.2, spec.kind === 'hatch' || spec.kind === 'sedan' ? 0.95 : 1.1, -h + 0.1)) };
  root.userData.size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  root.userData.lamps = lamps;
  return root;
}

// ------------------------------------------------------------- number plates
// KZN style: white plate, black "ND 123-456" (made-up numbers), thin border.
// Atlas: 2 columns x 16 rows of 512 x 112 px plates on a 1024 x 2048 canvas.
const COLS = 2;
const ROWS = 16;
export const PLATE_CELLS = COLS * ROWS;
let plateTex = null;
let plateMat = null;
let plateInstMat = null;
function rnd(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function plateTexture() {
  if (plateTex) return plateTex;
  const cw = 512;
  const ch = 112;
  const c = document.createElement('canvas');
  c.width = cw * COLS;
  c.height = 128 * ROWS;
  const g = c.getContext('2d');
  g.fillStyle = '#222';
  g.fillRect(0, 0, c.width, c.height);
  const r = rnd(20261125);
  for (let i = 0; i < PLATE_CELLS; i++) {
    const x0 = (i % COLS) * cw;
    const y0 = Math.floor(i / COLS) * 128 + 8;
    g.fillStyle = '#f7f7f2';
    g.beginPath();
    g.roundRect ? g.roundRect(x0 + 3, y0 + 3, cw - 6, ch - 6, 10) : g.rect(x0 + 3, y0 + 3, cw - 6, ch - 6);
    g.fill();
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    g.stroke();
    const n1 = String(100 + Math.floor(r() * 900));
    const n2 = String(100 + Math.floor(r() * 900));
    const txt = `ND ${n1}-${n2}`;
    g.fillStyle = '#111';
    g.font = 'bold 76px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, x0 + cw / 2, y0 + ch / 2 + 4, cw - 40);
    g.font = 'bold 13px Arial, Helvetica, sans-serif';
    g.fillText('KWAZULU-NATAL', x0 + cw / 2, y0 + 13);
  }
  plateTex = new THREE.CanvasTexture(c);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  plateTex.anisotropy = 4;
  plateTex.generateMipmaps = true;
  return plateTex;
}
function cellUV(cell) {
  const u0 = (cell % COLS) / COLS;
  const row = Math.floor(cell / COLS) % ROWS;
  // canvas row 0 is at the top = v 1
  const v1 = 1 - (row * 128 + 8) / (128 * ROWS);
  const v0 = 1 - (row * 128 + 8 + 112) / (128 * ROWS);
  return [u0, v0, u0 + 1 / COLS, v1];
}
const PW = 0.52;
const PH = 0.113;
function plateOffsets(spec) {
  return [
    [0, spec.plateF, spec.L / 2 + 0.065, 0],
    [0, spec.plateR, -spec.L / 2 - 0.065, Math.PI]
  ];
}
// Plate quads (front + rear) for a model drawn as an InstancedMesh by any
// user (traffic, parked cars, learners): an instanced `plateCell` attribute
// gives every instance slot its own made-up number.
let cellAttr = null;
export function platePartGeometry(offsets) {
  const geos = [];
  for (const [x, y, z, yaw] of offsets) {
    const g = plateInstanceGeometry();
    g.rotateY(yaw);
    g.translate(x, y, z);
    geos.push(g);
  }
  const g = mergeGeometries(geos);
  if (!cellAttr) {
    const a = new Float32Array(1024);
    const r = rnd(777);
    for (let i = 0; i < a.length; i++) a[i] = Math.floor(r() * PLATE_CELLS);
    cellAttr = new THREE.InstancedBufferAttribute(a, 1);
  }
  g.setAttribute('plateCell', cellAttr);
  return g;
}

// Where the plates go on a glTF traffic model (vehicle space, front = +Z):
// the most forward / rearward surface in the middle at plate height.
export function scanPlateOffsets(geometries) {
  let zf = -Infinity;
  let yf = 0.5;
  let zr = Infinity;
  let yr = 0.7;
  for (const g of geometries) {
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      const z = pa.getZ(i);
      if (Math.abs(x) > 0.27 || y < 0.3) continue;
      if (y < 0.75 && z > zf) {
        zf = z;
        yf = y;
      }
      if (y < 1.1 && z < zr) {
        zr = z;
        yr = y;
      }
    }
  }
  if (!isFinite(zf) || !isFinite(zr)) return null;
  return [
    [0, Math.min(0.62, Math.max(0.42, yf)), zf + 0.012, 0],
    [0, Math.min(0.95, Math.max(0.5, yr)), zr - 0.012, Math.PI]
  ];
}

export function plateMaterial() {
  if (!plateMat) plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return plateMat;
}
// Single plate quad (unit cell 0) for an InstancedMesh; per instance the
// `plateCell` attribute picks the plate in the atlas.
export function plateInstanceGeometry() {
  const g = new THREE.PlaneGeometry(PW, PH);
  const [u0, v0, u1, v1] = cellUV(0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  return g;
}
export function plateInstanceMaterial() {
  if (plateInstMat) return plateInstMat;
  plateInstMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  plateInstMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float plateCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  float pc = mod(plateCell, ${PLATE_CELLS}.0);
  vMapUv += vec2(mod(pc, ${COLS}.0) / ${COLS}.0, -floor(pc / ${COLS}.0) / ${ROWS}.0);
#endif`
      );
  };
  plateInstMat.customProgramCacheKey = () => 'hdplate-inst';
  return plateInstMat;
}

// ------------------------------------------------------------------ paints
// SA traffic colours: lots of white and silver; taxis nearly all white.
const PAINT_HEX = {
  default: ['#f2f2f0', '#f2f2f0', '#c9ccd0', '#a7abb0', '#1d1f22', '#8c1d1d', '#1f3f7a', '#d8d2c0', '#5a6066', '#2c5a3a', '#f2f2f0', '#b8bcc0'],
  quantum: ['#f4f4f0', '#f4f4f0', '#f4f4f0', '#eeeeea', '#d9dadb'],
  gusheshe: ['#b7332c', '#f2f2f0', '#1d1f22', '#c9ccd0', '#8c1d1d', '#1f3f7a', '#b7332c'],
  saps: ['#ffffff']
};
const PAINT_COL = {};
for (const k in PAINT_HEX) PAINT_COL[k] = PAINT_HEX[k].map((h) => new THREE.Color(h));
export function hdPaint(id, rng) {
  const list = PAINT_COL[id] || PAINT_COL.default;
  return list[Math.floor(rng() * list.length) % list.length];
}

// Player glTF cars: put real plates over the model's own plate panels
// (material named "plate"), front and rear. Returns true when added.
export function addPlayerPlates(root, publicTransport = false) {
  void publicTransport; // ND plates are black on white for every vehicle
  let src = null;
  root.traverse((o) => {
    if (!src && o.isMesh && /plate/i.test(o.material?.name || '')) src = o;
  });
  if (!src) return false;
  root.updateMatrixWorld(true);
  const pos = src.geometry.attributes.position;
  const v = new THREE.Vector3();
  const front = new THREE.Box3();
  const rear = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(src.matrixWorld);
    (v.z > 0 ? front : rear).expandByPoint(v);
  }
  if (front.isEmpty() && !rear.isEmpty()) {
    // the model has no front plate: put one on the front bumper, at the
    // rear plate's size, on the most forward surface in the middle
    let zMax = -Infinity;
    let yAt = 0.46;
    root.traverse((o) => {
      if (!o.isMesh || o === src || !o.geometry.attributes.position) return;
      const pa = o.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
        if (Math.abs(v.x) < 0.27 && v.y > 0.32 && v.y < 0.6 && v.z > zMax) {
          zMax = v.z;
          yAt = v.y;
        }
      }
    });
    if (zMax > 0) {
      const rs = rear.getSize(new THREE.Vector3());
      const y = Math.min(0.5, Math.max(0.4, yAt));
      front.set(new THREE.Vector3(-rs.x / 2, y - rs.y / 2, zMax - 0.004), new THREE.Vector3(rs.x / 2, y + rs.y / 2, zMax - 0.002));
    }
  }
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  for (const [box, dir] of [[front, 1], [rear, -1]]) {
    if (box.isEmpty()) continue;
    const s = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const w = Math.max(0.3, Math.min(0.56, s.x));
    const g = new THREE.PlaneGeometry(w, w * (PH / PW));
    const [u0, v0, u1, v1] = cellUV(dir > 0 ? 2 : 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    if (dir < 0) g.rotateY(Math.PI);
    const m = new THREE.Mesh(g, plateMaterial());
    m.position.set(c.x, c.y, dir > 0 ? box.max.z + 0.006 : box.min.z - 0.006).applyMatrix4(inv);
    m.name = 'numberPlate';
    root.add(m);
  }
  return true;
}

// Player glTF paint: smooth the body shading across soft panel edges (keeps
// real creases), so the paint reads as one smooth surface. Load-time only.
export function smoothPlayerPaint(root) {
  for (const o of root.children) {
    if (o.isMesh && /carpaint|paint|body/i.test(o.material?.name || '') && o.geometry.attributes.position.count < 60000) {
      try {
        o.geometry = toCreasedNormals(o.geometry, (34 * Math.PI) / 180);
      } catch (err) {
        void err;
      }
    }
  }
}
