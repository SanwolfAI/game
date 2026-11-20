// One top layer for every game popup / dialog (licence desk, K53 test,
// house picker, taxi career, pause menu).
//
// Why (Bheko, 20 Nov 2026: "learner's test popup can't be tapped on Android"):
// the licence and career panels were appended inside #hud, which has
// `pointer-events: none` so the HUD never eats taps meant for the game. A child
// inherits that, so every tap on the panel's buttons fell straight through to
// the canvas / touch controls underneath. On a phone the touch controls (MAP,
// GPS buttons) also sat over the middle of the panel.
//
// Now: popups live in #dialogs (fixed, z-index 1000, after everything else in
// <body>), each popup gets pointer-events:auto, and while any popup is showing
// <body> carries the class `dialog-open`. CSS hides the driving / on-foot
// controls then, and main.js stops feeding input to the car or the player.

let layer = null;
const watched = new Set();
let openCount = 0;
const listeners = [];
let obs = null;

function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.id = 'dialogs';
  document.body.appendChild(layer);
  return layer;
}

function shown(el) {
  if (!el.isConnected) return false;
  const st = el.style;
  if (st.display === 'none') return false;
  if (el.id === 'menu') return el.classList.contains('open');
  if (el.dataset.dialogHidden === '1') return false;
  return true;
}

function recount() {
  let n = 0;
  for (const el of watched) {
    if (!el.isConnected) {
      watched.delete(el);
      continue;
    }
    if (shown(el)) n++;
  }
  if (n === openCount) return;
  const was = openCount > 0;
  openCount = n;
  const now = n > 0;
  document.body.classList.toggle('dialog-open', now);
  if (was !== now) for (const fn of listeners) fn(now);
}

// Register a popup element. It moves into the top layer (unless keepParent),
// becomes tappable, and its show/hide is tracked through its style/class.
export function registerDialog(el, { keepParent = false } = {}) {
  if (!keepParent) ensureLayer().appendChild(el);
  el.classList.add('izk-dialog');
  el.style.pointerEvents = 'auto';
  watched.add(el);
  // watch only the popups themselves (and the layer for removals): the game
  // restyles HUD bits every frame, and a body-wide observer would allocate
  // mutation records every frame
  if (!obs) {
    obs = new MutationObserver(recount);
    obs.observe(ensureLayer(), { childList: true });
  }
  obs.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  recount();
  return el;
}

export function dialogOpen() {
  return openCount > 0;
}

export function onDialogChange(fn) {
  listeners.push(fn);
}
