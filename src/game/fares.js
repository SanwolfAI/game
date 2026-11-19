import * as THREE from '../../vendor/three/three.module.js';
import { PLACES, toXZ } from '../core/geo.js';

// Every rank runs its own routes, like the real thing (Bheko 19 Nov: "every
// taxi has its own route, it doesn't go everywhere like an Uber"). Sources:
// Taxis To Anywhere rank pages (Pinetown rank: Westmead, KwaMashu, Durban
// Market, Isipingo, Gateway; KwaMashu rank: Durban, Pinetown, Umhlanga,
// Bridge City, Inanda, Springfield), ShiftMate CBD guide (Warwick: KwaMashu,
// Inanda, Ntuzuma, Phoenix, Verulam; Berea Station: Berea, Glenwood,
// Chatsworth, Wentworth; Brook St: Pinetown, Kloof, Chatsworth), Durban Central
// Market rank (Umlazi, KwaMashu, Chatsworth, Pinetown). Where a source names a
// corridor but not a rank, the nearest OSM rank on that corridor carries it.
// A destination is a rank name (prefix) or a suburb from PLACES.
const ROUTES = [
  [/^Durban Station/, ['KwaMashu', 'Inanda', 'Phoenix', 'Verulam', 'Bridge City Taxi Rank']],
  [/^Soldiersway/, ['Umlazi', 'Isipingo', 'Amanzimtoti', 'Winklespruit Taxi Rank']],
  [/^Centenary|^No\. 1/, ['Pinetown Taxi Rank', 'Chatsworth', 'Umlazi', 'Westmead']],
  [/^Taxi to Pinetown|^Minibuses to PMB/, ['Pinetown Taxi Rank']],
  [/^Durban Central/, ['Berea', 'Chatsworth', 'Wentworth', 'Cato Manor', 'Sydenham']],
  [/^South Beach/, ['Durban Station Taxi Rank 1', 'Berea', 'Morningside', 'Umbilo']],
  [/^Pinetown/, ['Westmead', 'KwaMashu', 'Centenary Taxi Rank', 'Isipingo', 'Kloof', 'Hillcrest Taxi Rank']],
  [/^Hillcrest/, ['Pinetown Taxi Rank', 'Kloof', 'Centenary Taxi Rank']],
  [/^Bridge City|^Redfern/, ['KwaMashu', 'Inanda', 'Phoenix', 'Durban Station Taxi Rank 1', 'Umhlanga Rocks']],
  [/^Brookdale/, ['Phoenix', 'Bridge City Taxi Rank', 'Durban Station Taxi Rank 2', 'Verulam']],
  [/^La Lucia|^Somerset Park/, ['Umhlanga Rocks', 'Durban Station Taxi Rank 1', 'Phoenix', 'Bridge City Taxi Rank']],
  [/^La Mercy/, ['Verulam', 'Umhlanga Rocks', 'Durban Station Taxi Rank 2']],
  [/^Winklespruit/, ['Amanzimtoti', 'Isipingo', 'Umlazi', 'Soldiersway Taxi Rank']]
];

// Taxi rank fares. Real OSM ranks (amenity=taxi, in durban-grounds.json as
// k:'taxi') get a yellow loading bay at the kerb, a TAXI RANK board and a
// queue of people. Stop in the bay: passengers board, the GPS routes you to
// another rank (or a suburb), and dropping them off pays rand into the wallet
// (saved on the phone). The Quantum carries 14, anything else carries 3.
// Wallet feeds car unlocks later.

const WALLET_KEY = 'izk.wallet.v1';
const BAY_R = 16; // m from the bay centre to count as "in the bay"
const STOP_KMH = 8;
const BOARD_S = 2.2;
const SHIRTS = [0xd23b2f, 0x2f6fd2, 0xf2c230, 0x3a9a4a, 0xffffff, 0x7a3fa0, 0xe57a1f, 0x222222];

function loadWallet() {
  try {
    const w = JSON.parse(localStorage.getItem(WALLET_KEY) || 'null');
    if (w && Number.isFinite(w.r)) return w;
  } catch {}
  return { r: 0, trips: 0 };
}

function boardTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#f5c400';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#111';
  g.fillRect(6, 6, 244, 84);
  g.fillStyle = '#f5c400';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI RANK', 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Fares {
  constructor(data, { hf, roads, gps, hud }) {
    this.hf = hf;
    this.roads = roads;
    this.gps = gps;
    this.hud = hud;
    this.group = new THREE.Group();
    this.group.name = 'taxi-ranks';
    this.wallet = loadWallet();
    this.job = null; // {from, to, pax, fare, t, est}
    this.stopT = 0;
    this.cool = 0;
    this.ranks = [];
    const sites = ((data && data.sites) || []).filter((s) => s.k === 'taxi' && s.c);
    for (const s of sites) {
      const [ox, oz] = s.c;
      // the bay sits on the kerb of the nearest proper road
      const nr = roads.nearestRoad(ox, oz, 90, (r) => r.rank >= 2);
      let x = ox;
      let z = oz;
      let yaw = 0;
      if (nr) {
        const l = Math.hypot(nr.dirX, nr.dirZ) || 1;
        const ux = nr.dirX / l;
        const uz = nr.dirZ / l;
        // left side of the road (SA drives on the left), toward the rank
        let nx = -uz;
        let nz = ux;
        if ((ox - nr.x) * nx + (oz - nr.z) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        const off = nr.road.width / 2 - 1.6;
        x = nr.x + nx * off;
        z = nr.z + nz * off;
        yaw = Math.atan2(ux, uz);
        this.ranks.push({ name: s.n, x, z, ox, oz, yaw, nx, nz });
      } else this.ranks.push({ name: s.n, x, z, ox, oz, yaw, nx: 1, nz: 0 });
    }
    this.#build();
    this.#makeWalletEl();
    this.#makeBeam();
  }

  #build() {
    const paint = new THREE.MeshBasicMaterial({ color: 0xf2c200, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const bayGeo = new THREE.PlaneGeometry(4.2, 22);
    bayGeo.rotateX(-Math.PI / 2);
    const board = new THREE.MeshBasicMaterial({ map: boardTexture(), side: THREE.DoubleSide });
    const boardGeo = new THREE.PlaneGeometry(2.6, 0.98);
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x8a8f94 });
    const shelterRoof = new THREE.BoxGeometry(2.4, 0.12, 9);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x5f6a72 });
    const body = new THREE.CapsuleGeometry(0.24, 0.9, 3, 6);
    const head = new THREE.SphereGeometry(0.15, 6, 5);
    const skin = new THREE.MeshLambertMaterial({ color: 0x4a2e1f });
    const shirtMats = SHIRTS.map((c) => new THREE.MeshLambertMaterial({ color: c }));
    for (const r of this.ranks) {
      const g = new THREE.Group();
      const y = this.hf.heightAt(r.x, r.z);
      g.position.set(r.x, y, r.z);
      g.rotation.y = r.yaw;
      const bay = new THREE.Mesh(bayGeo, paint);
      bay.position.y = 0.06;
      g.add(bay);
      // shelter + board on the pavement side (local +x is the kerb side once rotated)
      const side = (r.nx * Math.cos(r.yaw) - r.nz * Math.sin(r.yaw)) >= 0 ? 1 : -1;
      const sx = side * 4.4;
      for (const pz of [-4, 4]) {
        const p = new THREE.Mesh(poleGeo, poleMat);
        p.position.set(sx, 1.6, pz);
        g.add(p);
      }
      const roof = new THREE.Mesh(shelterRoof, roofMat);
      roof.position.set(sx, 3.2, 0);
      g.add(roof);
      const b = new THREE.Mesh(boardGeo, board);
      b.position.set(sx, 3.85, 0);
      b.rotation.y = Math.PI / 2;
      g.add(b);
      // the queue
      const people = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const m = shirtMats[(i * 5 + Math.floor(r.x)) & 7] || shirtMats[0];
        const pb = new THREE.Mesh(body, m);
        pb.position.set(sx - side * 0.2 + (i % 2) * 0.4 * side, 0.7, -3.6 + i * 1.15);
        const ph = new THREE.Mesh(head, skin);
        ph.position.set(pb.position.x, 1.46, pb.position.z);
        people.add(pb, ph);
      }
      g.add(people);
      r.people = people;
      r.group = g;
      g.visible = false;
      this.group.add(g);
    }
  }

  #makeBeam() {
    const geo = new THREE.CylinderGeometry(3, 3, 140, 16, 1, true);
    geo.translate(0, 70, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd21a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(geo, mat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.group.add(this.beam);
  }

  #makeWalletEl() {
    const el = document.createElement('div');
    el.id = 'wallet';
    el.style.cssText = 'position:fixed;right:12px;top:96px;z-index:6;padding:4px 10px;border-radius:12px;background:rgba(12,14,18,.72);color:#ffd21a;font:700 14px system-ui,sans-serif;pointer-events:none;letter-spacing:.3px';
    (document.getElementById('hud') || document.body).appendChild(el);
    this.walletEl = el;
    this.#showWallet();
  }

  #showWallet(extra = '') {
    const r = Math.round(this.wallet.r).toLocaleString('en-ZA');
    this.walletEl.textContent = `R ${r}${extra}`;
  }

  #save() {
    try {
      localStorage.setItem(WALLET_KEY, JSON.stringify(this.wallet));
    } catch {}
  }

  get money() {
    return this.wallet.r;
  }

  #pickDestination(from) {
    if (!from.routes) {
      const row = ROUTES.find(([re]) => re.test(from.name));
      from.routes = [];
      for (const n of row ? row[1] : []) {
        const rk = this.ranks.find((r) => r !== from && r.name.startsWith(n));
        if (rk) {
          from.routes.push({ name: rk.name, x: rk.x, z: rk.z });
          continue;
        }
        const p = PLACES.find((q) => q.name === n);
        if (p) {
          const [x, z] = toXZ(p.lon, p.lat);
          const nr = this.roads.nearestRoad(x, z, 400, (r) => r.rank >= 3);
          from.routes.push({ name: n, x: nr ? nr.x : x, z: nr ? nr.z : z });
        }
      }
      // a rank with no researched routes runs to the nearest CBD rank
      if (!from.routes.length) {
        const cbd = this.ranks.filter((r) => r !== from && Math.hypot(r.x, r.z) < 1500).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
        if (cbd) from.routes.push({ name: cbd.name, x: cbd.x, z: cbd.z });
      }
      from.turn = Math.floor(Math.random() * Math.max(1, from.routes.length));
    }
    if (!from.routes.length) return null;
    // the queue loads one route at a time, in turn
    const to = from.routes[from.turn % from.routes.length];
    from.turn++;
    return to;
  }

  routesOf(rank) {
    if (!rank.routes) {
      this.#pickDestination(rank);
      rank.turn--;
    }
    return rank.routes.map((r) => r.name.replace(/ Taxi Rank.*$/, '')).join(', ');
  }

  cancel(reason) {
    if (!this.job) return;
    this.job = null;
    this.beam.visible = false;
    if (this.gps.dest && this.gps.dest.fare) this.gps.clear();
    if (reason) this.hud.toast(reason, 2.6);
    this.cool = 6;
  }

  // GPS arrival hook. Returns true when the arrival was a fare drop-off.
  onArrive(arrival) {
    if (!this.job || !arrival || arrival.name !== this.job.to.name) return false;
    const j = this.job;
    const fast = j.t < j.est;
    const tip = fast ? Math.round(j.pax * 4) : 0;
    const total = j.pax * j.fare + tip;
    this.wallet.r += total;
    this.wallet.trips = (this.wallet.trips || 0) + 1;
    this.#save();
    this.job = null;
    this.beam.visible = false;
    this.cool = 5;
    this.hud.toast(`Dropped ${j.pax} at ${j.to.name}: +R${total}${tip ? ` (R${tip} tips, quick trip)` : ''}`, 4);
    this.#showWallet(`  +${total}`);
    this.flash = 3;
    return true;
  }

  update(dt, ent, inVehicle, vehicle) {
    const px = ent.x;
    const pz = ent.z;
    // only draw ranks nearby
    for (const r of this.ranks) r.group.visible = Math.abs(r.x - px) < 700 && Math.abs(r.z - pz) < 700;
    if (this.flash > 0 && (this.flash -= dt) <= 0) this.#showWallet();
    if (this.cool > 0) this.cool -= dt;

    if (this.job) {
      this.job.t += dt;
      this.beam.visible = true;
      this.beam.position.set(this.job.to.x, this.hf.heightAt(this.job.to.x, this.job.to.z), this.job.to.z);
      if (!inVehicle) return this.cancel('Passengers got out: you left the taxi');
      if (!this.gps.dest) return this.cancel('Fare cancelled');
      return;
    }
    if (!inVehicle || this.cool > 0) {
      this.stopT = 0;
      return;
    }
    let near = null;
    for (const r of this.ranks) {
      if (Math.abs(r.x - px) > 40 || Math.abs(r.z - pz) > 40) continue;
      if (Math.hypot(r.x - px, r.z - pz) < BAY_R || Math.hypot(r.ox - px, r.oz - pz) < 24) {
        near = r;
        break;
      }
    }
    if (!near) {
      this.stopT = 0;
      this.hinted = null;
      return;
    }
    if (this.hinted !== near) {
      this.hinted = near;
      this.hud.toast(`${near.name}: routes to ${this.routesOf(near)}. Stop in the yellow bay to load`, 3.4);
    }
    if (Math.abs(vehicle.speedKmh || 0) > STOP_KMH) {
      this.stopT = 0;
      return;
    }
    this.stopT += dt;
    if (this.stopT < BOARD_S) return;
    this.stopT = 0;
    const to = this.#pickDestination(near);
    if (!to) return;
    const pax = vehicle.typeId === 'quantum' ? 14 : 3;
    const km = Math.hypot(to.x - near.x, to.z - near.z) / 1000;
    const fare = Math.round(Math.min(35, Math.max(15, 10 + km * 1.1)));
    // estimate: road distance ~1.35x straight line at ~40 km/h
    const est = ((km * 1.35) / 40) * 3600 + 30;
    this.job = { from: near, to, pax, fare, t: 0, est };
    this.gps.setDestination(to.x, to.z, to.name);
    this.gps.dest.fare = true;
    this.hud.toast(`${near.name} \u2192 ${to.name}: ${pax} on board, R${fare} each. Follow the GPS.`, 3.5);
    near.people.visible = false;
    setTimeout(() => (near.people.visible = true), 60000);
  }
}
