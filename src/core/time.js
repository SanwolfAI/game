// Real-world Durban time, season and an approximate solar model.
// Durban is at 29.86°S, 31.02°E (SAST, UTC+2, no daylight saving).

import { clamp, smoothstep } from './utils.js';

const LAT = (-29.8587 * Math.PI) / 180;
const TZ_HOURS = 2;
const DAY_MS = 86400000;

export const SEASONS = {
  summer: {
    id: 'summer',
    name: 'Summer',
    months: 'Dec – Feb',
    sky: 0x8fc0e8,
    fog: 0xa8cfe6,
    sun: 0xfff2d0,
    ground: 0x4f6b3d,
    tint: 0xfff0c8,
    note: 'Hot and humid, afternoon thunderstorms'
  },
  autumn: {
    id: 'autumn',
    name: 'Autumn',
    months: 'Mar – May',
    sky: 0x9dc0d8,
    fog: 0xb7c8cf,
    sun: 0xffe6b8,
    ground: 0x53603d,
    tint: 0xf0d7a8,
    note: 'Warm days, golden light'
  },
  winter: {
    id: 'winter',
    name: 'Winter',
    months: 'Jun – Aug',
    sky: 0x9fc9e8,
    fog: 0xc3d8e6,
    sun: 0xfff4dd,
    ground: 0x4a5a3e,
    tint: 0xdfe8f2,
    note: 'Dry, clear and mild'
  },
  spring: {
    id: 'spring',
    name: 'Spring',
    months: 'Sep – Nov',
    sky: 0x92c4e4,
    fog: 0xaed2e8,
    sun: 0xfff0c9,
    ground: 0x547440,
    tint: 0xdaefc8,
    note: 'Green hills, warm sea breeze'
  }
};

export function seasonForDate(date) {
  const m = date.getMonth();
  if (m === 11 || m <= 1) return SEASONS.summer;
  if (m <= 4) return SEASONS.autumn;
  if (m <= 7) return SEASONS.winter;
  return SEASONS.spring;
}

// Current wall-clock time for Durban, independent of the device timezone.
export function durbanNow() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + TZ_HOURS * 3600000);
}

export function dayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / DAY_MS);
}

// Solar declination for the day (degrees).
function declination(date) {
  const n = dayOfYear(date);
  return 23.44 * Math.sin(((2 * Math.PI) / 365) * (n - 80)) * (Math.PI / 180);
}

export function sunTimes(date) {
  const dec = declination(date);
  const cosH0 = -Math.tan(LAT) * Math.tan(dec);
  const h0 = Math.acos(clamp(cosH0, -1, 1));
  const halfDay = (h0 * 180) / Math.PI / 15;
  const solarNoon = 12.1;
  return {
    sunrise: solarNoon - halfDay,
    sunset: solarNoon + halfDay,
    daylight: halfDay * 2
  };
}

// Returns the sun direction (world +Y up, +X east, -Z north) and lighting weights.
export function solarState(date) {
  const dec = declination(date);
  const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const H = ((hours - 12.1) * 15 * Math.PI) / 180;

  const sinDec = Math.sin(dec);
  const cosDec = Math.cos(dec);
  const sinLat = Math.sin(LAT);
  const cosLat = Math.cos(LAT);

  const up = sinLat * sinDec + cosLat * cosDec * Math.cos(H);
  const east = -cosDec * Math.sin(H);
  const north = cosLat * sinDec - sinLat * cosDec * Math.cos(H);
  const len = Math.hypot(east, up, north) || 1;

  const elevation = Math.asin(clamp(up / len, -1, 1));
  const dir = [east / len, up / len, -north / len];

  // 0 at night, 1 in full daylight, with a warm band around the horizon.
  const day = smoothstep(-0.08, 0.16, Math.sin(elevation));
  const golden = Math.exp(-Math.pow(elevation / 0.22, 2));
  const night = 1 - smoothstep(-0.18, 0.02, Math.sin(elevation));

  return { dir, elevation, day, golden, night, declination: dec };
}

export function formatDurbanTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatDurbanDate(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function isNight(date) {
  const { sunrise, sunset } = sunTimes(date);
  const h = date.getHours() + date.getMinutes() / 60;
  return h < sunrise || h > sunset;
}

// Accelerated in-game clock: one 24-hour game day passes in four real hours.
// Every fresh game session begins at 08:00 so play starts in daylight.
export function createGameClock() {
  const startReal = Date.now();
  const startGame = durbanNow();
  startGame.setHours(8, 0, 0, 0);
  return function gameNow() {
    return new Date(startGame.getTime() + (Date.now() - startReal) * 6);
  };
}
