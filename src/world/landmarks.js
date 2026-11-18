import * as THREE from '../../vendor/three/three.module.js';
import { toXZ } from '../core/geo.js';

function mat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function box(group, w, h, d, x, y, z, color, yaw = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  group.add(mesh);
  return mesh;
}

function cylinder(group, rTop, rBottom, h, x, y, z, color, segments = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat(color));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function cone(group, r, h, x, y, z, color, segments = 4) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, h, segments), mat(color));
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

function landPoint(hf, x, z) {
  if (!hf.isWater(x, z) && hf.signedCoastDistance(x, z) > 14) return [x, z];
  for (let r = 30; r <= 600; r += 30) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const nx = x + Math.cos(ang) * r;
      const nz = z + Math.sin(ang) * r;
      if (!hf.isWater(nx, nz) && hf.signedCoastDistance(nx, nz) > 14) return [nx, nz];
    }
  }
  return [x, z];
}

function groundAt(hf, x, z) {
  return hf.isWater(x, z) ? 0.6 : hf.heightAt(x, z);
}

const PLACE = {
  ushaka: { lon: 31.0281, lat: -29.8706 },
  harbour: { lon: 31.045, lat: -29.893 },
  market: { lon: 31.0209, lat: -29.857 }
};

// Moses Mabhida Stadium, placed on its real OSM footprint (relation 318673,
// centre -29.82900, 31.03037) with the arch on its real axis (OSM way
// 172893308: 379 m long, running NNE-SSW, splitting into two legs at the
// south end). Bowl ~260 x 240 m, PTFE roof hung from the arch by cables,
// mosaic seating, striped pitch, paved podium. OSM footprints inside are
// hidden (buildings.exclude) so nothing else stands in the bowl.
export const MABHIDA = { lon: 31.030366, lat: -29.828995, ux: 0.3302, uz: -0.9439, a: 150, b: 140 };

function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// strip between ellipse rings; rings = [[a, b, y, v], ...]
function ellipseStrip(rings, seg, uRep, material) {
  const pos = [];
  const uv = [];
  const idx = [];
  const cols = seg + 1;
  for (const [a, b, y, v] of rings) {
    for (let k = 0; k <= seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      pos.push(Math.cos(t) * a, y, Math.sin(t) * b);
      uv.push((k / seg) * uRep, v);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < seg; k++) {
      const p = r * cols + k;
      idx.push(p, p + cols, p + 1, p + 1, p + cols, p + cols + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

function mabhidaStadium(hf) {
  const group = new THREE.Group();
  group.name = 'landmark-mabhida';
  const M = MABHIDA;
  const [px, pz] = toXZ(M.lon, M.lat);
  const y = groundAt(hf, px, pz);
  group.position.set(px, y, pz);
  group.rotation.y = Math.atan2(-M.uz, M.ux); // local +X = arch axis (NNE)
  const SEG = 96;

  // paved podium with a skirt down to the ground
  const paving = canvasTex(64, 64, (g) => {
    g.fillStyle = '#c9c4ba';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(90,85,78,0.35)';
    for (let i = 0; i <= 64; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
    }
  }, 60, 4);
  const podMat = new THREE.MeshLambertMaterial({ map: paving, side: THREE.DoubleSide });
  group.add(ellipseStrip([[150, 140, -6, 0], [150, 140, 0.35, 0.1], [118, 108, 0.35, 1]], SEG, 1, podMat));

  // white ribbed facade, leaning outward
  const ribs = canvasTex(64, 64, (g) => {
    g.fillStyle = '#f2f1ec';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#c9cdd0';
    g.fillRect(0, 0, 10, 64);
    g.fillStyle = 'rgba(40,60,70,0.55)';
    for (let r = 8; r < 64; r += 16) g.fillRect(14, r, 50, 5);
  }, 70, 1);
  group.add(ellipseStrip([[118, 108, 0.3, 0], [131, 121, 42, 1]], SEG, 1, new THREE.MeshLambertMaterial({ map: ribs, side: THREE.DoubleSide })));

  // seating bowl: mosaic seats, three tiers
  const seats = canvasTex(128, 128, (g) => {
    const pal = ['#1f5f8b', '#2a7a9b', '#3e8f7a', '#c46a2b', '#8a3b2e', '#d9a441', '#2d4d6b', '#5f7f3a'];
    g.fillStyle = '#6c6c68';
    g.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 32; c++) {
        const n = Math.sin(c * 0.41 + r * 0.73) + Math.sin(c * 0.13 - r * 0.29) * 1.3;
        g.fillStyle = pal[Math.abs(Math.floor(n * 2.7 + 8)) % pal.length];
        g.fillRect(c * 4, r * 8, 4, 5);
      }
    }
  }, 120, 6);
  const seatMat = new THREE.MeshLambertMaterial({ map: seats, side: THREE.DoubleSide });
  group.add(ellipseStrip([[66, 48, 1.2, 0], [86, 70, 9, 0.33], [88, 72, 10.5, 0.36], [104, 90, 20, 0.62], [106, 92, 22, 0.66], [124, 112, 38, 1]], SEG, 1, seatMat));

  // pitch: surround + mown stripes
  group.add(ellipseStrip([[66, 48, 0.6, 0], [0.1, 0.1, 0.6, 1]], 48, 1, mat(0x2f6b34)));
  const grass = canvasTex(256, 64, (g) => {
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#3f8a3a' : '#4d9b44';
      g.fillRect(i * 16, 0, 16, 64);
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.5;
    g.strokeRect(1, 1, 254, 62);
    g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 64); g.stroke();
    g.beginPath(); g.arc(128, 32, 9, 0, Math.PI * 2); g.stroke();
    g.strokeRect(1, 14, 40, 36);
    g.strokeRect(215, 14, 40, 36);
  });
  grass.wrapS = grass.wrapT = THREE.ClampToEdgeWrapping;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshLambertMaterial({ map: grass }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.7;
  group.add(pitch);

  // PTFE roof membrane with steel edge rings
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xf7f6f2, side: THREE.DoubleSide, transparent: true, opacity: 0.88, emissive: 0x202020 });
  group.add(ellipseStrip([[134, 124, 43.5, 0], [112, 100, 45.5, 0.5], [84, 70, 46.5, 1]], SEG, 1, roofMat));
  group.add(ellipseStrip([[84, 70, 46.5, 0], [84, 70, 45.3, 1]], SEG, 1, mat(0x9aa0a4)));
  // floodlights along the inner roof edge
  const fl = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.8, 1.4), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), 48);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -t);
    m4.compose(new THREE.Vector3(Math.cos(t) * 86, 45.6, Math.sin(t) * 72), q, new THREE.Vector3(1, 1, 1));
    fl.setMatrixAt(i, m4);
  }
  group.add(fl);

  // the arch: 379 m long, 106 m high, splitting into two legs at the south (-X) end
  const H = 106;
  const L = 189;
  const archY = (x) => H * Math.pow(Math.max(0, 1 - (x / L) * (x / L)), 0.85);
  const archMat = new THREE.MeshLambertMaterial({ color: 0xf6f6f2 });
  const mkTube = (pts, r) => group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, r, 8, false), archMat));
  const main = [];
  for (let x = -110; x <= L; x += 8) main.push(new THREE.Vector3(Math.min(x, L), archY(Math.min(x, L)) - (x >= L ? 1 : 0), 0));
  mkTube(main, 2.6);
  for (const side of [-1, 1]) {
    const leg = [];
    for (let x = -L; x <= -102; x += 8) {
      const t = (x + 110) / (-L + 110); // 0 at split, 1 at foot
      leg.push(new THREE.Vector3(x, archY(x) - (x <= -L ? 1 : 0), side * 16 * Math.max(0, Math.min(1, t)) ** 0.8));
    }
    leg.push(new THREE.Vector3(-102, archY(-102), 0));
    mkTube(leg, 1.9);
  }
  // cables from the arch down to the roof's inner ring
  const cab = [];
  for (let x = -78; x <= 78; x += 6) {
    const ay = archY(x);
    const zr = 70 * Math.sqrt(Math.max(0, 1 - (x / 84) * (x / 84)));
    cab.push(x, ay - 2, 0, x, 46.5, zr, x, ay - 2, 0, x, 46.5, -zr);
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cab, 3));
  group.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x8a9096 })));
  // SkyCar near the north foot
  const car = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), mat(0xd23c3c));
  car.position.set(140, archY(140) + 3.4, 0);
  car.rotation.z = -0.75;
  group.add(car);

  return { group, colliders: [{ x: px, z: pz, r: 122 }] };
}

// uShaka Marine World: ship-shaped aquarium with colourful slide towers.
function ushakaMarine(hf) {
  const group = new THREE.Group();
  group.name = 'landmark-ushaka';
  const [px, pz] = landPoint(hf, ...toXZ(PLACE.ushaka.lon, PLACE.ushaka.lat));
  const y = groundAt(hf, px, pz);
  group.position.set(px, y, pz);

  box(group, 34, 5, 13, 0, 2.5, 0, 0x3f4b52);
  box(group, 26, 3, 11, 2, 6.4, 0, 0x5d6b72);
  box(group, 13, 6, 10, -8, 9, 0, 0xe9e4d8);
  box(group, 8, 4, 8, 8, 9, 0, 0xe9e4d8);
  const bow = cone(group, 5.5, 9, 17.5, 3, 0, 0x3f4b52, 4);
  bow.rotation.z = -Math.PI / 2;

  const roofColors = [0xd94f3d, 0xf2c230, 0x2f8f4e, 0x2f6fb5];
  for (let i = 0; i < 4; i++) {
    const rx = -24 + i * 9;
    box(group, 12, 6, 10, rx, 3, -18, roofColors[i]);
    cone(group, 8, 8, rx, 10, -18, roofColors[(i + 1) % 4], 4);
  }

  cylinder(group, 4, 5, 26, 26, 13, -12, 0xf0eee7, 10);
  cylinder(group, 3.4, 3.8, 20, 34, 10, -6, 0xf0eee7, 10);
  const slide = new THREE.Mesh(new THREE.TorusGeometry(9, 1.1, 8, 24, Math.PI * 1.4), mat(0x2f9fd9));
  slide.position.set(30, 18, -9);
  slide.rotation.set(Math.PI / 2, 0, 0.4);
  group.add(slide);

  group.rotation.y = -0.5;
  return { group, colliders: [{ x: px, z: pz, r: 36 }] };
}

// Durban Harbour container terminal with ship-to-shore gantry cranes.
function harbourCranes(hf) {
  const group = new THREE.Group();
  group.name = 'landmark-harbour';
  const [px, pz] = landPoint(hf, ...toXZ(PLACE.harbour.lon, PLACE.harbour.lat));
  const y = Math.max(1.2, groundAt(hf, px, pz));
  group.position.set(px, y, pz);

  const containers = [0xc0392b, 0x2f6fb5, 0x2f8f4e, 0xe67e22, 0x8e44ad, 0x16a085];
  for (let i = 0; i < 46; i++) {
    const cx = (i % 12) * 6.4 - 36;
    const cz = Math.floor(i / 12) * 3.2 - 4;
    const stack = Math.floor((i * 7) % 3);
    for (let s = 0; s <= stack; s++) {
      box(group, 6, 2.6, 2.5, cx, 1.4 + s * 2.7, cz, containers[(i + s) % containers.length]);
    }
  }

  for (let i = 0; i < 3; i++) {
    const cx = -30 + i * 34;
    const cz = 12;
    box(group, 4.6, 40, 4.6, cx, 20, cz, 0x2b5f8a);
    box(group, 4.8, 2, 4.8, cx, 40.5, cz, 0x1e4868);
    box(group, 58, 2.4, 3.4, cx + 12, 39, cz, 0x2b5f8a);
    box(group, 12, 2.2, 5, cx - 16, 39, cz, 0x1e4868);
    box(group, 1.4, 26, 1.4, cx - 20, 25, cz, 0x3b73a0);
    box(group, 1.2, 12, 1.2, cx + 30, 32, cz, 0x3b73a0);
    box(group, 5, 2.6, 3.4, cx + 30, 24.5, cz, 0xe0b33c);
    box(group, 0.3, 12, 0.3, cx + 30, 32, cz, 0x3b73a0);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
    beacon.position.set(cx, 42, cz);
    group.add(beacon);
  }

  box(group, 150, 1.2, 30, 0, 0.3, 4, 0x6a6f73);
  group.rotation.y = -0.2;
  return { group, colliders: [{ x: px, z: pz, r: 46 }] };
}

// Victoria Street Market: Indian-spice hall with minarets and awnings.
function victoriaMarket(hf) {
  const group = new THREE.Group();
  group.name = 'landmark-market';
  const [px, pz] = landPoint(hf, ...toXZ(PLACE.market.lon, PLACE.market.lat));
  const y = groundAt(hf, px, pz);
  group.position.set(px, y, pz);

  box(group, 52, 13, 34, 0, 6.5, 0, 0xe9dfc8);
  box(group, 54, 1.2, 36, 0, 13.2, 0, 0xc7b48f);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(17, 17, 52, 18, 1, false, -Math.PI / 2, Math.PI),
    mat(0xd8c9a8)
  );
  barrel.rotation.z = Math.PI / 2;
  barrel.position.y = 20;
  group.add(barrel);

  for (const sx of [-24, 24]) {
    for (const sz of [-15, 15]) {
      box(group, 4, 22, 4, sx, 11, sz, 0xe4d8bf);
      cylinder(group, 3.4, 2.4, 4, sx, 24, sz, 0xd8c9a8, 10);
      cone(group, 2.6, 5, sx, 28.5, sz, 0x2f8f4e, 10);
    }
  }

  const awnings = [0xd94f3d, 0xf2c230, 0x2f6fb5, 0x2f8f4e];
  for (let i = 0; i < 4; i++) {
    const ax = -18 + i * 12;
    box(group, 10, 0.5, 5, ax, 5.2, 19, awnings[i]);
    for (let j = 0; j < 3; j++) {
      box(group, 1.1, 1, 1.1, ax - 4 + j * 3, 2.4, 20.5, 0x7a5c3c);
      box(group, 2.2, 0.8, 1.6, ax - 4 + j * 3, 1.6, 20.5, awnings[(i + j) % 4]);
    }
  }

  box(group, 54, 0.6, 8, 0, 0.4, 21, 0x8a857c);
  group.rotation.y = 0.12;
  return { group, colliders: [{ x: px, z: pz, r: 34 }] };
}

export function buildLandmarks(hf, city) {
  const root = new THREE.Group();
  root.name = 'landmarks';
  const builders = [mabhidaStadium, ushakaMarine, harbourCranes, victoriaMarket];
  for (const build of builders) {
    const { group, colliders } = build(hf);
    root.add(group);
    if (city) {
      for (const c of colliders) city.addCollider(c.x, c.z, c.r);
    }
  }
  return root;
}
