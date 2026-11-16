// Fetches OSM building footprints and green/land-use areas for the core of
// Durban in small tiles (Overpass is flaky with big boxes) and caches each
// tile under src/data/cache/bld-*.json. Re-run until every tile is cached,
// then run `node scripts/build-buildings.mjs` to pack them.
// Usage: node scripts/fetch-buildings.mjs [maxSeconds]
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const CACHE = process.env.OSM_TILE_CACHE || new URL('../../work/osm-tiles/', import.meta.url).pathname;
fs.mkdirSync(CACHE, { recursive: true });

// [south, west, north, east] core region in 0.02 degree tiles.
export const BUILDING_REGION = [-29.92, 30.94, -29.70, 31.10];
export const AREA_REGION = [-29.96, 30.90, -29.68, 31.12];
const STEP = 0.02;

function tiles(region, step) {
  const out = [];
  for (let s = region[0]; s < region[2] - 1e-9; s += step) {
    for (let w = region[1]; w < region[3] - 1e-9; w += step) {
      out.push([+s.toFixed(3), +w.toFixed(3), +(s + step).toFixed(3), +(w + step).toFixed(3)]);
    }
  }
  return out;
}

function curl(ep, q) {
  return new Promise((resolve) => {
    execFile('curl', ['-s', '-m', '100', '-X', 'POST', ep, '--data-urlencode', `data=${q}`], { maxBuffer: 512 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null);
      try {
        const json = JSON.parse(out);
        resolve(Array.isArray(json.elements) ? json.elements : null);
      } catch {
        resolve(null);
      }
    });
  });
}

async function query(q) {
  for (let i = 0; i < 3; i++) {
    const els = await curl(ENDPOINTS[0], q);
    if (els) return els;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

const maxSeconds = Number(process.argv[2] || 100);
const t0 = Date.now();
const jobs = [];
for (const t of tiles(BUILDING_REGION, STEP)) {
  const bb = t.join(',');
  jobs.push({ key: `bld-${bb}`, q: `[out:json][timeout:100];way["building"](${bb});out tags geom qt;` });
}
for (const t of tiles(AREA_REGION, 0.04)) {
  const bb = t.join(',');
  jobs.push({
    key: `area-${bb}`,
    q: `[out:json][timeout:100];(way["leisure"~"^(park|garden|golf_course|pitch|nature_reserve|stadium|playground|recreation_ground)$"](${bb});way["landuse"~"^(forest|grass|industrial|commercial|retail|cemetery|recreation_ground|meadow|farmland|port|railway|village_green|construction|brownfield)$"](${bb});way["natural"~"^(wood|scrub|grassland|sand|beach|wetland|heath)$"](${bb});way["amenity"~"^(parking|school)$"](${bb}););out tags geom qt;`
  });
}
let done = 0;
let fetched = 0;
const todo = jobs.filter((j) => !fs.existsSync(`${CACHE}${j.key}.json`));
done = jobs.length - todo.length;
const CONC = Number(process.env.CONC || 6);
async function worker() {
  while (todo.length && (Date.now() - t0) / 1000 < maxSeconds) {
    const job = todo.shift();
    const els = await query(job.q);
    if (els) {
      fs.writeFileSync(`${CACHE}${job.key}.json`, JSON.stringify(els));
      done++;
      fetched++;
      console.log('ok', job.key, els.length);
    } else console.log('fail', job.key);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`${done}/${jobs.length} tiles cached (${fetched} new)`);
