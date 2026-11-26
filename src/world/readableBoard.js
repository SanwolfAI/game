import * as THREE from '../../vendor/three/three.module.js';

// Text boards that read left to right from BOTH sides (owner bug, 26 Nov 2026:
// "names on signs read back to front"). A single plane with DoubleSide shows
// its canvas text mirrored from behind. Instead: the front face as it is, plus
// a copy turned 180° about the board's own up axis (local Y), so the back is a
// real front face with the same UVs. Use with a FrontSide material.
// One small non-indexed geometry: 4 triangles for a plain board.
export function readableBothSides(geo, gap = 0) {
  const front = geo.index ? geo.toNonIndexed() : geo.clone();
  const back = front.clone();
  back.rotateY(Math.PI);
  if (gap) {
    front.translate(0, 0, gap / 2);
    back.translate(0, 0, -gap / 2);
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(front.attributes)) {
    const a = front.attributes[name];
    const b = back.attributes[name];
    const arr = new a.array.constructor(a.array.length + b.array.length);
    arr.set(a.array, 0);
    arr.set(b.array, a.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  geo.dispose();
  return out;
}

// a PlaneGeometry board (w x h) readable from both sides
export function readablePlane(w, h) {
  return readableBothSides(new THREE.PlaneGeometry(w, h));
}
