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

  const stepCells = 3;
  for (let iz = 0; iz < hf.rows; iz += stepCells) {
    for (let ix = 0; ix < hf.cols; ix += stepCells) {
      const i = hf.idx(ix, iz);
      if (hf.water[i]) continue;
      const h = hf.height[i];
      const coast = hf.dist[i];
      let color;
      if (coast < 90) color = SAND;
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

  function update(x, z, yaw, dest) {
    ctx.clearRect(0, 0, size, size);
    const sw = VIEW_METERS * scale;
    const sx = (x - hf.minX) * scale - sw / 2;
    const sy = (z - hf.minZ) * scale - sw / 2;
    ctx.drawImage(off, sx, sy, sw, sw, 0, 0, size, size);

    const center = size / 2;
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
      ctx.globalAlpha = 0.6;
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

  return { update, canvas, viewMeters: VIEW_METERS };
}
