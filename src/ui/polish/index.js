// Mobile polish (25 Nov 2026): title screen + loading tips, steering choice
// (wheel / buttons / tilt), first-time tutorial, garage (paint + rims),
// daily reward + achievements, vibration, settings, pause-menu shortcuts.
//
// Loaded from index.html BEFORE main.js so the title shows at once, and it
// only talks to the game through window.__izk once the game has booted:
// nothing in main.js depends on it, so if anything here fails the game still
// runs as before.
import { prefs, setPref } from './prefs.js';
import { haptic } from './haptics.js';
import { setupControls } from './controls.js';
import { TitleScreen } from './title.js';
import { Garage, applyLook } from './garage.js';
import { Rewards, rewardsScreen } from './rewards.js';
import { settingsScreen } from './settings.js';
import { Tutorial } from './tutorial.js';
import { registerDialog } from '../dialogs.js';
import { toXZ } from '../../core/geo.js';
import { MABHIDA } from '../../world/landmarks.js';
import { perfPass } from '../../world/perfPass.js';

const qs = new URLSearchParams(location.search);
// automated rigs (other agents' screenshots and physics checks) start straight
// in the game unless they ask for the title with ?title=1
const robot = navigator.webdriver && qs.get('title') !== '1';
const skipTitle = robot || prefs().titleSkip || qs.get('notitle') === '1';

let hasSave = false;
try {
  hasSave = !!localStorage.getItem('izk-save-v1');
} catch {}

let z = null; // window.__izk once booted
let title = null;
let garage = null;
let rewards = null;
let rwScreen = null;
let settings = null;
let tutorial = null;
let orbit = null; // { r, h, speed, a } while a screen shows the car
let camOwned = false;
let story = null;
let farCull = null;

function story0() {
  const s = window.__izk && window.__izk.story;
  return s && ['journal', 'open', 'show', 'start'].some((k) => typeof s[k] === 'function') ? s : null;
}

function anyScreenOpen() {
  return (title && title.isOpen) || (garage && garage.isOpen) || (rwScreen && rwScreen.isOpen) || (settings && settings.isOpen);
}

function backToTitleOrGame() {
  if (title && title.isOpen) {
    orbit = { r: 8.5, h: 2.6, speed: 0.12, a: orbit ? orbit.a : 0.6 };
    title.setDot(rewards && rewards.dailyState().ready);
    return;
  }
  if (!anyScreenOpen()) stopOrbit();
}

function stopOrbit() {
  orbit = null;
  if (camOwned) {
    window.__izkCam = null;
    camOwned = false;
  }
}

// slow orbit around the car (title, garage) using main.js's camera override
let lastT = performance.now();
function orbitLoop() {
  requestAnimationFrame(orbitLoop);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (!orbit || !z) return;
  if (window.__izkCam && !camOwned) return; // a test rig owns the camera
  const st = z.state ? z.state() : { inVehicle: true };
  const target = orbit.car || st.inVehicle || !z.player ? z.vehicle.group.position : z.player.group.position;
  orbit.a += dt * orbit.speed;
  const cx = target.x + Math.sin(orbit.a) * orbit.r;
  const cz = target.z + Math.cos(orbit.a) * orbit.r;
  let cy = target.y + orbit.h;
  try {
    cy = Math.max(cy, z.hf.heightAt(cx, cz) + 1.2);
  } catch {}
  window.__izkCam = { pos: [cx, cy, cz], look: [target.x, target.y + (orbit.lookY ?? 0.8), target.z] };
  camOwned = true;
}

function openGarage(fromGame) {
  if (title && title.isOpen) title.root.classList.add('dim');
  orbit = { r: 5.6, h: 1.5, speed: 0.22, a: orbit ? orbit.a : 0.9, car: true, lookY: 0.55 };
  garage.open();
  garage.fromGame = fromGame;
}

function startPlay() {
  if (title) title.hide();
  stopOrbit();
  if (!prefs().tutorialDone && tutorial) setTimeout(() => tutorial.start(), 500);
}

function makeScreens() {
  const fares = z.fares;
  const hud = fares && fares.hud;
  const wallet = fares ? fares.wallet : { r: 0 };
  const showW = () => fares && fares.showWallet();
  const saveW = () => fares && fares.saveWallet();
  rewards = new Rewards({ wallet, saveWallet: saveW, showWallet: showW, toast: (m, t) => hud && hud.toast(m, t) });
  try {
    const [mx, mz] = toXZ(MABHIDA.lon, MABHIDA.lat);
    const [bx, bz] = toXZ(31.0376, -29.8478); // North Beach promenade
    rewards.places = [
      { id: 'stadium', x: mx, z: mz, r: 260 },
      { id: 'beach', x: bx, z: bz, r: 220 }
    ];
  } catch {}
  const pay = (n) => {
    if (!fares || wallet.r < n) return false;
    wallet.r -= n;
    saveW();
    showW();
    return true;
  };
  garage = new Garage({
    getWallet: () => wallet.r || 0,
    pay,
    onBuy: () => rewards.unlock('look'),
    onClose: () => {
      refreshCockpitPaint();
      if (title && title.isOpen) title.root.classList.remove('dim');
      backToTitleOrGame();
    }
  });
  rwScreen = rewardsScreen(rewards, () => backToTitleOrGame());
  settings = settingsScreen({
    input: z.vehicle.input,
    onClose: () => backToTitleOrGame(),
    onTutorial: () => {
      if (title && title.isOpen) startPlay();
      else setTimeout(() => tutorial.start(), 300);
    }
  });
  tutorial = new Tutorial({
    getState: tutState,
    pay: (n) => {
      wallet.r = (wallet.r || 0) + n;
      saveW();
      showW();
    }
  });
  for (const s of [garage.root, rwScreen.root, settings.root]) registerDialog(s, { keepParent: true });
}

// ---- per-frame hook (runs inside the game's own frame, never while paused)
const tut = { inVehicle: true, steer: 0, kmh: 0, brake: 0, gear: 'D', locked: false, sawR: false };
function tutState() {
  return tut;
}

let prevSpeed = 0;
let prevX = 0;
let prevZ = 0;
let nightT = 0;
let night = false;
function perFrame(dt) {
  if (farCull) farCull.update(dt);
  const v = z.vehicle;
  const input = v.input;
  const st = z.state();
  const driving = st.inVehicle && !st.riding;
  const speed = v.speed || 0;
  // a sudden stop that the brakes can't do = a crash (walls, poles, cars)
  if (driving && dt > 0) {
    const moved = Math.hypot(v.x - prevX, v.z - prevZ);
    const decel = (Math.abs(prevSpeed) - Math.abs(speed)) / dt;
    if (Math.abs(prevSpeed) > 5 && decel > 28 && moved < 6) onCrash(Math.abs(prevSpeed) - Math.abs(speed));
  }
  prevSpeed = speed;
  prevX = v.x;
  prevZ = v.z;
  if ((nightT -= dt) <= 0) {
    nightT = 1;
    try {
      const h = z.gameClock.now().getHours();
      night = h < 6 || h >= 19;
    } catch {}
  }
  const trips = (z.fares && z.fares.wallet && z.fares.wallet.trips) || 0;
  rewards.track(dt, { driving, speed, night, x: v.x, z: v.z, trips });
  if (tutorial.active) {
    tut.inVehicle = st.inVehicle;
    tut.steer = input.steer;
    tut.kmh = Math.abs(speed) * 3.6;
    tut.brake = input.brake;
    tut.gear = input.gear;
    if (input.gear === 'R') tut.sawR = true;
    tut.locked = input.locked;
    tutorial.update(dt);
  }
}

let crashCd = 0;
function onCrash(impact) {
  const now = performance.now();
  if (now - crashCd < 400) return;
  crashCd = now;
  haptic.crash(impact);
  rewards && rewards.crashed();
}

function hookGame() {
  const input = z.vehicle.input;
  setupControls(input);
  input.gearListeners.push(() => haptic.gear());
  if (z.traffic) {
    const prev = z.traffic.onCrash;
    z.traffic.onCrash = (impact, car) => {
      if (prev) prev(impact, car);
      if (impact > 2) onCrash(impact);
    };
  }
  if (z.streetLife && z.streetLife.update) {
    // parked-car bumps come through streetLife's onCrash argument; the
    // sudden-stop check in perFrame covers them
  }
  const orig = input.update.bind(input);
  input.update = (dt, speed) => {
    const r = orig(dt, speed);
    try {
      perFrame(dt);
    } catch (err) {
      if (!perFrame.warned) console.warn('[IZK] polish frame', err);
      perFrame.warned = true;
    }
    return r;
  };
}

// pause menu: Garage / Rewards / Settings / Main menu next to Resume
function extendPauseMenu() {
  const panel = document.querySelector('#menu .panel');
  const resume = document.getElementById('m-resume');
  if (!panel || !resume || panel.querySelector('.izk-pm')) return;
  const box = document.createElement('div');
  box.className = 'izk-pm';
  box.innerHTML = '<button type="button" data-k="garage">Garage</button><button type="button" data-k="rewards">Rewards</button><button type="button" data-k="settings">Settings</button><button type="button" data-k="title">Main menu</button>';
  resume.after(box);
  box.addEventListener('click', (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.k;
    if (!k) return;
    haptic.tap();
    resume.click(); // close the pause menu the game's own way (unpauses)
    if (k === 'garage') openGarage(true);
    else if (k === 'rewards') rwScreen.open();
    else if (k === 'settings') settings.open();
    else if (k === 'title') {
      title.show();
      title.ready({ story: story0(), dailyReady: rewards.dailyState().ready });
      backToTitleOrGame();
    }
  });
}

// the cockpit bonnet copies the car's paint once; ask it to copy again
function refreshCockpitPaint() {
  try {
    z.scene.traverse((o) => {
      if (o.userData && o.userData.paint && 'paintDone' in o.userData) o.userData.paintDone = false;
    });
  } catch {}
}

// a Garage icon in the in-game drawer (next to map, camera, settings)
function addDrawerButton() {
  const grid = document.querySelector('#t-drawer .dr-grid');
  if (!grid || document.getElementById('t-garage')) return;
  const b = document.createElement('div');
  b.className = 'tbtn small';
  b.id = 't-garage';
  b.setAttribute('aria-label', 'Garage: paint and rims');
  b.innerHTML = '<svg class="ico" viewBox="0 0 24 24"><path d="M3 21v-9l9-6 9 6v9"/><path d="M7 21v-6h10v6"/><path d="M7 18h10"/></svg>';
  grid.appendChild(b);
  b.addEventListener('pointerup', (e) => {
    e.preventDefault();
    haptic.tap();
    const menu = document.getElementById('t-menu');
    if (menu && menu.classList.contains('open')) menu.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    openGarage(true);
  });
}

function onBooted() {
  z = window.__izk;
  if (!z || !z.vehicle || !z.vehicle.input) return;
  try {
    applyLook(); // saved paint / rims
  } catch {}
  try {
    const pp = perfPass(z);
    farCull = pp.cull;
    z.perf = pp;
  } catch (err) {
    console.warn('[IZK] perf pass', err);
  }
  makeScreens();
  hookGame();
  extendPauseMenu();
  addDrawerButton();
  orbitLoop();
  window.__izk.polish = { title, garage, rewards, settings, tutorial, rwScreen, openGarage, startPlay };
  if (title) {
    story = story0();
    const d = rewards.dailyState();
    title.ready({ story, dailyReady: d.ready });
    orbit = { r: 8.5, h: 2.6, speed: 0.12, a: 0.6 };
    if (d.ready && !robot) setTimeout(() => rwScreen.open(), 700); // daily reward pops up on launch
    // the story agent may add its hook a little later: keep checking while the title shows
    const iv = setInterval(() => {
      if (!title.isOpen) return clearInterval(iv);
      const s = story0();
      if (s && !story) {
        story = s;
        title.ready({ story, dailyReady: rewards.dailyState().ready });
      }
    }, 1000);
  } else if (!prefs().tutorialDone && !robot) setTimeout(() => tutorial.start(), 1500);
}

function onStory() {
  const s = story0();
  if (!s) return;
  startPlay();
  try {
    // story mode's own hook (src/story/story.js): the journal lists the chapters
    const fn = s.journal || s.open || s.show || s.start;
    setTimeout(() => fn.call(s), 450);
  } catch (err) {
    console.warn('[IZK] story', err);
  }
}

// ---- start: title at once, then wait for the game ----
if (!skipTitle) {
  title = new TitleScreen({
    hasSave,
    onPlay: () => startPlay(),
    onGarage: () => garage && openGarage(false),
    onSettings: () => settings && settings.open(),
    onRewards: () => rwScreen && rwScreen.open(),
    onStory
  });
  registerDialog(title.root, { keepParent: true });
}
window.__izkTitle = {
  close: () => title && title.isOpen && startPlay()
};
(function wait() {
  if (window.__izkBooted) {
    try {
      onBooted();
    } catch (err) {
      console.warn('[IZK] polish not started', err);
      if (title) title.hide();
    }
    return;
  }
  setTimeout(wait, 200);
})();
