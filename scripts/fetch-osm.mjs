import fs from 'node:fs/promises';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

const CACHE = new URL('../src/data/cache/', import.meta.url);
await fs.mkdir(CACHE, { recursive: true });

const zones = [
  { name: 'cbd', bbox: [-29.905, 30.985, -29.795, 31.065], roads: 'all' },
  { name: 'umlazi', bbox: [-30.005, 30.835, -29.905, 30.965], roads: 'all' },
  { name: 'kwamashu', bbox: [-29.790, 30.945, -29.675, 31.045], roads: 'all' },
  { name: 'connectors', bbox: [-29.910, 30.885, -29.665, 31.075], roads: 'major' }
];

const allRoads = '^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$';
const majorRoads = '^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function queryOnce(endpoint, query) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'IZK-Game/1.0 (Durban educational game; contact: local)' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(240000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('non-JSON response'); }
  if (!json.elements) throw new Error(json.remark || 'No elements');
  return json.elements;
}

async function cached(key, query) {
  const file = new URL(`${key}.json`, CACHE);
  try {
    const cachedJson = JSON.parse(await fs.readFile(file));
    console.log('cached', key, cachedJson.length, 'elements');
    return cachedJson;
  } catch {}
  let attempt = 0;
  let lastErr;
  while (attempt < 8) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log('Querying', key, 'via', new URL(endpoint).host, '...');
      const els = await queryOnce(endpoint, query);
      await fs.writeFile(file, JSON.stringify(els));
      console.log(' got', els.length, 'elements');
      return els;
    } catch (e) {
      lastErr = e;
      console.warn(' failed:', e.message, '- retrying');
      attempt++;
      await sleep(Math.min(4000 * attempt, 20000));
    }
  }
  throw lastErr;
}

const out = { source: 'OpenStreetMap / Overpass API', center: [-29.8587, 31.0218], fetched: new Date().toISOString(), roads: [], coastline: [], beaches: [] };

const coastQ = `[out:json][timeout:180];(
way["natural"="coastline"](-30.10,30.76,-29.60,31.14);
way["natural"="beach"](-30.10,30.76,-29.60,31.14);
);out geom;`;
const coast = await cached('coast', coastQ);
for (const el of coast) {
  if (!el.geometry) continue;
  const pts = el.geometry.map(p => [p.lon, p.lat]);
  if (el.tags?.natural === 'coastline') out.coastline.push({ id: el.id, tags: el.tags, points: pts });
  else out.beaches.push({ id: el.id, tags: el.tags, points: pts });
}
console.log('coastlines', out.coastline.length, 'beaches', out.beaches.length);

for (const zone of zones) {
  const [s, w, n, e] = zone.bbox;
  const hw = zone.roads === 'all' ? allRoads : majorRoads;
  const q = `[out:json][timeout:180];(
way["highway"~"${hw}"](${s},${w},${n},${e});
way["railway"="rail"](${s},${w},${n},${e});
);out geom;`;
  const els = await cached(zone.name, q);
  for (const el of els) {
    if (!el.geometry || el.geometry.length < 2) continue;
    const pts = el.geometry.map(p => [p.lon, p.lat]);
    if (el.tags?.railway === 'rail') {
      (out.rail = out.rail || []).push({ id: el.id, tags: el.tags, points: pts });
    } else {
      out.roads.push({ id: el.id, tags: el.tags, points: pts });
    }
  }
  await fs.writeFile(new URL('../src/data/durban-osm.json', import.meta.url), JSON.stringify(out));
  console.log('checkpoint written after', zone.name);
  await sleep(1000);
}

const seen = new Set();
out.roads = out.roads.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
console.log('unique roads', out.roads.length, 'total points', out.roads.reduce((a,r)=>a+r.points.length,0));

await fs.writeFile(new URL('../src/data/durban-osm.json', import.meta.url), JSON.stringify(out));
console.log('wrote durban-osm.json', (JSON.stringify(out).length/1024/1024).toFixed(2), 'MB');
