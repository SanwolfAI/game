import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32 } from '../core/utils.js';

// Boundary walls, palisade and mesh fences along house plot fronts, as seen on
// Mapillary street photos of each area (src/data/durban-house-styles.json).
// One small atlas (512 x 256, 4 x 2 tiles) and one alpha-tested material, so
// every 250 m building cell adds at most one fence mesh (and it is hidden
// beyond a few hundred metres).
// Loops only, no array spreads (Android WebView stack).

// tile index and height (m) per fence type
export const FENCE = {
  palisade: { tile: 0, gate: 1, h: 1.8 },
  mesh: { tile: 2, gate: 2, h: 1.3 },
  precast: { tile: 3, gate: 6, h: 1.8 },
  lowwall: { tile: 4, gate: 1, h: 1.1 },
  highwall: { tile: 4, gate: 6, h: 2.1 },
  brickwall: { tile: 5, gate: 6, h: 1.5 },
  wallpal: { tile: 7, gate: 1, h: 1.9 }
};
// Opaque wall types take the boundary wall paint, steel ones the steel paint.
export const PAINTED_WALL = { lowwall: true, highwall: true, wallpal: true };
export const PANEL = 2.4; // m of fence per atlas tile

const TW = 128;
const TH = 128;

function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = TW * 4;
  c.height = TH * 2;
  const g = c.getContext('2d');
  const rng = mulberry32(5150);
  const at = (i) => [(i % 4) * TW, Math.floor(i / 4) * TH];
  const pales = (x0, y0, y1, step, w, col, spikes) => {
    g.fillStyle = col;
    for (let x = x0 + 3; x < x0 + TW - 2; x += step) {
      g.fillRect(x, y0 + 6, w, y1 - y0 - 6);
      if (spikes) {
        // trident tip
        g.beginPath();
        g.moveTo(x - 1, y0 + 7);
        g.lineTo(x + w / 2, y0);
        g.lineTo(x + w + 1, y0 + 7);
        g.fill();
      }
    }
  };
  const plaster = (x, y, w, h, base) => {
    g.fillStyle = base;
    g.fillRect(x, y, w, h);
    for (let i = 0; i < 500; i++) {
      const v = rng() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${v},${v},${v},${0.08 * rng()})`;
      g.fillRect(x + rng() * w, y + rng() * h, 2, 2);
    }
    // coping on top, dirt at the bottom
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(x, y, w, 4);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x, y + 4, w, 2);
    g.fillStyle = 'rgba(90,70,50,0.25)';
    g.fillRect(x, y + h - 10, w, 10);
  };
  let x, y;
  // 0 palisade: steel pales with trident tips, two rails, posts
  [x, y] = at(0);
  pales(x, y + 4, y + TH, 9, 4, '#f0f0ee', true);
  g.fillStyle = '#e0e0dc';
  g.fillRect(x, y + 22, TW, 5);
  g.fillRect(x, y + TH - 22, TW, 5);
  g.fillRect(x, y + 2, 5, TH);
  // 1 palisade gate: framed, denser pales
  [x, y] = at(1);
  pales(x, y + 6, y + TH, 7, 3.5, '#f0f0ee', true);
  g.fillStyle = '#e6e6e2';
  g.fillRect(x + 1, y + 16, TW - 2, 5);
  g.fillRect(x + 1, y + TH - 8, TW - 2, 6);
  g.fillRect(x + 1, y + 16, 5, TH - 16);
  g.fillRect(x + TW - 6, y + 16, 5, TH - 16);
  g.fillRect(x + TW / 2 - 2, y + 16, 4, TH - 16);
  // 2 diamond wire mesh on round poles, top wire
  [x, y] = at(2);
  g.save();
  g.beginPath();
  g.rect(x, y, TW, TH);
  g.clip();
  g.strokeStyle = 'rgba(225,225,222,0.95)';
  g.lineWidth = 1.6;
  for (let k = -TH; k < TW + TH; k += 9) {
    g.beginPath();
    g.moveTo(x + k, y + 8);
    g.lineTo(x + k + TH, y + TH);
    g.stroke();
    g.beginPath();
    g.moveTo(x + k, y + TH);
    g.lineTo(x + k + TH, y + 8);
    g.stroke();
  }
  g.restore();
  g.fillStyle = '#d9d9d6';
  g.fillRect(x, y + 6, TW, 3);
  g.fillRect(x + 2, y + 4, 6, TH - 4);
  // 3 precast concrete panel wall
  [x, y] = at(3);
  g.fillStyle = '#c9c6bf';
  g.fillRect(x, y, TW, TH);
  for (let i = 0; i < 700; i++) {
    const v = rng() < 0.5 ? 60 : 230;
    g.fillStyle = `rgba(${v},${v},${v},${0.12 * rng()})`;
    g.fillRect(x + rng() * TW, y + rng() * TH, 2, 2);
  }
  for (let r = 0; r < 4; r++) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x, y + 10 + r * 30, TW, 2);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x, y + 12 + r * 30, TW, 1);
    // pebble texture strip
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.fillRect(x, y + 18 + r * 30, TW, 14);
  }
  g.fillStyle = '#b9b5ad';
  g.fillRect(x, y, 10, TH);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x + 10, y, 2, TH);
  // 4 plastered wall (tinted)
  [x, y] = at(4);
  plaster(x, y, TW, TH, '#f2efe8');
  g.fillStyle = 'rgba(0,0,0,0.07)';
  g.fillRect(x, y, 6, TH); // pier joint
  // 5 face brick wall with a brick-on-edge coping
  [x, y] = at(5);
  for (let row = 0; row < TH / 6; row++) {
    const off = row % 2 ? 6 : 0;
    for (let bx = -12; bx < TW; bx += 12) {
      const v = 0.82 + rng() * 0.32;
      g.fillStyle = `rgb(${Math.round(160 * v)},${Math.round(88 * v)},${Math.round(60 * v)})`;
      g.fillRect(x + bx + off, y + row * 6, 11, 5);
    }
  }
  g.fillStyle = '#8a4a34';
  g.fillRect(x, y, TW, 7);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x, y + 7, TW, 2);
  // 6 solid steel sliding gate (ribbed sheet)
  [x, y] = at(6);
  g.fillStyle = '#d6d6d2';
  g.fillRect(x, y + 6, TW, TH - 6);
  for (let bx = 0; bx < TW; bx += 8) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(x + bx, y + 6, 2, TH - 6);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x + bx + 4, y + 6, 1, TH - 6);
  }
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(x, y + 6, TW, 3);
  g.fillRect(x, y + TH - 4, TW, 4);
  // 7 low plastered wall with palisade on top
  [x, y] = at(7);
  plaster(x, y + TH / 2, TW, TH / 2, '#f2efe8');
  pales(x, y + 4, y + TH / 2, 9, 3.5, '#2e3033', true);
  g.fillStyle = '#2e3033';
  g.fillRect(x, y + 18, TW, 4);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  g.fillRect(x, y + TH / 2, 6, TH / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY; // GPU max (main.js)
  return tex;
}

let shared = null;
export function fenceMaterial() {
  if (shared) return shared;
  shared = new THREE.MeshLambertMaterial({ vertexColors: true, map: paintAtlas(), alphaTest: 0.5, side: THREE.DoubleSide });
  return shared;
}

// tile UV rectangle with a 6 px gutter (mipmaps bleed otherwise)
export function tileUV(i) {
  const u0 = (i % 4) / 4 + 6 / 512;
  const u1 = (i % 4 + 1) / 4 - 6 / 512;
  const v1 = 1 - Math.floor(i / 4) / 2 - 3 / 256; // canvas top = v 1 (flipY)
  const v0 = 1 - (Math.floor(i / 4) + 1) / 2 + 4 / 256;
  return [u0, v0, u1, v1];
}

export class FenceBuf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.tris = 0;
  }
  // vertical panel from (x0,z0) to (x1,z1), bottoms g0/g1, height h,
  // tile i, horizontal fraction of the tile used (f)
  panel(x0, z0, g0, x1, z1, g1, h, i, f, c) {
    const [u0, v0, u1, v1] = tileUV(i);
    const ue = u0 + (u1 - u0) * f;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    const P = this.pos;
    const N = this.nor;
    const C = this.col;
    const U = this.uv;
    const v = (x, y, z, u, vv) => {
      P.push(x, y, z);
      N.push(nx, 0, nz);
      C.push(c[0], c[1], c[2]);
      U.push(u, vv);
    };
    const b0 = g0 - 0.25;
    const b1 = g1 - 0.25;
    const vb = v0; // the tile's foot is sunk 0.25 m (slopes)
    v(x0, b0, z0, u0, vb);
    v(x1, b1, z1, ue, vb);
    v(x1, g1 + h, z1, ue, v1);
    v(x0, b0, z0, u0, vb);
    v(x1, g1 + h, z1, ue, v1);
    v(x0, g0 + h, z0, u0, v1);
    this.tris += 2;
  }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.computeBoundingSphere();
    return g;
  }
}
