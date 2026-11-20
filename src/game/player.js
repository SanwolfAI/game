import { clamp } from '../core/utils.js';
import { buildPlayerModel } from './models.js';
import { Human, humansReady, skinTone, hairTone } from './humans.js';
import * as THREE from '../../vendor/three/three.module.js';

// On-foot speeds (Bheko, 20 Nov 2026: walking was too slow, no way to run).
// Touch: light joystick push walks, full push jogs; hold RUN to sprint.
// Keyboard: W jogs, Shift+W sprints, A/D turn, S steps back.
export const WALK = 1.6;
export const JOG = 4.0;
export const SPRINT = 7.2;
const STAMINA_DRAIN = 1 / 9; // a full bar = 9 s of sprinting
const STAMINA_FILL = 1 / 6; // ~6 s to refill while walking (faster standing still)
const STAMINA_DELAY = 0.7; // s after a sprint before it starts refilling
const TIRED_UNTIL = 0.3; // once empty, no sprint until it is back to 30 %
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
    this.camYaw = yaw; // the on-foot chase camera's heading (main.js reads it)
    this.stamina = 1;
    this.tired = false;
    this.sprinting = false;
    this.restT = 0;

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
    this.camYaw = this.yaw;
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
    const joy = input.joy;
    const locked = input.locked;
    let target = 0;
    let wantYaw = NaN;
    let fromKeys = false;
    const runHeld = !locked && (input.runHeld || input.isDown('boost'));
    if (!locked && joy && joy.active && joy.mag > 0.12) {
      // joystick: direction relative to the camera, push depth picks the pace
      const m = joy.mag;
      target = m < 0.6 ? WALK : m >= 0.9 ? JOG : WALK + ((JOG - WALK) * (m - 0.6)) / 0.3;
      wantYaw = this.camYaw - Math.atan2(joy.x, joy.y);
    } else if (!locked) {
      const forward = (input.down.has('gas') ? 1 : 0) - (input.down.has('brake') ? 1 : 0);
      const turn = (input.down.has('left') ? 1 : 0) - (input.down.has('right') ? 1 : 0);
      if (forward || turn) fromKeys = true;
      target = forward > 0 ? JOG : forward < 0 ? -WALK : 0;
      this.yaw += turn * 2.6 * dt;
      // RUN held with no stick: sprint straight ahead
      if (!forward && input.runHeld) target = JOG;
    }
    // sprint (RUN button or Shift) while there is stamina
    this.sprinting = false;
    if (runHeld && target > 0 && !this.tired && this.stamina > 0) {
      target = SPRINT;
      this.sprinting = true;
    }
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      this.restT = 0;
      if (this.stamina === 0) this.tired = true;
    } else {
      this.restT += dt;
      if (this.restT > STAMINA_DELAY) this.stamina = Math.min(1, this.stamina + STAMINA_FILL * dt * (Math.abs(this.speed) < 0.3 ? 1.6 : 1));
      if (this.tired && this.stamina >= TIRED_UNTIL) this.tired = false;
    }
    input.paintStamina?.(this.stamina, this.tired);

    if (wantYaw === wantYaw) {
      // turn to face where the stick points (quick, but not a snap)
      let d = wantYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const step = 11 * dt;
      this.yaw += d < -step ? -step : d > step ? step : d;
    }
    const rate = target > Math.abs(this.speed) ? 5 : 9; // ease in, stop crisply
    this.speed += (target - this.speed) * Math.min(1, dt * rate);
    if (Math.abs(this.speed) < 0.05 && target === 0) this.speed = 0;

    // the camera swings round behind the player: briskly with keys, lazily
    // with the stick (so pushing sideways walks a wide curve, and running
    // back toward the camera doesn't spin it)
    {
      let d = this.yaw - this.camYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const moving = Math.abs(this.speed) > 0.3;
      const k = fromKeys ? 6 : !moving ? 0.6 : Math.abs(d) > 2.4 ? 0.35 : 1.8;
      this.camYaw += d * (1 - Math.exp(-k * dt));
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
      const st = sp < 0.25 ? 'Idle' : sp > 2.6 ? 'Run' : 'Walk';
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
