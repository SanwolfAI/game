import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

// Loads small Kenney GLB props (CC0) and flattens each into ONE geometry so it
// can be drawn with a single InstancedMesh: untextured kits (nature) get their
// material colours baked into vertex colours, textured kits (roads) keep UVs
// and share one material per colormap.

const loader = new GLTFLoader();
const matCache = new Map();

// Natural KZN greens/browns instead of the kit's stylised teal/orange.
const RECOLOR = {
  leafsGreen: '#4c7d2c',
  leafsDark: '#355f24',
  woodBark: '#6b4a31',
  woodBarkDark: '#5a3e2b',
  grass: '#5b8a32',
  dirt: '#7a5a3d',
  _defaultMat: '#8a8a82'
};

export const vertexColorMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

function texturedMaterial(map, key) {
  let m = matCache.get(key);
  if (!m) {
    map.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.MeshLambertMaterial({ map });
    matCache.set(key, m);
  }
  return m;
}

/**
 * @param {string} url
 * @param {{ leaf?: string, height?: number }} opts  leaf = override leaf colour,
 *   height = normalise to this height (metres) with the base at y = 0.
 */
export async function loadKitModel(url, opts = {}) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  let map = null;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const mat = o.material;
    if (mat.map) map = mat.map;
    const keep = mat.map ? ['position', 'normal', 'uv'] : ['position', 'normal'];
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    if (!mat.map) {
      const name = mat.name || '';
      let hex = RECOLOR[name];
      if (opts.leaf && /leafs/.test(name)) hex = opts.leaf;
      const c = hex ? new THREE.Color(hex) : mat.color.clone();
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  let geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (!geometry) throw new Error(`empty model ${url}`);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const h = bb.max.y - bb.min.y || 1;
  if (opts.height) {
    const s = opts.height / h;
    geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geometry.scale(s, s, s);
  } else {
    geometry.translate(0, -bb.min.y, 0);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = map ? texturedMaterial(map, url.slice(0, url.lastIndexOf('/'))) : vertexColorMaterial;
  return { geometry, material, size: geometry.boundingBox.getSize(new THREE.Vector3()) };
}
