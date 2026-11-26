import * as THREE from '../../vendor/three/three.module.js';
import { plateInstanceGeometry, plateInstanceMaterial, hdWheelGeometry, hdWheelMaterial } from './hdCars.js';

// Traffic glue for the HD cars (hdCars.js): near cars draw the full model,
// spinning wheels and number plates; far cars draw the light LOD. Both are
// one InstancedMesh per type, packed every frame (near first), so the GPU
// only ever draws the cars that need it.

export const HD_NEAR = 75; // m: full detail + wheels + plates inside this
const NEAR2 = HD_NEAR * HD_NEAR;

function inst(geo, mat, n, paint) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  if (paint) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (m.instanceColor) m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  return m;
}

// Per type: { hi, lo, always[], plateOff[2], lampAdj, ni, fi }
export function hdTrafficType(model, count, group) {
  const hd = { model, ni: 0, fi: 0, always: [], hi: null, lo: null, near2: NEAR2 };
  for (const part of model.trafficParts) {
    if (part.shadow) {
      const m = inst(part.geometry, part.material, count, false);
      hd.always.push(m);
      group.add(m);
    } else {
      hd.hi = inst(part.geometry, part.material, count, true);
      group.add(hd.hi);
    }
  }
  hd.lo = inst(model.lod.geometry, model.lod.material, count, true);
  group.add(hd.lo);
  const s = model.spec;
  hd.plateOff = model.plateOffsets.map(([x, y, z, yaw]) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z));
  // traffic lamp glow quads are laid out for a 4.5 m car: stretch per type
  const headY = { hatch: 0.68, sedan: 0.62, bakkie: 0.86, police: 0.86, van: 0.92 }[s.kind] || 0.62;
  hd.lampAdj = new THREE.Matrix4().makeScale(s.W / 1.7, headY / 0.62, (s.L + 0.1) / 4.5);
  hd.layout = { track: model.wheels[0], base: model.wheels[1], r: model.wheels[2], mid: model.wheels[3] };
  return hd;
}

let wheelGeo = null;
export function hdTrafficWheels(count) {
  if (!wheelGeo) wheelGeo = hdWheelGeometry(1);
  const wm = inst(wheelGeo, hdWheelMaterial(), count * 4, false);
  return wm;
}

// All traffic plates in one draw call; `plateCell` picks the number per car.
export function hdPlates(max) {
  const geo = plateInstanceGeometry();
  const cell = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  cell.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('plateCell', cell);
  const m = new THREE.InstancedMesh(geo, plateInstanceMaterial(), max);
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  m.name = 'trafficPlates';
  m.userData.cell = cell;
  return m;
}

const _m = new THREE.Matrix4();
// Add the two plates of one car (matrix = the car's world matrix).
export function pushPlates(plates, n, matrix, hd, id) {
  if (n + 2 > plates.instanceMatrix.count) return n;
  const cell = plates.userData.cell.array;
  for (const off of hd.plateOff) {
    _m.multiplyMatrices(matrix, off);
    plates.setMatrixAt(n, _m);
    cell[n] = (id * 7 + 3) % 32;
    n++;
  }
  return n;
}
