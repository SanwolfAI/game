// Merge a static group's plain meshes into one mesh per material
// (performance pass, 25 Nov 2026). Each separate Mesh is one draw call; a
// landmark built from 60 boxes in 6 colours becomes 6 draw calls.
// Only use on groups whose meshes never move, hide or swap materials on their
// own. InstancedMesh, SkinnedMesh, points, lines and anything marked
// userData.noBake are kept as they are. The group's own transform is kept, so
// a whole landmark can still be placed / turned as one.
import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();

// Materials that look the same (same type, colour, texture, flags) share one
// key, so a builder that made a new material per box still merges.
function matKey(m) {
  if (!m) return 'none';
  const hex = (c) => (c && c.isColor ? c.getHexString() : '');
  return [m.type, hex(m.color), hex(m.emissive), m.map ? m.map.uuid : '', m.transparent ? 1 : 0, m.opacity, m.side, m.vertexColors ? 1 : 0,
    m.flatShading ? 1 : 0, m.roughness ?? '', m.metalness ?? '', m.alphaTest, m.depthWrite ? 1 : 0, m.fog ? 1 : 0, m.wireframe ? 1 : 0].join('|');
}

export function bakeStatic(group, { dedupe = true } = {}) {
  const firstMat = new Map();
  group.updateMatrixWorld(true);
  _inv.copy(group.matrixWorld).invert();
  const by = new Map();
  const keep = [];
  let before = 0;
  const visit = (o) => {
    for (const c of o.children.slice()) {
      const plain = c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh && !Array.isArray(c.material) && c.visible && !c.userData.noBake && !c.morphTargetInfluences && c.children.length === 0;
      if (plain && c.geometry && c.geometry.attributes.position) {
        before++;
        _m.multiplyMatrices(_inv, c.matrixWorld);
        let g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
        for (const k of Object.keys(g.morphAttributes)) delete g.morphAttributes[k];
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(_m);
        // a mirrored transform flips the triangle winding: put it back
        if (_m.determinant() < 0) {
          const p = g.attributes.position;
          const arrs = [p, g.attributes.normal, g.attributes.uv];
          for (let i = 0; i < p.count; i += 3) {
            for (const a of arrs) {
              const s = a.itemSize;
              for (let k = 0; k < s; k++) {
                const t = a.array[(i + 1) * s + k];
                a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
                a.array[(i + 2) * s + k] = t;
              }
            }
          }
        }
        let key = c.material;
        if (dedupe) {
          const k = matKey(key);
          if (!firstMat.has(k)) firstMat.set(k, key);
          key = firstMat.get(k);
        }
        let e = by.get(key);
        if (!e) by.set(key, (e = { list: [], cast: false, recv: false, order: c.renderOrder }));
        e.list.push(g);
        e.cast ||= c.castShadow;
        e.recv ||= c.receiveShadow;
        o.remove(c);
      } else if (c.userData.noBake || !c.visible) {
        keep.push(c);
      } else if (c.isMesh || c.isPoints || c.isLine || c.isSprite) {
        keep.push(c);
        if (c.children.length) visit(c); // a mesh with parts hung on it
      } else {
        visit(c); // plain Group / Object3D: look inside
      }
    }
  };
  visit(group);
  // drop empty inner groups left behind
  const prune = (o) => {
    for (const c of o.children.slice()) {
      if (c.isMesh || c.isPoints || c.isLine || c.isSprite) continue;
      prune(c);
      if (!c.children.length && c.type === 'Group') o.remove(c);
    }
  };
  prune(group);
  let after = 0;
  for (const [mat, e] of by) {
    const geo = e.list.length === 1 ? e.list[0] : mergeGeometries(e.list);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = e.recv;
    mesh.renderOrder = e.order || 0;
    mesh.name = 'baked';
    group.add(mesh);
    after++;
    for (const g of e.list) if (g !== geo) g.dispose();
  }
  return { before, after };
}
