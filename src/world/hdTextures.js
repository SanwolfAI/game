import * as THREE from '../../vendor/three/three.module.js';
import { GFX } from '../core/gfx.js';

// HD texture pack, slice 1: 1K CC0 Poly Haven maps (src/assets/hd, see
// CREDITS.txt). Medium tier = diffuse only, High = diffuse + normal maps.
// Low tier never loads these and keeps the original flat look.
const DIR = './src/assets/hd/';
const loader = new THREE.TextureLoader();
const cache = new Map();

export const HD = {
  get on() {
    return !!GFX.caps.hd;
  },
  get normals() {
    return !!GFX.caps.normals;
  }
};

// name like 'asphalt_02', kind 'diff' | 'nor_gl'
export function hdTex(name, kind = 'diff') {
  const key = name + '_' + kind;
  let t = cache.get(key);
  if (t) return t;
  t = loader.load(DIR + name + '_' + kind + '_1k.jpg');
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = kind === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = GFX.caps.aniso; // three clamps to the GPU's own max
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  cache.set(key, t);
  return t;
}

// Clone with its own repeat (several materials share one image).
function rep(t, r) {
  const c = t.clone();
  c.repeat.set(r, r);
  c.needsUpdate = true;
  return c;
}

// Roads use UVs in units of 5 m (TEX_SCALE 1/5). Repeat = 5 m / real size.
export function upgradeRoadMats(mats) {
  if (!HD.on) return;
  const N = HD.normals;
  // asphalt_02 is a 3 m sample
  const a = mats.asphalt;
  a.map = rep(hdTex('asphalt_02'), 5 / 3);
  a.color.setScalar(1.15); // a touch lighter: the HD sample reads darker at a distance
  if (N) {
    a.normalMap = rep(hdTex('asphalt_02', 'nor_gl'), 5 / 3);
    a.normalScale = new THREE.Vector2(0.7, 0.7);
  }
  a.needsUpdate = true;
  // bridges / fascias: brushed concrete (2.5 m)
  const s = mats.structure;
  s.map = rep(hdTex('brushed_concrete'), 2);
  if (N) s.normalMap = rep(hdTex('brushed_concrete', 'nor_gl'), 2);
  s.needsUpdate = true;
  // pavements: concrete pavers (1.92 m), kerb faces (u < 0.08) brushed concrete
  const w = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: rep(hdTex('concrete_pavers'), 5 / 1.92) });
  if (N) w.normalMap = rep(hdTex('concrete_pavers', 'nor_gl'), 5 / 1.92);
  const kerb = hdTex('brushed_concrete');
  w.onBeforeCompile = (sh) => {
    sh.uniforms.tKerb = { value: kerb };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawU = uv.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRawU;\nuniform sampler2D tKerb;')
      .replace(
        '#include <map_fragment>',
        `vec4 sampledDiffuseColor = vRawU < 0.081 ? texture2D(tKerb, vMapUv * 0.8) : texture2D(map, vMapUv);
diffuseColor *= sampledDiffuseColor;`
      )
      .replace('#include <normal_fragment_maps>', 'if (vRawU >= 0.081) {\n#include <normal_fragment_maps>\n}');
  };
  w.customProgramCacheKey = () => 'izk-walk-hd' + (N ? 'n' : '');
  mats.walk = w;
}

// Ground: swap the 512 grass for the 1K one (same world scale).
export function groundGrass(fallback) {
  return HD.on ? hdTex('sparse_grass') : fallback();
}

// Buildings: world-space detail on walls and roofs. Returns shader chunks
// for createBuildingMaterial, or null on Low.
//   layer 7 facebrick  -> red brick colour (1 m sample)
//   plaster-like walls -> plaster detail (keeps the wall tint)
//   layer 10 roofIron  -> corrugated iron (2.7 m)
export function buildingDetail() {
  if (!HD.on) return null;
  return {
    N: HD.normals,
    uniforms: {
      tBrick: { value: hdTex('red_brick_03') },
      tPlaster: { value: hdTex('white_plaster_rough_01') },
      tIron: { value: hdTex('corrugated_iron_02') },
      ...(HD.normals
        ? {
            nBrick: { value: hdTex('red_brick_03', 'nor_gl') },
            nPlaster: { value: hdTex('white_plaster_rough_01', 'nor_gl') },
            nIron: { value: hdTex('corrugated_iron_02', 'nor_gl') }
          }
        : {})
    }
  };
}
