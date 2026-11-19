// Graphics quality: Auto / Low / Medium / High, saved on the phone
// (localStorage izk.gfx.v1). Tiers only change the 3D canvas; the HTML HUD
// is never scaled or blurred by them.
//
//  low    1x pixels, current flat textures, fewer people, shorter draw range
//  medium up to 1.5x pixels, HD (1K CC0) diffuse textures
//  high   up to 2x pixels, HD diffuse + normal maps, max anisotropy
//
// Auto picks a starting tier from device signals (pixel density, screen
// size, RAM, CPU cores, GPU name), then main.js adjusts from frame time.
// Pixel ratio never drops below 1.0 on any tier.
const KEY = 'izk.gfx.v1';
export const GFX_SETTINGS = ['auto', 'low', 'medium', 'high'];

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

// What each tier allows. maxPx is clamped to the screen's own density but
// never below 1.
export function tierCaps(tier) {
  const dpr = Math.max(1, devicePixelRatio || 1);
  if (tier === 'low') return { tier, maxPx: 1, hd: false, normals: false, aniso: 4, humanCap: 14, range: 0.8 };
  if (tier === 'medium') return { tier, maxPx: Math.max(1, Math.min(dpr, 1.5)), hd: true, normals: false, aniso: 8, humanCap: 22, range: 1 };
  return { tier, maxPx: Math.max(1, Math.min(dpr, 2)), hd: true, normals: true, aniso: 16, humanCap: 30, range: 1 };
}

// Resolved once at boot (textures are built from it). A changed setting
// applies pixels/people live and textures on the next start.
const setting = readSetting();
const MOBILE_UA = /Android|Mobi|iPhone|iPad/i.test(navigator.userAgent || '') || ((navigator.maxTouchPoints || 0) > 0 && Math.min(screen.width, screen.height) < 900);
const det = detectTier(MOBILE_UA);
export const GFX = {
  setting,
  detected: det.tier,
  signals: det.signals,
  caps: tierCaps(setting === 'auto' ? det.tier : setting),
  auto: setting === 'auto'
};
