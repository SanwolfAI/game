import * as THREE from '../../vendor/three/three.module.js';

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

export function buildCockpit() {
  const g = new THREE.Group();
  g.name = 'cockpit';
  g.visible = false;
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
  const skin = new THREE.MeshStandardMaterial({ color: 0x6e4630, roughness: 0.75 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2a4a7a, roughness: 0.9 });
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
  // hands at quarter to three, short forearms back toward the driver
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hand.position.set(side * 0.185, 0.01, -0.01);
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.05, 4, 10), skin);
    palm.rotation.z = side * 0.3;
    hand.add(palm);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.36, 4, 10), sleeve);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * 0.035, -0.05, -0.24);
    hand.add(arm);
    wheel.add(hand);
  }
  g.userData.wheel = wheel;
  g.userData.speedNeedle = speedNeedle;
  g.userData.revNeedle = revNeedle;
  g.userData.rpm = 900;
  return g;
}

// Needles sweep 270 degrees from bottom-left; the face is seen from behind
// (rotated to look at the driver), so a clockwise sweep is +z rotation here.
const SWEEP = Math.PI * 1.5;
export function updateCockpit(cockpit, steer, vehicle = null) {
  const u = cockpit.userData;
  if (u.wheel) u.wheel.rotation.z = -steer * 2.4; // the wheel turns the way you steer
  if (!vehicle || !u.speedNeedle) return;
  const kmh = Math.abs(vehicle.speedKmh || 0);
  u.speedNeedle.rotation.z = SWEEP * 0.5 - SWEEP * Math.min(1, kmh / 220);
  // a simple five-speed rev picture: climbs through each gear, idles at 900
  const thr = Math.max(0, vehicle.throttleNow || 0);
  const band = kmh < 1 ? 0 : (kmh % 38) / 38;
  const target = 900 + band * 3600 + thr * 900 + Math.min(1600, kmh * 12);
  u.rpm += (target - u.rpm) * 0.15;
  u.revNeedle.rotation.z = SWEEP * 0.5 - SWEEP * Math.min(1, u.rpm / 8000);
}
