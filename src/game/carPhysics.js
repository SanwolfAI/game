// Pure driving maths shared by the player car (vehicle.js), the touch /
// keyboard input (input.js) and the physics check (scripts/check-physics.mjs).
// No DOM and no three.js, so it runs in node.
//
// Tuned 24 Nov 2026 (Bheko: "the brakes take too much time to brake; the car
// does not turn fast, or it goes out of the road to turn"):
//  - brakes: ABS-style 9 m/s² at full pedal on dry tar (8.3 for the heavy
//    taxi / van), brake pressure is applied at once (no ramp) and kills the
//    throttle, and the touch pedal reaches full pressure halfway down
//  - steering: one quick smoothing stage, a bit more grip (~1.05 g) and a
//    slower speed falloff in town, tyre scrub when you ask for more turn than
//    the tyres can give so the car slows into the corner instead of running wide

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// a0: launch acceleration (m/s²), vk: speed where engine power starts to limit
// thrust, vmax: top speed (m/s). 0-100 / top: Gusheshe ~6.7 s / 226 km/h,
// Polo ~8.5 s / 187, Hilux ~9.3 s / 180, SAPS ~7.4 s / 201, Quantum ~12 s / 151.
const PHYS = {
  gusheshe: { a0: 7.2, vk: 30, vmax: 72, mass: 1200 },
  quantum: { a0: 5.2, vk: 22, vmax: 50, mass: 2300 },
  polo: { a0: 6.2, vk: 26, vmax: 62, mass: 1100 },
  hilux: { a0: 5.8, vk: 24, vmax: 58, mass: 1900 },
  saps: { a0: 6.6, vk: 28, vmax: 66, mass: 2100 }
};

// full-pedal deceleration with ABS on dry tar (m/s²)
export const BRAKE_CAR = 9.0;
export const BRAKE_HEAVY = 8.3;
// lateral grip at handling 1.5 (m/s², ~1.05 g: a little arcade help so a
// 15 m city corner goes at 40 km/h)
export const GRIP_BASE = 10.3;
export const LOCK_DEG = 38; // front wheels at full lock, parked

export function physicsFor(spec) {
  const p = PHYS[spec.id] || { a0: 3.8, vk: 16, vmax: spec.max, mass: 1500 };
  const vk = p.vk;
  const vmax = p.vmax;
  const roll = 0.13;
  // drag coefficient so full power balances resistance at vmax
  const drag = Math.max(0.00005, (p.a0 * (vk / vmax) - roll) / (vmax * vmax));
  const heavy = p.mass > 2000;
  return {
    a0: p.a0,
    vk,
    vmax,
    vmaxBoost: vmax * 1.25,
    vmaxR: 9,
    roll,
    drag,
    brake: heavy ? BRAKE_HEAVY : BRAKE_CAR,
    mass: p.mass,
    wheelbase: heavy ? 3.0 : 2.55,
    grip: GRIP_BASE * ((spec.handling || 1.5) / 1.5)
  };
}

// Front-wheel angle at full lock for a speed (m/s): 38° parked, ~23° at
// 35 km/h, ~12° at 80 km/h, ~7° at 120 km/h so the motorway stays calm
// (on the old 38°/(1 + v/20) curve 8 % of the wheel used all the grip at
// 120 km/h; now it takes about 19 %).
export function maxSteerAngle(speedAbs) {
  const s = speedAbs / 24;
  return (LOCK_DEG * Math.PI) / 180 / (1 + s + 1.5 * s * s);
}

// Yaw rate (rad/s) from the bicycle model, capped by tyre grip. `scrub` is
// the extra deceleration (m/s²) when the driver asks for more turn than the
// tyres can give: the front tyres scrub speed off, like a real car pushing
// wide, which tightens the line instead of sailing straight off the road.
export function yawFor(ph, speed, steer, handbrake = false) {
  const speedAbs = Math.abs(speed);
  const delta = steer * maxSteerAngle(speedAbs);
  let yawRate = (speed / ph.wheelbase) * Math.tan(delta);
  const grip = ph.grip * (handbrake && speedAbs > 5 ? 1.7 : 1);
  const maxYaw = grip / Math.max(speedAbs, 1);
  let scrub = 0;
  if (Math.abs(yawRate) > maxYaw) {
    const over = Math.abs(yawRate) / maxYaw - 1;
    scrub = Math.min(3.5, over * 2.2);
    yawRate = Math.sign(yawRate) * maxYaw;
  }
  return { yawRate, delta, scrub };
}

// Steering smoothing (one stage only; the input already holds the wheel angle)
export const STEER_RESPONSE = 30; // 1/s

// Pedal build-up rates (per second). Brake goes on at once: no ramp.
export const THROTTLE_UP = 2.2;
export const THROTTLE_DOWN = 12;
export const BRAKE_DOWN = 10;

export function pedalStep(cur, target, dt, up, down) {
  const next = up === Infinity && target > cur ? target : cur + clamp(target - cur, -down * dt, up * dt);
  return next < 0.003 ? 0 : next;
}

// Touch brake pedal: where the thumb lands, 0 = top edge .. 1 = bottom edge.
// Top edge = 50 % (a gentle slow-down), full pressure from 45 % down.
export function brakePressure(t) {
  return clamp(0.5 + (0.5 * t) / 0.45, 0.5, 1);
}

// One longitudinal step (m/s). Returns the new signed speed.
export function longStep(ph, v, { throttle = 0, brake = 0, gear = 'D', boost = false, handbrake = false, slope = 0, scrub = 0 }, dt) {
  const dir = gear === 'D' ? 1 : gear === 'R' ? -1 : 0;
  // the brake beats the accelerator (brake override, as on modern cars)
  if (brake > 0.1) throttle = 0;
  const vmax = dir < 0 ? ph.vmaxR : boost ? ph.vmaxBoost : ph.vmax;
  const a0 = (dir < 0 ? ph.a0 * 0.7 : ph.a0) * (boost && dir > 0 ? 1.3 : 1);
  let accel = 0;
  if (dir !== 0) {
    const vAlong = v * dir;
    const powerLimit = Math.min(1, ph.vk / Math.max(vAlong, 0.1));
    const headroom = vAlong > vmax ? 0 : 1;
    let aEng = throttle * a0 * powerLimit * headroom;
    // automatic gearbox idle creep (walking pace) when off both pedals
    if (throttle < 0.05 && brake < 0.05 && !handbrake && vAlong < 1.4) aEng += 0.7 * (1 - Math.max(vAlong, 0) / 1.4);
    // engine braking when lifting off
    if (throttle < 0.05 && vAlong > 2) aEng -= 0.32 + 0.011 * vAlong;
    accel += aEng * dir;
  }
  const res = ph.roll + ph.drag * v * v;
  if (Math.abs(v) > 0.01) accel -= Math.sign(v) * res;
  // slope > 0 = nose down, so downhill speeds you up
  accel += 9.81 * Math.sin(slope) * 0.6;
  let vNew = v + accel * dt;
  // brakes / handbrake / tyre scrub oppose motion, never push backwards
  const decel = brake * ph.brake + (handbrake ? 5.5 : 0) + scrub;
  if (decel > 0) {
    const dv = decel * dt;
    if (Math.abs(vNew) <= dv) vNew = 0;
    else vNew -= Math.sign(vNew) * dv;
  }
  if (Math.abs(vNew) < 0.05 && (dir === 0 || brake > 0.05) && throttle < 0.05) vNew = 0;
  return clamp(vNew, -ph.vmaxR * 1.05, (boost ? ph.vmaxBoost : ph.vmax) * 1.02);
}
