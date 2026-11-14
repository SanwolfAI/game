import * as THREE from 'three';
import { toXZ } from './core/geo.js';
import { Heightfield } from './world/heightfield.js';
import { buildTerrain } from './world/terrain.js';
import { RoadNetwork } from './world/roads.js';
import { Player } from './game/player.js';
import { Input } from './game/input.js';
import { createMinimap } from './ui/minimap.js';

const $ = (id) => document.getElementById(id);
const load = (p, label) => { $('load-fill').style.width = p + '%'; $('load-status').textContent = label; };
function boundsFor(data, coast) {
  const pts = [...coast];
  for (const road of data.roads || []) for (const p of road.p || []) pts.push(toXZ(p[0], p[1]));
  if (!pts.length) throw new Error('No road or coastline geometry found in the offline map data.');
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  return { minX: Math.min(...xs)-500, maxX: Math.max(...xs)+500, minZ: Math.min(...zs)-500, maxZ: Math.max(...zs)+500 };
}
async function main() {
  load(8, 'Loading offline Durban road data…');
  const response = await fetch('./src/data/durban-game.json');
  if (!response.ok) throw new Error('Durban map data missing. Build the 12 offline OSM road chunks first.');
  const data = await response.json();
  if (!Array.isArray(data.roads) || data.roads.length === 0) throw new Error('Durban road data is empty. No placeholder roads will be generated.');
  const coast = (data.coast || []).map(([lon,lat]) => toXZ(lon,lat));
  const bounds = boundsFor(data, coast);
  load(24, 'Building Durban terrain and coastline…');
  await new Promise(requestAnimationFrame);
  const hf = new Heightfield(coast, bounds, 80);
  const terrain = buildTerrain(hf, coast, 3);
  load(52, 'Building road surfaces…');
  await new Promise(requestAnimationFrame);
  const roads = new RoadNetwork(data, hf);
  const spawn = roads.nearestRoad(0, 0, 10000) || roads.nearestRoad(0, 0, 100000);
  if (!spawn) throw new Error('No usable road found for player spawn.');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc6e2);
  scene.fog = new THREE.Fog(0x9fc6e2, 650, 4200);
  scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x536047, 1.8));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.0);
  sun.position.set(-300, 700, 250);
  scene.add(sun);
  scene.add(terrain.group);
  scene.add(roads.group);

  const input = new Input();
  const player = new Player(hf, roads, input, spawn.x, spawn.z, Math.atan2(spawn.dirX, spawn.dirZ));
  scene.add(player.group);
  const camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.2, 9000);
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  $('app').appendChild(renderer.domElement);
  const minimap = createMinimap(hf, roads);
  const roadLabel = $('road-label');
  const attribution = $('osm-attribution');
  attribution.textContent = '© OpenStreetMap contributors';
  let lastRoad = '';
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.04);
    player.update(dt);
    const ground = hf.heightAt(player.x, player.z);
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    camera.position.set(player.x - fx*8, ground+5.2, player.z - fz*8);
    camera.lookAt(player.x+fx*2, ground+1.2, player.z+fz*2);
    const nearest = roads.nearestRoad(player.x, player.z, 35);
    const name = nearest?.road?.name || '';
    roadLabel.textContent = name ? 'You are on: ' + name : 'Off road';
    if (name && name !== lastRoad) lastRoad = name;
    minimap.update(player.x, player.z, player.yaw, null);
    $('speed-val').textContent = String(Math.round(player.speedKmh));
    renderer.render(scene, camera);
  }
  addEventListener('resize', () => {
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  load(100, 'Road world ready');
  $('loading').classList.add('done');
  frame();
}
main().catch(error => {
  console.error(error);
  load(100, 'Phase 1 data unavailable: ' + error.message);
  $('load-fill').style.background = '#ff6b57';
});
