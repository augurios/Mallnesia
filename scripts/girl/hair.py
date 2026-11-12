# The girl's hair, loose and messy. Run by scripts/guard/retarget.py as a --post step after cry.py (it provides `rig`,
# `made` and `scene`).
#
# MPFB's long hair (long01, CC0) is a smooth painted sheet; it stays as the dark mass underneath, roughed up a little.
# Over it, locks of hair cards are grown strand by strand with her in her crying pose, so gravity really pulls them
# down where she is: some fall from her brow over her fingers, some over her shoulders, some down her back from under
# the veil, plus stray wisps that break her outline. Each strand steps down from its root, bending toward the floor,
# wandering a little (messy), and pushed out of her body, her clothes and the hair sheet; it never crosses the veil.
# The finished cards are carried back to the rest pose through the very skinning that will pose them again (the head
# near the roots; where a lock lies on her, the chest or back underneath), so in the game they hang exactly as grown.
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(__file__))
import dress  # noqa: E402

SOB_HZ = 0.75  # cry.py: 6 sobs in 8 s
STEP = 0.012  # strand segment length (m)
G = np.array([0.0, 0.0, -1.0])
TORSO = ("pelvis", "spine", "neck", "clavicle", "head")
rng = np.random.default_rng(11)

mw = rig.matrix_world  # noqa: F821
bones = rig.data.bones  # noqa: F821
pbs = rig.pose.bones  # noqa: F821


def obj(key):
    return next(o for o in bpy.data.objects if o.name == key or o.name.endswith("." + key))


def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


body, hair, eyes = obj("body"), obj("long01"), obj("low-poly")
CLOTHES = ["girl_bodice", "girl_collar", "girl_cuff_l", "girl_cuff_r", "girl_sash", "girl_skirt_upper", "girl_skirt_lower", "girl_lace_upper", "girl_lace_lower"]
VEIL = ["girl_veil", "girl_veil_lace"]

# ---- rest-frame landmarks ------------------------------------------------------------------------------------------------
eye_rest = np.array([(eyes.matrix_world @ v.co)[:] for v in eyes.data.vertices])
ec = eye_rest.mean(0)
centre = np.array([0.0, ec[1] + 0.065, ec[2] + 0.02])  # roughly the middle of her skull


# ---- 1. the sheet underneath: roughed up below the ears (its blunt ends are hidden under the locks down her back) ---------------------------------------
def waves(p, seed, freq):
    r = np.random.default_rng(seed)
    out = 0.0
    for _ in range(3):
        k = unit(r.normal(size=3)) * freq * r.uniform(0.7, 1.4)
        out = out + np.sin(p @ k + r.uniform(0, 2 * np.pi)) / 3
    return out


hm = hair.matrix_world
hmi = hm.inverted()
hco = np.array([(hm @ v.co)[:] for v in hair.data.vertices])
ear_z = ec[2] - 0.02
d_below = np.clip(ear_z - hco[:, 2], 0, None)
amp = 0.016 * dress.smoothstep(0.0, 0.3, d_below)
moved = hco.copy()
moved[:, 0] += amp * waves(hco, 1, 22)
moved[:, 1] += amp * 0.6 * waves(hco, 2, 22)
for v, p in zip(hair.data.vertices, moved):
    v.co = hmi @ Vector(p)
hair.data.update()

# ---- 2. her crying pose (between two sobs) --------------------------------------------------------------------------------
cry = next(a for a in made if a.name == "cry")  # noqa: F821
rig.animation_data.action = cry  # noqa: F821
if hasattr(rig.animation_data, "action_slot") and cry.slots:  # noqa: F821
    rig.animation_data.action_slot = cry.slots[0]  # noqa: F821
fps = scene.render.fps / scene.render.fps_base  # noqa: F821
scene.frame_set(int(round(0.6 / SOB_HZ * fps)))  # noqa: F821
bpy.context.view_layer.update()
# rest -> pose, per bone, in world space
S = {pb.name: np.array(mw @ pb.matrix @ pb.bone.matrix_local.inverted() @ mw.inverted()) for pb in pbs}


def head_pose(p):
    return (S["head"] @ np.append(p, 1.0))[:3]


def posed(objs):
    V, P = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        b = len(V)
        V += [(o.matrix_world @ v.co)[:] for v in me.vertices]
        P += [tuple(b + i for i in p.vertices) for p in me.polygons]
        e.to_mesh_clear()
    return BVHTree.FromPolygons(V, P), np.array(V)


solid, _ = posed([body, hair] + [obj(n) for n in CLOTHES])
veil, veil_v = posed([obj(n) for n in VEIL])
sheet, _ = posed([hair])
axis = [np.array((mw @ pbs[n].head)[:]) for n in ("pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head")]
axis.append(head_pose(centre))


def axis_point(p):
    """The nearest point of her middle line (pelvis up the spine to the middle of her skull): 'out' is away from it."""
    best, bd = axis[0], 9.0
    for a, b in zip(axis, axis[1:]):
        ab = b - a
        t = float(np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1))
        q = a + ab * t
        d = np.linalg.norm(p - q)
        if d < bd:
            best, bd = q, d
    return best


def outward(loc, nrm):
    n = np.array(nrm[:])
    return n if np.dot(n, loc - axis_point(loc)) >= 0 else -n


def push_out(p, margin):
    for _ in range(3):
        loc, nrm, _, _ = solid.find_nearest(Vector(p), 0.08)
        if loc is None:
            return p
        loc = np.array(loc[:])
        n = outward(loc, nrm)
        off = float(np.dot(p - loc, n))
        if off >= margin:
            return p
        p = p + n * (margin - off)
    return p


def keep_side(p, side):
    """The veil is never crossed: what starts under it stays under it, what is outside stays outside."""
    loc, nrm, _, _ = veil.find_nearest(Vector(p), 0.025)
    if loc is None:
        return p, side
    loc = np.array(loc[:])
    n = outward(loc, nrm)
    off = float(np.dot(p - loc, n))
    if side == 0:
        side = 1 if off > 0 else -1
    if side > 0 and off < 0.004:
        p = p + n * (0.004 - off)
    elif side < 0 and off > -0.004:
        p = p - n * (off + 0.004)
    return p, side


def grow(root, d0, length, grav=(0.08, 0.3), mess=0.1, margin=0.005, side=0):
    p = push_out(root, margin)
    d = unit(d0)
    pts = [p]
    u1, u2 = unit(rng.normal(size=3)), unit(rng.normal(size=3))
    f1, f2 = rng.uniform(25, 60), rng.uniform(50, 110)
    ph1, ph2 = rng.uniform(0, 2 * np.pi, 2)
    for k in range(max(3, int(length / STEP))):
        s = k * STEP
        g = grav[0] + (grav[1] - grav[0]) * float(dress.smoothstep(0.0, 0.1, s))
        wander = mess * (np.sin(s * f1 + ph1) * u1 + 0.6 * np.sin(s * f2 + ph2) * u2)
        d = unit(d + G * g + wander)
        q = push_out(pts[-1] + d * STEP, margin)
        q, side = keep_side(q, side)
        step = q - pts[-1]
        if np.linalg.norm(step) < 1e-5:
            break
        d = unit(step)
        q, side = keep_side(push_out(pts[-1] + d * STEP, margin), side)
        pts.append(q)
    return np.array(pts)


# ---- 3. the roots -------------------------------------------------------------------------------------------------------
rest_tree = BVHTree.FromPolygons([(hm @ v.co)[:] for v in hair.data.vertices], [tuple(p.vertices) for p in hair.data.polygons])


def root_at(theta, phi):
    """A point on the outside of the hair, seen from the middle of her skull at `theta` from straight up and `phi` round
    from the front toward her left (+x). Returned in the pose, with the comb's frame turned to match."""
    t, f = math.radians(theta), math.radians(phi)
    d = np.array([math.sin(t) * math.sin(f), -math.sin(t) * math.cos(f), math.cos(t)])
    hit = rest_tree.ray_cast(Vector(centre + d * 0.3), Vector(-d))
    if hit[0] is None:
        return None
    return head_pose(np.array(hit[0][:]))


def comb(v):
    return S["head"][:3, :3] @ np.array(v, float)


strands = []  # (points, width, texture variant, cross verts)


def add(points, width, variant, across=3):
    if len(points) >= 3:
        strands.append((points, width, variant, across))


def sx_of(phi):
    return 1.0 if phi > 0 else -1.0


# A: from her brow, falling over her fingers and in front of her face (a parting down the middle, so not a curtain)
for _ in range(12):
    phi = sx_of(rng.uniform(-1, 1)) * rng.uniform(4, 40)
    r = root_at(rng.uniform(26, 46), phi)
    if r is not None:
        sx = sx_of(phi)
        L = rng.uniform(0.24, 0.42)
        add(grow(r, comb((sx * 0.25, -0.6, -0.75)), L, mess=rng.uniform(0.05, 0.13), margin=rng.uniform(0.004, 0.008)), rng.uniform(0.018, 0.032), int(rng.integers(0, 3)))
# B: the sides, falling over her shoulders, in front and behind
for _ in range(26):
    phi = sx_of(rng.uniform(-1, 1)) * rng.uniform(42, 100)
    r = root_at(rng.uniform(48, 95), phi)
    if r is not None:
        sx = sx_of(phi)
        add(grow(r, comb((sx * 0.5, rng.uniform(-0.45, 0.25), -0.8)), rng.uniform(0.3, 0.52), grav=(0.15, 0.35), mess=rng.uniform(0.06, 0.16), margin=rng.uniform(0.004, 0.01)), rng.uniform(0.022, 0.04), int(rng.integers(0, 3)))
# C: the crown, out from the parting and down over the sides, tousled
for _ in range(18):
    phi = rng.uniform(-100, 100)
    r = root_at(rng.uniform(3, 40), phi)
    if r is not None:
        sx = sx_of(phi) if abs(phi) > 4 else sx_of(rng.uniform(-1, 1))
        add(grow(r, comb((sx * 0.75, rng.uniform(-0.35, 0.1), -0.35)), rng.uniform(0.2, 0.42), mess=rng.uniform(0.1, 0.22), margin=rng.uniform(0.005, 0.011)), rng.uniform(0.02, 0.034), int(rng.integers(0, 3)))
# D: down her back from under the veil, past the end of the sheet
veil_low = float(veil_v[:, 2].min()) + 0.036  # the bottom of the tulle (above its lace edge)
for _ in range(30):
    x, z = rng.uniform(-0.1, 0.1), veil_low + rng.uniform(0.004, 0.025)
    hit = sheet.ray_cast(Vector((x, 0.6, z)), Vector((0, -1, 0)))
    if hit[0] is not None:
        add(grow(np.array(hit[0][:]), np.array([0, 0.1, -1.0]), rng.uniform(0.22, 0.44), grav=(0.2, 0.4), mess=rng.uniform(0.06, 0.15), margin=rng.uniform(0.003, 0.007), side=-1), rng.uniform(0.022, 0.036), int(rng.integers(0, 3)))
# E: stray wisps standing off the head
for _ in range(42):
    phi = rng.uniform(-115, 115)
    theta = rng.uniform(25, 100)
    r = root_at(theta, phi)
    if r is not None:
        t, f = math.radians(theta), math.radians(phi)
        out = comb((math.sin(t) * math.sin(f), -math.sin(t) * math.cos(f), math.cos(t)))
        across_ = unit(np.cross(out, rng.normal(size=3)))
        d0 = unit(across_ * 0.8 + out * 0.45 + G * 0.35)  # off to one side and out, never straight up
        add(grow(r, d0, rng.uniform(0.04, 0.11), grav=(0.06, 0.2), mess=rng.uniform(0.3, 0.55), margin=rng.uniform(0.008, 0.018)), rng.uniform(0.006, 0.012), 3, across=2)
print("hair: strands", len(strands))

# ---- 4. skin weights for every point of a strand (the head near the roots; the body where a lock lies on her) ---------------
bco, _ = dress.eval_mesh(body)  # posed, indexed like the mesh
names = {g.index: g.name for g in body.vertex_groups}
bone_names = {b.name for b in bones}
bweights = [{names[g.group]: g.weight for g in v.groups if names[g.group] in bone_names and names[g.group].startswith(TORSO) and g.weight > 0.001} for v in body.data.vertices]
helper_g = body.vertex_groups.get("HelperGeometry")
helper = {v.index for v in body.data.vertices if helper_g and any(g.group == helper_g.index for g in v.groups)}
dominant = []
for v in body.data.vertices:
    allw = {names[g.group]: g.weight for g in v.groups if names[g.group] in bone_names}
    dominant.append(max(allw, key=allw.get) if allw else "")
keep = [i for i in range(len(bco)) if i not in helper and dominant[i].startswith(TORSO[:-1]) and bweights[i]]
src = dress.WeightSource(bco, bweights, keep)
chin_z = float((mw @ pbs["head"].head)[2]) - 0.03


def strand_weights(P):
    t = np.array([float(dress.smoothstep(0.075, 0.03, src.tree.find(Vector(p))[2]) * dress.smoothstep(chin_z, chin_z - 0.07, p[2])) for p in P])
    t = np.maximum.accumulate(t)
    t = np.convolve(np.pad(t, 2, mode="edge"), np.ones(5) / 5, mode="valid")
    out = []
    for p, tt in zip(P, t):
        w = {"head": 1.0 - tt}
        if tt > 1e-3:
            bw = src.at(p)
            total = sum(bw.values()) or 1.0
            for b, v in bw.items():
                w[b] = w.get(b, 0.0) + tt * v / total
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        total = sum(v for _, v in top)
        out.append({b: v / total for b, v in top if v / total >= 0.01})
    return out


def unpose(p, w):
    M = sum(v * S[b] for b, v in w.items())
    return (np.linalg.inv(M) @ np.append(p, 1.0))[:3]


# ---- 5. the cards: built round each strand in the pose, then carried back to rest ---------------------------------------------
verts, faces, uvs, vweights = [], [], [], []
VARIANTS = 4
for P, width, variant, across in strands:
    n = len(P)
    T = np.gradient(P, axis=0)
    T /= np.linalg.norm(T, axis=1)[:, None]
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    L = s[-1]
    W = strand_weights(P)
    twist_a, twist_f, twist_p = rng.uniform(0, 0.7), rng.uniform(8, 25), rng.uniform(0, 2 * np.pi)
    u0 = variant / VARIANTS
    base = len(verts)
    for i in range(n):
        out = P[i] - axis_point(P[i])
        out = unit(out - np.dot(out, T[i]) * T[i])
        side = unit(np.cross(T[i], out))
        a = twist_a * math.sin(s[i] * twist_f + twist_p)
        side, out = side * math.cos(a) + out * math.sin(a), out * math.cos(a) - side * math.sin(a)
        w = width * (0.6 + 0.4 * float(dress.smoothstep(0, 0.05, s[i]))) * (1 - 0.5 * (s[i] / L) ** 1.5)
        ring = [P[i] - side * w / 2 - out * w * 0.03, P[i] + out * w * 0.035, P[i] + side * w / 2 - out * w * 0.03]  # nearly flat: a rounder card catches light like a cord
        if across == 2:
            ring = [ring[0], ring[2]]
        for q in ring:
            verts.append(unpose(q, W[i]))
            vweights.append(W[i])
    m = across
    for i in range(n - 1):
        for j in range(m - 1):
            a = base + i * m + j
            faces.append([a, a + 1, a + m + 1, a + m])
            v_a, v_b = 1 - s[i] / L, 1 - s[i + 1] / L
            ua, ub = u0 + j / (m - 1) / VARIANTS, u0 + (j + 1) / (m - 1) / VARIANTS
            uvs += [(ua, v_a), (ub, v_a), (ub, v_b), (ua, v_b)]


# ---- 6. the texture: locks of fine strands, roots at the top (v = 1), ragged ends at the bottom ------------------------------
def lock_tile(base, size=512, seed=5):
    H, Wd = size, size
    VW = Wd // VARIANTS
    r = np.random.default_rng(seed)
    v = (np.arange(H) + 0.5) / H  # row 0 is the bottom of the image in Blender: the tip end
    cols = np.arange(VW) + 0.5
    rgba = np.zeros((H, Wd, 4))
    for var in range(VARIANTS):
        wisp = var == VARIANTS - 1
        a = np.zeros((H, VW))
        c = np.zeros((H, VW, 3))
        ws = np.zeros((H, VW))
        for _ in range(16 if wisp else 56):  # gaps between the strands: a lock you can see through, not a rope
            xr = VW / 2 + r.normal(0, VW * (0.2 if wisp else 0.15))
            xt = r.normal(0, VW * (0.16 if wisp else 0.11))
            v0 = r.uniform(0.93, 1.0)
            v1 = min(0.7, r.uniform(0.0, 0.35) ** 1.6 * (1.0 if r.random() > 0.15 else 3.0))
            tp = np.clip((v0 - v) / (v0 - v1), -0.2, 1.2)
            tc = np.clip(tp, 0, 1)
            amp = r.uniform(0.5, 3.0) * (3.5 if r.random() < 0.18 else 1.0) * (2.0 if wisp else 1.0)
            x = xr + xt * tc**1.5 + amp * np.sin(2 * np.pi * r.uniform(1.5, 5) * v + r.uniform(0, 2 * np.pi)) * tc
            wpx = r.uniform(0.9, 1.6) * (0.8 if wisp else 1.0) * (1 - 0.45 * tc)
            cov = np.clip(wpx[:, None] / 2 + 0.5 - np.abs(cols[None, :] - x[:, None]), 0, 1)
            cov *= (dress.smoothstep(-0.02, 0.04, tp) * dress.smoothstep(1.0, 0.8, tp))[:, None] * r.uniform(0.55, 1.0)
            sheen = 0.35 * np.exp(-(((v - r.uniform(0.55, 0.8)) / 0.06) ** 2))
            ccol = (base * r.uniform(0.65, 1.35))[None, :] * (1 + sheen[:, None])
            a = 1 - (1 - a) * (1 - cov)
            c += cov[..., None] * ccol[:, None, :]
            ws += cov
        edge = dress.smoothstep(0, 5, cols) * dress.smoothstep(VW, VW - 5, cols)
        rgba[:, var * VW:(var + 1) * VW, 3] = a * edge[None, :]
        rgba[:, var * VW:(var + 1) * VW, :3] = np.where(ws[..., None] > 1e-4, c / np.maximum(ws, 1e-4)[..., None], base)
    return rgba


img = next(n.image for n in hair.material_slots[0].material.node_tree.nodes if n.type == "TEX_IMAGE")
px = np.empty(len(img.pixels), np.float32)
img.pixels.foreach_get(px)
px = px.reshape(-1, 4)
hair_rgb = px[px[:, 3] > 0.5, :3].mean(0)
locks = dress.mesh_object("girl_hair_locks", verts, faces, uvs, rig)  # noqa: F821
locks.data.materials.append(dress.material("girl_hair_locks", dress.image("girl_hair_locks", lock_tile(hair_rgb)), rough=0.6, alpha=True, double=True))
dress.set_weights(locks, vweights)

rig.animation_data.action = None  # noqa: F821
scene.frame_set(0)  # noqa: F821
print(f"hair: {len(faces)} quads, colour {np.round(hair_rgb, 3)}")
