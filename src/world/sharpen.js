import * as THREE from '../../vendor/three/three.module.js';

// One cheap full-screen pass that makes phone frames crisp:
//  - FXAA-style edge smoothing (phones run without MSAA, so edges stair-step)
//  - a light contrast-adaptive sharpen (CAS-like) so textures and far
//    buildings read clearly instead of looking soft.
// The scene is drawn into a half-float target (keeps HDR for tone mapping),
// then this pass tone-maps + converts to sRGB itself. If half-float targets
// are not supported the pass stays off and the game renders as before.
const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uSharp;
varying vec2 vUv;
vec3 tap(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
  return clamp(linearToOutputTexel(vec4(toneMapping(c), 1.0)).rgb, 0.0, 1.0);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 cM = tap(vec2(0.0));
  vec3 cN = tap(vec2(0.0, 1.0)), cS = tap(vec2(0.0, -1.0));
  vec3 cE = tap(vec2(1.0, 0.0)), cW = tap(vec2(-1.0, 0.0));
  float lM = luma(cM), lN = luma(cN), lS = luma(cS), lE = luma(cE), lW = luma(cW);
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float range = lMax - lMin;
  vec3 col = cM;
  // edge smoothing: blend along the edge where contrast is high
  if (range > max(0.03, lMax * 0.1)) {
    vec2 dir = vec2(-((lN) - (lS)), (lE) - (lW));
    float dmin = 1.0 / (min(abs(dir.x), abs(dir.y)) + range * 0.25 + 1e-4);
    dir = clamp(dir * dmin, -2.0, 2.0);
    vec3 a = 0.5 * (tap(dir * (1.0 / 3.0 - 0.5)) + tap(dir * (2.0 / 3.0 - 0.5)));
    vec3 b = a * 0.5 + 0.25 * (tap(dir * -0.5) + tap(dir * 0.5));
    float lb = luma(b);
    col = (lb < lMin || lb > lMax) ? a : b;
  } else {
    // flat-ish areas: contrast-adaptive sharpen (strong on soft detail, gentle near edges)
    float amp = sqrt(clamp(min(lMin, 1.0 - lMax) / max(lMax, 1e-4), 0.0, 1.0));
    float w = -amp * uSharp;
    col = clamp((cM + (cN + cS + cE + cW) * w) / (1.0 + 4.0 * w), 0.0, 1.0);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sharpen {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.enabled = false;
    this.debugOff = !!opts.off; // ?sharp=0 (debug only); the game never turns it off
    const gl = renderer.getContext();
    const ok = renderer.capabilities.isWebGL2 && (gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
    if (!ok || opts.off) return;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    this.target.texture.generateMipmaps = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: this.target.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uSharp: { value: opts.sharp != null ? opts.sharp : 0.16 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.enabled = true;
    this.resize();
  }

  resize() {
    if (!this.target) return;
    const v = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(v.x)), h = Math.max(1, Math.floor(v.y));
    if (w !== this.target.width || h !== this.target.height) {
      this.target.setSize(w, h);
      this.mat.uniforms.uTexel.value.set(1 / w, 1 / h);
    }
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) {
      r.render(scene, camera);
      return;
    }
    this.resize();
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.qScene, this.qCam);
  }
}

// Sharper textures at grazing angles (roads, ground, facades): raise every
// loaded texture's anisotropy to what the GPU allows, with mipmaps.
export function sharpenTextures(scene, renderer, cap = 16) {
  const max = Math.min(cap, renderer.capabilities.getMaxAnisotropy() || 1);
  if (max <= 1) return;
  const seen = new Set();
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : null;
    if (!mats) return;
    for (const m of mats) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
        const t = m[k];
        if (t && !seen.has(t) && t.isTexture && !t.isRenderTargetTexture) {
          seen.add(t);
          let dirty = false;
          if (t.anisotropy < max) {
            t.anisotropy = max;
            dirty = true;
          }
          // mipmaps on every image texture (no blurry-then-shimmering far detail)
          if (!t.isDataTexture && !t.isCompressedTexture && t.minFilter === THREE.LinearFilter) {
            t.minFilter = THREE.LinearMipmapLinearFilter;
            t.generateMipmaps = true;
            dirty = true;
          }
          if (dirty && t.image && t.version > 0) t.needsUpdate = true;
        }
      }
    }
  });
}
