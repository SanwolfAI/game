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

Planned: garages and malls, the south extension to Umzinto, notable buildings, car sounds, buying cars with money from the wallet. Version 2 adds walking (wallet, health, hunger).

## Controls (keyboard)

| Key | Action |
|---|---|
| W / Up | Accelerate |
| S / Down | Brake |
| A D / Left Right | Steer |
| Shift | Boost |
| Space | Handbrake |
| C | Camera |
| H | Hooter |
| E or F | Get in / out |
| V | Change car |
| G / X | Set / clear GPS destination |
| R / N | Reverse / neutral |
| L | Lights |
| Q or comma, full stop | Left, right indicator |
| K | Hazards |
| M | Big map |
| U | Mute |

On the phone, use the on-screen controls.

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

The game earns ad revenue, so every asset is commercial-friendly: CC0, CC BY, CC BY-SA, public domain, or ODbL only. Map data © OpenStreetMap contributors (ODbL). Model credits are listed in the game's big map screen (`src/ui/bigmap.js`). No real brand logos are used.
