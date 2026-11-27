// Settings screen: steering type, sensitivity, tilt centre, vibration,
// sound, and "show the tutorial again". Plain words, big buttons.
import { prefs, setPref, el } from './prefs.js';
import { haptic, buzz } from './haptics.js';
import { setControlMode, askTiltPermission, centreTilt, tiltWorking } from './controls.js';
import { toggleMute } from '../../game/audio.js';
import { setPerfPref } from './perfPrefs.js';

const SENS_KEY = 'izk-steer-sens'; // same key the pause menu uses

function isMuted() {
  try {
    return localStorage.getItem('izk-mute') === '1';
  } catch {
    return false;
  }
}

export function settingsScreen({ input, onClose, onTutorial }) {
  const root = el('div', 'izk-screen izk-settings');
  root.style.display = 'none';
  document.body.appendChild(root);
  let sens = 1;
  try {
    sens = Number(localStorage.getItem(SENS_KEY)) || 1;
  } catch {}

  const setSens = (v) => {
    sens = Math.round(Math.max(0.5, Math.min(2.5, v)) * 10) / 10;
    if (input) input.steerSens = sens;
    try {
      localStorage.setItem(SENS_KEY, String(sens));
    } catch {}
    const pm = document.getElementById('m-sval'); // keep the pause menu in step
    if (pm) pm.textContent = sens.toFixed(1) + '×';
  };

  const render = () => {
    const p = prefs();
    const seg = (name, opts, cur) =>
      `<div class="izk-seg" data-name="${name}">${opts.map(([v, label, sub]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${label}${sub ? `<small>${sub}</small>` : ''}</button>`).join('')}</div>`;
    const tiltNote = p.controls === 'tilt' ? (tiltWorking() ? 'Hold the phone the way you like, then tap Centre.' : 'Turn the phone a little. If nothing moves, this phone has no tilt sensor.') : '';
    root.innerHTML = `<div class="izk-card wide">
      <div class="izk-ghead"><b>Settings</b></div>
      <div class="izk-set"><span>Steering</span>${seg('controls', [['wheel', 'Wheel', 'turn it'], ['buttons', 'Buttons', '◀ ▶'], ['tilt', 'Tilt', 'turn the phone']], p.controls)}</div>
      ${p.controls === 'tilt' ? `<div class="izk-set"><span>Tilt</span><div class="izk-row2"><button class="izk-btn small izk-centre">Centre</button><small>${tiltNote}</small></div></div>
      <div class="izk-set"><span>Tilt amount</span><div class="izk-step"><button data-d="4">−</button><b>${p.tiltRange <= 20 ? 'Quick' : p.tiltRange >= 36 ? 'Gentle' : 'Normal'}</b><button data-d="-4">+</button></div></div>` : ''}
      <div class="izk-set"><span>Steering sensitivity</span><div class="izk-step izk-sens"><button data-d="-0.1">−</button><b>${sens.toFixed(1)}×</b><button data-d="0.1">+</button></div></div>
      <div class="izk-set"><span>Vibration</span>${seg('haptics', [['on', 'On'], ['off', 'Off']], p.haptics ? 'on' : 'off')}</div>
      <div class="izk-set"><span>Mirrors</span>${seg('mirrors', [['on', 'On'], ['off', 'Off', 'faster']], p.mirrors === false ? 'off' : 'on')}</div>
      <div class="izk-set"><span>FPS counter</span>${seg('fps', [['on', 'On'], ['off', 'Off']], p.fps ? 'on' : 'off')}</div>
      <div class="izk-set"><span>Sound</span>${seg('sound', [['on', 'On'], ['off', 'Off']], isMuted() ? 'off' : 'on')}</div>
      <div class="izk-set"><span>Learn to drive</span><button class="izk-btn small ghost izk-tut">Show the tutorial again</button></div>
      <div class="izk-grow"><button class="izk-btn izk-sclose">Done</button></div>
    </div>`;
    for (const s of root.querySelectorAll('.izk-seg')) {
      for (const b of s.querySelectorAll('button')) {
        b.addEventListener('click', async () => {
          haptic.tap();
          const v = b.dataset.v;
          const name = s.dataset.name;
          if (name === 'controls') {
            if (v === 'tilt') await askTiltPermission();
            setControlMode(v);
            if (v === 'tilt') setTimeout(() => (centreTilt(), render()), 400);
          } else if (name === 'haptics') {
            setPref('haptics', v === 'on');
            if (v === 'on') buzz(30, 0);
          } else if (name === 'mirrors' || name === 'fps') {
            setPerfPref(name, v === 'on');
          } else if (name === 'sound') {
            if ((v === 'off') !== isMuted()) {
              const m = toggleMute();
              document.getElementById('t-mute')?.classList.toggle('muted', m);
            }
          }
          render();
        });
      }
    }
    root.querySelector('.izk-centre')?.addEventListener('click', () => {
      haptic.tap();
      centreTilt();
      render();
    });
    for (const b of root.querySelectorAll('.izk-step:not(.izk-sens) button')) {
      b.addEventListener('click', () => {
        haptic.tap();
        setPref('tiltRange', Math.max(16, Math.min(40, prefs().tiltRange + Number(b.dataset.d))));
        render();
      });
    }
    for (const b of root.querySelectorAll('.izk-sens button')) {
      b.addEventListener('click', () => {
        haptic.tap();
        setSens(sens + Number(b.dataset.d));
        render();
      });
    }
    root.querySelector('.izk-tut').addEventListener('click', () => {
      haptic.tap();
      setPref('tutorialDone', false);
      root.style.display = 'none';
      onTutorial?.();
    });
    root.querySelector('.izk-sclose').addEventListener('click', () => {
      haptic.tap();
      root.style.display = 'none';
      onClose?.();
    });
  };
  return {
    root,
    open() {
      try {
        sens = Number(localStorage.getItem(SENS_KEY)) || sens;
      } catch {}
      render();
      root.style.display = '';
    },
    get isOpen() {
      return root.style.display !== 'none';
    }
  };
}
