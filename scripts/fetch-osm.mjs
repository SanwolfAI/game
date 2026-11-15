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
  { name: '01-cbd', bbox: [-29.905, 30.985, -29.795, 31.065], roads: 'all' },
  { name: '02-golden-mile', bbox: [-29.875, 31.015, -29.835, 31.055], roads: 'all' },
  { name: '03-berea-morningside', bbox: [-29.865, 30.975, -29.805, 31.045], roads: 'all' },
  { name: '04-bluff', bbox: [-30.005, 30.965, -29.885, 31.045], roads: 'all' },
  { name: '05-n3-western', bbox: [-29.965, 30.805, -29.835, 31.015], roads: 'major' },
  { name: '06-eb-cloete', bbox: [-29.925, 30.965, -29.865, 31.025], roads: 'major' },
  { name: '07-n2-north', bbox: [-29.865, 30.985, -29.625, 31.145], roads: 'major' },
  { name: '08-n2-south', bbox: [-30.105, 30.865, -29.865, 31.035], roads: 'major' },
  { name: '09-umlazi', bbox: [-30.005, 30.835, -29.905, 30.965], roads: 'all' },
  { name: '10-kwamashu-ntuzuma', bbox: [-29.790, 30.925, -29.675, 31.055], roads: 'all' },
  { name: '11-phoenix-inanda', bbox: [-29.790, 30.935, -29.635, 31.105], roads: 'all' },
  { name: '12-chatsworth-lamont-wentworth', bbox: [-30.005, 30.885, -29.885, 31.025], roads: 'all' }
];

const allRoads = '^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|track|path|footway|pedestrian|steps|cycleway|bridleway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$';
const majorRoads = '^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function queryOnce(endpoint, query) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'IZK-Game/1.0 (Durban offline map build)'
    },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(240000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  let json;
  try { json = JSON.parse(body); }
  catch { throw new Error('Overpass returned a non-JSON response'); }
  if (!Array.isArray(json.elements)) throw new Error(json.remark || 'Overpass response has no elements');
  return json.elements;
}

async function cached(key, query) {
  const file = new URL(`${key}.json`, CACHE);
  try {
    const elements = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Array.isArray(elements)) {
      console.log('cached', key, elements.length, 'elements');
      return elements;
    }
  } catch {}

  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log('Querying', key, 'via', new URL(endpoint).host);
      const elements = await queryOnce(endpoint, query);
      await fs.writeFile(file, JSON.stringify(elements));
      console.log('received', elements.length, 'elements');
      return elements;
    } catch (error) {
      lastError = error;
      console.warn('Overpass attempt failed:', error.message);
      if (attempt < 7) await sleep(Math.min(4000 * (attempt + 1), 20000));
    }
  }
  throw lastError;
}

const out = {
  source: 'OpenStreetMap / Overpass API',
  center: [-29.8587, 31.0218],
  fetched: new Date().toISOString(),
  roads: [],
  rail: [],
  coastline: [],
  beaches: []
};

const coastQuery = `[out:json][timeout:180];(
  way["natural"="coastline"](-30.10,30.76,-29.60,31.14);
  way["natural"="beach"](-30.10,30.76,-29.60,31.14);
);out geom;`;
const coastElements = await cached('coast', coastQuery);
for (const element of coastElements) {
  if (!element.geometry?.length) continue;
  const points = element.geometry.map(point => [point.lon, point.lat]);
  if (element.tags?.natural === 'coastline') {
    out.coastline.push({ id: element.id, tags: element.tags, points });
  } else if (element.tags?.natural === 'beach') {
    out.beaches.push({ id: element.id, tags: element.tags, points });
  }
}
console.log('coastline ways', out.coastline.length, 'beaches', out.beaches.length);

for (const zone of zones) {
  const [south, west, north, east] = zone.bbox;
  const highwayPattern = zone.roads === 'all' ? allRoads : majorRoads;
  const query = `[out:json][timeout:180];(
    way["highway"~"${highwayPattern}"](${south},${west},${north},${east});
    way["railway"="rail"](${south},${west},${north},${east});
  );out geom;`;
  const elements = await cached(zone.name, query);

  for (const element of elements) {
    if (!element.geometry || element.geometry.length < 2) continue;
    const points = element.geometry.map(point => [point.lon, point.lat]);
    if (element.tags?.railway === 'rail') {
      out.rail.push({ id: element.id, tags: element.tags || {}, points });
    } else if (element.tags?.highway) {
      out.roads.push({ id: element.id, tags: element.tags, points });
    }
  }

  const uniqueRoads = new Map(out.roads.map(road => [road.id, road]));
  const uniqueRail = new Map(out.rail.map(line => [line.id, line]));
  out.roads = [...uniqueRoads.values()];
  out.rail = [...uniqueRail.values()];
  await fs.writeFile(new URL('../src/data/durban-osm.json', import.meta.url), JSON.stringify(out));
  console.log('saved checkpoint', zone.name, 'roads', out.roads.length);
  await sleep(1000);
}

const output = JSON.stringify(out);
await fs.writeFile(new URL('../src/data/durban-osm.json', import.meta.url), output);
console.log(
  'Wrote durban-osm.json:',
  out.roads.length, 'roads,',
  out.roads.reduce((sum, road) => sum + road.points.length, 0), 'road points,',
  out.rail.length, 'rail lines,',
  (output.length / 1024 / 1024).toFixed(2), 'MB'
);
