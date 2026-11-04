# Engine architecture

Next.js (App Router) + TypeScript, static export. The game engine is plain Three.js with no React imports; React only draws the UI around it. dirien/backrooms is a structural reference only (no license, no code copied).

## Layout

- `src/app/` — Next.js UI. `page.tsx` renders `GameLoader`, which loads `GameCanvas` client-side only (`ssr: false`), since the engine needs `window` and WebGL. `GameCanvas` mounts the engine and shows the menu/hint overlay.
- `src/engine/` — framework-free TypeScript. Today: `runtime.ts` (renderer, loop, first-person movement and look, test scene). Planned modules, mirroring the reference:
  - `input.ts` (keyboard, mouse, touch), `audio.ts`, `sanity.ts`, `lighting.ts` (baked plus flashlight with charge), `quality.ts` (presets, `?quality=`)
  - `levels/` (registry, lazy loading; the mall and the garage as separate levels)
  - `world/` (GLB loading, `three-mesh-bvh` collision, garage chunk generator)
  - `entities/` (shadow, girl in white, watchers, guard)
  - `save.ts` (versioned, tolerant of blocked storage)
- `src/strings/es-CR.ts` — all UI and in-world text, Costa Rican Spanish.
- `docs/floorplans/` — floor plans and the generator that will feed the blockout GLB.

## Commands

- `npm run dev` — dev server
- `npm run lint`, `npx tsc --noEmit` — checks
- `npm run build` — static export to `out/` (relative asset URLs, so it can sit in a subfolder)
