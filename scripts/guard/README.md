# The guard model

`public/models/guard.glb` is built by `scripts/guard/build.sh` and **committed** (it needs Blender, so it is not part of
`npm run assets`). Rebuild it only when the character changes.

## Sources (all CC0)

- **Character:** MPFB (the MakeHuman plugin for Blender) and the MakeHuman system assets pack: base body, skin
  `middleage_caucasian_male` (tinted warmer), hair `short01`, eyebrows, eyelashes, low-poly eyes, clothes
  `male_casualsuit06` (repainted: grey shirt, black knit vest, black trousers) and `shoes04`. Everything MakeHuman
  ships and produces is CC0.
- **Gear:** the navy "SEGURIDAD" cap and the brass shield badge are our own, modeled by script in `gear.py` (MakeHuman has
  no cap, and Poly Haven's only hat is a fisherman's hat). The cap's letters are Blender's built-in font, turned into
  raised mesh.
- **Animations:** Quaternius' Universal Animation Library, Standard (CC0), from
  <https://opengameart.org/content/universal-animation-library>: `Idle_Loop`, `Idle_Talking_Loop`, `Idle_Torch_Loop`,
  `Walk_Loop`, `Walk_Formal_Loop`, retargeted onto MPFB's `game_engine` skeleton.

## One-time setup

```sh
brew install --cask blender
blender --online-mode -c extension sync
blender --online-mode -c extension install --enable mpfb
# MakeHuman system assets (CC0, ~270 MB), unzipped into MPFB's user data folder:
curl -LO https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
unzip makehuman_system_assets_cc0.zip -d "$HOME/Library/Application Support/Blender/5.2/extensions/.user/blender_org/mpfb/data"
# Universal Animation Library (Standard), unzipped to ~/Downloads/ual/ual1 (or point $UAL at the Godot .glb):
curl -L -A "Mozilla/5.0" -o ual1.zip https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip
```

## Steps (`build.sh`)

1. `build_guard.py` (Blender): makes the character (with shorter, thicker fingers from MakeHuman's hand targets), moves
   the finger joints to where the skin's weights bend (MPFB's fitted joints are centimetres off, which stretched curled
   fingers into claws), hides the body where the clothes cover it, repaints the textures (the vest is painted in
   texture space onto the shirt), adds the gear (`gear.py`: the cap fitted to the skull, with the hair under it hidden,
   and the badge pinned to the vest with the vest's own skin weights), lifts the rig onto the floor, exports glTF.
2. `retarget.py` (Blender): bakes the library clips onto the guard's bones (rotation deltas from each rig's rest, with
   the T-pose / A-pose difference corrected; hips scaled by leg length) and exports with the clips. Fingers follow
   the library's finger directions only, with no twist, and the free hand keeps half the library's curl (it clenches
   otherwise); the torch clip keeps its full grip.
3. `finish.mts` (Node): hair, eyebrows and eyelashes alpha-tested, everything else opaque; the vertex data quantized
   (KHR_mesh_quantization), then meshopt compression. It refuses a file that is quantized already (finish the file
   Blender wrote).

The game plays `walk`, `talk` or `idle` on the body, and always the left arm of `torch` (the flashlight hand); the
flashlight itself is added in code (`src/engine/guard-view.ts`).
