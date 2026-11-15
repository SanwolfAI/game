import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';
import { buildVehicleMesh, vehicleType, VEHICLE_TYPES } from './models.js';

const CAR_RADIUS = 2.1;
const MAX_REVERSE = 13;

export class Vehicle {
  constructor(hf, roads, city, input, typeId = 'gusheshe') {
    this.hf = hf;
    this.roads = roads;
    this.city = city;
    this.input = input;

    const spawn = roads.nearestRoad(0, 0, 400);
    this.x = spawn ? spawn.x : 0;
    this.z = spawn ? spawn.z : 0;
    let yaw = spawn ? Math.atan2(spawn.dirX, spawn.dirZ) : 0;
    if (spawn && !this.#roadForwardOk(spawn, yaw)) yaw += Math.PI;
    this.yaw = yaw;
    this.speed = 0;
    this.steer = 0;
    this.lateral = 0;
    this.driftTilt = 0;
    this.y = null;
    this.vy = 0;

    this.group = new THREE.Group();
    this.group.name = 'player-vehicle';
    this.mesh = null;
    this.setType(typeId);
    this.#place();
  }

  setType(id) {
    if (this.mesh) this.group.remove(this.mesh);
    this.mesh = buildVehicleMesh(id);
    this.group.add(this.mesh);
    this.typeId = id;
    this.spec = vehicleType(id);
  }

  cycleType() {
    const idx = VEHICLE_TYPES.findIndex((t) => t.id === this.typeId);
    const next = VEHICLE_TYPES[(idx + 1) % VEHICLE_TYPES.length];
    this.setType(next.id);
    return next.name;
  }

  get typeName() {
    return this.spec.name;
  }

  #roadForwardOk(spawn, yaw) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const ahead = this.roads.nearestRoad(spawn.x + fx * 14, spawn.z + fz * 14, 24);
    return !!ahead;
  }

  #place(dt = 0) {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    // Road-aware surface (bridges, embankments, kerbs). The previous height
    // picks the layer, so driving under a bridge keeps you on the ground.
    const prev = this.y;
    const surf = this.roads.surfaceAt(this.x, this.z, prev);
    let target = surf.y;
    this.onDeck = surf.deck;
    if (prev === null || dt === 0) {
      this.y = target;
      this.vy = 0;
    } else if (target < prev - 0.35) {
      // simple gravity when leaving a ledge
      this.vy -= 22 * dt;
      this.y = Math.max(target, prev + this.vy * dt);
    } else {
      this.vy = 0;
      this.y = target;
    }
    const base = this.y;
    const h = (x, z) => this.roads.surfaceAt(x, z, base).y;
    const hF = h(this.x + fx * 1.9, this.z + fz * 1.9);
    const hB = h(this.x - fx * 1.9, this.z - fz * 1.9);
    const hR = h(this.x + rx * 0.95, this.z + rz * 0.95);
    const hL = h(this.x - rx * 0.95, this.z - rz * 0.95);

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = this.yaw;
    this.group.rotation.x = clamp(Math.atan2(hB - hF, 3.8), -0.35, 0.35) * 0.7;
    this.group.rotation.z = clamp(Math.atan2(hR - hL, 1.9), -0.3, 0.3) * 0.7 + this.driftTilt;
  }

  // Keep the car between the parapets while on a bridge deck.
  #bridgeRails() {
    const surf = this.roads.surfaceAt(this.x, this.z, this.y);
    if (!surf.deck || !surf.pc || !surf.pc.bridge) return;
    const lim = surf.hw - 1.0;
    if (Math.abs(surf.lateral) <= lim) return;
    // push back toward the deck centre line
    const s = surf.pc.s;
    void s;
    const over = Math.abs(surf.lateral) - lim;
    const near = this.roads.nearestRoad(this.x, this.z, surf.hw + 4, (r) => r === surf.pc.road);
    if (!near) return;
    const dl = Math.hypot(near.dirX, near.dirZ) || 1;
    // left normal of the road direction
    const nx = near.dirZ / dl;
    const nz = -near.dirX / dl;
    const sign = surf.lateral > 0 ? 1 : -1;
    this.x -= nx * sign * over;
    this.z -= nz * sign * over;
    this.speed *= 0.9;
    this.lateral *= 0.2;
  }

  update(dt) {
    const input = this.input;
    const gas = input.isDown('gas');
    const brake = input.isDown('brake');
    const boost = input.isDown('boost');
    const handbrake = input.isDown('handbrake');
    const steerTarget = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);

    const maxSpeed = boost ? this.spec.boost : this.spec.max;
    if (gas) {
      const pull = 1 - clamp(Math.max(this.speed, 0) / maxSpeed, 0, 1);
      this.speed += (10 + 16 * pull) * dt;
    } else if (!brake && !handbrake) {
      this.speed *= Math.exp(-0.55 * dt);
      if (Math.abs(this.speed) < 0.25) this.speed = 0;
    }

    if (brake) {
      if (this.speed > 0.4) this.speed = Math.max(0, this.speed - 26 * dt);
      else this.speed = Math.max(-MAX_REVERSE, this.speed - 7 * dt);
    }

    if (handbrake) {
      this.speed *= Math.exp(-0.75 * dt);
      if (Math.abs(this.speed) < 0.4) this.speed = 0;
    }

    this.speed = clamp(this.speed, -MAX_REVERSE, maxSpeed);

    const steerSpeed = clamp(Math.abs(this.speed) / 7, 0, 1);
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 9);
    const driftBoost = handbrake && Math.abs(this.speed) > 4 ? 1.9 : 1;
    const turnRate = (this.spec.handling / (1 + Math.abs(this.speed) * 0.018)) * driftBoost;
    this.yaw += this.steer * turnRate * steerSpeed * Math.sign(this.speed || 1) * dt;

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    const targetLateral = handbrake && Math.abs(this.speed) > 6 ? this.steer * this.speed * 0.55 : 0;
    this.lateral += (targetLateral - this.lateral) * Math.min(1, dt * (handbrake ? 5 : 8));
    this.lateral = clamp(this.lateral, -9, 9);

    const prevX = this.x;
    const prevZ = this.z;
    this.x += (fx * this.speed + rx * this.lateral) * dt;
    this.z += (fz * this.speed + rz * this.lateral) * dt;

    const tiltTarget = handbrake ? -this.steer * 0.06 * steerSpeed : 0;
    this.driftTilt += (tiltTarget - this.driftTilt) * Math.min(1, dt * 6);

    if (this.hf.signedCoastDistance(this.x, this.z) < -7) {
      this.x = prevX;
      this.z = prevZ;
      this.speed *= -0.25;
      this.lateral = 0;
    }

    const margin = 40;
    this.x = clamp(this.x, this.hf.minX + margin, this.hf.minX + (this.hf.cols - 1) * this.hf.cell - margin);
    this.z = clamp(this.z, this.hf.minZ + margin, this.hf.minZ + (this.hf.rows - 1) * this.hf.cell - margin);

    this.#resolveCollisions();
    this.#bridgeRails();
    this.#place(dt);
  }

  #resolveCollisions() {
    const nearby = this.city.hash.query(this.x, this.z, 10);
    for (const c of nearby) {
      const dx = this.x - c.x;
      const dz = this.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = c.r + CAR_RADIUS;
      if (d >= minD || d === 0) continue;
      const push = (minD - d) / d;
      this.x += dx * push;
      this.z += dz * push;
      this.speed *= -0.18;
      this.lateral *= 0.3;
    }
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }
}
