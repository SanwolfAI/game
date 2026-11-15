import * as THREE from 'three';
import { toXZ, districtsWorld, configurePlaces } from './core/geo.js';
import { mulberry32 } from './core/utils.js';
import { durbanNow, seasonForDate, solarState } from './core/time.js';
import { Heightfield, loadDurbanDEM } from './world/heightfield.js';
import { buildTerrain } from './world/terrain.js';
import { buildLanduse } from './world/landuse.js';
import { buildNature } from './world/nature.js';
import { RoadNetwork } from './world/roads.js';
import { Roadside } from './world/roadside.js';
import { buildRoadProps } from './world/roadProps.js';
import { City } from './world/city.js';
import { buildLandmarks } from './world/landmarks.js';
import { Vehicle } from './game/vehicle.js';
import { loadDownloadedVehicles, applyVehicleEnvironment } from './game/sketchfabModels.js';
import { Player } from './game/player.js';
import { Traffic } from './game/traffic.js';
import { Pedestrians } from './game/pedestrians.js';
import { Input } from './game/input.js';
import { honk, unlockAudio } from './game/audio.js';
import { HUD } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { GPS } from './game/gps.js';

const SKY_NIGHT = new THREE.Color(0x060b18);
const SKY_DUSK = new THREE.Color(0xd97a4d);
const MOON_COLOR = new THREE.Color(0x9db4ff);

const loadFill = document.getElementById('load-fill');
const loadStatus = document.getElementById('load-status');

function setLoad(pct, text) {
  loadFill.style.width = `${pct}%`;
  if (text) loadStatus.textContent = text;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function worldBounds(coastXZ, data) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const add = (x, z) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  for (const [x, z] of coastXZ) add(x, z);
  for (const r of data.roads) for (const p of r.p) add(...toXZ(p[0], p[1]));
  for (const b of data.beaches || []) for (const p of b.p) add(...toXZ(p[0], p[1]));
  for (const r of data.rail || []) for (const p of r.p) add(...toXZ(p[0], p[1]));
  const pad = 700;
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

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

function buildStars() {
  const count = 900;
  const positions = new Float32Array(count * 3);
  const rng = mulberry32(77);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const y = 0.06 + rng() * 0.94;
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(a) * r * 7000;
    positions[i * 3 + 1] = y * 7000;
    positions[i * 3 + 2] = Math.sin(a) * r * 7000;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xdfe8ff,
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'stars';
  points.frustumCulled = false;
  points.renderOrder = -3;
  return points;
}

async function main() {
  setLoad(6, 'Loading OpenStreetMap data…');
  const res = await fetch('./src/data/durban-game.json');
  if (!res.ok) throw new Error(`Could not load map data (HTTP ${res.status})`);
  const data = await res.json();
  configurePlaces(data.places);
  setLoad(18, 'Projecting coastline…');
  await nextFrame();

  const coastXZ = extendCoast(data.coast.map(([lon, lat]) => toXZ(lon, lat)));
  const bounds = worldBounds(coastXZ, data);

  setLoad(26, 'Loading real Durban elevation…');
  await nextFrame();
  let dem = null;
  try {
    dem = await loadDurbanDEM();
  } catch (error) {
    console.warn('Real Durban DEM unavailable; using fallback terrain:', error);
  }
  const hf = new Heightfield(coastXZ, bounds, 80, dem);

  setLoad(40, 'Paving the ground…');
  await nextFrame();
  const terrain = buildTerrain(hf, coastXZ, 2);
  const landuse = buildLanduse(hf, data.landuse);

  const mappedBridgeCount = data.roads.reduce((count, road) => count + (road.b ? 1 : 0), 0);
  setLoad(58, `Paving ${data.roads.length.toLocaleString()} roads and building ${mappedBridgeCount.toLocaleString()} bridges…`);
  await nextFrame();
  const roads = new RoadNetwork(data, hf);
  setLoad(62, 'Placing streetlights and bridge barriers…');
  await nextFrame();
  const roadProps = await buildRoadProps(roads, hf);
  const roadside = new Roadside(data, roads, hf);

  setLoad(72, 'Raising the city…');
  await nextFrame();
  const city = new City(hf, roads, mulberry32(20241113));
  const cityGroup = city.build(districtsWorld(data));

  setLoad(78, 'Planting Durban trees and palms…');
  await nextFrame();
  const nature = await buildNature(data, roads, city, hf, coastXZ, mulberry32(15112026));

  setLoad(84, 'Building Durban landmarks…');
  await nextFrame();
  const landmarks = buildLandmarks(hf, city);

  setLoad(88, 'Loading downloaded 3D vehicles…');
  await loadDownloadedVehicles();
  setLoad(90, 'Warming up the engine…');
  await nextFrame();

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyDay = new THREE.Color(0x9fc6e2);
  scene.background = skyDay.clone();
  scene.fog = new THREE.Fog(0x9fc6e2, 750, 5200);

  applyVehicleEnvironment(renderer, scene);

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 16000);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x4b5a42, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0cf, 2.4);
  scene.add(sun);
  const moon = new THREE.DirectionalLight(MOON_COLOR, 0);
  scene.add(moon);
  const fill = new THREE.DirectionalLight(0x9bb8d6, 0.5);
  fill.position.set(-0.5, 0.6, -0.4).multiplyScalar(800);
  scene.add(fill);

  const stars = buildStars();
  scene.add(stars);
  const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(120, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xe8edff, fog: false })
  );
  moonDisc.renderOrder = -2;
  scene.add(moonDisc);

  scene.add(terrain.group);
  scene.add(landuse);
  scene.add(roads.group);
  scene.add(roadside.group);
  scene.add(roadProps.group);
  scene.add(cityGroup);
  scene.add(landmarks);
  scene.add(nature.group);

  const input = new Input();
  const vehicle = new Vehicle(hf, roads, city, input, 'gusheshe-3d');
  scene.add(vehicle.group);

  const [vx, vz] = vehicle.forward;
  const player = new Player(hf, roads, input, vehicle.x - vx * 3.4, vehicle.z - vz * 3.4, vehicle.yaw);
  scene.add(player.group);

  const traffic = new Traffic(roads, hf, mulberry32(99117), vehicle.x, vehicle.z);
  scene.add(traffic.group);

  const pedestrians = new Pedestrians(hf, city, mulberry32(40421), vehicle.x, vehicle.z);
  scene.add(pedestrians.group);

  const hud = new HUD();
  const minimap = createMinimap(hf, roads);
  const gps = new GPS();

  let inVehicle = true;
  let camMode = 0;
  let cameraReady = false;
  let camSnap = true;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();

  // Five selectable views, tuned around the Polo Vivo test car.
  // Local coordinates use +Z as forward and +X as the driver's (right) side.
  const CAM_MODES = [
    { name: 'Close chase', kind: 'chase', back: 9.5, height: 3.9, ahead: 7, look: 1.5 },
    { name: 'High chase', kind: 'chase', back: 18, height: 8.5, ahead: 12, look: 1.2 },
    { name: 'Bonnet', kind: 'bonnet', forward: 1.25, height: 1.65, ahead: 22, look: 1.25 },
    { name: 'Front view', kind: 'front', forward: 8.5, height: 3.1, look: 1.2 },
    { name: 'Side view', kind: 'side', right: 7.5, height: 3.2, ahead: 2.5, look: 1.2 }
  ];

  let newRoadTimer = 0;
  let lastRoad = '';
  let roadToastCooldown = 0;

  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const daySky = new THREE.Color();
  const fogColor = new THREE.Color();
  const sunColor = new THREE.Color();
  const hemiSky = new THREE.Color();
  const hemiGround = new THREE.Color();

  function entity() {
    return inVehicle ? vehicle : player;
  }

  function blocked(x, z) {
    if (hf.signedCoastDistance(x, z) < 1.5) return true;
    for (const c of city.hash.query(x, z, 2)) {
      if (Math.hypot(c.x - x, c.z - z) < c.r + 0.6) return true;
    }
    return false;
  }

  function exitVehicle() {
    const rx = Math.cos(vehicle.yaw);
    const rz = -Math.sin(vehicle.yaw);
    let ex = vehicle.x + rx * 3.6;
    let ez = vehicle.z + rz * 3.6;
    let ok = !blocked(ex, ez);
    if (!ok) {
      ex = vehicle.x - rx * 3.6;
      ez = vehicle.z - rz * 3.6;
      ok = !blocked(ex, ez);
    }
    if (!ok) {
      hud.toast('No room to get out here', 1.6);
      return;
    }
    player.placeAt(ex, ez, vehicle.yaw + Math.PI / 2);
    player.group.visible = true;
    vehicle.speed = 0;
    vehicle.lateral = 0;
    inVehicle = false;
    camSnap = true;
    hud.toast('On foot — F to get back in', 2.2);
  }

  function enterVehicle() {
    const d = Math.hypot(player.x - vehicle.x, player.z - vehicle.z);
    if (d > 6.5) {
      hud.toast('Walk closer to the vehicle', 1.4);
      return;
    }
    inVehicle = true;
    player.group.visible = false;
    camSnap = true;
    hud.toast(vehicle.typeName, 1.6);
  }

  function updateEnvironment(now) {
    const season = seasonForDate(now);
    const solar = solarState(now);

    daySky.setHex(season.sky);
    sunDir.set(solar.dir[0], solar.dir[1], solar.dir[2]);
    if (sunDir.lengthSq() < 1e-6) sunDir.set(0, 1, 0);
    sunDir.normalize();
    moonDir.copy(sunDir).multiplyScalar(-1);
    if (moonDir.y < 0.08) {
      moonDir.y = 0.16;
      moonDir.normalize();
    }

    sun.position.copy(sunDir).multiplyScalar(1800);
    sun.intensity = solar.day * (2.3 + (season.id === 'winter' ? 0.5 : 0.2));
    sunColor.setHex(season.sun);
    sunColor.lerp(new THREE.Color(0xff8d4d), solar.golden * 0.7);
    sun.color.copy(sunColor);

    moon.position.copy(moonDir).multiplyScalar(1800);
    moon.intensity = solar.night * 0.42;
    moon.color.copy(MOON_COLOR);

    const sky = SKY_NIGHT.clone().lerp(daySky, solar.day);
    sky.lerp(SKY_DUSK, solar.golden * 0.55);
    scene.background.copy(sky);

    fogColor.copy(sky).lerp(daySky, 0.18);
    scene.fog.color.copy(fogColor);
    scene.fog.near = 750 - solar.night * 320;
    scene.fog.far = 5200 - solar.night * 2300;

    hemi.intensity = 0.3 + solar.day * 1.35;
    hemiSky.copy(sky).lerp(daySky, 0.4);
    hemiGround.setHex(season.ground);
    hemi.color.copy(hemiSky);
    hemi.groundColor.copy(hemiGround);

    fill.intensity = 0.15 + solar.day * 0.35;
    renderer.toneMappingExposure = 0.82 + solar.day * 0.3;

    stars.material.opacity = solar.night * 0.95;
    stars.position.copy(camera.position);
    moonDisc.visible = solar.night > 0.05;
    moonDisc.position.copy(camera.position).addScaledVector(moonDir, 7000);

    return { season, solar };
  }

  function updateCamera(dt, snap) {
    const ent = entity();
    const mode = CAM_MODES[camMode];
    const [fx, fz] = ent.forward;
    const rx = fz;
    const rz = -fx;
    const ground = inVehicle ? vehicle.group.position.y : hf.heightAt(ent.x, ent.z);

    if (!inVehicle) {
      desiredPos.set(ent.x - fx * 5.6, ground + 2.5, ent.z - fz * 5.6);
      desiredLook.set(ent.x + fx * 2.5, ground + 1.35, ent.z + fz * 2.5);
    } else if (mode.kind === 'front') {
      desiredPos.set(ent.x + fx * mode.forward, ground + mode.height, ent.z + fz * mode.forward);
      desiredLook.set(ent.x - fx * 2.2, ground + mode.look, ent.z - fz * 2.2);
    } else if (mode.kind === 'bonnet') {
      desiredPos.set(ent.x + fx * mode.forward, ground + mode.height, ent.z + fz * mode.forward);
      desiredLook.set(ent.x + fx * mode.ahead, ground + mode.look, ent.z + fz * mode.ahead);
    } else if (mode.kind === 'side') {
      desiredPos.set(ent.x + rx * mode.right - fx * 1.5, ground + mode.height, ent.z + rz * mode.right - fz * 1.5);
      desiredLook.set(ent.x + fx * mode.ahead, ground + mode.look, ent.z + fz * mode.ahead);
    } else {
      desiredPos.set(ent.x - fx * mode.back, ground + mode.height, ent.z - fz * mode.back);
      desiredLook.set(ent.x + fx * mode.ahead, ground + mode.look, ent.z + fz * mode.ahead);
    }

    const t = snap ? 1 : 1 - Math.exp(-7 * dt);
    camPos.lerp(desiredPos, t);
    camLook.lerp(desiredLook, snap ? 1 : 1 - Math.exp(-10 * dt));
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  let helpTimer = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (terrain.ocean?.material?.uniforms?.time) terrain.ocean.material.uniforms.time.value += dt;
    const now = durbanNow();
    const { season, solar } = updateEnvironment(now);
    const ent = entity();

    if (input.takePressed('camera')) {
      camMode = (camMode + 1) % CAM_MODES.length;
      hud.toast(`${CAM_MODES[camMode].name} camera`, 1.2);
    }
    if (input.takePressed('horn')) {
      unlockAudio();
      honk();
      hud.toast('Beep beep!', 0.9);
    }
    if (input.takePressed('cycle')) {
      const name = vehicle.cycleType();
      hud.toast(`Now driving a ${name}`, 2);
    }
    if (input.takePressed('interact')) {
      unlockAudio();
      if (inVehicle) exitVehicle();
      else enterVehicle();
    }
    if (input.takePressed('destination')) {
      const dest = gps.next();
      hud.toast(`GPS set: ${dest.name}`, 2.2);
    }
    if (input.takePressed('clearDest')) {
      if (gps.dest) hud.toast('GPS cleared', 1.2);
      gps.clear();
    }

    if (input.isDown('gas') || input.isDown('left') || input.isDown('right')) {
      hud.hideHelp();
    }
    helpTimer += dt;
    if (helpTimer > 16) hud.hideHelp();

    ent.update(dt);
    updateCamera(dt, !cameraReady || camSnap);
    cameraReady = true;
    camSnap = false;

    const arrival = gps.update(ent.x, ent.z, ent.yaw);
    if (arrival) hud.toast(`Arrived at ${arrival.name}`, 3);

    traffic.update(dt, ent.x, ent.z);
    roadside.update(ent.x, ent.z, dt);
    roadProps.update(ent.x, ent.z);
    pedestrians.update(dt, ent.x, ent.z);
    nature.update(ent.x, ent.z);

    const targetFov = inVehicle ? 62 + Math.min(12, (vehicle.speedKmh / 180) * 12) : 62;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }

    hud.updateTime(now, season, solar.night > 0.5);
    hud.update(dt, ent);
    hud.updateDestination(gps);
    minimap.update(ent.x, ent.z, ent.yaw, gps.dest);

    newRoadTimer += dt;
    if (newRoadTimer > 0.5) {
      newRoadTimer = 0;
      const near = roads.nearestRoad(ent.x, ent.z, 26);
      if (near && near.dist < 18 && near.road.name && near.road.name !== lastRoad) {
        lastRoad = near.road.name;
        if (roadToastCooldown <= 0) {
          hud.toast(near.road.name, 2);
          roadToastCooldown = 4;
        }
      }
    }
    if (roadToastCooldown > 0) roadToastCooldown -= dt;

    renderer.render(scene, camera);
  }

  setLoad(100, 'Ready');
  document.getElementById('loading').classList.add('done');
  updateEnvironment(durbanNow());
  updateCamera(0, true);
  cameraReady = true;
  const now = durbanNow();
  hud.updateTime(now, seasonForDate(now), solarState(now).night > 0.5);
  hud.toast(`Welcome to Izinja zase Kasi (IZK) — ${seasonForDate(now).name} ${formatSeasonTime(now)}`, 4);
  frame();
}

function formatSeasonTime(now) {
  const h = now.getHours();
  return h < 6 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 20 ? 'evening' : 'night';
}

main().catch((err) => {
  console.error(err);
  setLoad(100, `Failed: ${err.message}`);
  loadFill.style.background = '#ff6b57';
});
