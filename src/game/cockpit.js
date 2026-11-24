import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

// The inside of the car for the driver view (Bheko, 23 Nov 2026: "fix inside
// of the car to look like a real car"). A South African car: RIGHT-hand drive,
// so the steering wheel, instrument cluster and pedals sit on the right.
// Moulded dashboard with a soft-touch grain, instrument binnacle with real
// dials (needles follow speed and revs), steering wheel with airbag boss,
// thin A-pillars and a windscreen header, door cards, centre console with a
// manual gear lever and handbrake. Everything is low-poly and shares a few
// materials, so it costs a handful of draw calls on budget phones.
// The mirrors are drawn by mirrors.js (top-centre rear-view, wing mirrors at
// door level), so the cockpit carries no mirror glass of its own.
// Vehicle space: front = +Z, left = +X, y up.
export const DRIVER_X = -0.36;

function grainTexture(base, amp, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amp;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Instrument faces: speedometer (km/h) left, rev counter right, fuel and
// temperature in between. Drawn once at 1024 x 384 so the numbers stay crisp.
function clusterTexture() {
  const W = 1024;
  const H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#07080a';
  g.fillRect(0, 0, W, H);
  const dial = (cx, cy, r, max, step, label, red) => {
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    g.lineWidth = 4;
    g.strokeStyle = '#2b3038';
    g.beginPath();
    g.arc(cx, cy, r + 10, 0, Math.PI * 2);
    g.stroke();
    if (red) {
      g.strokeStyle = '#d8312a';
      g.lineWidth = 10;
      g.beginPath();
      g.arc(cx, cy, r - 6, a0 + (a1 - a0) * red, a1);
      g.stroke();
    }
    for (let v = 0; v <= max; v += step / 2) {
      const a = a0 + ((a1 - a0) * v) / max;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const r0 = r - (major ? 26 : 14);
      g.strokeStyle = '#f2f4f6';
      g.lineWidth = major ? 5 : 3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.stroke();
      if (major) {
        g.fillStyle = '#e9edf1';
        g.font = 'bold 30px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const rr = r - 52;
        g.fillText(String(max > 100 ? v : v / 1), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
    }
    g.fillStyle = '#9aa4ae';
    g.font = 'bold 22px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, cx, cy + r * 0.45);
  };
  dial(200, 196, 168, 220, 20, 'km/h', 0);
  dial(824, 196, 168, 8, 1, 'x1000 r/min', 6.2 / 8);
  // fuel and temperature bars, odometer
  g.fillStyle = '#9aa4ae';
  g.font = 'bold 22px sans-serif';
  g.textAlign = 'center';
  g.fillText('FUEL', 512, 92);
  g.fillText('TEMP', 512, 232);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i < 6 ? '#e9edf1' : '#3a3f46';
    g.fillRect(452 + i * 15, 108, 11, 30);
    g.fillStyle = i < 4 ? '#e9edf1' : '#3a3f46';
    g.fillRect(452 + i * 15, 248, 11, 30);
  }
  g.fillStyle = '#12161b';
  g.fillRect(440, 300, 144, 40);
  g.fillStyle = '#7fd0ff';
  g.font = 'bold 26px monospace';
  g.fillText('084 213', 512, 322);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Extrude a side profile (points in z, y) across the car, centred on x = cx.
function across(points, width, cx = 0, bevel = 0.015) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  // shape (u, v) extruded along w  ->  car (x = cx + width/2 - w, y = v, z = u)
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, cx + width / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  geo.computeVertexNormals();
  return geo;
}

// A tapered pillar from a to b (car space), w wide.
function pillar(a, b, w0, w1, mat) {
  const len = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(w1, w0, len, 8, 1);
  geo.scale(1, 1, 0.65);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function buildGeneric() {
  const g = new THREE.Group();
  g.name = 'cockpitGeneric';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  const dashMap = grainTexture('#3b3e44', 14);
  dashMap.repeat.set(6, 3);
  const dash = new THREE.MeshStandardMaterial({ color: 0xffffff, map: dashMap, roughness: 0.82, metalness: 0 });
  const dashTop = new THREE.MeshStandardMaterial({ color: 0x9a948a, map: dashMap, roughness: 0.92, metalness: 0 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2f333a, roughness: 0.6 });
  const piano = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.22, metalness: 0.2 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.28, metalness: 0.85 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.55 });
  const clothMap = grainTexture('#45484e', 22, 128);
  clothMap.repeat.set(4, 4);
  const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, map: clothMap, roughness: 1 });
  const linerMap = grainTexture('#cfc8ba', 10, 128);
  linerMap.repeat.set(5, 5);
  const liner = new THREE.MeshStandardMaterial({ color: 0xffffff, map: linerMap, roughness: 1 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.95 });
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  };

  // ---- dashboard: one moulded piece, rounded lip toward the driver, top
  // sloping down into the windscreen, darker top so it does not reflect
  add(across([[0.52, 0.62], [0.52, 0.9], [0.56, 0.95], [0.7, 0.975], [1.08, 0.985], [1.1, 0.62]], 1.5, 0, 0.03), dash);
  add(across([[0.66, 0.985], [1.08, 0.995], [1.08, 1.005], [0.66, 0.99]], 1.46, 0, 0), dashTop);
  // demister vent slots along the windscreen base
  for (const vx of [-0.42, 0.42]) add(new THREE.BoxGeometry(0.36, 0.004, 0.03), piano, vx, 1.0, 0.98);

  // ---- instrument binnacle in front of the driver (RHD)
  const hood = new THREE.CylinderGeometry(0.19, 0.19, 0.56, 20, 1, true, -Math.PI * 0.52, Math.PI * 1.04);
  hood.rotateZ(Math.PI / 2);
  hood.scale(1, 0.62, 0.9);
  add(hood, dash, DRIVER_X, 0.98, 0.66).material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: dashMap, roughness: 0.8, side: THREE.DoubleSide });
  const face = add(new THREE.PlaneGeometry(0.5, 0.1875), new THREE.MeshBasicMaterial({ map: clusterTexture(), toneMapped: false }), DRIVER_X, 1.0, 0.68, -0.32, Math.PI, 0);
  face.renderOrder = 1;
  // needles (pivot at the dial centres)
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xff4a1c, toneMapped: false });
  const needle = (u) => {
    const piv = new THREE.Group();
    // dial centres on the face (canvas 200 / 824 px of 1024 across 0.5 m)
    piv.position.set(u, -0.002, 0.002);
    const n = add(new THREE.PlaneGeometry(0.005, 0.07), needleMat, 0, 0.029, 0, 0, 0, 0, piv);
    n.renderOrder = 2;
    add(new THREE.CircleGeometry(0.008, 12), piano, 0, 0, 0.001, 0, 0, 0, piv).renderOrder = 3;
    face.add(piv);
    return piv;
  };
  const speedNeedle = needle(-0.152);
  const revNeedle = needle(0.152);
  // chrome bezels round the two dials
  for (const u of [-0.152, 0.152]) add(new THREE.TorusGeometry(0.088, 0.004, 6, 40), silver, u, -0.002, 0.003, 0, 0, 0, face);

  // ---- centre stack: screen, vents, climate knobs (piano black, silver rims)
  add(new THREE.BoxGeometry(0.34, 0.38, 0.05), piano, 0.02, 0.77, 0.545, -0.12, 0, 0);
  const radio = add(new THREE.PlaneGeometry(0.22, 0.11), new THREE.MeshBasicMaterial({ color: 0x0f3a52, toneMapped: false }), 0.02, 0.86, 0.515, -0.12, Math.PI, 0);
  radio.renderOrder = 1;
  for (const vx of [-0.1, 0.14]) {
    add(new THREE.BoxGeometry(0.09, 0.05, 0.02), trim, vx, 0.94, 0.53);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.085, 0.004, 0.022), silver, vx, 0.925 + i * 0.015, 0.522);
  }
  for (const kx of [-0.08, 0.02, 0.12]) {
    add(new THREE.CylinderGeometry(0.024, 0.024, 0.025, 16), piano, kx, 0.69, 0.53, Math.PI / 2 - 0.12, 0, 0);
    add(new THREE.TorusGeometry(0.024, 0.003, 6, 20), silver, kx, 0.69, 0.517, -0.12, 0, 0);
  }
  // side vents at each end of the dash
  for (const sx of [-0.66, 0.66]) {
    add(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 18), trim, sx, 0.9, 0.53, Math.PI / 2, 0, 0);
    add(new THREE.TorusGeometry(0.048, 0.005, 6, 22), silver, sx, 0.9, 0.513);
  }

  // ---- centre console, manual gear lever with a leather boot, handbrake
  add(new THREE.BoxGeometry(0.26, 0.26, 0.95), trim, 0.02, 0.5, 0.08);
  add(new THREE.BoxGeometry(0.2, 0.02, 0.2), piano, 0.02, 0.64, 0.36);
  add(new THREE.ConeGeometry(0.06, 0.1, 12), leather, 0.02, 0.69, 0.36);
  add(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 8), silver, 0.02, 0.78, 0.38, 0.2, 0, 0);
  add(new THREE.SphereGeometry(0.036, 16, 12), leather, 0.02, 0.88, 0.4);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 10), leather, 0.02, 0.66, -0.12, Math.PI / 2 - 0.3, 0, 0);

  // ---- doors: card, armrest, sill, handle; side windows above
  for (const sx of [-0.78, 0.78]) {
    const s = Math.sign(sx);
    add(new THREE.BoxGeometry(0.06, 0.6, 1.6), trim, sx, 0.78, 0.15);
    add(new THREE.BoxGeometry(0.06, 0.14, 1.2), cloth, sx - s * 0.035, 0.86, 0.05);
    add(new THREE.BoxGeometry(0.1, 0.05, 0.5), leather, sx - s * 0.06, 0.78, -0.05);
    add(new THREE.BoxGeometry(0.1, 0.05, 1.62), dash, sx - s * 0.01, 1.08, 0.16);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.14), silver, sx - s * 0.045, 0.93, 0.34);
    // door speaker grille
    add(new THREE.CircleGeometry(0.07, 20), rubber, sx - s * 0.032, 0.6, 0.52, 0, -s * Math.PI / 2, 0);
  }

  // ---- windscreen frame: thin A-pillars, header, black frit band
  for (const s of [-1, 1]) {
    g.add(pillar(V(s * 0.7, 0.99, 1.06), V(s * 0.66, 1.56, 0.42), 0.045, 0.04, dash));
    // the black ceramic band on the glass edge beside the pillar
    g.add(pillar(V(s * 0.655, 1.0, 1.05), V(s * 0.62, 1.54, 0.44), 0.012, 0.012, rubber));
    // B-pillar and quarter of the roof over the door
    add(new THREE.BoxGeometry(0.1, 0.62, 0.14), liner, s * 0.8, 1.32, -0.55);
  }
  add(new THREE.BoxGeometry(1.7, 0.04, 1.4), liner, 0, 1.64, -0.25);
  add(new THREE.BoxGeometry(1.4, 0.09, 0.16), liner, 0, 1.58, 0.44);
  add(new THREE.BoxGeometry(1.32, 0.02, 0.03), rubber, 0, 1.535, 0.5);
  // sun visors folded up against the header, one each side
  for (const vx of [-0.42, 0.42]) add(new THREE.BoxGeometry(0.42, 0.02, 0.17), liner, vx, 1.6, 0.34, 0.1, 0, 0);
  // the rear-view mirror hangs from the header at the top centre (its glass
  // and housing are drawn by mirrors.js); a small mount on the glass
  add(new THREE.BoxGeometry(0.06, 0.05, 0.03), rubber, 0, 1.53, 0.47);

  // ---- seats (front edges) and floor, pedals
  add(new THREE.BoxGeometry(0.52, 0.14, 0.56), cloth, 0.4, 0.5, -0.1);
  add(new THREE.BoxGeometry(0.52, 0.1, 0.1), cloth, 0.4, 0.55, 0.2, 0.2, 0, 0);
  add(new THREE.BoxGeometry(0.54, 0.66, 0.14), cloth, 0.4, 0.86, -0.42, -0.12, 0, 0);
  add(new THREE.BoxGeometry(0.28, 0.18, 0.12), cloth, 0.4, 1.28, -0.48);
  add(new THREE.BoxGeometry(0.52, 0.14, 0.5), cloth, DRIVER_X, 0.5, -0.15);
  add(new THREE.BoxGeometry(1.56, 0.04, 1.8), rubber, 0, 0.36, 0.05);
  for (const px of [-0.12, 0.0, 0.13]) add(new THREE.BoxGeometry(0.07, 0.1, 0.015), silver, DRIVER_X + px, 0.48, 0.62, -0.4, 0, 0);

  // ---- steering column and wheel (pivot tilted toward the driver)
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.3, 12), rubber, DRIVER_X, 0.9, 0.56, Math.PI / 2 - 0.38, 0, 0);
  const column = new THREE.Group();
  column.position.set(DRIVER_X, 0.95, 0.42);
  column.rotation.x = -0.38;
  g.add(column);
  const wheel = new THREE.Group();
  wheel.name = 'steeringWheel';
  column.add(wheel);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.019, 12, 48), leather);
  rim.scale.set(1, 1, 1.25);
  wheel.add(rim);
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.06, 24), leather);
  boss.rotation.x = Math.PI / 2;
  boss.scale.set(1.15, 1, 0.85);
  boss.position.z = -0.01;
  wheel.add(boss);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.016, 16), silver);
  badge.position.z = -0.042;
  badge.rotation.y = Math.PI;
  wheel.add(badge);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.034, 0.022), a === -Math.PI / 2 ? leather : silver);
    spoke.position.set(Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0);
    spoke.rotation.z = a;
    wheel.add(spoke);
  }
  // smooth gloved hands at quarter to three (24 Nov: no more box hands)
  addHands(wheel, 0.185);
  g.userData.wheel = wheel;
  g.userData.speedNeedle = speedNeedle;
  g.userData.revNeedle = revNeedle;
  g.userData.rpm = 900;
  g.userData.sweep = Math.PI * 1.5;
  g.userData.speedMax = 220;
  g.userData.rpmMax = 8000;
  g.userData.eye = [DRIVER_X, 1.25, -0.13]; // ~0.55 m behind the hub (seat a little forward, 24 Nov)
  g.userData.mirror = { rearY: 1.47, rearZ: 0.47, roofY: 1.58, wingY: 1.17, wingZ: 0.9 };
  g.userData.hideInMirror = [column];
  return g;
}

// ---------------------------------------------------------------------------
// Shared bits for the cockpits below
// ---------------------------------------------------------------------------

// A rounded, bevelled slab: w (x) by h (y), d deep along z, corner radius r.
// Everything in the E30 is built from these, so no edge is a hard box edge.
function slab(w, h, d, r = 0.02, bevel = 0.008) {
  const s = new THREE.Shape();
  const bw = Math.min(bevel, w * 0.3, h * 0.3, d * 0.3);
  const x = -w / 2 + bw;
  const y = -h / 2 + bw;
  const W = w - bw * 2;
  const H = h - bw * 2;
  const R = Math.max(0.0005, Math.min(r, W / 2 - 1e-4, H / 2 - 1e-4));
  s.moveTo(x + R, y);
  s.lineTo(x + W - R, y);
  s.quadraticCurveTo(x + W, y, x + W, y + R);
  s.lineTo(x + W, y + H - R);
  s.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
  s.lineTo(x + R, y + H);
  s.quadraticCurveTo(x, y + H, x, y + H - R);
  s.lineTo(x, y + R);
  s.quadraticCurveTo(x, y, x + R, y);
  const depth = Math.max(0.0005, d - bw * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bw, bevelSize: bw, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Collects static parts per material and merges each set into ONE mesh
// (a handful of draw calls for the whole interior on budget phones).
class Baker {
  constructor() {
    this.sets = new Map();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
  }
  add(mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(sx, sy, sz));
    return this.addM(mat, geo, this.m);
  }
  addM(mat, geo, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(matrix);
    let list = this.sets.get(mat);
    if (!list) this.sets.set(mat, (list = []));
    list.push(g);
    geo.dispose();
    return g;
  }
  into(parent) {
    for (const [mat, list] of this.sets) {
      const geo = list.length === 1 ? list[0] : mergeGeometries(list);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
    this.sets.clear();
  }
}

function canvasTex(w, h, draw, repeat = null) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function noise(g, w, h, amp) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amp;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// Smooth gloved hands on the rim at quarter to three, with short rounded
// forearms in a dark sleeve going back toward the driver (they turn with the
// wheel). Lambert, two draw calls.
const GLOVE = new THREE.MeshLambertMaterial({ color: 0x232327, emissive: 0x111113 });
const SLEEVE = new THREE.MeshLambertMaterial({ color: 0x2c3c55, emissive: 0x141c28 });
function addHands(wheel, R) {
  const gl = new Baker();
  for (const side of [-1, 1]) {
    const x = side * R;
    // palm wrapped round the rim, knuckles forward
    gl.add(GLOVE, new THREE.SphereGeometry(1, 14, 10), x, 0.006, -0.004, 0, 0, side * 0.25, 0.034, 0.05, 0.034);
    // fingers curled over the front of the rim
    gl.add(GLOVE, new THREE.CapsuleGeometry(0.016, 0.05, 4, 10), x + side * 0.006, 0.012, 0.018, 0, 0, side * 0.2);
    // thumb along the spoke
    gl.add(GLOVE, new THREE.CapsuleGeometry(0.011, 0.034, 4, 8), x - side * 0.03, 0.012, -0.016, 0, 0, side * 1.2);
    // cuff and forearm going back and down to the driver's elbows
    gl.add(GLOVE, new THREE.CylinderGeometry(0.03, 0.033, 0.04, 14), x + side * 0.01, -0.012, -0.05, Math.PI / 2 - 0.5, 0, 0);
    gl.add(SLEEVE, new THREE.CapsuleGeometry(0.037, 0.24, 6, 14), x + side * 0.035, -0.09, -0.19, Math.PI / 2 - 0.62, 0, side * 0.08);
  }
  gl.into(wheel);
}

// ---------------------------------------------------------------------------
// BMW 3 Series E30 (325is) "gusheshe", right-hand drive as sold in SA.
// Bheko, 24 Nov 2026: "get me a real inside of the gusheshe".
// Built from the E30's real layout (owner's manual and parts catalogues):
//  - instrument cluster in a hooded binnacle: fuel gauge far left, big
//    speedometer, big rev counter with the econometer, coolant temperature
//    far right; black faces, white numbers, orange-red needles, the
//    service-interval LEDs between the dials;
//  - four-spoke sport steering wheel with a roundel on the pad;
//  - centre stack angled toward the driver: square vents, check control and
//    clock, radio/cassette, heater sliders and knobs, window switches;
//  - tall gear lever in a ribbed boot, handbrake between the seats;
//  - black/anthracite plastics, sport cloth seats, grey-beige headliner,
//    thin upright A-pillars, door cards with armrests, a sail panel at the
//    front of each door window where the wing mirror mounts;
//  - the red bonnet and wipers through the windscreen;
//  - rear seats, parcel shelf and C-pillars, seen in the rear-view mirror.
// All textures are drawn here (procedural, our own), no photos copied.
// Vehicle space: front = +Z, left = +X, y up from the road. Body: 4.33 m long,
// window line 0.89 m, roof lining 1.385 m (from the E30 model in the game).
// ---------------------------------------------------------------------------
const E30 = { D: -0.37, BELT: 0.89, ROOF: 1.385, WS: 1.18, HDR: 0.47, HW: 0.7 };

function e30Cluster() {
  const W = 1024;
  const H = 278;
  return canvasTex(W, H, (g) => {
    // black face with a faint vignette
    const bg = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.6);
    bg.addColorStop(0, '#0c0d0f');
    bg.addColorStop(1, '#030304');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const S = Math.PI * 1.45; // the needles' sweep (same as updateCockpit)
    const a0 = Math.PI / 2 + (Math.PI * 2 - S) / 2;
    const dial = (cx, cy, r, max, major, minor, numbers, red, sub) => {
      g.strokeStyle = '#26292e';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r + 8, 0, Math.PI * 2);
      g.stroke();
      if (red !== null) {
        g.strokeStyle = '#d42a1f';
        g.lineWidth = r * 0.07;
        g.beginPath();
        g.arc(cx, cy, r * 0.93, a0 + S * red, a0 + S);
        g.stroke();
      }
      for (let v = 0; v <= max + 1e-6; v += minor) {
        const a = a0 + (S * v) / max;
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const r0 = r * (isMajor ? 0.82 : 0.89);
        g.strokeStyle = '#eef0f2';
        g.lineWidth = isMajor ? r * 0.035 : r * 0.016;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        g.stroke();
        if (isMajor && numbers) {
          g.fillStyle = '#f2f3f5';
          g.font = `bold ${Math.round(r * 0.17)}px Helvetica, Arial, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const rr = r * 0.64;
          g.fillText(numbers(v), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
      }
      if (sub) {
        g.fillStyle = '#9ba3ab';
        g.font = `${Math.round(r * 0.11)}px Helvetica, Arial, sans-serif`;
        g.textAlign = 'center';
        g.fillText(sub, cx, cy + r * 0.38);
      }
      // centre cap shadow
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
      g.fill();
    };
    const cy = 136;
    dial(330, cy, 124, 240, 20, 10, (v) => String(v), null, 'km/h');
    dial(694, cy, 124, 7, 1, 0.5, (v) => String(v), 6.4 / 7, '1/min x1000');
    // econometer: small arc in the lower part of the rev counter
    g.strokeStyle = '#d42a1f';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(694, cy + 52, 46, Math.PI * 1.22, Math.PI * 1.42);
    g.stroke();
    g.strokeStyle = '#f2b23a';
    g.beginPath();
    g.arc(694, cy + 52, 46, Math.PI * 1.42, Math.PI * 1.58);
    g.stroke();
    g.strokeStyle = '#e8eaec';
    g.beginPath();
    g.arc(694, cy + 52, 46, Math.PI * 1.58, Math.PI * 1.78);
    g.stroke();
    // small gauges: fuel (left) and coolant temperature (right), static needles
    const small = (cx, frac, lo, hi) => {
      const r = 62;
      g.strokeStyle = '#26292e';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy + 14, r + 6, 0, Math.PI * 2);
      g.stroke();
      const b0 = Math.PI * 1.2;
      const b1 = Math.PI * 1.8;
      g.lineWidth = 5;
      g.strokeStyle = lo;
      g.beginPath();
      g.arc(cx, cy + 14, r * 0.9, b0, b0 + 0.18);
      g.stroke();
      g.strokeStyle = hi;
      g.beginPath();
      g.arc(cx, cy + 14, r * 0.9, b1 - 0.18, b1);
      g.stroke();
      g.strokeStyle = '#eef0f2';
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        const a = b0 + ((b1 - b0) * i) / 4;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r * 0.74, cy + 14 + Math.sin(a) * r * 0.74);
        g.lineTo(cx + Math.cos(a) * r * 0.88, cy + 14 + Math.sin(a) * r * 0.88);
        g.stroke();
      }
      const a = b0 + (b1 - b0) * frac;
      g.strokeStyle = '#ff5a1a';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx, cy + 14);
      g.lineTo(cx + Math.cos(a) * r * 0.86, cy + 14 + Math.sin(a) * r * 0.86);
      g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(cx, cy + 14, 9, 0, Math.PI * 2);
      g.fill();
    };
    small(96, 0.7, '#ff7a1a', '#eef0f2');
    small(928, 0.48, '#3a7bd5', '#d42a1f');
    // service interval LEDs and warning lamps between the big dials
    const leds = ['#1d5c2a', '#1d5c2a', '#1d5c2a', '#1d5c2a', '#1d5c2a', '#5a4a12', '#5a1612'];
    leds.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(482 + i * 10, 250, 3.4, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = '#16181b';
    g.fillRect(470, 214, 84, 22);
    g.fillStyle = '#c8cdd2';
    g.font = 'bold 17px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('186 421', 512, 226);
  });
}

function e30Stack() {
  const W = 512;
  const H = 680;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#1b1c1f';
    g.fillRect(0, 0, W, H);
    noise(g, W, H, 10);
    // ---- two square vents with horizontal vanes and a thumbwheel each
    for (const vx of [26, 266]) {
      g.fillStyle = '#0a0b0c';
      g.fillRect(vx, 18, 220, 128);
      for (let i = 0; i < 9; i++) {
        const y = 26 + i * 13.5;
        const gr = g.createLinearGradient(0, y, 0, y + 9);
        gr.addColorStop(0, '#3b3e43');
        gr.addColorStop(1, '#16181a');
        g.fillStyle = gr;
        g.fillRect(vx + 6, y, 208, 8);
      }
      g.fillStyle = '#2c2f33';
      g.fillRect(vx + 92, 22, 36, 120);
      g.fillStyle = '#4a4e54';
      for (let i = 0; i < 10; i++) g.fillRect(vx + 98, 30 + i * 11, 24, 4);
    }
    // ---- check control / clock strip
    g.fillStyle = '#0d0e10';
    g.fillRect(26, 162, 460, 44);
    g.fillStyle = '#ff9a2e';
    g.font = 'bold 28px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('12:47', 150, 185);
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i === 6 ? '#5a1612' : '#2b2e33';
      g.fillRect(280 + i * 28, 176, 18, 18);
    }
    // ---- radio / cassette deck (DIN)
    g.fillStyle = '#0b0b0c';
    g.fillRect(26, 222, 460, 120);
    g.strokeStyle = '#3a3d42';
    g.lineWidth = 2;
    g.strokeRect(27, 223, 458, 118);
    // knobs
    for (const kx of [66, 446]) {
      g.fillStyle = '#26282c';
      g.beginPath();
      g.arc(kx, 282, 26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4a4d52';
      g.beginPath();
      g.arc(kx, 282, 13, 0, Math.PI * 2);
      g.fill();
    }
    // cassette door and display
    g.fillStyle = '#151618';
    g.fillRect(112, 236, 288, 46);
    g.fillStyle = '#2a2c30';
    g.fillRect(118, 254, 276, 10);
    g.fillStyle = '#ff8a1e';
    g.font = 'bold 24px monospace';
    g.fillText('FM  94.7', 256, 307);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = '#2b2d31';
      g.fillRect(118 + i * 56, 322, 46, 14);
    }
    // ---- heater: three sliders over blue-red strips, temp wheels, fan knob
    g.fillStyle = '#121315';
    g.fillRect(26, 358, 460, 150);
    for (let i = 0; i < 3; i++) {
      const y = 378 + i * 30;
      const gr = g.createLinearGradient(130, 0, 382, 0);
      gr.addColorStop(0, '#2f6fd6');
      gr.addColorStop(1, '#d6402f');
      g.fillStyle = i === 0 ? gr : '#3a3d42';
      g.fillRect(130, y, 252, 4);
      g.fillStyle = '#050506';
      g.fillRect(130, y + 8, 252, 6);
      g.fillStyle = '#c9ced3';
      g.fillRect(150 + i * 70, y + 4, 20, 14);
    }
    for (const kx of [72, 440]) {
      // knurled temperature wheels (seen face on)
      g.fillStyle = '#2a2c30';
      g.fillRect(kx - 28, 372, 56, 92);
      g.fillStyle = '#44474c';
      for (let i = 0; i < 12; i++) g.fillRect(kx - 26, 376 + i * 7.5, 52, 3);
      g.fillStyle = kx < 256 ? '#2f6fd6' : '#d6402f';
      g.fillRect(kx - 28, 470, 56, 6);
    }
    // fan knob ring marks (the knob itself is geometry)
    g.fillStyle = '#c9ced3';
    for (let i = 0; i < 4; i++) {
      const a = Math.PI * (0.8 + i * 0.27);
      g.fillRect(256 + Math.cos(a) * 48 - 2, 478 + Math.sin(a) * 18 - 2, 4, 4);
    }
    // ---- window switches and the hazard switch
    g.fillStyle = '#0f1012';
    g.fillRect(26, 524, 460, 130);
    for (let i = 0; i < 4; i++) {
      const x = 60 + i * 110;
      const gr = g.createLinearGradient(0, 548, 0, 628);
      gr.addColorStop(0, '#3c3f44');
      gr.addColorStop(1, '#17181a');
      g.fillStyle = gr;
      g.fillRect(x, 548, 72, 80);
      g.fillStyle = '#7e848b';
      g.beginPath();
      g.moveTo(x + 36, 560);
      g.lineTo(x + 48, 576);
      g.lineTo(x + 24, 576);
      g.closePath();
      g.fill();
    }
  });
}

function e30Roundel() {
  return canvasTex(128, 128, (g) => {
    const c = 64;
    g.fillStyle = '#0b0b0c';
    g.beginPath();
    g.arc(c, c, 63, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9ced3';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(c, c, 61, 0, Math.PI * 2);
    g.stroke();
    // blue and white quarters (no lettering)
    const q = [['#f4f6f8', Math.PI, Math.PI * 1.5], ['#1c69d4', Math.PI * 1.5, Math.PI * 2], ['#f4f6f8', 0, Math.PI / 2], ['#1c69d4', Math.PI / 2, Math.PI]];
    for (const [col, a, b] of q) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, 38, a, b);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = '#c9ced3';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, 38, 0, Math.PI * 2);
    g.stroke();
  });
}

function buildE30() {
  const { D, BELT, ROOF, WS, HDR, HW } = E30;
  const g = new THREE.Group();
  g.name = 'cockpitE30';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---- materials (Lambert: cheap on Mali/PowerVR budget GPUs)
  const grain = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#808080';
    c.fillRect(0, 0, w, h);
    noise(c, w, h, 26);
  }, [6, 6]);
  const dash = new THREE.MeshLambertMaterial({ color: 0x575a60, map: grain });
  const trim = new THREE.MeshLambertMaterial({ color: 0x4c4f55, map: grain });
  const black = new THREE.MeshLambertMaterial({ color: 0x26272a });
  const silver = new THREE.MeshPhongMaterial({ color: 0x9aa1a8, shininess: 60, specular: 0x666666 });
  const clothMap = canvasTex(256, 256, (c, w, h) => {
    // E30 sport cloth: anthracite with a fine grey check
    c.fillStyle = '#505157';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(170,172,178,0.25)';
    for (let i = 0; i < w; i += 8) {
      c.fillRect(i, 0, 1.5, h);
      c.fillRect(0, i, w, 1.5);
    }
    noise(c, w, h, 22);
  }, [10, 10]);
  const cloth = new THREE.MeshLambertMaterial({ map: clothMap });
  const linerMap = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#c9c5bb';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(70,66,60,0.35)';
    for (let y = 4; y < h; y += 9) for (let x = (y % 18 ? 4 : 8.5); x < w; x += 9) c.fillRect(x, y, 2, 2);
    noise(c, w, h, 8);
  }, [8, 8]);
  const liner = new THREE.MeshLambertMaterial({ map: linerMap });
  const pillarMat = new THREE.MeshLambertMaterial({ color: 0x8f8b83, map: grain });
  const carpet = new THREE.MeshLambertMaterial({ color: 0x1c1d1f, map: grain });
  const paint = new THREE.MeshPhongMaterial({ color: 0xb01e23, shininess: 70, specular: 0x444444 });
  const leather = new THREE.MeshPhongMaterial({ color: 0x141416, shininess: 18, specular: 0x222222 });
  const stackMat = new THREE.MeshLambertMaterial({ map: e30Stack() });
  // cabin fill: the sun barely reaches inside, and the sky/ground light
  // tints a roof lining green, so every interior surface also glows a
  // little of its own colour (no extra light, no extra draw calls)
  for (const m of [dash, trim, black, cloth, liner, pillarMat, carpet, stackMat, leather]) {
    m.emissive = m.color.getHex() === 0xffffff ? new THREE.Color(0xffffff).multiplyScalar(0.5) : m.color.clone().multiplyScalar(0.85);
    if (m.map) m.emissiveMap = m.map;
  }
  const B = new Baker();

  // ---- dashboard: three sections; the one in front of the driver dips so
  // the cluster sits in its hooded recess
  const dashProfile = [[0.6, 0.56], [0.6, 0.8], [0.635, 0.858], [0.71, 0.893], [WS - 0.03, 0.905], [WS, 0.885], [WS, 0.56]];
  const binLeft = D + 0.27;
  const binRight = D - 0.27;
  B.addM(dash, across(dashProfile, HW - binLeft, (HW + binLeft) / 2, 0.022), new THREE.Matrix4());
  B.addM(dash, across(dashProfile, binRight + HW, (binRight - HW) / 2, 0.012), new THREE.Matrix4());
  const binProfile = [[0.6, 0.56], [0.6, 0.78], [0.64, 0.823], [0.75, 0.83], [0.805, 0.832], [0.815, 0.9], [1.0, 0.905], [WS - 0.03, 0.905], [WS, 0.885], [WS, 0.56]];
  B.addM(dash, across(binProfile, 0.54, D, 0.012), new THREE.Matrix4());
  // the hood over the cluster: a curved brow and two cheeks that run down
  // the dash, so the recess has proper side walls
  B.addM(dash, across([[0.665, 1.0], [0.682, 1.028], [0.72, 1.044], [0.85, 1.05], [0.94, 1.03], [0.94, 1.008], [0.85, 1.03], [0.725, 1.024], [0.692, 1.01], [0.678, 0.992]], 0.56, D, 0.006), new THREE.Matrix4());
  for (const s of [-1, 1]) B.addM(dash, across([[0.598, 0.56], [0.598, 0.8], [0.633, 0.86], [0.666, 1.0], [0.94, 1.028], [1.02, 0.906], [1.02, 0.56]], 0.03, D + s * 0.27, 0.008), new THREE.Matrix4());
  // glovebox lid seam and lock on the passenger side
  B.add(black, slab(0.42, 0.006, 0.006, 0.002, 0.001), 0.36, 0.64, 0.598);
  B.add(silver, slab(0.05, 0.016, 0.012, 0.004, 0.002), 0.36, 0.76, 0.6);
  // side vents at both dash ends (rounded rectangles with vanes)
  for (const s of [-1, 1]) {
    B.add(black, slab(0.13, 0.075, 0.03, 0.02, 0.006), s * 0.6, 0.84, 0.604);
    for (let i = 0; i < 4; i++) B.add(trim, slab(0.115, 0.007, 0.012, 0.002, 0.001), s * 0.6, 0.815 + i * 0.016, 0.592);
  }
  // demister slots along the windscreen base
  for (const s of [-1, 1]) B.add(black, slab(0.4, 0.004, 0.035, 0.002, 0.001), s * 0.36, 0.907, 1.06);
  // the light switch knob left of the column, wiper/indicator stalks
  B.add(trim, new THREE.CylinderGeometry(0.022, 0.024, 0.03, 16), D + 0.33, 0.78, 0.6, Math.PI / 2);

  // ---- instrument cluster face and needles
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.1357), new THREE.MeshBasicMaterial({ map: e30Cluster(), toneMapped: false }));
  face.position.set(D, 0.905, 0.79);
  face.rotation.set(0.15, Math.PI, 0);
  g.add(face);
  // cluster glass edge and the black surround
  B.add(black, slab(0.54, 0.16, 0.012, 0.02, 0.003), D, 0.905, 0.802, 0.15);
  const needleMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a, toneMapped: false });
  const capMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0b, toneMapped: false });
  const needle = (u) => {
    const piv = new THREE.Group();
    piv.position.set(u, 0.002, 0.002);
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.0042, 0.052), needleMat);
    n.position.y = 0.019;
    piv.add(n);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 14), capMat);
    cap.position.z = 0.001;
    piv.add(cap);
    face.add(piv);
    return piv;
  };
  const speedNeedle = needle(-0.0889);
  const revNeedle = needle(0.0889);

  // ---- centre stack, angled toward the driver (RHD: turned to the right)
  const stack = new THREE.Group();
  stack.position.set(0.1, 0.705, 0.66); // clear of the binnacle cheek (RHD)
  stack.rotation.set(0.08, 0.14, 0);
  stack.updateMatrix();
  const SM = stack.matrix;
  const L = (x, y, z, rx = 0, ry = 0, rz = 0) => SM.clone().multiply(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
  B.addM(trim, slab(0.33, 0.42, 0.14, 0.025, 0.01), L(0, 0, 0));
  const stackFace = new THREE.PlaneGeometry(0.3, 0.398);
  B.addM(stackMat, stackFace, L(0, 0, -0.0745, 0, Math.PI, 0));
  // knobs with real depth: fan (middle) and the radio pair
  B.addM(black, new THREE.CylinderGeometry(0.02, 0.022, 0.028, 18), L(0, -0.098, -0.08, Math.PI / 2));
  B.addM(silver, new THREE.TorusGeometry(0.02, 0.0025, 6, 18), L(0, -0.098, -0.094));
  for (const kx of [0.112, -0.112]) B.addM(black, new THREE.CylinderGeometry(0.011, 0.012, 0.018, 14), L(kx, 0.075, -0.078, Math.PI / 2));

  // ---- centre console, gear lever in a ribbed boot, handbrake
  B.add(trim, slab(0.24, 0.17, 1.0, 0.04, 0.012), 0, 0.445, 0.11);
  B.add(black, slab(0.17, 0.012, 0.22, 0.02, 0.004), 0, 0.535, 0.3);
  const bootPts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    bootPts.push(new THREE.Vector2(0.055 - t * 0.04 + Math.sin(t * Math.PI * 6) * 0.004, t * 0.1));
  }
  B.add(leather, new THREE.LatheGeometry(bootPts, 16), 0, 0.54, 0.3);
  B.add(silver, new THREE.CylinderGeometry(0.008, 0.009, 0.15, 10), 0, 0.68, 0.285, -0.18);
  B.add(leather, new THREE.SphereGeometry(0.03, 18, 12), 0, 0.76, 0.27, 0, 0, 0, 1, 0.85, 1);
  B.add(leather, new THREE.LatheGeometry(bootPts.map((p) => new THREE.Vector2(p.x * 0.6, p.y * 0.7)), 12), 0, 0.535, -0.18);
  B.add(trim, slab(0.04, 0.03, 0.27, 0.012, 0.006), 0, 0.6, -0.25, 0.35);

  // ---- doors: card, cloth insert, armrest/pull, window rail, sail panel
  for (const s of [-1, 1]) {
    const x = s * HW;
    B.add(trim, slab(0.05, 0.5, 1.05, 0.03, 0.012), x, 0.63, 0.27);
    B.add(cloth, slab(0.02, 0.17, 0.78, 0.04, 0.006), x - s * 0.028, 0.67, 0.25);
    B.add(trim, slab(0.075, 0.05, 0.42, 0.02, 0.01), x - s * 0.05, 0.74, 0.08);
    B.add(dash, slab(0.07, 0.05, 1.08, 0.02, 0.01), x - s * 0.012, 0.866, 0.27);
    B.add(silver, slab(0.012, 0.02, 0.09, 0.006, 0.003), x - s * 0.03, 0.8, 0.5);
    B.add(black, new THREE.CylinderGeometry(0.06, 0.06, 0.012, 20), x - s * 0.028, 0.5, 0.58, 0, 0, Math.PI / 2);
    // sail panel: the black triangle at the front of the window, and the
    // mirror adjuster knob on it
    const sail = new THREE.Shape();
    const zc = s > 0 ? 0.84 : 0.58; // at each wing mirror (see userData.mirror)
    sail.moveTo(zc + 0.16, BELT);
    sail.lineTo(zc - 0.08, BELT);
    sail.lineTo(zc + 0.08, 1.0);
    sail.closePath();
    const sg = new THREE.ExtrudeGeometry(sail, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
    sg.applyMatrix4(new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
    B.add(black, sg, x - s * 0.01, 0, 0);
    B.add(trim, new THREE.CylinderGeometry(0.012, 0.014, 0.025, 12), x - s * 0.03, 0.925, zc + 0.04, 0, 0, Math.PI / 2);
    // window frames: thin black rubber round the door glass
    B.add(black, slab(0.03, 0.025, 1.45, 0.008, 0.004), x + s * 0.01, ROOF - 0.03, 0.27 - 0.53);
    // B-pillar (cloth-trimmed upper, plastic lower)
    B.add(pillarMat, slab(0.06, ROOF - BELT, 0.13, 0.025, 0.01), x - s * 0.005, (ROOF + BELT) / 2, -0.52);
    // rear door card and rear quarter
    B.add(trim, slab(0.05, 0.5, 0.95, 0.03, 0.012), x, 0.63, -1.05);
    B.add(dash, slab(0.07, 0.05, 0.95, 0.02, 0.01), x - s * 0.012, 0.866, -1.05);
  }

  // ---- A-pillars (thin, upright), header, headliner, visors
  for (const s of [-1, 1]) {
    const a = V(s * 0.672, BELT + 0.005, WS - 0.01);
    const b = V(s * 0.612, ROOF - 0.01, HDR + 0.02);
    const len = a.distanceTo(b);
    const pg = new THREE.CapsuleGeometry(0.034, len, 4, 12);
    pg.scale(1, 1, 0.6);
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()), V(1, 1, 1));
    B.addM(pillarMat, pg, m);
    // C-pillars round the rear window (wide, cloth trimmed)
    const c0 = V(s * 0.62, 0.93, -1.98);
    const c1 = V(s * 0.57, ROOF - 0.01, -1.56);
    const cl = c0.distanceTo(c1);
    const cg = new THREE.CapsuleGeometry(0.07, cl, 4, 10);
    cg.scale(1, 1, 0.5);
    B.addM(pillarMat, cg, new THREE.Matrix4().compose(c0.clone().add(c1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), c1.clone().sub(c0).normalize()), V(1, 1, 1)));
  }
  B.add(liner, slab(1.42, 0.035, 2.1, 0.02, 0.01), 0, ROOF + 0.016, -0.53);
  B.add(liner, slab(1.32, 0.05, 0.1, 0.02, 0.012), 0, ROOF - 0.012, HDR + 0.03);
  B.add(liner, slab(1.24, 0.05, 0.1, 0.02, 0.012), 0, ROOF - 0.012, -1.56);
  for (const s of [-1, 1]) {
    B.add(liner, slab(0.07, 0.06, 2.2, 0.02, 0.01), s * 0.655, ROOF - 0.02, -0.55);
    B.add(liner, slab(0.4, 0.02, 0.17, 0.02, 0.006), s * 0.37, ROOF - 0.025, 0.35, 0.08);
  }
  // interior light
  B.add(silver, slab(0.12, 0.012, 0.07, 0.02, 0.003), 0, ROOF - 0.004, -0.35);

  // ---- seats: E30 sport seats in cloth, rear bench, parcel shelf
  const seat = (x) => {
    B.add(cloth, slab(0.5, 0.13, 0.52, 0.05, 0.03), x, 0.47, -0.2);
    for (const s of [-1, 1]) B.add(cloth, slab(0.07, 0.1, 0.5, 0.03, 0.02), x + s * 0.22, 0.54, -0.2);
    B.add(cloth, slab(0.5, 0.64, 0.13, 0.06, 0.03), x, 0.82, -0.56, -0.17);
    for (const s of [-1, 1]) B.add(cloth, slab(0.08, 0.5, 0.15, 0.035, 0.02), x + s * 0.225, 0.8, -0.54, -0.17);
    B.add(cloth, slab(0.27, 0.17, 0.1, 0.05, 0.025), x, 1.21, -0.66, -0.1);
    B.add(silver, new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), x - 0.07, 1.11, -0.645);
    B.add(silver, new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), x + 0.07, 1.11, -0.645);
  };
  seat(D);
  seat(-D);
  B.add(cloth, slab(1.3, 0.14, 0.5, 0.05, 0.03), 0, 0.46, -1.17);
  B.add(cloth, slab(1.3, 0.5, 0.13, 0.06, 0.03), 0, 0.74, -1.55, -0.24);
  for (const s of [-1, 1]) B.add(cloth, slab(0.25, 0.14, 0.09, 0.05, 0.02), s * 0.36, 1.03, -1.66, -0.2);
  B.add(trim, slab(1.32, 0.025, 0.42, 0.02, 0.008), 0, 0.905, -1.8);
  // floor carpet, pedals
  B.add(carpet, slab(1.4, 0.03, 2.9, 0.02, 0.01), 0, 0.35, -0.5);
  for (const px of [-0.12, 0.0, 0.12]) B.add(silver, slab(0.07, 0.1, 0.016, 0.01, 0.004), D + px, 0.47, 0.64, -0.4);

  // ---- the outside you see: red bonnet, black cowl, parked wipers
  B.add(paint, slab(1.48, 0.03, 1.12, 0.02, 0.012), 0, 0.855, 1.78, 0.07);
  B.add(black, slab(1.44, 0.02, 0.13, 0.01, 0.006), 0, 0.88, WS + 0.07);
  for (const x of [0.34, -0.28]) B.add(black, slab(0.5, 0.012, 0.016, 0.004, 0.002), x, 0.893, WS + 0.06, 0, 0.08);

  // ---- steering column and the four-spoke sport wheel
  B.add(black, slab(0.11, 0.1, 0.3, 0.04, 0.02), D, 0.74, 0.57, -0.38);
  // wiper / indicator stalks
  for (const s of [-1, 1]) B.add(black, new THREE.CapsuleGeometry(0.008, 0.13, 4, 8), D + s * 0.1, 0.76, 0.52, 0, 0, Math.PI / 2 + s * 0.15);
  B.into(g);

  const column = new THREE.Group();
  column.position.set(D, 0.78, 0.42);
  column.rotation.x = -0.38;
  g.add(column);
  const wheel = new THREE.Group();
  wheel.name = 'steeringWheel';
  column.add(wheel);
  const W = new Baker();
  const R = 0.19;
  W.add(leather, new THREE.TorusGeometry(R, 0.0175, 14, 64), 0, 0, 0, 0, 0, 0, 1, 1, 1.2);
  // padded centre (the horn): a rounded, slightly domed block
  W.add(leather, slab(0.14, 0.11, 0.05, 0.035, 0.016), 0, -0.008, -0.012);
  // four flat spokes: two just below horizontal, two down at the bottom
  for (const a of [-0.3, Math.PI + 0.3, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42]) {
    const len = R - 0.06;
    W.add(leather, slab(len, 0.034, 0.016, 0.01, 0.005), Math.cos(a) * (0.06 + len / 2), Math.sin(a) * (0.06 + len / 2) - 0.008, -0.004, 0, 0, a);
  }
  W.into(wheel);
  const roundel = new THREE.Mesh(new THREE.CircleGeometry(0.019, 28), new THREE.MeshBasicMaterial({ map: e30Roundel(), toneMapped: false }));
  roundel.position.set(0, -0.006, -0.0385);
  roundel.rotation.y = Math.PI;
  wheel.add(roundel);
  addHands(wheel, R);

  g.userData.wheel = wheel;
  g.userData.hub = wheel;
  g.userData.speedNeedle = speedNeedle;
  g.userData.revNeedle = revNeedle;
  g.userData.rpm = 900;
  g.userData.sweep = Math.PI * 1.45;
  g.userData.speedMax = 240;
  g.userData.rpmMax = 7000;
  g.userData.paint = paint;
  // seated eye: ~0.55 m behind the hub (Bheko 24 Nov: "move the seat a lil bit forward",
  // was 0.65 m), 1.13 m up (E30 hip point ~0.42 m)
  g.userData.eye = [D, 1.13, -0.13];
  g.userData.fixedLift = 0;
  // wing mirrors where the E30 model has them (door front corner, z ~0.5)
  g.userData.mirror = { rearY: 1.29, rearZ: 0.53, roofY: ROOF, wingY: 0.99, wingZ: 0.58, wingZL: 0.84, camZ: 0.44 };
  g.userData.hideInMirror = [column];
  return g;
}

// Every car's interior: the E30 for the gusheshe, the generic RHD cockpit for
// the rest. The active one is picked from the player's car each frame.
export function buildCockpit() {
  const g = new THREE.Group();
  g.name = 'cockpit';
  g.visible = false;
  const generic = buildGeneric();
  const e30 = buildE30();
  e30.visible = false;
  g.add(generic, e30);
  g.userData.variants = { generic, gusheshe: e30 };
  g.userData.active = generic;
  Object.assign(g.userData, pick(generic));
  return g;
}

function pick(v) {
  const u = v.userData;
  return { eye: u.eye, mirror: u.mirror, fixedLift: u.fixedLift, hideInMirror: u.hideInMirror, hub: u.hub || u.wheel };
}

const paintRe = /carpaint|paint|body/i;
export function updateCockpit(cockpit, steer, vehicle = null) {
  const cu = cockpit.userData;
  if (cu.variants && vehicle) {
    const want = cu.variants[vehicle.typeId] || cu.variants.generic;
    if (want !== cu.active) {
      cu.active.visible = false;
      want.visible = true;
      cu.active = want;
      cu.fixedLift = undefined;
      Object.assign(cu, pick(want));
      want.userData.paintDone = false;
    }
  }
  const u = cu.active ? cu.active.userData : cu;
  if (u.wheel) u.wheel.rotation.z = -steer * 2.4; // the wheel turns the way you steer
  if (!vehicle || !u.speedNeedle) return;
  // bonnet in the car's own colour
  if (u.paint && !u.paintDone && vehicle.mesh) {
    vehicle.mesh.traverse((o) => {
      if (o.isMesh && o.material && paintRe.test(o.material.name || '') && o.material.color) u.paint.color.copy(o.material.color);
    });
    u.paintDone = true;
  }
  const S = u.sweep || Math.PI * 1.5;
  const kmh = Math.abs(vehicle.speedKmh || 0);
  u.speedNeedle.rotation.z = S * 0.5 - S * Math.min(1, kmh / (u.speedMax || 220));
  // a simple five-speed rev picture: climbs through each gear, idles at 900
  const thr = Math.max(0, vehicle.throttleNow || 0);
  const band = kmh < 1 ? 0 : (kmh % 38) / 38;
  const target = 900 + band * 3600 + thr * 900 + Math.min(1600, kmh * 12);
  u.rpm += (target - u.rpm) * 0.15;
  u.revNeedle.rotation.z = S * 0.5 - S * Math.min(1, u.rpm / (u.rpmMax || 8000));
}
