# The girl's "cry" clip, authored by script over the library's idle (no CC0 library has a crying clip): she stands
# with her head bowed and her shoulders drawn up, both hands over her face, and her shoulders heave with each sob.
#
# Run by scripts/guard/retarget.py as its --post step (it provides `rig`, `made` and `scene`):
#   - the idle clip gives the body its small shifts of weight;
#   - the spine, neck, head and shoulders get added rotations (the hunch, the bow, the sobs);
#   - the arms are solved by IK onto targets carried by the head, so the hands stay on her face as it moves, with the
#     hands turned palm-in and fingers up by tracking constraints;
#   - every frame is read back as a plain pose (a visual bake), the constraints are removed, and the clip is keyed.
# The sobs repeat SOBS times in the clip, so it loops; the game's crying sound pulses at the same rate.
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

CLIP_SECONDS = 8.0
SOBS = 6  # 0.75 Hz: keep in step with the sob pulse in src/engine/audio.ts (GIRL_SOB_HZ in girl-view.ts)

fps = scene.render.fps / scene.render.fps_base  # noqa: F821 (provided by retarget.py)
idle = next(a for a in made if a.name == "idle")  # noqa: F821
i0, i1 = (int(round(v)) for v in idle.frame_range)
idle_len = i1 - i0
frames = int(round(CLIP_SECONDS * fps))
mw = rig.matrix_world  # noqa: F821
bones = rig.data.bones  # noqa: F821
pbs = rig.pose.bones  # noqa: F821


def world(name, which="head"):
    b = bones[name]
    return mw @ (b.head_local if which == "head" else b.tail_local)


# ---- 1. the idle's pose at every frame of the clip (looped) --------------------------------------------------------
rig.animation_data.action = idle  # noqa: F821
if hasattr(rig.animation_data, "action_slot") and idle.slots:  # noqa: F821
    rig.animation_data.action_slot = idle.slots[0]  # noqa: F821
base = []
for f in range(frames):
    scene.frame_set(i0 + (f % idle_len))  # noqa: F821
    base.append({pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in pbs})
rig.animation_data.action = None  # noqa: F821


# ---- 2. added rotations: world axis -> the bone's own rest frame ----------------------------------------------------
def local_rot(name, axis_world, angle):
    rest = (mw @ bones[name].matrix_local).to_3x3().normalized()
    return Quaternion(rest.inverted() @ Vector(axis_world), angle)


FWD = (1, 0, 0)  # rotating about +x bends a bone's tip toward the front (-y)


def sob(t):
    """0 to 1: the catch of breath in each sob (sharp in, slow out), with a shudder on the way out."""
    ph = (t * SOBS / CLIP_SECONDS) % 1.0
    rise = min(1.0, ph / 0.12)
    fall = math.exp(-(ph - 0.12) / 0.22) if ph > 0.12 else 1.0
    s = rise * fall
    shudder = 0.18 * math.sin(ph * 2 * math.pi * 9) * math.exp(-ph / 0.3) * (ph > 0.1)
    return max(0.0, s + shudder)


# ---- 3. the hands' targets, carried by the head --------------------------------------------------------------------
# placed with the skeleton at rest (the targets ride on the head bone from there), from where her eyes really are
for pb in pbs:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
eyes = next(o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("low-poly"))
eye_pts = [eyes.matrix_world @ v.co for v in eyes.data.vertices]
eye_c = sum(eye_pts, Vector()) / len(eye_pts)
eye_z = eye_c.z
face_y = min(p.y for p in eye_pts)  # the front of the eyes
created = []


def empty(name, loc, parent_bone=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)  # noqa: F821
    if parent_bone:
        e.parent = rig  # noqa: F821
        e.parent_type = "BONE"
        e.parent_bone = parent_bone
        bpy.context.view_layer.update()
        e.matrix_world = Matrix.Translation(loc)
    else:
        e.location = loc
    created.append(e)
    return e


cons = []
for s, sx in (("l", 1), ("r", -1)):
    # the heels of her hands under her chin, fingers up over her eyes to the brow, palms flat toward her face
    wrist = empty(f"wrist_{s}", Vector((sx * 0.045, face_y - 0.03, eye_z - 0.08)), "head")
    tips = empty(f"tips_{s}", Vector((sx * 0.03, face_y - 0.022, eye_z + 0.06)), "head")
    palm = empty(f"palm_{s}", Vector((sx * 0.0, face_y + 0.1, eye_z - 0.01)), "head")
    pole = empty(f"pole_{s}", Vector((sx * 0.16, world("spine_03").y - 0.3, world("spine_03").z - 0.25)))
    ik = pbs[f"lowerarm_{s}"].constraints.new("IK")
    ik.target, ik.pole_target, ik.chain_count = wrist, pole, 2
    ik.pole_angle = math.radians(-90)
    ik.use_tail = True
    dt = pbs[f"hand_{s}"].constraints.new("DAMPED_TRACK")
    dt.target, dt.track_axis = tips, "TRACK_Y"
    lt = pbs[f"hand_{s}"].constraints.new("LOCKED_TRACK")
    lt.target, lt.lock_axis, lt.track_axis = palm, "LOCK_Y", "TRACK_Z"
    cons += [(f"lowerarm_{s}", ik), (f"hand_{s}", dt), (f"hand_{s}", lt)]

FINGERS = ("thumb", "index", "middle", "ring", "pinky")


def pose_frame(f):
    t = f / fps
    k = sob(t)
    breath = 0.5 + 0.5 * math.sin(2 * math.pi * t / CLIP_SECONDS * 2)
    adds = {
        "spine_01": local_rot("spine_01", FWD, math.radians(2)),
        "spine_02": local_rot("spine_02", FWD, math.radians(4 - 2 * k)),
        "spine_03": local_rot("spine_03", FWD, math.radians(5 - 3 * k)),
        "neck_01": local_rot("neck_01", FWD, math.radians(9 + 2 * k)),
        "head": local_rot("head", FWD, math.radians(11 + 3 * k - 1.5 * breath)),
        "clavicle_l": local_rot("clavicle_l", (0, -1, 0), math.radians(5 + 6 * k)),
        "clavicle_r": local_rot("clavicle_r", (0, 1, 0), math.radians(5 + 6 * k)),
    }
    for pb in pbs:
        loc, q = base[f][pb.name]
        pb.location = loc
        if pb.name in adds:
            q = q @ adds[pb.name]
        if pb.name.startswith(FINGERS):
            q = Quaternion()  # fingers straight and together over her face (MPFB's rest is a relaxed, nearly flat hand)
            if pb.name.startswith(("index", "middle", "ring", "pinky")) and not pb.name.endswith(("_01_l", "_01_r")):
                q = local_rot(pb.name, (1, 0, 0), math.radians(8))
        pb.rotation_quaternion = q


# ---- 4. visual bake --------------------------------------------------------------------------------------------------
baked = []
for f in range(frames):
    pose_frame(f)
    bpy.context.view_layer.update()
    frame = {}
    for pb in pbs:
        m = rig.convert_space(pose_bone=pb, matrix=pb.matrix, from_space="POSE", to_space="LOCAL")  # noqa: F821
        loc, q, _ = m.decompose()
        frame[pb.name] = (loc, q)
    baked.append(frame)

for name, c in cons:
    pbs[name].constraints.remove(c)
for e in created:
    bpy.data.objects.remove(e, do_unlink=True)

cry = bpy.data.actions.new("cry")
cry.use_fake_user = True
rig.animation_data.action = cry  # noqa: F821
prev = {}
for f, frame in enumerate(baked + [baked[0]]):  # the first pose again at the end, so the loop closes
    for pb in pbs:
        loc, q = frame[pb.name]
        if pb.name in prev and prev[pb.name].dot(q) < 0:
            q = -q  # keep quaternions on one side, so the interpolation never spins the long way round
        prev[pb.name] = q
        pb.rotation_quaternion = q
        pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
        if pb.name == "pelvis":
            pb.location = loc
            pb.keyframe_insert("location", frame=f, group=pb.name)
rig.animation_data.action = None  # noqa: F821
made.append(cry)  # noqa: F821
print("baked cry", frames, "frames,", SOBS, "sobs")
