import * as THREE from '../../vendor/three/three.module.js';
import { registerDialog } from '../ui/dialogs.js';
import { playerCarModel, animateWheels } from './carModels.js';
import { buildVehicleMesh } from './models.js';

// Riding a minibus taxi as a passenger (Bheko, 20 Nov 2026: "too much
// walking"). At a rank (or a north-corridor stop) ACTION "Board taxi" lists
// that rank's routes (fares.js ROUTES) with the fare. Pay from the wallet,
// get in, and a real Quantum drives the route on the road graph (router.js)
// while you sit behind it or inside. Fast-forward x4 is on by default (game
// time runs x4 too); the ride bar toggles x1/x4, switches the view and lets
// you get off early. You are dropped at the chosen stop on the kerb.
// The taxi is moved along the routed road path (not by the car physics), in
// the left lane, slowing for corners and for traffic ahead of it.

const R = (n) => `R${Math.round(n).toLocaleString('en-ZA')}`;
const CRUISE = 13.9; // m/s (50 km/h) through town
const FAST = 20; // m/s (72 km/h) on long straights
const ACC = 2.2;
const DEC = 3.6;
const LANE = 1.8; // m left of the centre line (SA drives on the left)

// Moves something along a routed polyline: speed limits from the corners
// ahead, a smooth lane offset and heading. No allocation per step.
export class PathMover {
  constructor(roads) {
    this.roads = roads;
    this.pts = null;
    this.x = 0;
    this.z = 0;
    this.y = null;
    this.yaw = 0;
    this.v = 0;
    this.s = 0;
    this.i = 0;
    this.ox = 0;
    this.oz = 0;
    this.done = false;
  }

  // endLane (rides.js): pull over to this offset from the centre line over the
  // last 25 m (the kerb), instead of easing towards the middle
  set(route, lane = LANE, endLane = null) {
    const pts = route.pts;
    this.endLane = endLane;
    this.pts = pts;
    this.cum = route.cum;
    this.len = route.len;
    this.lane = lane;
    this.s = 0;
    this.i = 0;
    this.v = 0;
    this.done = false;
    this.y = null;
    // corner speed at every vertex from the heading change over ~10 m
    const n = pts.length;
    const lim = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let a = i;
      let b = i;
      while (a > 0 && this.cum[i] - this.cum[a] < 10) a--;
      while (b < n - 1 && this.cum[b] - this.cum[i] < 10) b++;
      if (a === i || b === i) {
        lim[i] = 99;
        continue;
      }
      const h1 = Math.atan2(pts[i][0] - pts[a][0], pts[i][1] - pts[a][1]);
      const h2 = Math.atan2(pts[b][0] - pts[i][0], pts[b][1] - pts[i][1]);
      const d = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
      lim[i] = d < 0.25 ? 99 : Math.max(4.2, 15 - d * 9);
    }
    this.lim = lim;
    const p0 = pts[0];
    const p1 = pts[Math.min(1, n - 1)];
    this.yaw = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    // left of travel is (cos yaw, -sin yaw) in this world (x east, z south)
    this.ox = Math.cos(this.yaw) * lane;
    this.oz = -Math.sin(this.yaw) * lane;
    this.#at(0);
  }

  // target speed: cruise, the corners ahead, the end of the route, a cap
  target(cruise, cap = 99) {
    const v = this.v;
    const look = (v * v) / (2 * DEC) + 12;
    let t = Math.min(cruise, cap);
    const cum = this.cum;
    for (let k = this.i + 1; k < cum.length && cum[k] - this.s < look; k++) {
      const d = Math.max(0, cum[k] - this.s - 4);
      const allow = Math.sqrt(this.lim[k] * this.lim[k] + 2 * DEC * d);
      if (allow < t) t = allow;
    }
    const left = this.len - this.s;
    const stop = Math.sqrt(2 * DEC * Math.max(0, left - 1));
    return stop < t ? stop : t;
  }

  step(dt, target) {
    if (this.done) return;
    if (this.v < target) this.v = Math.min(target, this.v + ACC * dt);
    else this.v = Math.max(target, this.v - DEC * 1.4 * dt);
    this.s += this.v * dt;
    if (this.s >= this.len - 0.6 || (this.len - this.s < 3 && this.v < 0.3)) {
      this.s = Math.min(this.s, this.len);
      this.v = 0;
      this.done = true;
    }
    this.#at(dt);
  }

  #at(dt) {
    const pts = this.pts;
    const cum = this.cum;
    while (this.i < cum.length - 2 && cum[this.i + 1] < this.s) this.i++;
    const i = this.i;
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const segL = cum[Math.min(i + 1, cum.length - 1)] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, (this.s - cum[i]) / segL));
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const hd = Math.atan2(dx, dz);
    // heading and lane offset ease round corners instead of snapping
    let d = hd - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const k = dt ? Math.min(1, dt * (2.5 + this.v * 0.35)) : 1;
    this.yaw += d * k;
    // lane: off the road ends (first/last 8 m) so the car meets the kerb stop
    let lane;
    if (this.endLane == null) lane = this.lane * Math.min(1, Math.min(this.s, this.len - this.s) / 8 + 0.35);
    else {
      const f = Math.min(1, (this.len - this.s) / 25);
      const e = f * f * (3 - 2 * f);
      lane = (this.endLane + (this.lane - this.endLane) * e) * Math.min(1, this.s / 8 + 0.35);
    }
    const wx = Math.cos(hd) * lane;
    const wz = -Math.sin(hd) * lane;
    this.ox += (wx - this.ox) * k;
    this.oz += (wz - this.oz) * k;
    this.x = a[0] + dx * t + this.ox;
    this.z = a[1] + dz * t + this.oz;
    const surf = this.roads.surfaceAt(this.x, this.z, this.y, null, Math.sin(this.yaw), Math.cos(this.yaw));
    this.y = this.y === null || !dt ? surf.y : this.y + Math.max(-8 * dt, Math.min(8 * dt, surf.y - this.y));
  }
}

// Distance to the nearest traffic car in the lane ahead (2-30 m), else 99.
// Read only; shared with rides.js so hailed cars queue behind traffic too.
export function laneGap(T, x, z, yaw) {
  if (!T || !T.buckets) return 99;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  let best = 99;
  for (const bucket of T.buckets) {
    for (const car of bucket) {
      if (car.px === undefined || car.crash) continue;
      const dx = car.px - x;
      const dz = car.pz - z;
      if (dx > 40 || dx < -40 || dz > 40 || dz < -40) continue;
      const along = dx * fx + dz * fz;
      if (along < 2 || along > 30) continue;
      const side = dx * fz - dz * fx;
      if (side > 2.2 || side < -2.2) continue;
      if (along < best) best = along;
    }
  }
  return best;
}

// a fresh copy of a game car (the shared GLB model is the player's own car)
export function carMeshClone(type) {
  const m = playerCarModel(type);
  if (!m) return buildVehicleMesh(type);
  const wp = m.userData.wheelParts;
  delete m.userData.wheelParts;
  const c = m.clone(true);
  if (wp) m.userData.wheelParts = wp;
  return c;
}

export class TaxiRide {
  constructor({ roads, hf, hud, router, fares, wallet, save, show }) {
    this.roads = roads;
    this.hf = hf;
    this.hud = hud;
    this.router = router;
    this.fares = fares;
    this.w = wallet;
    this.saveWallet = save;
    this.showWallet = show;
    this.mover = new PathMover(roads);
    this.group = new THREE.Group();
    this.group.name = 'taxi-ride';
    this.group.visible = false;
    this.mesh = null;
    this.active = false;
    this.ff = 4;
    this.inside = false;
    this.traffic = null;
    this.stuckT = 0;
    this.ghostT = 0;
    // entity fields (camera, HUD, traffic read these)
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.yaw = 0;
    this.speed = 0;
    this.lateral = 0;
    this.knockX = 0;
    this.knockZ = 0;
    this.spin = 0;
    this.indicator = null;
    this.phys = { mass: 2300 };
    this.surfRoad = null;
    this.onArrive = null; // (x, z, yaw, name, early) main puts the player on the kerb
    this.#picker();
    this.#bar();
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get forward() {
    return [Math.sin(this.yaw), Math.cos(this.yaw)];
  }

  fare(from, to) {
    const km = Math.hypot(to.x - from.x, to.z - from.z) / 1000;
    return Math.round(Math.min(35, Math.max(15, 10 + km * 1.1)));
  }

  // ---- route picker (a popup in the top layer) ----
  #picker() {
    const p = document.createElement('div');
    p.id = 'taxi-pick';
    p.className = 'izk-pop';
    p.style.display = 'none';
    registerDialog(p);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.a === 'close') return this.closePicker();
      const r = this.routes && this.routes[Number(b.dataset.i)];
      if (r) this.board(this.from, r);
    });
    this.pickEl = p;
  }

  open(from) {
    const routes = this.fares.passengerRoutes(from);
    this.from = from;
    this.routes = routes;
    const nm = from.name.replace(/ Taxi Rank.*$/, '');
    let h = `<b style="color:#ffd21a">${nm}${from.stop ? '' : ' rank'}</b><div style="opacity:.75;font-size:13px">Where to? Pay the driver, sit back. Wallet ${R(this.w.r)}</div><div class="ride-grid">`;
    routes.forEach((r, i) => {
      const f = this.fare(from, r);
      const ok = this.w.r >= f;
      h += `<button type="button" class="pop-btn dim ride-opt" data-i="${i}"${ok ? '' : ' disabled'}><span>${r.name.replace(/ Taxi Rank.*$/, '')}</span><b>${R(f)}</b></button>`;
    });
    if (!routes.length) h += '<div style="margin-top:8px">No taxis load here right now.</div>';
    h += `</div><button type="button" class="pop-btn dim" data-a="close">Not now</button>`;
    this.pickEl.innerHTML = h;
    this.pickEl.style.display = 'block';
  }

  closePicker() {
    this.pickEl.style.display = 'none';
  }

  get pickerOpen() {
    return this.pickEl.style.display === 'block';
  }

  // ---- the ride bar: x1/x4, view, get off ----
  #bar() {
    const el = document.createElement('div');
    el.id = 'ride-bar';
    el.innerHTML = '<div id="ride-info"><b id="ride-to">—</b><span id="ride-eta"></span></div><button type="button" id="ride-ff">x4</button><button type="button" id="ride-view">VIEW</button><button type="button" id="ride-off">GET OFF</button>';
    document.body.appendChild(el);
    this.barEl = el;
    this.toEl = el.querySelector('#ride-to');
    this.etaEl = el.querySelector('#ride-eta');
    this.ffEl = el.querySelector('#ride-ff');
    el.querySelector('#ride-ff').addEventListener('click', () => this.toggleFF());
    el.querySelector('#ride-view').addEventListener('click', () => {
      this.inside = !this.inside;
    });
    // inside view: a simple windscreen frame (headliner, pillars, dash) in CSS
    const cab = document.createElement('div');
    cab.id = 'ride-cabin';
    cab.innerHTML = '<i class="rc-top"></i><i class="rc-l"></i><i class="rc-r"></i><i class="rc-dash"></i>';
    const app = document.getElementById('app');
    if (app) app.after(cab); // above the 3D view, under the HUD
    else document.body.appendChild(cab);
    this.cabEl = cab;
    el.querySelector('#ride-off').addEventListener('click', () => this.getOff());
  }

  toggleFF() {
    this.ff = this.ff === 4 ? 1 : 4;
    this.ffEl.textContent = this.ff === 4 ? 'x4' : 'x1';
    this.ffEl.classList.toggle('on', this.ff === 4);
  }

  // opt (rides.js: hailed taxis and Hamba Ride): { fare, type, label, toast,
  // payAtEnd, onEnd(early, fractionDone) }
  board(from, to, opt = {}) {
    const fare = opt.fare ?? this.fare(from, to);
    if (this.w.r < fare) {
      this.hud.toast(`Not enough money. Fare ${R(fare)}, you have ${R(this.w.r)}`, 2.5);
      return false;
    }
    // the road path from the rank bay to the stop
    const yaw0 = from.yaw ?? 0;
    const route = this.router.route(from.x, from.z, Math.sin(yaw0), Math.cos(yaw0), to.x, to.z);
    if (!route || route.pts.length < 2) {
      this.hud.toast('No taxi on that route right now', 2.5);
      return false;
    }
    if (!opt.payAtEnd) {
      this.w.r -= fare;
      this.saveWallet();
      this.showWallet();
    }
    this.closePicker();
    const type = opt.type || 'quantum';
    if (!this.meshes) this.meshes = {};
    if (!this.meshes[type]) {
      this.meshes[type] = carMeshClone(type);
      this.group.add(this.meshes[type]);
    }
    for (const k in this.meshes) this.meshes[k].visible = k === type;
    this.mesh = this.meshes[type];
    this.onEnd = opt.onEnd || null;
    this.mover.set(route);
    this.to = to;
    this.active = true;
    this.group.visible = true;
    this.stuckT = this.ghostT = 0;
    this.toEl.textContent = opt.label || to.name.replace(/ Taxi Rank.*$/, '');
    this.ffEl.textContent = this.ff === 4 ? 'x4' : 'x1';
    this.ffEl.classList.toggle('on', this.ff === 4);
    this.etaT = 0;
    this.#sync(0);
    this.hud.toast(opt.toast || `Paid ${R(fare)}. Off to ${this.toEl.textContent}`, 2.5);
    return true;
  }

  getOff() {
    if (!this.active) return;
    this.#finish(true);
  }

  #finish(early) {
    const m = this.mover;
    this.active = false;
    this.group.visible = false;
    this.speed = 0;
    this.cabShown = false;
    document.body.classList.remove('ride-inside');
    const end = this.onEnd;
    this.onEnd = null;
    end?.(early, m.len ? m.s / m.len : 1);
    // step out on the kerb side (left)
    const lx = Math.cos(m.yaw);
    const lz = -Math.sin(m.yaw);
    this.onArrive?.(m.x + lx * 2.6, m.z + lz * 2.6, m.yaw, this.to ? this.to.name : '', early);
  }

  // anything in the lane ahead? (traffic cars, read only)
  #trafficAhead() {
    if (this.ghostT > 0) return 99;
    return laneGap(this.traffic, this.x, this.z, this.yaw);
  }

  update(dt) {
    if (!this.active) return false;
    const m = this.mover;
    const sdt = dt * this.ff;
    // corners, the stop, and a car in front (follow it with a gap)
    let tgt = m.target(m.len - m.s > 600 ? FAST : CRUISE);
    const gap = this.#trafficAhead();
    if (gap < 30) tgt = Math.min(tgt, Math.max(0, (gap - 7) * 0.8));
    if (this.ghostT > 0) this.ghostT -= dt;
    if (m.v < 0.3 && gap < 30 && !m.done) {
      this.stuckT += dt;
      if (this.stuckT > 5) {
        this.ghostT = 3; // a stalled car: squeeze past
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
    // fixed small steps so x4 stays smooth
    const n = Math.ceil(sdt / 0.05);
    for (let k = 0; k < n; k++) m.step(sdt / n, tgt);
    this.#sync(sdt);
    this.etaT -= dt;
    if (this.etaT <= 0) {
      this.etaT = 0.5;
      const left = m.len - m.s;
      const sec = left / Math.max(14, m.v || 14) / this.ff; // ~50 km/h average
      this.etaEl.textContent = left > 1000 ? `${(left / 1000).toFixed(1)} km · ${Math.max(1, Math.round(sec / 60))} min` : `${Math.round(left)} m`;
    }
    if (m.done) {
      this.#finish(false);
      return true;
    }
    return false;
  }

  #sync(dt) {
    const m = this.mover;
    const inCab = this.active && this.inside;
    if (inCab !== this.cabShown) {
      this.cabShown = inCab;
      document.body.classList.toggle('ride-inside', inCab);
    }
    this.x = m.x;
    this.z = m.z;
    this.y = m.y;
    this.yaw = m.yaw;
    this.speed = m.v * this.ff;
    this.lateral = this.knockX = this.knockZ = this.spin = 0; // traffic may write these; the path wins
    this.group.position.set(m.x, m.y, m.z);
    this.group.rotation.y = m.yaw;
    if (this.mesh && dt) animateWheels(this.mesh, m.v, 0, dt);
  }
}
