// Graphics quality: Auto / Low / Medium / High / HD, saved on the phone
// (localStorage izk.gfx.v1). Tiers only change the 3D canvas; the HTML HUD
// is never scaled or blurred by them.
//
// Sharpness first: a phone screen packs 2-3 real pixels into every CSS pixel,
// so drawing at 1x and stretching looks blurry ("worse than an 80s game").
// Every tier now draws at least 1.5 real pixels per CSS pixel on such screens.
//
//  low    1.5x pixels, HD textures if 4 GB+ RAM (no normal maps), fewer people
//  medium up to 2x pixels, HD (1K CC0) diffuse textures
//  high   up to 2x pixels, HD diffuse + normal maps, max anisotropy
//  hd     full screen pixels (up to 3x), HD diffuse + normal maps
//
// Auto picks a starting tier from device signals (pixel density, screen
// size, RAM, CPU cores, GPU name), then main.js adjusts from frame time.
// Auto cuts draw range, shadows and people before pixels, and never goes
// below minPx.
const KEY = 'izk.gfx.v1';
export const GFX_SETTINGS = ['auto', 'low', 'medium', 'high', 'hd'];

function readSetting() {
  try {
    const v = new URLSearchParams(location.search).get('gfx') || localStorage.getItem(KEY);
    if (GFX_SETTINGS.includes(v)) return v;
  } catch {}
  return 'auto';
}

export function saveSetting(v) {
  try {
    localStorage.setItem(KEY, v);
  } catch {}
}

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

export function detectTier(mobile) {
  const dpr = devicePixelRatio || 1;
  const mem = navigator.deviceMemory || 0; // GB, Chrome/WebView only
  const cores = navigator.hardwareConcurrency || 0;
  const px = (screen.width || innerWidth) * (screen.height || innerHeight) * dpr * dpr;
  const gpu = gpuName();
  const signals = { dpr, mem, cores, px: Math.round(px), gpu };
  let tier;
  if (!mobile) tier = WEAK.test(gpu) ? 'medium' : 'high';
  else if (WEAK.test(gpu) || (mem && mem <= 2) || (cores && cores <= 4)) tier = 'low';
  else if (STRONG.test(gpu) && (!mem || mem >= 6) && cores >= 8) tier = 'high';
  else if (mem && mem <= 3) tier = 'low';
  else tier = 'medium';
  return { tier, signals };
}

// What each tier allows. maxPx/minPx are clamped to the screen's own
// density (never above it, never below 1).
export function tierCaps(tier) {
  const dpr = Math.max(1, devicePixelRatio || 1);
  const px = (v) => Math.max(1, Math.min(dpr, v));
  // Low is for budget phones (Hisense E32 Pro, Samsung A04 class), where
  // High (2x + normal maps + 30 people) froze the phone: 1.5x, no climbing
  // above it, HD diffuse textures only when the phone has 4 GB+ RAM.
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
  if (tier === 'low') return { tier, maxPx: px(1.5), startPx: px(1.5), minPx: px(1.25), hd: !(mem && mem < 4), normals: false, aniso: 8, humanCap: 14, range: 0.8 };
  if (tier === 'medium') return { tier, maxPx: px(2), startPx: px(2), minPx: px(1.5), hd: true, normals: false, aniso: 8, humanCap: 22, range: 1 };
  if (tier === 'hd') return { tier, maxPx: px(3), startPx: px(3), minPx: px(2), hd: true, normals: true, aniso: 16, humanCap: 30, range: 1 };
  return { tier, maxPx: px(2), startPx: px(2), minPx: px(1.5), hd: true, normals: true, aniso: 16, humanCap: 30, range: 1 };
}

// Resolved once at boot (textures are built from it). A changed setting
// applies pixels/people live and textures on the next start.
// Freeze rescue: if the last launch froze (crash-guard flag still set, or
// ?safe=1 from the Android "Restart (safe)" button) while on a heavy setting,
// drop back to Low and save it, so the game can't get stuck freezing on
// every start.
function rescueSetting(v) {
  try {
    const q = new URLSearchParams(location.search);
    const froze = q.get('safe') === '1' || (q.get('safe') !== '0' && localStorage.getItem('izk-boot') === 'running');
    if (froze && v !== 'low') {
      saveSetting('low');
      return 'low';
    }
  } catch {}
  return v;
}
const setting = rescueSetting(readSetting());
const MOBILE_UA = /Android|Mobi|iPhone|iPad/i.test(navigator.userAgent || '') || ((navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) < 900);
const det = detectTier(MOBILE_UA);
export const GFX = {
  setting,
  detected: det.tier,
  signals: det.signals,
  caps: tierCaps(setting === 'auto' ? det.tier : setting),
  auto: setting === 'auto'
};
