# CLAUDE.md — El Mall Vivo (working title)

## Project overview

A first-person, browser-based horror game inspired by *Amnesia: The Dark Descent*: no combat, vulnerability, darkness, a sanity system, and environmental storytelling. The setting is a hand-built recreation of an old shopping mall in Costa Rica, based on the urban legends that surround it, plus a procedurally generated parking garage where the player gets lost.

### Real-world reference

- **Place:** Mall San Pedro, San Pedro, Montes de Oca, San José, Costa Rica. Opened in 1995; known for its confusing architecture, multi-level parking garage, food court, and the local legends compiled in the legends reference.
- **Use:** the real mall is the reference for layout, architecture, materials, signage, and atmosphere. Reference photos are in `reference/photos/`; spatial accuracy to the real building matters for the hand-built areas.
- **In-game name:** a lightly fictionalized name that locals will recognize as Mall San Pedro (final name undecided). Do not use the real name in game content until Augusto decides otherwise, since the game links a real, operating business to crimes and hauntings.

- **Release:** free, on the web (itch.io or similar).
- **Platforms:** desktop browsers first; mobile touch support where practical.
- **Owner:** Augusto. He makes all creative decisions; propose, don't decide.

## Key documents

- `docs/El_Mall_Vivo_Design_Doc.pdf` — **legends reference.** 17 selected legends, each with what the legend says, the game mechanic it becomes, its area, and its priority (Vertical slice / Core / Later). This is the source of truth for game content. Read it before designing any area, threat, note, or mechanic.
- `docs/base-project-claude.md` — the original CLAUDE.md from the base project (commands, code conventions, module notes). Keep following its technical conventions unless this file overrides them.

## Central premise

**The mall is alive.** It has absorbed so much tragedy that it became a living thing: it changes the number of floors, moves its exits, and shows each visitor something different. This is the game's true antagonist and the justification for every unusual mechanic (shifting layout, wrong-floor elevators, the unreachable exit, the procedural garage). Every other threat is one of its manifestations. Keep new content consistent with this premise.

Backstory (revealed gradually through notes): the land was a coffee plantation, construction began without permits, a worker died during construction, and rumors say bodies lie beneath the foundations.

## Tech stack and base project

- **Base:** [dirien/backrooms](https://github.com/dirien/backrooms) — Three.js + Vite browser horror game. Chosen after testing three candidates for stability and code quality.
- **Planned additions:** levels modeled in Blender and loaded as glTF/GLB; mesh collision with `three-mesh-bvh`; KTX2/Basis texture compression.

### Module plan (relative to the base project)

| Action | Modules |
|---|---|
| Keep | Sanity system and effects, audio pipeline (`audio.js`), input and mobile controls (`input.js`), HUD, quality presets, shaders and fade transitions, lint and profiling setup |
| Adapt | `world.js` → parking-garage chunk generator. `entity.js` → the shadow, the girl in white, the watchers. `levels.js` → mall areas plus the garage as its own level |
| Add | Hand-built mall from GLB, mesh collision, physics drag-to-open doors and drawers, hiding spots, inventory, readable notes, flashlight with limited batteries, security camera room, save/load |

## Game mechanics

- **No combat.** Threats are avoided, hidden from, or endured. Never add weapons the player can use.
- **Sanity:** drained by darkness, apparitions, and the watchers. Low sanity increases hallucinations and makes the mall shift more (e.g., more wrong-floor elevator results).
- **Light:** a flashlight with limited batteries (equivalent of Amnesia's lantern oil).
- **Interaction:** physics doors and drawers dragged with the mouse (touch drag on mobile), hiding spots (including abandoned cars), inventory, readable notes.
- **Security room:** monitors the player can use to scout other areas; the shadow can appear on the feeds.

## Areas and the procedural garage

- **Hand-built areas** carry the place's identity: food court (first area), abandoned gym, gray service corridors (shortcuts and stealth network), upper-floor offices with an empty pool, TV station offices, bathrooms and elevators, fifth floor, atriums.
- **The parking garage** is procedural and treated as its own level, entered via the wrong-floor elevator or a stairwell door, with a fade transition. A seamless ramp connection is a later goal.
  - Built from a small chunk set: column bays, ramps, dead ends, stairwell doors, painted lines, fluorescent lights, parked cars.
  - Starts looking normal; then level signs skip (P2, P3, P7, P-12) and "Salida" arrows point into walls.
  - A recurring generic minivan landmark signals the player is going in circles.
  - Goal: reach a payphone, intercom, or attendant booth before sanity runs out. Failure → wake up elsewhere in the mall.
  - Contained, guided sequence, not endless wandering. Fixed vs. random seed: undecided, make it configurable.

## Threats

- **The shadow:** appears on security camera feeds, approaches figures; radio voice warns to look behind. Later appears on the feed of the player's own room.
- **The girl in white:** brief, sparing apparitions in elevators, mirrors, bathroom corridors. Never chases.
- **The watchers:** ordinary-looking people who never attack; they move closer when not observed, freeze when looked at directly, and drain sanity while watching.

## Current priority: vertical slice

1. Replace the procedural world with one hand-built test room loaded from GLB, with working collision.
2. Physics door interaction.
3. The food court as the first real area (night noises: physics events that trigger when the player isn't looking).
4. Wrong-floor elevator → procedural parking garage with the recurring van.

Work in small, testable steps. Augusto playtests; after each feature, tell him exactly what to try and what to look for, since feel and scares can only be judged by playing.

## Content guidelines (must follow)

Some legends are tied to real tragedies and real people. When writing notes, dialogue, signage, events, or any content:

- **Never depict suicide** or use it as a scare.
- **No real crimes or real victims** (shootings, bodies found, muggings, taxi crimes). Fictionalize or omit.
- **No real names:** use fictional names for the mall (see "Real-world reference"), its businesses (e.g., the betting company, the TV station), and people (e.g., the TV host).
- **No sexual content** or prostitution rumors.
- The game draws on the **legends**, not the narration of the source YouTube video; never reproduce its script. Credit the video as a source.
- The minivan is generic, never a copy of the cartoon mystery van.

## Language

- In-world text (signs, labels such as "Salida", "Nivel", "Parqueo") is in **Costa Rican Spanish**, matching the real mall.
- UI and notes language (Spanish, English, or both): undecided. Keep strings in one place so localization stays easy.

## Web performance rules

- Bake lighting where possible; keep the flashlight and only a few lights dynamic.
- Compress textures (KTX2) and keep the initial download small; load areas as the player moves.
- Respect the base project's quality presets; test on low-end and mobile settings.
- Avoid heavy post-processing that breaks on weak GPUs.

## Repository conventions

- Large binary assets (photos, textures, models, audio) go through **Git LFS**.
- Reference photos of the real mall: `reference/photos/`.
- Design docs, floor plans, and legend notes: `docs/`.
- Update this file when decisions change (license status, seed choice, language, priorities).
