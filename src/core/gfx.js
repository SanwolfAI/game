// Graphics: ONE look, "HD", on every phone. There is no graphics menu.
//
// FULL SHARPNESS, always (never given up, never lowered automatically):
//  - the screen's own native pixel ratio (devicePixelRatio, capped at 3),
//    on phones too: one drawing-buffer pixel per screen pixel
//  - HD 1K CC0 diffuse textures with mipmaps + the GPU's max anisotropy
//  - the sharpen/FXAA edge pass
//
// What changes between phones is invisible performance SAFETY, not the look:
// a budget phone (Hisense E32 Pro / Samsung A04 class: 2-3 GB RAM, weak GPU)
// starts with a shorter draw range, fewer people and cars, thinner grass
// tufts and trees, slower mirror refresh and no normal maps. When frames are
// slow, main.js trims, in order: draw distance, shadows, people/traffic
// density, grass tufts + tree density, mirror update rate. Resolution,
// sharpen and texture size are never touched.
//
// Freeze rescue: if the last launch froze (crash-guard flag still set, or
// ?safe=1 from the Android "Restart (safe)" button) the game quietly starts
// one safety step lighter: it cuts those same things harder and keeps full
// native resolution, HD textures and sharpen. No message.
//
// The old per-phone choice (localStorage izk.gfx.v1: auto/low/medium/high/hd)
// is ignored and removed on start.
const OLD_KEY = 'izk.gfx.v1';
try {
  localStorage.removeItem(OLD_KEY);
} catch {}

let maxAniso = 1;
function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const af = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    if (af) maxAniso = Math.max(1, gl.getParameter(af.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1);
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

// Native pixel ratio of this screen (capped at 3). Read live: it changes
// when a window moves between screens or the page is zoomed.
export const PX_CAP = 3;
export function nativePx() {
  return Math.max(1, Math.min(PX_CAP, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
}

// The HD look plus the safety budget for a level (0..3; 3 = budget phone
// after a freeze). Pixels are ALWAYS the screen's native ratio.
export function hdCaps(level) {
  const L = Math.max(0, Math.min(3, level | 0));
  const px = nativePx();
  return {
    tier: 'hd',
    safety: L,
    hd: true, // HD diffuse textures: always
    sharpen: true, // sharpen/FXAA pass: always
    nativePx: true, // full native resolution: always
    normals: L === 0, // normal maps are a start-up extra only (diffuse stays HD)
    aniso: 16, // three clamps to the GPU's own max
    maxPx: px,
    startPx: px,
    minPx: px, // the resolution floor IS native: never lowered
    humanCap: [30, 22, 12, 6][L],
    range: [1, 1, 0.8, 0.6][L],
    tufts: [1, 1, 0.6, 0.35][L], // grass tuft density
    trees: [1, 1, 0.8, 0.6][L], // tree draw distance / far density
    traffic: [1, 1, 0.75, 0.5][L], // share of far traffic cars drawn
    mirrorEvery: [1, 1, 2, 3][L], // mirrors redraw every N frames
    blobs: L < 3, // soft ground shadows
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
  maxAniso, // the GPU's max anisotropic filtering (every texture uses it)
  caps: hdCaps(level),
  // live safety values read by other modules each frame (main.js sets them)
  live: { mirrorEvery: 1 }
};
GFX.live.mirrorEvery = GFX.caps.mirrorEvery;
