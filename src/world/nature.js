import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toXZ } from '../core/geo.js';

const CHUNK_SIZE = 500;
const MAX_TREES = 1200;
const TREE_MODELS = [
  { file: 'tree_default.glb', height: 6.2 },
  { file: 'tree_plateau.glb', height: 7.2 },
  { file: 'tree_palm.glb', height: 9.2 }
];

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a[1] > z) !== (b[1] > z);
    if (crosses && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function prepareModel(scene) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const height = Math.max(0.001, size.y);
  const center = bounds.getCenter(new THREE.Vector3());
  const parts = [];
  scene.traverse((object) => {
    if (!object.isMesh || !object.geometry || !object.material) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.translate(-center.x, -bounds.min.y, -center.z);
    geometry.scale(1 / height, 1 / height, 1 / height);
    geometry.computeBoundingSphere();
    parts.push({ geometry, material: object.material });
  });
  return parts;
}

function buildRailIndex(lines) {
  const cell = 18;
  const cells = new Set();
  for (const line of lines || []) {
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1], b = line.pts[i];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(length / 10));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        cells.add(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
      }
    }
  }
  return (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (cells.has(`${cx + dx},${cz + dz}`)) return true;
      }
    }
    return false;
  };
}

function buildRailIndex(lines) {
  const cell = 18;
  const cells = new Set();
  for (const line of lines || []) {
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1], b = line.pts[i];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(length / 10));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        cells.add(`${Math.floor((a[0] + (b[0] - a[0]) * t) / cell)},${Math.floor((a[1] + (b[1] - a[1]) * t) / cell)}`);
      }
    }
  }
  return (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (cells.has(`${cx + dx},${cz + dz}`)) return true;
      }
    }
    return false;
  };
}

export async function buildNature(data, roads, city, hf, coastXZ, rng) {
  const group = new THREE.Group();
  group.name = 'durban-natural-vegetation';
  const loader = new GLTFLoader();
  const nearRail = buildRailIndex(roads.rail);
  const loaded = await Promise.all(TREE_MODELS.map(async (entry) => {
    try {
      const gltf = await loader.loadAsync(`./src/assets/naturekit/${entry.file}`);
      return prepareModel(gltf.scene);
    } catch (error) {
      console.warn(`Could not load vegetation model ${entry.file}`, error);
      return [];
    }
  }));

  const placements = new Map();
  const chunkGroups = [];
  const spacingCells = new Map();
  const isNearTree = (x, z) => {
    const cx = Math.floor(x / 14), cz = Math.floor(z / 14);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = spacingCells.get(`${cx + dx},${cz + dz}`) || [];
        if (list.some((p) => Math.hypot(p[0] - x, p[1] - z) < 13)) return true;
      }
    }
    return false;
  };
  const add = (type, x, z, height) => {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!placements.has(key)) placements.set(key, { cx, cz, items: [[], [], []] });
    placements.get(key).items[type].push({
      x, z, y: hf.heightAt(x, z), yaw: rng() * Math.PI * 2, height
    });
    const sk = `${Math.floor(x / 14)},${Math.floor(z / 14)}`;
    if (!spacingCells.has(sk)) spacingCells.set(sk, []);
    spacingCells.get(sk).push([x, z]);
  };
  const clear = (x, z) => {
    if (hf.isWater(x, z) || hf.signedCoastDistance(x, z) < 12 || nearRail(x, z)) return false;
    const nearest = roads.nearestRoad(x, z, 48);
    if (nearest && nearest.dist < nearest.road.width * 0.5 + 4) return false;
    if (city.hash.query(x, z, 10).some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2.5)) return false;
    if (isNearTree(x, z)) return false;
    const h = hf.heightAt(x, z);
    if (Math.abs(hf.heightAt(x + 10, z) - h) > 9 || Math.abs(hf.heightAt(x, z + 10) - h) > 9) return false;
    return true;
  };

  // The refreshed map currently supplies residential/informal polygons.
  // Trees are planted only in residential land, never in informal areas.
  let planted = 0;
  for (const area of data.landuse || []) {
    if (area.u !== 'residential' || !Array.isArray(area.p) || area.p.length < 4 || planted >= MAX_TREES) continue;
    const ring = area.p.map(([lon, lat]) => toXZ(lon, lat));
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    if (maxX - minX < 20 || maxZ - minZ < 20) continue;
    const desired = Math.min(14, Math.max(1, Math.round((area.a || 12000) / 18000)));
    let added = 0;
    for (let attempt = 0; attempt < desired * 18 && added < desired && planted < MAX_TREES; attempt++) {
      const x = minX + rng() * (maxX - minX);
      const z = minZ + rng() * (maxZ - minZ);
      if (!pointInRing(x, z, ring) || !clear(x, z)) continue;
      const type = rng() < 0.58 ? 0 : 1;
      add(type, x, z, TREE_MODELS[type].height * (0.82 + rng() * 0.34));
      added++;
      planted++;
    }
  }

  // A small palm line follows the real coastline, on the landward side only.
  const stride = Math.max(1, Math.floor((coastXZ?.length || 1) / 55));
  for (let i = 8; i < (coastXZ?.length || 0) - 8 && planted < MAX_TREES; i += stride) {
    const p = coastXZ[i], a = coastXZ[i - 4], b = coastXZ[i + 4];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const length = Math.hypot(tx, tz) || 1;
    tx /= length; tz /= length;
    const nx = -tz, nz = tx;
    let candidate = null;
    for (const sign of [1, -1]) {
      const x = p[0] + nx * sign * 78;
      const z = p[1] + nz * sign * 78;
      if (!hf.isWater(x, z) && hf.signedCoastDistance(x, z) > 20) {
        candidate = [x, z];
        break;
      }
    }
    if (!candidate || !clear(candidate[0], candidate[1])) continue;
    add(2, candidate[0], candidate[1], TREE_MODELS[2].height * (0.9 + rng() * 0.22));
    planted++;
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const chunk of placements.values()) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = `vegetation-${chunk.cx}-${chunk.cz}`;
    chunkGroup.userData.centerX = (chunk.cx + 0.5) * CHUNK_SIZE;
    chunkGroup.userData.centerZ = (chunk.cz + 0.5) * CHUNK_SIZE;
    for (let type = 0; type < loaded.length; type++) {
      const items = chunk.items[type];
      if (!items.length || !loaded[type].length) continue;
      for (const part of loaded[type]) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        for (let i = 0; i < items.length; i++) {
          const tree = items[i];
          position.set(tree.x, tree.y, tree.z);
          quaternion.setFromAxisAngle(up, tree.yaw);
          scale.setScalar(tree.height);
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

  group.userData.treeCount = planted;
  function update(x, z) {
    for (const chunk of chunkGroups) {
      const dx = chunk.userData.centerX - x;
      const dz = chunk.userData.centerZ - z;
      chunk.visible = dx * dx + dz * dz < 780 * 780;
    }
  }
  return { group, update, treeCount: planted };
}
