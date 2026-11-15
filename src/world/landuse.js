import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { toXZ } from '../core/geo.js';

const LANDUSE_COLOR = {
  residential: new THREE.Color('#8a9a68'),
  informal: new THREE.Color('#9a8f7c')
};

// Drapes OSM residential/informal polygons over the terrain as a subtle tint.
export function buildLanduse(hf, areas, { lift = 0.45, opacity = 0.4 } = {}) {
  const group = new THREE.Group();
  group.name = 'landuse';
  if (!Array.isArray(areas) || areas.length === 0) return group;

  const geometries = [];
  for (const area of areas) {
    if (!['residential', 'informal'].includes(area?.u)) continue;
    const ring = area?.p;
    if (!ring || ring.length < 4) continue;

    const pts = ring.map(([lon, lat]) => {
      const [x, z] = toXZ(lon, lat);
      return new THREE.Vector2(x, z);
    });
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first.distanceToSquared(last) < 1e-6) pts.pop();
    if (pts.length < 3) continue;

    let geo;
    try {
      geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    } catch {
      continue;
    }
    geo.rotateX(Math.PI / 2);
    geo.deleteAttribute('uv');

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = LANDUSE_COLOR[area.u] || LANDUSE_COLOR.residential;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const ground = hf.isWater(x, z) ? 0 : hf.heightAt(x, z);
      pos.setY(i, ground + lift);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geometries.push(geo);
  }

  if (geometries.length === 0) return group;

  const merged = mergeGeometries(geometries, false);
  for (const geo of geometries) geo.dispose();
  if (!merged) return group;

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'landuseMesh';
  mesh.renderOrder = -0.5;
  group.add(mesh);
  return group;
}
