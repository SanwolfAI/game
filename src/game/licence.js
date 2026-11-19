import * as THREE from '../../vendor/three/three.module.js';
import { toXZ } from '../core/geo.js';

// Licence before any driving job (Bheko, 19 Nov 2026).
// A new player starts on foot with R2,500 saved, outside a driving school.
// Driving schools: Bho's Driving Academy (real, OSM) plus one at each township
// and suburb mall (made-up names). At a school:
//   1. Learner's licence (K53 questions), R110. Pass 4 of 5.
//   2. Lessons, R300: practice in the K53 test yard. No fail.
//   3. Driving test, R450: taken at the nearest real testing ground (Umbilo
//      Motor Licensing or Amanzimtoti Testing Grounds). Going in is like a
//      different game: the screen fades and you are in the fenced K53 yard
//      (alley docking, parallel parking, three-point turn; touch a cone and
//      you fail), then the road test round the testing ground. Pass = Code 10.
//      Fail = come back in 2 days (game days), no same-day retry.
//   4. PrDP at a testing ground, R250: needed to carry paying passengers.
// Mirrors (rear-view + both side mirrors) in every car, seen in the inside view.
// State: wallet.licence (localStorage izk.wallet.v1).

const R = (n) => `R${Math.round(n).toLocaleString('en-ZA')}`;
const DAY_MS = 24 * 3600 * 1000;
export const SCHOOLS = [
  { name: "Bho's Driving Academy", lon: 30.994246, lat: -29.764138 },
  { name: 'Siyaqhuba Driving School', at: 'Midway Crossing', lon: 30.94978, lat: -29.76457 },
  { name: 'Phakama Driving School', at: 'KwaMnyandu Shopping Centre', lon: 30.90463, lat: -29.97199 },
  { name: 'Sharp Sharp Driving Academy', at: 'Phoenix Plaza', lon: 31.0057, lat: -29.70091 },
  { name: 'Hamba Kahle Driving School', at: 'Woodview Shopping Centre', lon: 31.02654, lat: -29.68662 },
  { name: 'Thuthuka Driving School', at: 'The Ridge@Shallcross', lon: 30.87965, lat: -29.89991 },
  { name: 'Isibani Driving School', at: 'Croton Plaza', lon: 30.91337, lat: -29.99797 },
  { name: 'Zama Zama Driving Academy', at: 'Lovu Plaza', lon: 31.01897, lat: -29.74353 },
  { name: 'Ubuntu Driving School', at: 'Reservoir Hills Mall', lon: 30.96258, lat: -29.80165 },
  { name: 'Khanya Driving School', at: 'City View Shopping Centre', lon: 31.02111, lat: -29.84175 },
  { name: 'Vuka Driving School', at: 'Galleria Mall', lon: 30.89921, lat: -30.03403 },
  { name: 'Hlanganani Driving School', at: 'Link Hills Shopping Centre', lon: 30.81461, lat: -29.75061 },
];
// Testing grounds (real, OSM): yard test, road test and PrDP
export const DLTCS = [
  { name: 'Umbilo Motor Licensing', lon: 30.982393, lat: -29.886883 },
  { name: 'Amanzimtoti Testing Grounds', lon: 30.85687, lat: -30.09331 },
];
const LEARNERS_FEE = 110;
const LESSON_FEE = 300;
const TEST_FEE = 450;
const PRDP_FEE = 250;
const START_CASH = 25000; // R25,000: buy a cheap house (home.js), the rest pays for school
const NEAR = 14;
const CP_R = 11;
const LIMIT = 60;
const QUIZ = [
  ['General speed limit in a town or city?', ['60 km/h', '80 km/h', '40 km/h'], 0],
  ['Speed limit on a freeway?', ['100 km/h', '120 km/h', '140 km/h'], 1],
  ['Speed limit on a rural road outside town?', ['100 km/h', '80 km/h', '120 km/h'], 0],
  ['A robot flashes red. What do you do?', ['Slow down and go', 'Stop, then go when it is safe', 'Hoot and go'], 1],
  ['Minimum following distance in good weather?', ['1 second', '2 seconds', 'Half a car length'], 1],
  ['Blood alcohol limit for a professional driver (PrDP)?', ['0.05 g per 100 ml', '0.02 g per 100 ml', '0.08 g per 100 ml'], 1],
  ['At a four-way stop, who goes first?', ['The biggest vehicle', 'The first to stop', 'The one on the right'], 1],
  ['A solid white line in the middle of the road means?', ['No crossing or overtaking', 'Overtake with care', 'Parking allowed'], 0],
];

// ---- K53 test yard (local metres, +z forward; vehicle yaw 0 faces +z) ----
// Built off the map's north-west corner, where the ground is one flat height,
// so going in feels like a different place.
const YARD = {
  start: { x: 0, z: -34, yaw: 0 },
  cones: [],
  tasks: [
    // reverse into the alley (nose out)
    { id: 'alley', label: 'Alley docking: REVERSE into the coned bay and stop', x: -32, z: 22, yaw: Math.PI, tol: 1.4, yawTol: 0.35 },
    // parallel park beside the kerb between the two parked cars
    { id: 'parallel', label: 'Parallel parking: park in the bay by the kerb', x: 36.2, z: 14, yaw: 0, either: true, tol: 1.3, yawTol: 0.3 },
    // turn round inside the narrow coned road
    { id: 'turn', label: 'Three-point turn: turn round inside the coned road', x: 0, z: 30, box: [-11, 26, 11, 34] },
    { id: 'finish', label: 'Drive back to the start line and stop', x: 0, z: -34, tol: 3 },
  ],
};
(() => {
  const c = YARD.cones;
  // alley bay 3.2 m wide, 8 m deep, open to the south
  for (let z = 17; z <= 26; z += 1.5) c.push([-34, z], [-30, z]);
  for (let x = -33; x <= -31; x += 1) c.push([x, 26.6]);
  // parallel bay along the kerb x=38
  for (let z = 6; z <= 22; z += 2) c.push([38.2, z]);
  // three-point-turn road: two cone lines 8 m apart
  for (let x = -11; x <= 11; x += 2) c.push([x, 25.6], [x, 34.4]);
})();
const YARD_PARKED = [[36.2, 6.5], [36.2, 21.5]];

function yardCanvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Licence {
  constructor(wallet, { hud, gps, hf, roads, save, show }) {
    this.w = wallet;
    this.hud = hud;
    this.gps = gps;
    this.hf = hf;
    this.roads = roads;
    this.save = save;
    this.show = show;
    if (!wallet.licence) {
      wallet.licence = { learner: false, code10: false, prdp: false, lessons: 0, retestAt: 0 };
      if (!wallet.r && !wallet.trips) wallet.r = START_CASH; // a new player arrives with savings
      if (wallet.trips) Object.assign(wallet.licence, { learner: true, code10: true, prdp: true }); // old saves already drove taxis
      save();
    }
    this.L = wallet.licence;
    this.group = new THREE.Group();
    this.group.name = 'licence';
    this.schools = SCHOOLS.map((s) => ({ ...s, kind: 'school', ...this.#kerb(...toXZ(s.lon, s.lat)) }));
    this.dltcs = DLTCS.map((s) => ({ ...s, kind: 'dltc', ...this.#kerb(...toXZ(s.lon, s.lat)) }));
    for (const s of this.schools) this.#marker(s, 0x2f6fd2, ['DRIVING SCHOOL', s.name.toUpperCase()]);
    for (const s of this.dltcs) this.#marker(s, 0x1e5a32, ['TESTING GROUND', s.name.toUpperCase()]);
    this.cpMesh = new THREE.Mesh(new THREE.TorusGeometry(CP_R * 0.55, 0.35, 8, 32), new THREE.MeshBasicMaterial({ color: 0x3fd0ff }));
    this.cpMesh.rotation.x = Math.PI / 2;
    this.cpMesh.visible = false;
    this.group.add(this.cpMesh);
    // the yard sits in the rural north-west corner of the map on a flat pad
    // (the car drives the pad, not the hills under it)
    this.yardO = { x: hf.minX + 700, z: hf.minZ + 700 };
    let top = -Infinity;
    for (let a = -70; a <= 70; a += 10) for (let b = -70; b <= 70; b += 10) top = Math.max(top, hf.heightAt(this.yardO.x + a, this.yardO.z + b));
    this.yardY = top + 0.25;
    const orig = roads.surfaceAt.bind(roads);
    roads.surfaceAt = (x, z, ...rest) => {
      if (this.yard && Math.abs(x - this.yardO.x) < 70 && Math.abs(z - this.yardO.z) < 70) return { y: this.yardY, onRoad: true, deck: false, pc: null };
      return orig(x, z, ...rest);
    };
    this.yard = null; // built on first visit
    this.mode = null; // null | 'lesson' | 'test-yard' | 'test-road'
    this.near = null;
    this.hooks = {}; // put(x, z, yaw): main moves the car and seats the player
    this.#panel();
    this.#fader();
  }

  get licensed() {
    return this.L.code10;
  }

  get canTaxi() {
    return this.L.code10 && this.L.prdp;
  }

  get atSchool() {
    return !!this.mode;
  }

  canDrive() {
    return this.L.code10 || !!this.mode;
  }

  #nearest(list, x, z) {
    let best = list[0];
    let bd = Infinity;
    for (const s of list) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  why() {
    if (!this.L.learner) return 'You need a licence. GPS set to the nearest driving school.';
    if (!this.L.code10) return 'Book lessons and your driving test at a driving school (GPS set).';
    return 'Taxi work needs a PrDP from a testing ground (GPS set).';
  }

  guide(x = this.lastX || 0, z = this.lastZ || 0) {
    const t = this.L.code10 ? this.#nearest(this.dltcs, x, z) : this.#nearest(this.schools, x, z);
    this.gps.setDestination(t.x, t.z, t.name);
  }

  #kerb(x, z) {
    const nr = this.roads.nearestRoad(x, z, 150);
    if (!nr) return { x, z };
    const dx = x - nr.x;
    const dz = z - nr.z;
    const l = Math.hypot(dx, dz) || 1;
    const off = nr.road.width / 2 + 3;
    return { x: nr.x + (dx / l) * off, z: nr.z + (dz / l) * off, rx: nr.x, rz: nr.z, dirX: nr.dirX, dirZ: nr.dirZ };
  }

  #marker(p, color, lines) {
    const tex = yardCanvasTex(512, 128, (g) => {
      g.fillStyle = '#' + color.toString(16).padStart(6, '0');
      g.fillRect(0, 0, 512, 128);
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      g.strokeRect(5, 5, 502, 118);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold 44px sans-serif';
      g.fillText(lines[0], 256, 44);
      let fs = 28;
      g.font = `bold ${fs}px sans-serif`;
      while (fs > 14 && g.measureText(lines[1]).width > 480) g.font = `bold ${--fs}px sans-serif`;
      g.fillText(lines[1], 256, 96);
    });
    const y = this.hf.heightAt(p.x, p.z);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    board.position.set(p.x, y + 3.2, p.z);
    if (p.dirX !== undefined) board.rotation.y = Math.atan2(p.dirX, p.dirZ) + Math.PI / 2;
    this.group.add(board);
    const pm = new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.5, roughness: 0.5 });
    for (const s of [-1.9, 1.9]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6), pm);
      post.position.set(p.x + Math.cos(board.rotation.y) * s, y + 1.6, p.z - Math.sin(board.rotation.y) * s);
      this.group.add(post);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 32), new THREE.MeshBasicMaterial({ color: 0xffd21a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, y + 0.08, p.z);
    this.group.add(ring);
  }

  // a brand-new player starts on foot at Bho's, the school car at the kerb
  startSpot() {
    const s = this.schools[0];
    const yaw = s.dirX !== undefined ? Math.atan2(s.dirX, s.dirZ) : 0;
    return { px: s.x, pz: s.z, cx: s.rx ?? s.x, cz: s.rz ?? s.z, yaw };
  }

  update(dt, ent, inVehicle, vehicle, now) {
    this.now = now;
    this.lastX = ent.x;
    this.lastZ = ent.z;
    if (!this.mode) {
      let hit = null;
      for (const s of this.schools.concat(this.dltcs)) {
        if (Math.abs(s.x - ent.x) < NEAR && Math.abs(s.z - ent.z) < NEAR && Math.hypot(s.x - ent.x, s.z - ent.z) < NEAR) {
          hit = s;
          break;
        }
      }
      if (hit && this.near !== hit) {
        this.near = hit;
        this.#open(hit);
      } else if (!hit && this.near && Math.hypot(this.near.x - ent.x, this.near.z - ent.z) > NEAR + 6) {
        this.near = null;
        this.#close();
      }
      return;
    }
    if (this.mode === 'lesson' || this.mode === 'test-yard') this.#yardTick(dt, inVehicle, vehicle);
    else if (this.mode === 'test-road') this.#roadTick(dt, inVehicle, vehicle);
  }

  // ---------- the yard ----------
  #buildYard() {
    const g = new THREE.Group();
    g.name = 'k53-yard';
    const O = this.yardO;
    const y0 = this.yardY;
    g.position.set(O.x, y0, O.z);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0x6f8f4a, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.05;
    g.add(grass);
    const tarTex = yardCanvasTex(1024, 768, (c) => {
      c.fillStyle = '#4a4c4f';
      c.fillRect(0, 0, 1024, 768);
      for (let i = 0; i < 9000; i++) {
        c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.06)`;
        c.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2);
      }
      // painted lines (yard is 100 x 80 m -> 10.24 px per m)
      const P = (x, z) => [(x + 50) * 10.24, (z + 40) * 9.6]; // canvas top = yard -z after the plane is laid flat
      c.strokeStyle = '#f2f2ee';
      c.lineWidth = 4;
      const line = (a, b) => {
        c.beginPath();
        c.moveTo(...P(...a));
        c.lineTo(...P(...b));
        c.stroke();
      };
      line([-8, -34], [8, -34]); // start line
      c.strokeStyle = '#f2c230';
      line([-34, 16.5], [-34, 26.6]);
      line([-30, 16.5], [-30, 26.6]);
      line([38.2, 4], [38.2, 24]);
      line([35, 8], [35, 20]);
    });
    const tar = new THREE.Mesh(new THREE.PlaneGeometry(100, 80), new THREE.MeshStandardMaterial({ map: tarTex, roughness: 0.95 }));
    tar.rotation.x = -Math.PI / 2;
    tar.position.set(0, 0.02, 0);
    g.add(tar);
    // kerb for parallel parking
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 22), new THREE.MeshStandardMaterial({ color: 0xd8d4c8 }));
    kerb.position.set(38.6, 0.09, 14);
    g.add(kerb);
    // fence
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.55 });
    for (const [x, z, w, d] of [[0, 40, 100, 0.1], [0, -40, 100, 0.1], [50, 0, 0.1, 80], [-50, 0, 0.1, 80]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, d), fenceMat);
      f.position.set(x, 1.1, z);
      g.add(f);
    }
    // examiner's office and a board
    const office = new THREE.Mesh(new THREE.BoxGeometry(14, 3.4, 7), new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.9 }));
    office.position.set(-30, 1.7, -32);
    g.add(office);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x8a2b20, roughness: 0.8 }));
    roof.position.set(-30, 3.5, -32);
    g.add(roof);
    const boardTex = yardCanvasTex(512, 128, (c) => {
      c.fillStyle = '#1e5a32';
      c.fillRect(0, 0, 512, 128);
      c.fillStyle = '#fff';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = 'bold 40px sans-serif';
      c.fillText('K53 TEST YARD', 256, 44);
      c.font = 'bold 24px sans-serif';
      c.fillText('ETHEKWINI · DRIVER LICENSING', 256, 96);
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: boardTex, side: THREE.DoubleSide }));
    board.position.set(-30, 4.6, -28.4);
    g.add(board);
    this.yardTitle = board;
    // cones
    const coneGeo = new THREE.ConeGeometry(0.28, 0.75, 10);
    coneGeo.translate(0, 0.375, 0);
    const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }), YARD.cones.length);
    const m = new THREE.Matrix4();
    YARD.cones.forEach(([x, z], i) => {
      m.makeTranslation(x, 0, z);
      cones.setMatrixAt(i, m);
    });
    g.add(cones);
    this.coneMesh = cones;
    // the two parked cars either side of the parallel bay
    for (const [x, z] of YARD_PARKED) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4.3), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.4, roughness: 0.4 }));
      car.position.set(x, 0.75, z);
      g.add(car);
    }
    // target marker
    this.yardMark = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32), new THREE.MeshBasicMaterial({ color: 0x3fd0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    this.yardMark.rotation.x = -Math.PI / 2;
    this.yardMark.position.y = 0.06;
    g.add(this.yardMark);
    this.group.add(g);
    this.yard = g;
  }

  #enterYard(kind, dltc) {
    if (!this.yard) this.#buildYard();
    this.mode = kind;
    this.testAt = dltc || null;
    this.task = 0;
    this.coneHits = 0;
    this.turnYaw = null;
    this.holdT = 0;
    this.#close();
    const O = this.yardO;
    this.#fade(kind === 'lesson' ? 'DRIVING LESSON · K53 YARD' : `DRIVING TEST · ${dltc.name.toUpperCase()}`, () => {
      this.hooks.put?.(O.x + YARD.start.x, O.z + YARD.start.z, YARD.start.yaw);
      this.gps.clear?.();
      this.hud.setStreet?.('K53 Test Yard');
      this.#showTask();
    });
  }

  #showTask() {
    const t = YARD.tasks[this.task];
    this.yardMark.position.set(t.x, 0.06, t.z);
    this.hud.toast(`${this.mode === 'lesson' ? 'Lesson' : 'Test'} ${this.task + 1}/${YARD.tasks.length}: ${t.label}`, 5);
  }

  #yardTick(dt, inVehicle, vehicle) {
    if (!inVehicle) return;
    const O = this.yardO;
    const lx = vehicle.x - O.x;
    const lz = vehicle.z - O.z;
    // left the yard?
    if (Math.abs(lx) > 49 || Math.abs(lz) > 39) {
      this.hooks.put?.(O.x + YARD.start.x, O.z + YARD.start.z, YARD.start.yaw);
      this.hud.toast('Stay inside the yard.', 2);
      return;
    }
    // cones: a car is about 2 x 4.5 m; test the cone against the car's box
    const fx = Math.sin(vehicle.yaw);
    const fz = Math.cos(vehicle.yaw);
    for (const c of YARD.cones) {
      const dx = c[0] - lx;
      const dz = c[1] - lz;
      if (dx * dx + dz * dz > 16) continue;
      const along = dx * fx + dz * fz;
      const side = dx * fz - dz * fx;
      if (Math.abs(along) < 2.4 && Math.abs(side) < 1.15) {
        if (c.hitT && performance.now() - c.hitT < 2000) continue;
        c.hitT = performance.now();
        if (this.mode === 'test-yard') return this.#fail('you touched a cone');
        this.hud.toast('Cone! In the test that is an instant fail.', 2);
      }
    }
    const t = YARD.tasks[this.task];
    const kmh = Math.abs(vehicle.speedKmh || 0);
    let done = false;
    if (t.box) {
      const [x0, z0, x1, z1] = t.box;
      const inBox = lx > x0 && lx < x1 && lz > z0 && lz < z1;
      if (inBox && this.turnYaw === null) this.turnYaw = vehicle.yaw;
      if (inBox && this.turnYaw !== null) {
        const d = Math.abs(Math.atan2(Math.sin(vehicle.yaw - this.turnYaw), Math.cos(vehicle.yaw - this.turnYaw)));
        if (d > 2.6) done = true;
      }
      if (!inBox && this.turnYaw !== null && !done) this.turnYaw = null;
    } else {
      const dist = Math.hypot(lx - t.x, lz - t.z);
      let yawOk = true;
      if (t.yaw !== undefined) {
        const d = Math.abs(Math.atan2(Math.sin(vehicle.yaw - t.yaw), Math.cos(vehicle.yaw - t.yaw)));
        yawOk = d < t.yawTol || (t.either && Math.PI - d < t.yawTol);
      }
      if (dist < t.tol && yawOk && kmh < 1.5) {
        this.holdT += dt;
        if (this.holdT > 0.8) done = true;
      } else this.holdT = 0;
    }
    if (!done) return;
    this.holdT = 0;
    this.turnYaw = null;
    this.task += 1;
    if (this.task < YARD.tasks.length) return this.#showTask();
    if (this.mode === 'lesson') {
      this.L.lessons = (this.L.lessons || 0) + 1;
      this.save();
      return this.#leave('Lesson done. The instructor says: book your test when you feel ready.');
    }
    // yard passed: the road test round the testing ground
    this.hud.toast('Yard passed! Now the road test.', 3);
    this.#startRoad();
  }

  #startRoad() {
    const s = this.testAt;
    this.mode = 'test-road';
    const cps = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = 180 + (k % 2) * 90;
      const nr = this.roads.nearestRoad(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 90, (q) => q.width >= 5);
      if (nr) cps.push({ x: nr.x, z: nr.z });
    }
    cps.push({ x: s.rx ?? s.x, z: s.rz ?? s.z, end: true });
    this.road = { cps, i: 0, speeding: 0 };
    this.#fade('ROAD TEST', () => {
      const yaw = s.dirX !== undefined ? Math.atan2(s.dirX, s.dirZ) : 0;
      this.hooks.put?.(s.rx ?? s.x, s.rz ?? s.z, yaw);
      this.#nextCp();
      this.hud.toast(`Road test: ${cps.length} checkpoints. Under ${LIMIT} km/h, no knocks. Use your mirrors.`, 5);
    });
  }

  #nextCp() {
    const cp = this.road.cps[this.road.i];
    this.cpMesh.position.set(cp.x, this.hf.heightAt(cp.x, cp.z) + 1.2, cp.z);
    this.cpMesh.visible = true;
    this.gps.setDestination(cp.x, cp.z, cp.end ? 'Back to the testing ground' : `Checkpoint ${this.road.i + 1}`);
  }

  #roadTick(dt, inVehicle, vehicle) {
    const L = this.road;
    this.cpMesh.rotation.z += dt;
    if (!inVehicle) return;
    const kmh = Math.abs(vehicle.speedKmh || 0);
    if (kmh > LIMIT + 5) {
      L.speeding += dt;
      if (L.speeding > 3) return this.#fail(`speeding (${Math.round(kmh)} km/h in a 60 zone)`);
    } else L.speeding = Math.max(0, L.speeding - dt * 0.5);
    const cp = L.cps[L.i];
    if (Math.hypot(cp.x - vehicle.x, cp.z - vehicle.z) < CP_R) {
      if (cp.end && kmh > 8) return;
      L.i += 1;
      if (L.i >= L.cps.length) return this.#pass();
      this.hud.toast(`Checkpoint ${L.i} of ${L.cps.length - 1}`, 1.4);
      this.#nextCp();
    }
  }

  onCrash(impact) {
    if (this.mode && this.mode !== 'lesson' && impact > 4) this.#fail('you hit another car');
  }

  #pass() {
    this.mode = null;
    this.cpMesh.visible = false;
    this.gps.clear?.();
    this.L.code10 = true;
    this.save();
    this.hud.toast('PASSED! Code 10 licence. You can drive now. For taxi work, apply for a PrDP here at the testing ground.', 7);
  }

  #fail(why) {
    const at = this.testAt;
    this.mode = null;
    this.cpMesh.visible = false;
    this.gps.clear?.();
    this.L.retestAt = (this.now ? this.now.getTime() : Date.now()) + 2 * DAY_MS;
    this.save();
    this.#fade('FAILED', () => {
      if (at) {
        const yaw = at.dirX !== undefined ? Math.atan2(at.dirX, at.dirZ) : 0;
        this.hooks.put?.(at.rx ?? at.x, at.rz ?? at.z, yaw);
      }
      this.hud.toast(`Failed: ${why}. You can book again in 2 days.`, 6);
      this.hooks.exit?.();
    });
  }

  #leave(msg) {
    const back = this.from;
    this.mode = null;
    this.#fade('', () => {
      if (back) {
        const yaw = back.dirX !== undefined ? Math.atan2(back.dirX, back.dirZ) : 0;
        this.hooks.put?.(back.rx ?? back.x, back.rz ?? back.z, yaw);
      }
      this.hooks.exit?.();
      this.hud.toast(msg, 5);
    });
  }

  // ---------- mirrors (driving school and test) ----------
  // drawn only in the inside (driver) view, where the real mirrors sit:
  // rear-view top-centre (a little left of the driver, RHD), wings low at each side
  renderMirrors(renderer, scene, vehicle, inVehicle, insideView) {
    if (!inVehicle || !insideView || this.mirrorsOff) {
      if (this.framesShown) {
        for (const d of this.mirrorFrames) d.style.display = 'none';
        this.framesShown = false;
      }
      return;
    } // every car has mirrors (Bheko, 19 Nov)
    if (!this.mirrorCams) {
      this.mirrorCams = [0, 1, 2].map(() => new THREE.PerspectiveCamera(45, 3, 0.5, 250));
    }
    const W = renderer.domElement.clientWidth;
    const H = renderer.domElement.clientHeight;
    const fx = Math.sin(vehicle.yaw);
    const fz = Math.cos(vehicle.yaw);
    const rx = fz;
    const rz = -fx;
    const y = (vehicle.y ?? this.hf.heightAt(vehicle.x, vehicle.z)) + 1.5;
    const views = [
      // rear-view: top centre
      { cam: this.mirrorCams[0], ox: 0, back: 2.2, side: 0, turn: 0, vx: W * 0.47, vy: H * 0.03, vw: W * 0.26, vh: H * 0.13 },
      // left and right wing mirrors
      { cam: this.mirrorCams[1], ox: -1.1, back: 0, side: -1, turn: 0.18, vx: W * 0.01, vy: H * 0.56, vw: W * 0.13, vh: H * 0.14 },
      { cam: this.mirrorCams[2], ox: 1.1, back: 0, side: 1, turn: -0.18, vx: W * 0.86, vy: H * 0.56, vw: W * 0.13, vh: H * 0.14 },
    ];
    if (!this.mirrorFrames) {
      this.mirrorFrames = views.map(() => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;z-index:5;pointer-events:none;border:3px solid #111;border-radius:7px;box-shadow:0 1px 4px rgba(0,0,0,.5);box-sizing:border-box';
        document.body.appendChild(d);
        return d;
      });
    }
    views.forEach((v, k) => {
      const st = this.mirrorFrames[k].style;
      st.left = `${v.vx - 2}px`;
      st.top = `${v.vy - 2}px`;
      st.width = `${v.vw + 4}px`;
      st.height = `${v.vh + 4}px`;
      st.display = 'block';
    });
    this.framesShown = true;
    renderer.setScissorTest(true);
    const old = renderer.autoClear;
    renderer.autoClear = true;
    for (const v of views) {
      const c = v.cam;
      c.aspect = v.vw / v.vh;
      c.updateProjectionMatrix();
      c.position.set(vehicle.x + rx * v.ox - fx * v.back, y - (v.side ? 0.35 : 0), vehicle.z + rz * v.ox - fz * v.back);
      const lookYaw = vehicle.yaw + Math.PI + v.turn;
      c.lookAt(c.position.x + Math.sin(lookYaw) * 10, c.position.y - 0.4, c.position.z + Math.cos(lookYaw) * 10);
      // GL viewport origin is bottom-left
      renderer.setViewport(v.vx, H - v.vy - v.vh, v.vw, v.vh);
      renderer.setScissor(v.vx, H - v.vy - v.vh, v.vw, v.vh);
      renderer.render(scene, c);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.autoClear = old;
  }

  // ---------- panel ----------
  #panel() {
    const p = document.createElement('div');
    p.id = 'licence';
    p.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:30;width:min(340px,86vw);max-height:84vh;overflow:auto;padding:12px 14px;border-radius:14px;background:rgba(12,14,18,.94);color:#eee;font:14px/1.45 system-ui,sans-serif;display:none';
    (document.getElementById('hud') || document.body).appendChild(p);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      this.#act(b.dataset.a, b.dataset.v);
    });
    this.panelEl = p;
  }

  #fader() {
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;z-index:40;background:#000;color:#ffd21a;display:flex;align-items:center;justify-content:center;font:800 22px system-ui,sans-serif;letter-spacing:1px;text-align:center;opacity:0;pointer-events:none;transition:opacity .45s';
    document.body.appendChild(f);
    this.faderEl = f;
  }

  #fade(title, mid) {
    const f = this.faderEl;
    f.textContent = title;
    f.style.opacity = '1';
    setTimeout(() => {
      mid();
      setTimeout(() => (f.style.opacity = '0'), title ? 1100 : 300);
    }, 480);
  }

  #btn(a, label, v = '') {
    return `<button data-a="${a}" data-v="${v}" style="display:block;margin-top:8px;width:100%;padding:9px;border:0;border-radius:9px;font:700 14px system-ui;background:${a === 'close' ? '#333;color:#eee' : '#ffd21a;color:#111'}">${label}</button>`;
  }

  #waitText() {
    const t = (this.L.retestAt || 0) - (this.now ? this.now.getTime() : Date.now());
    if (t <= 0) return '';
    const h = Math.ceil(t / 3600000);
    return h > 24 ? `${Math.ceil(h / 24)} days` : `${h} hours`;
  }

  #open(site) {
    this.from = site;
    const L = this.L;
    let h = `<b style="color:#ffd21a">${site.name}</b>${site.at ? `<div style="opacity:.7">${site.at}</div>` : '<br>'}`;
    const wait = this.#waitText();
    if (site.kind === 'school') {
      if (!L.learner) h += `First, your learner's licence (K53 questions), ${R(LEARNERS_FEE)}.` + this.#btn('quiz', `Write learner's test ${R(LEARNERS_FEE)}`);
      else if (!L.code10) {
        h += `Learner's: passed. Lessons done: ${L.lessons || 0}.`;
        h += this.#btn('lesson', `Driving lesson in the yard ${R(LESSON_FEE)}`);
        const dl = this.#nearest(this.dltcs, site.x, site.z);
        if (wait) h += `<div style="margin-top:8px;color:#ff9a7a">You failed your last test. Book again in ${wait}.</div>`;
        else h += this.#btn('test', `Driving test at ${dl.name} ${R(TEST_FEE)}`);
      } else h += 'You have your Code 10. Sharp!';
    } else {
      if (!L.code10) h += 'Tests are booked through a driving school. Get your learner\'s and lessons there first.';
      else if (!L.prdp) h += `PrDP (professional driving permit) to carry paying passengers, ${R(PRDP_FEE)}.` + this.#btn('prdp', `Apply for PrDP ${R(PRDP_FEE)}`);
      else h += 'Code 10 and PrDP: you can drive taxis.';
    }
    h += `<div style="margin-top:6px;opacity:.7">Wallet ${R(this.w.r)}</div>` + this.#btn('close', 'Close');
    this.panelEl.innerHTML = h;
    this.panelEl.style.display = 'block';
  }

  #close() {
    this.panelEl.style.display = 'none';
  }

  #pay(fee) {
    if (this.w.r < fee) {
      this.hud.toast(`You need ${R(fee)}. Wallet: ${R(this.w.r)}.`, 3);
      return false;
    }
    this.w.r -= fee;
    this.save();
    this.show();
    return true;
  }

  #act(a, v) {
    if (a === 'close') return this.#close();
    if (a === 'quiz') {
      if (!this.#pay(LEARNERS_FEE)) return;
      const qs = QUIZ.slice().sort(() => Math.random() - 0.5).slice(0, 5);
      this.quiz = { qs, i: 0, right: 0 };
      return this.#quizShow();
    }
    if (a === 'ans') {
      const q = this.quiz.qs[this.quiz.i];
      if (Number(v) === q[2]) this.quiz.right += 1;
      this.quiz.i += 1;
      if (this.quiz.i < this.quiz.qs.length) return this.#quizShow();
      const ok = this.quiz.right >= 4;
      if (ok) {
        this.L.learner = true;
        this.save();
      }
      this.panelEl.innerHTML = `<b style="color:#ffd21a">${ok ? 'Passed' : 'Failed'}: ${this.quiz.right} of 5</b><br>${ok ? "Learner's licence done. Now book a lesson." : 'You need 4 of 5. Study the K53 and write again.'}` + this.#btn('again', 'OK');
      return;
    }
    if (a === 'again') return this.#open(this.from);
    if (a === 'lesson') {
      if (!this.#pay(LESSON_FEE)) return;
      return this.#enterYard('lesson', null);
    }
    if (a === 'test') {
      if (this.#waitText()) return;
      if (!this.#pay(TEST_FEE)) return;
      return this.#enterYard('test-yard', this.#nearest(this.dltcs, this.from.x, this.from.z));
    }
    if (a === 'prdp') {
      if (!this.#pay(PRDP_FEE)) return;
      this.L.prdp = true;
      this.save();
      this.#close();
      this.hud.toast('PrDP done. Go to a taxi rank: a boss there will give you a taxi to drive.', 5);
    }
  }

  #quizShow() {
    const { qs, i } = this.quiz;
    const [q, opts] = qs[i];
    this.panelEl.innerHTML = `<b style="color:#ffd21a">K53 question ${i + 1} of 5</b><br>${q}` + opts.map((o, k) => this.#btn('ans', o, k)).join('');
  }
}
