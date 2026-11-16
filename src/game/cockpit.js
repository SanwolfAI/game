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

  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.55), dark);
  dash.position.set(0, 0.92, 0.78);
  g.add(dash);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.22), trim); // instrument hood
  hood.position.set(DRIVER_X, 1.06, 0.6);
  g.add(hood);
  for (const dx of [-0.11, 0.11]) {
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), glow);
    dial.position.set(DRIVER_X + dx, 1.0, 0.495);
    dial.rotation.y = Math.PI;
    dial.material = glow;
    g.add(dial);
  }
  for (const sx of [-0.74, 0.74]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.62, 0.07), dark);
    pillar.position.set(sx, 1.3, 0.62);
    pillar.rotation.x = -0.55;
    pillar.rotation.z = sx > 0 ? -0.12 : 0.12;
    g.add(pillar);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.12), dark);
  roof.position.set(0, 1.56, 0.42);
  g.add(roof);

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
