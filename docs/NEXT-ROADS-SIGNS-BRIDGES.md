# eThekwini Drive: next job (roads, signs, bridges)

Written 15 Nov 2026 for the next AI helper (ChatGPT/OpenCode). Read all of it before you change anything.

## 1. Where the game stands (commit ab28eaf on `main`)

- `main` now has everything: the steering wheel, pedals, gear selector and full map (from `feature/durban-vehicle-expansion`), plus the Sketchfab cars.
- **Work on `main` only.** Don't use the old feature branches; they're merged.
- Cars: `models/import/gusheshe.zip` (optimized E30, 54k triangles), `bmw-lowpoly.zip`, `hiace.zip`. CI unzips them into `src/assets/vehicles/`. Loader: `src/game/sketchfabModels.js`, which handles glossy paint, chrome, glass, spinning and steering wheels, and the environment reflections. **Don't rewrite it.**
- Minimap: roads are drawn as sharp vectors in `src/ui/minimap.js`.
- Touch layout: the `@media (pointer: coarse)` block at the end of the `<style>` in `index.html`. Keep the pedals, wheel, gear, HORN/RUN and the top buttons from overlapping. The phone is about 800 x 360 CSS px in landscape.

**All models, sign pictures and textures are already in the repo. See `src/assets/ASSETS-README.md` for where each file is.**

## 2. Rules

1. Make one feature per commit, and run `npm test` before every push. Each push to `main` builds the APK.
2. Keep each model under about 20k triangles, and the whole APK under about 60 MB. The test phone is a Hisense E32 Pro.
3. Use only CC0 or CC-BY assets. Credit every CC-BY author in the `#model-credits` panel in `index.html`.
4. Use no real brand logos. Sign text must be the real SA wording.
5. Never commit keys or tokens.

## 3. Tasks, in order

### A. The car must drive on bridges (bug, do this first)
`Vehicle.#place()` in `src/game/vehicle.js` uses `hf.heightAt()`, which is the ground height. On a bridge the car drops under the deck.

- In `RoadNetwork` (`src/world/roads.js`), add `deckHeightAt(x, z, prevY)`. It returns the bridge deck height when the car is on a bridge segment: the ground (minimum 1.2 m) plus `bridgeLiftAt` along the segment (6.5 m per layer, 36 m ramps). Otherwise it returns the ground height. Pick the layer closest to `prevY` so the car can drive under a bridge too.
- Use it in `#place()`, and in `traffic.js` for AI cars.

### B. Road markings (SARTSM Vol 1 Ch 7)

- There's already a yellow left edge line, and white centre dashes on major roads.
- In town, white lane lines are 3 m line and 6 m gap; on rural and freeway roads, 4 m line and 8 m gap. Use the OSM `lanes` tag, with 3.4 m lanes in town and 3.7 m on freeways.
- A solid white centre line marks no overtaking near junctions.
- At traffic signals, add a stop line, 300 mm white, across the approach lanes.
- Pedestrian crossings are two white lines 2.4 to 3 m apart, or zebra blocks where OSM says `crossing=zebra`.
- Red kerb means no stopping and yellow kerb means no parking. These are optional, for the CBD only.

### C. Road signs
Free SA sign drawings, the official SADC-RTSM designs:

- https://commons.wikimedia.org/wiki/Category:Diagrams_of_road_signs_of_South_Africa
- https://commons.wikimedia.org/wiki/Category:SVG_road_signs_in_South_Africa

Check each file's licence on its own page (most are public domain). Convert each SVG to a 256 px PNG (for example `rsvg-convert -w 256`) and save it in `src/assets/signs/`.

Where to place signs, using the OSM data in `scripts/fetch-osm.mjs` and `build-data.mjs`:

- `highway=stop` gets the R1 STOP sign.
- `highway=give_way` gets the R2 YIELD sign.
- `highway=traffic_signals` gets traffic lights ("robots"). Use the Kenney traffic light model, or build one: a black pole and a 3-lamp head with red, amber and green on a cycle.
- A `maxspeed` change gets the R201 speed limit disc (60 in town, 80 on M roads, 120 on N roads).
- `highway=motorway_junction` gets a green exit sign with the OSM `ref` (exit number) and `exit_to` or `destination`. N2, N3 and M4 names go on the blue (metro) or green (national) route signs.
- `railway=level_crossing` gets the W-series warning sign.

The sign mesh is a pole plus a thin box. The texture goes on the front and grey on the back. Use instancing (`THREE.InstancedMesh`) for poles, and only show signs within about 400 m of the player.

### D. Bridges and freeway props

- Bridges already have rails, posts and piers in `roads.js`. Swap the rails for Jersey barriers (grey concrete, about 0.8 m high) on motorways, M roads and N roads.
- Add street lights along major roads every 35 m, staggered both sides, as InstancedMesh.
- Add bridge pillars and barriers from the Kenney kit.

## 4. Free model and texture sources

- **Roads kit** (barriers, traffic lights, signs, light posts, bridge pillars, cones; 90 glTF models, CC0): https://kenney.nl/assets/city-kit-roads (mirror: https://opengameart.org/content/city-kit-roads)
- **Low-poly background cars** (CC0): https://quaternius.com/packs/cars.html
- **Asphalt, concrete and kerb textures** (CC0): https://polyhaven.com/textures/asphalt
- **More CC0 textures**: https://ambientcg.com/list?q=asphalt
- **SA road sign drawings** (mostly public domain; check each file): the Wikimedia links in section 3C
- **OSM sign tagging reference**: https://wiki.openstreetmap.org/wiki/Key:traffic_sign

Keep textures at 512 px or smaller (1024 px for asphalt), and use JPG or WebP to keep the APK small.

## 5. When you finish

Update this file's section 1 with what you changed, and push.
