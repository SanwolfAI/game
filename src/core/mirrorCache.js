import * as THREE from '../../vendor/three/three.module.js';
import { GFX } from './gfx.js';

// Mirror update rate (the last thing the performance safety trims before
// cutting harder). With GFX.live.mirrorEvery = 1 a mirror is drawn straight
// to the screen every frame, exactly as before. With N > 1 each mirror is
// drawn into its own native-resolution render target only every N frames
// (mirrors take turns), and in between the last picture is pasted back,
// which costs almost nothing. Resolution stays native either way.
//
// Use from any mirror code, inside the viewport/scissor already set for the
// mirror (GL bottom-left origin, CSS pixels):
//   renderMirrorView(renderer, scene, cam, key, x, y, w, h)
// main.js calls mirrorFrame() once per frame.

let frameNo = 0;
export function mirrorFrame() {
  frameNo++;
}

const cache = new Map();
let quadCam = null;
let halfFloat = null;

function entry(renderer, key, bw, bh) {
  let e = cache.get(key);
  if (halfFloat === null) {
    const gl = renderer.getContext();
    halfFloat = !!(renderer.capabilities.isWebGL2 && (gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float')));
  }
  if (!e) {
    const rt = new THREE.WebGLRenderTarget(bw, bh, { type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true, samples: 0 });
    rt.texture.generateMipmaps = false;
    rt.texture.minFilter = THREE.LinearFilter; // 1:1 on screen, no mips needed
    const mat = new THREE.MeshBasicMaterial({ map: rt.texture, depthTest: false, depthWrite: false, fog: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const sc = new THREE.Scene();
    sc.add(quad);
    e = { rt, sc, last: -1e9 };
    cache.set(key, e);
  } else if (e.rt.width !== bw || e.rt.height !== bh) {
    e.rt.setSize(bw, bh);
    e.last = -1e9;
  }
  return e;
}

// Is mirror `key` due a fresh picture this frame? (same stagger as below)
export function mirrorDue(key) {
  const every = Math.max(1, GFX.live.mirrorEvery | 0);
  return every <= 1 || (frameNo + key) % every === 0;
}

// `target`: a mirror that already owns a render target (the 3D cockpit
// mirrors in game/mirrors.js, whose glass shows that texture). Its target is
// the cache: the caller asks mirrorDue(key) and only calls this when a fresh
// picture is due (or the target was resized); in between the glass keeps the
// last picture.
export function renderMirrorView(renderer, scene, cam, key, x, y, w, h, target = null) {
  const every = Math.max(1, GFX.live.mirrorEvery | 0);
  if (target) {
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    return;
  }
  if (every <= 1) {
    renderer.render(scene, cam);
    return;
  }
  const pr = renderer.getPixelRatio();
  const bw = Math.max(1, Math.round(w * pr));
  const bh = Math.max(1, Math.round(h * pr));
  const e = entry(renderer, key, bw, bh);
  // stagger: mirror k refreshes on its own frame of the cycle
  const due = (frameNo + key) % every === 0 || frameNo - e.last > every;
  if (due) {
    e.last = frameNo;
    const prevScissor = renderer.getScissorTest();
    renderer.setRenderTarget(e.rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(null); // restores the screen viewport/scissor set by the caller
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(prevScissor);
  }
  if (!quadCam) quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  renderer.render(e.sc, quadCam);
}
