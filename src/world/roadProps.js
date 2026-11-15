import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CHUNK_SIZE = 700;
const MAX_LIGHTS = 1600;

function sampleRoad(road, distance) {
  const cumulative = road.cumulative;
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < distance) i++;
  const span = cumulative[i] - cumulative[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (distance - cumulative[i - 1]) / span));
  const a = road.pts[i - 1], b = road.pts[i];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz) || 1;
  return {
    x: a[0] + dx * t,
    z: a[1] + dz * t,
    dirX: dx / length,
    dirZ: dz / length
  };
}

function prepareModel(scene) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const sx = Math.max(size.x, 0.001);
  const sy = Math.max(size.y, 0.001);
  const sz = Math.max(size.z, 0.001);
  const longAxis = sx >= sz ? 'x' : 'z';
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
  return { parts, longAxis };
}

export async function buildRoadProps(roads, hf) {
  const group = new THREE.Group();
  group.name = 'instanced-roadside-props';
  const loader = new GLTFLoader();
  const [lightModel, barrierModel] = await Promise.all([
    loader.loadAsync('./src/assets/roadkit/light-curved.glb'),
    loader.loadAsync('./src/assets/roadkit/road-straight-barrier.glb')
  ]);
  const models = [
    prepareModel(lightModel.scene),
    prepareModel(barrierModel.scene)
  ];

  const chunks = new Map();
  const add = (type, item) => {
    const cx = Math.floor(item.x / CHUNK_SIZE);
    const cz = Math.floor(item.z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!chunks.has(key)) chunks.set(key, { cx, cz, items: [[], []] });
    chunks.get(key).items[type].push(item);
  };

  let lightCount = 0;
  let barrierCount = 0;
  for (const road of roads.roads) {
    if (!road.major || road.len < 50) continue;

    // Staggered streetlights: one side every 35 m, alternating sides.
    for (let d = 25, index = 0; d < road.len && lightCount < MAX_LIGHTS; d += 35, index++) {
      const p = sampleRoad(road, d);
      const side = index % 2 === 0 ? 1 : -1;
      const offset = road.width * 0.5 + 2.4;
      const x = p.x - p.dirZ * offset * side;
      const z = p.z + p.dirX * offset * side;
      const ground = hf.heightAt(x, z);
      const y = roads.deckHeightAt(x, z, ground + (road.bridge ? 6.5 : 0));
      add(0, {
        x, y: y + 0.02, z,
        yaw: Math.atan2(p.dirX, p.dirZ),
        scale: [1.25, 6.8, 1.25]
      });
      lightCount++;
    }

    // Jersey-style barrier sections replace the old tubular rails on major bridges.
    if (road.bridge && road.len > 90) {
      for (let d = 38; d < road.len - 36; d += 7.2) {
        const p = sampleRoad(road, d);
        const ramp = Math.min(
          Math.max(0, Math.min(1, d / 36)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, d / 36))),
          Math.max(0, Math.min(1, (road.len - d) / 36)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, (road.len - d) / 36)))
        );
        const ground = hf.heightAt(p.x, p.z);
        const deck = Math.max(ground, 1.2) + 6.5 * ramp;
        for (const side of [-1, 1]) {
          const offset = road.width * 0.5 + 0.42;
          const x = p.x - p.dirZ * offset * side;
          const z = p.z + p.dirX * offset * side;
          const yaw = models[1].longAxis === 'x'
            ? Math.atan2(-p.dirZ, p.dirX)
            : Math.atan2(p.dirX, p.dirZ);
          add(1, { x, y: deck + 0.02, z, yaw, scale: models[1].longAxis === 'x' ? [7.2, 0.82, 0.72] : [0.72, 0.82, 7.2] });
          barrierCount++;
        }
      }
    }
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const chunkGroups = [];
  for (const chunk of chunks.values()) {
    const chunkGroup = new THREE.Group();
    chunkGroup.userData.centerX = (chunk.cx + 0.5) * CHUNK_SIZE;
    chunkGroup.userData.centerZ = (chunk.cz + 0.5) * CHUNK_SIZE;
    chunkGroup.name = `road-props-${chunk.cx}-${chunk.cz}`;
    for (let type = 0; type < models.length; type++) {
      const items = chunk.items[type];
      if (!items.length) continue;
      for (const part of models[type].parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          position.set(item.x, item.y, item.z);
          quaternion.setFromAxisAngle(up, item.yaw);
          scale.set(item.scale[0], item.scale[1], item.scale[2]);
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

  group.userData.streetlightCount = lightCount;
  group.userData.bridgeBarrierCount = barrierCount;
  function update(x, z) {
    for (const chunk of chunkGroups) {
      const dx = chunk.userData.centerX - x;
      const dz = chunk.userData.centerZ - z;
      chunk.visible = dx * dx + dz * dz < 900 * 900;
    }
  }
  return { group, update, streetlightCount: lightCount, bridgeBarrierCount: barrierCount };
}
