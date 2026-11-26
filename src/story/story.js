// Story mode in the world: resolves mission places on real Durban roads,
// draws the 3D markers (mission start beams, goal rings, race rings, a
// waiting passenger, the spin-show crowd), drives the story cars (the taxi
// you follow, Skhokho's white gusheshe) on the road graph, and draws story
// icons on the minimap and the big map. The rules live in engine.js; the
// screens in ui.js; the missions in missions.js.
//
// main.js hooks (small): new Story({...}), story.update(dt) each frame,
// story.drawMinimap() after the minimap draws, story.onCrash(impact), and
// window.__izk.story = story.api.
//
// Light on budget phones: one beam + one ring per marker (shared geometry),
// the crowd is one InstancedMesh shown only during the spin show, nothing is
// allocated per frame.

import * as THREE from '../../vendor/three/three.module.js';
import { toXZ } from '../core/geo.js';
import { dialogOpen } from '../ui/dialogs.js';
import { PathMover, carMeshClone } from '../game/taxiRide.js';
import { StoryEngine } from './engine.js';
import { StoryUI, icon } from './ui.js';
import { MISSIONS, CHAPTERS, PLACES } from './missions.js';

const KEY = 'izk.story.v1';
const HINT_KEY = 'izk.story.hint';
const MM_SIZE = 336; // minimap drawing units (minimap.js)

function store() {
  return {
    get: () => {
      try {
        return JSON.parse(localStorage.getItem(KEY) || 'null');
      } catch {
        return null;
      }
    },
    set: (s) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {}
    },
  };
}

// a number / icon badge texture for the floating marker sign
function badgeTexture(color, text) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `900 ${text.length > 2 ? 40 : 54}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Story {
  constructor(d) {
    this.d = d; // { scene, hf, roads, gps, hud, fares, minimap, bigmap, hooks }
    this.hf = d.hf;
    this.roads = d.roads;
    this.gps = d.gps;
    this.hooks = d.hooks;
    this.places = new Map();
    this.group = new THREE.Group();
    this.group.name = 'story';
    d.scene.add(this.group);
    this.#buildMarkers();
    this.ui = new StoryUI();
    this.ui.onGps = (m) => m && this.#gpsTo(this.place(m.start));
    if (d.bigmap) d.bigmap.extraDraw = (ctx, X, Y) => this.drawBigmap(ctx, X, Y);
    this.actors = new Set();
    this.engine = new StoryEngine(this.#ctx());
    this.time = 0;
    this.#hookMenus();
    this.api = this.#api();
    // a mission that was running when the app closed carries on
    setTimeout(() => {
      try {
        if (!this.engine.run && this.engine.s.active) this.engine.resume();
      } catch (e) {
        console.warn('[IZK story] resume', e);
      }
    }, 2500);
    // one hint for players who have not found the story yet
    setTimeout(() => {
      try {
        if (this.engine.progress().done || this.engine.run || localStorage.getItem(HINT_KEY)) return;
        localStorage.setItem(HINT_KEY, '1');
        d.hud.toast("New: Story mode! Find the red marker at Ma's house in KwaMashu, or open Story in the menu.", 6);
      } catch {}
    }, 30000);
  }

  // ---------------- places ----------------
  place(key) {
    if (this.places.has(key)) return this.places.get(key);
    const p = PLACES[key];
    let [x, z] = p.xz ? p.xz : toXZ(p.ll[0], p.ll[1]);
    let yaw = 0;
    const fares = this.d.fares;
    if (p.rank && fares) {
      // a real taxi rank bay (fares.js): the nearest one with that name
      let best = null;
      let bd = Infinity;
      for (const r of fares.ranks) {
        if (!r.name.startsWith(p.rank)) continue;
        const dd = Math.hypot(r.ox - x, r.oz - z);
        if (dd < bd) {
          bd = dd;
          best = r;
        }
      }
      if (best && bd < 600) {
        x = best.x;
        z = best.z;
        yaw = best.yaw;
        const out = { x, z, yaw, name: p.name, key, road: { x, z, yaw } };
        this.places.set(key, out);
        return out;
      }
    }
    let road = null;
    const nr = this.roads.nearestRoad(x, z, 300);
    if (nr) {
      const l = Math.hypot(nr.dirX, nr.dirZ) || 1;
      yaw = Math.atan2(nr.dirX / l, nr.dirZ / l);
      // the lane next to the kerb, on the left (SA drives on the left)
      const off = Math.max(1.6, nr.road.width / 2 - 1.8);
      road = { x: nr.x + Math.cos(yaw) * off, z: nr.z - Math.sin(yaw) * off, yaw };
      if (p.snap !== false) {
        // the marker stands on the kerb between the road and the place
        const dx = x - nr.x;
        const dz = z - nr.z;
        const dl = Math.hypot(dx, dz) || 1;
        const kerb = nr.road.width / 2 + 2.5;
        x = nr.x + (dx / dl) * Math.min(kerb, dl);
        z = nr.z + (dz / dl) * Math.min(kerb, dl);
      }
    }
    const out = { x, z, yaw, name: p.name, key, road: road || { x, z, yaw } };
    this.places.set(key, out);
    return out;
  }

  #gpsTo(p) {
    if (!p) return;
    this.gps.setDestination(p.x, p.z, p.name);
    if (this.gps.dest) this.gps.dest.story = true;
    this.d.hud.toast(`GPS set: ${p.name}`, 2.4);
  }

  // ---------------- the engine's view of the world ----------------
  #ctx() {
    const d = this.d;
    const H = this.hooks;
    const fares = d.fares;
    const me = { x: 0, z: 0, yaw: 0, kmh: 0, mode: 'foot' };
    return {
      place: (k) => this.place(k),
      me: () => {
        const e = H.entity();
        me.x = e.x;
        me.z = e.z;
        me.yaw = e.yaw || 0;
        me.kmh = e.speedKmh != null ? Math.abs(e.speedKmh) : Math.abs(e.speed || 0) * 3.6;
        me.mode = H.mode();
        return me;
      },
      paused: () => dialogOpen() || !!(d.bigmap && d.bigmap.open) || !!(fares && fares.licence && fares.licence.atSchool),
      licence: () => (fares && fares.licence ? fares.licence.L : { learner: true, code10: true, prdp: true }),
      guideLicence: () => {
        if (!fares || !fares.licence) return;
        const e = H.entity();
        fares.licence.guide(e.x, e.z);
        if (this.gps.dest) this.gps.dest.story = true;
      },
      money: () => (fares ? fares.wallet.r : 0),
      addMoney: (n) => {
        if (!fares) return;
        fares.wallet.r = Math.max(0, fares.wallet.r + n);
        fares.saveWallet();
        fares.showWallet();
      },
      route: (x, z, yaw, tx, tz) => {
        try {
          return this.gps.router ? this.gps.router.route(x, z, Math.sin(yaw), Math.cos(yaw), tx, tz) : null;
        } catch {
          return null;
        }
      },
      waypoint: (p) => {
        if (p) {
          this.gps.setDestination(p.x, p.z, p.name || 'Story');
          if (this.gps.dest) this.gps.dest.story = true;
        } else if (this.gps.dest && this.gps.dest.story) this.gps.clear();
        this.goal = p || null;
        if (d.bigmap) d.bigmap.dirty = true;
      },
      beacon: (p, kind) => this.#beacon(p, kind),
      pax: (p) => this.#pax(p),
      crowd: (p) => this.#crowd(p),
      actor: (type, route, opts) => this.#actor(type, route, opts),
      removeActor: (a) => this.#removeActor(a),
      putCar: (x, z, yaw) => H.put(x, z, yaw),
      bringCar: (x, z) => {
        // park the car in the kerb lane next to the start, facing along the road
        const nr = this.roads.nearestRoad(x, z, 120);
        if (nr) {
          const l = Math.hypot(nr.dirX, nr.dirZ) || 1;
          const yaw = Math.atan2(nr.dirX / l, nr.dirZ / l);
          const off = Math.max(1.6, nr.road.width / 2 - 1.8);
          H.park(nr.x + Math.cos(yaw) * off, nr.z - Math.sin(yaw) * off, yaw);
        } else H.park(x, z, 0);
      },
      giveCar: (type, p) => {
        H.setCar(type);
        if (!p) return;
        const e = H.entity();
        const r = p.road || p;
        if (Math.hypot(e.x - p.x, e.z - p.z) < 90 && H.mode() !== 'ride') H.put(r.x, r.z, r.yaw);
        else H.park(r.x, r.z, r.yaw);
      },
      toast: (t, s) => d.hud.toast(t, s || 2.4),
      chatter: (who, t) => this.ui.chatter(who, t),
      ui: {
        offer: (o, yes, later) => this.ui.offer(o, yes, later),
        scene: (lines, done) => this.ui.playScene(lines, done),
        chapter: (ch, done) => this.ui.chapter(ch, done),
        objective: (o) => this.ui.objective(o),
        fail: (r, retry, quit) => this.ui.fail(r, retry, quit),
        complete: (info, done) => this.ui.complete(info, done),
        pay: (amount, what, have, cb) => this.ui.pay(amount, what, have, cb),
      },
      store: store(),
    };
  }

  // ---------------- 3D markers ----------------
  #buildMarkers() {
    const beamGeo = new THREE.CylinderGeometry(2.4, 2.4, 160, 16, 1, true);
    beamGeo.translate(0, 80, 0);
    const ringGeo = new THREE.RingGeometry(4.2, 5, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const mk = (color) => {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.frustumCulled = false;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      ring.position.y = 0.12;
      g.add(beam, ring);
      g.visible = false;
      g.userData = { beam, ring };
      this.group.add(g);
      return g;
    };
    this.startMark = mk(0xe2463a);
    this.goalMark = mk(0xffd21a);
    // floating badge over the start marker (mission number)
    this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
    this.badge.scale.set(5, 5, 1);
    this.badge.position.y = 8;
    this.startMark.add(this.badge);
    this.badgeKey = '';
    // big ground ring for the spin show
    const spin = new THREE.Mesh(new THREE.RingGeometry(32.5, 34, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    spin.visible = false;
    this.group.add(spin);
    this.spinRing = spin;
    // standing race ring
    const gate = new THREE.Mesh(new THREE.TorusGeometry(7, 0.45, 8, 36), new THREE.MeshBasicMaterial({ color: 0x3fd0ff }));
    gate.visible = false;
    this.group.add(gate);
    this.gate = gate;
    // a person waiting at the kerb (pick-ups)
    const pax = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.95, 3, 8), new THREE.MeshLambertMaterial({ color: 0x1e6fa8 }));
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshLambertMaterial({ color: 0x5a3726 }));
    head.position.y = 1.56;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.55, 2, 6), new THREE.MeshLambertMaterial({ color: 0x1e6fa8 }));
    arm.position.set(0.32, 1.55, 0);
    pax.add(body, head, arm);
    pax.userData.arm = arm;
    pax.visible = false;
    this.group.add(pax);
    this.paxMesh = pax;
  }

  #beacon(p, kind) {
    const g = this.goalMark;
    this.spinRing.visible = false;
    this.gate.visible = false;
    if (!p) {
      g.visible = false;
      this.beaconKind = null;
      return;
    }
    this.beaconKind = kind;
    const y = this.hf.heightAt(p.x, p.z);
    g.position.set(p.x, y, p.z);
    const col = kind === 'pax' ? 0x46d27a : kind === 'finish' ? 0xffffff : kind === 'gate' ? 0x3fd0ff : 0xffd21a;
    g.userData.beam.material.color.setHex(col);
    g.userData.ring.material.color.setHex(col);
    g.visible = kind !== 'ring';
    if (kind === 'ring') {
      this.spinRing.position.set(p.x, y + 0.15, p.z);
      this.spinRing.visible = true;
    }
    if (kind === 'gate' || kind === 'finish') {
      // stand the ring across the road, facing along the route
      const nr = this.roads.nearestRoad(p.x, p.z, 40);
      this.gate.position.set(p.x, y + 5.5, p.z);
      this.gate.rotation.set(0, nr ? Math.atan2(nr.dirX, nr.dirZ) : 0, 0);
      this.gate.material.color.setHex(kind === 'finish' ? 0xffd21a : 0x3fd0ff);
      this.gate.visible = true;
    }
  }

  #pax(p) {
    const m = this.paxMesh;
    if (!p) {
      m.visible = false;
      return;
    }
    m.position.set(p.x, this.hf.heightAt(p.x, p.z), p.z);
    m.rotation.y = (p.yaw || 0) + Math.PI / 2;
    m.visible = true;
  }

  #crowd(p) {
    if (!p) {
      if (this.crowdMesh) this.crowdMesh.visible = false;
      return;
    }
    const N = 56;
    if (!this.crowdMesh) {
      const geo = new THREE.CapsuleGeometry(0.28, 1.0, 2, 6);
      geo.translate(0, 0.78, 0);
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const im = new THREE.InstancedMesh(geo, mat, N);
      const cols = [0xd23b2f, 0x2f6fd2, 0xf2c230, 0x3a9a4a, 0xffffff, 0x7a3fa0, 0xe57a1f, 0x222222];
      const c = new THREE.Color();
      for (let i = 0; i < N; i++) im.setColorAt(i, c.setHex(cols[(i * 5) % cols.length]));
      im.frustumCulled = false;
      this.group.add(im);
      this.crowdMesh = im;
      this.crowdBase = new Float32Array(N * 3);
      this.crowdM = new THREE.Matrix4();
    }
    const im = this.crowdMesh;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (i % 3) * 0.02;
      const r = 39 + (i % 3) * 1.4;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      this.crowdBase[i * 3] = x;
      this.crowdBase[i * 3 + 1] = this.hf.heightAt(x, z);
      this.crowdBase[i * 3 + 2] = z;
    }
    im.visible = true;
    this.crowdT = 0;
    this.#crowdPose(0);
  }

  #crowdPose(t) {
    const im = this.crowdMesh;
    const b = this.crowdBase;
    const m = this.crowdM;
    for (let i = 0; i < im.count; i++) {
      const hop = Math.max(0, Math.sin(t * 7 + i * 1.7)) * 0.35;
      m.makeTranslation(b[i * 3], b[i * 3 + 1] + hop, b[i * 3 + 2]);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  }

  // ---------------- story cars ----------------
  #actor(type, route, { rival } = {}) {
    const mover = new PathMover(this.roads);
    mover.set(route);
    let mesh = null;
    try {
      mesh = carMeshClone(type);
      if (rival && mesh) {
        // Skhokho's gusheshe is white: own paint, the player's car keeps red
        mesh.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const one = (mt) => {
            const c = mt.color;
            if (c && c.r > 0.35 && c.r > c.g * 1.8 && c.r > c.b * 1.8) {
              const n = mt.clone();
              n.color.setRGB(0.92, 0.92, 0.9);
              return n;
            }
            return mt;
          };
          o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
        });
      }
    } catch (e) {
      console.warn('[IZK story] actor mesh', e);
    }
    const g = new THREE.Group();
    if (mesh) g.add(mesh);
    this.group.add(g);
    const a = {
      type,
      mover,
      group: g,
      x: mover.x,
      z: mover.z,
      yaw: mover.yaw,
      s: 0,
      len: mover.len,
      done: false,
      step(dt, cruise) {
        const n = Math.max(1, Math.ceil(dt / 0.05));
        const tgt = cruise > 0 ? mover.target(cruise) : 0;
        for (let k = 0; k < n; k++) mover.step(dt / n, tgt);
        a.x = mover.x;
        a.z = mover.z;
        a.yaw = mover.yaw;
        a.s = mover.s;
        a.done = mover.done;
        g.position.set(mover.x, mover.y ?? 0, mover.z);
        g.rotation.y = mover.yaw;
      },
    };
    g.position.set(mover.x, mover.y ?? 0, mover.z);
    g.rotation.y = mover.yaw;
    this.actors.add(a);
    return a;
  }

  #removeActor(a) {
    if (!a) return;
    this.group.remove(a.group);
    this.actors.delete(a);
  }

  // ---------------- per frame ----------------
  onCrash(impact) {
    this.engine.onCrash(impact);
  }

  update(dt) {
    this.time += dt;
    this.ui.tick(dt);
    this.engine.update(dt);
    // the next mission's start marker (only while no mission runs)
    const nx = !this.engine.run ? this.engine.next() : null;
    const sm = this.startMark;
    if (nx) {
      const p = this.place(nx.start);
      const ch = CHAPTERS.find((c) => c.id === nx.chapter);
      const key = nx.id;
      if (key !== this.badgeKey) {
        this.badgeKey = key;
        if (this.badge.material.map) this.badge.material.map.dispose();
        this.badge.material.map = badgeTexture(ch.color, this.engine.label(nx));
        this.badge.material.needsUpdate = true;
        sm.userData.beam.material.color.set(ch.color);
        sm.userData.ring.material.color.set(ch.color);
        sm.position.set(p.x, this.hf.heightAt(p.x, p.z), p.z);
      }
      sm.visible = true;
      this.badge.position.y = 8 + Math.sin(this.time * 2) * 0.5;
    } else sm.visible = false;
    if (this.goalMark.visible) this.goalMark.userData.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);
    if (this.gate.visible) this.gate.rotation.z = this.time * 0.6;
    if (this.paxMesh.visible) this.paxMesh.userData.arm.rotation.z = 0.6 + Math.sin(this.time * 8) * 0.5;
    if (this.crowdMesh && this.crowdMesh.visible) {
      this.crowdT += dt;
      if ((this.crowdF = (this.crowdF || 0) + 1) % 2 === 0) this.#crowdPose(this.crowdT);
    }
  }

  // ---------------- maps ----------------
  // after minimap.update(): story icons on top of the small map
  drawMinimap() {
    const mm = this.d.minimap;
    if (!mm || !mm.canvas) return;
    const c = mm.canvas;
    const g = c.getContext('2d');
    const k = c.width / MM_SIZE;
    const e = this.hooks.entity();
    const s = MM_SIZE / (mm.viewMeters || 1900);
    const cen = MM_SIZE / 2;
    g.setTransform(k, 0, 0, k, 0, 0);
    // the phone HUD shows the minimap as small as 72 css px: grow the icons so
    // they stay visible, and drop the tiny mission number when it can't be read
    const cssW = c.clientWidth || 168;
    const u = Math.min(2.2, Math.max(1, 168 / cssW));
    const small = cssW < 110;
    const pin = (x, z, color, text, r0 = 9) => {
      const r = r0 * u;
      if (small) text = text === '★' ? text : '';
      let px = cen + (x - e.x) * s;
      let py = cen + (z - e.z) * s;
      const dx = px - cen;
      const dy = py - cen;
      const dd = Math.hypot(dx, dy);
      const max = cen - r - 3;
      if (dd > max) {
        px = cen + (dx / dd) * max;
        py = cen + (dy / dd) * max;
      }
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 2.5 * u;
      g.strokeStyle = '#fff';
      g.stroke();
      if (text) {
        g.fillStyle = '#fff';
        g.font = `900 ${Math.round((text.length > 2 ? 9 : 11) * u)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, px, py + 0.5);
      }
    };
    const r = this.engine.run;
    if (!r) {
      const nx = this.engine.next();
      if (nx) {
        const p = this.place(nx.start);
        pin(p.x, p.z, CHAPTERS.find((q) => q.id === nx.chapter).color, this.engine.label(nx), 11);
      }
    } else {
      for (const a of this.actors) pin(a.x, a.z, a.type === 'quantum' ? '#f2c230' : '#eeeeee', '', 6);
      if (this.goal) pin(this.goal.x, this.goal.z, '#ff3d8a', '★', 9);
    }
  }

  // the big map: drawn after its own pins (bigmap.extraDraw)
  drawBigmap(ctx, X, Y) {
    const icon = (x, z, color, text, label) => {
      const px = X(x);
      const py = Y(z);
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '900 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, px, py + 0.5);
      if (label) {
        ctx.font = '700 12px system-ui, sans-serif';
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(10,16,24,0.85)';
        ctx.fillRect(px - w / 2, py + 18, w, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, px, py + 27.5);
      }
    };
    const r = this.engine.run;
    if (!r) {
      const nx = this.engine.next();
      if (nx) {
        const p = this.place(nx.start);
        icon(p.x, p.z, CHAPTERS.find((q) => q.id === nx.chapter).color, this.engine.label(nx), `Story: ${nx.title}`);
      }
    } else if (this.goal) icon(this.goal.x, this.goal.z, '#ff3d8a', '★', this.goal.name || r.m.title);
  }

  // ---------------- menu / drawer / keys ----------------
  #hookMenus() {
    const openJ = () => this.openJournal();
    // the settings drawer (cockpit HUD) gets a Story icon
    const addDrawer = () => {
      const grid = document.querySelector('#t-drawer .dr-grid');
      if (!grid || document.getElementById('t-story')) return !!grid;
      const b = document.createElement('div');
      b.className = 'tbtn small';
      b.id = 't-story';
      b.setAttribute('aria-label', 'Story');
      b.innerHTML = icon('book', 'ico');
      b.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dr = document.getElementById('t-drawer');
        const mb = document.getElementById('t-menu');
        dr?.classList.remove('open');
        dr?.setAttribute('aria-hidden', 'true');
        mb?.classList.remove('open');
        mb?.setAttribute('aria-expanded', 'false');
        openJ();
      });
      grid.insertBefore(b, grid.firstChild);
      return true;
    };
    addDrawer();
    // the pause menu gets a Story button
    const panel = document.querySelector('#menu .panel');
    const resume = document.getElementById('m-resume');
    if (panel && !document.getElementById('m-story')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'm-story';
      b.innerHTML = `${icon('book')} Story`;
      b.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px';
      b.addEventListener('click', () => {
        resume?.click();
        setTimeout(openJ, 30);
      });
      if (resume && resume.nextSibling) panel.insertBefore(b, resume.nextSibling);
      else panel.appendChild(b);
    }
    // tapping the objective line opens the journal too
    this.ui.obj.style.pointerEvents = 'auto';
    this.ui.obj.style.cursor = 'pointer';
    this.ui.obj.addEventListener('click', openJ);
    // keyboard: J
    addEventListener('keydown', (e) => {
      if ((e.key === 'j' || e.key === 'J') && !e.repeat && !e.ctrlKey && !e.metaKey) {
        if (this.ui.journalOpen) this.ui.closeJournal();
        else if (!dialogOpen()) openJ();
      }
    });
    // New game clears the story too
    document.getElementById('m-new')?.addEventListener('click', () => {
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(HINT_KEY);
      } catch {}
    });
  }

  openJournal() {
    this.ui.openJournal(this.engine, (act, m) => {
      const eng = this.engine;
      if (act === 'gps') this.#gpsTo(this.place(m.start));
      else if (act === 'goto') this.#goto(this.place(m.start));
      else if (act === 'quit') eng.quit();
      else if (act === 'route') {
        if (this.goal) this.#gpsTo(this.goal);
        else if (eng.run && eng.run.step && eng.run.step.do === 'licence') this.engine.ctx.guideLicence();
        else this.d.hud.toast('Follow the objective at the top of the screen', 2.4);
      } else if (act === 'replay') {
        this.#goto(this.place(m.start));
        setTimeout(() => eng.start(m.id, { replay: true }), 400);
      }
    });
  }

  // "Take me there": straight to a mission start (no long walks)
  #goto(p) {
    const H = this.hooks;
    const mode = H.mode();
    if (mode === 'ride') {
      this.d.hud.toast('Get off the taxi first', 2);
      return;
    }
    const r = p.road || p;
    if (mode === 'car') H.put(r.x, r.z, r.yaw);
    else H.foot(p.x + Math.cos(r.yaw) * 4, p.z - Math.sin(r.yaw) * 4, r.yaw);
    this.engine.laterId = null;
    this.d.hud.toast(`At ${p.name}`, 2);
  }

  // ---------------- window.__izk.story ----------------
  #api() {
    const eng = this.engine;
    return {
      version: 1,
      engine: eng,
      ui: this.ui,
      state: () => eng.state(),
      missions: () => MISSIONS.map((m) => ({ id: m.id, chapter: m.chapter, label: eng.label(m), title: m.title, status: eng.status(m), start: m.start })),
      chapters: () => CHAPTERS.map((c) => ({ id: c.id, n: c.n, title: c.title, sub: c.sub })),
      place: (k) => this.place(k),
      start: (id, opts) => eng.start(id, opts),
      jump: (id) => eng.jump(id),
      quit: () => eng.quit(true),
      skipStep: () => eng.skipStep(),
      fail: (why) => eng.fail(why || 'Failed (test)'),
      reset: () => eng.reset(),
      on: (evt, fn) => eng.on(evt, fn),
      journal: () => this.openJournal(),
      goto: (id) => {
        const m = MISSIONS.find((q) => q.id === id);
        if (m) this.#goto(this.place(m.start));
      },
    };
  }
}
