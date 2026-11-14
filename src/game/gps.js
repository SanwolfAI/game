import { CURATED_PLACES, toXZ } from '../core/geo.js';

const ARRIVE_RADIUS = 70;

// Simple waypoint navigation: cycles through the featured Durban places and
// reports the straight-line distance and bearing to the current target.
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
  }

  next() {
    this.index = (this.index + 1) % this.places.length;
    this.dest = this.places[this.index];
    this.distance = Infinity;
    this.bearing = 0;
    return this.dest;
  }

  clear() {
    this.dest = null;
    this.index = -1;
  }

  // Returns an arrival event once when the player reaches the waypoint.
  update(x, z, yaw) {
    if (!this.dest) return null;
    const dx = this.dest.x - x;
    const dz = this.dest.z - z;
    this.distance = Math.hypot(dx, dz);
    const len = this.distance || 1;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = -fz;
    const rz = fx;
    this.bearing = Math.atan2((dx * rx + dz * rz) / len, (dx * fx + dz * fz) / len);
    if (this.distance < ARRIVE_RADIUS) {
      const name = this.dest.name;
      this.clear();
      return { arrived: true, name };
    }
    return null;
  }
}

export function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '--';
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}
