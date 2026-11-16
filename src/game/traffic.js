import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';
import { VEHICLE_TYPES, buildVehicleMesh } from './models.js';
import { trafficCarModel } from './carModels.js';
import { glowTexture } from './carLights.js';
import { WORLD } from '../world/worldLight.js';

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

const COUNTS = { gusheshe: 15, quantum: 17, polo: 13, hilux: 11, saps: 8 };
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
  }

  #makeCar(type, px, pz) {
    let edge = null;
    let mid = null;
    for (let tries = 0; tries < 40; tries++) {
      const candidate = this.roads.edges[Math.floor(this.rng() * this.roads.edges.length)];
      if (!candidate || candidate.road.len < 12) continue;
      const m = pointAlong(candidate.road, 1, candidate.road.len * this.rng());
      if (this.hf.isWater(m.x, m.z)) continue;
      if (Math.hypot(m.x - px, m.z - pz) > 900) continue;
      edge = candidate;
      mid = m;
      break;
    }
    if (!edge) {
      edge = this.roads.randomEdge(this.rng);
      if (!edge) return null;
      mid = pointAlong(edge.road, 1, edge.road.len * 0.5);
    }
    return {
      type,
      edge,
      dir: edge.reverse && this.rng() > 0.5 ? -1 : 1,
      dist: this.rng() * edge.road.len,
      speed: clamp(edge.road.speed * (0.28 + this.rng() * 0.18), 3.5, 13),
      lane: this.roads.laneOffset ? this.roads.laneOffset(edge.road, this.rng) : LANE + this.rng() * 0.6,
      checkpoint: mid
    };
  }

  #relocate(car, px, pz) {
    const fresh = this.#makeCar(car.type, px, pz);
    if (!fresh) return;
    Object.assign(car, fresh);
  }

  #advance(car) {
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
        if (dir) options.push([e, dir]);
      }
    }

    let next = null;
    if (options.length) next = options[Math.floor(this.rng() * options.length)];
    else if (!edge.road.oneway) next = [edge, -car.dir];
    else next = [edge, car.dir];

    car.edge = next[0];
    car.dir = next[1];
    car.dist = Math.max(0, car.dist - edge.road.len);
    car.speed = clamp(car.edge.road.speed * (0.28 + this.rng() * 0.18), 3.5, 13);
    if (car.edge.road !== edge.road && this.roads.laneOffset) car.lane = this.roads.laneOffset(car.edge.road, this.rng);
  }

  update(dt, px, pz) {
    const night = WORLD.night.value > 0.15;
    let li = 0;
    for (let b = 0; b < this.buckets.length; b++) {
      const bucket = this.buckets[b];
      const parts = this.meshes[b];
      for (let i = 0; i < bucket.length; i++) {
        const car = bucket[i];
        car.dist += car.speed * dt;

        let guard = 0;
        while (car.dist > car.edge.road.len && guard++ < 4) this.#advance(car);

        const p = pointAlong(car.edge.road, car.dir, car.dist);
        const lx = p.fz;
        const lz = -p.fx;
        const x = p.x + lx * car.lane;
        const z = p.z + lz * car.lane;

        if (this.hf.isWater(x, z) || Math.hypot(x - px, z - pz) > 950) {
          this.#relocate(car, px, pz);
          if (!car.edge) continue;
        }

        const pp = pointAlong(car.edge.road, car.dir, car.dist);
        const cx = pp.x + pp.fz * car.lane;
        const cz = pp.z - pp.fx * car.lane;
        const along = car.dir > 0 ? car.dist : car.edge.road.len - car.dist;
        const y = this.roads.roadHeightAt ? this.roads.roadHeightAt(car.edge.road, along, cx, cz) : this.hf.heightAt(pp.x, pp.z);
        this.pos.set(cx, y, cz);
        this.quat.setFromAxisAngle(this.axis, Math.atan2(pp.fx, pp.fz));
        this.matrix.compose(this.pos, this.quat, this.scale);
        for (const mesh of parts) mesh.setMatrixAt(i, this.matrix);
        if (night) this.lamps.setMatrixAt(li++, this.matrix);
      }
      for (const mesh of parts) {
        mesh.count = bucket.length;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.lamps.count = li;
    this.lamps.visible = li > 0;
    this.lamps.material.opacity = Math.min(1, WORLD.night.value * 1.3);
    if (li) this.lamps.instanceMatrix.needsUpdate = true;
  }
}

export { pointAlong };
