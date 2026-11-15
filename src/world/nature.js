import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toXZ } from '../core/geo.js';

const CHUNK_SIZE = 500;
const MAX_VEGETATION = 7000;
const VEGETATION_MODELS = [
  { file: 'tree_default.glb', height: 6.2 },
  { file: 'tree_plateau.glb', height: 7.2 },
  { file: 'tree_palm.glb', height: 9.2 },
  { file: 'plant_bush.glb', height: 1.8 },
  { file: 'grass.glb', height: 0.62 },
  { file: 'crops_bambooStageB.glb', height: 2.4 },
  { file: 'rock_largeA.glb', height: 1.8 },
  { file: 'flower_yellowA.glb', height: 0.62 },
  { file: 'grass_large.glb', height: 0.88 }
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

export async function buildNature(data, roads, city, hf, coastXZ, rng) {
  const group = new THREE.Group();
  group.name = 'durban-natural-vegetation';
  const loader = new GLTFLoader();
  const nearRail = buildRailIndex(roads.rail);
  const loaded = await Promise.all(VEGETATION_MODELS.map(async (entry) => {
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
  const isNearVegetation = (x, z, spacing) => {
    const cx = Math.floor(x / 14), cz = Math.floor(z / 14);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = spacingCells.get(`${cx + dx},${cz + dz}`) || [];
        if (list.some((p) => Math.hypot(p[0] - x, p[1] - z) < spacing)) return true;
      }
    }
    return false;
  };
  const add = (type, x, z, height, spacing = 13, yaw = null) => {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!placements.has(key)) placements.set(key, { cx, cz, items: VEGETATION_MODELS.map(() => []) });
    placements.get(key).items[type].push({
      x, z, y: hf.heightAt(x, z),
      yaw: yaw === null ? rng() * Math.PI * 2 : yaw,
      height
    });
    const sk = `${Math.floor(x / 14)},${Math.floor(z / 14)}`;
    if (!spacingCells.has(sk)) spacingCells.set(sk, []);
    spacingCells.get(sk).push([x, z]);
  };
  const clear = (x, z, spacing = 13) => {
    if (hf.isWater(x, z) || hf.signedCoastDistance(x, z) < 12 || nearRail(x, z)) return false;
    const nearest = roads.nearestRoad(x, z, 48);
    if (nearest && nearest.dist < nearest.road.width * 0.5 + 4) return false;
    if (city.hash.query(x, z, 10).some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 2.5)) return false;
    if (isNearVegetation(x, z, spacing)) return false;
    const h = hf.heightAt(x, z);
    if (Math.abs(hf.heightAt(x + 10, z) - h) > 11 || Math.abs(hf.heightAt(x, z + 10) - h) > 11) return false;
    return true;
  };

  // Land-cover categories come from the refreshed OpenStreetMap place/landuse query.
  const rules = {
    residential: { types: [0, 1], density: 22000, max: 12, spacing: 13, min: 1 },
    forest: { types: [0, 1, 3], density: 1200, max: 200, spacing: 7, min: 12 },
    wood: { types: [0, 1, 3], density: 1200, max: 200, spacing: 7, min: 12 },
    park: { types: [0, 1, 3, 7], density: 4000, max: 60, spacing: 8, min: 4 },
    nature_reserve: { types: [0, 1, 3], density: 2500, max: 120, spacing: 7, min: 8 },
    garden: { types: [0, 3, 7], density: 5000, max: 35, spacing: 8, min: 3 },
    golf_course: { types: [0, 1, 3], density: 7000, max: 45, spacing: 10, min: 4 },
    scrub: { types: [3, 6], density: 1000, max: 100, spacing: 5, min: 5 },
    heath: { types: [3, 6], density: 1000, max: 100, spacing: 5, min: 5 },
    grassland: { types: [4, 8, 7], density: 500, max: 250, spacing: 2.6, min: 8 },
    meadow: { types: [4, 8, 7], density: 500, max: 250, spacing: 2.6, min: 8 },
    grass: { types: [4, 8], density: 500, max: 250, spacing: 2.6, min: 8 },
    farmland: { types: [5], density: 140, max: 500, spacing: 2.8, min: 12 },
    orchard: { types: [0, 1], density: 1800, max: 160, spacing: 8, min: 6 },
    vineyard: { types: [5], density: 180, max: 400, spacing: 2.8, min: 12 },
    bare_rock: { types: [6], density: 1000, max: 80, spacing: 8, min: 6 }
  };

  let planted = 0;
  for (const area of data.landuse || []) {
    const rule = rules[area.u];
    if (!rule || !Array.isArray(area.p) || area.p.length < 4 || planted >= MAX_VEGETATION) continue;
    const ring = area.p.map(([lon, lat]) => toXZ(lon, lat));
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    if (maxX - minX < 12 || maxZ - minZ < 12) continue;
    const desired = Math.min(rule.max, Math.max(rule.min, Math.round((area.a || 12000) / rule.density)));
    let added = 0;
    for (let attempt = 0; attempt < desired * 18 && added < desired && planted < MAX_VEGETATION; attempt++) {
      const x = minX + rng() * (maxX - minX);
      const z = minZ + rng() * (maxZ - minZ);
      if (!pointInRing(x, z, ring) || !clear(x, z, rule.spacing)) continue;
      const type = rule.types[Math.floor(rng() * rule.types.length)];
      const height = VEGETATION_MODELS[type].height * (0.82 + rng() * 0.34);
      add(type, x, z, height, rule.spacing, type === 5 ? 0 : null);
      added++;
      planted++;
    }
  }

  // A small palm line follows the real coastline, on the landward side only.
  const stride = Math.max(1, Math.floor((coastXZ?.length || 1) / 55));
  for (let i = 8; i < (coastXZ?.length || 0) - 8 && planted < MAX_VEGETATION; i += stride) {
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
    if (!candidate || !clear(candidate[0], candidate[1], 13)) continue;
    add(2, candidate[0], candidate[1], VEGETATION_MODELS[2].height * (0.9 + rng() * 0.22));
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
          const item = items[i];
          position.set(item.x, item.y, item.z);
          quaternion.setFromAxisAngle(up, item.yaw);
          scale.setScalar(item.height);
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

  group.userData.vegetationCount = planted;
  function update(x, z) {
    for (const chunk of chunkGroups) {
      const dx = chunk.userData.centerX - x;
      const dz = chunk.userData.centerZ - z;
      chunk.visible = dx * dx + dz * dz < 780 * 780;
    }
  }
  return { group, update, vegetationCount: planted, treeCount: planted };
}
