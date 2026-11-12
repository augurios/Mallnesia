#!/bin/zsh
# Builds public/models/girl.glb: the girl in white (MPFB + MakeHuman system assets, CC0, with an outfit modeled by
# script in dress.py) and her "cry" clip (cry.py, authored over the idle of Quaternius' Universal Animation Library,
# CC0). The result is committed, so this only needs to run when she changes.
#
# Needs what the guard's build needs (see scripts/guard/README.md): Blender 4.2+ with MPFB and the
# makehuman_system_assets pack, and the library at $UAL. Set KEEP=<dir> to keep the intermediate .blend and .glb files.
set -e
cd "$(dirname "$0")/../.."
UAL=${UAL:-"$HOME/Downloads/ual/ual1/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb"}
TMP=${KEEP:-$(mktemp -d)}
blender -b --python scripts/girl/build_girl.py -- "$TMP/girl.glb" "$TMP/girl.blend" | grep -E "lifted|outfit|skirt:|hidden|exported|Error" || true
blender -b "$TMP/girl.blend" --python scripts/guard/retarget.py -- "$UAL" "$TMP/girl_anim.glb" --rig girl --clips Idle_Loop:idle --limb-swing yes --post scripts/girl/cry.py,scripts/girl/hair.py | grep -E "baked|hair:|exported|unmapped|Error|Traceback|line [0-9]" || true
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/guard/finish.mts "$TMP/girl_anim.glb" public/models/girl.glb
ls -la public/models/girl.glb
[[ -z "$KEEP" ]] && rm -rf "$TMP"
true
