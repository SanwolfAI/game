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
  mabhida: { lon: 31.0255, lat: -29.8339 },
  ushaka: { lon: 31.0281, lat: -29.8706 },
  harbour: { lon: 31.045, lat: -29.893 },
  market: { lon: 31.0209, lat: -29.857 }
};

// Moses Mabhida Stadium: 56 000-seat bowl crossed by its 106 m arch.
function mabhidaStadium(hf) {
  const group = new THREE.Group();
  group.name = 'landmark-mabhida';
  const [px, pz] = landPoint(hf, ...toXZ(PLACE.mabhida.lon, PLACE.mabhida.lat));
  const y = groundAt(hf, px, pz);
  group.position.set(px, y, pz);

  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(118, 118, 24, 48, 1, true),
    new THREE.MeshLambertMaterial({ color: 0xe8e7e2, side: THREE.DoubleSide })
  );
  bowl.position.y = 12;
  bowl.scale.z = 0.72;
  group.add(bowl);

  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(126, 126, 3.2, 48, 1, true),
    new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  roof.position.y = 24.6;
  roof.scale.z = 0.72;
  group.add(roof);

  const pitch = new THREE.Mesh(new THREE.CylinderGeometry(102, 102, 1.4, 40), mat(0x3f7d3a));
  pitch.position.y = 0.8;
  pitch.scale.z = 0.7;
  group.add(pitch);

  const track = new THREE.Mesh(new THREE.CylinderGeometry(112, 112, 0.5, 40), mat(0xa8493c));
  track.position.y = 1.7;
  track.scale.z = 0.71;
  group.add(track);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const mx = Math.cos(a) * 124;
    const mz = Math.sin(a) * 124 * 0.72;
    box(group, 2.4, 30, 2.4, mx, 15, mz, 0xd8d8d2, -a);
    const light = cone(group, 1.5, 1.8, mx, 30.6, mz, 0xfff3c0, 6);
    light.material = new THREE.MeshBasicMaterial({ color: 0xfff3c0 });
  }

  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(94, 3.4, 10, 60, Math.PI),
    mat(0xf4f4f0)
  );
  arch.position.y = 0.4;
  group.add(arch);

  for (let i = 2; i <= 8; i++) {
    const t = i / 10;
    const a = Math.PI * t;
    const ax = Math.cos(a) * 94;
    const ay = Math.sin(a) * 94;
    if (ay < 26) continue;
    box(group, 0.22, ay - 24, 0.22, ax, 24 + (ay - 24) / 2, 0, 0xd0d0ca);
  }

  group.rotation.y = 0.4;
  return { group, colliders: [{ x: px, z: pz, r: 112 }] };
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
