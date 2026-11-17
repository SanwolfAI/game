import { toXZ, toLonLat } from '../core/geo.js';
import { clamp, smoothstep } from '../core/utils.js';

// Low-poly hills placed on their real KZN locations.
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
  // opts.dem: { meta, data: Int16Array } real SRTM terrain (scripts/build-dem.py)
  // opts.rivers: [{ xz: [[x,z],...], w }] carved as valleys that flow downhill
  constructor(coastXZ, bounds, cell = 80, opts = {}) {
    this.dem = opts.dem || null;
    this.cell = cell;
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
    this.#coastDistance(coastXZ);
    this.#buildHeight();
    if (this.dem && opts.roads) this.#landUnderRoads(opts.roads);
    this.#smooth(this.dem ? 1 : 2);
    if (opts.rivers) this.#carveRivers(opts.rivers);
    this.lake = new Uint8Array(n);
    if (opts.areas) this.#carveAreas(opts.areas);
  }

  idx(ix, iz) {
    return iz * this.cols + ix;
  }

  #rasteriseCoast(coastXZ) {
    if (!coastXZ || coastXZ.length === 0) return;
    // rasterise every coastline segment (not just its vertices) so the wall is
    // gap-free, and run both ends on to the map edge so the sea can't leak round
    coastXZ = coastXZ.slice();
    const far = 4 * (this.cols + this.rows) * this.cell;
    const ext = (p, q) => {
      const dx = p[0] - q[0];
      const dz = p[1] - q[1];
      const l = Math.hypot(dx, dz) || 1;
      return [p[0] + (dx / l) * far, p[1] + (dz / l) * far];
    };
    if (coastXZ.length > 1) {
      coastXZ.unshift(ext(coastXZ[0], coastXZ[1]));
      coastXZ.push(ext(coastXZ[coastXZ.length - 1], coastXZ[coastXZ.length - 2]));
    }
    for (let k = 0; k < coastXZ.length; k++) {
      const a = coastXZ[k];
      const b = coastXZ[Math.min(coastXZ.length - 1, k + 1)];
      const steps = Math.min(200000, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.cell * 0.5))));
      for (let t = 0; t <= steps; t++) {
        const x = a[0] + ((b[0] - a[0]) * t) / steps;
        const z = a[1] + ((b[1] - a[1]) * t) / steps;
        const ix = Math.round((x - this.minX) / this.cell);
        const iz = Math.round((z - this.minZ) / this.cell);
        if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) continue;
        this.wall[this.idx(ix, iz)] = 1;
      }
    }
    // A wall thicker than one cell so the flood fill cannot leak through diagonal gaps.
    // Dilate from a copy: dilating in place cascaded right/down and turned
    // most of the map (including the sea off the Golden Mile) into "wall".
    const src = this.wall.slice();
    for (let iz = 0; iz < this.rows; iz++) {
      for (let ix = 0; ix < this.cols; ix++) {
        if (!src[this.idx(ix, iz)]) continue;
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

  // True distance (metres) to the coastline polyline. The legacy `dist` field
  // (used for the height profile, unchanged so roads/bridges keep their tuned
  // heights) comes from an over-dilated wall and is 0 over most of the land;
  // signedCoastDistance() uses this field instead.
  #coastDistance(coastXZ) {
    const { cols, rows } = this;
    const n = cols * rows;
    const cd = new Float32Array(n).fill(1e9);
    if (coastXZ && coastXZ.length > 1) {
      for (let k = 1; k < coastXZ.length; k++) {
        const a = coastXZ[k - 1];
        const b = coastXZ[k];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.cell * 0.5)));
        for (let t = 0; t <= steps; t++) {
          const x = a[0] + ((b[0] - a[0]) * t) / steps;
          const z = a[1] + ((b[1] - a[1]) * t) / steps;
          const ix = Math.round((x - this.minX) / this.cell);
          const iz = Math.round((z - this.minZ) / this.cell);
          if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) continue;
          cd[iz * cols + ix] = 0;
        }
      }
    }
    const d1 = 1;
    const d2 = Math.SQRT2;
    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const i = iz * cols + ix;
        let d = cd[i];
        if (ix > 0 && cd[i - 1] + d1 < d) d = cd[i - 1] + d1;
        if (iz > 0) {
          if (cd[i - cols] + d1 < d) d = cd[i - cols] + d1;
          if (ix > 0 && cd[i - cols - 1] + d2 < d) d = cd[i - cols - 1] + d2;
          if (ix < cols - 1 && cd[i - cols + 1] + d2 < d) d = cd[i - cols + 1] + d2;
        }
        cd[i] = d;
      }
    }
    for (let iz = rows - 1; iz >= 0; iz--) {
      for (let ix = cols - 1; ix >= 0; ix--) {
        const i = iz * cols + ix;
        let d = cd[i];
        if (ix < cols - 1 && cd[i + 1] + d1 < d) d = cd[i + 1] + d1;
        if (iz < rows - 1) {
          if (cd[i + cols] + d1 < d) d = cd[i + cols] + d1;
          if (ix < cols - 1 && cd[i + cols + 1] + d2 < d) d = cd[i + cols + 1] + d2;
          if (ix > 0 && cd[i + cols - 1] + d2 < d) d = cd[i + cols - 1] + d2;
        }
        cd[i] = d;
      }
    }
    for (let i = 0; i < n; i++) cd[i] *= this.cell;
    this.cdist = cd;
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

  // True where the real DEM says open water at sea level (harbour, lagoons).
  isSeaLevel(x, z) {
    const ix = Math.round((x - this.minX) / this.cell);
    const iz = Math.round((z - this.minZ) / this.cell);
    if (ix >= 0 && iz >= 0 && ix < this.cols && iz < this.rows && this.lake[this.idx(ix, iz)]) return true;
    for (const [ox, oz] of [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60]]) if (this.isWater(x + ox, z + oz)) return true;
    if (this.renderedHeightAt(x, z) < 0.4) return true;
    const h = this.demAt(x, z);
    return h !== null && h < 0.6;
  }

  // Real ground height (m) from the DEM grid, or null outside it.
  demAt(x, z) {
    const D = this.dem;
    if (!D) return null;
    const [lon, lat] = toLonLat(x, z);
    const m = D.meta;
    const fx = (lon - m.lon0) / m.dlon;
    const fy = (m.lat1 - lat) / m.dlat;
    if (fx < 0 || fy < 0 || fx >= m.cols - 1 || fy >= m.rows - 1) return null;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const u = fx - ix;
    const v = fy - iy;
    const d = D.data;
    const i = iy * m.cols + ix;
    const a = d[i] * (1 - u) + d[i + 1] * u;
    const b = d[i + m.cols] * (1 - u) + d[i + m.cols + 1] * u;
    return (a * (1 - v) + b * v) * m.scale;
  }

  // Rivers: walk each waterway downstream (OSM draws them in flow direction),
  // keep the bed always falling, and dig a valley around it.
  #carveRivers(rivers) {
    const { cols, rows, height, cell } = this;
    for (const r of rivers) {
      const P = [];
      for (let i = 0; i < r.xz.length - 1; i++) {
        const [ax, az] = r.xz[i];
        const [bx, bz] = r.xz[i + 1];
        const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 30));
        for (let j = 0; j < k; j++) P.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]);
      }
      P.push(r.xz[r.xz.length - 1]);
      if (P.length < 2) continue;
      let bed = Infinity;
      const beds = new Float32Array(P.length);
      for (let i = 0; i < P.length; i++) {
        const h = this.heightAt(P[i][0], P[i][1]);
        bed = Math.min(bed, h);
        beds[i] = Math.max(bed, -0.6);
      }
      const R = Math.max(150, (r.w || 10) * 0.5 + 110); // valley half-width
      const depth = Math.min(3, 1 + (r.w || 10) * 0.05);
      for (let i = 0; i < P.length; i++) {
        const [px, pz] = P[i];
        // channel never dips below sea level, so low coastal land isn't flooded
        const b = Math.max(beds[i] - depth, -0.25);
        const x0 = Math.max(0, Math.floor((px - R - this.minX) / cell));
        const x1 = Math.min(cols - 1, Math.ceil((px + R - this.minX) / cell));
        const z0 = Math.max(0, Math.floor((pz - R - this.minZ) / cell));
        const z1 = Math.min(rows - 1, Math.ceil((pz + R - this.minZ) / cell));
        for (let iz = z0; iz <= z1; iz++) {
          for (let ix = x0; ix <= x1; ix++) {
            const i = iz * cols + ix;
            if (this.water[i]) continue;
            const dd = Math.hypot(this.minX + ix * cell - px, this.minZ + iz * cell - pz) / R;
            if (dd >= 1) continue;
            const t = dd * dd * (3 - 2 * dd); // smooth valley sides
            const h = b + (height[i] - b) * t;
            if (h < height[i]) height[i] = h;
          }
        }
      }
    }
  }

  // Roads are ground truth: wharves, the Point and reclaimed land that the
  // coastline flood marked as sea become dry land wherever a road runs.
  #landUnderRoads(roads) {
    const { cols, rows, cell, water, height } = this;
    const mark = (x, z) => {
      const cx = Math.round((x - this.minX) / cell);
      const cz = Math.round((z - this.minZ) / cell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) continue;
          const i = iz * cols + ix;
          if (!water[i]) continue;
          water[i] = 0;
          const hd = this.demAt(this.minX + ix * cell, this.minZ + iz * cell);
          height[i] = Math.max(hd === null ? 1.2 : hd, 1.2);
        }
      }
    };
    for (const pts of roads) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 40));
        for (let j = 0; j <= k; j++) mark(ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k);
      }
    }
  }

  // Lakes, dams and the harbour: lower the ground inside each OSM water polygon
  // a little below its shoreline so the water surface covers it cleanly.
  #carveAreas(areas) {
    const { cols, rows, height, cell } = this;
    for (const ring of areas) {
      if (ring.length < 3) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      let shore = Infinity;
      for (const [x, z] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
        shore = Math.min(shore, this.heightAt(x, z));
      }
      const bed = shore - 1.2;
      const ix0 = Math.max(0, Math.ceil((x0 - this.minX) / cell));
      const ix1 = Math.min(cols - 1, Math.floor((x1 - this.minX) / cell));
      const iz0 = Math.max(0, Math.ceil((z0 - this.minZ) / cell));
      const iz1 = Math.min(rows - 1, Math.floor((z1 - this.minZ) / cell));
      for (let iz = iz0; iz <= iz1; iz++) {
        const pz = this.minZ + iz * cell;
        for (let ix = ix0; ix <= ix1; ix++) {
          const px = this.minX + ix * cell;
          let inside = false;
          for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
            const [ax, az] = ring[a];
            const [bx, bz] = ring[b];
            if (az > pz !== bz > pz && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
          }
          if (!inside) continue;
          const i = iz * cols + ix;
          this.lake[i] = 1;
          if (height[i] > bed) height[i] = bed;
        }
      }
    }
  }

  #buildHeight() {
    if (this.dem) return this.#buildHeightDem();
    const { cols, rows, water, dist, height } = this;
    for (let iz = 0; iz < rows; iz++) {
      const z = this.minZ + iz * this.cell;
      for (let ix = 0; ix < cols; ix++) {
        const x = this.minX + ix * this.cell;
        const i = this.idx(ix, iz);
        const d = water[i] ? -dist[i] : dist[i];
        let h = this.#profile(d);
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
        if (d < 0) h = Math.min(h, -0.4);
        height[i] = h;
      }
    }
  }

  #buildHeightDem() {
    const { cols, rows, water, dist, height, cdist } = this;
    for (let iz = 0; iz < rows; iz++) {
      const z = this.minZ + iz * this.cell;
      for (let ix = 0; ix < cols; ix++) {
        const x = this.minX + ix * this.cell;
        const i = this.idx(ix, iz);
        if (water[i]) {
          // The coastline floods the whole harbour; wharves, the Point and the
          // Bluff are real dry land in the DEM, so give them back.
          const hd = this.demAt(x, z);
          if (hd !== null && hd > 0.3 && cdist[i] < 4000) {
            water[i] = 0;
            height[i] = Math.max(hd, 0.8);
            continue;
          }
          height[i] = this.#profile(-dist[i]);
          continue;
        }
        const prof = this.#profile(dist[i]);
        let h = this.demAt(x, z);
        if (h === null) h = prof;
        h = Math.max(h, 0.8);
        // keep the tuned beach profile right at the shoreline
        const w = smoothstep(60, 300, cdist[i]);
        height[i] = Math.min(prof, 6) * (1 - w) + h * w;
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
      return this.water[i] ? -this.cdist[i] : this.cdist[i];
    }
    const tx = fx - ix;
    const tz = fz - iz;
    const d = (a, b) => {
      const i = this.idx(a, b);
      return this.water[i] ? -this.cdist[i] : this.cdist[i];
    };
    const d00 = d(ix, iz);
    const d10 = d(ix + 1, iz);
    const d01 = d(ix, iz + 1);
    const d11 = d(ix + 1, iz + 1);
    const top = d00 + (d10 - d00) * tx;
    const bot = d01 + (d11 - d01) * tx;
    return top + (bot - top) * tz;
  }

  // Height of the drawn (decimated, triangulated) terrain mesh.
  renderedHeightAt(x, z) {
    const step = this.renderStep || 1;
    if (step <= 1) return this.heightAt(x, z);
    const cell = this.cell * step;
    const cols = Math.floor((this.cols - 1) / step) + 1;
    const rows = Math.floor((this.rows - 1) / step) + 1;
    const fx = clamp((x - this.minX) / cell, 0, cols - 1.001);
    const fz = clamp((z - this.minZ) / cell, 0, rows - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const H = (a, c) => this.height[this.idx(Math.min(a * step, this.cols - 1), Math.min(c * step, this.rows - 1))];
    if (tx + tz <= 1) {
      const ha = H(ix, iz);
      return ha + (H(ix + 1, iz) - ha) * tx + (H(ix, iz + 1) - ha) * tz;
    }
    const hc = H(ix + 1, iz + 1);
    return hc + (H(ix, iz + 1) - hc) * (1 - tx) + (H(ix + 1, iz) - hc) * (1 - tz);
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
