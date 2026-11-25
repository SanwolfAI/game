// Daily reward (7-day calendar, day 7 is the big one) and simple
// achievements, all paid in rand into the same wallet the taxi fares use.
// Research (Unity Learn, psittacus.studio): growing rewards beat flat ones,
// and one missed day should not wipe the streak, so a 1-day gap is forgiven.
import { el, rand } from './prefs.js';
import { haptic } from './haptics.js';

const KEY = 'izk.rewards.v1';
export const DAILY = [100, 150, 200, 300, 400, 500, 1000];

export const ACHIEVEMENTS = [
  { id: 'km1', name: 'First drive', how: 'Drive 1 km', pay: 100 },
  { id: 'km25', name: 'Road trip', how: 'Drive 25 km in total', pay: 500 },
  { id: 'km100', name: 'Long hauler', how: 'Drive 100 km in total', pay: 1500 },
  { id: 'speed', name: 'Need for speed', how: 'Reach 140 km/h', pay: 300 },
  { id: 'clean', name: 'Clean driver', how: 'Drive 5 km in one go with no crash', pay: 400 },
  { id: 'night', name: 'Night rider', how: 'Drive 3 km at night', pay: 300 },
  { id: 'stadium', name: 'Stadium visit', how: 'Drive to Moses Mabhida Stadium', pay: 250 },
  { id: 'beach', name: 'Beach run', how: 'Drive along the beachfront (North Beach)', pay: 250 },
  { id: 'taxi5', name: 'Taxi boss', how: 'Finish 5 taxi fares', pay: 500 },
  { id: 'look', name: 'New look', how: 'Buy paint or rims in the garage', pay: 100 },
  { id: 'week', name: 'Daily driver', how: 'Collect the daily reward 7 days in a row', pay: 500 }
];

function dayKey(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function dayNum(key) {
  const y = Math.floor(key / 10000);
  const m = Math.floor(key / 100) % 100;
  const d = key % 100;
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.v === 1) return s;
  } catch {}
  return { v: 1, last: 0, streak: 0, best: 0, got: {}, km: 0, kmNight: 0, kmClean: 0, maxKmh: 0 };
}

export class Rewards {
  constructor({ wallet, saveWallet, showWallet, toast }) {
    this.s = load();
    this.wallet = wallet;
    this.saveWallet = saveWallet;
    this.showWallet = showWallet;
    this.toast = toast;
    this.dirty = 0;
    this.banner = el('div', 'izk-banner');
    document.body.appendChild(this.banner);
    this.queue = [];
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {}
  }

  pay(n) {
    if (!this.wallet) return;
    this.wallet.r = (this.wallet.r || 0) + n;
    this.saveWallet?.();
    this.showWallet?.();
  }

  // ---- daily ----
  dailyState() {
    const today = dayKey();
    if (this.s.last === today) return { ready: false, day: this.s.streak, today };
    const gap = this.s.last ? dayNum(today) - dayNum(this.s.last) : 99;
    const streak = gap <= 2 ? this.s.streak : 0; // one missed day is forgiven
    const day = (streak % 7) + 1;
    return { ready: true, day, amount: DAILY[day - 1], streak, today };
  }

  claimDaily() {
    const d = this.dailyState();
    if (!d.ready) return 0;
    this.s.last = d.today;
    this.s.streak = d.streak + 1;
    this.s.best = Math.max(this.s.best || 0, this.s.streak);
    this.save();
    this.pay(d.amount);
    haptic.reward();
    if (this.s.streak >= 7) this.unlock('week');
    return d.amount;
  }

  // ---- achievements ----
  has(id) {
    return !!this.s.got[id];
  }

  unlock(id) {
    if (this.s.got[id]) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.s.got[id] = Date.now();
    this.save();
    this.pay(a.pay);
    this.queue.push(a);
    if (this.queue.length === 1) this.#showNext();
  }

  #showNext() {
    const a = this.queue[0];
    if (!a) return;
    haptic.reward();
    this.banner.innerHTML = `<b>★ ${a.name}</b><span>${a.how} · +${rand(a.pay)}</span>`;
    this.banner.classList.add('show');
    setTimeout(() => {
      this.banner.classList.remove('show');
      setTimeout(() => {
        this.queue.shift();
        this.#showNext();
      }, 450);
    }, 3200);
  }

  // called every frame from the input hook; only adds numbers
  track(dt, { driving, speed, night, x, z, trips }) {
    const s = this.s;
    if (driving) {
      const km = (Math.abs(speed) * dt) / 1000;
      s.km += km;
      s.kmClean += km;
      if (night) s.kmNight += km;
      const kmh = Math.abs(speed) * 3.6;
      if (kmh > s.maxKmh) s.maxKmh = kmh;
      this.dirty += dt;
    }
    this._t = (this._t || 0) + dt;
    if (this._t < 0.5) return; // checks twice a second
    this._t = 0;
    if (s.km >= 1) this.unlock('km1');
    if (s.km >= 25) this.unlock('km25');
    if (s.km >= 100) this.unlock('km100');
    if (s.maxKmh >= 140) this.unlock('speed');
    if (s.kmClean >= 5) this.unlock('clean');
    if (s.kmNight >= 3) this.unlock('night');
    if (trips >= 5) this.unlock('taxi5');
    if (driving && this.places) {
      for (const p of this.places) {
        if (!this.has(p.id) && Math.hypot(x - p.x, z - p.z) < p.r) this.unlock(p.id);
      }
    }
    if (this.dirty > 10) {
      this.dirty = 0;
      this.save();
    }
  }

  crashed() {
    this.s.kmClean = 0;
  }
}

// ---- the rewards screen (daily calendar + achievement list) ----
export function rewardsScreen(rw, onClose) {
  const root = el('div', 'izk-screen izk-rewards');
  root.style.display = 'none';
  document.body.appendChild(root);
  const render = () => {
    const d = rw.dailyState();
    const cur = d.ready ? d.day : ((d.day - 1) % 7) + 1;
    let cal = '';
    for (let i = 1; i <= 7; i++) {
      const done = d.ready ? i < cur : i <= cur;
      const now = d.ready && i === cur;
      cal += `<div class="izk-day${done ? ' done' : ''}${now ? ' now' : ''}${i === 7 ? ' big' : ''}"><small>Day ${i}</small><b>${rand(DAILY[i - 1])}</b>${done ? '<i>✓</i>' : ''}</div>`;
    }
    let ach = '';
    let n = 0;
    for (const a of ACHIEVEMENTS) {
      const got = rw.has(a.id);
      if (got) n++;
      ach += `<div class="izk-ach${got ? ' got' : ''}"><span class="izk-ach-ico">${got ? '★' : '☆'}</span><div><b>${a.name}</b><small>${a.how}</small></div><em>${rand(a.pay)}</em></div>`;
    }
    root.innerHTML = `<div class="izk-card wide">
      <div class="izk-ghead"><b>Rewards</b><span>${n} / ${ACHIEVEMENTS.length} done</span></div>
      <div class="izk-gsub">Come back every day. Day 7 pays the most.</div>
      <div class="izk-cal">${cal}</div>
      <div class="izk-grow">${d.ready ? `<button class="izk-btn izk-claim">Collect ${rand(d.amount)}</button>` : '<button class="izk-btn" disabled>Collected today. Come back tomorrow</button>'}</div>
      <div class="izk-stats">Driven: ${rw.s.km.toFixed(1)} km · Top speed: ${Math.round(rw.s.maxKmh)} km/h</div>
      <div class="izk-achs">${ach}</div>
      <div class="izk-grow"><button class="izk-btn ghost izk-rclose">Close</button></div>
    </div>`;
    root.querySelector('.izk-claim')?.addEventListener('click', () => {
      const got = rw.claimDaily();
      if (got) rw.toast?.(`+${rand(got)} daily reward`, 2);
      render();
    });
    root.querySelector('.izk-rclose').addEventListener('click', () => {
      haptic.tap();
      root.style.display = 'none';
      onClose?.();
    });
  };
  return {
    root,
    open() {
      render();
      root.style.display = '';
    },
    get isOpen() {
      return root.style.display !== 'none';
    }
  };
}
