import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32 } from '../core/utils.js';

// Procedural facade/roof texture array (WebGL2 sampler2DArray, repeat-wrapped
// per layer, so one material and one draw call cover every building style).
// RGB = surface colour (walls are near-white so a per-building tint can paint
// them), A = window/glass mask (1 = glass, lit at night).
// One layer spans 4 window bays x 4 floors.

export const LAYER = {
  office: 0,
  glass: 1,
  plaster: 2,
  hotel: 3,
  flats: 4,
  house: 5,
  industrial: 6,
  facebrick: 7,
  roofFlat: 8,
  roofTile: 9,
  roofIron: 10,
  shop: 11,
  glassDark: 12
};
export const LAYER_COUNT = 13;
const S = 256;

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}

function noise(g, rng, alpha, n = 1400, size = 2) {
  for (let i = 0; i < n; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rng()})`;
    g.fillRect(rng() * S, rng() * S, size, size);
  }
}

// Each painter draws colour into `g` and the glass mask (white) into `m`.
const PAINTERS = {
  office(g, m, rng) {
    g.fillStyle = '#e9e7e2';
    g.fillRect(0, 0, S, S);
    noise(g, rng, 0.06);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      // dark spandrel band + ribbon window
      g.fillStyle = '#c9c6bf';
      g.fillRect(0, y + 44, S, 6);
      for (let b = 0; b < 4; b++) {
        const x = b * 64;
        g.fillStyle = '#2d3c4a';
        g.fillRect(x + 4, y + 12, 56, 30);
        m.fillRect(x + 4, y + 12, 56, 30);
        g.fillStyle = 'rgba(160,190,215,0.35)';
        g.fillRect(x + 4, y + 12, 56, 9);
        g.fillStyle = '#d6d3cc';
        g.fillRect(x + 31, y + 12, 3, 30);
      }
    }
  },
  glass(g, m, rng) {
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, '#5f8fae');
    grd.addColorStop(0.5, '#3d6b8c');
    grd.addColorStop(1, '#2e5674');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    m.fillRect(0, 0, S, S);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      g.fillStyle = '#9fb3c2';
      g.fillRect(0, y + 58, S, 6);
      m.clearRect(0, y + 58, S, 6);
      for (let b = 0; b < 8; b++) {
        g.fillStyle = 'rgba(200,215,225,0.8)';
        g.fillRect(b * 32, y, 2, 64);
      }
      // random tinted panels
      for (let b = 0; b < 8; b++) {
        if (rng() < 0.3) {
          g.fillStyle = `rgba(20,40,60,${0.15 + rng() * 0.25})`;
          g.fillRect(b * 32 + 2, y, 30, 58);
        }
      }
    }
  },
  glassDark(g, m, rng) {
    g.fillStyle = '#26323b';
    g.fillRect(0, 0, S, S);
    m.fillRect(0, 0, S, S);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      g.fillStyle = '#56616a';
      g.fillRect(0, y + 60, S, 4);
      m.clearRect(0, y + 60, S, 4);
      for (let b = 0; b < 4; b++) {
        g.fillStyle = '#48535c';
        g.fillRect(b * 64, y, 3, 64);
        if (rng() < 0.25) {
          g.fillStyle = 'rgba(120,150,170,0.25)';
          g.fillRect(b * 64 + 3, y, 61, 60);
        }
      }
    }
  },
  plaster(g, m, rng) {
    g.fillStyle = '#efe9dc';
    g.fillRect(0, 0, S, S);
    noise(g, rng, 0.08, 2200);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      g.fillStyle = '#dcd5c6';
      g.fillRect(0, y + 60, S, 4);
      for (let b = 0; b < 4; b++) {
        const x = b * 64;
        g.fillStyle = '#d3cab8';
        g.fillRect(x + 15, y + 12, 34, 40);
        g.fillStyle = '#34414b';
        g.fillRect(x + 18, y + 15, 28, 34);
        m.fillRect(x + 18, y + 15, 28, 34);
        g.fillStyle = '#e8e2d4';
        g.fillRect(x + 31, y + 15, 2, 34);
        g.fillRect(x + 18, y + 28, 28, 2);
        g.fillStyle = '#bdb4a2';
        g.fillRect(x + 14, y + 52, 36, 3);
      }
    }
  },
  hotel(g, m, rng) {
    g.fillStyle = '#f4f2ec';
    g.fillRect(0, 0, S, S);
    noise(g, rng, 0.04);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      for (let b = 0; b < 4; b++) {
        const x = b * 64;
        g.fillStyle = '#2a3a48';
        g.fillRect(x + 6, y + 8, 52, 40);
        m.fillRect(x + 6, y + 8, 52, 40);
        g.fillStyle = 'rgba(150,185,210,0.4)';
        g.fillRect(x + 6, y + 8, 52, 12);
        g.fillStyle = '#e6e3dc';
        g.fillRect(x + 30, y + 8, 3, 40);
      }
      // balcony slab and glass balustrade
      g.fillStyle = '#ffffff';
      g.fillRect(0, y + 48, S, 8);
      g.fillStyle = '#b9c4c9';
      g.fillRect(0, y + 38, S, 3);
      g.fillStyle = '#d8d6d0';
      g.fillRect(0, y + 56, S, 3);
      m.clearRect(0, y + 48, S, 11);
    }
  },
  flats(g, m, rng) {
    g.fillStyle = '#ece6da';
    g.fillRect(0, 0, S, S);
    noise(g, rng, 0.09, 2000);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      for (let b = 0; b < 4; b++) {
        const x = b * 64;
        const wide = b % 2 === 0;
        const w = wide ? 40 : 22;
        const x0 = x + (64 - w) / 2;
        g.fillStyle = '#3a4650';
        g.fillRect(x0, y + 16, w, 32);
        m.fillRect(x0, y + 16, w, 32);
        g.fillStyle = '#f6f3ec';
        g.fillRect(x0 + w / 2 - 1, y + 16, 2, 32);
        if (wide) {
          // balcony railing
          g.fillStyle = '#8c8f8f';
          g.fillRect(x0 - 4, y + 40, w + 8, 2);
          for (let r = 0; r < 9; r++) g.fillRect(x0 - 4 + r * ((w + 8) / 8), y + 40, 1, 12);
          g.fillStyle = '#d9d3c6';
          g.fillRect(x0 - 4, y + 52, w + 8, 4);
        }
      }
    }
  },
  house(g, m, rng) {
    g.fillStyle = '#f2ede2';
    g.fillRect(0, 0, S, S);
    noise(g, rng, 0.1, 2600);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      for (let b = 0; b < 4; b++) {
        const x = b * 64;
        if ((b + f) % 2 === 1) continue;
        g.fillStyle = '#ffffff';
        g.fillRect(x + 12, y + 14, 40, 32);
        g.fillStyle = '#33404a';
        g.fillRect(x + 15, y + 17, 34, 26);
        m.fillRect(x + 15, y + 17, 34, 26);
        g.fillStyle = '#f7f7f4';
        g.fillRect(x + 31, y + 17, 2, 26);
        g.fillRect(x + 15, y + 29, 34, 2);
        g.fillStyle = '#c9c0ae';
        g.fillRect(x + 10, y + 46, 44, 3);
      }
    }
  },
  industrial(g, m, rng) {
    g.fillStyle = '#d8dbdc';
    g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x, 0, 2, S);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 3, 0, 2, S);
    }
    noise(g, rng, 0.08, 1200, 3);
    // a strip of high windows on the top row
    for (let b = 0; b < 8; b++) {
      g.fillStyle = '#4a5864';
      g.fillRect(b * 32 + 4, 8, 24, 10);
      m.fillRect(b * 32 + 4, 8, 24, 10);
    }
    g.fillStyle = 'rgba(90,70,50,0.25)';
    g.fillRect(0, S - 16, S, 16);
  },
  facebrick(g, m, rng) {
    g.fillStyle = '#9a5a40';
    g.fillRect(0, 0, S, S);
    for (let row = 0; row < S / 6; row++) {
      const off = row % 2 ? 6 : 0;
      for (let x = -12; x < S; x += 12) {
        const v = 0.85 + rng() * 0.3;
        g.fillStyle = `rgb(${Math.round(150 * v)},${Math.round(86 * v)},${Math.round(60 * v)})`;
        g.fillRect(x + off, row * 6, 11, 5);
      }
    }
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      for (let b = 0; b < 4; b++) {
        const x = b * 64;
        g.fillStyle = '#e9e4da';
        g.fillRect(x + 13, y + 14, 38, 34);
        g.fillStyle = '#2f3b44';
        g.fillRect(x + 16, y + 17, 32, 28);
        m.fillRect(x + 16, y + 17, 32, 28);
        g.fillStyle = '#e9e4da';
        g.fillRect(x + 31, y + 17, 2, 28);
      }
    }
  },
  roofFlat(g, m, rng) {
    g.fillStyle = '#9c9a94';
    g.fillRect(0, 0, S, S);
    noise(g, rng, 0.25, 6000, 2);
    g.strokeStyle = 'rgba(60,60,60,0.25)';
    for (let i = 0; i < 6; i++) {
      g.strokeRect(rng() * S, rng() * S, 20 + rng() * 40, 20 + rng() * 40);
    }
  },
  roofTile(g, m, rng) {
    g.fillStyle = '#f0f0f0';
    g.fillRect(0, 0, S, S);
    for (let row = 0; row < S / 16; row++) {
      for (let x = 0; x < S; x += 16) {
        const v = 200 + Math.floor(rng() * 50);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + (row % 2) * 8, row * 16, 15, 14);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x + (row % 2) * 8, row * 16 + 12, 15, 3);
      }
    }
  },
  roofIron(g, m, rng) {
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 10) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, 0, 3, S);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(x + 5, 0, 2, S);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(140,80,40,${rng() * 0.2})`;
      g.fillRect(rng() * S, rng() * S, 8 + rng() * 30, 4 + rng() * 20);
    }
  },
  shop(g, m, rng) {
    // Upper floors plaster, ground row = shop windows (used for the first floor of CBD blocks).
    g.fillStyle = '#ebe5d8';
    g.fillRect(0, 0, S, S);
    noise(g, rng, 0.08, 2000);
    for (let f = 0; f < 4; f++) {
      const y = f * 64;
      for (let b = 0; b < 4; b++) {
        const x = b * 64;
        g.fillStyle = '#28323a';
        g.fillRect(x + 4, y + 10, 56, 46);
        m.fillRect(x + 4, y + 10, 56, 46);
        g.fillStyle = ['#b8322a', '#2a6fb8', '#e0a526', '#2f8f4e'][(b + f) % 4];
        g.fillRect(x + 2, y + 2, 60, 8);
      }
    }
  }
};

export function buildFacadeArray() {
  const data = new Uint8Array(S * S * 4 * LAYER_COUNT);
  const names = Object.keys(LAYER).sort((a, b) => LAYER[a] - LAYER[b]);
  for (let i = 0; i < names.length; i++) {
    const c = canvas();
    const mc = canvas();
    const g = c.getContext('2d', { willReadFrequently: true });
    const m = mc.getContext('2d', { willReadFrequently: true });
    m.fillStyle = '#fff';
    PAINTERS[names[i]](g, m, mulberry32(1000 + i * 77));
    const col = g.getImageData(0, 0, S, S).data;
    const msk = m.getImageData(0, 0, S, S).data;
    const off = i * S * S * 4;
    // flip vertically so v=0 is the bottom of the layer (ground)
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      const dst = off + y * S * 4;
      for (let x = 0; x < S * 4; x += 4) {
        data[dst + x] = col[src + x];
        data[dst + x + 1] = col[src + x + 1];
        data[dst + x + 2] = col[src + x + 2];
        data[dst + x + 3] = msk[src + x + 3];
      }
    }
  }
  const tex = new THREE.DataArrayTexture(data, S, S, LAYER_COUNT);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
