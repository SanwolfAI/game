import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { EXTRA_VEHICLES } from './catalog.js';

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


function catalogVehicle(spec) {
 const parts=[];
 if(spec.shape==='motorcycle'){
  for(const z of [-1.05,1.05]){const g=new THREE.CylinderGeometry(.43,.43,.18,16);paint(g,'#17191c');g.rotateX(Math.PI/2);g.translate(0,.43,z);parts.push(g);}
  parts.push(box(.16,.18,1.35,0,.78,0,'#9da3a9'),box(.48,.42,.62,0,1.08,.12,spec.color),box(.42,.16,.62,0,1.02,-.52,'#202329'),box(.34,.12,.34,0,1.31,.16,spec.color),box(.48,.1,.12,0,1.22,.78,'#b8c0c8'),box(.1,.08,.48,0,1.27,.92,'#252a30'),box(.2,.12,.12,0,1.03,1.12,'#fff1c2'));
  return mergeGeometries(parts);
 }
 const bus=spec.shape==='bus',van=spec.shape==='van',truck=spec.shape==='bakkie',suv=spec.shape==='suv';
 const w=bus?2.55:van?2.05:truck||suv?2:1.86, len=bus?9.2:van?5.8:truck?5.3:suv?4.65:spec.shape==='sports'?4.25:spec.shape==='sedan'?4.7:3.9;
 const y=bus?.78:.68, r=bus?.52:van||truck||suv?.45:.37, base=len*.34;
 parts.push(box(w,bus?.72:.52,len,0,y,0,spec.color));
 if(truck){parts.push(box(w*.92,.86,2.05,0,1.34,.78,spec.color),glass(w*.84,.55,.1,0,1.42,1.83),box(w*.9,.3,2,0,1.02,-1.48,'#555b61'),box(.12,.5,2,w*.43,1.2,-1.48,spec.color),box(.12,.5,2,-w*.43,1.2,-1.48,spec.color));}
 else{
  const cab=bus?7.3:van?4:spec.shape==='sports'?1.75:2, cy=bus?2.05:van?1.55:suv?1.35:1.22;
  parts.push(box(w*.9,bus?1.55:van?1.1:.72,cab,0,cy,bus?-.15:-.12,spec.color));
  if(bus){for(let z=-3;z<=3;z+=1){parts.push(glass(.08,.88,.76,w*.455,2.12,z),glass(.08,.88,.76,-w*.455,2.12,z));}parts.push(glass(w*.82,1,.1,0,2.12,4.58),glass(w*.82,1,.1,0,2.12,-4.58));}
  else{parts.push(glass(w*.78,.48,.1,0,cy+.03,.9),glass(.08,.42,cab*.72,w*.455,cy+.02,-.15),glass(.08,.42,cab*.72,-w*.455,cy+.02,-.15),glass(w*.76,.42,.1,0,cy+.02,-1.16));
   // Simple cockpit with steering wheel on the South African right-hand-drive side.
   parts.push(box(.58,.12,.42,.42,.92,.55,'#252a30'),box(.1,.34,.1,.58,1.05,.62,'#181b20'),box(.42,.12,.36,.42,.72,-.12,'#24282d'),box(.42,.12,.36,-.42,.72,-.12,'#24282d'));}
 }
 const f=len/2;
 parts.push(box(w*.26,.16,.08,-w*.29,y+.05,f+.02,'#fff2c4'),box(w*.26,.16,.08,w*.29,y+.05,f+.02,'#fff2c4'),box(w*.22,.14,.08,-w*.3,y+.05,-f-.02,'#a5221d'),box(w*.22,.14,.08,w*.3,y+.05,-f-.02,'#a5221d'));
 if(bus){for(const z of [-3,0,3])parts.push(wheel(r,-w*.52,r,z),wheel(r,w*.52,r,z));}else parts.push(...wheels(w*.52,base,r));
 if(spec.category==='taxi')parts.push(box(w*.54,.08,.32,0,1.9,-.2,'#f0c51b'),box(w*.72,.16,.08,0,.98,f+.06,'#f0c51b'));
 return mergeGeometries(parts);
}
for(const spec of EXTRA_VEHICLES) BUILDERS[spec.id]=()=>catalogVehicle(spec);

export const VEHICLE_TYPES = [
  { id: 'gusheshe', name: 'BMW 325i Gusheshe', max: 54, boost: 76, handling: 1.55 },
  { id: 'quantum', name: 'Toyota Quantum taxi', max: 44, boost: 62, handling: 1.35 },
  { id: 'polo', name: 'VW Polo Vivo', max: 48, boost: 68, handling: 1.7 },
  { id: 'hilux', name: 'Toyota Hilux bakkie', max: 46, boost: 64, handling: 1.45 },
  { id: 'saps', name: 'SAPS patrol van', max: 58, boost: 82, handling: 1.5 },
  ...EXTRA_VEHICLES
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
  }[id] || EXTRA_VEHICLES.find((v) => v.id === id)?.color || '#e7e7e2';
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
