// Title screen (also the loading screen): IZK logo over a Durban beachfront
// skyline at sunset (Moses Mabhida arch, hotels, palms, the Indian Ocean),
// drawn in code so it is sharp on any screen and costs no download.
// While the city loads: progress bar + one short tip at a time.
// When ready: the live game shows behind (the camera slowly circles your
// car) and the buttons appear: Play / Continue, Story, Garage, Rewards,
// Settings.
import { el } from './prefs.js';
import { haptic } from './haptics.js';

export const TIPS = [
  'Press lower on the GAS pedal to go faster.',
  'Taxi ranks pay you rand for every fare you finish.',
  'Use your indicators before you turn. Other drivers notice.',
  'Tap the little map to open the big map and set the GPS.',
  'The garage changes your paint and rims. It stays saved.',
  'Collect your daily reward. Day 7 pays R 1 000.',
  'Too twitchy? Change steering sensitivity in Settings.',
  'You can steer with the wheel, buttons or by tilting the phone.',
  'Your spot, car and time save by themselves.',
  'Tap CAM to change the camera view.',
  'At night, put your headlights on (or leave them on AUTO).',
  'Crashing costs you the Clean driver reward. Drive nice.'
];

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Durban skyline, drawn once per size ----
export function drawSkyline(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.max(2, Math.round(cv.clientWidth * dpr));
  const H = Math.max(2, Math.round(cv.clientHeight * dpr));
  if (cv.width === W && cv.height === H) return;
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const R = mulberry(31);
  const hz = H * 0.7; // horizon / shoreline
  // sky
  let g = c.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, '#0b1633');
  g.addColorStop(0.35, '#2a2f66');
  g.addColorStop(0.62, '#8a4a74');
  g.addColorStop(0.82, '#e27a55');
  g.addColorStop(1, '#ffc477');
  c.fillStyle = g;
  c.fillRect(0, 0, W, hz + 2);
  // a few stars up top
  c.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 70; i++) {
    const y = R() * hz * 0.35;
    c.globalAlpha = 0.25 + R() * 0.6 * (1 - y / (hz * 0.35));
    c.fillRect(R() * W, y, dpr * (R() < 0.2 ? 1.6 : 1), dpr * (R() < 0.2 ? 1.6 : 1));
  }
  c.globalAlpha = 1;
  // sun low over the sea (east: Durban looks out over the sea at sunrise,
  // the city glows gold either way)
  const sx = W * 0.8;
  const sy = hz - H * 0.02;
  g = c.createRadialGradient(sx, sy, 0, sx, sy, H * 0.55);
  g.addColorStop(0, 'rgba(255,226,150,0.95)');
  g.addColorStop(0.12, 'rgba(255,190,110,0.55)');
  g.addColorStop(1, 'rgba(255,140,80,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, hz);
  c.fillStyle = '#fff0c2';
  c.beginPath();
  c.arc(sx, sy, H * 0.06, Math.PI, 0);
  c.fill();
  // far hills (the Berea ridge)
  c.fillStyle = '#3a2d55';
  c.beginPath();
  c.moveTo(0, hz);
  for (let x = 0; x <= W; x += W / 40) c.lineTo(x, hz - H * (0.12 + 0.05 * Math.sin(x / W * 5.2 + 1) + 0.02 * Math.sin(x / W * 17)));
  c.lineTo(W, hz);
  c.fill();
  // far city blocks
  const far = '#2b2346';
  const near = '#1a1730';
  const tower = (x, w, h, col, lit) => {
    c.fillStyle = col;
    c.fillRect(x, hz - h, w, h);
    if (!lit) return;
    const cw = Math.max(2, w / 6);
    for (let yy = hz - h + cw * 1.5; yy < hz - cw; yy += cw * 1.8) {
      for (let xx = x + cw * 0.7; xx < x + w - cw; xx += cw * 1.6) {
        if (R() < 0.42) {
          c.fillStyle = R() < 0.8 ? 'rgba(255,214,140,0.85)' : 'rgba(180,220,255,0.7)';
          c.fillRect(xx, yy, cw * 0.7, cw * 0.8);
        }
      }
    }
  };
  for (let x = W * 0.02; x < W * 0.98; ) {
    const w = W * (0.018 + R() * 0.03);
    tower(x, w, H * (0.1 + R() * 0.12), far, false);
    x += w + W * 0.004;
  }
  // Moses Mabhida Stadium: the bowl and its great arch
  const mx = W * 0.3;
  const mw = W * 0.2;
  g = c.createLinearGradient(mx - mw / 2, 0, mx + mw / 2, 0);
  g.addColorStop(0, '#9d94b8');
  g.addColorStop(0.6, '#e6e1f2');
  g.addColorStop(1, '#f6d9b8'); // the sunny side
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(mx, hz - H * 0.055, mw / 2, H * 0.06, 0, Math.PI, 0);
  c.fill();
  c.fillStyle = '#5c5577'; // the open bowl under the roof
  c.fillRect(mx - mw / 2, hz - H * 0.058, mw, H * 0.058);
  c.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 18; i++) c.fillRect(mx - mw / 2 + (i + 0.3) * (mw / 18), hz - H * 0.056, mw / 50, H * 0.05); // columns
  c.fillStyle = '#cfc8e0';
  c.fillRect(mx - mw / 2, hz - H * 0.06, mw, H * 0.008);
  c.strokeStyle = '#f4f1fb';
  c.lineCap = 'round';
  c.lineWidth = Math.max(2, H * 0.012);
  c.beginPath();
  c.moveTo(mx - mw * 0.62, hz - H * 0.01);
  c.quadraticCurveTo(mx - mw * 0.1, hz - H * 0.62, mx + mw * 0.55, hz - H * 0.05);
  c.stroke();
  c.lineWidth = Math.max(1.5, H * 0.007); // the arch splits into two legs on one side
  c.beginPath();
  c.moveTo(mx + mw * 0.14, hz - H * 0.255);
  c.quadraticCurveTo(mx + mw * 0.42, hz - H * 0.2, mx + mw * 0.66, hz - H * 0.03);
  c.stroke();
  // beachfront hotels, nearer and lit
  for (let x = W * 0.46; x < W * 1.02; ) {
    const w = W * (0.025 + R() * 0.035);
    tower(x, w, H * (0.16 + R() * 0.26), near, true);
    x += w + W * (0.003 + R() * 0.01);
  }
  for (let x = -W * 0.01; x < W * 0.18; ) {
    const w = W * (0.02 + R() * 0.03);
    tower(x, w, H * (0.12 + R() * 0.16), near, true);
    x += w + W * 0.006;
  }
  // sea
  g = c.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, '#d98a62');
  g.addColorStop(0.15, '#6c4f74');
  g.addColorStop(1, '#141a38');
  c.fillStyle = g;
  c.fillRect(0, hz, W, H - hz);
  // sun glitter
  for (let i = 0; i < 60; i++) {
    const y = hz + (R() ** 1.6) * (H - hz);
    const spread = (y - hz) / (H - hz);
    const w = W * (0.01 + R() * 0.05) * (1 - spread * 0.5);
    c.fillStyle = `rgba(255,220,160,${0.5 * (1 - spread)})`;
    c.fillRect(sx - w / 2 + (R() - 0.5) * W * 0.1 * (0.4 + spread), y, w, dpr * 1.5);
  }
  // promenade
  c.fillStyle = '#0e0d1c';
  c.fillRect(0, hz - H * 0.006, W, H * 0.012);
  // palm trees in front
  const palm = (x, h, lean) => {
    c.strokeStyle = '#0c0b17';
    c.fillStyle = '#0c0b17';
    c.lineWidth = Math.max(3, H * 0.016);
    const tx = x + lean * h;
    const ty = hz - h;
    c.beginPath();
    c.moveTo(x, hz + H * 0.01);
    c.quadraticCurveTo(x + lean * h * 0.2, hz - h * 0.5, tx, ty);
    c.stroke();
    for (let k = 0; k < 9; k++) {
      // a frond: a filled leaf that arcs out and droops
      const a = -Math.PI * 1.05 + (k / 8) * Math.PI * 1.1 + (R() - 0.5) * 0.25;
      const L = h * (0.3 + R() * 0.12);
      const ex = tx + Math.cos(a) * L;
      const ey = ty + Math.sin(a) * L * 0.45 + L * 0.42;
      const dx = ex - tx;
      const dy = ey - ty;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const mx = tx + dx * 0.5;
      const my = ty + dy * 0.5 - L * 0.22; // arc up, then droop to the tip
      const w = L * 0.11;
      c.beginPath();
      c.moveTo(tx, ty);
      c.quadraticCurveTo(mx + nx * w, my + ny * w, ex, ey);
      c.quadraticCurveTo(mx - nx * w, my - ny * w, tx, ty);
      c.fill();
    }
    c.beginPath();
    c.arc(tx, ty, h * 0.025, 0, Math.PI * 2);
    c.fill();
  };
  palm(W * 0.47, H * 0.42, 0.08);
  palm(W * 0.52, H * 0.34, -0.12);
  palm(W * 0.95, H * 0.46, -0.06);
  palm(W * 0.08, H * 0.3, 0.1);
}

export class TitleScreen {
  constructor({ onPlay, onGarage, onSettings, onRewards, onStory, hasSave }) {
    this.root = el('div', 'izk-title loading');
    this.root.innerHTML = `
      <canvas class="izk-sky"></canvas>
      <div class="izk-shade"></div>
      <div class="izk-tleft">
        <div class="izk-logo"><span class="izk-l1">IZK</span><span class="izk-l2">Izinja <em>zase Kasi</em></span><span class="izk-l3">Durban · KwaZulu-Natal</span></div>
        <div class="izk-menu">
          <button class="izk-btn big izk-play">${hasSave ? 'Continue' : 'Play'}</button>
          <button class="izk-btn izk-story" style="display:none">Story</button>
          <div class="izk-mrow">
            <button class="izk-btn ghost izk-garage">Garage</button>
            <button class="izk-btn ghost izk-rewards">Rewards<i class="izk-dot" style="display:none"></i></button>
            <button class="izk-btn ghost izk-settings">Settings</button>
          </div>
        </div>
      </div>
      <div class="izk-tload">
        <div class="izk-tip"></div>
        <div class="izk-bar"><i></i></div>
        <div class="izk-status">Starting engine…</div>
        <button class="izk-btn small izk-safe">Restart in safe mode</button>
      </div>`;
    document.body.appendChild(this.root);
    this.sky = this.root.querySelector('.izk-sky');
    this.fill = this.root.querySelector('.izk-bar i');
    this.status = this.root.querySelector('.izk-status');
    this.tip = this.root.querySelector('.izk-tip');
    this.tipI = Math.floor(Math.random() * TIPS.length);
    this.tip.textContent = TIPS[this.tipI];
    const on = (cls, fn) =>
      this.root.querySelector(cls).addEventListener('click', () => {
        haptic.tap();
        fn?.();
      });
    on('.izk-play', onPlay);
    on('.izk-garage', onGarage);
    on('.izk-settings', onSettings);
    on('.izk-rewards', onRewards);
    on('.izk-story', onStory);
    on('.izk-safe', () => (location.href = location.pathname + '?safe=1'));
    const redraw = () => {
      try {
        drawSkyline(this.sky);
      } catch {}
    };
    requestAnimationFrame(redraw);
    addEventListener('resize', () => requestAnimationFrame(redraw));
    this.tipTimer = setInterval(() => this.nextTip(), 4500);
    this.mirror();
  }

  nextTip() {
    this.tipI = (this.tipI + 1) % TIPS.length;
    this.tip.classList.remove('in');
    void this.tip.offsetWidth;
    this.tip.textContent = TIPS[this.tipI];
    this.tip.classList.add('in');
  }

  // copy the game's own loading bar / status (main.js keeps writing those)
  mirror() {
    const srcFill = document.getElementById('load-fill');
    const srcStatus = document.getElementById('load-status');
    const tick = () => {
      if (!this.root.classList.contains('loading')) return;
      if (srcFill) this.fill.style.width = srcFill.style.width || '4%';
      if (srcStatus) {
        const t = srcStatus.textContent;
        if (t !== this.status.textContent) this.status.textContent = t;
        const failed = /^Failed/.test(t);
        this.root.classList.toggle('failed', failed);
      }
      setTimeout(tick, 150);
    };
    tick();
  }

  ready({ story, dailyReady }) {
    this.root.classList.remove('loading');
    this.root.classList.add('ready');
    clearInterval(this.tipTimer);
    if (story) this.root.querySelector('.izk-story').style.display = '';
    this.root.querySelector('.izk-dot').style.display = dailyReady ? '' : 'none';
  }

  setDot(on) {
    this.root.querySelector('.izk-dot').style.display = on ? '' : 'none';
  }

  show() {
    this.root.style.display = '';
    this.root.classList.remove('gone');
  }

  hide() {
    this.root.classList.add('gone');
    setTimeout(() => {
      if (this.root.classList.contains('gone')) this.root.style.display = 'none';
    }, 380);
  }

  get isOpen() {
    return this.root.style.display !== 'none' && !this.root.classList.contains('gone');
  }
}
