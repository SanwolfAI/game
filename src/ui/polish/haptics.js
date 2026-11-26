// Phone vibration (navigator.vibrate; the APK asks for VIBRATE).
// Short buzz on crashes (stronger for harder hits), a tick on gear changes,
// a double pulse for rewards. Off switch in Settings.
import { prefs } from './prefs.js';

let lastBuzz = 0;

export function buzz(pattern, minGapMs = 60) {
  if (!prefs().haptics) return;
  const now = performance.now();
  if (now - lastBuzz < minGapMs) return;
  lastBuzz = now;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {}
}

export const haptic = {
  tap: () => buzz(8, 40),
  gear: () => buzz(14, 80),
  crash: (impact) => buzz(Math.round(Math.min(140, 25 + impact * 6)), 250),
  reward: () => buzz([30, 50, 30, 50, 60], 300)
};
