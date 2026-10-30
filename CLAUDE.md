# CLAUDE.md — El Mall Vivo (working title)

## Project overview

A first-person, browser-based horror game inspired by *Amnesia: The Dark Descent*: no combat, vulnerability, darkness, a sanity system, and environmental storytelling. The setting is a hand-built recreation of an old shopping mall in Costa Rica, based on the urban legends that surround it, plus a procedurally generated parking garage where the player gets lost.

### Real-world reference

- **Place:** Mall San Pedro, San Pedro, Montes de Oca, San José, Costa Rica. Opened in 1995; known for its confusing architecture, multi-level parking garage, food court, and the local legends compiled in the legends reference.
- **Use:** the real mall is the reference for layout, architecture, materials, signage, and atmosphere. Reference photos are in `reference/photos/`; spatial accuracy to the real building matters for the hand-built areas.
- **Era (decided):** the game is set in the **present day**, which is more canon and closer to the player. The mall's 90s bones stay, with decades of renovation on top. A mid-90s prequel is a possible later project. See `docs/art_style_reference.md`.
- **In-game name:** a lightly fictionalized name that locals will recognize as Mall San Pedro (final name undecided). Do not use the real name in game content until Augusto decides otherwise, since the game links a real, operating business to crimes and hauntings.

- **Release:** free, on the web (itch.io or similar).
- **Platforms:** desktop browsers first; mobile touch support where practical.
- **Owner:** Augusto. He makes all creative decisions; propose, don't decide.

## Key documents

- `docs/El_Mall_Vivo_Design_Doc.pdf` — **legends reference.** 17 selected legends, each with what the legend says, the game mechanic it becomes, its area, and its priority (Vertical slice / Core / Later). This is the source of truth for game content. Read it before designing any area, threat, note, or mechanic.
  - **Where they conflict, this file wins.** The PDF predates the decision to drop item pickup, inventory, and player-operated doors and drawers. Adapt these legend mechanics:
    - Legend 8 (gym): physics props can still be pushed; the player just doesn't pick anything up.
    - Legend 9 (gray corridors): no keys or access cards; the mall opens sections itself.
    - Legend 16 (fifth floor): the weapons cache is a scene to look at, not an item to take.
    - Legend 17 (laughing-drug photo): examined where it lies, not picked up. Not yet redesigned (Later).
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
| Add | Hand-built mall from GLB, mesh collision, self-moving doors (driven by the mall), physics props for night-noise events, hiding spots, readable notes, flashlight with limited charge, stealth and detection (noise, light, line of sight), the guard NPC, security camera room, win and fail states, save/load |

## Game mechanics

- **No combat.** Threats are avoided, hidden from, or endured. Never add weapons the player can use.
- **Sanity:** drained by darkness, apparitions, and the watchers. Low sanity increases hallucinations and makes the mall shift more (e.g., more wrong-floor elevator results).
- **Light:** a flashlight with limited charge (equivalent of Amnesia's lantern oil). Charge drains while it is on and recharges in lit areas or at fixed charging points. There are no battery pickups.
- **Locked zones:** no keys or access cards. The mall opens and locks sections on its own, tied to story beats.
- **Doors:** the player never opens or closes doors. The mall does, on its own: doors that were open are now closed, and vice versa. Door state is a tool of the mall's shifting (see "Central premise"), driven by scripted events and by sanity. Drawers are not interactive.
- **Interaction:** limited to hiding spots (including abandoned cars), readable notes, and security-room monitors. **No inventory and no item pickup.**
- **Security room:** monitors the player can use to scout other areas; the shadow can appear on the feeds. The player can also spot the guard here (see "The guard").
- **Stealth:** the player survives by staying quiet, hidden, and out of sight. The flashlight must be off to avoid being noticed by a major threat. See "Failure".

## Areas and the procedural garage

### The main atrium (hub)

- **The main atrium is a defining feature of the real mall** and the game's central hub. It is the **most static place in the game**: the rest of the mall shifts, but the atrium keeps its layout, so the player always has a place to orient themselves.
- **It is where the player chooses a path:** an elevator, a corridor, stairs, or an open door. Each leads to a different area.
- **The unreachable exit is seen from here** (legend 2): the main doors are visible from the railings, but the route down always leads somewhere else.
- **Checkpoints:** the game auto-saves when the player enters or leaves the atrium (see "Save, load, and checkpoints").
- **Start (decided):** the main building has 4 floors. The player starts on the **first floor at the main entrance, which is closed** when the game begins. The food court is in the southern part of the top 3 floors, and the player reaches it, and the atrium, from there.

### Other areas

- **Hand-built areas** carry the place's identity: food court (first area), abandoned gym, gray service corridors (shortcuts and stealth network), upper-floor offices with an empty pool, TV station offices, bathrooms and elevators, fifth floor, atriums.
- **The parking garage** is procedural and treated as its own level, entered via the wrong-floor elevator or a stairwell door, with a fade transition. A seamless ramp connection is a later goal.
  - Built from a small chunk set: column bays, ramps, dead ends, stairwell doors, painted lines, fluorescent lights, parked cars.
  - Starts looking normal; then level signs skip (P2, P3, P7, P-12) and "Salida" arrows point into walls.
  - A recurring generic minivan landmark signals the player is going in circles.
  - Goal: reach a payphone, intercom, or attendant booth before sanity runs out. Failure → wake up elsewhere in the mall.
  - Contained, guided sequence, not endless wandering. Seed: **fixed by default**, with a config flag to randomize.

## Threats

- **The shadow:** appears on security camera feeds, approaches figures; radio voice warns to look behind. Later appears on the feed of the player's own room. **It is the only threat that can catch the player** (see "Failure").
- **The girl in white:** brief, sparing apparitions in elevators, mirrors, bathroom corridors. Never chases.
- **The watchers:** ordinary-looking people who never attack; they move closer when not observed, freeze when looked at directly, and drain sanity while watching.

## Save, load, and checkpoints

- **Auto-save checkpoint:** created whenever the player **enters or leaves the main atrium**. This is the "last checkpoint" the player returns to after being caught by the shadow.
- **Manual save and load:** available from the **pause menu**.
- **What a save stores (decided):** player position and current area, which notes were read, and guard and exit progress. Sanity and flashlight charge are **not** saved (reset on load). Keep it small and versioned so saves survive updates.
- **Storage:** browser local storage, since the game is free and web-only. Keep it working if storage is blocked.
- **Manual saves (decided):** allowed anywhere except while the shadow is hunting the player.

## Opening and the guard

- **The guard is a real, ordinary mall worker.** He is not a ghost and not a manifestation of the mall. He is fictional (no real person); see the content guidelines.
- **Opening:** when the game starts, the guard is the first thing the player sees. He tells the player the mall is already closed for the day and they have to leave. He disappears once he is out of the player's camera view. The player is then alone in the mall.
- **Return:** he reappears later, once the player has done some scouting for an exit (the trigger is tied to exploration progress, not a timer).
- **Rounds:** he walks a loose patrol between fixed checkpoints (e.g., food court, an atrium, the garage stairwell door). The mall reshuffles the order, so the route is never the same twice.
- **Finding him is audio-first:** keys jingling, a radio crackling, footsteps, a flashlight beam far down a hall. Sound comes before sight.
- **Scouting him:** the security room monitors show him on a feed. The player decides whether to go meet him.
- **The mall interferes:** at low sanity the cues go quiet or point the wrong way. A watcher can pass for him on a camera feed, so the player has to check before trusting it.
- **Pity rule:** if the player has been lost for several minutes, the cues get clearer, so a long search doesn't become frustrating.
- **Meeting him** is the guard win condition (see "Winning").

## Failure

- **No combat and no health.** The player fails by being caught by the shadow. To avoid this, the player must stay quiet, hidden, and out of sight, with the flashlight off.
- **The shadow is the only threat that can catch the player.** The girl in white never chases, and the watchers drain sanity but never catch the player.
- **Being caught restarts the player at the last checkpoint** (see "Save, load, and checkpoints").
- **Other failure:** sanity running out in the garage wakes the player elsewhere in the mall (not a restart).

## Winning

There are two ways to win. Either one ends the game.

### Finding the guard

- He escorts the player out; the player just follows, with no puzzle.
- It is the easier, social ending, and it depends on luck, timing, and good scouting.
- **Ending tone:** the mall lets the player go.

### Finding an elusive exit

- **Each exit is seen first, then earned.** Following legend 2, the player sees it from afar (e.g., the main doors from an atrium railing, or a strip of daylight at the end of a service corridor). The obvious route to it always leads somewhere else.
- **Each exit has a rule the player has to learn.** The rule is hinted at in the notes (legend 15) and in how the mall behaves. Starting ideas, none decided:
  - **Main entrance:** reached only by the route that makes no sense (e.g., going up when the exit is below).
  - **Garage:** reach the payphone, intercom, or attendant booth, then the ramp out.
  - **Service corridor or dock door:** opens only after the mall has opened its sections in sequence.
- **Exits fade as sanity drops,** so the player needs enough composure to find them.
- **Count:** start with 3; any one wins. Build them in the order their areas get built, starting with the garage.
- **Ending tone:** the player understood the mall and got out on their own.

## Current priority: vertical slice

1. Replace the procedural world with one hand-built test room loaded from GLB, with working collision.
2. Self-moving doors: doors open, close, and slam on their own, triggered by script (and later by sanity).
3. The food court as the first real area (night noises: physics events that trigger when the player isn't looking), starting with the guard's opening scene.
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
- UI and notes language: **Costa Rican Spanish**. Keep strings in one place so localization stays easy.

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
