// Keyboard + touch input with analog driving controls.
//
// Touch: a steering wheel you turn with your finger (900° lock-to-lock, with
// finger rotation scaled 2.5x so ±180° of finger travel reaches full lock),
// self-centring when released; analog accelerator / brake pedals (press lower
// on the pedal for more); a D / R / N gear selector.
// Keyboard: W/S/A/D (or arrows) ramp the same analog values smoothly.
//
// Analog outputs read by the vehicle every frame:
//   steer    -1..1  (+ = left)
//   throttle  0..1
//   brake     0..1
//   gear     'D' | 'R' | 'N'

const KEY_ACTIONS = {
  KeyW: 'gas',
  ArrowUp: 'gas',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  Space: 'handbrake'
};

const PRESS_ACTIONS = {
  KeyC: 'camera',
  KeyH: 'horn',
  KeyF: 'interact',
  KeyE: 'interact',
  Enter: 'interact',
  KeyV: 'cycle',
  KeyG: 'destination',
  KeyX: 'clearDest',
  KeyR: 'gearR',
  KeyN: 'gearN'
};

export const WHEEL_LOCK_DEG = 450; // ±450° = 900° lock-to-lock
const FINGER_GAIN = 2.5; // wheel degrees per finger degree
const KEY_STEER_RATE = 620; // °/s when steering with keys

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Input {
  constructor() {
    this.down = new Set();
    this.queue = [];
    this.stick = { x: 0, y: 0, active: false }; // legacy (unused by the wheel)

    // analog state
    this.wheelDeg = 0; // visual wheel angle, + = clockwise (right)
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.gear = 'D';
    this.wheelHeld = false;
    this.pedal = { gas: 0, brake: 0 }; // raw touch targets 0..1
    this.pedalHeld = { gas: false, brake: false };
    this.lastSource = 'keys';
    this.gearListeners = [];

    addEventListener('keydown', (e) => {
      const press = PRESS_ACTIONS[e.code];
      if (press && !e.repeat) {
        if (press === 'gearR') this.setGear(this.gear === 'R' ? 'D' : 'R');
        else if (press === 'gearN') this.setGear(this.gear === 'N' ? 'D' : 'N');
        else this.queue.push(press);
      }
      const action = KEY_ACTIONS[e.code];
      if (action) {
        this.down.add(action);
        this.lastSource = 'keys';
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => {
      const action = KEY_ACTIONS[e.code];
      if (action) this.down.delete(action);
    });
    addEventListener('blur', () => this.#releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.#releaseAll();
    });

    for (const btn of document.querySelectorAll('#touch .tbtn')) {
      
      const action = btn.dataset.action;
      const press = (e) => {
        e.preventDefault();
        if (btn.dataset.press === 'true') {
          this.queue.push(action);
          btn.classList.add('active');
          setTimeout(() => btn.classList.remove('active'), 140);
          return;
        }
        this.down.add(action);
        btn.classList.add('active');
      };
      const release = (e) => {
        e.preventDefault();
        if (btn.dataset.press === 'true') return;
        this.down.delete(action);
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    }

    for (const button of document.querySelectorAll('.gear-btn')) {
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.lastSource = 'touch';
        this.setGear(button.dataset.gear);
      });
    }

    this.wheelEl = document.getElementById('t-wheel');
    this.wheelInner = document.getElementById('t-wheel-inner');
    this.#setupWheel();
    this.#setupPedal('gas', document.getElementById('t-gas'));
    this.#setupPedal('brake', document.getElementById('t-brake'));
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setGear(g) {
    if (g !== 'D' && g !== 'R' && g !== 'N') return;
    this.gear = g;
    for (const item of document.querySelectorAll('.gear-btn')) item.classList.toggle('active', item.dataset.gear === g);
    for (const fn of this.gearListeners) fn(g);
  }

  #releaseAll() {
    this.down.clear();
    this.wheelHeld = false;
    this.pedalHeld.gas = this.pedalHeld.brake = false;
    this.pedal.gas = this.pedal.brake = 0;
  }

  #setupWheel() {
    const el = this.wheelEl;
    if (!el) return;
    let pid = null;
    let lastAng = 0;
    let lastX = 0;
    const polar = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      return { ang: Math.atan2(dy, dx), rad: Math.hypot(dx, dy) / (r.width / 2), dx, R: r.width / 2 };
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      el.setPointerCapture?.(pid);
      const p = polar(e);
      lastAng = p.ang;
      lastX = e.clientX;
      this.wheelHeld = true;
      this.lastSource = 'touch';
      el.classList.add('active');
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      const p = polar(e);
      let dDeg;
      if (p.rad < 0.22) {
        // too close to the hub for a stable angle: use sideways drag instead
        dDeg = ((e.clientX - lastX) / p.R) * 70;
      } else {
        let d = p.ang - lastAng;
        if (d > Math.PI) d -= Math.PI * 2;
        else if (d < -Math.PI) d += Math.PI * 2;
        dDeg = (d * 180) / Math.PI;
      }
      lastAng = p.ang;
      lastX = e.clientX;
      this.wheelDeg = clamp(this.wheelDeg + dDeg * FINGER_GAIN, -WHEEL_LOCK_DEG, WHEEL_LOCK_DEG);
    });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.wheelHeld = false;
      el.classList.remove('active');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  #setupPedal(name, el) {
    if (!el) return;
    let pid = null;
    const read = (e) => {
      const r = el.getBoundingClientRect();
      // touching the top of the pedal = light press, lower = deeper press
      const t = (e.clientY - r.top) / (r.height * 0.82);
      this.pedal[name] = clamp(0.12 + 0.88 * t, 0.12, 1);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      el.setPointerCapture?.(pid);
      this.pedalHeld[name] = true;
      this.lastSource = 'touch';
      el.classList.add('active');
      read(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      read(e);
    });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.pedalHeld[name] = false;
      this.pedal[name] = 0;
      el.classList.remove('active');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    this['_' + name + 'El'] = el;
  }

  // Call once per frame before the vehicle update. `speed` is the signed
  // vehicle speed in m/s (used for speed-dependent self-centring).
  update(dt, speed = 0) {
    const keyL = this.down.has('left');
    const keyR = this.down.has('right');
    const v = Math.abs(speed);

    // --- steering wheel angle
    if (keyL || keyR) {
      const target = (keyR ? WHEEL_LOCK_DEG : 0) - (keyL ? WHEEL_LOCK_DEG : 0);
      const rate = KEY_STEER_RATE * (target === 0 || Math.sign(target) !== Math.sign(this.wheelDeg) ? 1.6 : 1);
      this.wheelDeg += clamp(target - this.wheelDeg, -rate * dt, rate * dt);
    } else if (!this.wheelHeld) {
      // self-centring: caster return gets stronger with speed
      const k = 4.5 + Math.min(v, 30) * 0.18; // 1/s
      const minRate = 90 + v * 6; // °/s floor so it fully settles
      const step = Math.max(Math.abs(this.wheelDeg) * k, minRate) * dt;
      if (Math.abs(this.wheelDeg) <= step) this.wheelDeg = 0;
      else this.wheelDeg -= Math.sign(this.wheelDeg) * step;
    }
    // smooth (anti-jitter) steering output, + = left
    const steerTarget = -this.wheelDeg / WHEEL_LOCK_DEG;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 16);
    if (Math.abs(this.steer) < 0.002 && steerTarget === 0) this.steer = 0;

    // --- keyboard convenience: hold S at a standstill to reverse, W to go forward
    const keys = this.lastSource === 'keys';
    if (keys && v < 0.3) {
      if (this.down.has('brake') && !this.down.has('gas') && this.gear === 'D') this.setGear('R');
      else if (this.down.has('gas') && this.gear === 'R') this.setGear('D');
    }
    // in R on the keyboard, S means "go back" and W brakes
    const swap = keys && this.gear === 'R';
    const gasKey = this.down.has(swap ? 'brake' : 'gas');
    const brakeKey = this.down.has(swap ? 'gas' : 'brake');

    // --- pedals (rate-limited so throttle and brake build up gradually)
    const gasTarget = gasKey ? 1 : this.pedal.gas;
    const brakeTarget = brakeKey ? 1 : this.pedal.brake;
    this.throttle += clamp(gasTarget - this.throttle, -5 * dt, 2.2 * dt);
    this.brake += clamp(brakeTarget - this.brake, -7 * dt, 3.5 * dt);
    if (this.throttle < 0.003) this.throttle = 0;
    if (this.brake < 0.003) this.brake = 0;

    this.#paint();
  }

  #paint() {
    if (this.wheelInner) {
      const deg = Math.round(this.wheelDeg * 10) / 10;
      if (deg !== this._paintedDeg) {
        this.wheelInner.style.transform = `rotate(${deg}deg)`;
        this._paintedDeg = deg;
      }
    }
    for (const name of ['gas', 'brake']) {
      const el = this['_' + name + 'El'];
      if (!el) continue;
      const val = name === 'gas' ? this.throttle : this.brake;
      const q = Math.round(val * 50) / 50;
      if (q !== el._q) {
        el._q = q;
        el.style.setProperty('--press', q.toFixed(2));
      }
    }
  }

  isDown(action) {
    if (this.down.has(action)) return true;
    // analog controls also drive on-foot movement and generic checks
    if (action === 'gas') return this.pedal.gas > 0.1;
    if (action === 'brake') return this.pedal.brake > 0.1;
    if (action === 'left') return this.wheelDeg < -40;
    if (action === 'right') return this.wheelDeg > 40;
    return false;
  }

  takePressed(action) {
    const i = this.queue.indexOf(action);
    if (i === -1) return false;
    this.queue.splice(i, 1);
    return true;
  }
}
