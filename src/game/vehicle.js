import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { buildVehicleMesh, vehicleType, VEHICLE_TYPES } from './models.js';
import { animateVehicleWheels } from './sketchfabModels.js';

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
    const spawnGround = this.hf.heightAt(this.x, this.z);
    this.surfaceY = spawn?.road.bridge
      ? this.roads.deckHeightAt(this.x, this.z, spawnGround + 6.5)
      : spawnGround;
    this.speed = 0;
    this.steer = 0;
    this.lateral = 0;
    this.driftTilt = 0;

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

  #place() {
    const surface = this.roads.deckHeightAt(this.x, this.z, this.surfaceY);
    this.surfaceY = surface;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    const hF = this.roads.deckHeightAt(this.x + fx * 1.9, this.z + fz * 1.9, surface);
    const hB = this.roads.deckHeightAt(this.x - fx * 1.9, this.z - fz * 1.9, surface);
    const hR = this.roads.deckHeightAt(this.x + rx * 0.95, this.z + rz * 0.95, surface);
    const hL = this.roads.deckHeightAt(this.x - rx * 0.95, this.z - rz * 0.95, surface);

    this.group.position.set(this.x, surface, this.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = this.yaw;
    this.group.rotation.x = Math.atan2(hB - hF, 3.8) * 0.7;
    this.group.rotation.z = Math.atan2(hR - hL, 1.9) * 0.7 + this.driftTilt;
  }

  update(dt) {
    const input = this.input;
    const gear = input.gear || 'D';
    const gas = input.isDown('gas') && gear !== 'N';
    const brake = input.isDown('brake');
    const boost = input.isDown('boost');
    const handbrake = input.isDown('handbrake');
    const steerTarget = input.stick?.active ? clamp(-input.stick.x, -1, 1) : (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);

    const maxSpeed = boost ? this.spec.boost : this.spec.max;
    if (gas) {
      const direction = gear === 'R' ? -1 : 1;
      const pull = 1 - clamp(Math.max(this.speed * direction, 0) / maxSpeed, 0, 1);
      this.speed += direction * (10 + 16 * pull) * dt;
    } else if (!brake && !handbrake) {
      this.speed *= Math.exp(-0.55 * dt);
      if (Math.abs(this.speed) < 0.25) this.speed = 0;
    }

    if (brake) {
      if (this.speed > 0.4) this.speed = Math.max(0, this.speed - 26 * dt);
      else if (this.speed < -0.4) this.speed = Math.min(0, this.speed + 26 * dt);
      else this.speed = 0;
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
    this.#place();
    animateVehicleWheels(this.mesh, this.speed, this.steer, dt);
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
