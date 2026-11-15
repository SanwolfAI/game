import { clamp } from '../core/utils.js';
import { roadClass } from '../world/roads.js';

const VIEW_METERS = 1900;
const WATER = '#183d55';
const LAND_LOW = '#4c6b45';
const LAND_MID = '#5f7b4a';
const LAND_HIGH = '#837c58';
const SAND = '#b7a878';

export function createMinimap(hf, roads) {
  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const worldW = (hf.cols - 1) * hf.cell;
  const worldH = (hf.rows - 1) * hf.cell;
  const scale = Math.min(2048 / worldW, 2048 / worldH);
  const off = document.createElement('canvas');
  off.width = Math.max(2, Math.ceil(worldW * scale));
  off.height = Math.max(2, Math.ceil(worldH * scale));
  const oc = off.getContext('2d');
  oc.fillStyle = WATER;
  oc.fillRect(0, 0, off.width, off.height);

  for (let iz = 0; iz < hf.rows; iz += 3) {
    for (let ix = 0; ix < hf.cols; ix += 3) {
      const i = hf.idx(ix, iz);
      if (hf.water[i]) continue;
      const h = hf.height[i], coast = hf.dist[i];
      oc.fillStyle = coast < 90 ? SAND : h < 55 ? LAND_LOW : h < 120 ? LAND_MID : LAND_HIGH;
      oc.fillRect(ix * hf.cell * scale, iz * hf.cell * scale, 3 * hf.cell * scale + 1, 3 * hf.cell * scale + 1);
    }
  }
  oc.lineCap = 'round'; oc.lineJoin = 'round';
  for (const road of roads.roads) {
    oc.beginPath();
    for (let i = 0; i < road.pts.length; i++) {
      const p = road.pts[i], px = (p[0] - hf.minX) * scale, py = (p[1] - hf.minZ) * scale;
      if (!i) oc.moveTo(px, py); else oc.lineTo(px, py);
    }
    const info = roadClass(road.cls);
    oc.strokeStyle = road.major ? '#d8e2e9' : '#' + info.color.toString(16).padStart(6, '0');
    oc.globalAlpha = road.major ? .95 : .62;
    oc.lineWidth = clamp(info.width * scale * 2.4, .45, 2.4);
    oc.stroke();
  }
  oc.globalAlpha = 1;

  let player = { x: 0, z: 0, yaw: 0, dest: null }, opened = false, zoom = 1;
  const overlay = document.createElement('section');
  overlay.id = 'full-map';
  overlay.innerHTML = '<header><strong>DURBAN · FULL MAP</strong><button type="button" id="map-close">CLOSE ✕</button></header><div class="full-map-stage"><canvas id="full-map-canvas"></canvas></div><footer><button type="button" id="map-minus">−</button><span id="map-zoom-label">FIT</span><button type="button" id="map-plus">+</button><button type="button" id="map-reset">FIT DURBAN</button></footer>';
  document.body.appendChild(overlay);
  const full = overlay.querySelector('#full-map-canvas'), fctx = full.getContext('2d');
  function resizeFull() {
    const r = full.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    full.width = Math.max(1, Math.floor(r.width * dpr));
    full.height = Math.max(1, Math.floor(r.height * dpr));
    drawFull();
  }
  function drawArrow(c, x, y, yaw, radius) {
    c.save(); c.translate(x, y); c.rotate(-yaw);
    c.beginPath(); c.moveTo(0, -radius); c.lineTo(radius * .7, radius); c.lineTo(0, radius * .48); c.lineTo(-radius * .7, radius); c.closePath();
    c.fillStyle = '#ffcf5c'; c.fill(); c.lineWidth = 2; c.strokeStyle = '#101820'; c.stroke(); c.restore();
  }
  function drawFull() {
    if (!opened || !full.width || !full.height) return;
    const w = full.width, h = full.height, fit = Math.min(w / off.width, h / off.height);
    const k = fit * zoom, dw = off.width * k, dh = off.height * k;
    fctx.clearRect(0, 0, w, h); fctx.fillStyle = WATER; fctx.fillRect(0, 0, w, h);
    let left = (w - dw) / 2, top = (h - dh) / 2;
    if (zoom > 1) {
      const px = (player.x - hf.minX) * scale, py = (player.z - hf.minZ) * scale;
      left = w / 2 - px * k; top = h / 2 - py * k;
    }
    fctx.drawImage(off, left, top, dw, dh);
    if (player.dest) {
      const dx = (player.dest.x - player.x) * scale * k, dy = (player.dest.z - player.z) * scale * k;
      fctx.strokeStyle = '#ffcf5c'; fctx.lineWidth = 3; fctx.setLineDash([8, 8]);
      fctx.beginPath(); fctx.moveTo(w / 2, h / 2); fctx.lineTo(w / 2 + dx, h / 2 + dy); fctx.stroke(); fctx.setLineDash([]);
    }
    drawArrow(fctx, w / 2, h / 2, player.yaw, 17);
    overlay.querySelector('#map-zoom-label').textContent = zoom === 1 ? 'FIT' : zoom.toFixed(1) + '×';
  }
  function openMap() {
    opened = true; overlay.classList.add('open');
    requestAnimationFrame(resizeFull);
  }
  function closeMap() { opened = false; overlay.classList.remove('open'); }
  canvas.addEventListener('click', openMap);
  canvas.addEventListener('pointerup', (e) => { if (e.detail === 0) openMap(); });
  overlay.querySelector('#map-close').addEventListener('click', closeMap);
  overlay.querySelector('#map-plus').addEventListener('click', () => { zoom = Math.min(12, zoom * 1.4); drawFull(); });
  overlay.querySelector('#map-minus').addEventListener('click', () => { zoom = Math.max(1, zoom / 1.4); drawFull(); });
  overlay.querySelector('#map-reset').addEventListener('click', () => { zoom = 1; drawFull(); });
  addEventListener('resize', () => { if (opened) resizeFull(); });

  function drawPlayerArrow(x, y, yaw) { drawArrow(ctx, x, y, yaw, 11); }
  function update(x, z, yaw, dest) {
    player = { x, z, yaw, dest };
    ctx.clearRect(0, 0, size, size);
    const sw = VIEW_METERS * scale, sx = (x - hf.minX) * scale - sw / 2, sy = (z - hf.minZ) * scale - sw / 2;
    ctx.drawImage(off, sx, sy, sw, sw, 0, 0, size, size);
    const center = size / 2;
    if (dest) {
      const s = size / sw, edge = 14;
      let mx = center + (dest.x - x) * s, my = center + (dest.z - z) * s;
      const dx = mx - center, dy = my - center, max = center - edge, dist = Math.hypot(dx, dy);
      if (dist > max) { mx = center + dx / dist * max; my = center + dy / dist * max; }
      ctx.save(); ctx.strokeStyle = '#ffcf5c'; ctx.globalAlpha = .65; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(mx, my); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(mx, my, 6.5, 0, Math.PI * 2); ctx.fillStyle = '#ffcf5c'; ctx.fill(); ctx.restore();
    }
    drawPlayerArrow(center, center, yaw);
    if (opened) drawFull();
    return canvas;
  }
  return { update, canvas, viewMeters: VIEW_METERS, open: openMap, close: closeMap };
}
