let ctx = null;

function context() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function honk() {
  const audio = context();
  if (!audio || pausedAudio) return;
  if (audio.state === 'suspended') audio.resume();
  const t = audio.currentTime;
  for (const freq of [392, 494]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.02);
    gain.gain.setValueAtTime(0.1, t + 0.28);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.44);
  }
}

// Pause: silence everything (menu open, phone locked, app in background).
let pausedAudio = false;
export function pauseAudio(on) {
  pausedAudio = on;
  if (!ctx) return;
  if (on && ctx.state === 'running') ctx.suspend();
  else if (!on && ctx.state === 'suspended') ctx.resume();
}

export function unlockAudio() {
  if (pausedAudio) return;
  const audio = context();
  if (audio && audio.state === 'suspended') audio.resume();
}

// Indicator relay click (tick on / tock off).
export function tick(on = true) {
  const audio = context();
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = on ? 1900 : 1400;
  gain.gain.setValueAtTime(0.06, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.03);
}

// ---- Engine sound (synth): player engine + up to 3 nearby traffic hums ----
let engine = null;
let muted = false;
try {
  muted = localStorage.getItem('izk-mute') === '1';
} catch {
  muted = false;
}

function makeVoice(audio, out, type, sub) {
  const osc = audio.createOscillator();
  osc.type = type;
  const osc2 = audio.createOscillator();
  osc2.type = sub;
  const filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 2;
  const gain = audio.createGain();
  gain.gain.value = 0;
  const g2 = audio.createGain();
  g2.gain.value = 0.6;
  osc.connect(filter);
  osc2.connect(g2).connect(filter);
  filter.connect(gain).connect(out);
  osc.start();
  osc2.start();
  return { osc, osc2, filter, gain };
}

function ensureEngine() {
  if (engine) return engine;
  const audio = context();
  if (!audio || audio.state !== 'running') return null;
  const master = audio.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(audio.destination);
  const player = makeVoice(audio, master, 'sawtooth', 'square');
  const traffic = [];
  for (let i = 0; i < 3; i++) traffic.push(makeVoice(audio, master, 'triangle', 'sawtooth'));
  engine = { audio, master, player, traffic, gear: 1, shift: 0 };
  return engine;
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem('izk-mute', muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (engine) engine.master.gain.setTargetAtTime(muted ? 0 : 1, engine.audio.currentTime, 0.05);
  return muted;
}

const GEAR_TOP = [0, 22, 45, 72, 105, 145, 999]; // km/h per gear

// kmh: player speed, throttle 0..1, running: engine on (in a vehicle),
// cars: [{d, v}] nearest traffic (distance m, speed m/s), at most 3.
export function updateEngine(dt, kmh, throttle, running, cars) {
  const e = ensureEngine();
  if (!e) return;
  const t = e.audio.currentTime;
  const v = Math.abs(kmh);
  let g = 1;
  while (g < GEAR_TOP.length - 1 && v > GEAR_TOP[g]) g++;
  if (g !== e.gear) {
    if (g > e.gear) e.shift = 0.18; // brief dip on upshift
    e.gear = g;
  }
  if (e.shift > 0) e.shift -= dt;
  const lo = GEAR_TOP[g - 1];
  const hi = Math.min(GEAR_TOP[g], 180);
  const frac = Math.max(0, Math.min(1, (v - lo) / Math.max(hi - lo, 1)));
  let rpm = 850 + frac * 4600 + throttle * 600;
  if (v < 2) rpm = 850 + throttle * 2800; // revving at standstill
  if (e.shift > 0) rpm *= 0.82;
  const f = (rpm / 60) * 2; // 4-cylinder firing frequency
  const p = e.player;
  p.osc.frequency.setTargetAtTime(f, t, 0.05);
  p.osc2.frequency.setTargetAtTime(f / 2, t, 0.05);
  p.filter.frequency.setTargetAtTime(380 + throttle * 1300 + frac * 500, t, 0.08);
  p.gain.gain.setTargetAtTime(running ? 0.05 + throttle * 0.07 + frac * 0.02 : 0, t, 0.08);
  for (let i = 0; i < 3; i++) {
    const tv = e.traffic[i];
    const c = cars && i < cars.length ? cars[i] : null;
    const gain = c ? 0.045 * Math.max(0, 1 - c.d / 60) : 0;
    const tf = 45 + Math.min(c ? c.v : 0, 20) * 4;
    tv.osc.frequency.setTargetAtTime(tf, t, 0.2);
    tv.osc2.frequency.setTargetAtTime(tf / 2, t, 0.2);
    tv.filter.frequency.setTargetAtTime(320, t, 0.2);
    tv.gain.gain.setTargetAtTime(gain * gain * 20, t, 0.15);
  }
}

// Another driver's hooter, quieter with distance (impatient traffic).
export function honkFar(dist = 10, pitch = 1, long = false) {
  const audio = context();
  if (!audio || muted) return;
  if (audio.state === 'suspended') return;
  const vol = Math.min(0.09, 0.9 / Math.max(6, dist));
  if (vol < 0.006) return;
  const t = audio.currentTime;
  const len = long ? 0.75 : 0.32;
  const beeps = long ? 1 : 2;
  for (let b = 0; b < beeps; b++) {
    const t0 = t + b * 0.42;
    for (const freq of [370 * pitch, 466 * pitch]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      gain.gain.setValueAtTime(vol, t0 + len - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + len + 0.02);
    }
  }
}

// Crash: a low thump plus a burst of crunching noise. intensity 0..1.
let lastCrash = 0;
export function crashSound(intensity = 0.5, dist = 0) {
  const audio = context();
  if (!audio || muted) return;
  if (audio.state === 'suspended') return;
  const t = audio.currentTime;
  if (t - lastCrash < 0.25) return;
  lastCrash = t;
  const vol = Math.min(0.5, (0.12 + intensity * 0.38) * Math.min(1, 12 / Math.max(12, dist)));
  if (vol < 0.01) return;
  const len = 0.35 + intensity * 0.5;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * len), audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const f = i / d.length;
    // crunchy: random noise with clicky debris near the start
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - f, 2.2) * (Math.random() < 0.02 ? 1.6 : 1);
  }
  const src = audio.createBufferSource();
  src.buffer = buf;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800 + intensity * 2500;
  const g = audio.createGain();
  g.gain.value = vol;
  src.connect(lp).connect(g).connect(audio.destination);
  src.start(t);
  const osc = audio.createOscillator();
  const og = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.25);
  og.gain.setValueAtTime(vol * 1.4, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(og).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.32);
}

// Thunder: low rolling noise, delayed/quieter with distance (0..1 near..far).
export function thunderSound(far = 0.5) {
  const audio = context();
  if (!audio || muted || audio.state === 'suspended') return;
  const t = audio.currentTime + far * 2.5;
  const len = 2.8 + far * 1.5;
  const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * len), audio.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < d.length; i++) {
    const f = i / d.length;
    v = v * 0.985 + (Math.random() * 2 - 1) * 0.15; // brown-ish noise
    const env = Math.min(1, f * 18) * Math.pow(1 - f, 1.4) * (0.7 + 0.3 * Math.sin(f * 23 + Math.random()));
    d[i] = v * env * 3;
  }
  const src = audio.createBufferSource();
  src.buffer = buf;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420 - far * 250;
  const g = audio.createGain();
  g.gain.value = 0.55 * (1 - far * 0.6);
  src.connect(lp).connect(g).connect(audio.destination);
  src.start(t);
}

let rain = null;
// Rain hiss loop, level 0..1.
export function setRainLevel(level) {
  const audio = context();
  if (!audio || audio.state === 'suspended') return;
  if (!rain) {
    if (level < 0.02) return;
    const buf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.004 ? 2.5 : 1);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = audio.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.5;
    const g = audio.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(g).connect(audio.destination);
    src.start();
    rain = { g };
  }
  rain.g.gain.setTargetAtTime(muted ? 0 : level * 0.16, audio.currentTime, 0.4);
}
