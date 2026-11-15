# Assets for roads, signs and bridges (read this, ChatGPT)

Everything below is already in the repo and gets copied into the APK (the build copies all of `src/`).
You only write code. Do not download or add models yourself. Load files with relative paths like `./src/assets/...`, the same way `sketchfabModels.js` loads cars.

## 1. Kenney City Kit Roads, `src/assets/roadkit/` (CC0, no credit needed)
- 92 `.glb` models. They all share one texture, `roadkit/Textures/colormap.png`, so keep that folder next to them.
- See `roadkit/preview.png` for what they look like. Tiles are about 1 x 1 unit, so scale them to metres (try 8 to 10 for a road tile and check it in-game).
- Useful files:
  - Traffic lights ("robots"): `traffic-light.glb`, `traffic-light-hanging.glb`
  - Street lights: `light-curved.glb`, `light-curved-double.glb`, `light-square.glb`
  - Bridges: `road-bridge.glb`, `bridge-pillar.glb`, `bridge-pillar-wide.glb`
  - Barriers and roadworks: `construction-barrier.glb`, `construction-cone.glb`, `construction-fence.glb`, `road-straight-barrier.glb`
  - Sign posts (blank, put our SA sign texture on them): `road-sign-empty.glb`, `road-sign-empty-hanging.glb`
  - Highway gantry signs: `sign-highway.glb`, `sign-highway-wide.glb`, `sign-highway-detailed.glb`
  - Power poles: `electricity-pole.glb`, `electricity-wires.glb`
  - Road tiles (optional, our roads come from OSM): `road-straight.glb`, `road-crossroad.glb`, `road-roundabout.glb`, and others
- Do not use `road-sign-stop.glb` or `road-sign-warning.glb` as they are, because they are not SA designs. Use the blank posts with the textures in section 2.
- Use `THREE.InstancedMesh` for anything placed more than about 20 times (lights, poles, barriers).

## 2. SA road signs, `src/assets/signs/` (public domain, from Wikimedia SADC-RTSM drawings)
- 256 px PNGs with see-through backgrounds. `signs/signs.json` lists each code, file, meaning and source page.
- R1 `r1.png` STOP (put it at OSM `highway=stop`)
- R2 `r2.png` Yield (OSM `highway=give_way`)
- R201 speed limits: `r201-40.png`, `r201-60.png`, `r201-80.png`, `r201-100.png`, `r201-120.png` (where OSM `maxspeed` changes)
- R213 `r213.png` No U-turn, R216 `r216.png` No parking
- W301 `w301.png` Traffic signals ahead (about 80 m before OSM `highway=traffic_signals`)
- W302 `w302.png` Stop ahead, W303 `w303.png` Yield ahead
- W306 `w306.png` Pedestrian crossing ahead, W307 `w307.png` Pedestrians, W308 `w308.png` Children, W309 `w309.png` Cyclists
- W401 `w401.png` Hazard chevron (outside of sharp bends and at bridge ends)
- SA drives on the left, so signs stand on the left side of the road, facing oncoming traffic.

## 3. Road and pavement textures, `src/assets/textures/` (CC0, Poly Haven)
- `asphalt_02_diff_1k.jpg` with normal map `asphalt_02_nor_gl_1k.jpg` for road surfaces
- `concrete_pavement_diff_1k.jpg` with normal map `concrete_pavement_nor_gl_1k.jpg` for pavements, kerbs and bridge decks
- Set `texture.wrapS = texture.wrapT = THREE.RepeatWrapping` and repeat about every 4 m along the road. Use `colorSpace = THREE.SRGBColorSpace` on the colour maps only.

## 4. Sketchfab "Low road", `src/assets/roads/low-road/` (CC BY 4.0, credit needed)
- `scene.gltf` with `scene.bin` and `textures/`. It's a detailed road piece, about 8 MB, so use it only for one showcase spot or as a reference. Don't tile it across the city.
- Add this credit to the `#model-credits` panel in `index.html`: "Low road" by Yarelon, https://sketchfab.com/3d-models/low-road-e353f90e42b542689bade5e3f714f710, CC BY 4.0.

## Order of work
Follow `docs/NEXT-ROADS-SIGNS-BRIDGES.md`. Do task A, the bridge deck height, first. Then do markings, then signs from this folder, then props from `roadkit/`.
Run `npm test` before each push, and keep one feature per commit.

## 5. Loaders and water (added 15 Nov 2026)
- GLTFLoader for three r169: `vendor/three/loaders/GLTFLoader.js`. It's offline, and its helper import points to `vendor/three/BufferGeometryUtils.js`. Import it with `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';` (the import map already maps `three/addons/` to `./vendor/three/`).
- Ocean: `vendor/three/objects/Water.js` (three r169, MIT) with `src/assets/textures/waternormals.jpg`. Import it with `import { Water } from 'three/addons/objects/Water.js';`. Use it for the Indian Ocean east of the beachfront and for the harbour basin.
- Railway sign: `signs/w318.png`, W318 "Railway crossing ahead", public domain, https://commons.wikimedia.org/wiki/File:SADC_road_sign_W318.svg. Place it about 100 to 150 m before OSM `railway=level_crossing`, on the left side.

## 6. Trains, harbour and industry (Kenney, CC0)
- `trainkit/`: locomotives (`train-diesel-*`, `train-locomotive-*`), Metrorail-style electric sets (`train-electric-city-*`), container wagons (`train-carriage-container-*`), tank and box wagons, and track pieces (`track*.glb`, `railroad-*.glb`). Run trains along OSM `railway=rail` lines.
- `harbourkit/`: container ships (`ship-cargo-a/b/c`), tugboats (`boat-tug-*`), the ocean liner (`ship-ocean-liner*`), containers (`cargo-container-*`, `cargo-pile-*`), buoys, small boats and the rest. Put these in the Port of Durban basin (OSM `harbour`/`landuse=port`, at the Point and the Bluff).
- `industrialkit/`: shipping containers (`shipping-container-a/b/c`), tanks, chimneys, warehouses (`building-a` to `building-t`) and water towers. Use them for the container terminal stacks and the industrial areas in the south.
- Every Kenney kit keeps its own `Textures/` folder next to the GLBs, so keep the folder there.

## 7. Freeway rules: match the real map, not guesses
Everything you place must match real Durban as it is today (current OSM data and real layout). Don't invent anything.
- **Median type**: read it from OSM. Where a freeway is drawn as two one-way carriageways (`oneway=yes`, separate ways), measure the gap between them:
  - Gap under about 3 m: concrete Jersey barrier in the middle. Use `roadkit/road-straight-barrier.glb` or `construction-barrier.glb`, or build a 0.8 m grey wedge.
  - Gap of about 3 m or more: grass median. Use a green ground strip, with a guard rail on both edges if the gap is under 10 m.
  - If OSM has a `barrier=*` way between them (`jersey_barrier`, `guard_rail`), use that.
- **Pillars in the middle**: only where a bridge (`bridge=yes`) crosses over a road. Put `roadkit/bridge-pillar.glb` / `bridge-pillar-wide.glb` in the median or the gap under the deck, spaced about 25 to 35 m.
- **Guard rails**: on freeway edges where OSM has `barrier=guard_rail`, on bridge edges, on embankments, and on the outside of sharp bends. Use the barrier models in `roadkit/` (`road-*-barrier.glb`) or a simple steel W-beam mesh (grey, about 0.75 m high, posts every 2 m). Use InstancedMesh.
- **Pedestrian bridges**: use OSM `highway=footway` + `bridge=yes`. Draw them as a narrow deck about 3 m wide with railings, at deck height, and never let cars drive on them.
- Trains only run on real OSM railway lines, ships only sit in the real harbour water, and water only shows where OSM has `natural=water`, coastline or the harbour.

## 8. Real terrain, vegetation and ground (added 15 Nov 2026)
**Elevation (real DEM)**: `src/assets/terrain/durban-dem-terrarium-z12.png` with `durban-dem.json`.
- It covers west 30.674 to east 31.201, north -29.612 to south -30.069. That's the whole map, from Inchanga to the coast and from Umhlanga to Amanzimtoti.
- It's 1536 x 1536 px, Web Mercator zoom 12, about 33 m per pixel. Decode each pixel with: `height_m = R*256 + G + B/256 - 32768`. Load it into a canvas, read the pixels with `getImageData`, convert lon/lat to pixel, and sample it bilinearly.
- Source: AWS Terrain Tiles (Mapzen), which mostly use SRTM. Add the credit "Terrain: Mapzen / AWS Terrain Tiles (SRTM, NASA)" to the credits panel. See https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- `src/world/heightfield.js` uses made-up Gaussian hills (the HILLS and FLATS lists). Replace those with this DEM, and keep the water and wall logic.
- **Roads must win**: after sampling, flatten the terrain under each road corridor (road width plus 3 m shoulders) to a smoothed road profile. Cut or fill the ground so roads never sink or float. Don't let the ground go above bridge decks or tunnels.
- The DEM includes some building and tree height noise in the CBD. Smooth it with a small blur, and clamp the sea to 0 m.

**Trees, bushes, grass, rocks**: `src/assets/naturekit/` (Kenney Nature Kit 2.1, CC0, about 130 GLBs, no textures needed). See `naturekit/preview.png`.
- KZN coastal look: palms (`tree_palm*.glb`) along the beachfront and Umhlanga; flat-top acacia/thorn (`tree_plateau*.glb`); broad bush trees (`tree_default`, `tree_fat`, `tree_oak`, `tree_detailed`, `tree_simple`, `tree_small`, `tree_tall`, `tree_thin`, and their `_dark` variants).
- Bush and coastal scrub: `plant_bush*.glb`, `plant_flat*.glb`. Grass tufts: `grass*.glb`. Flowers: `flower_*.glb`.
- Sugarcane fields (north, around Verulam and Tongaat, and inland): use `crops_cornStageC/D.glb` scaled about 2 m tall, in dense rows, only on OSM `landuse=farmland`. `crops_bambooStageB.glb` is an alternative.
- Rocks and stones: `rock_*.glb`, `stone_*.glb`, `cliff_block*.glb` if present. Logs and stumps: `log*.glb`, `stump_old*.glb`.

**Ground textures** (512 px JPG, CC0 Poly Haven, mobile-friendly) in `src/assets/textures/`:
- `sparse_grass_512.jpg` for parks and verges, `aerial_grass_rock_512.jpg` for hillsides, `dry_ground_01_512.jpg` for dry veld and dirt, `brown_mud_512.jpg` for soil and farm edges, `rocky_terrain_02_512.jpg` for steep slopes (blend in above about 25 degrees), and `coast_sand_01_512.jpg` for beaches.

**Placement rules (must match the real map)**:
- Use the OSM `landuse`/`natural`/`leisure` polygons already in `durban-game.json`. Dense trees go in `natural=wood`, `landuse=forest`, `leisure=park`, `natural=scrub` and nature reserves. Scattered trees go in residential gardens (back of plots only). Cane goes in farmland. Use none in `landuse=industrial/commercial/retail`, in the port, or on beaches (palms only at the beach edge).
- Never place vegetation within road width plus 2 m of any road or footway, on junctions, in building footprints, on driveways, on rail lines or in water. Test every point against the road and building data before you place it.
- Use seeded random (a fixed seed), so trees stay in the same place every time you play.
- Performance: one `InstancedMesh` per model type, only draw within about 600 m (grass tufts within 120 m), and keep it to roughly 15 tree types at most.
