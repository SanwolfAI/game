import * as THREE from '../../vendor/three/three.module.js';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { clone as skeletonClone } from '../../vendor/three/utils/SkeletonUtils.js';

// ---- real animated people (Quaternius Ultimate Modular Men & Women, CC0) ----
// Eight rigged characters share one 62-bone skeleton and the clips Idle, Walk,
// Run, Wave and Interact (src/assets/people/*.glb). Each character is merged
// into ONE skinned mesh (one draw call per person) with a per-vertex colour
// slot (skin, hair, top, trousers, shoes...). Every person on screen is a
// SkeletonUtils clone that shares the merged position/normal/skin buffers and
// only owns its colour buffer, so skin tone and clothes vary per person.
// A small pool (default 30) of these is handed to the nearest people; the
// rest of the crowd stays on the cheap instanced bodies in streetLife.js.

export const HUMAN_MODELS = ['male_casual_2', 'male_casual_hoodie', 'male_suit', 'male_worker', 'female_casual', 'female_formal', 'female_suit', 'female_worker'];
const HEIGHT = 1.7; // metres, before the per-person scale
const WALK_BASE = 1.15; // m/s the Walk clip covers at timeScale 1 (scaled to 1.7 m)
const RUN_BASE = 3.2;

// colour slots
const S_KEEP = 0;
const S_SKIN = 1;
const S_SKIN2 = 2;
const S_HAIR = 3;
const S_HAIR2 = 4;
const S_BROW = 5;
const S_TOP = 6;
const S_BOTTOM = 7;
const S_SHOE = 8;
const S_SOLE = 9;
const S_TOP2 = 10;
const N_SLOT = 11;

let LIB = null;
let MAT = null;

export function humansReady() {
  return LIB;
}

function parse(loader, buf) {
  return new Promise((res, rej) => loader.parse(buf, '', res, rej));
}

export async function loadHumans(base = './src/assets/people/') {
  try {
    const loader = new GLTFLoader();
    const bufs = await Promise.all(HUMAN_MODELS.map((n) => fetch(base + n + '.glb').then((r) => {
      if (!r.ok) throw new Error(n + ' ' + r.status);
      return r.arrayBuffer();
    })));
    MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
    MAT.name = 'human';
    const lib = {};
    for (let i = 0; i < HUMAN_MODELS.length; i++) {
      const g = await parse(loader, bufs[i]);
      lib[HUMAN_MODELS[i]] = buildTemplate(HUMAN_MODELS[i], g);
    }
    LIB = lib;
  } catch (err) {
    console.warn('[IZK] animated people not loaded', err);
    LIB = null;
  }
  return LIB;
}

// Which colour slot a primitive takes, from its body part and material name.
function roleOf(part, mat, model) {
  if (/^Skin_Dark/i.test(mat)) return S_SKIN2;
  if (/^Skin/i.test(mat)) return S_SKIN;
  if (/^Eye$/i.test(mat)) return S_KEEP;
  if (/^Worker_|^Gold$|^Tie$/.test(mat)) return S_KEEP;
  if (part === 'Head') {
    if (/Eyebrows|Moustache|^Brown$/.test(mat)) return S_BROW;
    if (/Hair_Brown/.test(mat)) return S_HAIR2;
    return S_HAIR;
  }
  if (part === 'Feet') return /White/.test(mat) ? S_SOLE : S_SHOE;
  if (part === 'Body') {
    if (model.endsWith('suit') && mat === 'White') return S_KEEP; // shirt under the jacket
    return S_TOP;
  }
  if (part === 'Legs') return S_BOTTOM;
  return S_KEEP;
}

function buildTemplate(name, gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const prims = [];
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    let p = o;
    while (p.parent && p.parent.name !== 'CharacterArmature') p = p.parent;
    const part = p.name.split('_').pop();
    if (part === 'Pistol') return; // the suit character ships holding a gun
    prims.push({ mesh: o, part, mat: o.material.name });
  });
  // Body Legs: when the same material spans body and legs (suit, dress) it
  // takes the top colour so the outfit matches.
  const bodyMats = new Set();
  for (const pr of prims) if (pr.part === 'Body') bodyMats.add(pr.mat);
  let nv = 0;
  let ni = 0;
  for (const pr of prims) {
    pr.role = roleOf(pr.part, pr.mat, name);
    if (pr.role === S_BOTTOM && bodyMats.has(pr.mat)) pr.role = S_TOP;
    nv += pr.mesh.geometry.attributes.position.count;
    ni += pr.mesh.geometry.index.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const si = new Uint16Array(nv * 4);
  const sw = new Float32Array(nv * 4);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const slot = new Uint8Array(nv);
  const keepCol = new Float32Array(nv * 3);
  let vo = 0;
  let io = 0;
  for (const pr of prims) {
    // getX/Y/Z/W read through interleaving and dequantise normalised data
    const at = pr.mesh.geometry.attributes;
    const n = at.position.count;
    for (let k = 0; k < n; k++) {
      const o3 = (vo + k) * 3;
      const o4 = (vo + k) * 4;
      pos[o3] = at.position.getX(k);
      pos[o3 + 1] = at.position.getY(k);
      pos[o3 + 2] = at.position.getZ(k);
      nor[o3] = at.normal.getX(k);
      nor[o3 + 1] = at.normal.getY(k);
      nor[o3 + 2] = at.normal.getZ(k);
      si[o4] = at.skinIndex.getX(k);
      si[o4 + 1] = at.skinIndex.getY(k);
      si[o4 + 2] = at.skinIndex.getZ(k);
      si[o4 + 3] = at.skinIndex.getW(k);
      sw[o4] = at.skinWeight.getX(k);
      sw[o4 + 1] = at.skinWeight.getY(k);
      sw[o4 + 2] = at.skinWeight.getZ(k);
      sw[o4 + 3] = at.skinWeight.getW(k);
    }
    const src = pr.mesh.geometry.index;
    for (let k = 0; k < src.count; k++) idx[io + k] = src.getX(k) + vo;
    const c = pr.mesh.material.color;
    for (let k = 0; k < n; k++) {
      slot[vo + k] = pr.role;
      keepCol[(vo + k) * 3] = c.r;
      keepCol[(vo + k) * 3 + 1] = c.g;
      keepCol[(vo + k) * 3 + 2] = c.b;
    }
    vo += n;
    io += src.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const skeleton = prims[0].mesh.skeleton;
  // remove the source meshes (and the pistol) from the template
  const drop = [];
  scene.traverse((o) => {
    if (o.isSkinnedMesh) drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  const merged = new THREE.SkinnedMesh(geo, MAT);
  merged.name = 'body';
  scene.add(merged);
  scene.updateMatrixWorld(true);
  merged.bind(skeleton, new THREE.Matrix4());
  // in place animation, feet at y=0: a fixed sphere avoids a costly skinned
  // bounds pass per clone
  merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.25);
  merged.castShadow = false;
  merged.receiveShadow = false;

  const clips = {};
  for (const a of gltf.animations) clips[a.name] = a;
  return { name, scene, geo, slot, keepCol, nv, tris: ni / 3, clips, female: name.startsWith('female') };
}

// ---- colours ---------------------------------------------------------------
const C = (hs) => hs.map((h) => new THREE.Color(h));
// Durban mix: ~78% Black African, 12% Indian, 6% White, 4% Coloured.
const SKIN_AFR = C(['#3b2219', '#432719', '#4a2c1d', '#55321f', '#5b3624', '#643a24', '#6e4129', '#7a472c']);
const SKIN_IND = C(['#7d4c2f', '#8a5636', '#96623f', '#a26c47']);
const SKIN_WHT = C(['#e3b896', '#d9a77e', '#efc8a6', '#c99572']);
const SKIN_COL = C(['#8d5a39', '#9a6542', '#a8744d', '#7f4f33']);
const HAIR_DARK = C(['#0b0908', '#120d0a', '#16100c', '#1a1410']);
const HAIR_WHT = C(['#2a1d14', '#4a3420', '#7a5a34', '#a8844e', '#16100c']);
const HAIR_TINT = C(['#3a1414', '#2a1d14', '#5a2a18']);
const SHOES = C(['#121212', '#1a1a1a', '#f0f0ee', '#3b2a1e', '#5a4632', '#202838', '#d9d9d6']);
const SUIT = C(['#15181f', '#1c2433', '#22262c', '#2c2f35', '#3a3d42', '#2b2219', '#101010']);
const WORK_PANTS = C(['#1f2a44', '#24324d', '#3a3a3a', '#5c4a35', '#2d3e5c']);

export function skinTone(r) {
  // r in [0,1): stable per person
  if (r < 0.78) return { color: SKIN_AFR[Math.floor((r / 0.78) * SKIN_AFR.length)], eth: 0 };
  if (r < 0.9) return { color: SKIN_IND[Math.floor(((r - 0.78) / 0.12) * SKIN_IND.length)], eth: 1 };
  if (r < 0.96) return { color: SKIN_WHT[Math.floor(((r - 0.9) / 0.06) * SKIN_WHT.length)], eth: 2 };
  return { color: SKIN_COL[Math.min(SKIN_COL.length - 1, Math.floor(((r - 0.96) / 0.04) * SKIN_COL.length))], eth: 3 };
}

export function hairTone(eth, r) {
  if (eth === 2) return HAIR_WHT[Math.floor(r * HAIR_WHT.length) % HAIR_WHT.length];
  if (r > 0.92) return HAIR_TINT[Math.floor(((r - 0.92) / 0.08) * HAIR_TINT.length) % HAIR_TINT.length];
  return HAIR_DARK[Math.floor(r * HAIR_DARK.length) % HAIR_DARK.length];
}

function frac(x) {
  return x - Math.floor(x);
}

// Pick a character for a person (stable).
export function pickModel(female, worker, r, suitOk = true) {
  if (female) {
    if (worker) return 'female_worker';
    if (r < 0.48) return 'female_casual';
    if (r < 0.74) return 'female_formal';
    if (r < 0.88 && suitOk) return 'female_suit';
    return r < 0.94 ? 'female_worker' : 'female_casual';
  }
  if (worker) return 'male_worker';
  if (r < 0.42) return 'male_casual_2';
  if (r < 0.78) return 'male_casual_hoodie';
  if (r < 0.89 && suitOk) return 'male_suit';
  return r < 0.95 ? 'male_worker' : 'male_casual_hoodie';
}

// ---- one person ---------------------------------------------------------------
export class Human {
  constructor(model) {
    const T = LIB[model];
    this.model = model;
    this.T = T;
    this.root = new THREE.Group();
    this.obj = skeletonClone(T.scene);
    this.obj.scale.setScalar(HEIGHT / 1.81);
    this.root.add(this.obj);
    this.mesh = this.obj.getObjectByName('body');
    const g = new THREE.BufferGeometry();
    const src = T.geo;
    g.setAttribute('position', src.attributes.position);
    g.setAttribute('normal', src.attributes.normal);
    g.setAttribute('skinIndex', src.attributes.skinIndex);
    g.setAttribute('skinWeight', src.attributes.skinWeight);
    g.setIndex(src.index);
    this.col = new Uint8Array(T.nv * 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3, true);
    g.setAttribute('color', this.colAttr);
    this.mesh.geometry = g;
    this.mesh.material = MAT;
    this.mesh.frustumCulled = true;
    this.mixer = new THREE.AnimationMixer(this.obj);
    this.actions = {};
    for (const k in T.clips) this.actions[k] = this.mixer.clipAction(T.clips[k]);
    this.cur = null;
    this.state = '';
    this.person = null;
    this.acc = 0;
    this.slotCol = [];
    for (let s = 0; s < N_SLOT; s++) this.slotCol.push(new THREE.Color());
    this.play('Idle', 0);
    this.mixer.update(Math.random() * 1.5);
  }

  // colours: { skin, hair, top, bottom, shoe } THREE.Color (linear)
  paint(c) {
    const T = this.T;
    const sc = this.slotCol;
    sc[S_SKIN].copy(c.skin);
    sc[S_SKIN2].copy(c.skin).multiplyScalar(0.8);
    sc[S_HAIR].copy(c.hair);
    sc[S_HAIR2].copy(c.hair).multiplyScalar(1.35);
    sc[S_BROW].copy(c.brow || c.hair);
    sc[S_TOP].copy(c.top);
    sc[S_TOP2].copy(c.top);
    sc[S_BOTTOM].copy(c.bottom);
    sc[S_SHOE].copy(c.shoe);
    sc[S_SOLE].setRGB(0.8, 0.8, 0.78);
    const col = this.col;
    const slot = T.slot;
    const keep = T.keepCol;
    for (let v = 0; v < T.nv; v++) {
      const s = slot[v];
      const o = v * 3;
      if (s === S_KEEP) {
        col[o] = Math.min(255, keep[o] * 255 + 0.5);
        col[o + 1] = Math.min(255, keep[o + 1] * 255 + 0.5);
        col[o + 2] = Math.min(255, keep[o + 2] * 255 + 0.5);
      } else {
        const cc = sc[s];
        col[o] = Math.min(255, cc.r * 255 + 0.5);
        col[o + 1] = Math.min(255, cc.g * 255 + 0.5);
        col[o + 2] = Math.min(255, cc.b * 255 + 0.5);
      }
    }
    this.colAttr.needsUpdate = true;
  }

  play(name, fade = 0.25) {
    if (this.state === name) return;
    const next = this.actions[name] || this.actions.Idle;
    this.state = name;
    if (next === this.cur) return;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.time = Math.random() * next.getClip().duration;
    next.play();
    if (this.cur && fade > 0) this.cur.crossFadeTo(next, fade, false);
    else if (this.cur) this.cur.stop();
    this.cur = next;
  }

  setSpeed(name, speed) {
    // keep the feet roughly planted: clip rate follows ground speed
    const a = this.actions[name];
    if (!a) return;
    if (name === 'Walk') a.timeScale = Math.min(2.0, Math.max(0.6, speed / WALK_BASE));
    else if (name === 'Run') a.timeScale = Math.min(1.9, Math.max(0.7, speed / RUN_BASE));
    else a.timeScale = 1;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}

// Shared colour record for a street person (made once per person, kept on it).
const _tmp = new THREE.Color();
export function personColors(h) {
  if (h._hc) return h._hc;
  const r = frac(h.phase * 0.3183 + 0.17);
  const sk = h.skinTone || skinTone(frac(h.phase * 0.7071));
  const hairR = frac(h.phase * 1.913);
  const c = {
    skin: sk.color,
    hair: h.doek ? h.hair : hairTone(sk.eth, hairR),
    brow: hairTone(sk.eth === 2 ? 2 : 0, frac(hairR * 3.1)),
    top: h.shirt,
    bottom: h.pants,
    shoe: SHOES[Math.floor(frac(h.phase * 2.617) * SHOES.length)],
    model: pickModel(h.female, !!h.worker, r, !h.ragged)
  };
  if (c.model.endsWith('suit')) {
    const s = SUIT[Math.floor(frac(h.phase * 4.21) * SUIT.length)];
    c.top = s;
    c.bottom = s;
    c.shoe = SHOES[Math.floor(frac(h.phase * 5.3) * 2)];
  } else if (c.model.endsWith('worker')) {
    c.bottom = WORK_PANTS[Math.floor(frac(h.phase * 4.7) * WORK_PANTS.length)];
  }
  if (h.ragged) {
    // night phara: worn, muted clothes
    c.top = _tmp.copy(h.shirt).multiplyScalar(0.45).clone();
    c.bottom = h.pants;
  }
  h._hc = c;
  return c;
}

// ---- pool for the street crowd ------------------------------------------------
// begin() / offer(h, d2) / end(dt): the nearest `cap` people (in front of the
// camera first) within `far` metres become animated humans; everyone else
// stays on the instanced bodies. No allocation per frame once warm.
export class HumanPool {
  constructor(cap = 30, far = 80) {
    this.cap = cap;
    this.far2 = far * far;
    this.group = new THREE.Group();
    this.group.name = 'humans';
    this.byModel = {};
    this.all = [];
    for (const m of HUMAN_MODELS) {
      this.byModel[m] = [];
      for (let i = 0; i < 3; i++) this.#make(m);
    }
    this.cand = new Array(cap).fill(null);
    this.score = new Float64Array(cap);
    this.n = 0;
    this.epoch = 0;
    this.grown = 0;
    this.camX = 0;
    this.camZ = 0;
    this.fx = 0;
    this.fz = 0;
    this.drawn = 0;
  }

  #make(m) {
    const hu = new Human(m);
    hu.used = -1;
    hu.attached = false; // hidden bodies leave the scene graph (no bone updates)
    this.byModel[m].push(hu);
    this.all.push(hu);
    return hu;
  }

  begin(cx, cz, fx = 0, fz = 0) {
    this.epoch++;
    this.n = 0;
    this.camX = cx;
    this.camZ = cz;
    this.fx = fx;
    this.fz = fz;
    this.grown = 0;
  }

  offer(h) {
    const dx = h.x - this.camX;
    const dz = h.z - this.camZ;
    let d2 = dx * dx + dz * dz;
    if (d2 > this.far2) return;
    if (dx * this.fx + dz * this.fz < -4) d2 *= 4; // behind the camera
    if (h._hu && h._hu.person === h) d2 *= 0.7; // keep who already has a body
    const cap = this.cap;
    if (this.n < cap) {
      let i = this.n++;
      while (i > 0 && this.score[i - 1] > d2) {
        this.score[i] = this.score[i - 1];
        this.cand[i] = this.cand[i - 1];
        i--;
      }
      this.score[i] = d2;
      this.cand[i] = h;
    } else if (d2 < this.score[cap - 1]) {
      let i = cap - 1;
      while (i > 0 && this.score[i - 1] > d2) {
        this.score[i] = this.score[i - 1];
        this.cand[i] = this.cand[i - 1];
        i--;
      }
      this.score[i] = d2;
      this.cand[i] = h;
    }
  }

  // true when h is drawn as an animated human this frame (after end())
  isHuman(h) {
    return h._hsel === this.epoch;
  }

  // assign bodies, pose them, animate; frees the rest
  end(dt, t) {
    const ep = this.epoch;
    // 1) people who keep their body
    for (let i = 0; i < this.n; i++) {
      const h = this.cand[i];
      if (h._hu && h._hu.person === h) h._hu.used = ep;
    }
    // 2) free bodies nobody holds this frame
    for (let k = 0; k < this.all.length; k++) {
      const hu = this.all[k];
      if (hu.used !== ep) {
        if (hu.person && hu.person._hu === hu) hu.person._hu = null;
        hu.person = null;
        if (hu.attached) {
          this.group.remove(hu.root);
          hu.attached = false;
        }
      }
    }
    // 3) newcomers
    for (let i = 0; i < this.n; i++) {
      const h = this.cand[i];
      if (h._hu && h._hu.person === h) continue;
      const c = personColors(h);
      const list = this.byModel[c.model];
      let hu = null;
      for (let k = 0; k < list.length; k++) {
        if (list[k].used !== ep && !list[k].person) {
          hu = list[k];
          break;
        }
      }
      if (!hu && this.grown < 2 && list.length < this.cap) {
        hu = this.#make(c.model);
        this.grown++;
      }
      if (!hu) continue; // stays on the instanced body this frame
      hu.person = h;
      hu.used = ep;
      h._hu = hu;
      hu.paint(c);
      hu.state = '';
      hu.acc = 0;
    }
    // 4) pose + animate
    let drawn = 0;
    for (let i = 0; i < this.n; i++) {
      const h = this.cand[i];
      const hu = h._hu;
      if (!hu || hu.person !== h || hu.used !== ep) continue;
      drawn++;
      h._hsel = ep;
      const sc = h.scale || 1;
      if (!hu.attached) {
        this.group.add(hu.root);
        hu.attached = true;
      }
      hu.root.position.set(h.x, h.y, h.z);
      hu.root.rotation.y = h.yaw;
      hu.root.scale.setScalar(sc);
      let st = 'Idle';
      let spd = 0;
      if (h.act === 'walk') {
        spd = h.speed * (h.flee > 0 ? 2.6 : 1);
        st = spd > 2.2 ? 'Run' : 'Walk';
      } else if (h.act === 'sell' || h.act === 'cut') st = 'Interact';
      else if (h.act === 'phone' && Math.sin(t * 0.21 + h.phase) > 0.93) st = 'Wave';
      hu.play(st, hu.state ? 0.25 : 0);
      hu.setSpeed(st, spd);
      // far bodies animate at half rate
      hu.acc += dt;
      if (this.score[i] < 900 || (ep + i) % 2 === 0) {
        hu.update(hu.acc);
        hu.acc = 0;
      }
    }
    this.drawn = drawn;
  }
}
