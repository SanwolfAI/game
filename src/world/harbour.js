import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

// Durban harbour and the outer anchorage.
// Ships are placed where the real coastline says: a berth is a stretch of
// water lying alongside land (a quay) inside the harbour basin, found from the
// terrain (SRTM coastline + OSM water). Container ships get ship-to-shore
// gantry cranes on the quay beside them. Out at sea, ships wait at anchor off
// the Golden Mile the way they do in real life, a few km offshore, swinging
// slowly. Tugs and small boats move around the basin. OSM piers and the two
// breakwaters (src/data/durban-harbour.json, scripts/build-harbour.py) get a
// concrete deck so the beach piers are visible and walkable-looking.

const WATER_Y = -0.55;
// harbour basin (local metres, geo.js projection): Point to Bayhead / Island View
const BASIN = { x0: -2900, x1: 3400, z0: 400, z1: 6400 };

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#2b3440';
  for (let y = 6; y < 64; y += 16) for (let x = 3; x < 64; x += 10) g.fillRect(x, y, 6, 5);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Hull: plan outline (pointed bow, round-ish stern) extruded up, length along +Z.
function hullGeometry(L, B, D) {
  const s = new THREE.Shape();
  const h = B / 2;
  s.moveTo(-h, -L / 2 + 3);
  s.quadraticCurveTo(-h, -L / 2, -h + 3, -L / 2);
  s.lineTo(h - 3, -L / 2);
  s.quadraticCurveTo(h, -L / 2, h, -L / 2 + 3);
  s.lineTo(h, L / 2 - L * 0.16);
  s.quadraticCurveTo(h, L / 2 - 2, 0, L / 2);
  s.quadraticCurveTo(-h, L / 2 - 2, -h, L / 2 - L * 0.16);
  s.lineTo(-h, -L / 2 + 3);
  const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(-Math.PI / 2); // shape XY -> XZ, extrude up (shape +Y becomes -Z)
  g.rotateY(Math.PI); // bow back to +Z without mirroring
  return g;
}

const HULL_COLS = [0x1c2a44, 0x7a1d1d, 0x23313a, 0x0f3d2e, 0x2a2a2a, 0x8a2a14, 0x14365c];
const BOX_COLS = [0xb23a2a, 0x2a5aa8, 0x2e7d4f, 0xd8a02a, 0x8a8f96, 0xe2e2dc, 0x6b3b8c, 0xc65a1e, 0x1f6f78];

export class Harbour {
  constructor(data, { hf }) {
    this.hf = hf;
    this.data = data || {};
    this.group = new THREE.Group();
    this.group.name = 'harbour';
    this.mats = {
      red: new THREE.MeshLambertMaterial({ color: 0x8e2a1f }),
      white: new THREE.MeshLambertMaterial({ map: windowTexture() }),
      plain: new THREE.MeshLambertMaterial({ color: 0xe8e8e2 }),
      deck: new THREE.MeshLambertMaterial({ color: 0x6d5b4a }),
      funnel: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
      crane: new THREE.MeshLambertMaterial({ color: 0xc23a22 }),
      craneB: new THREE.MeshLambertMaterial({ color: 0x2f5f9e }),
      concrete: new THREE.MeshLambertMaterial({ color: 0xb9b4a8 }),
      tug: new THREE.MeshLambertMaterial({ color: 0xd8462a }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff1c8 }),
    };
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.box.translate(0, 0.5, 0);
    this.ships = [];
    this.boats = [];
    this.containers = []; // [x,y,z,yaw,colour]
    this.lamps = [];
    const t0 = performance.now();
    this.#piers();
    this.#berths();
    this.#anchorage();
    this.#tugs();
    this.#buildContainers();
    this.stats = { ships: this.ships.length, boats: this.boats.length, ms: Math.round(performance.now() - t0) };
  }

  #water(x, z) {
    return this.hf.heightAt(x, z) < -0.8;
  }

  #inBay(x, z) {
    const hf = this.hf;
    if (!hf.bay) return false;
    const ix = Math.round((x - hf.minX) / hf.cell);
    const iz = Math.round((z - hf.minZ) / hf.cell);
    if (ix < 0 || iz < 0 || ix >= hf.cols || iz >= hf.rows) return false;
    return hf.bay[hf.idx(ix, iz)] === 1;
  }

  #land(x, z) {
    return this.hf.heightAt(x, z) > 0.6;
  }

  // ---- piers / breakwaters: a concrete deck along each line ------------------
  #piers() {
    const segs = [];
    for (const p of this.data.piers || []) if (!p.c) segs.push([p.p, p.n ? 6 : 4]);
    for (const b of this.data.breakwaters || []) segs.push([b, 9]);
    const pos = [];
    const idx = [];
    for (const [pts, w] of segs) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5) continue;
        const nx = (-(bz - az) / L) * (w / 2);
        const nz = ((bx - ax) / L) * (w / 2);
        const ya = Math.max(1.6, this.hf.renderedHeightAt(ax, az) + 0.25);
        const yb = Math.max(1.6, this.hf.renderedHeightAt(bx, bz) + 0.25);
        const o = pos.length / 3;
        pos.push(ax + nx, ya, az + nz, ax - nx, ya, az - nz, bx + nx, yb, bz + nz, bx - nx, yb, bz - nz);
        pos.push(ax + nx, WATER_Y - 1, az + nz, ax - nx, WATER_Y - 1, az - nz, bx + nx, WATER_Y - 1, bz + nz, bx - nx, WATER_Y - 1, bz - nz);
        idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); // top
        idx.push(o, o + 4, o + 2, o + 2, o + 4, o + 6); // side +
        idx.push(o + 1, o + 3, o + 5, o + 3, o + 7, o + 5); // side -
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xa9a49a, side: THREE.DoubleSide }));
    m.name = 'piers';
    this.group.add(m);
  }

  // ---- berths: water alongside a quay inside the basin ----------------------
  #berths() {
    const rng = rngFrom(4031);
    const used = [];
    const free = (x, z, r) => used.every(([ux, uz, ur]) => Math.hypot(ux - x, uz - z) > ur + r);
    const dirs = [];
    for (let k = 0; k < 16; k++) dirs.push([Math.cos((k / 16) * Math.PI * 2), Math.sin((k / 16) * Math.PI * 2)]);
    const cands = [];
    for (let x = BASIN.x0; x <= BASIN.x1; x += 45) {
      for (let z = BASIN.z0; z <= BASIN.z1; z += 45) {
        if (!this.#water(x, z) || !this.#inBay(x, z)) continue;
        for (const [dx, dz] of dirs) {
          // land 22-34 m to one side, open water on the other side
          if (!this.#land(x + dx * 80, z + dz * 80)) continue;
          if (!this.#water(x - dx * 40, z - dz * 40)) continue;
          // the quay must run straight for a ship's length: along (-dz, dx)
          const ax = -dz;
          const az = dx;
          let run = 0;
          for (let s = 10; s <= 140; s += 10) {
            const ok = (sgn) =>
              this.#water(x + ax * s * sgn, z + az * s * sgn) && this.#land(x + ax * s * sgn + dx * 90, z + az * s * sgn + dz * 90);
            if (ok(1) && ok(-1)) run = s;
            else break;
          }
          if (run >= 60) cands.push({ x, z, dx, dz, ax, az, run, r: rng() });
          break;
        }
      }
    }
    cands.sort((a, b) => b.run - a.run || a.r - b.r);
    let n = 0;
    for (const c of cands) {
      if (n >= 18) break;
      const L = Math.min(c.run * 2 - 10, c.run > 110 ? 180 + rng() * 80 : 70 + rng() * 60);
      // ship centre a hull half-beam off the quay face
      const B = L > 160 ? 30 : L > 110 ? 22 : 15;
      // quay face: where the ground comes up out of the water
      let f = 0;
      while (f < 100 && this.hf.heightAt(c.x + c.dx * f, c.z + c.dz * f) < 0) f += 4;
      c.face = f;
      const sx = c.x + c.dx * (f - 1.5 - B / 2);
      const sz = c.z + c.dz * (f - 1.5 - B / 2);
      if (!free(sx, sz, L / 2 + 10)) continue;
      used.push([sx, sz, L / 2 + 10]);
      const type = L > 160 && rng() < 0.65 ? 'container' : rng() < 0.5 ? 'bulk' : L > 150 ? 'tanker' : 'general';
      const yaw = Math.atan2(c.ax, c.az) + (rng() < 0.5 ? Math.PI : 0);
      this.#ship(sx, sz, yaw, L, B, type, rng);
      this.#apron(c.x + c.dx * (c.face + 30), c.z + c.dz * (c.face + 30), yaw, L + 60, 64);
      if (type === 'container') this.#gantries(c.x + c.dx * (c.face + 9), c.z + c.dz * (c.face + 9), yaw, L, c.dx, c.dz, rng);
      n++;
    }
    this.berthCount = n;
    this.berthCands = cands.length;
  }

  // ---- outer anchorage off the beachfront -----------------------------------
  #anchorage() {
    const rng = rngFrom(9917);
    let placed = 0;
    for (let tries = 0; tries < 80 && placed < 12; tries++) {
      const z = -7000 + rng() * 9000;
      // find the shoreline along this line, then go 2.5-7 km out
      let shore = null;
      for (let x = -1000; x < 9000; x += 100) {
        if (this.#water(x, z) && this.#water(x + 300, z) && this.#water(x + 800, z)) {
          shore = x;
          break;
        }
      }
      if (shore === null) continue;
      const x = shore + 2500 + rng() * 4500;
      if (!this.#water(x, z)) continue;
      if (this.ships.some((s) => Math.hypot(s.x - x, s.z - z) < 600)) continue;
      const L = 160 + rng() * 120;
      const type = rng() < 0.5 ? 'container' : rng() < 0.6 ? 'bulk' : 'tanker';
      // anchored ships head into the prevailing wind/current, roughly NE-SW
      const yaw = Math.PI * 0.8 + (rng() - 0.5) * 0.6;
      this.#ship(x, z, yaw, L, L > 220 ? 36 : 30, type, rng, true);
      placed++;
    }
  }

  // ---- tugs moving in the basin ----------------------------------------------
  #tugs() {
    const rng = rngFrom(551);
    const hull = hullGeometry(28, 10, 4);
    for (let i = 0; i < 8; i++) {
      let x = 0;
      let z = 0;
      let ok = false;
      for (let t = 0; t < 60 && !ok; t++) {
        x = BASIN.x0 + rng() * (BASIN.x1 - BASIN.x0);
        z = BASIN.z0 + rng() * (BASIN.z1 - BASIN.z0);
        ok = this.#water(x, z) && this.#water(x + 60, z) && this.#water(x - 60, z) && this.#water(x, z + 60) && this.#water(x, z - 60);
      }
      if (!ok) continue;
      const g = new THREE.Group();
      const h = new THREE.Mesh(hull, i % 3 === 0 ? this.mats.red : this.mats.tug);
      h.position.y = -2.2;
      g.add(h);
      const cab = new THREE.Mesh(this.box, this.mats.white);
      cab.scale.set(6, 4, 7);
      cab.position.set(0, 1.8, 2);
      g.add(cab);
      const fun = new THREE.Mesh(this.box, this.mats.funnel);
      fun.scale.set(1.6, 3, 1.6);
      fun.position.set(0, 5.6, -1);
      g.add(fun);
      this.#bake(g);
      g.position.set(x, WATER_Y, z);
      g.rotation.y = rng() * Math.PI * 2;
      this.group.add(g);
      this.boats.push({ g, v: 3 + rng() * 4, turn: (rng() - 0.5) * 0.08, ph: rng() * 10 });
    }
  }

  // ---- one ship ----------------------------------------------------------------
  #ship(x, z, yaw, L, B, type, rng, anchored = false) {
    const g = new THREE.Group();
    const D = Math.max(9, B * 0.8); // hull height
    const draft = D * 0.45;
    const hullMat = new THREE.MeshLambertMaterial({ color: HULL_COLS[Math.floor(rng() * HULL_COLS.length)] });
    const hull = new THREE.Mesh(hullGeometry(L, B, D), hullMat);
    hull.position.y = -draft;
    g.add(hull);
    // red antifouling band at the waterline
    const band = new THREE.Mesh(hullGeometry(L * 0.995, B * 1.01, 1.4), this.mats.red);
    band.position.y = -0.6;
    g.add(band);
    const deckY = D - draft;
    const deck = new THREE.Mesh(this.box, this.mats.deck);
    deck.scale.set(B * 0.92, 0.3, L * 0.8);
    deck.position.set(0, deckY - 0.2, 0);
    g.add(deck);
    // accommodation block at the stern (-Z); tankers/bulkers too
    const accW = B * 0.8;
    const accL = Math.min(22, L * 0.1);
    const accH = 12 + (L > 200 ? 8 : 4);
    const acc = new THREE.Mesh(this.box, this.mats.white);
    acc.scale.set(accW, accH, accL);
    acc.position.set(0, deckY, -L / 2 + accL / 2 + 6);
    g.add(acc);
    const bridgeWing = new THREE.Mesh(this.box, this.mats.plain);
    bridgeWing.scale.set(B, 2.4, 5);
    bridgeWing.position.set(0, deckY + accH, -L / 2 + accL / 2 + 6 + accL / 2 - 2.5);
    g.add(bridgeWing);
    const fun = new THREE.Mesh(this.box, this.mats.funnel);
    fun.scale.set(B * 0.22, 9, 6);
    fun.position.set(0, deckY + accH - 2, -L / 2 + 5);
    g.add(fun);
    // mast light (seen at night)
    g.userData.lamps = [[0, deckY + accH + 6, -L / 2 + accL + 6], [0, deckY + 10, L / 2 - 8]];
    const cargoZ0 = -L / 2 + accL + 10;
    const cargoZ1 = L / 2 - L * 0.14;
    if (type === 'container') {
      // stacks: rows of 12.2 m boxes, 2.5 m wide, tiers by bay
      const cols = Math.floor((B - 3) / 2.5);
      for (let bz = cargoZ0; bz + 12.2 < cargoZ1; bz += 13) {
        const tiers = 2 + Math.floor(rng() * 5);
        for (let c = 0; c < cols; c++) {
          const cx = -((cols - 1) * 2.5) / 2 + c * 2.5;
          const th = Math.max(0, tiers - (Math.abs(c - cols / 2) > cols * 0.4 && rng() < 0.5 ? 1 : 0));
          for (let t = 0; t < th; t++) this.containers.push({ g, lx: cx, ly: deckY + t * 2.6, lz: bz + 6.1, col: BOX_COLS[Math.floor(rng() * BOX_COLS.length)] });
        }
      }
    } else if (type === 'bulk') {
      for (let bz = cargoZ0; bz + 14 < cargoZ1; bz += 20) {
        const h = new THREE.Mesh(this.box, hullMat);
        h.scale.set(B * 0.6, 2, 14);
        h.position.set(0, deckY, bz + 7);
        g.add(h);
        if (rng() < 0.6) {
          const crane = new THREE.Mesh(this.box, this.mats.crane);
          crane.scale.set(1.2, 14, 1.2);
          crane.position.set(B * 0.3, deckY, bz + 17);
          g.add(crane);
        }
      }
    } else if (type === 'tanker') {
      const pipe = new THREE.Mesh(this.box, this.mats.plain);
      pipe.scale.set(2, 1.2, cargoZ1 - cargoZ0);
      pipe.position.set(0, deckY, (cargoZ0 + cargoZ1) / 2);
      g.add(pipe);
      const man = new THREE.Mesh(this.box, this.mats.crane);
      man.scale.set(B * 0.7, 3, 6);
      man.position.set(0, deckY, (cargoZ0 + cargoZ1) / 2);
      g.add(man);
    } else {
      for (let bz = cargoZ0; bz + 10 < cargoZ1; bz += 16) {
        const h = new THREE.Mesh(this.box, this.mats.deck);
        h.scale.set(B * 0.6, 1.6, 10);
        h.position.set(0, deckY, bz + 5);
        g.add(h);
        const mast = new THREE.Mesh(this.box, this.mats.plain);
        mast.scale.set(0.8, 12, 0.8);
        mast.position.set(0, deckY, bz + 13);
        g.add(mast);
      }
    }
    // forecastle
    const fc = new THREE.Mesh(this.box, hullMat);
    fc.scale.set(B * 0.7, 2.4, L * 0.08);
    fc.position.set(0, deckY, L / 2 - L * 0.1);
    g.add(fc);
    this.#bake(g);
    g.position.set(x, WATER_Y, z);
    g.rotation.y = yaw;
    g.updateMatrixWorld(true);
    this.group.add(g);
    this.ships.push({ g, x, z, yaw, anchored, ph: rng() * 10, L });
  }

  // Concrete quay apron along a berth (bollards on the edge).
  #apron(x, z, yaw, len, wid) {
    const y = Math.max(0.9, this.hf.heightAt(x, z)) + 0.12;
    const m = new THREE.Mesh(this.box, this.mats.concrete);
    m.scale.set(wid, 0.4, len);
    m.position.set(x, y - 0.4, z);
    m.rotation.y = yaw;
    this.group.add(m);
  }

  // Ship-to-shore gantry cranes on the quay (legs straddle the rail track).
  #gantries(qx, qz, yaw, L, dx, dz, rng) {
    const n = L > 220 ? 3 : 2;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const mat = rng() < 0.5 ? this.mats.crane : this.mats.craneB;
    const ground = Math.max(1, this.hf.renderedHeightAt(qx, qz));
    for (let i = 0; i < n; i++) {
      const s = (i - (n - 1) / 2) * (L / (n + 0.5));
      const cx = qx + fx * s;
      const cz = qz + fz * s;
      const g = new THREE.Group();
      const leg = (ox, oz) => {
        const m = new THREE.Mesh(this.box, mat);
        m.scale.set(1.6, 42, 1.6);
        m.position.set(ox, 0, oz);
        g.add(m);
      };
      // local: +X toward the water (boom), Z along the quay
      leg(-8, -9);
      leg(-8, 9);
      leg(8, -9);
      leg(8, 9);
      const beam = new THREE.Mesh(this.box, mat);
      beam.scale.set(18, 2.2, 20);
      beam.position.set(0, 40, 0);
      g.add(beam);
      const boom = new THREE.Mesh(this.box, mat);
      boom.scale.set(95, 2.6, 3);
      boom.position.set(20, 44, 0);
      g.add(boom);
      const mach = new THREE.Mesh(this.box, this.mats.plain);
      mach.scale.set(10, 6, 8);
      mach.position.set(-6, 42, 0);
      g.add(mach);
      const aframe = new THREE.Mesh(this.box, mat);
      aframe.scale.set(2, 20, 2);
      aframe.position.set(0, 44, 0);
      g.add(aframe);
      this.#bake(g);
      g.position.set(cx, ground, cz);
      // +X of the crane points at the water: -(dx,dz)
      g.rotation.y = Math.atan2(dz, -dx);
      this.group.add(g);
    }
  }

  // Merge a group's plain meshes into one mesh per material (phone draw calls).
  #bake(g) {
    const by = new Map();
    const keep = [];
    for (const c of g.children) {
      if (!c.isMesh || c.isInstancedMesh) {
        keep.push(c);
        continue;
      }
      c.updateMatrix();
      let geo = c.geometry.clone().applyMatrix4(c.matrix);
      if (geo.index) geo = geo.toNonIndexed();
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
      if (!by.has(c.material)) by.set(c.material, []);
      by.get(c.material).push(geo);
    }
    g.clear();
    for (const [mat, list] of by) g.add(new THREE.Mesh(list.length === 1 ? list[0] : mergeGeometries(list), mat));
    for (const c of keep) g.add(c);
  }

  #buildContainers() {
    if (!this.containers.length) return;
    const geo = new THREE.BoxGeometry(2.44, 2.59, 12.19);
    geo.translate(0, 1.3, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const by = new Map();
    for (const c of this.containers) {
      if (!by.has(c.g)) by.set(c.g, []);
      by.get(c.g).push(c);
    }
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const [g, list] of by) {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((c, i) => {
        m.makeTranslation(c.lx, c.ly, c.lz);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, col.setHex(c.col));
      });
      inst.name = 'containers';
      g.add(inst);
    }
    this.containers.length = 0;
  }

  // Gentle roll and heave; anchored ships swing slowly; tugs potter about.
  update(dt, t) {
    for (const s of this.ships) {
      const roll = s.anchored ? 0.012 : 0.003;
      s.g.rotation.z = Math.sin(t * 0.35 + s.ph) * roll;
      s.g.position.y = WATER_Y + Math.sin(t * 0.5 + s.ph) * (s.anchored ? 0.35 : 0.08);
      if (s.anchored) s.g.rotation.y = s.yaw + Math.sin(t * 0.01 + s.ph) * 0.25;
    }
    for (const b of this.boats) {
      const g = b.g;
      g.rotation.y += b.turn * dt * Math.sin(t * 0.05 + b.ph);
      const nx = g.position.x + Math.sin(g.rotation.y) * b.v * dt;
      const nz = g.position.z + Math.cos(g.rotation.y) * b.v * dt;
      if (this.#water(nx + Math.sin(g.rotation.y) * 40, nz + Math.cos(g.rotation.y) * 40)) {
        g.position.x = nx;
        g.position.z = nz;
      } else g.rotation.y += 1.2 * dt;
      g.rotation.z = Math.sin(t * 1.3 + b.ph) * 0.03;
    }
  }
}
