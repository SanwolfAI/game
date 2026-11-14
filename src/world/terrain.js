import * as THREE from 'three';
import { clamp } from '../core/utils.js';

const SAND = new THREE.Color('#e6d3a3');
const SAND_WET = new THREE.Color('#cbb98d');
const GRASS = new THREE.Color('#6f9b52');
const GRASS_DRY = new THREE.Color('#9aa85c');
const DIRT = new THREE.Color('#8a7355');
const ROCK = new THREE.Color('#9a938a');
const SEABED = new THREE.Color('#5d7f8c');

// Terrain mesh built straight from the OSM coastline height field.
export function buildTerrain(hf, coastXZ, step = 2) {
  const group = new THREE.Group();
  group.name = 'terrain';

  const cell = hf.cell * step;
  const cols = Math.floor((hf.cols - 1) / step) + 1;
  const rows = Math.floor((hf.rows - 1) / step) + 1;

  const positions = [];
  const colors = [];
  const indices = [];

  const heightAt = (ix, iz) => hf.height[hf.idx(Math.min(ix, hf.cols - 1), Math.min(iz, hf.rows - 1))];
  const waterAt = (ix, iz) => hf.water[hf.idx(Math.min(ix, hf.cols - 1), Math.min(iz, hf.rows - 1))];

  const colorFor = (x, z, h, d, water) => {
    if (water) return SEABED.clone();
    if (d < 70) return SAND.clone();
    if (d < 130) return SAND_WET.clone();
    const n = Math.sin(x * 0.0013) * Math.cos(z * 0.0017) + Math.sin((x + z) * 0.0004) * 0.6;
    if (h > 130) return ROCK.clone().lerp(GRASS_DRY, clamp(0.5 + n * 0.2, 0, 1));
    if (h > 45) return GRASS_DRY.clone().lerp(GRASS, clamp(0.6 + n * 0.3, 0, 1));
    return GRASS.clone().lerp(DIRT, clamp(0.35 + n * 0.35, 0, 1));
  };

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
      const c = colorFor(x, z, h, d, water);
      colors.push(c.r, c.g, c.b);
    }
  }

  const at = (ix, iz) => iz * cols + ix;
  for (let iz = 0; iz < rows - 1; iz++) {
    for (let ix = 0; ix < cols - 1; ix++) {
      const a = at(ix, iz);
      const b = at(ix + 1, iz);
      const c = at(ix + 1, iz + 1);
      const d = at(ix, iz + 1);
      const anyWater = waterAt(ix * step, iz * step) || waterAt((ix + 1) * step, iz * step) ||
        waterAt((ix + 1) * step, (iz + 1) * step) || waterAt(ix * step, (iz + 1) * step);
      const allWater = waterAt(ix * step, iz * step) && waterAt((ix + 1) * step, iz * step) &&
        waterAt((ix + 1) * step, (iz + 1) * step) && waterAt(ix * step, (iz + 1) * step);
      if (allWater) continue;
      indices.push(a, d, b, b, d, c);
      void anyWater;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrainMesh';
  mesh.receiveShadow = false;
  group.add(mesh);

  // Ocean
  const oceanGeo = new THREE.PlaneGeometry(400000, 400000, 1, 1);
  const oceanMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#1d6f9e') });
  const ocean = new THREE.Mesh(oceanGeo, oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.55, 0);
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
    colors.push(0.79, 0.72, 0.55);
    positions.push(innerX, Math.max(0.05, hf.heightAt(innerX, innerZ)), innerZ);
    colors.push(0.9, 0.83, 0.64);
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
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
