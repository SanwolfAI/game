import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const downloaded = new Map();

const SOURCES = [
  { id: 'gusheshe-3d', path: './src/assets/vehicles/gusheshe/scene.gltf', length: 4.55, title: '1991 BMW 325i (E30) — Pink Slip Kings' },
  { id: 'bmw-lowpoly-3d', path: './src/assets/vehicles/bmw-lowpoly/scene.gltf', length: 4.4, title: 'Low-Poly BMW' },
  { id: 'hiace-3d', path: './src/assets/vehicles/hiace/scene.gltf', length: 5.2, title: 'Toyota HiAce 2004' }
];

function prepareVehicle(root, targetLength, id) {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (size.x > size.z) root.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const fitted = bounds.getSize(new THREE.Vector3());
  const longest = Math.max(fitted.x, fitted.z, 0.001);
  const scale = targetLength / longest;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= bounds.min.y;
  root.traverse((part) => {
    if (part.isMesh) {
      part.castShadow = true;
      part.receiveShadow = true;
      if (part.material) {
        part.material.side = THREE.FrontSide;
        part.material.needsUpdate = true;
      }
    }
  });
  root.name = `downloaded-${id}`;
  return root;
}

export async function loadDownloadedVehicles() {
  const results = await Promise.all(SOURCES.map(async (source) => {
    try {
      const gltf = await loader.loadAsync(source.path);
      const model = prepareVehicle(gltf.scene, source.length, source.id);
      downloaded.set(source.id, model);
      return source.id;
    } catch (error) {
      console.warn(`[IZK] ${source.title} unavailable; using built-in fallback.`, error);
      return null;
    }
  }));
  const loaded = results.filter(Boolean);
  console.info(`[IZK] Loaded ${loaded.length}/${SOURCES.length} downloaded vehicles.`);
  return loaded;
}

export function getDownloadedVehicle(id) {
  return downloaded.get(id) || null;
}
