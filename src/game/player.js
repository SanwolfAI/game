import { clamp } from '../core/utils.js';
import { buildPlayerModel } from './models.js';

const WALK = 3.4;
const RUN = 7.2;
const PERSON_RADIUS = 0.5;

export class Player {
  constructor(hf, roads, input, x, z, yaw = 0) {
    this.hf = hf;
    this.roads = roads;
    this.input = input;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.phase = 0;

    const model = buildPlayerModel();
    this.group = model.group;
    this.armL = model.armL;
    this.armR = model.armR;
    this.legL = model.legL;
    this.legR = model.legR;
    this.shoeL = model.shoeL;
    this.shoeR = model.shoeR;
    this.group.visible = true;
    this.#place();
  }

  placeAt(x, z, yaw) {
    this.x = x;
    this.z = z;
    if (yaw !== undefined) this.yaw = yaw;
    this.speed = 0;
    this.#place();
  }

  #place() {
    this.group.position.set(this.x, this.hf.heightAt(this.x, this.z), this.z);
    this.group.rotation.y = this.yaw;
  }

  update(dt) {
    const input = this.input;
    const forward = (input.isDown('gas') ? 1 : 0) - (input.isDown('brake') ? 1 : 0);
    const turn = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
    const target = forward > 0 ? (input.isDown('boost') ? RUN : WALK) : forward < 0 ? -WALK * 0.7 : 0;

    this.speed += (target - this.speed) * Math.min(1, dt * 9);
    if (Math.abs(this.speed) < 0.05 && target === 0) this.speed = 0;

    if (Math.abs(this.speed) > 0.2) {
      this.yaw += turn * 2.4 * dt * (this.speed < 0 ? -1 : 1);
    }

    const prevX = this.x;
    const prevZ = this.z;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.x += fx * this.speed * dt;
    this.z += fz * this.speed * dt;

    const nearest = this.roads?.nearestRoad(this.x, this.z, 45);
    const roadLimit = nearest ? Math.max(1.8, nearest.road.width * 0.5 - PERSON_RADIUS) : 0;
    if (!nearest || nearest.dist > roadLimit || this.hf.signedCoastDistance(this.x, this.z) < 2) {
      this.x = prevX;
      this.z = prevZ;
    }

    const margin = 30;
    this.x = clamp(this.x, this.hf.minX + margin, this.hf.minX + (this.hf.cols - 1) * this.hf.cell - margin);
    this.z = clamp(this.z, this.hf.minZ + margin, this.hf.minZ + (this.hf.rows - 1) * this.hf.cell - margin);

    this.#resolveCollisions();
    this.#animate(dt);
    this.#place();
  }

  #resolveCollisions() {
    const nearby = this.roads?.nearestRoad(this.x, this.z, 45);
    if (!nearby) return;
    // Roads are the only walkable surfaces in Phase 1; no building colliders exist.
    for (const c of []) {
      const dx = this.x - c.x;
      const dz = this.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = c.r + PERSON_RADIUS;
      if (d >= minD || d === 0) continue;
      const push = (minD - d) / d;
      this.x += dx * push;
      this.z += dz * push;
    }
  }

  #animate(dt) {
    const moving = Math.abs(this.speed) > 0.2;
    if (moving) this.phase += Math.abs(this.speed) * dt * 2.6;
    const swing = moving ? Math.sin(this.phase) * 0.6 : 0;
    const bob = moving ? Math.abs(Math.cos(this.phase)) * 0.05 : 0;

    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.shoeL.rotation.x = swing;
    this.shoeR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.7;
    this.armR.rotation.x = swing * 0.7;
    this.group.position.y = this.hf.heightAt(this.x, this.z) + bob;
  }

  get forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }
}
