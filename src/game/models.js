import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { EXPANSION_TYPES } from './vehicle-catalog.js';

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
  { id: 'saps', name: 'SAPS patrol van', max: 58, boost: 82, handling: 1.5 },
  ...EXPANSION_TYPES
];

// Keep ambient traffic lightweight; the full catalogue is available to the player.
export const TRAFFIC_VEHICLE_TYPES = VEHICLE_TYPES.slice(0, 5);

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
  }[id] || vehicleType(id).color || '#d8dce0';
}


function buildGenericVehicle(type) {
  const kind = type.kind || 'car';
  const color = type.color || '#d8dce0';
  const parts = [];
  if (kind === 'motorcycle' || kind === 'sportbike' || kind === 'cruiser' || kind === 'scooter') {
    const sport = kind === 'sportbike';
    const cruiser = kind === 'cruiser';
    const wheelR = cruiser ? 0.43 : 0.36;
    parts.push(
      box(0.28, 0.28, 1.15, 0, 0.72, -0.02, '#30343a'),
      box(0.42, 0.34, 0.62, 0, 1.0, 0.12, color),
      box(0.38, 0.18, 0.65, 0, 0.84, -0.55, '#171a1e'),
      box(0.12, 0.68, 0.14, -0.13, 0.75, 0.76, '#aeb8c2'),
      box(0.12, 0.68, 0.14, 0.13, 0.75, 0.76, '#aeb8c2'),
      box(0.68, 0.08, 0.12, 0, 1.25, 0.62, '#252a30'),
      box(0.25, 0.12, 0.18, 0, 0.82, 0.92, '#fff4c5'),
      wheel(wheelR, 0, wheelR, 1.02),
      wheel(wheelR, 0, wheelR, -1.02)
    );
    if (sport) parts.push(box(0.58, 0.42, 0.48, 0, 1.05, 0.55, color));
    if (cruiser) parts.push(box(0.62, 0.18, 0.72, 0, 0.95, -0.48, '#171a1e'));
    if (kind === 'scooter') parts.push(box(0.48, 0.52, 0.58, 0, 0.88, 0.05, color));
    return mergeGeometries(parts);
  }

  const isBus = kind === 'bus' || kind === 'coach';
  const isVan = kind === 'van' || kind === 'minibus' || kind === 'taxi';
  const isPickup = kind === 'pickup';
  const isSuv = kind === 'suv' || kind === 'luxury';
  const length = isBus ? 10.2 : isVan ? 5.8 : isPickup ? 5.3 : isSuv ? 4.8 : 4.25;
  const width = isBus ? 2.5 : isVan ? 2.05 : 1.9;
  const baseY = isBus ? 1.15 : isVan ? 1.0 : 0.76;
  const bodyH = isBus ? 2.35 : isVan ? 1.65 : isSuv ? 0.82 : 0.62;
  const wheelR = isBus ? 0.62 : isVan ? 0.43 : isPickup || isSuv ? 0.46 : 0.38;
  parts.push(box(width, bodyH, length, 0, baseY, 0, color));
  if (isBus) {
    parts.push(box(width * 0.98, 0.12, length * 0.96, 0, baseY + 1.02, 0, color));
    for (let z = -length * 0.39; z <= length * 0.4; z += 1.35) {
      parts.push(box(0.07, 0.9, 0.92, width / 2 + 0.01, baseY + 0.47, z, '#243a4a'));
      parts.push(box(0.07, 0.9, 0.92, -width / 2 - 0.01, baseY + 0.47, z, '#243a4a'));
    }
    parts.push(box(width * 0.82, 0.92, 0.08, 0, baseY + 0.48, length / 2 + 0.015, '#243a4a'));
  } else {
    const cabinZ = isPickup ? 0.78 : -0.05;
    const cabinLen = isPickup ? 2.15 : length * 0.48;
    parts.push(box(width * 0.84, isVan ? 0.78 : 0.62, cabinLen, 0, baseY + bodyH * 0.58, cabinZ, color));
    parts.push(box(width * 0.78, 0.46, 0.07, 0, baseY + bodyH * 0.7, cabinZ + cabinLen / 2 + 0.01, '#243a4a'));
    parts.push(box(0.07, 0.42, cabinLen * 0.7, width * 0.42, baseY + bodyH * 0.7, cabinZ, '#243a4a'));
    parts.push(box(0.07, 0.42, cabinLen * 0.7, -width * 0.42, baseY + bodyH * 0.7, cabinZ, '#243a4a'));
    if (isPickup) {
      parts.push(box(width * 0.88, 0.24, length * 0.36, 0, baseY + 0.18, -length * 0.29, '#343a40'));
    }
  }
  parts.push(
    box(width * 0.22, 0.16, 0.08, -width * 0.31, baseY - 0.08, length / 2 + 0.02, '#fff4c5'),
    box(width * 0.22, 0.16, 0.08, width * 0.31, baseY - 0.08, length / 2 + 0.02, '#fff4c5'),
    box(width * 0.2, 0.14, 0.08, -width * 0.31, baseY - 0.08, -length / 2 - 0.02, '#9e2525'),
    box(width * 0.2, 0.14, 0.08, width * 0.31, baseY - 0.08, -length / 2 - 0.02, '#9e2525')
  );
  const halfTrack = width * 0.54;
  const halfBase = length * (isBus ? 0.37 : 0.31);
  const axleCount = isBus ? 3 : 2;
  for (let axle = 0; axle < axleCount; axle++) {
    const z = axleCount === 3 ? (axle - 1) * halfBase : (axle === 0 ? halfBase : -halfBase);
    parts.push(wheel(wheelR, -halfTrack, wheelR, z), wheel(wheelR, halfTrack, wheelR, z));
  }
  if (kind === 'taxi') {
    parts.push(box(width + 0.02, 0.16, length * 0.82, 0, baseY - 0.04, 0, '#e4bd24'));
    parts.push(box(width + 0.03, 0.08, length * 0.82, 0, baseY + 0.08, 0, '#23824c'));
  }
  return mergeGeometries(parts);
}

export function buildVehicleMesh(id) {
  const type = vehicleType(id);
  const geo = BUILDERS[id] ? BUILDERS[id]() : buildGenericVehicle(type);
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
