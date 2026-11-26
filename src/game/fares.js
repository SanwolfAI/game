import * as THREE from '../../vendor/three/three.module.js';
import { readablePlane } from '../world/readableBoard.js';
import { hdCanvas } from '../core/hdcanvas.js';
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
  // Soldiers Way: "serves Durban north routes including Inanda, Ntuzuma and
  // Phoenix" (East Coast Radio). Bheko rides Amaoti-Inanda into town.
  [/^Soldiersway/, ['Inanda', 'Amaoti', 'Ntuzuma', 'Phoenix', 'KwaMashu', 'Newlands', 'Verulam']],
  // Centenary (ML Sultan Rd): the Inanda rank by Market (IOL)
  [/^Centenary/, ['Inanda', 'Amaoti', 'KwaMashu', 'Ntuzuma', 'Bridge City Taxi Rank']],
  // Durban Station ranks (Umgeni Rd side): north and Durban North suburbs
  [/^Durban Station Taxi Rank 1/, ['Umhlanga Rocks', 'Durban North', 'Phoenix', 'Verulam', 'La Mercy Taxi Rank', 'Brookdale Taxi Rank']],
  [/^Durban Station Taxi Rank 2/, ['Sydenham', 'Overport', 'Sea-Cow Lake', 'Greenwood Park', 'Avoca', 'Newlands']],
  // Durban Central Market (Warwick): Umlazi, KwaMashu, Chatsworth, Pinetown (Taxis To Anywhere)
  [/^Durban Central/, ['Umlazi', 'Chatsworth', 'KwaMashu', 'Pinetown Taxi Rank', 'Cato Manor', 'Chesterville']],
  // Berea side (ShiftMate: Berea, Glenwood, Chatsworth, Wentworth)
  [/^No\. 1/, ['Berea', 'Glenwood', 'Mayville', 'Umbilo', 'Wentworth', 'Bluff']],
  // Brook St / Pinetown line (ShiftMate: Pinetown, Kloof); Clermont via Westville (Sunday Tribune)
  [/^Taxi to Pinetown|^Minibuses to PMB/, ['Pinetown Taxi Rank', 'Westville', 'Clermont', 'KwaDabeka', 'Kloof', 'Hillcrest Taxi Rank']],
  // South Beach: the south line (Port Shepstone rank: Umlazi, Isipingo, south coast)
  [/^South Beach/, ['Umlazi', 'Isipingo', 'Lamontville', 'Amanzimtoti', 'Winklespruit Taxi Rank']],
  [/^Pinetown/, ['Westmead', 'KwaMashu', 'Durban Central Taxi Rank', 'Clermont', 'New Germany', 'Kloof', 'Hillcrest Taxi Rank']],
  [/^Hillcrest/, ['Pinetown Taxi Rank', 'Kloof', 'Westmead', 'Durban Central Taxi Rank']],
  [/^Bridge City|^Redfern/, ['KwaMashu', 'Inanda', 'Ntuzuma', 'Phoenix', 'Centenary Taxi Rank', 'Umhlanga Rocks']],
  [/^Brookdale/, ['Phoenix', 'Bridge City Taxi Rank', 'Durban Station Taxi Rank 1', 'Verulam', 'Inanda']],
  [/^La Lucia|^Somerset Park/, ['Umhlanga Rocks', 'Durban Station Taxi Rank 1', 'Phoenix', 'Bridge City Taxi Rank', 'Durban North']],
  [/^La Mercy/, ['Verulam', 'Umhlanga Rocks', 'Durban Station Taxi Rank 1', 'Phoenix']],
  [/^Winklespruit/, ['Amanzimtoti', 'Isipingo', 'Umlazi', 'South Beach Taxi Rank']]
];

// Taxi rank fares. Real OSM ranks (amenity=taxi, in durban-grounds.json as
// k:'taxi') get a yellow loading bay at the kerb, a TAXI RANK board and a
// queue of people. Stop in the bay: passengers board, the GPS routes you to
// another rank (or a suburb), and dropping them off pays rand into the wallet
// (saved on the phone). The Quantum carries 14, anything else carries 3.
// Wallet feeds car unlocks later.

import { TaxiCareer } from './owner.js';
import { Homes } from './home.js';
import { Licence } from './licence.js';

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
  const c = hdCanvas(256, 96);
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
  t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY; // GPU max (main.js)
  return t;
}

// Route suburbs in game x/z: OSM place nodes (places-raw.json); Amaoti from its
// schools; Ntuzuma, Newlands, Glenwood, Bluff, Westville, Lamontville and
// Mayville from approximate suburb centres (not in the place data).
const EXTRA_TOWNS = {
  'Amaoti': { x: -3100, z: -19600 },
  'Ntuzuma': { x: -7414, z: -13899 },
  'Newlands': { x: -4518, z: -9255 },
  'Glenwood': { x: -2105, z: 1581 },
  'Bluff': { x: 309, z: 7331 },
  'Westville': { x: -8863, z: -2621 },
  'Lamontville': { x: -7414, z: 9874 },
  'Mayville': { x: -3553, z: -1515 },
  'Sydenham': { x: -2799, z: -2994 },
  'Overport': { x: -2965, z: -2271 },
  'Sea-Cow Lake': { x: -1381, z: -6429 },
  'Greenwood Park': { x: -496, z: -8149 },
  'Avoca': { x: -496, z: -9716 },
  'Clermont': { x: -11303, z: -7289 },
  'Cato Manor': { x: -6744, z: 359 },
  'Westmead': { x: -17900, z: -4433 },
  'Umbilo': { x: -4250, z: 3522 },
  'Morningside': { x: -895, z: -4051 },
  'Wentworth': { x: -2105, z: 6840 },
  'Inanda': { x: -6932, z: -15889 },
  'Phoenix': { x: -1408, z: -17376 },
  'Verulam': { x: 2052, z: -23753 },
  'Isipingo': { x: -9748, z: 13935 },
  'Amanzimtoti': { x: -12858, z: 21122 },
  'Kloof': { x: -18973, z: -8057 },
  'Umhlanga Rocks': { x: 5887, z: -14231 },
  'Durban North': { x: 1355, z: -8641 },
  'KwaDabeka': { x: -10928, z: -9163 },
  'New Germany': { x: -13717, z: -5938 },
  'Chesterville': { x: -7173, z: -1208 },
};
// Stops before the city rank on the north-corridor township routes
// (Bheko, 19 Nov, Amaoti-Inanda route: people get off at Red Hill shelter,
// Mabhida, Home Affairs on Umgeni Road, before the rank).
const NORTH_CITY_STOPS = [
  { name: 'Red Hill shelter', x: 99.3, z: -8819.0 },
  { name: 'Mabhida', x: 632.9, z: -3551.8 },
  { name: 'Home Affairs, Umgeni Road', lon: 31.02283, lat: -29.841406 },
];

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
    this.waiting = this.ranks.length ? this.ranks[0].people.clone() : new THREE.Group();
    this.waiting.visible = false;
    this.group.add(this.waiting);
  }

  #build() {
    const paint = new THREE.MeshBasicMaterial({ color: 0xf2c200, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const bayGeo = new THREE.PlaneGeometry(4.2, 22);
    bayGeo.rotateX(-Math.PI / 2);
    const board = new THREE.MeshBasicMaterial({ map: boardTexture() });
    const boardGeo = readablePlane(2.6, 0.98); // reads left to right from both sides
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
    el.style.cssText = 'position:fixed;right:12px;top:144px;z-index:6;padding:4px 10px;border-radius:12px;background:rgba(12,14,18,.72);color:#ffd21a;font:700 14px system-ui,sans-serif;pointer-events:auto;cursor:pointer;letter-spacing:.3px';
    (document.getElementById('hud') || document.body).appendChild(el);
    this.walletEl = el;
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => this.career.toggle());
    this.licence = new Licence(this.wallet, { hud: this.hud, gps: this.gps, hf: this.hf, roads: this.roads, save: () => this.#save(), show: () => this.#showWallet() });
    this.group.add(this.licence.group);
    this.homes = new Homes(this.wallet, { hud: this.hud, hf: this.hf, roads: this.roads, save: () => this.#save(), show: () => this.#showWallet() });
    this.group.add(this.homes.group);
    this.licence.homeOf = () => this.homes.home; // lesson pick-up at your door
    this.career = new TaxiCareer(this.wallet, { save: () => this.#save(), toast: (m, t) => this.hud.toast(m, t), show: () => this.#showWallet() });
    this.career.licence = this.licence;
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

  // wallet changed elsewhere (taxi rides as a passenger)
  saveWallet() {
    this.#save();
  }

  showWallet() {
    this.#showWallet();
  }

  get money() {
    return this.wallet.r;
  }

  #pickDestination(from) {
    if (!from.routes) {
      const row = ROUTES.find(([re]) => re.test(from.name));
      from.routes = this.#resolve(from, row ? row[1] : []);
      // a rank with no researched routes runs to the nearest CBD rank
      if (!from.routes.length) {
        const cbd = this.ranks.filter((r) => r !== from && Math.hypot(r.x, r.z) < 1500).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
        if (cbd) from.routes.push({ name: cbd.name, x: cbd.x, z: cbd.z, rank: true });
      }
      from.turn = Math.floor(Math.random() * Math.max(1, from.routes.length));
    }
    if (!from.routes.length) return null;
    // the queue loads one route at a time, in turn
    const to = from.routes[from.turn % from.routes.length];
    from.turn++;
    return to;
  }

  // North-corridor stops (Red Hill shelter, Mabhida, Home Affairs): you can
  // board there too, into town or out to the townships (taxiRide.js)
  #buildStops() {
    this.stops = [];
    for (const c of NORTH_CITY_STOPS) {
      const [cx, cz] = c.lon != null ? toXZ(c.lon, c.lat) : [c.x, c.z];
      const nr = this.roads.nearestRoad(cx, cz, 200, (q) => q.rank >= 2);
      if (!nr) continue;
      this.stops.push({ name: c.name, x: nr.x, z: nr.z, ox: nr.x, oz: nr.z, yaw: Math.atan2(nr.dirX, nr.dirZ), stop: true, names: ['Soldiersway', 'Durban Station Taxi Rank 1', 'Inanda', 'Amaoti', 'KwaMashu', 'Phoenix'] });
    }
  }

  stopNear(x, z, r = 18) {
    if (!this.stops) this.#buildStops();
    for (const k of this.stops) if (Math.abs(k.x - x) < r && Math.abs(k.z - z) < r && Math.hypot(k.x - x, k.z - z) < r) return k;
    return null;
  }

  // where a passenger can ride from here (the rank's own routes)
  passengerRoutes(from) {
    if (from.stop) {
      if (!from.routes) from.routes = this.#resolve(from, from.names);
      return from.routes;
    }
    this.routesOf(from);
    return from.routes;
  }

  // route names (rank prefix or suburb) -> road points
  #resolve(from, names) {
    const out = [];
    for (const n of names) {
      const rk = this.ranks.find((r) => r !== from && r.name.startsWith(n));
      if (rk) {
        out.push({ name: rk.name, x: rk.x, z: rk.z, rank: true });
        continue;
      }
      const p = (EXTRA_TOWNS[n] && { name: n, ...EXTRA_TOWNS[n] }) || PLACES.find((q) => q.name === n);
      if (p) {
        const [x, z] = p.lon != null ? toXZ(p.lon, p.lat) : [p.x, p.z];
        const nr = this.roads.nearestRoad(x, z, 400, (r) => r.rank >= 3);
        out.push({ name: n, x: nr ? nr.x : x, z: nr ? nr.z : z, town: true });
      }
    }
    return out;
  }

  // the rank a person on foot is standing at (bay or rank site), or null
  rankNear(x, z, r = 24) {
    for (const k of this.ranks) {
      if (Math.abs(k.ox - x) > 60 && Math.abs(k.x - x) > 60) continue;
      if (Math.hypot(k.x - x, k.z - z) < r || Math.hypot(k.ox - x, k.oz - z) < r) return k;
    }
    return null;
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
    this.waiting.visible = false;
    if (this.gps.dest && this.gps.dest.fare) this.gps.clear();
    if (reason) this.hud.toast(reason, 2.6);
    this.cool = 6;
  }

  // a road point inside a town, `r` metres from its centre
  #townPoint(cx, cz, r) {
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2;
      const nr = this.roads.nearestRoad(cx + Math.cos(a) * r, cz + Math.sin(a) * r, 250, (q) => q.rank >= 3 && q.rank <= 6);
      if (nr) return { x: nr.x, z: nr.z };
    }
    return { x: cx, z: cz };
  }

  // Two kinds of route, as Bheko explained (19 Nov):
  //  - rank to rank (e.g. Durban - Umzinto): load at the rank, drive straight
  //    to the other rank, nobody picked up on the road.
  //  - township routes (e.g. Inanda): from the city rank drive out and drop
  //    stop to stop in the township, picking up people going to town on the
  //    way, then back to the same rank, where it queues for its turn again.
  #legs(from, to, pax) {
    if (to.rank || !to.town) return [{ kind: 'final', name: to.name, x: to.x, z: to.z, drop: pax, pick: 0 }];
    const legs = [];
    let left = pax;
    const drops = 3;
    for (let k = 1; k <= drops; k++) {
      const p = this.#townPoint(to.x, to.z, 200 + k * 260);
      const d = k === drops ? left : Math.max(1, Math.round(pax / drops));
      left -= d;
      // on the way, people at the roadside who are going to town get on
      const pick = k === drops ? 0 : Math.min(d, 1 + Math.floor(Math.random() * Math.max(1, d)));
      legs.push({ kind: 'drop', name: `${to.name} stop ${k}`, x: p.x, z: p.z, drop: d, pick });
    }
    for (let k = 1; k <= 2; k++) {
      const p = this.#townPoint(to.x, to.z, 150 + k * 300);
      legs.push({ kind: 'pick', name: `${to.name} pick-up ${k}`, x: p.x, z: p.z, drop: 0, pick: 0 });
    }
    // north-corridor routes into the CBD: some get off before the rank
    if (to.z < -6000 && Math.hypot(from.x, from.z) < 3500) {
      for (const c of NORTH_CITY_STOPS) {
        const [cx, cz] = c.lon != null ? toXZ(c.lon, c.lat) : [c.x, c.z];
        const nr = this.roads.nearestRoad(cx, cz, 200, (q) => q.rank >= 2);
        legs.push({ kind: 'city', name: c.name, x: nr ? nr.x : cx, z: nr ? nr.z : cz, drop: 0, pick: 0 });
      }
    }
    legs.push({ kind: 'final', name: from.name, x: from.x, z: from.z, drop: -1, pick: 0 });
    return legs;
  }

  #goLeg() {
    const j = this.job;
    const leg = j.legs[j.i];
    this.gps.setDestination(leg.x, leg.z, leg.name);
    this.gps.dest.fare = true;
    this.beam.position.set(leg.x, this.hf.heightAt(leg.x, leg.z), leg.z);
    this.waiting.visible = leg.kind === 'pick';
    if (leg.kind === 'pick') this.waiting.position.set(leg.x, this.hf.heightAt(leg.x, leg.z), leg.z);
  }

  #pay(n, tip = 0) {
    const total = n * this.job.fare + tip;
    // driver for a boss: the boss's target comes first (owner.js)
    const { mine, boss, fired } = this.career.earn(total, this.now);
    if (fired) this.hud.toast('Parked for today: the boss keeps every fare.', 2.5);
    this.#showWallet(boss ? `  +${mine} (boss R${boss})` : `  +${mine}`);
    this.flash = 3;
    return total;
  }

  // GPS arrival hook. Returns true when the arrival was a fare stop.
  onArrive(arrival) {
    const j = this.job;
    if (!j || !arrival) return false;
    const leg = j.legs[j.i];
    if (!leg || arrival.name !== leg.name) return false;
    const cap = j.cap;
    let msg = '';
    if (leg.kind === 'drop') {
      const got = this.#pay(leg.drop);
      j.onboard -= leg.drop;
      const pick = Math.min(leg.pick, cap - j.onboard);
      j.onboard += pick;
      j.townward += pick;
      msg = `Dropped ${leg.drop}: +R${got}` + (pick ? `, ${pick} going to town got on` : '');
    } else if (leg.kind === 'pick') {
      const pick = Math.max(0, Math.min(cap - j.onboard, 2 + Math.floor(Math.random() * 5)));
      j.onboard += pick;
      j.townward += pick;
      msg = pick ? `${pick} picked up at the roadside, going to ${j.from.name.replace(/ Taxi Rank.*$/, '')}` : 'Nobody waiting here';
      this.waiting.visible = false;
    } else if (leg.kind === 'city') {
      const n = Math.min(j.townward, 1 + Math.floor(Math.random() * Math.max(1, j.townward / 3)));
      const got = n ? this.#pay(n) : 0;
      j.townward -= n;
      j.onboard -= n;
      msg = n ? `${n} got off at ${leg.name}: +R${got}` : `Nobody for ${leg.name}`;
    } else {
      const n = leg.drop < 0 ? j.townward : leg.drop;
      const tip = j.t < j.est ? Math.round(n * 3) : 0;
      const got = n ? this.#pay(n, tip) : 0;
      this.wallet.trips = (this.wallet.trips || 0) + 1;
      this.#save();
      this.hud.toast(`Trip done: +R${got}${tip ? ` (R${tip} tips)` : ''}. Queue again to load.`, 4);
      this.job = null;
      this.beam.visible = false;
      this.waiting.visible = false;
      this.cool = 5;
      return true;
    }
    j.i++;
    // skip the pick-ups when the taxi is already full
    while (j.legs[j.i] && j.legs[j.i].kind === 'pick' && j.onboard >= cap) j.i++;
    this.#goLeg();
    const next = j.legs[j.i];
    this.hud.toast(`${msg}. Next: ${next.kind === 'final' ? `back to ${next.name}` : next.name}`, 3.4);
    return true;
  }

  update(dt, ent, inVehicle, vehicle, now) {
    this.now = now;
    if (this.career) this.career.update(now);
    if (this.licence) this.licence.update(dt, ent, inVehicle, vehicle, now);
    const px = ent.x;
    const pz = ent.z;
    // only draw ranks nearby
    for (const r of this.ranks) r.group.visible = Math.abs(r.x - px) < 700 && Math.abs(r.z - pz) < 700;
    if (this.flash > 0 && (this.flash -= dt) <= 0) this.#showWallet();
    if (this.cool > 0) this.cool -= dt;

    if (this.job) {
      this.job.t += dt;
      this.beam.visible = true;
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
      this.queueT = 0;
      this.hinted = null;
      return;
    }
    if (this.hinted !== near) {
      this.hinted = near;
      this.hud.toast(`${near.name.replace(/ Taxi Rank.*$/, '')} rank: stop in the yellow bay to queue`, 3.4);
    }
    if (Math.abs(vehicle.speedKmh || 0) > STOP_KMH) {
      this.stopT = 0;
      return;
    }
    // taxi work needs a Code 10 and a PrDP (licence.js)
    if (this.licence.atSchool) return;
    if (!this.licence.canTaxi) {
      if (this.hinted !== 'nolicence' + near.name) {
        this.hinted = 'nolicence' + near.name;
        this.hud.toast(this.licence.why(), 3.5);
        this.licence.guide(px, pz);
      }
      return;
    }
    // queue for your turn
    if (!this.queueT) {
      const ahead = 1 + Math.floor(Math.random() * 3);
      this.queueT = BOARD_S + ahead * 3;
      this.hud.toast(`In the queue: ${ahead} taxi${ahead > 1 ? 's' : ''} ahead of you`, 2.6);
    }
    this.stopT += dt;
    if (this.stopT < this.queueT) return;
    this.stopT = 0;
    this.queueT = 0;
    const to = this.#pickDestination(near);
    if (!to) return;
    const cap = vehicle.typeId === 'quantum' ? 14 : 3;
    const km = Math.hypot(to.x - near.x, to.z - near.z) / 1000;
    const fare = Math.round(Math.min(35, Math.max(15, 10 + km * 1.1)));
    const legs = this.#legs(near, to, cap);
    const est = ((km * 1.35 * (to.town ? 2.4 : 1)) / 40) * 3600 + 60;
    this.job = { from: near, to, cap, onboard: cap, townward: 0, fare, legs, i: 0, t: 0, est };
    this.#goLeg();
    const how = to.town ? 'stop to stop, then back to the rank' : 'straight to the rank, no road pick-ups';
    this.hud.toast(`Your turn: ${cap} on board to ${to.name}, R${fare} each, ${how}`, 4);
    near.people.visible = false;
    setTimeout(() => (near.people.visible = true), 60000);
  }
}
