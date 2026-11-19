import { clamp } from '../core/utils.js';
import { buildPlayerModel } from './models.js';
import { Human, humansReady, skinTone, hairTone } from './humans.js';
import * as THREE from '../../vendor/three/three.module.js';

const WALK = 2.0; // brisk walk (animated human walk cycle); sprint below
const RUN = 7.2;
const PERSON_RADIUS = 0.5;

export class Player {
  constructor(hf, city, input, x, z, yaw = 0) {
    this.hf = hf;
    this.city = city;
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
    this.group.visible = false;
    this.human = null;
    this.#attachHuman();
    this.#place();
  }

  // Real animated body (Quaternius CC0) when it loaded; the old block body
  // stays as the fallback.
  #attachHuman() {
    if (this.human || !humansReady()) return;
    try {
      const hu = new Human('male_casual_hoodie');
      hu.paint({
        skin: skinTone(0.3).color,
        hair: hairTone(0, 0.1),
        top: new THREE.Color('#1f4f9a'),
        bottom: new THREE.Color('#22262c'),
        shoe: new THREE.Color('#f0f0ee')
      });
      for (const c of this.group.children) c.visible = false;
      this.group.add(hu.root);
      this.human = hu;
    } catch (err) {
      console.warn('[IZK] player human failed, block body kept', err);
      this.human = false;
    }
  }

  placeAt(x, z, yaw, y = null) {
    this.y = y;
    this.x = x;
    this.z = z;
    if (yaw !== undefined) this.yaw = yaw;
    this.speed = 0;
    this.#place();
  }

  // Walkable height: roads/bridges/sidewalks when the road network is attached.
  #groundY() {
    if (!this.roads) return this.hf.heightAt(this.x, this.z);
    const prev = this.y ?? null;
    this.y = this.roads.surfaceAt(this.x, this.z, prev).y;
    return this.y;
  }

  #place() {
    this.group.position.set(this.x, this.#groundY(), this.z);
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

    if (this.hf.signedCoastDistance(this.x, this.z) < 2) {
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
    const hit = this.city.buildings ? this.city.buildings.collide(this.x, this.z, PERSON_RADIUS) : null;
    if (hit) {
      this.x = hit.x;
      this.z = hit.z;
    }
    const nearby = this.city.hash.query(this.x, this.z, 6);
    for (const c of nearby) {
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
    if (this.human === null && humansReady()) this.#attachHuman();
    if (this.human) {
      const sp = Math.abs(this.speed);
      const st = sp < 0.25 ? 'Idle' : sp > WALK + 0.6 ? 'Run' : 'Walk';
      this.human.play(st);
      this.human.setSpeed(st, sp);
      const a = this.human.actions[st];
      if (a && this.speed < 0) a.timeScale = -Math.abs(a.timeScale);
      this.human.update(dt);
      this.group.position.y = this.#groundY();
      return;
    }
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
    this.group.position.y = this.#groundY() + bob;
  }

  get forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }
}
