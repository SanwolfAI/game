import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';

// Starter bicycle (Bheko, 20 Nov 2026: "too much walking"). Every owned house
// comes with a bicycle parked at the door. ACTION "Ride bicycle" gets on, the
// joystick steers (left/right) and pedals (push up) or brakes (pull down),
// RUN sprint-pedals while there is stamina, ACTION again gets off. No licence
// needed. Cruise ~18 km/h, sprint ~25 km/h, slower off the tar. The bike stays
// where you leave it (localStorage izk.bike.v1). Traffic sees it as a slow
// car (it is the traffic "player" while you ride).
// Model: own low-poly geometry (~1.4k triangles), no external asset.

const KEY = 'izk.bike.v1';
export const BIKE_CRUISE = 5.0; // m/s, 18 km/h
export const BIKE_SPRINT = 6.95; // m/s, 25 km/h
const ACCEL = 1.7;
const SPRINT_ACCEL = 2.4;
const BRAKE = 5.5;
const COAST = 0.22;
const WHEELBASE = 1.05;
const WHEEL_R = 0.34;
const SCALE = 1.08; // model scale (26-inch wheels)
const OFFROAD = 0.6; // share of the speed off the tar (grass, dirt)
const STAMINA_DRAIN = 1 / 12; // sprint-pedalling lasts longer than a sprint on foot
const STAMINA_FILL = 1 / 7;
const STAMINA_DELAY = 0.8;
const TIRED_UNTIL = 0.3;
const RADIUS = 0.6;

const FRAME_RED = 0xc81d25;

// ---- geometry ------------------------------------------------------------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _qq = new THREE.Quaternion();
const _sc = new THREE.Vector3(1, 1, 1);

// a cylinder from a to b (local space), 6 sides
function tube(a, b, r, sides = 6) {
  _a.set(a[0], a[1], a[2]);
  _b.set(b[0], b[1], b[2]);
  const len = _a.distanceTo(_b);
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1, true);
  _qq.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
  _m.compose(_a.clone().add(_b).multiplyScalar(0.5), _qq, _sc);
  g.applyMatrix4(_m);
  return g;
}

function box(w, h, d, x, y, z, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

// merge plain geometries (position + normal only), no external utils
function merge(list) {
  let n = 0;
  const flat = list.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    n += f.attributes.position.count;
    return f;
  });
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const f of flat) {
    pos.set(f.attributes.position.array, o * 3);
    nor.set(f.attributes.normal.array, o * 3);
    o += f.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function wheelGeometry() {
  const tyre = new THREE.TorusGeometry(WHEEL_R - 0.025, 0.028, 5, 20);
  tyre.rotateY(Math.PI / 2);
  const rim = new THREE.TorusGeometry(WHEEL_R - 0.06, 0.012, 3, 20);
  rim.rotateY(Math.PI / 2);
  const parts = [tyre, rim, tube([-0.05, 0, 0], [0.05, 0, 0], 0.03)];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    parts.push(tube([0, 0, 0], [0, Math.cos(a) * (WHEEL_R - 0.06), Math.sin(a) * (WHEEL_R - 0.06)], 0.005, 3));
  }
  return { tyre: merge([tyre]), metal: merge([rim, ...parts.slice(2)]) };
}

// returns { group, rearWheel, frontWheel, fork, crank, tris }
export function buildBicycle() {
  const red = new THREE.MeshStandardMaterial({ color: FRAME_RED, roughness: 0.45, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.8 });
  const g = new THREE.Group();
  g.name = 'bicycle';
  const RZ = -0.52; // rear axle
  const FZ = 0.53; // front axle
  const BB = [0, 0.3, -0.04];
  const SEAT = [0, 0.8, -0.22];
  const HEAD_T = [0, 0.84, 0.39];
  const HEAD_B = [0, 0.66, 0.43];
  const frame = merge([
    tube(BB, SEAT, 0.022), // seat tube
    tube(SEAT, HEAD_T, 0.02), // top tube
    tube(BB, HEAD_B, 0.026), // down tube
    tube(HEAD_B, HEAD_T, 0.03), // head tube
    tube(BB, [0.06, WHEEL_R, RZ], 0.012), // chain stays
    tube(BB, [-0.06, WHEEL_R, RZ], 0.012),
    tube(SEAT, [0.06, WHEEL_R, RZ], 0.011), // seat stays
    tube(SEAT, [-0.06, WHEEL_R, RZ], 0.011),
    // rear rack over the wheel (carries shopping)
    tube([0.07, 0.72, -0.25], [0.07, 0.72, -0.72], 0.008, 4),
    tube([-0.07, 0.72, -0.25], [-0.07, 0.72, -0.72], 0.008, 4),
    tube([0.07, 0.72, -0.72], [0.06, WHEEL_R, RZ], 0.008, 4),
    tube([-0.07, 0.72, -0.72], [-0.06, WHEEL_R, RZ], 0.008, 4),
  ]);
  const frameMesh = new THREE.Mesh(frame, red);
  g.add(frameMesh);
  const parts = merge([
    tube(SEAT, [0, 0.9, -0.24], 0.013), // seat post
    box(0.14, 0.05, 0.26, 0, 0.92, -0.25), // saddle
    box(0.17, 0.012, 0.42, 0, 0.73, -0.48), // rack deck
    // mudguard over the back wheel
    box(0.08, 0.012, 0.3, 0, WHEEL_R + 0.37, RZ + 0.05, -0.25),
  ]);
  g.add(new THREE.Mesh(parts, dark));
  // fork + bars: turns with the steering, pivots on the head tube
  const fork = new THREE.Group();
  fork.position.set(0, HEAD_B[1], HEAD_B[2]);
  // tilt of the head tube
  const forkTilt = Math.atan2(HEAD_T[2] - HEAD_B[2], HEAD_T[1] - HEAD_B[1]);
  fork.rotation.x = forkTilt;
  const axleY = WHEEL_R - HEAD_B[1];
  const axleZ = FZ - HEAD_B[2];
  // fork geometry in the un-tilted head-tube frame: rotate the axle into it
  const ca = Math.cos(-forkTilt);
  const sa = Math.sin(-forkTilt);
  const ay = axleY * ca - axleZ * sa;
  const az = axleY * sa + axleZ * ca;
  const forkGeo = merge([
    tube([0.055, 0, 0], [0.055, ay, az], 0.013),
    tube([-0.055, 0, 0], [-0.055, ay, az], 0.013),
    tube([-0.06, 0, 0], [0.06, 0, 0], 0.016),
    tube([0, 0, 0], [0, 0.34, 0], 0.016), // steerer + stem
  ]);
  fork.add(new THREE.Mesh(forkGeo, metal));
  const bars = merge([tube([-0.29, 0.36, -0.06], [0.29, 0.36, -0.06], 0.012), tube([0, 0.34, 0], [0, 0.36, -0.06], 0.014)]);
  fork.add(new THREE.Mesh(bars, metal));
  const grips = merge([tube([-0.3, 0.36, -0.06], [-0.2, 0.36, -0.06], 0.019), tube([0.2, 0.36, -0.06], [0.3, 0.36, -0.06], 0.019)]);
  fork.add(new THREE.Mesh(grips, dark));
  g.add(fork);
  const wg = wheelGeometry();
  const mkWheel = () => {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wg.tyre, dark));
    w.add(new THREE.Mesh(wg.metal, metal));
    return w;
  };
  const rearWheel = mkWheel();
  rearWheel.position.set(0, WHEEL_R, RZ);
  g.add(rearWheel);
  // the front wheel hangs off the fork (so it steers), at the axle
  const frontWheel = mkWheel();
  frontWheel.position.set(0, ay, az);
  frontWheel.rotation.x = -forkTilt;
  fork.add(frontWheel);
  // crank: arms + pedals, turns with the pedalling
  const crank = new THREE.Group();
  crank.position.set(0, BB[1], BB[2]);
  const crankGeo = merge([
    tube([0.085, 0, 0], [0.085, -0.17, 0], 0.012, 4),
    tube([-0.085, 0, 0], [-0.085, 0.17, 0], 0.012, 4),
    tube([-0.09, 0, 0], [0.09, 0, 0], 0.02, 6),
    box(0.1, 0.02, 0.07, 0.15, -0.17, 0),
    box(0.1, 0.02, 0.07, -0.15, 0.17, 0),
  ]);
  crank.add(new THREE.Mesh(crankGeo, metal));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 3, 14), dark);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = 0.05;
  crank.add(ring);
  g.add(crank);
  // kickstand
  const stand = new THREE.Mesh(tube([0.05, 0.3, -0.12], [0.2, 0.0, -0.3], 0.01, 4), metal);
  g.add(stand);
  let tris = 0;
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    }
  });
  return { group: g, rearWheel, frontWheel, fork, crank, stand, tris: Math.round(tris), seat: SEAT };
}

// ---- seated rider pose (Quaternius rig, bones re-aimed on top of Idle) -----
// A small two-bone IK: hips sit on the saddle, the feet follow the pedals
// (the rig's Foot bones are IK targets under Root, so they are placed at the
// ankle), knees point forward, hands hold the grips, elbows bend down/out.
const _qp = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _H = new THREE.Vector3();
const _A = new THREE.Vector3();
const _K = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const AX_X = new THREE.Vector3(1, 0, 0);
const PEDAL_L = new THREE.Vector3(0.15, -0.17, 0);
const PEDAL_R = new THREE.Vector3(-0.15, 0.17, 0);
const GRIP_L = new THREE.Vector3(0.24, 0.37, -0.06);
const GRIP_R = new THREE.Vector3(-0.24, 0.37, -0.06);

// rotate a bone about an axis given in the rider's root frame
function turn(bone, root, axis, angle) {
  if (!bone || !angle) return;
  root.getWorldQuaternion(_qr);
  bone.parent.getWorldQuaternion(_qp);
  _ax.copy(axis).applyQuaternion(_qr).applyQuaternion(_qp.invert()).normalize();
  _qp.setFromAxisAngle(_ax, angle);
  bone.quaternion.premultiply(_qp);
}

// point a bone's own axis (calibrated, local) along a world direction
function aim(bone, localAxis, dirWorld) {
  bone.getWorldQuaternion(_qb);
  _c.copy(localAxis).applyQuaternion(_qb);
  _t.copy(dirWorld).normalize();
  _q2.setFromUnitVectors(_c, _t);
  bone.parent.getWorldQuaternion(_qp);
  // local' = P^-1 * Q * P * local  (world' = Q * world)
  _qb.copy(_qp).invert().multiply(_q2).multiply(_qp);
  bone.quaternion.premultiply(_qb);
}

// two-bone chain from (upper, lower) to world target `tgt`, bending toward `hint`
function chain(upper, lower, ax1, ax2, la, lb, tgt, hint) {
  upper.getWorldPosition(_H);
  _u.copy(tgt).sub(_H);
  let d = _u.length();
  if (d < 1e-4) return;
  _u.multiplyScalar(1 / d);
  d = Math.min(d, (la + lb) * 0.999);
  _w.copy(hint).addScaledVector(_u, -hint.dot(_u));
  if (_w.lengthSq() < 1e-6) return;
  _w.normalize();
  const ca = Math.max(-1, Math.min(1, (la * la + d * d - lb * lb) / (2 * la * d)));
  const sa = Math.sqrt(1 - ca * ca);
  _K.copy(_H).addScaledVector(_u, la * ca).addScaledVector(_w, la * sa);
  _A.copy(_K).sub(_H);
  aim(upper, ax1, _A);
  _A.copy(_H).addScaledVector(_u, d).sub(_K);
  aim(lower, ax2, _A);
}

function findBones(obj) {
  const want = { hips: /^Hips$/, torso: /^Torso$/, abdomen: /^Abdomen$/, chest: /^Chest$/, neck: /^Neck$/, thighL: /^UpperLeg\.?L$/, thighR: /^UpperLeg\.?R$/, shinL: /^LowerLeg\.?L$/, shinR: /^LowerLeg\.?R$/, footL: /^Foot\.?L$/, footR: /^Foot\.?R$/, armL: /^UpperArm\.?L$/, armR: /^UpperArm\.?R$/, foreL: /^LowerArm\.?L$/, foreR: /^LowerArm\.?R$/, wristL: /^Wrist\.?L$/, wristR: /^Wrist\.?R$/ };
  const out = {};
  obj.traverse((o) => {
    if (!o.isBone) return;
    for (const k in want) if (!out[k] && want[k].test(o.name)) out[k] = o;
  });
  return out;
}

// The mixer only writes a bone when its clip value changes, so a bone we
// rotated keeps our rotation into the next frame. Before posing, put back the
// clip's value (if the mixer did not overwrite it); after, remember ours.
const POSED = ['abdomen', 'torso', 'neck', 'thighL', 'thighR', 'shinL', 'shinR', 'armL', 'armR', 'foreL', 'foreR'];
function restore(B) {
  for (const k of POSED) {
    const b = B[k];
    if (!b) continue;
    const u = b.userData;
    if (!u.bq) {
      u.bq = b.quaternion.clone();
      u.lo = new THREE.Quaternion(2, 2, 2, 2);
    }
    if (b.quaternion.equals(u.lo)) b.quaternion.copy(u.bq);
    else u.bq.copy(b.quaternion);
  }
}
// back to the clip's pose (getting off)
function unpose(B) {
  for (const k of POSED) {
    const b = B[k];
    if (!b || !b.userData.bq) continue;
    if (b.quaternion.equals(b.userData.lo)) b.quaternion.copy(b.userData.bq);
    b.userData.lo.set(2, 2, 2, 2);
  }
  for (const k of ['footL', 'footR']) if (B[k] && B[k].userData.bp) B[k].position.copy(B[k].userData.bp);
}
function remember(B) {
  for (const k of POSED) if (B[k]) B[k].userData.lo.copy(B[k].quaternion);
}

// lengths and bone axes from the standing Idle pose (once)
function calibrate(B) {
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const seg = (a, b) => {
    a.getWorldPosition(v1);
    b.getWorldPosition(v2);
    const len = v1.distanceTo(v2);
    a.getWorldQuaternion(q);
    const axis = v2.sub(v1).normalize().applyQuaternion(q.invert());
    return { len, axis: axis.clone() };
  };
  const C = {};
  for (const s of ['L', 'R']) {
    C['thigh' + s] = seg(B['thigh' + s], B['shin' + s]);
    C['shin' + s] = seg(B['shin' + s], B['foot' + s]);
    C['arm' + s] = seg(B['arm' + s], B['fore' + s]);
    C['fore' + s] = seg(B['fore' + s], B['wrist' + s]);
  }
  return C;
}

export class Bicycle {
  constructor(hf, roads, city, input) {
    this.hf = hf;
    this.roads = roads;
    this.city = city;
    this.input = input;
    const b = buildBicycle();
    this.model = b;
    this.group = new THREE.Group();
    this.group.name = 'player-bicycle';
    this.lean = new THREE.Group(); // leans into corners (rider rides along)
    this.group.add(this.lean);
    b.group.scale.setScalar(SCALE); // a full-size 26-inch town bike next to a 1.7 m rider
    this.lean.add(b.group);
    this.riderMount = new THREE.Group();
    this.riderMount.position.set(0, 0.24, -0.33); // hips on the saddle
    this.lean.add(this.riderMount);
    this.x = 0;
    this.z = 0;
    this.y = null;
    this.yaw = 0;
    this.speed = 0;
    this.steer = 0;
    this.crankA = 0;
    this.placed = false;
    this.riding = false;
    // what traffic.js reads off its "player"
    this.lateral = 0;
    this.knockX = 0;
    this.knockZ = 0;
    this.spin = 0;
    this.indicator = null;
    this.phys = { mass: 95 };
    this.surfRoad = null;
    this.stamina = 1;
    this.tired = false;
    this.restT = 0;
    this.sprinting = false;
    this.rider = null;
    this.bones = null;
    this.group.visible = false;
    this.#load();
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  #load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && Number.isFinite(s.x) && Number.isFinite(s.z)) this.park(s.x, s.z, s.yaw || 0, false);
    } catch {}
  }

  save() {
    if (!this.placed) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ x: Math.round(this.x * 10) / 10, z: Math.round(this.z * 10) / 10, yaw: Math.round(this.yaw * 1000) / 1000 }));
    } catch {}
  }

  // park the bike (on its stand)
  park(x, z, yaw, save = true) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.y = null;
    this.placed = true;
    this.group.visible = true;
    this.#place(0);
    if (save) this.save();
  }

  // a new house: the bike leans by the door, a step to the side
  parkAtHome(h) {
    const rx = Math.cos(h.yaw);
    const rz = -Math.sin(h.yaw);
    this.park(h.x + rx * 1.6, h.z + rz * 1.6, h.yaw + Math.PI / 2);
  }

  near(x, z, r = 2.8) {
    return this.placed && !this.riding && Math.abs(x - this.x) < r && Math.abs(z - this.z) < r && Math.hypot(x - this.x, z - this.z) < r;
  }

  // get on: the player's body rides along in a seated pose
  mount(player) {
    this.riding = true;
    this.speed = 0;
    this.steer = 0;
    this.knockX = this.knockZ = this.spin = 0;
    this.stamina = player.stamina;
    this.tired = player.tired;
    this.player = player;
    const hu = player.human;
    if (hu) {
      this.rider = hu;
      this.riderMount.add(hu.root);
      hu.play('Idle', 0);
      if (!this.bones) this.bones = findBones(hu.obj);
      player.group.visible = false;
    } else {
      // block-body fallback (no animated people, e.g. safe mode): ride along as is
      this.blockParent = player.group.parent;
      this.riderMount.add(player.group);
      player.group.position.set(0, 0.2, 0);
      player.group.rotation.set(0, 0, 0);
      player.group.visible = true;
    }
    this.#place(0);
  }

  // get off on the kerb side (left of the bike), the bike stays parked
  dismount() {
    const p = this.player;
    this.riding = false;
    this.speed = 0;
    this.lean.rotation.z = 0;
    if (this.bones && this.rider) unpose(this.bones);
    if (p) {
      if (this.rider) p.group.add(this.rider.root);
      else if (this.blockParent) {
        this.blockParent.add(p.group);
        this.blockParent = null;
      }
      p.stamina = this.stamina;
      p.tired = this.tired;
      const lx = Math.cos(this.yaw); // rider's left (x east, z south world)
      const lz = -Math.sin(this.yaw);
      p.placeAt(this.x + lx * 0.9, this.z + lz * 0.9, this.yaw, this.y);
      p.group.visible = true;
    }
    this.rider = null;
    this.#place(0);
    this.save();
  }

  update(dt) {
    if (!this.riding) return;
    const input = this.input;
    const joy = input.joy;
    const locked = input.locked;
    let pedal = 0;
    let brake = 0;
    let steerIn = 0;
    if (!locked && joy && joy.active && joy.mag > 0.1) {
      // stick: up pedals, down brakes, sideways steers
      pedal = joy.y > 0.15 ? Math.min(1, joy.y * 1.4) : 0;
      brake = joy.y < -0.25 ? Math.min(1, -joy.y * 1.4) : 0;
      steerIn = -clamp(joy.x * 1.25, -1, 1);
    } else if (!locked) {
      pedal = input.down.has('gas') ? 1 : 0;
      brake = input.down.has('brake') ? 1 : 0;
      steerIn = (input.down.has('left') ? 1 : 0) - (input.down.has('right') ? 1 : 0);
    }
    const runHeld = !locked && (input.runHeld || input.isDown('boost'));
    if (runHeld && pedal < 0.5 && !brake) pedal = 1; // RUN alone pedals hard straight on

    // stamina (shared idea with running): sprint-pedal while it lasts
    this.sprinting = runHeld && pedal > 0 && !this.tired && this.stamina > 0;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      this.restT = 0;
      if (this.stamina === 0) this.tired = true;
    } else {
      this.restT += dt;
      if (this.restT > STAMINA_DELAY) this.stamina = Math.min(1, this.stamina + STAMINA_FILL * dt * (pedal === 0 ? 1.5 : 1));
      if (this.tired && this.stamina >= TIRED_UNTIL) this.tired = false;
    }
    input.paintStamina?.(this.stamina, this.tired);

    const onTar = !!this.surfRoad;
    const top = (this.sprinting ? BIKE_SPRINT : BIKE_CRUISE * pedal) * (onTar ? 1 : OFFROAD);
    let v = this.speed;
    if (pedal > 0 && v < top) v = Math.min(top, v + (this.sprinting ? SPRINT_ACCEL : ACCEL) * dt);
    else if (v > top) v = Math.max(top, v - (pedal > 0 ? 1.2 : COAST) * dt - (onTar ? 0 : 0.8 * dt));
    if (brake > 0) v = Math.max(0, v - BRAKE * brake * dt);
    // hills: downhill rolls faster, uphill slows (capped)
    v += 9.81 * Math.sin(this.slope || 0) * 0.35 * dt;
    v = clamp(v, 0, BIKE_SPRINT * 1.25);
    if (v < 0.02 && pedal === 0) v = 0;
    this.speed = v;

    // steering: tight at walking pace, gentle at speed
    this.steer += (steerIn - this.steer) * Math.min(1, dt * 8);
    const maxA = 0.62 / (1 + v / 5);
    const yawRate = (v / WHEELBASE) * Math.tan(this.steer * maxA);
    this.yaw += yawRate * dt;
    this.yawRate = yawRate;
    // knocks from traffic bleed off
    if (this.knockX || this.knockZ || this.spin) {
      this.yaw += this.spin * dt;
      const k = Math.max(0, 1 - dt * 4);
      this.knockX *= k;
      this.knockZ *= k;
      this.spin *= k;
      if (Math.abs(this.knockX) + Math.abs(this.knockZ) < 0.05) this.knockX = this.knockZ = 0;
      if (Math.abs(this.spin) < 0.01) this.spin = 0;
    }
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const px = this.x;
    const pz = this.z;
    this.x += (fx * v + this.knockX) * dt;
    this.z += (fz * v + this.knockZ) * dt;
    if (this.hf.signedCoastDistance(this.x, this.z) < 2) {
      this.x = px;
      this.z = pz;
      this.speed = 0;
    }
    const margin = 40;
    this.x = clamp(this.x, this.hf.minX + margin, this.hf.minX + (this.hf.cols - 1) * this.hf.cell - margin);
    this.z = clamp(this.z, this.hf.minZ + margin, this.hf.minZ + (this.hf.rows - 1) * this.hf.cell - margin);
    this.#collide();
    this.crankA += (v / (WHEEL_R * SCALE)) * dt * 0.42; // ~2.4:1 gearing
    this.#place(dt);
    this.#spin(dt);
    this.#pose(dt);
  }

  #collide() {
    const hit = this.city.buildings ? this.city.buildings.collide(this.x, this.z, RADIUS) : null;
    if (hit) {
      this.x = hit.x;
      this.z = hit.z;
      this.speed *= 0.3;
    }
    const nearby = this.city.hash.query(this.x, this.z, 6);
    for (const c of nearby) {
      const dx = this.x - c.x;
      const dz = this.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = c.r + RADIUS;
      if (d >= minD || d === 0) continue;
      const push = (minD - d) / d;
      this.x += dx * push;
      this.z += dz * push;
      this.speed *= 0.5;
    }
  }

  #place(dt) {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const prev = this.y;
    const surf = this.roads.surfaceAt(this.x, this.z, prev, this.surfRoad, fx, fz);
    if (surf.pc) this.surfRoad = surf.pc.road;
    else if (!surf.onRoad) this.surfRoad = null;
    const t = surf.y;
    if (prev === null || !dt) this.y = t;
    else this.y = prev + clamp(t - prev, -6 * dt, Math.max(0.3, 8 * dt));
    const base = this.y;
    const hF = this.roads.surfaceAt(this.x + fx * 0.6, this.z + fz * 0.6, base).y;
    const hB = this.roads.surfaceAt(this.x - fx * 0.6, this.z - fz * 0.6, base).y;
    this.slope = clamp(Math.atan2(hB - hF, 1.2), -0.3, 0.3);
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = this.yaw;
    this.group.rotation.x = this.slope * 0.8;
    if (this.riding) {
      // lean into the turn (centripetal), a little wobble at walking pace
      const want = clamp(-(this.yawRate || 0) * this.speed * 0.09, -0.4, 0.4);
      this.lean.rotation.z += (want - this.lean.rotation.z) * Math.min(1, (dt || 0) * 6);
      this.model.stand.visible = false;
    } else {
      this.lean.rotation.z = 0.12; // resting on the kickstand
      this.model.stand.visible = true;
    }
  }

  #spin(dt) {
    const M = this.model;
    const a = (this.speed * dt) / (WHEEL_R * SCALE);
    M.rearWheel.rotation.x += a;
    M.frontWheel.children[0].rotation.x += a;
    M.frontWheel.children[1].rotation.x += a;
    M.fork.rotation.y = this.steer * 0.45 / (1 + this.speed / 4);
    M.crank.rotation.x = this.crankA;
  }

  // seated pose on top of the Idle clip: hips on the saddle, hands on the
  // grips, feet on the pedals (both follow the crank)
  #pose(dt) {
    const hu = this.rider;
    if (!hu) return;
    hu.update(dt);
    const B = this.bones;
    if (!B || !B.thighL || !B.footL || !B.wristL) return;
    const root = hu.obj;
    if (!this.cal) {
      root.updateMatrixWorld(true);
      this.cal = calibrate(B);
      B.footL.userData.bp = B.footL.position.clone();
      B.footR.userData.bp = B.footR.position.clone();
    }
    const C = this.cal;
    const M = this.model;
    restore(B);
    const lean = 0.32 + Math.min(0.12, this.speed * 0.015);
    turn(B.abdomen || B.torso, root, AX_X, lean);
    turn(B.neck, root, AX_X, -lean * 0.9);
    M.group.updateMatrixWorld(true);
    // knees forward, elbows down and out
    _f.set(0, 0, 1).applyQuaternion(this.group.getWorldQuaternion(_qr));
    for (let s = 0; s < 2; s++) {
      const L = s === 0;
      const foot = L ? B.footL : B.footR;
      // ankle a little above the pedal
      _t.copy(L ? PEDAL_L : PEDAL_R);
      M.crank.localToWorld(_t);
      _t.y += 0.07;
      this._ank = this._ank || new THREE.Vector3();
      this._ank.copy(_t);
      chain(L ? B.thighL : B.thighR, L ? B.shinL : B.shinR, (L ? C.thighL : C.thighR).axis, (L ? C.shinL : C.shinR).axis, (L ? C.thighL : C.thighR).len, (L ? C.shinL : C.shinR).len, this._ank, _f);
      // the rig's foot is an IK target under Root: put it at the ankle
      foot.parent.updateWorldMatrix(true, false);
      _t.copy(this._ank);
      foot.parent.worldToLocal(_t);
      foot.position.copy(_t);
      // arms: shoulder -> grip, elbows bend down and outward
      _t.copy(L ? GRIP_L : GRIP_R);
      M.fork.localToWorld(_t);
      this._grip = this._grip || new THREE.Vector3();
      this._grip.copy(_t);
      this._hint = this._hint || new THREE.Vector3();
      this._hint.set(L ? 0.6 : -0.6, -1, -0.4).applyQuaternion(_qr);
      chain(L ? B.armL : B.armR, L ? B.foreL : B.foreR, (L ? C.armL : C.armR).axis, (L ? C.foreL : C.foreR).axis, (L ? C.armL : C.armR).len, (L ? C.foreL : C.foreR).len, this._grip, this._hint);
    }
    remember(B);
  }
}
