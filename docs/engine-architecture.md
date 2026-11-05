# Engine architecture

Next.js (App Router) + TypeScript, static export. The game engine is plain Three.js with no React imports; React only draws the UI around it. dirien/backrooms is a structural reference only (no license, no code copied).

## Layout

- `src/app/` — Next.js UI. `page.tsx` renders `GameLoader`, which loads `GameCanvas` client-side only (`ssr: false`), since the engine needs `window` and WebGL. `GameCanvas` mounts the engine and shows the menu/hint overlay.
- `src/engine/` — framework-free TypeScript. Today: `runtime.ts` (renderer, loop, first-person movement and look, test scene). The player's height follows the ground: a downward ray against the floor and stair meshes (step up 0.5 m, otherwise gravity), and the floor index is derived from that height. Planned modules, mirroring the reference:
  - `input.ts` (keyboard, mouse, touch), `audio.ts`, `sanity.ts`, `lighting.ts` (baked plus flashlight with charge), `quality.ts` (presets, `?quality=`)
  - `levels/` (registry, lazy loading; the mall and the garage as separate levels)
  - `world/` (GLB loading, `three-mesh-bvh` collision, garage chunk generator)
  - `entities/` (shadow, girl in white, watchers, guard)
  - `save.ts` (versioned, tolerant of blocked storage)
- Look (see `docs/art_style_reference.md`, "How the base project gets its look"): `materials.ts` adds procedural surface detail to the blockout's materials in world space (porcelain tiles with granite inserts and glossy grout, plaster with skirting and corner darkening, ceiling panels, stained concrete), keyed by the material names in `scripts/build-blockout.mts`. `post.ts` is the finishing pass (bloom, film grain, vignette, color drain) on top of ACES tone mapping and a hemisphere sky-glow light. Quality presets switch detail, bloom and film individually; low renders straight to the screen. Debug: `?ambient=`, `?exposure=`, `?hud=off`.
- `src/strings/es-CR.ts` — all UI and in-world text, Costa Rican Spanish.
- `docs/floorplans/` — floor plans and the generator that will feed the blockout GLB.

## Commands

- `npm run dev` — dev server
- `npm run lint`, `npx tsc --noEmit` — checks
- `npm run build` — static export to `out/` (relative asset URLs, so it can sit in a subfolder)
