import { CURATED_PLACES, toXZ } from '../core/geo.js';

const ARRIVE_RADIUS = 35;
const OFF_ROUTE = 38; // m from the route line before we re-route
const REROUTE_AFTER = 1.6; // s off-route

// Navigation: a destination (tapped on the map or picked from the featured
// places) gets a real road route from Router; update() tracks progress along
// it and exposes the next turn, distance to it and the distance remaining.
export class GPS {
  constructor(places = CURATED_PLACES) {
    this.places = places.map((p) => {
      const [x, z] = toXZ(p.lon, p.lat);
      return { name: p.name, kind: p.kind, x, z };
    });
    this.index = -1;
    this.dest = null;
    this.distance = 0;
    this.bearing = 0;
    this.router = null;
    this.route = null;
    this.progress = 0;
    this.seg = 0;
    this.offTimer = 0;
    this.nextTurn = null;
    this.turnDist = Infinity;
    this.version = 0; // bumps whenever the route changes (map redraw)
  }

  next() {
    this.index = (this.index + 1) % this.places.length;
    this.dest = this.places[this.index];
    this.route = null;
    this.needRoute = true;
    this.distance = Infinity;
    this.bearing = 0;
    return this.dest;
  }

  setDestination(x, z, name = 'Map pin') {
    this.dest = { name, x, z };
    this.index = -1;
    this.route = null;
    this.needRoute = true;
    this.distance = Infinity;
  }

  clear() {
    this.dest = null;
    this.index = -1;
    this.route = null;
    this.nextTurn = null;
    this.version++;
  }

  #reroute(x, z, yaw) {
    this.needRoute = false;
    this.offTimer = 0;
    if (!this.router || !this.dest) return;
    const r = this.router.route(x, z, Math.sin(yaw), Math.cos(yaw), this.dest.x, this.dest.z);
    this.route = r;
    this.seg = 0;
    this.progress = 0;
    this.version++;
  }

  // Returns an arrival event once when the player reaches the destination.
  update(x, z, yaw) {
    if (!this.dest) return null;
    if (this.needRoute) this.#reroute(x, z, yaw);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    let tx = this.dest.x;
    let tz = this.dest.z;
    const r = this.route;
    if (r) {
      // progress: nearest point on the route near the last known segment
      const pts = r.pts;
      let best = this.seg;
      let bd = Infinity;
      let bt = 0;
      const i0 = Math.max(0, this.seg - 3);
      const i1 = Math.min(pts.length - 2, this.seg + 40);
      for (let i = i0; i <= i1; i++) {
        const ax = pts[i][0];
        const az = pts[i][1];
        const dx = pts[i + 1][0] - ax;
        const dz = pts[i + 1][1] - az;
        const l2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < bd) {
          bd = d;
          best = i;
          bt = t;
        }
      }
      this.seg = best;
      this.progress = r.cum[best] + (r.cum[best + 1] - r.cum[best]) * bt;
      this.distance = Math.max(0, r.len - this.progress);
      if (bd > OFF_ROUTE) {
        this.offTimer += 1 / 60;
        if (this.offTimer > REROUTE_AFTER) this.needRoute = true;
      } else this.offTimer = 0;
      // steer the arrow at a point ~25 m further along the route
      const ahead = this.progress + 25;
      let j = best;
      while (j < pts.length - 1 && r.cum[j] < ahead) j++;
      tx = pts[j][0];
      tz = pts[j][1];
      this.nextTurn = null;
      this.turnDist = Infinity;
      for (const t of r.turns) {
        if (t.d > this.progress + 3) {
          this.nextTurn = t;
          this.turnDist = t.d - this.progress;
          break;
        }
      }
    } else {
      this.distance = Math.hypot(this.dest.x - x, this.dest.z - z);
    }
    const dx = tx - x;
    const dz = tz - z;
    const len = Math.hypot(dx, dz) || 1;
    this.bearing = Math.atan2((dx * rx + dz * rz) / len, (dx * fx + dz * fz) / len);
    if (Math.hypot(this.dest.x - x, this.dest.z - z) < ARRIVE_RADIUS || (r && this.distance < 12)) {
      const name = this.dest.name;
      this.clear();
      return { arrived: true, name };
    }
    return null;
  }
}

export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '--';
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}
