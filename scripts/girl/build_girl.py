# Builds the girl in white with MPFB (the MakeHuman plugin for Blender) and exports her as glTF.
# Everything MPFB and the MakeHuman system assets produce is CC0; the outfit is our own (dress.py).
#
# Run (Blender 4.2+ with the MPFB extension and the makehuman_system_assets pack installed):
#   blender -b --python scripts/girl/build_girl.py -- <out.glb> [<out.blend>]
#
# The look (decided by Augusto): a girl of about eight in a first communion dress, white lace, a short veil on a wreath
# of small flowers, white socks and shoes, her dark hair in a neat braid. The wrongness is in her face: grey-pale skin,
# dark hollows round red-rimmed eyes, nearly black irises, bloodless lips. Hidden behind her hands while she cries.
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = argv[0] if argv else "/tmp/girl.glb"
OUT_BLEND = argv[1] if len(argv) > 1 else None

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
import dress  # noqa: E402

# Age: 0 is 1 year, 0.1875 is 11, 0.5 is 25; 0.17 is about eight (1.23 m).
HUMAN = {
    "name": "girl",
    "phenotype": {
        "gender": 0.0,
        "age": 0.17,
        "muscle": 0.4,
        "weight": 0.42,
        "proportions": 0.5,
        "height": 0.5,
        "cupsize": 0.5,
        "firmness": 0.5,
        "race": {"caucasian": 0.6, "asian": 0.3, "african": 0.1},
    },
    "targets": [
        {"target": "head-scale-vert-incr", "value": 0.1},
        {"target": "neck-scale-horiz-decr", "value": 0.3},
    ],
    "rig": "game_engine",
    "eyes": "low-poly.mhclo",
    "eyebrows": "eyebrow010.mhclo",
    "eyelashes": "eyelashes02.mhclo",
    "teeth": "",
    "tongue": "",
    "hair": "braid01.mhclo",
    "proxy": "",
    "clothes": ["shoes01.mhclo"],
    "skin_mhmat": "young_caucasian_female.mhmat",
    "skin_material_type": "MAKESKIN",
    "eyes_material_type": "MAKESKIN",
    "clothes_material_type": "MAKESKIN",
    "skin_material_settings": {},
    "eyes_material_settings": {},
    "expressions": [],
}

settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 0
settings["mask_helpers"] = True
# The joint helper groups are what MPFB fits the skeleton to; without them the rig stays at the default adult size.
settings["detailed_helpers"] = True
settings["feet_on_ground"] = False

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

HumanService.deserialize_from_dict(HUMAN, settings)

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="OBJECT")
lowest = min((o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("shoes01") for v in o.data.vertices)
co_b, _ = dress.eval_mesh(next(o for o in bpy.data.objects if o.name.endswith(".body")))
lowest = min(lowest, float(co_b[:, 2].min()))
rig.location.z -= lowest
bpy.context.view_layer.update()
print("lifted by", round(-lowest, 3))

objs = {o.name.split(".", 1)[1] if "." in o.name else o.name: o for o in bpy.data.objects}
body = objs["body"]
shoes = objs["shoes01"]
hair = objs["braid01"]
eyes = objs["low-poly"]


# ---- finger joints onto the finger mesh (as for the guard, see scripts/guard/build_guard.py) ----------------------------
def fit_fingers():
    co, _ = dress.eval_mesh(body)
    names = {g.index: g.name for g in body.vertex_groups}
    weights = [{names[g.group]: g.weight for g in v.groups} for v in body.data.vertices]
    inv = rig.matrix_world.inverted()

    def ring(a, b):
        pts = [co[i] for i, w in enumerate(weights) if 0.2 < w.get(a, 0) < 0.8 and 0.2 < w.get(b, 0) < 0.8]
        return (inv @ Vector(np.mean(pts, axis=0)), len(pts)) if len(pts) >= 4 else (None, len(pts))

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones
    for f in ("thumb", "index", "middle", "ring", "pinky"):
        for s in "lr":
            names3 = [f"{f}_0{i}_{s}" for i in (1, 2, 3)]
            chain = [eb.get(n) for n in names3]
            if None in chain:
                continue
            j0, _ = ring(chain[0].parent.name, names3[0])
            j1, n1 = ring(names3[0], names3[1])
            j2, n2 = ring(names3[1], names3[2])
            if j1 is None or j2 is None:
                continue
            if j0 is None:
                j0 = chain[0].head.copy()
            axis = (j2 - j1).normalized()
            tip_verts = [co[i] for i, w in enumerate(weights) if w.get(names3[2], 0) > 0.5]
            reach = max((inv @ Vector(p) - j2).dot(axis) for p in tip_verts) - 0.004
            for b, h, t in zip(chain, (j0, j1, j2), (j1, j2, j2 + axis * reach)):
                b.use_connect = False
                b.head, b.tail = h, t
    bpy.ops.object.mode_set(mode="OBJECT")


fit_fingers()

# ---- the outfit (dress.py) --------------------------------------------------------------------------------------------
pieces, hidden, marks = dress.add_outfit(rig, body, hair, eyes)

# ---- hide the body where the dress and the shoes cover it ----------------------------------------------------------
from mathutils.bvhtree import BVHTree  # noqa: E402

bco, _ = dress.eval_mesh(body)
under = np.zeros(len(bco), bool)
under[list(hidden)] = True
sco, _ = dress.eval_mesh(shoes)
shoe_tree = BVHTree.FromPolygons([tuple(map(float, c)) for c in sco], [tuple(p.vertices) for p in shoes.data.polygons])
for i, c in enumerate(bco):
    if c[2] > 0.2:
        continue
    hit = shoe_tree.find_nearest(c, 0.05)
    if hit[0] is not None and np.dot(np.array(c) - np.array(hit[0][:]), np.array(hit[1][:])) < 0.003:
        under[i] = True
nbr = [[] for _ in bco]
for e in body.data.edges:
    a, b = e.vertices
    nbr[a].append(b)
    nbr[b].append(a)
for _ in range(2):  # erode, so the skin stays a little way under every hem, collar and cuff
    under = np.array([under[i] and all(under[j] for j in nbr[i]) for i in range(len(bco))])
group = body.vertex_groups.new(name="under_clothes")
group.add([int(i) for i in np.nonzero(under)[0]], 1.0, "REPLACE")
mask = body.modifiers.new("Hide under clothes", "MASK")
mask.vertex_group = "under_clothes"
mask.invert_vertex_group = True
print("hidden body vertices", int(under.sum()), "of", len(bco))


# ---- textures ------------------------------------------------------------------------------------------------------------
def pixels(img):
    a = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def diffuse_of(o):
    for n in o.material_slots[0].material.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.name == "diffuseTexture":
            return n.image
    raise RuntimeError("no diffuse on " + o.name)


def sized(img, size):
    if img.size[0] != size:
        img = img.copy()
        img.scale(size, size)
    return img


def lum(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


def simple(name, px, rough, alpha=False):
    return dress.material(name, dress.image(name, px if alpha else px[..., :3]), rough=rough, alpha=alpha)


# skin: a Costa Rican child's tone, drained toward a cold grey pallor
SK = 1024
skin = pixels(sized(diffuse_of(body), SK)).copy()
rgb = skin[..., :3] * np.array([0.93, 0.84, 0.76])
L = lum(rgb)[..., None]
rgb = rgb * 0.5 + L * np.array([0.9, 0.93, 1.0]) * 0.5
# the face: dark hollows round red-rimmed eyes, bloodless lips. Painted through the surface of the face.
eco, _ = dress.eval_mesh(eyes)
eye_c = [eco[eco[:, 0] > 0].mean(0), eco[eco[:, 0] < 0].mean(0)]
bco_all, _ = dress.eval_mesh(body)
uvl = body.data.uv_layers.active.data
names = {g.index: g.name for g in body.vertex_groups}
helper_g = body.vertex_groups.get("HelperGeometry")
helpers = {v.index for v in body.data.vertices if any(g.group == helper_g.index for g in v.groups)} if helper_g else set()
lips = {v.index for v in body.data.vertices if any(names[g.group] == "lips" and g.weight > 0.5 for g in v.groups)}
tri_uv, tri_pos, lip_tri = [], [], []
for p in body.data.polygons:
    idx = list(p.vertices)
    if any(i in helpers for i in idx):
        continue
    cen = bco_all[idx].mean(0)
    if min(np.linalg.norm(cen - e) for e in eye_c) > 0.09:
        continue
    lis = list(p.loop_indices)
    for k in range(1, len(idx) - 1):
        tri_uv.append([uvl[lis[0]].uv[:], uvl[lis[k]].uv[:], uvl[lis[k + 1]].uv[:]])
        tri_pos.append([bco_all[idx[0]], bco_all[idx[k]], bco_all[idx[k + 1]]])
        lip_tri.append(all(i in lips for i in idx))
P = dress.rasterize(tri_uv, tri_pos, SK, SK)
face = ~np.isnan(P[..., 0])
P = np.nan_to_num(P, nan=99.0)
dark = np.zeros((SK, SK))
red = np.zeros((SK, SK))
for e in eye_c:
    q = ((P[..., 0] - e[0]) / 0.024) ** 2 + ((P[..., 2] - (e[2] - 0.006)) / 0.019) ** 2
    front = P[..., 1] < e[1] + 0.012
    dark = np.maximum(dark, np.exp(-q * 1.4) * front)
    red = np.maximum(red, np.exp(-(((np.sqrt(q) - 0.42) / 0.16) ** 2)) * front)
Lf = lum(rgb)[..., None]
bruise = Lf * np.array([0.62, 0.5, 0.58])
rgb = rgb * (1 - 0.62 * dark[..., None]) + bruise * 0.62 * dark[..., None] * 0.55
rgb = rgb * (1 - 0.3 * red[..., None]) + np.array([0.55, 0.27, 0.28]) * 0.3 * red[..., None] * (Lf / 0.6)
lip_px = dress.rasterize([t for t, l in zip(tri_uv, lip_tri) if l], [t for t, l in zip(tri_pos, lip_tri) if l], SK, SK)
lipm = ~np.isnan(lip_px[..., 0])
rgb = np.where(lipm[..., None], rgb * 0.45 + lum(rgb)[..., None] * np.array([0.88, 0.76, 0.78]) * 0.55, rgb)
skin[..., :3] = rgb
body.data.materials.clear()
body.data.materials.append(simple("girl_skin", skin, 0.6))

# shoes: the brown leather becomes white patent with scuffed toes; the white socks stay as they are
sh = pixels(sized(diffuse_of(shoes), 512)).copy()
sat = sh[..., :3].max(-1) - sh[..., :3].min(-1)
Ls = lum(sh[..., :3])
leather = sat > 0.08
white = np.clip(0.9 * (Ls / max(1e-3, float(Ls[leather].mean()))) ** 0.35, 0.55, 0.97)[..., None] * np.array([0.98, 0.97, 0.95])
sock = np.clip(0.93 * (Ls / max(1e-3, float(Ls[~leather].mean()))) ** 0.3, 0.75, 0.97)[..., None] * np.array([0.96, 0.96, 0.95])
sh[..., :3] = np.where(leather[..., None], white, sock)
shoes.data.materials.clear()
shoes.data.materials.append(simple("girl_shoes", sh, 0.3))

# hair: very dark brown
hp = pixels(sized(diffuse_of(hair), 512)).copy()
hp[..., :3] = hp[..., :3] * 0.42 * np.array([1.0, 0.9, 0.82])
hair.data.materials.clear()
hair.data.materials.append(simple("girl_braid01", hp, 0.7, alpha=True))
for key in ("eyebrow010", "eyelashes02"):
    o = objs[key]
    px = pixels(sized(diffuse_of(o), 256)).copy()
    o.data.materials.clear()
    o.data.materials.append(simple("girl_" + key, px, 0.8, alpha=True))
# eyes: nearly black irises, dull grey whites
ep = pixels(sized(diffuse_of(eyes), 256)).copy()
el = lum(ep[..., :3])[..., None]
ep[..., :3] = np.where(el < 0.45, ep[..., :3] * 0.2 * np.array([0.9, 0.85, 0.85]), el * np.array([0.8, 0.79, 0.76]))
eyes.data.materials.clear()
eyes.data.materials.append(simple("girl_eyes", ep, 0.15))

bpy.ops.object.select_all(action="DESELECT")
if OUT_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_skins=True,
    export_morph=False,
    export_animations=False,
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
)
print("exported", OUT_GLB)
