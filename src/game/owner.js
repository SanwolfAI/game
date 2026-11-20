import { registerDialog } from '../ui/dialogs.js';
// Taxi work career: driver for a boss first, then your own taxi, then a fleet.
//
// SABC's day with a Durban driver (Cato Manor to town): the owner ("the boss")
// wants R700 to R1,000 a day; the driver keeps what is left over. So:
//  - DRIVER: every fare goes into the day's takings. The first part belongs to
//    the boss (today's target, R700-R1,000). Once the target is met, every rand
//    after that is yours (into the wallet). At 20:00 (or when the day changes)
//    the boss collects. Short of target: the boss takes the lot and is not
//    happy; three short days in a row and you are fired for a day (no
//    takings at all until tomorrow).
//  - Buy your own Quantum (used, plus the association joining fee). Now you
//    are an OWNER-DRIVER: every fare is yours.
//  - Buy more taxis. Each one has a hired driver who pays you a daily target
//    when the day ends (a driver sometimes comes up short).
// State lives in the wallet object (localStorage izk.wallet.v1).

export const OWN_TAXI_PRICE = 150000; // used Quantum
export const ASSOCIATION_FEE = 30000; // joining the rank's taxi association
export const FLEET_TAXI_PRICE = 220000; // each extra taxi with a driver
export const FLEET_MAX = 20;
const SHIFT_END = 20;

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// a stable "random" target per game day, rounded to R50
function targetFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return 700 + (Math.abs(h) % 7) * 50;
}

const R = (n) => `R${Math.round(n).toLocaleString('en-ZA')}`;

export class TaxiCareer {
  constructor(wallet, { save, toast, show }) {
    this.w = wallet;
    this.save = save;
    this.toast = toast;
    this.show = show;
    if (!wallet.career) wallet.career = { role: 'driver', fleet: 0, day: null, target: 0, takings: 0, bossPaid: 0, short: 0, fired: null, ownedSince: null, lifetime: 0 };
    this.c = wallet.career;
    this.#buildPanel();
  }

  get role() {
    return this.c.role;
  }

  // a fare was paid: split it between the boss and the wallet
  earn(amount, now) {
    this.#roll(now);
    const c = this.c;
    c.lifetime += amount;
    if (c.role !== 'driver') {
      this.w.r += amount;
      this.save();
      return { mine: amount, boss: 0 };
    }
    if (c.fired === c.day) {
      this.save();
      return { mine: 0, boss: 0, fired: true };
    }
    const owed = Math.max(0, c.target - c.bossPaid);
    const boss = Math.min(owed, amount);
    const mine = amount - boss;
    c.bossPaid += boss;
    c.takings += amount;
    this.w.r += mine;
    if (owed > 0 && c.bossPaid >= c.target) this.toast(`Target met: ${R(c.target)} for the boss. Every rand from now is yours.`, 4);
    this.save();
    return { mine, boss };
  }

  // called every frame with the game clock: end of shift and new days
  update(now) {
    if (!now) return;
    this.#roll(now);
    const c = this.c;
    if (!c.shiftDone && now.getHours() >= SHIFT_END) this.#endShift(false);
  }

  #roll(now) {
    if (!now) return;
    const key = dayKey(now);
    const c = this.c;
    if (c.day === key) return;
    if (c.day && !c.shiftDone) this.#endShift(true);
    c.day = key;
    c.target = targetFor(key);
    c.takings = 0;
    c.bossPaid = 0;
    c.shiftDone = false;
    if (c.fired === 'next') c.fired = key;
    if (c.role === 'driver' && c.fired !== key) this.toast(`New day. The boss wants ${R(c.target)} today.`, 3.5);
    this.save();
  }

  #endShift(quiet) {
    const c = this.c;
    c.shiftDone = true;
    const msgs = [];
    if (c.role === 'driver' && c.fired !== c.day) {
      if (c.bossPaid >= c.target) {
        c.short = 0;
        msgs.push(`Shift over. The boss got his ${R(c.target)}, you kept the rest.`);
      } else if (c.takings > 0 || c.target > 0) {
        c.short += 1;
        if (c.short >= 3) {
          c.short = 0;
          c.fired = 'next';
          msgs.push(`Short again (${R(c.bossPaid)} of ${R(c.target)}). The boss parks you for a day.`);
        } else {
          msgs.push(`Short: ${R(c.bossPaid)} of ${R(c.target)}. The boss is not happy (${c.short} of 3).`);
        }
      }
    }
    if (c.fleet > 0) {
      // each hired driver pays a target; now and then one comes up short
      let total = 0;
      for (let i = 0; i < c.fleet; i++) {
        const t = targetFor(`${c.day}#${i}`);
        total += Math.random() < 0.15 ? Math.round(t * (0.4 + Math.random() * 0.4)) : t;
      }
      this.w.r += total;
      msgs.push(`Your ${c.fleet} driver${c.fleet > 1 ? 's' : ''} paid in ${R(total)}.`);
    }
    this.save();
    this.show();
    if (msgs.length && !quiet) this.toast(msgs.join(' '), 5);
  }

  buyOwnTaxi() {
    const cost = OWN_TAXI_PRICE + ASSOCIATION_FEE;
    if (this.c.role !== 'driver') return;
    if (this.licence && !this.licence.canTaxi) return this.toast(this.licence.why(), 4);
    if (this.w.r < cost) return this.toast(`You need ${R(cost)} (taxi + association fee)`, 4);
    this.w.r -= cost;
    this.c.role = 'owner';
    this.c.ownedSince = this.c.day;
    this.save();
    this.show();
    this.toast('Your own Quantum. No more boss: every fare is yours now.', 4.5);
    this.#refresh();
  }

  buyFleetTaxi() {
    if (this.c.role === 'driver') return;
    if (this.c.fleet >= FLEET_MAX) return this.toast('The association will not give you more permits.', 3);
    if (this.w.r < FLEET_TAXI_PRICE) return this.toast(`Another taxi costs ${R(FLEET_TAXI_PRICE)} with a driver.`, 3);
    this.w.r -= FLEET_TAXI_PRICE;
    this.c.fleet += 1;
    this.save();
    this.show();
    this.toast(`Taxi ${this.c.fleet + 1} is on the road. Its driver pays you every evening.`, 4);
    this.#refresh();
  }

  // --- panel (tap the wallet) ---
  #buildPanel() {
    const p = document.createElement('div');
    p.id = 'career';
    p.className = 'izk-pop';
    p.style.display = 'none';
    registerDialog(p); // top layer, tappable (it sat in pointer-events:none #hud)
    this.panel = p;
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.a === 'own') this.buyOwnTaxi();
      if (b.dataset.a === 'fleet') this.buyFleetTaxi();
      if (b.dataset.a === 'close') this.toggle(false);
    });
  }

  toggle(on = this.panel.style.display === 'none') {
    this.panel.style.display = on ? 'block' : 'none';
    if (on) this.#refresh();
  }

  #refresh() {
    if (!this.panel || this.panel.style.display === 'none') return;
    const c = this.c;
    let h = '';
    if (c.role === 'driver') {
      h += `<b style="color:#ffd21a">Driver for a boss</b><br>`;
      if (c.fired === c.day) h += 'Parked for today. Back tomorrow.<br>';
      else h += `Boss's target today: ${R(c.target)}<br>Paid to boss: ${R(c.bossPaid)}<br>`;
      h += `<button data-a="own" class="pop-btn">Buy own Quantum ${R(OWN_TAXI_PRICE + ASSOCIATION_FEE)}</button>`;
    } else {
      h += `<b style="color:#ffd21a">Taxi owner</b><br>Your taxi + ${c.fleet} with drivers<br>`;
      if (c.fleet) h += `Drivers pay in each evening (about ${R(c.fleet * 850)})<br>`;
      h += `<button data-a="fleet" class="pop-btn">Buy another taxi ${R(FLEET_TAXI_PRICE)}</button>`;
    }
    h += `<div style="margin-top:6px;opacity:.7">Wallet ${R(this.w.r)} · earned ${R(c.lifetime)}</div>`;
    h += `<button data-a="close" class="pop-btn dim">Close</button>`;
    this.panel.innerHTML = h;
  }
}
