import { roadClass } from '../world/roads.js';
import { formatDistance } from '../game/gps.js';

// Full-screen map: drag to pan, pinch (or mouse wheel / +/-) to zoom, tap a
// spot to set a destination. The GPS route is drawn on top. Redraws only when
// something changed (or ~4x a second for the moving player arrow).

export class BigMap {
  constructor({ hf, roads, minimap, gps, onDestination }) {
    this.hf = hf;
    this.roads = roads;
    this.minimap = minimap;
    this.gps = gps;
    this.onDestination = onDestination;
    this.open = false;
    this.cx = 0; // view centre (world metres)
    this.cz = 0;
    this.mpp = 6; // metres per CSS pixel
    this.player = { x: 0, z: 0, yaw: 0 };
    this.dirty = true;
    this.redrawT = 0;

    const root = document.createElement('div');
    root.id = 'bigmap';
    root.innerHTML = `
      <canvas id="bigmap-canvas"></canvas>
      <div id="bigmap-top" class="panel"><b>Map</b><span id="bigmap-hint">Drag to move · pinch to zoom · tap to set destination</span></div>
      <div id="bigmap-info" class="panel"></div>
      <div id="bigmap-btns">
        <button type="button" id="bm-zin" aria-label="Zoom in">+</button>
        <button type="button" id="bm-zout" aria-label="Zoom out">−</button>
        <button type="button" id="bm-me" aria-label="Centre on me">◎</button>
        <button type="button" id="bm-clear" aria-label="Clear route">✕ route</button>
        <button type="button" id="bm-close" aria-label="Close map">Close</button>
      </div>
      <details id="model-credits">
        <summary>Credits</summary>
        <div class="credits-body">
          Map data © OpenStreetMap contributors (ODbL).<br>
          "1991 BMW 325i (E30) — Pink Slip Kings" by micorlov, <a href="https://sketchfab.com/3d-models/1991-bmw-325i-e30-pink-slip-kings-f0399f2b18394643bf57d20ba3b72a98" target="_blank" rel="noopener">Sketchfab</a>, CC BY 4.0 (optimised).<br>
          "Low-Poly BMW" by Luka.Fox, <a href="https://sketchfab.com/3d-models/low-poly-bmw-8dd6a439eed349b9a4d073ca20166ac3" target="_blank" rel="noopener">Sketchfab</a>, CC BY 4.0.<br>
          "Toyota HiAce 2004" by Abdelrahman Elbaqsawi, <a href="https://sketchfab.com/3d-models/toyota-hiace-2004-0b7aa3f313e5469f83d6bf03a88299d1" target="_blank" rel="noopener">Sketchfab</a>, CC BY 4.0.<br>
          Kenney City Kit Roads and Nature Kit (CC0). Textures: Poly Haven (CC0). SA road signs: SADC-RTSM drawings, Wikimedia Commons (public domain).
        </div>
      </details>`;
    document.body.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('#bigmap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = root.querySelector('#bigmap-info');
    const stop = (e) => e.stopPropagation();
    root.addEventListener('keydown', stop);
    root.querySelector('#bm-close').addEventListener('click', () => this.hide());
    root.querySelector('#bm-zin').addEventListener('click', () => this.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.6));
    root.querySelector('#bm-zout').addEventListener('click', () => this.zoomAt(innerWidth / 2, innerHeight / 2, 1.6));
    root.querySelector('#bm-me').addEventListener('click', () => {
      this.cx = this.player.x;
      this.cz = this.player.z;
      this.dirty = true;
    });
    root.querySelector('#bm-clear').addEventListener('click', () => {
      this.gps.clear();
      this.dirty = true;
    });
    this.#bindPointers();
    addEventListener('resize', () => {
      if (this.open) this.#resize();
    });
  }

  show(px, pz, yaw) {
    this.open = true;
    this.root.classList.add('show');
    this.player = { x: px, z: pz, yaw };
    this.cx = px;
    this.cz = pz;
    this.mpp = 4;
    this.#resize();
    this.dirty = true;
  }

  hide() {
    this.open = false;
    this.root.classList.remove('show');
  }

  toggle(px, pz, yaw) {
    if (this.open) this.hide();
    else this.show(px, pz, yaw);
  }

  #resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    this.dirty = true;
  }

  toWorld(sx, sy) {
    return [this.cx + (sx - innerWidth / 2) * this.mpp, this.cz + (sy - innerHeight / 2) * this.mpp];
  }

  zoomAt(sx, sy, factor) {
    const [wx, wz] = this.toWorld(sx, sy);
    this.mpp = Math.min(110, Math.max(0.6, this.mpp * factor));
    // keep the world point under the finger fixed
    this.cx = wx - (sx - innerWidth / 2) * this.mpp;
    this.cz = wz - (sy - innerHeight / 2) * this.mpp;
    this.dirty = true;
  }

  #bindPointers() {
    const c = this.canvas;
    const pts = new Map();
    let tap = null;
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      else {
        tap = null;
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (pts.size === 1) {
        this.cx -= dx * this.mpp;
        this.cz -= dy * this.mpp;
        this.dirty = true;
        if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 9) tap.moved = true;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.d / d);
        pinch.d = d;
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (tap && !tap.moved && pts.size === 0 && performance.now() - tap.t < 450) {
        const [wx, wz] = this.toWorld(tap.x, tap.y);
        this.#pick(wx, wz);
      }
      if (pts.size === 0) tap = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 1.18 : 1 / 1.18);
      },
      { passive: false }
    );
  }

  #pick(wx, wz) {
    // snap to the nearest road so the pin is reachable
    const near = this.roads.nearestRoad(wx, wz, Math.max(60, this.mpp * 30));
    if (!near) {
      this.info.textContent = 'No road near there — tap closer to a street';
      this.info.classList.add('show');
      return;
    }
    const name = near.road.name || near.road.ref || 'Map pin';
    this.onDestination(near.x, near.z, name);
    this.dirty = true;
  }

  // called every frame from the game loop
  update(dt, px, pz, yaw) {
    if (!this.open) return;
    this.player.x = px;
    this.player.z = pz;
    this.player.yaw = yaw;
    this.redrawT += dt;
    if (this.gps.version !== this.lastVersion) {
      this.lastVersion = this.gps.version;
      this.dirty = true;
    }
    if (!this.dirty && this.redrawT < 0.25) return;
    this.redrawT = 0;
    this.dirty = false;
    this.#draw();
  }

  #draw() {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    const W = innerWidth;
    const H = innerHeight;
    const hf = this.hf;
    const mm = this.minimap;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#183d55';
    ctx.fillRect(0, 0, W, H);
    // raster base (land, sea, all roads) from the minimap's world canvas
    const s = mm.scale; // base px per metre
    const [wx0, wz0] = this.toWorld(0, 0);
    const sx = (wx0 - hf.minX) * s;
    const sy = (wz0 - hf.minZ) * s;
    const sw = W * this.mpp * s;
    const sh = H * this.mpp * s;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mm.base, sx, sy, sw, sh, 0, 0, W, H);
    const k = 1 / this.mpp; // CSS px per metre
    const X = (x) => (x - this.cx) * k + W / 2;
    const Y = (z) => (z - this.cz) * k + H / 2;

    // crisp vector roads when zoomed in
    if (this.mpp < 9) {
      const cs = this.roads.cell;
      const [ax, az] = this.toWorld(0, 0);
      const [bx, bz] = this.toWorld(W, H);
      const seen = new Set();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const majors = [];
      const minors = [];
      for (let gz = Math.floor(az / cs); gz <= Math.floor(bz / cs); gz++) {
        for (let gx = Math.floor(ax / cs); gx <= Math.floor(bx / cs); gx++) {
          const list = this.roads.grid.get(this.roads.gridKey(gx, gz));
          if (!list) continue;
          for (const r of list) {
            if (seen.has(r)) continue;
            seen.add(r);
            (r.major ? majors : minors).push(r);
          }
        }
      }
      const stroke = (list, color, wMul, minW) => {
        ctx.strokeStyle = color;
        for (const r of list) {
          ctx.lineWidth = Math.max(minW, roadClass(r.cls).width * k * wMul);
          ctx.beginPath();
          for (let i = 0; i < r.pts.length; i++) {
            const p = r.pts[i];
            if (i === 0) ctx.moveTo(X(p[0]), Y(p[1]));
            else ctx.lineTo(X(p[0]), Y(p[1]));
          }
          ctx.stroke();
        }
      };
      stroke(minors, '#8e9aa3', 1, 1.2);
      stroke(majors, '#1f2a33', 1.25, 3);
      stroke(majors, '#f1d58a', 1, 2);
      // street names on majors when close
      if (this.mpp < 3) {
        ctx.font = '600 11px "Trebuchet MS", sans-serif';
        ctx.fillStyle = '#f4f7fa';
        ctx.strokeStyle = 'rgba(10,18,26,0.85)';
        ctx.lineWidth = 3;
        const done = new Set();
        for (const r of majors.concat(minors)) {
          if (!r.name || done.has(r.name) || r.len < 120) continue;
          const p = r.pts[Math.floor(r.pts.length / 2)];
          const x = X(p[0]);
          const y = Y(p[1]);
          if (x < 20 || y < 50 || x > W - 20 || y > H - 20) continue;
          done.add(r.name);
          ctx.strokeText(r.name, x + 4, y - 4);
          ctx.fillText(r.name, x + 4, y - 4);
        }
      }
    }

    // route
    const route = this.gps.route;
    if (route) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < route.pts.length; i++) {
        const p = route.pts[i];
        if (i === 0) ctx.moveTo(X(p[0]), Y(p[1]));
        else ctx.lineTo(X(p[0]), Y(p[1]));
      }
      ctx.strokeStyle = 'rgba(10,18,26,0.85)';
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = '#3fa9ff';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    // destination pin
    const d = this.gps.dest;
    if (d) {
      const x = X(d.x);
      const y = Y(d.z);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y - 16, 9, Math.PI * 0.8, Math.PI * 2.2);
      ctx.closePath();
      ctx.fillStyle = '#ff5a4a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - 16, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    // player
    ctx.save();
    ctx.translate(X(this.player.x), Y(this.player.z));
    ctx.rotate(Math.atan2(Math.sin(this.player.yaw), -Math.cos(this.player.yaw)));
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffcf5c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(10,18,26,0.9)';
    ctx.stroke();
    ctx.restore();
    // scale bar
    const barM = this.mpp < 2 ? 100 : this.mpp < 6 ? 500 : this.mpp < 15 ? 1000 : 5000;
    const barPx = barM * k;
    ctx.fillStyle = 'rgba(10,18,26,0.7)';
    ctx.fillRect(12, H - 30, barPx + 16, 20);
    ctx.fillStyle = '#f4f7fa';
    ctx.fillRect(20, H - 18, barPx, 3);
    ctx.font = '10px sans-serif';
    ctx.fillText(barM >= 1000 ? `${barM / 1000} km` : `${barM} m`, 22, H - 21);

    if (route) {
      this.info.textContent = `${d ? d.name : 'Route'} · ${formatDistance(this.gps.distance || route.len)} by road`;
      this.info.classList.add('show');
    } else if (d) {
      this.info.textContent = `${d.name} · no road route found`;
      this.info.classList.add('show');
    } else this.info.classList.remove('show');
  }
}
