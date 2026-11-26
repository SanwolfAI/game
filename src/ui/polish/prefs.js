// Player choices kept on the phone (mobile polish, 25 Nov 2026).
// One small JSON blob so a new setting never needs a new key.
const KEY = 'izk.prefs.v1';

const DEFAULTS = {
  controls: 'wheel', // 'wheel' | 'buttons' | 'tilt'
  tiltCentre: 0, // tilt that counts as "straight" (set with Centre tilt)
  tiltRange: 28, // degrees of phone tilt for full lock
  haptics: true,
  tutorialDone: false,
  titleSkip: false // test rigs only: start straight in the game
};

let cache = null;

export function prefs() {
  if (cache) return cache;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {}
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

export function setPref(name, value) {
  prefs()[name] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
}

// shared tiny helpers
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export function rand(n) {
  return 'R ' + Math.round(n).toLocaleString('en-ZA');
}
