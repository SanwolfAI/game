import * as THREE from '../../vendor/three/three.module.js';
import { hdCanvas } from '../core/hdcanvas.js';

// Real landmarks from OpenStreetMap (src/data/durban-landmarks.json, built by
// scripts/build-landmarks.py): hospitals, clinics, schools, campuses, police,
// fuel stations, malls, supermarkets, stations, halls, libraries, stadiums,
// sports fields, playgrounds and named industrial areas. Each named place gets
// a roadside name pylon (only the nearest few are drawn, from a small canvas
// atlas), fuel stations get a forecourt canopy with pumps, and sports fields /
// playgrounds get their real outline painted on the ground.
export const CATS = {
  hospital: { label: 'HOSPITAL', icon: 'H', color: '#c62828' },
  clinic: { label: 'CLINIC', icon: '+', color: '#d84343' },
  school: { label: 'SCHOOL', icon: 'S', color: '#1f6fb2' },
  campus: { label: 'CAMPUS', icon: 'U', color: '#283593' },
  police: { label: 'SAPS POLICE', icon: 'P', color: '#0b3d91' },
  fuel: { label: 'FUEL', icon: 'F', color: '#2e7d32' },
  mall: { label: 'MALL', icon: 'M', color: '#7b1fa2' },
  shop: { label: 'SHOPS', icon: '$', color: '#8e24aa' },
  station: { label: 'STATION', icon: 'T', color: '#ef6c00' },
  hall: { label: 'HALL', icon: 'C', color: '#6d4c41' },
  library: { label: 'LIBRARY', icon: 'L', color: '#5d4037' },
  market: { label: 'MARKET', icon: 'M', color: '#f9a825' },
  stadium: { label: 'STADIUM', icon: '★', color: '#00897b' },
  sports: { label: 'SPORTS', icon: '★', color: '#00897b' },
  factory: { label: 'INDUSTRIAL', icon: 'I', color: '#546e7a' },
  fire: { label: 'FIRE STATION', icon: 'F', color: '#b71c1c' }
};

const SLOTS = 20; // 4 x 5 boards of 256 x 128 px
const SIGN_R = 380;

export class LandmarkLayer {
  constructor(data, { roads, hf }) {
    this.roads = roads;
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'landmarks-real';
    this.list = (data && data.landmarks) || [];
    this.named = [];
    const t0 = performance.now();
    const fields = [];
    const fuel = [];
    for (const l of this.list) {
      if (l.y) fields.push(l);
      if (l.k === 'fuel') fuel.push(l);
      if (l.n && CATS[l.k]) this.named.push(l);
    }
    this.#fields(fields);
    this.#forecourts(fuel);
    this.#signs();
    this.ms = performance.now() - t0;
  }

  // ---- painted pitches / playgrounds ----------------------------------------
  #fields(list) {
    const pos = [];
    const col = [];
    const idx = [];
    const line = [];
    const lineIdx = [];
    const c = new THREE.Color();
    for (const f of list) {
      const ring = f.y.slice(0, -1);
      if (ring.length < 3) continue;
      const v2 = ring.map(([x, z]) => new THREE.Vector2(x, z));
      let tris;
      try {
        tris = THREE.ShapeUtils.triangulateShape(v2, []);
      } catch {
        continue;
      }
      let y = Infinity;
      for (const [x, z] of ring) y = Math.min(y, this.hf.heightAt(x, z));
      if (!Number.isFinite(y)) continue;
      y += 0.09;
      const s = f.s || '';
      if (f.k === 'playground') c.set('#c8b383');
      else if (/tennis|basketball|netball|volleyball|multi/.test(s)) c.set('#4f6f8f');
      else if (/athletics|running/.test(s)) c.set('#a5523c');
      else c.set(f.k === 'stadium' ? '#4c8a3a' : '#5a9a40');
      const base = pos.length / 3;
      for (const [x, z] of ring) {
        pos.push(x, y, z);
        col.push(c.r, c.g, c.b);
      }
      for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
      // white boundary line (not for playgrounds)
      if (f.k !== 'playground') {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * 0.09;
          const nz = (dx / l) * 0.09;
          const lb = line.length / 3;
          line.push(a[0] - nx, y + 0.02, a[1] - nz, a[0] + nx, y + 0.02, a[1] + nz, b[0] - nx, y + 0.02, b[1] - nz, b[0] + nx, y + 0.02, b[1] + nz);
          lineIdx.push(lb, lb + 2, lb + 1, lb + 1, lb + 2, lb + 3);
        }
      }
    }
    if (!pos.length) return;
    const fixUp = (P, I) => {
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3;
        const b = I[t + 1] * 3;
        const cc = I[t + 2] * 3;
        if ((P[b + 2] - P[a + 2]) * (P[cc] - P[a]) - (P[b] - P[a]) * (P[cc + 2] - P[a + 2]) < 0) {
          const tmp = I[t + 1];
          I[t + 1] = I[t + 2];
          I[t + 2] = tmp;
        }
      }
    };
    fixUp(pos, idx);
    fixUp(line, lineIdx);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }));
    m.name = 'sportsFields';
    this.group.add(m);
    if (line.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
      lg.setIndex(lineIdx);
      lg.computeVertexNormals();
      const lm = new THREE.Mesh(lg, new THREE.MeshLambertMaterial({ color: 0xf2f2ee, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -5 }));
      lm.name = 'fieldLines';
      this.group.add(lm);
    }
  }

  // ---- fuel station forecourts: canopy on four columns + two pump islands ----
  #forecourts(list) {
    const items = [];
    for (const f of list) {
      const near = this.roads.nearestRoad(f.x, f.z, 70, (r) => r.rank > 1);
      let x = f.x;
      let z = f.z;
      let yaw = 0;
      if (near) {
        yaw = Math.atan2(near.dirX, near.dirZ);
        // keep the canopy off the carriageway
        const minD = near.road.width / 2 + 9;
        if (near.dist < minD) {
          let ux = x - near.x;
          let uz = z - near.z;
          let l = Math.hypot(ux, uz);
          if (l < 0.5) {
            const dl = Math.hypot(near.dirX, near.dirZ) || 1;
            ux = near.dirZ / dl;
            uz = -near.dirX / dl;
            l = 1;
          }
          x = near.x + (ux / l) * minD;
          z = near.z + (uz / l) * minD;
        }
      }
      if (this.hf.isWater(x, z)) continue;
      items.push({ x, z, yaw, y: this.hf.heightAt(x, z) });
    }
    if (!items.length) return;
    const canopy = new THREE.BoxGeometry(15, 0.9, 9);
    canopy.translate(0, 5.25, 0);
    const col = new THREE.BoxGeometry(0.45, 4.9, 0.45);
    col.translate(0, 2.45, 0);
    const pump = new THREE.BoxGeometry(0.9, 1.7, 2.2);
    pump.translate(0, 0.85, 0);
    const island = new THREE.BoxGeometry(1.4, 0.2, 5.2);
    island.translate(0, 0.1, 0);
    const parts = [
      [canopy, 0xf3f3ef, [[0, 0]]],
      [col, 0xd0d0cc, [[-5.2, -3], [5.2, -3], [-5.2, 3], [5.2, 3]]],
      [island, 0xb8b6ad, [[-3, 0], [3, 0]]],
      [pump, 0x2e7d32, [[-3, 0], [3, 0]]]
    ];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (const [geo, color, offs] of parts) {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), items.length * offs.length);
      let k = 0;
      for (const it of items) {
        q.setFromAxisAngle(up, it.yaw);
        const c = Math.cos(it.yaw);
        const s = Math.sin(it.yaw);
        for (const [ox, oz] of offs) {
          p.set(it.x + ox * c + oz * s, it.y, it.z - ox * s + oz * c);
          m4.compose(p, q, one);
          mesh.setMatrixAt(k++, m4);
        }
      }
      mesh.name = 'fuelForecourt';
      this.group.add(mesh);
    }
    // a strip of colour under the canopy roof edge so it reads from the road
    this.fuelCount = items.length;
  }

  // ---- roadside name pylons ---------------------------------------------------
  #signs() {
    // a fixed roadside spot for every named landmark
    this.spots = [];
    for (const l of this.named) {
      if (l.k === 'factory') continue;
      const near = this.roads.nearestRoad(l.x, l.z, 160, (r) => r.rank > 1 && !r.bridge);
      if (!near) continue;
      let ux = l.x - near.x;
      let uz = l.z - near.z;
      let d = Math.hypot(ux, uz);
      const dl = Math.hypot(near.dirX, near.dirZ) || 1;
      if (d < 0.5) {
        ux = near.dirZ / dl;
        uz = -near.dirX / dl;
        d = 1;
      }
      const off = near.road.width / 2 + 2.6;
      const x = near.x + (ux / d) * off;
      const z = near.z + (uz / d) * off;
      // board faces along the road so drivers both ways can read it
      const yaw = Math.atan2(near.dirX, near.dirZ);
      this.spots.push({ l, x, z, yaw, y: this.hf.heightAt(x, z) });
    }
    this.canvas = hdCanvas(1024, 640); // HD scale: boards drawn in old units, 2x pixels
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY; // GPU max (main.js)
    this.slots = new Array(SLOTS).fill(null);
    // board: two faces (front + back) per slot, UVs set per slot
    const boardGeo = new THREE.PlaneGeometry(3.6, 1.8);
    this.boardMat = new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.DoubleSide, toneMapped: false });
    this.boards = [];
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.13, 4.2, 6);
    poleGeo.translate(0, 2.1, 0);
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x8a8f94 }), SLOTS * 2);
    this.poles.count = 0;
    this.poles.name = 'landmarkPoles';
    this.group.add(this.poles);
    for (let i = 0; i < SLOTS; i++) {
      const g = boardGeo.clone();
      const u0 = (i % 4) / 4;
      const v0 = 1 - (Math.floor(i / 4) + 1) / 5;
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 4, v0 + uv.getY(k) / 5);
      const mesh = new THREE.Mesh(g, this.boardMat);
      mesh.visible = false;
      mesh.name = 'landmarkBoard';
      this.group.add(mesh);
      this.boards.push(mesh);
    }
    this.lastX = 1e9;
    this.lastZ = 1e9;
  }

  #draw(slot, l) {
    const ctx = this.ctx;
    const W = 256;
    const H = 128;
    const x0 = (slot % 4) * W;
    const y0 = Math.floor(slot / 4) * H;
    const cat = CATS[l.k];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, W, H);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, y0, W, H);
    ctx.fillStyle = cat.color;
    ctx.fillRect(x0, y0, W, 30);
    ctx.fillRect(x0, y0 + H - 6, W, 6);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 19px "Trebuchet MS", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${cat.icon}  ${cat.label}`, x0 + 10, y0 + 16);
    ctx.fillStyle = '#16202a';
    // name, wrapped to two lines, shrunk to fit
    const words = l.n.split(/\s+/);
    let size = 26;
    let lines;
    for (;;) {
      ctx.font = `bold ${size}px "Trebuchet MS", Arial, sans-serif`;
      lines = [];
      let cur = '';
      for (const w of words) {
        const t = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(t).width > W - 18 && cur) {
          lines.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) lines.push(cur);
      let widest = 0;
      for (const ln of lines) widest = Math.max(widest, ctx.measureText(ln).width);
      if ((lines.length <= 2 && widest <= W - 18) || size <= 14) break;
      size -= 2;
    }
    lines = lines.slice(0, 2);
    const top = y0 + 30 + (H - 36 - lines.length * (size + 4)) / 2 + size / 2 + 2;
    lines.forEach((s, i) => ctx.fillText(s, x0 + 9, top + i * (size + 4), W - 18));
    ctx.restore();
  }

  update(camX, camZ) {
    if (!this.spots || Math.abs(camX - this.lastX) + Math.abs(camZ - this.lastZ) < 25) return;
    this.lastX = camX;
    this.lastZ = camZ;
    const near = [];
    for (const s of this.spots) {
      const d = Math.abs(s.x - camX) + Math.abs(s.z - camZ);
      if (d < SIGN_R * 1.4) near.push([d, s]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const want = near.slice(0, SLOTS).map((a) => a[1]);
    const keep = new Set(want);
    // free slots no longer wanted
    for (let i = 0; i < SLOTS; i++) if (this.slots[i] && !keep.has(this.slots[i])) this.slots[i] = null;
    let dirty = false;
    for (const s of want) {
      if (this.slots.includes(s)) continue;
      const free = this.slots.indexOf(null);
      if (free < 0) break;
      this.slots[free] = s;
      this.#draw(free, s.l);
      dirty = true;
    }
    if (dirty) this.tex.needsUpdate = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let pi = 0;
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i];
      const b = this.boards[i];
      if (!s) {
        b.visible = false;
        continue;
      }
      b.visible = true;
      // board plane faces across the road: rotate so its normal runs along the road
      b.position.set(s.x, s.y + 4.6, s.z);
      b.rotation.set(0, s.yaw, 0);
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      for (const o of [-1.45, 1.45]) {
        p.set(s.x + o * c, s.y, s.z - o * sn);
        q.identity();
        m4.compose(p, q, one);
        this.poles.setMatrixAt(pi++, m4);
      }
    }
    void up;
    this.poles.count = pi;
    this.poles.instanceMatrix.needsUpdate = true;
  }
}
