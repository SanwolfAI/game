import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';
import { blobMaterial, blobGeometry } from '../world/blobShadow.js';
import { hdTrafficModel, hdPlayerModel, addPlayerPlates, smoothPlayerPaint, platePartGeometry, scanPlateOffsets, plateInstanceMaterial } from './hdCars.js';

// Sketchfab cars (CC BY 4.0, credited in #model-credits), pre-optimised by
// scripts/optimize-vehicles.mjs into src/assets/vehicles/*.glb.
// Material handling follows main's sketchfabModels.js: glossy clear-coated
// paint, chrome, see-through glass, glowing lamps, wheels that spin and steer.
// Every model is optional: the procedural cars in models.js stay as fallback.

const SOURCES = [
  { id: 'gusheshe', file: './src/assets/vehicles/gusheshe.glb', length: 4.33, title: '1991 BMW 325i (E30)' },
  { id: 'hiace', file: './src/assets/vehicles/hiace.glb', length: 4.9, title: 'Toyota HiAce 2004', flip: true }
];

// Which loaded model plays which game vehicle (player / traffic).
const PLAYER_MODEL = { gusheshe: 'gusheshe', quantum: 'hiace' };
const TRAFFIC_MODEL = { gusheshe: 'bmw-lowpoly', quantum: 'hiace' };

const loaded = new Map();

function upgradeMaterial(src, player) {
  const name = (src.name || '').toLowerCase();
  const isGlass = /glass|window|windscreen|transparent/.test(name) || (src.transparent && src.opacity < 0.9);
  const isPaint = /carpaint|paint|body/.test(name);
  const isChrome = /chrome|rim(?!_dark)|alloy/.test(name);
  const isHead = /headlamp|reflector/.test(name);
  const isTail = /tail_red/.test(name);
  const isAmber = /amber|signal/.test(name);
  const params = {
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map || null,
    side: src.side,
    transparent: !!src.transparent,
    opacity: src.opacity ?? 1
  };
  let m;
  if (player && (isPaint || isChrome || isGlass)) {
    m = new THREE.MeshPhysicalMaterial({ ...params, metalness: src.metalness ?? 0, roughness: src.roughness ?? 0.6 });
  } else {
    m = new THREE.MeshStandardMaterial({ ...params, metalness: Math.min(0.6, src.metalness ?? 0), roughness: Math.max(0.35, src.roughness ?? 0.8) });
  }
  m.name = src.name;
  if (isPaint) {
    m.metalness = 0.3;
    m.roughness = 0.32;
    if (m.isMeshPhysicalMaterial) {
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.06;
    }
    m.envMapIntensity = 1.3;
  }
  if (isChrome) {
    m.metalness = 1;
    m.roughness = 0.14;
    m.envMapIntensity = 1.6;
  }
  if (isGlass) {
    m.transparent = true;
    m.opacity = Math.min(m.opacity, 0.45);
    m.color.multiplyScalar(0.35);
    m.roughness = 0.05;
    m.metalness = 0.1;
    m.depthWrite = false;
    m.envMapIntensity = 1.8;
  }
  if (isHead || isTail || isAmber) {
    m.emissive = m.color.clone().multiplyScalar(0.25);
    m.userData.lamp = isHead ? 'head' : isTail ? 'tail' : 'amber';
  }
  return m;
}

// Orient/scale so length runs along +Z, front = +Z, origin at ground centre.
function normalise(scene, length) {
  const inner = new THREE.Group();
  inner.add(scene);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(inner);
  let size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) inner.rotation.y = Math.PI / 2;
  outer.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  size = box.getSize(new THREE.Vector3());
  inner.scale.multiplyScalar(length / Math.max(size.x, size.z, 0.001));
  outer.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  inner.position.y -= box.min.y;
  outer.updateMatrixWorld(true);
  return { outer, inner };
}

function flipIfBackwards(outer, inner, frontHint) {
  if (frontHint < 0) {
    inner.rotation.y += Math.PI;
    inner.position.x *= -1;
    inner.position.z *= -1;
    outer.updateMatrixWorld(true);
  }
}

// Player model: keeps wheel nodes as pivots, merges the static body by material.
function preparePlayer(gltf, src) {
  const { outer, inner } = normalise(gltf.scene, src.length);
  // front detection from headlamp material (E30) or the taller cabin end (vans)
  const lamp = new THREE.Box3();
  inner.traverse((o) => {
    if (o.isMesh && /headlamp/i.test(o.material?.name || '')) lamp.expandByObject(o);
  });
  if (!lamp.isEmpty()) flipIfBackwards(outer, inner, lamp.getCenter(new THREE.Vector3()).z);
  else if (src.flip) flipIfBackwards(outer, inner, -1);

  const wheels = [];
  inner.traverse((o) => {
    if (/^wheel_(fl|fr|rl|rr)/i.test(o.name)) wheels.push(o);
  });
  const wheelSet = new Set();
  for (const w of wheels) w.traverse((o) => wheelSet.add(o));

  // merge static meshes by material (world space inside `outer`)
  const byMat = new Map();
  outer.updateMatrixWorld(true);
  inner.traverse((o) => {
    if (!o.isMesh || wheelSet.has(o)) return;
    const key = o.material;
    let list = byMat.get(key);
    if (!list) byMat.set(key, (list = []));
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    list.push(g.index ? g.toNonIndexed() : g);
  });
  const root = new THREE.Group();
  const lamps = { head: new THREE.Box3(), tail: new THREE.Box3() };
  for (const [mat, list] of byMat) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, upgradeMaterial(mat, true));
    root.add(m);
    if (m.material.userData.lamp === 'head') lamps.head.expandByObject(m);
    if (m.material.userData.lamp === 'tail') lamps.tail.expandByObject(m);
  }
  for (const w of wheels) {
    const box = new THREE.Box3().setFromObject(w);
    if (box.isEmpty()) continue;
    const c = box.getCenter(new THREE.Vector3());
    const steer = new THREE.Group();
    steer.name = /^wheel_f/i.test(w.name) ? 'wheelSteer' : 'wheelFixed';
    steer.position.copy(c);
    const spin = new THREE.Group();
    spin.name = 'wheelSpin';
    spin.userData.radius = Math.max(box.max.y - box.min.y, 0.3) / 2;
    steer.add(spin);
    root.add(steer);
    root.updateMatrixWorld(true);
    spin.attach(w);
    w.traverse((o) => {
      if (o.isMesh) o.material = upgradeMaterial(o.material, true);
    });
  }
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  root.userData.size = size;
  root.userData.lamps = lamps;
  return root;
}

// Traffic model: one geometry per material in vehicle space, for InstancedMesh.
function prepareTraffic(gltf, src) {
  const scene = gltf.scene.clone(true);
  const { outer, inner } = normalise(scene, src.length);
  if (src.flip) flipIfBackwards(outer, inner, -1);
  outer.updateMatrixWorld(true);
  const byMat = new Map();
  inner.traverse((o) => {
    if (!o.isMesh) return;
    let list = byMat.get(o.material);
    if (!list) byMat.set(o.material, (list = []));
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    list.push(g.index ? g.toNonIndexed() : g);
  });
  const parts = [];
  for (const [mat, list] of byMat) {
    const geometry = list.length === 1 ? list[0] : mergeGeometries(list);
    if (!geometry) continue;
    const m = upgradeMaterial(mat, false);
    parts.push({ geometry, material: m, paint: /material\.001|carpaint|paint|body/i.test(mat.name || '') });
  }
  // made-up KZN "ND" number plates over the model's own (no brand names)
  const plateSpots = scanPlateOffsets(parts.map((p) => p.geometry));
  if (plateSpots) parts.push({ geometry: platePartGeometry(plateSpots), material: plateInstanceMaterial(), paint: false, plate: true });
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  // soft contact shadow under the car (slightly bigger than the body)
  const ctr = box.getCenter(new THREE.Vector3());
  parts.push({ geometry: blobGeometry(size.x * 1.25, size.z * 1.15, box.min.y + 0.04, ctr.x, ctr.z), material: blobMaterial(), paint: false, shadow: true });
  return { parts, size };
}

export async function loadCarModels() {
  const loader = new GLTFLoader();
  await Promise.all(
    SOURCES.map(async (src) => {
      try {
        const gltf = await loader.loadAsync(src.file);
        loaded.set(src.id, { gltf, src, player: null, traffic: null });
      } catch (err) {
        console.warn(`[IZK] ${src.title} unavailable, using the built-in car.`, err);
      }
    })
  );
  return loaded.size;
}

// Fresh player mesh for a game vehicle id, or null (use procedural fallback).
const HD_PLAYER_PAINT = { polo: 0x2f6fb5, hilux: 0xe8e6df, saps: 0xffffff };
const hdPlayers = new Map();

export function playerCarModel(typeId) {
  const id = PLAYER_MODEL[typeId];
  const rec = id && loaded.get(id);
  if (!rec) {
    // no glTF for this type: the HD built-in car (not the old boxes)
    if (!HD_PLAYER_PAINT[typeId]) return null;
    if (!hdPlayers.has(typeId)) hdPlayers.set(typeId, hdPlayerModel(typeId, HD_PLAYER_PAINT[typeId]));
    return hdPlayers.get(typeId);
  }
  if (!rec.player) {
    try {
      rec.player = preparePlayer(rec.gltf, rec.src);
      addPlayerPlates(rec.player, typeId === 'quantum');
      smoothPlayerPaint(rec.player);
    } catch (err) {
      console.warn('[IZK] could not prepare', id, err);
      return null;
    }
  }
  return rec.player;
}

// HD built-in cars (hdCars.js) for these types, in traffic and parked
const HD_TRAFFIC = new Set(['polo', 'hilux', 'saps', 'gusheshe']);

export function trafficCarModel(typeId) {
  if (HD_TRAFFIC.has(typeId)) {
    const hd = hdTrafficModel(typeId);
    if (hd) return hd;
  }
  const id = TRAFFIC_MODEL[typeId];
  const rec = id && loaded.get(id);
  if (!rec) return null;
  if (!rec.traffic) {
    try {
      rec.traffic = prepareTraffic(rec.gltf, rec.src);
    } catch (err) {
      console.warn('[IZK] could not prepare traffic', id, err);
      return null;
    }
  }
  return rec.traffic;
}

export function animateWheels(mesh, speed, steer, dt) {
  if (!mesh) return;
  if (!mesh.userData.wheelParts) {
    const parts = [];
    mesh.traverse((o) => {
      if (o.name === 'wheelSteer' || o.name === 'wheelFixed') parts.push(o);
    });
    mesh.userData.wheelParts = parts;
  }
  for (const node of mesh.userData.wheelParts) {
    const spin = node.children[0];
    if (!spin) continue;
    spin.rotation.x += (speed * dt) / (spin.userData.radius || 0.32);
    if (node.name === 'wheelSteer') node.rotation.y = steer;
  }
}

let envReady = false;
// Soft sky/ground environment so paint, chrome and glass have something to reflect.
export function applyVehicleEnvironment(renderer, scene) {
  if (envReady) return;
  envReady = true;
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const colors = [];
  const pos = geo.attributes.position;
  const top = new THREE.Color(0x8fc3ea);
  const horizon = new THREE.Color(0xf4ead2);
  const ground = new THREE.Color(0x4a4a44);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y > 0) c.copy(horizon).lerp(top, Math.pow(y, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 3));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  // a row of bright "buildings" so the paint shows reflections along the sides
  for (let k = 0; k < 10; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(6, 10 + (k % 3) * 6, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xd9d4c8 : 0x8fa1b0 }));
    const a = (k / 10) * Math.PI * 2;
    b.position.set(Math.cos(a) * 40, 2, Math.sin(a) * 40);
    envScene.add(b);
  }
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 4.8) }));
  sunDisc.position.set(20, 35, 15);
  envScene.add(sunDisc);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  return env;
}
