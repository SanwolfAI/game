import * as THREE from '../../vendor/three/three.module.js';
import { glowTexture } from '../game/carLights.js';

// HD light and sky (cheap enough for Hisense E32 / Samsung A04 class GPUs):
//  - sky dome: gradient + drifting clouds (one small tiling noise texture,
//    two lookups per sky pixel), sun disc, silver lining, humid horizon haze
//  - sun colour from the sun's height (deep orange low, warm white high)
//  - Durban humid haze: thicker, milkier fog in summer and on muggy days
//  - ACES filmic tone mapping (exposure tuned per time of day)
//  - night street lights: soft halo around each lamp ("bloom" without a
//    post pass) and faint light cones in the humid air under nearby lamps
// No extra render passes, no shadow maps.

// -------------------------------------------------------------- cloud noise
function cloudTexture(size = 256) {
  // tileable value-noise fBm, 5 octaves
  const data = new Uint8Array(size * size * 4);
  const rnd = (() => {
    let s = 1234567;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  })();
  const octaves = [4, 8, 16, 32, 64];
  const grids = octaves.map((n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return g;
  });
  const field = new Float32Array(size * size);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 1;
      let tot = 0;
      for (let o = 0; o < octaves.length; o++) {
        const n = octaves[o];
        const g = grids[o];
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const a = g[y0 * n + x0];
        const b = g[y0 * n + x1];
        const c = g[y1 * n + x0];
        const d = g[y1 * n + x1];
        v += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        tot += amp;
        amp *= 0.5;
      }
      v /= tot;
      field[y * size + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(((field[i] - lo) / (hi - lo)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const SKY_FRAG = `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uGlow;
uniform sampler2D uClouds; uniform float uCover; uniform float uTime; uniform vec3 uCloudLit; uniform vec3 uCloudDark;
uniform float uHaze; uniform vec3 uSunDisc;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 c = mix(uHor, uTop, t);
  if (h < 0.0) c = uHor * (1.0 + h * 0.6);
  vec3 sdir = normalize(uSunDir);
  float sd = max(dot(d, sdir), 0.0);
  c += uGlow * (pow(sd, 8.0) * 0.55 + pow(sd, 90.0) * 1.2);
  c += uSunDisc * smoothstep(0.99935, 0.99965, sd);
  if (d.y > 0.0 && uCover > 0.01) {
    vec2 p = d.xz / (d.y + 0.12);
    float n1 = texture2D(uClouds, p * 0.16 + vec2(uTime * 0.0016, uTime * 0.0007)).r;
    float n2 = texture2D(uClouds, p * 0.52 + vec2(-uTime * 0.0025, uTime * 0.0012)).r;
    float dens = n1 * 0.68 + n2 * 0.32;
    float th = 1.0 - uCover;
    float cov = smoothstep(th, th + 0.22, dens) * smoothstep(0.0, 0.2, d.y);
    float shade = smoothstep(th + 0.05, th + 0.45, dens);
    vec3 cc = mix(uCloudLit, uCloudDark, shade * 0.75);
    cc += uGlow * pow(sd, 5.0) * (1.0 - shade) * 1.3; // bright edges toward the sun
    c = mix(c, cc, cov * 0.94);
  }
  c = mix(c, uHor, (1.0 - smoothstep(0.0, 0.16, h)) * uHaze);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Kelvin -> linear RGB (Tanner Helland fit), for the sun colour
function kelvin(k, out) {
  const t = k / 100;
  let r;
  let g;
  let b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const cl = (v) => Math.min(255, Math.max(0, v)) / 255;
  return out.setRGB(cl(r), cl(g), cl(b), THREE.SRGBColorSpace);
}

const HUMID = { summer: 1, spring: 0.7, autumn: 0.65, winter: 0.3 };
const MILK = new THREE.Color(0xdde6ea);
const NIGHT_CLOUD = new THREE.Color(0x10141c);
const GREY = new THREE.Color(0x8a9096);
const WHITE = new THREE.Color(0xffffff);

export class SkyHD {
  constructor({ renderer, scene, skyDome, skyUni, props }) {
    this.renderer = renderer;
    this.scene = scene;
    this.uni = skyUni;
    this.props = props;
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    const tm = q.get('tm') || 'aces';
    this.aces = tm === 'aces';
    if (tm === 'aces') renderer.toneMapping = THREE.ACESFilmicToneMapping;
    else if (tm === 'agx') renderer.toneMapping = THREE.AgXToneMapping;
    this.off = q.get('hdsky') === '0';
    if (this.off) return;

    Object.assign(skyUni, {
      uClouds: { value: cloudTexture() },
      uCover: { value: 0.4 },
      uTime: { value: 0 },
      uCloudLit: { value: new THREE.Color(1, 1, 1) },
      uCloudDark: { value: new THREE.Color(0.6, 0.64, 0.7) },
      uHaze: { value: 0.3 },
      uSunDisc: { value: new THREE.Color(0, 0, 0) }
    });
    const mat = skyDome.material;
    mat.fragmentShader = SKY_FRAG;
    mat.uniforms = skyUni;
    mat.needsUpdate = true;
    this.sunCol = new THREE.Color();
    this.tmp = new THREE.Color();

    // ---- night street lights: halo layer over the props lamp glow points
    if (props && props.glow) {
      this.halo = new THREE.Points(
        props.glow.geometry,
        new THREE.PointsMaterial({ map: glowTexture(), size: 15, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })
      );
      this.halo.frustumCulled = false;
      this.halo.renderOrder = 6;
      this.halo.visible = false;
      scene.add(this.halo);
      // light cones under the nearest lamps (instanced, additive, no depth write)
      const cone = new THREE.CylinderGeometry(0.3, 4.2, 7.5, 14, 1, true);
      cone.translate(0, 7.5 / 2, 0);
      this.coneMat = new THREE.ShaderMaterial({
        uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.8, 0.52) } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        vertexShader: `varying float vA; varying float vY;
void main(){
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  n = mat3(instanceMatrix) * n;
#endif
  vec4 wp = modelMatrix * lp;
  vec3 v = normalize(cameraPosition - wp.xyz);
  vec3 wn = normalize(mat3(modelMatrix) * n);
  float facing = abs(dot(wn, v));
  float dist = length(cameraPosition - wp.xyz);
  vA = pow(facing, 1.6) * (1.0 - smoothstep(120.0, 220.0, dist));
  vY = position.y / 7.5;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
        fragmentShader: `uniform float uStrength; uniform vec3 uColor; varying float vA; varying float vY;
void main(){
  float a = vA * uStrength * (0.25 + 0.75 * vY * vY);
  gl_FragColor = vec4(uColor * a, 1.0);
}`
      });
      this.coneMax = 160;
      this.cones = new THREE.InstancedMesh(cone, this.coneMat, this.coneMax);
      this.cones.frustumCulled = false;
      this.cones.count = 0;
      this.cones.renderOrder = 5;
      this.cones.visible = false;
      scene.add(this.cones);
      this.poolVer = -1;
      this.coneT = 0;
      this._m = new THREE.Matrix4();
      this._p = new THREE.Vector3();
    }
  }

  // Called at the end of main.js updateEnvironment (after its own sky/fog/sun).
  update({ solar, weather, season, sunDir, sun, camera }) {
    const nowMs = performance.now();
    const dt = this.lastMs ? Math.min(0.1, (nowMs - this.lastMs) / 1000) : 0.016;
    this.lastMs = nowMs;
    if (this.aces) this.renderer.toneMappingExposure *= 1.12 + 0.08 * solar.day; // ACES is darker than Neutral
    if (this.off) return;
    const u = this.uni;
    const cloud = weather.cur.cloud;
    const day = solar.day;
    const night = solar.night;
    const hum = (HUMID[season.id] ?? 0.6) * (0.75 + 0.25 * cloud);
    u.uTime.value += dt * 60;
    u.uCover.value = Math.min(0.95, 0.22 + cloud * 0.72);

    // sun colour by height: ~1900 K at the horizon -> ~5600 K high up
    const el = Math.max(0, sunDir.y);
    kelvin(1900 + 3700 * Math.min(1, Math.pow(el / 0.55, 0.8)), this.sunCol);
    sun.color.lerp(this.sunCol, 0.65 * Math.min(1, day * 3));
    u.uSunDisc.value.copy(this.sunCol).multiplyScalar(6 * day * (1 - cloud * 0.9) * Math.min(1, el * 8 + 0.15));

    // cloud colours: white by day, warm at sunrise/sunset, dark at night
    const warm = solar.golden * Math.min(1, day * 2) * (1 - night);
    u.uCloudLit.value.copy(WHITE).lerp(this.sunCol, 0.35 + warm * 0.4).multiplyScalar(0.25 + 0.85 * day);
    u.uCloudLit.value.lerp(NIGHT_CLOUD, night * 0.9);
    u.uCloudLit.value.lerp(GREY, cloud * cloud * 0.5 * day);
    u.uCloudDark.value.copy(u.uHor.value).multiplyScalar(0.62).lerp(GREY, 0.3 * day);
    u.uCloudDark.value.lerp(NIGHT_CLOUD, night * 0.85);

    // Durban humid haze: milky horizon, fog starts closer on muggy days
    u.uHaze.value = (0.18 + 0.32 * hum) * (0.4 + 0.6 * day);
    u.uHor.value.lerp(MILK, 0.18 * hum * day * (1 - warm));
    const fog = this.scene.fog;
    if (fog) {
      fog.color.copy(u.uHor.value);
      fog.near *= 1 - 0.42 * hum * (0.5 + 0.5 * day);
      fog.far *= 1 - 0.2 * hum;
    }

    // night street lights
    if (this.halo) {
      const on = (this.props.glow && this.props.glow.visible) || false;
      this.halo.visible = on;
      this.cones.visible = on;
      if (on) {
        const n = Math.min(1, night * 1.3);
        this.halo.material.opacity = 0.2 * n;
        this.coneMat.uniforms.uStrength.value = (0.05 + 0.05 * hum) * n;
        this.coneT -= dt;
        const pools = this.props.pools;
        if (pools && (pools.instanceMatrix.version !== this.poolVer || this.coneT <= 0)) {
          this.poolVer = pools.instanceMatrix.version;
          this.coneT = 1.5; // re-pick the nearest lamps every 1.5 s
          this.#cones(pools, camera);
        }
      }
    }
  }

  #cones(pools, camera) {
    const a = pools.instanceMatrix.array;
    const cx = camera.position.x;
    const cz = camera.position.z;
    let k = 0;
    const m = this._m;
    for (let i = 0; i < pools.count && k < this.coneMax; i++) {
      const o = i * 16;
      const x = a[o + 12];
      const y = a[o + 13];
      const z = a[o + 14];
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > 200 * 200) continue;
      m.makeTranslation(x, y + 0.05, z);
      this.cones.setMatrixAt(k++, m);
    }
    this.cones.count = k;
    this.cones.instanceMatrix.needsUpdate = true;
  }
}
