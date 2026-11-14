import fs from 'node:fs';
import { toXZ, configurePlaces, districtsWorld } from './src/core/geo.js';
import { mulberry32 } from './src/core/utils.js';
import { Heightfield } from './src/world/heightfield.js';
import { buildTerrain } from './src/world/terrain.js';
import { buildLanduse } from './src/world/landuse.js';
import { RoadNetwork } from './src/world/roads.js';
import { City } from './src/world/city.js';
import { buildLandmarks } from './src/world/landmarks.js';
import { Vehicle } from './src/game/vehicle.js';
import { Player } from './src/game/player.js';
import { Traffic } from './src/game/traffic.js';
import { Pedestrians } from './src/game/pedestrians.js';
import { GPS } from './src/game/gps.js';

const t0 = Date.now();
const data = JSON.parse(fs.readFileSync('./src/data/durban-game.json', 'utf8'));
configurePlaces(data.places);

function extendCoast(coastXZ) {
  const pts = coastXZ.slice();
  const n = pts.length;
  if (n < 2) return pts;
  const reach = 4000;
  const start = pts[0];
  const sNext = pts[1];
  const startDx = start[0] - sNext[0];
  const startDz = start[1] - sNext[1];
  const startLen = Math.hypot(startDx, startDz) || 1;
  pts.unshift([start[0] + (startDx / startLen) * reach, start[1] + (startDz / startLen) * reach]);
  const end = pts[pts.length - 1];
  const ePrev = pts[pts.length - 2];
  const endDx = end[0] - ePrev[0];
  const endDz = end[1] - ePrev[1];
  const endLen = Math.hypot(endDx, endDz) || 1;
  pts.push([end[0] + (endDx / endLen) * reach, end[1] + (endDz / endLen) * reach]);
  return pts;
}

function worldBounds(coastXZ, data) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const add = (x, z) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  for (const [x, z] of coastXZ) add(x, z);
  for (const r of data.roads) for (const p of r.p) add(...toXZ(p[0], p[1]));
  const pad = 700;
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

const coastXZ = extendCoast(data.coast.map(([lon, lat]) => toXZ(lon, lat)));
const bounds = worldBounds(coastXZ, data);
const hf = new Heightfield(coastXZ, bounds, 80);
const terrain = buildTerrain(hf, coastXZ, 2);
const landuse = buildLanduse(hf, data.landuse);
const roads = new RoadNetwork(data, hf);
const districts = districtsWorld(data);
console.log('districts', districts.length, 'roads', roads.roads.length);

const city = new City(hf, roads, mulberry32(20241113));
const startCity = Date.now();
city.build(districts);
console.log('city build ms', Date.now() - startCity, 'colliders', city.colliders.length, 'buildings', city.buildings.length);
console.log('city meshes', city.group.children.length);

const landmarks = buildLandmarks(hf, city);
console.log('landmarks children', landmarks.children.length);

const input = { isDown: () => false, takePressed: () => false };
const vehicle = new Vehicle(hf, roads, city, input);
const player = new Player(hf, city, input, vehicle.x - 3, vehicle.z - 3, 0);
const traffic = new Traffic(roads, hf, mulberry32(99117), vehicle.x, vehicle.z);
const ped = new Pedestrians(hf, city, mulberry32(40421), vehicle.x, vehicle.z);
const gps = new GPS();
gps.next();
for (let i = 0; i < 10; i++) {
  vehicle.update(1 / 60);
  player.update(1 / 60);
  traffic.update(1 / 60, vehicle.x, vehicle.z);
  ped.update(1 / 60, vehicle.x, vehicle.z);
  gps.update(vehicle.x, vehicle.z, vehicle.yaw);
}
console.log('sim ok; vehicle', vehicle.x.toFixed(1), vehicle.z.toFixed(1), 'traffic buckets', traffic.buckets.map((b) => b.length));
console.log('terrain verts', terrain.group.children.length, 'landuse', landuse.children.length);
console.log('total ms', Date.now() - t0);
