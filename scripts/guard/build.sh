#!/bin/zsh
# Builds public/models/guard.glb: the guard character (MPFB + MakeHuman system assets, CC0) with animation clips
# retargeted from Quaternius' Universal Animation Library (CC0). The result is committed, so this only needs to run
# when the character changes.
#
# Needs: Blender 4.2+ (`blender` on the PATH) with the MPFB extension and the makehuman_system_assets pack installed
# (see scripts/guard/README.md), and the library at $UAL (default: ~/Downloads/ual/...).
set -e
cd "$(dirname "$0")/../.."
UAL=${UAL:-"$HOME/Downloads/ual/ual1/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb"}
TMP=$(mktemp -d)
blender -b --python scripts/guard/build_guard.py -- "$TMP/guard.glb" "$TMP/guard.blend" | grep -E "lifted|hidden|fit |cap fitted|badge pinned|exported|Error" || true
blender -b "$TMP/guard.blend" --python scripts/guard/retarget.py -- "$UAL" "$TMP/guard_anim.glb" | grep -E "baked|exported|unmapped|Error" || true
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/guard/finish.mts "$TMP/guard_anim.glb" public/models/guard.glb
ls -la public/models/guard.glb
rm -rf "$TMP"
