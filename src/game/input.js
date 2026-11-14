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
  KeyX: 'clearDest'
};

export class Input {
  constructor() {
    this.down = new Set();
    this.queue = [];
    this.stick = { x: 0, y: 0, active: false };
    this.gear = 'D';

    for (const button of document.querySelectorAll('.gear-btn')) {
      button.addEventListener('click', () => {
        this.gear = button.dataset.gear;
        for (const item of document.querySelectorAll('.gear-btn')) item.classList.toggle('active', item === button);
      });
    }

    addEventListener('keydown', (e) => {
      const press = PRESS_ACTIONS[e.code];
      if (press && !e.repeat) this.queue.push(press);
      const action = KEY_ACTIONS[e.code];
      if (action) {
        this.down.add(action);
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => {
      const action = KEY_ACTIONS[e.code];
      if (action) this.down.delete(action);
    });
    addEventListener('blur', () => {
      this.down.clear();
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.active = false;
      const wheel = document.getElementById('t-wheel-inner');
      if (wheel) wheel.style.transform = '';
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

    this.#setupStick();
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #setupStick() {
    const stick = document.getElementById('t-wheel');
    const wheel = document.getElementById('t-wheel-inner');
    if (!stick || !wheel) return;
    let pointerId = null;

    const update = (e) => {
      const rect = stick.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = (e.clientX - cx) / (rect.width / 2);
      dx = Math.max(-1, Math.min(1, dx));
      this.stick.x = dx;
      this.stick.y = 0;
      wheel.style.transform = `rotate(${dx * 145}deg)`;
    };

    const release = () => {
      pointerId = null;
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.active = false;
      wheel.style.transform = '';
      stick.classList.remove('active');
    };

    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointerId = e.pointerId;
      this.stick.active = true;
      stick.classList.add('active');
      stick.setPointerCapture?.(e.pointerId);
      update(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (pointerId !== e.pointerId) return;
      e.preventDefault();
      update(e);
    });
    stick.addEventListener('pointerup', (e) => {
      if (pointerId !== e.pointerId) return;
      e.preventDefault();
      release();
    });
    stick.addEventListener('pointercancel', release);
    stick.addEventListener('pointerleave', (e) => {
      if (pointerId === e.pointerId) release();
    });
  }

  isDown(action) {
    if (this.down.has(action)) return true;
    const s = this.stick;
    if (action === 'left') return s.x < -0.12;
    if (action === 'right') return s.x > 0.12;
        return false;
  }

  takePressed(action) {
    const i = this.queue.indexOf(action);
    if (i === -1) return false;
    this.queue.splice(i, 1);
    return true;
  }
}
