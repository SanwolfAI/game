import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';
import { VEHICLE_TYPES, buildVehicleMesh, BUILTIN_WHEELS, buildWheelGeometry } from './models.js';
import { trafficCarModel } from './carModels.js';
import { glowTexture } from './carLights.js';
import { WORLD } from '../world/worldLight.js';
import { honkFar, crashSound } from './audio.js';

const PAINTS = ['#f2f2f0', '#c9ccd0', '#1d1f22', '#8c1d1d', '#1f3f7a', '#d8d2c0', '#5a6066', '#9a9ea3', '#2c5a3a', '#f2f2f0'].map((h) => new THREE.Color(h));

// Head/tail lamp glow quads for every traffic car (one instanced draw call).
function lampGeometry() {
  const quads = [
    [0.55, 0.62, 2.25, 1, 0.95, 0.8, 1],
    [-0.55, 0.62, 2.25, 1, 0.95, 0.8, 1],
    [0.6, 0.78, -2.25, 1, 0.12, 0.06, -1],
    [-0.6, 0.78, -2.25, 1, 0.12, 0.06, -1]
  ];
  const pos = [];
  const col = [];
  const uv = [];
  const s = 0.45;
  for (const [x, y, z, r, g, b, f] of quads) {
    const v = [
      [x - s, y - s * 0.6],
      [x + s, y - s * 0.6],
      [x + s, y + s * 0.6],
      [x - s, y + s * 0.6]
    ];
    const order = f > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of order) {
      pos.push(v[k][0], v[k][1], z);
      col.push(r, g, b);
      uv.push(uvs[k][0], uvs[k][1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function pointAlong(road, dir, dist, out) {
  const pts = road.pts;
  const n = pts.length;
  const d = clamp(dist, 0, road.len);
  let acc = 0;

  if (dir > 0) {
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = hyp(b[0] - a[0], b[1] - a[1]);
      if (acc + seg >= d || i === n - 1) {
        const t = seg > 0 ? clamp((d - acc) / seg, 0, 1) : 0;
        return setPt(out, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / (seg || 1), (b[1] - a[1]) / (seg || 1));
      }
      acc += seg;
    }
  } else {
    for (let i = n - 1; i >= 1; i--) {
      const a = pts[i];
      const b = pts[i - 1];
      const seg = hyp(b[0] - a[0], b[1] - a[1]);
      if (acc + seg >= d || i === 1) {
        const t = seg > 0 ? clamp((d - acc) / seg, 0, 1) : 0;
        return setPt(out, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / (seg || 1), (b[1] - a[1]) / (seg || 1));
      }
      acc += seg;
    }
  }
  const p = pts[0];
  return setPt(out, p[0], p[1], 0, 1);
}

// A double zero (-0 is not a small integer), so number fields start out with a
// double representation and later writes never re-box them.
const F0 = -0;

// Junction disc height (copy of roads.js junctionY): ends' heights weighted
// by inverse square distance.
function junctionY(nd, x, z) {
  const ep = nd.ep;
  if (!ep) return nd.y;
  let ws = 0;
  let ys = 0;
  for (let k = 0; k < ep.length; k += 3) {
    const dx = x - ep[k];
    const dz = z - ep[k + 1];
    const w = 1 / (dx * dx + dz * dz + 0.25);
    ws += w;
    ys += w * ep[k + 2];
  }
  return ys / ws;
}

// Math.hypot allocates (it boxes its arguments); this does not.
function hyp(a, b) {
  return Math.sqrt(a * a + b * b);
}

function setPt(out, x, z, fx, fz) {
  if (!out) return { x, z, fx, fz };
  out.x = x;
  out.z = z;
  out.fx = fx;
  out.fz = fz;
  return out;
}

// Kinematic (bicycle) model for traffic: the lane path is only the target.
const WB = 2.6; // wheelbase (m)
const STEER_MAX = 0.6; // front wheel lock (rad)
const STEER_RATE = 1.6; // how fast the wheel turns (rad/s at the road wheels)
const A_LAT = 3.6; // comfortable cornering (m/s²)

const COUNTS = { gusheshe: 28, quantum: 36, polo: 26, hilux: 18, saps: 9 };
// Spawn weight by road class: busy arterials and the CBD, quiet side streets.
const CLASS_WEIGHT = { motorway: 1, trunk: 1, primary: 1, secondary: 0.85, motorway_link: 0.5, trunk_link: 0.5, primary_link: 0.5, secondary_link: 0.45, tertiary: 0.5, tertiary_link: 0.35, unclassified: 0.14, residential: 0.1, living_street: 0.05, service: 0, pedestrian: 0 };
const SPAWN_R = 650;
// Body sizes (m) and masses (kg) for collisions.
const BODY = { gusheshe: [4.4, 1.7, 1250], quantum: [5.4, 1.9, 2300], polo: [4.0, 1.7, 1100], hilux: [5.3, 1.85, 1900], saps: [5.2, 1.9, 2100] };
const CELL = 24;
const SLOTS = 4096; // power of two
function slotOf(gx, gz) {
  return (Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663)) & (SLOTS - 1);
}
const LANE = 2.1;

export class Traffic {
  constructor(roads, hf, rng, px, pz) {
    this.roads = roads;
    this.hf = hf;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.pos = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.scale = new THREE.Vector3(1, 1, 1);
    this.buckets = [];
    this.meshes = [];
    // scratch path points (pointAlong `out`), one per user so none clobbers another
    this._pp = { x: 0, z: 0, fx: 0, fz: 1 }; // update(): this car's lane point
    this._ta = { x: 0, z: 0, fx: 0, fz: 1 }; // #steerBody look-ahead
    this._tq = { x: 0, z: 0, fx: 0, fz: 1 }; // #steerBody curve probe
    this._spP = { x: 0, z: 0, fx: 0, fz: 1 }; // #startPass
    this._ocP = { x: 0, z: 0, fx: 0, fz: 1 }; // #oncomingClear
    this._cnA = { x: 0, z: 0, fx: 0, fz: 1 }; // #chooseNext heading in
    this._cnB = { x: 0, z: 0, fx: 0, fz: 1 }; // #chooseNext heading out
    // reused per-frame buffers: nothing in update() allocates
    this._nb = new Array(128).fill(null); // #gather result (cars in the 3x3 cells round a point)
    this._nb2 = new Array(128).fill(null); // #collisions neighbours (used while _nb may be live)
    // spatial hash: CELL m cells folded into a fixed table of slots (two far
    // cells may share a slot; every user filters by distance anyway)
    this._slots = [];
    // lists pre-sized so a car entering a fresh slot never grows an array
    for (let i = 0; i < SLOTS; i++) this._slots.push({ n: 0, a: new Array(8).fill(null) });
    this._used = new Int32Array(SLOTS); // slots holding cars this frame
    this._usedN = 0;
    this._seen = new Int32Array(9); // #gather: slots already visited
    this._lead = { gap: 0, v: 0, who: null }; // #leader result
    this._bA = { x: 0, z: 0, hx: 0, hz: 1, vx: 0, vz: 0, len: 0, wid: 0, mass: 1, dx: 0, dz: 0, ivx: 0, ivz: 0, w: 0 };
    this._bB = { x: 0, z: 0, hx: 0, hz: 1, vx: 0, vz: 0, len: 0, wid: 0, mass: 1, dx: 0, dz: 0, ivx: 0, ivz: 0, w: 0 };
    this.cops = new Array(16).fill(null);
    this.copsN = 0;

    let total = 0;
    for (const type of VEHICLE_TYPES) {
      const count = COUNTS[type.id] || 10;
      total += count;
      const model = trafficCarModel(type.id);
      const parts = [];
      if (model) {
        for (const part of model.parts) {
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
          if (part.paint) {
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
            for (let i = 0; i < count; i++) mesh.setColorAt(i, PAINTS[Math.floor(this.rng() * PAINTS.length)]);
          }
          parts.push(mesh);
        }
      } else {
        const proto = buildVehicleMesh(type.id);
        parts.push(new THREE.InstancedMesh(proto.geometry, proto.material, count));
      }
      for (const mesh of parts) {
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        this.group.add(mesh);
      }
      // spinning wheels over the baked ones (traffic bodies are one merged mesh)
      let wl;
      if (model && model.size) {
        const sz = model.size;
        const r = Math.min(0.46, Math.max(0.3, sz.y * 0.2));
        wl = [sz.x / 2 - 0.13, sz.z * 0.31, r];
      } else wl = BUILTIN_WHEELS[type.id] || [0.96, 1.44, 0.4];
      if (!this.wheelGeo) {
        this.wheelGeo = buildWheelGeometry();
        this.wheelMat = new THREE.MeshLambertMaterial({ vertexColors: true });
      }
      const wm = new THREE.InstancedMesh(this.wheelGeo, this.wheelMat, count * 4);
      wm.frustumCulled = false;
      wm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      wm.count = 0;
      wm.userData.layout = { track: model ? wl[0] : wl[0] + 0.03, base: wl[1], r: wl[2] * 1.04 };
      this.group.add(wm);
      (this.wheelMeshes = this.wheelMeshes || []).push(wm);
      this.meshes.push(parts);
      const bucket = [];
      for (let i = 0; i < count; i++) {
        const car = this.#makeCar(type, px, pz);
        if (car) bucket.push(car);
      }
      this.buckets.push(bucket);
    }
    this.lamps = new THREE.InstancedMesh(
      lampGeometry(),
      new THREE.MeshBasicMaterial({ map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
      total
    );
    this.lamps.frustumCulled = false;
    this.lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lamps.count = 0;
    this.lamps.renderOrder = 4;
    this.group.add(this.lamps);
    // amber indicator / hazard flashes (one instanced draw call)
    this.blinkMax = 64;
    const bg = new THREE.SphereGeometry(0.13, 6, 4);
    this.blinkers = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: 0xffa21a, toneMapped: false }), this.blinkMax);
    this.blinkers.frustumCulled = false;
    this.blinkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blinkers.count = 0;
    this.group.add(this.blinkers);
  }

  #makeCar(type, px, pz, minR = 0) {
    if (!this.edgeOf) {
      this.edgeOf = new Map();
      for (const e of this.roads.edges) this.edgeOf.set(e.road, e);
    }
    let edge = null;
    let mid = null;
    for (let tries = 0; tries < 30; tries++) {
      const a = this.rng() * Math.PI * 2;
      // busy CBD: pack the cars into the streets around you
      const sr = SPAWN_R * (1 - 0.62 * (this.busy || 0));
      const mr = Math.min(minR, sr * 0.55);
      const r = mr + Math.sqrt(this.rng()) * (sr - mr);
      const sx = px + Math.cos(a) * r;
      const sz = pz + Math.sin(a) * r;
      const near = this.roads.nearestRoad(sx, sz, 90);
      if (!near) continue;
      const candidate = this.edgeOf.get(near.road);
      if (!candidate || candidate.road.len < 12 || candidate.road.rank <= 1) continue;
      let w = CLASS_WEIGHT[candidate.road.cls] ?? 0.2;
      if (candidate.road.lanes >= 4) w = Math.max(w, 0.9);
      if (this.rng() > w) continue;
      const m = pointAlong(candidate.road, 1, candidate.road.len * this.rng());
      if (this.hf.isWater(m.x, m.z)) continue;
      edge = candidate;
      mid = m;
      break;
    }
    if (!edge) {
      for (let tries = 0; tries < 40 && !edge; tries++) {
        const c = this.roads.edges[Math.floor(this.rng() * this.roads.edges.length)];
        if (c && c.road.len >= 12) {
          const m = pointAlong(c.road, 1, c.road.len * 0.5);
          if (hyp(m.x - px, m.z - pz) < 900) {
            edge = c;
            mid = m;
          }
        }
      }
      if (!edge) edge = this.roads.randomEdge(this.rng);
      if (!edge) return null;
      if (!mid) mid = pointAlong(edge.road, 1, edge.road.len * 0.5);
    }
    const kind = type.id;
    const taxi = kind === 'quantum';
    const cop = kind === 'saps';
    // personality: 1 = drives at the limit; taxis push well past it
    const aggr = taxi ? 1.12 + this.rng() * 0.22 : cop ? 0.95 + this.rng() * 0.1 : 0.82 + this.rng() * 0.3;
    const road = edge.road;
    const nl = this.roads.lanesPerDir ? this.roads.lanesPerDir(road) : 1;
    const laneIdx = Math.floor(this.rng() * nl);
    const lane = this.#laneOff(road, laneIdx);
    const body = BODY[kind] || [4.5, 1.8, 1500];
    return {
      type,
      edge,
      dir: edge.reverse && this.rng() > 0.5 ? -1 : 1,
      dist: this.rng() * road.len,
      speed: F0,
      v: Math.min(road.speed * aggr * 0.8, 30),
      aggr,
      taxi,
      cop,
      patience: taxi ? 1.0 : aggr > 1 ? 1.8 : 3.2 + this.rng() * 2,
      laneIdx,
      lane,
      laneTarget: lane,
      len: body[0],
      wid: body[1],
      mass: body[2],
      stuck: F0,
      honkCd: F0,
      stopT: F0,
      nextStop: taxi ? 25 + this.rng() * 70 : 1e9,
      blink: 0, // -1 left, 1 right, 2 hazards
      next: null,
      turn: 0,
      crash: null,
      checkpoint: mid,
      // Every field the AI ever writes is declared here, in one order, with
      // its final type, so all cars share one hidden class: property access
      // stays monomorphic and numbers are written in place (no boxing).
      id: -1,
      posd: false, // has a position (px/pz/py/hx/hz) yet
      px: NaN,
      pz: NaN,
      py: F0,
      hx: F0,
      hz: F0,
      cx0: F0,
      cz0: F0,
      why: '',
      redT: F0,
      wx: NaN,
      wz: NaN,
      wa: F0,
      dmg: F0,
      hooted: F0,
      laneChangeCd: F0,
      node: null,
      nodeArms: 0,
      otherRank: 0,
      turnSharp: false,
      crashRec: null,
      nextBuf: null,
      // body (bicycle model) state; placed = false puts it on the lane path
      placed: false,
      bx: 0,
      bz: 0,
      vb: F0,
      lag: F0,
      passOff: F0,
      passBlock: false,
      yaw: F0,
      steer: F0,
      vCurve: 99,
      pass: 0, // 2 = going round the stopped player
      passT: F0,
      surprise: undefined,
      brakeCap: 8
    };
  }

  #laneOff(road, i) {
    if (this.roads.laneOffsetAt) return this.roads.laneOffsetAt(road, i);
    return LANE;
  }

  #relocate(car, px, pz) {
    const fresh = this.#makeCar(car.type, px, pz, 220); // respawn out of sight
    if (!fresh) return;
    const id = car.id;
    const rec = car.crashRec;
    const nb = car.nextBuf;
    Object.assign(car, fresh); // same fields, same order: the hidden class is kept
    car.id = id;
    car.crashRec = rec;
    car.nextBuf = nb;
  }

  // Pick the edge after this one (once, ahead of time, so the car can get
  // into the right lane and slow for the turn).
  #chooseNext(car) {
    const edge = car.edge;
    const arrival = car.dir > 0 ? edge.to : edge.from;
    const node = this.roads.nodes[arrival];
    // candidate exits in two reused parallel arrays; the pick goes into the
    // car's own [edge, dir] pair (car.next points at it)
    const oe = this._optE || (this._optE = []);
    const od = this._optD || (this._optD = []);
    let no = 0;
    if (node) {
      for (let k = 0; k < node.edges.length; k++) {
        const e = this.roads.edges[node.edges[k]];
        if (!e || e === edge || e.len < 4) continue;
        let dir = 0;
        if (e.from === arrival) dir = 1;
        else if (e.reverse && e.to === arrival) dir = -1;
        if (dir && e.road.rank > 1) {
          if (no < oe.length) {
            oe[no] = e;
            od[no] = dir;
          } else {
            oe.push(e);
            od.push(dir);
          }
          no++;
        }
      }
    }
    const next = car.nextBuf || (car.nextBuf = [null, 0]);
    if (no) {
      let sum = 0;
      for (let k = 0; k < no; k++) sum += (CLASS_WEIGHT[oe[k].road.cls] ?? 0.2) + 0.05;
      let pick = this.rng() * sum;
      let w = no - 1;
      for (let k = 0; k < no; k++) {
        pick -= (CLASS_WEIGHT[oe[k].road.cls] ?? 0.2) + 0.05;
        if (pick <= 0) {
          w = k;
          break;
        }
      }
      next[0] = oe[w];
      next[1] = od[w];
    } else {
      next[0] = edge;
      next[1] = edge.road.oneway ? car.dir : -car.dir;
    }
    const options = no; // count, for nodeArms below
    car.next = next;
    car.node = node;
    car.nodeArms = options + 1;
    // turn direction: cross product of heading in vs heading out
    const a = pointAlong(edge.road, car.dir, edge.road.len - 0.5, this._cnA);
    const b = pointAlong(next[0].road, next[1], 3, this._cnB);
    const cross = a.fx * b.fz - a.fz * b.fx;
    const dot = a.fx * b.fx + a.fz * b.fz;
    car.turn = dot > 0.85 ? 0 : cross > 0 ? -1 : 1; // -1 left, 1 right (x = east, z = south)
    car.turnSharp = dot < 0.3;
    car.otherRank = 0;
    if (node) {
      for (const id of node.edges) {
        const e = this.roads.edges[id];
        if (e && e.road !== edge.road) car.otherRank = Math.max(car.otherRank, e.road.rank);
      }
    }
  }

  #advance(car) {
    if (!car.next) this.#chooseNext(car);
    const edge = car.edge;
    const next = car.next;
    car.edge = next[0];
    car.dir = next[1];
    car.dist = Math.max(0, car.dist - edge.road.len);
    car.next = null;
    car.turn = 0;
    // a pass belongs to the segment it started on
    const passing = car.pass !== 0;
    car.pass = 0;
    car.passBlock = false;
    car.passT = 0;
    if (passing) car.laneTarget = this.#laneOff(car.edge.road, car.laneIdx);
    if (car.edge.road !== edge.road) {
      const nl = this.roads.lanesPerDir ? this.roads.lanesPerDir(car.edge.road) : 1;
      car.laneIdx = Math.min(car.laneIdx, nl - 1);
      car.laneTarget = this.#laneOff(car.edge.road, car.laneIdx);
      car.lane = car.laneTarget;
    }
    if (car.blink !== 2) car.blink = 0;
  }

  // Nearest n cars to (px, pz) as [{d, v}] (engine sounds). Reuses arrays.
  nearest(px, pz, n = 3) {
    const out = this._near || (this._near = []);
    out.length = 0;
    for (const bucket of this.buckets) {
      for (const car of bucket) {
        if (!car.posd) continue;
        const d = hyp(car.px - px, car.pz - pz);
        if (d > 60) continue;
        let k = out.length;
        if (k >= n && d >= out[n - 1].d) continue;
        const item = { d, v: car.v || 0 };
        while (k > 0 && out[k - 1].d > d) k--;
        out.splice(k, 0, item);
        if (out.length > n) out.length = n;
      }
    }
    return out;
  }

  #hash() {
    const slots = this._slots;
    const used = this._used;
    // (counts, not .length = 0: emptying an array frees its store, so the next
    // push would allocate a new one)
    for (let i = 0; i < this._usedN; i++) slots[used[i]].n = 0;
    this._usedN = 0;
    const cops = this.cops;
    let nc = 0;
    for (let b = 0; b < this.buckets.length; b++) {
      const bucket = this.buckets[b];
      for (let j = 0; j < bucket.length; j++) {
        const car = bucket[j];
        if (!car.posd) continue;
        const si = slotOf(Math.floor(car.px / CELL), Math.floor(car.pz / CELL));
        const l = slots[si];
        if (l.n === 0) used[this._usedN++] = si;
        if (l.n < l.a.length) l.a[l.n] = car;
        else l.a.push(car); // grows once, then reused
        l.n++;
        if (car.cop && !car.crash) {
          if (nc < cops.length) cops[nc] = car;
          else cops.push(car);
          nc++;
        }
      }
    }
    this.copsN = nc;
  }

  // Cars in the 3x3 cells round (x, z) into the reused array `out`;
  // returns how many (entries past that are stale).
  #gather(x, z, out) {
    let n = 0;
    let ns = 0;
    const seen = this._seen;
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gz - 1; b <= gz + 1; b++) {
        const si = slotOf(a, b);
        let dup = false;
        for (let k = 0; k < ns; k++) if (seen[k] === si) dup = true;
        if (dup) continue;
        seen[ns++] = si;
        const l = this._slots[si];
        for (let i = 0; i < l.n; i++) {
          if (n < out.length) out[n] = l.a[i];
          else out.push(l.a[i]);
          n++;
        }
      }
    }
    return n;
  }

  // Closest thing in our path within `look` m: another car or the player.
  #leader(car, look) {
    const best = this._lead;
    best.who = null;
    best.gap = look;
    const nb = this._nb;
    const nbN = this.#gather(car.px, car.pz, this._nb);
    for (let i = 0; i < nbN; i++) {
      const o = nb[i];
      if (o === car || !o.posd) continue;
      this.#leadTest(car, look, o.px, o.pz, o.hx, o.hz, o.crash ? 0 : o.v, o.len, o.wid, o);
    }
    const P = this.player;
    if (P && this.playerActive && car.pass !== 2) this.#leadTest(car, look, P.x, P.z, Math.sin(P.yaw), Math.cos(P.yaw), P.speed, 4.4, 1.8, 'player');
    return best.who === null ? null : best;
  }

  #leadTest(car, look, ox, oz, ohx, ohz, ov, olen, owid, who) {
    const hx = car.hx;
    const hz = car.hz;
    const dx = ox - car.px;
    const dz = oz - car.pz;
    const ahead = dx * hx + dz * hz;
    if (ahead <= 0.5 || ahead > look + 6) return;
    const lat = Math.abs(dx * hz - dz * hx);
    if (lat > (car.wid + owid) * 0.5 + 0.35) return;
    // only things moving with us or across us (ignore oncoming in the other lane: lat filter does that)
    const gap = ahead - (car.len + olen) * 0.5;
    const best = this._lead;
    if (gap < best.gap) {
      best.gap = gap;
      best.v = Math.max(0, (ohx * hx + ohz * hz) * ov);
      best.who = who;
    }
  }

  // Is a lateral move to offset `off` clear (no car alongside / close behind)?
  #laneClear(car, off) {
    const lx = car.hz;
    const lz = -car.hx;
    const tx = car.cx0 + lx * off;
    const tz = car.cz0 + lz * off;
    const nb = this._nb;
    const nbN = this.#gather(tx, tz, this._nb);
    for (let i = 0; i < nbN; i++) {
      const o = nb[i];
      if (o !== car && o.px !== undefined && !this.#roomOk(car, tx, tz, o.px, o.pz, o.v || 0)) return false;
    }
    const P = this.player;
    if (P && this.playerActive && !this.#roomOk(car, tx, tz, P.x, P.z, P.speed)) return false;
    return true;
  }

  #roomOk(car, tx, tz, ox, oz, ov) {
    const dx = ox - tx;
    const dz = oz - tz;
    const ahead = dx * car.hx + dz * car.hz;
    const lat = Math.abs(dx * car.hz - dz * car.hx);
    if (lat > 2.2) return true;
    const room = ahead >= 0 ? 9 + Math.max(0, car.v - ov) * 1.2 : 8 + Math.max(0, ov - car.v) * 1.6;
    return Math.abs(ahead) >= room;
  }

  #nearCop(car) {
    for (let i = 0; i < this.copsN; i++) {
      const c = this.cops[i];
      if (Math.abs(c.px - car.px) + Math.abs(c.pz - car.pz) < 220) return true;
    }
    if (this.playerIsCop && this.player && Math.abs(this.player.x - car.px) + Math.abs(this.player.z - car.pz) < 160) return true;
    return false;
  }

  // Is the player just sitting in a queue (a car close ahead of them, or a
  // robot)? Then nobody is surprised by a stopped car.
  #playerQueued(car) {
    const P = this.player;
    const fx = Math.sin(P.yaw);
    const fz = Math.cos(P.yaw);
    let q = false;
    const nb = this._nb;
    const nbN = this.#gather(P.x, P.z, this._nb);
    for (let i = 0; i < nbN && !q; i++) {
      const o = nb[i];
      if (o === car || !o.posd) continue;
      const dx = o.px - P.x;
      const dz = o.pz - P.z;
      const ahead = dx * fx + dz * fz;
      if (ahead > 0 && ahead < 14 && Math.abs(dx * fz - dz * fx) < 2.2) q = true;
    }
    if (!q && this.props) {
      const sig = this.props.signalAhead(P.x, P.z, fx, fz, 30);
      if (sig && sig.state !== 2) q = true;
    }
    return q;
  }

  // Overtake a stopped player (hazards / indicator on): pick a line to their
  // right with room, and only go when the oncoming side is clear.
  #startPass(car, road) {
    const P = this.player;
    const sp = pointAlong(road, car.dir, car.dist, this._spP);
    // player's offset from the centre line, + = left (our lane side)
    const pOff = (P.x - car.cx0) * sp.fz - (P.z - car.cz0) * sp.fx;
    const off = pOff - (1.8 + car.wid) * 0.5 - 0.9;
    // the line must stay on the tar; if it does not, wait behind
    const edge = (road.width || 2 * LANE * 2) * 0.5 - car.wid * 0.5 - 0.2;
    if (off < -edge || off > edge) {
      car.why = 'no-room';
      return;
    }
    if (!this.#oncomingClear(car, road, off)) {
      car.why = 'wait-oncoming';
      return;
    }
    car.pass = 2;
    car.passT = 0;
    car.passOff = off;
    car.laneTarget = off;
    car.blink = 1;
  }

  #oncomingClear(car, road, off) {
    const op = pointAlong(road, car.dir, car.dist, this._ocP);
    const fx = op.fx;
    const fz = op.fz;
    const lx = fz;
    const lz = -fx;
    const ox = car.cx0 + lx * off + fx * 30;
    const oz = car.cz0 + lz * off + fz * 30;
    const nb = this._nb;
    const nbN = this.#gather(ox, oz, this._nb);
    for (let i = 0; i < nbN; i++) {
      const o = nb[i];
      if (o === car || !o.posd) continue;
      // along from our body, sideways from the centre line
      const ahead = (o.px - car.px) * fx + (o.pz - car.pz) * fz;
      if (ahead < -6 || ahead > 75) continue;
      const lat = (o.px - car.cx0) * lx + (o.pz - car.cz0) * lz - off;
      if (Math.abs(lat) > 2.6) continue;
      // oncoming, or anything sitting on the line we want
      if (o.hx * fx + o.hz * fz < -0.3 || o.v < 1 || ahead < 18) return false;
    }
    return true;
  }

  #passTick(car, road, dt) {
    const P = this.player;
    car.passT += dt;
    const dx = P.x - car.px;
    const dz = P.z - car.pz;
    const ahead = dx * car.hx + dz * car.hz;
    const lat = Math.abs(dx * car.hz - dz * car.hx);
    // still clipping the player's corner: wait for the body to swing out
    car.passBlock = ahead > 0 && ahead < car.len * 0.5 + 3.4 && lat < (car.wid + 1.8) * 0.5 + 0.15;
    // not alongside yet and something now comes the other way: abort, tuck back in
    const before = ahead > car.len * 0.5 + 3.4;
    const abort = before && car.passT > 0.3 && !this.#oncomingClear(car, road, car.passOff);
    if (abort || ahead < -(car.len * 0.5 + 4.5) || car.passT > 20 || !this.playerActive) {
      if (abort) car.why = 'pass-abort';
      car.pass = 0;
      car.passBlock = false;
      car.laneTarget = this.#laneOff(road, car.laneIdx);
      car.blink = -1;
      car.laneChangeCd = 2;
    } else car.blink = car.passT < 3 ? 1 : 0;
  }

  #drive(car, dt) {
    const road = car.edge.road;
    const remain = road.len - car.dist;
    if (!car.next && remain < 70) this.#chooseNext(car);
    const nl = this.roads.lanesPerDir ? this.roads.lanesPerDir(road) : 1;
    const copNear = car.taxi && this.#nearCop(car);

    car.why = '';
    // ---- target speed --------------------------------------------------------
    let aggr = car.aggr;
    if (car.taxi && copNear) aggr = 0.95; // behave when the cops are watching
    let desired = Math.min(road.speed * aggr, 38);
    // corners: never faster than the bend ahead allows (bicycle-model grip)
    if (car.vCurve < desired) desired = Math.max(3, car.vCurve);
    if (car.next && car.turn !== 0 && remain < 45) {
      const vt = car.turnSharp ? (car.taxi ? 9 : 7) : 13;
      desired = Math.min(desired, Math.sqrt(vt * vt + 2 * 3.0 * Math.max(0, remain - 6)));
    }

    // robots (taxis go on amber; nobody runs a red)
    if (this.props) {
      const sig = this.props.signalAhead(car.px, car.pz, car.hx, car.hz, 50);
      const amberGo = car.taxi && !copNear;
      const red = sig && (sig.state === 0 || (sig.state === 1 && !amberGo && sig.dist > 9));
      // a robot that never turns green (broken / bad data): treat as a 4-way stop after a long wait
      if (red && car.v < 0.5) car.redT = (car.redT || 0) + dt;
      else if (!red) car.redT = 0;
      if (red && car.redT < 150) {
        const stop = sig.dist - 2.6;
        if (stop > -2) desired = Math.min(desired, stop < 0.4 ? 0 : Math.sqrt(2 * 3.4 * stop));
        car.why = 'sig';
      }
    }

    // give way at uncontrolled junctions when joining a bigger road
    if (car.next && remain < 22 && car.node && car.nodeArms >= 3 && car.otherRank > road.rank && !(this.props && this.props.signalAhead(car.px, car.pz, car.hx, car.hz, 30))) {
      const nx = car.node.x;
      const nz = car.node.z;
      let busy = false;
      const nb = this._nb;
      const nbN = this.#gather(nx, nz, this._nb);
      for (let i = 0; i < nbN && !busy; i++) {
        const o = nb[i];
        if (o === car || o.crash || !o.posd || o.edge.road === road) continue;
        const dx = nx - o.px;
        const dz = nz - o.pz;
        const d = hyp(dx, dz);
        if (d < 28 && (dx * o.hx + dz * o.hz) > 0 && o.v > 2) busy = true;
      }
      const P = this.player;
      if (!busy && P && this.playerActive) {
        const dx = nx - P.x;
        const dz = nz - P.z;
        if (hyp(dx, dz) < 30 && dx * Math.sin(P.yaw) + dz * Math.cos(P.yaw) > 0 && P.speed > 2) busy = true;
      }
      if (busy) {
        car.why = 'gw';
        const stop = remain - (car.taxi ? 3 : 5);
        desired = Math.min(desired, stop < 0.4 ? 0 : Math.sqrt(2 * 3.0 * stop));
      }
    }

    // taxi stops: pull over to the kerb, hazards on, load / drop, go
    if (car.taxi) {
      car.nextStop -= dt;
      if (car.stopT > 0) {
        car.stopT -= dt;
        desired = 0;
        car.blink = 2;
        if (car.stopT <= 0) {
          car.blink = 0;
          car.laneTarget = this.#laneOff(road, car.laneIdx);
          car.nextStop = 40 + this.rng() * 90;
        }
      } else if (car.nextStop <= 0 && road.rank <= 7 && road.rank >= 3 && remain > 40) {
        car.stopT = 4 + this.rng() * 6;
        car.laneIdx = 0;
        car.laneTarget = this.#laneOff(road, 0) + 0.9;
        car.blink = 2;
      }
    }

    // ---- car / player ahead: follow with a time gap ------------------------
    const look = 12 + car.v * 2.2;
    let lead = this.#leader(car, look);
    car.brakeCap = 8;
    // the player stopped in the road ahead of us
    const P = this.player;
    const pStopped = P && this.playerActive && Math.abs(P.speed) < 0.6;
    if (lead && lead.who === 'player' && pStopped && car.pass === 0) {
      const warned = P.indicator === 'hazard' || P.indicator === 'left' || P.indicator === 'right';
      if (warned) {
        // hazards / indicator: slow down, stop well back, then go round
        car.surprise = undefined;
        const stop = lead.gap - 8;
        desired = Math.min(desired, stop < 0.4 ? 0 : Math.sqrt(2 * 3.0 * stop));
        car.why = 'player-hz';
        if (lead.gap < 16 && car.v < 3) this.#startPass(car, road);
      } else {
        // no warning: the driver only notices late (and brakes too late)
        if (car.surprise === undefined) car.surprise = this.rng() < 0.6 && !this.#playerQueued(car);
        if (car.surprise) {
          const notice = 3 + car.v * 0.45;
          if (lead.gap > notice) lead = null;
          else car.brakeCap = 6.5;
        }
      }
    } else if (!lead || lead.who !== 'player') car.surprise = undefined;
    if (car.pass === 2) this.#passTick(car, road, dt);
    const headway = car.taxi && !copNear ? 0.8 : car.aggr > 1.05 ? 1.1 : 1.6;
    if (lead) {
      if (lead.gap < 8) car.why = lead.who === 'player' ? 'player' : lead.who.crash ? 'lead:wreck' : lead.who.v < 0.5 ? 'lead:stopped' : 'lead:moving';
      const safe = 2.2 + car.v * headway;
      const room = lead.gap - 2.0;
      const vFollow = room <= 0 ? 0 : Math.sqrt(lead.v * lead.v + 2 * 4.5 * room);
      if (lead.gap < safe) desired = Math.min(desired, lead.v + (lead.gap - safe) * 0.6, vFollow);
      else desired = Math.min(desired, vFollow);
      if (desired < 0) desired = 0;
    }

    // stuck behind something slow: hoot, then overtake when there's a lane
    const slowAhead = lead && lead.gap < 18 && lead.v < Math.max(3, road.speed * car.aggr * 0.5);
    if (slowAhead) car.stuck += dt;
    else car.stuck = Math.max(0, car.stuck - dt * 2);
    car.honkCd -= dt;
    if (slowAhead && car.stuck > car.patience && car.honkCd <= 0 && car.stopT <= 0 && !(this.props && this.props.signalAhead(car.px, car.pz, car.hx, car.hz, 25)?.state === 0)) {
      const P = this.player;
      const d = P ? hyp(P.x - car.px, P.z - car.pz) : 99;
      if (d < 70) honkFar(d, car.taxi ? 1.18 : 0.9 + this.rng() * 0.2, !car.taxi && this.rng() < 0.4);
      car.honkCd = (car.taxi ? 2.5 + this.rng() * 2 : 5 + this.rng() * 5) / (1 + 1.6 * (this.busy || 0));
    }
    // lane changes
    if (car.laneChangeCd > 0) car.laneChangeCd -= dt;
    else if (nl > 1 && car.stopT <= 0 && Math.abs(car.lane - car.laneTarget) < 0.2) {
      let want = car.laneIdx;
      if (car.next && car.turn !== 0 && remain < 90) want = car.turn < 0 ? 0 : nl - 1; // turn lanes
      else if (slowAhead && car.stuck > car.patience * 0.6) want = car.laneIdx + 1 < nl ? car.laneIdx + 1 : car.laneIdx - 1; // overtake
      else if (!lead && car.laneIdx > 0 && !car.taxi && this.rng() < dt * 0.15) want = car.laneIdx - 1; // keep left
      else if (car.taxi && !copNear && lead && lead.gap < 25 && this.rng() < dt * 0.8) want = car.laneIdx > 0 ? car.laneIdx - 1 : car.laneIdx + 1; // weave
      want = Math.max(0, Math.min(nl - 1, want));
      if (want !== car.laneIdx) {
        const off = this.#laneOff(road, want);
        if (this.#laneClear(car, off) || (car.taxi && !copNear && this.rng() < 0.08)) {
          car.blink = want > car.laneIdx ? 1 : -1;
          car.laneIdx = want;
          car.laneTarget = off;
          car.laneChangeCd = car.taxi ? 1.2 : 3;
        } else car.laneChangeCd = 0.6;
      }
    }
    if (car.hooted > 0) {
      car.hooted -= dt;
      const atRed = this.props && this.props.signalAhead(car.px, car.pz, car.hx, car.hz, 30)?.state === 0;
      if (!atRed) {
        if (nl > 1 && Math.abs(car.lane - car.laneTarget) < 0.2) {
          const want = car.laneIdx > 0 ? car.laneIdx - 1 : car.laneIdx + 1;
          const off = want >= 0 && want < nl ? this.#laneOff(road, want) : null;
          if (off !== null && this.#laneClear(car, off)) {
            car.blink = want > car.laneIdx ? 1 : -1;
            car.laneIdx = want;
            car.laneTarget = off;
            car.laneChangeCd = 3;
            car.hooted = 0;
          } else if (!lead || lead.gap > 20) desired = Math.max(desired, Math.min(road.speed * 1.15, car.v + 6));
        } else if (nl === 1) {
          if (!lead || lead.gap > 25) desired = Math.max(desired, Math.min(road.speed * 1.1, car.v + 5));
          else {
            // pull over to the kerb and slow so the player can pass
            car.laneTarget = this.#laneOff(road, 0) - 1.4;
            car.blink = -1;
            desired = Math.min(desired, 2);
          }
        }
      }
    }
    // single-lane road: go around something that has stopped dead (a crash)
    if (nl === 1 && lead && lead.v < 0.5 && lead.gap < 12 && car.stuck > 5 && typeof lead.who === 'object' && lead.who.crash) {
      car.laneTarget = this.#laneOff(road, 0) - 3.2;
      car.blink = 1;
      desired = Math.max(desired, 3);
    }
    // indicate before a turn
    if (car.next && car.turn !== 0 && remain < 45 && car.blink !== 2) car.blink = car.turn;

    // ---- integrate -----------------------------------------------------------
    const acc = car.taxi ? 3.0 : 2.2 * car.aggr;
    if (car.pass === 2) desired = Math.min(desired, Math.abs(car.lane - car.laneTarget) > 0.4 ? 4.5 : 8);
    if (car.pass === 2 && car.passBlock) desired = 0;
    // the body can't keep up with its lane point (a sharp corner): slow down
    // and let the lane point wait, so the body never ends up cutting across
    // the kerb towards a target metres ahead of it
    if (car.lag > 1.5) desired = Math.min(desired, car.vb + 1);
    const dv = desired - car.v;
    car.v += Math.max(-car.brakeCap * dt, Math.min(acc * dt, dv));
    if (car.v < 0) car.v = 0;
    car.dist += (car.lag > 2.5 ? Math.min(car.v, car.vb) : car.v) * dt;
    // ease across lanes (~2.5 s per lane, quicker for taxis)
    const ld = car.laneTarget - car.lane;
    if (Math.abs(ld) > 0.01) {
      const rate = (car.taxi || car.pass === 2 ? 2.0 : 1.3) * dt;
      car.lane += Math.max(-rate, Math.min(rate, ld));
      if (Math.abs(car.laneTarget - car.lane) < 0.05 && car.blink !== 2 && !(car.next && car.turn !== 0)) car.blink = 0;
    }
  }

  // Crashed car: slides free of the road, spins, comes to rest with hazards.
  #slide(car, dt) {
    const c = car.crash;
    c.t += dt;
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    c.yaw += c.w * dt;
    const sp = hyp(c.vx, c.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp - 7 * dt);
      c.vx *= ns / sp;
      c.vz *= ns / sp;
    }
    c.w *= Math.max(0, 1 - dt * 2.2);
    if (this.buildings) {
      const hit = this.buildings.collide(c.x, c.z, 1.1);
      if (hit) {
        c.x = hit.x;
        c.z = hit.z;
        const into = c.vx * hit.nx + c.vz * hit.nz;
        if (into < 0) {
          c.vx -= 1.4 * into * hit.nx;
          c.vz -= 1.4 * into * hit.nz;
        }
      }
    }
    car.v = sp;
    car.blink = 2;
  }

  // Two-circle bodies for a car-on-car contact test.
  #circles(x, z, hx, hz, len, out, o) {
    const r = 0.95;
    const a = Math.max(0, len * 0.5 - r);
    out[o] = x + hx * a;
    out[o + 1] = z + hz * a;
    out[o + 2] = x - hx * a;
    out[o + 3] = z - hz * a;
  }

  // Resolve a contact between bodies A and B. Returns impact speed (m/s).
  #contact(A, B) {
    const cA = this._ca || (this._ca = new Float64Array(4));
    const cB = this._cb || (this._cb = new Float64Array(4));
    this.#circles(A.x, A.z, A.hx, A.hz, A.len, cA, 0);
    this.#circles(B.x, B.z, B.hx, B.hz, B.len, cB, 0);
    const rA = A.wid * 0.5 + 0.05;
    const rB = B.wid * 0.5 + 0.05;
    let best = Infinity;
    let nx = 0;
    let nz = 0;
    for (let i = 0; i < 4; i += 2) {
      for (let j = 0; j < 4; j += 2) {
        const dx = cB[j] - cA[i];
        const dz = cB[j + 1] - cA[i + 1];
        const d = hyp(dx, dz);
        if (d < best) {
          best = d;
          nx = d > 1e-4 ? dx / d : 1;
          nz = d > 1e-4 ? dz / d : 0;
        }
      }
    }
    const overlap = rA + rB - best;
    if (overlap <= 0) return -1;
    const vrel = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz; // < 0 closing
    const iA = 1 / A.mass;
    const iB = 1 / B.mass;
    // push apart by mass
    const sA = overlap * iA / (iA + iB);
    const sB = overlap * iB / (iA + iB);
    A.dx = -nx * sA;
    A.dz = -nz * sA;
    B.dx = nx * sB;
    B.dz = nz * sB;
    A.ivx = 0;
    A.ivz = 0;
    B.ivx = 0;
    B.ivz = 0;
    if (vrel >= 0) return 0;
    const e = 0.22;
    const j = -(1 + e) * vrel / (iA + iB);
    A.ivx = -j * iA * nx;
    A.ivz = -j * iA * nz;
    B.ivx = j * iB * nx;
    B.ivz = j * iB * nz;
    // spin from an off-centre hit
    const tA = (nx * A.hz - nz * A.hx);
    const tB = (nx * B.hz - nz * B.hx);
    A.w = tA * Math.min(2.5, -vrel * 0.12);
    B.w = -tB * Math.min(2.5, -vrel * 0.12);
    return -vrel;
  }

  #knockCar(car, b, impact) {
    if (!car.crash) {
      // one crash record per car, reused for every later wreck
      const r = car.crashRec || (car.crashRec = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, w: 0, t: 0, y: 0 });
      r.x = car.px;
      r.z = car.pz;
      r.yaw = Math.atan2(car.hx, car.hz);
      r.vx = car.hx * car.v;
      r.vz = car.hz * car.v;
      r.w = 0;
      r.t = 0;
      r.y = car.py;
      car.crash = r;
    }
    const c = car.crash;
    c.x += b.dx;
    c.z += b.dz;
    c.vx += b.ivx;
    c.vz += b.ivz;
    c.w += b.w || 0;
    if (impact > 2) car.dmg = Math.min(1, (car.dmg || 0) + impact / 25);
  }

  #collisions(dt) {
    const P = this.player;
    // player <-> traffic
    if (P && this.playerActive) {
      const fx = Math.sin(P.yaw);
      const fz = Math.cos(P.yaw);
      const rx = Math.cos(P.yaw);
      const rz = -Math.sin(P.yaw);
      const nb = this._nb;
      const nbN = this.#gather(P.x, P.z, this._nb);
      for (let n = 0; n < nbN; n++) {
        const car = nb[n];
        if (!car.posd) continue;
        const bx = car.crash ? car.crash.x : car.px;
        const bz = car.crash ? car.crash.z : car.pz;
        if (Math.abs(bx - P.x) > 7 || Math.abs(bz - P.z) > 7) continue;
        const A = this._bA;
        A.x = P.x;
        A.z = P.z;
        A.hx = fx;
        A.hz = fz;
        A.vx = fx * P.speed + rx * P.lateral + P.knockX;
        A.vz = fz * P.speed + rz * P.lateral + P.knockZ;
        A.len = 4.4;
        A.wid = 1.75;
        A.mass = (P.phys && P.phys.mass) || 1300;
        const B = this.#body(car, this._bB);
        const impact = this.#contact(A, B);
        if (impact < 0) continue;
        P.x += A.dx;
        P.z += A.dz;
        if (impact > 0) {
          const nvx = A.vx + A.ivx;
          const nvz = A.vz + A.ivz;
          P.speed = nvx * fx + nvz * fz;
          P.lateral = 0;
          P.knockX = (nvx * rx + nvz * rz) * rx;
          P.knockZ = (nvx * rx + nvz * rz) * rz;
          P.spin = (P.spin || 0) + A.w;
        }
        if (impact > 1.2 || car.crash) this.#knockCar(car, B, impact);
        else {
          car.v = Math.min(car.v, 0.5);
          car.dist -= 0.15;
        }
        if (impact > 1.0) {
          crashSound(Math.min(1, impact / 18), 0);
          if (this.onCrash) this.onCrash(impact, car);
        }
      }
    }
    // traffic <-> traffic (anything near a crash, plus close rail cars)
    for (let ci = 0; ci < this._usedN; ci++) {
      const l = this._slots[this._used[ci]];
      for (let i = 0; i < l.n; i++) {
        const a = l.a[i];
        const nb = this._nb2;
        const nbN = this.#gather(a.crash ? a.crash.x : a.px, a.crash ? a.crash.z : a.pz, this._nb2);
        for (let n = 0; n < nbN; n++) {
          const b = nb[n];
          if (b === a || (!a.crash && !b.crash && a.edge === b.edge && a.dir === b.dir)) continue;
          if (b.id <= a.id) continue;
          const ax = a.crash ? a.crash.x : a.px;
          const az = a.crash ? a.crash.z : a.pz;
          const bx = b.crash ? b.crash.x : b.px;
          const bz = b.crash ? b.crash.z : b.pz;
          if (Math.abs(ax - bx) > 6 || Math.abs(az - bz) > 6) continue;
          const A = this.#body(a, this._bA);
          const B = this.#body(b, this._bB);
          const impact = this.#contact(A, B);
          if (impact < 0) continue;
          const wreckMoving = (a.crash && hyp(a.crash.vx, a.crash.vz) > 2) || (b.crash && hyp(b.crash.vx, b.crash.vz) > 2);
          if (impact > 7 || wreckMoving) {
            this.#knockCar(a, A, impact);
            this.#knockCar(b, B, impact);
            if (impact > 2.5 && P) {
              const d = hyp(ax - P.x, az - P.z);
              if (d < 90) crashSound(Math.min(1, impact / 18), d);
            }
          } else {
            // near miss / nudge: the one behind (or the one on the smaller road) stops;
            // a parked wreck just blocks
            if (a.crash && !b.crash) b.v = 0;
            else if (b.crash && !a.crash) a.v = 0;
            else {
              const behind = (bx - ax) * a.hx + (bz - az) * a.hz > 0 ? a : b;
              behind.v = 0;
              behind.dist -= 0.3;
            }
          }
        }
      }
    }
  }

  // Contact body of a car, written into the reused `out`.
  #body(car, out) {
    const c = car.crash;
    out.x = c ? c.x : car.px;
    out.z = c ? c.z : car.pz;
    out.hx = car.hx;
    out.hz = car.hz;
    out.vx = c ? c.vx : car.hx * car.v;
    out.vz = c ? c.vz : car.hz * car.v;
    out.len = car.len;
    out.wid = car.wid;
    out.mass = car.mass;
    out.dx = out.dz = out.ivx = out.ivz = out.w = 0;
    return out;
  }

  // Player hooted: the car ahead in our direction (within ~35 m) makes way.
  // Multi-lane: it moves over a lane if clear; otherwise it hurries along,
  // or on a narrow road pulls to the kerb and lets us pass. Nobody runs a
  // red robot for a hoot, and cops ignore it.
  playerHoot(px, pz, hx, hz) {
    let best = null;
    let bd = 36;
    for (const bucket of this.buckets) for (const car of bucket) {
      if (!car.edge || car.crash || car.cop) continue;
      const dx = car.px - px;
      const dz = car.pz - pz;
      const ahead = dx * hx + dz * hz;
      if (ahead < 3 || ahead > bd) continue;
      if (Math.abs(dx * hz - dz * hx) > 4) continue;
      if (car.hx * hx + car.hz * hz < 0.6) continue;
      best = car;
      bd = ahead;
    }
    if (!best) return false;
    best.hooted = 4 + this.rng() * 2;
    return true;
  }

  update(dt, px, pz) {
    const night = WORLD.night.value > 0.15;
    this.time = (this.time || 0) + dt;
    const blinkOn = this.time % 0.8 < 0.42;
    if (!this.ids) {
      this.ids = true;
      let n = 0;
      for (const bucket of this.buckets) for (const car of bucket) car.id = n++;
    }
    this.#hash();
    for (const bucket of this.buckets) {
      for (const car of bucket) {
        if (car.crash) this.#slide(car, dt);
        else if (car.posd) this.#drive(car, dt);
        else car.dist += car.v * dt;
      }
    }
    this.#collisions(dt);

    let li = 0;
    let bi = 0;
    for (let b = 0; b < this.buckets.length; b++) {
      const bucket = this.buckets[b];
      const parts = this.meshes[b];
      for (let i = 0; i < bucket.length; i++) {
        const car = bucket[i];
        let cx;
        let cz;
        let y;
        let yaw;
        if (car.crash) {
          const c = car.crash;
          // tidy up wrecks once they're well behind you
          const far = hyp(c.x - px, c.z - pz);
          if ((c.t > 25 && far > 140) || far > 800 || c.t > 120) {
            car.crash = null;
            car.dmg = 0;
            car.blink = 0;
            this.#relocate(car, px, pz);
          }
        }
        if (car.crash) {
          const c = car.crash;
          cx = c.x;
          cz = c.z;
          yaw = c.yaw;
          const near = this.roads.nearestRoad ? null : null;
          y = c.y !== undefined ? c.y : this.hf.heightAt(cx, cz);
          car.hx = Math.sin(yaw);
          car.hz = Math.cos(yaw);
          car.px = cx;
          car.pz = cz;
          car.posd = true;
          void near;
        } else {
          let guard = 0;
          while (car.dist > car.edge.road.len && guard++ < 4) this.#advance(car);
          const pp = pointAlong(car.edge.road, car.dir, car.dist, this._pp);
          let rx = pp.x + pp.fz * car.lane;
          let rz = pp.z - pp.fx * car.lane;
          if (this.hf.isWater(rx, rz) || hyp(rx - px, rz - pz) > 800 - 440 * (this.busy || 0)) {
            this.#relocate(car, px, pz);
            pointAlong(car.edge.road, car.dir, car.dist, pp);
            rx = pp.x + pp.fz * car.lane;
            rz = pp.z - pp.fx * car.lane;
          }
          car.cx0 = pp.x;
          car.cz0 = pp.z;
          // the lane path is the target; the body steers after it like a car
          if (!car.placed || Math.abs(car.bx - rx) + Math.abs(car.bz - rz) > 12) {
            car.placed = true;
            car.bx = rx;
            car.bz = rz;
            car.yaw = Math.atan2(pp.fx, pp.fz);
            car.steer = 0;
          } else this.#steerBody(car, dt, rx, rz);
          cx = car.bx;
          cz = car.bz;
          car.hx = Math.sin(car.yaw);
          car.hz = Math.cos(car.yaw);
          // Height where the BODY is, not where its lane point is: the body
          // trails the lane point by metres at junctions and corners (and in a
          // pass), so the lane point's height left cars floating or sunk on
          // slopes. The lane profile only picks the layer (deck vs ground).
          // (body's distance along the road = lane point's + how far the body is
          // ahead of it along the path)
          const lag = (cx - rx) * pp.fx + (cz - rz) * pp.fz;
          car.lag = -lag; // + = the lane point is ahead of the body (#drive holds it back)
          let along = (car.dir > 0 ? car.dist : car.edge.road.len - car.dist) + car.dir * lag;
          // An elevated road's profile only spans its raised pieces; off its
          // ends roadHeightAt drops to the terrain, so a car on the deck or
          // junction disc just past them sank to the ground under the bridge
          // (or flew off it). Clamp onto the profile so the hint stays on the
          // deck layer; #deckY then snaps to the drawn surface.
          const prof = car.edge.road.prof;
          if (prof) {
            const d0 = prof.d[0];
            const d1 = prof.d[prof.d.length - 1];
            // only just past an end (the junction / abutment there); further
            // away the road is back on the ground
            if (along < d0 && along > d0 - 20) along = d0;
            else if (along > d1 && along < d1 + 20) along = d1;
          }
          const yHint = this.roads.roadHeightAt ? this.roads.roadHeightAt(car.edge.road, along, cx, cz) : this.hf.heightAt(cx, cz);
          y = this.#deckY(car.edge.road, cx, cz, yHint);
          car.py = y;
          car.px = cx;
          car.pz = cz;
          car.posd = true;
          yaw = car.yaw;
        }
        // performance safety: at density < 1 a share of the FAR cars is not
        // drawn (still driven, so nothing pops or ghosts near the player)
        const dens = this.density ?? 1;
        const hide = dens < 0.999 && (car.id % 20) >= dens * 20 && (cx - px) * (cx - px) + (cz - pz) * (cz - pz) > 12100;
        if (!car.dmg) {
          // upright car: yaw about Y + position, written straight into the
          // matrix (no Vector3/Quaternion calls boxing numbers per car)
          const me = this.matrix.elements;
          const cyw = Math.cos(yaw);
          const syw = Math.sin(yaw);
          me[0] = cyw;
          me[1] = 0;
          me[2] = -syw;
          me[3] = 0;
          me[4] = 0;
          me[5] = 1;
          me[6] = 0;
          me[7] = 0;
          me[8] = syw;
          me[9] = 0;
          me[10] = cyw;
          me[11] = 0;
          me[12] = cx;
          me[13] = y;
          me[14] = cz;
          me[15] = 1;
        } else {
          this.pos.set(cx, y, cz);
          this.quat.setFromAxisAngle(this.axis, yaw);
          // battered: sits a little crooked
          this.tilt = this.tilt || new THREE.Quaternion();
          this.tiltE = this.tiltE || new THREE.Euler();
          this.tiltE.set(car.dmg * 0.05, 0, ((car.id % 2) - 0.5) * car.dmg * 0.09);
          this.tilt.setFromEuler(this.tiltE);
          this.quat.multiply(this.tilt);
          this.matrix.compose(this.pos, this.quat, this.scale);
        }
        if (hide) {
          // collapse to a point: no pixels drawn (wheels follow the zero matrix)
          const me = this.matrix.elements;
          for (let q = 0; q < 11; q++) me[q] = 0;
        }
        for (let pi = 0; pi < parts.length; pi++) parts[pi].setMatrixAt(i, this.matrix);
        this.#wheels(b, i, car, cx, cz);
        if (hide) continue;
        if (night) this.lamps.setMatrixAt(li++, this.matrix);
        // indicators / hazards: amber flashes at the four corners
        if (car.blink && blinkOn && bi < this.blinkMax - 4) {
          const hx = car.hx;
          const hz = car.hz;
          const lx = hz;
          const lz = -hx;
          const fl = car.len * 0.5 - 0.1;
          const sw = car.wid * 0.5 - 0.05;
          const s0 = car.blink === 2 ? -1 : car.blink;
          const s1 = car.blink === 2 ? 1 : car.blink;
          for (let side = s0; side <= s1; side += 2) {
            // side -1 = left: +lane offset is the driver's left
            const s = side < 0 ? 1 : -1;
            for (let fi = 0; fi < 2; fi++) {
              const f = fi === 0 ? fl : -fl;
              // the car's rotation, moved to this corner
              const me = this.matrix.elements;
              const ba = this.blinkers.instanceMatrix.array;
              const o = bi++ * 16;
              for (let q = 0; q < 12; q++) ba[o + q] = me[q];
              ba[o + 12] = cx + hx * f + lx * sw * s;
              ba[o + 13] = y + 0.75;
              ba[o + 14] = cz + hz * f + lz * sw * s;
              ba[o + 15] = 1;
            }
          }
        }
      }
      for (let pi = 0; pi < parts.length; pi++) {
        parts[pi].count = bucket.length;
        parts[pi].instanceMatrix.needsUpdate = true;
      }
      const wm = this.wheelMeshes[b];
      wm.count = bucket.length * 4;
      wm.instanceMatrix.needsUpdate = true;
    }
    this.lamps.count = li;
    this.lamps.visible = li > 0;
    this.lamps.material.opacity = Math.min(1, WORLD.night.value * 1.3);
    if (li) this.lamps.instanceMatrix.needsUpdate = true;
    this.blinkers.count = bi;
    this.blinkers.visible = bi > 0;
    if (bi) this.blinkers.instanceMatrix.needsUpdate = true;
  }
  // Height of the DRAWN road surface at (x, z): the road pieces / junction
  // discs from the roads' surface index (what the asphalt mesh is built from;
  // it can sit ~0.5 m off the terrain + lift that roadHeightAt samples).
  // Of the surfaces there, the one closest to `hint` (the lane profile, which
  // knows deck vs ground), own road first. Same rules as roads.surfaceAt but
  // without its per-call closure, so nothing allocates.
  #deckY(road, x, z, hint) {
    const R = this.roads;
    if (!R.sGrid) return hint;
    const SC = R.sCell;
    const list = R.sGrid.get(Math.floor(x / SC) * 100000 + Math.floor(z / SC));
    if (!list) return hint;
    let best = hint;
    let bestScore = 2.5; // never snap more than this far off the profile
    for (let k = 0; k < list.length; k++) {
      const item = list[k];
      let yc;
      let own = false;
      let pen = 0;
      if (item.node) {
        const nd = item.node;
        const dx = x - nd.x;
        const dz = z - nd.z;
        if (dx * dx + dz * dz > nd.r * nd.r) continue;
        yc = junctionY(nd, x, z);
      } else {
        const pc = item.pc;
        const sp = pc.s;
        const i = item.i;
        const ax = sp.xs[i - 1];
        const az = sp.zs[i - 1];
        const dx = sp.xs[i] - ax;
        const dz = sp.zs[i] - az;
        const l2 = dx * dx + dz * dz;
        if (l2 < 1e-6) continue;
        const t = ((x - ax) * dx + (z - az) * dz) / l2;
        if (t < -0.02 || t > 1.02) continue;
        const lat = ((x - ax) * dz - (z - az) * dx) / Math.sqrt(l2);
        // a wheel over the kerb when a corner is cut still counts (the
        // pavement beside the road is drawn at about road height)
        const out = (lat < 0 ? -lat : lat) - pc.hw;
        if (out > 3.5) continue;
        const tc = t < 0 ? 0 : t > 1 ? 1 : t;
        yc = sp.ys[i - 1] + (sp.ys[i] - sp.ys[i - 1]) * tc;
        if (out > 0.3) {
          yc += 0.16; // KERB_H: on the pavement
          pen = 0.8;
        }
        own = pc.road === road;
      }
      const score = Math.abs(yc - hint) - (own ? 0.6 : 0) + pen;
      if (score < bestScore) {
        bestScore = score;
        best = yc;
      }
    }
    return best;
  }

  // Point on the lane path `d` m ahead of the car (into the next road at a
  // junction), written into `out` with the path heading.
  #ahead(car, d, out) {
    const road = car.edge.road;
    const s = car.dist + d;
    if (s <= road.len || !car.next) {
      pointAlong(road, car.dir, Math.min(s, road.len), out);
      out.x += out.fz * car.lane;
      out.z -= out.fx * car.lane;
      return out;
    }
    const nr = car.next[0].road;
    let off = car.lane;
    if (nr !== road) {
      const nl = this.roads.lanesPerDir ? this.roads.lanesPerDir(nr) : 1;
      off = this.#laneOff(nr, Math.min(car.laneIdx, nl - 1));
    } else if (car.next[1] !== car.dir) off = this.#laneOff(road, 0);
    pointAlong(nr, car.next[1], s - road.len, out);
    out.x += out.fz * off;
    out.z -= out.fx * off;
    return out;
  }

  // Bicycle model: pure-pursuit steering at a look-ahead point on the lane
  // path, wheel angle limited by lock, turn rate and grip; the body only ever
  // moves along its own heading (no sideways sliding).
  #steerBody(car, dt, rx, rz) {
    const hx = Math.sin(car.yaw);
    const hz = Math.cos(car.yaw);
    // keep the body level with its point on the path (longitudinally)
    const eAlong = (rx - car.bx) * hx + (rz - car.bz) * hz;
    let vb = car.v + eAlong * 1.5;
    if (vb < 0) vb = 0;
    if (vb > car.v + 4) vb = car.v + 4;
    if (car.v < 0.05 && Math.abs(eAlong) < 0.3) vb = 0;
    // short look-ahead at town speeds so tight corners are not cut over the kerb
    const ld = clamp(2.5 + car.v * 0.7, 3.5, 22);
    const t = this.#ahead(car, ld, this._ta);
    const dx = t.x - car.bx;
    const dz = t.z - car.bz;
    const l2 = Math.max(4, dx * dx + dz * dz);
    const latL = dx * hz - dz * hx; // + = target to our left (yaw grows to the left)
    let want = Math.atan((2 * WB * latL) / l2);
    // speed for the curve ahead: path bend over the next stretch + the wheel we need now
    const pv = Math.max(14, car.v * 1.8);
    const q = this.#ahead(car, pv, this._tq);
    const dot = clamp(q.fx * hx + q.fz * hz, -1, 1);
    const bend = Math.acos(dot);
    const rBend = bend > 0.02 ? pv / bend : 1e4;
    const rNow = WB / Math.max(0.01, Math.tan(Math.min(STEER_MAX, Math.abs(want))));
    car.vCurve = Math.sqrt(A_LAT * Math.max(4, Math.min(rBend, rNow * 1.4)));
    // limits: lock, grip at this speed, and how fast the wheel can turn
    const gripLim = Math.atan((A_LAT * 1.8 * WB) / Math.max(1, vb * vb));
    const lim = Math.min(STEER_MAX, gripLim);
    if (want > lim) want = lim;
    else if (want < -lim) want = -lim;
    const ds = STEER_RATE * dt;
    car.steer += Math.max(-ds, Math.min(ds, want - car.steer));
    car.yaw += (vb / WB) * Math.tan(car.steer) * dt;
    const nhx = Math.sin(car.yaw);
    const nhz = Math.cos(car.yaw);
    car.bx += nhx * vb * dt;
    car.bz += nhz * vb * dt;
    car.vb = vb;
  }

  // four rolling wheels per car, placed off the car's own matrix (this.matrix)
  #wheels(b, i, car, cx, cz) {
    const wm = this.wheelMeshes[b];
    const L = wm.userData.layout;
    const moved = car.wx !== car.wx ? 0 : hyp(cx - car.wx, cz - car.wz); // NaN = first frame
    car.wx = cx;
    car.wz = cz;
    if (moved < 5) car.wa = (car.wa || 0) + moved / L.r;
    // wheel = car * T(sx*track, r, sz*base) * Ry(steer, front) * Ry(pi, left side)
    //         * Rx(±spin) * S(r), written straight into the instance buffer
    // (same result as the Matrix4 chain, without boxing a number per call)
    const e = this.matrix.elements;
    const arr = wm.instanceMatrix.array;
    const r = L.r;
    let k = i * 4;
    for (let sx = 1; sx >= -1; sx -= 2) {
      const a = sx < 0 ? -car.wa : car.wa;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let sz = 1; sz >= -1; sz -= 2) {
        const th = (sz > 0 ? car.steer : 0) + (sx < 0 ? Math.PI : 0);
        const ct = Math.cos(th);
        const st = Math.sin(th);
        // local 3x3 (columns) = Ry(th) * Rx(a), scaled by r
        const c0x = ct * r;
        const c0z = -st * r;
        const c1x = st * sa * r;
        const c1y = ca * r;
        const c1z = ct * sa * r;
        const c2x = st * ca * r;
        const c2y = -sa * r;
        const c2z = ct * ca * r;
        const tx = sx * L.track;
        const ty = r;
        const tz = sz * L.base;
        const o = k * 16;
        // world column = car 3x3 * local column (c0y = 0)
        arr[o] = e[0] * c0x + e[8] * c0z;
        arr[o + 1] = e[1] * c0x + e[9] * c0z;
        arr[o + 2] = e[2] * c0x + e[10] * c0z;
        arr[o + 3] = 0;
        arr[o + 4] = e[0] * c1x + e[4] * c1y + e[8] * c1z;
        arr[o + 5] = e[1] * c1x + e[5] * c1y + e[9] * c1z;
        arr[o + 6] = e[2] * c1x + e[6] * c1y + e[10] * c1z;
        arr[o + 7] = 0;
        arr[o + 8] = e[0] * c2x + e[4] * c2y + e[8] * c2z;
        arr[o + 9] = e[1] * c2x + e[5] * c2y + e[9] * c2z;
        arr[o + 10] = e[2] * c2x + e[6] * c2y + e[10] * c2z;
        arr[o + 11] = 0;
        arr[o + 12] = e[0] * tx + e[4] * ty + e[8] * tz + e[12];
        arr[o + 13] = e[1] * tx + e[5] * ty + e[9] * tz + e[13];
        arr[o + 14] = e[2] * tx + e[6] * ty + e[10] * tz + e[14];
        arr[o + 15] = 1;
        k++;
      }
    }
  }
}

export { pointAlong };
