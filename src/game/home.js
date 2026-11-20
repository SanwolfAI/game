import { registerDialog } from '../ui/dialogs.js';
import * as THREE from '../../vendor/three/three.module.js';
import { toXZ } from '../core/geo.js';

// Choose where you live (Bheko, 19 Nov 2026). A new player arrives with
// R25,000 and buys a cheap house first; what is left pays for driving school
// (learner's R110, lessons R300, test R450, PrDP R250). Game prices, not market
// prices. Each home sits on a real residential street in that area.
// State: wallet.home = id (localStorage izk.wallet.v1).

export const HOMES = [
  { id: 'inanda', area: 'Inanda Newtown', kind: 'RDP house, 2 rooms', price: 12000, lon: 30.9605, lat: -29.7005 },
  { id: 'ntuzuma', area: 'Ntuzuma G', kind: 'RDP house, 2 rooms', price: 13500, lon: 30.9445, lat: -29.7352 },
  { id: 'wentworth', area: 'Wentworth', kind: 'Flat, 2 rooms', price: 15000, lon: 30.9905, lat: -29.9298 },
  { id: 'clermont', area: 'Clermont', kind: 'Brick house, 3 rooms', price: 16000, lon: 30.8752, lat: -29.8248 },
  { id: 'kwamashu', area: 'KwaMashu K Section', kind: 'Four-room house', price: 17500, lon: 30.9798, lat: -29.7452 },
  { id: 'umlazi', area: 'Umlazi V Section', kind: 'Four-room house', price: 18000, lon: 30.8852, lat: -29.9702 },
  { id: 'lamontville', area: 'Lamontville', kind: 'Four-room house', price: 19500, lon: 30.9482, lat: -29.9452 },
  { id: 'phoenix', area: 'Phoenix, Westham', kind: 'Semi-detached house', price: 20000, lon: 31.0002, lat: -29.7002 },
  { id: 'chatsworth', area: 'Chatsworth Unit 3', kind: 'Semi-detached house', price: 21000, lon: 30.8802, lat: -29.9102 },
];
export const START_MONEY = 25000;
const R = (n) => `R${Math.round(n).toLocaleString('en-ZA')}`;

export class Homes {
  constructor(wallet, { hud, hf, roads, save, show }) {
    this.w = wallet;
    this.hud = hud;
    this.hf = hf;
    this.roads = roads;
    this.save = save;
    this.show = show;
    this.group = new THREE.Group();
    this.group.name = 'homes';
    const maxX = hf.minX + (hf.cols - 1) * hf.cell;
    const maxZ = hf.minZ + (hf.rows - 1) * hf.cell;
    this.list = [];
    for (const h of HOMES) {
      const [x, z] = toXZ(h.lon, h.lat);
      if (x < hf.minX + 200 || x > maxX - 200 || z < hf.minZ + 200 || z > maxZ - 200) continue; // outside the map for now
      // a small residential street near the spot: the house is behind its kerb
      const nr = roads.nearestRoad(x, z, 250, (q) => q.width < 8) || roads.nearestRoad(x, z, 250);
      if (!nr) continue;
      const dx = x - nr.x;
      const dz = z - nr.z;
      const l = Math.hypot(dx, dz) || 1;
      const off = nr.road.width / 2 + 4;
      this.list.push({ ...h, x: nr.x + (dx / l) * off, z: nr.z + (dz / l) * off, rx: nr.x, rz: nr.z, yaw: Math.atan2(-dx / l, -dz / l) });
    }
    this.hooks = {};
    this.#marker();
  }

  get home() {
    return this.list.find((h) => h.id === this.w.home) || null;
  }

  // gate + HOME sign at the house you own
  #marker() {
    const h = this.home;
    if (this.markerG) this.group.remove(this.markerG);
    if (!h) return;
    const g = new THREE.Group();
    const y = this.hf.heightAt(h.x, h.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2, 32), new THREE.MeshBasicMaterial({ color: 0x46d27a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(h.x, y + 0.08, h.z);
    g.add(ring);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#1e5a32';
    x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = 'bold 44px sans-serif';
    x.fillText('HOME', 128, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    sign.position.set(h.x, y + 2.4, h.z);
    sign.rotation.y = h.yaw;
    g.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x777b80 }));
    post.position.set(h.x, y + 1.1, h.z);
    g.add(post);
    this.group.add(g);
    this.markerG = g;
  }

  // the first screen of a new game: pick a house
  choose() {
    const p = document.createElement('div');
    p.id = 'home-pick';
    p.style.cssText = 'position:fixed;inset:0;z-index:45;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(520px,94vw);max-height:92vh;overflow:auto;padding:12px 14px;border-radius:14px;background:rgba(12,14,18,.96);color:#eee;font:14px/1.4 system-ui,sans-serif';
    let h = `<b style="color:#ffd21a;font-size:16px">Where do you want to live?</b><div style="opacity:.8;margin:2px 0 8px">You have ${R(this.w.r)}. Buy a house, and keep the rest for driving school (about R1,110).</div>`;
    for (const o of this.list) {
      const ok = this.w.r - o.price >= 1110;
      h += `<button data-id="${o.id}" ${ok ? '' : 'disabled'} style="display:flex;justify-content:space-between;align-items:center;width:100%;min-height:48px;margin-top:6px;padding:8px 10px;border:0;border-radius:9px;background:${ok ? '#22272e' : '#191b1f'};color:${ok ? '#eee' : '#777'};font:14px system-ui;text-align:left"><span><b>${o.area}</b><br><span style="opacity:.75">${o.kind}</span></span><b style="color:#ffd21a">${R(o.price)}</b></button>`;
    }
    box.innerHTML = h;
    p.appendChild(box);
    registerDialog(p); // top layer; game input pauses while you choose
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      const o = this.list.find((q) => q.id === b.dataset.id);
      this.w.r -= o.price;
      this.w.home = o.id;
      this.save();
      this.show();
      p.remove();
      this.#marker();
      this.hooks.moveIn?.(o);
      this.hud.toast(`Welcome home to ${o.area}. ${R(this.w.r)} left. First stop: your licence. GPS is set to the nearest driving school.`, 7);
    });
  }
}
