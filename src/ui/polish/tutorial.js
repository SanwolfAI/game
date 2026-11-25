// First-time tutorial: teach by doing (instruction -> action -> feedback ->
// reward), one control at a time, skippable. A glowing ring points at the
// control. Each step finishes by itself when you do the thing.
import { prefs, setPref, el, rand } from './prefs.js';
import { haptic } from './haptics.js';

const coarse = () => matchMedia('(pointer: coarse)').matches;

function steps() {
  const mode = prefs().controls;
  const touch = coarse();
  const steerText = !touch
    ? 'Steer with A and D (or the arrow keys).'
    : mode === 'buttons'
      ? 'Steer: hold ◀ or ▶.'
      : mode === 'tilt'
        ? 'Steer: turn your phone like a steering wheel.'
        : 'Steer: put your thumb on the wheel and turn it.';
  const steerTarget = mode === 'buttons' ? '#izk-steer-btns' : mode === 'tilt' ? null : '#t-wheel';
  return [
    {
      id: 'car',
      text: 'Get in your car: walk to it and tap the car button.',
      target: '#t-act',
      skipIf: (g) => g.inVehicle,
      done: (g) => g.inVehicle
    },
    { id: 'steer', text: steerText, target: steerTarget, done: (g) => Math.abs(g.steer) > 0.3, hold: 0.35 },
    { id: 'gas', text: touch ? 'Press GAS (right side) to drive. Press lower on it for more.' : 'Press W to drive.', target: '#t-gas', done: (g) => g.kmh > 15 },
    { id: 'brake', text: touch ? 'Now press BRAKE to stop.' : 'Press S to brake and stop.', target: '#t-brake', done: (g) => g.kmh < 3 && g.brake > 0.2 },
    { id: 'gear', text: touch ? 'Gears: tap R to reverse, then D to drive again.' : 'Hold S when stopped to reverse.', target: '#t-gear', done: (g) => g.gear === 'R', next: true },
    { id: 'map', text: 'Tap the little map to pick a place. The GPS arrow shows the way.', target: '#map-box', next: true, done: () => false },
    { id: 'end', text: 'You are ready! Taxi ranks pay fares, the garage changes your look, and a reward waits every day.', end: true }
  ];
}

export class Tutorial {
  constructor({ getState, pay }) {
    this.getState = getState;
    this.pay = pay;
    this.card = el('div', 'izk-tut');
    this.ring = el('div', 'izk-ring');
    this.card.style.display = this.ring.style.display = 'none';
    document.body.append(this.ring, this.card);
    this.active = false;
  }

  start() {
    this.list = steps();
    this.i = -1;
    this.active = true;
    this.card.style.display = '';
    this.next();
  }

  stop(finished) {
    this.active = false;
    this.card.style.display = this.ring.style.display = 'none';
    if (finished || !prefs().tutorialDone) setPref('tutorialDone', true);
  }

  next() {
    this.i++;
    this.t = 0;
    this.held = 0;
    const g = this.getState();
    while (this.list[this.i] && this.list[this.i].skipIf?.(g)) this.i++;
    const s = this.list[this.i];
    if (!s) return this.stop(true);
    const n = this.list.length;
    const dots = this.list.map((_, k) => `<i class="${k < this.i ? 'd' : k === this.i ? 'c' : ''}"></i>`).join('');
    let firstBonus = 0;
    if (s.end && !this.paid) {
      this.paid = true;
      firstBonus = prefs().tutorialDone ? 0 : 200;
      if (firstBonus) this.pay(firstBonus);
      haptic.reward();
    }
    this.card.innerHTML = `<div class="izk-tut-dots">${dots}</div><p>${s.text}${firstBonus ? `<br><b>Here is ${rand(firstBonus)} to start.</b>` : ''}</p>
      <div class="izk-tut-row">${s.end ? '<button class="izk-btn small izk-tgo">Let\'s drive</button>' : `${s.next ? '<button class="izk-btn small izk-tnext">Next</button>' : ''}<button class="izk-btn small ghost izk-tskip">Skip tutorial</button>`}</div>
      <small class="izk-tut-n">${Math.min(this.i + 1, n)} / ${n}</small>`;
    this.card.querySelector('.izk-tnext')?.addEventListener('click', () => (haptic.tap(), this.next()));
    this.card.querySelector('.izk-tskip')?.addEventListener('click', () => (haptic.tap(), this.stop(false)));
    this.card.querySelector('.izk-tgo')?.addEventListener('click', () => (haptic.tap(), this.stop(true)));
    this.card.classList.remove('pop');
    void this.card.offsetWidth;
    this.card.classList.add('pop');
    this.placeRing();
  }

  placeRing() {
    const s = this.list[this.i];
    const t = s && s.target && document.querySelector(s.target);
    const r = t && t.getBoundingClientRect();
    if (!r || r.width < 4 || !coarse()) {
      this.ring.style.display = 'none';
      return;
    }
    this.ring.style.display = '';
    const pad = 8;
    this.ring.style.left = r.left - pad + 'px';
    this.ring.style.top = r.top - pad + 'px';
    this.ring.style.width = r.width + pad * 2 + 'px';
    this.ring.style.height = r.height + pad * 2 + 'px';
  }

  update(dt) {
    if (!this.active) return;
    const s = this.list[this.i];
    if (!s || s.end) return;
    this.t += dt;
    if ((this._ringT = (this._ringT || 0) + dt) > 0.5) {
      this._ringT = 0;
      this.placeRing(); // controls move between car / foot; cheap twice a second
    }
    const g = this.getState();
    if (g.locked) return;
    if (s.done(g)) {
      this.held += dt;
      if (this.held >= (s.hold || 0)) {
        haptic.tap();
        this.next();
      }
    } else this.held = 0;
  }
}
