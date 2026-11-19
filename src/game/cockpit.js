import * as THREE from '../../vendor/three/three.module.js';

// Simple low-poly cockpit for the driver camera: dashboard, gauges, A-pillars,
// a steering wheel that turns with the steering, and two hands on the rim.
// Vehicle space: front = +Z, left = +X, y up. SA cars are right-hand drive.
export const DRIVER_X = -0.36;

export function buildCockpit() {
  const g = new THREE.Group();
  g.name = 'cockpit';
  g.visible = false;
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.8 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x2a4a7a, roughness: 0.9 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xcfe6ff });

  const cloth = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 1 });
  const liner = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 1 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.6, roughness: 0.35 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  // dashboard: lower body, sloping top up to the windscreen, padded lip
  add(new THREE.BoxGeometry(1.56, 0.34, 0.5), dark, 0, 0.78, 0.82);
  add(new THREE.BoxGeometry(1.56, 0.05, 0.42), dark, 0, 0.97, 0.95, -0.22);
  add(new THREE.BoxGeometry(1.56, 0.07, 0.08), trim, 0, 0.95, 0.57);
  // instrument hood and dials in front of the driver (RHD)
  add(new THREE.BoxGeometry(0.5, 0.1, 0.22), trim, DRIVER_X, 1.06, 0.6);
  for (const dx of [-0.11, 0.11]) {
    add(new THREE.CircleGeometry(0.075, 20), glow, DRIVER_X + dx, 1.0, 0.495, 0, Math.PI, 0);
    add(new THREE.BoxGeometry(0.006, 0.06, 0.004), new THREE.MeshBasicMaterial({ color: 0xff4a2a }), DRIVER_X + dx, 1.01, 0.492, 0, 0, dx > 0 ? 0.7 : -0.4);
  }
  // centre stack: two vents, radio, climate knobs
  add(new THREE.BoxGeometry(0.32, 0.36, 0.06), trim, 0.02, 0.74, 0.56);
  for (const vx of [-0.08, 0.12]) add(new THREE.BoxGeometry(0.1, 0.05, 0.02), dark, vx, 0.88, 0.53);
  add(new THREE.BoxGeometry(0.22, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0x1b8f5a }), 0.02, 0.77, 0.53);
  for (const kx of [-0.08, 0.02, 0.12]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 10), metal, kx, 0.66, 0.53, Math.PI / 2, 0, 0);
  // side vents at each end of the dash
  for (const sx of [-0.68, 0.68]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), dark, sx, 0.9, 0.57, Math.PI / 2, 0, 0);
  // centre console, gear lever and handbrake between the seats
  add(new THREE.BoxGeometry(0.24, 0.22, 0.9), trim, 0.02, 0.5, 0.1);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), metal, 0.02, 0.7, 0.3, -0.2, 0, 0);
  add(new THREE.SphereGeometry(0.035, 10, 8), dark, 0.02, 0.8, 0.32);
  add(new THREE.BoxGeometry(0.04, 0.04, 0.24), dark, 0.02, 0.64, -0.1, 0.25, 0, 0);
  // doors: panel, armrest, window sill, with the side window above
  for (const sx of [-0.8, 0.8]) {
    add(new THREE.BoxGeometry(0.06, 0.55, 1.5), trim, sx, 0.78, 0.1);
    add(new THREE.BoxGeometry(0.1, 0.05, 0.5), cloth, sx - Math.sign(sx) * 0.05, 0.8, 0.0);
    add(new THREE.BoxGeometry(0.1, 0.04, 1.5), dark, sx, 1.07, 0.1);
    add(new THREE.BoxGeometry(0.04, 0.04, 0.12), metal, sx - Math.sign(sx) * 0.04, 0.92, 0.3); // door handle
  }
  // A-pillars (windscreen frame), B-pillars, roof liner, header over the windscreen
  for (const sx of [-0.74, 0.74]) {
    add(new THREE.BoxGeometry(0.08, 0.66, 0.08), dark, sx, 1.32, 0.6, -0.6, 0, sx > 0 ? -0.1 : 0.1);
    add(new THREE.BoxGeometry(0.08, 0.6, 0.12), liner, sx * 1.04, 1.3, -0.6);
  }
  add(new THREE.BoxGeometry(1.6, 0.04, 1.7), liner, 0, 1.62, -0.35);
  add(new THREE.BoxGeometry(1.5, 0.08, 0.12), liner, 0, 1.57, 0.4);
  add(new THREE.BoxGeometry(0.2, 0.1, 0.02), liner, -0.5, 1.53, 0.36, 0.5, 0, 0); // sun visor
  // rear-view mirror housing on its stalk (the picture is drawn by the mirror camera)
  add(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 6), dark, 0.05, 1.53, 0.38);
  add(new THREE.BoxGeometry(0.26, 0.08, 0.03), dark, 0.05, 1.47, 0.37);
  // wing-mirror housings just outside the windows
  for (const sx of [-0.96, 0.96]) add(new THREE.BoxGeometry(0.06, 0.12, 0.2), dark, sx, 1.14, 0.55);
  // passenger seat and the edge of the driver's seat
  add(new THREE.BoxGeometry(0.5, 0.14, 0.5), cloth, 0.38, 0.5, -0.15);
  add(new THREE.BoxGeometry(0.5, 0.62, 0.12), cloth, 0.38, 0.84, -0.42, -0.12, 0, 0);
  add(new THREE.BoxGeometry(0.26, 0.16, 0.1), cloth, 0.38, 1.24, -0.46);
  add(new THREE.BoxGeometry(0.5, 0.14, 0.5), cloth, DRIVER_X, 0.5, -0.15);
  // floor and pedals
  add(new THREE.BoxGeometry(1.56, 0.04, 1.8), new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 1 }), 0, 0.36, 0.05);
  for (const px of [-0.1, 0.0, 0.12]) add(new THREE.BoxGeometry(0.06, 0.1, 0.02), metal, DRIVER_X + px, 0.48, 0.62, -0.4, 0, 0);

  // Steering wheel (pivot tilted toward the driver, spins about its own axis).
  const column = new THREE.Group();
  column.position.set(DRIVER_X, 0.98, 0.42);
  column.rotation.x = -0.38;
  g.add(column);
  const wheel = new THREE.Group();
  wheel.name = 'steeringWheel';
  column.add(wheel);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.022, 8, 28), trim));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), dark);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.02), dark);
    spoke.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0);
    spoke.rotation.z = a;
    wheel.add(spoke);
  }
  // Hands at nine and three, with short forearms back toward the driver.
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hand.position.set(side * 0.185, 0.0, 0);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.06), skin);
    hand.add(palm);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 8), sleeve);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * 0.03, -0.04, -0.22);
    hand.add(arm);
    wheel.add(hand);
  }
  g.userData.wheel = wheel;
  return g;
}

export function updateCockpit(cockpit, steer) {
  const w = cockpit.userData.wheel;
  if (w) w.rotation.z = -steer * 2.4; // steer +1 = right? wheel turns the same way
}
