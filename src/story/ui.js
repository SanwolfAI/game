// Story screens: dialogue with portraits, the objective line, passenger
// chatter, mission offer, chapter card, mission complete, mission failed,
// pay, and the story journal. Plain DOM + one injected <style>. Every
// popup is registered with dialogs.js so game input pauses while it shows.

import { registerDialog } from '../ui/dialogs.js';
import { portraitURL } from './portraits.js';
import { CAST, CHAPTERS, MISSIONS, PLACES } from './missions.js';

const R = (n) => `R${Math.round(n).toLocaleString('en-ZA')}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// "Woza (come here)" -> the word bold, the meaning soft
const say = (s) => esc(s).replace(/((?:Woza la|Hhayi bo)|[A-Za-z'’!]+) \(([^)]+)\)/g, (m, w, mean) => (/^[A-Z]/.test(w) || w.length > 2 ? `<b class="sz-zu">${w}</b> <span class="sz-mean">(${mean})</span>` : m));

// simple line icons, 24 x 24, stroke = currentColor
const P = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  taxi: '<path d="M3 16V9a2 2 0 0 1 2-2h11l4 4v5"/><path d="M3 12h17"/><path d="M8 7v5M13 7v5"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  licence: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2.2"/><path d="M5.5 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4"/><path d="M14 10h4M14 13h4"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/><path d="M3.5 10.5h6.3M14.2 10.5h6.3M12 14.2V21"/>',
  car: '<path d="M4 16v-3l2-5h12l2 5v3"/><path d="M3 13h18"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
  box: '<path d="M3 8 12 3l9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  follow: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/><path d="M8.5 11h5M11 8.5v5"/>',
  spin: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c.5-3.5 2.8-5.5 6-5.5s5.5 2 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.5c2.6.2 4.4 2 5 5"/>',
  baby: '<circle cx="12" cy="9" r="5"/><path d="M10 9h.01M14 9h.01"/><path d="M10.5 11.5c.8.6 2.2.6 3 0"/><path d="M7 21c.6-3 2.6-5 5-5s4.4 2 5 5"/>',
  shop: '<path d="M4 9h16l-1-5H5z"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M8 7h7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v.01M18 15v.01"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  go: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
};
export const icon = (k, cls = '') => `<svg class="sz-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[k] || P.book}</svg>`;

const CSS = `
#sz-obj{position:fixed;left:50%;top:calc(var(--sat,0px) + 54px);transform:translateX(-50%);z-index:20;max-width:min(560px,52vw);padding:5px 12px 6px 8px;border-radius:12px;background:rgba(10,16,24,.78);color:#f3f5f7;font:600 12.5px/1.3 system-ui,sans-serif;pointer-events:none;display:none;border-left:4px solid #e2463a;box-shadow:0 2px 10px rgba(0,0,0,.35)}
#sz-obj.show{display:flex;gap:8px;align-items:center}
#sz-obj .sz-oi{flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#111}
#sz-obj .sz-oi .sz-ico{width:17px;height:17px}
#sz-obj .sz-ot{font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;opacity:.75}
#sz-obj .sz-ox{color:#ffd21a;font-weight:700;margin-left:6px;white-space:nowrap}
#sz-obj .sz-otm{font:800 15px system-ui;color:#fff;margin-left:auto;padding-left:8px;white-space:nowrap}
#sz-obj .sz-otm.low{color:#ff6b57}
#sz-chat{position:fixed;left:50%;top:calc(var(--sat,0px) + 104px);transform:translateX(-50%);z-index:20;display:none;align-items:center;gap:8px;max-width:min(520px,60vw);padding:5px 12px 5px 5px;border-radius:24px;background:rgba(255,255,255,.93);color:#1b2127;font:600 13px/1.3 system-ui,sans-serif;pointer-events:none;box-shadow:0 3px 12px rgba(0,0,0,.35)}
#sz-chat.show{display:flex;animation:szpop .25s ease-out}
#sz-chat img{width:36px;height:36px;border-radius:50%;flex:none}
#sz-chat b{display:block;font-size:10.5px;opacity:.6;text-transform:uppercase;letter-spacing:.4px}
@keyframes szpop{from{transform:translate(-50%,-6px);opacity:0}to{transform:translate(-50%,0);opacity:1}}
.sz-pop{position:fixed;inset:0;z-index:1001;display:none;font:14px/1.4 system-ui,sans-serif;color:#eef1f4}
.sz-ico{width:20px;height:20px;flex:none}
.sz-zu{color:#ffd76a}
.sz-mean{opacity:.72;font-weight:500}
.sz-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:8px 16px;border:0;border-radius:12px;background:#2a323c;color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer}
.sz-btn.main{background:#ffcf5c;color:#17202a}
.sz-btn:disabled{opacity:.45}
.sz-btn .sz-ico{width:18px;height:18px}
/* dialogue */
#sz-scene{background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,0) 55%)}
#sz-scene .sz-box{position:absolute;left:50%;bottom:calc(var(--sab,0px) + 10px);transform:translateX(-50%);width:min(760px,96vw);display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:16px;background:rgba(12,16,22,.94);border:1px solid rgba(255,255,255,.12);box-shadow:0 6px 24px rgba(0,0,0,.5);box-sizing:border-box}
#sz-scene .sz-face{width:84px;height:84px;border-radius:14px;flex:none;border:2px solid rgba(255,255,255,.18)}
#sz-scene .sz-who{font:800 13px system-ui;letter-spacing:.5px;text-transform:uppercase}
#sz-scene .sz-role{font:500 11px system-ui;opacity:.6;margin-left:6px;text-transform:none;letter-spacing:0}
#sz-scene .sz-line{font:500 16px/1.4 system-ui,sans-serif;margin-top:3px;min-height:44px}
#sz-scene .sz-line.narr{font-style:italic;color:#d9dfe6}
#sz-scene .sz-act{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
#sz-scene .sz-dots{margin-right:auto;align-self:center;font-size:11px;opacity:.55}
#sz-scene .sz-txt{flex:1;min-width:0}
/* centred cards */
.sz-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,92vw);max-height:92vh;overflow:auto;box-sizing:border-box;padding:16px 18px;border-radius:18px;background:rgba(12,16,22,.96);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 40px rgba(0,0,0,.6)}
.sz-card h2{margin:2px 0 4px;font:900 22px/1.15 system-ui,sans-serif}
.sz-card .sz-kick{font:800 11px system-ui;letter-spacing:1.4px;text-transform:uppercase}
.sz-card p{margin:6px 0;opacity:.9}
.sz-card .sz-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.sz-card .sz-row .sz-btn{flex:1}
.sz-badge{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:14px;color:#111;flex:none}
.sz-badge .sz-ico{width:26px;height:26px}
.sz-head{display:flex;gap:12px;align-items:center}
#sz-offer .sz-card,#sz-pay .sz-card{top:auto;bottom:calc(var(--sab,0px) + 12px);transform:translateX(-50%)}
#sz-offer{background:linear-gradient(to top,rgba(0,0,0,.5),rgba(0,0,0,0) 60%)}
#sz-fail{background:rgba(40,0,0,.45)}
#sz-fail h2{color:#ff6b57}
#sz-done{background:rgba(0,0,0,.55)}
#sz-done .sz-reward{display:flex;align-items:center;gap:10px;margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,207,92,.12);color:#ffd76a;font:800 20px system-ui}
#sz-done .sz-reward small{font:600 12px system-ui;color:#e9e3cf;opacity:.85}
#sz-done .sz-next{margin-top:10px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.06);font-size:13px}
/* chapter card */
#sz-chapter{background:#000}
#sz-chapter canvas{position:absolute;inset:0;width:100%;height:100%}
#sz-chapter .sz-ctext{position:absolute;left:6vw;bottom:calc(var(--sab,0px) + 9vh);right:6vw;max-width:620px;text-shadow:0 2px 12px rgba(0,0,0,.8)}
#sz-chapter .sz-cn{font:900 13px system-ui;letter-spacing:3px;text-transform:uppercase}
#sz-chapter .sz-ct{font:900 clamp(30px,7vw,54px)/1.05 system-ui,sans-serif;margin:4px 0}
#sz-chapter .sz-cs{font:600 18px system-ui;opacity:.9}
#sz-chapter .sz-cb{font:500 14px/1.45 system-ui;opacity:.9;margin-top:8px;max-width:560px}
#sz-chapter .sz-btn{margin-top:14px}
#sz-chapter.show-anim .sz-ctext{animation:szrise .8s ease-out}
@keyframes szrise{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
/* journal */
#sz-journal{background:rgba(0,0,0,.55)}
#sz-journal .sz-card{width:min(720px,96vw);height:min(560px,94vh);display:flex;flex-direction:column;padding:12px 14px}
#sz-journal .sz-jtop{display:flex;align-items:center;gap:10px}
#sz-journal .sz-jtop h2{margin:0;flex:1;font-size:19px}
#sz-journal .sz-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.12);margin:8px 0 6px;overflow:hidden}
#sz-journal .sz-bar i{display:block;height:100%;background:linear-gradient(90deg,#e2463a,#f2b632,#3fb37a)}
#sz-journal .sz-tabs{display:flex;gap:6px;margin:4px 0 8px}
#sz-journal .sz-tab{flex:1;min-height:40px;border:0;border-radius:10px;background:#20262e;color:#cfd6dd;font:700 12.5px system-ui;cursor:pointer;border-bottom:3px solid transparent}
#sz-journal .sz-tab.on{background:#2c343e;color:#fff}
#sz-journal .sz-list{flex:1;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
#sz-journal .sz-m{display:flex;gap:10px;align-items:center;min-height:52px;padding:6px 10px;border-radius:12px;background:#1a2027;cursor:pointer;border:1px solid transparent}
#sz-journal .sz-m.next{border-color:#ffcf5c}
#sz-journal .sz-m.active{border-color:#46d27a}
#sz-journal .sz-m.locked{opacity:.5}
#sz-journal .sz-m .sz-mt{flex:1;min-width:0}
#sz-journal .sz-m .sz-mt b{display:block;font-size:14.5px}
#sz-journal .sz-m .sz-mt span{display:block;font-size:12px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sz-journal .sz-st{display:flex;align-items:center;gap:4px;font:700 11px system-ui;opacity:.85;white-space:nowrap}
#sz-journal .sz-detail{margin:-2px 0 4px;padding:8px 10px 10px;border-radius:0 0 12px 12px;background:#141a20;font-size:13.5px}
#sz-journal .sz-detail .sz-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
#sz-journal .sz-cast{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
#sz-journal .sz-cast img{width:34px;height:34px;border-radius:9px}
@media (max-height:420px){
 #sz-scene .sz-face{width:66px;height:66px}
 #sz-scene .sz-line{font-size:14.5px;min-height:38px}
 #sz-scene .sz-box{padding:8px 10px}
 .sz-card{padding:12px 14px}
 .sz-card h2{font-size:19px}
 #sz-obj{top:calc(var(--sat,0px) + 6px);max-width:min(460px,46vw)}
 #sz-chat{top:calc(var(--sat,0px) + 52px)}
}
`;

// ---- chapter card art: Durban skyline, the Moses Mabhida arch, a red E30 ----
function chapterArt(c, color, n) {
  const W = c.width;
  const H = c.height;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H);
  const tones = [
    ['#2b1033', '#e2463a', '#ffb067'], // ch1 sunset
    ['#0b1f3a', '#2f6fd2', '#f2b632'], // ch2 city day into gold
    ['#071a14', '#1f6f55', '#ffe7a0'], // ch3 sunrise
  ][(n - 1) % 3];
  sky.addColorStop(0, tones[0]);
  sky.addColorStop(0.62, tones[1]);
  sky.addColorStop(1, tones[2]);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // sun
  const sx = W * 0.72;
  const sy = H * 0.52;
  const sun = g.createRadialGradient(sx, sy, 4, sx, sy, H * 0.35);
  sun.addColorStop(0, 'rgba(255,240,200,0.95)');
  sun.addColorStop(0.2, 'rgba(255,200,120,0.55)');
  sun.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  // skyline
  const base = H * 0.72;
  g.fillStyle = 'rgba(10,8,14,0.85)';
  let x = 0;
  let k = 7 + n;
  const rnd = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
  g.beginPath();
  g.moveTo(0, base);
  while (x < W) {
    const w = W * (0.025 + rnd() * 0.045);
    const h = H * (0.05 + rnd() * (x > W * 0.35 && x < W * 0.6 ? 0.28 : 0.14));
    g.lineTo(x, base - h);
    g.lineTo(x + w, base - h);
    x += w;
  }
  g.lineTo(W, base);
  g.closePath();
  g.fill();
  // the stadium arch
  g.strokeStyle = 'rgba(245,245,250,0.9)';
  g.lineWidth = Math.max(2, H * 0.008);
  g.beginPath();
  g.moveTo(W * 0.12, base);
  g.quadraticCurveTo(W * 0.22, H * 0.18, W * 0.34, base);
  g.stroke();
  g.fillStyle = 'rgba(10,8,14,0.9)';
  g.beginPath();
  g.ellipse(W * 0.23, base, W * 0.1, H * 0.04, 0, Math.PI, Math.PI * 2);
  g.fill();
  // road + palm trees
  g.fillStyle = '#121016';
  g.fillRect(0, base, W, H - base);
  g.strokeStyle = 'rgba(255,210,60,0.5)';
  g.lineWidth = Math.max(2, H * 0.006);
  g.setLineDash([W * 0.03, W * 0.02]);
  g.beginPath();
  g.moveTo(0, base + H * 0.12);
  g.lineTo(W, base + H * 0.12);
  g.stroke();
  g.setLineDash([]);
  for (const px of [0.05, 0.42, 0.93]) {
    const tx = W * px;
    g.strokeStyle = '#0c0a10';
    g.lineWidth = Math.max(3, H * 0.012);
    g.beginPath();
    g.moveTo(tx, base);
    g.quadraticCurveTo(tx + W * 0.01, base - H * 0.2, tx + W * 0.005, base - H * 0.3);
    g.stroke();
    g.fillStyle = '#0c0a10';
    for (let a = 0; a < 6; a++) {
      g.save();
      g.translate(tx + W * 0.005, base - H * 0.3);
      g.rotate(-Math.PI / 2 + (a - 2.5) * 0.55);
      g.beginPath();
      g.ellipse(H * 0.06, 0, H * 0.065, H * 0.012, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  // the red E30: boxy two-door silhouette
  const cx = W * 0.6;
  const cy = base + H * 0.06;
  const s = H * 0.0021;
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = '#d32a20';
  g.beginPath();
  g.moveTo(-100, 0);
  g.lineTo(-98, -22);
  g.lineTo(-60, -26);
  g.lineTo(-38, -46);
  g.lineTo(30, -46);
  g.lineTo(52, -26);
  g.lineTo(98, -22);
  g.lineTo(100, 0);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(160,210,255,0.55)';
  g.beginPath();
  g.moveTo(-54, -27);
  g.lineTo(-36, -42);
  g.lineTo(-4, -42);
  g.lineTo(-4, -27);
  g.closePath();
  g.moveTo(2, -27);
  g.lineTo(2, -42);
  g.lineTo(28, -42);
  g.lineTo(46, -27);
  g.closePath();
  g.fill();
  g.fillStyle = '#111';
  for (const wx of [-62, 62]) {
    g.beginPath();
    g.arc(wx, 0, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#9aa0a6';
    g.beginPath();
    g.arc(wx, 0, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
  }
  g.fillStyle = '#ffe9a8';
  g.fillRect(92, -18, 8, 6);
  g.fillStyle = '#ff3b30';
  g.fillRect(-100, -18, 6, 6);
  g.restore();
  // tint with the chapter colour
  g.fillStyle = color + '22';
  g.fillRect(0, 0, W, H);
  const vg = g.createLinearGradient(0, 0, W, 0);
  vg.addColorStop(0, 'rgba(0,0,0,0.65)');
  vg.addColorStop(0.55, 'rgba(0,0,0,0.1)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

export class StoryUI {
  constructor() {
    const st = document.createElement('style');
    st.id = 'sz-style';
    st.textContent = CSS;
    document.head.appendChild(st);
    this.obj = this.#el('div', 'sz-obj', false);
    this.chat = this.#el('div', 'sz-chat', false);
    this.scene = this.#pop('sz-scene');
    this.offerEl = this.#pop('sz-offer');
    this.chapterEl = this.#pop('sz-chapter');
    this.doneEl = this.#pop('sz-done');
    this.failEl = this.#pop('sz-fail');
    this.payEl = this.#pop('sz-pay');
    this.journalEl = this.#pop('sz-journal');
    this.objKey = '';
    this.chatT = 0;
    this.queue = [];
  }

  #el(tag, id, dialog) {
    const e = document.createElement(tag);
    e.id = id;
    document.body.appendChild(e);
    if (dialog) registerDialog(e);
    return e;
  }

  #pop(id) {
    const e = document.createElement('div');
    e.id = id;
    e.className = 'sz-pop';
    e.style.display = 'none';
    registerDialog(e);
    return e;
  }

  #show(e, on) {
    e.style.display = on ? 'block' : 'none';
  }

  face(who, size = 96) {
    return portraitURL(who, CAST[who] && CAST[who].look, size);
  }

  // ---------------- dialogue ----------------
  playScene(lines, done) {
    let i = 0;
    const e = this.scene;
    const show = () => {
      const [who, text] = lines[i];
      const c = CAST[who];
      const narr = who === 'story' || !c;
      const col = narr ? '#cfd6dd' : who === 'sizwe' ? '#ff8a7a' : '#ffd76a';
      e.innerHTML = `<div class="sz-box"><img class="sz-face" alt="" src="${this.face(narr ? 'story' : who)}"><div class="sz-txt"><div class="sz-who" style="color:${col}">${narr ? 'Story' : esc(c.name)}${narr ? '' : `<span class="sz-role">${esc(c.role)}</span>`}</div><div class="sz-line${narr ? ' narr' : ''}">${say(text)}</div><div class="sz-act"><span class="sz-dots">${i + 1} / ${lines.length}</span><button type="button" class="sz-btn" data-a="skip">Skip</button><button type="button" class="sz-btn main" data-a="next">${i < lines.length - 1 ? 'Next' : 'Go'} ${icon('go')}</button></div></div></div>`;
    };
    const finish = () => {
      e.onclick = null;
      this.#show(e, false);
      done();
    };
    e.onclick = (ev) => {
      ev.stopPropagation();
      const b = ev.target.closest('button');
      if (b && b.dataset.a === 'skip') return finish();
      // tap anywhere (or Next) moves on
      if (++i >= lines.length) return finish();
      show();
    };
    show();
    this.#show(e, true);
  }

  // ---------------- objective line + chatter ----------------
  objective(o) {
    if (!o) {
      if (this.objKey) {
        this.objKey = '';
        this.obj.classList.remove('show');
      }
      return;
    }
    const tm = o.timer == null ? '' : `${Math.floor(o.timer / 60)}:${String(Math.floor(o.timer % 60)).padStart(2, '0')}`;
    const key = `${o.title}|${o.text}|${o.extra}|${tm}`;
    if (key === this.objKey) return;
    const head = this.objKey.split('|').slice(0, 2).join('|');
    this.objKey = key;
    if (head !== `${o.title}|${o.text}`) {
      this.obj.style.borderLeftColor = o.color;
      this.obj.innerHTML = `<span class="sz-oi" style="background:${o.color}">${icon(o.icon)}</span><span><span class="sz-ot">${esc(o.title)}</span><br><span class="sz-otx">${esc(o.text)}</span><span class="sz-ox"></span></span><span class="sz-otm"></span>`;
      this.oxEl = this.obj.querySelector('.sz-ox');
      this.otmEl = this.obj.querySelector('.sz-otm');
    }
    this.oxEl.textContent = o.extra ? `· ${o.extra}` : '';
    this.otmEl.textContent = tm;
    this.otmEl.classList.toggle('low', o.timer != null && o.timer < 20);
    this.obj.classList.add('show');
  }

  chatter(who, text) {
    const c = CAST[who];
    this.chat.innerHTML = `<img alt="" src="${this.face(c ? who : 'story', 48)}"><span><b>${c ? esc(c.name) : 'Story'}</b>${say(text)}</span>`;
    this.chat.classList.remove('show');
    void this.chat.offsetWidth;
    this.chat.classList.add('show');
    this.chatT = 4.5;
  }

  tick(dt) {
    if (this.chatT > 0 && (this.chatT -= dt) <= 0) this.chat.classList.remove('show');
  }

  // ---------------- cards ----------------
  offer({ mission: m, label, chapter }, yes, later) {
    const e = this.offerEl;
    e.innerHTML = `<div class="sz-card"><div class="sz-head"><span class="sz-badge" style="background:${chapter.color}">${icon(m.icon)}</span><div><div class="sz-kick" style="color:${chapter.color}">Story · Chapter ${chapter.n} · Mission ${label}</div><h2>${esc(m.title)}</h2></div></div><p>${esc(m.blurb)}</p><div class="sz-row"><button type="button" class="sz-btn" data-a="later">Later</button><button type="button" class="sz-btn main" data-a="go">${icon('play')} Start</button></div></div>`;
    e.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      ev.stopPropagation();
      e.onclick = null;
      this.#show(e, false);
      (b.dataset.a === 'go' ? yes : later)();
    };
    this.#show(e, true);
  }

  chapter(ch, done) {
    const e = this.chapterEl;
    e.innerHTML = `<canvas></canvas><div class="sz-ctext"><div class="sz-cn" style="color:${ch.color}">Chapter ${ch.n}</div><div class="sz-ct">${esc(ch.title)}</div><div class="sz-cs">${esc(ch.sub)}</div><div class="sz-cb">${say(ch.blurb)}</div><button type="button" class="sz-btn main">${icon('play')} Begin</button></div>`;
    this.#show(e, true);
    e.classList.remove('show-anim');
    void e.offsetWidth;
    e.classList.add('show-anim');
    const c = e.querySelector('canvas');
    const pr = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(innerWidth * pr);
    c.height = Math.round(innerHeight * pr);
    chapterArt(c, ch.color, ch.n);
    e.querySelector('button').onclick = (ev) => {
      ev.stopPropagation();
      this.#show(e, false);
      done();
    };
  }

  complete(info, done) {
    const { mission: m, label, money, note, chapterDone, chapter, next, finished } = info;
    const e = this.doneEl;
    const nextCh = next && CHAPTERS.find((c) => c.id === next.chapter);
    const nextLine = finished
      ? '<div class="sz-next"><b>Story complete!</b> Thank you for playing. Durban is still out there: deliveries, taxi shifts and spin shows.</div>'
      : next
        ? `<div class="sz-next">${icon('pin')} <b>Next:</b> ${esc(next.title)} · at ${esc(PLACES[next.start].name)}${nextCh && nextCh.id !== chapter.id ? ` (Chapter ${nextCh.n})` : ''}</div>`
        : '';
    e.innerHTML = `<div class="sz-card"><div class="sz-kick" style="color:${chapter.color}">Mission ${label}${chapterDone ? ` · Chapter ${chapter.n} complete!` : ''}</div><h2>${icon('check')} Mission complete</h2><div style="font:800 16px system-ui;opacity:.95">${esc(m.title)}</div><p>${esc(m.summary)}</p>${money ? `<div class="sz-reward">${icon('money')} +${R(money)} <small>${esc(note || '')}</small></div>` : '<div class="sz-reward"><small>Replay: no pay this time</small></div>'}${nextLine}<div class="sz-row">${next ? '<button type="button" class="sz-btn" data-a="gps">' + icon('pin') + ' Show next on GPS</button>' : ''}<button type="button" class="sz-btn main" data-a="ok">Continue</button></div></div>`;
    e.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      ev.stopPropagation();
      e.onclick = null;
      this.#show(e, false);
      if (b.dataset.a === 'gps') this.onGps?.(next);
      done();
    };
    this.#show(e, true);
  }

  fail(reason, retry, quit) {
    const e = this.failEl;
    e.innerHTML = `<div class="sz-card"><div class="sz-kick" style="color:#ff6b57">Mission failed</div><h2>${icon('x')} Eish (oh no)!</h2><p>${esc(reason)}</p><div class="sz-row"><button type="button" class="sz-btn" data-a="quit">Stop mission</button><button type="button" class="sz-btn main" data-a="retry">${icon('retry')} Try again</button></div></div>`;
    e.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      ev.stopPropagation();
      e.onclick = null;
      this.#show(e, false);
      (b.dataset.a === 'retry' ? retry : quit)();
    };
    this.#show(e, true);
  }

  pay(amount, what, have, cb) {
    const e = this.payEl;
    const okm = have >= amount;
    e.innerHTML = `<div class="sz-card"><div class="sz-head"><span class="sz-badge" style="background:#3fb37a">${icon('shop')}</span><div><div class="sz-kick" style="color:#3fb37a">Buy</div><h2>${R(amount)}</h2></div></div><p>Pay ${R(amount)} for ${esc(what)}? You have ${R(have)}.</p>${okm ? '' : `<p style="color:#ffb4a8">You need ${R(amount - have)} more. Do deliveries or taxi work, then come back.</p>`}<div class="sz-row"><button type="button" class="sz-btn" data-a="no">Not yet</button><button type="button" class="sz-btn main" data-a="yes"${okm ? '' : ' disabled'}>${icon('money')} Pay</button></div></div>`;
    e.onclick = (ev) => {
      const b = ev.target.closest('button');
      if (!b || b.disabled) return;
      ev.stopPropagation();
      e.onclick = null;
      this.#show(e, false);
      cb(b.dataset.a === 'yes');
    };
    this.#show(e, true);
  }

  // ---------------- journal ----------------
  // eng: the StoryEngine, act(kind, mission): journal button actions
  openJournal(eng, act) {
    const e = this.journalEl;
    const cur = (eng.run && eng.run.m) || eng.next() || MISSIONS[MISSIONS.length - 1];
    let tab = cur.chapter;
    let open = cur.id;
    const render = () => {
      const pg = eng.progress();
      let h = `<div class="sz-card"><div class="sz-jtop"><span class="sz-badge" style="background:#ffcf5c">${icon('book')}</span><h2>Story: Ntombi<br><span style="font:600 12px system-ui;opacity:.7">${pg.done} of ${pg.total} missions · ${pg.pct}%${eng.s.earned ? ` · earned ${R(eng.s.earned)}` : ''}</span></h2><button type="button" class="sz-btn" data-a="close" aria-label="Close">${icon('x')}</button></div><div class="sz-bar"><i style="width:${pg.pct}%"></i></div><div class="sz-tabs">`;
      for (const c of CHAPTERS) h += `<button type="button" class="sz-tab${c.id === tab ? ' on' : ''}" data-tab="${c.id}" style="border-bottom-color:${c.id === tab ? c.color : 'transparent'}">${c.n}. ${esc(c.title)}<br><span style="font-weight:500;opacity:.7">${esc(c.sub)}</span></button>`;
      h += '</div><div class="sz-list">';
      const ch = CHAPTERS.find((c) => c.id === tab);
      if (eng.s.seen[tab] || MISSIONS.some((m) => m.chapter === tab && eng.isDone(m.id))) h += `<div style="font-size:12.5px;opacity:.75;margin:0 2px 4px">${say(ch.blurb)}</div>`;
      for (const m of MISSIONS.filter((q) => q.chapter === tab)) {
        const st = eng.status(m);
        const lab = eng.label(m);
        const stTxt = { done: `${icon('check')} Done`, next: `${icon('pin')} Next`, active: `${icon('play')} Playing`, locked: `${icon('lock')} Locked` }[st];
        const sub = st === 'locked' ? 'Finish the missions before this one' : st === 'done' ? m.summary : `${m.blurb} · ${PLACES[m.start].name}`;
        h += `<div class="sz-m ${st}" data-m="${m.id}"><span class="sz-badge" style="background:${st === 'locked' ? '#3a4048' : ch.color}">${icon(st === 'locked' ? 'lock' : m.icon)}</span><div class="sz-mt"><b>${lab} ${st === 'locked' ? '???' : esc(m.title)}</b><span>${esc(sub)}</span></div><span class="sz-st">${stTxt}</span></div>`;
        if (open === m.id && st !== 'locked') {
          const speakers = [...new Set(m.steps.flatMap((s) => (s.lines || []).map((l) => l[0])).filter((w) => CAST[w] && w !== 'sizwe'))];
          h += `<div class="sz-detail">${esc(st === 'done' ? m.summary : m.blurb)}<br><span style="opacity:.7">${icon('pin')} ${esc(PLACES[m.start].name)}${m.reward && m.reward.money ? ` · pays ${R(m.reward.money)}` : ''}</span>`;
          if (st !== 'next') h += `<div class="sz-cast">${speakers.map((w) => `<img alt="${esc(CAST[w].name)}" title="${esc(CAST[w].name)}" src="${this.face(w, 48)}">`).join('')}</div>`;
          h += '<div class="sz-row">';
          if (st === 'next') h += `<button type="button" class="sz-btn" data-act="gps" data-id="${m.id}">${icon('pin')} Show on GPS</button><button type="button" class="sz-btn main" data-act="goto" data-id="${m.id}">${icon('go')} Take me there</button>`;
          else if (st === 'active') h += `<button type="button" class="sz-btn" data-act="quit" data-id="${m.id}">${icon('x')} Stop mission</button><button type="button" class="sz-btn main" data-act="route" data-id="${m.id}">${icon('pin')} Show the way</button>`;
          else if (st === 'done') h += `<button type="button" class="sz-btn main" data-act="replay" data-id="${m.id}">${icon('retry')} Play again (no pay)</button>`;
          h += '</div></div>';
        }
      }
      h += '</div></div>';
      e.innerHTML = h;
    };
    e.onclick = (ev) => {
      const b = ev.target.closest('button,[data-m]');
      if (!b) {
        if (ev.target === e) close();
        return;
      }
      ev.stopPropagation();
      if (b.dataset.a === 'close') return close();
      if (b.dataset.tab) {
        tab = b.dataset.tab;
        render();
        return;
      }
      if (b.dataset.act) {
        const m = MISSIONS.find((q) => q.id === b.dataset.id);
        close();
        act(b.dataset.act, m);
        return;
      }
      if (b.dataset.m) {
        open = open === b.dataset.m ? null : b.dataset.m;
        render();
      }
    };
    const close = () => {
      e.onclick = null;
      this.#show(e, false);
    };
    render();
    this.#show(e, true);
  }

  get journalOpen() {
    return this.journalEl.style.display === 'block';
  }

  closeJournal() {
    this.#show(this.journalEl, false);
  }
}
