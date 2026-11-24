import * as THREE from '../../vendor/three/three.module.js';
import { hdCanvas } from '../core/hdcanvas.js';

// Bus stations and depots from OSM amenity=bus_station
// (src/data/durban-buses.json, scripts/add-buses.py):
//  - 'coach': Durban Station Coach Terminal (Masabalala Yengwa Ave / Jelf
//    Taylor Cres), where the long-distance coaches to Johannesburg, Pretoria,
//    Cape Town, Bloemfontein, Gqeberha, East London, Mthatha and beyond leave.
//    Long canopy, coaches nose-in at the bays, a DEPARTURES board.
//  - 'city': city bus stations and depots (Alice Street, Warwick Avenue,
//    Pinetown, KwaMashu/Malandela...). Canopy over a platform, city buses at
//    the bays, a name board.
//  - 'coachstop': coach stops on the south coast line (shelter + sign).
// Liveries are plain colour schemes with no operator names or logos.
const SHOW_R = 900;

const COACH_LIVERIES = [
  [0xf2f2ee, 0xc62828], // white / red
  [0xf2f2ee, 0x1f4e9e], // white / blue
  [0x1c1c1e, 0xe0a100], // black / gold
  [0xf2f2ee, 0x2e7d32], // white / green
  [0x9e1b1b, 0xf2f2ee], // red / white
];
const CITY_LIVERIES = [
  [0xe9e4d2, 0x2e6b3a], // cream / green
  [0xe9e4d2, 0xd06a12], // cream / orange
  [0xf2f2ee, 0x1b6fb3], // white / blue
];
const DESTS = [
  ['JOHANNESBURG', '07:30'],
  ['PRETORIA', '08:15'],
  ['CAPE TOWN', '10:00'],
  ['BLOEMFONTEIN', '12:45'],
  ['GQEBERHA', '14:30'],
  ['EAST LONDON', '16:45'],
  ['MTHATHA', '18:00'],
  ['JOHANNESBURG', '21:30'],
];

function boardTex(lines, { bg = '#14365f', fg = '#ffffff', w = 512, h = 128, title = null, gold = false } = {}) {
  const c = hdCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = gold ? '#f2c230' : '#ffffff';
  g.lineWidth = 4;
  g.strokeRect(4, 4, w - 8, h - 8);
  g.textBaseline = 'middle';
  if (title) {
    g.fillStyle = gold ? '#f2c230' : fg;
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'left';
    g.fillText(title, 18, 32);
    g.font = 'bold 26px monospace';
    lines.forEach(([d, t], k) => {
      const y = 76 + k * 34;
      g.fillStyle = '#ffd34d';
      g.textAlign = 'left';
      g.fillText(d, 18, y);
      g.textAlign = 'right';
      g.fillText(t, w - 18, y);
    });
  } else {
    g.fillStyle = fg;
    g.textAlign = 'center';
    let fs = 44;
    g.font = `bold ${fs}px sans-serif`;
    while (fs > 18 && g.measureText(lines[0]).width > w - 30) g.font = `bold ${--fs}px sans-serif`;
    g.fillText(lines[0], w / 2, lines[1] ? h * 0.38 : h / 2);
    if (lines[1]) {
      g.font = 'bold 24px sans-serif';
      g.fillText(lines[1], w / 2, h * 0.74);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY; // GPU max (main.js)
  return t;
}

export class BusStations {
  constructor(data, { roads, hf, buildings }) {
    this.roads = roads;
    this.hf = hf;
    this.buildings = buildings;
    this.group = new THREE.Group();
    this.group.name = 'busStations';
    this.sites = [];
    this.buses = []; // {x,y,z,yaw,len,body,accent,coach}
    for (const s of (data && data.sites) || []) {
      try {
        this.#site(s);
      } catch (err) {
        console.warn('[IZK] bus station skipped', s.n, err);
      }
    }
    this.#buildBuses();
  }

  #free(x, z, r, yard = false) {
    if (this.hf.isWater && this.hf.isWater(x, z)) return false;
    // inside an OSM depot yard the 'building' is the depot shed itself
    if (!yard && this.buildings && this.buildings.blocked && this.buildings.blocked(x, z, r)) return false;
    // depot yards are crossed by service lanes; only real streets block a bay
    const nr = this.roads.nearestRoad(x, z, 14, (r) => r.width >= 6.5);
    return !(nr && nr.dist < nr.road.width / 2 + 1.5);
  }

  #site(s) {
    let cx, cz, ux, uz;
    if (s.p) {
      cx = s.p.reduce((a, q) => a + q[0], 0) / s.p.length;
      cz = s.p.reduce((a, q) => a + q[1], 0) / s.p.length;
      // canopy runs along the longest edge of the OSM area
      let best = 0;
      for (let i = 0; i < s.p.length - 1; i++) {
        const dx = s.p[i + 1][0] - s.p[i][0];
        const dz = s.p[i + 1][1] - s.p[i][1];
        const l = Math.hypot(dx, dz);
        if (l > best) {
          best = l;
          ux = dx / l;
          uz = dz / l;
        }
      }
    } else {
      [cx, cz] = s.c;
      const nr = this.roads.nearestRoad(cx, cz, 80, (r) => r.rank >= 2);
      if (nr) {
        const l = Math.hypot(nr.dirX, nr.dirZ) || 1;
        ux = nr.dirX / l;
        uz = nr.dirZ / l;
        // stand off the road on the side with room
        const nx = -uz;
        const nz = ux;
        const off = s.k === 'coach' ? 20 : 7;
        const a = [nr.x + nx * off, nr.z + nz * off];
        const b = [nr.x - nx * off, nr.z - nz * off];
        const fa = this.#free(a[0], a[1], 4);
        [cx, cz] = fa || !this.#free(b[0], b[1], 4) ? a : b;
      } else {
        ux = 1;
        uz = 0;
      }
    }
    const nx = -uz;
    const nz = ux;
    const y = this.hf.heightAt(cx, cz);
    const g = new THREE.Group();
    g.position.set(cx, y, cz);
    g.rotation.y = Math.atan2(ux, uz) - Math.PI / 2; // local +x along the canopy
    const coach = s.k === 'coach';
    const stop = s.k === 'coachstop';
    const L = coach ? 56 : stop ? 8 : 36;
    const D = coach ? 9 : stop ? 3 : 7;
    const H = coach ? 5.2 : stop ? 2.8 : 4.4;
    const roofMat = new THREE.MeshStandardMaterial({ color: coach ? 0xe8e8e4 : 0x6f7f74, roughness: 0.6, metalness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8c9196, roughness: 0.5, metalness: 0.6 });
    const conc = new THREE.MeshStandardMaterial({ color: 0xb9b5aa, roughness: 0.95 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(L, 0.35, D), roofMat);
    roof.position.set(0, H, 0);
    g.add(roof);
    if (!stop) {
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(L, 0.9, 0.15), new THREE.MeshStandardMaterial({ color: coach ? 0x1f3b66 : 0x2e6b3a, roughness: 0.6 }));
      fascia.position.set(0, H - 0.2, D / 2);
      g.add(fascia);
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(L + 2, 0.3, D + 1), conc);
    plat.position.set(0, 0.15, 0);
    g.add(plat);
    const colGeo = new THREE.CylinderGeometry(0.16, 0.16, H, 8);
    for (let k = 0; k <= Math.round(L / 7); k++) {
      for (const side of [-1, 1]) {
        if (stop && side > 0) continue;
        const c = new THREE.Mesh(colGeo, steel);
        c.position.set(-L / 2 + 0.5 + (k * (L - 1)) / Math.max(1, Math.round(L / 7)), H / 2, side * (D / 2 - 0.4));
        g.add(c);
      }
    }
    // benches under the canopy
    const bench = new THREE.Mesh(new THREE.BoxGeometry(L * 0.8, 0.45, 0.5), steel);
    bench.position.set(0, 0.55, -D / 2 + 1.2);
    g.add(bench);
    // name board on two posts; the coach terminal also gets a departures board
    const bw = coach ? 7 : 5;
    const nameTex = coach
      ? boardTex(['DURBAN STATION', 'LONG DISTANCE COACHES'], { bg: '#14365f', gold: true })
      : stop
        ? boardTex(['COACH STOP', s.n.replace(/^Coach: /, '').replace(/ Stop$/, '')], { bg: '#14365f' })
        : boardTex([s.n.replace(/ Bus Station$/, '').toUpperCase(), /Depot/.test(s.n) ? 'BUS DEPOT' : 'BUS STATION'], { bg: '#2e6b3a' });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 4), new THREE.MeshBasicMaterial({ map: nameTex, side: THREE.DoubleSide }));
    const bx = stop ? L / 2 + 2 : L / 2 + 3;
    board.position.set(bx, 3.6, D / 2 + 1.5);
    g.add(board);
    for (const sx of [-bw / 2 + 0.3, bw / 2 - 0.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 6), steel);
      post.position.set(bx + sx, 1.8, D / 2 + 1.48);
      g.add(post);
    }
    if (coach) {
      const dep = new THREE.Mesh(new THREE.PlaneGeometry(6, 6 * (360 / 512)), new THREE.MeshBasicMaterial({ map: boardTex(DESTS, { bg: '#0b0b0d', title: 'DEPARTURES', w: 512, h: 360 }) }));
      dep.position.set(-L / 4, H - 1.9, -D / 2 + 0.3);
      g.add(dep);
      const dep2 = dep.clone();
      dep2.position.set(L / 4, H - 1.9, -D / 2 + 0.3);
      g.add(dep2);
    }
    this.group.add(g);
    // buses nose-in at the bays on the open side of the canopy
    if (!stop) {
      const n = coach ? 6 : 4;
      const lv = coach ? COACH_LIVERIES : CITY_LIVERIES;
      const len = coach ? 13.5 : 12;
      const gap = coach ? 5 : 4.6;
      for (let k = 0; k < n; k++) {
        if ((k * 7 + Math.round(cx)) % 5 === 4) continue; // an empty bay or two
        const along = (k - (n - 1) / 2) * gap;
        const out = D / 2 + 1.2 + len / 2;
        // bays on the open side; the other side when a building is in the way
        let side = 0;
        for (const sd of [1, -1]) {
          if (this.#free(cx + ux * along + nx * out * sd, cz + uz * along + nz * out * sd, 2.5, !!s.p)) {
            side = sd;
            break;
          }
        }
        if (!side) continue;
        const x = cx + ux * along + nx * out * side;
        const z = cz + uz * along + nz * out * side;
        const yaw = Math.atan2(-nx * side, -nz * side); // nose toward the canopy
        const [body, accent] = lv[(k + Math.round(Math.abs(cz))) % lv.length];
        this.buses.push({ x, y: this.hf.heightAt(x, z), z, yaw, len, body, accent, coach });
      }
    }
    this.sites.push({ name: s.n, kind: s.k, x: cx, z: cz, group: g });
  }

  #buildBuses() {
    const n = this.buses.length;
    if (!n) return;
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2 }), n);
    const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: 0.15, metalness: 0.6 }), n);
    const stripe = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), n);
    const wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }), n * 6);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();
    const place = (mesh, i, b, lx, ly, lz, sx, sy, sz, rx = 0) => {
      e.set(rx, b.yaw, 0);
      q.setFromEuler(e);
      p.set(lx, ly, lz).applyEuler(new THREE.Euler(0, b.yaw, 0));
      p.x += b.x;
      p.y += b.y;
      p.z += b.z;
      sc.set(sx, sy, sz);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
    };
    this.buses.forEach((b, i) => {
      const H = b.coach ? 3.6 : 3.1;
      // local +z is the bus's nose
      place(body, i, b, 0, 0.45 + H / 2, 0, 2.55, H, b.len);
      body.setColorAt(i, col.setHex(b.body));
      place(glass, i, b, 0, 0.45 + H * 0.66, 0.2, 2.6, H * 0.34, b.len - 1.2);
      place(stripe, i, b, 0, 0.45 + H * 0.3, 0, 2.6, 0.45, b.len - 0.4);
      stripe.setColorAt(i, col.setHex(b.accent));
      const ax = [b.len / 2 - 2.4, -b.len / 2 + 2.6, -b.len / 2 + 4.0];
      ax.forEach((az, k) => {
        for (const side of [-1, 1]) place(wheels, i * 6 + k * 2 + (side > 0 ? 1 : 0), b, side * 1.2, 0.55, az, 1, 1, 1, 0);
      });
    });
    // wheels lie on their side
    for (let k = 0; k < n * 6; k++) {
      wheels.getMatrixAt(k, m);
      m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
      wheels.setMatrixAt(k, m);
    }
    for (const mesh of [body, glass, stripe, wheels]) {
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.busMeshes = [body, glass, stripe, wheels];
  }

  update(px, pz) {
    for (const s of this.sites) s.group.visible = Math.abs(s.x - px) < SHOW_R && Math.abs(s.z - pz) < SHOW_R;
  }
}
