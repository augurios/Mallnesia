# Art style reference (DRAFT, proposed for Augusto's approval)

Purpose: keep every asset (hand-modeled, AI-generated, or from free libraries) looking like the same game. Paste the **Style prompt** below into any AI 3D or texture generator, then add the object description.

Status: proposal. Items marked **[decide]** are Augusto's call. Update this file as decisions are made.

## Mood in one line

A present-day Costa Rican mall after closing: clean, glossy, empty and slightly wrong. Familiar enough that the player recognizes it from their own life, which is what makes it tense. The public areas are well kept; the dirt and decay live in the back-of-house spaces (garage, emergency stairs), so the contrast between sterile front and grimy back is part of the dread. Ordinary first, uncanny second. The mall is alive, so the wrongness is in arrangement and repetition, not in gore.

## Era and condition

- **Setting (decided by Augusto): the present day.** It is more canon and closer to the player. A mid-90s version is a possible prequel later, not part of this game.
- The building is from 1995, so the bones are 90s (terrazzo and ceramic tile, painted concrete, drop-ceiling panels, tinted glass) with decades of renovation layered on top: newer floor finishes, LED fixtures beside old fluorescent tubes, modern store fronts, mismatched signage, security cameras, digital screens, plastic and metal furniture of recent years. The patchwork of renovated and neglected is part of the look.
- **Condition (from the reference photos): well preserved and renovated.** Public areas are clean, bright and glossy: polished porcelain floors with strong reflections, freshly painted white plaster, intact glass and stainless railings. Nothing is broken. The mall is closed for the day, not abandoned.
- Wear is concentrated in back-of-house: the parking garage (cracked and patched concrete, oil and water stains, grime on stairs, exposed pipes) and the emergency stairs (scuffed grey paint, worn handrails, dirty steps). Keep the grime there and keep the front clean.
- Small signs of use in the public areas are fine and even useful: wet-floor cones, plastic sheeting over a vacant unit, taped-off event areas, cables and equipment left out.
- Temporary event clutter appears in the atrium (play area, themed seasonal displays). This is a good source for creepy props, but use invented themes and no real brands.
- No smartphone-era gimmicks that date or distract (QR codes, readable social media, etc.) unless used deliberately as a story element.

## Palette

Muted and desaturated, with warm and cold light competing.

| Use | Colors |
|---|---|
Approximate values sampled from the photos (phone auto white balance and glossy reflections shift them, so treat them as a guide and tint by eye):

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

Light:
- Public areas: very bright and even. Recessed round LED downlights plus long rectangular LED panels in a white drywall ceiling. Curved suspended ceiling discs (some red, some grey) with downlights, especially around the food court and entrance.
- Garage: sparse linear fluorescent tubes, with long pools of darkness between them.
- With the lights off at night, the same spaces become large, dark, reflective voids: the glossy floors will catch the flashlight. This is the horror opportunity of the present-day setting.

Avoid saturated colors, neon, pure black (use very dark green-grey) and pure white (use dirty off-white).

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
- **Garage**: orange-banded columns, painted arrows, round convex mirrors on walls, curving lanes, an elevator lobby with checkerboard tile, a stairwell door.

## Rules of thumb for assets

- **Generic and fictional.** No real brand names, logos or signage from the real mall. Invented businesses only (see CLAUDE.md content guidelines). This matters more with a present-day setting: the real mall is an operating business today, so store fronts, food court counters and signage must be clearly invented, not copied from reference photos.
- **Costa Rican context.** In-world text is Costa Rican Spanish ("Salida", "Nivel", "Parqueo"). Furniture and objects should look regionally plausible: plastic chairs, metal food court tables, local-style signage.
- **Low-poly friendly.** Target well under a few thousand triangles per prop; textures 512 to 1024 px, compressed to KTX2. Simple silhouettes read better in the dark.
- **Readable in darkness.** Mostly dark scenes, so shape and a few lit edges matter more than surface detail.
- **No weapons the player can use, no gore, no real victims.**
- **The minivan is a generic minivan**, never a copy of the cartoon mystery van.

## Style prompt (paste into AI generators)

> Low-poly game prop, present-day Costa Rican shopping mall, clean and well maintained, light scuffs only, muted colors, off-white and grey tones, plain unbranded design, no logos or text, realistic proportions, clean simple geometry, PBR textures, single object, neutral pose.

Add the object after it, for example: "plastic food court chair, stackable, red, simple molded shape". For characters add: "ordinary person in everyday clothes, neutral expression, A-pose" (A-pose or T-pose so Mixamo can auto-rig it).

## Texture notes

- Prefer tileable CC0 textures (Poly Haven, ambientCG) for floors, walls and ceilings. Tint toward the palette above rather than generating from scratch.
- Grime levels: clean in public areas (light scuffs at most), heavy only in the garage, emergency stairs and service corridors.
- Glossy floors are a defining look but real-time reflections are expensive on weak GPUs. Plan to fake them: a high-gloss material with a baked reflection probe or cubemap, and low roughness only where it matters. Test on the low-end preset.

## Per-area mood (starting points)

| Area | Look |
|---|---|
| Food court | red plastic chairs on a cream floor, white tables, curved ceiling discs, TVs off, counters shuttered; a huge room that is normally full of people and is now silent |
| Main atrium | tall octagonal truss roof, four stacked curved balconies, glass elevators, curved stairs, sphere-capped columns; the most static and recognizable space; daylight at the main doors that never gets closer |
| Halls and kiosks | long glossy corridors with black floor inserts, glass kiosks, repeated store fronts; repetition is the scare (the mall can quietly add a few meters) |
| Gray service corridors | bare concrete, pipes, bad lighting, cramped and utilitarian; the opposite of the polished front |
| Emergency stairs | white walls, grey scuffed concrete, worn handrails; mundane and tight |
| Parking garage | sparse fluorescent tubes, orange-banded columns, painted arrows, round mirrors, patched floor; starts normal, then signs skip and arrows point into walls |

## Open decisions

- **Decided:** present-day setting (see "Era and condition").
- **[decide]** Overall look: realistic-low-poly (recommended) vs. PS1-style chunky and dithered. PS1 is cheaper to make consistent and hides AI-mesh flaws, but it is a different mood.
- **[decide]** Resolution budget for characters (guard, watchers).
- **[decide]** Whether AI-generated assets are acceptable for the released game (check each service's licence terms first, and keep a record of what was generated where).

## Asset log

Record each non-original asset here so licences are traceable.

| Asset | Source (service or library) | Date | Licence / terms checked |
|---|---|---|---|
| | | | |
