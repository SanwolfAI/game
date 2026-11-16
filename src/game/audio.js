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
  if (!audio) return;
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

export function unlockAudio() {
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
