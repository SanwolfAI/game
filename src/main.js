import * as THREE from '../vendor/three/three.module.js';
import { toXZ, districtsWorld, configurePlaces } from './core/geo.js';
import { mulberry32 } from './core/utils.js';
import { GameClock, seasonForDate, solarState } from './core/time.js';
import { Heightfield } from './world/heightfield.js';
import { buildTerrain, buildLandcover, createGroundMaterial } from './world/terrain.js';
import { buildLanduse } from './world/landuse.js';
import { RoadNetwork } from './world/roads.js';
import { City } from './world/city.js';
import { Buildings } from './world/buildings.js';
import { Props } from './world/props.js';
import { DirSigns } from './world/dirSigns.js';
import { WORLD } from './world/worldLight.js';
import { buildLandmarks } from './world/landmarks.js';
import { Vehicle } from './game/vehicle.js';
import { loadCarModels, applyVehicleEnvironment } from './game/carModels.js';
import { Player } from './game/player.js';
import { Traffic } from './game/traffic.js';
import { StreetLife, loadPeople } from './game/streetLife.js';
import { Input } from './game/input.js';
import { honk, unlockAudio, tick, updateEngine, toggleMute } from './game/audio.js';
import { HUD } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { GPS } from './game/gps.js';
import { Router } from './game/router.js';
import { BigMap } from './ui/bigmap.js';
import { buildCockpit, updateCockpit, DRIVER_X } from './game/cockpit.js';
import { loadSave, writeSave, clearSave } from './game/save.js';
import { Medians } from './world/medians.js';
import { Weather } from './world/weather.js';
import { Water } from './world/water.js';
import { LandmarkLayer, CATS as LM_CATS } from './world/landmarkLayer.js';
import { VEHICLE_TYPES } from './game/models.js';

const SKY_NIGHT = new THREE.Color(0x060b18);
const SKY_DUSK = new THREE.Color(0xe6a27a); // faint warm haze only while the sun is just above the horizon
const SKY_TWILIGHT = new THREE.Color(0x24406e); // natural blue hour
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

// Crash guard: a launch that never reaches a stable ~20 s of play (whole-phone
// freeze, GPU hang, killed WebView) leaves this flag behind, so the next
// launch starts in SAFE MODE: low resolution, no street life/real people,
// fresh spawn. ?safe=1 forces it, ?safe=0 skips it.
const BOOT_KEY = 'izk-boot';
const qs0 = new URLSearchParams(location.search);
let lastBoot = null;
try { lastBoot = localStorage.getItem(BOOT_KEY); } catch {}
const SAFE = qs0.get('safe') === '1' || (qs0.get('safe') !== '0' && lastBoot === 'running');
const MOBILE = /Android|Mobi|iPhone|iPad/i.test(navigator.userAgent || '') || ((navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) < 900);
const setBoot = (v) => { try { v ? localStorage.setItem(BOOT_KEY, v) : localStorage.removeItem(BOOT_KEY); } catch {} };
if (SAFE) setBoot(null);

async function main() {
  window.__izkStarted = true;
  setLoad(6, 'Loading OpenStreetMap data…');
  const res = await fetch('./src/data/durban-game.json');
  if (!res.ok) throw new Error(`Could not load map data (HTTP ${res.status})`);
  const data = await res.json();
  configurePlaces(data.places);
  setLoad(18, 'Projecting coastline…');
  await nextFrame();

  const coastXZ = extendCoast(data.coast.map(([lon, lat]) => toXZ(lon, lat)));
  const bounds = worldBounds(coastXZ, data);

  setLoad(26, 'Shaping real terrain and rivers…');
  await nextFrame();
  let dem = null;
  try {
    const [mr, br] = await Promise.all([fetch('./src/data/durban-dem.json'), fetch('./src/data/durban-dem.bin')]);
    if (mr.ok && br.ok) dem = { meta: await mr.json(), data: new Int16Array(await br.arrayBuffer()) };
  } catch {
    dem = null;
  }
  let waterPre = null;
  try {
    const wr = await fetch('./src/data/durban-water.json');
    waterPre = wr.ok ? await wr.json() : null;
  } catch {
    waterPre = null;
  }
  const rivers = waterPre ? waterPre.rivers.filter((r) => r.k === 'river').map((r) => ({ xz: r.p.map(([lon, lat]) => toXZ(lon, lat)), w: r.w })) : null;
  const areas = waterPre ? (waterPre.areas || []).map((a) => a.p.map(([lon, lat]) => toXZ(lon, lat))) : null;
  const roadLines = data.roads.filter((r) => !r.b).map((r) => r.p.map(([lon, lat]) => toXZ(lon, lat)));
  const hf = new Heightfield(coastXZ, bounds, 80, { dem, rivers, areas, roads: roadLines });

  const loadJson = async (url) => {
    try {
      const r = await fetch(url);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const [areaData, featData, waterData, lmData] = await Promise.all([loadJson('./src/data/durban-areas.json'), loadJson('./src/data/durban-features.json'), Promise.resolve(waterPre), loadJson('./src/data/durban-landmarks.json')]);
  setLoad(40, 'Paving the ground…');
  await nextFrame();
  const coverBox = { minX: -11760, maxX: 9470, minZ: -19760, maxZ: 11300 };
  const groundMat = createGroundMaterial(buildLandcover(areaData?.areas, coverBox), coverBox);
  const terrain = buildTerrain(hf, coastXZ, 2, groundMat);
  hf.renderStep = 2; // roads sample the rendered (decimated) terrain too
  const landuse = buildLanduse(hf, data.landuse);

  setLoad(58, 'Laying 19 000 roads…');
  await nextFrame();
  const roads = new RoadNetwork(data, hf);

  setLoad(68, 'Raising 200 000 real buildings…');
  await nextFrame();
  let buildings = null;
  try {
    const bres = await fetch('./src/data/durban-buildings.bin');
    if (!bres.ok) throw new Error(`HTTP ${bres.status}`);
    buildings = new Buildings(await bres.arrayBuffer(), hf, roads);
  } catch (err) {
    console.warn('[IZK] building footprints unavailable, using generated city only', err);
  }
  setLoad(74, 'Raising the city…');
  await nextFrame();
  const city = new City(hf, roads, mulberry32(20241113));
  city.buildings = buildings;
  // Footprint data covers the core; generated districts fill in the rest.
  const cityGroup = city.build(districtsWorld(data).filter((d) => !buildings || !Buildings.covers(d.x, d.z)));

  setLoad(82, 'Building Durban landmarks…');
  await nextFrame();
  const landmarks = buildLandmarks(hf, city);

  setLoad(84, 'Planting trees and street lights…');
  await nextFrame();
  const props = new Props({ roads, hf, buildings, areas: areaData?.areas, features: featData?.features, coastXZ });
  setLoad(86, 'Polishing the gusheshe…');
  await nextFrame();
  await Promise.race([Promise.all([loadCarModels(), props.load(), SAFE ? null : loadPeople()]), new Promise((r) => setTimeout(r, 20000))]);

  setLoad(90, 'Warming up the engine…');
  await nextFrame();

  // Phones: 1x pixels, no MSAA, default GPU mode. A Hisense-class GPU hung
  // the whole device at 2x + MSAA with the full city on the first frame.
  const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE && !SAFE, powerPreference: MOBILE ? 'default' : 'high-performance' });
  renderer.setPixelRatio(SAFE ? Math.min(devicePixelRatio || 1, 0.75) : Math.min(devicePixelRatio || 1, MOBILE ? 1 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyDay = new THREE.Color(0x9fc6e2);
  scene.background = skyDay.clone();
  scene.fog = new THREE.Fog(0x9fc6e2, 750, 5200);

  // near=1 m doubles depth precision vs 0.5 (no road/marking z-fighting at range)
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1.0, 16000);

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
  const weather = new Weather(scene);
  const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(120, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xe8edff, fog: false })
  );
  moonDisc.renderOrder = -2;
  scene.add(moonDisc);

  scene.environment = applyVehicleEnvironment(renderer, scene);
  scene.add(terrain.group);
  scene.add(landuse);
  scene.add(roads.group);
  scene.add(cityGroup);
  if (buildings) scene.add(buildings.group);
  scene.add(props.group);
  const dirSigns = new DirSigns({ roads, features: featData?.features });
  scene.add(dirSigns.group);
  const medians = new Medians(roads);
  scene.add(medians.group);
  const water = new Water(waterData, hf);
  scene.add(water.group);
  const realLandmarks = new LandmarkLayer(lmData, { roads, hf });
  scene.add(realLandmarks.group);
  scene.add(landmarks);

  const input = new Input();
  const vehicle = new Vehicle(hf, roads, city, input);
  scene.add(vehicle.group);
  vehicle.medians = medians;
  // Autosave: carry on exactly where the last session stopped.
  const params0 = new URLSearchParams(location.search);
  const saved = params0.get('new') === '1' || SAFE ? null : loadSave();
  if (saved) {
    if (saved.car && saved.car !== vehicle.typeId && VEHICLE_TYPES.some((t) => t.id === saved.car)) vehicle.setType(saved.car);
    vehicle.restore(saved.x, saved.z, saved.yaw || 0);
    if (saved.lights) vehicle.lightMode = saved.lights;
  }

  const [vx, vz] = vehicle.forward;
  const player = new Player(hf, city, input, vehicle.x - vx * 3.4, vehicle.z - vz * 3.4, vehicle.yaw);
  player.roads = roads;
  scene.add(player.group);

  // Street life first: it marks CBD kerb lanes as parking before traffic spawns.
  const streetLife = new StreetLife(roads, hf, buildings, mulberry32(40421));
  scene.add(streetLife.group);
  // Street life joins a few seconds after the controls appear (spreads the
  // shader compile and upload); never in safe mode.
  streetLife.group.visible = false;
  let streetLifeOn = false;
  let streetLifeDelay = SAFE ? Infinity : 4;
  const traffic = new Traffic(roads, hf, mulberry32(99117), vehicle.x, vehicle.z);
  traffic.props = props;
  traffic.player = vehicle;
  traffic.playerActive = true;
  traffic.buildings = buildings;
  let shake = 0;
  let crashToastCd = 0;
  traffic.onCrash = (impact) => {
    shake = Math.min(0.6, Math.max(shake, impact * 0.03));
    if (impact > 6 && crashToastCd <= 0) {
      hud.toast(impact > 14 ? 'Hard crash!' : 'Bumped another car', 1.2);
      crashToastCd = 2;
    }
  };
  scene.add(traffic.group);


  const hud = new HUD();
  input.gearListeners.push((g) => hud.toast(g === 'D' ? 'Drive' : g === 'R' ? 'Reverse' : 'Neutral', 0.9));
  const minimap = createMinimap(hf, roads);
  const gps = new GPS();
  gps.router = new Router(roads);
  const bigmap = new BigMap({
    hf,
    roads,
    minimap,
    gps,
    onDestination: (x, z, name) => {
      gps.setDestination(x, z, name);
      const e = entity();
      gps.update(e.x, e.z, e.yaw);
      hud.toast(gps.route ? `Route set: ${name}` : `Destination set: ${name}`, 2);
    }
  });
  bigmap.features = featData?.features || null;
  bigmap.landmarks = realLandmarks.named;
  bigmap.landmarkCats = LM_CATS;
  if (saved && saved.dest && Number.isFinite(saved.dest.x)) gps.setDestination(saved.dest.x, saved.dest.z, saved.dest.name || 'Map pin');
  document.getElementById('map-box')?.addEventListener('click', () => {
    const e = entity();
    bigmap.show(e.x, e.z, e.yaw);
  });

  let inVehicle = true;
  let camMode = 0;
  let cameraReady = false;
  let camSnap = true;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();

  const CAM_MODES = [
    { name: 'Chase camera', dist: 9.5, height: 3.9, ahead: 7, look: 1.5 },
    { name: 'Close chase', dist: 6.2, height: 2.3, ahead: 6, look: 1.25 },
    { name: 'Bonnet camera', local: [0, 1.32, 1.0], near: 0.3 },
    { name: 'Driver view', local: [DRIVER_X, 1.24, -0.12], near: 0.08, cockpit: true },
    { name: 'Orbit: drag to turn, pinch to zoom', orbit: true },
    { name: 'High camera', dist: 18, height: 8.5, ahead: 12, look: 1.2 }
  ];
  if (saved && Number.isInteger(saved.cam) && saved.cam >= 0 && saved.cam < CAM_MODES.length) camMode = saved.cam;
  const cockpit = buildCockpit();
  vehicle.group.add(cockpit);
  const camTmp = new THREE.Vector3();
  const orbit = { yaw: 0.6, pitch: 0.28, dist: 7.5, ptrs: new Map(), pinch: 0 };
  {
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!CAM_MODES[camMode].orbit) return;
      orbit.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      orbit.pinch = 0;
    });
    const end = (e) => orbit.ptrs.delete(e.pointerId);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointermove', (e) => {
      const p = orbit.ptrs.get(e.pointerId);
      if (!p) return;
      if (orbit.ptrs.size === 1) {
        orbit.yaw -= (e.clientX - p[0]) * 0.008;
        orbit.pitch = Math.max(-0.05, Math.min(1.3, orbit.pitch + (e.clientY - p[1]) * 0.006));
      }
      p[0] = e.clientX;
      p[1] = e.clientY;
      if (orbit.ptrs.size === 2) {
        const it = orbit.ptrs.values();
        const a = it.next().value;
        const b = it.next().value;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (orbit.pinch > 0) orbit.dist = Math.max(3.2, Math.min(22, orbit.dist * (orbit.pinch / d)));
        orbit.pinch = d;
      }
    });
    el.addEventListener('wheel', (e) => {
      if (!CAM_MODES[camMode].orbit) return;
      orbit.dist = Math.max(3.2, Math.min(22, orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: true });
  }
  let camNear = 1.0;
  function setNear(n) {
    if (n !== camNear) {
      camNear = n;
      camera.near = n;
      camera.updateProjectionMatrix();
    }
  }

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

  vehicle.onBlink = (on) => tick(on);
  const sigEls = {
    l: document.getElementById('t-ind-l'),
    r: document.getElementById('t-ind-r'),
    h: document.getElementById('t-haz'),
    lights: document.getElementById('t-lights'),
    mode: document.getElementById('t-lights-mode')
  };
  let sigKey = '';
  function updateSignalButtons() {
    const ind = vehicle.indicator;
    const blink = vehicle.blinkOn;
    const key = `${ind}|${blink}|${vehicle.lightMode}`;
    if (key === sigKey || !sigEls.l) return;
    sigKey = key;
    sigEls.l.classList.toggle('on', blink && (ind === 'left' || ind === 'hazard'));
    sigEls.r.classList.toggle('on', blink && (ind === 'right' || ind === 'hazard'));
    sigEls.h.classList.toggle('on', ind === 'hazard' && blink);
    sigEls.lights.classList.toggle('on', vehicle.lightMode === 'on' || vehicle.lightMode === 'high');
    sigEls.lights.classList.toggle('high', vehicle.lightMode === 'high');
    sigEls.mode.textContent = { auto: 'A', on: '', high: 'H', off: 'off' }[vehicle.lightMode];
  }

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
    player.placeAt(ex, ez, vehicle.yaw + Math.PI / 2, vehicle.y);
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
    sun.intensity = solar.day * (2.3 + (season.id === 'winter' ? 0.5 : 0.2)) * (1 - weather.cur.cloud * 0.75);
    sunColor.setHex(season.sun);
    sunColor.lerp(new THREE.Color(0xff8d4d), solar.golden * 0.7);
    sun.color.copy(sunColor);

    moon.position.copy(moonDir).multiplyScalar(1800);
    moon.intensity = solar.night * 0.42;
    moon.color.copy(MOON_COLOR);

    // Natural sky: navy night -> blue hour -> day blue. Only a light warm haze at
    // sunrise/sunset while the sun is still up (no orange sky after dark).
    const sky = solar.day < 0.5 ? SKY_NIGHT.clone().lerp(SKY_TWILIGHT, solar.day * 2) : SKY_TWILIGHT.clone().lerp(daySky, (solar.day - 0.5) * 2);
    sky.lerp(SKY_DUSK, solar.golden * 0.16 * Math.min(1, solar.day * 2) * (1 - solar.night));
    weather.applySky(sky, solar.day);
    scene.background.copy(sky);

    fogColor.copy(sky).lerp(daySky, 0.18);
    scene.fog.color.copy(fogColor);
    scene.fog.near = (750 - solar.night * 320) * weather.cur.fog;
    scene.fog.far = (5200 - solar.night * 2300) * weather.cur.fog;

    hemi.intensity = (0.3 + solar.day * 1.35) * (1 - weather.cur.cloud * 0.25) + weather.flash * 2.5;
    hemiSky.copy(sky).lerp(daySky, 0.4);
    hemiGround.setHex(season.ground);
    hemi.color.copy(hemiSky);
    hemi.groundColor.copy(hemiGround);

    fill.intensity = 0.15 + solar.day * 0.35;
    renderer.toneMappingExposure = 0.82 + solar.day * 0.3;

    WORLD.night.value = Math.min(1, solar.night * 1.2 + solar.golden * 0.25);
    WORLD.day.value = solar.day;
    WORLD.time.value = performance.now() / 1000;
    if (terrain.ocean.material.uniforms) terrain.ocean.material.uniforms.uSunDir.value.copy(sunDir);
    scene.environmentIntensity = 0.12 + solar.day * 0.88;
    WORLD.sky.value.copy(sky);
    stars.material.opacity = solar.night * 0.95 * (1 - weather.cur.cloud);
    stars.position.copy(camera.position);
    moonDisc.visible = solar.night > 0.05 && weather.cur.cloud < 0.6;
    moonDisc.position.copy(camera.position).addScaledVector(moonDir, 7000);

    return { season, solar };
  }

  function updateCamera(dt, snap) {
    const ent = entity();
    const mode = inVehicle ? CAM_MODES[camMode] : CAM_MODES[0];
    const inCar = inVehicle && !!mode.local;
    cockpit.visible = inVehicle && !!mode.cockpit;
    if (vehicle.mesh) vehicle.mesh.visible = !cockpit.visible;
    if (cockpit.visible) updateCockpit(cockpit, vehicle.steer || 0);
    setNear(inCar ? mode.near : 1.0);
    if (inCar) {
      // Rigidly mounted in the car (follows pitch and roll). Taller vans
      // (Quantum) lift the eye point and cockpit with the body height.
      const sz = vehicle.mesh && vehicle.mesh.userData.size;
      const lift = sz ? Math.max(0, sz.y * 0.88 - 1.24) : 0;
      cockpit.position.y = lift;
      ent.group.updateMatrixWorld(true);
      camPos.set(mode.local[0], mode.local[1] + lift, mode.local[2]);
      ent.group.localToWorld(camPos);
      camLook.set(mode.local[0], mode.local[1] + lift - 0.25, mode.local[2] + 12);
      ent.group.localToWorld(camLook);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    } else if (inVehicle && mode.orbit) {
      const baseY = ent.group.position.y;
      const a = ent.yaw + Math.PI + orbit.yaw;
      desiredPos.set(ent.x + Math.sin(a) * Math.cos(orbit.pitch) * orbit.dist, baseY + 0.9 + Math.sin(orbit.pitch) * orbit.dist, ent.z + Math.cos(a) * Math.cos(orbit.pitch) * orbit.dist);
      camTmp.set(ent.x, baseY + 0.8, ent.z);
      camPos.lerp(desiredPos, snap ? 1 : 1 - Math.exp(-14 * dt));
      camLook.copy(camTmp);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    } else {
      const dist = inVehicle ? mode.dist : 5.6;
      const height = inVehicle ? mode.height : 2.5;
      const ahead = inVehicle ? mode.ahead : 2.5;
      const look = inVehicle ? mode.look : 1.35;
      const [fx, fz] = ent.forward;

      const baseY = ent.group.position.y;
      desiredPos.set(ent.x - fx * dist, baseY + height, ent.z - fz * dist);
      desiredLook.set(ent.x + fx * ahead, baseY + look, ent.z + fz * ahead);

      const t = snap ? 1 : 1 - Math.exp(-7 * dt);
      camPos.lerp(desiredPos, t);
      camLook.lerp(desiredLook, snap ? 1 : 1 - Math.exp(-10 * dt));
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }
    // Debug/screenshot override: window.__izkCam = { pos: [x, y, z], look: [x, y, z] }
    const ov = window.__izkCam;
    if (ov) {
      camera.position.set(ov.pos[0], ov.pos[1], ov.pos[2]);
      camera.lookAt(ov.look[0], ov.look[1], ov.look[2]);
    }
  }

  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  // 24 in-game hours = 4 real hours. Fresh sessions start at 08:00; ?time=HH
  // overrides the start hour and ?resume=1 continues the last saved clock.
  const params = new URLSearchParams(location.search);
  const startHour = params.has('time') ? Number(params.get('time')) || 0 : 8;
  const gameClock = params.get('resume') === '1' || (saved && !params.has('time')) ? GameClock.load({ startHour }) : new GameClock({ startHour });
  let saveTimer = 0;
  let saveBlocked = false;
  function saveNow() {
    if (saveBlocked) return;
    gameClock.save();
    writeSave({
      x: Math.round(vehicle.x * 10) / 10,
      z: Math.round(vehicle.z * 10) / 10,
      yaw: Math.round(vehicle.yaw * 1000) / 1000,
      car: vehicle.typeId,
      lights: vehicle.lightMode,
      cam: camMode,
      onFoot: !inVehicle,
      px: Math.round(player.x * 10) / 10,
      pz: Math.round(player.z * 10) / 10,
      pyaw: player.yaw || 0,
      dest: gps.dest ? { x: gps.dest.x, z: gps.dest.z, name: gps.dest.name } : null
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  addEventListener('pagehide', saveNow);
  addEventListener('beforeunload', saveNow);
  // Menu: Resume / New game (back to the CBD start, clears the save).
  {
    const menu = document.getElementById('menu');
    document.getElementById('t-menu')?.addEventListener('pointerup', () => menu?.classList.add('open'));
    document.getElementById('m-resume')?.addEventListener('click', () => menu?.classList.remove('open'));
    // steering sensitivity, saved on the phone
    let sens = 1;
    try {
      sens = Number(localStorage.getItem('izk-steer-sens')) || 1;
    } catch {}
    const sval = document.getElementById('m-sval');
    const applySens = (v) => {
      sens = Math.round(Math.max(0.5, Math.min(2.5, v)) * 10) / 10;
      input.steerSens = sens;
      if (sval) sval.textContent = sens.toFixed(1) + '×';
      try {
        localStorage.setItem('izk-steer-sens', String(sens));
      } catch {}
    };
    applySens(sens);
    document.getElementById('m-sdn')?.addEventListener('click', () => applySens(sens - 0.1));
    document.getElementById('m-sup')?.addEventListener('click', () => applySens(sens + 0.1));
    document.getElementById('m-safe')?.addEventListener('click', () => {
      saveBlocked = true;
      location.href = location.pathname + '?safe=1';
    });
    document.getElementById('m-new')?.addEventListener('click', () => {
      saveBlocked = true;
      clearSave();
      location.reload();
    });
  }
  if (saved && saved.onFoot && Number.isFinite(saved.px)) {
    inVehicle = false;
    player.placeAt(saved.px, saved.pz, saved.pyaw || 0, null);
    player.group.visible = true;
    camSnap = true;
  }
  let helpTimer = 0;
  let clockSaveTimer = 0;

  // Audio needs a user gesture before it can start (Android WebView too).
  const unlockOnce = () => unlockAudio();
  addEventListener('pointerdown', unlockOnce, { passive: true });
  addEventListener('keydown', unlockOnce);

  let frameErrShown = false;
  let bootFrames = 0;
  let bootTime = 0;
  let slowFrames = 0;
  let streetLifeAge = 0;
  let resT = 0, resSum = 0, resN = 0;
  let lastT = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const t = performance.now();
    const raw = (t - lastT) / 1000;
    lastT = t;
    try {
      frameBody(raw);
    } catch (err) {
      console.error(err);
      if (!frameErrShown && window.__izkShowError) {
        frameErrShown = true;
        window.__izkShowError('in-game error: ' + (err && err.message ? err.message : String(err)));
      }
    }
  }
  function frameBody(raw) {
    // crash guard: clear the boot flag once ~20 s ran fine
    if (bootFrames >= 0) {
      bootFrames++;
      bootTime += Math.min(raw, 1);
      if (bootTime > 20 && bootFrames > 200) {
        setBoot(null);
        bootFrames = -1;
      }
    }
    // dynamic resolution on phones: start at 1x (safe), step up to 1.5x
    // while frames stay smooth, step back down when they don't.
    if (MOBILE && !SAFE) {
      resT += Math.min(raw, 0.1);
      resSum += raw;
      resN++;
      if (resT > 6) {
        const avg = resSum / resN;
        const cur = renderer.getPixelRatio();
        const max = Math.min(devicePixelRatio || 1, 1.5);
        let next = cur;
        if (avg < 0.036 && cur < max) next = Math.min(max, cur + 0.25);
        else if (avg > 0.07 && cur > 1) next = Math.max(1, cur - 0.25);
        if (next !== cur) renderer.setPixelRatio(next);
        resT = resSum = resN = 0;
      }
    }
    // watchdog: very slow frames well after street life appeared (not the
    // one-off hitch when it first shows) -> drop street life for this run
    if (streetLifeOn) streetLifeAge += Math.min(raw, 0.1);
    if (raw > 0.9 && streetLifeOn && streetLifeAge > 5) {
      slowFrames++;
      if (slowFrames >= 5) {
        streetLifeOn = false;
        streetLifeDelay = Infinity;
        streetLife.group.visible = false;
        hud.toast('Phone struggling: street life turned off', 3);
      }
    }
    if (!streetLifeOn && streetLifeDelay !== Infinity) {
      streetLifeDelay -= Math.min(raw, 0.1);
      if (streetLifeDelay <= 0) {
        streetLifeOn = true;
        streetLife.group.visible = true;
      }
    }
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = gameClock.tick();
    weather.update(dt, camera, seasonForDate(now).id, now.getHours());
    const { season, solar } = updateEnvironment(now);
    const ent = entity();
    clockSaveTimer += dt;
    if (clockSaveTimer > 10) {
      clockSaveTimer = 0;
      gameClock.save();
    }
    saveTimer += dt;
    if (saveTimer > 3) {
      saveTimer = 0;
      saveNow();
    }

    if (input.takePressed('camera')) {
      camMode = (camMode + 1) % CAM_MODES.length;
      hud.toast(CAM_MODES[camMode].name, 1.4);
    }
    if (input.takePressed('horn')) {
      unlockAudio();
      honk();
      hud.toast('Beep beep!', 0.9);
    }
    if (input.takePressed('map')) {
      bigmap.toggle(ent.x, ent.z, ent.yaw);
    }
    if (input.takePressed('lights')) {
      unlockAudio();
      const m = vehicle.cycleLights();
      hud.toast({ auto: 'Lights: auto', on: 'Headlights on', high: 'High beam', off: 'Lights off' }[m], 1.1);
    }
    for (const [act, which] of [['indLeft', 'left'], ['indRight', 'right'], ['hazard', 'hazard']]) {
      if (input.takePressed(act)) {
        unlockAudio();
        vehicle.setIndicator(which);
      }
    }
    updateSignalButtons();
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

    input.update(dt, inVehicle ? vehicle.speed : 0);
    ent.update(dt);
    hud.updateGear?.(inVehicle ? input.gear : '');
    updateCamera(dt, !cameraReady || camSnap);
    if (shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
      shake *= Math.max(0, 1 - dt * 6);
    } else shake = 0;
    if (crashToastCd > 0) crashToastCd -= dt;
    cameraReady = true;
    camSnap = false;

    const arrival = gps.update(ent.x, ent.z, ent.yaw);
    if (arrival) hud.toast(`Arrived at ${arrival.name}`, 3);

    traffic.playerActive = inVehicle;
    traffic.playerIsCop = inVehicle && vehicle.typeId === 'saps';
    traffic.update(dt, ent.x, ent.z);
    roads.update(camera.position.x, camera.position.z);
    if (buildings) buildings.update(camera.position.x, camera.position.z, 1);
    props.update(camera.position.x, camera.position.z, dt, 1);
    dirSigns.update(camera.position.x, camera.position.z);
    water.update(dt);
    realLandmarks.update(camera.position.x, camera.position.z);
    if (streetLifeOn) streetLife.update(dt, ent.x, ent.z, now.getHours() + now.getMinutes() / 60, inVehicle ? vehicle : null, traffic.onCrash);

    const targetFov = inVehicle ? 62 + Math.min(12, (vehicle.speedKmh / 180) * 12) : 62;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }

    hud.updateTime(now, season, solar.night > 0.5, weather.label);
    hud.update(dt, ent);
    hud.updateDestination(gps);
    minimap.update(ent.x, ent.z, ent.yaw, gps.dest, gps.route);
    bigmap.update(dt, ent.x, ent.z, ent.yaw);

    if (input.takePressed('mute')) hud.toast(toggleMute() ? 'Sound off' : 'Sound on', 1.1);
    updateEngine(dt, inVehicle ? vehicle.speedKmh : 0, inVehicle ? vehicle.throttleNow || 0 : 0, inVehicle, traffic.nearest(ent.x, ent.z, 3));

    newRoadTimer += dt;
    if (newRoadTimer > 0.5) {
      newRoadTimer = 0;
      const near = roads.nearestRoad(ent.x, ent.z, 26);
      const onRoad = ent.surfRoad && ent.surfRoad.name ? ent.surfRoad : near && near.dist < near.road.width / 2 + 3 ? near.road : null;
      if (onRoad && onRoad.name && onRoad.name !== lastRoad) {
        lastRoad = onRoad.name;
        hud.setStreet(onRoad.name); // permanent label; keeps the last name off-road
        bigmap.street = onRoad.name;
        bigmap.dirty = true;
      }
    }
    if (roadToastCooldown > 0) roadToastCooldown -= dt;

    renderer.render(scene, camera);
  }

  setLoad(100, 'Ready');
  document.getElementById('loading').classList.add('done');
  const now = gameClock.now();
  updateEnvironment(now);
  updateCamera(0, true);
  roads.update(camera.position.x, camera.position.z, 1e9); // build nearby road detail up front
  if (buildings) buildings.update(camera.position.x, camera.position.z, 400);
  props.update(camera.position.x, camera.position.z, 0, 12);
  realLandmarks.update(camera.position.x, camera.position.z);
  cameraReady = true;
  // Small debug handle for automated checks / console tinkering.
  window.__izk = { THREE, scene, camera, renderer, vehicle, roads, hf, gameClock, weather, traffic, streetLife, buildings, city, props, dirSigns, gps, bigmap, medians, water, realLandmarks };
  hud.updateTime(now, seasonForDate(now), solarState(now).night > 0.5);
  try {
    renderer.compile(scene, camera); // warm shaders on the loading screen
  } catch {}
  setBoot('running');
  addEventListener('pagehide', () => { if (bootFrames < 0 || bootTime > 3) setBoot(null); });
  if (SAFE) setTimeout(() => hud.toast('Safe mode: last start froze, so graphics are lowered (☰ → New game for normal)', 6), 4500);
  hud.toast(saved ? 'Welcome back — carrying on where you left off' : `Welcome to Izinja zase Kasi (IZK) — ${seasonForDate(now).name} ${formatSeasonTime(now)}`, 4);
  frame();
}

function formatSeasonTime(now) {
  const h = now.getHours();
  return h < 6 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 20 ? 'evening' : 'night';
}

main().then(() => {
  window.__izkBooted = true;
}).catch((err) => {
  console.error(err);
  if (window.__izkShowError) window.__izkShowError(err && err.message ? err.message : String(err));
  setLoad(100, `Failed: ${err.message}`);
  loadFill.style.background = '#ff6b57';
});
