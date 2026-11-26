// Stylised character portraits, drawn in code on a canvas (no art files):
// flat shapes, a soft background, head, hair or hat, face, clothes. Each
// look comes from CAST in missions.js. Cached as data URLs per size.

const cache = new Map();

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (k < 0) {
    r *= 1 + k;
    g *= 1 + k;
    b *= 1 + k;
  } else {
    r += (255 - r) * k;
    g += (255 - g) * k;
    b += (255 - b) * k;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function ellipse(g, x, y, rx, ry, fill) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

// draws one portrait in a 100 x 100 box (scaled by the caller)
export function drawPortrait(g, look) {
  const L = look || {};
  const skin = L.skin || '#6b4430';
  const dark = shade(skin, -0.28);
  const light = shade(skin, 0.12);
  // background: soft radial light
  const bg = g.createRadialGradient(50, 38, 8, 50, 50, 72);
  bg.addColorStop(0, shade(L.bg || '#223', 0.28));
  bg.addColorStop(1, L.bg || '#223');
  g.fillStyle = bg;
  g.fillRect(0, 0, 100, 100);
  // shoulders and shirt
  const shirt = L.shirt || '#444';
  g.beginPath();
  g.moveTo(10, 100);
  g.quadraticCurveTo(14, 74, 34, 70);
  g.lineTo(66, 70);
  g.quadraticCurveTo(86, 74, 90, 100);
  g.closePath();
  g.fillStyle = shirt;
  g.fill();
  if (L.overalls) {
    g.fillStyle = shade(shirt, -0.25);
    g.fillRect(30, 80, 8, 20);
    g.fillRect(62, 80, 8, 20);
    g.fillStyle = '#e8c547';
    ellipse(g, 34, 84, 2.2, 2.2, '#e8c547');
    ellipse(g, 66, 84, 2.2, 2.2, '#e8c547');
  }
  // neck
  g.fillStyle = dark;
  g.fillRect(43, 60, 14, 14);
  // collar / tie / nurse collar
  if (L.tie) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(40, 70);
    g.lineTo(50, 80);
    g.lineTo(60, 70);
    g.closePath();
    g.fill();
    g.fillStyle = L.tie;
    g.beginPath();
    g.moveTo(48, 76);
    g.lineTo(52, 76);
    g.lineTo(54, 98);
    g.lineTo(50, 100);
    g.lineTo(46, 98);
    g.closePath();
    g.fill();
  } else if (L.collar) {
    g.strokeStyle = L.collar;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(38, 72);
    g.lineTo(50, 82);
    g.lineTo(62, 72);
    g.stroke();
  } else {
    g.fillStyle = shade(shirt, -0.18);
    g.beginPath();
    g.moveTo(40, 70);
    g.quadraticCurveTo(50, 78, 60, 70);
    g.lineTo(58, 70);
    g.quadraticCurveTo(50, 75, 42, 70);
    g.fill();
  }
  if (L.chain) {
    g.strokeStyle = '#e7c34a';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(41, 71);
    g.quadraticCurveTo(50, 86, 59, 71);
    g.stroke();
  }
  // back hair (behind the head)
  const hairC = L.hair === 'grey' ? '#bdbab2' : '#16110e';
  if (L.hair === 'bun') ellipse(g, 50, 13, 11, 9, hairC);
  if (L.hair === 'ponytail') {
    g.fillStyle = hairC;
    g.beginPath();
    g.moveTo(66, 30);
    g.quadraticCurveTo(84, 40, 76, 64);
    g.quadraticCurveTo(70, 46, 62, 36);
    g.fill();
  }
  // head
  const wide = L.round ? 25 : 22;
  ellipse(g, 50, 40, wide, 26, skin);
  // ears
  ellipse(g, 50 - wide + 1, 42, 4, 6, dark);
  ellipse(g, 50 + wide - 1, 42, 4, 6, dark);
  // cheek light
  ellipse(g, 41, 34, 9, 7, light);
  if (L.earrings) {
    ellipse(g, 50 - wide + 1, 51, 2.4, 2.4, L.earrings);
    ellipse(g, 50 + wide - 1, 51, 2.4, 2.4, L.earrings);
  }
  // hair on top
  g.fillStyle = hairC;
  switch (L.hair) {
    case 'fade':
    case 'short':
    case 'grey':
    case 'part':
      g.beginPath();
      g.ellipse(50, 30, wide - 1, 17, 0, Math.PI, Math.PI * 2);
      g.fill();
      if (L.hair === 'fade') {
        g.fillStyle = 'rgba(22,17,14,0.45)';
        g.fillRect(50 - wide + 2, 30, 6, 10);
        g.fillRect(50 + wide - 8, 30, 6, 10);
      }
      if (L.hair === 'part') {
        g.strokeStyle = light;
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(40, 15);
        g.lineTo(38, 26);
        g.stroke();
      }
      break;
    case 'twists':
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        ellipse(g, 50 + Math.cos(a) * (wide - 3), 30 + Math.sin(a) * 18, 5, 6.5, hairC);
      }
      break;
    case 'bun':
    case 'ponytail':
      g.beginPath();
      g.ellipse(50, 30, wide, 18, 0, Math.PI, Math.PI * 2);
      g.fill();
      break;
    default:
      break; // bald or under a hat
  }
  // hats
  const hc = L.hatColor || '#333';
  switch (L.hat) {
    case 'cap':
      g.fillStyle = hc;
      g.beginPath();
      g.ellipse(50, 27, wide, 15, 0, Math.PI, Math.PI * 2);
      g.fill();
      g.fillRect(50 - wide, 26, wide * 2, 4);
      g.fillStyle = shade(hc, -0.25);
      g.beginPath();
      g.ellipse(32, 29, 16, 4, -0.1, 0, Math.PI * 2);
      g.fill();
      ellipse(g, 50, 13, 2.5, 2, shade(hc, 0.3));
      break;
    case 'doek': {
      // headwrap: a tall wrap with a second-colour band and a knot
      g.fillStyle = hc;
      g.beginPath();
      g.moveTo(50 - wide - 2, 34);
      g.quadraticCurveTo(48, -6, 50 + wide + 2, 34);
      g.quadraticCurveTo(50, 26, 50 - wide - 2, 34);
      g.fill();
      g.strokeStyle = L.hatColor2 || '#f2c230';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(50 - wide, 26);
      g.quadraticCurveTo(50, 12, 50 + wide, 26);
      g.stroke();
      ellipse(g, 66, 9, 8, 6, shade(hc, 0.15));
      break;
    }
    case 'bucket':
      g.fillStyle = hc;
      g.beginPath();
      g.moveTo(31, 26);
      g.lineTo(35, 8);
      g.quadraticCurveTo(50, 2, 65, 8);
      g.lineTo(69, 26);
      g.closePath();
      g.fill();
      g.fillStyle = shade(hc, -0.15);
      g.beginPath();
      g.ellipse(50, 27, 30, 6, 0, 0, Math.PI * 2);
      g.fill();
      break;
    case 'fedora':
      g.fillStyle = shade(hc, -0.1);
      g.beginPath();
      g.ellipse(50, 24, 34, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hc;
      g.beginPath();
      g.moveTo(34, 24);
      g.lineTo(37, 6);
      g.quadraticCurveTo(50, 1, 63, 6);
      g.lineTo(66, 24);
      g.closePath();
      g.fill();
      g.fillStyle = '#8a1f2a';
      g.fillRect(35, 18, 30, 4);
      break;
    case 'nurse':
      g.fillStyle = hc;
      g.beginPath();
      g.moveTo(34, 18);
      g.lineTo(38, 6);
      g.lineTo(62, 6);
      g.lineTo(66, 18);
      g.closePath();
      g.fill();
      g.fillStyle = '#d33';
      g.fillRect(48, 8, 4, 8);
      g.fillRect(46, 10, 8, 4);
      break;
    default:
      break;
  }
  if (L.headphones) {
    g.strokeStyle = '#222';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(50, 38, wide + 3, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    ellipse(g, 50 - wide - 1, 42, 5, 8, '#2a2a2a');
    ellipse(g, 50 + wide + 1, 42, 5, 8, '#2a2a2a');
  }
  // eyes / glasses
  const eyeY = 41;
  if (L.glasses === 'sun') {
    g.fillStyle = '#0d0d0d';
    g.beginPath();
    g.roundRect ? g.roundRect(33, eyeY - 5, 14, 9, 3) : g.rect(33, eyeY - 5, 14, 9);
    g.roundRect ? g.roundRect(53, eyeY - 5, 14, 9, 3) : g.rect(53, eyeY - 5, 14, 9);
    g.fill();
    g.fillRect(46, eyeY - 3, 8, 2);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(35, eyeY - 4, 4, 2);
    g.fillRect(55, eyeY - 4, 4, 2);
  } else {
    ellipse(g, 41, eyeY, 3.6, 2.6, '#fbf7f0');
    ellipse(g, 59, eyeY, 3.6, 2.6, '#fbf7f0');
    ellipse(g, 41.6, eyeY, 1.9, 2, '#1c120c');
    ellipse(g, 59.6, eyeY, 1.9, 2, '#1c120c');
    // brows
    g.strokeStyle = L.hair === 'grey' || L.beard === 'grey' ? '#cfcac0' : '#1c120c';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(36, eyeY - 6);
    g.quadraticCurveTo(41, eyeY - 8.5, 46, eyeY - 6);
    g.moveTo(54, eyeY - 6);
    g.quadraticCurveTo(59, eyeY - 8.5, 64, eyeY - 6);
    g.stroke();
    if (L.glasses) {
      g.strokeStyle = '#2b2b2b';
      g.lineWidth = 1.6;
      g.beginPath();
      if (L.glasses === 'round') {
        g.arc(41, eyeY, 6, 0, Math.PI * 2);
        g.moveTo(65, eyeY);
        g.arc(59, eyeY, 6, 0, Math.PI * 2);
      } else {
        g.rect(34, eyeY - 4.5, 13, 9);
        g.rect(53, eyeY - 4.5, 13, 9);
      }
      g.moveTo(47, eyeY);
      g.lineTo(53, eyeY);
      g.stroke();
    }
  }
  // nose
  g.strokeStyle = dark;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(48, 47);
  g.quadraticCurveTo(50, 51, 53, 49);
  g.stroke();
  // age lines
  if (L.age >= 2) {
    g.strokeStyle = shade(skin, -0.2);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(33, 50);
    g.quadraticCurveTo(35, 54, 38, 55);
    g.moveTo(67, 50);
    g.quadraticCurveTo(65, 54, 62, 55);
    g.stroke();
  }
  // beard
  const bc = L.beard === 'grey' ? '#cfcac0' : '#18110d';
  if (L.beard === 'full' || L.beard === 'grey') {
    g.fillStyle = bc;
    g.beginPath();
    g.moveTo(30, 44);
    g.quadraticCurveTo(32, 70, 50, 68);
    g.quadraticCurveTo(68, 70, 70, 44);
    g.quadraticCurveTo(66, 58, 50, 58);
    g.quadraticCurveTo(34, 58, 30, 44);
    g.fill();
  } else if (L.beard === 'goatee') {
    ellipse(g, 50, 62, 6, 5, bc);
  } else if (L.beard === 'stubble') {
    g.fillStyle = 'rgba(20,14,10,0.28)';
    g.beginPath();
    g.moveTo(32, 46);
    g.quadraticCurveTo(34, 68, 50, 66);
    g.quadraticCurveTo(66, 68, 68, 46);
    g.quadraticCurveTo(64, 60, 50, 60);
    g.quadraticCurveTo(36, 60, 32, 46);
    g.fill();
  }
  // mouth: a warm smile
  g.strokeStyle = L.lips || '#3a1f17';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(43, 55);
  g.quadraticCurveTo(50, 60, 57, 55);
  g.stroke();
  if (L.beard === 'moustache' || L.beard === 'grey' || L.beard === 'full') {
    g.fillStyle = bc;
    g.beginPath();
    g.moveTo(41, 54);
    g.quadraticCurveTo(50, 48, 59, 54);
    g.quadraticCurveTo(50, 52, 41, 54);
    g.fill();
  }
}

// the narrator: an open book
export function drawStoryIcon(g) {
  const bg = g.createLinearGradient(0, 0, 0, 100);
  bg.addColorStop(0, '#2a3340');
  bg.addColorStop(1, '#151b23');
  g.fillStyle = bg;
  g.fillRect(0, 0, 100, 100);
  g.fillStyle = '#f4ead2';
  g.beginPath();
  g.moveTo(50, 34);
  g.quadraticCurveTo(34, 26, 18, 30);
  g.lineTo(18, 72);
  g.quadraticCurveTo(34, 68, 50, 76);
  g.quadraticCurveTo(66, 68, 82, 72);
  g.lineTo(82, 30);
  g.quadraticCurveTo(66, 26, 50, 34);
  g.fill();
  g.strokeStyle = '#b9a77e';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(50, 34);
  g.lineTo(50, 76);
  for (let i = 0; i < 4; i++) {
    g.moveTo(24, 40 + i * 7);
    g.lineTo(44, 41 + i * 7);
    g.moveTo(56, 41 + i * 7);
    g.lineTo(76, 40 + i * 7);
  }
  g.stroke();
}

// data URL of one portrait (size in CSS px; drawn at 2x for sharp screens)
export function portraitURL(key, look, size = 96) {
  const id = `${key}@${size}`;
  if (cache.has(id)) return cache.get(id);
  const px = Math.round(size * Math.min(3, Math.max(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 2)));
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.scale(px / 100, px / 100);
  if (key === 'story') drawStoryIcon(g);
  else drawPortrait(g, look);
  const url = c.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
