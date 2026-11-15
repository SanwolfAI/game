import * as THREE from 'three';

const downloaded = new Map();
const SOURCES = [
  { id: 'gusheshe-3d', path: './src/assets/vehicles/gusheshe/scene.gltf', length: 4.55, title: '1991 BMW 325i (E30) — Pink Slip Kings' },
  { id: 'bmw-lowpoly-3d', path: './src/assets/vehicles/bmw-lowpoly/scene.gltf', length: 4.4, title: 'Low-Poly BMW' },
  { id: 'hiace-3d', path: './src/assets/vehicles/hiace/scene.gltf', length: 5.2, title: 'Toyota HiAce 2004' }
];
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const TYPES = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
};
const ATTRIBUTE_NAMES = {
  POSITION: 'position', NORMAL: 'normal', TANGENT: 'tangent',
  TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', COLOR_0: 'color',
  JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight'
};

function readAccessor(gltf, binary, index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const Type = TYPES[accessor.componentType];
  if (!Type) throw new Error('Unsupported glTF component type ' + accessor.componentType);
  const itemSize = COMPONENTS[accessor.type];
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || itemSize * Type.BYTES_PER_ELEMENT;
  const packed = stride === itemSize * Type.BYTES_PER_ELEMENT;
  let array;
  if (packed) {
    array = new Type(binary, start, accessor.count * itemSize).slice();
  } else {
    array = new Type(accessor.count * itemSize);
    const data = new DataView(binary);
    for (let i = 0; i < accessor.count; i++) {
      for (let c = 0; c < itemSize; c++) {
        const offset = start + i * stride + c * Type.BYTES_PER_ELEMENT;
        const value = Type === Float32Array ? data.getFloat32(offset, true)
          : Type === Uint32Array ? data.getUint32(offset, true)
          : Type === Uint16Array ? data.getUint16(offset, true)
          : Type === Int16Array ? data.getInt16(offset, true)
          : Type === Uint8Array ? data.getUint8(offset)
          : data.getInt8(offset);
        array[i * itemSize + c] = value;
      }
    }
  }
  return { array, itemSize, normalized: !!accessor.normalized };
}

async function makeMaterial(gltf, index, baseUrl) {
  const source = gltf.materials?.[index] || {};
  const pbr = source.pbrMetallicRoughness || {};
  const color = pbr.baseColorFactor || [1, 1, 1, 1];
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
    opacity: color[3],
    metalness: pbr.metallicFactor ?? 0,
    roughness: pbr.roughnessFactor ?? 1,
    side: source.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: source.alphaMode === 'BLEND',
    depthWrite: source.alphaMode !== 'BLEND'
  });
  const textureInfo = pbr.baseColorTexture;
  if (textureInfo) {
    const textureDef = gltf.textures?.[textureInfo.index];
    const imageDef = textureDef && gltf.images?.[textureDef.source];
    if (imageDef?.uri) {
      const texture = await new THREE.TextureLoader().loadAsync(new URL(imageDef.uri, baseUrl).href);
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
    }
  }
  return material;
}

async function parseGltf(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Model file missing: ' + path);
  const gltf = await response.json();
  const baseUrl = new URL('.', new URL(path, document.baseURI)).href;
  const bufferDef = gltf.buffers?.[0];
  if (!bufferDef?.uri) throw new Error('Model has no external binary buffer');
  const binaryResponse = await fetch(new URL(bufferDef.uri, baseUrl));
  if (!binaryResponse.ok) throw new Error('Model geometry buffer missing');
  const binary = await binaryResponse.arrayBuffer();
  const materials = await Promise.all((gltf.materials || []).map((_, i) => makeMaterial(gltf, i, baseUrl)));
  const meshObjects = (gltf.meshes || []).map((meshDef) => {
    const group = new THREE.Group();
    for (const primitive of meshDef.primitives || []) {
      const geometry = new THREE.BufferGeometry();
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes || {})) {
        const attr = readAccessor(gltf, binary, accessorIndex);
        const name = ATTRIBUTE_NAMES[semantic];
        if (name) geometry.setAttribute(name, new THREE.BufferAttribute(attr.array, attr.itemSize, attr.normalized));
      }
      if (primitive.indices !== undefined) {
        const indices = readAccessor(gltf, binary, primitive.indices);
        geometry.setIndex(new THREE.BufferAttribute(indices.array, 1));
      }
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const material = materials[primitive.material] || new THREE.MeshStandardMaterial({ color: 0xb9b9b9 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  });
  const nodes = (gltf.nodes || []).map((nodeDef) => {
    const object = new THREE.Group();
    object.name = nodeDef.name || 'vehicle-part';
    if (nodeDef.matrix) {
      object.matrix.fromArray(nodeDef.matrix);
      object.matrixAutoUpdate = false;
    } else {
      if (nodeDef.translation) object.position.fromArray(nodeDef.translation);
      if (nodeDef.rotation) object.quaternion.fromArray(nodeDef.rotation);
      if (nodeDef.scale) object.scale.fromArray(nodeDef.scale);
    }
    if (nodeDef.mesh !== undefined) object.add(meshObjects[nodeDef.mesh]);
    return object;
  });
  (gltf.nodes || []).forEach((nodeDef, index) => {
    for (const child of nodeDef.children || []) nodes[index].add(nodes[child]);
  });
  const scene = new THREE.Group();
  const sceneDef = gltf.scenes?.[gltf.scene || 0];
  for (const nodeIndex of sceneDef?.nodes || []) scene.add(nodes[nodeIndex]);
  return scene;
}

function prepareVehicle(root, targetLength, id) {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  let size = bounds.getSize(new THREE.Vector3());
  if (size.x > size.z) root.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  size = bounds.getSize(new THREE.Vector3());
  const scale = targetLength / Math.max(size.x, size.z, 0.001);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= bounds.min.y;
  root.name = 'downloaded-' + id;
  return root;
}

export async function loadDownloadedVehicles() {
  const results = await Promise.all(SOURCES.map(async (source) => {
    try {
      const model = await parseGltf(source.path);
      downloaded.set(source.id, prepareVehicle(model, source.length, source.id));
      return source.id;
    } catch (error) {
      console.warn('[IZK] ' + source.title + ' unavailable; using built-in fallback.', error);
      return null;
    }
  }));
  const loaded = results.filter(Boolean);
  console.info('[IZK] Loaded ' + loaded.length + '/' + SOURCES.length + ' downloaded vehicles.');
  return loaded;
}

export function getDownloadedVehicle(id) {
  return downloaded.get(id) || null;
}
