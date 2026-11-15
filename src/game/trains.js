import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function buildCumulative(pts) {
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(
      pts[i][0] - pts[i - 1][0],
      pts[i][1] - pts[i - 1][1]
    ));
  }
  return cumulative;
}

function sampleLine(pts, cumulative, distance) {
  const total = cumulative[cumulative.length - 1];
  const d = Math.max(0, Math.min(total, distance));
  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < d) i++;
  const span = cumulative[i] - cumulative[i - 1] || 1;
  const t = (d - cumulative[i - 1]) / span;
  const a = pts[i - 1], b = pts[i];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz) || 1;
  return {
    x: a[0] + dx * t,
    z: a[1] + dz * t,
    dirX: dx / length,
    dirZ: dz / length
  };
}

function prepareCarriage(scene, targetLength) {
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const longAxis = size.x >= size.z ? 'x' : 'z';
  const sourceLength = Math.max(0.001, longAxis === 'x' ? size.x : size.z);
  const factor = targetLength / sourceLength;
  const clone = scene.clone(true);
  clone.scale.setScalar(factor);
  if (longAxis === 'x') clone.rotation.y = -Math.PI / 2;
  clone.position.set(0, 0, 0);
  clone.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(clone);
  const normalizedCenter = normalizedBounds.getCenter(new THREE.Vector3());
  clone.position.set(-normalizedCenter.x, -normalizedBounds.min.y, -normalizedCenter.z);
  const pivot = new THREE.Group();
  pivot.add(clone);
  return pivot;
}

export async function buildTrains(roads, hf) {
  const group = new THREE.Group();
  group.name = 'durban-moving-trains';
  const line = (roads.rail || [])
    .map((item) => ({ item, cumulative: buildCumulative(item.pts) }))
    .filter((entry) => entry.cumulative.length > 1 && entry.cumulative[entry.cumulative.length - 1] > 1200)
    .sort((a, b) => b.cumulative[b.cumulative.length - 1] - a.cumulative[a.cumulative.length - 1])[0];
  if (!line) return { group, update() {}, trainCount: 0 };

  const loader = new GLTFLoader();
  try {
    const files = [
      './src/assets/trainkit/train-diesel-a.glb',
      './src/assets/trainkit/train-carriage-container-blue.glb',
      './src/assets/trainkit/train-carriage-container-green.glb',
      './src/assets/trainkit/train-carriage-container-red.glb'
    ];
    const loaded = await Promise.all(files.map((file) => loader.loadAsync(file)));
    const train = new THREE.Group();
    train.name = 'durban-freight-train';
    train.add(prepareCarriage(loaded[0].scene, 18));
    train.add(prepareCarriage(loaded[1].scene, 15));
    train.add(prepareCarriage(loaded[2].scene, 15));
    train.add(prepareCarriage(loaded[3].scene, 15));
    train.children[1].position.z = -17;
    train.children[2].position.z = -32;
    train.children[3].position.z = -47;
    group.add(train);

    const pts = line.item.pts;
    const cumulative = line.cumulative;
    const length = cumulative[cumulative.length - 1];
    let distance = Math.min(length - 70, Math.max(70, length * 0.35));
    const speed = 5.2;
    let direction = 1;
    function update(dt, px, pz) {
      distance += speed * dt * direction;
      if (distance > length - 70) { distance = length - 70; direction = -1; }
      else if (distance < 70) { distance = 70; direction = 1; }
      const p = sampleLine(pts, cumulative, distance);
      train.position.set(p.x, hf.heightAt(p.x, p.z) + 0.35, p.z);
      train.rotation.y = Math.atan2(p.dirX * direction, p.dirZ * direction);
      train.visible = Math.hypot(p.x - px, p.z - pz) < 3600;
    }
    group.userData.trainCount = 1;
    return { group, update, trainCount: 1 };
  } catch (error) {
    console.warn('Freight train models could not be loaded:', error);
    return { group, update() {}, trainCount: 0 };
  }
}
