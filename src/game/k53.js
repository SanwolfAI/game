// K53 learner's licence test (Bheko, 20 Nov 2026: "close to the real test").
//
// Same shape as the real South African learner's test: 64 multiple-choice
// questions in three sections, and you must pass EVERY section:
//   1. Vehicle controls          8 questions, pass mark 6
//   2. Road signs, signals and   28 questions, pass mark 23
//      road markings
//   3. Rules of the road         28 questions, pass mark 22
// (The section sizes and pass marks are the same for the motorcycle code 1 and
// the light-vehicle code 2 tests; the game teaches cars, so the controls are a
// car's.)
//
// The question bank below is written for this game (not copied from any K53
// book). Each test draws a fresh random set from it. Road signs are drawn as
// SVG in the SADC sign system's shapes and colours:
//   STOP red octagon · YIELD inverted triangle, red border · pedestrian
//   priority diamond · prohibition: white disc, red ring, black symbol, red
//   slash for actions/objects (limits have no slash) · command: blue disc,
//   white symbol · reservation: blue rectangle, white symbol · one-way: red
//   rectangle, white arrow · warning: white triangle, red border, black symbol
//   · temporary signs: yellow background · information: blue / green.

export const SECTIONS = [
  { id: 'controls', name: 'Vehicle controls', n: 8, pass: 6 },
  { id: 'signs', name: 'Road signs, signals and markings', n: 28, pass: 23 },
  { id: 'rules', name: 'Rules of the road', n: 28, pass: 22 },
];

// ---------------------------------------------------------------- drawings
const RED = '#c8102e';
const BLUE = '#1450a0';
const INK = '#111';
const YEL = '#ffd21a';

const S = (inner, w = 100, h = 100) => `<svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
const line = (d, c = INK, w = 7) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const fill = (d, c = INK) => `<path d="${d}" fill="${c}"/>`;
const text = (t, y, size, c = INK, x = 50) => `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${size}" text-anchor="middle" fill="${c}">${t}</text>`;

// symbols, drawn for a 100x100 box centred on 50,50 (about 50 units tall)
const SYM = {
  up: (c) => line('M50 76 V30', c) + fill('M50 18 L64 36 H36 Z', c),
  left: (c) => line('M58 78 V50 Q58 42 50 42 H38', c) + fill('M26 42 L42 30 V54 Z', c),
  right: (c) => line('M42 78 V50 Q42 42 50 42 H62', c) + fill('M74 42 L58 30 V54 Z', c),
  uturn: (c) => line('M62 78 V44 Q62 28 48 28 Q36 28 36 44 V54', c) + fill('M36 68 L24 50 H48 Z', c),
  keepLeft: (c) => line('M66 26 L40 60', c) + fill('M30 74 L33 50 L52 64 Z', c),
  car: (c) => fill('M28 58 L34 44 H66 L72 58 H76 V68 H24 V58 Z', c) + `<circle cx="36" cy="69" r="5" fill="${c}"/><circle cx="64" cy="69" r="5" fill="${c}"/>`,
  twoCars: () => fill('M14 58 L19 46 H41 L46 58 H48 V67 H12 V58 Z', RED) + `<circle cx="21" cy="68" r="4" fill="${RED}"/><circle cx="40" cy="68" r="4" fill="${RED}"/>` + fill('M52 58 L57 46 H79 L84 58 H86 V67 H50 V58 Z', INK) + `<circle cx="59" cy="68" r="4" fill="${INK}"/><circle cx="78" cy="68" r="4" fill="${INK}"/>`,
  ped: (c) => `<circle cx="50" cy="26" r="6" fill="${c}"/>` + line('M50 34 V56 M50 56 L40 76 M50 56 L60 76 M38 46 L50 38 L62 46', c, 6),
  kids: (c) => `<circle cx="38" cy="32" r="5.5" fill="${c}"/><circle cx="62" cy="38" r="4.5" fill="${c}"/>` + line('M38 39 V58 L30 76 M38 58 L46 76 M28 48 L38 42 L50 50 M62 44 V60 L56 74 M62 60 L68 74 L68 74 M50 50 L62 48 L70 54', c, 5),
  bike: (c) => `<circle cx="32" cy="62" r="11" fill="none" stroke="${c}" stroke-width="5"/><circle cx="68" cy="62" r="11" fill="none" stroke="${c}" stroke-width="5"/>` + line('M32 62 L44 42 H62 L68 62 M44 42 L52 62 L62 42 M40 36 H50', c, 5),
  truck: (c) => fill('M18 40 H58 V66 H18 Z M60 48 H72 L80 56 V66 H60 Z', c) + `<circle cx="30" cy="68" r="5.5" fill="${c}"/><circle cx="70" cy="68" r="5.5" fill="${c}"/>`,
  bus: (c, bg = '#fff') => fill('M20 34 H80 Q84 34 84 40 V64 H16 V40 Q16 34 20 34 Z', c) + fill('M22 40 H34 V50 H22 Z M38 40 H50 V50 H38 Z M54 40 H66 V50 H54 Z M70 40 H78 V50 H70 Z', bg) + `<circle cx="30" cy="66" r="5" fill="${c}"/><circle cx="70" cy="66" r="5" fill="${c}"/>`,
  horn: (c) => fill('M22 44 H36 L66 28 V72 L36 56 H22 Z', c) + line('M74 40 Q80 50 74 60', c, 4),
  moto: (c) => `<circle cx="30" cy="64" r="10" fill="none" stroke="${c}" stroke-width="5"/><circle cx="70" cy="64" r="10" fill="none" stroke="${c}" stroke-width="5"/>` + fill('M34 52 H58 L66 44 H72 L70 52 L64 60 H40 Z', c),
  cross: (c) => line('M50 26 V78 M26 52 H74', c, 10),
  tee: (c) => line('M26 36 H74 M50 36 V78', c, 10),
  curveL: (c) => line('M58 78 V56 Q58 40 42 34', c, 9) + fill('M28 30 L46 22 L44 44 Z', c),
  curveR: (c) => line('M42 78 V56 Q42 40 58 34', c, 9) + fill('M72 30 L54 22 L56 44 Z', c),
  narrows: (c) => line('M34 78 V60 L42 44 V26 M66 78 V60 L58 44 V26', c, 6),
  hump: (c) => fill('M18 70 Q50 34 82 70 Z', c),
  twoWay: (c) => line('M40 76 V36', c, 6) + fill('M40 24 L50 40 H30 Z', c) + line('M60 24 V64', c, 6) + fill('M60 76 L50 60 H70 Z', c),
  circle: (c) => line('M50 30 A20 20 0 0 1 70 50 M70 50 A20 20 0 0 1 36 64 M36 64 A20 20 0 0 1 40 32', c, 6) + fill('M50 22 L60 30 L50 38 Z M74 60 L62 60 L68 50 Z M30 58 L32 70 L42 64 Z', c),
  descent: (c) => fill('M18 76 L82 76 L18 44 Z', c) + text('10%', 46, 20, c, 64),
  slippery: (c) => SYM.car(c).replace(/cy="69"/g, 'cy="59"').replace('M28 58 L34 44 H66 L72 58 H76 V68 H24 V58 Z', 'M28 48 L34 34 H66 L72 48 H76 V58 H24 V48 Z') + line('M30 66 Q36 72 30 78 M50 66 Q56 72 50 78 M70 66 Q76 72 70 78', c, 4),
  signals: (c) => `<rect x="40" y="24" width="20" height="54" rx="5" fill="${c}"/><circle cx="50" cy="34" r="6" fill="${RED}"/><circle cx="50" cy="51" r="6" fill="#f5a300"/><circle cx="50" cy="68" r="6" fill="#1e9e4a"/>`,
  bang: (c) => line('M50 30 V60', c, 10) + `<circle cx="50" cy="72" r="5.5" fill="${c}"/>`,
  rail: (c) => line('M30 32 L70 72 M70 32 L30 72', c, 9),
  wheel: (c) => `<circle cx="46" cy="24" r="6" fill="${c}"/>` + line('M46 32 V52 H62 L68 70 M46 42 H60', c, 6) + `<circle cx="44" cy="64" r="14" fill="none" stroke="${c}" stroke-width="5"/>`,
  falling: (c) => fill('M24 76 L76 76 L76 24 Z', c) + `<circle cx="40" cy="40" r="6" fill="${c}"/><circle cx="52" cy="28" r="4" fill="${c}"/>`,
  cow: (c) => fill('M24 46 H66 Q72 46 72 52 V60 H24 Z M66 40 L78 40 L80 52 L70 52 Z M28 60 H34 V74 H28 Z M58 60 H64 V74 H58 Z', c),
};

function disc(inner, ring = RED, bg = '#fff', slash = false) {
  return S(`<circle cx="50" cy="50" r="46" fill="${bg}" stroke="${ring}" stroke-width="9"/>${inner}${slash ? line('M22 78 L78 22', RED, 9) : ''}`);
}
function triangle(inner, bg = '#fff', down = false) {
  const pts = down ? '6,10 94,10 50,90' : '50,6 95,88 5,88';
  return S(`<polygon points="${pts}" fill="${bg}" stroke="${RED}" stroke-width="8" stroke-linejoin="round"/><g transform="translate(50 ${down ? 40 : 62}) scale(0.7) translate(-50 -50)">${inner}</g>`);
}
function rect(inner, bg = BLUE, w = 100, h = 100) {
  return S(`<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="8" fill="${bg}" stroke="#fff" stroke-width="4"/>${inner}`, w, h);
}
function robot(lit, flash = false, arrow = false) {
  const col = { red: RED, amber: '#f5a300', green: '#1e9e4a' };
  const on = (k, y) => {
    const c = lit === k ? col[k] : '#2a2a2a';
    if (arrow && k === 'green' && lit === k) return `<circle cx="50" cy="${y}" r="12" fill="#2a2a2a"/>` + line(`M42 ${y} H56`, col.green, 5) + fill(`M60 ${y} L52 ${y - 7} V${y + 7} Z`, col.green);
    return `<circle cx="50" cy="${y}" r="12" fill="${c}"/>${lit === k && flash ? `<circle cx="50" cy="${y}" r="17" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="4 4"/>` : ''}`;
  };
  return S(`<rect x="30" y="8" width="40" height="84" rx="8" fill="#111"/>${on('red', 24)}${on('amber', 50)}${on('green', 76)}`);
}
function road(marks) {
  // a road seen from above: grey tar, edges, and the asked-about marking
  const m = {
    solid: line('M50 4 V96', '#fff', 4),
    broken: line('M50 4 V96', '#fff', 4).replace('stroke-linecap="round"', 'stroke-dasharray="12 10"'),
    double: line('M46 4 V96', '#fff', 3) + line('M54 4 V96', '#fff', 3),
    yellowEdge: line('M16 4 V96', YEL, 4),
    stopLine: line('M18 60 H50', '#fff', 6) + text('STOP', 80, 11, '#fff', 34),
    yieldLine: line('M18 60 H50', '#fff', 5).replace('stroke-linecap="round"', 'stroke-dasharray="6 4"') + fill('M28 70 L40 70 L34 86 Z', '#fff'),
    island: `<polygon points="50,20 62,96 38,96" fill="none" stroke="#fff" stroke-width="3"/>` + line('M42 80 L56 66 M44 92 L60 76 M46 56 L52 50', '#fff', 3),
    zebra: [22, 30, 38, 46, 54, 62, 70].map((x) => `<rect x="${x}" y="40" width="5" height="22" fill="#fff"/>`).join(''),
    noStopYellow: line('M16 4 V96', '#e8d23a', 4) + line('M16 4 V96', '#e8d23a', 4).replace('M16', 'M22'),
  };
  return S(`<rect x="0" y="0" width="100" height="100" rx="8" fill="#55595e"/>${line('M12 4 V96 M88 4 V96', '#cfd2d4', 2)}${m[marks] || ''}`);
}

// a car dashboard (right-hand drive) with numbered controls for section 1
export const CONTROL_NAMES = {
  1: 'steering wheel', 2: 'indicator lever', 3: 'hooter (horn)', 4: 'light switch', 5: 'wiper lever',
  6: 'gear lever', 7: 'handbrake', 8: 'clutch pedal', 9: 'brake pedal', 10: 'accelerator',
};
export function cockpitSVG() {
  const n = (k, x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="${YEL}" stroke="#111" stroke-width="1.5"/>${text(String(k), y + 4.5, 11, '#111', x)}`;
  return S(
    `<rect x="0" y="0" width="320" height="170" rx="10" fill="#1d2228"/>` +
      `<rect x="10" y="10" width="300" height="40" rx="8" fill="#2c333b"/>` +
      // wheel (driver on the right)
      `<circle cx="210" cy="78" r="44" fill="none" stroke="#5c646c" stroke-width="10"/><circle cx="210" cy="78" r="13" fill="#3b434b"/>` +
      line('M168 78 H197 M223 78 H252 M210 91 V120', '#5c646c', 7) +
      // stalks: indicators right, wipers left; light switch on the dash right
      line('M256 66 L292 56', '#9aa2aa', 6) + line('M164 66 L130 56', '#9aa2aa', 6) +
      `<rect x="282" y="16" width="20" height="20" rx="4" fill="#9aa2aa"/>` +
      // centre console: gear lever + handbrake
      `<rect x="70" y="100" width="56" height="62" rx="6" fill="#2c333b"/><circle cx="98" cy="96" r="9" fill="#9aa2aa"/>` + line('M98 104 V128', '#9aa2aa', 5) +
      `<rect x="88" y="138" width="20" height="18" rx="4" fill="#9aa2aa"/>` +
      // pedals: clutch, brake, accelerator (left to right)
      `<rect x="168" y="138" width="22" height="22" rx="3" fill="#9aa2aa"/><rect x="200" y="136" width="28" height="24" rx="3" fill="#9aa2aa"/><rect x="242" y="130" width="14" height="32" rx="3" fill="#9aa2aa"/>` +
      n(1, 182, 44) + n(2, 300, 66) + n(3, 210, 78) + n(4, 292, 44) + n(5, 122, 56) + n(6, 116, 92) + n(7, 118, 148) + n(8, 179, 128) + n(9, 214, 126) + n(10, 266, 126),
    320,
    170,
  );
}

export function signSVG(spec) {
  const [kind, a, b] = spec;
  switch (kind) {
    case 'stop':
      return S(`<polygon points="30,4 70,4 96,30 96,70 70,96 30,96 4,70 4,30" fill="${RED}" stroke="#fff" stroke-width="4"/>${text('STOP', 60, 27, '#fff')}`);
    case 'stop4':
      return S(`<polygon points="34,2 66,2 88,24 88,56 66,78 34,78 12,56 12,24" fill="${RED}" stroke="#fff" stroke-width="3"/>${text('STOP', 48, 22, '#fff')}<rect x="20" y="82" width="60" height="16" fill="#fff" stroke="#111" stroke-width="1.5"/>${text('4-WAY', 95, 13, INK)}`);
    case 'yield':
      return triangle('', '#fff', true);
    case 'pedPriority':
      return S(`<polygon points="50,4 96,50 50,96 4,50" fill="#fff" stroke="${RED}" stroke-width="7"/><g transform="translate(50 50) scale(0.62) translate(-50 -50)">${SYM.ped(INK)}</g>`);
    case 'no':
      return disc(`<g transform="translate(50 50) scale(0.78) translate(-50 -50)">${SYM[a](INK)}</g>`, RED, b === 'temp' ? YEL : '#fff', true);
    case 'noParking':
      return disc(text('P', 70, 58, INK), RED, '#fff', true);
    case 'limit':
      return disc(text(String(a), 64, String(a).length > 2 ? 36 : 44, INK), RED, b === 'temp' ? YEL : '#fff');
    case 'cmd':
      return S(`<circle cx="50" cy="50" r="47" fill="${BLUE}" stroke="#fff" stroke-width="3"/><g transform="translate(50 50) scale(0.8) translate(-50 -50)">${SYM[a]('#fff')}</g>`);
    case 'minSpeed':
      return S(`<circle cx="50" cy="50" r="47" fill="${BLUE}" stroke="#fff" stroke-width="3"/>${text(String(a), 64, 40, '#fff')}`);
    case 'oneWay':
      return S(`<rect x="4" y="30" width="92" height="40" rx="6" fill="${RED}" stroke="#fff" stroke-width="3"/>${line('M16 50 H72', '#fff', 8)}${fill('M88 50 L70 38 V62 Z', '#fff')}`);
    case 'reserve':
      return rect(`<g transform="translate(50 52) scale(0.75) translate(-50 -50)">${SYM[a]('#fff', BLUE)}</g>`);
    case 'parkInfo':
      return rect(text('P', 74, 66, '#fff'));
    case 'hospital':
      return rect(text('H', 72, 60, '#fff'));
    case 'warn':
      return triangle(SYM[a](INK), b === 'temp' ? YEL : '#fff');
    case 'robot':
      return robot(a, b === 'flash', b === 'arrow');
    case 'road':
      return road(a);
    default:
      return S('');
  }
}

// ---------------------------------------------------------------- question bank
// Each entry: [question, [correct, wrong, wrong], sign?]. Options are shuffled
// when the test is drawn. Section 1 also builds questions from CONTROL_TASKS.

// "Which control(s) do you use to ...?" against the numbered dashboard
const CONTROL_TASKS = [
  ['turn the vehicle', [1]],
  ['tell other road users you are going to turn', [2]],
  ['warn another road user of danger', [3]],
  ['switch your headlights between dim and bright', [4]],
  ['clear rain off the windscreen', [5]],
  ['select a gear', [8, 6]],
  ['stop the vehicle', [8, 9]],
  ['slow the vehicle down', [9]],
  ['make the vehicle go faster', [10]],
  ['keep the vehicle from rolling once it is parked', [7]],
  ['change to a lower gear before a steep downhill', [8, 6]],
  ['pull away on an uphill without rolling back', [7, 8, 10]],
];
const ctlLabel = (set) => (set.length === 1 ? `${set[0]} only` : set.slice(0, -1).join(', ') + ' and ' + set[set.length - 1]);

const CONTROLS = [
  ['The warning light for oil pressure comes on while you drive. What do you do?', ['Stop safely and switch off the engine', 'Drive faster to get home sooner', 'Ignore it until the next service']],
  ['The temperature gauge climbs into the red. What is the safest thing to do?', ['Pull over safely and let the engine cool', 'Open the radiator cap while it is hot', 'Keep driving with the windows open']],
  ['What does the clutch do in a manual car?', ['Disconnects the engine from the wheels', 'Stops the wheels from turning', 'Makes the engine run faster']],
  ['Before you get out of a parked car you must:', ['Apply the handbrake and switch off the engine', 'Leave it in neutral with the engine running', 'Only switch off the lights']],
  ['When should you switch on the hazard lights?', ['When your vehicle is stopped and is a danger to traffic', 'When you park in a legal bay', 'When you drive in light rain']],
  ['Which instrument shows how fast you are going?', ['Speedometer', 'Rev counter', 'Fuel gauge']],
  ['The rev counter (tachometer) shows:', ['How fast the engine is turning', 'How far you have driven', 'How much fuel is left']],
  ['Before moving off from the kerb you must check:', ['Mirrors and your blind spot, then signal', 'Only the rear-view mirror', 'Nothing if the road looks quiet']],
  ['Where should your hands be on the steering wheel?', ['On the outside of the rim, at about a quarter to three', 'One hand on top in the middle', 'Inside the spokes']],
  ['A soft brake pedal that sinks to the floor means:', ['The brakes are faulty and must be repaired before you drive', 'The brakes are fine', 'You must press the clutch too']],
];

const SIGNS = [
  ['What does this sign mean?', ['Stop completely, then go when it is safe', 'Slow down and go if the road is clear', 'Stop only if there is other traffic'], ['stop']],
  ['What must you do at this sign?', ['Give way to traffic on the road you are entering', 'Stop for at least three seconds', 'Speed up to join the traffic'], ['yield']],
  ['At an intersection with this sign, who goes first?', ['The vehicle that stopped first', 'The vehicle on the right', 'The biggest vehicle'], ['stop4']],
  ['This diamond sign tells you:', ['Pedestrians have right of way here', 'Pedestrians may not cross here', 'A school is 1 km ahead'], ['pedPriority']],
  ['What does this sign mean?', ['No turning left', 'Turn left ahead', 'Keep left'], ['no', 'left']],
  ['What does this sign mean?', ['No turning right', 'Turn right only', 'Sharp bend to the right'], ['no', 'right']],
  ['What does this sign mean?', ['No U-turns', 'U-turn allowed', 'Road closed ahead'], ['no', 'uturn']],
  ['What does this sign mean?', ['No overtaking', 'Two lanes merge', 'Car hire ahead'], ['no', 'twoCars']],
  ['What does this sign mean?', ['No parking', 'Parking area', 'Parking for buses only'], ['noParking']],
  ['What does this sign mean?', ['No pedestrians allowed', 'Pedestrian crossing ahead', 'Pedestrians only'], ['no', 'ped']],
  ['What does this sign mean?', ['No pedal cycles', 'Cycle lane ahead', 'Cyclists only'], ['no', 'bike']],
  ['What does this sign mean?', ['Goods vehicles may not enter', 'Truck stop ahead', 'Trucks keep left'], ['no', 'truck']],
  ['What does this sign mean?', ['No hooting', 'Hoot before the bend', 'Music shop ahead'], ['no', 'horn']],
  ['What does this sign mean?', ['No motorcycles', 'Motorcycles only', 'Motorcycle parking'], ['no', 'moto']],
  ['What does this sign mean?', ['Maximum speed 60 km/h', 'Minimum speed 60 km/h', 'Route number 60'], ['limit', 60]],
  ['What does this sign mean?', ['Do not drive faster than 80 km/h', 'Drive at least 80 km/h', 'The next town is 80 km away'], ['limit', 80]],
  ['This sign with a yellow background means:', ['A temporary speed limit of 40 km/h, for example at road works', 'A suggested speed only', 'Speed limit for trucks only'], ['limit', 40, 'temp']],
  ['What does this sign mean?', ['Maximum speed 120 km/h', 'Minimum speed 120 km/h', 'Freeway ends in 120 m'], ['limit', 120]],
  ['What does this blue sign tell you?', ['Keep to the left of the obstruction', 'No entry on the left', 'Road bends to the left'], ['cmd', 'keepLeft']],
  ['What does this blue sign tell you?', ['Proceed straight only', 'One-way street', 'Overtaking allowed'], ['cmd', 'up']],
  ['What does this blue sign tell you?', ['You must turn left ahead', 'No left turn', 'Left lane ends'], ['cmd', 'left']],
  ['What does this blue sign tell you?', ['Traffic circle: go round in the direction of the arrows', 'U-turns allowed here', 'Recycling depot'], ['cmd', 'circle']],
  ['What does this blue sign tell you?', ['Only pedestrians may use this way', 'Pedestrian crossing ahead', 'No pedestrians'], ['cmd', 'ped']],
  ['What does this blue sign tell you?', ['Only cyclists may use this way', 'Cyclists are prohibited', 'Bicycle shop ahead'], ['cmd', 'bike']],
  ['What does this blue sign with a number tell you?', ['Minimum speed 60 km/h', 'Maximum speed 60 km/h', 'Parking for 60 minutes'], ['minSpeed', 60]],
  ['What does this red rectangular sign mean?', ['One-way roadway in the direction of the arrow', 'No entry', 'Detour to the right'], ['oneWay']],
  ['What does this blue rectangular sign mean?', ['Reserved for buses only', 'Bus stop 500 m ahead', 'No buses'], ['reserve', 'bus']],
  ['What does this blue rectangular sign mean?', ['Reserved for people with disabilities', 'Hospital ahead', 'Wheelchair repairs'], ['reserve', 'wheel']],
  ['What does this blue sign mean?', ['Parking area', 'No parking', 'Police station'], ['parkInfo']],
  ['What does this blue sign mean?', ['Hospital', 'Hotel', 'Helipad only'], ['hospital']],
  ['What does this warning sign mean?', ['Crossroad ahead', 'Hospital ahead', 'Church ahead'], ['warn', 'cross']],
  ['What does this warning sign mean?', ['T-junction ahead', 'Road ends with a wall', 'Telephone ahead'], ['warn', 'tee']],
  ['What does this warning sign mean?', ['Sharp curve to the left ahead', 'Turn left now', 'No left turn'], ['warn', 'curveL']],
  ['What does this warning sign mean?', ['Sharp curve to the right ahead', 'Keep right', 'Right lane closed'], ['warn', 'curveR']],
  ['What does this warning sign mean?', ['Pedestrian crossing ahead', 'Pedestrians only', 'No pedestrians'], ['warn', 'ped']],
  ['What does this warning sign mean?', ['Children may be crossing (school ahead)', 'Playground for children only', 'Family restaurant ahead'], ['warn', 'kids']],
  ['What does this warning sign mean?', ['Traffic signals (robot) ahead', 'Robot out of order', 'Railway signals'], ['warn', 'signals']],
  ['What does this warning sign mean?', ['The road gets narrower ahead', 'Bridge for pedestrians', 'Two lanes ahead'], ['warn', 'narrows']],
  ['What does this warning sign mean?', ['Speed hump ahead', 'Hill ahead', 'Tunnel ahead'], ['warn', 'hump']],
  ['What does this warning sign mean?', ['Two-way traffic ahead', 'One-way street', 'Overtaking lane'], ['warn', 'twoWay']],
  ['What does this warning sign mean?', ['Traffic circle ahead', 'U-turn ahead', 'Road works'], ['warn', 'circle']],
  ['What does this warning sign mean?', ['Steep descent ahead: use a lower gear', 'Steep climb: speed up', 'Toll 10% discount'], ['warn', 'descent']],
  ['What does this warning sign mean?', ['Road slippery when wet', 'Car wash ahead', 'Drifting allowed'], ['warn', 'slippery']],
  ['What does this warning sign mean?', ['Danger ahead of a kind not shown by another sign', 'Information centre', 'Hospital'], ['warn', 'bang']],
  ['What does this warning sign mean?', ['Animals (cattle) may be on the road', 'Dairy farm shop', 'Abattoir ahead'], ['warn', 'cow']],
  ['What does a warning sign with a yellow background tell you?', ['It is a temporary sign, for example at road works', 'It is only a suggestion', 'It applies only at night'], ['warn', 'bang', 'temp']],
  ['The robot shows this. What do you do?', ['Stop behind the line and wait for green', 'Go if nobody is coming', 'Hoot and go'], ['robot', 'red']],
  ['The robot shows this. What do you do?', ['Stop, unless you are so close that stopping would be unsafe', 'Speed up to beat the red', 'Go, amber means go'], ['robot', 'amber']],
  ['The robot shows this. What do you do?', ['Go if the intersection is clear', 'Stop and wait', 'Go without looking'], ['robot', 'green']],
  ['The red light of a robot is flashing. What do you do?', ['Stop, then go when it is safe, like a stop sign', 'Slow down and go', 'Wait until it turns green'], ['robot', 'red', 'flash']],
  ['The robot shows a green arrow. It means:', ['You may turn in the direction of the arrow', 'Turning is not allowed', 'Only buses may go'], ['robot', 'green', 'arrow']],
  ['What does a solid white line in the middle of the road mean?', ['You may not cross it or drive on it', 'You may overtake with care', 'Parking is allowed next to it'], ['road', 'solid']],
  ['What does a broken white line in the middle of the road mean?', ['You may cross it when it is safe', 'You may never cross it', 'The road is about to end'], ['road', 'broken']],
  ['What does this yellow line along the left edge of the road show?', ['The edge of the roadway (the shoulder is outside it)', 'A lane for taxis only', 'No overtaking'], ['road', 'yellowEdge']],
  ['What does this white line across your lane at a STOP sign show?', ['Where you must stop', 'Where you may park', 'The end of the speed limit'], ['road', 'stopLine']],
  ['This broken line across your lane with a triangle means:', ['Yield to traffic on the road you are entering', 'Stop for three seconds', 'Pedestrian crossing'], ['road', 'yieldLine']],
  ['What do these painted stripes (a painted island) mean?', ['Do not drive or stop on it', 'Extra lane for overtaking', 'Parking for motorcycles'], ['road', 'island']],
  ['What do these white blocks across the road show?', ['A pedestrian crossing: give way to people on it', 'Speed humps', 'A taxi rank'], ['road', 'zebra']],
];

const RULES = [
  ['What is the general speed limit in a town or city, unless a sign says otherwise?', ['60 km/h', '80 km/h', '40 km/h']],
  ['What is the general speed limit on a public road outside a town?', ['100 km/h', '120 km/h', '80 km/h']],
  ['What is the general speed limit on a freeway?', ['120 km/h', '100 km/h', '140 km/h']],
  ['What is the speed limit for a goods vehicle heavier than 9 000 kg (GVM)?', ['80 km/h', '100 km/h', '120 km/h']],
  ['What is the legal blood-alcohol limit for an ordinary driver?', ['Less than 0.05 g per 100 ml of blood', 'Less than 0.08 g per 100 ml of blood', 'Any amount, if you feel fine']],
  ['What is the legal blood-alcohol limit for a professional driver (PrDP)?', ['Less than 0.02 g per 100 ml of blood', 'Less than 0.05 g per 100 ml of blood', 'Less than 0.10 g per 100 ml of blood']],
  ['In good conditions, what is the minimum following distance behind the car in front?', ['At least two seconds', 'Half a second', 'One car length at any speed']],
  ['In rain or poor visibility your following distance should be:', ['Longer than in good weather', 'Shorter, to see the car ahead', 'The same as always']],
  ['On which side of the road do you drive in South Africa?', ['The left side', 'The right side', 'Any side that is open']],
  ['On which side do you normally overtake?', ['On the right', 'On the left', 'On either side']],
  ['When may you overtake on the left?', ['When the vehicle ahead is turning right and there is room, or on a multi-lane one-way road', 'Whenever the left lane is empty', 'Never, under any circumstances']],
  ['Another vehicle is overtaking you. You must:', ['Keep left and not speed up', 'Speed up so it cannot pass', 'Move to the right']],
  ['Where may you not overtake?', ['Near the top of a hill or on a bend where you cannot see far enough', 'On a straight road with a broken line', 'When the road ahead is clear']],
  ['At a four-way stop, who has right of way?', ['The vehicle that stopped first', 'The vehicle on the right', 'The vehicle going straight']],
  ['A robot is out of order (all lights off). Treat the intersection as:', ['A four-way stop', 'A free road for whoever is fastest', 'A yield for the smaller road']],
  ['At a traffic circle you must give way to:', ['Traffic coming from your right', 'Traffic coming from your left', 'Nobody once you are moving']],
  ['You want to turn right at an intersection. Who must you give way to?', ['Oncoming traffic going straight or turning left', 'Nobody, if you signalled', 'Only buses']],
  ['A traffic officer signals you to stop while the robot is green. You:', ['Obey the traffic officer', 'Go, because the robot is green', 'Hoot to warn the officer']],
  ['An ambulance with its siren on comes up behind you. You:', ['Move left and give way, stopping if needed', 'Speed up to stay ahead', 'Brake hard in your lane']],
  ['People are walking on a pedestrian crossing in front of you. You:', ['Stop and give way to them', 'Hoot so they hurry', 'Drive around them']],
  ['When must your headlights be on?', ['Between sunset and sunrise, and whenever you cannot see clearly for 150 m', 'Only on the freeway', 'Only when it rains']],
  ['An oncoming vehicle is coming closer at night. You should:', ['Dip your headlights', 'Switch to bright lights', 'Switch off your lights']],
  ['When may you use the hooter?', ['Only when needed for safety', 'To greet friends', 'To tell slow drivers to hurry']],
  ['Who must wear a seatbelt?', ['The driver and every passenger, where a belt is fitted', 'Only the driver', 'Only front-seat passengers']],
  ['A child younger than 3 years riding in a car must sit in:', ['A suitable child restraint (car seat)', "A passenger's lap", 'The front seat with an adult belt']],
  ['May you hold a cellphone in your hand while driving?', ['No, only a hands-free kit may be used', 'Yes, if you drive slowly', 'Yes, at a red robot only']],
  ['A learner driver may only drive when:', ['A person licensed for that vehicle sits beside them', 'Another learner sits beside them', 'It is daytime, alone']],
  ['How long is a learner\'s licence valid?', ['24 months', '6 months', 'For life']],
  ['How often must a driving licence card be renewed?', ['Every 5 years', 'Every year', 'Never']],
  ['While driving you must carry:', ['Your driving licence (or learner\'s licence)', 'Your birth certificate', 'Nothing']],
  ['Your vehicle broke down on the road. How far behind it should the warning triangle be?', ['At least 45 m', '5 m', 'Right next to the car']],
  ['You were in a crash in which someone was hurt. You must:', ['Stop, help the injured, and report it to the police', 'Drive away if your car still works', 'Only swap phone numbers']],
  ['When may you stop on a freeway?', ['Only in an emergency, on the shoulder', 'To take a phone call', 'To pick up hitchhikers']],
  ['On a freeway you may never:', ['Reverse or make a U-turn', 'Use the left lane', 'Use your indicators']],
  ['Before changing lanes you must:', ['Check your mirrors and blind spot, then signal', 'Hoot, then move', 'Brake hard first']],
  ['After overtaking you should:', ['Return to the left lane when it is safe', 'Stay in the right lane', 'Slow down sharply in front of the other car']],
  ['When may you drive on the yellow-lined shoulder to let faster traffic pass?', ['In daylight, where you can see far ahead, and when it is safe', 'At night only', 'Whenever you like']],
  ['The red lights at a railway level crossing flash. You:', ['Stop and wait until they stop flashing', 'Cross quickly before the train', 'Hoot and cross']],
  ['On a long trip, how often should you rest?', ['About every 2 hours or 200 km', 'Only when you run out of fuel', 'Never, keep going']],
  ['Where must the vehicle licence disc be displayed?', ['On the windscreen, where it can be read from outside', 'In the cubbyhole', 'In the boot']],
  ['When towing with a rope, the space between the two vehicles may not be more than:', ['3.5 m', '10 m', '20 m']],
  ['You come to a school bus stopped with children getting off. You should:', ['Slow down and be ready to stop: children may run into the road', 'Hoot and drive past fast', 'Overtake on the left']],
  ['When you pass a cyclist you should:', ['Leave plenty of space and pass slowly', 'Hoot loudly as you pass', 'Pass as close as possible']],
  ['You feel tired while driving. The safest thing is to:', ['Stop in a safe place and rest', 'Open the window and drive faster', 'Drink alcohol to wake up']],
  ['You may not park:', ['On a pedestrian crossing or in front of a driveway', 'In a marked parking bay', 'In your own garage']],
  ['A funeral or official procession is passing. You should:', ['Not cut into or through it', 'Join it to get through traffic', 'Hoot to make it go faster']],
  ['Before turning left at an intersection you should:', ['Signal, check for cyclists and pedestrians, and keep left', 'Move to the right lane first', 'Speed up through the turn']],
  ['What is the main danger of driving too close to the vehicle in front?', ['You cannot stop in time if it brakes', 'You use more fuel', 'Your radio works worse']],
  ['Animals are on the road ahead. You should:', ['Slow down and pass carefully, ready to stop', 'Hoot and drive at the same speed', 'Speed up to scare them off']],
  ['You are driving and a tyre bursts. You should:', ['Hold the steering firmly and slow down gradually', 'Brake as hard as you can', 'Let go of the steering wheel']],
  ['A taxi in front stops suddenly to drop passengers. You should:', ['Keep a safe distance so you can stop or pass safely', 'Hoot and stay right behind it', 'Overtake on the left over the pavement']],
  ['At night your headlights dazzle you from an oncoming car. You should:', ['Look towards the left edge of the road and slow down', 'Flash your brights back', 'Close your eyes for a moment']],
  ['When you see a STOP sign at a railway crossing you must:', ['Stop, look both ways and cross only when it is safe', 'Slow down only', 'Stop only if a train is visible']],
  ['Who must you give way to when you drive out of a driveway onto a road?', ['Pedestrians on the pavement and traffic on the road', 'Nobody', 'Only buses']],
  ['The road is wet after the first rain in a long time. You know that:', ['The road can be extra slippery with oil, so slow down', 'Grip is better than ever', 'Brakes work better when wet']],
];

// ---------------------------------------------------------------- drawing a test
function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function mcq(section, q, opts, rnd, extra = {}) {
  const order = shuffle([0, 1, 2], rnd);
  return { section, q, opts: order.map((k) => opts[k]), c: order.indexOf(0), ...extra };
}

function controlTaskQuestions(rnd) {
  const out = [];
  for (const [task, set] of CONTROL_TASKS) {
    const right = ctlLabel(set);
    const wrong = [];
    for (const [, s] of shuffle(CONTROL_TASKS.slice(), rnd)) {
      const l = ctlLabel(s);
      if (l !== right && !wrong.includes(l)) wrong.push(l);
      if (wrong.length === 2) break;
    }
    out.push(mcq('controls', `Which control(s) do you use to ${task}?`, [right, wrong[0], wrong[1]], rnd, { cockpit: true }));
  }
  return out;
}

export function bankSize() {
  return CONTROL_TASKS.length + CONTROLS.length + SIGNS.length + RULES.length;
}

// A fresh 64-question test: 8 controls, 28 signs, 28 rules (in that order).
export function drawTest(rnd = Math.random) {
  // at most 4 from the "which control" picture so the section mixes both kinds
  let pics = 0;
  const ctl = [];
  for (const q of shuffle(controlTaskQuestions(rnd).concat(CONTROLS.map(([q2, o]) => mcq('controls', q2, o, rnd))), rnd)) {
    if (q.cockpit && pics >= 4) continue;
    if (q.cockpit) pics++;
    ctl.push(q);
    if (ctl.length === 8) break;
  }
  const signs = shuffle(SIGNS.slice(), rnd).slice(0, 28).map(([q, o, s]) => mcq('signs', q, o, rnd, { sign: s }));
  const rules = shuffle(RULES.slice(), rnd).slice(0, 28).map(([q, o]) => mcq('rules', q, o, rnd));
  return ctl.concat(signs, rules);
}

// Marks per section: [{id, name, n, pass, right, ok}], plus overall ok.
export function mark(test, answers) {
  const res = SECTIONS.map((s) => ({ ...s, right: 0, ok: false }));
  test.forEach((q, i) => {
    if (answers[i] === q.c) res.find((r) => r.id === q.section).right++;
  });
  for (const r of res) r.ok = r.right >= r.pass;
  return { sections: res, ok: res.every((r) => r.ok) };
}
