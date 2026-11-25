import * as THREE from '../vendor/three/three.module.js';
import { toXZ, districtsWorld, configurePlaces } from './core/geo.js';
import { mulberry32 } from './core/utils.js';
import { GameClock, seasonForDate, solarState } from './core/time.js';
import { Heightfield } from './world/heightfield.js';
import { buildTerrain, buildLandcover, createGroundMaterial } from './world/terrain.js';
import { buildLanduse } from './world/landuse.js';
import { GrassTufts } from './world/grassTufts.js';
import { RoadNetwork } from './world/roads.js';
import { City } from './world/city.js';
import { Buildings } from './world/buildings.js';
import { Props } from './world/props.js';
import { DirSigns } from './world/dirSigns.js';
import { WORLD } from './world/worldLight.js';
import { buildLandmarks, MABHIDA } from './world/landmarks.js';
import { Vehicle } from './game/vehicle.js';
import { loadCarModels, applyVehicleEnvironment } from './game/carModels.js';
import { Player } from './game/player.js';
import { Bicycle } from './game/bicycle.js';
import { TaxiRide } from './game/taxiRide.js';
import { Rides } from './game/rides.js';
import { Traffic } from './game/traffic.js';
import { StreetLife, loadPeople } from './game/streetLife.js';
import { loadHumans } from './game/humans.js';
import { Input } from './game/input.js';
import { registerDialog, dialogOpen, onDialogChange } from './ui/dialogs.js';
import { honk, unlockAudio, tick, updateEngine, toggleMute, pauseAudio } from './game/audio.js';
import { HUD } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { GPS } from './game/gps.js';
import { Fares } from './game/fares.js';
import { Learners } from './world/learners.js';
import { BusStations } from './world/busStations.js';
import { Shelters } from './world/shelters.js';
import { Router } from './game/router.js';
import { BigMap } from './ui/bigmap.js';
import { buildCockpit, updateCockpit, DRIVER_X } from './game/cockpit.js';
import { loadSave, writeSave, clearSave } from './game/save.js';
import { Medians } from './world/medians.js';
import { Weather } from './world/weather.js';
import { Sharpen, sharpenTextures } from './world/sharpen.js';
import { Water } from './world/water.js';
import { LandmarkLayer, CATS as LM_CATS } from './world/landmarkLayer.js';
import { Grounds } from './world/grounds.js';
import { SHADOW, blobMaterial } from './world/blobShadow.js';
import { GFX, nativePx } from './core/gfx.js';
import { mirrorFrame } from './core/mirrorCache.js';
import { Kasi } from './world/kasi.js';
import { OsmDetail } from './world/osmDetail.js';
import { Harbour } from './world/harbour.js';
import { Trains } from './world/trains.js';
import { VEHICLE_TYPES } from './game/models.js';
// Full sharpness: every texture made while loading already gets the GPU's
// max anisotropic filtering (read from a probe context in gfx.js).
THREE.Texture.DEFAULT_ANISOTROPY = Math.max(1, GFX.maxAniso || 1);

const SKY_NIGHT = new THREE.Color(0x060b18);
const SKY_DUSK = new THREE.Color(0xe6a27a); // faint warm haze only while the sun is just above the horizon
const SKY_TWILIGHT = new THREE.Color(0x24406e); // natural blue hour
const SUN_WARM = new THREE.Color(0xffd7a8);
const SUN_GOLD = new THREE.Color(0xff8a45);
const HAZE_WHITE = new THREE.Color(0xe8eef2);
const SKY_ZENITH_TINT = new THREE.Color(0x2f6fc0);
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
// launch starts in SAFE MODE: same full-sharp HD look (native pixels, HD
// textures, sharpen), but a lighter safety budget (src/core/gfx.js), no street life/real people,
// (keeps the autosave). ?safe=1 forces it, ?safe=0 skips it.
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
  // House looks per area from Mapillary street photos (walls, roofs, fences).
  if (buildings) {
    try {
      const sres = await fetch('./src/data/durban-house-styles.json');
      if (sres.ok) buildings.setStyles(await sres.json());
    } catch (err) {
      console.warn('[IZK] house styles unavailable', err);
    }
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
  if (buildings) {
    const [mx, mz] = toXZ(MABHIDA.lon, MABHIDA.lat);
    buildings.exclude(mx, mz, MABHIDA.a, MABHIDA.b, MABHIDA.ux, MABHIDA.uz);
  }

  setLoad(84, 'Planting trees and street lights…');
  await nextFrame();
  // golf courses, race tracks, pitches, pools, car parks, cemeteries from OSM
  let osmDetail = null;
  try {
    const detData = await loadJson('./src/data/durban-detail.json');
    if (detData) {
      osmDetail = new OsmDetail(detData, { hf, roads });
      console.log('[IZK] osm detail', JSON.stringify(osmDetail.stats), Math.round(osmDetail.ms), 'ms');
    }
  } catch (err) {
    console.warn('[IZK] osm detail not built', err);
  }
  const props = new Props({ roads, hf, buildings, areas: areaData?.areas, features: featData?.features, coastXZ });
  props.detail = osmDetail;
  const tufts = new GrassTufts({ hf, roads, buildings, detail: osmDetail });
  setLoad(86, 'Polishing the gusheshe…');
  await nextFrame();
  await Promise.race([Promise.all([loadCarModels(), props.load(), SAFE ? null : loadHumans().then((lib) => (lib ? lib : loadPeople()))]), new Promise((r) => setTimeout(r, 20000))]);

  setLoad(90, 'Warming up the engine…');
  await nextFrame();

  // Phones: no MSAA (edges are smoothed by the FXAA in the sharpen pass),
  // default GPU mode. A Hisense-class GPU hung the whole device at 2x + MSAA
  // with the full city on the first frame. FULL SHARPNESS (src/core/gfx.js):
  // the screen's native pixel ratio (cap 3) on every device, safe mode
  // included, and never lowered automatically.
  const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE && !SAFE, powerPreference: MOBILE ? 'default' : 'high-performance' });
  // every texture made from here on gets the GPU's max anisotropy (mipmaps
  // are three's default); textures made earlier get it in sharpenTextures()
  THREE.Texture.DEFAULT_ANISOTROPY = Math.max(THREE.Texture.DEFAULT_ANISOTROPY, renderer.capabilities.getMaxAnisotropy() || 1);
  // Canvas CSS size == drawing buffer / pixel ratio EXACTLY, so the browser
  // never rescales the frame (no CSS-scaling blur, even at 2.5x / 2.75x).
  // (three's size is set to buffer/pr + a hair, so its floor() for the buffer
  // and round() for the viewport both land on the same whole pixel count)
  const fitCanvas = () => {
    const pr = nativePx();
    const bw = Math.max(1, Math.floor(innerWidth * pr));
    const bh = Math.max(1, Math.floor(innerHeight * pr));
    renderer.setPixelRatio(pr);
    renderer.setSize((bw + 1e-3) / pr, (bh + 1e-3) / pr, false);
    const c = renderer.domElement;
    c.style.width = `${bw / pr}px`;
    c.style.height = `${bh / pr}px`;
    return bw / bh;
  };
  fitCanvas();
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps colours rich (ACES washed them out)
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app').appendChild(renderer.domElement);
  // crisp frames: edge smoothing + light sharpen in one pass, always on in the
  // HD mode (?sharp=0 turns it off for debugging only)
  const sharp = new Sharpen(renderer, { off: new URLSearchParams(location.search).get('sharp') === '0' });

  const scene = new THREE.Scene();
  const skyDay = new THREE.Color(0x9fc6e2);
  scene.background = skyDay.clone();
  scene.fog = new THREE.Fog(0x9fc6e2, 750, 5200);

  // near=1 m doubles depth precision vs 0.5 (no road/marking z-fighting at range)
  const camera = new THREE.PerspectiveCamera(62, renderer.domElement.width / Math.max(1, renderer.domElement.height), 1.0, 16000);
  // Sky dome: smooth fade from deep blue overhead to a soft hazy horizon
  // (which the fog matches, so distant city melts into haze), with a warm
  // glow around the sun at golden hour. Replaces the flat background colour.
  const skyUni = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlow: { value: new THREE.Color() } };
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(12000, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUni,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uGlow; varying vec3 vDir;
void main(){
  float h = clamp(vDir.y, -0.2, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 c = mix(uHor, uTop, t);
  if (h < 0.0) c = uHor * (1.0 + h * 0.6);
  float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  c += uGlow * (pow(sd, 8.0) * 0.55 + pow(sd, 90.0) * 1.2);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
    })
  );
  skyDome.renderOrder = -10;
  skyDome.frustumCulled = false;
  skyDome.name = 'skyDome';
  scene.add(skyDome);

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
  scene.add(tufts.group);
  const dirSigns = new DirSigns({ roads, features: featData?.features });
  scene.add(dirSigns.group);
  const medians = new Medians(roads);
  scene.add(medians.group);
  const water = new Water(waterData, hf);
  scene.add(water.group);
  const realLandmarks = new LandmarkLayer(lmData, { roads, hf });
  scene.add(realLandmarks.group);
  scene.add(landmarks);
  // hospital / clinic / police / fire-station grounds (real OSM outlines)
  let grounds = null;
  let groundsData = null;
  try {
    const gdata = await loadJson('./src/data/durban-grounds.json');
    groundsData = gdata;
    grounds = new Grounds(gdata, { roads, hf, buildings });
    if (buildings && gdata) buildings.setSites(gdata.sites); // hospital, clinic, school, police blocks get their look
    scene.add(grounds.group);
  } catch (err) {
    console.warn('[IZK] grounds not built', err);
  }
  // township dressing: container spazas + wooden electricity poles (Umlazi, KwaMashu)
  let kasi = null;
  try {
    if (osmDetail) scene.add(osmDetail.group);
    kasi = new Kasi({ roads, hf, buildings });
    scene.add(kasi.group);
    if (buildings) {
      const solid = buildings.collide.bind(buildings);
      buildings.collide = (x, z, r) => solid(x, z, r) || kasi.collide(x, z, r);
    }
    console.log('[IZK] kasi', kasi.spazas.length, 'spazas', kasi.poles.length, 'poles', Math.round(kasi.ms), 'ms');
  } catch (err) {
    console.warn('[IZK] kasi not built', err);
  }
  // harbour: ships at real quays, gantry cranes, tugs, outer anchorage, piers
  let harbour = null;
  try {
    harbour = new Harbour(await loadJson('./src/data/durban-harbour.json'), { hf });
    scene.add(harbour.group);
  } catch (err) {
    console.warn('[IZK] harbour not built', err);
  }
  // Metrorail trains on the real railway lines
  let trains = null;
  try {
    trains = new Trains(roads, hf);
    scene.add(trains.group);
  } catch (err) {
    console.warn('[IZK] trains not built', err);
  }

  const input = new Input();
  const vehicle = new Vehicle(hf, roads, city, input);
  scene.add(vehicle.group);
  vehicle.medians = medians;
  // Autosave: carry on exactly where the last session stopped.
  const params0 = new URLSearchParams(location.search);
  const saved = params0.get('new') === '1' ? null : loadSave(); // safe mode keeps your place too
  if (saved) {
    if (saved.car && saved.car !== vehicle.typeId && VEHICLE_TYPES.some((t) => t.id === saved.car)) vehicle.setType(saved.car);
    vehicle.restore(saved.x, saved.z, saved.yaw || 0);
    if (saved.lights) vehicle.lightMode = saved.lights;
  }

  const [vx, vz] = vehicle.forward;
  const player = new Player(hf, city, input, vehicle.x - vx * 3.4, vehicle.z - vz * 3.4, vehicle.yaw);
  player.roads = roads;
  scene.add(player.group);
  // starter bicycle at the house door (bicycle.js)
  const bike = new Bicycle(hf, roads, city, input);
  scene.add(bike.group);
  let onBike = false;

  // Street life first: it marks CBD kerb lanes as parking before traffic spawns.
  const streetLife = new StreetLife(roads, hf, buildings, mulberry32(40421));
  streetLife.camera = camera;
  scene.add(streetLife.group);
  // Street life joins a few seconds after the controls appear (spreads the
  // shader compile and upload); never in safe mode.
  streetLife.group.visible = false;
  let streetLifeOn = false;
  let streetLifeDelay = SAFE || !GFX.caps.streetLife ? Infinity : 4;
  const traffic = new Traffic(roads, hf, mulberry32(99117), vehicle.x, vehicle.z);
  traffic.props = props;
  traffic.player = vehicle;
  traffic.playerActive = true;
  traffic.buildings = buildings;
  let shake = 0;
  // Road feel: freeways glassy, city tar fine-grained, suburbs and old roads
  // rough with the odd pothole thump, off the tar bumpy. Felt as camera
  // vibration that grows with speed; potholes are fixed spots per road.
  const ROUGH = { motorway: 0.12, motorway_link: 0.2, trunk: 0.18, trunk_link: 0.25, primary: 0.3, primary_link: 0.32, secondary: 0.4, secondary_link: 0.4, tertiary: 0.55, tertiary_link: 0.55, residential: 0.75, living_street: 0.8, unclassified: 0.9, service: 0.85, track: 1.6 };
  let feelT = 0;
  let thump = 0;
  let lastHole = -1;
  function roadFeel(dt) {
    if (!inVehicle) return;
    const v = Math.abs(vehicle.speed || 0);
    if (v < 0.5) return;
    const r = vehicle.surfRoad;
    const near = r ? null : roads.nearestRoad(vehicle.x, vehicle.z, 8);
    const rd = r || (near && near.dist < near.road.width / 2 + 0.5 ? near.road : null);
    let k = rd ? ROUGH[rd.cls] ?? 0.6 : 2.2; // off the road: veld / gravel
    if (rd && rd.unpaved) k = Math.max(k, 1.8);
    else if (rd && rd.rural) k *= 1.3;
    if (rd && rd.bridge) k *= 0.6;
    const vf = Math.min(1, v / 30);
    feelT += dt * (18 + v * 1.5);
    const amp = 0.006 * k * (0.3 + vf);
    camera.position.y += Math.sin(feelT) * amp + Math.sin(feelT * 2.7 + 1.3) * amp * 0.6;
    camera.position.x += Math.sin(feelT * 1.9 + 0.4) * amp * 0.4;
    // potholes / joints: deterministic per 7 m cell on rough roads
    if (k >= 0.4) {
      const cell = Math.floor(vehicle.x / 7) * 92821 + Math.floor(vehicle.z / 7) * 68917 + (rd ? rd.id % 1000 : 7);
      if (cell !== lastHole) {
        lastHole = cell;
        const h = Math.abs(Math.sin(cell * 12.9898) * 43758.5453) % 1;
        if (h < 0.035 * k) {
          thump = Math.max(thump, 0.05 * k * (0.4 + vf));
          if (window.navigator.vibrate && k > 0.7 && v > 8) window.navigator.vibrate(18);
        }
      }
    }
    if (thump > 0.002) {
      camera.position.y -= thump * Math.sin(Math.min(1, thump * 30) * 3.14);
      camera.rotation.z += (Math.random() - 0.5) * thump * 0.15;
      thump *= Math.max(0, 1 - dt * 9);
    }
  }
  let crashToastCd = 0;
  traffic.onCrash = (impact) => {
    if (ride && ride.active) return; // a passenger: the driver's problem
    if (onBike) {
      if (impact > 5) {
        dismountBike();
        hud.toast('Knocked off your bike!', 2);
      }
      return;
    }
    shake = Math.min(0.6, Math.max(shake, impact * 0.03));
    if (impact > 6 && crashToastCd <= 0) {
      hud.toast(impact > 14 ? 'Hard crash!' : 'Bumped another car', 1.2);
      crashToastCd = 2;
    }
    if (fares && fares.licence) fares.licence.onCrash(impact);
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
  // school-day learners in uniform + scholar transport at the gates
  let learners = null;
  try {
    if (grounds && !SAFE) {
      learners = new Learners(grounds, hf);
      scene.add(learners.group);
    }
  } catch (err) {
    console.warn('[IZK] learners not built', err);
  }
  // bus stations, depots and the long-distance coach terminal (OSM amenity=bus_station)
  let busStations = null;
  try {
    const bdata = await loadJson('./src/data/durban-buses.json');
    busStations = new BusStations(bdata, { roads, hf, buildings });
    scene.add(busStations.group);
  } catch (err) {
    console.warn('[IZK] bus stations not built', err);
  }
  // bus / taxi stop shelters at their real spots (OSM shelter=yes + Mapillary)
  let shelters = null;
  try {
    const sdata = await loadJson('./src/data/durban-shelters.json');
    shelters = new Shelters(sdata, { roads, hf, buildings, grounds });
    await shelters.load();
    scene.add(shelters.group);
    // shelter back / end panels are solid for the player, bikes and traffic
    if (buildings && shelters.sites.length) {
      const solidS = buildings.collide.bind(buildings);
      const sh = shelters;
      buildings.collide = (x, z, r) => solidS(x, z, r) || sh.collide(x, z, r);
    }
  } catch (err) {
    console.warn('[IZK] shelters not built', err);
  }
  // taxi rank fares (real OSM ranks) and the rand wallet
  let fares = null;
  try {
    fares = new Fares(groundsData, { hf, roads, gps, hud });
    scene.add(fares.group);
  } catch (err) {
    console.warn('[IZK] fares not built', err);
  }
  // riding a taxi as a passenger (taxiRide.js)
  let ride = null;
  if (fares) {
    ride = new TaxiRide({ roads, hf, hud, router: gps.router, fares, wallet: fares.wallet, save: () => fares.saveWallet(), show: () => fares.showWallet() });
    ride.traffic = traffic;
    scene.add(ride.group);
    ride.onArrive = (x, z, yaw, name, early) => {
      player.placeAt(x, z, yaw, null);
      player.group.visible = true;
      camSnap = true;
      hud.toast(early ? 'You got off early' : `Dropped at ${name.replace(/ Taxi Rank.*$/, '')}`, 2.5);
    };
  }
  // hail a taxi from the roadside / Hamba Ride e-hailing (rides.js)
  let rides = null;
  if (ride) {
    try {
      rides = new Rides({ ride, roads, router: gps.router, hud, fares, shelters, bigmap, player });
      scene.add(rides.group);
    } catch (err) {
      console.warn('[IZK] rides not built', err);
    }
  }
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
  const RIDE_CAM = { name: 'Taxi ride', dist: 8, height: 3.2, ahead: 7, look: 1.6 }; // a passenger: close behind the taxi
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
  let fogRange = 1; // shrinks with the draw distance on slow phones
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

  const riding = () => !!(ride && ride.active);
  function entity() {
    if (ride && ride.active) return ride;
    return inVehicle ? vehicle : onBike ? bike : player;
  }

  function mountBike() {
    if (onBike || inVehicle) return;
    bike.mount(player);
    onBike = true;
    camSnap = true;
    hud.toast('Stick up to pedal, down to brake. RUN = sprint', 2.6);
  }
  function dismountBike() {
    if (!onBike) return;
    bike.dismount();
    onBike = false;
    camSnap = true;
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

  // ---- on foot: one context ACTION button (touch) / F or E (keyboard) ----
  // Enter car / Start lesson / Talk / Pay / Board taxi, from what is nearby.
  const actEl = document.getElementById('t-act');
  let actKind = '';
  let actLabel = '';
  let actT = 0;
  // sets ctxKind / ctxLabel (no allocation: runs 5x a second)
  let ctxKind = '';
  let ctxLabel = '';
  function footContext() {
    const lic = fares && fares.licence;
    const lab = lic ? lic.deskLabel() : '';
    ctxKind = '';
    ctxLabel = '';
    const px = onBike ? bike.x : player.x;
    const pz = onBike ? bike.z : player.z;
    if (lab) {
      ctxKind = 'desk';
      ctxLabel = lab;
    } else if (onBike) {
      ctxKind = 'bike-off';
      ctxLabel = 'Get off';
    } else if (bike.near(px, pz)) {
      ctxKind = 'bike';
      ctxLabel = 'Ride bicycle';
    } else if (Math.abs(player.x - vehicle.x) < 7 && Math.abs(player.z - vehicle.z) < 7 && Math.hypot(player.x - vehicle.x, player.z - vehicle.z) < 6.5) {
      ctxKind = 'car';
      ctxLabel = 'Enter car';
    } else if (ride && fares && (fares.rankNear(px, pz) || fares.stopNear(px, pz))) {
      ctxKind = 'rank';
      ctxLabel = 'Board taxi';
    }
  }
  function updateFootAction(dt) {
    if (inVehicle || riding()) return;
    actT -= dt;
    if (actT > 0) return;
    actT = 0.2;
    footContext();
    if (ctxKind === actKind && ctxLabel === actLabel) return;
    actKind = ctxKind;
    actLabel = ctxLabel;
    if (!actEl) return;
    actEl.classList.toggle('none', !actKind);
    if (actLabel) actEl.textContent = actLabel;
  }
  function footAction() {
    footContext();
    if (ctxKind === 'desk') {
      if (onBike) dismountBike();
      fares.licence.openDesk();
    } else if (ctxKind === 'bike-off') dismountBike();
    else if (ctxKind === 'bike') mountBike();
    else if (ctxKind === 'rank') ride.open(fares.rankNear(player.x, player.z) || fares.stopNear(player.x, player.z));
    else if (ctxKind === 'car') enterVehicle();
  }
  // body classes: on-foot (joystick, RUN, ACTION), on-bike, riding (taxi passenger)
  let footState = -1;
  function syncFootClass() {
    const st = riding() ? 3 : inVehicle ? 0 : onBike ? 2 : 1;
    if (st === footState) return;
    footState = st;
    const cl = document.body.classList;
    cl.toggle('on-foot', st === 1 || st === 2);
    cl.toggle('on-bike', st === 2);
    cl.toggle('riding', st === 3);
    actKind = actLabel = '';
    actT = 0;
  }

  function enterVehicle() {
    // no driving without a licence (driving school first; licence.js)
    const lic = fares && fares.licence;
    if (lic && !lic.canDrive()) {
      hud.toast(lic.why(), 3.2);
      lic.guide(player.x, player.z);
      return;
    }
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
    sunColor.lerp(SUN_WARM, 0.16 * solar.day); // a touch of warmth all day
    sunColor.lerp(SUN_GOLD, solar.golden * 0.85); // soft orange at sunrise / sunset
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

    // dome: deeper blue overhead, pale hazy horizon (warm at golden hour)
    const warmth = solar.golden * Math.min(1, solar.day * 2) * (1 - solar.night);
    skyUni.uTop.value.copy(sky).multiplyScalar(0.82).lerp(SKY_ZENITH_TINT, 0.12 * solar.day);
    skyUni.uHor.value.copy(sky).lerp(HAZE_WHITE, 0.32 * solar.day * (1 - weather.cur.cloud * 0.5)).lerp(SKY_DUSK, warmth * 0.55);
    skyUni.uSunDir.value.copy(sunDir);
    skyUni.uGlow.value.copy(SUN_GOLD).multiplyScalar(solar.day * (0.25 + warmth * 0.9) * (1 - weather.cur.cloud * 0.8));
    skyDome.position.copy(camera.position);
    if (medians.lampHeads) medians.lampHeads.material.emissiveIntensity = solar.night > 0.4 ? 1.4 : 0;
    fogColor.copy(skyUni.uHor.value);
    scene.fog.color.copy(fogColor);
    scene.fog.near = (1100 - solar.night * 600) * weather.cur.fog * fogRange;
    scene.fog.far = (5200 - solar.night * 2300) * weather.cur.fog * fogRange;

    hemi.intensity = (0.3 + solar.day * 1.35) * (1 - weather.cur.cloud * 0.25) + weather.flash * 2.5;
    hemiSky.copy(sky).lerp(daySky, 0.4);
    hemiGround.setHex(season.ground);
    hemi.color.copy(hemiSky);
    hemi.groundColor.copy(hemiGround);

    fill.intensity = 0.15 + solar.day * 0.35;
    SHADOW.strength.value = 0.18 + 0.42 * solar.day * (1 - weather.cur.cloud * 0.6);
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
    // lessons and tests are driven from the driver's seat only (Bheko, 19 Nov)
    const rideNow = riding();
    if (rideNow && ride.inside) {
      // passenger seat, looking out of the windscreen
      cockpit.visible = false;
      if (vehicle.mesh) vehicle.mesh.visible = true;
      if (ride.mesh) ride.mesh.visible = false;
      setNear(0.1);
      ride.group.updateMatrixWorld(true);
      camPos.set(-0.45, 1.75, 0.35);
      ride.group.localToWorld(camPos);
      camLook.set(-0.45, 1.55, 14);
      ride.group.localToWorld(camLook);
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      return;
    }
    if (ride && ride.mesh) ride.mesh.visible = true;
    const schoolCam = inVehicle && fares && fares.licence && fares.licence.atSchool;
    const mode = schoolCam ? CAM_MODES[3] : rideNow ? RIDE_CAM : inVehicle ? CAM_MODES[camMode] : CAM_MODES[0];
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
      const car = inVehicle || rideNow;
      const dist = car ? mode.dist : onBike ? 4.8 : 5.6;
      const height = car ? mode.height : onBike ? 2.25 : 2.5;
      const ahead = car ? mode.ahead : onBike ? 4 : 2.5;
      const look = car ? mode.look : onBike ? 1.4 : 1.35;
      let fx;
      let fz;
      if (car || onBike) {
        fx = Math.sin(ent.yaw);
        fz = Math.cos(ent.yaw);
      }
      else {
        // on foot the camera has its own heading that swings round behind the player
        fx = Math.sin(player.camYaw);
        fz = Math.cos(player.camYaw);
      }

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
    camera.aspect = fitCanvas(); // native pixels again (DPR can change on zoom / screen move)
    camera.updateProjectionMatrix();
    sharp.resize();
  }
  addEventListener('resize', onResize);
  // a DPR change without a resize (browser zoom, moving to another screen)
  const watchDpr = () => {
    try {
      matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { onResize(); watchDpr(); }, { once: true });
    } catch {}
  };
  watchDpr();

  const clock = new THREE.Clock();
  // 24 in-game hours = 4 real hours. Fresh sessions start at 08:00; ?time=HH
  // overrides the start hour and ?resume=1 continues the last saved clock.
  const params = new URLSearchParams(location.search);
  const startHour = params.has('time') ? Number(params.get('time')) || 0 : 8;
  const gameClock = params.get('resume') === '1' || (saved && !params.has('time')) ? GameClock.load({ startHour }) : new GameClock({ startHour });
  const baseClockScale = gameClock.scale;
  let saveTimer = 0;
  let saveBlocked = false;
  function saveNow() {
    if (saveBlocked) return;
    gameClock.save();
    bike.save();
    writeSave({
      x: Math.round(vehicle.x * 10) / 10,
      z: Math.round(vehicle.z * 10) / 10,
      yaw: Math.round(vehicle.yaw * 1000) / 1000,
      car: vehicle.typeId,
      lights: vehicle.lightMode,
      cam: camMode,
      onFoot: !inVehicle,
      px: Math.round((riding() ? ride.x : onBike ? bike.x : player.x) * 10) / 10,
      pz: Math.round((riding() ? ride.z : onBike ? bike.z : player.z) * 10) / 10,
      pyaw: player.yaw || 0,
      dest: gps.dest ? { x: gps.dest.x, z: gps.dest.z, name: gps.dest.name } : null
    });
  }
  // Pause: the world stops while the menu is open or the phone is locked /
  // the app is in the background; sound goes quiet too.
  let paused = false;
  const menuEl = document.getElementById('menu');
  const setPaused = (on) => {
    paused = on;
    pauseAudio(on);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveNow();
      menuEl?.classList.add('open'); // come back to the pause menu
      setPaused(true);
    }
  });
  addEventListener('pagehide', saveNow);
  addEventListener('beforeunload', saveNow);
  // Menu: Resume / New game (back to the CBD start, clears the save).
  {
    const menu = document.getElementById('menu');
    document.getElementById('t-menu')?.addEventListener('pointerup', () => {
      menu?.classList.add('open');
      setPaused(true);
    });
    if (menu) registerDialog(menu, { keepParent: true });
    // lock / unlock game input the moment a popup opens or closes (not a frame later)
    onDialogChange((open) => {
      input.locked = open;
    });
    input.locked = dialogOpen();
    document.getElementById('m-resume')?.addEventListener('click', () => {
      menu?.classList.remove('open');
      setPaused(false);
      lastT = performance.now();
    });
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
  // driving school moves the car (yard, road test) and seats/unseats the player
  if (fares && fares.licence) {
    fares.licence.hooks = {
      put: (x, z, yaw) => {
        if (onBike) dismountBike();
        vehicle.restore(x, z, yaw);
        if (!inVehicle) {
          inVehicle = true;
          player.group.visible = false;
        }
        camSnap = true;
      },
      exit: () => {
        if (inVehicle) exitVehicle();
      },
    };
  }
  // a brand-new player has no licence: start on foot at the driving school
  if (!saved && fares && fares.licence && !fares.licence.licensed && !params0.has('x')) {
    const st = fares.licence.startSpot();
    vehicle.restore(st.cx, st.cz, st.yaw); // the school car waits at the school kerb
    inVehicle = false;
    player.placeAt(st.px, st.pz, st.yaw, null);
    player.group.visible = true;
    camSnap = true;
    // first, choose where you live (home.js): you then start at your front door
    fares.homes.hooks.moveIn = (h) => {
      bike.parkAtHome(h);
      player.placeAt(h.x, h.z, h.yaw, null);
      camSnap = true;
      fares.licence.guide(h.x, h.z);
    };
    if (fares.homes.list.length) setTimeout(() => fares.homes.choose(), 1200);
    else setTimeout(() => hud.toast('First stop: your licence. Walk into the yellow ring at the school.', 5), 2500);
  } else if (saved && saved.onFoot && Number.isFinite(saved.px)) {
    inVehicle = false;
    player.placeAt(saved.px, saved.pz, saved.pyaw || 0, null);
    player.group.visible = true;
    camSnap = true;
  }
  // an owned house without a bike yet (older saves): it waits at the door
  if (!bike.placed && fares && fares.homes.home) bike.parkAtHome(fares.homes.home);
  let helpTimer = 0;
  let clockSaveTimer = 0;

  // Audio needs a user gesture before it can start (Android WebView too).
  const unlockOnce = () => {
    if (!paused) unlockAudio();
  };
  addEventListener('pointerdown', unlockOnce, { passive: true });
  addEventListener('keydown', unlockOnce);

  let frameErrShown = false;
  let bootFrames = 0;
  let bootTime = 0;
  let slowFrames = 0;
  let streetLifeAge = 0;
  let resT = 0, resSum = 0, resN = 0;
  const setRange = (r) => {
    roads.range = r;
    if (buildings) buildings.range = r;
    fogRange = r;
  };
  // ---- HD mode: invisible performance safety (no menu, no toasts) -------
  // FULL SHARPNESS never changes: native pixel ratio, HD textures with
  // mipmaps + max anisotropy, and the sharpen/FXAA pass all stay, always.
  // Slow frames trim, in this order: draw distance, shadows, people/traffic
  // density, grass tufts + tree density, mirror update rate, then (last
  // resort) all of those harder. Headroom restores in reverse.
  const gfxStats = { ms: 0, steps: 0, upBlock: 0, lastUp: -1e9 };
  const caps = GFX.caps;
  const blobMat = blobMaterial();
  const humanCap = () => (streetLife.humans ? streetLife.humans.cap : caps.humanCap);
  const setHumanCap = (c) => {
    if (streetLife.humans) streetLife.humans.cap = Math.max(1, Math.min(c, streetLife.humans.cand.length));
  };
  const setTufts = (d) => tufts.setDensity && tufts.setDensity(d);
  const tuftD = () => (tufts.density == null ? caps.tufts : tufts.density);
  const trafD = () => (traffic.density == null ? 1 : traffic.density);
  const setTraf = (d) => (traffic.density = Math.max(0, Math.min(1, d)));
  const treeD = () => (props.treeLod == null ? 1 : props.treeLod);
  const setTrees = (d) => props.setTreeLod && props.setTreeLod(d);
  const mirE = () => GFX.live.mirrorEvery;
  const setMir = (n) => (GFX.live.mirrorEvery = Math.max(1, Math.min(6, n | 0)));
  const E = 1e-3;
  // the native pixel ratio is the only resolution there is: put it back if
  // anything (a resize race, an old code path) ever moved it
  const keepNative = () => {
    const pr = nativePx();
    if (Math.abs(renderer.getPixelRatio() - pr) > E) onResize();
  };
  function gfxAdapt(avg) {
    const now = performance.now();
    const rg = roads.range;
    keepNative();
    if (sharp.target && !sharp.enabled && !sharp.debugOff) sharp.enabled = true; // never off
    if (avg > 0.03) {
      if (now - gfxStats.lastUp < 7000) gfxStats.upBlock = now + 30000;
      gfxStats.steps++;
      if (rg > 0.5 + E) setRange(Math.max(0.5, rg - 0.15)); // 1. draw distance
      else if (blobMat.visible) blobMat.visible = false; // 2. shadows
      else if (humanCap() > 6) setHumanCap(Math.max(6, Math.round(humanCap() * 0.6))); // 3. people
      else if (trafD() > 0.5 + E) setTraf(Math.max(0.5, trafD() - 0.25)); // 3. traffic density
      else if (tuftD() > 0.3 + E) setTufts(Math.max(0.3, tuftD() - 0.25)); // 4. grass tufts
      else if (treeD() > 0.6 + E) setTrees(Math.max(0.6, treeD() - 0.2)); // 4. tree density / LOD
      else if (mirE() < 3) setMir(mirE() + 1); // 5. mirror update rate
      // last resort: the same things, harder (never pixels)
      else if (rg > 0.35 + E) setRange(0.35);
      else if (humanCap() > 3) setHumanCap(3);
      else if (trafD() > 0.3 + E) setTraf(0.3);
      else if (tuftD() > E) setTufts(0);
      else if (treeD() > 0.4 + E) setTrees(0.4);
      else if (mirE() < 5) setMir(5);
      else gfxStats.steps--;
    } else if (avg < 0.021 && now > gfxStats.upBlock) {
      gfxStats.lastUp = now;
      if (mirE() > 3) setMir(3);
      else if (treeD() < 0.6 - E) setTrees(0.6);
      else if (tuftD() < 0.3 - E) setTufts(0.3);
      else if (trafD() < 0.5 - E) setTraf(0.5);
      else if (humanCap() < 6) setHumanCap(6);
      else if (rg < 0.5 - E) setRange(0.5);
      else if (mirE() > caps.mirrorEvery) setMir(mirE() - 1);
      else if (treeD() < caps.trees - E) setTrees(Math.min(caps.trees, treeD() + 0.2));
      else if (tuftD() < caps.tufts - E) setTufts(Math.min(caps.tufts, tuftD() + 0.25));
      else if (trafD() < caps.traffic - E) setTraf(Math.min(caps.traffic, trafD() + 0.25));
      else if (humanCap() < caps.humanCap) setHumanCap(Math.min(caps.humanCap, humanCap() + 6));
      else if (!blobMat.visible && caps.blobs) blobMat.visible = true;
      else if (rg < caps.range - E) setRange(Math.min(caps.range, rg + 0.1));
      else gfxStats.lastUp = -1e9;
    }
  }
  blobMat.visible = caps.blobs;
  setTraf(caps.traffic);
  setTrees(caps.trees);
  setRange(caps.range);
  setHumanCap(caps.humanCap);
  let lastT = performance.now();
  let beatT = 0;
  const fullView = new THREE.Vector2();
  function frame() {
    requestAnimationFrame(frame);
    const t = performance.now();
    const raw = (t - lastT) / 1000;
    lastT = t;
    // tell the Android app we're alive (its freeze watchdog), once a second
    if (window.IZKNative && t - beatT > 1000) {
      beatT = t;
      try {
        window.IZKNative.ping();
      } catch {}
    }
    if (paused) return; // nothing moves; the last frame stays on screen
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
      if (bootTime > 8 && bootFrames > 80) {
        setBoot(null);
        bootFrames = -1;
      }
    }
    // Invisible performance safety: aim for ~33-45 fps on any phone while
    // the HD look stays (see gfxAdapt). Headroom restores in reverse. A step up that makes things slow again blocks steps up for
    // 30 s, so it does not flip-flop.
    resT += Math.min(raw, 0.1);
    resSum += raw;
    resN++;
    if (resT > 3) {
      const avg = resSum / resN;
      gfxStats.ms = Math.round(avg * 10000) / 10;
      if (streetLife.humans && !gfxStats.humansInit) {
        gfxStats.humansInit = true;
        setHumanCap(caps.humanCap);
      }
      gfxAdapt(avg);
      resT = resSum = resN = 0;
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
    // real time up to 0.1 s per frame, so slow frames don't turn into slow motion
    const dt = Math.min(clock.getDelta(), 0.1);
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

    input.locked = dialogOpen(); // a popup is open: no driving / walking input
    if (input.takePressed('camera')) {
      if (riding()) ride.inside = !ride.inside;
      else if (fares && fares.licence && fares.licence.atSchool) hud.toast('Driving school: driver view only', 1.4);
      else {
        camMode = (camMode + 1) % CAM_MODES.length;
        hud.toast(CAM_MODES[camMode].name, 1.4);
      }
    }
    if (input.takePressed('horn')) {
      unlockAudio();
      honk();
      if (inVehicle) traffic.playerHoot(ent.x, ent.z, Math.sin(ent.yaw), Math.cos(ent.yaw));
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
      else footAction();
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
    syncFootClass();
    updateFootAction(dt);
    // car/player physics in small steps so a long frame stays stable
    if (rides) rides.update(dt, !inVehicle && !onBike && !riding() ? player : null);
    if (riding()) ride.update(dt); // moves itself along the route (x1 / x4)
    else {
      const n = Math.ceil(dt / 0.034);
      for (let k = 0; k < n; k++) ent.update(dt / n);
    }
    // the clock runs x4 too while fast-forwarding a taxi ride
    gameClock.scale = baseClockScale * (riding() ? ride.ff : 1);
    hud.updateGear?.(inVehicle ? input.gear : '');
    updateCamera(dt, !cameraReady || camSnap);
    if (shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
      shake *= Math.max(0, 1 - dt * 6);
    } else shake = 0;
    roadFeel(dt);
    if (harbour) harbour.update(dt, performance.now() / 1000);
    if (trains) trains.update(dt, ent.x, ent.z);
    if (crashToastCd > 0) crashToastCd -= dt;
    cameraReady = true;
    camSnap = false;

    const arrival = gps.update(ent.x, ent.z, ent.yaw);
    if (arrival && !(fares && fares.onArrive(arrival))) hud.toast(`Arrived at ${arrival.name}`, 3);
    if (fares) {
      if (fares.licence) fares.licence.passenger = riding(); // no school desks from a taxi window
      fares.update(dt, ent, inVehicle, vehicle, now);
    }
    if (learners) learners.update(dt, camera.position.x, camera.position.z, now);
    if (busStations) busStations.update(camera.position.x, camera.position.z);
    if (shelters) shelters.update(camera.position.x, camera.position.z);

    // traffic sees the car, the bike (a slow car) or the taxi you ride in
    traffic.player = riding() ? ride : onBike ? bike : vehicle;
    traffic.playerActive = inVehicle || onBike || riding();
    traffic.playerIsCop = inVehicle && vehicle.typeId === 'saps';
    traffic.busy = streetLife.busyAt(ent.x, ent.z, now.getHours() + now.getMinutes() / 60);
    {
      const n = Math.ceil(dt / 0.05);
      for (let k = 0; k < n; k++) traffic.update(dt / n, ent.x, ent.z);
    }
    roads.update(camera.position.x, camera.position.z);
    if (buildings) buildings.update(camera.position.x, camera.position.z, 1);
    if (kasi) kasi.update(camera.position.x, camera.position.z);
    if (osmDetail) osmDetail.update(camera.position.x, camera.position.z);
    if (grounds) grounds.update(camera.position.x, camera.position.z);
    props.update(camera.position.x, camera.position.z, dt, 1);
    tufts.update(camera.position.x, camera.position.z);
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
    updateEngine(dt, inVehicle ? vehicle.speedKmh : 0, inVehicle ? vehicle.throttleNow || 0 : 0, inVehicle, traffic.nearest(ent.x, ent.z, 3), vehicle.typeId);

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

    sharp.render(scene, camera);
    mirrorFrame();
    if (fares && fares.licence) fares.licence.renderMirrors(renderer, scene, vehicle, inVehicle, cockpit.visible);
    // mirrors reset the viewport from the canvas' rounded CSS size; put back the
    // exact full-frame viewport so the next frame maps 1:1 (no sub-pixel blur)
    renderer.getSize(fullView);
    renderer.setViewport(0, 0, fullView.x, fullView.y);
  }

  setLoad(100, 'Ready');
  document.getElementById('loading').classList.add('done');
  const now = gameClock.now();
  updateEnvironment(now);
  updateCamera(0, true);
  roads.update(camera.position.x, camera.position.z, 1e9); // build nearby road detail up front
  if (buildings) buildings.update(camera.position.x, camera.position.z, 400);
  if (kasi) kasi.update(camera.position.x, camera.position.z);
  if (osmDetail) osmDetail.update(camera.position.x, camera.position.z);
  props.update(camera.position.x, camera.position.z, 0, 12);
  tufts.update(camera.position.x, camera.position.z, true);
  realLandmarks.update(camera.position.x, camera.position.z);
  cameraReady = true;
  // Small debug handle for automated checks / console tinkering.
  window.__izk = { shelters, tufts, gfx: { GFX, stats: gfxStats, state: () => ({ setting: GFX.setting, safety: caps.safety, rescued: GFX.rescued, detected: GFX.detected, signals: GFX.signals, px: renderer.getPixelRatio(), native: nativePx(), buffer: [renderer.domElement.width, renderer.domElement.height], css: [renderer.domElement.style.width, renderer.domElement.style.height], range: roads.range, blobs: blobMat.visible, humans: humanCap(), tufts: tuftD(), traffic: trafD(), trees: treeD(), mirrorEvery: mirE(), hd: caps.hd, normals: caps.normals, aniso: caps.aniso, sharp: sharp.enabled, ms: gfxStats.ms, steps: gfxStats.steps }) }, busStations, learners, fares, kasi, osmDetail, trains, harbour, grounds, THREE, scene, camera, renderer, vehicle, roads, hf, gameClock, weather, traffic, streetLife, buildings, city, props, dirSigns, gps, bigmap, medians, water, realLandmarks };
  // test hooks: player on foot, street life now (no slow-frame watchdog)
  window.__izk.player = player;
  window.__izk.bike = bike;
  window.__izk.ride = ride;
  window.__izk.rides = rides;
  window.__izk.mountBike = mountBike;
  window.__izk.dismountBike = dismountBike;
  window.__izk.state = () => ({ inVehicle, onBike, riding: riding(), act: actLabel });
  window.__izk.onFoot = (x, z, yaw) => {
    player.placeAt(x, z, yaw || 0, null);
    player.group.visible = true;
    inVehicle = false;
    camSnap = true;
  };
  window.__izk.streetNow = () => {
    streetLifeDelay = 0;
    streetLifeAge = -1e9;
  };
  hud.updateTime(now, seasonForDate(now), solarState(now).night > 0.5);
  try {
    sharpenTextures(scene, renderer, 16);
    // textures that stream in after the first frame (signs, shelters, people)
    setTimeout(() => { try { sharpenTextures(scene, renderer, 16); } catch {} }, 20000);
    renderer.compile(scene, camera); // warm shaders on the loading screen
  } catch {}
  setBoot('running');
  addEventListener('pagehide', () => { if (bootFrames < 0 || bootTime > 3) setBoot(null); });
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
