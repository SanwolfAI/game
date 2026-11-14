import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  paint(g, color);
  g.translate(x, y, z);
  return g;
}

function wheel(r, x, y, z) {
  const g = new THREE.CylinderGeometry(r, r, 0.34, 10);
  paint(g, '#16181b');
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function wheels(halfTrack, halfBase, r = 0.42) {
  return [
    wheel(r, -halfTrack, r, halfBase),
    wheel(r, halfTrack, r, halfBase),
    wheel(r, -halfTrack, r, -halfBase),
    wheel(r, halfTrack, r, -halfBase)
  ];
}

function glass(w, h, d, x, y, z) {
  return box(w, h, d, x, y, z, '#20323f');
}

function lightBar() {
  return [
    box(0.55, 0.16, 0.34, -0.55, 2.28, 0.9, '#2f7bff'),
    box(0.55, 0.16, 0.34, 0.55, 2.28, 0.9, '#ff3b30')
  ];
}

const BUILDERS = {
  quantum() {
    const parts = [
      box(2.0, 1.85, 5.5, 0, 1.45, 0, '#f4f4ef'),
      box(2.04, 0.22, 5.3, 0, 2.4, 0, '#e9e9e2'),
      glass(1.9, 0.72, 0.12, 0, 1.86, 2.7),
      glass(0.1, 0.66, 3.3, 1.01, 1.84, -0.35),
      glass(0.1, 0.66, 3.3, -1.01, 1.84, -0.35),
      box(2.02, 0.3, 5.5, 0, 1.06, 0, '#2f8f4e'),
      box(2.02, 0.16, 5.5, 0, 0.86, 0, '#f2c230'),
      box(2.02, 0.16, 5.5, 0, 0.68, 0, '#c0392b'),
      box(0.5, 0.18, 0.12, -0.68, 0.78, 2.76, '#fff6bf'),
      box(0.5, 0.18, 0.12, 0.68, 0.78, 2.76, '#fff6bf'),
      box(0.34, 0.16, 0.1, -0.72, 0.78, -2.76, '#8d1c15'),
      box(0.34, 0.16, 0.1, 0.72, 0.78, -2.76, '#8d1c15'),
      ...wheels(1.0, 1.75, 0.44)
    ];
    return mergeGeometries(parts);
  },

  polo() {
    const parts = [
      box(1.78, 0.58, 3.9, 0, 0.78, 0, '#2f6fb5'),
      box(1.66, 0.5, 1.95, 0, 1.3, -0.15, '#2a63a2'),
      glass(1.58, 0.44, 1.7, 0, 1.34, -0.15),
      box(1.82, 0.2, 0.34, 0, 0.55, 1.86, '#26292d'),
      box(1.82, 0.2, 0.34, 0, 0.55, -1.86, '#26292d'),
      box(0.42, 0.18, 0.1, -0.56, 0.84, 1.93, '#fff6bf'),
      box(0.42, 0.18, 0.1, 0.56, 0.84, 1.93, '#fff6bf'),
      box(0.32, 0.15, 0.1, -0.6, 0.84, -1.93, '#8d1c15'),
      box(0.32, 0.15, 0.1, 0.6, 0.84, -1.93, '#8d1c15'),
      ...wheels(0.92, 1.28, 0.36)
    ];
    return mergeGeometries(parts);
  },

  gusheshe() {
    const parts = [
      box(1.86, 0.56, 4.55, 0, 0.76, 0, '#b7332c'),
      box(1.72, 0.5, 2.1, 0, 1.26, -0.18, '#a32c26'),
      glass(1.62, 0.44, 1.86, 0, 1.3, -0.18),
      box(1.9, 0.16, 0.3, 0, 0.58, 2.18, '#22252a'),
      box(1.9, 0.16, 0.3, 0, 0.58, -2.18, '#22252a'),
      box(1.9, 0.1, 4.55, 0, 1.02, 0, '#f0efe8'),
      box(0.44, 0.18, 0.1, -0.58, 0.82, 2.24, '#fff6bf'),
      box(0.44, 0.18, 0.1, 0.58, 0.82, 2.24, '#fff6bf'),
      box(0.4, 0.16, 0.1, -0.62, 0.82, -2.26, '#8d1c15'),
      box(0.4, 0.16, 0.1, 0.62, 0.82, -2.26, '#8d1c15'),
      ...wheels(0.96, 1.44, 0.4)
    ];
    return mergeGeometries(parts);
  },

  hilux() {
    const parts = [
      box(1.9, 0.55, 5.2, 0, 0.82, 0, '#e8e6df'),
      box(1.86, 0.95, 1.95, 0, 1.52, 0.85, '#e8e6df'),
      glass(1.74, 0.62, 0.12, 0, 1.62, 1.86),
      glass(0.1, 0.5, 1.5, 0.94, 1.6, 0.85),
      glass(0.1, 0.5, 1.5, -0.94, 1.6, 0.85),
      box(1.88, 0.34, 2.2, 0, 1.28, -1.5, '#d8d6cf'),
      box(0.16, 0.6, 2.2, 0.9, 1.62, -1.5, '#d8d6cf'),
      box(0.16, 0.6, 2.2, -0.9, 1.62, -1.5, '#d8d6cf'),
      box(1.88, 0.6, 0.16, 0, 1.62, -2.55, '#d8d6cf'),
      box(0.46, 0.2, 0.1, -0.6, 0.9, 2.54, '#fff6bf'),
      box(0.46, 0.2, 0.1, 0.6, 0.9, 2.54, '#fff6bf'),
      box(0.34, 0.16, 0.1, -0.66, 0.9, -2.62, '#8d1c15'),
      box(0.34, 0.16, 0.1, 0.66, 0.9, -2.62, '#8d1c15'),
      ...wheels(1.0, 1.7, 0.46)
    ];
    return mergeGeometries(parts);
  },

  saps() {
    const parts = [
      box(2.02, 1.8, 5.2, 0, 1.45, 0, '#f1f3f5'),
      box(2.06, 0.42, 5.2, 0, 1.08, 0, '#1e4fa1'),
      glass(1.92, 0.66, 0.12, 0, 1.88, 2.55),
      glass(0.1, 0.58, 2.9, 1.03, 1.86, -0.4),
      glass(0.1, 0.58, 2.9, -1.03, 1.86, -0.4),
      box(1.0, 0.4, 0.12, 0, 1.08, 2.62, '#f2c230'),
      ...lightBar(),
      ...wheels(1.02, 1.66, 0.44)
    ];
    return mergeGeometries(parts);
  }
};

export const VEHICLE_TYPES = [
  { id: 'gusheshe', name: 'BMW 325i Gusheshe', max: 54, boost: 76, handling: 1.55 },
  { id: 'quantum', name: 'Toyota Quantum taxi', max: 44, boost: 62, handling: 1.35 },
  { id: 'polo', name: 'VW Polo Vivo', max: 48, boost: 68, handling: 1.7 },
  { id: 'hilux', name: 'Toyota Hilux bakkie', max: 46, boost: 64, handling: 1.45 },
  { id: 'saps', name: 'SAPS patrol van', max: 58, boost: 82, handling: 1.5 }
];

export function vehicleType(id) {
  return VEHICLE_TYPES.find((t) => t.id === id) || VEHICLE_TYPES[0];
}

function firstPaint(id) {
  return {
    quantum: '#f4f4ef',
    polo: '#2f6fb5',
    gusheshe: '#b7332c',
    hilux: '#e8e6df',
    saps: '#f1f3f5'
  }[id];
}

export function buildVehicleMesh(id) {
  const geo = BUILDERS[id] ? BUILDERS[id]() : BUILDERS.gusheshe();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `vehicle-${id}`;
  return mesh;
}

export function buildPedestrianGeometry() {
  const parts = [
    box(0.42, 0.62, 0.26, 0, 0.95, 0, '#b9773f'),
    box(0.2, 0.42, 0.24, -0.12, 0.28, 0, '#333a44'),
    box(0.2, 0.42, 0.24, 0.12, 0.28, 0, '#333a44'),
    box(0.32, 0.46, 0.24, 0, 1.48, 0, '#4d7ab0'),
    box(0.13, 0.46, 0.15, -0.27, 1.42, 0, '#b9773f'),
    box(0.13, 0.46, 0.15, 0.27, 1.42, 0, '#b9773f'),
    box(0.26, 0.26, 0.24, 0, 1.86, 0, '#8a5c33')
  ];
  return mergeGeometries(parts);
}

export function buildPlayerModel() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xb9773f });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2f6fb5 });
  const jeans = new THREE.MeshLambertMaterial({ color: 0x2c3742 });
  const shoes = new THREE.MeshLambertMaterial({ color: 0x1b1e22 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirt);
  torso.position.y = 1.2;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skin);
  head.position.y = 1.68;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), new THREE.MeshLambertMaterial({ color: 0x1d1712 }));
  hair.position.y = 1.82;
  group.add(hair);

  const armGeo = new THREE.BoxGeometry(0.15, 0.56, 0.16);
  const armL = new THREE.Mesh(armGeo, skin);
  const armR = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.34, 1.2, 0);
  armR.position.set(0.34, 1.2, 0);
  group.add(armL, armR);

  const legGeo = new THREE.BoxGeometry(0.19, 0.66, 0.2);
  const legL = new THREE.Mesh(legGeo, jeans);
  const legR = new THREE.Mesh(legGeo, jeans);
  legL.position.set(-0.14, 0.56, 0);
  legR.position.set(0.14, 0.56, 0);
  group.add(legL, legR);

  const shoeGeo = new THREE.BoxGeometry(0.21, 0.14, 0.32);
  const shoeL = new THREE.Mesh(shoeGeo, shoes);
  const shoeR = new THREE.Mesh(shoeGeo, shoes);
  shoeL.position.set(-0.14, 0.07, 0.04);
  shoeR.position.set(0.14, 0.07, 0.04);
  group.add(shoeL, shoeR);

  for (const part of [armL, armR, legL, legR, shoeL, shoeR]) {
    part.geometry = part.geometry.clone();
    part.geometry.translate(0, -0.28, 0);
    part.userData.baseY = part.position.y;
  }
  armL.position.y += 0.28;
  armR.position.y += 0.28;
  legL.position.y += 0.28;
  legR.position.y += 0.28;
  shoeL.position.y += 0.28;
  shoeR.position.y += 0.28;

  group.name = 'player';
  return { group, armL, armR, legL, legR, shoeL, shoeR };
}

export { firstPaint };
