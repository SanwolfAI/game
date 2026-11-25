// Far / tiny culling for static far-away things (performance pass, 25 Nov
// 2026). Three.js only skips what is outside the view; ships and landmarks
// 3-5 km away were still drawn even when they covered less than one pixel or
// sat fully inside the fog. Twice a second this hides:
//   - anything smaller than ~1 screen pixel (at the real native resolution),
//   - anything wholly past the fog's far end (it would draw as fog colour).
// It never changes resolution (native pixel ratio rule stays). Only objects
// handed to it are touched, and only ones nobody else shows / hides.
import * as THREE from '../../vendor/three/three.module.js';

const _s = new THREE.Sphere();

export class FarCull {
  constructor(camera, scene, renderer) {
    this.camera = camera;
    this.scene = scene;
    this.renderer = renderer;
    this.items = [];
    this.t = 0;
    this.hidden = 0;
  }

  // mode 'tiny' = pixel size + fog test, 'fog' = fog test only (big
  // instanced blocks whose bounding sphere spans many buildings)
  add(obj, mode = 'tiny') {
    if (!obj.isMesh && !obj.isGroup && !obj.isObject3D) return;
    if (obj.geometry && !obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere();
    this.items.push({ o: obj, mode, off: false });
  }

  addMeshesOf(group, mode = 'tiny') {
    group.traverse((o) => {
      if (o.isMesh) this.add(o, mode);
    });
  }

  update(dt) {
    this.t += dt;
    if (this.t < 0.45 || !this.items.length) return;
    this.t = 0;
    const cam = this.camera;
    const h = this.renderer.domElement.height || 720;
    const k = h / 2 / Math.tan((cam.fov * Math.PI) / 360); // px per (radius / distance)
    const fogFar = this.scene.fog ? this.scene.fog.far : Infinity;
    const p = cam.position;
    let hidden = 0;
    for (const it of this.items) {
      const o = it.o;
      if (!o.parent) continue;
      const g = o.geometry;
      if (!g || !g.boundingSphere) continue;
      if (o.isInstancedMesh && o.boundingSphere) _s.copy(o.boundingSphere);
      else _s.copy(g.boundingSphere);
      _s.applyMatrix4(o.matrixWorld);
      const d = _s.center.distanceTo(p);
      let off = d - _s.radius > fogFar * 1.02;
      if (!off && it.mode === 'tiny' && d > 300) off = (_s.radius / d) * k < 1.0;
      if (off !== it.off) {
        it.off = off;
        o.visible = !off;
      }
      if (off) hidden++;
    }
    this.hidden = hidden;
  }
}
