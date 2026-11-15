import fs from 'node:fs/promises';

const raw = JSON.parse(await fs.readFile(new URL('../src/data/durban-osm.json', import.meta.url)));

function rdp(points, tol) {
  if (points.length < 3) return points;
  const sqTol = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    const [x1, y1] = points[start], [x2, y2] = points[end];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let maxDist = 0, maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const [x, y] = points[i];
      let d2;
      if (len2 === 0) d2 = (x - x1) ** 2 + (y - y1) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
        d2 = (x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2;
      }
      if (d2 > maxDist) { maxDist = d2; maxIndex = i; }
    }
    if (maxDist > sqTol && maxIndex > 0) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

// Order coastline ways into long continuous chains.
const ways = raw.coastline.map(w => ({ id: w.id, pts: w.points.map(round) }));
const used = new Set();
const near = (a, b) => Math.abs(a[0] - b[0]) < 2e-4 && Math.abs(a[1] - b[1]) < 2e-4;
const chains = [];
for (const seed of ways) {
  if (used.has(seed.id)) continue;
  let chain = [...seed.pts];
  used.add(seed.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of ways) {
      if (used.has(w.id)) continue;
      if (near(chain[chain.length - 1], w.pts[0])) { chain.push(...w.pts.slice(1)); used.add(w.id); changed = true; }
      else if (near(chain[chain.length - 1], w.pts[w.pts.length - 1])) { chain.push(...w.pts.slice(0, -1).reverse()); used.add(w.id); changed = true; }
      else if (near(chain[0], w.pts[w.pts.length - 1])) { chain.unshift(...w.pts.slice(0, -1)); used.add(w.id); changed = true; }
      else if (near(chain[0], w.pts[0])) { chain.unshift(...w.pts.slice(1).reverse()); used.add(w.id); changed = true; }
    }
  }
  if (chain.length > 3) chains.push(chain);
}
chains.sort((a, b) => b.length - a.length);
console.log('coast chains', chains.map(c => c.length));

const tol = 0.000018;
const roads = raw.roads.map(r => {
  const hw = r.tags.highway;
  const simplify = ['motorway','trunk','primary','secondary','tertiary'].includes(hw) ? 0.000012 : 0.000022;
  const pts = [];
  let last = null;
  for (const p of r.points) {
    const q = round(p);
    if (!last || q[0] !== last[0] || q[1] !== last[1]) pts.push(q);
    last = q;
  }
  const simp = rdp(pts, simplify);
  // OSM oneway=-1 means traffic travels opposite to the stored way geometry.
  // Reverse the geometry so the road graph's forward edge follows legal traffic.
  const directed = r.tags.oneway === '-1' ? simp.reverse() : simp;
  return {
    id: r.id,
    h: hw,
    n: r.tags.old_name || r.tags.name || '',
    r: r.tags.ref || '',
    w: Number(r.tags.lanes) || 0,
    o: r.tags.oneway === 'yes' || r.tags.oneway === '1' || r.tags.oneway === '-1' ? 1 : 0,
    b: r.tags.bridge === 'yes' ? 1 : 0,
    p: directed
  };
});

const beaches = raw.beaches.map(b => ({ id: b.id, n: b.tags.name || '', p: b.points.map(round) }));

const rail = (raw.rail || []).map(r => {
  const pts = [];
  let last = null;
  for (const p of r.points) {
    const q = round(p);
    if (!last || q[0] !== last[0] || q[1] !== last[1]) pts.push(q);
    last = q;
  }
  return { id: r.id, n: r.tags.name || '', p: rdp(pts, 0.00002) };
}).filter(r => r.p.length > 1);
const chain = chains[0] || [];
const flatCoast = chain.map(round);

// Optional place labels / landuse fetched by scripts/fetch-places.mjs.
const M_PER_DEG_LON = 111320 * Math.cos((-29.8587 * Math.PI) / 180);
const M_PER_DEG_LAT = 110574;
const PLACE_RADIUS = { town: 2100, suburb: 950, neighbourhood: 480, quarter: 600, village: 800 };

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs((a / 2) * M_PER_DEG_LON * M_PER_DEG_LAT);
}

function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  let w = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
    w += cross;
  }
  if (Math.abs(w) < 1e-12) {
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [x / (3 * w), y / (3 * w)];
}

let placesRaw = null;
try {
  placesRaw = JSON.parse(await fs.readFile(new URL('../src/data/places-raw.json', import.meta.url)));
} catch {
  console.warn('no places-raw.json; run scripts/fetch-places.mjs to add OSM place labels');
}

const places = [];
for (const p of placesRaw?.places || []) {
  const kind = p.place || 'suburb';
  let ring = p.ring && p.ring.length > 3 ? rdp(p.ring.map(round), 0.00005) : null;
  if (ring && ring.length < 4) ring = null;
  const c = ring ? ringCentroid(ring) : p.center;
  if (!c) continue;
  const area = ring ? ringArea(ring) : 0;
  const r = ring
    ? Math.max(180, Math.min(3200, Math.sqrt(area / Math.PI)))
    : PLACE_RADIUS[kind] || 700;
  const entry = { n: p.name, k: kind, c: [round(c)[0], round(c)[1]], r: Math.round(r) };
  if (ring) entry.p = ring;
  places.push(entry);
}

const landuse = (placesRaw?.landuse || [])
  .map((l) => ({ u: l.landuse || '', p: rdp(l.ring.map(round), 0.00012) }))
  .filter((l) => l.p.length > 3)
  .map((l) => ({ p: l.p, a: Math.round(ringArea(l.p)), u: l.u }))
  .filter((l) => l.a > 20000);

const out = {
  center: raw.center,
  fetched: raw.fetched,
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  coast: flatCoast,
  coastChains: chains.map(c => c.map(round)),
  beaches,
  rail,
  roads,
  places,
  landuse
};
const txt = JSON.stringify(out);
await fs.writeFile(new URL('../src/data/durban-game.json', import.meta.url), txt);
console.log('roads', roads.length, 'points', roads.reduce((a,r)=>a+r.p.length,0), 'coast', flatCoast.length, 'places', places.length, 'landuse', landuse.length, 'size', (txt.length/1024/1024).toFixed(2), 'MB');
