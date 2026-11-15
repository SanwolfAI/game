import { toXZ, toLonLat } from '../core/geo.js';
import { clamp, smoothstep } from '../core/utils.js';


// Load the bundled Terrarium DEM locally; no network tile requests are made.
export async function loadDurbanDEM() {
  const metaResponse = await fetch('./src/assets/terrain/durban-dem.json');
  if (!metaResponse.ok) throw new Error('Durban elevation metadata unavailable');
  const meta = await metaResponse.json();
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Durban elevation image could not be loaded'));
    image.src = './src/assets/terrain/durban-dem-terrarium-z12.png';
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Elevation canvas is unavailable');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return { meta, pixels, width: canvas.width, height: canvas.height };
}

// Fallback hills are used only if the bundled DEM cannot be read.
const HILLS = [
  { lon: 31.0055, lat: -29.862, amp: 95, sigma: 1400, name: 'Berea' },
  { lon: 30.928, lat: -29.912, amp: 150, sigma: 2600, name: 'Cato Ridge' },
  { lon: 30.955, lat: -29.935, amp: 90, sigma: 1500, name: 'Magazine' },
  { lon: 30.985, lat: -29.985, amp: 120, sigma: 1800, name: 'Mariannhill' },
  { lon: 31.02, lat: -29.735, amp: 110, sigma: 2000, name: 'Umhlanga Ridge' },
  { lon: 30.75, lat: -29.95, amp: 300, sigma: 4000, name: 'Inchanga' },
  { lon: 31.09, lat: -29.69, amp: 70, sigma: 1200, name: 'Verulam hills' }
];

// Flat urban platforms carved out of the rolling ground.
const FLATS = [
  { lon: 31.0218, lat: -29.8587, r: 1500, inner: 600, h: 12 },
  { lon: 31.0305, lat: -29.8775, r: 950, inner: 400, h: 5 },
  { lon: 31.0255, lat: -29.8339, r: 900, inner: 350, h: 14 },
  { lon: 30.8905, lat: -29.9315, r: 1700, inner: 800, h: 62 },
  { lon: 30.979, lat: -29.7295, r: 1400, inner: 700, h: 96 },
  { lon: 30.9255, lat: -29.9205, r: 1100, inner: 500, h: 54 }
];

export class Heightfield {
  constructor(coastXZ, bounds, cell = 80, dem = null) {
    this.cell = cell;
    this.dem = dem;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
    const n = this.cols * this.rows;

    this.wall = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.dist = new Float32Array(n);
    this.height = new Float32Array(n);

    this.hills = HILLS.map((h) => {
      const [x, z] = toXZ(h.lon, h.lat);
      return { ...h, x, z };
    });
    this.flats = FLATS.map((f) => {
      const [x, z] = toXZ(f.lon, f.lat);
      return { ...f, x, z };
    });

    this.#rasteriseCoast(coastXZ);
    this.#distanceTransform();
    this.#floodOcean();
    this.#buildHeight();
    this.#smooth(2);
  }

  idx(ix, iz) {
    return iz * this.cols + ix;
  }

  #rasteriseCoast(coastXZ) {
    if (!coastXZ || coastXZ.length === 0) return;
    for (const [x, z] of coastXZ) {
      const ix = Math.round((x - this.minX) / this.cell);
      const iz = Math.round((z - this.minZ) / this.cell);
      if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) continue;
      const i = this.idx(ix, iz);
      this.wall[i] = 1;
    }
    // A wall thicker than one cell so the flood fill cannot leak through diagonal gaps.
    for (let iz = 0; iz < this.rows; iz++) {
      for (let ix = 0; ix < this.cols; ix++) {
        if (!this.wall[this.idx(ix, iz)]) continue;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = ix + dx;
            const nz = iz + dz;
            if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
            this.wall[this.idx(nx, nz)] = 1;
          }
        }
      }
    }
  }

  #distanceTransform() {
    // Chamfer 3-4 two pass transform -> approximate euclidean distance in cells.
    const { cols, rows, wall, dist } = this;
    const d1 = 1;
    const d2 = Math.SQRT2;
    const big = 1e9;
    for (let i = 0; i < dist.length; i++) dist[i] = wall[i] ? 0 : big;

    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const i = this.idx(ix, iz);
        if (dist[i] === 0) continue;
        let d = dist[i];
        if (ix > 0) d = Math.min(d, dist[i - 1] + d1);
        if (iz > 0) d = Math.min(d, dist[i - cols] + d1);
        if (ix > 0 && iz > 0) d = Math.min(d, dist[i - cols - 1] + d2);
        if (ix < cols - 1 && iz > 0) d = Math.min(d, dist[i - cols + 1] + d2);
        dist[i] = d;
      }
    }
    for (let iz = rows - 1; iz >= 0; iz--) {
      for (let ix = cols - 1; ix >= 0; ix--) {
        const i = this.idx(ix, iz);
        if (dist[i] === 0) continue;
        let d = dist[i];
        if (ix < cols - 1) d = Math.min(d, dist[i + 1] + d1);
        if (iz < rows - 1) d = Math.min(d, dist[i + cols] + d1);
        if (ix < cols - 1 && iz < rows - 1) d = Math.min(d, dist[i + cols + 1] + d2);
        if (ix > 0 && iz < rows - 1) d = Math.min(d, dist[i + cols - 1] + d2);
        dist[i] = d;
      }
    }
    for (let i = 0; i < dist.length; i++) dist[i] *= this.cell;
  }

  #floodOcean() {
    // The eastern edge of the map is open ocean, everything reachable from there is water.
    const { cols, rows, wall, water } = this;
    const stack = [];
    for (let iz = 0; iz < rows; iz++) {
      const i = this.idx(cols - 1, iz);
      if (!wall[i]) {
        water[i] = 1;
        stack.push(i);
      }
    }
    while (stack.length) {
      const i = stack.pop();
      const ix = i % cols;
      const iz = (i / cols) | 0;
      const tryPush = (nx, nz) => {
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) return;
        const ni = this.idx(nx, nz);
        if (wall[ni] || water[ni]) return;
        water[ni] = 1;
        stack.push(ni);
      };
      if (ix > 0) tryPush(ix - 1, iz);
      if (ix < cols - 1) tryPush(ix + 1, iz);
      if (iz > 0) tryPush(ix, iz - 1);
      if (iz < rows - 1) tryPush(ix, iz + 1);
    }
  }

  #profile(d) {
    if (d < 0) return -Math.min(28, 5 + -d * 0.014);
    let h = 1.2 + 0.0105 * Math.max(0, d - 45);
    h += 3.2 * Math.exp(-Math.pow((d - 110) / 95, 2));
    return h;
  }

  #sampleDem(x, z) {
    const dem = this.dem;
    if (!dem?.meta || !dem.pixels || !dem.width || !dem.height) return NaN;
    const [lon, lat] = toLonLat(x, z);
    const m = dem.meta;
    if (lon < m.west || lon > m.east || lat < m.south || lat > m.north) return NaN;
    const mercator = (value) => Math.log(Math.tan(Math.PI / 4 + value * Math.PI / 360));
    const northY = mercator(m.north);
    const southY = mercator(m.south);
    const px = clamp(((lon - m.west) / (m.east - m.west)) * (dem.width - 1), 0, dem.width - 1);
    const py = clamp(((northY - mercator(lat)) / (northY - southY)) * (dem.height - 1), 0, dem.height - 1);
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const x1 = Math.min(dem.width - 1, x0 + 1), y1 = Math.min(dem.height - 1, y0 + 1);
    const read = (ix, iy) => {
      const k = (iy * dem.width + ix) * 4;
      return dem.pixels[k] * 256 + dem.pixels[k + 1] + dem.pixels[k + 2] / 256 - 32768;
    };
    const tx = px - x0, ty = py - y0;
    const top = read(x0, y0) * (1 - tx) + read(x1, y0) * tx;
    const bottom = read(x0, y1) * (1 - tx) + read(x1, y1) * tx;
    return top * (1 - ty) + bottom * ty;
  }

  #buildHeight() {
    const { cols, rows, water, dist, height } = this;
    for (let iz = 0; iz < rows; iz++) {
      const z = this.minZ + iz * this.cell;
      for (let ix = 0; ix < cols; ix++) {
        const x = this.minX + ix * this.cell;
        const i = this.idx(ix, iz);
        const d = water[i] ? -dist[i] : dist[i];
        let h = this.#sampleDem(x, z);
        if (!Number.isFinite(h)) {
          h = this.#profile(d);
          for (const hill of this.hills) {
            const dx = x - hill.x;
            const dz = z - hill.z;
            const q = (dx * dx + dz * dz) / (2 * hill.sigma * hill.sigma);
            if (q < 12) h += hill.amp * Math.exp(-q);
          }
          for (const flat of this.flats) {
            const dx = x - flat.x;
            const dz = z - flat.z;
            const r = Math.hypot(dx, dz);
            if (r > flat.r) continue;
            const w = 1 - smoothstep(flat.inner, flat.r, r);
            h = h * (1 - w) + flat.h * w;
          }
        } else if (d >= 0) {
          // DEM land elevations are kept real; the sea remains below the water plane.
          h = Math.max(0, h);
        }
        if (d < 0) h = Math.min(h, -0.4);
        height[i] = h;
      }
    }
  }

  #smooth(passes) {
    const { cols, rows, height } = this;
    const tmp = new Float32Array(height.length);
    for (let p = 0; p < passes; p++) {
      tmp.set(height);
      for (let iz = 0; iz < rows; iz++) {
        for (let ix = 0; ix < cols; ix++) {
          const i = this.idx(ix, iz);
          let sum = 0;
          let n = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = ix + dx;
              const nz = iz + dz;
              if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
              sum += tmp[this.idx(nx, nz)];
              n++;
            }
          }
          height[i] = sum / n;
        }
      }
    }
  }

  // Signed distance to the coastline in metres: positive on land, negative at sea.
  signedCoastDistance(x, z) {
    const fx = (x - this.minX) / this.cell;
    const fz = (z - this.minZ) / this.cell;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    if (ix < 0 || iz < 0 || ix >= this.cols - 1 || iz >= this.rows - 1) {
      const i = this.idx(clamp(ix, 0, this.cols - 1), clamp(iz, 0, this.rows - 1));
      return this.water[i] ? -this.dist[i] : this.dist[i];
    }
    const tx = fx - ix;
    const tz = fz - iz;
    const d = (a, b) => {
      const i = this.idx(a, b);
      return this.water[i] ? -this.dist[i] : this.dist[i];
    };
    const d00 = d(ix, iz);
    const d10 = d(ix + 1, iz);
    const d01 = d(ix, iz + 1);
    const d11 = d(ix + 1, iz + 1);
    const top = d00 + (d10 - d00) * tx;
    const bot = d01 + (d11 - d01) * tx;
    return top + (bot - top) * tz;
  }

  heightAt(x, z) {
    const fx = clamp((x - this.minX) / this.cell, 0, this.cols - 1.001);
    const fz = clamp((z - this.minZ) / this.cell, 0, this.rows - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h = (a, b) => this.height[this.idx(a, b)];
    const h00 = h(ix, iz);
    const h10 = h(ix + 1, iz);
    const h01 = h(ix, iz + 1);
    const h11 = h(ix + 1, iz + 1);
    const top = h00 + (h10 - h00) * tx;
    const bot = h01 + (h11 - h01) * tx;
    return top + (bot - top) * tz;
  }

  isWater(x, z) {
    return this.signedCoastDistance(x, z) < 0;
  }
}
