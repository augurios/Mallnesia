# Engine architecture

Next.js (App Router) + TypeScript, static export. The game engine is plain Three.js with no React imports; React only draws the UI around it. dirien/backrooms is a structural reference only (no license, no code copied).

## Layout

- `src/app/` — Next.js UI. `page.tsx` renders `GameLoader`, which loads `GameCanvas` client-side only (`ssr: false`), since the engine needs `window` and WebGL. `GameCanvas` mounts the engine and shows the menu/hint overlay.
- `src/engine/` — framework-free TypeScript. Today: `runtime.ts` (renderer, loop, first-person look, input, doors, audio) and `props.ts` (kit pieces placed through the mall: one `InstancedMesh` per piece per floor, plus a collider per instance) and `walk.ts` (collision and ground-following, with no rendering and no DOM, so `scripts/test-walk.mts` runs the exact code the game runs). The player is pushed out of walls horizontally by a `three-mesh-bvh` sphere test; its height follows the ground via a downward ray against the floor and stair meshes (step up 0.5 m, otherwise gravity); the floor index is derived from that height. Colliders and ground are picked by material name, not node name: the loader makes node names unique for chunks (`walls`, `walls_1`, ...). Planned modules, mirroring the reference:
  - `input.ts` (keyboard, mouse, touch), `audio.ts`, `sanity.ts`, `lighting.ts` (baked plus flashlight with charge), `quality.ts` (presets, `?quality=`)
  - `levels/` (registry, lazy loading; the mall and the garage as separate levels)
  - `world/` (GLB loading, `three-mesh-bvh` collision, garage chunk generator)
  - `entities/` (shadow, girl in white, watchers, guard)
  - `save.ts` (versioned, tolerant of blocked storage)
- Look (see `docs/art_style_reference.md`, "How the base project gets its look"): `materials.ts` adds procedural surface detail to the blockout's materials in world space (porcelain tiles with granite inserts and glossy grout, plaster with skirting and corner darkening, ceiling panels, stained concrete), keyed by the material names in `scripts/blockout/palette.mts`. `post.ts` is the finishing pass (bloom, film grain, vignette, color drain) on top of ACES tone mapping and a hemisphere sky-glow light. Quality presets switch detail, bloom and film individually; low renders straight to the screen. Debug: `?ambient=`, `?exposure=`, `?hud=off`.
- `src/strings/es-CR.ts` — all UI and in-world text, Costa Rican Spanish.
- `scripts/build-blockout.mts` — the blockout generator; a short orchestrator over `scripts/blockout/`, split by what a part is: `config` (constants, cell classes, plan types), `grid` (plans, rasterizing, cell lookups), `geo` (geometry accumulator and primitives: slabs, prisms, lathes, sweeps, tubes, rocks, boxes), `walls` (edge runs merged into wall quads), `shell` (floors, ceilings, walls, roof), `towers` (stair towers, gardens, elevator piers), `doors` (secret-hallway doors), `palette` (materials), `check` (spawn check, `BLOCKOUT_DEBUG` reachability image), `write` (chunking, meshopt, GLB). The order the orchestrator calls them in is the order of the triangles in the file. Scripts run directly with Node's type stripping: relative imports end in `.mts`, types are imported with `import { type X }`, and no enums or constructor parameter properties.
- `scripts/build-props.mts` and `scripts/kit/` — the kit pieces and where they stand (see "Kit pieces and placement" below).
- `docs/floorplans/` — floor plans and the data the blockout is built from: the plans, `secret_doors.json`, `towers.json` (the open stair towers), `props.json` (where kit pieces stand).

## Commands

- `npm run dev` — dev server
- `npm run lint`, `npx tsc --noEmit` — checks
- `npm run build` — static export to `out/` (relative asset URLs, so it can sit in a subfolder)
- `npm run blockout` — regenerates `public/models/mall_blockout.glb` from the floor plans
- `npm run props` — regenerates the kit piece files (`public/models/kit/`) and `public/models/props.json` from `docs/floorplans/props.json`
- `npm run assets` — both of the above; run it after changing plans, towers, doors or props
- `npm run test:walk` — rebuilds the assets (`npm run assets`), then walks a simulated player through it with the game's own collision: the three stair sets climb from floor 1 to 3, the sealed set's gate holds, no atrium edge or solid block can be walked through (about 8,000 attempts, a few seconds), and every placed prop stops the player from all four sides. Run it after any change to the builder or `walk.ts`. With the old chunk-name bug it reports hundreds of failures.
- `npm run shots` — after `npm run build`, screenshots six fixed views into `shots/` (gitignored) with headless Chrome and software rendering; edit the `VIEWS` list in `scripts/shots.mts` to add views. For checking looks by eye, not a pixel comparison.

## Optimization plan (running name)

Order: (1) chunk and compress the blockout, (2) split the builder into modules and add automated walk/screenshot checks, (3) kit pieces and placement JSON, (4) exterior panorama and baked vertex AO, (5) area streaming. Layers: shell, collision, kit pieces, area decoration, hero areas, garage. Split by what a part is, not by floor.

**Step 1 (done): chunks and compression.** `scripts/blockout/write.mts` cuts each material's geometry into chunks (storey x 48 m square, `CHUNK_SIZE` env to try other sizes; triangle goes to the chunk holding its centroid), so three.js frustum culling can skip them. About 270 chunks. Every chunk node keeps the material name, because the material name identifies what a chunk is. The GLB is written with `EXT_meshopt_compression` (3.5 MB to about 1 MB). Positions stay plain float32 on purpose: the collision BVH is built from them. Normals are quantized, and the runtime drops them for collision anyway. `GLTFLoader` needs `MeshoptDecoder` (set in `runtime.ts`).

**Step 2 (done): builder modules and automated checks.** The 1,200-line builder is split into the modules listed under Layout, with byte-identical output (checked by hashing the GLB before and after). Collision and ground-following moved out of `runtime.ts` into `walk.ts` so the game and the test share one implementation. `npm run test:walk` and `npm run shots` are the two checks. Still to do for this step: move the `TOWERS` list and other per-tower settings into JSON next to the floor plans, and set up Git LFS (`.gitattributes`) for photos and hand-made models; the generated GLB could then be gitignored and built before `next build`.

## Kit pieces and placement

For things that repeat (tables and chairs now; benches, bins, shop fronts, elevator cars, garage chunks later). Three parts, each with one place to edit:

- **The piece** (`scripts/kit/pieces.mts`): a function that builds one piece around its own origin (x and z centred, y = 0 on the floor) as geometry per material, plus a collision box and a clearance radius. `npm run props` writes each to `public/models/kit/<name>.glb`: one node per material, and a node called `collider` with the invisible `barrier` material. **A hand-modelled file with the same layout can replace a generated one without touching anything else.** The collider box has to reach chest height (the player's collision sphere sits at 1.0 m), so a table's box is 1.3 m tall even though the top is at 0.75.
- **Where they stand** (`docs/floorplans/props.json`, hand-edited): `scatter` rules fill an area (a plan polygon such as `south_area`, or a box) on a grid with jitter, a turn limit, a skip chance, a required aisle and a seed; `place` puts one piece at one spot. `scripts/build-props.mts` checks every instance against the floor grid (clear floor all around, with the aisle, no stair zone, 3 m from any secret door) and drops the ones that fail, printing how many and why. The random numbers are drawn for every grid spot whether or not it is placed, so changing one rule never reshuffles the others.
- **In the game** (`public/models/props.json`, generated): per piece, flat `[x, y, z, yaw]` groups. `props.ts` loads each piece once, draws it with one `InstancedMesh` per floor, and builds each instance's collider as plain positions in world space (not a clone, so how a file stores its vertices cannot break the merge into the collision BVH). A missing or broken props file does not stop the mall from loading.

Pieces are not styled by `materials.ts` yet: they use their plain palette colors (`laminate`, `plastic`, `steel`, `chair_leg`).

`scripts/blockout/paint.mts` (`paintGrid`) is the one list of steps that change the floor grid after the plans are rasterized (stair zones, the bridge arc). The builder, the props builder and the walk test all call it. A new painting step goes there, never in a caller, or the three will disagree about the mall.

**Step 3 (done, first pass): kit pieces and placement.** Done for one piece, the food court table set (38 on floors 2 and 3). Also done: the tower list moved to `docs/floorplans/towers.json`. Not done: Git LFS (`.gitattributes`) for photos and hand-made models, and making `public/models/*.glb` build artifacts that are not committed. Both change what gets committed, so they are Augusto's call. Next kit candidates: bins, benches, restaurant shop fronts, the elevator car.
