import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';
import { buildVehicleMesh, vehicleType, VEHICLE_TYPES } from './models.js';
import { playerCarModel, animateWheels } from './carModels.js';
import { CarLights } from './carLights.js';
import { WORLD } from '../world/worldLight.js';

const CAR_RADIUS = 2.1;

// Per-vehicle driving physics derived from the catalogue spec.
// a0: launch acceleration (m/s²), vk: speed where engine power starts to limit
// thrust, vmax: top speed (m/s), brake: full-pedal deceleration (~0.9 g).
// Tuned 17 Nov 2026 (Bheko: too slow). 0-100 / top: Gusheshe ~6.7 s / 226 km/h,
// Polo ~8.5 s / 187, Hilux ~9.3 s / 180, SAPS ~7.4 s / 201, Quantum ~12 s / 151.
const PHYS = {
  gusheshe: { a0: 4.6, vk: 20, vmax: 63, mass: 1200 },
  quantum: { a0: 3.4, vk: 14, vmax: 42, mass: 2300 },
  polo: { a0: 4.0, vk: 17, vmax: 52, mass: 1100 },
  hilux: { a0: 3.8, vk: 16, vmax: 50, mass: 1900 },
  saps: { a0: 4.3, vk: 19, vmax: 56, mass: 2100 }
};

function physicsFor(spec) {
  const p = PHYS[spec.id] || { a0: 3.8, vk: 16, vmax: spec.max, mass: 1500 };
  const vk = p.vk;
  const vmax = p.vmax;
  const roll = 0.13;
  // drag coefficient so full power balances resistance at vmax
  const drag = Math.max(0.00005, (p.a0 * (vk / vmax) - roll) / (vmax * vmax));
  return {
    a0: p.a0,
    vk,
    vmax,
    vmaxBoost: vmax * 1.25,
    vmaxR: 9,
    roll,
    drag,
    brake: p.mass > 2000 ? 9.0 : 10.0,
    mass: p.mass,
    wheelbase: p.mass > 2000 ? 3.0 : 2.55,
    grip: 7.2 * (spec.handling / 1.5)
  };
}

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
    this.accel = 0;
    this.yawRate = 0;
    this.knockX = 0;
    this.knockZ = 0;
    this.spin = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;

    this.group = new THREE.Group();
    this.group.name = 'player-vehicle';
    this.mesh = null;
    this.delta = 0;
    this.lightMode = 'auto'; // auto -> on -> high -> off
    this.indicator = null; // 'left' | 'right' | 'hazard' | null
    this.blinkT = 0;
    this.blinkOn = false;
    this.turnAccum = 0;
    this.onBlink = null; // callback(on) for the relay tick
    this.lights = new CarLights();
    this.group.add(this.lights.group);
    this.setType(typeId);
    this.#place();
  }

  setType(id) {
    if (this.mesh) this.group.remove(this.mesh);
    const model = playerCarModel(id);
    this.mesh = model || buildVehicleMesh(id);
    this.group.add(this.mesh);
    if (model) {
      const sz = model.userData.size;
      this.lights.layout({ length: sz.z, width: sz.x, lamps: model.userData.lamps });
    } else {
      const box = new THREE.Box3().setFromObject(this.mesh);
      const sz = box.getSize(new THREE.Vector3());
      this.lights.layout({ length: sz.z, width: sz.x, headY: sz.y * 0.42, tailY: sz.y * 0.45 });
    }
    this.typeId = id;
    this.spec = vehicleType(id);
    this.phys = physicsFor(this.spec);
  }

  // Put the car back where a save left it (stopped).
  restore(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.lateral = 0;
    this.y = null;
    this.vy = 0;
    this.#place();
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
    const surf = this.roads.surfaceAt(this.x, this.z, prev, this.surfRoad || null, fx, fz);
    let target = surf.y;
    this.onDeck = surf.deck;
    if (surf.pc) this.surfRoad = surf.pc.road;
    else if (!surf.onRoad) this.surfRoad = null;
    if (prev === null || dt === 0) {
      this.y = target;
      this.vy = 0;
    } else if (target < prev - 0.35) {
      // simple gravity when leaving a ledge
      this.vy -= 22 * dt;
      this.y = Math.max(target, prev + this.vy * dt);
    } else if (target > prev + 0.4) {
      // ease up over a seam / ramp step instead of popping
      this.vy = 0;
      this.y = prev + Math.min(target - prev, Math.max(0.4, 14 * dt));
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
    this.slope = clamp(Math.atan2(hB - hF, 3.8), -0.35, 0.35);
    this.group.rotation.x = this.slope * 0.7 + (this.bodyPitch || 0);
    this.group.rotation.z = clamp(Math.atan2(hR - hL, 1.9), -0.3, 0.3) * 0.7 + this.driftTilt + (this.bodyRoll || 0);
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
    const boost = input.isDown('boost');
    const handbrake = input.isDown('handbrake');
    const throttle = input.throttle ?? (input.isDown('gas') ? 1 : 0);
    this.throttleNow = throttle;
    const brakeIn = input.brake ?? (input.isDown('brake') ? 1 : 0);
    const gear = input.gear || 'D';
    const ph = this.phys;

    // ---- longitudinal dynamics (m/s, m/s²) ---------------------------------
    const v = this.speed;
    const dir = gear === 'D' ? 1 : gear === 'R' ? -1 : 0;
    const vmax = dir < 0 ? ph.vmaxR : boost ? ph.vmaxBoost : ph.vmax;
    const a0 = (dir < 0 ? ph.a0 * 0.7 : ph.a0) * (boost && dir > 0 ? 1.3 : 1);
    let accel = 0;
    if (dir !== 0) {
      const vAlong = v * dir; // speed in the selected direction
      // engine: constant force at low speed, power-limited above ~vk
      const powerLimit = Math.min(1, ph.vk / Math.max(vAlong, 0.1));
      // above top speed (e.g. after boost ends) the engine stops pulling
      const headroom = vAlong > vmax ? 0 : 1;
      let aEng = throttle * a0 * powerLimit * headroom;
      // automatic gearbox idle creep (walking pace) when off both pedals
      if (throttle < 0.05 && brakeIn < 0.05 && !handbrake && vAlong < 1.4) aEng += 0.7 * (1 - Math.max(vAlong, 0) / 1.4);
      // engine braking when lifting off
      if (throttle < 0.05 && vAlong > 2) aEng -= 0.32 + 0.011 * vAlong;
      accel += aEng * dir;
    }
    // rolling resistance + aerodynamic drag (balances full power at vmax)
    const res = ph.roll + ph.drag * v * v;
    if (Math.abs(v) > 0.01) accel -= Math.sign(v) * res;
    // slope: gravity along the road
    // slope > 0 = nose down (rotation.x convention), so downhill speeds you up
    accel += 9.81 * Math.sin(this.slope || 0) * 0.6;

    let vNew = v + accel * dt;
    // brakes / handbrake oppose motion and never push the car backwards
    const decel = brakeIn * ph.brake + (handbrake ? 5.5 : 0);
    if (decel > 0) {
      const dv = decel * dt;
      if (Math.abs(vNew) <= dv) vNew = 0;
      else vNew -= Math.sign(vNew) * dv;
    }
    // settle when parked in neutral or on the brake
    if (Math.abs(vNew) < 0.05 && (dir === 0 || brakeIn > 0.05) && throttle < 0.05) vNew = 0;
    this.speed = clamp(vNew, -ph.vmaxR * 1.05, (boost ? ph.vmaxBoost : ph.vmax) * 1.02);
    this.accel = (this.speed - v) / Math.max(dt, 1e-4);

    // ---- steering: bicycle model, speed-sensitive lock, grip limited --------
    const steerIn = input.steer ?? ((input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0));
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 14);
    const speedAbs = Math.abs(this.speed);
    const maxAngle = (34 * Math.PI) / 180 / (1 + speedAbs / 13); // 34° parked, ~10° at 110 km/h
    const delta = this.steer * maxAngle;
    this.delta = delta;
    let yawRate = (this.speed / ph.wheelbase) * Math.tan(delta);
    const grip = ph.grip * (handbrake && speedAbs > 5 ? 1.7 : 1); // lateral accel limit
    const maxYaw = grip / Math.max(speedAbs, 1);
    if (Math.abs(yawRate) > maxYaw) yawRate = Math.sign(yawRate) * maxYaw;
    this.yaw += yawRate * dt;
    this.yawRate = yawRate;
    const steerSpeed = clamp(speedAbs / 7, 0, 1);

    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);

    const targetLateral = handbrake && speedAbs > 6 ? this.steer * this.speed * 0.5 : 0;
    this.lateral += (targetLateral - this.lateral) * Math.min(1, dt * (handbrake ? 4 : 7));
    this.lateral = clamp(this.lateral, -9, 9);

    // body pitch (dive under braking, squat on throttle) and roll in corners
    const pitchT = clamp(-this.accel * 0.0065, -0.06, 0.05);
    const rollT = clamp(yawRate * this.speed * 0.0042, -0.07, 0.07);
    this.bodyPitch += (pitchT - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyRoll += (rollT - this.bodyRoll) * Math.min(1, dt * 6);

    const prevX = this.x;
    const prevZ = this.z;
    this.x += (fx * this.speed + rx * this.lateral + this.knockX) * dt;
    this.z += (fz * this.speed + rz * this.lateral + this.knockZ) * dt;
    // crash knock: sideways shove and spin that bleed off over ~half a second
    if (this.knockX || this.knockZ || this.spin) {
      this.yaw += this.spin * dt;
      const k = Math.max(0, 1 - dt * 3.2);
      this.knockX *= k;
      this.knockZ *= k;
      this.spin *= Math.max(0, 1 - dt * 2.5);
      if (Math.abs(this.knockX) + Math.abs(this.knockZ) < 0.05) this.knockX = this.knockZ = 0;
      if (Math.abs(this.spin) < 0.01) this.spin = 0;
    }

    const tiltTarget = handbrake ? -this.steer * 0.05 * steerSpeed : 0;
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
    animateWheels(this.mesh, this.speed, this.delta, dt);
    this.#indicators(dt);
    const bl = this.blinkOn && this.indicator;
    this.lights.update(WORLD.night.value, brakeIn > 0.1 || handbrake, gear === 'R', 10, this.lightMode, {
      left: bl && (this.indicator === 'left' || this.indicator === 'hazard'),
      right: bl && (this.indicator === 'right' || this.indicator === 'hazard')
    });
  }

  #resolveCollisions() {
    const hit = this.city.buildings ? this.city.buildings.collide(this.x, this.z, 1.25) : null;
    if (hit) {
      this.x = hit.x;
      this.z = hit.z;
      // bounce off the wall: lose most speed, keep a little glancing slide
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const into = -(fx * hit.nx + fz * hit.nz) * Math.sign(this.speed);
      this.speed *= into > 0.5 ? -0.15 : 0.6;
      this.lateral *= 0.3;
    }
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

  cycleLights() {
    const order = ['auto', 'on', 'high', 'off'];
    this.lightMode = order[(order.indexOf(this.lightMode) + 1) % order.length];
    return this.lightMode;
  }

  // Toggle an indicator ('left' | 'right' | 'hazard'); pressing it again cancels.
  setIndicator(which) {
    this.indicator = this.indicator === which ? null : which;
    this.turnAccum = 0;
    this.blinkT = 0;
    this.blinkOn = !!this.indicator;
    if (this.onBlink) this.onBlink(this.blinkOn);
    return this.indicator;
  }

  #indicators(dt) {
    if (!this.indicator) {
      this.blinkOn = false;
      return;
    }
    this.blinkT += dt;
    if (this.blinkT >= 0.38) {
      this.blinkT = 0;
      this.blinkOn = !this.blinkOn;
      if (this.onBlink) this.onBlink(this.blinkOn);
    }
    // auto-cancel like a real stalk: after a turn of 45°+ in the signalled
    // direction, once the wheel comes back near the centre
    if (this.indicator === 'hazard') return;
    const sgn = this.indicator === 'left' ? 1 : -1;
    this.turnAccum += this.yawRate * dt * sgn;
    if (this.turnAccum > 0.78 && Math.abs(this.steer) < 0.12) {
      this.indicator = null;
      this.blinkOn = false;
      this.turnAccum = 0;
    }
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }
}
