# The girl in white's model

`public/models/girl.glb` is built by `scripts/girl/build.sh` and **committed** (it needs Blender, so it is not part of
`npm run assets`). Rebuild it only when she changes. Setup is the same as the guard's (`scripts/guard/README.md`).

## Look (decided by Augusto)

A girl of about eight in a first communion dress, crying with her hands over her face: white lace, a short veil on a
wreath of small white flowers, white socks and shoes, long dark hair loose and messy, falling over her hands and face.
The wrongness is in her face: grey-pale skin, dark hollows round red-rimmed eyes, nearly black irises, bloodless lips.
In the game she is a ghost (`src/engine/girl-view.ts`): a little see-through, with a subtle cold glow, rim and aura.

## Sources (all CC0)

- **Character:** MPFB and the MakeHuman system assets: base body (a girl of about eight, 1.23 m), skin
  `young_caucasian_female` (drained toward a cold grey, the eye hollows and lips painted through the face), hair
  `long01` (darkened and roughed up: the mass under the loose locks), `eyebrow010`, `eyelashes02`, low-poly eyes,
  `shoes01` (repainted white; its white socks kept).
- **Loose hair:** our own, grown by script in `hair.py`: about 125 locks of hair cards (one procedural strand texture,
  four variants: three locks and a wisp) grown strand by strand **in the crying pose**, so gravity pulls them where she
  really is: from her brow over her fingers, from the sides over her shoulders, from the crown out of the parting, down
  her back from under the veil, plus stray wisps. Each strand bends toward the floor, wanders a little and is pushed out
  of her body, clothes and the hair sheet, and never crosses the veil. The cards are then carried back to the rest pose
  through the skinning that poses them again (the head near the roots, the chest or back where a lock lies on her).
- **Outfit:** our own, modeled by script in `dress.py` (MakeHuman has no dress, veil or wreath): a bodice and puff
  sleeves made from the body's own surface (smoothed into one plain cloth shape, the chest wrapped by a smooth envelope
  so the body never shows through), a two-tier gathered skirt, scalloped lace at the hems, collar and cuffs (one tiling
  lace texture), a satin sash with a bow and tails, pearl buttons, a tulle veil with a lace edge and a wreath of
  five-petal flowers with pearl centers. The body under the dress is removed from the mesh.
- **Animation:** `cry`, authored by `cry.py` over the library's `Idle_Loop` (Quaternius' Universal Animation Library,
  Standard): head bowed, shoulders drawn up, hands over her face (IK onto targets carried by the head), shoulders
  heaving 6 times in 8 s, baked to a plain looping clip. `idle` is exported too.

## Steps (`build.sh`)

1. `build_girl.py` (Blender): the character (with MPFB's detailed helpers kept: they are what it fits the skeleton to;
   without them a child keeps the adult default skeleton), the outfit (`dress.py`), the body hidden under the clothes,
   the repainted textures; exports glTF and a .blend.
2. `scripts/guard/retarget.py --rig girl --clips Idle_Loop:idle --limb-swing yes --post scripts/girl/cry.py,scripts/girl/hair.py`:
   bakes the idle (the rest-pose swing only on the limbs: on a child the library's spine directions bend the chest
   forward), authors `cry`, grows the loose hair in that pose, and exports.
3. `scripts/guard/finish.mts`: lace, hair and lashes alpha-tested, the veil blended, the skirt and sash two-sided;
   meshopt compression.

`KEEP=<dir> scripts/girl/build.sh` keeps the intermediate files.
