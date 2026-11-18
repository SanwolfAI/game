// Projection between WGS84 (OSM) and the local metric world used by Three.js.
// The world uses metres at 1:1 with reality. +X is east, -Z is north, Y is up.

export const CENTER = { lon: 31.0218, lat: -29.8587 };

export const M_PER_DEG_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180); // ~96500 m
export const M_PER_DEG_LAT = 110574;

export function toXZ(lon, lat) {
  return [(lon - CENTER.lon) * M_PER_DEG_LON, -(lat - CENTER.lat) * M_PER_DEG_LAT];
}

export function toLonLat(x, z) {
  return [CENTER.lon + x / M_PER_DEG_LON, CENTER.lat - z / M_PER_DEG_LAT];
}

export function dist2d(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az);
}

// Curated names for featured spots that OSM place nodes don't cover.
export const CURATED_PLACES = [
  { name: 'Durban CBD', lon: 31.0218, lat: -29.8587, r: 1100, kind: 'city' },
  { name: 'Golden Mile Beachfront', lon: 31.0305, lat: -29.8775, r: 900, kind: 'beach' },
  { name: 'uShaka Marine World', lon: 31.0281, lat: -29.8706, r: 420, kind: 'landmark' },
  { name: 'Kings Park / Moses Mabhida', lon: 31.0255, lat: -29.8339, r: 900, kind: 'landmark' },
  { name: 'Durban Harbour / Bluff', lon: 31.045, lat: -29.893, r: 900, kind: 'landmark' },
  { name: 'Victoria Street Market', lon: 31.0209, lat: -29.857, r: 350, kind: 'landmark' },
  { name: 'Berea', lon: 31.008, lat: -29.872, r: 1200, kind: 'suburb' },
  { name: 'Umbilo / Pinetown', lon: 30.935, lat: -29.885, r: 1600, kind: 'suburb' },
  { name: 'Umlazi', lon: 30.8905, lat: -29.9315, r: 2600, kind: 'township' },
  { name: 'KwaMashu', lon: 30.979, lat: -29.7295, r: 2200, kind: 'township' },
  { name: 'Cato Ridge / Philani', lon: 30.9255, lat: -29.9205, r: 1600, kind: 'township' },
  { name: 'Chatsworth', lon: 30.88, lat: -29.885, r: 1500, kind: 'township' },
  { name: 'Umhlanga', lon: 31.054, lat: -29.7315, r: 900, kind: 'suburb' },
  { name: 'Salt Rock', lon: 31.037, lat: -29.789, r: 800, kind: 'suburb' },
  { name: 'Blue Bank / Snell Parade', lon: 31.022, lat: -29.876, r: 700, kind: 'beach' }
];

// Full lookup list: curated spots first, then OSM place labels from the build.
export const PLACES = CURATED_PLACES.slice();
const curatedNames = new Set(CURATED_PLACES.map((p) => p.name.toLowerCase()));

// Merge OSM place labels (from fetch-places.mjs / build-data.mjs) into the list.
export function configurePlaces(fetched) {
  if (!Array.isArray(fetched) || fetched.length === 0) return PLACES;
  for (const p of fetched) {
    if (!p || !p.n || !Array.isArray(p.c)) continue;
    if (curatedNames.has(p.n.toLowerCase())) continue;
    PLACES.push({
      name: p.n,
      lon: p.c[0],
      lat: p.c[1],
      r: p.r || 700,
      kind: p.k || 'suburb'
    });
  }
  placeCache.clear();
  return PLACES;
}

const placeCache = new Map();

export function placeAt(x, z) {
  const [lon, lat] = toLonLat(x, z);
  const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
  if (placeCache.has(key)) return placeCache.get(key);

  const distance = (p) => Math.hypot(
    (lon - p.lon) * M_PER_DEG_LON,
    (lat - p.lat) * M_PER_DEG_LAT
  );

  // Curated spots win inside their radius so landmarks stay readable.
  let best = null;
  let bestD = Infinity;
  for (const p of CURATED_PLACES) {
    const d = distance(p);
    if (d < p.r && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) {
    for (let i = CURATED_PLACES.length; i < PLACES.length; i++) {
      const p = PLACES[i];
      const d = distance(p);
      if (d < p.r && d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }

  const res = best || { name: 'eThekwini', kind: 'wild' };
  placeCache.set(key, res);
  return res;
}

// Districts used by the city generator.
export const DISTRICTS = [
  {
    name: 'cbd',
    kind: 'cbd',
    lon: 31.0218,
    lat: -29.8587,
    r: 950,
    buildings: { min: 26, max: 95, count: 430, gap: 16 },
    palette: ['#cfd6dc', '#d9dee3', '#b9c3cc', '#e4e7ea', '#a7b3bd', '#c8bca8']
  },
  {
    name: 'golden-mile',
    kind: 'hotels',
    lon: 31.0305,
    lat: -29.8775,
    r: 620,
    buildings: { min: 22, max: 70, count: 90, gap: 26 },
    palette: ['#f2ede4', '#efe3d2', '#e8d9c4', '#f5f0e6', '#d9cdb8']
  },
  {
    name: 'umlazi',
    kind: 'township',
    lon: 30.8905,
    lat: -29.9315,
    r: 2400,
    buildings: { min: 6, max: 11, count: 520, gap: 20 },
    palette: ['#c9a37a', '#b98f66', '#d6b48c', '#a8815c', '#c2a184']
  },
  {
    name: 'kwamashu',
    kind: 'township',
    lon: 30.979,
    lat: -29.7295,
    r: 2100,
    buildings: { min: 6, max: 11, count: 460, gap: 20 },
    palette: ['#cfae86', '#bb9a72', '#d8bd97', '#b08a63']
  },
  {
    name: 'philani',
    kind: 'informal',
    lon: 30.9255,
    lat: -29.9205,
    r: 1500,
    buildings: { min: 4, max: 7, count: 620, gap: 12 },
    palette: ['#9aa3a6', '#8d979b', '#a7afb1', '#7f8a8d']
  },
  {
    name: 'durban-north',
    kind: 'suburb',
    lon: 31.025,
    lat: -29.75,
    r: 2400,
    buildings: { min: 7, max: 14, count: 320, gap: 30 },
    palette: ['#e8e2d6', '#ded6c8', '#efe9dd', '#d6cdbc']
  },
  {
    name: 'umhlanga',
    kind: 'suburb',
    lon: 31.054,
    lat: -29.7315,
    r: 1200,
    buildings: { min: 8, max: 22, count: 120, gap: 30 },
    palette: ['#f0ece2', '#e6ded0', '#f7f3ea']
  }
];

export function districtsWorld(data) {
  const all = DISTRICTS.concat(osmDistricts(data?.places, data?.landuse));
  return all.map((d) => {
    const [x, z] = toXZ(d.lon, d.lat);
    return { ...d, x, z, r: d.r };
  });
}

const TOWNSHIP_PALETTE = ['#c9a37a', '#b98f66', '#d6b48c', '#a8815c', '#c2a184', '#cfae86', '#bb9a72'];
const INFORMAL_PALETTE = ['#9aa3a6', '#8d979b', '#a7afb1', '#7f8a8d', '#94a0a3'];
const SUBURB_PALETTE = ['#e8e2d6', '#ded6c8', '#efe9dd', '#d6cdbc', '#f0ece2', '#e6ded0'];

function buildingSpec(kind, r) {
  if (kind === 'informal') {
    return { min: 4, max: 7, count: Math.max(80, Math.min(420, Math.round(r * 0.9))), gap: 12 };
  }
  if (kind === 'township') {
    return { min: 6, max: 11, count: Math.max(60, Math.min(300, Math.round(r * 0.5))), gap: 18 };
  }
  return { min: 7, max: 14, count: Math.max(30, Math.min(150, Math.round(r * 0.28))), gap: 28 };
}

function paletteFor(kind) {
  if (kind === 'informal') return INFORMAL_PALETTE;
  if (kind === 'township') return TOWNSHIP_PALETTE;
  return SUBURB_PALETTE;
}

// Turns the OSM place labels and residential/informal landuse polygons into
// extra city districts so the whole live map fills in, not just the landmarks.
export function osmDistricts(places, landuse) {
  const out = [];
  const taken = DISTRICTS.map((d) => {
    const [x, z] = toXZ(d.lon, d.lat);
    return [x, z, d.r];
  });
  const overlaps = (x, z, r) => taken.some(([tx, tz, tr]) => Math.hypot(x - tx, z - tz) < Math.max(tr, r) * 0.7);
  const add = (name, kind, lon, lat, r) => {
    const [x, z] = toXZ(lon, lat);
    if (overlaps(x, z, r)) return;
    taken.push([x, z, r]);
    out.push({
      name,
      kind,
      lon,
      lat,
      r,
      buildings: buildingSpec(kind, r),
      palette: paletteFor(kind)
    });
  };

  const labels = (Array.isArray(places) ? places : [])
    .filter((p) => Array.isArray(p.c) && p.r >= 350)
    .sort((a, b) => b.r - a.r)
    .slice(0, 40);
  for (const p of labels) {
    const kind =
      p.k === 'neighbourhood' || p.k === 'quarter'
        ? 'township'
        : p.r >= 1400
          ? 'township'
          : 'suburb';
    add(p.n || 'Area', kind, p.c[0], p.c[1], Math.min(p.r, 2400));
  }

  const areas = (Array.isArray(landuse) ? landuse : [])
    .filter((l) => Array.isArray(l.p) && l.p.length >= 4 && l.a > 150000)
    .sort((a, b) => b.a - a.a)
    .slice(0, 15);
  for (const l of areas) {
    let lon = 0;
    let lat = 0;
    for (const [x, y] of l.p) {
      lon += x;
      lat += y;
    }
    lon /= l.p.length;
    lat /= l.p.length;
    const r = Math.max(250, Math.min(2200, Math.sqrt(l.a / Math.PI)));
    const kind = l.u === 'informal' ? 'informal' : r >= 900 ? 'township' : 'suburb';
    add(kind === 'informal' ? 'Informal settlement' : 'Residential area', kind, lon, lat, r);
  }

  return out;
}
