import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CHUNK_SIZE = 600;
const TRACK_SPACING = 6;
const MAX_TRACK_SEGMENTS = 18000;

function cumulativeFor(pts) {
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(
      pts[i][0] - pts[i - 1][0],
      pts[i][1] - pts[i - 1][1]
    ));
  }
  return cumulative;
}

function sampleLine(pts, cumulative, distance) {
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < distance) i++;
  const span = cumulative[i] - cumulative[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (distance - cumulative[i - 1]) / span));
  const a = pts[i - 1], b = pts[i];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz) || 1;
  return {
    x: a[0] + dx * t,
    z: a[1] + dz * t,
    dirX: dx / length,
    dirZ: dz / length
  };
}

function prepareTrack(scene) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const sx = Math.max(size.x, 0.001), sy = Math.max(size.y, 0.001), sz = Math.max(size.z, 0.001);
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

export async function buildRailTracks(roads, hf) {
  const group = new THREE.Group();
  group.name = 'detailed-durban-rail-tracks';
  if (!(roads.rail || []).length) return { group, update() {}, trackSegments: 0 };

  const loader = new GLTFLoader();
  let model;
  try {
    const gltf = await loader.loadAsync('./src/assets/trainkit/track-detailed.glb');
    model = prepareTrack(gltf.scene);
    if (!model.parts.length) throw new Error('Detailed track model has no meshes');
  } catch (error) {
    console.warn('Detailed railway track model unavailable; keeping the basic track bed:', error);
    return { group, update() {}, trackSegments: 0 };
  }

  const chunks = new Map();
  let trackSegments = 0;
  for (const line of roads.rail) {
    if (line.pts.length < 2 || trackSegments >= MAX_TRACK_SEGMENTS) continue;
    const cumulative = cumulativeFor(line.pts);
    const length = cumulative[cumulative.length - 1];
    for (let d = TRACK_SPACING * 0.5; d < length && trackSegments < MAX_TRACK_SEGMENTS; d += TRACK_SPACING) {
      const p = sampleLine(line.pts, cumulative, d);
      const cx = Math.floor(p.x / CHUNK_SIZE), cz = Math.floor(p.z / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      if (!chunks.has(key)) chunks.set(key, { cx, cz, items: [] });
      const yaw = model.longAxis === 'x'
        ? Math.atan2(-p.dirZ, p.dirX)
        : Math.atan2(p.dirX, p.dirZ);
      chunks.get(key).items.push({
        x: p.x,
        y: hf.heightAt(p.x, p.z) + 0.05,
        z: p.z,
        yaw,
        scale: model.longAxis === 'x' ? [TRACK_SPACING, 0.48, 4.4] : [4.4, 0.48, TRACK_SPACING]
      });
      trackSegments++;
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
    chunkGroup.name = `rail-track-${chunk.cx}-${chunk.cz}`;
    chunkGroup.userData.centerX = (chunk.cx + 0.5) * CHUNK_SIZE;
    chunkGroup.userData.centerZ = (chunk.cz + 0.5) * CHUNK_SIZE;
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, chunk.items.length);
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      for (let i = 0; i < chunk.items.length; i++) {
        const item = chunk.items[i];
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
    group.add(chunkGroup);
    chunkGroups.push(chunkGroup);
  }

  // The detailed Kenney track contains the rails and sleepers, so hide the
  // older single-strip placeholder only after the replacement loaded.
  roads.group.traverse((object) => {
    if (object.name === 'rail') object.visible = false;
  });
  group.userData.trackSegments = trackSegments;
  function update(x, z) {
    for (const chunk of chunkGroups) {
      const dx = chunk.userData.centerX - x;
      const dz = chunk.userData.centerZ - z;
      chunk.visible = dx * dx + dz * dz < 1500 * 1500;
    }
  }
  return { group, update, trackSegments };
}
