import * as THREE from '../../vendor/three/three.module.js';

// Metrorail trains on the real OSM railway lines (roads.rail, from
// durban-game.json). Lines are joined end to end into long routes; each train
// shuttles along its route (stops at the end, then runs back), slowing for
// curves and pausing at stations every few km like a stopping service.
// Two liveries: the older PRASA 5M2A sets (grey with a yellow/red band) and
// the newer Xtrapolis Mega sets (blue, white and grey). Cape gauge 1,067 mm.

const GAUGE = 1.067;
const CAR_L = 20;
const GAP = 0.8;

function key(p) {
  return Math.round(p[0] / 3) + ',' + Math.round(p[1] / 3);
}

function plen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

function sideTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  if (kind === 'mega') {
    g.fillStyle = '#e9ecef';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#1d4f9a';
    g.fillRect(0, 40, 256, 24);
    g.fillStyle = '#8f99a3';
    g.fillRect(0, 36, 256, 4);
  } else {
    g.fillStyle = '#9aa0a3';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#e3b21f';
    g.fillRect(0, 40, 256, 6);
    g.fillStyle = '#b3261e';
    g.fillRect(0, 46, 256, 5);
  }
  // windows and doors
  g.fillStyle = '#1e262e';
  for (let x = 10; x < 256; x += 30) g.fillRect(x, 12, 20, 16);
  g.fillStyle = kind === 'mega' ? '#f2c230' : '#4a4f52';
  g.fillRect(60, 8, 14, 52);
  g.fillRect(180, 8, 14, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Trains {
  constructor(roads, hf, { count = 8 } = {}) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'trains';
    const t0 = performance.now();
    this.routes = this.#routes(roads.rail || [], count);
    this.#rails(roads.rail || []);
    this.trains = [];
    const mats = {
      old: new THREE.MeshLambertMaterial({ map: sideTexture('old') }),
      mega: new THREE.MeshLambertMaterial({ map: sideTexture('mega') }),
      roof: new THREE.MeshLambertMaterial({ color: 0x5b6166 }),
      under: new THREE.MeshLambertMaterial({ color: 0x202224 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff4d0 }),
    };
    const carGeo = () => {
      const body = new THREE.BoxGeometry(2.9, 2.9, CAR_L);
      body.translate(0, 2.35, 0);
      const roof = new THREE.BoxGeometry(2.6, 0.4, CAR_L - 0.4);
      roof.translate(0, 3.95, 0);
      const bogie = new THREE.BoxGeometry(2.2, 0.8, CAR_L - 3);
      bogie.translate(0, 0.5, 0);
      return { body, roof, bogie };
    };
    this.geo = carGeo();
    this.routes.forEach((r, i) => {
      const n = 4 + ((i * 7) % 5);
      const kind = i % 3 === 0 ? 'mega' : 'old';
      const cars = [];
      for (let k = 0; k < n; k++) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.geo.body, mats[kind]));
        g.add(new THREE.Mesh(this.geo.roof, mats.roof));
        g.add(new THREE.Mesh(this.geo.bogie, mats.under));
        if (k === 0 || k === n - 1) {
          const l = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 0.1), mats.lamp);
          l.position.set(0, 3.4, k === 0 ? CAR_L / 2 + 0.05 : -CAR_L / 2 - 0.05);
          g.add(l);
        }
        this.group.add(g);
        cars.push(g);
      }
      const len = n * (CAR_L + GAP);
      this.trains.push({
        r,
        cars,
        len,
        s: len + ((i * 1777) % Math.max(1, r.L - len * 2)),
        dir: i % 2 ? 1 : -1,
        v: 0,
        vmax: 16 + (i % 3) * 3, // ~60-80 km/h
        wait: 0,
        nextStop: 1500 + ((i * 431) % 1500),
      });
    });
    this.stats = { routes: this.routes.length, km: Math.round(this.routes.reduce((a, r) => a + r.L, 0) / 1000), ms: Math.round(performance.now() - t0) };
  }

  // Join rail ways that meet end to end into long routes, keep the longest.
  #routes(rail, count) {
    const ends = new Map();
    const add = (k, w, atStart) => {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ w, atStart });
    };
    rail.forEach((w, i) => {
      w.i = i;
      add(key(w.pts[0]), w, true);
      add(key(w.pts[w.pts.length - 1]), w, false);
    });
    const used = new Set();
    const routes = [];
    const dirAt = (pts, atEnd) => {
      const n = pts.length;
      const a = atEnd ? pts[Math.max(0, n - 4)] : pts[Math.min(n - 1, 3)];
      const b = atEnd ? pts[n - 1] : pts[0];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    };
    const extend = (pts) => {
      // keep going from the end of pts along the straightest unused way
      for (let guard = 0; guard < 400; guard++) {
        const end = pts[pts.length - 1];
        const d = dirAt(pts, true);
        let best = null;
        let bd = 0.5; // must continue within ~60 degrees
        for (const e of ends.get(key(end)) || []) {
          if (used.has(e.w.i)) continue;
          const wp = e.atStart ? e.w.pts : e.w.pts.slice().reverse();
          const o = dirAt(wp, false);
          const dot = -(o[0] * d[0] + o[1] * d[1]);
          if (dot > bd) {
            bd = dot;
            best = { e, wp };
          }
        }
        if (!best) return;
        used.add(best.e.w.i);
        for (let i = 1; i < best.wp.length; i++) pts.push(best.wp[i]);
      }
    };
    const order = rail.slice().sort((a, b) => plen(b.pts) - plen(a.pts));
    for (const w of order) {
      if (used.has(w.i)) continue;
      used.add(w.i);
      let pts = w.pts.slice();
      extend(pts);
      pts = pts.reverse();
      extend(pts);
      const L = plen(pts);
      if (L > 2500) routes.push({ pts, L });
    }
    routes.sort((a, b) => b.L - a.L);
    const out = routes.slice(0, count);
    for (const r of out) {
      r.cum = [0];
      for (let i = 1; i < r.pts.length; i++) r.cum.push(r.cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      r.L = r.cum[r.cum.length - 1];
      r.h = r.pts.map((p) => this.hf.heightAt(p[0], p[1]) + 0.3);
    }
    return out;
  }

  // Two steel rails on every line (thin dark strips on top of the bed).
  #rails(rail) {
    const pos = [];
    const idx = [];
    for (const line of rail) {
      const pts = line.pts;
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        const L = Math.hypot(dx, dz) || 1;
        dx /= L;
        dz /= L;
        const y = this.hf.heightAt(pts[i][0], pts[i][1]) + 0.46;
        for (const side of [-1, 1]) {
          const o = (side * GAUGE) / 2;
          const cx = pts[i][0] - dz * o;
          const cz = pts[i][1] + dx * o;
          pos.push(cx - dz * 0.04, y, cz + dx * 0.04, cx + dz * 0.04, y, cz - dx * 0.04);
        }
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = base + i * 4;
        const b = a + 4;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
        idx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8c8f93, side: THREE.DoubleSide }));
    m.name = 'rails';
    this.group.add(m);
  }

  #at(r, s, out) {
    s = Math.max(0, Math.min(r.L, s));
    let lo = 0;
    let hi = r.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (r.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const seg = r.cum[hi] - r.cum[lo] || 1;
    const t = (s - r.cum[lo]) / seg;
    const a = r.pts[lo];
    const b = r.pts[hi];
    out.x = a[0] + (b[0] - a[0]) * t;
    out.z = a[1] + (b[1] - a[1]) * t;
    out.y = r.h[lo] + (r.h[hi] - r.h[lo]) * t;
    return out;
  }

  update(dt, px, pz) {
    const A = { x: 0, y: 0, z: 0 };
    const B = { x: 0, y: 0, z: 0 };
    for (const tr of this.trains) {
      const r = tr.r;
      if (tr.wait > 0) {
        tr.wait -= dt;
        tr.v = 0;
      } else {
        // station stop / end of line: brake to a halt
        const toEnd = tr.dir > 0 ? r.L - tr.s : tr.s - tr.len;
        const stopIn = Math.min(toEnd, tr.nextStop);
        const vStop = Math.sqrt(2 * 0.7 * Math.max(0, stopIn - 2));
        const want = Math.min(tr.vmax, vStop);
        tr.v += Math.max(-1.2 * dt, Math.min(0.6 * dt, want - tr.v));
        if (tr.v < 0.05 && stopIn < 4) {
          tr.v = 0;
          tr.wait = 25 + (tr.cars.length % 3) * 8;
          if (toEnd < 4) tr.dir = -tr.dir;
          tr.nextStop = 1800 + ((tr.s * 13) % 1600);
        }
        const ds = tr.v * dt;
        tr.s += tr.dir * ds;
        tr.nextStop -= ds;
        tr.s = Math.max(tr.len, Math.min(r.L, tr.s));
      }
      // place cars only when the train is anywhere near the player
      this.#at(r, tr.s, A);
      const near = Math.hypot(A.x - px, A.z - pz) < 2500;
      for (let k = 0; k < tr.cars.length; k++) {
        const car = tr.cars[k];
        car.visible = near;
        if (!near) continue;
        // head at s, cars trail behind (opposite to the direction of travel)
        const off = k * (CAR_L + GAP);
        const sf = tr.dir > 0 ? tr.s - off : tr.s - tr.len + off + CAR_L;
        this.#at(r, sf, A);
        this.#at(r, sf - CAR_L, B);
        car.position.set((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
        car.rotation.set(0, Math.atan2(A.x - B.x, A.z - B.z), 0);
        car.rotation.x = -Math.atan2(A.y - B.y, CAR_L);
      }
    }
  }
}

