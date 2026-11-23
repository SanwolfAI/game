import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';
import { WORLD } from './worldLight.js';
import { groundGrass, lushGrass } from './hdTextures.js';

const TEX = './src/assets/textures/';
const texLoader = new THREE.TextureLoader();
function tex(file, srgb = true) {
  const t = texLoader.load(TEX + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Land-cover mask from OSM areas, sampled by the ground shader:
// R = vegetation (parks, woods, sports fields), G = paved (CBD, industrial,
// parking, retail), B = sand. Covers `box` (world metres) at ~16 m per pixel.
export function buildLandcover(areas, box) {
  const W = 1024;
  const H = Math.round((W * (box.maxZ - box.minZ)) / (box.maxX - box.minX));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const sx = W / (box.maxX - box.minX);
  const sz = H / (box.maxZ - box.minZ);
  // CBD core is paved
  const cg = g.createRadialGradient(-box.minX * sx, -box.minZ * sz, 0, -box.minX * sx, -box.minZ * sz, 1500 * sx);
  cg.addColorStop(0, 'rgba(0,230,0,1)');
  cg.addColorStop(0.75, 'rgba(0,180,0,1)');
  cg.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = cg;
  g.fillRect(0, 0, W, H);
  const COLORS = {
    wood: 'rgb(255,0,0)', reserve: 'rgb(255,0,0)', scrub: 'rgb(200,0,0)', park: 'rgb(190,0,0)', golf: 'rgb(230,0,0)',
    pitch: 'rgb(240,0,0)', grass: 'rgb(150,0,0)', cemetery: 'rgb(140,0,0)', school: 'rgb(90,40,0)', wetland: 'rgb(170,0,0)',
    industrial: 'rgb(0,200,0)', commercial: 'rgb(0,170,0)', retail: 'rgb(0,200,0)', parking: 'rgb(0,255,0)', port: 'rgb(0,230,0)',
    sand: 'rgb(0,0,255)', farmland: 'rgb(110,30,0)'
  };
  for (const a of areas || []) {
    const col = COLORS[a.k];
    if (!col) continue;
    g.fillStyle = col;
    g.beginPath();
    for (let i = 0; i < a.p.length; i += 2) {
      const x = (a.p[i] - box.minX) * sx;
      const y = (a.p[i + 1] - box.minZ) * sz;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function createGroundMaterial(landcover, box) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const grass = groundGrass(() => tex('sparse_grass_512.jpg'));
  // real lawn/veld grass blades (ambientCG Grass004, CC0) on every tier:
  // 1K with HD textures on, 512 otherwise (budget phones under 4 GB)
  const lush = lushGrass(() => tex('grass004_512.jpg'));
  const dry = tex('dry_ground_01_512.jpg');
  const sand = tex('coast_sand_01_512.jpg');
  const rock = tex('aerial_grass_rock_512.jpg');
  const paved = tex('concrete_pavement_diff_1k.jpg');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tGrass: { value: grass },
      tLush: { value: lush },
      tDry: { value: dry },
      tSand: { value: sand },
      tRock: { value: rock },
      tPaved: { value: paved },
      tCover: { value: landcover },
      uCoverBox: { value: new THREE.Vector4(box.minX, box.minZ, 1 / (box.maxX - box.minX), 1 / (box.maxZ - box.minZ)) }
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldP;
uniform sampler2D tGrass, tLush, tDry, tSand, tRock, tPaved, tCover;
uniform vec4 uCoverBox;`
      )
      .replace(
        '#include <color_fragment>',
        `vec2 wp = vWorldP.xz;
vec3 g1 = texture2D(tGrass, wp / 17.0).rgb;
vec3 g2 = texture2D(tGrass, wp.yx / 61.0 + 0.37).rgb;
// HD grass: real blades at 2.6 m, a rotated 11 m copy to break the tiling,
// and two slow noise layers (170 m / 480 m) for lush, darker and dry,
// yellowed patches so no repeat shows from the road
vec3 lN = texture2D(tLush, wp / 2.6).rgb;
vec3 lM = texture2D(tLush, wp.yx / 11.3 + 0.21).rgb;
vec3 lush = mix(lN, lM, 0.3) * vec3(1.25, 1.72, 1.3);
lush *= clamp(0.5 + 0.5 * dot(lN, vec3(0.3, 0.59, 0.11)) / 0.12, 0.55, 1.6); // crisper blades
lush *= 0.72 + 0.56 * texture2D(tDry, wp.yx / 31.0 + 0.47).g; // mown / long patches
lush = mix(lush, vec3(dot(lush, vec3(0.3, 0.59, 0.11))), 0.22); // less lime, more KZN lawn
float n1 = texture2D(tDry, wp / 173.0 + 0.13).g;
float n2 = texture2D(tDry, wp.yx / 487.0 + 0.61).r;
lush *= 0.78 + 0.5 * n1;
lush = mix(lush, lush * vec3(1.2, 1.05, 0.7), smoothstep(0.4, 0.8, n2) * 0.6);
vec3 grassC = mix(lush, mix(g1, g2, 0.45) * vec3(0.95, 1.0, 0.8), 0.2 + 0.25 * smoothstep(0.5, 0.8, n2));
vec3 dryC = mix(texture2D(tDry, wp / 23.0).rgb, grassC, 0.35);
vec3 sandC = texture2D(tSand, wp / 13.0).rgb;
vec3 rockC = texture2D(tRock, wp / 37.0).rgb;
vec3 pavedC = texture2D(tPaved, wp / 9.0).rgb * vec3(0.95, 0.93, 0.9);
float macro = texture2D(tDry, wp / 900.0).r;
vec2 cuv = (wp - uCoverBox.xy) * uCoverBox.zw;
vec4 cover = vec4(0.0);
if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) cover = texture2D(tCover, cuv);
vec3 base = mix(grassC, dryC, clamp(vColor.g * 0.45 + (macro - 0.5) * 0.9, 0.0, 0.5));
base = mix(base, rockC, clamp(vColor.b, 0.0, 1.0) * 0.7);
base = mix(base, grassC * vec3(0.85, 1.12, 0.78), cover.r);
base = mix(base, pavedC, cover.g * 0.9);
base = mix(base, sandC, clamp(max(vColor.r, cover.b), 0.0, 1.0));
diffuseColor.rgb *= base;`
      );
  };
  mat.customProgramCacheKey = () => 'izk-ground-v2';
  return mat;
}

// Animated ocean: two scrolling normal maps, fresnel sky reflection and sun
// glint. No reflection render pass, so it is cheap on phones.
export function createOceanMaterial() {
  const normals = tex('waternormals.jpg', false);
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      tNormal: { value: null },
      uDeep: { value: new THREE.Color('#0c4a6e') },
      uShallow: { value: new THREE.Color('#1f8aa8') },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) }
    }
  ]);
  uniforms.tNormal.value = normals;
  uniforms.uTime = WORLD.time;
  uniforms.uSky = WORLD.sky;
  uniforms.uDay = WORLD.day;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `
uniform sampler2D tNormal;
uniform float uTime;
uniform float uDay;
uniform vec3 uSky, uDeep, uShallow, uSunDir, uSunColor;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz;
  vec3 n1 = texture2D(tNormal, p / 47.0 + vec2(uTime * 0.012, uTime * 0.008)).rgb;
  vec3 n2 = texture2D(tNormal, p / 113.0 - vec2(uTime * 0.006, -uTime * 0.01)).rgb;
  vec3 n = normalize((n1 + n2 - 1.0).xzy * vec3(1.0, 2.2, 1.0));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 water = mix(uDeep, uShallow, 0.35 + 0.3 * n.x);
  vec3 col = mix(water * (0.25 + 0.75 * uDay), uSky * 1.05, clamp(fres * 0.85 + 0.08, 0.0, 1.0));
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, normalize(uSunDir)), 0.0), 180.0);
  col += uSunColor * spec * 2.5 * uDay;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`
  });
  return mat;
}

const SAND = new THREE.Color('#e6d3a3');
const SAND_WET = new THREE.Color('#cbb98d');
const GRASS = new THREE.Color('#6f9b52');
const GRASS_DRY = new THREE.Color('#9aa85c');
const DIRT = new THREE.Color('#8a7355');
const ROCK = new THREE.Color('#9a938a');
const SEABED = new THREE.Color('#5d7f8c');

// Terrain mesh built straight from the OSM coastline height field.
export function buildTerrain(hf, coastXZ, step = 2, groundMaterial = null) {
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

  // vertex colour = splat weights for the ground shader: r sand, g dry, b rock
  const colorFor = (x, z, h, d, water) => {
    if (water) return new THREE.Color(1, 0, 0);
    const sand = d < 60 ? 1 : d < 120 ? 1 - (d - 60) / 60 : 0;
    const n = Math.sin(x * 0.0013) * Math.cos(z * 0.0017) + Math.sin((x + z) * 0.0004) * 0.6;
    const dry = clamp(0.25 + n * 0.25 + (h > 45 ? 0.15 : 0), 0, 1);
    const rock = clamp((h - 140) / 120, 0, 0.8);
    return new THREE.Color(sand, dry, rock);
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

  const mat = groundMaterial || new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrainMesh';
  mesh.receiveShadow = false;
  group.add(mesh);

  // Ocean
  const oceanGeo = new THREE.PlaneGeometry(400000, 400000, 1, 1);
  const oceanMat = createOceanMaterial();
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
    colors.push(0.78, 0.74, 0.66);
    positions.push(innerX, Math.max(0.05, hf.heightAt(innerX, innerZ)), innerZ);
    colors.push(1.05, 1.0, 0.92);
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
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    uv[i * 2] = positions[i * 3] / 14;
    uv[i * 2 + 1] = positions[i * 3 + 2] / 14;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: tex('coast_sand_01_512.jpg') });
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
