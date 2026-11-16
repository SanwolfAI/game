import * as THREE from '../../vendor/three/three.module.js';

// Shared uniforms the world shaders read (updated once per frame in main.js):
// night 0..1 (lit windows, lamps), day 0..1, sky = current horizon colour,
// time = seconds (water, flicker).
export const WORLD = {
  night: { value: 0 },
  day: { value: 1 },
  sky: { value: new THREE.Color(0x9fc6e2) },
  time: { value: 0 }
};
