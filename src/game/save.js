const SAVE_KEY = 'izk-driving-save-v1';

export function loadGameSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    const finite = (value) => Number.isFinite(Number(value));
    if (save?.version !== 1 || !save.vehicle || !save.player) return null;
    for (const key of ['x', 'z', 'yaw']) {
      if (!finite(save.vehicle[key]) || !finite(save.player[key])) return null;
    }
    return save;
  } catch {
    return null;
  }
}

export function writeGameSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (error) {
    console.warn('Could not save driving progress:', error);
    return false;
  }
}
