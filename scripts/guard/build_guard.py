# Builds the guard character with MPFB (the MakeHuman plugin for Blender) and exports it as glTF.
# Everything MPFB and the MakeHuman system assets produce is CC0.
#
# Run (Blender 4.2+ with the MPFB extension and the makehuman_system_assets pack installed):
#   blender -b --factory-startup=false --python scripts/guard/build_guard.py -- <out.glb> [<out.blend>]
#
# The look follows the guard in reference/photos/entrance_concourse-near-entrance.jpg: a stocky man in his
# forties, short dark hair, a light grey short-sleeve shirt under a black knit vest, black trousers and shoes.
# The clothes' colors are repainted later (scripts/guard/paint.mts); here we only choose the shapes.
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = argv[0] if argv else "/tmp/guard.glb"
OUT_BLEND = argv[1] if len(argv) > 1 else None

from bl_ext.blender_org.mpfb.services.humanservice import HumanService  # noqa: E402

# Age: 0.5 is 25 years, 1.0 is 90, so 0.7 is about 50.
HUMAN = {
    "name": "guard",
    "phenotype": {
        "gender": 1.0,
        "age": 0.7,
        "muscle": 0.55,
        "weight": 0.9,
        "proportions": 0.45,
        "height": 0.5,
        "cupsize": 0.5,
        "firmness": 0.45,
        # Costa Rican mestizo: mostly European and Indigenous features (MakeHuman's "asian" covers the latter best)
        "race": {"caucasian": 0.6, "asian": 0.3, "african": 0.1},
    },
    "targets": [
        {"target": "stomach-pregnant-incr", "value": 0.5},  # the belly
        {"target": "neck-scale-horiz-incr", "value": 0.4},
        {"target": "neck-scale-depth-incr", "value": 0.3},
        {"target": "neck-double-incr", "value": 0.3},
        {"target": "measure-shoulder-dist-incr", "value": 0.2},
        # MakeHuman's default fingers are long and thin: shorter, thicker, for a heavy-set man's hands. These targets
        # move the mesh but not the rig's finger joints; fit_fingers() below moves the joints to match.
        *({"target": f"{s}-hand-fingers-length-decr", "value": 0.6} for s in "lr"),
        *({"target": f"{s}-hand-fingers-diameter-incr", "value": 0.6} for s in "lr"),
    ],
    "rig": "game_engine",
    "eyes": "low-poly.mhclo",
    "eyebrows": "eyebrow001.mhclo",
    "eyelashes": "eyelashes01.mhclo",
    "teeth": "",
    "tongue": "",
    "hair": "short01.mhclo",
    "proxy": "",
    "clothes": ["male_casualsuit06.mhclo", "shoes04.mhclo"],
    "skin_mhmat": "middleage_caucasian_male.mhmat",
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
settings["detailed_helpers"] = False
# MPFB's feet_on_ground moves the mesh after the rig has been fitted, so the joints end up 0.85 m below the body.
# Build centred instead, and lift the armature object (which carries the meshes) after.
settings["feet_on_ground"] = False

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

basemesh = HumanService.deserialize_from_dict(HUMAN, settings)

import numpy as np  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
lowest = min((o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == "MESH" for v in o.data.vertices)
rig.location.z -= lowest
bpy.context.view_layer.update()
print("lifted by", round(-lowest, 3))

objs = {o.name.split(".", 1)[1] if "." in o.name else o.name: o for o in bpy.data.objects}
body = objs["body"]
suit = objs["male_casualsuit06"]
shoes = objs["shoes04"]
depsgraph = bpy.context.evaluated_depsgraph_get()


def world_coords(o):
    """Vertex positions with shape keys applied, indexed like the original mesh (modifiers that drop vertices are off)."""
    masks = [m for m in o.modifiers if m.type == "MASK"]
    for m in masks:
        m.show_viewport = False
    bpy.context.view_layer.update()
    e = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = e.to_mesh()
    co = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices])
    e.to_mesh_clear()
    for m in masks:
        m.show_viewport = True
    return co


# ---- finger joints onto the finger mesh -------------------------------------------------------------------------------
# MPFB's fitted finger joints do not sit where the skin's weights bend (they are centimetres off, more so with the
# finger targets above), so a curled finger stretches into a long, thin claw. Each joint is moved to the middle of the
# ring of skin that blends between its two bones; the last tail goes just inside the fingertip.
def fit_fingers():
    co = world_coords(body)
    names = {g.index: g.name for g in body.vertex_groups}
    weights = [{names[g.group]: g.weight for g in v.groups} for v in body.data.vertices]
    inv = rig.matrix_world.inverted()

    def ring(a, b):
        """Centre of the skin shared by bones a and b (both weights mid-way)."""
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
            j0, n0 = ring(chain[0].parent.name, names3[0])
            j1, n1 = ring(names3[0], names3[1])
            j2, n2 = ring(names3[1], names3[2])
            if j1 is None or j2 is None:
                print(f"fit {f}_{s}: skipped ({n1}, {n2} ring vertices)")
                continue
            if j0 is None:
                j0 = chain[0].head.copy()
            axis = (j2 - j1).normalized()
            tip_verts = [co[i] for i, w in enumerate(weights) if w.get(names3[2], 0) > 0.5]
            reach = max((inv @ Vector(p) - j2).dot(axis) for p in tip_verts) - 0.005
            tip = j2 + axis * reach
            for b, h, t in zip(chain, (j0, j1, j2), (j1, j2, tip)):
                b.use_connect = False
                b.head, b.tail = h, t
            print(f"fit {f}_{s}: " + ", ".join(f"{b.length * 100:.1f}" for b in chain) + " cm")
    bpy.ops.object.mode_set(mode="OBJECT")


from mathutils import Vector  # noqa: E402

fit_fingers()


# ---- hide the body wherever the clothes cover it (it pokes through at the knees and belly, and costs triangles) -------
cloth_trees = []
for o in (suit, shoes):
    co = world_coords(o)
    cloth_trees.append(BVHTree.FromPolygons([tuple(map(float, c)) for c in co], [tuple(p.vertices) for p in o.data.polygons]))
bco = world_coords(body)
under = np.zeros(len(bco), bool)
for i, c in enumerate(bco):
    for tree in cloth_trees:
        hit = tree.find_nearest(c, 0.06)
        if hit[0] is None:
            continue
        p, n = hit[0], hit[1]
        d = (c[0] - p[0], c[1] - p[1], c[2] - p[2])
        if d[0] * n[0] + d[1] * n[1] + d[2] * n[2] < 0.004:  # behind (inside) the cloth surface, or just on it
            under[i] = True
            break
# erode by two rings, so the skin stays a little way under every hem, collar and cuff
nbr = [[] for _ in bco]
for e in body.data.edges:
    a, b = e.vertices
    nbr[a].append(b)
    nbr[b].append(a)
for _ in range(2):
    under = np.array([under[i] and all(under[j] for j in nbr[i]) for i in range(len(bco))])
group = body.vertex_groups.new(name="under_clothes")
group.add([int(i) for i in np.nonzero(under)[0]], 1.0, "REPLACE")
mask = body.modifiers.new("Hide under clothes", "MASK")
mask.vertex_group = "under_clothes"
mask.invert_vertex_group = True
print("hidden body vertices", int(under.sum()), "of", len(bco))


# ---- textures: repaint to the photo's colors ---------------------------------------------------------------------------
def pixels(img):
    a = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def new_image(name, arr, size=1024):
    h, w, _ = arr.shape
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    if w > size:
        im.scale(size, size)
    im.pack()
    return im


def diffuse_of(o):
    for n in o.material_slots[0].material.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.name == "diffuseTexture":
            return n.image
    raise RuntimeError("no diffuse on " + o.name)


def normal_of(o):
    for n in o.material_slots[0].material.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.name == "normalmapTexture":
            return n.image
    return None


def simple_material(name, image, normal=None, rough=0.85, alpha=False):
    """A plain Principled material the glTF exporter understands (MakeSkin node setups do not export cleanly)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha:
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    if normal is not None:
        nt_tex = nt.nodes.new("ShaderNodeTexImage")
        nt_tex.image = normal
        normal.colorspace_settings.name = "Non-Color"
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nt_tex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def lum(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


src = pixels(diffuse_of(suit))
h, w, _ = src.shape
L = lum(src)
rows = np.arange(h)[:, None] / h  # v of each row (row 0 is v = 0)
shirt_rows = rows > 0.6
# shirt: light grey #8e939c with the folds kept; the dark print is lifted out
fold = np.clip(np.maximum(L, 0.72) / 0.84, 0.7, 1.12)
shirt = np.array([0.557, 0.576, 0.612])[None, None, :] * fold[..., None]
# trousers: near black, the denim fading squeezed down to a little sheen
denim = np.clip((L / max(1e-3, float(L[~shirt_rows[:, 0]].mean()))) ** 0.5, 0.7, 1.35)
trousers = np.array([0.055, 0.058, 0.066])[None, None, :] * denim[..., None]
clothes = np.where(shirt_rows[..., None], shirt, trousers)
clothes = np.concatenate([clothes, np.ones((h, w, 1), np.float32)], axis=2)
# ---- the vest, painted into the shirt's texture: every texel of the shirt is placed back on the body (through its
# triangle), and the texels on the torso, outside a V at the neck and inside the armholes, become black knit. Done in
# texture space, so the edges are smooth lines, not the stairs of the mesh's faces.
sco = world_coords(suit)
z_top = float(sco[:, 2].max())
V_BOTTOM = z_top - 0.27  # the point of the V
SHOULDER = z_top - 0.16  # where the armholes start to cut in


def vest_edge(x, y, z):
    """Signed distance (m, roughly) inside the vest: positive inside, negative outside."""
    ax = np.abs(x)
    arm = np.where(z < SHOULDER, 0.178, 0.178 - (z - SHOULDER) * 0.6) - ax
    arm = np.where(z < SHOULDER - 0.1, 1.0, arm)  # below the armpits the vest wraps the whole body
    vneck = np.where((y < 0) & (z > V_BOTTOM), ax - 0.105 * (z - V_BOTTOM) / (z_top - V_BOTTOM), 1.0)
    return np.minimum(arm, vneck)


me = suit.data
me.calc_loop_triangles()
uv_layer = me.uv_layers.active.data
inside = np.full((h, w), -1.0, np.float32)  # vest distance per texel, -1 where no triangle of the shirt covers it
covered = np.zeros((h, w), bool)
hem_z = None
for tri in me.loop_triangles:
    uv = np.array([uv_layer[li].uv[:] for li in tri.loops]) * [w, h]
    if uv[:, 1].mean() < 0.6 * h:
        continue  # trousers
    P = sco[list(tri.vertices)]
    x0, y0 = np.floor(uv.min(0)).astype(int)
    x1, y1 = np.ceil(uv.max(0)).astype(int)
    xs, ys = np.meshgrid(np.arange(max(0, x0), min(w, x1 + 1)) + 0.5, np.arange(max(0, y0), min(h, y1 + 1)) + 0.5)
    if xs.size == 0:
        continue
    (ax_, ay_), (bx, by), (cx, cy) = uv
    den = (by - cy) * (ax_ - cx) + (cx - bx) * (ay_ - cy)
    if abs(den) < 1e-9:
        continue
    l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
    l2 = ((cy - ay_) * (xs - cx) + (ax_ - cx) * (ys - cy)) / den
    l3 = 1 - l1 - l2
    m = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
    if not m.any():
        continue
    pos = l1[..., None] * P[0] + l2[..., None] * P[1] + l3[..., None] * P[2]
    d = vest_edge(pos[..., 0], pos[..., 1], pos[..., 2])
    iy = (ys[m] - 0.5).astype(int)
    ix = (xs[m] - 0.5).astype(int)
    inside[iy, ix] = d[m]
    covered[iy, ix] = True
# spread into the gutters between UV islands, so mipmaps do not bleed grey into the vest's seams
for _ in range(6):
    grown = inside.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        grown = np.maximum(grown, np.roll(np.roll(inside, dy, 0), dx, 1))
    inside = np.where(covered, inside, grown)
    covered = covered | (grown > -1)

u = np.arange(w)[None, :]
v_ = np.arange(h)[:, None]
rib = 0.8 + 0.2 * (0.5 + 0.5 * np.sin(u * 2 * np.pi / 7))  # vertical knit ribs (the panels run vertically in this layout)
band_rib = 0.8 + 0.2 * (0.5 + 0.5 * np.sin((u + v_) * 2 * np.pi / 5))  # the binding's finer rib
knit = np.array([0.04, 0.043, 0.05])[None, None, :] * (fold[..., None] ** 1.5)
body_knit = knit * rib[..., None]
binding = knit * 1.25 * band_rib[..., None]
is_vest = (inside > 0) & shirt_rows
is_band = is_vest & (inside < 0.014)
aa = np.clip(inside / 0.003, 0, 1)[..., None]  # a soft edge, a few millimetres wide
vest_rgb = np.where(is_band[..., None], binding, body_knit)
rgb = clothes[..., :3]
clothes[..., :3] = np.where(shirt_rows[..., None], rgb * (1 - aa) + vest_rgb * aa, rgb)

clothes_mat = simple_material("guard_clothes", new_image("guard_clothes", clothes), normal_of(suit), 0.9)
suit.data.materials.clear()
suit.data.materials.append(clothes_mat)

# skin: warmer and darker than the light-skinned base
skin = pixels(diffuse_of(body))
skin[..., :3] *= np.array([0.86, 0.72, 0.6])[None, None, :]
skin_mat = simple_material("guard_skin", new_image("guard_skin", skin), None, 0.6)
body.data.materials.clear()
body.data.materials.append(skin_mat)

shoe_mat = simple_material("guard_shoes", new_image("guard_shoes", pixels(diffuse_of(shoes)), 512), None, 0.55)
shoes.data.materials.clear()
shoes.data.materials.append(shoe_mat)

for key in ("short01", "eyebrow001", "eyelashes01"):
    o = objs[key]
    img = diffuse_of(o)
    px = pixels(img)
    if key == "short01":
        px[..., :3] *= 0.55  # dark, almost black hair
    mat = simple_material("guard_" + key, new_image("guard_" + key, px, 512), None, 0.8, alpha=True)
    o.data.materials.clear()
    o.data.materials.append(mat)
eyes = objs["low-poly"]
eye_px = pixels(diffuse_of(eyes))
eye_l = lum(eye_px)[..., None]
eye_px[..., :3] = eye_px[..., :3] * 0.45 + eye_l * 0.55  # the stock brown iris reads red under a flashlight: mostly grey
eye_px[..., :3] *= np.where(eye_l < 0.4, 0.6, 1.0)  # and darker
eye_mat = simple_material("guard_eyes", new_image("guard_eyes", eye_px, 256), None, 0.2)
eyes.data.materials.clear()
eyes.data.materials.append(eye_mat)

# ---- gear: the "SEGURIDAD" cap and the chest badge (scripts/guard/gear.py) --------------------------------------------
sys.path.insert(0, __import__("os").path.dirname(__file__))
import gear  # noqa: E402

gear.add_cap(rig, body, objs["short01"], objs["eyebrow001"])
gear.add_badge(rig, suit)

bpy.ops.object.select_all(action="DESELECT")
if OUT_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=True,
    export_apply=True,  # applies the modifiers: the mask that hides helpers and the body under the clothes
    export_skins=True,
    export_morph=False,
    export_animations=False,
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
)
print("exported", OUT_GLB)
