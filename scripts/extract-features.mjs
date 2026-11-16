// Extracts OSM road features (traffic signals, stop / give-way signs, pedestrian
// crossings, level crossings, motorway exits) from a durban-game.json that has
// a `features` array (main's data build) and keeps only those within 14 m of a
// road in this branch's map. Output: src/data/durban-features.json
// Usage: node scripts/extract-features.mjs /path/to/main/durban-game.json
import fs from 'node:fs';
import { toXZ } from '../src/core/geo.js';

const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ours = JSON.parse(fs.readFileSync(new URL('../src/data/durban-game.json', import.meta.url), 'utf8'));
const G = 50;
const grid = new Map();
for (const r of ours.roads) {
  let prev = null;
  for (const p of r.p) {
    const q = toXZ(p[0], p[1]);
    if (prev) {
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - prev[0], q[1] - prev[1]) / 10));
      for (let i = 0; i <= n; i++) {
        const x = prev[0] + ((q[0] - prev[0]) * i) / n;
        const z = prev[1] + ((q[1] - prev[1]) * i) / n;
        const k = Math.floor(x / G) * 100000 + Math.floor(z / G);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(x, z);
      }
    }
    prev = q;
  }
}
function near(x, z, d) {
  const gx = Math.floor(x / G);
  const gz = Math.floor(z / G);
  for (let a = gz - 1; a <= gz + 1; a++) {
    for (let b = gx - 1; b <= gx + 1; b++) {
      const l = grid.get(b * 100000 + a);
      if (!l) continue;
      for (let i = 0; i < l.length; i += 2) if (Math.hypot(l[i] - x, l[i + 1] - z) < d) return true;
    }
  }
  return false;
}
const out = [];
const counts = {};
for (const f of src.features || []) {
  const t = f.t || {};
  let k = null;
  if (t.highway === 'traffic_signals') k = 'signals';
  else if (t.highway === 'stop') k = 'stop';
  else if (t.highway === 'give_way') k = 'yield';
  else if (t.highway === 'crossing') k = t.crossing === 'traffic_signals' ? 'crossing_signals' : t.crossing_ref === 'zebra' || t.crossing === 'zebra' ? 'zebra' : 'crossing';
  else if (t.railway === 'level_crossing') k = 'rail';
  else if (t.highway === 'motorway_junction') k = 'exit';
  if (!k) continue;
  const [x, z] = toXZ(f.p[0], f.p[1]);
  if (!near(x, z, 14)) continue;
  const rec = { k, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
  if (k === 'exit') {
    if (t.ref) rec.ref = t.ref;
    if (t.name || t.exit_to || t.destination) rec.name = t.exit_to || t.destination || t.name;
  }
  out.push(rec);
  counts[k] = (counts[k] || 0) + 1;
}
fs.writeFileSync(new URL('../src/data/durban-features.json', import.meta.url), JSON.stringify({ v: 1, features: out }));
console.log(out.length, 'features', JSON.stringify(counts));
