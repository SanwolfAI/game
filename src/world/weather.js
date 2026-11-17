import * as THREE from '../../vendor/three/three.module.js';
import { thunderSound, setRainLevel } from '../game/audio.js';

// Random live weather. Nobody can predict it: Math.random picks the next state
// and how long it lasts, then everything blends smoothly into it.
//  cloud: 0 clear .. 1 fully overcast (greys the sky, dims the sun, hides stars)
//  rain:  0 .. 1 streak density + hiss;  fog: visibility multiplier;  storm: lightning
const STATES = {
  clear: { cloud: 0.0, rain: 0, fog: 1.0, storm: 0 },
  fair: { cloud: 0.3, rain: 0, fog: 1.0, storm: 0 },
  cloudy: { cloud: 0.6, rain: 0, fog: 0.85, storm: 0 },
  overcast: { cloud: 0.9, rain: 0, fog: 0.7, storm: 0 },
  drizzle: { cloud: 0.9, rain: 0.3, fog: 0.6, storm: 0 },
  rain: { cloud: 1.0, rain: 0.75, fog: 0.45, storm: 0 },
  storm: { cloud: 1.0, rain: 1.0, fog: 0.35, storm: 1 },
  mist: { cloud: 0.7, rain: 0, fog: 0.3, storm: 0 }
};
// what can follow what (weights) — loose, so sudden changes still happen
const NEXT = {
  clear: { clear: 3, fair: 4, cloudy: 1, mist: 0.5 },
  fair: { clear: 3, fair: 2, cloudy: 3, storm: 0.4 },
  cloudy: { fair: 3, cloudy: 1, overcast: 3, drizzle: 1, storm: 0.6 },
  overcast: { cloudy: 2, overcast: 1, drizzle: 2, rain: 2, mist: 0.7 },
  drizzle: { overcast: 2, rain: 2, cloudy: 1, drizzle: 1 },
  rain: { drizzle: 2, storm: 1.5, overcast: 2, rain: 1 },
  storm: { rain: 3, overcast: 1, storm: 0.6 },
  mist: { fair: 2, cloudy: 2, overcast: 1, clear: 1 }
};
// Durban climate bias per season (multiplies the weights above):
//  summer (Dec-Feb): hot, humid, wettest, afternoon thunderstorms
//  autumn (Mar-May): mild, settling, fewer storms
//  winter (Jun-Aug): dry, clear and sunny, cool mornings with mist
//  spring (Sep-Nov): rains return, grey drizzly spells, first storms
const SEASON = {
  summer: { clear: 0.8, fair: 1, cloudy: 1.2, overcast: 1.1, drizzle: 1, rain: 1.6, storm: 2.2, mist: 0.5 },
  autumn: { clear: 1.2, fair: 1.2, cloudy: 1, overcast: 0.9, drizzle: 0.8, rain: 0.8, storm: 0.5, mist: 1 },
  winter: { clear: 2.2, fair: 1.4, cloudy: 0.7, overcast: 0.5, drizzle: 0.4, rain: 0.35, storm: 0.1, mist: 1.4 },
  spring: { clear: 0.9, fair: 1, cloudy: 1.2, overcast: 1.3, drizzle: 1.5, rain: 1.2, storm: 1, mist: 1.1 }
};
function pick(w, season, hour) {
  const m = SEASON[season] || SEASON.spring;
  const b = {};
  for (const k in w) {
    let v = w[k] * (m[k] || 1);
    // summer storms build in the afternoon; mist belongs to the early morning
    if (k === 'storm' && season === 'summer' && hour >= 13 && hour <= 19) v *= 2;
    if (k === 'mist' && (hour < 5 || hour > 10)) v *= 0.3;
    b[k] = v;
  }
  w = b;
  let sum = 0;
  for (const k in w) sum += w[k];
  let r = Math.random() * sum;
  for (const k in w) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return 'fair';
}
const STORM_GREY = new THREE.Color(0x5d6670);
const NIGHT_GREY = new THREE.Color(0x0c0f14);
const FLASH = new THREE.Color(0xdfe6ff);

export class Weather {
  constructor(scene) {
    this.name = 'fair';
    this.first = true;
    this.cur = Object.assign({}, STATES[this.name]);
    this.timer = this.#duration();
    this.flash = 0;
    this.nextBolt = 5 + Math.random() * 10;

    // rain streaks: one LineSegments box that follows the camera
    const N = 1400;
    const pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * 60;
      this.drops[i * 3 + 1] = Math.random() * 30;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.N = N;
    scene.add(this.rain);
  }

  #duration() {
    // 2..12 real minutes, occasionally very short
    return Math.random() < 0.15 ? 40 + Math.random() * 60 : 120 + Math.random() * 600;
  }

  get label() {
    return this.name;
  }

  update(dt, camera, season = 'spring', hour = 12) {
    if (this.first) {
      // random starting sky, weighted by the season
      this.first = false;
      this.name = pick({ clear: 2, fair: 3, cloudy: 2, overcast: 1, drizzle: 0.5, rain: 0.5, storm: 0.2, mist: 0.5 }, season, hour);
      Object.assign(this.cur, STATES[this.name]);
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.name = pick(NEXT[this.name], season, hour);
      this.timer = this.#duration();
    }
    const tg = STATES[this.name];
    const k = 1 - Math.exp(-dt / 25); // ~25 s blend
    for (const key of ['cloud', 'rain', 'fog', 'storm']) this.cur[key] += (tg[key] - this.cur[key]) * k;

    // lightning
    this.flash = Math.max(0, this.flash - dt * 5);
    if (this.cur.storm > 0.5) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.flash = 1;
        thunderSound(Math.random());
        this.nextBolt = 4 + Math.random() * 18;
      }
    }

    // rain streaks
    const r = this.cur.rain;
    this.rain.visible = r > 0.03;
    setRainLevel(r);
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position.array;
      const n = Math.floor(this.N * Math.min(1, r * 1.1));
      const fall = 22 * dt;
      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;
      for (let i = 0; i < this.N; i++) {
        const j = i * 3;
        let y = this.drops[j + 1] - fall;
        if (y < -8) y += 38;
        this.drops[j + 1] = y;
        const o = i * 6;
        if (i >= n) {
          p[o] = p[o + 3] = cx;
          p[o + 1] = p[o + 4] = cy - 500;
          p[o + 2] = p[o + 5] = cz;
          continue;
        }
        // wrap horizontally around the camera
        let x = this.drops[j] - (cx % 60);
        x = ((x % 60) + 90) % 60 - 30;
        let z = this.drops[j + 2] - (cz % 60);
        z = ((z % 60) + 90) % 60 - 30;
        p[o] = cx + x;
        p[o + 1] = cy + y;
        p[o + 2] = cz + z;
        p[o + 3] = cx + x + 0.15;
        p[o + 4] = cy + y + 1.1;
        p[o + 5] = cz + z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rainMat.opacity = 0.25 + r * 0.35;
    }
  }

  // Tint a sky colour in place for clouds / storm / lightning.
  applySky(sky, day) {
    const grey = NIGHT_GREY.clone().lerp(STORM_GREY, day);
    if (this.cur.rain > 0.2) grey.multiplyScalar(1 - this.cur.rain * 0.25);
    sky.lerp(grey, this.cur.cloud * 0.8);
    if (this.flash > 0) sky.lerp(FLASH, this.flash * 0.7);
    return sky;
  }
}
