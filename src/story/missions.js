// IZK story campaign: "Ntombi" (the Red Lady).
//
// Data only (no THREE, no DOM): the engine (engine.js) plays it, the world
// layer (story.js) resolves the places and draws markers and actors, and
// scripts/check-story.mjs checks and plays every mission headlessly.
//
// A young guy from KwaMashu, Sizwe, gets his uncle's old red BMW E30
// ("gusheshe") and hustles to build a better life before his baby arrives.
// Rated 13+: no gore, no drugs, nothing sexual. Taxi trouble is background
// only (a tense rank, nobody hurt). isiZulu and slang always come with the
// plain English meaning in brackets.
//
// ---- format -------------------------------------------------------------
// PLACES[key] = { name, ll: [lon, lat] } or { name, xz: [x, z] }.
//   snap (default true): moved onto the kerb of the nearest road.
//   rank: name prefix of a real taxi rank (fares.js), used when it exists.
// MISSIONS[i] = { id, chapter, title, icon, start (place key), car (needs a
//   car), blurb, summary (journal text once done), reward: { money, car,
//   note }, steps: [...] }
// Step kinds ("do"):
//   scene   { lines: [[who, text], ...] }   who = CAST key or 'story'
//   reach   { to, text, r?, mode? ('any'|'car'|'foot'), stop?, time?,
//             fragile? (bumps allowed), maxKmh?, pax? (person waiting),
//             cargo?, chatter?: [[fraction, who, text]] }
//   licence { need: 'learner'|'code10'|'prdp', text }
//   follow  { from, to, car, cruise, lose, text }
//   race    { from, to, car, cruise, gates, text }
//   spin    { at, turns, time, text }
//   earn    { amount, text }   (money earned while the step runs)
//   pay     { amount, what, text }
//   car     { type, at }       (hands over / parks the car at a place)
// time: { limit } seconds, or { avg (m/s), extra (s) } from the route length.

export const STORY_VERSION = 1;

export const CHAPTERS = [
  {
    id: 'c1',
    n: 1,
    title: 'Ntombi Ebomvu',
    sub: 'The Red Lady',
    color: '#e2463a',
    blurb: 'KwaMashu, summer. Sizwe is 22, broke, and about to be a father. His uncle has an old red gusheshe (BMW E30) sleeping under a mango tree. It could change everything, if Sizwe gets his licence.',
  },
  {
    id: 'c2',
    n: 2,
    title: 'Umsebenzi',
    sub: 'The Hustle',
    color: '#f2b632',
    blurb: 'A licence, a car and a baby on the way. Now Sizwe needs real money. Durban is big, the work is hard, and the city has its own rules.',
  },
  {
    id: 'c3',
    n: 3,
    title: 'Isisekelo',
    sub: 'The Foundation',
    color: '#3fb37a',
    blurb: 'December is close. Sizwe has a car, a name in the kasi (township) and a few good friends. Now he must build something that lasts.',
  },
];

// Stylised portraits are drawn in code (portraits.js) from these looks.
export const CAST = {
  sizwe: { name: 'Sizwe', role: 'You', look: { skin: '#6b4430', hair: 'fade', hat: 'cap', hatColor: '#d8322a', shirt: '#d8322a', bg: '#3b1d1a', beard: 'stubble' } },
  ma: { name: 'Ma', role: "Sizwe's mother", look: { skin: '#5a3726', hair: 'none', hat: 'doek', hatColor: '#2f6fd2', hatColor2: '#f2c230', shirt: '#7a3fa0', bg: '#1d2440', earrings: '#f2c230', age: 2 } },
  bongz: { name: 'Malume Bongz', role: "Sizwe's uncle", look: { skin: '#4f3022', hair: 'bald', hat: 'bucket', hatColor: '#e9e2cf', shirt: '#2a6b4a', bg: '#1d3326', beard: 'grey', glasses: 'round', age: 3 } },
  nomsa: { name: 'Nomsa', role: "Sizwe's girlfriend", look: { skin: '#7a4c33', hair: 'bun', shirt: '#f2c230', bg: '#3d2a12', earrings: '#ffd76a', lips: '#8a3a3a' } },
  tsepo: { name: 'Tsepo', role: 'Best friend, car wash', look: { skin: '#5e3b28', hair: 'twists', shirt: '#2f5fb0', bg: '#14263f', beard: 'goatee', overalls: true } },
  naidoo: { name: 'Mr Naidoo', role: 'Spice shop, Victoria Street Market', look: { skin: '#8a5a3c', hair: 'grey', shirt: '#f1efe6', bg: '#3a2512', beard: 'moustache', glasses: 'square', age: 3 } },
  gumede: { name: 'Mr Gumede', role: 'Driving instructor', look: { skin: '#553524', hair: 'part', shirt: '#e8eef4', bg: '#1b2a3a', glasses: 'square', tie: '#1e5a32', age: 2 } },
  mthembu: { name: 'Baba Mthembu', role: 'Taxi owner', look: { skin: '#4a2c1f', hair: 'short', hat: 'fedora', hatColor: '#2b2b2b', shirt: '#7d1f2a', bg: '#2b1a12', beard: 'full', age: 2 } },
  zanele: { name: 'Zanele', role: "Mthembu's daughter, student", look: { skin: '#6e4530', hair: 'ponytail', shirt: '#1e6fa8', bg: '#12303f', glasses: 'round', earrings: '#ffffff' } },
  skhokho: { name: 'Skhokho', role: 'Rival spinner', look: { skin: '#5b3a27', hair: 'fade', hat: 'bucket', hatColor: '#111111', shirt: '#f4f4f4', bg: '#202020', glasses: 'sun', chain: true } },
  thoko: { name: 'Auntie Thoko', role: 'Caterer, Umlazi', look: { skin: '#5d3828', hair: 'none', hat: 'doek', hatColor: '#e0457b', hatColor2: '#ffd21a', shirt: '#e57a1f', bg: '#3a1530', earrings: '#ffd21a', age: 2, round: true } },
  nurse: { name: 'Sister Mkhize', role: 'Nurse', look: { skin: '#62402c', hair: 'bun', hat: 'nurse', hatColor: '#ffffff', shirt: '#f4f7fb', bg: '#16364a', collar: '#2f6fd2' } },
  mc: { name: 'MC Bhova', role: 'Spin show host', look: { skin: '#523222', hair: 'short', shirt: '#7a3fa0', bg: '#2a1240', headphones: true, beard: 'stubble', glasses: 'sun' } },
};

// Real Durban spots. Places off the road (car parks) keep their spot.
export const PLACES = {
  maHouse: { name: "Ma's house, K Section, KwaMashu", ll: [30.9798, -29.7452] },
  bridgeRank: { name: 'Bridge City taxi rank', xz: [-3378, -14547], rank: 'Bridge City Taxi Rank' },
  centenary: { name: 'Centenary taxi rank, town', xz: [-1042, -616], rank: 'Centenary Taxi Rank' },
  vicMarket: { name: 'Victoria Street Market', ll: [31.0209, -29.857] },
  bhos: { name: "Bho's Driving Academy", ll: [30.994246, -29.764138] },
  tsepoWash: { name: "Tsepo's car wash, Bridge City", xz: [-3398, -14577] },
  florida: { name: 'Restaurant on Florida Road, Morningside', ll: [31.01571, -29.83194] },
  dnorth: { name: 'Shop on Swapo Road, Durban North', ll: [31.03656, -29.78394] },
  pixley: { name: 'Dr Pixley KaSeme Hospital, KwaMashu', xz: [-3044.8, -14428.7] },
  ntuzuma: { name: 'Taxi stop, Ntuzuma', xz: [-6900, -13900] },
  magogo: { name: 'Princess Magogo Stadium car park', xz: [-4505, -12291], snap: false },
  battery: { name: 'Snell Parade, Battery Beach', ll: [31.03528, -29.84387] },
  ushaka: { name: 'uShaka Marine World', ll: [31.0281, -29.8706] },
  thoko: { name: "Auntie Thoko's house, Umlazi V Section", ll: [30.8852, -29.9702] },
  sukuma: { name: 'Corner by Sukuma Primary, Umlazi', xz: [-14554, 12619] },
  kwamnyandu: { name: 'KwaMnyandu Shopping Centre, Umlazi', xz: [-11312, 12527] },
  comtech: { name: 'Umlazi Comtech High School hall', xz: [-9845, 12293] },
};

export const MISSIONS = [
  // ======================= Chapter 1: Ntombi Ebomvu =======================
  {
    id: 'c1m1',
    chapter: 'c1',
    title: "Ma's Kitchen",
    icon: 'home',
    start: 'maHouse',
    blurb: 'Ma wants a word. A serious one.',
    summary: 'Ma told Sizwe that Nomsa is pregnant. Uncle Bongz promised him the red gusheshe once he has a licence. Nomsa said: prove it.',
    reward: { money: 150, note: 'Ma gave you taxi money' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['ma', 'Sizwe! Woza la (come here). Sit down, mntanami (my child).'],
          ['sizwe', "Ma, I'm late. The guys are waiting at the corner."],
          ['ma', 'The corner pays nothing. Nomsa came here this morning.'],
          ['sizwe', 'Nomsa? Here? Why?'],
          ['ma', "She's pregnant, Sizwe. The baby comes in December."],
          ['sizwe', 'Haibo (no way)... A baby? Me? A father?'],
          ['ma', 'Yes, you. So from today, no more corner. You need a plan.'],
          ['bongz', 'Heh! I heard everything from the gate. Congratulations, mfana (boy)!'],
          ['bongz', 'Listen. My old red gusheshe (BMW E30) is sleeping under the mango tree. She still runs.'],
          ['bongz', 'Get your licence and Ntombi (the Red Lady) is yours. A car is a job, if you are clever.'],
          ['sizwe', 'Malume (uncle), are you serious?'],
          ['bongz', 'Serious like Sunday church. But first, go find Nomsa. She sells sweets at the Bridge City rank.'],
        ],
      },
      { do: 'reach', to: 'bridgeRank', r: 30, text: 'Go to the Bridge City taxi rank and find Nomsa' },
      {
        do: 'scene',
        lines: [
          ['nomsa', 'So. Your mother told you.'],
          ['sizwe', "She did. Nomsa... I'm happy. Scared, but happy."],
          ['nomsa', "Happy doesn't buy nappies, Sizwe."],
          ['sizwe', "I know. Malume is giving me his gusheshe when I get my licence. I'll work. Deliveries, lifts, anything."],
          ['nomsa', 'Mm. You, that uncle and his old car... Okay. Prove it.'],
          ['nomsa', 'My cousin says Mr Naidoo at Victoria Street Market needs a driver. Go see him in town. Take a taxi from here.'],
        ],
      },
    ],
  },
  {
    id: 'c1m2',
    chapter: 'c1',
    title: 'Taxi to Town',
    icon: 'taxi',
    start: 'bridgeRank',
    blurb: 'Ride a minibus taxi into the city and meet Mr Naidoo.',
    summary: 'Sizwe rode a taxi into town and met Mr Naidoo, a spice seller at Victoria Street Market. There is a driving job, once Sizwe has wheels.',
    reward: { money: 100, note: 'Mr Naidoo gave you bunny chow money' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['story', 'The rank is loud and busy. Gqom music, hawkers, and marshals shouting the routes.'],
          ['sizwe', 'Taxi to town. Easy. Stand at the rank, tap ACTION, pick Centenary, pay the driver.'],
        ],
      },
      { do: 'reach', to: 'centenary', r: 260, text: 'Get to town: board a taxi to Centenary rank (ACTION at the rank)' },
      { do: 'reach', to: 'vicMarket', r: 40, text: 'Walk to Victoria Street Market' },
      {
        do: 'scene',
        lines: [
          ['naidoo', "You're the boy Nomsa's cousin told me about? The one with no car?"],
          ['sizwe', "The car is coming, Mr Naidoo. I'm getting my licence."],
          ['naidoo', 'Thirty years I sell spices here. Masala, chilli, real Durban curry stuff. My driver just retired.'],
          ['naidoo', 'Get your licence, come back with wheels, and you have work. I pay on time. Always.'],
          ['sizwe', 'Ngiyabonga (thank you), Mr Naidoo. I will be back.'],
          ['naidoo', 'Here, take something for a bunny chow (curry in a bread loaf). You look hungry.'],
        ],
      },
    ],
  },
  {
    id: 'c1m3',
    chapter: 'c1',
    title: "Learner's Licence",
    icon: 'licence',
    start: 'bhos',
    blurb: 'Signs, rules and controls. Pass the K53 learner test.',
    summary: "Sizwe met Mr Gumede, a strict K53 instructor, and passed his learner's licence.",
    reward: { money: 200, note: 'Ma is proud: R200 for your lessons' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['gumede', "Welcome to Bho's. I am Mr Gumede. K53 is not a suggestion. It is a lifestyle."],
          ['sizwe', 'Sawubona (hello), Mr Gumede. I want my licence. Fast.'],
          ['gumede', 'Fast is how people fail. First, the learner test: signs, rules, controls. Read every question.'],
        ],
      },
      { do: 'licence', need: 'learner', text: "Pass the learner's licence test at a driving school desk (R110)" },
      {
        do: 'scene',
        lines: [
          ['gumede', 'Passed! You see? Reading works. Next: lessons, then the driving test.'],
          ['sizwe', 'Mr Gumede, I think I like K53 now.'],
          ['gumede', 'Everybody says that. Until the alley docking.'],
        ],
      },
    ],
  },
  {
    id: 'c1m4',
    chapter: 'c1',
    title: 'Code 10',
    icon: 'wheel',
    start: 'bhos',
    blurb: 'Lessons in the yard, then the real driving test.',
    summary: 'Mirror, signal, blind spot. Sizwe passed his driving test and got his Code 10 licence.',
    reward: { money: 300, note: 'Malume Bongz: R300 for petrol' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['gumede', 'Mirror, signal, blind spot. Say it with me.'],
          ['sizwe', 'Mirror, signal, blind spot.'],
          ['gumede', "Good. Take lessons in the yard, then do the test at a testing ground. Don't touch the cones."],
        ],
      },
      { do: 'licence', need: 'code10', text: "Get your driver's licence: lessons, then the test at a testing ground" },
      {
        do: 'scene',
        lines: [
          ['gumede', 'Congratulations, Sizwe. Code 10. Drive like your mother is watching.'],
          ['sizwe', 'Mr Gumede, my mother is ALWAYS watching.'],
        ],
      },
    ],
  },
  {
    id: 'c1m5',
    chapter: 'c1',
    title: 'The Red Lady',
    icon: 'car',
    start: 'maHouse',
    blurb: 'Malume hands over the keys. Get her serviced before Tsepo closes.',
    summary: 'Malume Bongz gave Sizwe the keys to Ntombi, his 1991 red BMW E30. Tsepo checked her over at his car wash.',
    reward: { money: 250, note: 'Malume filled the tank', car: 'gusheshe' },
    steps: [
      { do: 'car', type: 'gusheshe', at: 'maHouse' },
      {
        do: 'scene',
        lines: [
          ['bongz', 'There she is. Ntombi. 1991, straight-six engine. Red like a tomato.'],
          ['sizwe', "Eish, Malume, she's beautiful. A bit dusty, but beautiful."],
          ['bongz', "Dust is just history. The keys are yours. Look after her and she'll look after you."],
          ['ma', 'And no spinning in my street! The neighbours complain.'],
          ['bongz', "Heh. We'll see, sisi (sister)."],
          ['bongz', 'Take her to Tsepo at Bridge City. He will check the oil and brakes. He closes soon. Shesha (hurry)!'],
        ],
      },
      {
        do: 'reach',
        to: 'tsepoWash',
        mode: 'car',
        stop: true,
        time: { avg: 8.5, extra: 45 },
        text: "Drive Ntombi to Tsepo's car wash before he closes",
        chatter: [
          [0.3, 'bongz', '(on the phone) Easy on the clutch, mfana! She is older than you!'],
          [0.7, 'sizwe', 'Ntombi pulls so nicely... Malume was right.'],
        ],
      },
      {
        do: 'scene',
        lines: [
          ['tsepo', "Yoh yoh yoh! Is that Malume Bongz's E30? The legend herself!"],
          ['sizwe', "She's mine now, Tsepo. Licence and everything."],
          ['tsepo', "Oil is low, brakes are fine, tyres... let's say they have personality. I'll do the oil mahala (free)."],
          ['tsepo', 'But bra (brother), a car drinks petrol. You need money coming in. Go see your spice man in town.'],
        ],
      },
    ],
  },

  // ========================= Chapter 2: Umsebenzi =========================
  {
    id: 'c2m1',
    chapter: 'c2',
    title: 'Spice Run',
    icon: 'box',
    start: 'vicMarket',
    car: true,
    blurb: "Deliver Mr Naidoo's masala boxes. Don't break them.",
    summary: "Sizwe delivered Mr Naidoo's spice boxes to Florida Road and Durban North, in one piece. His first real pay.",
    reward: { money: 600, note: 'Mr Naidoo pays on time' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['naidoo', 'Ah! The boy came back with wheels. A gusheshe! My nephew had one, in 1995.'],
          ['naidoo', 'Three boxes of masala. One for a restaurant on Florida Road, two for a shop in Durban North.'],
          ['naidoo', 'Drive carefully, hey. Boxes break and the car smells like curry for a month.'],
          ['sizwe', 'Honestly, Mr Naidoo, that sounds like a bonus.'],
        ],
      },
      { do: 'reach', to: 'florida', mode: 'car', stop: true, fragile: 3, cargo: 'masala', time: { avg: 9, extra: 60 }, text: 'Deliver box 1 to the restaurant on Florida Road' },
      { do: 'scene', lines: [['story', 'The chef signs for the box, sniffs it, and gives you a big thumbs up.']] },
      {
        do: 'reach',
        to: 'dnorth',
        mode: 'car',
        stop: true,
        fragile: 3,
        cargo: 'masala',
        time: { avg: 9, extra: 60 },
        text: 'Deliver the last two boxes to the shop in Durban North',
        chatter: [[0.5, 'naidoo', '(on the phone) The restaurant called. They love you. Now don\'t get a big head.']],
      },
      {
        do: 'scene',
        lines: [
          ['naidoo', '(on the phone) Everything arrived in one piece! R600, like I promised.'],
          ['naidoo', 'Come back any time. A good driver is hard to find in this city.'],
        ],
      },
    ],
  },
  {
    id: 'c2m2',
    chapter: 'c2',
    title: 'Check-up Day',
    icon: 'heart',
    start: 'maHouse',
    car: true,
    blurb: 'Drive Nomsa to her clinic check-up. Gently.',
    summary: 'Sizwe drove Nomsa to her check-up at Dr Pixley KaSeme Hospital. The baby is healthy, and it is a girl.',
    reward: { money: 150, note: "Ma's celebration money" },
    steps: [
      {
        do: 'scene',
        lines: [
          ['nomsa', "My check-up is today. Ma said you'd drive me."],
          ['sizwe', 'Your chariot is ready, madam. Fully serviced. Smells a bit like masala.'],
          ['nomsa', 'Just drive nicely, okay? No jumps, no spinning, no showing off.'],
        ],
      },
      {
        do: 'reach',
        to: 'pixley',
        mode: 'car',
        stop: true,
        fragile: 2,
        maxKmh: 70,
        text: 'Drive Nomsa gently to Dr Pixley KaSeme Hospital (stay under 70 km/h)',
        chatter: [
          [0.2, 'nomsa', "Did you eat today? You never eat when you're stressed."],
          [0.5, 'sizwe', 'I had a kota (quarter-loaf sandwich). It counts.'],
          [0.8, 'nomsa', 'It does not count.'],
        ],
      },
      {
        do: 'scene',
        lines: [
          ['nurse', 'Nomsa? Come in. And you must be the father. Sit there, baba (father).'],
          ['story', 'One hour later...'],
          ['nomsa', 'The baby is healthy. Strong heartbeat. Sister says... it\'s a girl!'],
          ['sizwe', 'A girl... Ngiyakuthanda (I love you), Nomsa. Both of you.'],
          ['nomsa', "Okay, okay, don't cry in the hospital. People are looking."],
        ],
      },
    ],
  },
  {
    id: 'c2m3',
    chapter: 'c2',
    title: 'Tense Rank',
    icon: 'follow',
    start: 'bridgeRank',
    car: true,
    blurb: "The ranks are tense today. Follow the last taxi and keep Zanele safe.",
    summary: "On a tense day at the ranks, Sizwe followed the last taxi out and brought Baba Mthembu's daughter Zanele safely back. The taxi associations made peace that afternoon.",
    reward: { money: 700, note: 'Baba Mthembu says thank you' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['mthembu', "You're Bongz's nephew? Good. I need someone I can trust."],
          ['mthembu', 'Two taxi associations are arguing over this route. Nobody is loading today. Police everywhere.'],
          ['mthembu', 'My daughter Zanele is on the last taxi out, going to Ntuzuma. Follow it. Stay close.'],
          ['sizwe', 'Is it dangerous, Baba?'],
          ['mthembu', 'Not if you keep your eyes open. Just follow. Do not lose her taxi.'],
        ],
      },
      { do: 'follow', from: 'bridgeRank', to: 'ntuzuma', car: 'quantum', cruise: 11.5, lose: 170, text: "Follow Zanele's taxi to Ntuzuma. Don't lose it" },
      { do: 'reach', to: 'ntuzuma', mode: 'car', stop: true, pax: true, r: 26, text: 'Stop next to Zanele to pick her up' },
      {
        do: 'scene',
        lines: [
          ['zanele', 'You are the guy my father sent? In a red gusheshe? Very subtle.'],
          ['sizwe', 'I am your bodyguard today. Sorry, the radio only plays maskandi (Zulu guitar music).'],
          ['zanele', 'Honestly? Maskandi is fine. Take me to my father at the rank.'],
        ],
      },
      {
        do: 'reach',
        to: 'bridgeRank',
        mode: 'car',
        stop: true,
        text: 'Drive Zanele back to her father at Bridge City rank',
        chatter: [
          [0.35, 'zanele', 'I study logistics at DUT. You know your car could be a business, right?'],
          [0.7, 'sizwe', 'A business? Like... a real one? With a sign?'],
          [0.85, 'zanele', 'With a sign. And a plan. Mostly the plan.'],
        ],
      },
      {
        do: 'scene',
        lines: [
          ['mthembu', 'Ngiyabonga (thank you), mfana. The associations made peace this afternoon. Today you helped my family.'],
          ['mthembu', 'If you ever want taxi work, get your PrDP (driving permit for passengers). There is always a seat for a careful driver.'],
        ],
      },
    ],
  },
  {
    id: 'c2m4',
    chapter: 'c2',
    title: 'Spin Kasi',
    icon: 'spin',
    start: 'magogo',
    car: true,
    blurb: 'A spinning show at Princess Magogo Stadium. The whole kasi is watching.',
    summary: 'At the spinning show by Princess Magogo Stadium, Sizwe and Ntombi won the crowd. A flashy rival, Skhokho, challenged him to a race.',
    reward: { money: 800, note: 'Spin show prize money' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['tsepo', 'Bra! Spinning show at Princess Magogo Stadium today. The whole kasi (township) is here!'],
          ['bongz', 'In my day I was the king of this car park. They called me Bongz the Tornado.'],
          ['sizwe', "Malume, you told me they called you 'Slow Bongz'."],
          ['bongz', '...That was a different time. Go! Show them Ntombi still has it.'],
          ['mc', 'Ladies and gentlemen! From K Section, in the Tornado\'s old red E30... SIZWEEE!'],
        ],
      },
      { do: 'spin', at: 'magogo', turns: 3, time: 80, text: 'Spin! Do 3 full circles inside the ring: hard steering plus gas' },
      {
        do: 'scene',
        lines: [
          ['mc', 'AYEYE (let\'s go)! Did you see that? The Red Lady is BACK!'],
          ['skhokho', 'Cute spins, farm boy. My white gusheshe does that in her sleep.'],
          ['sizwe', 'Then wake her up. Race me.'],
          ['skhokho', 'Friday night. Battery Beach to uShaka, on the beachfront. Do not be late.'],
        ],
      },
    ],
  },
  {
    id: 'c2m5',
    chapter: 'c2',
    title: 'Beachfront Race',
    icon: 'flag',
    start: 'battery',
    car: true,
    blurb: 'Battery Beach to uShaka. Beat Skhokho. Race clean.',
    summary: 'Sizwe beat Skhokho on the beachfront, from Battery Beach to uShaka. The rival became a friend, with an uncle who owns car washes.',
    reward: { money: 1200, note: 'Race winnings' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['skhokho', 'You came. Battery Beach to uShaka, along the beachfront. First to uShaka wins.'],
          ['tsepo', 'Bra, people are walking everywhere here. Race clean, nobody gets hurt. Promise me.'],
          ['sizwe', "Clean like Ma's kitchen."],
          ['story', '3... 2... 1... HAMBA (go)!'],
        ],
      },
      { do: 'race', from: 'battery', to: 'ushaka', car: 'gusheshe', cruise: 16.5, gates: 3, text: 'Beat Skhokho to uShaka. Drive through every blue ring' },
      {
        do: 'scene',
        lines: [
          ['skhokho', '...Okay. OKAY! That old E30 is fast. Respect, Sizwe.'],
          ['skhokho', 'My uncle owns three car washes in Umlazi. If you are serious about business, talk to me.'],
          ['sizwe', 'Funny. Everybody keeps saying business.'],
        ],
      },
    ],
  },

  // ========================= Chapter 3: Isisekelo =========================
  {
    id: 'c3m1',
    chapter: 'c3',
    title: 'Umlazi Wedding Run',
    icon: 'people',
    start: 'thoko',
    car: true,
    blurb: "Auntie Thoko's van died. Get her helper and the food to the wedding.",
    summary: "Sizwe saved Auntie Thoko's wedding job in Umlazi: her helper, the food and everyone at the hall, just in time.",
    reward: { money: 900, note: "Auntie Thoko's catering pay" },
    steps: [
      {
        do: 'scene',
        lines: [
          ['thoko', 'Sizwe! Skhokho says you are the driver with the red car. I am catering a wedding today and my van died!'],
          ['thoko', 'I need my helper Lindiwe and the food. Then the hall at Comtech High. We cannot be late. The bride\'s mother is scary.'],
          ['sizwe', 'Scarier than my mother?'],
          ['thoko', "Nobody is scarier than a bride's mother, baba."],
        ],
      },
      { do: 'reach', to: 'sukuma', mode: 'car', stop: true, pax: true, text: 'Pick up Lindiwe at the corner by Sukuma Primary' },
      { do: 'reach', to: 'kwamnyandu', mode: 'car', stop: true, cargo: 'food', text: 'Collect the food at KwaMnyandu Shopping Centre' },
      {
        do: 'reach',
        to: 'comtech',
        mode: 'car',
        stop: true,
        fragile: 3,
        cargo: 'food',
        time: { avg: 8.5, extra: 60 },
        text: 'Get everyone and the food to the wedding hall at Comtech High',
        chatter: [
          [0.3, 'thoko', 'Lindiwe, hold the pot! HOLD THE POT!'],
          [0.65, 'sizwe', 'Auntie, what is in the big pot?'],
          [0.8, 'thoko', 'Chicken, rice and chakalaka (spicy relish). Drive like it is your own wedding!'],
        ],
      },
      {
        do: 'scene',
        lines: [
          ['thoko', 'We made it! With minutes to spare! The bride\'s mother is smiling. I think.'],
          ['thoko', 'Here is your money. And take a plate. Nobody leaves my wedding hungry.'],
        ],
      },
    ],
  },
  {
    id: 'c3m2',
    chapter: 'c3',
    title: 'Taxi Shift',
    icon: 'taxi',
    start: 'bridgeRank',
    car: true,
    blurb: 'Baba Mthembu needs a driver for a week. Get your PrDP and load at the rank.',
    summary: "Sizwe got his PrDP and drove taxi shifts for Baba Mthembu. Passengers said he drives smooth. That's rare.",
    reward: { money: 500, note: 'Baba Mthembu: a bonus for smooth driving' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['mthembu', 'Sizwe. December needs money. My driver is sick this week.'],
          ['mthembu', 'Get your PrDP (driving permit for passengers) at a testing ground. Then load at a rank. The fares are yours.'],
          ['sizwe', 'Baba, I will drive like the K53 book is watching me.'],
        ],
      },
      { do: 'licence', need: 'prdp', text: 'Get your PrDP at a testing ground (R250)' },
      { do: 'earn', amount: 400, text: "Drive taxi fares: earn R400. Stop in a rank's yellow bay to load (tip: the Quantum carries 14)" },
      { do: 'scene', lines: [['mthembu', 'Good, good. Passengers say you drive nice and smooth. That is rare in this business.']] },
    ],
  },
  {
    id: 'c3m3',
    chapter: 'c3',
    title: 'Waters Break',
    icon: 'baby',
    start: 'maHouse',
    car: true,
    blurb: 'The baby is coming. NOW.',
    summary: 'Sizwe rushed Nomsa to Dr Pixley KaSeme Hospital. Their daughter Melokuhle ("what is good") was born at sunrise.',
    reward: { money: 1000, note: 'Gifts for the baby' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['ma', 'SIZWE! Woza (come)! Quickly!'],
          ['nomsa', "It's time. Sizwe, it's time!"],
          ['sizwe', "Now? It's early! Okay. Okay! Keys, bag, Nomsa. No wait, Nomsa first!"],
          ['ma', 'Drive fast but carefully. Pixley KaSeme Hospital. Hamba (go)!'],
        ],
      },
      {
        do: 'reach',
        to: 'pixley',
        mode: 'car',
        stop: true,
        fragile: 2,
        time: { avg: 9, extra: 45 },
        text: 'Rush Nomsa to Dr Pixley KaSeme Hospital: fast, but no crashes',
        chatter: [
          [0.2, 'nomsa', 'Breathe... breathe... why are YOU breathing like that?'],
          [0.5, 'sizwe', 'Solidarity!'],
          [0.8, 'nomsa', 'Just DRIVE, Sizwe!'],
        ],
      },
      {
        do: 'scene',
        lines: [
          ['nurse', 'Just in time. Wait here, baba.'],
          ['story', 'Hours pass. The sun comes up over KwaMashu.'],
          ['nurse', 'Congratulations. A healthy baby girl.'],
          ['nomsa', 'Meet your daughter, Sizwe. What do we call her?'],
          ['sizwe', "Melokuhle. It means 'what is good'. Because she is the good thing."],
          ['ma', 'My grandchild! Melokuhle! Hhayi bo (oh my), I am crying in public.'],
        ],
      },
    ],
  },
  {
    id: 'c3m4',
    chapter: 'c3',
    title: 'Wash & Go',
    icon: 'shop',
    start: 'tsepoWash',
    blurb: 'Buy the car wash spot next to Tsepo and open your own business.',
    summary: "Sizwe bought a car wash spot at Bridge City and opened Sizwe's Wash & Go: washes, deliveries and lifts. The family ate together at Ma's.",
    reward: { money: 500, note: 'Opening day gifts' },
    steps: [
      {
        do: 'scene',
        lines: [
          ['tsepo', 'Bra, the guy next to me is selling his car wash spot. Hoses, pump, a gazebo. R3,000.'],
          ['skhokho', 'My uncle will send you clients from Umlazi. You will be busy.'],
          ['zanele', 'And I made you a plan: washes in the morning, deliveries in the afternoon. A real business.'],
          ['sizwe', "Sizwe's Wash & Go. Washes, deliveries, lifts. I like it."],
        ],
      },
      { do: 'pay', amount: 3000, what: 'the car wash spot at Bridge City', text: 'Pay R3,000 for the car wash spot (earn more with deliveries or taxi work)' },
      {
        do: 'scene',
        lines: [
          ['tsepo', 'It is yours! And your first customer is already here. It is... Malume Bongz.'],
          ['bongz', 'Wash Ntombi properly. I want to see my face in that red paint.'],
          ['bongz', 'Then bring everybody home. Ma is cooking.'],
        ],
      },
      { do: 'reach', to: 'maHouse', mode: 'car', stop: true, text: 'Drive home. Ma is cooking for everyone' },
      {
        do: 'scene',
        lines: [
          ['ma', 'Look at this. My son. A businessman. A father. Woza (come), everyone, eat!'],
          ['nomsa', 'Melokuhle is asleep. Even she is proud of you.'],
          ['bongz', 'Ntombi chose well, mfana.'],
          ['sizwe', 'Ngiyabonga (thank you), everyone. This is just the start.'],
          ['story', 'THE END... for now. Your business is open. Keep working Durban: deliveries, taxi shifts and spin shows.'],
        ],
      },
    ],
  },
];

// every icon a mission or the journal uses (ui.js draws them)
export const ICONS = ['home', 'taxi', 'licence', 'wheel', 'car', 'box', 'heart', 'follow', 'spin', 'flag', 'people', 'baby', 'shop'];
