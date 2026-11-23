import * as THREE from '../../vendor/three/three.module.js';
import { hdCanvas } from '../core/hdcanvas.js';
import { trafficCarModel } from '../game/carModels.js';

// School-day life at the real OSM schools (grounds.sites kind 'school'):
// learners in uniform walk the pavement to the gate in the morning
// (06:40-08:00) and stream out in the afternoon (13:30-15:45), Mon-Fri.
// Scholar transport Quantums with a yellow SCHOLAR TRANSPORT board wait at
// the kerb outside the gate over the same windows. Only the nearest few
// schools are dressed, re-picked as you drive.
const MAX_SCHOOLS = 8;
const PER = 18;
const VANS = 2;
// jersey / blazer colours SA schools wear (no real crests)
const UNIFORMS = [0x7a1f2b, 0x1f2f5c, 0x1e5a32, 0x23408f, 0x5a2a6e, 0x2b2b2b, 0x8a5a1a];
const SKIN = [0x3b2416, 0x4a2e1f, 0x5c3a26, 0x6e4a30, 0x8a6446, 0xc89a78];

function boardTexture() {
  const c = hdCanvas(256, 48);
  const g = c.getContext('2d');
  g.fillStyle = '#ffd400';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#111';
  g.font = 'bold 26px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SCHOLAR TRANSPORT', 128, 25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Learners {
  constructor(grounds, hf) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'learners';
    this.schools = (grounds ? grounds.sites : []).filter((s) => s.kind === 'school' && s.gate && s.sub !== 'university' && s.sub !== 'college');
    const N = MAX_SCHOOLS * PER;
    const body = new THREE.CapsuleGeometry(0.2, 0.62, 3, 6);
    body.translate(0, 0.62, 0);
    const shirt = new THREE.BoxGeometry(0.36, 0.3, 0.22);
    shirt.translate(0, 1.0, 0);
    const head = new THREE.SphereGeometry(0.13, 6, 5);
    head.translate(0, 1.3, 0);
    const bag = new THREE.BoxGeometry(0.28, 0.34, 0.14);
    bag.translate(0, 0.98, -0.17);
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.mBody = new THREE.InstancedMesh(body, lam(0xffffff), N);
    this.mShirt = new THREE.InstancedMesh(shirt, lam(0xf4f4f0), N);
    this.mHead = new THREE.InstancedMesh(head, lam(0xffffff), N);
    this.mBag = new THREE.InstancedMesh(bag, lam(0xffffff), N);
    for (const m of [this.mBody, this.mShirt, this.mHead, this.mBag]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      this.mHead.setColorAt(i, col.setHex(SKIN[(i * 7) % SKIN.length]));
      this.mBag.setColorAt(i, col.setHex([0x111111, 0x2a3f8f, 0xb02020, 0x333333, 0x1d6b3a][(i * 3) % 5]));
      this.mBody.setColorAt(i, col.setHex(0x333333));
    }
    this.slots = [];
    for (let k = 0; k < MAX_SCHOOLS; k++) {
      const kids = [];
      for (let j = 0; j < PER; j++) kids.push({ a: 0, side: 1, sp: 1.1 + Math.random() * 0.5, lane: Math.random() });
      this.slots.push({ site: null, kids, vans: [] });
    }
    this.vanBoard = new THREE.MeshBasicMaterial({ map: boardTexture(), side: THREE.DoubleSide });
    this.vanBoardGeo = new THREE.PlaneGeometry(1.7, 0.32);
    this.vanPool = [];
    this.acc = 9;
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.Y = new THREE.Vector3(0, 1, 0);
    this.p = new THREE.Vector3();
    this.one = new THREE.Vector3(1, 1, 1);
  }

  #van() {
    const model = trafficCarModel('quantum');
    if (!model) return null;
    const g = new THREE.Group();
    for (const part of model.parts) {
      const m = new THREE.Mesh(part.geometry, part.material);
      if (part.paint) {
        m.material = part.material.clone();
        if (m.material.color) m.material.color.setHex(0xf2f2ee);
      }
      g.add(m);
    }
    const b = new THREE.Mesh(this.vanBoardGeo, this.vanBoard);
    b.position.set(0, 2.35, 0.6);
    b.rotation.y = Math.PI / 2;
    const b2 = b.clone();
    b2.rotation.y = 0;
    b2.position.set(0, 2.35, 2.0);
    g.add(b, b2);
    this.group.add(g);
    return g;
  }

  // 0 none, 1 morning (walking in), 2 afternoon (walking out)
  static phase(now) {
    const d = now.getDay();
    if (d === 0 || d === 6) return 0;
    const h = now.getHours() + now.getMinutes() / 60;
    if (h >= 6.66 && h < 8) return 1;
    if (h >= 13.5 && h < 15.75) return 2;
    return 0;
  }

  update(dt, x, z, now) {
    const phase = Learners.phase(now);
    this.acc += dt;
    if (this.acc > 2) {
      this.acc = 0;
      // re-pick the nearest schools
      const near = phase ? this.schools.map((s) => ({ s, d: Math.hypot(s.gate.x - x, s.gate.z - z) })).filter((o) => o.d < 450).sort((a, b) => a.d - b.d).slice(0, MAX_SCHOOLS).map((o) => o.s) : [];
      const keep = new Set(near);
      for (const sl of this.slots) if (sl.site && !keep.has(sl.site)) this.#release(sl);
      for (const s of near) {
        if (this.slots.some((sl) => sl.site === s)) continue;
        const free = this.slots.find((sl) => !sl.site);
        if (free) this.#assign(free, s, phase);
      }
    }
    // walk
    let n = 0;
    const col = new THREE.Color();
    for (const sl of this.slots) {
      const s = sl.site;
      if (!s) continue;
      const g = s.gate;
      for (const k of sl.kids) {
        if (phase === 1) {
          k.a -= Math.sign(k.a) * k.sp * dt;
          if (Math.abs(k.a) < g.half) k.a = (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 40);
        } else {
          k.a += Math.sign(k.a || 1) * k.sp * dt;
          if (Math.abs(k.a) > 80) k.a = (Math.random() < 0.5 ? -1 : 1) * (g.half * 0.5);
        }
        const off = 2.2 + k.lane * 1.4; // on the pavement outside the fence
        const px = g.x + g.ux * k.a - g.nx * off;
        const pz = g.z + g.uz * k.a - g.nz * off;
        const dir = phase === 1 ? -Math.sign(k.a) : Math.sign(k.a || 1);
        this.q.setFromAxisAngle(this.Y, Math.atan2(g.ux * dir, g.uz * dir));
        this.p.set(px, this.hf.heightAt(px, pz) + Math.abs(Math.sin(k.a * 2.4)) * 0.04, pz);
        this.m4.compose(this.p, this.q, this.one);
        this.mBody.setMatrixAt(n, this.m4);
        this.mShirt.setMatrixAt(n, this.m4);
        this.mHead.setMatrixAt(n, this.m4);
        this.mBag.setMatrixAt(n, this.m4);
        this.mBody.setColorAt(n, col.setHex(sl.uniform));
        n++;
      }
    }
    for (const m of [this.mBody, this.mShirt, this.mHead, this.mBag]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  #assign(sl, s, phase) {
    sl.site = s;
    let h = 0;
    for (const ch of s.name || 'x') h = (h * 31 + ch.charCodeAt(0)) | 0;
    sl.uniform = UNIFORMS[Math.abs(h) % UNIFORMS.length];
    const g = s.gate;
    for (const k of sl.kids) k.a = (Math.random() < 0.5 ? -1 : 1) * (phase === 1 ? g.half + Math.random() * 70 : g.half * 0.5 + Math.random() * 60);
    // scholar transport at the kerb beyond the pavement, nose along the street
    for (let v = 0; v < VANS; v++) {
      const van = this.vanPool.pop() || this.#van();
      if (!van) break;
      const a = (v ? -1 : 1) * (g.half + 9 + v * 2);
      const vx = g.x + g.ux * a - g.nx * 6.5;
      const vz = g.z + g.uz * a - g.nz * 6.5;
      van.position.set(vx, this.hf.heightAt(vx, vz), vz);
      van.rotation.y = Math.atan2(g.ux, g.uz);
      van.visible = true;
      sl.vans.push(van);
    }
  }

  #release(sl) {
    sl.site = null;
    for (const v of sl.vans) {
      v.visible = false;
      this.vanPool.push(v);
    }
    sl.vans = [];
  }
}
