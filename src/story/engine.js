// Story engine: plays the missions in missions.js. Pure logic: no THREE, no
// DOM. Everything it touches in the game goes through `ctx` (story.js builds
// the real one; scripts/check-story.mjs builds a fake one and plays every
// mission headlessly). Progress is saved through ctx.store (localStorage
// 'izk.story.v1' in the game).
//
// ctx = {
//   place(key) -> { x, z, yaw, name }          resolved mission places
//   me() -> { x, z, yaw, kmh, mode }            mode: 'car'|'foot'|'bike'|'ride'
//   paused() -> bool                            a popup is open
//   licence() -> { learner, code10, prdp }
//   guideLicence(need)                          GPS to a school / testing ground
//   money() / addMoney(n)
//   route(x, z, yaw, tx, tz) -> { pts, cum, len } | null
//   waypoint(p | null), beacon(p | null, kind), pax(p | null), crowd(p | null)
//   actor(type, route, opts) -> { x, z, yaw, s, len, done, step(dt, cruise) }
//   removeActor(a)
//   putCar(x, z, yaw)   car there, player in the driver's seat
//   bringCar(x, z, yaw) car parked there (player stays on foot)
//   giveCar(type, p)    hand over / park a car type at a place
//   toast(text, s), chatter(who, text)
//   ui: { offer, scene, chapter, objective, fail, complete, pay }
//   store: { get() -> object | null, set(object) }
// }

import { MISSIONS, CHAPTERS, STORY_VERSION } from './missions.js';

const START_R = 14; // m from a mission start marker to offer it
const LATER_R = 40; // "Later" holds the offer until you are this far away
const REACH_R = 24;
const STOP_KMH = 12;
const BUMP_MIN = 6; // impact that counts as a bump
const SPIN_R = 34;
const GATE_R = 20;
const CAR_MODES = { car: 1 };

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class StoryEngine {
  constructor(ctx, { missions = MISSIONS, chapters = CHAPTERS } = {}) {
    this.ctx = ctx;
    this.missions = missions;
    this.chapters = chapters;
    this.byId = new Map(missions.map((m) => [m.id, m]));
    this.listeners = new Map();
    this.run = null;
    this.laterId = null;
    this.offerOpen = false;
    this.s = this.#fresh();
    this.load();
  }

  #fresh() {
    return { v: STORY_VERSION, done: {}, seen: {}, active: null, earned: 0 };
  }

  load() {
    let s = null;
    try {
      s = this.ctx.store.get();
    } catch {}
    if (s && s.v === STORY_VERSION && s.done && typeof s.done === 'object') this.s = { ...this.#fresh(), ...s };
    else this.s = this.#fresh();
  }

  save() {
    try {
      this.ctx.store.set(this.s);
    } catch {}
  }

  reset() {
    this.#cleanup();
    this.run = null;
    this.s = this.#fresh();
    this.save();
    this.ctx.ui.objective(null);
    this.#emit('reset', {});
  }

  // ---------------- events (for other agents: window.__izk.story.on) -----
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, []);
    this.listeners.get(evt).push(fn);
    return () => {
      const l = this.listeners.get(evt);
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    };
  }

  #emit(evt, data) {
    for (const fn of this.listeners.get(evt) || []) {
      try {
        fn(data);
      } catch (e) {
        console.warn('[IZK story] listener', e);
      }
    }
  }

  // ---------------- queries ----------------
  chapter(id) {
    return this.chapters.find((c) => c.id === id) || this.chapters[0];
  }

  // "2.3" style number of a mission inside its chapter
  label(m) {
    const ch = this.chapter(m.chapter);
    const k = this.missions.filter((q) => q.chapter === m.chapter).indexOf(m) + 1;
    return `${ch.n}.${k}`;
  }

  isDone(id) {
    return !!this.s.done[id];
  }

  // the next mission in the story (missions unlock one after the other)
  next() {
    return this.missions.find((m) => !this.s.done[m.id]) || null;
  }

  status(m) {
    if (this.run && this.run.m === m) return 'active';
    if (this.s.done[m.id]) return 'done';
    return this.next() === m ? 'next' : 'locked';
  }

  progress() {
    const n = this.missions.filter((m) => this.s.done[m.id]).length;
    return { done: n, total: this.missions.length, pct: Math.round((n / this.missions.length) * 100) };
  }

  // a plain summary for other agents and the test script
  state() {
    const r = this.run;
    return {
      done: Object.keys(this.s.done),
      next: this.next()?.id || null,
      active: r ? { id: r.m.id, step: r.i, kind: r.step?.do || null, replay: r.replay, waiting: !!r.wait } : null,
      progress: this.progress(),
      earned: this.s.earned,
    };
  }

  // ---------------- control ----------------
  // resume a mission that was running when the game closed
  resume() {
    const a = this.s.active;
    if (!a || this.run) return false;
    const m = this.byId.get(a.id);
    if (!m) {
      this.s.active = null;
      this.save();
      return false;
    }
    this.#begin(m, { replay: !!a.replay, at: Math.min(a.i || 0, m.steps.length - 1), resumed: true });
    return true;
  }

  start(id, { replay } = {}) {
    const m = this.byId.get(id);
    if (!m) return false;
    if (this.run) this.quit(true);
    const st = this.status(m);
    if (st === 'locked') return false;
    const rep = replay ?? st === 'done';
    const ch = this.chapter(m.chapter);
    if (!this.s.seen[ch.id]) {
      this.s.seen[ch.id] = 1;
      this.save();
      this.#emit('chapter', { id: ch.id });
      this.ctx.ui.chapter(ch, () => this.#begin(m, { replay: rep, at: 0 }));
      return true;
    }
    this.#begin(m, { replay: rep, at: 0 });
    return true;
  }

  // skip ahead (tests, other agents): everything before `id` counts as done
  jump(id) {
    const idx = this.missions.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    if (this.run) this.quit(true);
    for (let i = 0; i < idx; i++) this.s.done[this.missions[i].id] = this.s.done[this.missions[i].id] || { t: Date.now(), skipped: true };
    for (let i = idx; i < this.missions.length; i++) delete this.s.done[this.missions[i].id];
    for (const c of this.chapters) if (this.missions.findIndex((m) => m.chapter === c.id) < idx) this.s.seen[c.id] = 1;
    this.save();
    return true;
  }

  quit(silent) {
    if (!this.run) return;
    const m = this.run.m;
    this.#cleanup();
    this.run = null;
    this.s.active = null;
    this.save();
    this.ctx.ui.objective(null);
    if (!silent) this.ctx.toast(`Mission stopped: ${m.title}. Start it again at the marker.`, 3);
    this.#emit('quit', { id: m.id });
  }

  #begin(m, { replay, at, resumed }) {
    this.#cleanup();
    this.run = { m, replay, i: -1, step: null, st: null, wait: false };
    this.laterId = null;
    this.s.active = { id: m.id, i: at, replay: !!replay };
    this.save();
    this.#emit('start', { id: m.id, replay, resumed: !!resumed });
    // car missions: if you came on foot, your car is parked at the start
    const me = this.ctx.me();
    if (m.car && me.mode !== 'car' && me.mode !== 'ride') {
      const p = this.ctx.place(m.start);
      this.ctx.bringCar(p.x, p.z, p.yaw);
      this.ctx.toast('Your car is parked right here. Get in to go.', 3);
    }
    this.#enter(at);
  }

  // ---------------- steps ----------------
  #enter(i) {
    const r = this.run;
    if (!r) return;
    this.#cleanStep();
    if (i >= r.m.steps.length) return this.#complete();
    const step = r.m.steps[i];
    r.i = i;
    r.step = step;
    r.wait = false;
    const me = this.ctx.me();
    const st = (r.st = { t: 0, bumps: 0, bumpCd: 0, strikes: 0, over: 0, said: 0, start: { x: me.x, z: me.z, yaw: me.yaw }, hold: 0 });
    // checkpoint: scenes and instant steps replay from here after a reload
    this.s.active = { id: r.m.id, i, replay: !!r.replay };
    this.save();
    this.#emit('step', { id: r.m.id, step: i, kind: step.do });
    const ctx = this.ctx;
    switch (step.do) {
      case 'scene':
        r.wait = true;
        ctx.ui.objective(null);
        ctx.ui.scene(step.lines, () => {
          if (this.run === r && r.i === i) this.#advance();
        });
        return;
      case 'car': {
        const p = ctx.place(step.at);
        ctx.giveCar(step.type, p);
        return this.#advance();
      }
      case 'reach': {
        st.target = ctx.place(step.to);
        st.r = step.r || REACH_R;
        st.d0 = Math.max(st.r + 1, dist(me, st.target));
        ctx.waypoint(st.target);
        ctx.beacon(st.target, step.pax ? 'pax' : 'goal');
        if (step.pax) ctx.pax(st.target);
        break;
      }
      case 'licence':
        if (ctx.licence()[step.need]) {
          ctx.toast(step.need === 'learner' ? "You already have your learner's licence" : step.need === 'code10' ? 'You already have your Code 10 licence' : 'You already have your PrDP', 2.5);
          return this.#advance();
        }
        ctx.guideLicence(step.need);
        break;
      case 'earn':
        st.base = ctx.money();
        st.last = st.base;
        st.got = 0;
        ctx.waypoint(null);
        break;
      case 'pay':
        st.target = ctx.place(r.m.start);
        this.#askPay();
        break;
      case 'spin':
        st.target = ctx.place(step.at);
        st.spun = 0;
        st.lastYaw = null;
        st.inRing = false;
        ctx.waypoint(st.target);
        ctx.beacon(st.target, 'ring');
        ctx.crowd(st.target);
        break;
      case 'follow':
      case 'race':
        this.#setupChase(step, st);
        break;
      default:
        console.warn('[IZK story] unknown step', step.do);
        return this.#advance();
    }
    this.#objective();
  }

  #setupChase(step, st) {
    const ctx = this.ctx;
    const a = ctx.place(step.from);
    const b = ctx.place(step.to);
    const route = ctx.route(a.x, a.z, a.yaw, b.x, b.z);
    st.target = b;
    if (!route || route.len < 50) {
      // no road path: fall back to a plain timed drive
      st.noRoute = true;
      st.r = REACH_R;
      st.d0 = dist(ctx.me(), b);
      ctx.waypoint(b);
      ctx.beacon(b, 'goal');
      return;
    }
    st.route = route;
    st.actor = ctx.actor(step.car || 'quantum', route, { rival: step.do === 'race' });
    // the player's car starts behind (follow) or beside (race) the actor
    const p0 = route.pts[0];
    const p1 = route.pts[Math.min(route.pts.length - 1, 3)];
    const yaw = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    if (step.do === 'follow') ctx.putCar(p0[0] - fx * 22 + lx * 1.8, p0[1] - fz * 22 + lz * 1.8, yaw);
    else ctx.putCar(p0[0] - lx * 1.9, p0[1] - lz * 1.9, yaw);
    st.count = step.do === 'race' ? 3.5 : 1.5;
    st.lostT = 0;
    if (step.do === 'race') {
      const n = Math.max(1, step.gates || 3);
      st.gates = [];
      for (let k = 1; k <= n; k++) st.gates.push(this.#along(route, (route.len * k) / (n + 1)));
      st.gates.push({ x: b.x, z: b.z, s: route.len, finish: true });
      st.g = 0;
      this.#gateMarks(st);
    } else {
      ctx.waypoint(null);
      ctx.beacon(null);
    }
  }

  #along(route, s) {
    const { pts, cum } = route;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
    return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, z: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, s };
  }

  #gateMarks(st) {
    const g = st.gates[st.g];
    if (!g) return;
    const name = g.finish ? this.run.step.to && this.ctx.place(this.run.step.to).name : `Ring ${st.g + 1} of ${st.gates.length - 1}`;
    this.ctx.waypoint({ x: g.x, z: g.z, name: name || 'Finish' });
    this.ctx.beacon({ x: g.x, z: g.z }, g.finish ? 'finish' : 'gate');
  }

  #askPay() {
    const r = this.run;
    const step = r.step;
    r.wait = true;
    this.ctx.ui.pay(step.amount, step.what, this.ctx.money(), (ok) => {
      if (this.run !== r || r.step !== step) return;
      r.wait = false;
      if (ok && this.ctx.money() >= step.amount) {
        this.ctx.addMoney(-step.amount);
        this.#advance();
      } else {
        // come back with the money: the marker stays here
        r.st.later = true;
        r.st.away = false;
        this.ctx.waypoint(null);
        this.ctx.beacon(r.st.target, 'goal');
        this.#objective();
      }
    });
  }

  #advance() {
    if (!this.run) return;
    this.#enter(this.run.i + 1);
  }

  #cleanStep() {
    const r = this.run;
    if (!r || !r.st) return;
    if (r.st.actor) this.ctx.removeActor(r.st.actor);
    r.st.actor = null;
    this.ctx.pax(null);
    this.ctx.crowd(null);
    this.ctx.beacon(null);
  }

  #cleanup() {
    this.#cleanStep();
    if (this.run) this.ctx.waypoint(null);
    this.ctx.pax(null);
    this.ctx.crowd(null);
    this.ctx.beacon(null);
  }

  // finish the current step at once (tests, other agents)
  skipStep() {
    if (!this.run) return false;
    this.#advance();
    return true;
  }

  #complete() {
    const r = this.run;
    const m = r.m;
    this.#cleanup();
    this.run = null;
    this.s.active = null;
    const first = !this.s.done[m.id] || this.s.done[m.id].skipped;
    const money = first && !r.replay ? (m.reward && m.reward.money) || 0 : 0;
    if (money) {
      this.ctx.addMoney(money);
      this.s.earned = (this.s.earned || 0) + money;
    }
    if (m.reward && m.reward.car && first) this.ctx.giveCar(m.reward.car, null);
    this.s.done[m.id] = { t: Date.now() };
    this.save();
    this.ctx.ui.objective(null);
    const nx = this.next();
    const chapterDone = !this.missions.some((q) => q.chapter === m.chapter && !this.s.done[q.id]);
    this.#emit('complete', { id: m.id, money, replay: !!r.replay });
    this.ctx.ui.complete({ mission: m, label: this.label(m), money, note: m.reward && m.reward.note, chapterDone, chapter: this.chapter(m.chapter), next: nx, finished: !nx }, () => {});
  }

  fail(reason) {
    const r = this.run;
    if (!r || r.failed) return;
    r.failed = true;
    const i = r.i;
    const start = r.st && r.st.start;
    this.#cleanStep();
    this.ctx.ui.objective(null);
    this.#emit('fail', { id: r.m.id, step: i, reason });
    this.ctx.ui.fail(
      reason,
      () => {
        if (this.run !== r) return;
        r.failed = false;
        // back to where this step began, in the car for car steps
        const step = r.m.steps[i];
        if (start && (step.mode === 'car' || r.m.car) && step.do !== 'follow' && step.do !== 'race') this.ctx.putCar(start.x, start.z, start.yaw);
        this.#enter(i);
      },
      () => {
        if (this.run !== r) return;
        r.failed = false;
        this.quit();
      }
    );
  }

  onCrash(impact) {
    const r = this.run;
    if (!r || !r.st || r.wait || r.failed) return;
    const step = r.step;
    if (!step.fragile || impact < BUMP_MIN || r.st.bumpCd > 0) return;
    r.st.bumpCd = 1.2;
    r.st.bumps++;
    const what = step.cargo === 'masala' ? 'The spice boxes' : step.cargo === 'food' ? 'The food' : 'Your passenger';
    if (r.st.bumps > step.fragile) return this.fail(`Too many bumps. ${what} could not take it.`);
    this.ctx.toast(`Careful! Bump ${r.st.bumps} of ${step.fragile}. ${what} felt that.`, 2.4);
  }

  // ---------------- per frame ----------------
  update(dt) {
    const ctx = this.ctx;
    if (ctx.paused()) return;
    const r = this.run;
    if (!r) return this.#watchStart();
    if (r.wait || r.failed) return;
    const st = r.st;
    const step = r.step;
    const me = ctx.me();
    if (st.bumpCd > 0) st.bumpCd -= dt;
    const needCar = step.mode === 'car' || step.do === 'follow' || step.do === 'race' || step.do === 'spin';
    st.noCar = needCar && !CAR_MODES[me.mode];
    if (st.noCar) {
      this.#objective();
      return;
    }
    switch (step.do) {
      case 'reach':
        this.#tickReach(dt, me, step, st);
        break;
      case 'licence':
        if (ctx.licence()[step.need]) this.#advance();
        break;
      case 'earn': {
        const m = ctx.money();
        if (m > st.last) st.got += m - st.last;
        st.last = m;
        if (st.got >= step.amount) this.#advance();
        else this.#objectiveThrottled(dt);
        break;
      }
      case 'pay':
        if (st.later) {
          const d = dist(me, st.target);
          if (d > LATER_R) st.away = true;
          if (st.away && d < START_R + 4) {
            st.later = false;
            this.#askPay();
          }
          this.#objectiveThrottled(dt);
        }
        break;
      case 'spin':
        this.#tickSpin(dt, me, step, st);
        break;
      case 'follow':
      case 'race':
        if (st.noRoute) this.#tickReach(dt, me, { ...step, stop: false, mode: 'car' }, st);
        else if (step.do === 'follow') this.#tickFollow(dt, me, step, st);
        else this.#tickRace(dt, me, step, st);
        break;
    }
  }

  #limit(step, st, me) {
    const t = step.time;
    if (!t) return 0;
    if (t.limit) return t.limit;
    const route = this.ctx.route(st.start.x, st.start.z, st.start.yaw || me.yaw, st.target.x, st.target.z);
    const len = route ? route.len : dist(st.start, st.target) * 1.4;
    return Math.ceil(len / (t.avg || 9) + (t.extra || 30));
  }

  #tickReach(dt, me, step, st) {
    const d = dist(me, st.target);
    if (step.time && st.limit === undefined) st.limit = this.#limit(step, st, me);
    if (st.limit) {
      st.t += dt;
      if (st.t > st.limit) return this.fail(step.do === 'reach' && step.to === 'tsepoWash' ? 'Too late. Tsepo already closed for the day.' : 'Out of time.');
    }
    if (step.maxKmh) {
      if (me.kmh > step.maxKmh + 3) {
        st.over += dt;
        if (st.over > 2.5) {
          st.over = -4; // a short grace before the next strike
          st.strikes++;
          if (st.strikes >= 3) return this.fail('Too fast, three times. Nomsa took a taxi instead.');
          this.ctx.toast(`Too fast! Slow down under ${step.maxKmh} km/h (warning ${st.strikes} of 2)`, 2.6);
        }
      } else if (st.over > 0) st.over = Math.max(0, st.over - dt);
      else if (st.over < 0) st.over = Math.min(0, st.over + dt);
    }
    // little lines from the passenger as you get closer
    if (step.chatter && st.said < step.chatter.length) {
      const frac = 1 - Math.min(1, d / st.d0);
      const c = step.chatter[st.said];
      if (frac >= c[0]) {
        st.said++;
        this.ctx.chatter(c[1], c[2]);
      }
    }
    const modeOk = !step.mode || step.mode === 'any' || (step.mode === 'car' ? me.mode === 'car' : me.mode === 'foot' || me.mode === 'bike');
    if (d < st.r && modeOk && (!step.stop || me.kmh < STOP_KMH)) {
      st.hold += dt;
      if (st.hold > (step.pax || step.cargo ? 1.0 : 0.15)) {
        if (step.pax) this.ctx.toast('They got in. Off you go!', 1.8);
        else if (step.cargo && step.do === 'reach' && !step.fragile) this.ctx.toast('Loaded up!', 1.6);
        return this.#advance();
      }
    } else st.hold = 0;
    if (step.stop && d < st.r && me.kmh >= STOP_KMH) st.slow = true;
    else st.slow = false;
    this.#objectiveThrottled(dt);
  }

  #tickSpin(dt, me, step, st) {
    const d = dist(me, st.target);
    const inRing = d < SPIN_R;
    if (inRing && !st.inRing) this.ctx.toast('In the ring! Turn hard and give gas!', 2);
    st.inRing = inRing;
    if (inRing) {
      st.t += dt;
      if (st.lastYaw !== null && me.kmh > 4) st.spun += Math.abs(wrap(me.yaw - st.lastYaw));
      st.lastYaw = me.yaw;
      const turns = st.spun / (Math.PI * 2);
      if (turns >= step.turns) return this.#advance();
      if (step.time && st.t > step.time) return this.fail("Time's up. The crowd wanted more spins.");
    } else st.lastYaw = null;
    this.#objectiveThrottled(dt);
  }

  #tickFollow(dt, me, step, st) {
    const a = st.actor;
    if (st.count > 0) {
      st.count -= dt;
      a.step(dt, 0);
      this.#objectiveThrottled(dt);
      return;
    }
    const d = Math.hypot(a.x - me.x, a.z - me.z);
    // the taxi slows a little when you fall behind (it is still a taxi)
    const cruise = d > 90 ? Math.min(step.cruise || 12, 6) : step.cruise || 12;
    a.step(dt, cruise);
    if (d > (step.lose || 170)) {
      st.lostT += dt;
      if (st.lostT > 6) return this.fail('You lost the taxi.');
    } else st.lostT = 0;
    if (a.done && d < 70) return this.#advance();
    this.#objectiveThrottled(dt);
  }

  #tickRace(dt, me, step, st) {
    const a = st.actor;
    if (st.count > 0) {
      const before = Math.ceil(st.count);
      st.count -= dt;
      const after = Math.ceil(st.count);
      if (after !== before && after > 0) this.ctx.toast(String(after), 0.8);
      if (st.count <= 0) this.ctx.toast('HAMBA (go)!', 1.2);
      a.step(dt, 0);
      this.#objectiveThrottled(dt);
      return;
    }
    // player progress along the course: rings passed + distance to the next
    const g = st.gates[st.g];
    const dg = Math.hypot(g.x - me.x, g.z - me.z);
    const mine = g.s - dg;
    const lead = mine - a.s;
    // rubber band: a real race, but never hopeless and never a walkover
    const cruise = (step.cruise || 16) * (lead > 120 ? 1.25 : lead > 40 ? 1.1 : lead < -150 ? 0.8 : lead < -60 ? 0.9 : 1);
    a.step(dt, cruise);
    st.pos = lead >= 0 ? 1 : 2;
    if (dg < (g.finish ? 26 : GATE_R)) {
      if (g.finish) return this.#advance();
      st.g++;
      this.ctx.toast(`Ring ${st.g} of ${st.gates.length - 1}!`, 1.2);
      this.#gateMarks(st);
    }
    if (a.done) return this.fail('Skhokho got to uShaka first.');
    this.#objectiveThrottled(dt);
  }

  // ---------------- offers at mission start markers ----------------
  #watchStart() {
    const m = this.next();
    if (!m || this.offerOpen) return;
    const me = this.ctx.me();
    if (me.mode === 'ride') return;
    const p = this.ctx.place(m.start);
    const d = dist(me, p);
    if (this.laterId === m.id) {
      if (d > LATER_R) this.laterId = null;
      return;
    }
    if (d > START_R) return;
    this.offerOpen = true;
    this.ctx.ui.offer(
      { mission: m, label: this.label(m), chapter: this.chapter(m.chapter) },
      () => {
        this.offerOpen = false;
        this.start(m.id);
      },
      () => {
        this.offerOpen = false;
        this.laterId = m.id;
      }
    );
  }

  // ---------------- objective line ----------------
  #objectiveThrottled(dt) {
    const r = this.run;
    r.ot = (r.ot || 0) - dt;
    if (r.ot > 0) return;
    r.ot = 0.2;
    this.#objective();
  }

  #objective() {
    const r = this.run;
    if (!r || !r.step) return;
    const step = r.step;
    const st = r.st;
    const ch = this.chapter(r.m.chapter);
    let text = step.text || '';
    let extra = '';
    let timer = null;
    const me = this.ctx.me();
    if (st.noCar) text = 'Get in your car (ACTION next to it)';
    else if (step.do === 'reach' || st.noRoute) {
      const d = st.target ? dist(me, st.target) : 0;
      extra = d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`;
      if (st.limit) timer = Math.max(0, st.limit - st.t);
      if (step.fragile) extra += ` · bumps ${st.bumps}/${step.fragile}`;
      if (step.maxKmh) extra += ` · max ${step.maxKmh} km/h`;
      if (st.slow) extra += ' · stop here';
    } else if (step.do === 'earn') extra = `R${Math.floor(st.got)} of R${step.amount}`;
    else if (step.do === 'pay') {
      const need = step.amount - this.ctx.money();
      if (st.later) text = need > 0 ? `Earn R${need.toLocaleString('en-ZA')} more, then come back here to pay` : 'Come back to the car wash to pay';
    } else if (step.do === 'spin') {
      const d = dist(me, st.target);
      extra = st.inRing ? `spins ${(st.spun / (Math.PI * 2)).toFixed(1)} of ${step.turns}` : `${Math.round(d)} m to the ring`;
      if (step.time && st.t > 0) timer = Math.max(0, step.time - st.t);
    } else if (step.do === 'follow') {
      if (st.count > 0) extra = 'the taxi is pulling off...';
      else if (st.actor) {
        const d = Math.hypot(st.actor.x - me.x, st.actor.z - me.z);
        extra = `taxi ${Math.round(d)} m ahead`;
        if (st.lostT > 0) extra += ` · LOSING IT ${Math.ceil(6 - st.lostT)}s`;
      }
    } else if (step.do === 'race') {
      if (st.count > 0) extra = `get ready... ${Math.ceil(st.count)}`;
      else extra = `${st.pos === 1 ? '1st' : '2nd'} · ring ${Math.min(st.g + 1, st.gates.length - 1)}/${st.gates.length - 1}`;
    }
    this.ctx.ui.objective({ title: `${this.label(r.m)} ${r.m.title}`, text, extra, timer, color: ch.color, icon: r.m.icon });
  }
}
