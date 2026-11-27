// Speed settings the player can switch (28 Nov 2026): Mirrors on/off and a
// small FPS counter in the corner. Both are saved in prefs (izk.prefs.v1).
import { prefs, setPref } from './prefs.js';

let fpsEl = null;
let fpsOn = false;
let frames = 0;
let t0 = 0;
function fpsLoop(now) {
  if (!fpsOn) return;
  requestAnimationFrame(fpsLoop);
  frames++;
  if (!t0) t0 = now;
  if (now - t0 >= 500) {
    const fps = Math.round((frames * 1000) / (now - t0));
    fpsEl.textContent = fps + ' fps';
    fpsEl.style.color = fps >= 28 ? '#8ef59a' : fps >= 18 ? '#ffd36a' : '#ff7a6a';
    frames = 0;
    t0 = now;
  }
}

export function showFps(on) {
  if (on && !fpsEl) {
    fpsEl = document.createElement('div');
    fpsEl.id = 'izk-fps';
    fpsEl.style.cssText =
      'position:fixed;left:calc(env(safe-area-inset-left,0px) + 6px);bottom:calc(env(safe-area-inset-bottom,0px) + 4px);z-index:60;font:600 12px/1 system-ui,sans-serif;padding:3px 6px;border-radius:6px;background:rgba(0,0,0,.55);color:#8ef59a;pointer-events:none';
    fpsEl.textContent = '-- fps';
    document.body.appendChild(fpsEl);
  }
  if (fpsEl) fpsEl.style.display = on ? '' : 'none';
  if (on && !fpsOn) {
    fpsOn = true;
    frames = 0;
    t0 = 0;
    requestAnimationFrame(fpsLoop);
  }
  fpsOn = !!on;
}

// apply the saved choices to the running game (window.__izk)
export function applyPerfPrefs() {
  const p = prefs();
  showFps(p.fps === true);
  try {
    const lic = window.__izk && window.__izk.fares && window.__izk.fares.licence;
    if (lic) lic.mirrorsOff = p.mirrors === false;
  } catch {}
}

export function setPerfPref(name, on) {
  setPref(name, !!on);
  applyPerfPrefs();
}
