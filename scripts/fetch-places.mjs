import fs from 'node:fs/promises';

const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

const CACHE = new URL('../src/data/cache/', import.meta.url);
await fs.mkdir(CACHE, { recursive: true });

const BBOX = [-30.10, 30.75, -29.60, 31.15];
const PLACE_RE = '^(township|suburb|neighbourhood|quarter|town|village)$';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryOnce(endpoint, query) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'IZK-Durban-Game/1.0 (educational; OSM ODbL)'
    },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(170000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('non-JSON response');
  }
  if (!json.elements) throw new Error(json.remark || 'No elements');
  return json.elements;
}

async function cached(key, query) {
  const file = new URL(`${key}.json`, CACHE);
  try {
    const data = JSON.parse(await fs.readFile(file));
    console.log('cached', key, data.length, 'elements');
    return data;
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

const placeQ = `[out:json][timeout:200];(
node["place"~"${PLACE_RE}"](${BBOX.join(',')});
way["place"~"${PLACE_RE}"](${BBOX.join(',')});
relation["place"~"${PLACE_RE}"](${BBOX.join(',')});
);out center tags;`;

const geomQ = `[out:json][timeout:200];(
way["place"~"${PLACE_RE}"](${BBOX.join(',')});
relation["place"~"${PLACE_RE}"](${BBOX.join(',')});
);out geom tags;`;

const landuseQ = `[out:json][timeout:200];(
way["landuse"~"^(residential|informal)$"](${BBOX.join(',')});
relation["landuse"~"^(residential|informal)$"](${BBOX.join(',')});
);out geom tags;`;

const labels = await cached('places', placeQ);
const geoms = await cached('places-geom', geomQ);
const landuse = await cached('landuse', landuseQ);

function centerOf(el) {
  if (el.type === 'node') return [el.lon, el.lat];
  if (el.center) return [el.center.lon, el.center.lat];
  return null;
}

const areas = geoms
  .map((el) => {
    let rings = [];
    if (el.type === 'way' && el.geometry) {
      rings = [el.geometry.map((p) => [p.lon, p.lat])];
    } else if (el.type === 'relation' && el.members) {
      for (const m of el.members) {
        if (m.type !== 'way' || !m.geometry) continue;
        if (m.role && m.role !== 'outer') continue;
        rings.push(m.geometry.map((p) => [p.lon, p.lat]));
      }
    }
    return {
      id: el.id,
      type: el.type,
      name: el.tags?.name || '',
      place: el.tags?.place || '',
      ring: rings.sort((a, b) => b.length - a.length)[0] || null
    };
  })
  .filter((a) => a.ring && a.ring.length > 2 && a.name);

const byName = new Map();
for (const a of areas) {
  const prev = byName.get(a.name);
  if (!prev || (a.ring?.length || 0) > (prev.ring?.length || 0)) byName.set(a.name, a);
}

for (const el of labels) {
  const name = el.tags?.name;
  const c = centerOf(el);
  if (!name || !c || byName.has(name)) continue;
  byName.set(name, {
    id: el.id,
    type: el.type,
    name,
    place: el.tags?.place || '',
    center: c,
    ring: null
  });
}

const places = [...byName.values()];
console.log('place areas', areas.length, 'unique named places', places.length, 'landuse polygons', landuse.length);

await fs.writeFile(new URL('../src/data/places-raw.json', import.meta.url), JSON.stringify({
  source: 'OpenStreetMap / Overpass API',
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  fetched: new Date().toISOString(),
  bbox: BBOX,
  places,
  landuse: landuse.map((el) => {
    let rings = [];
    if (el.type === 'way' && el.geometry) rings = [el.geometry.map((p) => [p.lon, p.lat])];
    else if (el.type === 'relation' && el.members) {
      rings = el.members
        .filter((m) => m.type === 'way' && m.geometry && (!m.role || m.role === 'outer'))
        .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
    }
    return {
      id: el.id,
      name: el.tags?.name || '',
      landuse: el.tags?.landuse || '',
      ring: rings.sort((a, b) => b.length - a.length)[0] || null
    };
  }).filter((l) => l.ring && l.ring.length > 2)
}));

console.log('wrote places-raw.json');
