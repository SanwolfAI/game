import * as THREE from '../../vendor/three/three.module.js';

// Player car lights: glowing lamp discs + soft flares (cheap, always on at
// night), one real SpotLight for the headlight beam, an additive light pool
// on the road ahead, and brake / reverse lamps.

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

let poolTex = null;
function beamTexture() {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  // elongated, brighter near the car, fading with distance and at the sides
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 64; x++) {
      const u = (x - 31.5) / 32;
      const v = y / 127; // 0 = near the car, 1 = far
      const width = 0.35 + v * 0.65;
      const side = Math.max(0, 1 - Math.pow(Math.abs(u) / width, 2));
      const along = Math.pow(1 - v, 0.9) * Math.min(1, v * 6 + 0.25);
      const a = side * along;
      const i = (y * 64 + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 240;
      img.data[i + 2] = 210;
      img.data[i + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  g.putImageData(img, 0, 0);
  poolTex = new THREE.CanvasTexture(c);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

export class CarLights {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'car-lights';
    const glow = glowTexture();
    this.headMat = new THREE.SpriteMaterial({ map: glow, color: 0xfff2d6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.tailMat = new THREE.SpriteMaterial({ map: glow, color: 0xff2a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.revMat = new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.ambMat = new THREE.SpriteMaterial({ map: glow, color: 0xffa020, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    // indicator lamps: front-left, rear-left, front-right, rear-right (left = +X)
    this.ambers = [new THREE.Sprite(this.ambMat), new THREE.Sprite(this.ambMat), new THREE.Sprite(this.ambMat), new THREE.Sprite(this.ambMat)];
    for (const a of this.ambers) {
      a.visible = false;
      a.renderOrder = 5;
      a.scale.set(0.75, 0.55, 1);
      this.group.add(a);
    }
    this.heads = [new THREE.Sprite(this.headMat), new THREE.Sprite(this.headMat)];
    this.tails = [new THREE.Sprite(this.tailMat), new THREE.Sprite(this.tailMat)];
    this.revs = [new THREE.Sprite(this.revMat), new THREE.Sprite(this.revMat)];
    for (const s of this.heads.concat(this.tails, this.revs)) {
      s.renderOrder = 5;
      this.group.add(s);
    }

    this.spot = new THREE.SpotLight(0xfff0d8, 0, 85, 0.55, 0.65, 1.2);
    this.spot.target.position.set(0, 0, 30);
    this.group.add(this.spot, this.spot.target);

    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.translate(0, 0, 0.5);
    this.pool = new THREE.Mesh(
      poolGeo,
      new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    );
    this.pool.renderOrder = 3;
    this.group.add(this.pool);
    this.layout({ length: 4.4, width: 1.7 });
  }

  // Place lamps for a car of the given size (vehicle space: front = +Z, y up).
  layout({ length, width, headY = 0.68, tailY = 0.8, lamps = null }) {
    const hz = length / 2;
    let hx = width * 0.33;
    let hy = headY;
    let tx = width * 0.36;
    let ty = tailY;
    let hzz = hz;
    let tzz = -hz;
    if (lamps && !lamps.head.isEmpty()) {
      const c = lamps.head.getCenter(new THREE.Vector3());
      const s = lamps.head.getSize(new THREE.Vector3());
      hx = Math.max(0.35, s.x * 0.36);
      hy = c.y;
      hzz = lamps.head.max.z;
    }
    if (lamps && !lamps.tail.isEmpty()) {
      const c = lamps.tail.getCenter(new THREE.Vector3());
      const s = lamps.tail.getSize(new THREE.Vector3());
      tx = Math.max(0.35, s.x * 0.38);
      ty = c.y;
      tzz = lamps.tail.min.z;
    }
    this.heads[0].position.set(hx, hy, hzz + 0.05);
    this.heads[1].position.set(-hx, hy, hzz + 0.05);
    this.tails[0].position.set(tx, ty, tzz - 0.05);
    this.tails[1].position.set(-tx, ty, tzz - 0.05);
    this.revs[0].position.set(tx * 0.55, ty - 0.08, tzz - 0.06);
    this.revs[1].position.set(-tx * 0.55, ty - 0.08, tzz - 0.06);
    const ax = width / 2 - 0.08;
    this.ambers[0].position.set(ax, hy, hzz);
    this.ambers[1].position.set(ax, ty, tzz);
    this.ambers[2].position.set(-ax, hy, hzz);
    this.ambers[3].position.set(-ax, ty, tzz);
    this.spot.position.set(0, hy + 0.1, hzz);
    this.spot.target.position.set(0, -1.5, hzz + 30);
    this.pool.position.set(0, 0.05, hzz + 0.6);
    this.pool.scale.set(9, 1, 34);
  }

  // mode: 'auto' | 'on' | 'high' | 'off'; blink: { left, right } lamp states this frame
  update(night, braking, reversing, camDist = 10, mode = 'auto', blink = null) {
    const on = mode === 'on' || mode === 'high' || (mode === 'auto' && night > 0.15);
    const high = mode === 'high';
    const k = mode === 'auto' ? Math.min(1, night * 1.4) : Math.max(0.55, Math.min(1, night * 1.4));
    if (blink) {
      this.ambers[0].visible = this.ambers[1].visible = !!blink.left;
      this.ambers[2].visible = this.ambers[3].visible = !!blink.right;
    }
    const hs = on ? 1.1 + k * 0.5 : 0;
    for (const s of this.heads) {
      s.visible = on;
      s.scale.set(hs, hs * 0.6, 1);
    }
    this.headMat.opacity = k;
    const tailOn = on || braking;
    const ts = braking ? 1.0 : 0.6;
    for (const s of this.tails) {
      s.visible = tailOn;
      s.scale.set(ts, ts * 0.6, 1);
    }
    this.tailMat.opacity = braking ? 1 : 0.7 * k;
    for (const s of this.revs) {
      s.visible = reversing;
      s.scale.set(0.55, 0.4, 1);
    }
    this.revMat.opacity = 0.9;
    this.spot.intensity = on ? (high ? 75 : 38) * Math.max(k, night) : 0;
    this.spot.distance = high ? 170 : 85;
    this.spot.angle = high ? 0.42 : 0.55;
    this.pool.scale.set(high ? 11 : 9, 1, high ? 60 : 34);
    this.pool.visible = on;
    this.pool.material.opacity = (high ? 0.5 : 0.42) * Math.max(night, 0.15) * (on ? 1 : 0);
    void camDist;
  }
}
