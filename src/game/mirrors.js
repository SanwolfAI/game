import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';
import { renderMirrorView, mirrorDue } from '../core/mirrorCache.js';

// Real car mirrors for the inside (driver) view.
// Bheko, 23-24 Nov 2026: "the mirrors are not attached to the car, they're
// floating. When I look in the mirrors I need to see the tail of the car and
// what's behind me" / "the mirrors are fuzzy".
//
// Three REAL 3D mirrors, part of the car, each with its own camera at its
// own place on the car:
//   - rear-view mirror: hangs on a stalk from the top of the windscreen. Its
//     camera sits at the mirror and looks back through the cabin and the rear
//     window, so the front headrests, rear seats, parcel shelf and C-pillars
//     (cockpit.js builds them) frame the road behind.
//   - left and right wing mirrors: housings on a base at the front corner of
//     each door window, outside the glass. Their cameras sit in the housings
//     with the car body VISIBLE, aimed back along the side of the car, so the
//     flank and the tail of your own car fill the inner edge of the glass and
//     the lane behind fills the rest.
// The picture is flipped left-right (a mirror), drawn into a render target
// sized to the pixels the glass covers on screen times the device pixel ratio
// (never stretched up), with linear filtering.
// Budget phones (Hisense E32 Pro, Samsung A04): the rear-view mirror updates on
// even frames and the two wing mirrors on odd frames, no MSAA, short draw
// distance, no shadow-map work in the mirror passes, and the housings are one
// merged mesh.

const GLASS_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// uKind 0 = rear-view, 1 = wing. uAspect = glass width / height.
const GLASS_FRAG = `
uniform sampler2D map;
uniform float uAspect;
uniform float uRadius;
varying vec2 vUv;
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float d = sdRound(p, vec2(uAspect, 1.0) * 0.5, uRadius);
  if (d > 0.0) discard;
  vec3 c = texture2D(map, vec2(1.0 - vUv.x, vUv.y)).rgb; // a mirror flips left-right
  // glass: a whisper of blue-grey and a soft sheen across the top
  c = c * vec3(0.92, 0.94, 0.97) + vec3(0.015, 0.018, 0.024) * smoothstep(0.45, 1.0, vUv.y);
  // dark edge where the glass meets the housing
  c *= mix(0.45, 1.0, smoothstep(0.0, 0.05, -d));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function lowEndGuess() {
  const n = typeof navigator !== 'undefined' ? navigator : {};
  const mem = n.deviceMemory || 0;
  const cores = n.hardwareConcurrency || 0;
  return (mem && mem <= 4) || (cores && cores <= 4);
}

// a rounded slab: w x h, d deep (along z), corner radius r, bevelled edges
function slab(w, h, d, r, bevel = 0.006) {
  const s = new THREE.Shape();
  const x = -w / 2 + bevel;
  const y = -h / 2 + bevel;
  const W = w - bevel * 2;
  const H = h - bevel * 2;
  const R = Math.max(0.001, Math.min(r, W / 2, H / 2));
  s.moveTo(x + R, y);
  s.lineTo(x + W - R, y);
  s.quadraticCurveTo(x + W, y, x + W, y + R);
  s.lineTo(x + W, y + H - R);
  s.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
  s.lineTo(x + R, y + H);
  s.quadraticCurveTo(x, y + H, x, y + H - R);
  s.lineTo(x, y + R);
  s.quadraticCurveTo(x, y, x + R, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, -(d - bevel * 2) / 2);
  return g;
}

function bake(list, geo, m) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.applyMatrix4(m);
  list.push(g);
}

// Mirror sizes (metres). The wing glass is a little bigger than a real E30's
// (about 1.4x) so it reads on a phone; the rear-view is true to size.
const REAR = { w: 0.29, h: 0.082 };
const WING = { w: 0.23, h: 0.145 };
// where the mirrors hang (cockpit space); cockpit.userData.mirror overrides
const DEFAULT_SPEC = { rearY: 1.335, rearZ: 0.5, roofY: 1.41, wingY: 0.99, wingZ: 0.86, wingZL: 0.86 };

export class CarMirrors {
  constructor(renderer) {
    this.renderer = renderer;
    this.lowEnd = lowEndGuess();
    const gl = renderer.getContext();
    // half-float targets keep the dark end smooth (no banding in the shade)
    this.half = renderer.capabilities.isWebGL2 && !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
    this.frame = 0;
    this.tmpV = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
    this.ownQ = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.corner = new THREE.Vector3();
    this.group = new THREE.Group();
    this.group.name = 'mirrorSet';
    this.mount = null;
    this.layoutKey = '';
    const shellMat = new THREE.MeshLambertMaterial({ color: 0x17181b });
    this.shellMat = shellMat;
    // [0] rear-view, [1] left wing (passenger side), [2] right wing (driver side)
    this.m = [0, 1, 2].map((k) => this.#makeMirror(k));
    this.shell = null;
  }

  #makeMirror(k) {
    const rt = new THREE.WebGLRenderTarget(16, 16, {
      type: this.half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
    const size = k === 0 ? REAR : WING;
    const cam = new THREE.PerspectiveCamera(k === 0 ? 17 : 26, size.w / size.h, 0.05, k === 0 ? 140 : 100);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), new THREE.ShaderMaterial({
      uniforms: { map: { value: rt.texture }, uAspect: { value: size.w / size.h }, uRadius: { value: k === 0 ? 0.42 : 0.22 } },
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
    }));
    glass.name = k === 0 ? 'mirrorRear' : k === 1 ? 'mirrorLeft' : 'mirrorRight';
    // a plane faces +z; turn it to face the driver (-z, the back of the car)
    const holder = new THREE.Group();
    holder.add(glass);
    glass.rotation.y = Math.PI;
    glass.position.z = -0.012;
    this.group.add(holder);
    return { k, rt, cam, glass, holder, size, drawn: false, px: 0 };
  }

  // Place the three mirrors on the car (vehicle space: front +Z, left +X) and
  // build the housings once per body size. lift raises everything for vans.
  #place(halfW, halfL, lift, eye, sp) {
    const key = `${halfW.toFixed(2)}|${halfL.toFixed(2)}|${lift.toFixed(2)}|${sp.rearY}|${sp.wingY}|${sp.wingZ}|${sp.wingZL}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const parts = [];
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const E = new THREE.Euler();
    const S = new THREE.Vector3(1, 1, 1);
    const P = new THREE.Vector3();
    // rear-view: top centre of the windscreen, angled toward the driver's eye
    const r = this.m[0];
    r.holder.position.set(0, sp.rearY + lift, sp.rearZ);
    r.holder.rotation.set(-0.06, Math.atan2(-eye.x, 0.75) * 0.5, 0);
    r.holder.updateMatrix();
    bake(parts, slab(REAR.w + 0.022, REAR.h + 0.022, 0.035, 0.03, 0.008), r.holder.matrix.clone().multiply(M.makeTranslation(0, 0, 0.006)));
    // stalk up to the roof lining
    const sl = Math.max(0.03, sp.roofY - sp.rearY - REAR.h / 2);
    const stalk = new THREE.CylinderGeometry(0.008, 0.011, sl, 8);
    bake(parts, stalk, M.compose(P.set(0, sp.rearY + REAR.h / 2 + sl / 2 + lift, sp.rearZ + 0.02), Q.setFromEuler(E.set(0.25, 0, 0)), S));
    bake(parts, slab(0.07, 0.022, 0.05, 0.01, 0.004), M.compose(P.set(0, sp.roofY - 0.008 + lift, sp.rearZ + 0.035), Q.identity(), S));
    // wing mirrors: front corner of each door window, outside the glass
    for (const k of [1, 2]) {
      const o = this.m[k];
      const s = k === 1 ? 1 : -1;
      const x = s * (halfW + 0.1);
      const y = sp.wingY + lift;
      // RHD: the far (passenger) mirror sits a little further forward so it
      // stays on screen through the left door window
      const z = k === 1 && sp.wingZL !== undefined ? sp.wingZL : sp.wingZ;
      o.holder.position.set(x, y, z);
      // face back, turned in toward the driver's eye so the glass reads
      const toEye = Math.atan2(eye.x - x, z - eye.z);
      o.holder.rotation.set(0, -toEye * 0.7, 0);
      o.holder.updateMatrix();
      const hm = o.holder.matrix;
      // housing: a deep rounded shell behind the glass, body-colour free
      bake(parts, slab(WING.w + 0.03, WING.h + 0.03, 0.075, 0.045, 0.012), hm.clone().multiply(M.makeTranslation(0, 0, 0.03)));
      // the base: a short arm to the door's front corner (the sail)
      const arm = slab(0.13, 0.05, 0.06, 0.02, 0.008);
      bake(parts, arm, M.compose(P.set(s * (halfW + 0.02), y - 0.045, z + 0.05), Q.setFromEuler(E.set(0, 0, s * 0.18)), S));
      bake(parts, slab(0.05, 0.11, 0.16, 0.02, 0.008), M.compose(P.set(s * (halfW - 0.03), y - 0.07, z + 0.06), Q.identity(), S));
    }
    const geo = mergeGeometries(parts);
    geo.computeVertexNormals();
    if (this.shell) {
      this.shell.geometry.dispose();
      this.shell.geometry = geo;
    } else {
      this.shell = new THREE.Mesh(geo, this.shellMat);
      this.shell.name = 'mirrorHousings';
      this.group.add(this.shell);
    }
  }

  hide() {
    for (const o of this.m) o.drawn = false;
    this.group.visible = false;
  }

  // Screen boxes (CSS px) of the three glasses as seen by `camera`, for the
  // drag-to-aim hit areas. Null for a mirror off screen.
  screenBoxes(camera, W, H) {
    return this.m.map((o) => this.#box(o, camera, W, H));
  }

  #box(o, camera, W, H) {
    o.glass.updateWorldMatrix(true, false);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      this.corner.set(u * o.size.w, v * o.size.h, 0).applyMatrix4(o.glass.matrixWorld).project(camera);
      if (this.corner.z > 1) return null;
      const sx = (this.corner.x * 0.5 + 0.5) * W;
      const sy = (0.5 - this.corner.y * 0.5) * H;
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
    if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // scene: the world; camera: the driver's camera; vehicle: the player's car;
  // cockpit: the interior group (the mirrors are mounted in it);
  // aim: [[yaw, pitch] x3] from dragging the mirrors
  render(scene, camera, vehicle, cockpit, aim) {
    const r = this.renderer;
    if (!cockpit) return;
    if (this.mount !== cockpit) {
      cockpit.add(this.group);
      this.mount = cockpit;
    }
    this.group.visible = true;
    const W = r.domElement.clientWidth;
    const H = r.domElement.clientHeight;
    // never upscale: at least the device's pixels (capped at 2x for phones)
    const pr = Math.max(r.getPixelRatio(), Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
    const g = vehicle.group;
    const size = vehicle.mesh && vehicle.mesh.userData && vehicle.mesh.userData.size;
    // the mesh size includes the factory wing mirrors: the door skin is ~5 cm in
    const halfW = size ? size.x / 2 - 0.07 : 0.84;
    const halfL = size ? size.z / 2 : 2.2;
    const lift = cockpit.position.y;
    const eye = cockpit.userData.eye ? this.tmpV.fromArray(cockpit.userData.eye) : this.tmpV.set(-0.36, 1.13, -0.22);
    const sp = cockpit.userData.mirror || DEFAULT_SPEC;
    this.#place(halfW, halfL, 0, eye, sp);
    g.updateMatrixWorld(true);

    // which mirrors refresh this frame
    this.frame++;
    // GFX.live.mirrorEvery (mirrorCache.js) sets the rate: mirrors take turns
    // when the performance safety cuts it; low-end alternates rear / wings
    const odd = this.frame & 1;
    const due = [0, 1, 2].map((k) => mirrorDue(k));
    if (this.lowEnd && due.every(Boolean)) due.splice(0, 3, !odd, !!odd, !!odd);

    // size each target to the glass on screen x pixel ratio
    camera.updateMatrixWorld();
    for (const o of this.m) {
      const b = this.#box(o, camera, W, H);
      const pw = b ? b.w : 64;
      const ph = b ? b.h : 24;
      const tw = Math.min(768, Math.max(64, Math.ceil((pw * pr) / 8) * 8));
      const th = Math.min(384, Math.max(24, Math.ceil(((tw / o.size.w) * o.size.h) / 4) * 4));
      // only resize on a real change (a drifting fov would realloc every frame)
      if (!o.drawn || Math.abs(tw - o.rt.width) > o.rt.width * 0.15) {
        if (o.rt.width !== tw || o.rt.height !== th) o.rt.setSize(tw, th);
        due[o.k] = true;
      }
      if (!o.drawn) due[o.k] = true;
    }

    const meshVis = vehicle.mesh ? vehicle.mesh.visible : false;
    const sm = r.shadowMap;
    const smAuto = sm.autoUpdate;
    const smNeed = sm.needsUpdate;
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    const oldTarget = r.getRenderTarget();
    const oldClear = r.autoClear;
    r.autoClear = true;
    // the mirror glass must never be drawn into its own picture
    this.group.visible = false;
    const wheel = cockpit.userData.hideInMirror;
    g.getWorldQuaternion(this.tmpQ);
    for (const o of this.m) {
      if (!due[o.k]) continue;
      const c = o.cam;
      const a = aim && aim[o.k] ? aim[o.k] : [0, 0];
      if (o.k === 0) {
        // rear-view: look back through the cabin (interior shown, the outside
        // body hidden: from inside you only see its glass and pillars, which
        // the cockpit draws)
        c.position.set(0, sp.rearY - 0.01 + lift, sp.rearZ - 0.03);
        if (vehicle.mesh) vehicle.mesh.visible = false;
        cockpit.visible = true;
        if (wheel) for (const w of wheel) w.visible = false;
        this.euler.set(-0.035 + a[1], a[0], 0);
      } else {
        // wing: in the housing, own car body visible, interior hidden
        const s = o.k === 1 ? 1 : -1;
        // just behind and outboard of the car model's own mirror, so its
        // housing never blocks the view; ~13 cm out from the door skin
        c.position.set(s * (halfW + 0.13), sp.wingY + lift, sp.camZ !== undefined ? sp.camZ : sp.wingZ - 0.08);
        if (vehicle.mesh) vehicle.mesh.visible = true;
        cockpit.visible = false;
        // straight back, toed out a touch: the flank and tail of the car
        // run along the inner third, the lane behind fills the rest.
        // A camera looks down its own -Z (= car's back); negative yaw turns
        // it toward +X (the car's left side).
        const toe = (o.k === 1 ? -1 : 1) * 0.06;
        this.euler.set(-0.05 + a[1], toe + a[0], 0);
      }
      c.position.applyMatrix4(g.matrixWorld);
      this.ownQ.setFromEuler(this.euler);
      c.quaternion.copy(this.tmpQ).multiply(this.ownQ);
      c.aspect = o.size.w / o.size.h;
      c.updateProjectionMatrix();
      c.updateMatrixWorld(true);
      renderMirrorView(r, scene, c, o.k, 0, 0, o.rt.width, o.rt.height, o.rt);
      if (wheel && o.k === 0) for (const w of wheel) w.visible = true;
      o.drawn = true;
    }
    r.setRenderTarget(oldTarget);
    r.autoClear = oldClear;
    if (vehicle.mesh) vehicle.mesh.visible = meshVis;
    cockpit.visible = true;
    this.group.visible = true;
    sm.autoUpdate = smAuto;
    sm.needsUpdate = smNeed;
  }

  dispose() {
    for (const o of this.m) o.rt.dispose();
    if (this.shell) this.shell.geometry.dispose();
  }
}
