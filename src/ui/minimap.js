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
  // Crisp on any screen: the drawing code works in the canvas' 336-unit
  // layout, the buffer is sized to its CSS box x the native pixel ratio.
  const size = canvas.width; // 336 drawing units
  const cssW = Math.max(canvas.clientWidth || 0, 168);
  const k = Math.max(1, (cssW * Math.min(3, devicePixelRatio || 1)) / size);
  canvas.width = canvas.height = Math.round(size * k);
  const ctx = canvas.getContext('2d');

  const worldW = (hf.cols - 1) * hf.cell;
  const worldH = (hf.rows - 1) * hf.cell;
  const scale = Math.min(2048 / worldW, 2048 / worldH);

  const off = document.createElement('canvas');
  off.width = Math.max(2, Math.ceil(worldW * scale));
  off.height = Math.max(2, Math.ceil(worldH * scale));
  const oc = off.getContext('2d');

  oc.fillStyle = WATER;
  oc.fillRect(0, 0, off.width, off.height);

  const stepCells = 3;
  for (let iz = 0; iz < hf.rows; iz += stepCells) {
    for (let ix = 0; ix < hf.cols; ix += stepCells) {
      const i = hf.idx(ix, iz);
      if (hf.water[i]) continue;
      const h = hf.height[i];
      const coast = hf.signedCoastDistance(hf.minX + ix * hf.cell, hf.minZ + iz * hf.cell);
      let color;
      if (coast < 60) color = SAND;
      else if (h < 55) color = LAND_LOW;
      else if (h < 120) color = LAND_MID;
      else color = LAND_HIGH;
      oc.fillStyle = color;
      oc.fillRect(ix * hf.cell * scale, iz * hf.cell * scale, stepCells * hf.cell * scale + 1, stepCells * hf.cell * scale + 1);
    }
  }

  oc.lineCap = 'round';
  oc.lineJoin = 'round';
  for (const road of roads.roads) {
    oc.beginPath();
    for (let i = 0; i < road.pts.length; i++) {
      const p = road.pts[i];
      const px = (p[0] - hf.minX) * scale;
      const py = (p[1] - hf.minZ) * scale;
      if (i === 0) oc.moveTo(px, py);
      else oc.lineTo(px, py);
    }
    const info = roadClass(road.cls);
    const c = '#' + info.color.toString(16).padStart(6, '0');
    oc.strokeStyle = road.major ? '#c9d6df' : c;
    oc.globalAlpha = road.major ? 0.9 : 0.55;
    oc.lineWidth = clamp(info.width * scale * 2.4, 0.45, 2.4);
    oc.stroke();
  }
  oc.globalAlpha = 1;

  function drawPlayerArrow(x, y, yaw) {
    const angle = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-7.5, 7);
    ctx.closePath();
    ctx.fillStyle = '#ffcf5c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(10,18,26,0.85)';
    ctx.stroke();
    ctx.restore();
  }

  let smoothYaw = null;
  function update(x, z, yaw, dest, route = null) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, size, size);
    const sw = VIEW_METERS * scale;
    const sx = (x - hf.minX) * scale - sw / 2;
    const sy = (z - hf.minZ) * scale - sw / 2;
    // Integer source rect + fractional destination offset: some WebViews snap
    // fractional source rects to whole pixels, which made the map jump under
    // the (fixed, centred) arrow.
    const k0 = size / sw;
    const sxi = Math.floor(sx);
    const syi = Math.floor(sy);
    const swi = Math.ceil(sw) + 2;
    ctx.drawImage(off, sxi, syi, swi, swi, -(sx - sxi) * k0, -(sy - syi) * k0, swi * k0, swi * k0);
    // smoothed heading for the arrow (shortest way round)
    if (smoothYaw === null) smoothYaw = yaw;
    let dy = yaw - smoothYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    smoothYaw += dy * 0.3;
    yaw = smoothYaw;

    const center = size / 2;
    if (route) {
      const s = size / sw;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      const pts = route.pts;
      const lim = VIEW_METERS;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i][0] - x;
        const dz = pts[i][1] - z;
        if (Math.abs(dx) > lim * 4 || Math.abs(dz) > lim * 4) {
          // far outside: break the line (canvas clips the nearby part itself)
          started = false;
          continue;
        }
        const px = center + dx * s;
        const py = center + dz * s;
        if (!started) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        started = true;
      }
      ctx.strokeStyle = 'rgba(10,18,26,0.8)';
      ctx.lineWidth = 13;
      ctx.stroke();
      ctx.strokeStyle = '#3fa9ff';
      ctx.lineWidth = 8.5;
      ctx.stroke();
      ctx.restore();
    }
    if (dest) {
      const s = size / sw;
      const edge = 14;
      let mx = center + (dest.x - x) * s;
      let my = center + (dest.z - z) * s;
      const dx = mx - center;
      const dy = my - center;
      const max = center - edge;
      const dist = Math.hypot(dx, dy);
      if (dist > max) {
        mx = center + (dx / dist) * max;
        my = center + (dy / dist) * max;
      }
      ctx.save();
      ctx.strokeStyle = '#ffcf5c';
      ctx.globalAlpha = route ? 0 : 0.6;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(mx, my, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcf5c';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(10,18,26,0.85)';
      ctx.stroke();
      ctx.restore();
    }

    drawPlayerArrow(center, center, yaw);
    return canvas;
  }

  return { update, canvas, viewMeters: VIEW_METERS, base: off, scale, drawPlayerArrow };
}
