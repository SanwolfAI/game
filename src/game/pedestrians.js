import * as THREE from 'three';
import { buildPedestrianGeometry } from './models.js';

const COUNT = 120;

export class Pedestrians {
  constructor(hf, city, rng, px, pz) {
    this.hf = hf;
    this.city = city;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'pedestrians';

    const geo = buildPedestrianGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);

    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.pos = new THREE.Vector3();
    this.scale = new THREE.Vector3();

    this.people = [];
    for (let i = 0; i < COUNT; i++) {
      const person = this.#spawn(px, pz);
      this.people.push(person);
    }
    this.#write();
  }

  #spawn(px, pz) {
    for (let tries = 0; tries < 25; tries++) {
      const ang = this.rng() * Math.PI * 2;
      const r = 18 + this.rng() * 320;
      const x = px + Math.cos(ang) * r;
      const z = pz + Math.sin(ang) * r;
      if (this.hf.isWater(x, z) || this.hf.signedCoastDistance(x, z) < 8) continue;
      const near = this.city.hash.query(x, z, 2.5);
      if (near.length) continue;
      return this.#makePerson(x, z);
    }
    return this.#makePerson(px + 6, pz + 6);
  }

  #makePerson(x, z) {
    return {
      x,
      z,
      yaw: this.rng() * Math.PI * 2,
      speed: 0.9 + this.rng() * 0.9,
      phase: this.rng() * Math.PI * 2,
      turn: this.rng() * 4,
      scale: 0.9 + this.rng() * 0.18
    };
  }

  update(dt, px, pz) {
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      if (Math.hypot(p.x - px, p.z - pz) > 420) {
        this.people[i] = this.#spawn(px, pz);
        continue;
      }

      p.turn -= dt;
      if (p.turn <= 0) {
        p.turn = 2 + this.rng() * 6;
        p.yaw += (this.rng() - 0.5) * 1.4;
      }

      const nx = p.x + Math.sin(p.yaw) * p.speed * dt;
      const nz = p.z + Math.cos(p.yaw) * p.speed * dt;
      if (this.hf.isWater(nx, nz) || this.hf.signedCoastDistance(nx, nz) < 5) {
        p.yaw += Math.PI * (0.6 + this.rng() * 0.8);
      } else {
        p.x = nx;
        p.z = nz;
      }
      p.phase += p.speed * dt * 5;
    }
    this.#write();
  }

  #write() {
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      const bob = Math.abs(Math.sin(p.phase)) * 0.05;
      this.pos.set(p.x, this.hf.heightAt(p.x, p.z) + bob, p.z);
      this.quat.setFromAxisAngle(this.axis, p.yaw);
      this.scale.set(p.scale, p.scale, p.scale);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = this.people.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
