import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CHUNK_SIZE = 600;
const MODEL_SETS = {
  house: [
    './src/assets/suburbankit/building-type-a.glb',
    './src/assets/suburbankit/building-type-h.glb',
    './src/assets/suburbankit/building-type-q.glb'
  ],
  hotel: [
    './src/assets/commercialkit/low-detail-building-wide-a.glb',
    './src/assets/commercialkit/low-detail-building-wide-b.glb',
    './src/assets/commercialkit/low-detail-building-c.glb'
  ],
  tower: [
    './src/assets/commercialkit/building-skyscraper-a.glb',
    './src/assets/commercialkit/building-skyscraper-c.glb',
    './src/assets/commercialkit/building-skyscraper-e.glb'
  ]
};

function prepareModel(scene) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const sx = Math.max(size.x, 0.001);
  const sy = Math.max(size.y, 0.001);
  const sz = Math.max(size.z, 0.001);
  const parts = [];
  scene.traverse((object) => {
    if (!object.isMesh || !object.geometry || !object.material) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.translate(-center.x, -bounds.min.y, -center.z);
    geometry.scale(1 / sx, 1 / sy, 1 / sz);
    geometry.computeBoundingSphere();
    parts.push({ geometry, material: object.material });
  });
  return parts;
}

export async function buildCityModels(city, hf, rng) {
  const group = new THREE.Group();
  group.name = 'mapped-3d-city-buildings';
  const loader = new GLTFLoader();
  const loaded = {};
  const modelByFile = new Map();

  await Promise.all(Object.entries(MODEL_SETS).map(async ([kind, files]) => {
    const variants = await Promise.all(files.map(async (file) => {
      try {
        const gltf = await loader.loadAsync(file);
        const model = { file, parts: prepareModel(gltf.scene) };
        if (model.parts.length) modelByFile.set(file, model);
        return model.parts.length ? model : null;
      } catch (error) {
        console.warn(`Could not load city building model ${file}`, error);
        return null;
      }
    }));
    loaded[kind] = variants.filter(Boolean);
  }));

  const chunks = new Map();
  const counts = { house: 0, hotel: 0, tower: 0 };
  for (const building of city.buildings) {
    const variants = loaded[building.kind] || [];
    if (!variants.length) continue;
    const model = variants[Math.floor(rng() * variants.length)];
    const cx = Math.floor(building.x / CHUNK_SIZE);
    const cz = Math.floor(building.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!chunks.has(key)) chunks.set(key, { cx, cz, items: new Map() });
    const chunk = chunks.get(key);
    if (!chunk.items.has(model.file)) chunk.items.set(model.file, []);
    chunk.items.get(model.file).push(building);
    counts[building.kind]++;
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const chunkGroups = [];
  for (const chunk of chunks.values()) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = `city-buildings-${chunk.cx}-${chunk.cz}`;
    chunkGroup.userData.centerX = (chunk.cx + 0.5) * CHUNK_SIZE;
    chunkGroup.userData.centerZ = (chunk.cz + 0.5) * CHUNK_SIZE;
    for (const [file, items] of chunk.items) {
      const model = modelByFile.get(file);
      if (!model) continue;
      for (const part of model.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        for (let i = 0; i < items.length; i++) {
          const building = items[i];
          position.set(building.x, hf.heightAt(building.x, building.z), building.z);
          quaternion.setFromAxisAngle(up, building.yaw || 0);
          scale.set(building.w, building.h, building.dp);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        chunkGroup.add(mesh);
      }
    }
    group.add(chunkGroup);
    chunkGroups.push(chunkGroup);
  }

  for (const [kind, variants] of Object.entries(loaded)) {
    if (!variants.length) continue;
    for (const mesh of city.buildingMeshes[kind] || []) mesh.visible = false;
  }

  group.userData.buildingCounts = counts;
  function update(x, z) {
    for (const chunk of chunkGroups) {
      const dx = chunk.userData.centerX - x;
      const dz = chunk.userData.centerZ - z;
      chunk.visible = dx * dx + dz * dz < 1200 * 1200;
    }
  }
  return { group, update, counts };
}
