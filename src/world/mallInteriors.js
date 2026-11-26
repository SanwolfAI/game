import * as THREE from '../../vendor/three/three.module.js';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js';

// Walk-in mall interiors (ground floor) for two real malls, entered on foot
// through the main entrance publicPlaces.js builds on the real mall outline:
//
//  Gateway Theatre of Shopping (Umhlanga Ridge): from public photos and the
//  landscape architects' notes: a central hub (the Great Hall) with wings going
//  off at 45 degrees to both sides, entered from the Palm Court. Triple-volume
//  hall with a glass lift core, fountain, white palette with geometric floor
//  tiles, curved ceiling bulkheads with timber accents, multi-stem palms in
//  planters, vaulted skylit wings, escalators up to the first floor.
//  Galleria Mall (Amanzimtoti): one long straight concourse running parallel to
//  the N2, a centre court with escalators and an information desk, large beige
//  floor tiles, a long skylight strip.
//
// Shop names are made up. Nothing is copied from the malls' own branding.
//
// The interior sits inside the real building footprint, so the building's
// outside walls hide it (they are single-sided: from inside you only see the
// interior). While the player is inside the walkable area:
//  - collide() replaces building collision with the interior walls (chained
//    in main.js), so you can walk in through the door,
//  - floorAt() gives the flat floor height (player.js hook),
//  - clampCamera() keeps the chase camera under the ceiling and inside.
// Built lazily when the camera comes within 600 m; drawn only near / inside.
// One merged mesh per material (6 draw calls per mall), no real lights:
// lit look comes from emissive / unlit materials (cheap on budget phones).

const BUILD_R = 600;
const SHOW_R = 160;
const WALL_H = 7.5; // concourse ceiling
const SHOP_D = 4.5; // shop depth behind the shopfront

export const MALL_PLANS = {
  'Gateway Theatre of Shopping': {
    key: 'gateway',
    entry: { w: 10, len: 22 }, // Palm Court passage
    hub: { w: 32, h: 13, fountain: true, liftCore: true }, // Great Hall
    wings: [{ ang: 45, w: 14, max: 110 }, { ang: -45, w: 14, max: 110 }],
    vault: true,
    tile: ['#f1ede4', '#d9d4c9', '#9aa3ab'],
    accent: '#a8754a', // timber
    palms: true
  },
  'Galleria Mall': {
    key: 'galleria',
    entry: { w: 8, len: 14 },
    hub: { w: 26, h: 11, info: true }, // centre court
    wings: [{ axis: 1, w: 14, max: 150 }, { axis: -1, w: 14, max: 150 }], // along the mall's long side
    vault: false,
    tile: ['#e6dccb', '#d3c6b0', '#b9a98f'],
    accent: '#6f7a84',
    palms: false
  }
};

const SHOPS = [
  'Ubuntu Threads', 'Kasi Kicks', 'Coastline Café', "Mama Thandi's Kitchen", 'Indlovu Books', 'Shosholoza Sport',
  'Sapphire Jewellers', 'Umoya Pharmacy', 'Ithemba Mobile', 'Bay Beauty', 'Zulu Sky Toys', 'Clear View Optics',
  'Durban Denim', 'Lekker Bakes', 'Ilanga Electronics', 'Imbali Flowers', 'Marula Home', 'Thula Baby',
  'Funda Stationery', 'Inyoni Travel', 'Amanzi Swim', 'Bunny Chow Co.', 'Sunrise Shoes', 'Isiphepho Gifts',
  'Wave Surf Shop', 'Spice Route Deli', 'Kwela Music', 'Ocean Tea House', 'Mzansi Market', 'Umsinsi Fashion'
];
const ANCHORS = ['HOMEMART', 'FRESHWAY FOODS', 'STYLE HOUSE', 'MEGA CINEMAS'];
const SHOP_COLS = ['#d64545', '#2f6db5', '#2f9e5b', '#e0a82e', '#7b4bb3', '#1b9aaa', '#e86f2c', '#c23b78', '#3d4a5c', '#8a6a3f'];

const _c = new THREE.Color();
function paint(g, color) {
  _c.set(color).convertSRGBToLinear();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------ textures
function tileTexture(cols, gateway) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = cols[0];
  g.fillRect(0, 0, 512, 512);
  if (gateway) {
    // geometric tiling: diamonds of two tones on a pale ground (4 x 4 m repeat)
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * 128 + 64;
        const y = j * 128 + 64;
        g.fillStyle = (i + j) % 2 ? cols[1] : cols[0];
        g.beginPath();
        g.moveTo(x, y - 60);
        g.lineTo(x + 60, y);
        g.lineTo(x, y + 60);
        g.lineTo(x - 60, y);
        g.fill();
        g.fillStyle = cols[2];
        g.beginPath();
        g.moveTo(x, y - 14);
        g.lineTo(x + 14, y);
        g.lineTo(x, y + 14);
        g.lineTo(x - 14, y);
        g.fill();
      }
    }
  } else {
    // big 1 m porcelain tiles with a subtle tone change
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        g.fillStyle = (i * 3 + j * 5) % 4 === 0 ? cols[1] : cols[0];
        g.fillRect(i * 128, j * 128, 128, 128);
      }
    }
  }
  g.strokeStyle = 'rgba(80,70,60,0.35)';
  g.lineWidth = 2;
  for (let k = 0; k <= 512; k += 128) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k, 512);
    g.moveTo(0, k);
    g.lineTo(512, k);
    g.stroke();
  }
  // soft sheen
  const grd = g.createLinearGradient(0, 0, 512, 512);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  return t;
}

// shop sign atlas: 2 columns x 32 rows of 512 x 64 px; names white on colour
const ROWS = 32;
function signAtlas(names) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 2048;
  const g = c.getContext('2d');
  names.forEach((n, i) => {
    const x = (i % 2) * 512;
    const y = Math.floor(i / 2) * 64;
    g.fillStyle = SHOP_COLS[i % SHOP_COLS.length];
    g.fillRect(x, y, 512, 64);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let fs = 40;
    g.font = `bold ${fs}px Arial, sans-serif`;
    while (g.measureText(n).width > 470 && fs > 18) {
      fs -= 2;
      g.font = `bold ${fs}px Arial, sans-serif`;
    }
    g.fillText(n, x + 256, y + 33);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  return t;
}
function signUV(i) {
  const H = 1 / ROWS;
  const x = (i % 2) * 0.5;
  const r = Math.floor(i / 2);
  return [x + 0.003, 1 - (r + 1) * H + 0.004, x + 0.497, 1 - r * H - 0.004];
}

// ------------------------------------------------------------------ builder helpers (world space)
class Parts {
  constructor() {
    this.solid = [];
    this.glass = [];
    this.light = [];
    this.sign = [];
    this.floor = [];
    this.water = [];
  }
}

function rectPts(r) {
  const out = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push([r.x + r.ax * a * r.hu + r.bx * b * r.hv, r.z + r.az * a * r.hu + r.bz * b * r.hv]);
  return out;
}
function inRect(r, x, z, m = 0) {
  const dx = x - r.x;
  const dz = z - r.z;
  return Math.abs(dx * r.ax + dz * r.az) <= r.hu - m && Math.abs(dx * r.bx + dz * r.bz) <= r.hv - m;
}

// ------------------------------------------------------------------ main
export class MallInteriors {
  constructor({ hf, buildings, publicPlaces, malls = [] }) {
    this.hf = hf;
    this.buildings = buildings;
    this.pub = publicPlaces;
    this.group = new THREE.Group();
    this.group.name = 'mallInteriors';
    this.malls = [];
    this.active = null; // the mall the player is inside
    this.onEnter = null;
    for (const m of malls) {
      const plan = MALL_PLANS[(m.n || '').trim()];
      if (!plan || !m.p || m.p.length < 3) continue;
      let x = 0;
      let z = 0;
      for (const p of m.p) {
        x += p[0];
        z += p[1];
      }
      this.malls.push({ name: m.n.trim(), plan, ring: m.p, cx: x / m.p.length, cz: z / m.p.length, built: false, failed: false, rects: [], obstacles: [], meshes: [] });
    }
    this.names = SHOPS.concat(ANCHORS, ['INFORMATION']);
    this.signTex = null;
    this.stats = { built: 0 };
  }

  #inBuilding(x, z) {
    return !!(this.buildings && this.buildings.blocked(x, z, 0.2));
  }
  #inRing(ring, x, z) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  // every point of a rect (plus the shop depth around it) inside the building
  #fits(m, r, pad) {
    const big = { ...r, hu: r.hu + pad, hv: r.hv + pad };
    const n = Math.max(2, Math.ceil((2 * big.hu) / 6));
    const k = Math.max(2, Math.ceil((2 * big.hv) / 6));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= k; j++) {
        if (i > 0 && i < n && j > 0 && j < k && (i + j) % 2) continue; // sparse inside, full on the edge
        const a = -1 + (2 * i) / n;
        const b = -1 + (2 * j) / k;
        const x = r.x + r.ax * a * big.hu + r.bx * b * big.hv;
        const z = r.z + r.az * a * big.hu + r.bz * b * big.hv;
        if (!this.#inBuilding(x, z) || !this.#inRing(m.ring, x, z)) return false;
      }
    }
    return true;
  }

  // ---- layout from the real outline + the entrance publicPlaces made ----------
  #layout(m, e) {
    const plan = m.plan;
    // frame: origin on the wall at the entrance, u along the wall, v inward
    const ix = -e.nx;
    const iz = -e.nz;
    const ux = -iz; // along the wall (right-handed with inward)
    const uz = ix;
    const F = {
      y: e.y + 0.06,
      yaw: Math.atan2(ix, iz),
      at: (u, v) => [e.x + ux * u + ix * v, e.z + uz * u + iz * v]
    };
    const rect = (cu, cv, hu, hv, ang = 0) => {
      // ang: rotation of the rect's u axis from the frame's u axis (radians)
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const ax = ux * c + ix * s;
      const az = uz * c + iz * s;
      const [x, z] = F.at(cu, cv);
      return { x, z, ax, az, bx: -az, bz: ax, hu, hv, ang, cu, cv };
    };
    const E = plan.entry;
    const H = plan.hub;
    const door = rect(0, -1.5, 2.6, 2.2); // the door gap through the wall
    let entry = rect(0, E.len / 2, E.w / 2, E.len / 2 + 0.2);
    let hubV = E.len + H.w / 2;
    let hub = rect(0, hubV, H.w / 2, H.w / 2);
    // shrink the hall until it fits the building
    let hw = H.w;
    while (hw >= 16 && !this.#fits(m, hub, SHOP_D)) {
      hw -= 4;
      hubV = E.len + hw / 2;
      hub = rect(0, hubV, hw / 2, hw / 2);
    }
    if (hw < 16) return null;
    if (!this.#fits(m, { ...entry, hv: entry.hv - 1.5, x: entry.x + ix * 0.75, z: entry.z + iz * 0.75 }, 1.5)) return null;
    // wings
    const wings = [];
    let mallAxis = null;
    if (plan.wings.some((w) => w.axis)) {
      // the mall's long axis from its outline (principal direction)
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      for (const [x, z] of m.ring) {
        sxx += (x - m.cx) ** 2;
        szz += (z - m.cz) ** 2;
        sxz += (x - m.cx) * (z - m.cz);
      }
      const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      mallAxis = [Math.cos(th), Math.sin(th)];
    }
    const [hcx, hcz] = F.at(0, hubV);
    for (const w of plan.wings) {
      let dx;
      let dz;
      if (w.axis) {
        dx = mallAxis[0] * w.axis;
        dz = mallAxis[1] * w.axis;
      } else {
        const a = (w.ang * Math.PI) / 180;
        // ang from the inward axis toward +u
        dx = ix * Math.cos(a) + ux * Math.sin(a);
        dz = iz * Math.cos(a) + uz * Math.sin(a);
      }
      // grow the wing from the hall edge while it fits
      let L = 0;
      const start = hw / 2 - 2;
      for (let len = 12; len <= w.max; len += 6) {
        const c = start + len / 2;
        const r = { x: hcx + dx * c, z: hcz + dz * c, ax: dx, az: dz, bx: -dz, bz: dx, hu: len / 2, hv: w.w / 2 };
        if (!this.#fits(m, r, SHOP_D)) break;
        L = len;
      }
      if (L < 12) continue;
      const c = start + L / 2;
      wings.push({ x: hcx + dx * c, z: hcz + dz * c, ax: dx, az: dz, bx: -dz, bz: dx, hu: L / 2, hv: w.w / 2, wing: true });
    }
    return { F, door, entry, hub: { ...hub, hall: true }, wings, hw };
  }

  // ---- geometry -----------------------------------------------------------------------
  #build(m) {
    m.built = true;
    // only the entrance publicPlaces built with open doors (OPEN_MALLS)
    const ents = (this.pub?.entrances || []).filter((e) => e.mall === m.name && e.open);
    let L = null;
    for (const e of ents) {
      L = this.#layout(m, e);
      if (L) {
        m.entrance = e;
        break;
      }
    }
    if (!L) {
      m.failed = true;
      console.warn('[IZK] mall interior does not fit', m.name);
      return;
    }
    const plan = m.plan;
    const y0 = L.F.y;
    m.floorY = y0;
    m.rects = [L.door, L.entry, L.hub, ...L.wings];
    const P = new Parts();
    if (!this.signTex) this.signTex = signAtlas(this.names);
    let shopN = (Math.abs(Math.round(m.cx)) * 7) % SHOPS.length;
    const nextShop = () => SHOPS.length > 0 && shopN++ % SHOPS.length;
    // generic world-space box helper for pieces with their own axes
    const wbox = (list, x, y, z, su, sy, sv, ax, az, color, tilt = 0) => {
      const g = new THREE.BoxGeometry(su, sy, sv);
      g.deleteAttribute('uv');
      if (tilt) g.rotateX(tilt);
      g.rotateY(Math.atan2(-az, ax)); // local x -> (ax, az): three's rotateY maps +x to (cos, -sin)
      g.translate(x, y, z);
      if (color) paint(g, color);
      P[list].push(g);
    };
    const wquad = (list, x, y, z, w, h, ax, az, nx, nz, uv) => {
      // plane with its width along (ax, az) and facing (nx, nz)
      const g = new THREE.PlaneGeometry(w, h);
      if (uv) {
        const a = g.attributes.uv;
        a.setXY(0, uv[0], uv[3]);
        a.setXY(1, uv[2], uv[3]);
        a.setXY(2, uv[0], uv[1]);
        a.setXY(3, uv[2], uv[1]);
      }
      // default plane: width along +x, normal +z. rotate so normal -> (nx, nz)
      g.rotateY(Math.atan2(nx, nz));
      // local +x is then (nz, -nx): seen from the front it reads left to right, so no uv flip
      g.translate(x, y, z);
      P[list].push(g);
    };
    const all = m.rects;
    const insideOther = (r, x, z) => all.some((o) => o !== r && inRect(o, x, z, -0.05));

    // floors (world-space uv so overlaps line up) and ceilings
    for (const r of all) {
      const pts = rectPts(r);
      const g = new THREE.BufferGeometry();
      const pos = [];
      const uv = [];
      for (const i of [0, 2, 1, 0, 3, 2]) {
        pos.push(pts[i][0], y0, pts[i][1]);
        uv.push(pts[i][0] / 4, pts[i][1] / 4);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) {
        // keep it facing up
        const p = g.attributes.position;
        for (let t = 0; t < p.count; t += 3) {
          const tx = p.getX(t + 1);
          const tz = p.getZ(t + 1);
          p.setXYZ(t + 1, p.getX(t + 2), y0, p.getZ(t + 2));
          p.setXYZ(t + 2, tx, y0, tz);
          const ux = uv[(t + 1) * 2];
          const uz = uv[(t + 1) * 2 + 1];
          g.attributes.uv.setXY(t + 1, uv[(t + 2) * 2], uv[(t + 2) * 2 + 1]);
          g.attributes.uv.setXY(t + 2, ux, uz);
        }
        g.computeVertexNormals();
      }
      P.floor.push(g);
      const hgt = r.hall ? plan.hub.h : WALL_H;
      if (r === L.door) continue;
      // ceiling: a box slab (both faces fine)
      wbox('solid', r.x, y0 + hgt + 0.2, r.z, 2 * r.hu, 0.4, 2 * r.hv, r.ax, r.az, '#f4f2ec');
      if (r.wing) {
        // skylight strip down the middle; vaulted ribs at Gateway
        wbox('light', r.x, y0 + hgt - 0.02, r.z, 2 * r.hu - 2, 0.04, plan.vault ? 5 : 3, r.ax, r.az, null);
        if (plan.vault) {
          for (let t = -r.hu + 3; t < r.hu - 2; t += 4.5) {
            const x = r.x + r.ax * t;
            const z = r.z + r.az * t;
            for (const s of [-1, 1]) wbox('solid', x + r.bx * s * 2.8, y0 + hgt - 0.6, z + r.bz * s * 2.8, 0.25, 0.25, 1.8, r.ax, r.az, plan.accent, s * 0.6);
          }
          // curved bulkheads along both sides (timber accent strip)
          for (const s of [-1, 1]) wbox('solid', r.x + r.bx * s * (r.hv - 1.6), y0 + hgt - 0.7, r.z + r.bz * s * (r.hv - 1.6), 2 * r.hu, 1.0, 3.0, r.ax, r.az, '#ffffff', s * 0.35);
          for (const s of [-1, 1]) wbox('solid', r.x + r.bx * s * (r.hv - 3.0), y0 + hgt - 1.2, r.z + r.bz * s * (r.hv - 3.0), 2 * r.hu, 0.16, 0.5, r.ax, r.az, plan.accent);
        }
      }
      // downlights every 6 m
      for (let a = -r.hu + 3; a < r.hu; a += 6) {
        for (const b of [-r.hv + 2.2, r.hv - 2.2]) {
          const x = r.x + r.ax * a + r.bx * b;
          const z = r.z + r.az * a + r.bz * b;
          if (insideOther(r, x, z) && !r.hall) continue;
          wbox('light', x, y0 + hgt - 0.03, z, 0.7, 0.05, 0.7, r.ax, r.az, null);
        }
      }
    }

    // walls around the union: shopfront units where nothing else joins
    const UNIT = 8;
    let anchorN = 0;
    for (const r of all) {
      if (r === L.door) continue;
      const hgt = r.hall ? plan.hub.h : WALL_H;
      const edges = [
        [r.ax, r.az, r.bx, r.bz, r.hu, r.hv], // +v side, runs along u
        [r.ax, r.az, -r.bx, -r.bz, r.hu, r.hv], // -v side
        [r.bx, r.bz, r.ax, r.az, r.hv, r.hu], // +u end, runs along v
        [r.bx, r.bz, -r.ax, -r.az, r.hv, r.hu] // -u end
      ];
      edges.forEach(([ex, ez, nx, nz, half, off], ei) => {
        const n = Math.max(1, Math.round((2 * half) / UNIT));
        const w = (2 * half) / n;
        const isEnd = ei >= 2 && r.wing && n <= 3;
        for (let k = 0; k < n; k++) {
          const t = -half + w * (k + 0.5);
          const cx = r.x + ex * t + nx * off;
          const cz = r.z + ez * t + nz * off;
          const out = [cx + nx * 0.6, cz + nz * 0.6];
          if (insideOther(r, out[0], out[1])) {
            // an opening into a taller hall gets a fascia up to its ceiling
            if (!r.hall && all.some((o) => o.hall && inRect(o, out[0], out[1]))) {
              wbox('solid', cx, y0 + WALL_H + (plan.hub.h - WALL_H) / 2, cz, w + 0.02, plan.hub.h - WALL_H + 0.4, 0.3, ex, ez, '#f4f2ec');
            }
            continue;
          }
          if (r === L.entry || (r.hall && ei === 1 && Math.abs(t) < 4)) {
            // Palm Court / entrance passage: stone walls with timber slats
            wbox('solid', cx, y0 + hgt / 2, cz, w + 0.02, hgt, 0.4, ex, ez, '#e7e1d4');
            wbox('solid', cx - nx * 0.25, y0 + 3.6, cz - nz * 0.25, w - 0.4, 2.0, 0.1, ex, ez, plan.accent);
            continue;
          }
          if (isEnd) {
            // a big anchor store closes the wing
            if (k === Math.floor(n / 2)) this.#anchor(P, wbox, wquad, r.x + nx * off, r.z + nz * off, ex, ez, nx, nz, 2 * half, hgt, y0, ANCHORS[anchorN++ % ANCHORS.length]);
            continue;
          }
          this.#shop(P, wbox, wquad, cx, cz, ex, ez, nx, nz, w, hgt, y0, nextShop(), r.hall);
        }
      });
    }
    // the hall: first-floor gallery ring, glass balustrade, escalators, centrepiece
    this.#hall(P, wbox, wquad, L.hub, plan, y0, m, L);
    // the door gap: a frame with open sliding doors
    {
      const d = L.door;
      for (const s of [-1, 1]) wbox('solid', d.x + d.ax * s * 2.9, y0 + 1.6, d.z + d.az * s * 2.9, 0.3, 3.2, 0.4, d.ax, d.az, '#2a2e33');
      for (const s of [-1, 1]) wbox('glass', d.x + d.ax * s * 3.9, y0 + 1.55, d.z + d.az * s * 3.9, 1.9, 3.0, 0.05, d.ax, d.az, null);
      wbox('solid', d.x, y0 + 3.3, d.z, 6.2, 0.3, 0.4, d.ax, d.az, '#2a2e33');
      // inner entry walls beside the door gap, up to the passage
      const E = L.entry;
      for (const s of [-1, 1]) {
        const half = (2 * E.hu - 6) / 4;
        if (half > 0.2) wbox('solid', d.x + d.ax * s * (3 + half), y0 + WALL_H / 2, d.z + d.az * s * (3 + half), 2 * half, WALL_H, 0.4, d.ax, d.az, '#e7e1d4');
      }
    }

    // materials (built once)
    if (!this.mats) {
      this.mats = {
        solid: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a2a2a }),
        glass: new THREE.MeshLambertMaterial({ color: 0xbfd6de, emissive: 0x1d2a30, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }),
        light: new THREE.MeshBasicMaterial({ color: 0xfffbea }),
        sign: new THREE.MeshBasicMaterial({ map: this.signTex }),
        water: new THREE.MeshBasicMaterial({ color: 0x4fb8d8, transparent: true, opacity: 0.85 })
      };
    }
    m.floorMat = new THREE.MeshLambertMaterial({ map: tileTexture(plan.tile, plan.key === 'gateway'), emissive: 0xffffff, emissiveIntensity: 0.18 });
    m.floorMat.emissiveMap = m.floorMat.map;
    const add = (list, mat, name, order = 0) => {
      if (!list.length) return;
      const g = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.renderOrder = order;
      mesh.visible = false;
      this.group.add(mesh);
      m.meshes.push(mesh);
    };
    add(P.floor, m.floorMat, 'mallFloor');
    add(P.solid, this.mats.solid, 'mallInside');
    add(P.light, this.mats.light, 'mallLights');
    add(P.sign, this.mats.sign, 'mallShopSigns');
    add(P.water, this.mats.water, 'mallWater', 1);
    add(P.glass, this.mats.glass, 'mallShopGlass', 2);
    // props from the public-places pools (benches, planters, bins)
    this.#props(m, L, y0);
    this.stats.built++;
    this.stats[m.plan.key] = { wings: L.wings.map((w) => Math.round(w.hu * 2)), hall: L.hw };
  }

  // one shop unit: glass front with a door, sign band, lit interior, pilasters
  #shop(P, wbox, wquad, cx, cz, ex, ez, nx, nz, w, hgt, y0, idx, hall) {
    const col = SHOP_COLS[idx % SHOP_COLS.length];
    const D = SHOP_D;
    const bx = cx + nx * (D / 2);
    const bz = cz + nz * (D / 2);
    // shop box: back wall (shop colour), side walls, floor, ceiling
    wbox('solid', cx + nx * D, y0 + 2.2, cz + nz * D, w, 4.4, 0.2, ex, ez, col);
    for (const s of [-1, 1]) wbox('solid', bx + ex * s * (w / 2 - 0.1), y0 + 2.2, bz + ez * s * (w / 2 - 0.1), 0.2, 4.4, D, ex, ez, '#f3f0ea');
    wbox('solid', bx, y0 + 0.02, bz, w, 0.04, D, ex, ez, '#d9d2c4');
    wbox('solid', bx, y0 + 4.4, bz, w, 0.1, D, ex, ez, '#fafafa');
    wbox('light', bx, y0 + 4.33, bz, w * 0.6, 0.04, 0.4, ex, ez, null);
    // display tables / racks
    for (const s of [-0.25, 0.25]) wbox('solid', bx + ex * s * w, y0 + 0.45, bz + ez * s * w, w * 0.22, 0.9, 1.2, ex, ez, s < 0 ? '#ffffff' : col);
    wbox('solid', cx + nx * (D - 0.5) , y0 + 1.6, cz + nz * (D - 0.5), w * 0.8, 2.2, 0.6, ex, ez, '#efeae0');
    // shopfront: glass both sides of a door gap, frame
    const gw = (w - 0.8 - 2.2) / 2;
    for (const s of [-1, 1]) wbox('glass', cx + ex * s * (1.1 + gw / 2), y0 + 1.75, cz + ez * s * (1.1 + gw / 2), gw, 3.4, 0.04, ex, ez, null);
    wbox('solid', cx, y0 + 3.5, cz, w, 0.12, 0.14, ex, ez, '#2f3338');
    for (const s of [-1, 1]) wbox('solid', cx + ex * s * (w / 2 - 0.2), y0 + hgt / 2, cz + ez * s * (w / 2 - 0.2), 0.4, hgt, 0.5, ex, ez, '#ece8df'); // pilasters
    // sign band + bulkhead above to the ceiling
    wbox('solid', cx + nx * 0.1, y0 + 4.1, cz + nz * 0.1, w - 0.8, 1.1, 0.3, ex, ez, '#2a2d31');
    wquad('sign', cx - nx * 0.06, y0 + 4.1, cz - nz * 0.06, w - 1.4, 0.8, ex, ez, -nx, -nz, signUV(idx % SHOPS.length));
    if (hgt > 4.8) wbox('solid', cx + nx * 0.15, y0 + 4.65 + (hgt - 4.65) / 2, cz + nz * 0.15, w, hgt - 4.65, 0.3, ex, ez, hall ? '#f6f4ef' : '#f1eee7');
    // collision: the shopfront line is a wall (the rect edge already is)
  }

  #anchor(P, wbox, wquad, cx, cz, ex, ez, nx, nz, w, hgt, y0, name) {
    wbox('solid', cx + nx * 0.2, y0 + hgt / 2, cz + nz * 0.2, w, hgt, 0.4, ex, ez, '#ece8df');
    wbox('glass', cx - nx * 0.02, y0 + 1.9, cz - nz * 0.02, Math.min(w - 2, 9), 3.6, 0.04, ex, ez, null);
    wbox('light', cx + nx * 0.15, y0 + 1.9, cz + nz * 0.15, Math.min(w - 2.4, 8.6), 3.4, 0.04, ex, ez, null);
    wbox('solid', cx - nx * 0.1, y0 + 5.0, cz - nz * 0.1, Math.min(w - 1, 11), 1.4, 0.2, ex, ez, '#1f2328');
    wquad('sign', cx - nx * 0.22, y0 + 5.0, cz - nz * 0.22, Math.min(w - 2, 9.5), 1.1, ex, ez, -nx, -nz, signUV(SHOPS.length + ANCHORS.indexOf(name)));
  }

  // the hall: gallery ring at first floor with glass balustrade, escalators, centrepiece
  #hall(P, wbox, wquad, h, plan, y0, m, L) {
    const FL = 6; // first floor level
    const ring = 3.6; // gallery depth
    for (const [ex, ez, nx, nz, half, off] of [
      [h.ax, h.az, h.bx, h.bz, h.hu, h.hv],
      [h.ax, h.az, -h.bx, -h.bz, h.hu, h.hv],
      [h.bx, h.bz, h.ax, h.az, h.hv, h.hu],
      [h.bx, h.bz, -h.ax, -h.az, h.hv, h.hu]
    ]) {
      const cx = h.x + nx * (off - ring / 2);
      const cz = h.z + nz * (off - ring / 2);
      wbox('solid', cx, y0 + FL, cz, 2 * half, 0.5, ring, ex, ez, '#f7f6f2');
      wbox('solid', cx - nx * (ring / 2 - 0.05), y0 + FL - 0.45, cz - nz * (ring / 2 - 0.05), 2 * half, 0.5, 0.12, ex, ez, plan.accent);
      // glass balustrade with a rail; on the +v side it opens where the escalators arrive
      const gap = nx === h.bx && nz === h.bz ? [-(h.hu - ring - 2.4) - 2.2, -(h.hu - ring - 2.4) + 2.2] : null;
      const spans = gap ? [[-half + 0.1, gap[0]], [gap[1], half - 0.1]] : [[-half + 0.1, half - 0.1]];
      for (const [t0, t1] of spans) {
        if (t1 - t0 < 0.3) continue;
        const tm = (t0 + t1) / 2;
        const bxp = cx - nx * (ring / 2 - 0.1) + ex * tm;
        const bzp = cz - nz * (ring / 2 - 0.1) + ez * tm;
        wbox('glass', bxp, y0 + FL + 0.8, bzp, t1 - t0, 1.1, 0.04, ex, ez, null);
        wbox('solid', bxp, y0 + FL + 1.38, bzp, t1 - t0, 0.06, 0.08, ex, ez, '#b8bcc0');
      }
      // gallery downlights
      for (let t = -half + 3; t < half; t += 5) wbox('light', cx + ex * t, y0 + FL - 0.27, cz + ez * t, 0.5, 0.04, 0.5, ex, ez, null);
    }
    // round glass roof lantern
    wbox('light', h.x, y0 + plan.hub.h - 0.05, h.z, h.hu * 0.9, 0.05, h.hv * 0.9, h.ax, h.az, null);
    for (let t = -h.hu * 0.45; t <= h.hu * 0.45 + 0.01; t += h.hu * 0.15) wbox('solid', h.x + h.ax * t, y0 + plan.hub.h - 0.2, h.z + h.az * t, 0.18, 0.25, h.hv * 0.9, h.ax, h.az, '#d8d8d4');
    // escalators: a pair rising along the hall's v axis on one side; the top
    // landing runs onto the first-floor gallery on the +v side
    const run = FL / Math.tan((30 * Math.PI) / 180);
    const ea = -(h.hu - ring - 2.4); // just inside the gallery void
    const eb = h.hv - ring + 0.3 - run / 2 - 2.0; // top landing edge on the gallery slab
    const ecx = h.x + h.ax * ea + h.bx * eb;
    const ecz = h.z + h.az * ea + h.bz * eb;
    this.#escalators(P, wbox, ecx, ecz, h.bx, h.bz, h.ax, h.az, y0, FL);
    m.obstacles.push({ x: ecx, z: ecz, ax: h.bx, az: h.bz, hu: run / 2 + 2.0, hv: 2.6 });
    m.escA = ea;
    if (plan.hub.fountain && Math.abs(ea) - 2.6 > 3.8) {
      // lily-pond style round fountain under the lantern
      const g = new THREE.CylinderGeometry(3.2, 3.4, 0.55, 24);
      g.deleteAttribute('uv');
      g.translate(h.x, y0 + 0.27, h.z);
      P.solid.push(paint(g, '#d8d2c4'));
      const w = new THREE.CircleGeometry(2.95, 24);
      w.rotateX(-Math.PI / 2);
      w.translate(h.x, y0 + 0.5, h.z);
      P.water.push(w);
      const s = new THREE.CylinderGeometry(0.25, 0.6, 1.6, 10);
      s.deleteAttribute('uv');
      s.translate(h.x, y0 + 0.8, h.z);
      P.solid.push(paint(s, '#c9c2b2'));
      const jet = new THREE.CylinderGeometry(0.05, 0.25, 1.8, 8);
      jet.translate(h.x, y0 + 2.4, h.z);
      P.water.push(jet);
      m.obstacles.push({ x: h.x, z: h.z, r: 3.5 });
    }
    if (plan.hub.liftCore) {
      // triple-volume glass lift core, off-centre toward the back of the hall
      const lx = h.x + h.bx * (h.hv - ring - 3.2) + h.ax * 5;
      const lz = h.z + h.bz * (h.hv - ring - 3.2) + h.az * 5;
      wbox('glass', lx, y0 + plan.hub.h / 2, lz, 3.6, plan.hub.h, 3.6, h.ax, h.az, null);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) wbox('solid', lx + h.ax * a * 1.8 + h.bx * b * 1.8, y0 + plan.hub.h / 2, lz + h.az * a * 1.8 + h.bz * b * 1.8, 0.16, plan.hub.h, 0.16, h.ax, h.az, '#2f3338');
      wbox('solid', lx, y0 + 1.6, lz, 1.8, 3.2, 1.8, h.ax, h.az, '#c9ccd0'); // the car
      m.obstacles.push({ x: lx, z: lz, r: 2.6 });
    }
    if (plan.hub.info) {
      // information desk in the centre court
      const g = new THREE.CylinderGeometry(2.2, 2.2, 1.1, 20, 1, false, 0, Math.PI * 1.4);
      g.deleteAttribute('uv');
      g.translate(h.x, y0 + 0.55, h.z);
      P.solid.push(paint(g, '#ffffff'));
      const top = new THREE.CylinderGeometry(2.35, 2.35, 0.08, 20, 1, false, 0, Math.PI * 1.4);
      top.deleteAttribute('uv');
      top.translate(h.x, y0 + 1.12, h.z);
      P.solid.push(paint(top, plan.accent));
      wbox('solid', h.x, y0 + 3.2, h.z, 2.6, 0.7, 0.12, h.ax, h.az, '#1f2328');
      wquad('sign', h.x - h.bx * 0.07, y0 + 3.2, h.z - h.bz * 0.07, 2.4, 0.55, h.ax, h.az, -h.bx, -h.bz, signUV(SHOPS.length + 4));
      m.obstacles.push({ x: h.x, z: h.z, r: 2.5 });
    }
  }

  // a pair of escalators (up + down) rising along (fx, fz)
  #escalators(P, wbox, cx, cz, fx, fz, sx, sz, y0, rise) {
    const run = rise / Math.tan((30 * Math.PI) / 180); // 30 degrees
    const tilt = Math.atan2(rise, run);
    const len = Math.hypot(run, rise);
    for (const s of [-1.1, 1.1]) {
      const x = cx + sx * s;
      const z = cz + sz * s;
      // truss (sloped box) + landing plates
      const g = new THREE.BoxGeometry(1.5, 0.8, len);
      g.deleteAttribute('uv');
      g.rotateX(-tilt);
      g.rotateY(Math.atan2(fx, fz));
      g.translate(x, y0 + rise / 2 - 0.3, z);
      P.solid.push(paint(g, '#b8bcc0'));
      for (const e of [-1, 1]) wbox('solid', x + fx * e * (run / 2 + 1.0), y0 + (e > 0 ? rise : 0) + 0.04, z + fz * e * (run / 2 + 1.0), 1.4, 0.08, 2.0, sx, sz, '#8f9499');
      // steps
      const N = 18;
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N - 0.5;
        wbox('solid', x + fx * t * run, y0 + (t + 0.5) * rise + 0.12, z + fz * t * run, 1.0, 0.18, run / N, sx, sz, i % 2 ? '#3a3e43' : '#4a4f55');
      }
      // glass balustrades with black handrails
      for (const b of [-0.7, 0.7]) {
        const gx = x + sx * b;
        const gz = z + sz * b;
        const pg = new THREE.BoxGeometry(0.03, 0.9, len + 1.6);
        pg.rotateX(-tilt);
        pg.rotateY(Math.atan2(fx, fz));
        pg.translate(gx, y0 + rise / 2 + 0.75, gz);
        P.glass.push(pg);
        const hr = new THREE.BoxGeometry(0.08, 0.08, len + 1.8);
        hr.deleteAttribute('uv');
        hr.rotateX(-tilt);
        hr.rotateY(Math.atan2(fx, fz));
        hr.translate(gx, y0 + rise / 2 + 1.22, gz);
        P.solid.push(paint(hr, '#15171a'));
      }
    }
  }

  #props(m, L, y0) {
    if (!this.pub || !this.pub.putProp) return;
    const put = (k, x, z, yaw) => this.pub.putProp(k, x, z, yaw, y0);
    for (const w of L.wings) {
      // benches and planters down the middle of each wing, bins at the shop line
      for (let t = -w.hu + 8; t < w.hu - 6; t += 14) {
        const x = w.x + w.ax * t;
        const z = w.z + w.az * t;
        put('planter', x, z, Math.atan2(w.ax, w.az) + Math.PI / 2);
        for (const s of [-1, 1]) put('bench', x + w.ax * s * 2.6, z + w.az * s * 2.6, Math.atan2(w.bx * s, w.bz * s));
        put('bin', x + w.bx * (w.hv - 1.2), z + w.bz * (w.hv - 1.2), 0);
        m.obstacles.push({ x, z, ax: w.ax, az: w.az, hu: 3.8, hv: 0.7 });
      }
    }
    // entrance passage planters (Palm Court)
    const E = L.entry;
    for (let t = -E.hv + 4; t < E.hv - 3; t += 6) {
      for (const s of [-1, 1]) {
        const x = E.x + E.bx * t + E.ax * s * (E.hu - 1.3);
        const z = E.z + E.bz * t + E.az * s * (E.hu - 1.3);
        put('planter', x, z, Math.atan2(E.bx, E.bz));
        if (m.plan.palms) this.#palm(m, x, z, y0);
      }
    }
  }

  // multi-stem indoor palm in a planter (Gateway's Great Hall palms)
  #palm(m, x, z, y0) {
    if (!m.palmParts) m.palmParts = [];
    const parts = m.palmParts;
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1;
      const ox = Math.cos(a) * 0.3;
      const oz = Math.sin(a) * 0.3;
      const h = 3.2 + k * 0.6;
      const t = new THREE.CylinderGeometry(0.06, 0.09, h, 6);
      t.deleteAttribute('uv');
      t.translate(x + ox, y0 + 0.7 + h / 2, z + oz);
      parts.push(paint(t, '#7d8a4a'));
      for (let f = 0; f < 6; f++) {
        const g = new THREE.BoxGeometry(0.35, 0.03, 1.6);
        g.deleteAttribute('uv');
        g.translate(0, 0, 0.8);
        g.rotateX(0.5);
        g.rotateY(f * 1.05 + k);
        g.translate(x + ox, y0 + 0.7 + h, z + oz);
        parts.push(paint(g, f % 2 ? '#3f7d33' : '#4f9440'));
      }
    }
    if (!m.palmMesh) {
      // merged lazily once all palms are in (next update)
      m.palmPending = true;
    }
  }

  // ---- runtime hooks ------------------------------------------------------------------
  #mallAt(x, z) {
    for (const m of this.malls) {
      if (!m.rects.length) continue;
      for (const r of m.rects) if (inRect(r, x, z)) return m;
    }
    return null;
  }

  inside(x, z) {
    return !!this.#mallAt(x, z);
  }

  floorAt(x, z) {
    const m = this.#mallAt(x, z);
    return m ? m.floorY : null;
  }

  // walls of the walkable union + obstacles; null when clear. Only used inside.
  collide(x, z, r) {
    const m = this.#mallAt(x, z);
    if (!m) return null;
    const out = this._o || (this._o = { x: 0, z: 0, nx: 0, nz: 0 });
    let px = x;
    let pz = z;
    let hit = false;
    // inside some rect shrunk by r? else pull to the nearest such point
    let ok = false;
    let best = null;
    for (const R of m.rects) {
      const dx = px - R.x;
      const dz = pz - R.z;
      const a = dx * R.ax + dz * R.az;
      const b = dx * R.bx + dz * R.bz;
      const ha = Math.max(0, R.hu - r);
      const hb = Math.max(0, R.hv - r);
      if (Math.abs(a) <= ha && Math.abs(b) <= hb) {
        ok = true;
        break;
      }
      const ca = Math.max(-ha, Math.min(ha, a));
      const cb = Math.max(-hb, Math.min(hb, b));
      const qx = R.x + R.ax * ca + R.bx * cb;
      const qz = R.z + R.az * ca + R.bz * cb;
      const d = Math.hypot(px - qx, pz - qz);
      if (!best || d < best.d) best = { d, qx, qz };
    }
    if (!ok && best) {
      out.nx = (best.qx - px) / (best.d || 1);
      out.nz = (best.qz - pz) / (best.d || 1);
      px = best.qx;
      pz = best.qz;
      hit = true;
    }
    for (const o of m.obstacles) {
      if (o.r) {
        const dx = px - o.x;
        const dz = pz - o.z;
        const d = Math.hypot(dx, dz);
        if (d < o.r + r && d > 1e-6) {
          px = o.x + (dx / d) * (o.r + r);
          pz = o.z + (dz / d) * (o.r + r);
          out.nx = dx / d;
          out.nz = dz / d;
          hit = true;
        }
      } else {
        const bx = -o.az;
        const bz = o.ax;
        const dx = px - o.x;
        const dz = pz - o.z;
        const a = dx * o.ax + dz * o.az;
        const b = dx * bx + dz * bz;
        const ea = o.hu + r - Math.abs(a);
        const eb = o.hv + r - Math.abs(b);
        if (ea > 0 && eb > 0) {
          if (ea < eb) {
            const s = Math.sign(a) || 1;
            px += o.ax * s * ea;
            pz += o.az * s * ea;
            out.nx = o.ax * s;
            out.nz = o.az * s;
          } else {
            const s = Math.sign(b) || 1;
            px += bx * s * eb;
            pz += bz * s * eb;
            out.nx = bx * s;
            out.nz = bz * s;
          }
          hit = true;
        }
      }
    }
    if (!hit) return null;
    out.x = px;
    out.z = pz;
    return out;
  }

  // keep the on-foot chase camera inside and under the ceiling
  clampCamera(camera, ex, ez) {
    const m = this.#mallAt(ex, ez);
    if (!m) return;
    const p = camera.position;
    const hit = this.collide(p.x, p.z, 0.4) || (this.#mallAt(p.x, p.z) ? null : this.collide(ex + (p.x - ex) * 0.01, ez + (p.z - ez) * 0.01, 0.4));
    if (!this.#mallAt(p.x, p.z)) {
      // pull the camera back toward the player until it is inside
      for (let k = 0.9; k > 0; k -= 0.1) {
        const x = ex + (p.x - ex) * k;
        const z = ez + (p.z - ez) * k;
        if (this.#mallAt(x, z)) {
          p.x = x;
          p.z = z;
          break;
        }
      }
    } else if (hit) {
      p.x = hit.x;
      p.z = hit.z;
    }
    p.y = Math.min(p.y, m.floorY + WALL_H - 0.6);
    p.y = Math.max(p.y, m.floorY + 0.8);
  }

  update(camX, camZ, playerX = camX, playerZ = camZ) {
    for (const m of this.malls) {
      const d = Math.hypot(m.cx - camX, m.cz - camZ);
      if (!m.built && d < BUILD_R && this.pub && this.pub.entrances.some((e) => e.mall === m.name && e.open)) {
        try {
          this.#build(m);
        } catch (err) {
          console.warn('[IZK] mall interior failed', m.name, err);
          m.failed = true;
        }
      }
      if (m.palmPending && m.palmParts && m.palmParts.length) {
        const g = mergeGeometries(m.palmParts, false);
        for (const x of m.palmParts) x.dispose();
        m.palmParts = null;
        m.palmPending = false;
        const mesh = new THREE.Mesh(g, this.mats.solid);
        mesh.name = 'mallPalms';
        this.group.add(mesh);
        m.meshes.push(mesh);
      }
      if (!m.rects.length) continue;
      // near the interior? (any rect within SHOW_R)
      let near = false;
      for (const r of m.rects) if (Math.abs(r.x - camX) < SHOW_R + r.hu && Math.abs(r.z - camZ) < SHOW_R + r.hu) near = true;
      for (const mesh of m.meshes) mesh.visible = near;
      const inNow = m.rects.some((r) => inRect(r, playerX, playerZ));
      if (inNow && this.active !== m) {
        this.active = m;
        if (this.onEnter) this.onEnter(m.name);
      } else if (!inNow && this.active === m) this.active = null;
    }
  }
}
