import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { clamp } from '../core/utils.js';

const SAND = new THREE.Color('#e6d3a3');
const SAND_WET = new THREE.Color('#cbb98d');
const GRASS = new THREE.Color('#6f9b52');
const GRASS_DRY = new THREE.Color('#9aa85c');
const DIRT = new THREE.Color('#8a7355');
const ROCK = new THREE.Color('#9a938a');
const SEABED = new THREE.Color('#5d7f8c');

function loadSurfaceTexture(file) {
  const texture = new THREE.TextureLoader().load(`./src/assets/textures/${file}`);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Terrain mesh built straight from the OSM coastline height field.
export function buildTerrain(hf, coastXZ, step = 2) {
  const group = new THREE.Group();
  group.name = 'terrain';

  const cell = hf.cell * step;
  const cols = Math.floor((hf.cols - 1) / step) + 1;
  const rows = Math.floor((hf.rows - 1) / step) + 1;

  const positions = [];
  const uvs = [];
  const indicesBySurface = [[], [], [], [], []];

  const heightAt = (ix, iz) => hf.height[hf.idx(Math.min(ix, hf.cols - 1), Math.min(iz, hf.rows - 1))];
  const waterAt = (ix, iz) => hf.water[hf.idx(Math.min(ix, hf.cols - 1), Math.min(iz, hf.rows - 1))];

  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const gx = ix * step;
      const gz = iz * step;
      const x = hf.minX + gx * hf.cell;
      const z = hf.minZ + gz * hf.cell;
      const h = heightAt(gx, gz);
      const d = hf.signedCoastDistance(x, z);
      const water = waterAt(gx, gz);
      positions.push(x, h, z);
      uvs.push(x / 32, z / 32);
    }
  }

  const at = (ix, iz) => iz * cols + ix;
  for (let iz = 0; iz < rows - 1; iz++) {
    for (let ix = 0; ix < cols - 1; ix++) {
      const a = at(ix, iz);
      const b = at(ix + 1, iz);
      const c = at(ix + 1, iz + 1);
      const d = at(ix, iz + 1);
      const allWater = waterAt(ix * step, iz * step) && waterAt((ix + 1) * step, iz * step) &&
        waterAt((ix + 1) * step, (iz + 1) * step) && waterAt(ix * step, (iz + 1) * step);
      if (allWater) continue;
      const hAvg = (
        heightAt(ix * step, iz * step) +
        heightAt((ix + 1) * step, iz * step) +
        heightAt((ix + 1) * step, (iz + 1) * step) +
        heightAt(ix * step, (iz + 1) * step)
      ) * 0.25;
      const dAvg = (
        hf.signedCoastDistance(hf.minX + ix * cell, hf.minZ + iz * cell) +
        hf.signedCoastDistance(hf.minX + (ix + 1) * cell, hf.minZ + iz * cell) +
        hf.signedCoastDistance(hf.minX + (ix + 1) * cell, hf.minZ + (iz + 1) * cell) +
        hf.signedCoastDistance(hf.minX + ix * cell, hf.minZ + (iz + 1) * cell)
      ) * 0.25;
      const surface = dAvg < 45 ? 3 : dAvg < 130 ? 4 : hAvg > 150 ? 2 : hAvg > 55 ? 1 : 0;
      indicesBySurface[surface].push(a, d, b, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const indices = [];
  const groups = [];
  let groupStart = 0;
  for (let materialIndex = 0; materialIndex < indicesBySurface.length; materialIndex++) {
    const surfaceIndices = indicesBySurface[materialIndex];
    if (!surfaceIndices.length) continue;
    groups.push({ start: groupStart, count: surfaceIndices.length, materialIndex });
    indices.push(...surfaceIndices);
    groupStart += surfaceIndices.length;
  }
  geo.setIndex(indices);
  for (const entry of groups) geo.addGroup(entry.start, entry.count, entry.materialIndex);
  geo.computeVertexNormals();

  const materials = [
    'sparse_grass_512.jpg',
    'dry_ground_01_512.jpg',
    'rocky_terrain_02_512.jpg',
    'coast_sand_01_512.jpg',
    'brown_mud_512.jpg'
  ].map((file) => new THREE.MeshLambertMaterial({
    map: loadSurfaceTexture(file),
    side: THREE.DoubleSide
  }));
  const mesh = new THREE.Mesh(geo, materials);
  mesh.name = 'terrainMesh';
  mesh.receiveShadow = false;
  group.add(mesh);

  // Ocean
  const waterNormals = new THREE.TextureLoader().load('./src/assets/textures/waternormals.jpg');
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
  const ocean = new Water(new THREE.PlaneGeometry(400000, 400000), {
    textureWidth: 128,
    textureHeight: 128,
    waterNormals,
    sunDirection: new THREE.Vector3(0.35, 0.85, 0.25).normalize(),
    sunColor: 0xffffff,
    waterColor: 0x126b8c,
    distortionScale: 3.2,
    fog: true
  });
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.35, 0);
  ocean.renderOrder = -1;
  ocean.name = 'ocean';
  group.add(ocean);

  // Beach ribbon hugging the exact OSM coastline.
  const beach = buildBeachRibbon(hf, coastXZ);
  if (beach) group.add(beach);

  // Surf line along the water's edge.
  const surf = buildSurfLine(hf, coastXZ);
  if (surf) group.add(surf);

  return { group, ocean, beach, surf, cell };
}

// Builds a sand strip that follows the coastline, landward edge snapped to the terrain.
function buildBeachRibbon(hf, coastXZ) {
  if (!coastXZ || coastXZ.length < 2) return null;
  const positions = [];
  const colors = [];
  const indices = [];
  const uvs = [];

  const n = coastXZ.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const p = coastXZ[i];
    const a = coastXZ[Math.max(0, i - 1)];
    const b = coastXZ[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    // normal candidates
    const nx = -tz;
    const nz = tx;
    const px = p[0] + nx * 60;
    const pz = p[1] + nz * 60;
    const sea = hf.isWater(px, pz);
    const s = sea ? 1 : -1;
    normals.push([nx * s, nz * s]);
  }

  for (let i = 0; i < n; i++) {
    const [x, z] = coastXZ[i];
    const [nx, nz] = normals[i];
    const outerX = x + nx * 55;
    const outerZ = z + nz * 55;
    const innerX = x - nx * 75;
    const innerZ = z - nz * 75;
    positions.push(outerX, -0.7, outerZ);
    colors.push(0.9, 0.9, 0.9);
    uvs.push(outerX / 18, outerZ / 18);
    positions.push(innerX, Math.max(0.05, hf.heightAt(innerX, innerZ)), innerZ);
    colors.push(1, 1, 1);
    uvs.push(innerX / 18, innerZ / 18);
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: loadSurfaceTexture('coast_sand_01_512.jpg'), vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'beach';
  return mesh;
}

function buildSurfLine(hf, coastXZ) {
  if (!coastXZ || coastXZ.length < 2) return null;
  const positions = [];
  const indices = [];
  const n = coastXZ.length;
  for (let i = 0; i < n; i++) {
    const p = coastXZ[i];
    const a = coastXZ[Math.max(0, i - 1)];
    const b = coastXZ[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    let nx = -tz;
    let nz = tx;
    const s = hf.isWater(p[0] + nx * 60, p[1] + nz * 60) ? 1 : -1;
    nx *= s;
    nz *= s;
    positions.push(p[0] + nx * 12, -0.35, p[1] + nz * 12);
    positions.push(p[0] - nx * 12, -0.35, p[1] - nz * 12);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffffff'),
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'surf';
  mesh.renderOrder = 2;
  return mesh;
}
