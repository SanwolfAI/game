// Garage: paint and rims for your gusheshe (E30), like the Car Parking
// Multiplayer / Extreme Car Driving garages: pick, see it on the car straight
// away, pay from the wallet, and it stays (saved on the phone).
// Only the player's own gusheshe changes (traffic E30s keep their colours).
import { playerCarModel } from '../../game/carModels.js';
import { el, rand } from './prefs.js';
import { haptic } from './haptics.js';

const KEY = 'izk.garage.v1';

// finish: gloss (clear coat), metal (metallic flake), matte
export const PAINTS = [
  { id: 'red', name: 'Classic red', hex: null, finish: 'gloss', price: 0 }, // the car's own red
  { id: 'white', name: 'Alpine white', hex: '#eef0f2', finish: 'gloss', price: 0 },
  { id: 'black', name: 'Gloss black', hex: '#0b0c0e', finish: 'gloss', price: 0 },
  { id: 'silver', name: 'Silver', hex: '#a9adb3', finish: 'metal', price: 300 },
  { id: 'blue', name: 'Midnight blue', hex: '#16264f', finish: 'metal', price: 400 },
  { id: 'sky', name: 'Sky blue', hex: '#4f9bd8', finish: 'gloss', price: 400 },
  { id: 'green', name: 'Kasi green', hex: '#1f6b3a', finish: 'metal', price: 400 },
  { id: 'orange', name: 'Sunset orange', hex: '#e8641c', finish: 'gloss', price: 450 },
  { id: 'purple', name: 'Royal purple', hex: '#4b2470', finish: 'metal', price: 500 },
  { id: 'yellow', name: 'Mango yellow', hex: '#f2c230', finish: 'gloss', price: 450 },
  { id: 'matte', name: 'Matte black', hex: '#1a1b1d', finish: 'matte', price: 600 },
  { id: 'gold', name: 'Gold', hex: '#b8892f', finish: 'metal', price: 800 }
];

export const RIMS = [
  { id: 'std', name: 'Standard silver', hex: null, metal: null, price: 0 },
  { id: 'black', name: 'Black', hex: '#141517', metal: 0.5, rough: 0.35, price: 400 },
  { id: 'white', name: 'White', hex: '#eceef0', metal: 0.2, rough: 0.3, price: 500 },
  { id: 'gold', name: 'Gold', hex: '#c9a04a', metal: 1, rough: 0.2, price: 900 },
  { id: 'chrome', name: 'Chrome', hex: '#f4f6f8', metal: 1, rough: 0.06, price: 1200 }
];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.paint) return { owned: [], ...s };
  } catch {}
  return { paint: 'red', rims: 'std', owned: [] };
}

let state = load();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
};

const owns = (kind, item) => item.price === 0 || state.owned.includes(kind + ':' + item.id);

// remember each material's first look so "Classic red" / "Standard" go back exactly
function orig(m) {
  if (!m.userData.izkOrig) {
    m.userData.izkOrig = {
      color: m.color.clone(),
      metalness: m.metalness,
      roughness: m.roughness,
      clearcoat: m.clearcoat ?? 0,
      clearcoatRoughness: m.clearcoatRoughness ?? 0
    };
  }
  return m.userData.izkOrig;
}

function mats(root) {
  const paint = new Set();
  const rims = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    let inWheel = false;
    for (let p = o; p; p = p.parent) if (p.name === 'wheelSpin') inWheel = true;
    for (const m of list) {
      const n = (m.name || '').toLowerCase();
      if (n === 'carpaint') paint.add(m);
      else if (inWheel && (n === 'material' || n === 'rim_dark')) rims.add(m);
    }
  });
  return { paint, rims };
}

export function applyLook(paintId = state.paint, rimId = state.rims) {
  const root = playerCarModel('gusheshe');
  if (!root) return false;
  const { paint, rims } = mats(root);
  const p = PAINTS.find((x) => x.id === paintId) || PAINTS[0];
  for (const m of paint) {
    const o = orig(m);
    if (p.hex) m.color.set(p.hex);
    else m.color.copy(o.color);
    if (p.finish === 'matte') {
      m.metalness = 0.05;
      m.roughness = 0.78;
      if ('clearcoat' in m) m.clearcoat = 0;
    } else if (p.finish === 'metal') {
      m.metalness = 0.62;
      m.roughness = 0.3;
      if ('clearcoat' in m) {
        m.clearcoat = 1;
        m.clearcoatRoughness = 0.05;
      }
    } else {
      m.metalness = o.metalness;
      m.roughness = o.roughness;
      if ('clearcoat' in m) {
        m.clearcoat = o.clearcoat;
        m.clearcoatRoughness = o.clearcoatRoughness;
      }
    }
  }
  const r = RIMS.find((x) => x.id === rimId) || RIMS[0];
  for (const m of rims) {
    const o = orig(m);
    const dark = (m.name || '').toLowerCase() === 'rim_dark';
    if (!r.hex) {
      m.color.copy(o.color);
      m.metalness = o.metalness;
      m.roughness = o.roughness;
    } else {
      m.color.set(r.hex);
      if (dark) m.color.multiplyScalar(0.45);
      m.metalness = r.metal;
      m.roughness = r.rough;
    }
  }
  return true;
}

export function garageState() {
  return state;
}

// ---- the garage screen ----
export class Garage {
  constructor({ getWallet, pay, onBuy, onClose }) {
    this.getWallet = getWallet;
    this.pay = pay;
    this.onBuy = onBuy;
    this.onClose = onClose;
    this.tab = 'paint';
    this.root = el('div', 'izk-screen izk-garage');
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="izk-gpanel">
        <div class="izk-ghead"><b>Garage</b><span class="izk-gwallet"></span></div>
        <div class="izk-gsub">Your gusheshe</div>
        <div class="izk-tabs"><button data-tab="paint" class="on">Paint</button><button data-tab="rims">Rims</button></div>
        <div class="izk-swatches"></div>
        <div class="izk-gpick"><span class="izk-gname"></span><span class="izk-gprice"></span></div>
        <div class="izk-grow"><button class="izk-btn izk-gbuy">Use this</button><button class="izk-btn ghost izk-gdone">Done</button></div>
      </div>`;
    document.body.appendChild(this.root);
    this.sw = this.root.querySelector('.izk-swatches');
    for (const b of this.root.querySelectorAll('.izk-tabs button')) {
      b.addEventListener('click', () => {
        haptic.tap();
        this.tab = b.dataset.tab;
        for (const o of this.root.querySelectorAll('.izk-tabs button')) o.classList.toggle('on', o === b);
        this.pick = this.tab === 'paint' ? state.paint : state.rims;
        this.render();
      });
    }
    this.root.querySelector('.izk-gbuy').addEventListener('click', () => this.buy());
    this.root.querySelector('.izk-gdone').addEventListener('click', () => this.close());
  }

  open() {
    this.tab = 'paint';
    for (const o of this.root.querySelectorAll('.izk-tabs button')) o.classList.toggle('on', o.dataset.tab === 'paint');
    this.pick = state.paint;
    this.root.style.display = '';
    this.render();
  }

  close() {
    applyLook(); // drop any preview you did not buy
    this.root.style.display = 'none';
    haptic.tap();
    this.onClose?.();
  }

  get isOpen() {
    return this.root.style.display !== 'none';
  }

  list() {
    return this.tab === 'paint' ? PAINTS : RIMS;
  }

  render() {
    const list = this.list();
    this.sw.innerHTML = '';
    for (const it of list) {
      const b = el('button', 'izk-sw' + (it.id === this.pick ? ' on' : ''));
      const col = it.hex || (this.tab === 'paint' ? '#8f1418' : '#c7c9cc');
      b.style.setProperty('--c', col);
      if (this.tab === 'paint' && it.finish === 'metal') b.classList.add('metal');
      if (this.tab === 'paint' && it.finish === 'matte') b.classList.add('matte');
      if (this.tab === 'rims') b.classList.add('rim');
      const using = (this.tab === 'paint' ? state.paint : state.rims) === it.id;
      b.innerHTML = `<i></i><small>${using ? 'ON CAR' : owns(this.tab, it) ? (it.price ? 'OWNED' : 'FREE') : rand(it.price)}</small>`;
      b.setAttribute('aria-label', it.name);
      b.addEventListener('click', () => {
        haptic.tap();
        this.pick = it.id;
        this.preview();
        this.render();
      });
      this.sw.appendChild(b);
    }
    this.updatePick();
  }

  preview() {
    if (this.tab === 'paint') applyLook(this.pick, state.rims);
    else applyLook(state.paint, this.pick);
  }

  updatePick() {
    const it = this.list().find((x) => x.id === this.pick) || this.list()[0];
    const using = (this.tab === 'paint' ? state.paint : state.rims) === it.id;
    const have = owns(this.tab, it);
    this.root.querySelector('.izk-gname').textContent = it.name;
    this.root.querySelector('.izk-gprice').textContent = using ? 'On your car' : have ? (it.price ? 'You own this' : 'Free') : rand(it.price);
    const buy = this.root.querySelector('.izk-gbuy');
    const money = this.getWallet();
    buy.disabled = using || (!have && money < it.price);
    buy.textContent = using ? 'On your car' : have ? 'Use this' : money < it.price ? `Need ${rand(it.price - money)} more` : `Buy for ${rand(it.price)}`;
    this.root.querySelector('.izk-gwallet').textContent = rand(money);
  }

  buy() {
    const it = this.list().find((x) => x.id === this.pick);
    if (!it) return;
    if (!owns(this.tab, it)) {
      if (!this.pay(it.price)) return;
      state.owned.push(this.tab + ':' + it.id);
      this.onBuy?.(it);
    }
    if (this.tab === 'paint') state.paint = it.id;
    else state.rims = it.id;
    save();
    applyLook();
    haptic.reward();
    this.render();
  }
}
