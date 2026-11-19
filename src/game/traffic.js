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

function pointAlong(road, dir, dist) {
  const pts = road.pts;
  const n = pts.length;
  const d = clamp(dist, 0, road.len);
  let acc = 0;

  if (dir > 0) {
    for (let i = 1; i < n; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + seg >= d || i === n - 1) {
        const t = seg > 0 ? clamp((d - acc) / seg, 0, 1) : 0;
        return {
          x: a[0] + (b[0] - a[0]) * t,
          z: a[1] + (b[1] - a[1]) * t,
          fx: (b[0] - a[0]) / (seg || 1),
          fz: (b[1] - a[1]) / (seg || 1)
        };
      }
      acc += seg;
    }
  } else {
    for (let i = n - 1; i >= 1; i--) {
      const a = pts[i];
      const b = pts[i - 1];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + seg >= d || i === 1) {
        const t = seg > 0 ? clamp((d - acc) / seg, 0, 1) : 0;
        return {
          x: a[0] + (b[0] - a[0]) * t,
          z: a[1] + (b[1] - a[1]) * t,
          fx: (b[0] - a[0]) / (seg || 1),
          fz: (b[1] - a[1]) / (seg || 1)
        };
      }
      acc += seg;
    }
  }
  const p = pts[0];
  return { x: p[0], z: p[1], fx: 0, fz: 1 };
}

const COUNTS = { gusheshe: 28, quantum: 36, polo: 26, hilux: 18, saps: 9 };
// Spawn weight by road class: busy arterials and the CBD, quiet side streets.
const CLASS_WEIGHT = { motorway: 1, trunk: 1, primary: 1, secondary: 0.85, motorway_link: 0.5, trunk_link: 0.5, primary_link: 0.5, secondary_link: 0.45, tertiary: 0.5, tertiary_link: 0.35, unclassified: 0.14, residential: 0.1, living_street: 0.05, service: 0, pedestrian: 0 };
const SPAWN_R = 650;
// Body sizes (m) and masses (kg) for collisions.
const BODY = { gusheshe: [4.4, 1.7, 1250], quantum: [5.4, 1.9, 2300], polo: [4.0, 1.7, 1100], hilux: [5.3, 1.85, 1900], saps: [5.2, 1.9, 2100] };
const CELL = 24;
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
          if (Math.hypot(m.x - px, m.z - pz) < 900) {
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
      speed: 0,
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
      stuck: 0,
      honkCd: 0,
      stopT: 0,
      nextStop: taxi ? 25 + this.rng() * 70 : 1e9,
      blink: 0, // -1 left, 1 right, 2 hazards
      next: null,
      turn: 0,
      crash: null,
      checkpoint: mid
    };
  }

  #laneOff(road, i) {
    if (this.roads.laneOffsetAt) return this.roads.laneOffsetAt(road, i);
    return LANE;
  }

  #relocate(car, px, pz) {
    const fresh = this.#makeCar(car.type, px, pz, 220); // respawn out of sight
    if (!fresh) return;
    Object.assign(car, fresh);
  }

  // Pick the edge after this one (once, ahead of time, so the car can get
  // into the right lane and slow for the turn).
  #chooseNext(car) {
    const edge = car.edge;
    const arrival = car.dir > 0 ? edge.to : edge.from;
    const node = this.roads.nodes[arrival];
    const options = [];
    if (node) {
      for (const id of node.edges) {
        const e = this.roads.edges[id];
        if (!e || e === edge || e.len < 4) continue;
        let dir = 0;
        if (e.from === arrival) dir = 1;
        else if (e.reverse && e.to === arrival) dir = -1;
        if (dir && e.road.rank > 1) options.push([e, dir]);
      }
    }
    let next = null;
    if (options.length) {
      let sum = 0;
      for (const o of options) sum += (CLASS_WEIGHT[o[0].road.cls] ?? 0.2) + 0.05;
      let pick = this.rng() * sum;
      next = options[options.length - 1];
      for (const o of options) {
        pick -= (CLASS_WEIGHT[o[0].road.cls] ?? 0.2) + 0.05;
        if (pick <= 0) {
          next = o;
          break;
        }
      }
    } else if (!edge.road.oneway) next = [edge, -car.dir];
    else next = [edge, car.dir];
    car.next = next;
    car.node = node;
    car.nodeArms = options.length + 1;
    // turn direction: cross product of heading in vs heading out
    const a = pointAlong(edge.road, car.dir, edge.road.len - 0.5);
    const b = pointAlong(next[0].road, next[1], 3);
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
        if (car.px === undefined) continue;
        const d = Math.hypot(car.px - px, car.pz - pz);
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
    const grid = this.grid || (this.grid = new Map());
    for (const l of grid.values()) l.length = 0;
    const cops = this.cops || (this.cops = []);
    cops.length = 0;
    for (const bucket of this.buckets) {
      for (const car of bucket) {
        if (car.px === undefined) continue;
        const k = Math.floor(car.px / CELL) * 100000 + Math.floor(car.pz / CELL);
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(car);
        if (car.cop && !car.crash) cops.push(car);
      }
    }
  }

  #near(x, z, fn) {
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gz - 1; b <= gz + 1; b++) {
        const l = this.grid.get(a * 100000 + b);
        if (l) for (const c of l) fn(c);
      }
    }
  }

  // Closest thing in our path within `look` m: another car or the player.
  #leader(car, look) {
    const hx = car.hx;
    const hz = car.hz;
    let best = null;
    let bestGap = look;
    const test = (ox, oz, ohx, ohz, ov, olen, owid, who) => {
      const dx = ox - car.px;
      const dz = oz - car.pz;
      const ahead = dx * hx + dz * hz;
      if (ahead <= 0.5 || ahead > look + 6) return;
      const lat = Math.abs(dx * hz - dz * hx);
      if (lat > (car.wid + owid) * 0.5 + 0.35) return;
      // only things moving with us or across us (ignore oncoming in the other lane: lat filter does that)
      const gap = ahead - (car.len + olen) * 0.5;
      if (gap < bestGap) {
        bestGap = gap;
        const along = (ohx * hx + ohz * hz) * ov;
        best = { gap, v: Math.max(0, along), who };
      }
    };
    this.#near(car.px, car.pz, (o) => {
      if (o === car || o.px === undefined) return;
      test(o.px, o.pz, o.hx, o.hz, o.crash ? 0 : o.v, o.len, o.wid, o);
    });
    const P = this.player;
    if (P && this.playerActive) test(P.x, P.z, Math.sin(P.yaw), Math.cos(P.yaw), P.speed, 4.4, 1.8, 'player');
    return best;
  }

  // Is a lateral move to offset `off` clear (no car alongside / close behind)?
  #laneClear(car, off) {
    const lx = car.hz;
    const lz = -car.hx;
    const tx = car.cx0 + lx * off;
    const tz = car.cz0 + lz * off;
    let ok = true;
    const chk = (ox, oz, ov) => {
      const dx = ox - tx;
      const dz = oz - tz;
      const ahead = dx * car.hx + dz * car.hz;
      const lat = Math.abs(dx * car.hz - dz * car.hx);
      if (lat > 2.2) return;
      const room = ahead >= 0 ? 9 + Math.max(0, car.v - ov) * 1.2 : 8 + Math.max(0, ov - car.v) * 1.6;
      if (Math.abs(ahead) < room) ok = false;
    };
    this.#near(tx, tz, (o) => {
      if (o !== car && o.px !== undefined) chk(o.px, o.pz, o.v || 0);
    });
    const P = this.player;
    if (P && this.playerActive) chk(P.x, P.z, P.speed);
    return ok;
  }

  #nearCop(car) {
    for (const c of this.cops) if (Math.abs(c.px - car.px) + Math.abs(c.pz - car.pz) < 220) return true;
    if (this.playerIsCop && this.player && Math.abs(this.player.x - car.px) + Math.abs(this.player.z - car.pz) < 160) return true;
    return false;
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
      this.#near(nx, nz, (o) => {
        if (busy || o === car || o.crash || o.px === undefined || o.edge.road === road) return;
        const dx = nx - o.px;
        const dz = nz - o.pz;
        const d = Math.hypot(dx, dz);
        if (d < 28 && (dx * o.hx + dz * o.hz) > 0 && o.v > 2) busy = true;
      });
      const P = this.player;
      if (!busy && P && this.playerActive) {
        const dx = nx - P.x;
        const dz = nz - P.z;
        if (Math.hypot(dx, dz) < 30 && dx * Math.sin(P.yaw) + dz * Math.cos(P.yaw) > 0 && P.speed > 2) busy = true;
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
    const lead = this.#leader(car, look);
    const headway = car.taxi && !copNear ? 0.8 : car.aggr > 1.05 ? 1.1 : 1.6;
    if (lead) {
      if (lead.gap < 8) car.why = lead.who === 'player' ? 'player' : 'lead:' + (lead.who.crash ? 'wreck' : lead.who.v < 0.5 ? 'stopped' : 'moving');
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
      const d = P ? Math.hypot(P.x - car.px, P.z - car.pz) : 99;
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
    const dv = desired - car.v;
    const acc = car.taxi ? 3.0 : 2.2 * car.aggr;
    car.v += Math.max(-8 * dt, Math.min(acc * dt, dv));
    if (car.v < 0) car.v = 0;
    car.dist += car.v * dt;
    // ease across lanes (~2.5 s per lane, quicker for taxis)
    const ld = car.laneTarget - car.lane;
    if (Math.abs(ld) > 0.01) {
      const rate = (car.taxi ? 2.0 : 1.3) * dt;
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
    const sp = Math.hypot(c.vx, c.vz);
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
        const d = Math.hypot(dx, dz);
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
      car.crash = { x: car.px, z: car.pz, yaw: Math.atan2(car.hx, car.hz), vx: car.hx * car.v, vz: car.hz * car.v, w: 0, t: 0, y: car.py };
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
    const bodyOf = (car) => {
      const c = car.crash;
      return {
        x: c ? c.x : car.px,
        z: c ? c.z : car.pz,
        hx: car.hx,
        hz: car.hz,
        vx: c ? c.vx : car.hx * car.v,
        vz: c ? c.vz : car.hz * car.v,
        len: car.len,
        wid: car.wid,
        mass: car.mass
      };
    };
    // player <-> traffic
    if (P && this.playerActive) {
      const fx = Math.sin(P.yaw);
      const fz = Math.cos(P.yaw);
      const rx = Math.cos(P.yaw);
      const rz = -Math.sin(P.yaw);
      this.#near(P.x, P.z, (car) => {
        if (car.px === undefined) return;
        const bx = car.crash ? car.crash.x : car.px;
        const bz = car.crash ? car.crash.z : car.pz;
        if (Math.abs(bx - P.x) > 7 || Math.abs(bz - P.z) > 7) return;
        const A = {
          x: P.x,
          z: P.z,
          hx: fx,
          hz: fz,
          vx: fx * P.speed + rx * P.lateral + P.knockX,
          vz: fz * P.speed + rz * P.lateral + P.knockZ,
          len: 4.4,
          wid: 1.75,
          mass: (P.phys && P.phys.mass) || 1300
        };
        const B = bodyOf(car);
        const impact = this.#contact(A, B);
        if (impact < 0) return;
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
      });
    }
    // traffic <-> traffic (anything near a crash, plus close rail cars)
    for (const l of this.grid.values()) {
      for (let i = 0; i < l.length; i++) {
        const a = l[i];
        for (const b of this.#neighbours(a)) {
          if (b === a || (!a.crash && !b.crash && a.edge === b.edge && a.dir === b.dir)) continue;
          if (b.id <= a.id) continue;
          const ax = a.crash ? a.crash.x : a.px;
          const az = a.crash ? a.crash.z : a.pz;
          const bx = b.crash ? b.crash.x : b.px;
          const bz = b.crash ? b.crash.z : b.pz;
          if (Math.abs(ax - bx) > 6 || Math.abs(az - bz) > 6) continue;
          const A = bodyOf(a);
          const B = bodyOf(b);
          const impact = this.#contact(A, B);
          if (impact < 0) continue;
          const wreckMoving = (a.crash && Math.hypot(a.crash.vx, a.crash.vz) > 2) || (b.crash && Math.hypot(b.crash.vx, b.crash.vz) > 2);
          if (impact > 7 || wreckMoving) {
            this.#knockCar(a, A, impact);
            this.#knockCar(b, B, impact);
            if (impact > 2.5 && P) {
              const d = Math.hypot(ax - P.x, az - P.z);
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

  *#neighbours(car) {
    const x = car.crash ? car.crash.x : car.px;
    const z = car.crash ? car.crash.z : car.pz;
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gz - 1; b <= gz + 1; b++) {
        const l = this.grid.get(a * 100000 + b);
        if (l) yield* l;
      }
    }
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
        else if (car.hx !== undefined) this.#drive(car, dt);
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
          const far = Math.hypot(c.x - px, c.z - pz);
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
          void near;
        } else {
          let guard = 0;
          while (car.dist > car.edge.road.len && guard++ < 4) this.#advance(car);
          const pp = pointAlong(car.edge.road, car.dir, car.dist);
          cx = pp.x + pp.fz * car.lane;
          cz = pp.z - pp.fx * car.lane;
          if (this.hf.isWater(cx, cz) || Math.hypot(cx - px, cz - pz) > 800 - 440 * (this.busy || 0)) {
            this.#relocate(car, px, pz);
            const q = pointAlong(car.edge.road, car.dir, car.dist);
            cx = q.x + q.fz * car.lane;
            cz = q.z - q.fx * car.lane;
            car.hx = q.fx;
            car.hz = q.fz;
          } else {
            car.hx = pp.fx;
            car.hz = pp.fz;
          }
          car.cx0 = cx - car.hz * car.lane;
          car.cz0 = cz + car.hx * car.lane;
          const along = car.dir > 0 ? car.dist : car.edge.road.len - car.dist;
          y = this.roads.roadHeightAt ? this.roads.roadHeightAt(car.edge.road, along, cx, cz) : this.hf.heightAt(cx, cz);
          car.py = y;
          car.px = cx;
          car.pz = cz;
          yaw = Math.atan2(car.hx, car.hz);
        }
        this.pos.set(cx, y, cz);
        this.quat.setFromAxisAngle(this.axis, yaw);
        if (car.dmg) {
          // battered: sits a little crooked
          this.tilt = this.tilt || new THREE.Quaternion();
          this.tiltE = this.tiltE || new THREE.Euler();
          this.tiltE.set(car.dmg * 0.05, 0, ((car.id % 2) - 0.5) * car.dmg * 0.09);
          this.tilt.setFromEuler(this.tiltE);
          this.quat.multiply(this.tilt);
        }
        this.matrix.compose(this.pos, this.quat, this.scale);
        for (const mesh of parts) mesh.setMatrixAt(i, this.matrix);
        this.#wheels(b, i, car, cx, cz);
        if (night) this.lamps.setMatrixAt(li++, this.matrix);
        // indicators / hazards: amber flashes at the four corners
        if (car.blink && blinkOn && bi < this.blinkMax - 4) {
          const hx = car.hx;
          const hz = car.hz;
          const lx = hz;
          const lz = -hx;
          const fl = car.len * 0.5 - 0.1;
          const sw = car.wid * 0.5 - 0.05;
          for (const side of car.blink === 2 ? [-1, 1] : [car.blink]) {
            // side -1 = left: +lane offset is the driver's left
            const s = side < 0 ? 1 : -1;
            for (const f of [fl, -fl]) {
              this.pos.set(cx + hx * f + lx * sw * s, y + 0.75, cz + hz * f + lz * sw * s);
              this.matrix.compose(this.pos, this.quat, this.scale);
              this.blinkers.setMatrixAt(bi++, this.matrix);
            }
          }
        }
      }
      for (const mesh of parts) {
        mesh.count = bucket.length;
        mesh.instanceMatrix.needsUpdate = true;
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
  // four rolling wheels per car, placed off the car's own matrix (this.matrix)
  #wheels(b, i, car, cx, cz) {
    const wm = this.wheelMeshes[b];
    const L = wm.userData.layout;
    const moved = car.wx === undefined ? 0 : Math.hypot(cx - car.wx, cz - car.wz);
    car.wx = cx;
    car.wz = cz;
    if (moved < 5) car.wa = (car.wa || 0) + moved / L.r;
    if (!this.wTmp) {
      this.wTmp = new THREE.Matrix4();
      this.wRot = new THREE.Matrix4();
      this.wFlip = new THREE.Matrix4().makeRotationY(Math.PI);
      this.wScale = new THREE.Matrix4();
    }
    this.wScale.makeScale(L.r, L.r, L.r);
    let k = i * 4;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const m = this.wTmp.copy(this.matrix);
        m.multiply(this.wRot.makeTranslation(sx * L.track, L.r, sz * L.base));
        if (sx < 0) m.multiply(this.wFlip);
        m.multiply(this.wRot.makeRotationX(sx < 0 ? -car.wa : car.wa));
        m.multiply(this.wScale);
        wm.setMatrixAt(k++, m);
      }
    }
  }
}

export { pointAlong };
