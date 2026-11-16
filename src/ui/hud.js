import { placeAt, toLonLat } from '../core/geo.js';
import { formatDurbanDate, formatDurbanTime } from '../core/time.js';
import { formatDistance } from '../game/gps.js';

const KIND_LABEL = {
  city: 'City Centre',
  beach: 'Beachfront',
  landmark: 'Landmark',
  suburb: 'Suburb',
  township: 'Township',
  neighbourhood: 'Neighbourhood',
  quarter: 'Quarter',
  town: 'Town',
  village: 'Village',
  wild: 'eThekwini'
};

export class HUD {
  constructor() {
    this.placeName = document.getElementById('place-name');
    this.placeKind = document.getElementById('place-kind');
    this.coords = document.getElementById('coords');
    this.clock = document.getElementById('clock');
    this.clockLabel = document.getElementById('clock-label');
    this.dateEl = document.getElementById('date');
    this.seasonEl = document.getElementById('season');
    this.speedVal = document.getElementById('speed-val');
    this.speedFill = document.getElementById('speed-fill');
    this.help = document.getElementById('help');
    this.toastEl = document.getElementById('toast');
    this.destEl = document.getElementById('dest');
    this.destName = document.getElementById('dest-name');
    this.destDistance = document.getElementById('dest-distance');
    this.destArrow = document.getElementById('dest-arrow');

    this.acc = 0;
    this.toastTimer = 0;
    this.lastPlace = null;
    this.helpHidden = false;
    this.lastSpeed = -1;
  }

  updateGear(g) {
    if (!this.gearEl) this.gearEl = document.getElementById('speed-gear');
    if (this.gearEl && this._gear !== g) {
      this._gear = g;
      this.gearEl.textContent = g;
    }
  }

  setClock(seconds) {
    const total = Math.floor(seconds) % 86400;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  updateTime(date, season, night) {
    this.clock.textContent = formatDurbanTime(date);
    if (this.clockLabel) this.clockLabel.textContent = night ? 'Durban · night' : 'Durban · day';
    if (this.dateEl) this.dateEl.textContent = formatDurbanDate(date);
    if (this.seasonEl) this.seasonEl.textContent = `${season.name} · ${season.months}`;
  }

  toast(text, hold = 2.4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = hold;
  }

  hideHelp() {
    if (this.helpHidden) return;
    this.helpHidden = true;
    this.help.classList.add('hidden');
  }

  updateDestination(gps) {
    if (!this.destEl) return;
    if (!gps.dest) {
      this.destEl.classList.remove('show');
      return;
    }
    this.destEl.classList.add('show');
    const t = gps.nextTurn;
    if (t && gps.turnDist < 300) {
      const icon = t.dir === 'left' ? '↰' : t.dir === 'right' ? '↱' : '⮌';
      const word = t.dir === 'uturn' ? 'U-turn' : `${t.sharp ? 'Sharp ' : 'Turn '}${t.dir}`;
      this.destArrow.textContent = icon;
      this.destArrow.style.transform = 'none';
      this.destArrow.classList.add('turn');
      this.destName.textContent = `${word} in ${formatDistance(gps.turnDist)}`;
      this.destDistance.textContent = `${t.name ? t.name + ' · ' : ''}${formatDistance(gps.distance)} to ${gps.dest.name}`;
    } else {
      this.destArrow.textContent = '▲';
      this.destArrow.classList.remove('turn');
      this.destArrow.style.transform = `rotate(${(gps.bearing * 180) / Math.PI}deg)`;
      this.destName.textContent = gps.dest.name;
      this.destDistance.textContent = gps.route ? `${formatDistance(gps.distance)} by road` : formatDistance(gps.distance);
    }
  }

  update(dt, vehicle) {
    this.acc += dt;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.acc < 0.08) return;
    this.acc = 0;

    const speed = Math.round(vehicle.speedKmh);
    if (speed !== this.lastSpeed) {
      this.speedVal.textContent = speed;
      this.speedFill.style.width = `${Math.min(100, (speed / 180) * 100)}%`;
      this.lastSpeed = speed;
    }

    const place = placeAt(vehicle.x, vehicle.z);
    if (place !== this.lastPlace) {
      this.lastPlace = place;
      this.placeName.textContent = place.name;
      this.placeKind.textContent = KIND_LABEL[place.kind] || 'Area';
    }

    const [lon, lat] = toLonLat(vehicle.x, vehicle.z);
    this.coords.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}
