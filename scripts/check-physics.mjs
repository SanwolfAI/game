// Driving physics check (npm test): braking distance from 100 km/h, corner
// radius at town speeds, highway calmness and steering response, run on the
// same maths the game uses (src/game/carPhysics.js + input constants).
import {
  physicsFor, longStep, yawFor, pedalStep, brakePressure, maxSteerAngle,
  THROTTLE_UP, THROTTLE_DOWN, BRAKE_DOWN, STEER_RESPONSE
} from '../src/game/carPhysics.js';

const SPECS = {
  gusheshe: { id: 'gusheshe', handling: 1.55 },
  quantum: { id: 'quantum', handling: 1.35 },
  polo: { id: 'polo', handling: 1.7 }
};
const FINGER_GAIN = 4.2; // keep in step with src/game/input.js
const WHEEL_LOCK_DEG = 300;
const DT = 1 / 60;

// Full chain: driver was flat on the gas at 100 km/h, then hits the brake
// with pedal pressure `target` (pedal + vehicle update, like the game loop).
function brakeRun(spec, target, dt = DT) {
  const ph = physicsFor(spec);
  let v = 100 / 3.6, x = 0, t = 0, thr = 1, br = 0;
  while (v > 0 && t < 20) {
    br = pedalStep(br, target, dt, Infinity, BRAKE_DOWN);
    thr = br > 0.1 ? 0 : pedalStep(thr, 0, dt, THROTTLE_UP, THROTTLE_DOWN);
    const vn = longStep(ph, v, { throttle: thr, brake: br }, dt);
    x += ((v + vn) / 2) * dt;
    v = vn;
    t += dt;
  }
  return { t: +t.toFixed(2), m: +x.toFixed(1) };
}

// Tightest steady circle at a speed (full lock), and the wheel needed for a
// given radius.
function radiusAt(spec, kmh, steer = 1) {
  const ph = physicsFor(spec);
  const v = kmh / 3.6;
  const { yawRate } = yawFor(ph, v, steer);
  return +(v / yawRate).toFixed(1);
}
function steerFor(spec, kmh, radius) {
  for (let s = 0.01; s <= 1.0001; s += 0.01) if (radiusAt(spec, kmh, s) <= radius * 1.002) return +s.toFixed(2);
  return null;
}

// Drive a 90° corner of radius R at a held speed, steering from the road's
// curvature with a driver reaction (step input after the corner starts):
// how far off the line does the car end up?
function cornerDrift(spec, kmh, R) {
  const ph = physicsFor(spec);
  const v = kmh / 3.6;
  const need = steerFor(spec, kmh, R) ?? 1;
  let steer = 0, yaw = 0, x = 0, z = 0, t = 0, maxErr = 0;
  // corner: circle centred at (R, 0) entered heading +z from the origin... use
  // polar error = |dist to centre - R|
  const cx = -R, cz = 0;
  while (yaw < Math.PI / 2 && t < 10) {
    steer += (need - steer) * Math.min(1, DT * STEER_RESPONSE);
    const { yawRate } = yawFor(ph, v, steer);
    yaw += yawRate * DT;
    x += -Math.sin(yaw) * v * DT; // turning left
    z += Math.cos(yaw) * v * DT;
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(x - cx, z - cz) - R));
    t += DT;
  }
  return +maxErr.toFixed(2);
}

// Touch: thumb turns the wheel 60°; time for the car's steering to get to
// 90 % of where it is going.
function steerLag() {
  const target = Math.min(1, (60 * FINGER_GAIN) / WHEEL_LOCK_DEG);
  let s1 = 0, s2 = 0, t = 0;
  while (s2 < 0.9 * target && t < 3) {
    s1 += (target - s1) * Math.min(1, DT * STEER_RESPONSE * 1.5);
    s2 += (s1 - s2) * Math.min(1, DT * STEER_RESPONSE);
    t += DT;
  }
  return { target: +target.toFixed(2), t90: +t.toFixed(2) };
}

const G = SPECS.gusheshe;
const r = {
  brakeFull: brakeRun(G, 1),
  brakeFull20fps: brakeRun(G, 1, 1 / 20),
  brakeTouchMid: brakeRun(G, brakePressure(0.5)),
  brakeTouchTopEdge: brakeRun(G, brakePressure(0)),
  brakeQuantum: brakeRun(SPECS.quantum, 1),
  radius35: radiusAt(G, 35),
  radius40: radiusAt(G, 40),
  radius50: radiusAt(G, 50),
  radius40Quantum: radiusAt(SPECS.quantum, 40),
  wheelFor15mAt35: steerFor(G, 35, 15),
  wheelFor15mAt40Quantum: steerFor(SPECS.quantum, 40, 15),
  cornerDrift15mAt35: cornerDrift(G, 35, 15),
  lockDeg35: +((maxSteerAngle(35 / 3.6) * 180) / Math.PI).toFixed(1),
  lockDeg120: +((maxSteerAngle(120 / 3.6) * 180) / Math.PI).toFixed(1),
  wheelToGripAt120: steerFor(G, 120, (120 / 3.6) ** 2 / physicsFor(G).grip),
  fingerDegFullLock: Math.round(WHEEL_LOCK_DEG / FINGER_GAIN),
  steerLag: steerLag()
};
console.log('Physics:', JSON.stringify(r));

const fails = [];
const want = (ok, msg) => { if (!ok) fails.push(msg); };
want(r.brakeFull.t >= 2.6 && r.brakeFull.t <= 3.3, `100-0 full brake time ${r.brakeFull.t} s (want ~3 s)`);
want(r.brakeFull.m >= 35 && r.brakeFull.m <= 45, `100-0 full brake distance ${r.brakeFull.m} m (want ~40 m)`);
want(Math.abs(r.brakeFull20fps.m - r.brakeFull.m) < 3, `braking changes with frame rate (${r.brakeFull20fps.m} m at 20 fps)`);
want(r.brakeTouchMid.m <= 45, `touch brake mid-pedal stops in ${r.brakeTouchMid.m} m (want full brake)`);
want(r.brakeTouchTopEdge.m > r.brakeFull.m + 10, 'a light touch on the pedal top should still be gentler');
want(r.brakeQuantum.m <= 50, `Quantum 100-0 ${r.brakeQuantum.m} m`);
want(r.wheelFor15mAt35 !== null && r.wheelFor15mAt35 <= 0.8, `15 m corner at 35 km/h needs wheel ${r.wheelFor15mAt35}`);
want(r.radius40 <= 15, `tightest circle at 40 km/h ${r.radius40} m (want <= 15)`);
want(r.wheelFor15mAt40Quantum !== null, 'Quantum cannot take a 15 m corner at 40 km/h');
want(r.cornerDrift15mAt35 < 1.5, `runs ${r.cornerDrift15mAt35} m wide in a 15 m corner at 35 km/h`);
want(r.wheelToGripAt120 >= 0.17, `twitchy at 120 km/h: ${r.wheelToGripAt120} of the wheel already uses all the grip`);
want(r.steerLag.t90 <= 0.15, `steering lag ${r.steerLag.t90} s`);
want(r.fingerDegFullLock <= 80, `full lock needs ${r.fingerDegFullLock}° of thumb travel`);
if (fails.length) {
  console.error('Physics check FAILED:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('Physics OK');
