// Steering choice, like most phone driving games (Car Parking Multiplayer,
// Real Driving School, Extreme Car Driving Simulator): steering WHEEL (the
// default), left / right BUTTONS, or TILT the phone like a wheel.
//
// No change inside input.js: buttons press the same 'left' / 'right' actions
// the keyboard uses (smooth ramp + self-centring), and tilt writes the wheel
// angle just before Input.update() runs each frame.
import { prefs, setPref, el } from './prefs.js';

const LOCK = 300; // WHEEL_LOCK_DEG in input.js
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

let input = null;
let btns = null;
let tilt = { raw: 0, smooth: 0, ok: false, listening: false, seen: 0 };

function screenAngle() {
  const a = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null) return;
  let x = g.x;
  let y = g.y;
  if (isIOS) {
    x = -x;
    y = -y;
  }
  if (Math.hypot(x, y) < 2) return; // phone lying flat: keep the last angle
  const a = screenAngle();
  let th;
  if (a === 90) th = Math.atan2(y, x);
  else if (a === 270) th = Math.atan2(-y, -x);
  else if (a === 180) th = Math.atan2(x, -y);
  else th = Math.atan2(-x, y);
  tilt.raw = (th * 180) / Math.PI;
  tilt.ok = true;
  tilt.seen = performance.now();
}

function listenTilt() {
  if (tilt.listening) return;
  tilt.listening = true;
  addEventListener('devicemotion', onMotion);
}

// iOS asks for motion permission on a tap; Android WebView just works
export async function askTiltPermission() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') return false;
    }
  } catch {
    return false;
  }
  listenTilt();
  return true;
}

export function tiltWorking() {
  return tilt.ok && performance.now() - tilt.seen < 2000;
}

export function centreTilt() {
  if (tilt.ok) {
    setPref('tiltCentre', Math.round(tilt.raw * 10) / 10);
    tilt.smooth = 0;
  }
}

export function setControlMode(mode) {
  if (!['wheel', 'buttons', 'tilt'].includes(mode)) mode = 'wheel';
  setPref('controls', mode);
  const b = document.body.classList;
  b.toggle('ctl-wheel', mode === 'wheel');
  b.toggle('ctl-buttons', mode === 'buttons');
  b.toggle('ctl-tilt', mode === 'tilt');
  if (mode === 'tilt') listenTilt();
  if (input && mode !== 'tilt') input.wheelHeld = false;
}

function makeButtons() {
  const touch = document.getElementById('touch');
  if (!touch) return;
  btns = el('div', '', '');
  btns.id = 'izk-steer-btns';
  const left = el('div', 'izk-sbtn', '<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg>');
  const right = el('div', 'izk-sbtn', '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>');
  left.setAttribute('aria-label', 'Steer left');
  right.setAttribute('aria-label', 'Steer right');
  const horn = el('div', 'izk-shorn', '<svg viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/></svg>');
  horn.setAttribute('aria-label', 'Horn');
  btns.append(left, right, horn);
  touch.appendChild(btns);
  const hold = (node, action) => {
    let pid = null;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      try {
        node.setPointerCapture(pid);
      } catch {}
      input?.down.add(action);
      node.classList.add('on');
    });
    const up = (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      input?.down.delete(action);
      node.classList.remove('on');
    };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('lostpointercapture', up);
  };
  hold(left, 'left');
  hold(right, 'right');
  horn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input?.queue.push('horn');
    horn.classList.add('on');
    setTimeout(() => horn.classList.remove('on'), 160);
  });
}

// per-frame work that runs just before Input.update (cheap: a few numbers)
function preUpdate(dt) {
  if (prefs().controls !== 'tilt' || !input || input.locked || !tilt.ok) {
    if (input && input._izkTilt) {
      input.wheelHeld = false;
      input._izkTilt = false;
    }
    return;
  }
  // keyboard steering still wins on a desktop
  if (input.down.has('left') || input.down.has('right')) return;
  let d = tilt.raw - prefs().tiltCentre;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const dz = 2; // small dead zone so a steady hand drives straight
  d = Math.abs(d) < dz ? 0 : d - Math.sign(d) * dz;
  const target = clamp(d / prefs().tiltRange, -1, 1);
  tilt.smooth += (target - tilt.smooth) * Math.min(1, dt * 12);
  input.wheelDeg = tilt.smooth * LOCK;
  input.wheelHeld = true;
  input._izkTilt = true;
}

export function setupControls(inp) {
  input = inp;
  makeButtons();
  const orig = input.update.bind(input);
  input.update = (dt, speed) => {
    try {
      preUpdate(dt);
    } catch {}
    return orig(dt, speed);
  };
  setControlMode(prefs().controls);
}
