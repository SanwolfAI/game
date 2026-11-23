// Graphics: ONE look, "HD", on every phone. There is no graphics menu.
//
// Always on (never given up): HD 1K CC0 diffuse textures, the sharpen/edge
// pass, anisotropic filtering (8-16x) and at least 1.5 real pixels per CSS
// pixel (up to the screen's own density, capped at 2.5x).
//
// What changes between phones is invisible performance SAFETY, not the look:
// a budget phone (Hisense E32 Pro / Samsung A04 class: 2-3 GB RAM, weak GPU)
// starts with a shorter draw range, fewer people, thinner grass tufts and no
// normal maps, and main.js keeps trimming those (draw range, blob shadows,
// people, tufts) from frame time before it ever touches resolution, which
// never goes below 1.5x.
//
// Freeze rescue: if the last launch froze (crash-guard flag still set, or
// ?safe=1 from the Android "Restart (safe)" button) the game quietly starts
// one safety step lighter. Still HD textures, still sharp, no message.
//
// The old per-phone choice (localStorage izk.gfx.v1: auto/low/medium/high/hd)
// is ignored and removed on start.
const OLD_KEY = 'izk.gfx.v1';
try {
  localStorage.removeItem(OLD_KEY);
} catch {}

function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return s;
  } catch {
    return '';
  }
}

// Known GPU families. Weak = budget phones (A04 / Hisense class).
const WEAK = /PowerVR|Mali-(4\d\d|T[678]\d\d|G31|G51|G52|G57)|Adreno \(TM\) (3\d\d|4\d\d|50\d|51\d|60\d|61\d)|Adreno.*\b(3\d\d|4\d\d|50\d|51\d|60\d|61\d)\b|SwiftShader|llvmpipe|Software/i;
const STRONG = /Adreno.*\b(6[4-9]\d|7\d\d|8\d\d)\b|Mali-G(7[1-9]|610|615|710|715|720|925)|Immortalis|Xclipse|Apple|NVIDIA|GeForce|Radeon|Intel.*(Iris|Arc)/i;

// Internal safety level from device signals: 0 = strong, 1 = mid,
// 2 = budget. Never shown to the player.
export function detectSafety(mobile) {
  const dpr = devicePixelRatio || 1;
  const mem = navigator.deviceMemory || 0; // GB, Chrome/WebView only
  const cores = navigator.hardwareConcurrency || 0;
  const px = (screen.width || innerWidth) * (screen.height || innerHeight) * dpr * dpr;
  const gpu = gpuName();
  const signals = { dpr, mem, cores, px: Math.round(px), gpu };
  let level;
  if (!mobile) level = WEAK.test(gpu) ? 1 : 0;
  else if (WEAK.test(gpu) || (mem && mem <= 3) || (cores && cores <= 4)) level = 2;
  else if (STRONG.test(gpu) && (!mem || mem >= 6) && cores >= 8) level = 0;
  else level = 1;
  return { level, signals };
}

// The HD look plus the safety budget for a level (0..3; 3 = budget phone
// after a freeze). Pixels are clamped to the screen's own density.
export function hdCaps(level) {
  const dpr = Math.max(1, devicePixelRatio || 1);
  const px = (v) => Math.max(1, Math.min(dpr, v));
  const L = Math.max(0, Math.min(3, level | 0));
  const maxPx = px(2.5);
  const minPx = px(1.5); // resolution floor: never below 1.5x
  const startPx = px([2.5, 2, 1.5, 1.5][L]);
  return {
    tier: 'hd',
    safety: L,
    hd: true, // HD diffuse textures: always
    sharpen: true, // sharpen/edge pass: always
    normals: L === 0, // normal maps are the first look extra to go
    aniso: L <= 1 ? 16 : 8,
    maxPx: L >= 2 ? Math.max(minPx, Math.min(maxPx, px(2))) : maxPx,
    startPx,
    minPx,
    humanCap: [30, 22, 12, 6][L],
    range: [1, 1, 0.8, 0.6][L],
    tufts: [1, 1, 0.6, 0.35][L], // grass tuft density
    streetLife: L < 3
  };
}

function frozeLastTime() {
  try {
    const q = new URLSearchParams(location.search);
    return q.get('safe') === '1' || (q.get('safe') !== '0' && localStorage.getItem('izk-boot') === 'running');
  } catch {
    return false;
  }
}

const MOBILE_UA = /Android|Mobi|iPhone|iPad/i.test(navigator.userAgent || '') || ((navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) < 900);
const det = detectSafety(MOBILE_UA);
const rescued = frozeLastTime();
const level = Math.min(3, det.level + (rescued ? 1 : 0));
export const GFX = {
  setting: 'hd',
  detected: det.level,
  rescued,
  signals: det.signals,
  caps: hdCaps(level)
};
