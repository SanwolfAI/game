// Builds src/assets/props/public-props.glb: three small CC0 Poly Haven models
// (https://polyhaven.com/license) used around malls, parks and hospitals by
// src/world/publicPlaces.js, squeezed for budget phones:
//   painted_wooden_bench  (Kirill Sannikov)   park / mall benches      630 tris (kept)
//   planter_box_01        (James Ray Cock)    mall entrance planters   8k -> ~700 tris
//   metal_trash_can       (GurJas Studios)    bins                     6k -> ~500 tris
// Each model becomes ONE primitive (meshes merged, base at y = 0, centred),
// all three share ONE material whose texture is a 1024 px atlas of their
// 512 px diffuse maps (normal / ARM maps dropped: flat on a phone anyway).
// One-off tool, not needed at runtime. Needs gltf-transform + meshoptimizer + ImageMagick:
//   mkdir /tmp/gt && cd /tmp/gt && npm i @gltf-transform/core @gltf-transform/extensions meshoptimizer
//   node <repo>/scripts/optimize-public-props.mjs <repo>   (run from /tmp/gt so the modules resolve)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';

const repo = path.resolve(process.argv[2] || '.');
const tmp = process.env.PH_DIR || fs.mkdtempSync('/tmp/phprops-');
const MODELS = [
  { id: 'painted_wooden_bench', name: 'bench', keep: () => true, ratio: 1, scale: 1.45 },
  { id: 'planter_box_01', name: 'planter', keep: () => true, ratio: 0.09, scale: 1.9 },
  { id: 'metal_trash_can', name: 'bin', keep: (n) => !/rust/.test(n), ratio: 0.08, scale: 1.0 }
];

function fetchModel(id) {
  const dir = path.join(tmp, id);
  if (fs.existsSync(path.join(dir, id + '.gltf'))) return path.join(dir, id + '.gltf');
  fs.mkdirSync(dir, { recursive: true });
  const files = JSON.parse(execFileSync('curl', ['-s', '-m', '30', `https://api.polyhaven.com/files/${id}`]).toString());
  const g = files.gltf['1k'].gltf;
  execFileSync('curl', ['-s', '-m', '60', '-o', path.join(dir, id + '.gltf'), g.url]);
  for (const [rel, v] of Object.entries(g.include)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    execFileSync('curl', ['-s', '-m', '60', '-o', path.join(dir, rel), v.url]);
  }
  return path.join(dir, id + '.gltf');
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

const out = new Document();
const buf = out.createBuffer();
const atlasParts = [];
const meshes = [];
for (let mi = 0; mi < MODELS.length; mi++) {
  const M = MODELS[mi];
  const doc = await io.read(fetchModel(M.id));
  const P = [];
  const N = [];
  const U = [];
  const I = [];
  let diffuse = null;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !M.keep(node.getName())) continue;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (mat && mat.getBaseColorTexture() && !diffuse) diffuse = mat.getBaseColorTexture();
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      const base = P.length / 3;
      const e = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, e);
        const [x, y, z] = e;
        P.push(wm[0] * x + wm[4] * y + wm[8] * z + wm[12], wm[1] * x + wm[5] * y + wm[9] * z + wm[13], wm[2] * x + wm[6] * y + wm[10] * z + wm[14]);
        nor.getElement(i, e);
        const [a, b, c] = e;
        const nx = wm[0] * a + wm[4] * b + wm[8] * c;
        const ny = wm[1] * a + wm[5] * b + wm[9] * c;
        const nz = wm[2] * a + wm[6] * b + wm[10] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        N.push(nx / l, ny / l, nz / l);
        uv.getElement(i, e);
        U.push(Math.min(1, Math.max(0, e[0])), Math.min(1, Math.max(0, e[1])));
      }
      const idx = prim.getIndices();
      for (let i = 0; i < idx.getCount(); i++) I.push(base + idx.getScalar(i));
    }
  }
  // centre on x/z, base on y = 0, scale
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]);
    y0 = Math.min(y0, P[i + 1]);
    z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]);
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] = (P[i] - cx) * M.scale;
    P[i + 1] = (P[i + 1] - y0) * M.scale;
    P[i + 2] = (P[i + 2] - cz) * M.scale;
  }
  let idx = new Uint32Array(I);
  const before = idx.length / 3;
  if (M.ratio < 1) {
    const target = Math.floor((idx.length * M.ratio) / 3) * 3;
    const [res] = MeshoptSimplifier.simplify(idx, new Float32Array(P), 3, target, 0.02, ['LockBorder']);
    idx = res;
  }
  // keep only used vertices
  const remap = new Map();
  const P2 = [], N2 = [], U2 = [], I2 = [];
  const col = mi % 2;
  const row = Math.floor(mi / 2);
  for (const v of idx) {
    if (!remap.has(v)) {
      remap.set(v, P2.length / 3);
      P2.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      N2.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      // into the 2 x 2 atlas (half-texel inset so mips don't bleed much)
      U2.push(col * 0.5 + 0.002 + U[v * 2] * 0.496, row * 0.5 + 0.002 + U[v * 2 + 1] * 0.496);
    }
    I2.push(remap.get(v));
  }
  console.log(M.name, 'tris', before, '->', I2.length / 3, 'size', [(x1 - x0) * M.scale, (z1 - z0) * M.scale].map((v) => v.toFixed(2)).join(' x '));
  const img = path.join(tmp, M.name + '_diff.png');
  fs.writeFileSync(img + '.src', Buffer.from(diffuse.getImage()));
  execFileSync('convert', [img + '.src', '-resize', '512x512!', img]);
  atlasParts[mi] = img;
  const acc = (arr, type, T) => out.createAccessor().setType(type).setArray(new T(arr)).setBuffer(buf);
  meshes.push({ name: M.name, prim: { P: acc(P2, 'VEC3', Float32Array), N: acc(N2, 'VEC3', Float32Array), U: acc(U2, 'VEC2', Float32Array), I: acc(I2, 'SCALAR', Uint16Array) } });
}
// 2 x 2 atlas, empty slot filled grey
const blank = path.join(tmp, 'blank.png');
execFileSync('convert', ['-size', '512x512', 'xc:#808080', blank]);
const atlas = path.join(tmp, 'atlas.jpg');
execFileSync('montage', [atlasParts[0], atlasParts[1], atlasParts[2] || blank, blank, '-tile', '2x2', '-geometry', '512x512+0+0', '-quality', '80', atlas]);
const tex = out.createTexture('public-props-atlas').setMimeType('image/jpeg').setImage(fs.readFileSync(atlas));
const mat = out.createMaterial('public-props').setBaseColorTexture(tex).setRoughnessFactor(0.9).setMetallicFactor(0);
const scene = out.createScene();
for (const m of meshes) {
  const prim = out.createPrimitive().setAttribute('POSITION', m.prim.P).setAttribute('NORMAL', m.prim.N).setAttribute('TEXCOORD_0', m.prim.U).setIndices(m.prim.I).setMaterial(mat);
  const mesh = out.createMesh(m.name).addPrimitive(prim);
  scene.addChild(out.createNode(m.name).setMesh(mesh));
}
const dst = path.join(repo, 'src/assets/props/public-props.glb');
fs.mkdirSync(path.dirname(dst), { recursive: true });
await io.write(dst, out);
console.log('wrote', dst, fs.statSync(dst).size, 'bytes');
