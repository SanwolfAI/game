import { roadClass } from '../world/roads.js';
import { formatDistance } from '../game/gps.js';
import { PLACES, toXZ, placeAt } from '../core/geo.js';

// Google-Maps-like road styles. minPx holds at every zoom, so freeways never
// shrink to look like side streets. m = real width multiplier when zoomed in.
const STYLES = [
  { id: 'minor', fill: '#dfe4e8', casing: null, minPx: 1.3, m: 1 },
  { id: 'tertiary', fill: '#ffffff', casing: '#56616b', minPx: 2.2, m: 1 },
  { id: 'secondary', fill: '#fff0b3', casing: '#6e6447', minPx: 3, m: 1.1 },
  { id: 'link', fill: '#ffd36a', casing: '#7d6417', minPx: 2.6, m: 1 },
  { id: 'primary', fill: '#ffd75e', casing: '#7d6417', minPx: 4.2, m: 1.2 },
  { id: 'mlink', fill: '#f7b46a', casing: '#8a4a12', minPx: 3, m: 1 },
  { id: 'motorway', fill: '#f5913a', casing: '#7d3f0c', minPx: 6, m: 1.3 }
];
const TIER = {
  motorway: 6, motorway_link: 5, trunk: 4, primary: 4, trunk_link: 3, primary_link: 3,
  secondary: 2, secondary_link: 2, tertiary: 1, tertiary_link: 1
};
const BIG_PLACE = { city: 1, town: 1, suburb: 1, township: 1 };

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
          CBD side streets: texture from "Road_ Avenue_ street" by ahmagh2e, <a href="https://sketchfab.com/3d-models/road--avenue--street-7f657c3eceb343ceaf5e542c50dab27a" target="_blank" rel="noopener">Sketchfab</a>, CC BY 4.0 (cropped and resized).<br>
          People: "Ps2 style Senegalese Casamance male and female" and "Ps2 style karnatid tamil indian male and female" by Humans of the World, <a href="https://sketchfab.com/humansoftheworld" target="_blank" rel="noopener">Sketchfab</a>, CC BY 4.0; "Low-Poly Construction workers (animated)" by Jungle Jim, <a href="https://sketchfab.com/3d-models/low-poly-construction-workers-animated-7b62e6e1b58c476f8b421dd007a4ff90" target="_blank" rel="noopener">Sketchfab</a>, CC BY 4.0 (posed and baked for the game).<br>
          People: Quaternius Ultimate Modular Men &amp; Women, CC0.<br>
          Benches, planters and bins: Poly Haven models by Kirill Sannikov, James Ray Cock and GurJas Studios (CC0).<br>
          HD cars (Polo, E30 in traffic, Hilux, SAPS bakkie), wheels, made-up "ND" number plates, sky, clouds and street-light glow: made in code for this game (CC0).<br>
          Terrain: AWS Terrain Tiles (SRTM, NASA / Mapzen). Street-level reference: Mapillary contributors, CC BY-SA 4.0. Street imagery attributes derived from Mapillary (CC BY-SA) (house walls, roofs and fences per area).<br>
          Kenney City Kit Roads and Nature Kit (CC0). Textures: Poly Haven (CC0); HD pack: asphalt_02, brushed_concrete, concrete_pavers, sparse_grass, white_plaster_rough_01, red_brick_03, corrugated_iron_02 (polyhaven.com, CC0). SA road signs: SADC-RTSM drawings, Wikimedia Commons (public domain); direction boards drawn in-game in SARTSM style from OpenStreetMap names.
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
    const dpr = Math.min(devicePixelRatio || 1, 3); // native, like the game view
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

    // Vector roads styled by class. Zoomed out only the bigger classes.
    if (!this.tiers) this.#buildTiers();
    const [ax, az] = this.toWorld(0, 0);
    const [bx, bz] = this.toWorld(W, H);
    const visible = (r) => r.bb[2] >= ax && r.bb[0] <= bx && r.bb[3] >= az && r.bb[1] <= bz;
    const minTier = this.mpp < 9 ? 0 : this.mpp < 22 ? 2 : 3;
    const far = this.mpp > 30 ? 0.75 : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const shown = [];
    for (let t = minTier; t < STYLES.length; t++) {
      const st = STYLES[t];
      const list = this.tiers[t];
      const vis = [];
      for (const r of list) if (visible(r)) vis.push(r);
      shown.push(vis);
      if (!vis.length) continue;
      const w = Math.max(st.minPx * far, roadClass(vis[0].cls).width * k * st.m);
      ctx.beginPath();
      for (const r of vis) {
        for (let i = 0; i < r.pts.length; i++) {
          const q = r.pts[i];
          if (i === 0) ctx.moveTo(X(q[0]), Y(q[1]));
          else ctx.lineTo(X(q[0]), Y(q[1]));
        }
      }
      if (st.casing) {
        ctx.strokeStyle = st.casing;
        ctx.lineWidth = w + 2;
        ctx.stroke();
      }
      ctx.strokeStyle = st.fill;
      ctx.lineWidth = w;
      ctx.stroke();
    }
    this.#labels(ctx, W, H, X, Y, shown, minTier);

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
    // player: halo, arrow and a "You are here" tag with street and suburb
    const ppx = X(this.player.x);
    const ppy = Y(this.player.z);
    ctx.beginPath();
    ctx.arc(ppx, ppy, 22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(63,169,255,0.22)';
    ctx.fill();
    ctx.save();
    ctx.translate(ppx, ppy);
    ctx.rotate(Math.atan2(Math.sin(this.player.yaw), -Math.cos(this.player.yaw)));
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fillStyle = '#3fa9ff';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
    const here = placeAt(this.player.x, this.player.z);
    const line1 = 'You are here';
    const line2 = [this.street || '', here && here.name ? here.name : ''].filter((v) => v).join(' · ');
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    const w1 = ctx.measureText(line1).width;
    ctx.font = '11px "Trebuchet MS", sans-serif';
    const w2 = Math.min(ctx.measureText(line2).width, 300);
    const bw = Math.max(w1, w2) + 16;
    let tx = ppx - bw / 2;
    if (tx < 8) tx = 8;
    if (tx + bw > W - 8) tx = W - 8 - bw;
    let ty = ppy - 62;
    if (ty < 46) ty = ppy + 26;
    ctx.fillStyle = 'rgba(10,18,26,0.88)';
    ctx.fillRect(tx, ty, bw, line2 ? 36 : 22);
    ctx.fillStyle = '#3fa9ff';
    ctx.fillRect(tx, ty, 3, line2 ? 36 : 22);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 12px "Trebuchet MS", sans-serif';
    ctx.fillText(line1, tx + 9, ty + 15);
    if (line2) {
      ctx.fillStyle = '#c9d6e0';
      ctx.font = '11px "Trebuchet MS", sans-serif';
      ctx.fillText(line2, tx + 9, ty + 30, 300);
    }
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

  #buildTiers() {
    this.tiers = [];
    for (let t = 0; t < STYLES.length; t++) this.tiers.push([]);
    for (const r of this.roads.roads) {
      if (!r.bb) {
        let x0 = Infinity;
        let z0 = Infinity;
        let x1 = -Infinity;
        let z1 = -Infinity;
        for (const q of r.pts) {
          if (q[0] < x0) x0 = q[0];
          if (q[0] > x1) x1 = q[0];
          if (q[1] < z0) z0 = q[1];
          if (q[1] > z1) z1 = q[1];
        }
        r.bb = [x0, z0, x1, z1];
      }
      this.tiers[TIER[r.cls] || 0].push(r);
    }
    // place labels: big areas first
    this.placeList = PLACES.map((p) => {
      const xz = toXZ(p.lon, p.lat);
      return { name: p.name, kind: p.kind, r: p.r || 700, x: xz[0], z: xz[1] };
    }).sort((a, b) => b.r - a.r);
  }

  // Labels by zoom with simple collision skip: areas when far, then major
  // roads, shields (N2, N3, M4...) and landmarks, and every street up close.
  #labels(ctx, W, H, X, Y, shown, minTier) {
    const mpp = this.mpp;
    const boxes = [];
    const fits = (x, y, w, h) => {
      if (x < 4 || y < 44 || x + w > W - 84 || y + h > H - 34) return false;
      for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false;
      boxes.push([x, y, w, h]);
      return true;
    };
    // keep the "You are here" tag clear
    boxes.push([X(this.player.x) - 160, Y(this.player.z) - 64, 320, 100]);
    const text = (str, x, y, font, fill, halo) => {
      ctx.font = font;
      ctx.lineWidth = 3;
      ctx.strokeStyle = halo;
      ctx.strokeText(str, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(str, x, y);
    };
    // route shields on motorway / trunk / primary
    const tierIdx = (t) => t - minTier;
    const shieldRefs = new Map();
    for (const t of [6, 5, 4]) {
      const vis = shown[tierIdx(t)];
      if (!vis) continue;
      for (const r of vis) {
        if (!r.ref || r.len < 200) continue;
        const ref = r.ref.split(';')[0].trim();
        const q = r.pts[Math.floor(r.pts.length / 2)];
        const x = X(q[0]);
        const y = Y(q[1]);
        const prev = shieldRefs.get(ref);
        if (prev && prev.some((p) => Math.hypot(p[0] - x, p[1] - y) < 220)) continue;
        ctx.font = '700 11px "Trebuchet MS", sans-serif';
        const w = ctx.measureText(ref).width + 10;
        if (!fits(x - w / 2, y - 9, w, 18)) continue;
        if (!prev) shieldRefs.set(ref, [[x, y]]);
        else prev.push([x, y]);
        const motor = t >= 5;
        ctx.fillStyle = motor ? '#1d6b3a' : '#ffffff';
        ctx.fillRect(x - w / 2, y - 9, w, 18);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = motor ? '#ffffff' : '#7d6417';
        ctx.strokeRect(x - w / 2 + 1, y - 8, w - 2, 16);
        ctx.fillStyle = motor ? '#ffffff' : '#222';
        ctx.fillText(ref, x - w / 2 + 5, y + 4);
      }
    }
    // areas / suburbs
    for (const p of this.placeList) {
      const big = BIG_PLACE[p.kind];
      const lm = p.kind === 'landmark' || p.kind === 'beach';
      if (lm && mpp >= 12) continue;
      if (!big && !lm && mpp >= 4) continue;
      if (big && mpp > 40 && p.r < 1000) continue;
      const x = X(p.x);
      const y = Y(p.z);
      if (x < -50 || x > W + 50 || y < -20 || y > H + 20) continue;
      const font = lm ? 'italic 600 11px "Trebuchet MS", sans-serif' : big ? '700 13px "Trebuchet MS", sans-serif' : '600 11px "Trebuchet MS", sans-serif';
      ctx.font = font;
      const label = p.name;
      const w = ctx.measureText(label).width;
      if (!fits(x - w / 2, y - 12, w, 15)) continue;
      text(label, x - w / 2, y, font, lm ? '#ffd6a0' : '#f4f7fa', 'rgba(10,18,26,0.85)');
    }
    // road names: majors at mid zoom, every street when close
    if (mpp < 12) {
      const done = new Set();
      const font = '600 11px "Trebuchet MS", sans-serif';
      ctx.font = font;
      for (let t = shown.length - 1; t >= 0; t--) {
        const real = t + minTier;
        if (mpp >= 3 && real < 2) break;
        for (const r of shown[t]) {
          if (!r.name || done.has(r.name)) continue;
          const minLen = mpp * 90;
          if (r.len < minLen) continue;
          const q = r.pts[Math.floor(r.pts.length / 2)];
          const x = X(q[0]);
          const y = Y(q[1]);
          const w = ctx.measureText(r.name).width;
          if (!fits(x - w / 2, y - 14, w, 14)) continue;
          done.add(r.name);
          text(r.name, x - w / 2, y - 3, font, '#f4f7fa', 'rgba(10,18,26,0.85)');
        }
      }
    }
    // real landmarks: big ones from mid zoom, everything named up close
    if (this.landmarks && this.landmarkCats && mpp < 7) {
      const BIG = { hospital: 1, mall: 1, stadium: 1, campus: 1, station: 1, police: 1 };
      const font = '700 10px "Trebuchet MS", sans-serif';
      for (const l of this.landmarks) {
        if (mpp >= 2.4 && !BIG[l.k]) continue;
        const cat = this.landmarkCats[l.k];
        if (!cat) continue;
        const x = X(l.x);
        const y = Y(l.z);
        if (x < 0 || x > W || y < 0 || y > H) continue;
        ctx.font = font;
        const w = ctx.measureText(l.n).width + 22;
        if (!fits(x - 8, y - 9, w, 18)) continue;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = cat.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 9px "Trebuchet MS", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cat.icon, x, y + 3);
        ctx.textAlign = 'left';
        text(l.n, x + 10, y + 4, font, '#ffffff', 'rgba(10,18,26,0.85)');
      }
    }
    // points of interest up close: motorway exits
    if (mpp < 3 && this.features) {
      const font = '600 10px "Trebuchet MS", sans-serif';
      for (const f of this.features) {
        if (f.k !== 'exit') continue;
        const x = X(f.x);
        const y = Y(f.z);
        if (x < 0 || x > W || y < 0 || y > H) continue;
        const label = `Exit${f.ref ? ' ' + f.ref : ''}${f.name ? ' · ' + f.name : ''}`;
        ctx.font = font;
        const w = ctx.measureText(label).width + 10;
        if (!fits(x - 5, y - 13, w, 15)) continue;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#1d6b3a';
        ctx.fill();
        text(label, x + 6, y - 2, font, '#bff0cf', 'rgba(10,18,26,0.85)');
      }
    }
  }
}
