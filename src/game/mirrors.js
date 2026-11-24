import * as THREE from '../../vendor/three/three.module.js';

// Real car mirrors for the inside (driver) view (Bheko, 23 Nov 2026:
// "the side mirrors didn't show the car, the centre mirror was on the side").
//
// Three mirrors, each with its own camera at the mirror's REAL place on the car:
//   - rear-view mirror: top centre of the windscreen. Its camera sits at the
//     back of the cabin looking out of the rear window (the glass shows the
//     rear-window frame and the back headrests around the picture).
//   - left and right wing mirrors: outside each front door at door level.
//     Their cameras sit just outside the doors, toed out a little, so the side
//     of your own car fills the inner edge of the glass and the lane behind
//     fills the rest, like a real mirror set up by the K53 book.
// Each camera draws into its own small render target, sized 1:1 to the pixels
// the mirror covers on screen (sharp, never stretched), and the picture is
// flipped left-right because it is a mirror. The glass and housings are drawn
// in one cheap overlay pass after the main frame.
// Budget phones (Hisense E32 Pro, Samsung A04): the rear-view mirror updates on
// even frames and the two wing mirrors on odd frames, no MSAA, short draw
// distance, and no shadow-map work in the mirror passes.

const GLASS_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// kind 0 = rear-view (rear window frame + headrests), 1 = wing (car side)
const GLASS_FRAG = `
uniform sampler2D map;
uniform vec2 uSize;
uniform float uRadius;
uniform float uKind;
varying vec2 vUv;
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = sdRound(p, uSize * 0.5, uRadius);
  float a = clamp(0.5 - d, 0.0, 1.0);
  vec3 c = texture2D(map, vec2(1.0 - vUv.x, vUv.y)).rgb; // a mirror flips left-right
  if (uKind < 0.5) {
    // the rear window seen from the front seats: C-pillars, roof lining and
    // parcel shelf frame the picture, two headrests sit at the bottom
    vec2 q = vUv - vec2(0.5, 0.52);
    float wx = 0.43 - (0.5 - vUv.y) * 0.07;
    float win = smoothstep(0.0, 0.015, wx - abs(q.x)) * smoothstep(0.0, 0.03, 0.36 - abs(q.y));
    vec3 cabin = mix(vec3(0.035, 0.037, 0.042), vec3(0.075, 0.072, 0.068), vUv.y);
    c = mix(cabin, c, win);
    for (int i = 0; i < 2; i++) {
      vec2 h = (vUv - vec2(i == 0 ? 0.27 : 0.73, 0.02)) * vec2(1.0, 1.9);
      float hr = smoothstep(0.012, 0.0, length(max(abs(h) - vec2(0.075, 0.11), 0.0)) - 0.06);
      c = mix(c, vec3(0.05, 0.05, 0.055), hr);
    }
  }
  // glass: a whisper of blue-grey and a soft sheen across the top
  c = c * vec3(0.93, 0.95, 0.97) + vec3(0.012, 0.015, 0.02) * smoothstep(0.4, 1.0, vUv.y);
  // dark inner edge where the glass meets the housing
  c *= mix(0.55, 1.0, smoothstep(0.0, 3.0, -d));
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Mirror housing (black textured plastic), drawn in screen pixels.
const SHELL_FRAG = `
uniform vec2 uSize;
uniform float uRadius;
uniform float uBorder;
uniform float uHot;
varying vec2 vUv;
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = sdRound(p, uSize * 0.5, uRadius);
  float a = clamp(0.5 - d, 0.0, 1.0);
  float shade = mix(0.07, 0.16, vUv.y);
  float rim = smoothstep(2.5, 0.0, abs(d + 1.2));
  vec3 c = vec3(shade) + rim * 0.10;
  c = mix(c, vec3(1.0, 0.82, 0.1), uHot * smoothstep(3.0, 0.0, abs(d + uBorder * 0.5)) );
  // soft drop shadow outside the housing
  float sh = (1.0 - a) * 0.45 * smoothstep(6.0, 0.0, d);
  gl_FragColor = vec4(mix(vec3(0.0), c, a), max(a, sh));
}`;

function lowEndGuess() {
  const n = typeof navigator !== 'undefined' ? navigator : {};
  const mem = n.deviceMemory || 0;
  const cores = n.hardwareConcurrency || 0;
  return (mem && mem <= 4) || (cores && cores <= 4);
}

export class CarMirrors {
  constructor(renderer) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.half = renderer.capabilities.isWebGL2 && !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
    this.lowEnd = lowEndGuess();
    this.frame = 0;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.tmpV = new THREE.Vector3();
    this.tmpL = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
    this.ownQ = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    // [0] rear-view, [1] left wing (passenger side, screen left), [2] right wing (driver side)
    this.m = [0, 1, 2].map((k) => this.#makeMirror(k));
    this.stalk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x15171a, toneMapped: false, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.stalk.renderOrder = 0;
    this.scene.add(this.stalk);
    this.layoutKey = '';
  }

  #makeMirror(k) {
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      type: this.half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: this.lowEnd || !this.renderer.capabilities.isWebGL2 ? 0 : 4,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    const cam = new THREE.PerspectiveCamera(k === 0 ? 24 : 30, 3, 0.12, k === 0 ? 170 : 130);
    const shell = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { uSize: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 8 }, uBorder: { value: 5 }, uHot: { value: 0 } },
      vertexShader: GLASS_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }));
    shell.renderOrder = 1;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      uniforms: { map: { value: rt.texture }, uSize: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 6 }, uKind: { value: k === 0 ? 0 : 1 } },
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    glass.renderOrder = 2;
    shell.frustumCulled = glass.frustumCulled = false;
    this.scene.add(shell, glass);
    return { k, rt, cam, shell, glass, box: null, drawn: false };
  }

  // Screen boxes (CSS px) for a W x H view. Rear-view mirror at the top centre
  // of the windscreen; wing mirrors low at each side, at door-window level.
  layout(W, H) {
    // phones in landscape (index.html moves the touch buttons around these)
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const cw = Math.round(Math.min(360, Math.max(190, W * 0.25)));
    const ch = Math.round(cw * 0.27);
    const top = coarse ? 8 : 16;
    const ww = Math.round(Math.min(220, Math.max(96, W * (coarse ? 0.13 : 0.14))));
    const wh = Math.round(ww * 0.64);
    // phones: under the minimap / the top-right button rows, above the
    // touch wheel and the pedals; desktop: half-way down each side
    const wy = coarse ? Math.round(116 + Math.max(0, H - 360) * 0.3) : Math.round(H * 0.5);
    const edge = coarse ? 8 : 18;
    return [
      { x: Math.round((W - cw) / 2), y: top, w: cw, h: ch },
      { x: edge, y: wy, w: ww, h: wh },
      { x: W - edge - ww, y: wy, w: ww, h: wh },
    ];
  }

  hide() {
    for (const o of this.m) o.drawn = false;
  }

  // vehicle: the player's car (group, mesh); cockpit: the interior group;
  // aim: [[yaw, pitch] x3] from dragging the mirrors; boxes: layout() result
  render(scene, vehicle, cockpit, aim, boxes, hot = -1) {
    const r = this.renderer;
    const W = r.domElement.clientWidth;
    const H = r.domElement.clientHeight;
    const pr = r.getPixelRatio();
    const g = vehicle.group;
    g.updateMatrixWorld(true);
    const size = vehicle.mesh && vehicle.mesh.userData && vehicle.mesh.userData.size;
    const halfW = size ? size.x / 2 : 0.9;
    const halfL = size ? size.z / 2 : 2.2;
    const lift = cockpit ? cockpit.position.y : 0;

    // which mirrors refresh this frame
    this.frame++;
    const odd = this.frame & 1;
    const due = this.lowEnd ? [!odd, !!odd, !!odd] : [true, true, true];
    for (const o of this.m) if (!o.drawn) due[o.k] = true;

    // mirror passes: own car body visible, interior hidden, no shadow updates
    const meshVis = vehicle.mesh ? vehicle.mesh.visible : false;
    const ckVis = cockpit ? cockpit.visible : false;
    const sm = r.shadowMap;
    const smAuto = sm.autoUpdate;
    const smNeed = sm.needsUpdate;
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    if (vehicle.mesh) vehicle.mesh.visible = true;
    if (cockpit) cockpit.visible = false;
    const oldTarget = r.getRenderTarget();
    const oldClear = r.autoClear;
    r.autoClear = true;
    g.getWorldQuaternion(this.tmpQ);
    for (const o of this.m) {
      const b = boxes[o.k];
      const pw = Math.max(16, Math.round(b.w * pr));
      const ph = Math.max(8, Math.round(b.h * pr));
      if (o.rt.width !== pw || o.rt.height !== ph) {
        o.rt.setSize(pw, ph);
        due[o.k] = true;
      }
      if (!due[o.k]) continue;
      const c = o.cam;
      c.aspect = b.w / b.h;
      // local mirror place (front +Z, left +X)
      if (o.k === 0) this.tmpL.set(0, 1.2 + lift, -halfL - 0.02);
      else this.tmpL.set((o.k === 1 ? 1 : -1) * (halfW + 0.12), 1.0 + lift, Math.min(0.75, halfL * 0.28));
      c.position.copy(this.tmpL);
      g.localToWorld(c.position);
      // look backwards; wings toe out a little so the car side shows on the inner edge
      const a = aim && aim[o.k] ? aim[o.k] : [0, 0];
      // a camera looks down its own -Z, which in car space is straight back;
      // negative yaw turns it toward +X (the car's left side)
      const toe = o.k === 0 ? 0 : (o.k === 1 ? -1 : 1) * 0.13;
      this.euler.set((o.k === 0 ? -0.04 : -0.07) + a[1], toe + a[0], 0);
      this.ownQ.setFromEuler(this.euler);
      c.quaternion.copy(this.tmpQ).multiply(this.ownQ);
      c.near = o.k === 0 ? 0.15 : 0.05;
      c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
      r.setRenderTarget(o.rt);
      r.render(scene, c);
      o.drawn = true;
    }
    r.setRenderTarget(oldTarget);
    if (vehicle.mesh) vehicle.mesh.visible = meshVis;
    if (cockpit) cockpit.visible = ckVis;
    sm.autoUpdate = smAuto;
    sm.needsUpdate = smNeed;

    // overlay: housings + glass, in CSS pixels (y down)
    this.cam.left = 0;
    this.cam.right = W;
    this.cam.top = 0;
    this.cam.bottom = H;
    this.cam.updateProjectionMatrix();
    const place = (mesh, x, y, w, h) => {
      mesh.position.set(x + w / 2, y + h / 2, 0);
      mesh.scale.set(w, -h, 1); // y-down camera: flip so uv.y = 1 is the top
    };
    for (const o of this.m) {
      const b = boxes[o.k];
      const border = o.k === 0 ? 5 : 6;
      const rad = o.k === 0 ? b.h * 0.42 : b.h * 0.3;
      place(o.shell, b.x - border, b.y - border, b.w + border * 2, b.h + border * 2);
      const su = o.shell.material.uniforms;
      su.uSize.value.set(b.w + border * 2, b.h + border * 2);
      su.uRadius.value = rad + border;
      su.uBorder.value = border;
      su.uHot.value = hot === o.k ? 1 : 0;
      place(o.glass, b.x, b.y, b.w, b.h);
      const gu = o.glass.material.uniforms;
      gu.uSize.value.set(b.w, b.h);
      gu.uRadius.value = rad;
    }
    // the rear-view mirror hangs from the windscreen header on a short stalk
    const c0 = boxes[0];
    place(this.stalk, c0.x + c0.w / 2 - 7, 0, 14, c0.y);
    r.autoClear = false;
    r.render(this.scene, this.cam);
    r.autoClear = oldClear;
  }

  dispose() {
    for (const o of this.m) o.rt.dispose();
  }
}
