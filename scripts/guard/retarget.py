# Retargets clips of Quaternius' Universal Animation Library (CC0) onto the guard's MPFB "game_engine" skeleton and
# exports the guard with them as glTF.
#
# Run after build_guard.py:
#   blender -b <guard.blend> --python scripts/guard/retarget.py -- <AnimationLibrary_Godot_Standard.glb> <out.glb>
# Other characters on the same skeleton (the girl in white) add options after the two paths:
#   --rig <armature object>   (default: guard)
#   --clips Lib_Clip:name,... (default: the guard's clips below)
#   --limb-swing yes          swing only the limbs' rest directions onto the library's (the spine, neck and head keep
#                             their own rest: on a child the library's spine directions bend the chest forward)
#   --post <a.py>,<b.py>      run in order after the clips are baked and before export, each with `rig`, `made` (the
#                             baked actions), `scene` and `__file__` in its namespace; they may append more actions to
#                             `made` and add meshes (everything in the scene is exported).
#
# How: both rigs face -y. For every frame, each target bone gets the world rotation the source bone has turned through
# since its own rest pose, applied on top of the target's rest, after first swinging the target's rest direction onto
# the source's (the library rests in a T-pose, MPFB in an A-pose). Bone lengths stay the guard's; only the hips move,
# scaled by leg length.
import os
import re
import sys
import bpy
from mathutils import Matrix, Quaternion, Vector

FINGER = re.compile(r"^(thumb|index|middle|ring|pinky)_0\d_[lr]$")
FINGER_CURL = 0.5  # how much of the library's finger curl the free hand keeps

argv = sys.argv[sys.argv.index("--") + 1:]
LIBRARY, OUT_GLB = argv[0], argv[1]
opts = dict(zip(argv[2::2], argv[3::2]))

# clip in the library -> name in our file
CLIPS = {
    "Idle_Loop": "idle",
    "Idle_Talking_Loop": "talk",
    "Idle_Torch_Loop": "torch",
    "Walk_Loop": "walk",
    "Walk_Formal_Loop": "walk_formal",
}
if "--clips" in opts:
    CLIPS = dict(pair.split(":") for pair in opts["--clips"].split(","))

# guard (MPFB game_engine) bone -> library (Rigify DEF) bone
MAP = {"pelvis": "DEF-hips", "spine_01": "DEF-spine.001", "spine_02": "DEF-spine.002", "spine_03": "DEF-spine.003",
       "neck_01": "DEF-neck", "head": "DEF-head"}
for s, S in (("l", "L"), ("r", "R")):
    MAP.update({
        f"clavicle_{s}": f"DEF-shoulder.{S}", f"upperarm_{s}": f"DEF-upper_arm.{S}", f"lowerarm_{s}": f"DEF-forearm.{S}",
        f"hand_{s}": f"DEF-hand.{S}", f"thigh_{s}": f"DEF-thigh.{S}", f"calf_{s}": f"DEF-shin.{S}",
        f"foot_{s}": f"DEF-foot.{S}", f"ball_{s}": f"DEF-toe.{S}",
    })
    for f in ("index", "middle", "ring", "pinky"):
        for i in (1, 2, 3):
            MAP[f"{f}_0{i}_{s}"] = f"DEF-f_{f}.0{i}.{S}"
    for i in (1, 2, 3):
        MAP[f"thumb_0{i}_{s}"] = f"DEF-thumb.0{i}.{S}"

guard = bpy.data.objects[opts.get("--rig", "guard")]
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=LIBRARY)
imported = [o for o in bpy.data.objects if o not in before]
src = next(o for o in imported if o.type == "ARMATURE")

gw = guard.matrix_world
sw = src.matrix_world


def rest_world(ob, bone):
    return ob.matrix_world @ bone.matrix_local


def rest_dir(ob, bone):
    return (ob.matrix_world @ bone.tail_local) - (ob.matrix_world @ bone.head_local)


TORSO = {"pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head"}

# per bone: the source's rest rotation, the target's, and the swing from the target's rest direction onto the source's
info = {}
for tname, sname in MAP.items():
    tb = guard.data.bones.get(tname)
    sb = src.data.bones.get(sname)
    if tb is None or sb is None:
        print("unmapped", tname, sname)
        continue
    info[tname] = {
        "src": sname,
        "s_rest": rest_world(src, sb).to_quaternion(),
        "t_rest": rest_world(guard, tb).to_quaternion(),
        "swing": Quaternion() if opts.get("--limb-swing") == "yes" and tname in TORSO else rest_dir(guard, tb).normalized().rotation_difference(rest_dir(src, sb).normalized()),
    }


def lowest(ob, names):
    return min((ob.matrix_world @ ob.data.bones[n].tail_local).z for n in names if n in ob.data.bones)


hips_t = (gw @ guard.data.bones["pelvis"].head_local)
hips_s = (sw @ src.data.bones["DEF-hips"].head_local)
leg_ratio = (hips_t.z - lowest(guard, ["ball_l", "ball_r"])) / (hips_s.z - lowest(src, ["DEF-toe.L", "DEF-toe.R"]))
print("leg ratio", round(leg_ratio, 3))

# bones in hierarchy order
order = []


def walk(b):
    order.append(b)
    for c in b.children:
        walk(c)


for b in guard.data.bones:
    if b.parent is None:
        walk(b)

for pb in guard.pose.bones:
    pb.rotation_mode = "QUATERNION"
if guard.animation_data is None:
    guard.animation_data_create()
if src.animation_data is None:
    src.animation_data_create()

scene = bpy.context.scene
made = []
for clip, name in CLIPS.items():
    act = bpy.data.actions.get(clip)
    if act is None:
        print("missing clip", clip)
        continue
    src.animation_data.action = act
    if hasattr(src.animation_data, "action_slot") and act.slots:
        src.animation_data.action_slot = act.slots[0]
    f0, f1 = (int(round(v)) for v in act.frame_range)
    out = bpy.data.actions.new(name)
    out.use_fake_user = True
    guard.animation_data.action = out
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        pose = {}  # bone name -> armature-space pose matrix of the guard
        for b in order:
            pb = guard.pose.bones[b.name]
            parent = b.parent
            rest_rel = b.matrix_local if parent is None else parent.matrix_local.inverted() @ b.matrix_local
            parent_pose = Matrix.Identity(4) if parent is None else pose[parent.name]
            if b.name in info:
                i = info[b.name]
                s_now = (sw @ src.pose.bones[i["src"]].matrix).to_quaternion()
                rot_w = s_now @ i["s_rest"].inverted() @ i["swing"] @ i["t_rest"]
                rot = (gw.to_quaternion().inverted() @ rot_w)
                if FINGER.match(b.name):
                    # fingers: follow the source bone's direction only (the shortest swing from where the parent
                    # carries it). Their full rotations bring the two rigs' different finger rolls along, which
                    # twists the thin finger meshes into long, spidery shapes.
                    sp = src.pose.bones[i["src"]]
                    r0 = (parent_pose @ rest_rel).to_quaternion()
                    d1 = gw.to_quaternion().inverted() @ ((sw @ sp.tail) - (sw @ sp.head))
                    swing = (r0 @ Vector((0, 1, 0))).rotation_difference(d1.normalized())
                    if name != "torch":  # the library's free hands clench; ease them into a relaxed half-curl
                        swing = Quaternion().slerp(swing, FINGER_CURL)
                    rot = swing @ r0
                if b.name == "pelvis":
                    s_head = sw @ src.pose.bones[i["src"]].head
                    pos_w = hips_t + (s_head - hips_s) * leg_ratio
                    pos = gw.inverted() @ pos_w
                else:
                    pos = (parent_pose @ rest_rel).translation
                M = Matrix.Translation(pos) @ rot.to_matrix().to_4x4()
            else:
                M = parent_pose @ rest_rel  # unmapped (root and the like): stays at rest
            pose[b.name] = M
            basis = rest_rel.inverted() @ parent_pose.inverted() @ M
            loc, q, _ = basis.decompose()
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f - f0, group=b.name)
            if b.name == "pelvis":
                pb.location = loc
                pb.keyframe_insert("location", frame=f - f0, group=b.name)
    made.append(out)
    print("baked", name, f1 - f0 + 1, "frames")

for post in opts.get("--post", "").split(","):
    if post:
        ns = {"rig": guard, "made": made, "scene": scene, "__name__": "post", "__file__": os.path.abspath(post)}
        exec(compile(open(post).read(), post, "exec"), ns)

# drop the library: its rig, its mesh and its actions, so only the guard and our clips are exported
for o in imported:
    bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    if a not in made:
        bpy.data.actions.remove(a)
guard.animation_data.action = None
for pb in guard.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
# every clip as an NLA strip, so the exporter writes each one as its own animation
for a in made:
    track = guard.animation_data.nla_tracks.new()
    track.name = a.name
    track.strips.new(a.name, 0, a)
    track.mute = True

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_skins=True,
    export_morph=False,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
)
print("exported", OUT_GLB)
