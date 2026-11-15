import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toXZ } from '../core/geo.js';

const CHUNK_SIZE = 500;
const MAX_CONTAINERS = 260;

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const crosses = (a[1] > z) !== (b[1] > z);
    if (crosses && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function prepareInstanced(scene) {
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

function prepareShip(scene, targetLength) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const longAxis = size.x >= size.z ? 'x' : 'z';
  const sourceLength = Math.max(0.001, longAxis === 'x' ? size.x : size.z);
  const factor = targetLength / sourceLength;
  const clone = scene.clone(true);
  clone.scale.setScalar(factor);
  if (longAxis === 'x') clone.rotation.y = -Math.PI / 2;
  clone.position.set(0, 0, 0);
  clone.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(clone);
  const normalizedCenter = normalizedBounds.getCenter(new THREE.Vector3());
  clone.position.set(-normalizedCenter.x, -normalizedBounds.min.y, -normalizedCenter.z);
  const pivot = new THREE.Group();
  pivot.add(clone);
  return pivot;
}

function polygonCenter(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

function polygonDirection(ring) {
  let best = 0, dirX = 0, dirZ = 1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length = dx * dx + dz * dz;
    if (length > best) { best = length; const l = Math.sqrt(length) || 1; dirX = dx / l; dirZ = dz / l; }
  }
  return { dirX, dirZ };
}

function findWaterPoint(center, hf, direction, waterRings) {
  let best = null;
  for (let radius = 80; radius <= 1000; radius += 40) {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.16) {
      const x = center[0] + Math.cos(angle) * radius;
      const z = center[1] + Math.sin(angle) * radius;
      if (!hf.isWater(x, z) || hf.signedCoastDistance(x, z) > -1) continue;
      if (waterRings.length && !waterRings.some((ring) => pointInRing(x, z, ring))) continue;
      const bowX = x + direction.dirX * 55, bowZ = z + direction.dirZ * 55;
      const sternX = x - direction.dirX * 55, sternZ = z - direction.dirZ * 55;
      if (!hf.isWater(bowX, bowZ) || !hf.isWater(sternX, sternZ)) continue;
      if (waterRings.length && (!waterRings.some((ring) => pointInRing(bowX, bowZ, ring)) ||
          !waterRings.some((ring) => pointInRing(sternX, sternZ, ring)))) continue;
      if (!best || radius < best.radius) best = { x, z, radius };
    }
    if (best && best.radius <= radius) break;
  }
  return best;
}

export async function buildHarbour(data, roads, city, hf, rng) {
  const group = new THREE.Group();
  group.name = 'durban-harbour';
  const portAreas = (data.landuse || []).filter((area) => area.u === 'port' && Array.isArray(area.p) && area.p.length >= 4);
  if (!portAreas.length) return { group, update() {}, counts: { ships: 0, tugs: 0, containers: 0 } };

  const loader = new GLTFLoader();
  let shipTemplate, tugTemplate, containers;
  try {
    const [ship, tug, a, b, c] = await Promise.all([
      loader.loadAsync('./src/assets/harbourkit/ship-cargo-a.glb'),
      loader.loadAsync('./src/assets/harbourkit/boat-tug-a.glb'),
      loader.loadAsync('./src/assets/harbourkit/cargo-container-a.glb'),
      loader.loadAsync('./src/assets/harbourkit/cargo-container-b.glb'),
      loader.loadAsync('./src/assets/harbourkit/cargo-container-c.glb')
    ]);
    shipTemplate = ship.scene;
    tugTemplate = tug.scene;
    containers = [a, b, c].map((gltf) => prepareInstanced(gltf.scene));
  } catch (error) {
    console.warn('Durban harbour models could not be loaded:', error);
    return { group, update() {}, counts: { ships: 0, tugs: 0, containers: 0 } };
  }

  const waterRings = (data.landuse || []).filter((area) => area.u === 'water' || area.u === 'riverbank')
    .filter((area) => Array.isArray(area.p) && area.p.length >= 4)
    .map((area) => area.p.map(([lon, lat]) => toXZ(lon, lat)));

  const containerChunks = new Map();
  const occupied = new Map();
  const addContainer = (type, x, z, y, yaw) => {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    if (!containerChunks.has(key)) containerChunks.set(key, { cx, cz, items: [[], [], []] });
    containerChunks.get(key).items[type].push({ x, y, z, yaw, stackScale: containers[type].longAxis === 'x' ? [12.2, 2.6, 2.45] : [2.45, 2.6, 12.2] });
    const sk = `${Math.floor(x / 14)},${Math.floor(z / 14)}`;
    if (!occupied.has(sk)) occupied.set(sk, []);
    occupied.get(sk).push([x, z]);
  };
  const nearContainer = (x, z) => {
    const cx = Math.floor(x / 14), cz = Math.floor(z / 14);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = occupied.get(`${cx + dx},${cz + dz}`) || [];
      if (list.some((p) => Math.hypot(p[0] - x, p[1] - z) < 13)) return true;
    }
    return false;
  };

  let containerCount = 0;
  const ships = [];
  let tugCount = 0;
  for (const area of portAreas.slice(0, 3)) {
    const ring = area.p.map(([lon, lat]) => toXZ(lon, lat));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const desired = Math.min(150, Math.max(10, Math.round((area.a || 30000) / 2800)));
    let placed = 0;
    for (let attempt = 0; attempt < desired * 24 && placed < desired && containerCount < MAX_CONTAINERS; attempt++) {
      const x = minX + rng() * (maxX - minX);
      const z = minZ + rng() * (maxZ - minZ);
      if (!pointInRing(x, z, ring) || hf.isWater(x, z) || nearContainer(x, z)) continue;
      const nearest = roads.nearestRoad(x, z, 60);
      if (nearest && nearest.dist < nearest.road.width * 0.5 + 3) continue;
      if (city.hash.query(x, z, 12).some((building) => Math.hypot(building.x - x, building.z - z) < building.r + 3)) continue;
      const type = Math.floor(rng() * containers.length);
      const yaw = rng() < 0.5 ? 0 : Math.PI / 2;
      const y = hf.heightAt(x, z);
      addContainer(type, x, z, y, yaw);
      containerCount++;
      if (rng() < 0.28 && containerCount < MAX_CONTAINERS) {
        addContainer(type, x, z, y + 2.65, yaw);
        containerCount++;
      }
      placed++;
    }

    const center = polygonCenter(ring);
    const direction = polygonDirection(ring);
    const water = findWaterPoint(center, hf, direction, waterRings);
    if (water && ships.length < 2) {
      const yaw = Math.atan2(direction.dirX, direction.dirZ);
      const shipGroup = prepareShip(shipTemplate, 130);
      shipGroup.position.set(water.x, -0.75, water.z);
      shipGroup.rotation.y = yaw;
      group.add(shipGroup);
      ships.push(shipGroup);

      const sideX = -direction.dirZ, sideZ = direction.dirX;
      for (const sign of [-1, 1]) {
        const tx = water.x + sideX * sign * 26;
        const tz = water.z + sideZ * sign * 26;
        if (!hf.isWater(tx, tz)) continue;
        const tug = prepareShip(tugTemplate, 19);
        tug.position.set(tx, -0.48, tz);
        tug.rotation.y = yaw + (sign * 0.12);
        group.add(tug);
        ships.push(tug);
        tugCount++;
      }
    }
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const containerGroups = [];
  for (const chunk of containerChunks.values()) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = `harbour-containers-${chunk.cx}-${chunk.cz}`;
    chunkGroup.userData.centerX = (chunk.cx + 0.5) * CHUNK_SIZE;
    chunkGroup.userData.centerZ = (chunk.cz + 0.5) * CHUNK_SIZE;
    for (let type = 0; type < containers.length; type++) {
      const items = chunk.items[type];
      if (!items.length) continue;
      for (const part of containers[type].parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.frustumCulled = true;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          position.set(item.x, item.y, item.z);
          quaternion.setFromAxisAngle(up, item.yaw);
          scale.set(item.stackScale[0], item.stackScale[1], item.stackScale[2]);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(i, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        chunkGroup.add(mesh);
      }
    }
    group.add(chunkGroup);
    containerGroups.push(chunkGroup);
  }

  const shipGroups = ships;
  group.userData.counts = { ships: shipGroups.length - tugCount, tugs: tugCount, containers: containerCount };
  function update(x, z) {
    for (const chunk of containerGroups) {
      const dx = chunk.userData.centerX - x, dz = chunk.userData.centerZ - z;
      chunk.visible = dx * dx + dz * dz < 1400 * 1400;
    }
    for (const ship of shipGroups) {
      const dx = ship.position.x - x, dz = ship.position.z - z;
      ship.visible = dx * dx + dz * dz < 6000 * 6000;
    }
  }
  return { group, update, counts: group.userData.counts };
}
