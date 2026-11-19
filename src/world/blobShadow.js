import * as THREE from '../../vendor/three/three.module.js';

// Soft contact shadows: one radial-gradient decal under cars, people and
// trees. Costs one transparent quad per object (no shadow maps), so it is
// safe on budget phones. Strength follows the sun (fainter at night / cloud).
let tex = null;
let mat = null;
export const SHADOW = { strength: { value: 0.55 } };

function blobTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function blobMaterial() {
  if (mat) return mat;
  tex = blobTexture();
  mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uShadow = SHADOW.strength;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uShadow;').replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= uShadow / 0.55;');
  };
  return mat;
}

// flat quad on the ground (y = lift), w across x, d across z, centred
export function blobGeometry(w, d, lift = 0.05, cx = 0, cz = 0) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, lift, cz);
  return g;
}
