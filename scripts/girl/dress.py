# The girl in white's communion outfit, modeled by script (MakeHuman ships no dress, veil or wreath; Poly Haven has no
# clothing):
#   - the dress: a fitted bodice with pin tucks (the body's own surface, pushed out), short puff sleeves, a full
#     two-tier gathered skirt to mid-calf, scalloped lace at both hems, a lace collar and lace cuffs, a satin sash with
#     a bow and two tails at the back, and four pearl buttons down the back;
#   - a short tulle veil with a lace edge, hanging from a wreath of small white flowers with pearl centers.
# Imported by build_girl.py. Everything is skinned: the bodice keeps the body's own weights, the skirt follows the
# pelvis and (lower down) the thighs, the wreath and veil follow the head.
import math

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

# ---- shared helpers ----------------------------------------------------------------------------------------------

ARM = ("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")
HEAD = ("head", "neck_01")


def eval_mesh(o):
    """World positions and normals of an evaluated mesh, indexed like the original (mask modifiers are switched off)."""
    masks = [m for m in o.modifiers if m.type == "MASK"]
    for m in masks:
        m.show_viewport = False
    bpy.context.view_layer.update()
    e = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = e.to_mesh()
    mw = o.matrix_world
    co = np.array([(mw @ v.co)[:] for v in me.vertices])
    nm = np.array([(mw.to_3x3() @ v.normal).normalized()[:] for v in me.vertices])
    e.to_mesh_clear()
    for m in masks:
        m.show_viewport = True
    return co, nm


def bvh_of(objs):
    verts, polys = [], []
    for o in objs:
        e = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = e.to_mesh()
        base = len(verts)
        verts += [(o.matrix_world @ v.co)[:] for v in me.vertices]
        polys += [tuple(base + i for i in p.vertices) for p in me.polygons]
        e.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys)


def mesh_object(name, verts, faces, uvs, rig):
    """A mesh in world coordinates, parented to and deformed by the rig. uvs: one (u, v) per face corner, in face order."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    layer = me.uv_layers.new(name="UVMap")
    for i, uv in enumerate(uvs):
        layer.data[i].uv = (float(uv[0]), float(uv[1]))
    me.validate()
    me.shade_smooth()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.parent = rig
    o.matrix_parent_inverse = rig.matrix_world.inverted()
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return o


def set_weights(o, per_vertex):
    """per_vertex: one {bone: weight} per vertex; the four strongest are kept and normalised."""
    groups = {}
    for i, w in enumerate(per_vertex):
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        total = sum(v for _, v in top) or 1.0
        for bone, v in top:
            if v / total < 0.01:
                continue
            g = groups.get(bone) or o.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([i], v / total, "REPLACE")


class WeightSource:
    """Skin weights borrowed from the nearest vertices of a mesh (the body, minus the arms and head)."""

    def __init__(self, co, weights, keep):
        self.weights = [weights[i] for i in keep]
        self.tree = KDTree(len(keep))
        for j, i in enumerate(keep):
            self.tree.insert(co[i], j)
        self.tree.balance()

    def at(self, p, k=4):
        out = {}
        found = self.tree.find_n(Vector(p), k)
        for _, j, d in found:
            f = 1.0 / max(d, 1e-4)
            for b, w in self.weights[j].items():
                out[b] = out.get(b, 0.0) + w * f
        return out


def image(name, rgba):
    h, w, c = rgba.shape
    im = bpy.data.images.new(name, w, h, alpha=(c == 4))
    if c == 3:
        rgba = np.concatenate([rgba, np.ones((h, w, 1))], axis=2)
    im.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    im.pack()
    return im


def material(name, img=None, color=(1, 1, 1), rough=0.7, alpha=False, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    if img is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    m.use_backface_culling = not double
    return m


def noise(h, w, cells, seed):
    """Smooth value noise in [0, 1] (bilinear upsampling of a coarse random grid), tiling in x."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1))
    g[:, -1] = g[:, 0]
    y = np.linspace(0, cells, h, endpoint=False)
    x = np.linspace(0, cells, w, endpoint=False)
    y0, x0 = y.astype(int), x.astype(int)
    fy, fx = (y - y0)[:, None], (x - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = g[y0][:, x0], g[y0][:, x0 + 1]
    c, d = g[y0 + 1][:, x0], g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def rasterize(tri_uv, tri_pos, h, w):
    """3D position of every texel covered by a triangle (uv in 0-1, positions in world). NaN where nothing covers it;
    the result is grown a few texels into the gutters so mipmaps do not bleed."""
    pos = np.full((h, w, 3), np.nan)
    for uv, P in zip(tri_uv, tri_pos):
        uv = np.asarray(uv) * [w, h]
        x0, y0 = np.floor(uv.min(0)).astype(int)
        x1, y1 = np.ceil(uv.max(0)).astype(int)
        xs, ys = np.meshgrid(np.arange(max(0, x0), min(w, x1 + 1)) + 0.5, np.arange(max(0, y0), min(h, y1 + 1)) + 0.5)
        if xs.size == 0:
            continue
        (ax, ay), (bx, by), (cx, cy) = uv
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        l3 = 1 - l1 - l2
        m = (l1 >= -0.03) & (l2 >= -0.03) & (l3 >= -0.03)
        if not m.any():
            continue
        P = np.asarray(P)
        p = l1[..., None] * P[0] + l2[..., None] * P[1] + l3[..., None] * P[2]
        pos[(ys[m] - 0.5).astype(int), (xs[m] - 0.5).astype(int)] = p[m]
    for _ in range(4):
        hole = np.isnan(pos[..., 0])
        if not hole.any():
            break
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb = np.roll(np.roll(pos, dy, 0), dx, 1)
            take = hole & ~np.isnan(nb[..., 0])
            pos[take] = nb[take]
            hole = np.isnan(pos[..., 0])
    return pos


# ---- fabric colors (sRGB) ---------------------------------------------------------------------------------------------

SATIN = np.array([0.905, 0.895, 0.87])
LACE = np.array([0.93, 0.915, 0.875])
DUST = np.array([0.47, 0.43, 0.38])


def satin_tile(size=256, seed=1):
    """A small tiling satin: a fine weave and a faint, soft sheen."""
    u = np.arange(size)[None, :]
    v = np.arange(size)[:, None]
    weave = 0.97 + 0.03 * (0.5 + 0.5 * np.sin((u * 2 + v) * 2 * np.pi / 6))
    sheen = 0.94 + 0.08 * noise(size, size, 6, seed)
    speck = 1 - 0.04 * (np.random.default_rng(seed).random((size, size)) > 0.985)
    return SATIN[None, None, :] * (weave * sheen * speck)[..., None]


def lace_tile():
    """512x256 lace (RGBA), two scallops wide, the scalloped edge at the bottom (v = 0), the tape at the top.
    Alpha 0 is a hole: the scallop's outline, the eyelets, the net between the flowers, the flower centers."""
    W, H = 512, 256
    x = np.arange(W)[None, :] + 0.5
    y = np.arange(H)[:, None] + 0.5
    X = np.broadcast_to(x, (H, W))
    Y = np.broadcast_to(y, (H, W))
    shade = np.full((H, W), 0.95)
    alpha = np.ones((H, W))
    dx = (X % 256) - 128
    edge = 52 * (1 - np.sqrt(np.clip(1 - (dx / 128) ** 2, 0, 1)))  # the scallop's outline: lowest at its middle
    alpha[Y < edge] = 0
    # picots: little loops all along the scalloped edge
    pic = np.hypot((X % 18) - 9, Y - edge + 2) < 5
    alpha[pic & (Y >= edge - 6)] = 1
    cord = np.abs(Y - edge - 9) < 3  # the corded outline that follows the scallop
    shade[cord] = 0.74
    # eyelets inside each scallop
    for cx, cy, r in ((128, 34, 10), (78, 50, 6), (178, 50, 6), (38, 64, 5), (218, 64, 5)):
        d = np.hypot(dx + 128 - cx, Y - cy)
        shade[(d > r) & (d < r + 3)] = 0.76
        alpha[d <= r] = 0
    # flowers between the scallop and the tape, with leaves where two scallops meet
    fx, fy = (X % 256) - 128, Y - 160
    ang = np.arctan2(fy, fx)
    rad = np.hypot(fx, fy)
    petal = rad < 44 * (0.55 + 0.45 * np.abs(np.cos(ang * 2.5)))
    petal_edge = petal & ~(rad < 44 * (0.55 + 0.45 * np.abs(np.cos(ang * 2.5))) - 4)
    lx = ((X + 128) % 256) - 128
    leaf = np.zeros_like(petal)
    for cy, tilt in ((132, 0.5), (190, -0.5)):
        ux = lx * math.cos(tilt) + (Y - cy) * math.sin(tilt)
        uy = -lx * math.sin(tilt) + (Y - cy) * math.cos(tilt)
        leaf |= (ux / 30) ** 2 + (uy / 11) ** 2 < 1
    motif = petal | leaf
    zone = (Y > 82) & (Y < 236)
    # the net: a hexagonal mesh of small holes wherever there is no flower or leaf
    hx = X / 12
    hy = Y / (12 * 0.866)
    row = np.floor(hy)
    hxs = hx - 0.5 * (row % 2)
    hd = np.hypot((hxs - np.round(hxs)) * 12, (hy - row - 0.5) * 12 * 0.866)
    net_hole = zone & ~motif & (hd < 4.2)
    alpha[net_hole] = 0
    shade[zone & ~motif] = 0.88
    shade[petal_edge | (leaf & ~((((lx * 0.9) / 30) ** 2 + ((Y - 132) / 9) ** 2 < 1) | (((lx * 0.9) / 30) ** 2 + ((Y - 190) / 9) ** 2 < 1)))] = 0.72
    alpha[rad < 9] = 0  # the flower's open centre
    shade[(rad >= 9) & (rad < 14)] = 0.7
    # the tape at the top, with a row of beading holes for a ribbon
    tape = Y >= 236
    shade[tape] = 0.93
    shade[np.abs(Y - 238) < 1.2] = 0.78
    bead = tape & (np.hypot((X % 20) - 10, Y - 247) < 3.5)
    alpha[bead] = 0
    rgb = LACE[None, None, :] * shade[..., None]
    return np.concatenate([rgb, alpha[..., None]], axis=2)


def tulle_tile():
    """128² tulle net (RGBA): thin threads round hexagonal holes, mostly see-through."""
    S = 128
    x = np.arange(S)[None, :] + 0.5
    y = np.arange(S)[:, None] + 0.5
    hy = y / (8 * 0.866)
    row = np.floor(hy)
    hx = x / 8 - 0.5 * (row % 2)
    d = np.hypot((hx - np.round(hx)) * 8, (hy - row - 0.5) * 8 * 0.866)
    a = np.where(d > 3.0, 0.5, 0.07)
    a = np.broadcast_to(a, (S, S))
    rgb = np.broadcast_to(LACE, (S, S, 3)) * 0.98
    return np.concatenate([rgb, a[..., None]], axis=2)


# ---- the outfit ---------------------------------------------------------------------------------------------------


def add_outfit(rig, body, hair, eyes):
    """Builds every piece; returns (pieces, hidden body vertex indices)."""
    co, nm = eval_mesh(body)
    names = {g.index: g.name for g in body.vertex_groups}
    bones = {b.name for b in rig.data.bones}
    weights = [{names[g.group]: g.weight for g in v.groups if names[g.group] in bones and g.weight > 0.001} for v in body.data.vertices]
    dom = [max(w, key=w.get) if w else "" for w in weights]
    is_arm = np.array([d.startswith(ARM) for d in dom])
    is_head = np.array([d.startswith(HEAD) for d in dom])
    is_leg = np.array([d.startswith(("thigh", "calf", "foot", "ball")) for d in dom])
    # MPFB's helper geometry (invisible fitting shapes for hair, tights, skirts) is part of the body mesh: never use it
    helper_g = body.vertex_groups.get("HelperGeometry")
    helper = np.array([any(g.group == helper_g.index for g in v.groups) for v in body.data.vertices]) if helper_g else np.zeros(len(co), bool)
    is_arm &= ~helper
    is_head &= ~helper
    is_leg &= ~helper
    mw = rig.matrix_world

    def bone_head(n):
        return np.array((mw @ rig.data.bones[n].head_local)[:])

    def bone_tail(n):
        return np.array((mw @ rig.data.bones[n].tail_local)[:])

    neck = bone_head("neck_01")
    knee = bone_head("calf_l")
    ankle = bone_head("foot_l")
    torso_mask = ~is_arm & ~is_head & ~is_leg & ~helper
    # the waist: the narrowest band of the torso between the hips and the chest
    zs = co[torso_mask, 2]
    pelvis_z = bone_head("pelvis")[2]
    best, waist_z = 9.0, pelvis_z
    for z in np.linspace(pelvis_z + 0.04, bone_head("spine_03")[2], 30):
        band = torso_mask & (np.abs(co[:, 2] - z) < 0.008)
        if band.sum() < 8:
            continue
        width = np.ptp(co[band, 0])
        if width < best:
            best, waist_z = width, z
    cy = float(np.mean(co[torso_mask & (np.abs(co[:, 2] - waist_z) < 0.01), 1]))
    hem_z = knee[2] - 0.5 * (knee[2] - ankle[2])
    print(f"outfit: waist {waist_z:.3f}, hem {hem_z:.3f}, neck {neck[2]:.3f}, height {co[:, 2].max():.3f}")

    src = WeightSource(co, weights, [i for i in range(len(co)) if torso_mask[i] or is_leg[i]])
    pieces = []

    # ---- bodice and puff sleeves: the body's own faces, pushed out ---------------------------------------------------
    SLEEVE = 0.085
    sides = {}
    for s in "lr":
        a, b = bone_head(f"upperarm_{s}"), bone_tail(f"upperarm_{s}")
        sides[s] = (a, (b - a) / np.linalg.norm(b - a))
    rel = co - [0, cy, 0]
    front = np.clip(-rel[:, 1] / np.maximum(np.hypot(rel[:, 0], rel[:, 1]), 1e-6), 0, 1)
    neckline = neck[2] - 0.012 - 0.034 * front ** 3  # a little under the collar's inner edge, which hides it
    inc = np.zeros(len(co), bool)
    sleeve_s = np.full(len(co), -1.0)
    for i in range(len(co)):
        z = co[i, 2]
        if z < waist_z - 0.022 or helper[i]:
            continue
        w = weights[i]
        arm_w = sum(v for b, v in w.items() if b.startswith(ARM))
        if arm_w > 0.3:
            s = "l" if co[i, 0] > 0 else "r"
            a, d = sides[s]
            along = float(np.dot(co[i] - a, d))
            if not w.get(f"upperarm_{s}", 0) > 0.3 or along > SLEEVE:
                continue
            sleeve_s[i] = max(0.0, along)
            inc[i] = True
        elif z < neckline[i] and not is_head[i] or (is_head[i] and z < neckline[i] - 0.004):
            inc[i] = True
    uvl = body.data.uv_layers.active.data
    # The body's chest has small details built from cones of tiny faces; flattened into cloth they fold over and shade
    # as dots. Those faces are cut out, and each hole is closed with a plain fan of triangles round a new vertex.
    detail_groups = {g.index for g in body.vertex_groups if g.name in ("nipple", "nippleTip")}
    detail = {v.index for v in body.data.vertices if any(gr.group in detail_groups for gr in v.groups)}
    body_nbr = {}
    for e in body.data.edges:
        a, b = e.vertices
        body_nbr.setdefault(a, set()).add(b)
        body_nbr.setdefault(b, set()).add(a)
    detail |= {n_ for v in list(detail) for n_ in body_nbr.get(v, ())}
    chosen = [p for p in body.data.polygons if all(inc[v] for v in p.vertices)]
    faces = [(list(p.vertices), [uvl[li].uv[:] for li in p.loop_indices]) for p in chosen if not any(v in detail for v in p.vertices)]
    cut_edges = {tuple(sorted(e)) for p in chosen if any(v in detail for v in p.vertices) for e in p.edge_keys}
    directed = {(vs[k], vs[(k + 1) % len(vs)]) for vs, _ in faces for k in range(len(vs))}
    vert_uv = {}
    for vs, uvs_ in faces:
        for v, uv in zip(vs, uvs_):
            vert_uv.setdefault(v, uv)
    hole = {a: b for a, b in directed if (b, a) not in directed and tuple(sorted((a, b))) in cut_edges}
    extra = []  # (position, normal, weights) of each fan centre, appended after the body's vertices
    while hole:
        a0, b = hole.popitem()
        loop = [a0, b]
        while b in hole and hole[b] != a0:
            b = hole.pop(b)
            loop.append(b)
        hole.pop(b, None)
        if len(loop) < 4:
            continue
        c = len(co) + len(extra)
        wsum = {}
        for v in loop:
            for bn_, x in weights[v].items():
                wsum[bn_] = wsum.get(bn_, 0.0) + x / len(loop)
        nrm = nm[loop].mean(0)
        extra.append((co[loop].mean(0), nrm / np.linalg.norm(nrm), wsum))
        uv_c = tuple(np.mean([vert_uv[v] for v in loop], axis=0))
        for k in range(len(loop)):
            a, b = loop[k], loop[(k + 1) % len(loop)]
            faces.append(([b, a, c], [vert_uv[b], vert_uv[a], uv_c]))
    # the bodice's own copies of the body's arrays, with the fan centres appended
    co_x = np.vstack([co] + ([np.array([e[0] for e in extra])] if extra else []))
    nm_x = np.vstack([nm] + ([np.array([e[1] for e in extra])] if extra else []))
    weights_x = weights + [e[2] for e in extra]
    sleeve_x = np.append(sleeve_s, [-1.0] * len(extra))
    print("bodice: closed", len(extra), "holes over the chest details")
    used = sorted({v for vs, _ in faces for v in vs})
    remap = {v: j for j, v in enumerate(used)}
    off = np.full(len(co_x), 0.0055)
    sl = sleeve_x >= 0
    puff = np.where(sl, 0.024 * np.sin(np.pi * np.clip(sleeve_x / SLEEVE, 0, 1)) ** 0.6, 0)
    # gathers round the puff, so it reads as gathered cloth and not a balloon
    ang_l = np.arctan2(co_x[:, 1], co_x[:, 2])
    puff *= 1 + 0.18 * np.sin(ang_l * 14)
    off = off + puff
    bverts = co_x[used] + nm_x[used] * off[used, None]
    bfaces = [[remap[v] for v in vs] for vs, _ in faces]
    # Cloth, not skin: the shape is smoothed hard (Taubin, so it does not shrink), and the chest smoothed flat, so none
    # of the body's own detail shows through. Only the edges stay where they are, on the visible skin.
    edge_count = {}
    for f in bfaces:
        for k in range(len(f)):
            e = tuple(sorted((f[k], f[(k + 1) % len(f)])))
            edge_count[e] = edge_count.get(e, 0) + 1
    nbrs = [set() for _ in bverts]
    for a, b in edge_count:
        nbrs[a].add(b)
        nbrs[b].add(a)
    pinned = np.zeros(len(bverts), bool)
    for (a, b), n_ in edge_count.items():
        if n_ == 1:
            pinned[a] = pinned[b] = True
    nb_idx = [np.array(sorted(n_)) for n_ in nbrs]

    bn = nm_x[used]

    def relax(vs, amount, which):
        """One smoothing step along each vertex's normal only, so the dense parts of the mesh never tangle."""
        avg = np.array([vs[n_].mean(0) if len(n_) else vs[i] for i, n_ in enumerate(nb_idx)])
        d = ((avg - vs) * bn).sum(1) * amount
        return vs + np.where(which, d, 0.0)[:, None] * bn

    free = ~pinned
    for _ in range(30):
        bverts = relax(bverts, 0.5, free)
        bverts = relax(bverts, -0.53, free)
    # the torso below the armpits: wrapped by a smooth envelope round the body (the widest the body gets in each
    # direction, spread wide and blurred), so the bodice is one plain, featureless shape, like cloth over a child
    bc = co_x[used]
    arm_top = min(sides["l"][0][2], sides["r"][0][2])
    zs_env = np.arange(waist_z - 0.04, arm_top + 0.03, 0.01)
    TH = 72
    rel_b = co - [0, cy, 0]
    th_b = (np.arctan2(rel_b[:, 0], rel_b[:, 1]) % (2 * np.pi)) / (2 * np.pi) * TH
    rad_b = np.hypot(rel_b[:, 0], rel_b[:, 1])
    torso_b = ~is_arm & ~is_head & ~helper & ~is_leg
    env = np.zeros((len(zs_env), TH))
    for zi, z in enumerate(zs_env):
        m = torso_b & (np.abs(co[:, 2] - z) < 0.006)
        np.maximum.at(env[zi], th_b[m].astype(int) % TH, rad_b[m])
    for _ in range(6):  # empty cells take their neighbours' value
        env = np.where(env > 0, env, np.maximum(np.roll(env, 1, 1), np.roll(env, -1, 1)))
    for _ in range(4):  # spread each bulge wide (a max filter), then blur: an envelope with no small features
        env = np.maximum.reduce([env, np.roll(env, 1, 1), np.roll(env, -1, 1), np.roll(env, 1, 0), np.roll(env, -1, 0)])
    for _ in range(10):
        env = 0.5 * env + 0.125 * (np.roll(env, 1, 1) + np.roll(env, -1, 1)) + 0.125 * (np.vstack([env[:1], env[:-1]]) + np.vstack([env[1:], env[-1:]]))
    rel_v = bverts - [0, cy, 0]
    th_v = (np.arctan2(rel_v[:, 0], rel_v[:, 1]) % (2 * np.pi)) / (2 * np.pi) * TH
    zf = np.clip((bc[:, 2] - zs_env[0]) / 0.01, 0, len(zs_env) - 1.001)
    z0, t0 = zf.astype(int), zf - zf.astype(int)
    k0 = th_v.astype(int) % TH
    k1 = (k0 + 1) % TH
    f = th_v - np.floor(th_v)
    r_env = ((env[z0, k0] * (1 - f) + env[z0, k1] * f) * (1 - t0) + (env[z0 + 1, k0] * (1 - f) + env[z0 + 1, k1] * f) * t0) + 0.007
    blend = free * (sleeve_x[used] < 0) * smoothstep(arm_top + 0.025, arm_top - 0.01, bc[:, 2])
    # not right at the edges: two rings in from any pinned vertex the envelope fades out
    near_edge = pinned.copy()
    for _ in range(2):
        near_edge = near_edge | np.array([near_edge[n_].any() if len(n_) else False for n_ in nb_idx])
    blend = blend * np.where(near_edge & ~pinned, 0.5, 1.0) * ~pinned
    rad_v = np.hypot(rel_v[:, 0], rel_v[:, 1])
    dir_v = rel_v[:, :2] / np.maximum(rad_v, 1e-6)[:, None]
    new_xy = dir_v * r_env[:, None] + [0, cy]  # the envelope wins even where the (hidden) body pokes past it
    bverts[:, :2] = bverts[:, :2] * (1 - blend[:, None]) + new_xy * blend[:, None]
    bverts = bverts + nm_x[used] * np.where(free, 0.003, 0.0)[:, None]
    buvs = [uv for _, uvs_ in faces for uv in uvs_]
    # the bodice's texture: satin in the body's UV layout, painted through the surface (pin tucks down the front, side
    # seams, the gathers of the sleeves and a little wear under the arms)
    TS = 1024
    tri_uv, tri_pos = [], []
    for idx, uvs_ in faces:
        for k in range(1, len(idx) - 1):
            tri_uv.append([uvs_[0], uvs_[k], uvs_[k + 1]])
            tri_pos.append([co_x[idx[0]], co_x[idx[k]], co_x[idx[k + 1]]])
    P = rasterize(tri_uv, tri_pos, TS, TS)
    valid = ~np.isnan(P[..., 0])
    P = np.nan_to_num(P)
    tile = satin_tile(256, 3)
    rgb = np.tile(tile, (TS // 256, TS // 256, 1))
    px, py, pz = P[..., 0], P[..., 1] - cy, P[..., 2]
    # pin tucks: soft ridges every 14 mm down the front panel, fading out at its edges (hard lines alias in the atlas)
    panel = (py < 0) * smoothstep(0.052, 0.04, np.abs(px)) * smoothstep(waist_z + 0.02, waist_z + 0.04, pz) * smoothstep(neck[2] - 0.035, neck[2] - 0.055, pz)
    wave = 0.5 - 0.5 * np.cos(2 * np.pi * px / 0.014)
    rgb *= (1 - panel * (0.13 * wave ** 3 - 0.04 * (1 - wave) ** 4))[..., None]
    side = np.abs(np.abs(np.arctan2(px, -py)) - np.pi / 2) * np.hypot(px, py)
    rgb *= (1 - 0.1 * np.clip(1 - side / 0.004, 0, 1) * (pz > waist_z))[..., None]
    under = 0
    for s in "lr":
        a, _ = sides[s]
        under = np.maximum(under, np.clip(1 - np.linalg.norm(P - (a - [0, 0, 0.035]), axis=2) / 0.045, 0, 1))
    rgb = rgb * (1 - 0.12 * under[..., None]) + DUST * 0.12 * under[..., None]
    rgb = np.where(valid[..., None], rgb, SATIN)
    bodice = mesh_object("girl_bodice", bverts, bfaces, buvs, rig)
    bodice.data.materials.append(material("girl_bodice", image("girl_bodice", rgb), rough=0.55))
    # the weights are smoothed too (the edges keep the skin's, so they move with it): cloth moves as one piece, and the
    # body's small features (which carry their own mix of weights) cannot reappear when she moves
    bw = [dict(weights_x[v]) for v in used]
    for _ in range(25):
        nxt = []
        for i, w in enumerate(bw):
            if pinned[i] or not len(nb_idx[i]) or sleeve_x[used[i]] >= 0:  # sleeves keep the arm's own weights
                nxt.append(w)
                continue
            acc = {b: 0.5 * x for b, x in w.items()}
            share = 0.5 / len(nb_idx[i])
            for j in nb_idx[i]:
                for b, x in bw[j].items():
                    acc[b] = acc.get(b, 0.0) + share * x
            nxt.append(acc)
        bw = nxt
    # along each puff sleeve the weights pass to the upper arm alone, so the puff keeps its shape when the arm rises
    for i, v in enumerate(used):
        if sleeve_x[v] >= 0:
            a = float(smoothstep(0.15 * SLEEVE, 0.75 * SLEEVE, sleeve_s[v]))
            side = "l" if co_x[v, 0] > 0 else "r"
            w = {b: x * (1 - a) for b, x in bw[i].items()}
            w[f"upperarm_{side}"] = w.get(f"upperarm_{side}", 0.0) + a
            bw[i] = w
    set_weights(bodice, bw)
    pieces.append(bodice)
    hidden = set(np.nonzero(inc)[0].tolist())

    # ---- the skirt: two gathered tiers, fitted at the waist, wide enough everywhere for the hips and legs ------------
    N = 96  # around
    theta = np.linspace(0, 2 * np.pi, N + 1)  # 0 at the back (+y), going round through her left (+x)
    leg_body = ~is_arm & ~is_head & ~helper
    rel_all = co - [0, cy, 0]
    ang_all = np.arctan2(rel_all[:, 0], rel_all[:, 1])  # 0 at +y (back)
    rad_all = np.hypot(rel_all[:, 0], rel_all[:, 1])
    bins = ((ang_all % (2 * np.pi)) / (2 * np.pi) * N).astype(int) % N

    def body_radius(z0, z1):
        """Largest radius of the body (no arms, no head) in each direction, between two heights."""
        m = leg_body & (co[:, 2] >= z0) & (co[:, 2] <= z1)
        r = np.zeros(N)
        np.maximum.at(r, bins[m], rad_all[m])
        # fill empty bins and smooth round the circle
        for _ in range(3):
            r = np.maximum(r, 0.5 * (np.roll(r, 1) + np.roll(r, -1)))
        return np.append(r, r[0])

    r_waist = body_radius(waist_z - 0.01, waist_z + 0.01) + 0.009
    r_need = body_radius(hem_z, waist_z - 0.005) + 0.03  # the widest the hips and legs get
    flare = max(0.22, float(r_need.max()) + 0.015)
    print(f"skirt: waist radius {r_waist.mean():.3f}, needed {r_need.max():.3f}, hem {flare:.3f}")

    def gathers(folds, ph1, ph2, th=theta):
        """Uneven gathers: folds that bunch and spread round the skirt, some deeper than others."""
        warp = th + 0.09 * np.sin(3 * th + ph2) + 0.05 * np.sin(7 * th + ph1)
        return 0.6 * np.sin(folds * warp + ph1) + 0.25 * np.sin((folds * 0.47) * warp + ph2) + 0.15 * np.sin(2.3 * folds * warp)

    def tier(z_top, z_bot, r_top, r_bot_min, rows, folds, seed, v0, v1, extra=0.0):
        """One gathered tier: rings from z_top to z_bot. Returns verts, faces, uvs, t per vertex, ring radii."""
        rng = np.random.default_rng(seed)
        ph1, ph2 = rng.random() * 6.28, rng.random() * 6.28
        verts, uvs_v, ts = [], [], []
        prev = None
        for j in range(rows + 1):
            t = j / rows
            z = z_top + (z_bot - z_top) * t
            span = z_top - z_bot
            tt = float(np.clip((t * span - 0.032) / (span - 0.032), 0, 1))  # gathered flat under the sash, then it flares
            bell = 0.55 * tt + 0.45 * (1 - (1 - tt) ** 2.5)  # an A-line, a little rounded by the petticoat
            depth = 0.9 + 0.1 * np.abs(np.sin(theta))  # a little less flare front and back
            r = r_top + (r_bot_min * depth - r_top) * bell + extra * t
            clear = 0.012 if z > waist_z - 0.06 else 0.022  # snug under the sash, roomier over the hips and legs
            r = np.maximum(r, body_radius(z - 0.03, z + 0.03) + clear if z > hem_z - 0.01 else r)
            if prev is not None:
                r = np.maximum(r, prev)  # a skirt never narrows on the way down
            prev = r
            g = 0.006 + 0.03 * t
            fold = gathers(folds, ph1, ph2)
            rr = r * (1 + g * fold)
            x = np.sin(theta) * rr
            y = cy + np.cos(theta) * rr
            for k in range(N + 1):
                verts.append((x[k], y[k], z))
                uvs_v.append((theta[k] / (2 * np.pi), v1 + (v0 - v1) * t))
                ts.append(t)
        faces, uvs = [], []
        for j in range(rows):
            for k in range(N):
                a = j * (N + 1) + k
                quad = [a, a + 1, a + N + 2, a + N + 1]
                faces.append(quad)
                uvs += [uvs_v[q] for q in quad]
        return np.array(verts), faces, uvs, np.array(ts), (ph1, ph2, folds)

    knee_z = knee[2]
    upper_bot = waist_z - 0.62 * (waist_z - hem_z)
    lower = tier(waist_z + 0.005, hem_z, r_waist, flare, 22, 34, 11, 0.5, 0.0)
    upper_need = float(np.hypot(lower[0][:, 0], lower[0][:, 1] - cy)[lower[0][:, 2] >= upper_bot - 0.01].max())
    upper = tier(waist_z + 0.008, upper_bot, r_waist + 0.004, upper_need + 0.012, 16, 30, 23, 1.0, 0.5, extra=0.004)
    # the skirt's texture: satin with the gathers shaded in (deeper in the folds), the tier seams, and a little dust
    # along the lower hem from the floors she wanders
    SK = 1024
    u = (np.arange(SK)[None, :] + 0.5) / SK
    v = (np.arange(SK)[:, None] + 0.5) / SK
    sk = np.tile(satin_tile(256, 5), (SK // 256, SK // 256, 1))
    th = u * 2 * np.pi
    for (ph1, ph2, folds), lo, hi in ((lower[4], 0.0, 0.5), (upper[4], 0.5, 1.0)):
        t = (hi - v) / (hi - lo)
        fold = gathers(folds, ph1, ph2, th)
        depth = (0.3 + 0.7 * t) * np.clip(-fold, 0, 1)
        band = (v >= lo) & (v < hi)
        sk *= np.where(band, 1 - 0.2 * depth + 0.05 * np.clip(fold, 0, 1) * t, 1.0)[..., None]
    hem_dust = np.clip(1 - v / 0.07, 0, 1) ** 1.6 * (0.55 + 0.45 * noise(SK, SK, 40, 9))
    sk = sk * (1 - 0.35 * hem_dust[..., None]) + DUST * 0.35 * hem_dust[..., None]
    waist_shadow = np.clip((v - 0.93) / 0.07, 0, 1) + np.clip((v - 0.43) / 0.07, 0, 1) * (v < 0.5)
    sk *= (1 - 0.18 * waist_shadow)[..., None]
    skirt_mat = material("girl_skirt", image("girl_skirt", sk), rough=0.55, double=True)

    def skirt_weights(verts, ts):
        out = []
        for p, t in zip(verts, ts):
            near = src.at(p)
            leg = 0.42 * float(smoothstep(0.15, 0.95, t))
            share_l = float(np.clip(0.5 + p[0] / 0.14, 0, 1))
            scheme = {"pelvis": 1 - leg, "thigh_l": leg * share_l, "thigh_r": leg * (1 - share_l)}
            a = float(smoothstep(0.0, 0.18, t))
            tot = sum(near.values()) or 1
            w = {b: (1 - a) * x / tot for b, x in near.items()}
            for b, x in scheme.items():
                w[b] = w.get(b, 0) + a * x
            out.append(w)
        return out

    for name, (verts, faces, uvs, ts, _) in (("girl_skirt_lower", lower), ("girl_skirt_upper", upper)):
        o = mesh_object(name, verts, faces, uvs, rig)
        o.data.materials.append(skirt_mat)
        set_weights(o, skirt_weights(verts, ts))
        pieces.append(o)
    # the body under the skirt is never seen: hidden from the waist down to just above the hem
    for i in range(len(co)):
        if not is_arm[i] and not is_head[i] and not helper[i] and hem_z + 0.1 < co[i, 2] < waist_z + 0.01:
            hidden.add(i)

    # ---- lace: both hems, the collar, the cuffs, the veil's edge (one tiling texture) --------------------------------
    lace_mat = material("girl_lace", image("girl_lace", lace_tile()), rough=0.75, alpha=True, double=True)
    PERIOD = 0.07  # one texture width (two scallops) in metres

    def strip(name, rows, weights_of, period=PERIOD):
        """rows: list of (M, 3) arrays, from the attached edge (v = 1) to the scalloped edge (v = 0)."""
        R = len(rows)
        M = len(rows[0])
        verts = np.concatenate(rows)
        seg = np.linalg.norm(np.diff(rows[0], axis=0), axis=1)
        us = np.concatenate([[0], np.cumsum(seg)]) / period
        us = us * (np.round(us[-1]) / us[-1]) if us[-1] > 1 else us  # whole repeats round a closed ring
        faces, uvs = [], []
        for j in range(R - 1):
            for k in range(M - 1):
                a = j * M + k
                faces.append([a, a + M, a + M + 1, a + 1])
                for q in (a, a + M, a + M + 1, a + 1):
                    uvs.append((us[q % M], 1 - (q // M) / (R - 1)))
        o = mesh_object(name, verts, faces, uvs, rig)
        o.data.materials.append(lace_mat)
        set_weights(o, [weights_of(p) for p in verts])
        pieces.append(o)
        return o

    def hem_lace(name, tierdata, depth):
        verts, _, _, _, _ = tierdata
        ring = verts[-(N + 1):]
        prev = verts[-2 * (N + 1):-(N + 1)]
        down = ring - prev
        down /= np.linalg.norm(down, axis=1)[:, None]
        rows = [ring + down * depth * f + (ring - [0, cy, ring[0, 2]]) * [1, 1, 0] * 0.04 * f * f for f in (0, 0.5, 1)]
        rows[0] = ring - down * 0.006  # tucked just under the hem
        t_hem = np.ones(len(ring))
        w_ring = skirt_weights(ring, t_hem)
        return strip(name, rows, lambda p: w_ring[int(np.argmin(np.linalg.norm(ring - p, axis=1)))])

    hem_lace("girl_lace_lower", lower, 0.05)
    hem_lace("girl_lace_upper", upper, 0.055)

    bod_tree = BVHTree.FromPolygons([tuple(p) for p in bverts], [tuple(f) for f in bfaces])
    body_tree = bvh_of([body])

    def onto(p, tree, lift):
        hit = tree.find_nearest(Vector(p), 0.2)
        if hit[0] is None:
            return np.array(p)
        n = hit[1]
        return np.array((hit[0] + n * lift)[:])

    # collar: a round lace collar lying on the shoulders, scalloped at its outer edge
    M = 72
    ring = []
    for k in range(M + 1):
        a = 2 * np.pi * k / M
        d = np.array([np.sin(a), np.cos(a), 0])  # 0 at the back
        fr = max(0.0, -np.cos(a))
        z = neck[2] - 0.004 - 0.034 * fr ** 3 - 0.004
        r = 0.046 + 0.006 * fr
        ring.append(onto(np.array([0, cy, z]) + d * r, bod_tree, 0.003))
    ring = np.array(ring)
    rows = [ring]
    centre = np.array([0, cy, neck[2]])
    for f in (0.016, 0.032, 0.048):
        out = ring - centre
        out[:, 2] = 0
        out /= np.linalg.norm(out, axis=1)[:, None]
        rows.append(np.array([onto(p + o * f + [0, 0, -0.35 * f], bod_tree, 0.004) for p, o in zip(ring, out)]))
    # split the collar at the back (two halves meet at the buttons), so u runs front to back on each side
    strip("girl_collar", rows, lambda p: src.at(p), period=0.06)

    # cuffs: a frill of lace round the end of each puff sleeve
    for s in "lr":
        a, d = sides[s]
        endpts = bverts[[remap[i] for i in used if sleeve_x[i] > SLEEVE - 0.012 and (co_x[i, 0] > 0) == (s == "l")]]
        c = a + d * SLEEVE
        e1 = np.cross(d, [0, 1, 0])
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(d, e1)
        rad = float(np.median(np.linalg.norm((endpts - c) - np.outer((endpts - c) @ d, d), axis=1))) + 0.002
        ringc = np.array([c + (np.cos(q) * e1 + np.sin(q) * e2) * rad for q in np.linspace(0, 2 * np.pi, 41)])
        rows = [ringc - d * 0.006, ringc + d * 0.012 + (ringc - c) * 0.12, ringc + d * 0.026 + (ringc - c) * 0.25]
        arm_w = {f"upperarm_{s}": 1.0}
        strip(f"girl_cuff_{s}", rows, lambda p, w=arm_w: w, period=0.05)

    # ---- the sash, the bow and its tails ------------------------------------------------------------------------------
    satin = image("girl_satin", satin_tile(256, 7))
    sash_mat = material("girl_sash", satin, rough=0.38)
    SH = 0.05
    skirt_pts = np.concatenate([lower[0], upper[0]])
    sk_ang = (np.arctan2(skirt_pts[:, 0], skirt_pts[:, 1] - cy) % (2 * np.pi)) / (2 * np.pi) * N
    sk_rad = np.hypot(skirt_pts[:, 0], skirt_pts[:, 1] - cy)
    sash_floor = np.zeros(N)
    in_band = skirt_pts[:, 2] > waist_z - SH / 2 - 0.004
    np.maximum.at(sash_floor, sk_ang[in_band].astype(int) % N, sk_rad[in_band])
    raw = sash_floor.copy()
    for _ in range(4):  # bins with no skirt vertex take their neighbours' value
        sash_floor = np.where(sash_floor > 0, sash_floor, np.maximum(np.roll(sash_floor, 1), np.roll(sash_floor, -1)))
    for _ in range(12):  # fill the hollows between gathers: a smooth band that never sinks into the skirt
        sash_floor = np.maximum(sash_floor, 0.25 * np.roll(sash_floor, 1) + 0.5 * sash_floor + 0.25 * np.roll(sash_floor, -1))
    sash_floor = np.append(sash_floor, sash_floor[0])
    rows = []
    # bottom edge over the gathered skirt top, top edge tucked against the bodice: a band wrapped round a waist
    for zz, over_skirt, out in ((waist_z - SH / 2 - 0.004, 1, 0.001), (waist_z - SH / 2 + 0.005, 1, 0.004), (waist_z + SH / 2 - 0.006, 0, 0.007), (waist_z + SH / 2 + 0.001, 0, 0.004)):
        rb = body_radius(zz - 0.006, zz + 0.006)
        r = np.maximum(rb + 0.0055, r_waist + 0.002)
        if over_skirt:
            r = np.maximum(r, sash_floor)
        for _ in range(12):
            r = np.maximum(r, 0.25 * np.roll(r, 1) + 0.5 * r + 0.25 * np.roll(r, -1))
        r = r + out
        rows.append(np.stack([np.sin(theta) * r, cy + np.cos(theta) * r, np.full(N + 1, zz)], axis=1))
    verts = np.concatenate(rows)
    faces, uvs = [], []
    for j in range(3):
        for k in range(N):
            a = j * (N + 1) + k
            faces.append([a, a + 1, a + N + 2, a + N + 1])
            uvs += [(k / N * 6, j / 3), ((k + 1) / N * 6, j / 3), ((k + 1) / N * 6, (j + 1) / 3), (k / N * 6, (j + 1) / 3)]
    back_r = float(np.max(np.linalg.norm(rows[1][:, :2] - [0, cy], axis=1)[np.abs(theta) < 0.4]))
    knot = np.array([0, cy + back_r + 0.004, waist_z])
    # bow loops: a ribbon (width along y, out of the back) round an ellipse to each side of the knot
    RW = 0.034
    base = len(verts)
    allv = [verts]
    for s in (-1, 1):
        L = 28
        b = base + sum(len(x) for x in allv[1:])
        lo_e, hi_e = [], []
        for i in range(L + 1):
            q = 2 * np.pi * i / L
            out = 0.5 - 0.5 * np.cos(q)  # 0 at the knot, 1 at the loop's tip
            c = knot + [s * 0.05 * out, 0.006 + 0.009 * np.sin(q), 0.008 * out]  # out and back, two layers apart in y
            half = RW / 2 * (0.35 + 0.85 * out ** 0.7)  # pinched at the knot, full at the tip
            lo_e.append(c - [0, 0, half])
            hi_e.append(c + [0, 0, half])
        allv += [np.array(lo_e), np.array(hi_e)]
        for i in range(L):
            faces.append([b + i, b + i + 1, b + L + 2 + i, b + L + 1 + i])
            uvs += [(i / L, 0), ((i + 1) / L, 0), ((i + 1) / L, 1), (i / L, 1)]
    # tails: hanging from the knot, spreading a little, cut in a V at the ends
    for s in (-1, 1):
        T = 10
        b = base + sum(len(x) for x in allv[1:])
        left, right = [], []
        for i in range(T + 1):
            f = i / T
            c = knot + [s * (0.006 + 0.05 * f), 0.008 + 0.012 * f + 0.004 * np.sin(f * 7), -0.24 * f]
            tw = 0.15 * s * f
            half = np.array([np.cos(tw), np.sin(tw), 0]) * RW / 2
            cut = 0.018 if i == T else 0.0
            left.append(c - half + [0, 0, 0])
            right.append(c + half + [0, 0, cut * 0])
        left, right = np.array(left), np.array(right)
        left[-1, 2] -= 0.018 if s > 0 else 0.0
        right[-1, 2] -= 0.018 if s < 0 else 0.0
        mid = (left + right) / 2
        mid[-1, 2] += 0.012  # the V notch
        allv += [left, mid, right]
        for i in range(T):
            for col in range(2):
                a = b + col * (T + 1) + i
                faces.append([a, a + 1, a + T + 2, a + T + 1])
                uvs += [(col / 2, i / T), (col / 2, (i + 1) / T), ((col + 1) / 2, (i + 1) / T), ((col + 1) / 2, i / T)]
    # the knot itself: a short wrapped band
    b = base + sum(len(x) for x in allv[1:])
    kr = []
    for zz in (-0.016, 0.016):
        kr.append(np.array([knot + [0.013 * np.cos(q), 0.009 + 0.008 * np.sin(q), zz] for q in np.linspace(-np.pi, np.pi, 13)]))
    allv += kr
    for i in range(12):
        faces.append([b + i, b + i + 1, b + 14 + i, b + 13 + i])
        uvs += [(i / 12, 0), ((i + 1) / 12, 0), ((i + 1) / 12, 1), (i / 12, 1)]
    sverts = np.concatenate(allv)
    sash = mesh_object("girl_sash", sverts, faces, uvs, rig)
    sash.data.materials.append(sash_mat)
    sash_mat.use_backface_culling = False
    set_weights(sash, [src.at(p) if p[2] > waist_z - 0.04 else {"pelvis": 1.0} for p in sverts])
    pieces.append(sash)

    # pearl buttons down the back of the bodice
    pearl_mat = material("girl_pearl", None, color=(0.86, 0.85, 0.8), rough=0.25)
    pv, pf = [], []
    for i in range(4):
        z = waist_z + 0.04 + i * 0.03
        p = onto(np.array([0, cy + 0.2, z]), bod_tree, 0.003)
        hit = bod_tree.ray_cast(Vector((0, cy + 0.3, z)), Vector((0, -1, 0)))
        if hit[0] is not None:
            p = np.array(hit[0][:]) + np.array(hit[1][:]) * 0.003
        b = len(pv)
        for la in range(5):
            for lo in range(8):
                th_ = np.pi * la / 4
                ph_ = 2 * np.pi * lo / 8
                pv.append(p + 0.0045 * np.array([np.sin(th_) * np.cos(ph_), np.sin(th_) * np.sin(ph_) * 0.6, np.cos(th_)]))
        for la in range(4):
            for lo in range(8):
                a = b + la * 8 + lo
                c = b + la * 8 + (lo + 1) % 8
                pf.append([a, c, c + 8, a + 8])
    buttons = mesh_object("girl_buttons", pv, pf, [(0.5, 0.5)] * (4 * len(pf)), rig)
    buttons.data.materials.append(pearl_mat)
    set_weights(buttons, [src.at(p) for p in pv])
    pieces.append(buttons)

    # ---- the wreath and the veil ----------------------------------------------------------------------------------------
    head_tree = bvh_of([body, hair])
    hb = bone_head("head")
    ht = bone_tail("head")
    top = co[is_head, 2].max()
    wc = np.array([0, hb[1] + 0.004, top - 0.03])  # the wreath's centre
    tilt = math.radians(28)  # high on the head at the front, sloping down to the back of the skull
    ax_up = np.array([0, math.sin(tilt), math.cos(tilt)])
    e_x = np.array([1.0, 0, 0])
    e_y = np.cross(ax_up, e_x)  # points to the back
    W = 64
    wring = []
    for k in range(W):
        a = 2 * np.pi * k / W
        d = np.cos(a) * e_y + np.sin(a) * e_x  # 0 at the back
        hit = head_tree.ray_cast(Vector(wc + d * 0.2), Vector(-d))
        r = 0.2 - hit[3] if hit[0] is not None else 0.08
        wring.append(wc + d * (r + 0.004))
    wring = np.array(wring)
    petal_mat = material("girl_petal", None, color=(0.93, 0.92, 0.89), rough=0.6)
    leaf_mat = material("girl_leaf", None, color=(0.62, 0.66, 0.58), rough=0.6)
    fv, ff, fmat = [], [], []

    def disc(centre, normal, radius, sides_, lift=0.0, sx=1.0, rot=0.0, tip=0.0):
        normal = normal / np.linalg.norm(normal)
        t1 = np.cross(normal, [0, 0, 1]) if abs(normal[2]) < 0.9 else np.cross(normal, [1, 0, 0])
        t1 /= np.linalg.norm(t1)
        t2 = np.cross(normal, t1)
        c1, s1 = math.cos(rot), math.sin(rot)
        t1, t2 = t1 * c1 + t2 * s1, -t1 * s1 + t2 * c1
        b = len(fv)
        fv.append(centre + normal * lift)
        for i in range(sides_):
            q = 2 * np.pi * i / sides_
            rr = radius * (1 + tip * math.cos(q))
            fv.append(centre + (t1 * math.cos(q) * sx + t2 * math.sin(q)) * rr - normal * 0.002 * (1 - math.cos(q)))
        tris = [[b, b + 1 + i, b + 1 + (i + 1) % sides_] for i in range(sides_)]
        ff.extend(tris)
        return len(tris)

    flowers = 15
    for k in range(flowers):
        a = 2 * np.pi * (k + 0.5) / flowers
        idx = int(a / (2 * np.pi) * W) % W
        c = wring[idx]
        out = c - wc
        out /= np.linalg.norm(out)
        n = out * 0.6 + ax_up * 0.8
        n /= np.linalg.norm(n)
        size = 0.0085 * (1.15 if abs(math.cos(a)) > 0.7 and math.cos(a) < 0 else 1.0)
        for pi_ in range(5):  # five petals round the centre
            q = 2 * np.pi * pi_ / 5 + k
            t1 = np.cross(n, [0, 0, 1])
            t1 /= np.linalg.norm(t1)
            t2 = np.cross(n, t1)
            pc = c + (t1 * math.cos(q) + t2 * math.sin(q)) * size * 0.75
            fmat.extend(["petal"] * disc(pc, n, size * 0.62, 6, lift=0.0015, sx=1.3, rot=q))
        fmat.extend(["pearl"] * disc(c + n * 0.002, n, size * 0.32, 6, lift=0.003))
        if k % 2 == 0:  # a leaf between every other pair
            a2 = 2 * np.pi * (k + 1) / flowers
            c2 = wring[int(a2 / (2 * np.pi) * W) % W]
            fmat.extend(["leaf"] * disc(c2, n, 0.007, 6, lift=0.001, sx=1.8, rot=a2))
    wreath = mesh_object("girl_wreath", fv, ff, [(0.5, 0.5)] * (3 * len(ff)), rig)
    for m in (petal_mat, pearl_mat, leaf_mat):
        wreath.data.materials.append(m)
    lookup = {"petal": 0, "pearl": 1, "leaf": 2}
    for p, kind in zip(wreath.data.polygons, fmat):
        p.material_index = lookup[kind]
    wreath.data.shade_flat()
    set_weights(wreath, [{"head": 1.0}] * len(fv))
    pieces.append(wreath)

    # the veil: tulle falling from the back half of the wreath to between the shoulder blades, clear of the hair
    veil_tree = bvh_of([body, hair])
    cols = [i for i in range(W) if math.cos(2 * np.pi * i / W) > -0.05]  # the back half (plus a little)
    order = sorted(cols, key=lambda i: ((2 * np.pi * i / W + np.pi) % (2 * np.pi)))
    top_row = wring[order]
    VR, VLEN = 12, 0.26
    vrows = []
    for j in range(VR + 1):
        f = j / VR
        row = []
        for p in top_row:
            out = p - wc
            out[2] = 0
            out /= max(np.linalg.norm(out), 1e-6)
            q = p + [0, 0, -VLEN * f] + out * (0.02 * f) + [0, 0.012 * f, 0]
            q[0] *= 1 - 0.22 * f  # it gathers in a little as it falls, instead of hanging like a board
            for _ in range(3):
                hit = veil_tree.find_nearest(Vector(q), 0.03)
                if hit[0] is None:
                    break
                d = np.array(q) - np.array(hit[0][:])
                if np.dot(d, hit[1]) < 0.012:
                    q = np.array(hit[0][:]) + np.array(hit[1][:]) * 0.013
            row.append(q)
        vrows.append(np.array(row))
    Mv = len(top_row)
    verts = np.concatenate(vrows)
    faces, uvs = [], []
    for j in range(VR):
        for k in range(Mv - 1):
            a = j * Mv + k
            faces.append([a, a + 1, a + Mv + 1, a + Mv])
            vv = lambda jj: (1 - jj / VR) * 14  # noqa: E731  tulle: about 14 repeats down, 30 across
            uu = lambda kk: kk / (Mv - 1) * 30  # noqa: E731
            uvs += [(uu(k), vv(j)), (uu(k + 1), vv(j)), (uu(k + 1), vv(j + 1)), (uu(k), vv(j + 1))]
    veil = mesh_object("girl_veil", verts, faces, uvs, rig)
    veil.data.materials.append(material("girl_veil", image("girl_veil", tulle_tile()), rough=0.8, alpha=True, double=True))

    def veil_w(p):
        f = float(np.clip((top_row[:, 2].mean() - p[2]) / VLEN, 0, 1))
        f = f ** 0.7  # below the wreath the tulle soon hangs from her back, not from her head
        return {"head": 1 - 0.85 * f, "neck_01": 0.25 * f, "spine_03": 0.6 * f}

    set_weights(veil, [veil_w(p) for p in verts])
    pieces.append(veil)
    last = vrows[-1]
    prev = vrows[-2]
    down = last - prev
    down /= np.linalg.norm(down, axis=1)[:, None]
    strip("girl_veil_lace", [last - down * 0.004, last + down * 0.018, last + down * 0.036], veil_w, period=0.06)

    return pieces, hidden, {"waist": waist_z, "hem": hem_z, "cy": cy}
