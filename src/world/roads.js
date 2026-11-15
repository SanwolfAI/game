import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { toXZ } from '../core/geo.js';

export const ROAD_CLASS = {
  motorway: { width: 17, speed: 30, color: 0x3b3b40, major: true },
  motorway_link: { width: 7, speed: 14, color: 0x4a4a50, major: false },
  trunk: { width: 14, speed: 25, color: 0x45454b, major: true },
  trunk_link: { width: 7, speed: 13, color: 0x4e4e54, major: false },
  primary: { width: 12, speed: 22, color: 0x4e4e54, major: true },
  primary_link: { width: 6, speed: 12, color: 0x55555b, major: false },
  secondary: { width: 10, speed: 18, color: 0x585860, major: true },
  secondary_link: { width: 6, speed: 11, color: 0x5a5a60, major: false },
  tertiary: { width: 8.5, speed: 15, color: 0x5f5f5c, major: true },
  tertiary_link: { width: 5, speed: 9, color: 0x60605c, major: false },
  residential: { width: 7, speed: 11, color: 0x6f6f6a, major: false },
  unclassified: { width: 7, speed: 11, color: 0x6a6a64, major: false },
  living_street: { width: 5.5, speed: 7, color: 0x66645e, major: false },
  service: { width: 4.5, speed: 6, color: 0x62615d, major: false },
  track: { width: 3.2, speed: 5, color: 0x756c59, major: false },
  path: { width: 2, speed: 4, color: 0x817b6a, major: false },
  footway: { width: 1.8, speed: 4, color: 0x898273, major: false },
  steps: { width: 1.6, speed: 2, color: 0x898273, major: false }
};

const LINK_CLASS = { width: 6, speed: 14, color: 0x55555a, major: false };

export function roadClass(cls) {
  return ROAD_CLASS[cls] || LINK_CLASS;
}

const KEY_SCALE = 4; // 4 m node snapping

function smooth01(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

export class RoadNetwork {
  constructor(data, hf) {
    this.hf = hf;
    this.roads = [];
    this.rail = [];
    this.pillars = [];
    this.group = new THREE.Group();
    this.group.name = 'roads';

    for (const r of data.roads) {
      const info = roadClass(r.h);
      const sourcePts = r.p.map((p) => toXZ(p[0], p[1]));
      const pts = [];
      if (sourcePts.length) pts.push(sourcePts[0]);
      for (let i = 1; i < sourcePts.length; i++) {
        const a = sourcePts[i - 1];
        const b = sourcePts[i];
        const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        // Straight OSM bridge ways often have only two endpoints. Add samples
        // so the raised deck, approach ramps and rails have real geometry.
        const steps = r.b ? Math.max(1, Math.ceil(distance / 10)) : 1;
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      if (pts.length < 2) continue;
      const cumulative = [0];
      for (let i = 1; i < pts.length; i++) {
        cumulative.push(cumulative[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      }
      const len = cumulative[cumulative.length - 1];
      this.roads.push({
        id: r.id,
        cls: r.h,
        name: r.n || '',
        ref: r.r || '',
        oneway: !!r.o,
        bridge: !!r.b,
        lanes: Math.max(1, Number(r.w) || 0),
        maxspeed: r.s || '',
        lanesTagged: Number(r.w) > 0,
        width: Number(r.w) > 0 ? Math.max(info.width, Number(r.w) * (roadClass(r.h).major ? 3.7 : 3.4)) : info.width,
        speed: info.speed,
        major: info.major,
        pts,
        len,
        cumulative,
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
      road.fromNode = from;
      road.toNode = to;
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
        chunk = { positions: [], colors: [], uvs: [], indices: [], dashPos: [], dashIdx: [], edgePos: [], edgeIdx: [] };
        chunks.set(k, chunk);
      }
      return chunk;
    };

    const asphaltTexture = new THREE.TextureLoader().load('./src/assets/textures/asphalt_02_diff_1k.jpg');
    asphaltTexture.wrapS = asphaltTexture.wrapT = THREE.RepeatWrapping;
    asphaltTexture.colorSpace = THREE.SRGBColorSpace;
    const asphalt = new THREE.MeshLambertMaterial({ map: asphaltTexture, vertexColors: true });
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2e9c8, side: THREE.DoubleSide });
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffd52a, side: THREE.DoubleSide });
    const bridgeRailMat = new THREE.MeshLambertMaterial({ color: 0x777d82 });
    const bridgePostMat = new THREE.MeshLambertMaterial({ color: 0x62696f });
    const bridgePierMat = new THREE.MeshLambertMaterial({ color: 0x77736b });

    for (const road of this.roads) {
      const positions = [];
      const colors = [];
      const indices = [];
      const base = new THREE.Color(roadClass(road.cls).color).lerp(new THREE.Color(0xffffff), 0.68);
      const n = road.pts.length;
      const half = road.width / 2;
      const lift = road.bridge ? 6.5 : 0;
      const cumulative = road.cumulative;
      const bridgeLiftAt = (i) => {
        if (!road.bridge) return 0;
        const rampLength = 36;
        const from = smooth01(cumulative[i] / rampLength);
        const to = smooth01((road.len - cumulative[i]) / rampLength);
        return lift * Math.min(from, to);
      };

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
        const groundY = this.hf.heightAt(p[0], p[1]);
        const y = road.bridge ? Math.max(groundY, 1.2) + bridgeLiftAt(i) : groundY + 0.28;
        positions.push(p[0] + lx * half, y, p[1] + lz * half);
        positions.push(p[0] - lx * half, y, p[1] - lz * half);
        colors.push(base.r, base.g, base.b, base.r, base.g, base.b);
      }

      for (let i = 0; i < n - 1; i++) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }

      // Add a visible deck edge, safety rails and support piers to every OSM-tagged bridge.
      if (road.bridge && n > 1) {
        if (!road.major || road.len <= 90) {
        const railOffset = half + 0.72;
        for (const side of [-1, 1]) {
          const railPoints = [];
          let lastPostAt = -Infinity;
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
            const x = p[0] + lx * railOffset * side;
            const z = p[1] + lz * railOffset * side;
            const y = Math.max(this.hf.heightAt(p[0], p[1]), 1.2) + bridgeLiftAt(i);
            railPoints.push(new THREE.Vector3(x, y + 1.05, z));
            if (cumulative[i] - lastPostAt >= 10 || i === n - 1) {
              lastPostAt = cumulative[i];
              const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.05, 0.18), bridgePostMat);
              post.position.set(x, y + 0.53, z);
              post.castShadow = false;
              this.group.add(post);
            }
          }
          if (railPoints.length > 1) {
            const curve = new THREE.CatmullRomCurve3(railPoints);
            const rail = new THREE.Mesh(
              new THREE.TubeGeometry(curve, Math.max(8, (n - 1) * 3), 0.12, 6, false),
              bridgeRailMat
            );
            rail.name = 'bridgeSafetyRail';
            this.group.add(rail);
          }
        }

        }

        // Add supports only where a mapped road actually passes beneath this bridge.
        // Place them just outside the lower road's carriageway, never in its lanes.
        if (road.major && road.len > 60) {
          let lastSupportDistance = -1000;
          for (let d = 20; d < road.len - 20; d += 12) {
            let seg = 1;
            while (seg < cumulative.length - 1 && cumulative[seg] < d) seg++;
            const span = cumulative[seg] - cumulative[seg - 1] || 1;
            const t = (d - cumulative[seg - 1]) / span;
            const a = road.pts[seg - 1];
            const b = road.pts[seg];
            const x = a[0] + (b[0] - a[0]) * t;
            const z = a[1] + (b[1] - a[1]) * t;
            const under = this.nearestRoad(
              x, z, 18,
              (candidate) => candidate.id !== road.id && !candidate.bridge && candidate.width >= 4
            );
            if (!under || under.dist > under.road.width * 0.5 + 4 || d - lastSupportDistance < 28) continue;
            const lowerLength = Math.hypot(under.dirX, under.dirZ) || 1;
            const nx = -under.dirZ / lowerLength;
            const nz = under.dirX / lowerLength;
            const offset = under.road.width * 0.5 + 0.8;
            const ramp = Math.min(smooth01(d / 36), smooth01((road.len - d) / 36));
            const deckY = Math.max(this.hf.heightAt(x, z), 1.2) + lift * ramp;
            let added = 0;
            for (const side of [-1, 1]) {
              const px = under.x + nx * offset * side;
              const pz = under.z + nz * offset * side;
              const bridgeAt = this.nearestRoad(px, pz, 12, (candidate) => candidate.id === road.id);
              if (!bridgeAt) continue;
              const blocked = this.nearestRoad(px, pz, 4, (candidate) =>
                candidate.id !== road.id && candidate.id !== under.road.id
              );
              if (blocked && blocked.dist < blocked.road.width * 0.5 + 0.5) continue;
              const bedY = this.hf.heightAt(px, pz);
              const height = deckY - bedY - 0.45;
              if (height < 1.5) continue;
              this.pillars.push({ x: px, z: pz, y: bedY, height });
              added++;
            }
            if (added) lastSupportDistance = d;
          }
        }
      }

      // Split every segment into its own safe chunk quad. The old two-segment
      // stride skipped the final quad on odd point counts, leaving visible cracks.
      for (let i = 0; i < n - 1; i++) {
        const mid = road.pts[i];
        const chunk = chunkFor(mid[0], mid[1]);
        const base0 = chunk.positions.length / 3;
        for (let k = i * 2; k <= i * 2 + 3; k++) {
          chunk.positions.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
          chunk.colors.push(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2]);
          chunk.uvs.push(positions[k * 3] / 4, positions[k * 3 + 2] / 4);
        }
        chunk.indices.push(base0, base0 + 2, base0 + 1, base0 + 1, base0 + 2, base0 + 3);
      }

      // South African-style yellow edge line along the left side of each mapped way.
      // The line follows the actual road geometry and stays slightly above the asphalt.
      for (let i = 1; i < n; i++) {
        const a = road.pts[i - 1];
        const b = road.pts[i];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const lx = -dz / len;
        const lz = dx / len;
        const offset = half - 0.22;
        const yA = road.bridge ? Math.max(this.hf.heightAt(a[0], a[1]), 1.2) + bridgeLiftAt(i - 1) + 0.06 : this.hf.heightAt(a[0], a[1]) + 0.36;
        const yB = road.bridge ? Math.max(this.hf.heightAt(b[0], b[1]), 1.2) + bridgeLiftAt(i) + 0.06 : this.hf.heightAt(b[0], b[1]) + 0.36;
        const chunk = chunkFor((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
        const baseEdge = chunk.edgePos.length / 3;
        const edgeHalf = 0.075;
        chunk.edgePos.push(
          a[0] + lx * (offset - edgeHalf), yA, a[1] + lz * (offset - edgeHalf),
          a[0] + lx * (offset + edgeHalf), yA, a[1] + lz * (offset + edgeHalf),
          b[0] + lx * (offset - edgeHalf), yB, b[1] + lz * (offset - edgeHalf),
          b[0] + lx * (offset + edgeHalf), yB, b[1] + lz * (offset + edgeHalf)
        );
        chunk.edgeIdx.push(baseEdge, baseEdge + 2, baseEdge + 1, baseEdge + 1, baseEdge + 2, baseEdge + 3);
      }

      // SA lane markings: 3 m paint / 6 m gap in town, 4 m / 8 m on freeways.
      const freeway = ['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(road.cls);
      const laneWidth = freeway ? 3.7 : 3.4;
      const laneCount = road.lanesTagged ? road.lanes : (road.major ? 2 : 1);
      const lineOffsets = [];
      if (road.oneway) {
        for (let lane = 1; lane < laneCount; lane++) {
          const offset = -half + laneWidth * lane;
          if (Math.abs(offset) < half - 0.25) lineOffsets.push(offset);
        }
      } else if (laneCount >= 2) {
        lineOffsets.push(0);
        const extraLeft = Math.floor((laneCount - 2) / 2);
        const extraRight = laneCount - 2 - extraLeft;
        for (let lane = 1; lane <= extraLeft; lane++) lineOffsets.push(-lane * laneWidth);
        for (let lane = 1; lane <= extraRight; lane++) lineOffsets.push(lane * laneWidth);
      }

      if (lineOffsets.length) {
        const dashLength = freeway ? 4 : 3;
        const dashGap = freeway ? 8 : 6;
        const dashPeriod = dashLength + dashGap;
        const solidRanges = [];
        if (!road.oneway && road.major) {
          const fromNode = this.nodes[road.fromNode];
          const toNode = this.nodes[road.toNode];
          if (fromNode?.edges.length > 1) solidRanges.push([0, Math.min(18, road.len)]);
          if (toNode?.edges.length > 1) solidRanges.push([Math.max(0, road.len - 18), road.len]);
        }

        for (const offset of lineOffsets) {
          const isCentre = !road.oneway && Math.abs(offset) < 0.01;
          for (let i = 1; i < n; i++) {
            const a = road.pts[i - 1];
            const b = road.pts[i];
            const ax = b[0] - a[0];
            const az = b[1] - a[1];
            const segLen = Math.hypot(ax, az);
            if (segLen < 0.001) continue;
            const dx = ax / segLen;
            const dz = az / segLen;
            const lx = -dz;
            const lz = dx;
            const segStart = cumulative[i - 1];
            const segEnd = cumulative[i];

            const drawPiece = (fromDistance, toDistance) => {
              const t0 = clamp((fromDistance - segStart) / segLen, 0, 1);
              const t1 = clamp((toDistance - segStart) / segLen, 0, 1);
              if (t1 - t0 < 0.0001) return;
              const x0 = a[0] + ax * t0;
              const z0 = a[1] + az * t0;
              const x1 = a[0] + ax * t1;
              const z1 = a[1] + az * t1;
              const d0 = segStart + segLen * t0;
              const d1 = segStart + segLen * t1;
              const yAt = (x, z, distance) => road.bridge
                ? Math.max(this.hf.heightAt(x, z), 1.2)
                  + lift * Math.min(smooth01(distance / 36), smooth01((road.len - distance) / 36)) + 0.055
                : this.hf.heightAt(x, z) + 0.34;
              const y0 = yAt(x0, z0, d0);
              const y1 = yAt(x1, z1, d1);
              const markHalf = 0.065;
              const chunk = chunkFor((x0 + x1) * 0.5, (z0 + z1) * 0.5);
              const baseMark = chunk.dashPos.length / 3;
              chunk.dashPos.push(
                x0 + lx * (offset - markHalf), y0, z0 + lz * (offset - markHalf),
                x0 + lx * (offset + markHalf), y0, z0 + lz * (offset + markHalf),
                x1 + lx * (offset - markHalf), y1, z1 + lz * (offset - markHalf),
                x1 + lx * (offset + markHalf), y1, z1 + lz * (offset + markHalf)
              );
              chunk.dashIdx.push(baseMark, baseMark + 2, baseMark + 1, baseMark + 1, baseMark + 2, baseMark + 3);
            };

            if (isCentre) {
              for (const [solidStart, solidEnd] of solidRanges) {
                const from = Math.max(segStart, solidStart);
                const to = Math.min(segEnd, solidEnd);
                if (to > from) drawPiece(from, to);
              }
            }

            const firstDash = Math.floor(segStart / dashPeriod);
            const lastDash = Math.floor(segEnd / dashPeriod);
            for (let dash = firstDash; dash <= lastDash; dash++) {
              const dashStart = dash * dashPeriod;
              const dashEnd = dashStart + dashLength;
              let pieces = [[Math.max(segStart, dashStart), Math.min(segEnd, dashEnd)]];
              if (isCentre) {
                for (const [solidStart, solidEnd] of solidRanges) {
                  const nextPieces = [];
                  for (const [from, to] of pieces) {
                    if (solidEnd <= from || solidStart >= to) nextPieces.push([from, to]);
                    else {
                      if (solidStart > from) nextPieces.push([from, solidStart]);
                      if (solidEnd < to) nextPieces.push([solidEnd, to]);
                    }
                  }
                  pieces = nextPieces;
                }
              }
              for (const [from, to] of pieces) if (to - from > 0.05) drawPiece(from, to);
            }
          }
        }
      }
    }

    // Fill small gaps where separately mapped OSM road ways meet.
    const junctionPositions = [];
    const junctionIndices = [];
    for (const node of this.nodes) {
      const connected = node.edges
        .map((id) => this.edges[id].road)
        .filter((road) => !road.bridge);
      if (connected.length < 2) continue;
      const radius = Math.max(...connected.map((road) => road.width * 0.5)) + 0.45;
      const y = this.hf.heightAt(node.x, node.z) + 0.36;
      const base = junctionPositions.length / 3;
      const steps = 12;
      junctionPositions.push(node.x, y, node.z);
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        junctionPositions.push(node.x + Math.cos(angle) * radius, y, node.z + Math.sin(angle) * radius);
      }
      for (let i = 0; i < steps; i++) {
        junctionIndices.push(base, base + i + 1, base + i + 2);
      }
    }
    if (junctionPositions.length) {
      const junctionGeo = new THREE.BufferGeometry();
      junctionGeo.setAttribute('position', new THREE.Float32BufferAttribute(junctionPositions, 3));
      junctionGeo.setIndex(junctionIndices);
      junctionGeo.computeVertexNormals();
      const junctionMesh = new THREE.Mesh(
        junctionGeo,
        new THREE.MeshLambertMaterial({ color: 0x55555a, side: THREE.DoubleSide })
      );
      junctionMesh.name = 'roadJunctionPatches';
      this.group.add(junctionMesh);
    }

    for (const [, chunk] of chunks) {
      if (!chunk.positions.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(chunk.colors, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(chunk.uvs, 2));
      geo.setIndex(chunk.indices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, asphalt);
      mesh.name = 'roads';
      this.group.add(mesh);

      if (chunk.edgePos.length) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', new THREE.Float32BufferAttribute(chunk.edgePos, 3));
        eg.setIndex(chunk.edgeIdx);
        const em = new THREE.Mesh(eg, edgeMat);
        em.name = 'yellowLeftEdge';
        this.group.add(em);
      }
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

  // Resolve the drivable surface at this position. The previous height keeps a
  // vehicle on the correct deck when roads cross vertically: a car below a
  // bridge stays on the ground, while a car already on the deck follows it.
  deckHeightAt(x, z, prevY = this.hf.heightAt(x, z)) {
    const ground = this.hf.heightAt(x, z);
    const nearest = this.nearestRoad(x, z, 32, (road) => road.bridge, prevY);
    if (!nearest || nearest.dist > nearest.road.width * 0.5 + 4) return ground;

    const road = nearest.road;
    const distance = nearest.distanceAlong;
    const ramp = Math.min(smooth01(distance / 36), smooth01((road.len - distance) / 36));
    const deck = Math.max(ground, 1.2) + 6.5 * ramp;
    const previous = Number.isFinite(prevY) ? prevY : ground;

    // At the foot of a ramp the deck is effectively ground level. Elsewhere,
    // require height continuity so a road passing underneath is not mistaken
    // for the bridge deck.
    return ramp < 0.04 || Math.abs(deck - previous) <= 2.75 ? deck : ground;
  }

  // Nearest road query used for the driving assist and for placing props.
  nearestRoad(x, z, radius = 60, filter = null, targetY = null) {
    const cs = this.cell;
    const cr = Math.ceil(radius / cs);
    const cx = Math.floor(x / cs);
    const cz = Math.floor(z / cs);
    let best = null;
    let bestD = radius * radius;
    let bestScore = Infinity;
    for (let gz = cz - cr; gz <= cz + cr; gz++) {
      for (let gx = cx - cr; gx <= cx + cr; gx++) {
        const list = this.grid.get(this.gridKey(gx, gz));
        if (!list) continue;
        for (const road of list) {
          if (filter && !filter(road)) continue;
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
            if (d2 <= radius * radius) {
              const distanceAlong = (road.cumulative[i] || 0) + Math.sqrt(l2) * t;
              let score = d2;
              if (targetY !== null && road.bridge) {
                const ramp = Math.min(
                  smooth01(distanceAlong / 36),
                  smooth01((road.len - distanceAlong) / 36)
                );
                const deckY = Math.max(this.hf.heightAt(px, pz), 1.2) + 6.5 * ramp;
                score += Math.pow(Math.abs(deckY - targetY) * 6, 2);
              }
              if (score < bestScore) {
                bestD = d2;
                bestScore = score;
                best = {
                  road, x: px, z: pz,
                  t: (i + t) / (pts.length - 1),
                  distanceAlong,
                  dist: Math.sqrt(d2), dirX: dx, dirZ: dz
                };
              }
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
