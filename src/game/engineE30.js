// Recorded BMW straight-six engine for the gusheshe (E30 325is, M20 inline-6).
//
// Four real recordings, each flattened to one steady pitch and cut into a
// seamless loop (scripts/build-engine-sound.py), are played together and
// crossfaded by rpm; each loop's playbackRate follows rpm / its recorded rpm.
// Throttle changes the load (loudness, brightness, on-throttle vs overrun
// loop) and a quick stab of gas gives a short rev blip. A real start-up plays
// when you get in. Sources and licences: src/assets/hd/CREDITS.txt.
//
// Each file (.ogg Opus and .m4a AAC) holds its loop twice in a row. We loop the middle stretch
// (0.5 to 1.5 loop lengths), so the AAC encoder's lead-in padding can never
// land inside the loop: any one-period window of a periodic signal is seamless.

const BASE = './src/assets/audio/';
const LOOPS = [
  // name, recorded rpm (firing tone x 20 for a six), loop length in seconds
  { name: 'idle', rpm: 960, sec: 1.75 },
  { name: 'low', rpm: 1700, sec: 2.68234375 }, // overrun / light load
  { name: 'mid', rpm: 3000, sec: 1.8 },
  { name: 'high', rpm: 6000, sec: 2.8 },
];
export const E30_IDLE = 820;
export const E30_REDLINE = 6500;

function decode(audio, data) {
  // callback form: older Android WebViews have no promise-based decodeAudioData
  return new Promise((resolve, reject) => {
    const p = audio.decodeAudioData(data, resolve, reject);
    if (p && p.catch) p.catch(reject);
  });
}

function fetchDecode(audio, url) {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.arrayBuffer();
    })
    .then((buf) => decode(audio, buf));
}

// Ogg Opus (Android WebView / Chrome / Firefox) or AAC .m4a (Safari, and any
// build without Opus); if the first one will not decode, try the other.
let formats = null;
function pickFormats() {
  if (formats) return formats;
  let opus = false;
  try {
    opus = !!document.createElement('audio').canPlayType('audio/ogg; codecs=opus');
  } catch {
    opus = false;
  }
  formats = opus ? ['.ogg', '.m4a'] : ['.m4a', '.ogg'];
  return formats;
}

function load(audio, name) {
  const [a, b] = pickFormats();
  return fetchDecode(audio, BASE + name + a).catch(() => fetchDecode(audio, BASE + name + b));
}

// Weights for the four loops at a given rpm: neighbours crossfade on a log-rpm
// scale with equal power, so loudness stays even through the sweep.
export function loopWeights(rpm, load) {
  const w = [0, 0, 0, 0];
  const r = Math.max(LOOPS[0].rpm, Math.min(LOOPS[3].rpm, rpm));
  for (let i = 0; i < 3; i++) {
    const a = LOOPS[i].rpm;
    const b = LOOPS[i + 1].rpm;
    if (r >= a && r <= b) {
      const f = Math.log(r / a) / Math.log(b / a);
      w[i] = Math.cos((f * Math.PI) / 2);
      w[i + 1] = Math.sin((f * Math.PI) / 2);
      break;
    }
  }
  if (rpm < LOOPS[0].rpm) w[0] = 1;
  // off the gas above ~1500 rpm: lean towards the overrun loop
  const off = (1 - load) * Math.min(1, Math.max(0, (rpm - 1500) / 800)) * 0.65;
  const moved = off * (w[2] + w[3]);
  w[2] *= 1 - off;
  w[3] *= 1 - off;
  w[1] = Math.sqrt(w[1] * w[1] + moved * moved);
  return w;
}

export function loopRate(i, rpm) {
  return Math.max(0.45, Math.min(2.2, rpm / LOOPS[i].rpm));
}

export function createE30Engine(audio, out) {
  const bus = audio.createGain();
  bus.gain.value = 0;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  lp.Q.value = 0.5;
  lp.connect(bus).connect(out);

  const voices = [];
  let startBuf = null;
  let ready = false;
  let failed = false;

  Promise.all(LOOPS.map((l) => load(audio, 'e30_' + l.name)))
    .then((bufs) => {
      bufs.forEach((buf, i) => {
        const src = audio.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const len = LOOPS[i].sec;
        src.loopStart = len * 0.5;
        src.loopEnd = len * 1.5;
        const g = audio.createGain();
        g.gain.value = 0;
        src.connect(g).connect(lp);
        src.start(0, len * 0.5);
        voices.push({ src, g });
      });
      ready = true;
    })
    .catch((err) => {
      failed = true;
      console.warn('E30 engine sound not loaded, using synth', err);
    });
  load(audio, 'e30_start')
    .then((b) => {
      startBuf = b;
    })
    .catch(() => {});

  const st = { rpm: E30_IDLE, load: 0, prevThrottle: 0, blip: 0, startT: -1, startNode: null, startGain: null, wasRunning: false };

  function playStart() {
    if (!startBuf) return;
    const src = audio.createBufferSource();
    src.buffer = startBuf;
    const g = audio.createGain();
    g.gain.value = 1;
    src.connect(g).connect(out);
    src.start();
    st.startNode = src;
    st.startGain = g;
    st.startT = audio.currentTime;
  }

  function stopStart(fade = 0.2) {
    if (!st.startNode) return;
    const t = audio.currentTime;
    st.startGain.gain.setTargetAtTime(0, t, fade / 3);
    try {
      st.startNode.stop(t + fade + 0.05);
    } catch {
      /* already stopped */
    }
    st.startNode = null;
  }

  // targetRpm: rpm from speed/gear; throttle 0..1; running: engine on
  function update(dt, targetRpm, throttle, running, active) {
    if (!ready) return false;
    const t = audio.currentTime;
    const on = running && active;
    if (on && !st.wasRunning && targetRpm < 1500) playStart();
    if (!on && st.wasRunning) stopStart(0.15);
    st.wasRunning = on;

    // rev blip: a quick stab of gas overshoots, then settles
    if (throttle - st.prevThrottle > 0.45 && st.prevThrottle < 0.35) st.blip = 1;
    st.prevThrottle = throttle;
    st.blip = Math.max(0, st.blip - dt / 0.32);
    const blipRpm = st.blip > 0 ? Math.sin(st.blip * Math.PI) * (targetRpm < 1400 ? 1900 : 900) : 0;

    // engine inertia: revs climb quicker than they fall
    const want = Math.min(E30_REDLINE, targetRpm + blipRpm);
    const tau = want > st.rpm ? 0.09 : 0.22;
    st.rpm += (want - st.rpm) * Math.min(1, dt / tau);
    st.load += (throttle - st.load) * Math.min(1, dt / 0.12);

    // start-up: loops come in under its tail; gas or rolling cuts it short
    let startMix = 1;
    if (st.startNode) {
      const age = t - st.startT;
      if (throttle > 0.3 && age > 0.8) stopStart(0.25);
      else if (age > startBuf.duration) st.startNode = null;
      startMix = age < 3.6 ? 0 : Math.min(1, (age - 3.6) / 0.8);
      if (!st.startNode) startMix = 1;
    }

    const w = loopWeights(st.rpm, st.load);
    for (let i = 0; i < voices.length; i++) {
      voices[i].src.playbackRate.setTargetAtTime(loopRate(i, st.rpm), t, 0.03);
      voices[i].g.gain.setTargetAtTime(w[i], t, 0.05);
    }
    lp.frequency.setTargetAtTime(1500 + st.load * 5500 + (st.rpm / E30_REDLINE) * 2500, t, 0.06);
    const level = on ? (0.3 + 0.45 * st.load + 0.12 * (st.rpm / E30_REDLINE)) * startMix : 0;
    bus.gain.setTargetAtTime(level, t, on ? 0.06 : 0.25);
    return true;
  }

  return {
    update,
    get ready() {
      return ready;
    },
    get failed() {
      return failed;
    },
    get rpm() {
      return st.rpm;
    },
  };
}
