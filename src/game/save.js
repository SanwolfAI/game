// Autosave: where you left off (car, place, camera, GPS, clock, lights).
// Written every few seconds and whenever the app is hidden / closed
// (Android WebView backgrounding fires visibilitychange + pagehide).
const KEY = 'izk-save-v1';

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.v === 1 && Number.isFinite(s.x) && Number.isFinite(s.z)) return s;
  } catch {}
  return null;
}

export function writeSave(state) {
  try {
    state.v = 1;
    state.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem('izk.gameClock.v1');
    localStorage.removeItem('izk.bike.v1'); // a new house brings a new bike
  } catch {}
}
