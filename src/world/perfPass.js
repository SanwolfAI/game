// Performance pass for budget phones (Hisense E32 Pro, Samsung A04), run once
// after the game has booted (25 Nov 2026). Measured at the start spot:
// ~690 draw calls in view, of which landmarks 191 (one material per box),
// harbour ships 236 and old city blocks 122 were all 3+ km away and mostly
// under one pixel. This keeps the look and the native pixel ratio:
//   1. landmarks: merge each landmark's boxes by look -> a few draw calls each
//   2. harbour ships + landmarks: hide parts smaller than a pixel / past fog
//   3. old city blocks: hide whole blocks past the fog
import { bakeStatic } from './bakeStatic.js';
import { FarCull } from './farCull.js';

export function perfPass(z) {
  const report = { baked: [], cull: 0 };
  const scene = z.scene;
  const lm = scene.getObjectByName('landmarks');
  if (lm) {
    for (const g of lm.children.slice()) {
      try {
        const r = bakeStatic(g);
        report.baked.push([g.name, r.before, r.after]);
      } catch (err) {
        console.warn('[IZK] bake', g.name, err);
      }
    }
  }
  const cull = new FarCull(z.camera, scene, z.renderer);
  if (lm) cull.addMeshesOf(lm, 'tiny');
  const hb = scene.getObjectByName('harbour');
  if (hb) {
    // ships / tugs: every merged part on its own (funnels vanish first)
    for (const c of hb.children) {
      if (c.isMesh && !c.isInstancedMesh) cull.add(c, 'tiny');
      else if (!c.isMesh) c.traverse((o) => o.isMesh && cull.add(o, o.isInstancedMesh ? 'fog' : 'tiny'));
    }
  }
  const city = scene.getObjectByName('city');
  if (city) for (const c of city.children) if (c.isInstancedMesh) cull.add(c, 'fog');
  report.cull = cull.items.length;
  return { cull, report };
}
