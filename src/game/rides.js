import * as THREE from '../../vendor/three/three.module.js';
import { registerDialog } from '../ui/dialogs.js';
import { PLACES, toXZ } from '../core/geo.js';
import { PathMover, carMeshClone, laneGap } from './taxiRide.js';
import { animateWheels } from './carModels.js';

// Catch a taxi or call a ride (Sandile, 24 Nov 2026: "let the player be able
// to catch a taxi or call an uber").
//
// 1) Hail a minibus taxi. On foot at a bus/taxi shelter or beside a road, the
//    hand button (or T) is the hand signal. A white Quantum comes up the road
//    behind you, pulls over on your side, you get in and say where you are
//    going (areas and landmarks along the main roads, dropped at the nearest
//    stop). Flat fare R18-R25 like real Durban taxis, paid when you get in.
// 2) Hamba Ride, a made-up e-hailing app (not any real brand). The phone button
//    (or P, or the pause menu) opens it: pick a place or a pin on the map, see
//    the fare (about R10/km, R30 minimum) and the driver's ETA, request, a car
//    drives to you, you get in and ride; the fare comes off the wallet at
//    drop-off.
// Both rides run through taxiRide.js (route, camera, x4 skip, get off early).
// No new assets: the Quantum and Polo are the game's own traffic cars.

const R = (n) => `R${Math.round(n).toLocaleString('en-ZA')}`;

// Lucide icons (ISC licence, https://lucide.dev), inlined as SVG paths
const LUCIDE = {
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  taxi: '<path d="M10 2h4"/><path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8"/><path d="M7 14h.01"/><path d="M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  ff: '<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>'
};
export const icon = (k, s = 24) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[k]}</svg>`;

// Durban minibus taxi: flat fare by how far you go (R18-R25, 2025/26 local fares)
export function taxiFare(m) {
  const km = m / 1000;
  return km < 3 ? 18 : km < 6 ? 20 : km < 10 ? 22 : 25;
}
// e-hailing: about R10/km on the road distance, R30 minimum
export function ehailFare(m) {
  return Math.max(30, Math.round((m / 1000) * 10));
}
const DRIVERS = ['Sipho', 'Thandeka', 'Ayanda', 'Lwazi', 'Nomvula', 'Kyle', 'Priya', 'Mthunzi'];
const EH_SPEED = 11; // m/s average for ETAs (~40 km/h through town)

export class Rides {
  constructor({ ride, roads, router, hud, fares, shelters, bigmap, player }) {
    this.ride = ride;
    this.roads = roads;
    this.router = router;
    this.hud = hud;
    this.fares = fares;
    this.w = fares.wallet;
    this.shelters = shelters;
    this.bigmap = bigmap;
    this.player = player;
    this.group = new THREE.Group();
    this.group.name = 'rides-approach';
    this.group.visible = false;
    this.meshes = {};
    this.mesh = null;
    this.mover = new PathMover(roads);
    this.state = 'idle'; // idle | coming | waiting
    this.kind = ''; // taxi | ehail
    this.ff = 1;
    this.checkT = 0;
    this.stuckT = 0;
    this.ghostT = 0;
    this.canHail = false;
    this.foot = null;
    this.dest = null; // e-hail destination { name, x, z }
    this.quote = null;
    this.#buttons();
    this.#card();
    this.#taxiPicker();
    this.#app();
    addEventListener('keydown', (e) => {
      if (e.repeat || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
      if (e.code === 'KeyT' && this.canHail) this.hail();
      else if (e.code === 'KeyP') this.openApp();
    });
  }

  // ---- buttons: hand signal + phone (thumb size, on foot only) ----
  #buttons() {
    const el = document.createElement('div');
    el.id = 'ride-btns';
    el.innerHTML = `<button type="button" id="rb-hail" aria-label="Hail a taxi">${icon('hand', 26)}</button><button type="button" id="rb-phone" aria-label="Hamba Ride app">${icon('phone', 26)}</button>`;
    document.body.appendChild(el);
    el.querySelector('#rb-hail').addEventListener('click', () => this.hail());
    el.querySelector('#rb-phone').addEventListener('click', () => this.openApp());
    // the pause menu gets a ride-app entry too
    const panel = document.querySelector('#menu .panel');
    const before = document.getElementById('m-new');
    if (panel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'm-ride';
      b.innerHTML = `${icon('phone', 20)} Hamba Ride`;
      b.addEventListener('click', () => {
        document.getElementById('m-resume')?.click();
        this.openApp();
      });
      panel.insertBefore(b, before || null);
    }
  }

  // ---- status card while a car is on its way / waiting ----
  #card() {
    const el = document.createElement('div');
    el.id = 'ride-card';
    el.innerHTML = `<span class="rc-ic"></span><div class="rc-txt"><b></b><span></span></div><button type="button" class="rc-in" aria-label="Get in">${icon('check')}</button><button type="button" class="rc-ff" aria-label="Skip the wait">${icon('ff')}</button><button type="button" class="rc-x" aria-label="Cancel">${icon('x')}</button>`;
    document.body.appendChild(el);
    this.cardEl = el;
    this.cardIc = el.querySelector('.rc-ic');
    this.cardB = el.querySelector('.rc-txt b');
    this.cardS = el.querySelector('.rc-txt span');
    this.cardIn = el.querySelector('.rc-in');
    this.cardFF = el.querySelector('.rc-ff');
    el.querySelector('.rc-x').addEventListener('click', () => this.cancel(true));
    this.cardFF.addEventListener('click', () => {
      this.ff = this.ff > 1 ? 1 : 6;
      this.cardFF.classList.toggle('on', this.ff > 1);
    });
    this.cardIn.addEventListener('click', () => this.getIn());
  }

  #setCard(ic, title, sub, canIn = false) {
    this.cardIc.innerHTML = icon(ic, 26);
    this.cardB.textContent = title;
    this.cardS.textContent = sub;
    this.cardIn.style.display = canIn ? '' : 'none';
    this.cardFF.style.display = canIn ? 'none' : '';
  }

  // ---- taxi: where to? (after you get in) ----
  #taxiPicker() {
    const p = document.createElement('div');
    p.id = 'taxi-hail-pick';
    p.className = 'izk-pop';
    p.style.display = 'none';
    registerDialog(p);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.a === 'close') {
        p.style.display = 'none';
        this.cancel(true);
        return;
      }
      const d = this.taxiDests && this.taxiDests[Number(b.dataset.i)];
      if (d) this.#rideTaxi(d);
    });
    this.tpEl = p;
  }

  // ---- Hamba Ride app ----
  #app() {
    const p = document.createElement('div');
    p.id = 'hamba-app';
    p.className = 'izk-pop';
    p.style.display = 'none';
    registerDialog(p);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.a;
      if (a === 'close') this.closeApp();
      else if (a === 'map') this.#pickOnMap();
      else if (a === 'go') this.#request();
      else if (a === 'dest') {
        const d = this.appDests && this.appDests[Number(b.dataset.i)];
        if (d) this.#setDest(d);
      }
    });
    this.appEl = p;
  }

  get busy() {
    return this.state !== 'idle';
  }

  // where taxis go from here: areas / landmarks along the main roads
  #places(x, z, max, minD = 900, maxD = 15000) {
    const out = [];
    const seen = new Set();
    for (const p of PLACES) {
      const [px, pz] = p.lon != null ? toXZ(p.lon, p.lat) : [p.x, p.z];
      if (!Number.isFinite(px)) continue;
      const d = Math.hypot(px - x, pz - z);
      if (d < minD || d > maxD || seen.has(p.name)) continue;
      seen.add(p.name);
      out.push({ name: p.name, px, pz, d });
    }
    out.sort((a, b) => a.d - b.d);
    const res = [];
    for (const p of out) {
      if (res.length >= max) break;
      // the drop-off: a shelter near there, else the main road nearest it
      const st = this.#stopNear(p.px, p.pz, 450);
      const nr = st ? null : this.roads.nearestRoad(p.px, p.pz, 450, (r) => r.rank >= 5);
      if (!st && !nr) continue;
      res.push({ name: p.name, x: st ? st.x : nr.x, z: st ? st.z : nr.z, d: p.d, stop: !!st });
    }
    return res;
  }

  #stopNear(x, z, r) {
    const sites = this.shelters && this.shelters.sites;
    if (!sites) return null;
    let best = null;
    let bd = r;
    for (const s of sites) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) return null;
    // the kerb in front of the shelter
    const nr = this.roads.nearestRoad(best.x, best.z, 30);
    return nr ? { x: nr.x, z: nr.z, name: best.name } : null;
  }

  // the road you can wave from (shelter within 30 m, or a car road within 14 m)
  #kerb(x, z) {
    if (this.fares.rankNear(x, z)) return null; // ranks use Board taxi
    const st = this.#stopNear(x, z, 30);
    const nr = st ? this.roads.nearestRoad(st.x, st.z, 30, (r) => r.rank >= 3) : this.roads.nearestRoad(x, z, 14, (r) => r.rank >= 3 && !r.bridge);
    return nr;
  }

  // ---- 1) hail a minibus taxi ----
  hail() {
    const f = this.foot;
    if (!f || this.busy || this.ride.active) return;
    const nr = this.#kerb(f.x, f.z);
    if (!nr) {
      this.hud.toast('Stand at a stop or beside a road to wave down a taxi', 2.4);
      return;
    }
    const path = this.#approachPath(nr, f.x, f.z, 170);
    if (!path) return;
    this.kind = 'taxi';
    this.#start('quantum', path, this.#kerbLane(nr));
    this.#setCard('taxi', 'Taxi coming', 'Wave… a Quantum is pulling over');
    this.hud.toast('Hand up: a taxi is coming', 2);
  }

  // a polyline along the kerb road ending beside the player, driving so the
  // player is on its left (SA drives on the left)
  #approachPath(nr, px, pz, back) {
    const pts = nr.road.pts;
    const n = pts.length;
    const fi = nr.t * (n - 1);
    const i = Math.min(n - 2, Math.floor(fi));
    let dx = nr.dirX;
    let dz = nr.dirZ;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // left of travel is (dz, -dx); player on the left keeps the road direction
    let fwd = (px - nr.x) * dz - (pz - nr.z) * dx >= 0;
    if (nr.road.oneway) fwd = true;
    const line = [[nr.x, nr.z]];
    let acc = 0;
    if (fwd) {
      for (let k = i; k >= 0 && acc < back; k--) {
        const a = line[line.length - 1];
        acc += Math.hypot(pts[k][0] - a[0], pts[k][1] - a[1]);
        line.push([pts[k][0], pts[k][1]]);
      }
    } else {
      for (let k = i + 1; k < n && acc < back; k++) {
        const a = line[line.length - 1];
        acc += Math.hypot(pts[k][0] - a[0], pts[k][1] - a[1]);
        line.push([pts[k][0], pts[k][1]]);
      }
    }
    line.reverse();
    // a short road: start a few metres back so it still rolls in
    if (line.length < 2 || acc < 25) {
      const s = fwd ? 1 : -1;
      line.length = 0;
      line.push([nr.x - dx * s * 40, nr.z - dz * s * 40], [nr.x, nr.z]);
    }
    return this.#poly(line);
  }

  #poly(line) {
    const pts = [];
    for (const p of line) {
      const q = pts[pts.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) pts.push(p);
    }
    if (pts.length < 2) return null;
    const cum = new Float64Array(pts.length);
    for (let k = 1; k < pts.length; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    return { pts, cum, len: cum[pts.length - 1] };
  }

  // how far left of the centre line the car pulls over: at the kerb, not mid-road
  #kerbLane(nr) {
    const w = nr && nr.road && nr.road.width ? nr.road.width : 7;
    return Math.max(1.8, Math.min(w / 2 - 1.15, 5));
  }

  #start(type, path, endLane = null) {
    if (!this.meshes[type]) {
      const m = carMeshClone(type);
      this.meshes[type] = m;
      this.group.add(m);
    }
    for (const k in this.meshes) this.meshes[k].visible = k === type;
    this.mesh = this.meshes[type];
    this.type = type;
    this.mover.set(path, undefined, endLane);
    this.state = 'coming';
    this.stuckT = this.ghostT = 0;
    this.ff = 1;
    this.cardFF.classList.remove('on');
    this.group.visible = true;
    this.cardEl.classList.add('show');
    this.#sync(0);
  }

  cancel(byUser) {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.group.visible = false;
    this.cardEl.classList.remove('show');
    this.tpEl.style.display = 'none';
    if (this.kind === 'ehail') this.drvFrom = null;
    if (byUser) this.hud.toast(this.kind === 'ehail' ? 'Ride cancelled' : 'Taxi drove off', 1.6);
    this.kind = '';
  }

  #arrived() {
    this.state = 'waiting';
    if (this.kind === 'taxi') {
      this.#setCard('taxi', 'Taxi stopped', 'Get in', true);
      this.hud.toast('The taxi pulled over: get in', 2);
    } else {
      this.#setCard('car', `${this.driver} is here`, `${this.plate} · get in`, true);
      this.hud.toast(`Your Hamba Ride is here: ${this.carName}`, 2.4);
    }
  }

  getIn() {
    if (this.state !== 'waiting' || !this.foot) return;
    const m = this.mover;
    if (Math.hypot(this.foot.x - m.x, this.foot.z - m.z) > 16) {
      this.hud.toast('Walk to the car first', 1.6);
      return;
    }
    if (this.kind === 'taxi') this.#openTaxiPicker();
    else this.#rideEhail();
  }

  #openTaxiPicker() {
    const m = this.mover;
    const dests = this.#places(m.x, m.z, 8);
    this.taxiDests = dests;
    let h = `<b style="color:#ffd21a">Where to?</b><div style="opacity:.8;font-size:13px">Pass your fare forward. ${icon('wallet', 14)} ${R(this.w.r)}</div><div class="ride-grid">`;
    let any = false;
    dests.forEach((d, i) => {
      const f = taxiFare(d.d);
      const ok = this.w.r >= f;
      any = any || ok;
      h += `<button type="button" class="pop-btn dim ride-opt" data-i="${i}"${ok ? '' : ' disabled'}><span>${d.name}</span><b>${R(f)}</b></button>`;
    });
    h += '</div>';
    if (!dests.length) h += '<div style="margin-top:8px">This taxi is not going anywhere near here.</div>';
    else if (!any) h += `<div class="ride-msg">Not enough money. A taxi costs R18 to R25 and you have ${R(this.w.r)}.</div>`;
    h += `<button type="button" class="pop-btn dim ride-ic" data-a="close" aria-label="Get out">${icon('x')}</button>`;
    this.tpEl.innerHTML = h;
    this.tpEl.style.display = 'block';
  }

  #rideTaxi(d) {
    const m = this.mover;
    const fare = taxiFare(d.d);
    if (this.w.r < fare) {
      this.hud.toast(`Not enough money. Fare ${R(fare)}, you have ${R(this.w.r)}`, 2.6);
      return;
    }
    const ok = this.ride.board({ x: m.x, z: m.z, yaw: m.yaw, name: 'here' }, { name: d.name, x: d.x, z: d.z }, { fare, type: 'quantum', label: d.name });
    if (!ok) return;
    this.tpEl.style.display = 'none';
    this.#handOff();
  }

  // ---- 2) Hamba Ride ----
  openApp() {
    if (this.ride.active) return;
    if (!this.foot) {
      this.hud.toast('Park and step out to order a ride', 2);
      return;
    }
    if (this.busy) {
      this.hud.toast(this.kind === 'ehail' ? 'Your ride is on its way' : 'Taxi on its way', 1.6);
      return;
    }
    this.appDests = this.#places(this.foot.x, this.foot.z, 6, 700, 20000);
    // a driver near where you are now (kept while you pick, so the ETA holds)
    if (this.drvFrom && Math.hypot(this.drvFrom.x - this.foot.x, this.drvFrom.z - this.foot.z) > 900) this.drvFrom = null;
    this.#renderApp();
    this.appEl.style.display = 'block';
  }

  closeApp() {
    this.appEl.style.display = 'none';
  }

  #renderApp() {
    const q = this.quote;
    let h = `<div class="ha-top"><b>Hamba<span>Ride</span></b><span class="ha-w">${icon('wallet', 16)} ${R(this.w.r)}</span></div>`;
    h += `<div class="ha-lbl">${icon('pin', 16)} ${this.dest ? `<b>${this.dest.name}</b>` : 'Where to?'}</div>`;
    h += `<div class="ride-grid">`;
    (this.appDests || []).forEach((d, i) => {
      h += `<button type="button" class="pop-btn dim ride-opt${this.dest && this.dest.name === d.name ? ' sel' : ''}" data-a="dest" data-i="${i}"><span>${d.name}</span></button>`;
    });
    h += `</div><button type="button" class="pop-btn dim ha-map" data-a="map" aria-label="Pick on the map">${icon('map', 20)} ${icon('pin', 20)}</button>`;
    if (q) {
      const ok = this.w.r >= q.fare;
      h += `<div class="ha-quote"><span>${icon('car', 20)} ${this.carName}</span><span>${(q.len / 1000).toFixed(1)} km</span><b>${R(q.fare)}</b><span>Driver ${Math.max(1, Math.round(q.eta / 60))} min away</span></div>`;
      if (!ok) h += `<div class="ride-msg">Not enough money. This ride is ${R(q.fare)} and you have ${R(this.w.r)}.</div>`;
      h += `<button type="button" class="pop-btn ha-go" data-a="go"${ok ? '' : ' disabled'} aria-label="Request ride">${icon('check', 22)} ${R(q.fare)}</button>`;
    } else if (this.dest) h += '<div class="ride-msg">No road route there. Pick another place.</div>';
    h += `<button type="button" class="pop-btn dim ride-ic" data-a="close" aria-label="Close">${icon('x')}</button>`;
    this.appEl.innerHTML = h;
  }

  #pickOnMap() {
    const bm = this.bigmap;
    if (!bm) return;
    const f = this.foot;
    this.closeApp();
    this.mapOrig = bm.onDestination;
    this.mapPicking = true;
    bm.onDestination = (x, z, name) => {
      this.#endMapPick();
      bm.hide();
      this.#setDest({ name, x, z });
      this.appEl.style.display = 'block';
    };
    bm.show(f.x, f.z, 0);
    const hint = document.getElementById('bigmap-hint');
    if (hint) {
      this.hintOrig = hint.textContent;
      hint.textContent = 'Hamba Ride: tap where you want to go';
    }
  }

  #endMapPick() {
    if (!this.mapPicking) return;
    this.mapPicking = false;
    this.bigmap.onDestination = this.mapOrig;
    const hint = document.getElementById('bigmap-hint');
    if (hint && this.hintOrig) hint.textContent = this.hintOrig;
  }

  #setDest(d) {
    const f = this.foot;
    this.dest = d;
    this.quote = null;
    if (!this.carName) this.#newDriver();
    if (f) {
      const yaw = this.player ? this.player.yaw || 0 : 0;
      const r = this.router.route(f.x, f.z, Math.sin(yaw), Math.cos(yaw), d.x, d.z);
      if (r && r.len > 50) {
        const eta = this.#driverPath(f.x, f.z, true);
        this.quote = { len: r.len, fare: ehailFare(r.len), eta: eta / EH_SPEED };
      }
    }
    this.#renderApp();
  }

  #newDriver() {
    const k = Math.floor(Math.random() * DRIVERS.length);
    this.driver = DRIVERS[k];
    const cars = ['VW Polo Vivo', 'Toyota Etios', 'Suzuki Swift'];
    this.carName = `${cars[k % cars.length]} · ${this.driver}`;
    const L = 'BCDFGHJKLMNPRSTVWXYZ';
    const rl = () => L[Math.floor(Math.random() * L.length)];
    this.plate = `N${rl()}${rl()} ${100 + Math.floor(Math.random() * 899)}`;
  }

  // the driver is somewhere 350-650 m away; returns the drive length (only
  // measures when dry)
  #driverPath(px, pz, dry) {
    const kerb = this.roads.nearestRoad(px, pz, 40, (r) => r.rank >= 2 && !r.bridge) || this.roads.nearestRoad(px, pz, 120, (r) => r.rank >= 2);
    if (!kerb) return 0;
    if (!this.drvFrom) { // same driver for the quote and the request
      const a = Math.random() * Math.PI * 2;
      const d = 350 + Math.random() * 300;
      const nr = this.roads.nearestRoad(px + Math.sin(a) * d, pz + Math.cos(a) * d, 250, (r) => r.rank >= 3);
      this.drvFrom = nr ? { x: nr.x, z: nr.z, yaw: Math.atan2(nr.dirX, nr.dirZ) } : null;
    }
    const s = this.drvFrom;
    // the last stretch runs along your kerb with you on the car's left (SA
    // drives on the left), so the driver stops on your side of the road
    const near = this.#approachPath(kerb, px, pz, 60);
    if (!near) return dry ? 300 : null;
    let route = null;
    if (s) {
      route = this.router.route(s.x, s.z, Math.sin(s.yaw), Math.cos(s.yaw), near.pts[0][0], near.pts[0][1]);
      // arriving against the approach (a U-turn at the join): come in from further back
      if (route && route.pts.length > 1 && this.#against(route.pts, near.pts)) {
        const far = this.#approachPath(kerb, px, pz, 160);
        const r2 = far && this.router.route(s.x, s.z, Math.sin(s.yaw), Math.cos(s.yaw), far.pts[0][0], far.pts[0][1]);
        if (r2 && !this.#against(r2.pts, far.pts)) return dry ? r2.len + far.len : this.#join(r2, far);
      }
    }
    if (dry) return route ? route.len + near.len : 300;
    if (route && route.len > 20 && route.len < 4000) return this.#join(route, near);
    return this.#approachPath(kerb, px, pz, 300);
  }

  #against(a, b) {
    const n = a.length;
    const ax = a[n - 1][0] - a[n - 2][0];
    const az = a[n - 1][1] - a[n - 2][1];
    const bx = b[1][0] - b[0][0];
    const bz = b[1][1] - b[0][1];
    return (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1) < -0.3;
  }

  #join(route, near) {
    return this.#poly(route.pts.concat(near.pts)) || near;
  }

  #request() {
    const q = this.quote;
    const f = this.foot;
    if (!q || !f || !this.dest) return;
    if (this.w.r < q.fare) {
      this.hud.toast(`Not enough money. Ride ${R(q.fare)}, you have ${R(this.w.r)}`, 2.6);
      return;
    }
    const path = this.#driverPath(f.x, f.z, false);
    if (!path) {
      this.hud.toast('No drivers near you right now', 2);
      return;
    }
    this.closeApp();
    this.kind = 'ehail';
    this.ehFare = q.fare;
    const kerb = this.roads.nearestRoad(f.x, f.z, 40, (r) => r.rank >= 2 && !r.bridge);
    this.#start('polo', path, kerb ? this.#kerbLane(kerb) : null);
    this.#setCard('car', `${this.driver} is on the way`, '');
    this.hud.toast(`Hamba Ride: ${this.carName} is coming`, 2.4);
  }

  #rideEhail() {
    const m = this.mover;
    const fare = this.ehFare;
    const d = this.dest;
    const ok = this.ride.board({ x: m.x, z: m.z, yaw: m.yaw, name: 'here' }, { name: d.name, x: d.x, z: d.z }, {
      fare,
      payAtEnd: true,
      type: 'polo',
      label: d.name,
      toast: `${this.driver}: Sawubona! Off to ${d.name}`,
      onEnd: (early, frac) => {
        const pay = early ? Math.min(fare, Math.max(30, Math.round(fare * frac))) : fare;
        this.w.r = Math.max(0, this.w.r - pay);
        this.fares.saveWallet();
        this.fares.showWallet();
        setTimeout(() => this.hud.toast(`Hamba Ride: paid ${R(pay)}. Thanks for riding with ${this.driver}`, 3), 2700);
      }
    });
    if (!ok) return;
    this.dest = null;
    this.quote = null;
    this.carName = '';
    this.drvFrom = null;
    this.#handOff();
  }

  // the ride takes over (taxiRide.js drives from here)
  #handOff() {
    this.state = 'idle';
    this.kind = '';
    this.group.visible = false;
    this.cardEl.classList.remove('show');
    if (this.player && this.player.group) this.player.group.visible = false;
  }

  // ---- per frame (foot = the player when on foot, else null) ----
  update(dt, foot) {
    this.foot = foot;
    if (this.mapPicking && !this.bigmap.open) {
      this.#endMapPick(); // map closed without a pick
      this.appEl.style.display = 'block';
    }
    // the hand button shows where you can wave
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.25;
      const can = !!foot && !this.busy && !this.ride.active && !!this.#kerb(foot.x, foot.z);
      if (can !== this.canHail) {
        this.canHail = can;
        document.body.classList.toggle('can-hail', can);
      }
      document.body.classList.toggle('can-phone', !!foot && !this.ride.active);
    }
    if (this.state === 'idle') return;
    // walked off / got in a car: the ride goes away
    if (!foot || Math.hypot(foot.x - this.mover.x, foot.z - this.mover.z) > 120) {
      this.cancel(true);
      return;
    }
    const m = this.mover;
    if (this.state === 'coming') {
      const sdt = dt * this.ff;
      let tgt = m.target(this.kind === 'taxi' ? 14 : 12);
      // queue behind traffic in the lane (squeeze past a car stuck > 5 s)
      if (this.ghostT > 0) this.ghostT -= dt;
      const gap = this.ghostT > 0 ? 99 : laneGap(this.ride.traffic, m.x, m.z, m.yaw);
      if (gap < 30) tgt = Math.min(tgt, Math.max(0, (gap - 7) * 0.8));
      if (gap < 30 && m.v < 0.3 && !m.done) {
        this.stuckT += dt;
        if (this.stuckT > 5) {
          this.ghostT = 3;
          this.stuckT = 0;
        }
      } else this.stuckT = 0;
      const n = Math.ceil(sdt / 0.05);
      for (let k = 0; k < n; k++) m.step(sdt / n, tgt);
      this.#sync(sdt);
      const left = m.len - m.s;
      const sec = Math.round(left / Math.max(6, m.v || 6) / this.ff);
      if (this.kind === 'ehail') this.cardS.textContent = `${this.plate} · ${left > 60 ? `${Math.max(1, Math.round(sec / 60))} min` : 'arriving'} · ${Math.round(left)} m`;
      else this.cardS.textContent = `${Math.round(left)} m away`;
      if (m.done) this.#arrived();
    }
  }

  #sync(dt) {
    const m = this.mover;
    this.group.position.set(m.x, m.y, m.z);
    this.group.rotation.y = m.yaw;
    if (this.mesh && dt) animateWheels(this.mesh, m.v, 0, dt);
  }
}
