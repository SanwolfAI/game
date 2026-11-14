import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { toXZ } from '../core/geo.js';

export const ROAD_CLASS = {
  motorway: { width: 17, speed: 30, color: 0x3b3b40, major: true },
  trunk: { width: 14, speed: 25, color: 0x45454b, major: true },
  primary: { width: 12, speed: 22, color: 0x4e4e54, major: true },
  secondary: { width: 10, speed: 18, color: 0x585860, major: true },
  tertiary: { width: 8.5, speed: 15, color: 0x5f5f5c, major: true },
  residential: { width: 7, speed: 11, color: 0x6f6f6a, major: false },
  unclassified: { width: 7, speed: 11, color: 0x6a6a64, major: false },
  living_street: { width: 5.5, speed: 7, color: 0x66645e, major: false }
};

const LINK_CLASS = { width: 6, speed: 14, color: 0x55555a, major: false };

export function roadClass(cls) {
  return ROAD_CLASS[cls] || LINK_CLASS;
}

const KEY_SCALE = 4; // 4 m node snapping

export class RoadNetwork {
  constructor(data, hf) {
    this.hf = hf;
    this.roads = [];
    this.rail = [];
    this.group = new THREE.Group();
    this.group.name = 'roads';

    for (const r of data.roads) {
      const info = roadClass(r.h);
      const pts = [];
      for (const p of r.p) {
        pts.push(toXZ(p[0], p[1]));
      }
      if (pts.length < 2) continue;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      this.roads.push({
        id: r.id,
        cls: r.h,
        name: r.n || '',
        ref: r.r || '',
        oneway: !!r.o,
        bridge: !!r.b,
        width: info.width,
        speed: info.speed,
        major: info.major,
        pts,
        len,
        id2: this.roads.length
      });
    }

    for (const r of data.rail || []) {
      const pts = r.p.map((p) => toXZ(p[0], p[1]));
      if (pts.length > 1) this.rail.push({ pts, name: r.n || '' });
    }

    this.#buildGraph();
    this.#buildIndex();
    this.#buildMeshes();
  }

  #buildGraph() {
    const nodes = [];
    const nodeMap = new Map();
    const key = (x, z) => `${Math.round(x / KEY_SCALE)},${Math.round(z / KEY_SCALE)}`;
    const nodeAt = (x, z) => {
      const k = key(x, z);
      let id = nodeMap.get(k);
      if (id === undefined) {
        id = nodes.length;
        nodes.push({ id, x, z, edges: [] });
        nodeMap.set(k, id);
      }
      return id;
    };

    this.nodes = nodes;
    this.edges = [];
    for (const road of this.roads) {
      const a = road.pts[0];
      const b = road.pts[road.pts.length - 1];
      const from = nodeAt(a[0], a[1]);
      const to = nodeAt(b[0], b[1]);
      if (from === to) continue;
      const edge = { id: this.edges.length, road, from, to, forward: true, reverse: !road.oneway, len: road.len };
      this.edges.push(edge);
      nodes[from].edges.push(edge.id);
      nodes[to].edges.push(edge.id);
      road.edgeIds = road.edgeIds || [];
      road.edgeIds.push(edge.id);
    }
  }

  #buildIndex() {
    this.cell = 250;
    this.grid = new Map();
    const key = (cx, cz) => cx * 100000 + cz;
    for (const road of this.roads) {
      let minx = Infinity;
      let maxx = -Infinity;
      let minz = Infinity;
      let maxz = -Infinity;
      for (const p of road.pts) {
        minx = Math.min(minx, p[0]);
        maxx = Math.max(maxx, p[0]);
        minz = Math.min(minz, p[1]);
        maxz = Math.max(maxz, p[1]);
      }
      const cx0 = Math.floor(minx / this.cell);
      const cx1 = Math.floor(maxx / this.cell);
      const cz0 = Math.floor(minz / this.cell);
      const cz1 = Math.floor(maxz / this.cell);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = key(cx, cz);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(road);
        }
      }
    }
    this.gridKey = key;
  }

  #buildMeshes() {
    const chunkSize = 3000;
    const chunks = new Map();
    const ckey = (cx, cz) => `${cx},${cz}`;
    const chunkFor = (x, z) => {
      const k = ckey(Math.floor(x / chunkSize), Math.floor(z / chunkSize));
      let chunk = chunks.get(k);
      if (!chunk) {
        chunk = { positions: [], colors: [], indices: [], dashPos: [], dashIdx: [] };
        chunks.set(k, chunk);
      }
      return chunk;
    };

    const asphalt = new THREE.MeshLambertMaterial({ vertexColors: true });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2e9c8, side: THREE.DoubleSide });

    for (const road of this.roads) {
      const positions = [];
      const colors = [];
      const indices = [];
      const base = new THREE.Color(roadClass(road.cls).color);
      const n = road.pts.length;
      const half = road.width / 2;
      const lift = road.bridge ? 6.5 : 0;

      for (let i = 0; i < n; i++) {
        const p = road.pts[i];
        const a = road.pts[Math.max(0, i - 1)];
        const b = road.pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const lx = -dz;
        const lz = dx;
        const y = this.hf.heightAt(p[0], p[1]) + (road.bridge ? lift : 0.28);
        positions.push(p[0] + lx * half, y, p[1] + lz * half);
        positions.push(p[0] - lx * half, y, p[1] - lz * half);
        colors.push(base.r, base.g, base.b, base.r, base.g, base.b);
      }

      for (let i = 0; i < n - 1; i++) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }

      // Split the ribbon into 2km chunks so frustum culling can drop most of the map.
      for (let i = 0; i < n - 1; i += 2) {
        const mid = road.pts[i];
        const chunk = chunkFor(mid[0], mid[1]);
        const base0 = chunk.positions.length / 3;
        for (let k = i * 2; k <= i * 2 + 3; k++) {
          chunk.positions.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
          chunk.colors.push(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2]);
        }
        chunk.indices.push(base0, base0 + 2, base0 + 1, base0 + 1, base0 + 2, base0 + 3);
      }

      // Centre dashes on the arterial roads.
      if (road.major) {
        const dashChunk = chunkFor(road.pts[0][0], road.pts[0][1]);
        let acc = 0;
        for (let i = 1; i < n; i++) {
          const q = road.pts[i - 1];
          const p = road.pts[i];
          const segLen = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (segLen < 0.001) continue;
          acc += segLen;
          if (acc < 9) continue;
          acc = 0;
          let dx = (p[0] - q[0]) / segLen;
          let dz = (p[1] - q[1]) / segLen;
          const lx = -dz;
          const lz = dx;
          const mx = (p[0] + q[0]) / 2;
          const mz = (p[1] + q[1]) / 2;
          const my = this.hf.heightAt(mx, mz) + (road.bridge ? lift : 0.33);
          const hl = 2.2;
          const hw = 0.16;
          const b0 = dashChunk.dashPos.length / 3;
          dashChunk.dashPos.push(
            mx - dx * hl + lx * hw, my, mz - dz * hl + lz * hw,
            mx - dx * hl - lx * hw, my, mz - dz * hl - lz * hw,
            mx + dx * hl + lx * hw, my, mz + dz * hl + lz * hw,
            mx + dx * hl - lx * hw, my, mz + dz * hl - lz * hw
          );
          dashChunk.dashIdx.push(b0, b0 + 2, b0 + 1, b0 + 1, b0 + 2, b0 + 3);
        }
      }
    }

    for (const [, chunk] of chunks) {
      if (!chunk.positions.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(chunk.colors, 3));
      geo.setIndex(chunk.indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, asphalt);
      mesh.name = 'roads';
      this.group.add(mesh);

      if (chunk.dashPos.length) {
        const dg = new THREE.BufferGeometry();
        dg.setAttribute('position', new THREE.Float32BufferAttribute(chunk.dashPos, 3));
        dg.setIndex(chunk.dashIdx);
        const dm = new THREE.Mesh(dg, dashMat);
        dm.name = 'roadDashes';
        this.group.add(dm);
      }
    }

    // Railways
    const railPositions = [];
    const railIndices = [];
    for (const line of this.rail) {
      const start = railPositions.length / 3;
      for (let i = 0; i < line.pts.length; i++) {
        const p = line.pts[i];
        const a = line.pts[Math.max(0, i - 1)];
        const b = line.pts[Math.min(line.pts.length - 1, i + 1)];
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const y = this.hf.heightAt(p[0], p[1]) + 0.3;
        railPositions.push(p[0] - dz * 2.2, y, p[1] + dx * 2.2, p[0] + dz * 2.2, y, p[1] - dx * 2.2);
      }
      for (let i = 0; i < line.pts.length - 1; i++) {
        const a = start + i * 2;
        railIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    if (railPositions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
      geo.setIndex(railIndices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: 0x6b6157 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'rail';
      this.group.add(mesh);
    }
  }

  // Nearest road query used for the driving assist and for placing props.
  nearestRoad(x, z, radius = 60) {
    const cs = this.cell;
    const cr = Math.ceil(radius / cs);
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    let best = null;
    let bestD = radius * radius;
    for (let gz = cz - cr; gz <= cz + cr; gz++) {
      for (let gx = cx - cr; gx <= cx + cr; gx++) {
        const list = this.grid.get(this.gridKey(gx, gz));
        if (!list) continue;
        for (const road of list) {
          const pts = road.pts;
          for (let i = 0; i < pts.length - 1; i++) {
            const ax = pts[i][0];
            const az = pts[i][1];
            const bx = pts[i + 1][0];
            const bz = pts[i + 1][1];
            const dx = bx - ax;
            const dz = bz - az;
            const l2 = dx * dx + dz * dz;
            let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
            t = clamp(t, 0, 1);
            const px = ax + dx * t;
            const pz = az + dz * t;
            const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
            if (d2 < bestD) {
              bestD = d2;
              best = { road, x: px, z: pz, t: (i + t) / (pts.length - 1), dist: Math.sqrt(d2), dirX: dx, dirZ: dz };
            }
          }
        }
      }
    }
    return best;
  }

  // Node lookup used by the traffic AI.
  nodeByPos(x, z) {
    const k = `${Math.round(x / KEY_SCALE)},${Math.round(z / KEY_SCALE)}`;
    for (const node of this.nodes) {
      if (`${Math.round(node.x / KEY_SCALE)},${Math.round(node.z / KEY_SCALE)}` === k) return node;
    }
    return null;
  }

  randomEdge(rng) {
    return this.edges[Math.floor(rng() * this.edges.length)];
  }
}
