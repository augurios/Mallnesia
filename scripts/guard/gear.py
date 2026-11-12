# The guard's gear, modeled by script (nothing CC0 fit: MakeHuman ships no cap, Poly Haven only a fisherman's hat):
#   - a six-panel "SEGURIDAD" cap fitted to his skull, with an embroidered (raised) front logo, a curved brim, a top
#     button and a painted, worn twill texture (seams, stitching, eyelets, faded crown, grime at the sweatband);
#   - a brass shield badge on the left chest of the vest: rim, recessed field, raised disc and star.
# Imported by build_guard.py; every piece is skinned (head bone for the cap, the vest's own weights for the badge).
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# ---- shared helpers ----------------------------------------------------------------------------------------------


def _mesh_object(name, verts, faces, uvs=None, rig=None):
    """A mesh in world coordinates, parented to the rig. uvs: one (u, v) per face corner, in face order."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], faces)
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        for i, uv in enumerate(uvs):
            layer.data[i].uv = uv
    me.validate()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if rig is not None:
        o.parent = rig
        o.matrix_parent_inverse = rig.matrix_world.inverted()
        mod = o.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
    return o


def _weights(o, weights):
    """weights: {bone name: weight}, the same for every vertex (rigid pieces)."""
    idx = list(range(len(o.data.vertices)))
    for bone, w in weights.items():
        o.vertex_groups.new(name=bone).add(idx, w, "REPLACE")


def _material(name, image=None, color=(1, 1, 1), rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def _image(name, rgb):
    h, w, _ = rgb.shape
    im = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((h, w, 1))], axis=2).astype(np.float32)
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    return im


def _noise(h, w, cells, seed):
    """Smooth value noise in [0, 1] (bilinear upsampling of a coarse random grid)."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1))
    y = np.linspace(0, cells, h, endpoint=False)
    x = np.linspace(0, cells, w, endpoint=False)
    y0, x0 = y.astype(int), x.astype(int)
    fy, fx = (y - y0)[:, None], (x - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = g[y0][:, x0], g[y0][:, x0 + 1]
    c, d = g[y0 + 1][:, x0], g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def _evaluated(o):
    """World-space vertex positions and polygons of an object as it is evaluated (shape keys and masks applied)."""
    e = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = e.to_mesh()
    co = [o.matrix_world @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    e.to_mesh_clear()
    return co, polys


# ---- the cap ------------------------------------------------------------------------------------------------------

CAP_SIZE = 1024
NAVY = np.array([0.028, 0.034, 0.062])
SEAMS = 6  # panels; the front panel is centred, so seams sit at +-30, +-90, +-150 degrees
PHI_N, THETA_N = 48, 12  # crown resolution
BRIM_PHI = math.radians(68)  # the brim's half-width around the front
BRIM_LEN = 0.072
TILT = math.radians(11)  # the cap sits higher at the forehead than at the back


def _paint_cap():
    """1024² twill: crown in v 0.35-1 (u = angle around the head, front at 0.5), brim top in v 0-0.15, under 0.17-0.32."""
    S = CAP_SIZE
    v = (np.arange(S)[:, None] + 0.5) / S
    u = (np.arange(S)[None, :] + 0.5) / S
    ui, vi = np.arange(S)[None, :], np.arange(S)[:, None]
    twill = 0.86 + 0.14 * (0.5 + 0.5 * np.sin((ui + vi) * 2 * np.pi / 4))  # diagonal weave
    mottle = 0.85 + 0.3 * _noise(S, S, 24, 7)
    rgb = NAVY[None, None, :] * (twill * mottle)[..., None]

    crown = v >= 0.35
    t = np.clip((v - 0.35) / 0.65, 0, 1)  # 0 at the rim, 1 at the top
    # sun-faded crown (top and front), grime and sweat at the band
    front = np.cos((u - 0.5) * 2 * np.pi) * 0.5 + 0.5
    fade = 1 + 0.35 * t ** 2 * (0.6 + 0.4 * front) * (0.7 + 0.6 * _noise(S, S, 9, 3))
    grime = 1 - 0.35 * np.clip(1 - t / 0.12, 0, 1) * (0.6 + 0.4 * _noise(S, S, 30, 5))
    rgb = np.where(crown[..., None], rgb * (fade * grime)[..., None] * np.array([1.0, 1.0, 0.94]), rgb)

    # panel seams: a dark groove with a row of stitches on each side (stitches run along v)
    seam_u = (u - 0.5 - 1 / (2 * SEAMS)) * SEAMS
    d_seam = np.abs(seam_u - np.round(seam_u)) / SEAMS * S  # px to the nearest seam
    stitch_on = (np.floor(v * S / 6) % 2 == 0)
    groove = np.clip(1 - d_seam / 2.2, 0, 1)
    stitch = (np.abs(d_seam - 6) < 1.2) & stitch_on & (t < 0.97)
    rgb = np.where(crown[..., None], rgb * (1 - 0.6 * groove)[..., None], rgb)
    rgb = np.where((crown & stitch)[..., None], NAVY * 1.9, rgb)
    # embroidered eyelets near the top of every panel
    for k in range(SEAMS):
        cu = 0.5 + k / SEAMS
        du = ((u - cu + 0.5) % 1 - 0.5) * S * 0.55  # panels are narrow up there: squash u
        r = np.hypot(du, (v - 0.86) * S)
        ring = (r > 3) & (r < 7)
        rgb = np.where((crown & ring)[..., None], NAVY * 1.6, rgb)
        rgb = np.where((crown & (r <= 3))[..., None], NAVY * 0.25, rgb)
    # the sweatband stitching just above the rim
    band = crown & (np.abs(t - 0.035) * 0.65 * S < 1.2) & (np.floor(u * S / 5) % 2 == 0)
    rgb = np.where(band[..., None], NAVY * 1.8, rgb)

    # brim, top and under: concentric rows of stitching, a worn, lighter edge
    for v0, under in ((0.0, False), (0.17, True)):
        region = (v >= v0) & (v < v0 + 0.15)
        s = np.clip((v - v0) / 0.15, 0, 1)  # 0 at the crown, 1 at the edge
        tone = rgb * (1.25 if under else 1.0)
        rows = np.zeros_like(s, dtype=bool)
        for r0 in (0.3, 0.42, 0.54, 0.66, 0.78, 0.9):
            rows |= np.abs(s - r0) * 0.15 * S < 1.0
        rows = rows & (np.floor(u * S / 5) % 2 == 0)
        tone = np.where(rows[..., None], NAVY * (2.0 if not under else 2.3), tone)
        edge = np.clip((s - 0.93) / 0.07, 0, 1) * (0.6 + 0.4 * _noise(S, S, 40, 11))
        tone = tone * (1 + 1.4 * edge)[..., None]
        rgb = np.where(region[..., None], tone, rgb)
    return rgb  # row i is v = (i + 0.5) / S, which is also how Blender stores image rows (bottom first)


def add_cap(rig, body, hair, brows):
    rest = np.array([tuple(v) for v in _evaluated(body)[0]])
    brow_z = float(np.mean([v.z for v in _evaluated(brows)[0]]))
    head = rest[(rest[:, 2] > brow_z) & (np.abs(rest[:, 0]) < 0.13)]
    xmin, ymin, _ = head.min(0)
    xmax, ymax, zmax = head.max(0)
    rx = (xmax - xmin) / 2 + 0.011
    ry = (ymax - ymin) / 2 + 0.011
    front_rim = brow_z + 0.024
    rim_z = front_rim - ry * math.sin(TILT)
    C = Vector(((xmin + xmax) / 2, (ymin + ymax) / 2 + 0.003, rim_z))
    rz = zmax - rim_z + 0.008
    R = Matrix.Rotation(-TILT, 3, "X")  # front (-y) up, back down

    def local_dir(phi, theta):
        # a superellipsoid, boxier than a sphere: upright panels and a fuller crown, not a helmet's dome
        h, z = math.sin(theta) ** 0.75, math.cos(theta) ** 0.8
        return Vector((rx * h * math.sin(phi), -ry * h * math.cos(phi), rz * z))

    # crown: a tilted half-ellipsoid, pushed out wherever the skull would poke through (ray from the centre)
    co, polys = _evaluated(body)
    body_tree = BVHTree.FromPolygons(co, polys)
    phis = [-math.pi + 2 * math.pi * i / PHI_N for i in range(PHI_N + 1)]
    thetas = [math.pi / 2 * j / THETA_N for j in range(1, THETA_N + 1)]
    grid = np.ones((THETA_N, PHI_N + 1))
    for j, th in enumerate(thetas):
        for i, ph in enumerate(phis):
            p = R @ local_dir(ph, th)
            hit = body_tree.ray_cast(C, p.normalized(), 0.3)
            if hit[0] is not None:
                need = ((hit[0] - C).length + 0.007) / p.length
                grid[j, i] = max(1.0, need)
    for _ in range(3):  # smooth the push-outs so they read as fabric, not dents
        g = grid.copy()
        g[:, :-1] = (grid[:, :-1] * 2 + np.roll(grid[:, :-1], 1, 1) + np.roll(grid[:, :-1], -1, 1)) / 4
        g[:, -1] = g[:, 0]
        g[1:-1] = (g[1:-1] * 2 + g[:-2] + g[2:]) / 4
        grid = np.maximum(grid, g)

    def crown_point(i, j):
        return C + R @ (local_dir(phis[i], thetas[j]) * float(grid[j, i]))

    verts, faces, uvs = [], [], []
    ring = []
    for j in range(THETA_N):
        row = []
        for i in range(PHI_N + 1):
            row.append(len(verts))
            verts.append(crown_point(i, j))
        ring.append(row)
    crown_uv = lambda i, j: (i / PHI_N, 0.35 + 0.65 * (1 - (j + 1) / THETA_N))  # noqa: E731
    top = C + R @ Vector((0, 0, rz * float(grid[0].mean())))
    for i in range(PHI_N):  # the top: a fan, one pole vertex per column so the texture stays continuous
        pole = len(verts)
        verts.append(top)
        faces.append((pole, ring[0][i], ring[0][i + 1]))
        uvs += [((i + 0.5) / PHI_N, 1.0), crown_uv(i, 0), crown_uv(i + 1, 0)]
    for j in range(THETA_N - 1):
        for i in range(PHI_N):
            faces.append((ring[j][i], ring[j + 1][i], ring[j + 1][i + 1], ring[j][i + 1]))
            uvs += [crown_uv(i, j), crown_uv(i, j + 1), crown_uv(i + 1, j + 1), crown_uv(i + 1, j)]

    # brim: from the front of the rim, out and down, the sides curling a little
    BN, BS = 24, 6
    top_rows, bot_rows = [], []
    for k in range(BS + 1):
        s = k / BS
        trow, brow = [], []
        for i in range(BN + 1):
            a = i / BN
            ph = -BRIM_PHI + 2 * BRIM_PHI * a
            # brim root: the crown's rim at this angle (with its push-out)
            col = min(range(PHI_N + 1), key=lambda c: abs(phis[c] - ph))
            root = C + R @ (local_dir(ph, math.pi / 2) * float(grid[-1, col]))
            out = R @ Vector((math.sin(ph), -math.cos(ph), 0))
            out.z = 0
            out.normalize()
            L = BRIM_LEN * max(0.0, math.cos(ph / BRIM_PHI * math.pi / 2)) ** 0.8
            side = (ph / BRIM_PHI) ** 2
            p = root + out * (L * s) + Vector((0, 0, -L * s * math.tan(math.radians(13)) - 0.016 * side * s ** 1.5))
            trow.append(len(verts))
            verts.append(p + Vector((0, 0, 0.0015)))
            brow.append(len(verts))
            verts.append(p + Vector((0, 0, -0.002)))
        top_rows.append(trow)
        bot_rows.append(brow)
    for k in range(BS):
        for i in range(BN):
            ua, ub = 0.05 + 0.9 * i / BN, 0.05 + 0.9 * (i + 1) / BN
            va, vb = 0.15 * k / BS, 0.15 * (k + 1) / BS
            faces.append((top_rows[k][i], top_rows[k][i + 1], top_rows[k + 1][i + 1], top_rows[k + 1][i]))
            uvs += [(ua, va), (ub, va), (ub, vb), (ua, vb)]
            faces.append((bot_rows[k][i], bot_rows[k + 1][i], bot_rows[k + 1][i + 1], bot_rows[k][i + 1]))
            uvs += [(ua, 0.17 + va), (ua, 0.17 + vb), (ub, 0.17 + vb), (ub, 0.17 + va)]
    for i in range(BN):  # the rolled edge
        ua, ub = 0.05 + 0.9 * i / BN, 0.05 + 0.9 * (i + 1) / BN
        faces.append((top_rows[BS][i], top_rows[BS][i + 1], bot_rows[BS][i + 1], bot_rows[BS][i]))
        uvs += [(ua, 0.149), (ub, 0.149), (ub, 0.171), (ua, 0.171)]

    cap = _mesh_object("guard_cap", verts, faces, uvs, rig)
    for p in cap.data.polygons:
        p.use_smooth = True
    image = _image("guard_cap", _paint_cap())
    cap.data.materials.append(_material("guard_cap", image, rough=0.95))

    # the top button
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0)
    for v in bm.verts:
        v.co = top + R @ Vector((v.co.x * 0.008, v.co.y * 0.008, v.co.z * 0.0035 + 0.0012))
    me = bpy.data.meshes.new("guard_cap_button")
    bm.to_mesh(me)
    bm.free()
    button = bpy.data.objects.new("guard_cap_button", me)
    bpy.context.scene.collection.objects.link(button)
    button.parent = rig
    button.matrix_parent_inverse = rig.matrix_world.inverted()
    button.modifiers.new("Armature", "ARMATURE").object = rig
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(_material("guard_cap_button", color=tuple(NAVY * 1.3), rough=0.9))

    # embroidered "SEGURIDAD": the letters as a thin raised mesh, wrapped onto the front panel
    tree = BVHTree.FromPolygons([cap.matrix_world @ v.co for v in cap.data.vertices], [tuple(p.vertices) for p in cap.data.polygons])
    curve = bpy.data.curves.new("guard_cap_text", "FONT")
    curve.body = "SEGURIDAD"
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.offset = 0.035  # a heavier stroke, like satin stitch
    curve.extrude = 0.05
    curve.resolution_u = 3
    tobj = bpy.data.objects.new("guard_cap_text_tmp", curve)
    bpy.context.scene.collection.objects.link(tobj)
    bpy.context.view_layer.update()
    tme = bpy.data.meshes.new_from_object(tobj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tobj, do_unlink=True)
    xs = [v.co.x for v in tme.vertices]
    width = max(xs) - min(xs)
    scale = 0.088 / width  # 8.8 cm wide across the front panel
    for v in tme.vertices:
        tx, ty, tz = v.co.x * scale, v.co.y * scale, (v.co.z + curve.extrude) * scale
        a = tx / ry
        e = math.asin(max(-1.0, min(1.0, (ty + 0.033) / rz)))
        d = R @ Vector((math.sin(a) * math.cos(e) * rx, -math.cos(a) * math.cos(e) * ry, math.sin(e) * rz))
        hit = tree.ray_cast(C, d.normalized(), 0.4)
        if hit[0] is None:
            continue
        v.co = rig.matrix_world.inverted() @ (hit[0] + hit[1] * (0.0005 + tz * 0.35))
    text = bpy.data.objects.new("guard_cap_text", tme)
    bpy.context.scene.collection.objects.link(text)
    text.parent = rig
    text.matrix_parent_inverse = Matrix.Identity(4)  # its vertices are already in the rig's space
    text.modifiers.new("Armature", "ARMATURE").object = rig
    tme.materials.clear()
    tme.materials.append(_material("guard_cap_text", color=(0.74, 0.73, 0.68), rough=0.85))

    for o in (cap, button, text):
        _weights(o, {"head": 1.0})

    # hide the hair under the cap (it would poke through the crown)
    inv = R.inverted()
    hco = _evaluated(hair)[0]
    under = []
    for i, c in enumerate(hco):
        q = inv @ (c - C)
        if q.z > 0.03:  # well above the rim: the hair's cut edge stays tucked inside the crown
            under.append(i)
    g = hair.vertex_groups.new(name="under_cap")
    g.add(under, 1.0, "REPLACE")
    m = hair.modifiers.new("Hide under cap", "MASK")
    m.vertex_group = "under_cap"
    m.invert_vertex_group = True
    print("cap fitted: rim", round(front_rim, 3), "hair hidden", len(under), "of", len(hco))


# ---- the badge ----------------------------------------------------------------------------------------------------


def _shield(a):
    """Radius of the shield outline (m) at angle a (0 = up, clockwise): pointed top, flared shoulders, pointed foot."""
    pts = [(0.0, 0.033), (0.012, 0.027), (0.025, 0.029), (0.027, 0.012), (0.022, -0.012), (0.012, -0.026),
           (0.0, -0.034)]
    pts = pts + [(-x, y) for x, y in reversed(pts[1:-1])]
    ang = [math.atan2(x, y) % (2 * math.pi) for x, y in pts]
    rad = [math.hypot(x, y) for x, y in pts]
    order = sorted(range(len(pts)), key=lambda k: ang[k])
    ang = [ang[k] for k in order]
    rad = [rad[k] for k in order]
    a %= 2 * math.pi
    return float(np.interp(a, ang, rad, period=2 * math.pi))


def _star(a, r_out, r_in):
    k = (a % (2 * math.pi / 5)) / (2 * math.pi / 5)
    return r_out + (r_in - r_out) * (1 - abs(1 - 2 * k))


def add_badge(rig, suit):
    co, polys = _evaluated(suit)
    tree = BVHTree.FromPolygons(co, polys)
    z_top = max(c.z for c in co)
    hit = tree.ray_cast(Vector((0.085, -1.0, z_top - 0.235)), Vector((0, 1, 0)), 2.0)
    if hit[0] is None:
        raise RuntimeError("badge: no vest under the ray")
    origin, n = hit[0], hit[1]
    n = Vector((n.x * 0.5, n.y, n.z * 0.3)).normalized()  # face mostly forward, as a pinned badge does
    up = (Vector((0, 0, 1)) - n * n.z).normalized()
    right = up.cross(n)
    N = 60
    # rings: (radius function, height above the cloth)
    shield = lambda k, s=1.0, ins=0.0: max(0.0, _shield(2 * math.pi * k / N) * s - ins)  # noqa: E731
    disc = lambda k, r: r  # noqa: E731
    star = lambda k, s: _star(2 * math.pi * k / N + math.pi / 5, 0.0085 * s, 0.0036 * s)  # noqa: E731
    rings = [
        (lambda k: shield(k), 0.0, "rim"),
        (lambda k: shield(k), 0.0024, "rim"),
        (lambda k: shield(k, ins=0.0012), 0.0032, "rim"),
        (lambda k: shield(k, ins=0.0034), 0.0032, "rim"),
        (lambda k: shield(k, ins=0.0044), 0.0018, "field"),
        (lambda k: disc(k, 0.0135), 0.0018, "field"),
        (lambda k: disc(k, 0.0135), 0.0034, "rim"),
        (lambda k: disc(k, 0.012), 0.0039, "rim"),
        (lambda k: disc(k, 0.0105), 0.0033, "field"),
        (lambda k: star(k, 1.0), 0.0033, "rim"),
        (lambda k: star(k, 0.92), 0.0046, "rim"),
    ]
    lift = 0.0012  # off the knit

    def at(r, h, k):
        a = 2 * math.pi * k / N
        return origin + n * (lift + h) + right * (math.sin(a) * r) + up * (math.cos(a) * r)

    verts, faces, mats = [], [], []
    idx = []
    for fn, h, _ in rings:
        row = []
        for k in range(N):
            row.append(len(verts))
            verts.append(at(fn(k), h, k))
        idx.append(row)
    for r in range(len(rings) - 1):
        for k in range(N):
            k2 = (k + 1) % N
            faces.append((idx[r][k], idx[r][k2], idx[r + 1][k2], idx[r + 1][k]))
            mats.append(0 if rings[r + 1][2] == "rim" and rings[r][2] == "rim" else 1)
    centre = len(verts)
    verts.append(origin + n * (lift + 0.0052))
    for k in range(N):
        faces.append((idx[-1][k], idx[-1][(k + 1) % N], centre))
        mats.append(0)
    back = len(verts)
    verts.append(origin + n * lift)
    for k in range(N):
        faces.append((idx[0][(k + 1) % N], idx[0][k], back))
        mats.append(0)

    badge = _mesh_object("guard_badge", verts, faces, None, rig)
    # winding: make the faces point out of the cloth
    me = badge.data
    me.update()
    if me.polygons[len(faces) - 2 * N].normal.dot(n) < 0:  # the first face of the top fan must face out
        for p in me.polygons:
            p.flip()
    for p, m in zip(me.polygons, mats):
        p.material_index = m
        p.use_smooth = False
    me.materials.append(_material("guard_badge_brass", color=(0.62, 0.45, 0.2), rough=0.32, metal=1.0))
    me.materials.append(_material("guard_badge_field", color=(0.22, 0.16, 0.08), rough=0.6, metal=0.8))

    # the vest's own skin weights at that spot, so the badge rides the chest as the cloth moves
    near = min(range(len(co)), key=lambda i: (co[i] - origin).length_squared)
    groups = {suit.vertex_groups[g.group].name: g.weight for g in suit.data.vertices[near].groups}
    _weights(badge, {b: w for b, w in groups.items() if b in rig.data.bones and w > 0.01})
    print("badge pinned at", tuple(round(c, 3) for c in origin), "weights", {b: round(w, 2) for b, w in groups.items()})
