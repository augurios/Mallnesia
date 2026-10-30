# Art style reference (DRAFT, proposed for Augusto's approval)

Purpose: keep every asset (hand-modeled, AI-generated, or from free libraries) looking like the same game. Paste the **Style prompt** below into any AI 3D or texture generator, then add the object description.

Status: proposal. Items marked **[decide]** are Augusto's call. Update this file as decisions are made.

## Mood in one line

A present-day Costa Rican mall **at night, after closing**: dark, clean, glossy, empty and slightly wrong. Almost all the light is gone; what remains comes mostly from outside, plus a few stray sources inside. Familiar enough that the player recognizes it from their own life, which is what makes it tense. The public areas are well kept; the dirt and decay live in the back-of-house spaces (garage, emergency stairs), so the contrast between sterile front and grimy back is part of the dread. Ordinary first, uncanny second. The mall is alive, so the wrongness is in arrangement and repetition, not in gore.

## Time of day: night (decided by Augusto)

- The game takes place **at night, with the mall closed and its lights mostly off**. Dark tones dominate; the player's flashlight is the main light.
- **The reference photos were taken during the day while the mall was open, so every interior light was on and the building was full of visitors.** They show the real materials and layout, but **not** the in-game lighting. Use them for shapes, materials and base colors; never for how bright a space should be.
- Everything below that describes color is split into two things: the material's own color (from the photos) and the light that falls on it (night, defined below). Darkness comes from the lighting, not from darkening the textures.
- Dark does not mean black. Keep enough readable shape (silhouettes of columns, railings, kiosks) so the player can navigate and the scares have something to hide in.

### Where the little light comes from

In rough order of how much each contributes:

1. **From outside** (the main source): street and parking-lot lights and passing headlights coming through the folding glass entrance wall, glass storefronts and any windows; faint sky glow through the translucent atrium roof panels. Cool grey-blue sky glow with warmer yellow-orange spill from street lamps near the entrance. It is weak, directional, and fades fast with distance from the glass. The garage, being half open to the outside, gets some of this too.
2. **Standby and emergency lights inside:** green exit signs, small red LEDs (fire alarm detectors, camera domes), a few security lights left on, glowing display screens on standby, refrigerator and vending lights in the food court, and the security room monitors. These are tiny, saturated points that make the dark feel inhabited.
3. **A few stuck-on fixtures:** one or two ceiling lights per area that were left on (sometimes flickering). These are the "lit areas" where the flashlight recharges, so their positions are gameplay, not decoration. Place them deliberately.
4. **The mall itself** can turn lights on or off as part of its shifting (scripted events, low sanity).
5. **The flashlight:** a warm cone, the only strong light. The glossy floors and glass will catch and bounce it, which is a big part of the look.

## Era and condition

- **Setting (decided by Augusto): the present day.** It is more canon and closer to the player. A mid-90s version is a possible prequel later, not part of this game.
- The building is from 1995, so the bones are 90s (terrazzo and ceramic tile, painted concrete, drop-ceiling panels, tinted glass) with decades of renovation layered on top: newer floor finishes, LED fixtures beside old fluorescent tubes, modern store fronts, mismatched signage, security cameras, digital screens, plastic and metal furniture of recent years. The patchwork of renovated and neglected is part of the look.
- **Condition (from the reference photos): well preserved and renovated.** Public areas are clean and glossy (by day; at night this reads as dark mirrors): polished porcelain floors with strong reflections, freshly painted white plaster, intact glass and stainless railings. Nothing is broken. The mall is closed for the day, not abandoned.
- Wear is concentrated in back-of-house: the parking garage (cracked and patched concrete, oil and water stains, grime on stairs, exposed pipes) and the emergency stairs (scuffed grey paint, worn handrails, dirty steps). Keep the grime there and keep the front clean.
- Small signs of use in the public areas are fine and even useful: wet-floor cones, plastic sheeting over a vacant unit, taped-off event areas, cables and equipment left out.
- Temporary event clutter appears in the atrium (play area, themed seasonal displays). This is a good source for creepy props, but use invented themes and no real brands.
- No smartphone-era gimmicks that date or distract (QR codes, readable social media, etc.) unless used deliberately as a story element.

## Palette

Muted and desaturated, dark overall, with a cool blue-grey base and a few small warm and saturated accents.

### Material colors (reference, as photographed with the lights on)

These are the surfaces' own colors, sampled from the photos. In the game they are lit by night lighting (next section), so they will look far darker and bluer than listed here. Approximate values (phone auto white balance and glossy reflections shift them, so treat them as a guide and tint by eye):

| Surface | Where | Look |
|---|---|---|
| Public walls and ceilings | atrium, halls | near-white plaster, slightly warm (about #a8a59c in shade, brighter under lights) |
| Public floors | atrium, halls, food court | large-format glossy off-white porcelain with black granite inserts (about #5c5d5d) in rectangles and diagonal squares; the food court floor reads warmer cream (about #c9b28e) |
| Columns | atrium, food court | painted mid-grey (about #656363), round |
| Roof | atrium | pale grey-silver painted steel truss (about #797872) with translucent panels |
| Elevator walls | halls | dark speckled granite cladding (about #403d3a) with brass or gold-toned doors |
| Wood accents | older kiosks, store fronts | dark brown stained wood |
| Food court chairs | food court | saturated red plastic (about #b04c3a); the one strong color in the building, with white tables on black pedestals |
| Signage and kiosks | everywhere | saturated brand colors (reds, yellows, blues). Keep them as invented, unbranded colors |
| Garage ceiling | garage | dark raw concrete with exposed beams (about #392e22 in shadow) and black pipes |
| Garage columns | garage | white with an orange band at the base (about #a57f4d), painted arrows and yellow lines |
| Garage floor | garage | grey patched concrete with dark stains (about #817c77) |
| Garage back lobby | garage | grey-and-white checkerboard tile, dark grey elevator doors, orange traffic cones |
| Emergency stairs | service | white walls, grey painted concrete floor and steps (about #aca8a3), grey handrails with worn paint |

### Night lighting palette (what the player actually sees)

Starting values to tune by playtesting. The reference for the *fixtures* is the photos; their *state* is mostly off.

| Light | Color | Notes |
|---|---|---|
| Ambient / shadow fill | very dark blue-grey, about #0b0f14 to #141a21 | never pure black; just enough to read shapes |
| Sky glow through roof panels and glass | cool grey-blue, about #3a4658 | faint, directional, strongest near the atrium roof and glass |
| Street lamp spill at the entrance | warm sodium yellow-orange, about #c8853a | low intensity; sets the "outside world" color |
| Passing headlights | cold white, short sweeps | brief events, useful for scares and timing |
| Stuck-on indoor fixtures | cold LED white, about #c9d6e0, or old fluorescent green-white | few, deliberately placed; these are the recharge spots |
| Exit signs | green, about #2fbf6b | small bright points |
| Fire alarm and camera LEDs | red, about #d02a2a | tiny |
| Standby screens, fridges, vending | blue-white or teal glow | tiny, flicker occasionally |
| Flashlight | warm white, about #ffedcc | the one strong, dynamic light |

Fixture types still matter for how the few stuck-on lights look, even if most are off:
- Public areas: recessed round LED downlights and long rectangular LED panels in a white drywall ceiling; curved suspended ceiling discs (some red, some grey) around the food court and entrance.
- Garage: sparse linear fluorescent tubes, with long pools of darkness between them.

Colors to avoid: bright saturated colors, neon, pure black (use the very dark blue-grey above) and pure white (use dirty off-white). Saturation lives only in the tiny standby lights and, faintly, the red food court chairs.

## Architecture signature (from the photos)

Things that make the building recognizable and should survive into the level:

- **Octagonal steel-truss roof** over the atrium, radiating from a central hub ring, with translucent panels. A bridge of truss crosses the atrium at upper level.
- **Curved ("spiral") staircases** with glass balustrades and stainless posts, stacked as rounded landings with grey undersides, next to **glass elevators in black shafts**. Confirmed by Augusto: there are **two** stair-and-elevator towers (north and south) plus a **third, separate** curved stair in the center of the atrium (with a planter at its base). The photos are named by tower (`stairs_northern_*`, `stairs_southern_*`, `stairs_center_*`).
- **Stacked curved balcony edges** around the atrium (white, rounded fascias with glass railings), 4 levels visible.
- **Round grey columns**, some with distinctive white capital brackets holding a large wooden or stone-colored sphere. This is a strong, unusual landmark; use it.
- **Glossy light floors with black inserts** laid out as stripes and squares, which also work as navigation cues (the pattern changes by area).
- **Curved suspended ceiling discs** over the food court and entrance.
- **Entrance** (confirmed): the main entrance is a retractable folding glass wall, with a street beyond. The glass doors seen in `entrance_from-inside` belong to a store beside it, not the entrance. Good for the "closed at start" entrance and the unreachable-exit view.
- **Elevator bank** in a granite-clad wall with brass doors, near a dark wood kiosk.
- **Island kiosks** (glass display cases) lining the halls, with some vacant units covered in plastic sheeting.
- **Garage layout (confirmed by Augusto):** the garage is a **spiral ramp**. Parking bays sit on the ramp itself: in the same view the near plane slopes up and the far plane slopes down, and because it spirals the tilt is barely noticeable. Photos `garage_spiral-ramp-parking-bay` and `garage_ramp-up-curving-lane` show this. This fits the "lost in the garage" idea well, since the player can't easily tell which way is up. Worth bringing into the procedural chunk design (curved lanes, gentle slope, bays on the slope).
- **Garage details**: orange-banded columns, painted arrows, round convex mirrors on walls, curving lanes, an elevator lobby with checkerboard tile, a stairwell door.

## How the base project gets its look (dirien/backrooms, read Oct 2026)

The base game is realistic low-poly, not PS1: simple box geometry, standard PBR materials, small textures, and a stack of cheap tricks that make it look better than its polygon count.

- **Geometry:** plain boxes for walls, floors and ceilings, merged into one mesh per chunk. Light panels are one instanced mesh. Props are a few small GLBs (each about 100 to 300 KB, decimated, with 512 px WebP textures).
- **Textures:** a handful of small WebP files (about 6 to 350 KB each). The whole `public/` folder is 9.4 MB including 5.3 MB of audio. Some surfaces (carpet fibre, stains) are procedural in the shader rather than textures.
- **Lighting:** the main trick is **baked per-vertex lighting**. At chunk build time the code computes how much light each vertex receives from every ceiling fixture (distance falloff, angle, and a ray test against walls so light doesn't pass through them) and stores it in a vertex attribute that the material adds on top. Result: many lights, zero per-frame cost. Only the **flashlight is a real dynamic light**, with one shadow map (512 px). No other light casts shadows.
- **Atmosphere:** exponential fog (also hides the draw distance), ACES filmic tone mapping, a bloom pass, and one custom post shader for film grain, vignette, color drain and the sanity distortions. Antialiasing is off and render scale is reduced on weaker presets.
- **Performance:** quality presets (desktop, mobile, low) change render scale, bloom, post effects and streaming distance. Chunks stream in and out. Collision and line of sight use a spatial index, not the render meshes. The code avoids per-frame allocations (enforced by lint).

What this means for this project:
- Our look target is the same recipe, with one big difference: the base game is a lit office space with a flashlight added, while ours is a **night scene lit mostly from outside**. In its baking code each fixture has a `powered` flag, so most fixtures can simply be unpowered, and a few stuck-on ones plus the exterior glow are what actually get baked. Exterior light through the glass can be treated as extra baked "fixtures" placed outside the windows, or as a handful of cheap dynamic lights; this is an engine decision to test early, since it drives the whole look.
- Fog stays dark (near black with a blue tint, not grey) and does double duty: it hides draw distance and it is the night. Exposure will need tuning much lower than the base game's.
- The baked-vertex trick works on procedural chunks. For a hand-built GLB, big flat floors have only a few vertices, so we'd either subdivide them, or bake lightmaps in Blender, or run the same bake at load time on a subdivided mesh. This is a decision for the engine step, not for art.
- The atrium is a large open vertical space with long sightlines, unlike the backrooms' short corridors. Fog and per-area loading will matter more.
- The base repo has no LICENSE file, so its reuse terms are undefined. See CLAUDE.md "license status".

## Rules of thumb for assets

- **Generic and fictional.** No real brand names, logos or signage from the real mall. Invented businesses only (see CLAUDE.md content guidelines). This matters more with a present-day setting: the real mall is an operating business today, so store fronts, food court counters and signage must be clearly invented, not copied from reference photos.
- **Costa Rican context.** In-world text is Costa Rican Spanish ("Salida", "Nivel", "Parqueo"). Furniture and objects should look regionally plausible: plastic chairs, metal food court tables, local-style signage.
- **Low-poly friendly.** Target well under a few thousand triangles per prop; textures 512 to 1024 px, compressed to KTX2. Simple silhouettes read better in the dark.
- **Readable in darkness.** Mostly dark scenes, so shape and a few lit edges matter more than surface detail.
- **Neutral albedo, no baked light.** Textures and generated assets should show the material's own color, evenly lit, with no painted-on shadows, highlights or glow. Night comes from the game's lighting. Exceptions: emissive parts (exit signs, standby screens, LEDs) can be authored as emissive maps.
- **No weapons the player can use, no gore, no real victims.**
- **The minivan is a generic minivan**, never a copy of the cartoon mystery van.

## Style prompt (paste into AI generators)

> Low-poly game prop, present-day Costa Rican shopping mall, clean and well maintained, light scuffs only, muted colors, off-white and grey tones, plain unbranded design, no logos or text, realistic proportions, clean simple geometry, PBR textures, evenly lit neutral albedo with no baked shadows or highlights, single object, neutral pose.

Add the object after it, for example: "plastic food court chair, stackable, red, simple molded shape". For characters add: "ordinary person in everyday clothes, neutral expression, A-pose" (A-pose or T-pose so Mixamo can auto-rig it).

## Texture notes

- Prefer tileable CC0 textures (Poly Haven, ambientCG) for floors, walls and ceilings. Tint toward the palette above rather than generating from scratch.
- Grime levels: clean in public areas (light scuffs at most), heavy only in the garage, emergency stairs and service corridors.
- Glossy floors are a defining look but real-time reflections are expensive on weak GPUs. At night they matter even more: the dark floor mirroring the flashlight, the exit signs and the glow from outside is a big part of the mood. Plan to fake them: a high-gloss material with a baked reflection probe or cubemap that holds those few light sources, and low roughness only where it matters. Test on the low-end preset.
- Photos taken in daytime with the lights on contain strong reflections and a mixed warm and cool color cast. When using them for textures, remove the lighting first or prefer CC0 library textures, so the material doesn't carry daytime light into a night scene.

## Per-area mood (starting points)

| Area | Look |
|---|---|
| Food court | dark red chairs and pale tables as silhouettes; blue glow from fridges and standby screens; sky and street glow through the big windows on one side; a huge room that is normally full of people and is now silent |
| Main atrium | tall octagonal truss roof catching faint blue-grey sky glow, four stacked curved balconies fading into black, glass elevators, curved stairs, sphere-capped columns; the most static and recognizable space; the main doors are a faint warm-orange rectangle of street light that never gets closer |
| Halls and kiosks | long dark glossy corridors with black floor inserts, glass kiosks, repeated store fronts; one or two stuck-on lights far apart; repetition is the scare (the mall can quietly add a few meters) |
| Gray service corridors | bare concrete, pipes, almost no light, cramped and utilitarian; the opposite of the polished front |
| Emergency stairs | white walls turned grey-blue in the dark, scuffed concrete, worn handrails; a green exit sign is the only light; mundane and tight |
| Parking garage | half open to the night, so cold outside glow at the edges; sparse fluorescent tubes (a few on, some flickering), orange-banded columns, painted arrows, round mirrors, patched floor; starts normal, then signs skip and arrows point into walls |

## Open decisions

- **Decided:** present-day setting (see "Era and condition").
- **Decided (Augusto):** the game is set at night, mall closed, lights mostly off, little light mostly from outside, dark tones (see "Time of day: night").
- **[decide]** Whether the exterior glow is baked or dynamic (engine test, early). Also which fixtures are "stuck on" in each area, since they double as flashlight recharge points.
- **Decided (Augusto):** realistic low-poly, not PS1. This is the same approach as the base project (dirien/backrooms); see "How the base project gets its look".
- **[decide]** Resolution budget for characters (guard, watchers).
- **[decide]** Whether AI-generated assets are acceptable for the released game (check each service's licence terms first, and keep a record of what was generated where).

## Asset log

Record each non-original asset here so licences are traceable.

| Asset | Source (service or library) | Date | Licence / terms checked |
|---|---|---|---|
| | | | |
