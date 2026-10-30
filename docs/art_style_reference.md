# Art style reference (DRAFT, proposed for Augusto's approval)

Purpose: keep every asset (hand-modeled, AI-generated, or from free libraries) looking like the same game. Paste the **Style prompt** below into any AI 3D or texture generator, then add the object description.

Status: proposal. Items marked **[decide]** are Augusto's call. Update this file as decisions are made.

## Mood in one line

A present-day Costa Rican mall after closing: humid, tired, half-renovated, slightly wrong. Familiar enough that the player recognizes it from their own life, which is what makes it tense. Ordinary first, uncanny second. The mall is alive, so the wrongness is in arrangement and repetition, not in gore.

## Era and condition

- **Setting (decided by Augusto): the present day.** It is more canon and closer to the player. A mid-90s version is a possible prequel later, not part of this game.
- The building is from 1995, so the bones are 90s (terrazzo and ceramic tile, painted concrete, drop-ceiling panels, tinted glass) with decades of renovation layered on top: newer floor finishes, LED fixtures beside old fluorescent tubes, modern store fronts, mismatched signage, security cameras, digital screens, plastic and metal furniture of recent years. The patchwork of renovated and neglected is part of the look.
- Worn, not ruined: water stains, scuffs, faded paint, peeling vinyl, closed stores with covered windows. Nothing is broken into rubble. The mall is closed for the day, not abandoned.
- Tropical humidity: mildew streaks at ceiling corners, rust at metal edges, dull sheen on floors.
- No smartphone-era gimmicks that date or distract (QR codes, readable social media, etc.) unless used deliberately as a story element.

## Palette

Muted and desaturated, with warm and cold light competing.

| Use | Colors |
|---|---|
| Walls and ceilings | dirty cream, pale institutional green, faded beige, grey concrete, newer flat-white repaint patches |
| Floors | off-white and grey terrazzo, large-format grey porcelain tile, terracotta-brown tile, dark stained concrete |
| Accents | faded red and mustard signage, brushed steel, dull plastic store fronts |
| Light | cold LED white mixed with sickly fluorescent green-white; a few dead or flickering fixtures; weak warm yellow from older fixtures; the player's flashlight is a warm cone |

Avoid saturated colors, neon, pure black (use very dark green-grey) and pure white (use dirty off-white).

## Rules of thumb for assets

- **Generic and fictional.** No real brand names, logos or signage from the real mall. Invented businesses only (see CLAUDE.md content guidelines). This matters more with a present-day setting: the real mall is an operating business today, so store fronts, food court counters and signage must be clearly invented, not copied from reference photos.
- **Costa Rican context.** In-world text is Costa Rican Spanish ("Salida", "Nivel", "Parqueo"). Furniture and objects should look regionally plausible: plastic chairs, metal food court tables, local-style signage.
- **Low-poly friendly.** Target well under a few thousand triangles per prop; textures 512 to 1024 px, compressed to KTX2. Simple silhouettes read better in the dark.
- **Readable in darkness.** Mostly dark scenes, so shape and a few lit edges matter more than surface detail.
- **No weapons the player can use, no gore, no real victims.**
- **The minivan is a generic minivan**, never a copy of the cartoon mystery van.

## Style prompt (paste into AI generators)

> Low-poly game prop, present-day Costa Rican shopping mall, worn but intact, muted desaturated colors, dirty cream and grey tones, subtle water stains and scuffs, humid tropical wear, plain unbranded design, no logos or text, realistic proportions, clean simple geometry, PBR textures, single object, neutral pose.

Add the object after it, for example: "plastic food court chair, stackable, faded beige". For characters add: "ordinary person in everyday clothes, neutral expression, A-pose" (A-pose or T-pose so Mixamo can auto-rig it).

## Texture notes

- Prefer tileable CC0 textures (Poly Haven, ambientCG) for floors, walls and ceilings. Tint toward the palette above rather than generating from scratch.
- Keep one consistent grime level: light-to-moderate wear everywhere, heavier only in service corridors and the garage.

## Per-area mood (starting points)

| Area | Look |
|---|---|
| Food court | tidy, closed-for-the-night, chairs up or askew, roll-down shutters on counters, dark menu screens, hum of refrigeration |
| Main atrium | wide, tall, echoing; the most static and recognizable space; daylight at the main doors that never gets closer |
| Gray service corridors | bare concrete, pipes, bad lighting, cramped and utilitarian |
| Parking garage | fluorescent tubes, painted lines, oil stains, repeating columns; starts normal, then signs skip and arrows point into walls |

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
