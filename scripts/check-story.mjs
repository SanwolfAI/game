// Story mode checks (part of `npm test`), no browser needed:
//  1. the mission data is complete (ids, chapters, places, speakers,
//     portraits, icons, step kinds, plain-English meanings for isiZulu);
//  2. every mission plays from start to finish through the real engine
//     (src/story/engine.js) with a fake world that does what each step asks;
//  3. fail paths work and retry recovers: time out, too many bumps, losing
//     the taxi, losing the race, too fast, not enough money;
//  4. progress saves and a mission running at "app close" resumes.
import { StoryEngine } from '../src/story/engine.js';
import { MISSIONS, CHAPTERS, CAST, PLACES, ICONS } from '../src/story/missions.js';

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fails++;
    console.error('  FAIL:', msg);
  }
};

// ---------- 1. data ----------
const KINDS = new Set(['scene', 'reach', 'licence', 'follow', 'race', 'spin', 'earn', 'pay', 'car']);
const ids = new Set();
for (const m of MISSIONS) {
  ok(!ids.has(m.id), `duplicate mission id ${m.id}`);
  ids.add(m.id);
  ok(CHAPTERS.some((c) => c.id === m.chapter), `${m.id}: unknown chapter ${m.chapter}`);
  ok(PLACES[m.start], `${m.id}: unknown start place ${m.start}`);
  ok(ICONS.includes(m.icon), `${m.id}: unknown icon ${m.icon}`);
  ok(m.title && m.blurb && m.summary, `${m.id}: title, blurb and summary needed`);
  ok(m.steps.length > 0, `${m.id}: no steps`);
  for (const [i, s] of m.steps.entries()) {
    ok(KINDS.has(s.do), `${m.id} step ${i}: unknown kind ${s.do}`);
    for (const k of ['to', 'from', 'at']) if (s[k]) ok(PLACES[s[k]], `${m.id} step ${i}: unknown place ${s[k]}`);
    if (s.do !== 'scene' && s.do !== 'car') ok(s.text, `${m.id} step ${i}: objective text needed`);
    const lines = (s.lines || []).concat((s.chatter || []).map((c) => [c[1], c[2]]));
    for (const [who, text] of lines) {
      ok(who === 'story' || CAST[who], `${m.id} step ${i}: unknown speaker ${who}`);
      ok(typeof text === 'string' && text.length > 1 && text.length < 160, `${m.id} step ${i}: line length (${text && text.length})`);
    }
  }
}
for (const [k, c] of Object.entries(CAST)) ok(c.name && c.look && c.look.skin && c.look.bg, `cast ${k}: name and look needed`);
for (const [k, p] of Object.entries(PLACES)) ok(p.name && (p.ll || p.xz), `place ${k}: name and ll/xz needed`);
ok(MISSIONS.length >= 12 && MISSIONS.length <= 15, `12-15 missions (got ${MISSIONS.length})`);
ok(CHAPTERS.length === 3, '3 chapters');
// isiZulu words carry their meaning in brackets the first time they appear
const ZULU = ['woza', 'mntanami', 'haibo', 'mfana', 'malume', 'shesha', 'mahala', 'sawubona', 'ngiyabonga', 'kota', 'ayeye', 'hamba', 'baba', 'kasi', 'chakalaka', 'maskandi', 'ngiyakuthanda'];
const all = MISSIONS.flatMap((m) => m.steps.flatMap((s) => (s.lines || []).map((l) => l[1]).concat((s.chatter || []).map((c) => c[2]))));
for (const w of ZULU) {
  const first = all.find((t) => new RegExp(`\\b${w}\\b`, 'i').test(t));
  if (first) ok(new RegExp(`\\b${w}\\b[^(]{0,14}\\(`, 'i').test(first), `first use of "${w}" should explain it in brackets: "${first}"`);
}
// 13+: nothing about drugs, alcohol, guns or gore
const BAD = /\b(drug|beer|drunk|alcohol|gun|shoot|blood|kill|dead|sex)\w*/i;
for (const t of all) ok(!BAD.test(t), `not for 13+: "${t}"`);
console.log(`data: ${MISSIONS.length} missions, ${CHAPTERS.length} chapters, ${Object.keys(CAST).length} characters, ${all.length} lines`);

// ---------- fake world ----------
function placeXZ(key) {
  const p = PLACES[key];
  if (p.xz) return { x: p.xz[0], z: p.xz[1] };
  return { x: (p.ll[0] - 31.0218) * 96500, z: -(p.ll[1] + 29.8587) * 110574 };
}
function makeWorld() {
  const w = {
    me: { x: 0, z: 0, yaw: 0, kmh: 0, mode: 'car' },
    lic: { learner: false, code10: false, prdp: false },
    money: 5000,
    store: null,
    log: [],
    fails: [],
    completes: [],
    offers: [],
    actors: new Set(),
    payOk: true,
    obj: null,
  };
  const route = (x, z, yaw, tx, tz) => {
    const n = 12;
    const pts = [];
    const cum = [];
    for (let i = 0; i <= n; i++) pts.push([x + ((tx - x) * i) / n, z + ((tz - z) * i) / n]);
    let L = 0;
    for (let i = 0; i <= n; i++) {
      if (i) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(L);
    }
    return { pts, cum, len: L };
  };
  w.ctx = {
    place: (k) => ({ ...placeXZ(k), yaw: 0, name: PLACES[k].name }),
    me: () => w.me,
    paused: () => false,
    licence: () => w.lic,
    guideLicence: () => {},
    money: () => w.money,
    addMoney: (n) => (w.money += n),
    route,
    waypoint: () => {},
    beacon: () => {},
    pax: () => {},
    crowd: () => {},
    actor: (type, r) => {
      const a = {
        x: r.pts[0][0],
        z: r.pts[0][1],
        yaw: 0,
        s: 0,
        len: r.len,
        done: false,
        step(dt, cruise) {
          if (this.done) return;
          this.s = Math.min(r.len, this.s + cruise * dt);
          const t = this.s / r.len;
          this.x = r.pts[0][0] + (r.pts[r.pts.length - 1][0] - r.pts[0][0]) * t;
          this.z = r.pts[0][1] + (r.pts[r.pts.length - 1][1] - r.pts[0][1]) * t;
          if (this.s >= r.len - 0.5) this.done = true;
        },
      };
      w.actors.add(a);
      return a;
    },
    removeActor: (a) => w.actors.delete(a),
    putCar: (x, z, yaw) => Object.assign(w.me, { x, z, yaw, mode: 'car', kmh: 0 }),
    bringCar: () => {},
    giveCar: (type) => w.log.push('car:' + type),
    toast: (t) => w.log.push(t),
    chatter: (who, t) => w.log.push(`${who}: ${t}`),
    ui: {
      offer: (o, yes) => {
        w.offers.push(o.mission.id);
        yes();
      },
      scene: (lines, done) => done(),
      chapter: (ch, done) => {
        w.log.push('chapter ' + ch.id);
        done();
      },
      objective: (o) => (w.obj = o),
      fail: (reason, retry, quit) => w.fails.push({ reason, retry, quit }),
      complete: (info) => w.completes.push(info.mission.id),
      pay: (amount, what, have, cb) => cb(w.payOk),
    },
    store: { get: () => (w.store ? JSON.parse(w.store) : null), set: (s) => (w.store = JSON.stringify(s)) },
  };
  return w;
}

// a player who does exactly what the objective asks
function playStep(eng, w, dt) {
  const r = eng.run;
  const s = r.step;
  const st = r.st;
  const me = w.me;
  switch (s.do) {
    case 'reach':
      Object.assign(me, { x: st.target.x + 3, z: st.target.z, kmh: 0, mode: s.mode === 'car' ? 'car' : me.mode });
      break;
    case 'licence':
      w.lic[s.need] = true;
      if (s.need === 'code10') w.lic.learner = true;
      break;
    case 'earn':
      w.money += 60;
      break;
    case 'spin':
      Object.assign(me, { x: st.target.x, z: st.target.z, kmh: 15, mode: 'car' });
      me.yaw += 0.6;
      break;
    case 'follow':
      if (st.actor) Object.assign(me, { x: st.actor.x - 15, z: st.actor.z, kmh: 40 });
      break;
    case 'race': {
      const g = st.gates[st.g];
      if (st.count <= 0 && g) Object.assign(me, { x: g.x, z: g.z, kmh: 80 });
      break;
    }
  }
  eng.update(dt);
}

function playMission(eng, w, id, { maxT = 4000 } = {}) {
  const before = w.completes.length;
  let t = 0;
  while (w.completes.length === before && t < maxT) {
    if (!eng.run) {
      if (w.fails.length) return false;
      eng.start(id);
      if (!eng.run && w.completes.length === before) return false;
      continue;
    }
    playStep(eng, w, 0.1);
    t += 0.1;
  }
  return w.completes.length > before;
}

// ---------- 2. play the whole story ----------
{
  const w = makeWorld();
  const eng = new StoryEngine(w.ctx);
  const money0 = w.money;
  // stand at the first start marker: the engine offers it
  Object.assign(w.me, placeXZ(MISSIONS[0].start), { mode: 'foot' });
  eng.update(0.1);
  ok(w.offers[0] === MISSIONS[0].id, 'standing at the first marker offers mission 1');
  ok(eng.run && eng.run.m.id === MISSIONS[0].id, 'mission 1 started from the offer');
  for (const m of MISSIONS) {
    const done = playMission(eng, w, m.id);
    ok(done, `${m.id} "${m.title}" plays to the end`);
    ok(eng.isDone(m.id), `${m.id} saved as done`);
  }
  const reward = MISSIONS.reduce((a, m) => a + ((m.reward && m.reward.money) || 0), 0);
  const paid = MISSIONS.flatMap((m) => m.steps).filter((s) => s.do === 'pay').reduce((a, s) => a + s.amount, 0);
  const earned = w.money - money0;
  ok(earned >= reward - paid, `rewards paid out (${earned} >= ${reward - paid})`);
  ok(w.log.filter((l) => l.startsWith('chapter')).length === 3, 'each chapter card shown once');
  ok(w.log.includes('car:gusheshe'), 'the gusheshe is handed over');
  ok(eng.next() === null && eng.progress().pct === 100, 'story complete at 100%');
  ok(w.fails.length === 0, 'no failures on a clean play-through: ' + w.fails.map((f) => f.reason).join('; '));
  console.log(`play-through: ${w.completes.length} missions completed, R${earned} net, ${w.log.length} events`);
  // replay pays nothing
  const m0 = w.money;
  playMission(eng, w, 'c2m1');
  ok(w.money === m0, 'replaying a done mission pays nothing');
}

// ---------- 3. fail paths + retry ----------
function at(id, pre) {
  const w = makeWorld();
  if (pre) pre(w);
  const eng = new StoryEngine(w.ctx);
  eng.jump(id);
  Object.assign(w.lic, { learner: true, code10: true, prdp: true });
  const m = MISSIONS.find((q) => q.id === id);
  Object.assign(w.me, placeXZ(m.start), { mode: 'car', kmh: 0 });
  eng.start(id);
  // through the opening scene / car steps
  while (eng.run && (eng.run.step.do === 'scene' || eng.run.step.do === 'car')) eng.update(0.1);
  return { w, eng };
}
{
  // time out on the timed drive to Tsepo, then retry and make it
  const { w, eng } = at('c1m5');
  ok(eng.run.step.do === 'reach' && eng.run.step.time, 'c1m5 drive is timed');
  Object.assign(w.me, { mode: 'car', kmh: 50 });
  for (let i = 0; i < 6000 && !w.fails.length; i++) eng.update(0.1);
  ok(w.fails.length === 1 && /Tsepo/.test(w.fails[0].reason), 'running out of time fails: ' + (w.fails[0] && w.fails[0].reason));
  w.fails[0].retry();
  ok(eng.run && eng.run.step.do === 'reach' && eng.run.st.t === 0, 'retry restarts the drive with a fresh timer');
  ok(playMission(eng, w, 'c1m5'), 'c1m5 completes after a retry');
}
{
  // too many bumps with the spice boxes
  const { w, eng } = at('c2m1');
  for (let i = 0; i < 4; i++) {
    eng.onCrash(9);
    eng.update(1.5);
  }
  ok(w.fails.length === 1 && /bumps/i.test(w.fails[0].reason), 'too many bumps fails');
  w.fails[0].quit();
  ok(!eng.run && !eng.isDone('c2m1'), 'quit leaves the mission open');
}
{
  // driving too fast with Nomsa
  const { w, eng } = at('c2m2');
  Object.assign(w.me, { x: -4000, z: -12500, mode: 'car', kmh: 95 });
  for (let i = 0; i < 400 && !w.fails.length; i++) eng.update(0.1);
  ok(w.fails.length === 1 && /fast/i.test(w.fails[0].reason), 'speeding three times fails');
}
{
  // losing the taxi
  const { w, eng } = at('c2m3');
  ok(eng.run.step.do === 'follow' && eng.run.st.actor, 'follow step spawns the taxi');
  for (let i = 0; i < 900 && !w.fails.length; i++) {
    Object.assign(w.me, { x: -9000, z: -9000, kmh: 30 });
    eng.update(0.1);
  }
  ok(w.fails.length === 1 && /lost the taxi/.test(w.fails[0].reason), 'falling far behind loses the taxi');
  w.fails[0].retry();
  ok(eng.run.st.actor && eng.run.st.actor.s === 0, 'retry puts the taxi back at the start');
}
{
  // losing the race
  const { w, eng } = at('c2m5');
  ok(eng.run.step.do === 'race' && eng.run.st.gates.length === 4, 'race has 3 rings + finish');
  for (let i = 0; i < 6000 && !w.fails.length; i++) eng.update(0.1);
  ok(w.fails.length === 1 && /first/.test(w.fails[0].reason), 'the rival finishing first loses the race');
}
{
  // not enough money for the business: come back later
  const { w, eng } = at('c3m4', (q) => (q.money = 1000));
  eng.update(0.1);
  ok(eng.run && eng.run.step.do === 'pay' && eng.run.st.later, 'not enough money: wait and come back');
  ok(/more/.test(w.obj && w.obj.text), 'objective says how much more to earn');
  w.money = 4000;
  Object.assign(w.me, { x: w.me.x + 200 });
  eng.update(0.1);
  Object.assign(w.me, placeXZ('tsepoWash'));
  eng.update(0.1);
  ok(eng.run && eng.run.step.do !== 'pay', 'coming back with the money pays');
  ok(w.money === 1000, 'R3,000 paid');
}
{
  // spin: leaving the ring does not count, the timer fails
  const { w, eng } = at('c2m4');
  const c = placeXZ('magogo');
  Object.assign(w.me, { x: c.x, z: c.z, kmh: 2, mode: 'car' });
  for (let i = 0; i < 1000 && !w.fails.length; i++) eng.update(0.1);
  ok(w.fails.length === 1 && /crowd/.test(w.fails[0].reason), 'standing still in the ring runs out the clock');
}

// ---------- 4. save + resume ----------
{
  const w = makeWorld();
  const eng = new StoryEngine(w.ctx);
  eng.jump('c2m3');
  eng.start('c2m3');
  eng.update(0.1);
  const saved = JSON.parse(w.store);
  ok(saved.active && saved.active.id === 'c2m3', 'running mission is saved');
  ok(saved.done.c1m1 && saved.done.c2m2 && !saved.done.c2m3, 'done list saved');
  // "reopen the app"
  const eng2 = new StoryEngine(w.ctx);
  ok(eng2.s.active && eng2.s.active.id === 'c2m3', 'save loads');
  ok(eng2.resume() && eng2.run && eng2.run.m.id === 'c2m3', 'running mission resumes');
  eng2.reset();
  ok(!JSON.parse(w.store).active && eng2.progress().done === 0, 'reset clears the story');
}

if (fails) {
  console.error(`check-story: ${fails} problem(s)`);
  process.exit(1);
}
console.log('check-story: OK');
