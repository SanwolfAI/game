import * as THREE from 'three';
import { toXZ } from '../core/geo.js';

const SIGN_FILES = {
  R1: 'r1.png',
  R2: 'r2.png',
  W301: 'w301.png',
  W306: 'w306.png',
  W307: 'w307.png',
  W308: 'w308.png',
  W309: 'w309.png',
  W318: 'w318.png',
  W401: 'w401.png'
};

const SPEED_SIGNS = [40, 60, 80, 100, 120];

export class Roadside {
  constructor(data, roads, hf) {
    this.roads = roads;
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'south-african-roadside';
    this.loader = new THREE.TextureLoader();
    this.records = [];
    this.signalHeads = [];
    this.markPositions = [];
    this.markIndices = [];
    this.poleGeometry = new THREE.CylinderGeometry(0.045, 0.06, 2.45, 6);
    this.poleMaterial = new THREE.MeshLambertMaterial({ color: 0x55585c });
    this.signGeometry = new THREE.PlaneGeometry(0.82, 0.82);
    this.signMaterials = new Map();
    this.streetNameMaterials = new Map();
    this.streetBoardGeometry = new THREE.PlaneGeometry(2.7, 0.55);

    for (const feature of data.features || []) this.#placeFeature(feature);
    for (const road of roads.roads) this.#placeSpeedSign(road);
    this.#placeStreetNames();
    this.#finishMarkings();
  }

  #material(code) {
    if (this.signMaterials.has(code)) return this.signMaterials.get(code);
    const file = SIGN_FILES[code];
    if (!file) return null;
    const texture = this.loader.load(`./src/assets/signs/${file}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.signMaterials.set(code, material);
    return material;
  }

  #addSign(code, x, z, dirX, dirZ, offset = 1.5) {
    const material = this.#material(code);
    if (!material) return;
    const leftX = -dirZ;
    const leftZ = dirX;
    const px = x + leftX * offset;
    const pz = z + leftZ * offset;
    const ground = this.roads.deckHeightAt(px, pz, this.hf.heightAt(px, pz) + 6.5);
    const group = new THREE.Group();
    group.position.set(px, ground, pz);
    const pole = new THREE.Mesh(this.poleGeometry, this.poleMaterial);
    pole.position.y = 1.22;
    pole.castShadow = false;
    group.add(pole);
    const panel = new THREE.Mesh(this.signGeometry, material);
    panel.position.y = 2.18;
    panel.rotation.y = Math.atan2(dirZ, -dirX);
    group.add(panel);
    group.userData.worldX = px;
    group.userData.worldZ = pz;
    this.group.add(group);
    this.records.push(group);
  }

  #addExitSign(feature, x, z, dirX, dirZ, road) {
    if (typeof document === 'undefined') return;
    const tags = feature.t || {};
    const ref = String(tags.ref || '').slice(0, 12);
    const destination = String(tags.exit_to || tags.destination || '').slice(0, 26);
    if (!ref && !destination) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#08743b';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.strokeRect(7, 7, 498, 242);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 76px sans-serif';
    ctx.fillText(ref || 'EXIT', 256, 104);
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(destination, 256, 178, 460);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const group = new THREE.Group();
    const leftX = -dirZ;
    const leftZ = dirX;
    const px = x + leftX * (road.width * 0.5 + 2);
    const pz = z + leftZ * (road.width * 0.5 + 2);
    group.position.set(px, this.roads.deckHeightAt(px, pz) + 3.1, pz);
    group.userData.worldX = px;
    group.userData.worldZ = pz;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), material);
    board.rotation.y = Math.atan2(dirZ, -dirX);
    group.add(board);
    this.group.add(group);
    this.records.push(group);
  }

  #addTrafficLight(x, z, dirX, dirZ, road) {
    const group = new THREE.Group();
    const leftX = -dirZ;
    const leftZ = dirX;
    const px = x + leftX * (road.width * 0.5 + 0.7);
    const pz = z + leftZ * (road.width * 0.5 + 0.7);
    group.position.set(px, this.roads.deckHeightAt(px, pz) + 0.1, pz);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.09, 4.2, 8),
      new THREE.MeshLambertMaterial({ color: 0x25282c })
    );
    pole.position.y = 2.1;
    group.add(pole);
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 1.25, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x151719 })
    );
    housing.position.set(0, 3.65, 0);
    group.add(housing);
    const lamps = [0xff2020, 0xffb51b, 0x22d34d].map((color, i) => {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), material);
      lamp.position.set(0, 4.08 - i * 0.42, 0.225);
      group.add(lamp);
      return material;
    });
    group.rotation.y = Math.atan2(dirZ, -dirX);
    group.userData.worldX = px;
    group.userData.worldZ = pz;
    this.group.add(group);
    this.records.push(group);
    this.signalHeads.push({ group, lamps, phase: this.signalHeads.length * 2.7 });
  }

  #addQuad(a, b, c, d) {
    const base = this.markPositions.length / 3;
    this.markPositions.push(...a, ...b, ...c, ...d);
    this.markIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  #featureMarkings(feature, x, z, nearest) {
    const tags = feature.t || {};
    const road = nearest.road;
    const dx = nearest.dirX;
    const dz = nearest.dirZ;
    const lx = -dz;
    const lz = dx;
    const half = Math.max(2, road.width * 0.5 - 0.35);
    const yAt = (px, pz) => this.roads.deckHeightAt(px, pz, this.hf.heightAt(px, pz) + (road.bridge ? 6.5 : 0)) + 0.12;
    const addAcross = (along, thickness) => {
      const cx = x + dx * along;
      const cz = z + dz * along;
      const a = [cx - dx * thickness / 2 - lx * half, yAt(cx, cz), cz - dz * thickness / 2 - lz * half];
      const b = [cx - dx * thickness / 2 + lx * half, yAt(cx, cz), cz - dz * thickness / 2 + lz * half];
      const c = [cx + dx * thickness / 2 - lx * half, yAt(cx, cz), cz + dz * thickness / 2 - lz * half];
      const d = [cx + dx * thickness / 2 + lx * half, yAt(cx, cz), cz + dz * thickness / 2 + lz * half];
      this.#addQuad(a, b, c, d);
    };

    if (tags.highway === 'traffic_signals' || tags.highway === 'stop' || tags.highway === 'give_way') {
      addAcross(-4.5, 0.3);
    }
    if (tags.highway === 'crossing') {
      if (tags.crossing === 'zebra') {
        for (let i = -4; i <= 4; i++) {
          const along = i * 1.05;
          const cx = x + dx * along;
          const cz = z + dz * along;
          const a = [cx - dx * 0.28 - lx * half, yAt(cx, cz), cz - dz * 0.28 - lz * half];
          const b = [cx - dx * 0.28 + lx * half, yAt(cx, cz), cz - dz * 0.28 + lz * half];
          const c = [cx + dx * 0.28 - lx * half, yAt(cx, cz), cz + dz * 0.28 - lz * half];
          const d = [cx + dx * 0.28 + lx * half, yAt(cx, cz), cz + dz * 0.28 + lz * half];
          this.#addQuad(a, b, c, d);
        }
      } else {
        addAcross(-1.35, 0.18);
        addAcross(1.35, 0.18);
      }
    }
  }

  #placeFeature(feature) {
    if (!Array.isArray(feature.p) || feature.p.length !== 2) return;
    const [x, z] = toXZ(feature.p[0], feature.p[1]);
    const nearest = this.roads.nearestRoad(x, z, 45);
    if (!nearest) return;
    const tags = feature.t || {};
    const road = nearest.road;
    const offset = road.width * 0.5 + 1.5;

    if (tags.highway === 'stop') this.#addSign('R1', x, z, nearest.dirX, nearest.dirZ, offset);
    if (tags.highway === 'give_way') this.#addSign('R2', x, z, nearest.dirX, nearest.dirZ, offset);
    if (tags.highway === 'crossing') this.#addSign('W306', x, z, nearest.dirX, nearest.dirZ, offset);
    if (tags.highway === 'traffic_signals') {
      this.#addTrafficLight(x, z, nearest.dirX, nearest.dirZ, road);
      this.#addSign('W301', x - nearest.dirX * 80, z - nearest.dirZ * 80, nearest.dirX, nearest.dirZ, offset);
    }
    if (tags.highway === 'motorway_junction') this.#addExitSign(feature, x, z, nearest.dirX, nearest.dirZ, road);
    if (tags.railway === 'level_crossing') {
      // W318 warning signs are placed 120 m before the crossing on the left
      // side of each legal approach. One-way roads need only their forward sign.
      const approach = 120;
      this.#addSign(
        'W318',
        x - nearest.dirX * approach,
        z - nearest.dirZ * approach,
        nearest.dirX,
        nearest.dirZ,
        offset
      );
      if (!road.oneway) {
        this.#addSign(
          'W318',
          x + nearest.dirX * approach,
          z + nearest.dirZ * approach,
          -nearest.dirX,
          -nearest.dirZ,
          offset
        );
      }
    }
    this.#featureMarkings(feature, x, z, nearest);
  }

  #streetNameMaterial(name) {
    const key = String(name).trim();
    if (this.streetNameMaterials.has(key)) return this.streetNameMaterials.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#075b39';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = key.length > 23 ? 16 : key.length > 16 ? 19 : 23;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText(key.slice(0, 30), 128, 33, 238);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    this.streetNameMaterials.set(key, material);
    return material;
  }

  #placeStreetNames() {
    if (typeof document === 'undefined') return;
    const maxSigns = 450;
    let placed = 0;
    const poleGeometry = new THREE.CylinderGeometry(0.055, 0.075, 3.1, 6);
    for (const node of this.roads.nodes) {
      if (placed >= maxSigns || node.edges.length < 3) continue;
      const named = new Map();
      for (const edgeId of node.edges) {
        const edge = this.roads.edges[edgeId];
        const road = edge?.road;
        if (!road?.name || ['motorway', 'motorway_link'].includes(road.cls)) continue;
        const key = road.name.trim().toLowerCase();
        if (!key || named.has(key) || road.pts.length < 2) continue;
        const atStart = road.fromNode === node.id;
        const p0 = atStart ? road.pts[0] : road.pts[road.pts.length - 1];
        const p1 = atStart ? road.pts[1] : road.pts[road.pts.length - 2];
        const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
        const length = Math.hypot(dx, dz) || 1;
        named.set(key, { name: road.name, dirX: dx / length, dirZ: dz / length, road });
      }
      const entries = [...named.values()];
      if (entries.length < 2) continue;
      const first = entries[0];
      const leftX = -first.dirZ, leftZ = first.dirX;
      const offset = first.road.width * 0.5 + 1.1;
      const x = node.x + leftX * offset;
      const z = node.z + leftZ * offset;
      const ground = this.roads.deckHeightAt(x, z, this.hf.heightAt(x, z) + 6.5);
      const group = new THREE.Group();
      group.position.set(x, ground, z);
      const pole = new THREE.Mesh(poleGeometry, this.poleMaterial);
      pole.position.y = 1.55;
      group.add(pole);
      for (let i = 0; i < 2; i++) {
        const entry = entries[i];
        const board = new THREE.Mesh(this.streetBoardGeometry, this.#streetNameMaterial(entry.name));
        board.position.set(0, 2.25 + i * 0.58, 0);
        board.rotation.y = Math.atan2(entry.dirZ, -entry.dirX);
        group.add(board);
      }
      group.userData.worldX = x;
      group.userData.worldZ = z;
      this.group.add(group);
      this.records.push(group);
      placed++;
    }
    this.group.userData.streetNameSigns = placed;
  }

  #placeSpeedSign(road) {
    const speed = Number.parseInt(String(road.maxspeed || '').match(/\d+/)?.[0] || '', 10);
    if (!SPEED_SIGNS.includes(speed) || road.pts.length < 2) return;
    const a = road.pts[0];
    const b = road.pts[1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    const code = `R201-${speed}`;
    const file = `r201-${speed}.png`;
    if (!this.signMaterials.has(code)) {
      const texture = this.loader.load(`./src/assets/signs/${file}`);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.signMaterials.set(code, new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    }
    const leftX = -dz / length;
    const leftZ = dx / length;
    const px = a[0] + dx / length * 10 + leftX * (road.width * 0.5 + 1.5);
    const pz = a[1] + dz / length * 10 + leftZ * (road.width * 0.5 + 1.5);
    const ground = this.roads.deckHeightAt(px, pz, this.hf.heightAt(px, pz) + (road.bridge ? 6.5 : 0));
    const group = new THREE.Group();
    group.position.set(px, ground, pz);
    const pole = new THREE.Mesh(this.poleGeometry, this.poleMaterial);
    pole.position.y = 1.22;
    group.add(pole);
    const panel = new THREE.Mesh(this.signGeometry, this.signMaterials.get(code));
    panel.position.y = 2.18;
    panel.rotation.y = Math.atan2(dz / length, -dx / length);
    group.add(panel);
    group.userData.worldX = px;
    group.userData.worldZ = pz;
    this.group.add(group);
    this.records.push(group);
  }

  #finishMarkings() {
    if (!this.markPositions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.markPositions, 3));
    geometry.setIndex(this.markIndices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0xf4f2e8, side: THREE.DoubleSide })
    );
    mesh.name = 'stop-lines-and-pedestrian-crossings';
    this.group.add(mesh);
  }

  update(x, z, dt = 0) {
    for (const group of this.records) {
      const dx = group.userData.worldX - x;
      const dz = group.userData.worldZ - z;
      group.visible = dx * dx + dz * dz < 400 * 400;
    }
    for (const signal of this.signalHeads) {
      signal.phase += dt;
      const phase = signal.phase % 18;
      const active = phase < 8 ? 0 : phase < 10 ? 1 : 2;
      signal.lamps.forEach((material, index) => {
        material.opacity = index === active ? 1 : 0.2;
      });
    }
  }
}
