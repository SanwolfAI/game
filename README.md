# Izinja zase Kasi (IZK): Durban

A 3D driving game set in real Durban, built from open map data (OpenStreetMap, ODbL) and running in the browser and as an Android APK.

- Play in the browser: https://sanwolfai.github.io/game/
- Android APK (rebuilt on every push to main): https://github.com/SanwolfAI/game/releases/download/apk-latest/eThekwini-Drive.apk

## The game

Version 1 is driving only. You drive real Durban streets, from the CBD and beachfront out to Umlazi, Pinetown, Hillcrest, KwaMashu, Inanda, Phoenix, Verulam, Umhlanga, La Mercy and south to Winklespruit. The world is generated from map data, so the APK stays small (about 16 MB).

What's in the world:

- Real roads with their names, avenue streets on urban residential streets, and the raised median island with street lights on Umgeni Road.
- Buildings from OSM footprints, hospitals (ward blocks, clinics, EMERGENCY canopies), 464 schools (named boards, learners on school days, scholar transport), 13 SAPS police stations (face-brick, razor-wire palisade, vans), spaza shops, the harbour, trains, beaches.
- Day and night, with weather that's random but follows the season.
- Traffic, pedestrians, police, and taxi ranks you can work from.

## How a game starts (latest, 19 Nov 2026)

1. **R25,000 and a house.** A new player starts with R25,000 and first picks a cheap township home: Inanda Newtown (R12,000), Ntuzuma G (R13,500), KwaMashu K Section (R17,500), Umlazi V Section (R18,000), Lamontville (R19,500), Phoenix Westham (R20,000) or Chatsworth Unit 3 (R21,000). You spawn at your front door and the rest of the money is for driving school.
2. **Driving school before any driving.** You start on foot. Every township mall has a driving school (Siyaqhuba at Midway Crossing, Phakama at KwaMnyandu, Sharp Sharp at Phoenix Plaza, Hamba Kahle at Woodview and more), plus Bho's Driving Academy on Queen Nandi Drive, KwaMashu. Learner's licence R110: the full K53 test, 64 questions in three sections (vehicle controls 8, pass 6; road signs, signals and markings 28, pass 23; rules of the road 28, pass 22), and you must pass every section (fail = write again after 2 game days). Lessons R300 in the K53 yard, driving test R450 at the nearest testing ground (Umbilo Motor Licensing or Amanzimtoti). Fail and you come back after 2 game days. PrDP R250 for taxi work.
3. **Driver's seat only for lessons and tests.** The camera locks to the inside view: a proper car interior (dash, console, gear lever, doors, seats, roof) with rear-view and wing mirrors. Drag a mirror to aim it, double-tap to reset.
4. **You can buy a car without a licence, but you can't drive it** until you pass.
5. **Work for a boss, then be the boss.** Drive a boss's Quantum with a daily target of R700 to R1,000; anything above it is yours. Save for your own Quantum (R150,000 plus R30,000 association fee), become an owner, then grow a fleet (R220,000 per taxi, up to 20) with drivers paid every evening.

On foot (20 Nov): a left-thumb joystick (light push walks, full push jogs), a RUN button to sprint with a stamina bar, and one ACTION button that changes with what is nearby (Enter car, Start lesson, Talk, Pay, Board taxi). The steering wheel and pedals only show in a car. Popups sit on top, pause your controls while open, and their buttons are big enough to tap.

Other recent changes: traffic cars' wheels roll, all cars have mirrors, the K53 yard sits on a flat pad.

## Still to come

In progress now:

- **Real people.** Replacing the round-face pedestrians and player with real human models (Quaternius, CC0) that walk, idle, run and wave, with skin tones from Durban's mix and random clothes.
- **Real traffic driving.** Cars steer through turns instead of sliding sideways; they overtake you if you stop with hazards or an indicator on, and rear-end you if you don't. Crashes call the cops.
- **Damage and the mechanic.** Dents build up, a damaged car loses speed and power, and a mechanic fixes it for a fee.
- **Hit-and-run and your record.** Drive off from an accident and the cops keep searching until they find you; when they catch you, every past fault counts toward the fine and licence points, and too many points suspends your licence.

Next, in order:

1. **Start page:** username, boy or girl, pick a character, a Houses tab (buy and see your homes), a Garage tab (your cars, paint, rims, lowering, engine), then Start.
2. **Jobs without a licence** to pay for driving school: car guard at the malls, car wash at the ranks, taxi rank marshal, street vendor at the robots.
3. Garages (canopy, pumps, shop, attendants, brand colours without logos) and malls (Gateway, Pavilion, Musgrave).
4. Road taxis that follow the same routes as their rank.
5. The south extension to Umzinto and Malangeni.
6. Hospital hero builds (Addington, then KZN Children's), notable buildings with balconies (City Hall, Greyville, ICC, Suncoast, beachfront hotels).
7. Car sounds, and car unlocks paid from the wallet.
8. Sibhudu Cave with the Tongaat map extension.

Version 2 adds on-foot careers (nurse, doctor, security, cop), health and hunger.

## Controls (keyboard)

| Key | Action |
|---|---|
| W / Up | Accelerate |
| S / Down | Brake |
| A D / Left Right | Steer |
| Shift | Boost (on foot: sprint) |
| Space | Handbrake |
| C | Camera |
| H | Hooter |
| E or F | Get in / out; on foot, the nearby action (start lesson, enter car...) |
| V | Change car |
| G / X | Set / clear GPS destination |
| R / N | Reverse / neutral |
| L | Lights |
| Q or comma, full stop | Left, right indicator |
| K | Hazards |
| M | Big map |
| U | Mute |

On foot, W jogs, Shift+W sprints, A/D turn. On the phone, use the on-screen controls.

## Taxi ranks: how to work a taxi

1. Drive to a taxi rank. The rank has a yellow loading bay, a TAXI RANK shelter and people queueing. When you pull in, a message shows that rank's routes.
2. Stop in the yellow bay. You join the queue ("In the queue: 2 taxis ahead of you") and wait for your turn.
3. When it's your turn, passengers load for the next route on that rank's list. Ranks take their routes in turn, one load at a time. A Quantum carries 14 passengers; any other car carries 3.
4. Follow the GPS. You're paid in rand into the wallet as passengers get off.
5. Leave the taxi and the passengers get out, and the trip is cancelled.

Fare per passenger: R10 plus R1.10 per km (straight-line distance between rank and destination), never less than R15 or more than R35. Finish faster than the estimate and passengers tip.

The wallet is saved on the phone. Car purchases from the wallet are still to come.

### Two kinds of route

Rank to rank (destination is another rank, for example Durban to Umzinto). You load at the rank, drive straight to the other rank, and everyone gets off there. No pick-ups on the road.

Township routes (destination is a township or suburb, for example Durban to Amaoti, Inanda or KwaMashu):

1. Load at the city rank.
2. Drive out and drop stop to stop in the township (three drops). People going to town get on at some of the drops.
3. Two roadside pick-ups in the township, where people wait to go to town, if there are free seats.
4. Drive back to the same rank. On north-corridor routes (Amaoti, Inanda, KwaMashu, Phoenix, Verulam and others north of Durban), some people get off before the rank at Red Hill shelter, Mabhida and Home Affairs on Umgeni Road.
5. Everyone left gets off at the rank. Then queue again for your next turn.

### Ranks and their routes

Each CBD rank holds its own 5 to 7 routes; no rank does everything.

| Rank | Routes (in turn) |
|---|---|
| Soldiers Way | Inanda, Amaoti, Ntuzuma, Phoenix, KwaMashu, Newlands, Verulam |
| Centenary (ML Sultan Rd, the Inanda rank) | Inanda, Amaoti, KwaMashu, Ntuzuma, Bridge City rank |
| Durban Station Taxi Rank 1 | Umhlanga Rocks, Durban North, Phoenix, Verulam, La Mercy rank, Brookdale rank |
| Durban Station Taxi Rank 2 | Sydenham, Overport, Sea Cow Lake, Greenwood Park, Avoca, Newlands |
| Durban Central (Market, Warwick) | Umlazi, Chatsworth, KwaMashu, Pinetown rank, Cato Manor, Chesterville |
| No. 1 (Berea side) | Berea, Glenwood, Mayville, Umbilo, Wentworth, Bluff |
| Taxi to Pinetown, Minibuses to PMB | Pinetown rank, Westville, Clermont, KwaDabeka, Kloof, Hillcrest rank |
| South Beach | Umlazi, Isipingo, Lamontville, Amanzimtoti, Winklespruit rank |
| Pinetown | Westmead, KwaMashu, Durban Central rank, Clermont, New Germany, Kloof, Hillcrest rank |
| Hillcrest | Pinetown rank, Kloof, Westmead, Durban Central rank |
| Bridge City, Redfern | KwaMashu, Inanda, Ntuzuma, Phoenix, Centenary rank, Umhlanga Rocks |
| Brookdale | Phoenix, Bridge City rank, Durban Station rank 1, Verulam, Inanda |
| La Lucia, Somerset Park | Umhlanga Rocks, Durban Station rank 1, Phoenix, Bridge City rank, Durban North |
| La Mercy | Verulam, Umhlanga Rocks, Durban Station rank 1, Phoenix |
| Winklespruit | Amanzimtoti, Isipingo, Umlazi, South Beach rank |
| Any other rank | Runs to the nearest CBD rank |

Destinations ending in "rank" are rank-to-rank routes. The rest are township routes.

Sources: East Coast Radio (Soldiers Way serves Inanda, Ntuzuma, Phoenix), IOL (the Inanda rank on ML Sultan Rd), Taxis To Anywhere rank pages (Pinetown, KwaMashu, Durban Central Market), the ShiftMate Durban CBD taxi guide, SABC's day with a Cato Manor driver, and local knowledge from Bheko (route types and the stops before the rank). Where a source names a corridor but not a rank, the nearest OSM rank on that corridor carries it. Rank positions come from OpenStreetMap (amenity=taxi).

The routes live in the `ROUTES` table at the top of `src/game/fares.js`; the stops before the rank are in `NORTH_CITY_STOPS`. To add a route, add the destination name (a rank name or a suburb name from the map) to that rank's list.

Coming next: AI taxis on the road follow these same routes, and Umzinto, Malangeni and the south coast ranks once the map extends south.

## Buses

Every OSM bus station and depot is in the game (25 sites): city bus stations and depots like Alice Street Bus Depot, Warwick Avenue, Pinetown, Malandela and the rest get a canopy, a platform, a name board and city buses at the bays. Durban Station Coach Terminal (Masabalala Yengwa Ave), where long-distance coaches leave for Johannesburg, Pretoria, Cape Town, Bloemfontein, Gqeberha, East London and Mthatha, gets a long canopy, coaches nose-in at the bays and DEPARTURES boards. The south-coast coach stops get a shelter and sign. Liveries are plain colours with no operator names or logos.

## Running it yourself

```bash
npm install
npm test        # syntax check, import paths
npm start       # local server, then open the address it prints
```

Test hooks in the URL: `?time=7.2` sets the hour, `?wx=clear` sets the weather, `?safe=1` starts in safe mode (lighter scene, used after a crash).

## Licences and credits

The game earns ad revenue, so every asset is commercial-friendly: CC0, CC BY, CC BY-SA, public domain, or ODbL only. Map data © OpenStreetMap contributors (ODbL). Street imagery attributes derived from Mapillary (CC BY-SA): house wall colours, roofs and fences per area (`src/data/durban-house-styles.json`, no photos stored). Model credits are listed in the game's big map screen (`src/ui/bigmap.js`). No real brand logos are used.
