// Turns the Grab3D "Bus Stop Shelter" (CC0, https://grab3d.com/models/city/bus-stop-shelter/)
// into the small game GLB src/assets/props/bus-shelter.glb used by src/world/shelters.js:
//  - steel frame/roof recoloured to the blue of eThekwini municipal shelters
//    (Mapillary street photos, e.g. Durban North / Umgeni Rd stops), done on the texture
//  - textures cut to 512 px, normal + metal/rough maps dropped (flat on a phone anyway)
//  - bolts and fittings under 10 cm dropped, body simplified: ~11k -> ~2.5k triangles
// One-off tool, not needed at runtime. Needs gltf-transform + meshoptimizer + ImageMagick:
//   mkdir /tmp/gt && cd /tmp/gt && npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer
//   cp <repo>/scripts/optimize-shelter.mjs /tmp/gt/ && node /tmp/gt/optimize-shelter.mjs <repo>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const repo = path.resolve(process.argv[2] || '.');
const SRC = 'https://grab3d.com/dl/bus-stop-shelter/bus-stop-shelter.glb';
const tmp = fs.mkdtempSync('/tmp/shelter-');
const srcGlb = path.join(tmp, 'src.glb');
execFileSync('curl', ['-sL', '-m', '60', '-o', srcGlb, SRC]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const doc = await io.read(srcGlb);
const root = doc.getRoot();

function tris() {
  let t = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3;
  return t;
}
const before = tris();

// recolour steel grey -> municipal blue on the body atlas; keep light panels (poster/info) as they are
const W = '(min(1,max(0,(0.62-(u.r+u.g+u.b)/3)/0.12))*min(1,max(0,(0.12-(max(u.r,max(u.g,u.b))-min(u.r,min(u.g,u.b))))/0.06)))';
const K = '(0.55+1.3*(u.r+u.g+u.b)/3)';
const BLUE = [0.16, 0.33, 0.62];
function img(buf, name, tint) {
  const a = path.join(tmp, name + '.jpg');
  const b512 = path.join(tmp, name + '_512.png');
  const out = path.join(tmp, name + '_out.jpg');
  fs.writeFileSync(a, buf);
  execFileSync('convert', [a, '-resize', '512x512', b512]);
  if (tint) {
    const ch = ['r', 'g', 'b'].map((c, i) => {
      const f = path.join(tmp, `${name}_${c}.png`);
      execFileSync('convert', [b512, '-fx', `u.${c}*(1-${W})+${BLUE[i]}*${K}*${W}`, '-channel', 'R', '-separate', f]);
      return f;
    });
    execFileSync('convert', [...ch, '-combine', '-quality', '82', out]);
  } else execFileSync('convert', [b512, '-quality', '82', out]);
  return fs.readFileSync(out);
}

for (const m of root.listMaterials()) {
  const n = m.getName();
  for (const t of [m.getNormalTexture(), m.getMetallicRoughnessTexture()]) if (t) t.dispose();
  m.setNormalTexture(null).setMetallicRoughnessTexture(null);
  const bc = m.getBaseColorTexture();
  if (bc) bc.setImage(img(bc.getImage(), n, /body/.test(n))).setMimeType('image/jpeg');
  m.setMetallicFactor(/body/.test(n) ? 0.35 : 0).setRoughnessFactor(/glass/.test(n) ? 0.1 : 0.6);
}
// drop bolts, caps and fittings under 10 cm (about 7k of the 10k body triangles,
// invisible from a car), then simplify what is left
function dropSmallParts(prim, minSize) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const nv = pos.length / 3;
  const km = new Map();
  const rep = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = `${pos[i * 3].toFixed(4)},${pos[i * 3 + 1].toFixed(4)},${pos[i * 3 + 2].toFixed(4)}`;
    if (!km.has(k)) km.set(k, i);
    rep[i] = km.get(k);
  }
  const par = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (a) => {
    while (par[a] !== a) a = par[a] = par[par[a]];
    return a;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(rep[idx[t]]);
    par[find(rep[idx[t + 1]])] = a;
    par[find(rep[idx[t + 2]])] = a;
  }
  const box = new Map();
  for (let t = 0; t < idx.length; t++) {
    const r = find(rep[idx[t]]);
    let b = box.get(r);
    if (!b) box.set(r, (b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]));
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], pos[idx[t] * 3 + k]);
      b[k + 3] = Math.max(b[k + 3], pos[idx[t] * 3 + k]);
    }
  }
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const b = box.get(find(rep[idx[t]]));
    if (Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) >= minSize) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  prim.getIndices().setArray(new Uint32Array(keep));
}
for (const node of root.listNodes()) if (/body/.test(node.getName())) for (const p of node.getMesh().listPrimitives()) dropSmallParts(p, 0.1);
// simplify the heavy body mesh only (bench/glass/info are already tiny)
await doc.transform(dedup(), weld());
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.003, lockBorder: false }), prune());
fs.mkdirSync(path.join(repo, 'src/assets/props'), { recursive: true });
const dst = path.join(repo, 'src/assets/props/bus-shelter.glb');
await io.write(dst, doc);
console.log(`triangles ${before} -> ${tris()}, ${fs.statSync(dst).size} bytes -> ${dst}`);
