// Turns the Sketchfab ZIPs in models/import/ into small game-ready GLBs in
// src/assets/vehicles/ (merged draw calls, simplified to < 20k triangles,
// wheel nodes kept so they can spin and steer).
//
// One-off tool, not needed at runtime. Needs gltf-transform + meshoptimizer:
//   mkdir /tmp/gt && cd /tmp/gt && npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer
//   cp <repo>/scripts/optimize-vehicles.mjs /tmp/gt/ && node /tmp/gt/optimize-vehicles.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, join, simplify, simplifyPrimitive, prune, flatten, textureCompress, transformPrimitive } from '@gltf-transform/functions';
import { mat4 } from 'gl-matrix';
import { MeshoptSimplifier } from 'meshoptimizer';

const repo = path.resolve(process.argv[2] || '.');
const out = path.join(repo, 'src/assets/vehicles');
fs.mkdirSync(out, { recursive: true });

// ratio: fraction of triangles to keep; drop: material names removed entirely (unseen underside parts).
const CARS = [
  { id: 'gusheshe', ratio: 0.3, error: 0.004, wheelRatio: 0.3, drop: ['underbody', 'arch_liner', 'carpet', 'headliner', 'brake_disc', 'caliper', 'panel_gap'] },
  { id: 'bmw-lowpoly', ratio: 1, error: 0 },
  { id: 'hiace', ratio: 1, error: 0 }
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

function tris(doc) {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      t += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(t);
}

for (const car of CARS) {
  const zip = path.join(repo, 'models/import', `${car.id}.zip`);
  if (!fs.existsSync(zip)) {
    console.log('missing', zip);
    continue;
  }
  const tmp = fs.mkdtempSync('/tmp/izk-car-');
  execFileSync('unzip', ['-oq', zip, '-d', tmp]);
  const doc = await io.read(path.join(tmp, 'scene.gltf'));
  const before = tris(doc);
  if (car.drop) {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const p of mesh.listPrimitives()) {
        const m = p.getMaterial();
        if (m && car.drop.includes(m.getName())) {
          mesh.removePrimitive(p);
          p.dispose();
        }
      }
    }
  }
  // Collapse each wheel_XX subtree into one mesh on the wheel node itself, so
  // the wheel keeps its own pivot after flatten/join; clear other node names
  // so all body parts can be joined into one primitive per material.
  const wheelNodes = doc.getRoot().listNodes().filter((n) => /^wheel_(fl|fr|rl|rr)/i.test(n.getName()));
  for (const w of wheelNodes) {
    const inv = mat4.invert(mat4.create(), w.getWorldMatrix());
    const mesh = doc.createMesh(w.getName());
    w.traverse((n) => {
      const m = n.getMesh();
      if (!m || n === w) return;
      const rel = mat4.multiply(mat4.create(), inv, n.getWorldMatrix());
      for (const p of m.listPrimitives()) {
        const c = p.clone();
        transformPrimitive(c, rel);
        mesh.addPrimitive(c);
      }
    });
    for (const c of w.listChildren()) w.removeChild(c);
    w.setMesh(mesh);
  }
  const wheelSet = new Set(wheelNodes);
  for (const n of doc.getRoot().listNodes()) if (!wheelSet.has(n)) n.setName('');
  await doc.transform(
    dedup(),
    flatten(),
    join({ keepNamed: true }),
    weld({ tolerance: 0.0001 }),
    ...(car.ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio: car.ratio, error: car.error, lockBorder: false })] : []),
    prune()
  );
  if (car.wheelRatio) {
    for (const w of wheelNodes) {
      for (const p of w.getMesh()?.listPrimitives() || []) {
        simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: car.wheelRatio, error: 0.02, lockBorder: false });
      }
    }
    await doc.transform(prune());
  }
  // Keep textures at <= 512 px for the APK.
  try {
    await doc.transform(textureCompress({ resize: [512, 512] }));
  } catch {
    /* sharp not installed: keep original textures */
  }
  const file = path.join(out, `${car.id}.glb`);
  await io.write(file, doc);
  fs.copyFileSync(path.join(tmp, 'license.txt'), path.join(out, `${car.id}-license.txt`));
  console.log(car.id, before, '->', tris(doc), 'tris', fs.statSync(file).size, 'bytes');
}
