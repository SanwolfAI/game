import * as THREE from '../../vendor/three/three.module.js';
import { buildFacadeArray, LAYER } from './facades.js';
import { buildingDetail } from './hdTextures.js';
import { WORLD } from './worldLight.js';
import { mulberry32 } from '../core/utils.js';

// Real OSM building footprints (src/data/durban-buildings.bin, packed by
// scripts/build-buildings.mjs), extruded into textured buildings and streamed
// in 250 m cells. Low buildings stream close to the camera; tall ones (the
// skyline) stream in 1 km cells out to the fog. Every cell is one merged mesh
// with one shared material, so draw calls stay low.
// NOTE: loops only (no spread of big arrays) — Android WebView stacks are small.

const CELL = 250;
const FAR_CELL = 1000;
const NEAR_IN = 720;
const NEAR_OUT = 900;
const FAR_IN = 4300;
const FAR_OUT = 4900;
const TALL = 13; // m: taller buildings belong to the far (skyline) layer

const KIND = { yes: 0, house: 1, apartments: 2, commercial: 3, industrial: 4, small: 5, civic: 6, terrace: 7, tank: 8, hotel: 9, roof: 10, construction: 11 };
const ZONE = { none: 0, industrial: 1, commercial: 2, retail: 3, port: 4, park: 5, school: 6, residential: 7, cemetery: 8 };

const hex = (h) => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};
const HOUSE_WALLS = ['#f4f1ea', '#efe6d2', '#f3e3b8', '#e9e9e4', '#f0d9c4', '#dfe7ea', '#e8dcc5', '#f6f2e6'].map(hex);
const RDP_WALLS = ['#d9c7a6', '#c9b28d', '#e4d6bb', '#cfbfa7', '#bfae95', '#d6d0c2'].map(hex);
const SHACK = ['#9b5a3a', '#7d8a93', '#6f7f8a', '#a8a39a', '#4f6f8f', '#8d6e4f', '#5f7f5f'].map(hex);
const TILE_ROOF = ['#9b4a32', '#7c3b2a', '#4a4a4c', '#5d3a2c', '#3c4148', '#8a5a3c', '#6b6b66'].map(hex);
// rural KZN homesteads: bright painted block houses, white/cream rondavels with thatch
const RURAL_WALLS = ['#9fd3b5', '#f2b8c6', '#a9cbe8', '#f4e3a1', '#f7f5ee', '#e8b48a', '#c5e3a5', '#f0f0f0'].map(hex);
// Wealthy suburbs (world metres, radius): big plots become mansions.
// Umhlanga Rocks/Prestondale, La Lucia, Glenashley, Durban North,
// Morningside/Berea, Westville, Kloof.
const RICH = [[5900, -15400, 1600], [4600, -12000, 1500], [2900, -9300, 1500], [1300, -7600, 1300], [-1600, -3000, 900], [-8900, -3200, 1500], [-18000, -7600, 1800]];
const MANSION_WALLS = ['#ffffff', '#f7f3ea', '#efe8da', '#e6dfd2', '#d9d4cb', '#f3ead6', '#c9c3b8'].map(hex);
const MANSION_ROOF = ['#3a3d42', '#2f3236', '#55483f', '#8a4a32', '#9b5a3c', '#474b50'].map(hex);
const POOL_WATER = hex('#2fb6d8');
const POOL_DECK = hex('#f2efe8');
const richAt = (x, z) => {
  for (const [rx, rz, r] of RICH) if ((x - rx) * (x - rx) + (z - rz) * (z - rz) < r * r) return true;
  return false;
};
const THATCH = ['#b8995e', '#a88a52', '#c2a56c', '#9c8150'].map(hex);
const IRON_ROOF = ['#9aa0a3', '#8a4a3a', '#4f6a55', '#b5b8b9', '#7a7f82'].map(hex);
const CBD_WALLS = ['#f2efe8', '#e6e1d6', '#d9d6cf', '#efe6d6', '#cfd5da', '#e9e4dc', '#d8cbb6'].map(hex);
const FLAT_WALLS = ['#f1ece2', '#e9e2d3', '#f5f1e8', '#e3dccd', '#f0e7d8'].map(hex);
const WHITE = hex('#ffffff');
// hospitals: SA public + private hospitals are mostly cream/white/pale grey
const HOSP_WALLS = ['#f4f1ea', '#ece6d6', '#f7f6f2', '#e4ded0', '#e9ecee', '#efe9dc'].map(hex);
const CLINIC_ROOF = ['#3f6b4f', '#8a3b2e', '#4a5f78', '#9aa0a3'].map(hex);
const IND_WALLS = ['#d9dcdd', '#c9ced1', '#e3e1da', '#b9c2c8', '#d8d2c4'].map(hex);

// --- small growable float buffer --------------------------------------------------
class Grow {
  constructor(n = 4096) {
    this.a = new Float32Array(n);
    this.n = 0;
  }
  need(k) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Float32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  done() {
    return this.a.slice(0, this.n);
  }
}

class GeoBuf {
  constructor() {
    this.pos = new Grow(8192);
    this.nor = new Grow(8192);
    this.col = new Grow(8192);
    this.fac = new Grow(8192);
    this.tris = 0;
  }
  // one vertex
  v(x, y, z, nx, ny, nz, c, fu, fv, layer, w) {
    const p = this.pos;
    p.need(3);
    p.a[p.n++] = x;
    p.a[p.n++] = y;
    p.a[p.n++] = z;
    const n = this.nor;
    n.need(3);
    n.a[n.n++] = nx;
    n.a[n.n++] = ny;
    n.a[n.n++] = nz;
    const cc = this.col;
    cc.need(3);
    cc.a[cc.n++] = c[0];
    cc.a[cc.n++] = c[1];
    cc.a[cc.n++] = c[2];
    const f = this.fac;
    f.need(4);
    f.a[f.n++] = fu;
    f.a[f.n++] = fv;
    f.a[f.n++] = layer;
    f.a[f.n++] = w;
  }
  geometry() {
    if (this.pos.n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.done(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.done(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.done(), 3));
    g.setAttribute('facade', new THREE.BufferAttribute(this.fac.done(), 4));
    g.computeBoundingSphere();
    return g;
  }
}

// HD tiers: world-space brick / plaster / corrugated iron detail (and normal
// maps on High). World coords are re-based on the camera in 54 m steps
// (a multiple of every sample size) so phones keep float precision.
const HD_PARS = `
varying vec3 vWP;
varying vec3 vWN;
uniform sampler2D tBrick, tPlaster, tIron;
#ifdef IZK_HDN
uniform sampler2D nBrick, nPlaster, nIron;
vec3 izkPerturb(vec3 eye, vec3 n, vec3 mapN, vec2 uv) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 T = q1p * st0.x + q0p * st1.x;
  vec3 B = q1p * st0.y + q0p * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + n * mapN.z);
}
#endif
float izkLum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }`;
const HD_COLOR = `
float izkL = floor(vFacade.z + 0.5);
vec3 izkN = normalize(vWN);
bool izkRoof = abs(izkN.y) > 0.5;
vec2 izkUV = izkRoof ? vWP.xz : vec2(dot(vWP.xz, normalize(vec2(-izkN.z, izkN.x) + 1e-5)), vWP.y);
float izkWall = 1.0 - fWin;
int izkK = 0; // 1 brick, 2 plaster, 3 iron
if (!izkRoof && izkL > 6.5 && izkL < 7.5) izkK = 1;
else if (!izkRoof && (izkL < 0.5 || (izkL > 1.5 && izkL < 5.5) || (izkL > 10.5 && izkL < 11.5))) izkK = 2;
else if (izkRoof && izkL > 9.5 && izkL < 10.5) izkK = 3;
if (izkK == 1) {
  // only where the painted facade is brick-red (keeps white window frames)
  float red = clamp((fTex.r - fTex.b) * 5.0 - 0.4, 0.0, 1.0);
  vec3 b = texture2D(tBrick, izkUV).rgb;
  diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb * b * vec3(1.6, 1.45, 1.35), izkWall * red);
} else if (izkK == 2) {
  float m = izkLum(texture2D(tPlaster, izkUV * 0.5).rgb) / 0.445;
  diffuseColor.rgb *= mix(1.0, m, 0.55 * izkWall);
} else if (izkK == 3) {
  float m = izkLum(texture2D(tIron, izkUV / 2.7).rgb) / 0.343;
  diffuseColor.rgb *= mix(1.0, m, 0.85);
}`;
const HD_NORMAL = `
#ifdef IZK_HDN
if (izkK > 0 && izkWall > 0.5 && (izkK != 1 || fTex.r - fTex.b > 0.12)) {
  vec3 mn = izkK == 1 ? texture2D(nBrick, izkUV).xyz : izkK == 2 ? texture2D(nPlaster, izkUV * 0.5).xyz : texture2D(nIron, izkUV / 2.7).xyz;
  mn = mn * 2.0 - 1.0;
  mn.xy *= 0.8;
  normal = izkPerturb(-vViewPosition, normal, mn, izkUV);
}
#endif`;

export function createBuildingMaterial(tex) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hd = buildingDetail();
  if (hd) {
    mat.defines = { IZK_HD: '' };
    if (hd.N) mat.defines.IZK_HDN = '';
  }
  mat.onBeforeCompile = (shader) => {
    if (hd) Object.assign(shader.uniforms, hd.uniforms);
    shader.uniforms.facadeTex = { value: tex };
    shader.uniforms.uNight = WORLD.night;
    shader.uniforms.uDay = WORLD.day;
    shader.uniforms.uSky = WORLD.sky;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    if (hd)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\n{ vec4 wq = modelMatrix * vec4(transformed, 1.0); vWP = wq.xyz - floor(cameraPosition / 54.0) * 54.0; vWN = normalize(mat3(modelMatrix) * objectNormal); }'
        );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2DArray facadeTex;
uniform float uNight;
uniform float uDay;
uniform vec3 uSky;
varying vec4 vFacade;
float fHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }` + (hd ? HD_PARS : '')
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec4 fTex = texture(facadeTex, vec3(vFacade.xy, floor(vFacade.z + 0.5)));
float fWin = fTex.a;
diffuseColor.rgb = mix(diffuseColor.rgb * fTex.rgb, fTex.rgb, fWin);` + (hd ? HD_COLOR : '')
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + (hd ? HD_NORMAL : ''))
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float seed = fract(vFacade.w);
  float litFrac = floor(vFacade.w) * 0.1;
  vec2 cell = floor(vFacade.xy * 4.0);
  float r = fHash(cell + seed * 131.0);
  float lit = step(r, litFrac) * fWin;
  vec3 warm = mix(vec3(1.0, 0.7, 0.36), vec3(0.8, 0.88, 1.0), step(0.72, fHash(cell.yx + seed * 71.0)));
  totalEmissiveRadiance += warm * lit * uNight * (0.75 + 0.6 * fHash(cell * 1.7 + seed));
  vec3 vd = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(abs(dot(vd, normal)), 0.0, 1.0), 2.0);
  totalEmissiveRadiance += uSky * fWin * (0.1 + 0.5 * fres) * uDay * 0.8;
}`
      );
  };
  mat.customProgramCacheKey = () => 'izk-building-v1' + (hd ? (hd.N ? '-hdn' : '-hd') : '');
  return mat;
}

// World-space box covered by the footprint data (see scripts/fetch-buildings.mjs).
const COVER = { minX: -7890, maxX: 7540, minZ: -17540, maxZ: 6770 };

export class Buildings {
  static covers(x, z) {
    return x > COVER.minX && x < COVER.maxX && z > COVER.minZ && z < COVER.maxZ;
  }

  constructor(buffer, hf, roads) {
    this.hf = hf;
    this.roads = roads;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    const dv = new DataView(buffer);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'IZKB') throw new Error('Bad buildings file');
    const count = dv.getUint32(8, true);
    const deltaCount = dv.getUint32(12, true);
    this.count = count;
    let o = 16;
    this.kind = new Uint8Array(buffer, o, count);
    o += count;
    this.zone = new Uint8Array(buffer, o, count);
    o += count;
    this.levels = new Uint8Array(buffer, o, count);
    o += count;
    this.npts = new Uint8Array(buffer, o, count);
    o += count;
    this.heightDm = new Uint16Array(buffer.slice(o, o + count * 2));
    o += count * 2;
    o = (o + 3) & ~3;
    this.start = new Int32Array(buffer, o, count * 2);
    o += count * 8;
    this.delta = new Int16Array(buffer, o, deltaCount * 2);

    this.off = new Uint32Array(count);
    this.cx = new Float32Array(count);
    this.cz = new Float32Array(count);
    this.area = new Float32Array(count);
    this.state = new Uint8Array(count); // 0 unknown, 1 ok, 2 rejected
    this.cells = new Map();
    let d = 0;
    for (let i = 0; i < count; i++) {
      this.off[i] = d;
      const n = this.npts[i];
      let x = this.start[i * 2];
      let z = this.start[i * 2 + 1];
      let sx = x;
      let sz = z;
      let a2 = 0;
      const x0 = x;
      const z0 = z;
      for (let k = 1; k < n; k++) {
        const nx = x + this.delta[(d + k - 1) * 2];
        const nz = z + this.delta[(d + k - 1) * 2 + 1];
        a2 += x * nz - nx * z;
        x = nx;
        z = nz;
        sx += x;
        sz += z;
      }
      a2 += x * z0 - x0 * z;
      d += n - 1;
      const cxm = sx / n / 10;
      const czm = sz / n / 10;
      this.cx[i] = cxm;
      this.cz[i] = czm;
      this.area[i] = Math.abs(a2) / 200;
      const key = Math.floor(cxm / CELL) * 100000 + Math.floor(czm / CELL);
      let cell = this.cells.get(key);
      if (!cell) {
        cell = { key, gx: Math.floor(cxm / CELL), gz: Math.floor(czm / CELL), ids: [], mesh: null, polys: null };
        this.cells.set(key, cell);
      }
      cell.ids.push(i);
    }
    this.farCells = new Map();
    this.tex = buildFacadeArray();
    this.material = createBuildingMaterial(this.tex);
    this.xs = new Float64Array(256);
    this.zs = new Float64Array(256);
    this.spec = { skip: false, h: 0, floorH: 3.2, wall: 0, ground: -1, groundH: 0, roof: 'flat', roofLayer: LAYER.roofFlat, wallTint: WHITE, roofTint: WHITE, lit: 3, plant: false, bay: 3 };
    this.range = 1; // draw-distance scale, lowered on slow phones
    this.builtNear = new Set();
    this.builtFar = new Set();
    this.stats = { nearCells: 0, farCells: 0, tris: 0 };
  }

  // Decode ring i into this.xs/zs (metres). Returns point count.
  #ring(i) {
    const n = this.npts[i];
    let x = this.start[i * 2];
    let z = this.start[i * 2 + 1];
    const d = this.off[i];
    this.xs[0] = x / 10;
    this.zs[0] = z / 10;
    for (let k = 1; k < n; k++) {
      x += this.delta[(d + k - 1) * 2];
      z += this.delta[(d + k - 1) * 2 + 1];
      this.xs[k] = x / 10;
      this.zs[k] = z / 10;
    }
    return n;
  }

  // Hospital / clinic sites (real OSM outlines from durban-grounds.json):
  // buildings whose centre lies inside become hospital or clinic blocks.
  setSites(sites) {
    this.sites = [];
    for (const st of sites || []) {
      if (st.k !== 'hospital' && st.k !== 'clinic' && st.k !== 'school' && st.k !== 'police') continue;
      const ring = st.p || st.ring;
      if (!ring || ring.length < 3) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      this.sites.push({ k: st.k === 'school' && (st.t === 'university' || st.t === 'college') ? 'campus' : st.k, ring, x0, z0, x1, z1 });
    }
  }

  #siteAt(x, z) {
    for (const st of this.sites) {
      if (x < st.x0 || x > st.x1 || z < st.z0 || z > st.z1) continue;
      const r = st.ring;
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
      if (c) return st.k;
    }
    return null;
  }

  // Deterministic classification: height, styles and tints for building i.
  #classify(i) {
    const s = this.spec;
    const rng = mulberry32(i * 2654435761 + 977);
    const kind = this.kind[i];
    const zone = this.zone[i];
    const A = this.area[i];
    const x = this.cx[i];
    const z = this.cz[i];
    const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
    s.skip = false;
    s.ground = -1;
    s.groundH = 0;
    s.plant = false;
    s.floorH = 3.3;
    s.bay = 3;
    s.roof = 'flat';
    s.roofLayer = LAYER.roofFlat;
    s.roofTint = WHITE;
    s.lit = 3;
    s.pool = false;
    if (kind === KIND.roof || kind === KIND.construction && A < 40) {
      s.skip = true;
      return s;
    }
    const cbd = Math.hypot(x, z); // world origin = Durban CBD
    const coast = this.hf.signedCoastDistance(x, z);
    // Golden Mile / Point beachfront strip and Umhlanga Rocks
    const beach = coast > 0 && coast < 380 && ((z > -2600 && z < 3100) || (z < -14200 && z > -16200 && x > 5400));
    const ridge = Math.hypot(x - 4810, z + 14700) < 1100; // Umhlanga Ridge town centre
    const industrial = zone === ZONE.industrial || zone === ZONE.port || kind === KIND.industrial;
    const tagH = this.heightDm[i] / 10;
    const lv = this.levels[i];
    let h = 0;
    let type = 'house';

    if (kind === KIND.tank) type = 'tank';
    else if (kind === KIND.small) type = A < 30 ? 'shack' : 'small';
    else if (kind === KIND.house || kind === KIND.terrace) type = 'house';
    else if (kind === KIND.hotel) type = 'hotel';
    else if (kind === KIND.civic) type = 'civic';
    else if (kind === KIND.apartments) type = 'flats';
    else if (kind === KIND.commercial) type = cbd < 1600 || ridge ? 'office' : 'shop';
    else if (industrial) type = A > 250 ? 'industrial' : 'small';
    else if (zone === ZONE.school) type = 'civic';
    else if (zone === ZONE.commercial || zone === ZONE.retail) type = A > 900 ? 'mall' : 'shop';
    else if (cbd < 1500) type = A < 60 ? 'shop' : 'office';
    else if (beach) type = A > 260 ? 'hotel' : A > 90 ? 'flats' : 'house';
    else if (ridge) type = A > 450 ? 'office' : A > 150 ? 'flats' : 'house';
    else if (A < 22) type = 'shack';
    else if (A < 55) type = 'rdp';
    else if (A < 320) type = 'house';
    else if (A < 1200) type = rng() < 0.6 ? 'flats' : 'shop';
    else type = 'industrial';

    // open country: no suburbs. Small homes become rural homesteads.
    if (this.roads && this.roads.ruralAt && !industrial && (type === 'house' || type === 'rdp' || type === 'small' || type === 'shack' || (type === 'flats' && A < 400)) && this.roads.ruralAt(x, z)) {
      type = 'rural';
    }

    // rich suburbs: large homes become mansions
    if (!industrial && !beach && (type === 'house' || ((type === 'flats' || type === 'shop') && A < 900 && (kind === KIND.house || kind === KIND.yes))) && A > 140 && richAt(x, z)) type = 'mansion';

    if (this.sites && this.sites.length && type !== 'tank' && type !== 'shack' && A > 25) {
      const sk = this.#siteAt(x, z);
      if (sk === 'police') type = 'police';
      else if (sk === 'school' || sk === 'campus') type = sk === 'campus' ? 'campus' : 'school';
      else if (sk) type = sk === 'hospital' && A > 120 ? 'hospital' : 'clinic';
    }
    switch (type) {
      case 'hospital': {
        // ward blocks: real levels/height tags win below; otherwise by size
        const fl = A < 300 ? 1 + Math.floor(rng() * 2) : A < 1500 ? 2 + Math.floor(rng() * 3) : 3 + Math.floor(rng() * 6);
        h = fl * 3.7;
        s.floorH = 3.7;
        s.bay = 3.2;
        s.wall = rng() < 0.75 ? LAYER.office : LAYER.plaster;
        s.wallTint = pick(HOSP_WALLS);
        s.lit = 6; // wards and corridors stay lit all night
        s.plant = fl > 3;
        break;
      }
      case 'police': {
        // SAPS stations: low face-brick blocks, dark iron roofs, charge office lit all night
        h = (A > 600 && rng() < 0.5 ? 2 : 1) * 3.4;
        s.floorH = 3.4;
        s.bay = 3.4;
        s.wall = LAYER.facebrick;
        s.wallTint = WHITE;
        if (A < 1200) {
          s.roof = 'hip';
          s.roofLayer = LAYER.roofIron;
          s.roofTint = pick(CLINIC_ROOF);
        }
        s.lit = 5;
        break;
      }
      case 'school': {
        // classroom blocks: long, low, face brick or cream plaster, iron roofs
        h = (A > 450 && rng() < 0.35 ? 2 : 1) * 3.5;
        s.floorH = 3.5;
        s.bay = 3.6;
        s.wall = rng() < 0.55 ? LAYER.facebrick : LAYER.plaster;
        s.wallTint = s.wall === LAYER.facebrick ? WHITE : pick(HOSP_WALLS);
        if (A < 1400) {
          s.roof = 'hip';
          s.roofLayer = LAYER.roofIron;
          s.roofTint = pick(CLINIC_ROOF);
        }
        s.lit = 1;
        break;
      }
      case 'campus': {
        const fl = A < 400 ? 2 : 2 + Math.floor(rng() * 4);
        h = fl * 3.8;
        s.floorH = 3.8;
        s.wall = rng() < 0.5 ? LAYER.facebrick : rng() < 0.5 ? LAYER.office : LAYER.plaster;
        s.wallTint = s.wall === LAYER.facebrick ? WHITE : pick(HOSP_WALLS);
        s.lit = 2;
        s.plant = fl > 3;
        break;
      }
      case 'clinic': {
        h = (A > 400 && rng() < 0.4 ? 2 : 1) * 3.4;
        s.floorH = 3.4;
        s.wall = LAYER.plaster;
        s.wallTint = pick(HOSP_WALLS);
        if (A < 900) {
          s.roof = 'hip';
          s.roofLayer = LAYER.roofIron;
          s.roofTint = pick(CLINIC_ROOF);
        }
        s.lit = 3;
        break;
      }
      case 'mansion': {
        const modern = rng() < 0.4;
        const fl = A > 450 && rng() < 0.5 ? 3 : 2;
        h = fl * 3.5;
        s.floorH = 3.5;
        s.wall = rng() < 0.15 ? LAYER.facebrick : LAYER.house;
        s.wallTint = s.wall === LAYER.facebrick ? WHITE : pick(MANSION_WALLS);
        s.roof = 'hip';
        s.roofLayer = modern ? LAYER.roofIron : LAYER.roofTile;
        s.roofTint = pick(MANSION_ROOF);
        s.lit = 5;
        s.bay = 4.8; // wide picture windows
        s.pool = true;
        break;
      }
      case 'rural': {
        const roundish = A < 45 && rng() < 0.55;
        h = 2.6 + rng() * 0.4;
        s.wall = LAYER.house;
        s.wallTint = roundish ? pick(['#f7f5ee', '#efe6d2', '#e9dcc0'].map(hex)) : pick(RURAL_WALLS);
        s.roof = 'hip';
        if (roundish) {
          s.roofLayer = LAYER.roofTile;
          s.roofTint = pick(THATCH);
        } else {
          s.roofLayer = LAYER.roofIron;
          s.roofTint = pick(IRON_ROOF);
        }
        s.lit = 1;
        s.bay = 2.6;
        break;
      }
      case 'shack':
        h = 2.3 + rng() * 0.4;
        s.wall = LAYER.industrial;
        s.wallTint = pick(SHACK);
        s.roofLayer = LAYER.roofIron;
        s.roofTint = pick(IRON_ROOF);
        s.lit = 2;
        s.bay = 2;
        break;
      case 'small':
        h = 2.6 + rng() * 0.6;
        s.wall = LAYER.house;
        s.wallTint = pick(HOUSE_WALLS);
        s.roofLayer = LAYER.roofIron;
        s.roofTint = pick(IRON_ROOF);
        s.lit = 1;
        break;
      case 'rdp':
        h = 2.7;
        s.wall = LAYER.house;
        s.wallTint = pick(RDP_WALLS);
        s.roof = A < 70 ? 'hip' : 'flat';
        s.roofLayer = LAYER.roofIron;
        s.roofTint = pick(IRON_ROOF);
        s.lit = 4;
        s.bay = 2.6;
        break;
      case 'house': {
        const two = A > 190 && rng() < 0.35;
        h = two ? 6.0 : 3.0;
        s.floorH = 3.0;
        s.wall = rng() < 0.22 ? LAYER.facebrick : LAYER.house;
        s.wallTint = s.wall === LAYER.facebrick ? WHITE : pick(HOUSE_WALLS);
        s.roof = 'hip';
        s.roofLayer = rng() < 0.18 ? LAYER.roofIron : LAYER.roofTile;
        s.roofTint = s.roofLayer === LAYER.roofIron ? pick(IRON_ROOF) : pick(TILE_ROOF);
        s.lit = 4;
        s.bay = 3.4;
        break;
      }
      case 'flats': {
        const fl = beach ? 6 + Math.floor(rng() * 14) : 3 + Math.floor(rng() * (A > 600 ? 5 : 3));
        h = fl * 3.1;
        s.floorH = 3.1;
        s.wall = rng() < 0.3 ? LAYER.facebrick : LAYER.flats;
        s.wallTint = s.wall === LAYER.facebrick ? WHITE : pick(FLAT_WALLS);
        s.lit = 4;
        if (A < 260 && fl <= 3 && rng() < 0.5) {
          s.roof = 'hip';
          s.roofLayer = LAYER.roofTile;
          s.roofTint = pick(TILE_ROOF);
        }
        break;
      }
      case 'hotel': {
        const fl = 8 + Math.floor(rng() * (A > 900 ? 24 : 14));
        h = fl * 3.2;
        s.floorH = 3.2;
        s.wall = rng() < 0.75 ? LAYER.hotel : LAYER.flats;
        s.wallTint = pick(FLAT_WALLS);
        s.lit = 5;
        s.plant = true;
        break;
      }
      case 'office': {
        let fl;
        const core = cbd < 900 || ridge;
        if (A < 120) fl = 2 + Math.floor(rng() * 3);
        else if (A < 500) fl = 3 + Math.floor(rng() * (core ? 9 : 5));
        else if (A < 2500) fl = 4 + Math.floor(rng() * (core ? 18 : 8));
        else fl = 3 + Math.floor(rng() * 7);
        if (core && A > 350 && rng() < 0.18) fl += 10 + Math.floor(rng() * 14);
        h = fl * 3.5;
        s.floorH = 3.5;
        const r = rng();
        if (fl > 14 && r < 0.45) s.wall = rng() < 0.5 ? LAYER.glass : LAYER.glassDark;
        else s.wall = r < 0.55 ? LAYER.office : r < 0.85 ? LAYER.plaster : LAYER.facebrick;
        s.wallTint = s.wall === LAYER.glass || s.wall === LAYER.glassDark || s.wall === LAYER.facebrick ? WHITE : pick(CBD_WALLS);
        if (cbd < 1600 && fl <= 12 && rng() < 0.7) {
          s.ground = LAYER.shop;
          s.groundH = 4.2;
        }
        s.lit = 3;
        s.plant = fl > 6;
        break;
      }
      case 'shop':
        h = (rng() < 0.5 ? 1 : 2) * 3.6 + 0.6;
        s.floorH = 3.6;
        s.wall = LAYER.plaster;
        s.wallTint = pick(CBD_WALLS);
        s.ground = LAYER.shop;
        s.groundH = 3.8;
        s.lit = 3;
        break;
      case 'mall':
        h = 9 + rng() * 5;
        s.floorH = 4.5;
        s.wall = rng() < 0.5 ? LAYER.plaster : LAYER.office;
        s.wallTint = pick(CBD_WALLS);
        s.ground = LAYER.shop;
        s.groundH = 4.5;
        s.lit = 2;
        s.plant = true;
        break;
      case 'industrial':
        h = 7 + rng() * 6;
        s.floorH = 8;
        s.wall = LAYER.industrial;
        s.wallTint = pick(IND_WALLS);
        s.roofLayer = rng() < 0.6 ? LAYER.roofIron : LAYER.roofFlat;
        s.roofTint = s.roofLayer === LAYER.roofIron ? pick(IRON_ROOF) : WHITE;
        s.lit = 1;
        s.bay = 6;
        break;
      case 'tank':
        h = 9 + rng() * 6;
        s.wall = LAYER.industrial;
        s.wallTint = hex('#e8e8e4');
        s.lit = 0;
        s.bay = 4;
        break;
      case 'civic':
        h = (2 + Math.floor(rng() * 2)) * 3.4;
        s.floorH = 3.4;
        s.wall = rng() < 0.5 ? LAYER.facebrick : LAYER.plaster;
        s.wallTint = s.wall === LAYER.facebrick ? WHITE : pick(CBD_WALLS);
        if (A < 700) {
          s.roof = 'hip';
          s.roofLayer = LAYER.roofTile;
          s.roofTint = pick(TILE_ROOF);
        }
        s.lit = 2;
        break;
      default:
        h = 3;
        s.wall = LAYER.house;
        s.wallTint = WHITE;
    }
    if (tagH > 2) h = tagH;
    else if (lv > 0) h = lv * s.floorH + (s.ground >= 0 ? 0.8 : 0);
    if (s.roof === 'hip' && h > 12) s.roof = 'flat';
    s.h = h;
    s.type = type;
    return s;
  }

  // Footprint sits on a road (our roads can be wider than OSM's)? Reject it.
  #onRoad(i, n) {
    const xs = this.xs;
    const zs = this.zs;
    const roads = this.roads;
    const test = (x, z) => {
      const r = roads.nearestRoad(x, z, 16);
      return r && r.dist < r.road.width / 2 - 0.4;
    };
    if (test(this.cx[i], this.cz[i])) return true;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      if (test(xs[k], zs[k])) return true;
      if (test((xs[k] + xs[k2]) / 2, (zs[k] + zs[k2]) / 2)) return true;
    }
    return false;
  }

  // Hide OSM footprints inside an ellipse (a hand-built landmark replaces them).
  // ux,uz = unit vector of the a axis.
  exclude(cx, cz, a, b, ux, uz) {
    const r = Math.max(a, b);
    let n = 0;
    for (let gx = Math.floor((cx - r) / CELL); gx <= Math.floor((cx + r) / CELL); gx++) {
      for (let gz = Math.floor((cz - r) / CELL); gz <= Math.floor((cz + r) / CELL); gz++) {
        const cell = this.cells.get(gx * 100000 + gz);
        if (!cell) continue;
        for (const i of cell.ids) {
          const dx = this.cx[i] - cx;
          const dz = this.cz[i] - cz;
          const p = (dx * ux + dz * uz) / a;
          const q = (-dx * uz + dz * ux) / b;
          if (p * p + q * q < 1) {
            this.state[i] = 2;
            n++;
          }
        }
      }
    }
    return n;
  }

  #accept(i) {
    let st = this.state[i];
    if (st) return st === 1;
    const n = this.#ring(i);
    st = 1;
    if (this.hf.isWater(this.cx[i], this.cz[i])) st = 2;
    else if (this.#onRoad(i, n)) st = 2;
    this.state[i] = st;
    return st === 1;
  }

  // ---- geometry ----------------------------------------------------------------
  #emitBuilding(B, i, s) {
    const n = this.#ring(i);
    const xs = this.xs;
    const zs = this.zs;
    const hf = this.hf;
    let gMin = Infinity;
    let gMax = -Infinity;
    for (let k = 0; k < n; k++) {
      const g = hf.heightAt(xs[k], zs[k]);
      if (g < gMin) gMin = g;
      if (g > gMax) gMax = g;
    }
    const ground = gMax;
    const base = gMin - 1.2;
    const top = ground + s.h;
    // signed area: > 0 means outward normal of edge (dx,dz) is (dz,-dx)
    let a2 = 0;
    for (let k = 0, j = n - 1; k < n; j = k++) a2 += xs[j] * zs[k] - xs[k] * zs[j];
    const sgn = a2 > 0 ? 1 : -1;
    const seed = ((i * 0.6180339887) % 1) * 0.98 + 0.01;
    const w = s.lit + seed;
    const layerH = s.floorH * 4;
    const bayW = s.bay * 4;

    const wallQuad = (x0, z0, x1, z1, y0, y1, layer, v0, v1, u1) => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (sgn * dz) / len;
      const nz = (-sgn * dx) / len;
      const c = s.wallTint;
      // outward normal (-dz,dx) matches order a,b,c / a,c,d
      const ccw = nx * -dz + nz * dx > 0;
      if (ccw) {
        B.v(x0, y0, z0, nx, 0, nz, c, 0, v0, layer, w);
        B.v(x1, y0, z1, nx, 0, nz, c, u1, v0, layer, w);
        B.v(x1, y1, z1, nx, 0, nz, c, u1, v1, layer, w);
        B.v(x0, y0, z0, nx, 0, nz, c, 0, v0, layer, w);
        B.v(x1, y1, z1, nx, 0, nz, c, u1, v1, layer, w);
        B.v(x0, y1, z0, nx, 0, nz, c, 0, v1, layer, w);
      } else {
        B.v(x0, y0, z0, nx, 0, nz, c, 0, v0, layer, w);
        B.v(x1, y1, z1, nx, 0, nz, c, u1, v1, layer, w);
        B.v(x1, y0, z1, nx, 0, nz, c, u1, v0, layer, w);
        B.v(x0, y0, z0, nx, 0, nz, c, 0, v0, layer, w);
        B.v(x0, y1, z0, nx, 0, nz, c, 0, v1, layer, w);
        B.v(x1, y1, z1, nx, 0, nz, c, u1, v1, layer, w);
      }
      B.tris += 2;
    };

    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const x0 = xs[k];
      const z0 = zs[k];
      const x1 = xs[k2];
      const z1 = zs[k2];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) continue;
      const bays = len < 1.6 ? 0.12 : Math.max(1, Math.round(len / s.bay));
      const u1 = len < 1.6 ? 0.03 : bays / 4;
      if (s.ground >= 0 && s.h > s.groundH + 1) {
        const gTop = ground + s.groundH;
        const shopH = s.groundH * 4;
        wallQuad(x0, z0, x1, z1, base, gTop, s.ground, (base - ground) / shopH, 0.25, u1);
        wallQuad(x0, z0, x1, z1, gTop, top, s.wall, 0, (top - gTop) / layerH, u1);
      } else {
        wallQuad(x0, z0, x1, z1, base, top, s.wall, (base - ground) / layerH, (top - ground) / layerH, u1);
      }
    }
    void bayW;

    let roofDone = false;
    if (s.roof === 'hip') roofDone = this.#hipRoof(B, n, top, s, w);
    if (!roofDone) this.#flatRoof(B, n, top, s, w);
    if (s.plant && this.area[i] > 150) {
      const side = Math.min(9, Math.sqrt(this.area[i]) * 0.28);
      this.#box(B, this.cx[i], this.cz[i], side, side * 0.8, top, top + 3.2, s, w);
    }
  }

  #flatRoof(B, n, y, s, w) {
    const pts = [];
    for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(this.xs[k], this.zs[k]));
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(pts, []);
    } catch {
      return;
    }
    const c = s.roofTint;
    const L = s.roofLayer;
    const sc = 1 / 12;
    for (const t of tris) {
      const a = pts[t[0]];
      const b = pts[t[1]];
      const d = pts[t[2]];
      // upward facing: (b-a) x (d-a) has y = dz1*dx2 - dx1*dz2 > 0
      const cy = (b.y - a.y) * (d.x - a.x) - (b.x - a.x) * (d.y - a.y);
      const p = cy > 0 ? [a, b, d] : [a, d, b];
      for (const q of p) B.v(q.x, y, q.y, 0, 1, 0, c, q.x * sc, q.y * sc, L, w - (w % 1));
      B.tris++;
    }
  }

  // Hipped roof over the footprint's minimum-area rectangle (houses).
  #hipRoof(B, n, y, s, w) {
    const xs = this.xs;
    const zs = this.zs;
    let best = null;
    let polyA = 0;
    for (let k = 0, j = n - 1; k < n; j = k++) polyA += xs[j] * zs[k] - xs[k] * zs[j];
    polyA = Math.abs(polyA) / 2;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      let ux = xs[k2] - xs[k];
      let uz = zs[k2] - zs[k];
      const l = Math.hypot(ux, uz);
      if (l < 0.5) continue;
      ux /= l;
      uz /= l;
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let m = 0; m < n; m++) {
        const pu = xs[m] * ux + zs[m] * uz;
        const pv = -xs[m] * uz + zs[m] * ux;
        if (pu < minU) minU = pu;
        if (pu > maxU) maxU = pu;
        if (pv < minV) minV = pv;
        if (pv > maxV) maxV = pv;
      }
      const area = (maxU - minU) * (maxV - minV);
      if (!best || area < best.area) best = { area, ux, uz, minU, maxU, minV, maxV };
    }
    if (!best || polyA / best.area < 0.72) return false;
    let { ux, uz } = best;
    let L = (best.maxU - best.minU) / 2;
    let W = (best.maxV - best.minV) / 2;
    const cu = (best.maxU + best.minU) / 2;
    const cv = (best.maxV + best.minV) / 2;
    const cx = cu * ux - cv * uz;
    const cz = cu * uz + cv * ux;
    // long axis along u
    let vx = -uz;
    let vz = ux;
    if (W > L) {
      const t = L;
      L = W;
      W = t;
      const tx = ux;
      const tz = uz;
      ux = vx;
      uz = vz;
      vx = -tx;
      vz = -tz;
    }
    const o = 0.45;
    L += o;
    W += o;
    const rise = Math.min(4.5, W * 0.55);
    const r = Math.max(0, L - W);
    const P = (a, b, h) => [cx + ux * a + vx * b, y + h, cz + uz * a + vz * b];
    const e1 = P(L, W, -0.25);
    const e2 = P(-L, W, -0.25);
    const e3 = P(-L, -W, -0.25);
    const e4 = P(L, -W, -0.25);
    const r1 = P(r, 0, rise);
    const r2 = P(-r, 0, rise);
    const c = s.roofTint;
    const Ly = s.roofLayer;
    const wl = w - (w % 1);
    const tri = (a, b, d) => {
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const adx = d[0] - a[0];
      const ady = d[1] - a[1];
      const adz = d[2] - a[2];
      let nx = aby * adz - abz * ady;
      let ny = abz * adx - abx * adz;
      let nz = abx * ady - aby * adx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      let pts = [a, b, d];
      if (ny < 0) {
        pts = [a, d, b];
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      // tile UV: u along the eave, v up the slope
      const hx = nx;
      const hz = nz;
      const hl = Math.hypot(hx, hz) || 1;
      for (const p of pts) {
        const along = (p[0] * -hz + p[2] * hx) / hl;
        const up = (p[0] * hx + p[2] * hz) / hl / Math.max(0.3, ny) ;
        B.v(p[0], p[1], p[2], nx, ny, nz, c, along / 6, -up / 6, Ly, wl);
      }
      B.tris++;
    };
    tri(e1, e2, r2);
    tri(e1, r2, r1);
    tri(e3, e4, r1);
    tri(e3, r1, r2);
    tri(e4, e1, r1);
    tri(e2, e3, r2);
    // soffit (underside) so the overhang doesn't look paper thin from below
    return true;
  }

  #box(B, cx, cz, sx, sz, y0, y1, s, w) {
    const hx = sx / 2;
    const hz = sz / 2;
    const c = hex('#d8d6d0');
    const L = LAYER.industrial;
    const quads = [
      [cx - hx, cz + hz, cx + hx, cz + hz, 0, 1],
      [cx + hx, cz + hz, cx + hx, cz - hz, 1, 0],
      [cx + hx, cz - hz, cx - hx, cz - hz, 0, -1],
      [cx - hx, cz - hz, cx - hx, cz + hz, -1, 0]
    ];
    const wl = 0.5;
    for (const [x0, z0, x1, z1, nx, nz] of quads) {
      const u1 = Math.hypot(x1 - x0, z1 - z0) / 12;
      const v1 = (y1 - y0) / 16;
      // outward (nx,nz); order a,b,c is outward when (-dz,dx) == n
      const dx = x1 - x0;
      const dz = z1 - z0;
      const ok = -dz * nx + dx * nz > 0;
      const A = [x0, y0, z0, 0, 0];
      const Bv = [x1, y0, z1, u1, 0];
      const C = [x1, y1, z1, u1, v1];
      const D = [x0, y1, z0, 0, v1];
      const order = ok ? [A, Bv, C, A, C, D] : [A, C, Bv, A, D, C];
      for (const p of order) B.v(p[0], p[1], p[2], nx, 0, nz, c, p[3], p[4], L, wl);
      B.tris += 2;
    }
    const top = [
      [cx - hx, cz - hz],
      [cx - hx, cz + hz],
      [cx + hx, cz + hz],
      [cx - hx, cz - hz],
      [cx + hx, cz + hz],
      [cx + hx, cz - hz]
    ];
    for (const p of top) B.v(p[0], y1, p[1], 0, 1, 0, c, p[0] / 12, p[1] / 12, LAYER.roofFlat, 0);
    B.tris += 2;
    void s;
    void w;
  }

  // Swimming pool with a white deck in the garden of a mansion: tries
  // four spots around the house, skipping roads and other buildings.
  #pool(B, i) {
    const cx = this.cx[i];
    const cz = this.cz[i];
    const r = Math.sqrt(this.area[i]) * 0.62 + 5.5;
    const rot = ((i * 0.381966) % 1) * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const a = rot + k * Math.PI / 2;
      const px = cx + Math.cos(a) * r;
      const pz = cz + Math.sin(a) * r;
      if (this.blocked(px, pz, 5)) continue;
      const nr = this.roads && this.roads.nearestRoad(px, pz, 14);
      if (nr && nr.dist < nr.road.width / 2 + 5) continue;
      const y = this.hf.heightAt(px, pz) + 0.07;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const quad = (hw, hl, yy, c) => {
        // long side across the radial direction
        const ax = -uz * hl, az = ux * hl, bx = ux * hw, bz = uz * hw;
        const p0 = [px - ax - bx, pz - az - bz], p1 = [px + ax - bx, pz + az - bz], p2 = [px + ax + bx, pz + az + bz], p3 = [px - ax + bx, pz - az + bz];
        for (const p of [p0, p2, p1, p0, p3, p2, p0, p1, p2, p0, p2, p3]) B.v(p[0], yy, p[1], 0, 1, 0, c, p[0] / 12, p[1] / 12, LAYER.roofFlat, 0);
        B.tris += 4;
      };
      quad(3.4, 5.6, y, POOL_DECK);
      quad(2.2, 4.2, y + 0.03, POOL_WATER);
      return;
    }
  }

  #buildNear(cell) {
    const B = new GeoBuf();
    for (const i of cell.ids) {
      const s = this.#classify(i);
      if (s.skip || s.h >= TALL) continue;
      if (!this.#accept(i)) continue;
      this.#emitBuilding(B, i, s);
      if (s.pool) this.#pool(B, i);
    }
    const g = B.geometry();
    if (g) {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.userData.tris = B.tris;
      cell.mesh = mesh;
      this.group.add(mesh);
      this.stats.tris += B.tris;
    } else cell.mesh = 'empty';
  }

  #buildFar(fc) {
    const B = new GeoBuf();
    for (let gz = fc.gz * 4; gz < fc.gz * 4 + 4; gz++) {
      for (let gx = fc.gx * 4; gx < fc.gx * 4 + 4; gx++) {
        const cell = this.cells.get(gx * 100000 + gz);
        if (!cell) continue;
        for (const i of cell.ids) {
          const s = this.#classify(i);
          if (s.skip || s.h < TALL) continue;
          if (!this.#accept(i)) continue;
          this.#emitBuilding(B, i, s);
        }
      }
    }
    const g = B.geometry();
    if (g) {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.userData.tris = B.tris;
      fc.mesh = mesh;
      this.group.add(mesh);
      this.stats.tris += B.tris;
    } else fc.mesh = 'empty';
  }

  #dispose(c) {
    if (c.mesh && c.mesh !== 'empty') {
      this.group.remove(c.mesh);
      this.stats.tris -= c.mesh.userData.tris;
      c.mesh.geometry.dispose();
    }
    c.mesh = null;
  }

  // Stream cells around the camera. `budget` = cells built this call.
  update(camX, camZ, budget = 1) {
    const rg = this.range;
    const NEAR_IN_ = NEAR_IN * rg, NEAR_OUT_ = NEAR_OUT * rg, FAR_IN_ = FAR_IN * rg, FAR_OUT_ = FAR_OUT * rg;
    let built = 0;
    // near layer
    const gx0 = Math.floor(camX / CELL);
    const gz0 = Math.floor(camZ / CELL);
    const R = Math.ceil(NEAR_OUT_ / CELL) + 1;
    let bestCell = null;
    let bestD = Infinity;
    for (let gz = gz0 - R; gz <= gz0 + R; gz++) {
      for (let gx = gx0 - R; gx <= gx0 + R; gx++) {
        const cell = this.cells.get(gx * 100000 + gz);
        if (!cell || cell.mesh) continue;
        const d = Math.hypot((gx + 0.5) * CELL - camX, (gz + 0.5) * CELL - camZ);
        if (d < NEAR_IN_ && d < bestD) {
          bestD = d;
          bestCell = cell;
        }
      }
    }
    for (const key of this.builtNear) {
      const cell = this.cells.get(key);
      const d = Math.hypot((cell.gx + 0.5) * CELL - camX, (cell.gz + 0.5) * CELL - camZ);
      if (d > NEAR_OUT_) {
        this.#dispose(cell);
        this.builtNear.delete(key);
      }
    }
    while (bestCell && built < budget) {
      this.#buildNear(bestCell);
      this.builtNear.add(bestCell.key);
      built++;
      if (built >= budget) break;
      // find the next nearest
      bestCell = null;
      bestD = Infinity;
      for (let gz = gz0 - R; gz <= gz0 + R; gz++) {
        for (let gx = gx0 - R; gx <= gx0 + R; gx++) {
          const cell = this.cells.get(gx * 100000 + gz);
          if (!cell || cell.mesh) continue;
          const d = Math.hypot((gx + 0.5) * CELL - camX, (gz + 0.5) * CELL - camZ);
          if (d < NEAR_IN_ && d < bestD) {
            bestD = d;
            bestCell = cell;
          }
        }
      }
    }
    // far layer (skyline)
    const fx0 = Math.floor(camX / FAR_CELL);
    const fz0 = Math.floor(camZ / FAR_CELL);
    const FR = Math.ceil(FAR_OUT_ / FAR_CELL) + 1;
    for (let gz = fz0 - FR; gz <= fz0 + FR && built < budget + 1; gz++) {
      for (let gx = fx0 - FR; gx <= fx0 + FR && built < budget + 1; gx++) {
        const key = gx * 100000 + gz;
        let fc = this.farCells.get(key);
        if (!fc) {
          fc = { key, gx, gz, mesh: null };
          this.farCells.set(key, fc);
        }
        if (fc.mesh) continue;
        const d = Math.hypot((gx + 0.5) * FAR_CELL - camX, (gz + 0.5) * FAR_CELL - camZ);
        if (d < FAR_IN_) {
          this.#buildFar(fc);
          this.builtFar.add(key);
          built++;
        }
      }
    }
    for (const key of this.builtFar) {
      const fc = this.farCells.get(key);
      const d = Math.hypot((fc.gx + 0.5) * FAR_CELL - camX, (fc.gz + 0.5) * FAR_CELL - camZ);
      if (d > FAR_OUT_) {
        this.#dispose(fc);
        this.builtFar.delete(key);
      }
    }
    this.stats.nearCells = this.builtNear.size;
    this.stats.farCells = this.builtFar.size;
    return built;
  }

  // ---- collision ---------------------------------------------------------------
  #cellPolys(cell) {
    if (cell.polys) return cell.polys;
    const polys = [];
    for (const i of cell.ids) {
      const s = this.#classify(i);
      if (s.skip) continue;
      if (!this.#accept(i)) continue;
      const n = this.#ring(i);
      const xs = new Float32Array(n);
      const zs = new Float32Array(n);
      let minx = Infinity;
      let maxx = -Infinity;
      let minz = Infinity;
      let maxz = -Infinity;
      for (let k = 0; k < n; k++) {
        xs[k] = this.xs[k];
        zs[k] = this.zs[k];
        if (xs[k] < minx) minx = xs[k];
        if (xs[k] > maxx) maxx = xs[k];
        if (zs[k] < minz) minz = zs[k];
        if (zs[k] > maxz) maxz = zs[k];
      }
      polys.push({ xs, zs, n, minx, maxx, minz, maxz });
    }
    cell.polys = polys;
    return polys;
  }

  // Push a circle (x, z, r) out of any footprint. Returns null when clear, else
  // { x, z, nx, nz } with the corrected centre and the wall normal.
  collide(x, z, r) {
    const out = this._col || (this._col = { x: 0, z: 0, nx: 0, nz: 0 });
    let hit = false;
    let px = x;
    let pz = z;
    const g0x = Math.floor((x - r - 60) / CELL);
    const g1x = Math.floor((x + r + 60) / CELL);
    const g0z = Math.floor((z - r - 60) / CELL);
    const g1z = Math.floor((z + r + 60) / CELL);
    for (let gz = g0z; gz <= g1z; gz++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        const cell = this.cells.get(gx * 100000 + gz);
        if (!cell) continue;
        const polys = this.#cellPolys(cell);
        for (const p of polys) {
          if (px < p.minx - r || px > p.maxx + r || pz < p.minz - r || pz > p.maxz + r) continue;
          // inside test + closest edge
          let inside = false;
          let bd = Infinity;
          let bx = 0;
          let bz = 0;
          for (let k = 0, j = p.n - 1; k < p.n; j = k++) {
            const ax = p.xs[j];
            const az = p.zs[j];
            const cx = p.xs[k];
            const cz = p.zs[k];
            if (cz > pz !== az > pz && px < ((ax - cx) * (pz - cz)) / (az - cz) + cx) inside = !inside;
            const dx = cx - ax;
            const dz = cz - az;
            const l2 = dx * dx + dz * dz;
            let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = ax + dx * t;
            const qz = az + dz * t;
            const d = Math.hypot(px - qx, pz - qz);
            if (d < bd) {
              bd = d;
              bx = qx;
              bz = qz;
            }
          }
          if (!inside && bd >= r) continue;
          let nx = px - bx;
          let nz = pz - bz;
          const nl = Math.hypot(nx, nz) || 1;
          nx /= nl;
          nz /= nl;
          if (inside) {
            nx = -nx;
            nz = -nz;
          }
          const push = inside ? bd + r : r - bd;
          px += nx * push;
          pz += nz * push;
          out.nx = nx;
          out.nz = nz;
          hit = true;
        }
      }
    }
    if (!hit) return null;
    out.x = px;
    out.z = pz;
    return out;
  }

  // Visit accepted buildings whose centroid lies in the rectangle:
  // fn(index, type, cx, cz, area, height).
  forEachIn(minx, minz, maxx, maxz, fn) {
    for (let gz = Math.floor(minz / CELL); gz <= Math.floor(maxz / CELL); gz++) {
      for (let gx = Math.floor(minx / CELL); gx <= Math.floor(maxx / CELL); gx++) {
        const cell = this.cells.get(gx * 100000 + gz);
        if (!cell) continue;
        for (const i of cell.ids) {
          const x = this.cx[i];
          const z = this.cz[i];
          if (x < minx || x >= maxx || z < minz || z >= maxz) continue;
          const s = this.#classify(i);
          if (s.skip || !this.#accept(i)) continue;
          fn(i, s.type, x, z, this.area[i], s.h);
        }
      }
    }
  }

  // True when (x, z) is inside / within r of a footprint (spawning, props).
  blocked(x, z, r = 0.5) {
    return !!this.collide(x, z, r);
  }
}
