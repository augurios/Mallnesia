"""Builds the floor plans (floor1_plan.png/.json ... floor3_plan.png/.json) next to this script.

Run:  python3 build_floorplans.py      (needs Pillow)

All three floors share one layout. Floor 1 has the entrance lobby at the south end;
floors 2 and 3 replace it with a food court (restaurant windows instead of stores along
the sides, balconies instead of the main doors and street access).

Meters, x east, y north, origin = south-west corner of the real building footprint
(footprint_osm.json). Every box edge is a multiple of 3 m, except the 5 m shop passage,
the 45-degree south-west diagonal hall and the lobby / food court outline.
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

# id, label, x0, x1, y0, y1, kind
BOXES = [
    ("atrium_b", "Atrium B (open void)", 51, 90, 123, 159, "void"),
    ("cross_corridor", "Cross-corridor", 51, 90, 111, 123, "hall"),
    ("atrium_a", "Atrium A (open void)", 51, 90, 51, 111, "void"),
    ("south_hall", "South hall (below Atrium A)", 45, 90, 45, 51, "hall"),
    ("south_shop_1", "Shop (west, aligned with the Atrium A stairs and the atrium's west side)", 51, 60, 36, 45, "shop"),
    ("south_shop_2", "Shop", 66, 76, 36, 45, "shop"),
    ("south_pass_1", "Passage between the west shop and the middle shop", 60, 66, 36, 45, "hall"),
    ("south_pass_2", "Passage between the middle and east shops (5 m)", 76, 81, 36, 45, "hall"),
    ("south_shop_3", "Shop", 81, 90, 36, 45, "shop"),
    ("b_elevators", "Elevator pair (B, NE), on the north hall", 78, 87, 153, 159, "elevator"),
    ("b_stairs", "Stairs (B, NW), on the north hall", 54, 60, 153, 159, "stairs"),
    ("b_center_stair", "Center curved stair (B, S), on the cross-corridor", 63, 72, 123, 132, "stairs"),
    ("a_escalators", "Escalators up/down, full width from the west hall to the east hall", 51, 90, 105, 111, "escalator"),
    ("a_stairs", "Stairs (A, SW), on the south hall, aligned with the west shop", 51, 60, 51, 57, "stairs"),
    ("a_elevators", "Elevator pair (A, SE), on the south hall", 78, 87, 51, 57, "elevator"),
    # west side, west to east
    ("parking", "Parking lot / garage side", 3, 15, 84, 183, "garage"),
    ("west_n", "W1 stores north", 15, 27, 117, 159, "shop"),
    ("hall_ew_garage", "East-west hall to the garage", 15, 45, 111, 117, "hall"),
    ("west_hall_outer", "West hall (outer)", 27, 33, 63, 159, "hall"),
    ("west_2n", "W2 stores north", 33, 45, 117, 159, "shop"),
    ("west_hall_inner", "West hall (next to the atriums), runs down to the lobby / food court", 45, 51, 30, 159, "hall"),
    # east side
    ("east_hall", "East hall", 90, 96, 36, 165, "hall"),
    ("east_stores", "East stores (north of the short hall, up to the north hall)", 96, 108, 39, 159, "shop"),
    ("east_side_south", "East block south of the short hall (continues along the lobby / food court)", 96, 108, 18, 33, "side"),
    ("east_spur", "Short hall east to the SE bathrooms", 96, 108, 33, 39, "hall"),
    ("se_bath", "Bathrooms (SE)", 108, 120, 30, 45, "bath"),
    ("secret_hall", "Secret hallway (game): SE bathrooms to NE bathrooms", 108, 111, 45, 147, "secret"),
    ("ne_bath", "Bathrooms (NE), door on the north hall", 108, 120, 147, 159, "bath"),
    # north
    ("hall_north", "North hall (ends at a store wall)", 15, 120, 159, 165, "hall"),
    ("top_left_block", "Top-left block", 15, 48, 165, 183, "shop"),
    ("nw_bath", "Bathrooms (NW)", 15, 27, 165, 174, "bath"),
    ("nw_stairs", "Stairs (NW)", 27, 36, 165, 174, "stairs"),
    ("n_hall_up", "Wide hall north", 48, 66, 165, 189, "hall"),
    ("big_store", "Big store", 66, 90, 165, 183, "shop"),
    ("n_hall_behind", "Hall behind the big store", 48, 96, 183, 189, "hall"),
    ("north_stores", "Store block along the outer (north) side of the hall behind the wide hall and big store", 48, 96, 189, 201, "shop"),
    ("north_stores_w", "North stores, west end (wraps around the hall end)", 36, 48, 183, 201, "shop"),
    ("north_stores_e", "North stores, east end (wraps around the hall end)", 96, 108, 183, 201, "shop"),
    ("n_hall_down", "Hall down beside the NE block", 90, 96, 165, 189, "hall"),
    ("ne_block", "NE store block", 96, 114, 165, 183, "shop"),
    ("ne_end_store", "Store closing the north hall", 120, 132, 153, 171, "shop"),
    # south
    ("walkin_kiosk", "Walk-in kiosk (island in the lobby / food court)", 72, 81, 15, 21, "shop"),
    ("west_side_south", "West block: the diagonal stores continue south along the lobby / food court", 45, 57, 1, 30, "side"),
]

SOUTH_AREA = [(57, 1), (72, 0), (84, 4), (94, 16), (96, 18), (96, 36), (51, 36), (51, 30), (57, 30)]


def UV(u, v):
    # 45-degree frame of the diagonal hall: u = x - y (along the hall), v = x + y (across it)
    return (round((u + v) / 2, 1), round((v - u) / 2, 1))


POLYS = [
    ("west_s", "W1 stores south (runs down to the diagonal stores)", [(15, 111), (27, 111), (27, 65), (21, 59), (15, 59)], "shop"),
    ("west_2s", "W2 stores south (runs down to the diagonal hall)", [(33, 111), (45, 111), (45, 55), (33, 67)], "shop"),
    ("south_area", "Entrance lobby", SOUTH_AREA, "hall"),
    ("sw_diag_hall", "Diagonal hall (45 degrees) from the outer west hall to the inner west hall", [(27, 65), (27, 73), (45, 55), (45, 47)], "hall"),
    ("sw_stores_w", "Diagonal hall stores, west part", [UV(-38, 80), UV(-38, 92), UV(-13, 92), UV(-13, 80)], "side"),
    ("sw_stores_e", "Diagonal hall stores, east part", [UV(-5, 80), UV(-5, 92), (45, 47), (45, 35)], "side"),
    ("sw_spur", "Short hall to the side door (between the two stores)", [UV(-13, 72), UV(-13, 92), UV(-5, 92), UV(-5, 72)], "hall"),
]

# intermittent elevators and stairs (mechanic: the mall makes them appear and disappear), on every floor.
# Drawn over the store blocks they sit in; not walkable (like other stairs and elevators).
INTERMITTENT = [
    ("int_elevator_w2n", "Intermittent elevator, NW corner of W2 N, reached from the outer west hall", 33, 39, 153, 159, "intermittent"),
    ("int_elevator_w1n", "Intermittent elevator, south end of W1 N, reached from the garage hall", 21, 27, 117, 123, "intermittent"),
    ("int_stairs_w1s", "Intermittent stairs, north end of W1 S, reached from the garage hall", 15, 24, 105, 111, "intermittent"),
]

# floor 1: street doors; floors 2 and 3: balcony doors
DOORS_F1 = [
    ("main_entrance", "Main entrance (stairs up from street)", 88, 10),
    ("side_exit", "Side exit (purple), end of the short hall") + UV(-9, 72),
    ("garage_open_1", "Parking-lot opening 1", 15, 162),
    ("garage_open_2", "Parking-lot opening 2", 15, 114),
]
DOORS_UP = [
    ("balcony_door_main", "Balcony door (where the main entrance is on floor 1)", 88, 10),
    ("garage_open_1", "Garage connection 1", 15, 162),
    ("garage_open_2", "Garage connection 2", 15, 114),
]

# balconies on floors 2 and 3: along the south and south-east outer wall of the food court,
# and a small one at the end of the short hall
BALCONIES = [
    ("balcony_south", "Balcony along the south and south-east wall",
     [(57, -3), (72, -4), (85, 0), (97.1, 13.4), (94, 16), (84, 4), (72, 0), (57, 1)], "balcony"),
    ("balcony_side", "Small balcony at the end of the short hall",
     [UV(-13, 72), UV(-5, 72), UV(-5, 66), UV(-13, 66)], "balcony"),
]

COLORS = {"void": "#cfe3ff", "hall": "#f4f4f4", "elevator": "#ff9a9a", "stairs": "#e0c8a0",
          "escalator": "#ffe680", "shop": "#dcdcdc", "bath": "#9be29b", "garage": "#c9c9d8",
          "secret": "#e3c9f0", "intermittent": "#d6b3ff", "cinema_lobby": "#e4dcf5", "cinema": "#8a8aa8", "kiosk": "#f7d774", "machines": "#f0a8d0", "foodcourt": "#fff0cc", "restaurant": "#f2b8a0", "balcony": "#bfe6dc"}
WALKABLE = {"cinema_lobby", "void", "hall", "bath", "garage", "secret", "foodcourt", "balcony"}


def north_floor2(items):
    """Floor 2 north end: a narrow (6 m) hall runs all the way north to a possible exit, and four square shops
    separated by passages replace the big store."""
    out = []
    for it in items:
        i = it[0]
        if i == "big_store":
            continue
        if i == "n_hall_up":
            it = (i, "Narrow hall north (6 m), runs to a possible exit at the north end", ("box", (48, 54, 165, 201)), "hall")
        elif i == "north_stores":
            it = (i, "North stores (the narrow hall cuts through the west end)", ("box", (54, 96, 189, 201)), "shop")
        out.append(it)
    # two rows of 6 m x 6 m square shops on the 3 m grid, 3 m between the rows, 4 m passages between columns
    # (4 x 6 + 3 x 4 = 36 m); the 3 m left behind the back row joins the hall behind
    for n in range(4):
        x0 = 54 + n * 10
        out.append(("shop_n%d_a" % (n + 1), "Shop %dA (floor 2, 6 m square, front row)" % (n + 1), ("box", (x0, x0 + 6, 165, 171)), "shop"))
        out.append(("shop_n%d_b" % (n + 1), "Shop %dB (floor 2, 6 m square, back row)" % (n + 1), ("box", (x0, x0 + 6, 174, 180)), "shop"))
    for x0 in (60, 70, 80):
        out.append(("passage_n_%d" % x0, "4 m passage between shop columns", ("box", (x0, x0 + 4, 165, 183)), "hall"))
    out.append(("gap_n", "3 m gap between the shop rows", ("box", (54, 90, 171, 174)), "hall"))
    out.append(("strip_n", "3 m strip behind the back row (joins the hall behind)", ("box", (54, 90, 180, 183)), "hall"))
    return out


def north_cinema(items):
    """Floor 3, north part (east of the top-left block up to the NE block): a cinema food station in the
    middle with two wide cinemas on its sides, which also run behind it."""
    drop = {"n_hall_up", "big_store", "n_hall_behind", "north_stores", "n_hall_down"}
    out = [it for it in items if it[0] not in drop]
    out.append(("cinema_lobby", "Cinema concourse (in front of the stores, the food station and the cinema entrances)", ("box", (48, 96, 165, 171)), "cinema_lobby"))
    out.append(("cinema_food", "Cinema food stand (middle, wide counter faces the concourse)", ("box", (60, 84, 171, 189)), "kiosk"))
    out.append(("cinema_1", "Cinema 1 (west of the food stand, and behind it)", ("poly", [(48, 171), (60, 171), (60, 189), (72, 189), (72, 201), (48, 201)]), "cinema"))
    out.append(("cinema_2", "Cinema 2 (east of the food stand, and behind it)", ("poly", [(96, 171), (84, 171), (84, 189), (72, 189), (72, 201), (96, 201)]), "cinema"))
    return out


def floor_items(floor):
    """Boxes and polygons for one floor, as (id, label, shape, kind) with shape ('box', ...) or ('poly', ...)."""
    items = []
    side_kind = "shop" if floor == 1 else "restaurant"
    for i, l, a, b, c, d, k in BOXES:
        if k == "side":
            k = side_kind
            if floor > 1:
                l = l.replace("West block", "Restaurant windows (west)").replace("East block", "Restaurant windows (east)")
        if floor > 1 and i == "walkin_kiosk":
            l, k = "Stairs between floors 2 and 3 (replaces the kiosk)", "stairs"
        if floor > 1 and i.startswith("south_shop_"):
            if floor == 2:
                l, k = "Kiosk", "kiosk"
            else:
                l, k = "Candy / toy coin machines", "machines"
        items.append((i, l, ("box", (a, b, c, d)), k))
    if floor == 2:
        items = north_floor2(items)
    if floor == 3:
        items = north_cinema(items)
    for i, l, p, k in POLYS:
        if i == "south_area" and floor > 1:
            l, k = "Food court (seating)", "foodcourt"
        if i == "sw_spur" and floor > 1:
            # no short hall / side exit on upper floors: the restaurant windows run unbroken
            p = [UV(-13, 80), UV(-13, 92), UV(-5, 92), UV(-5, 80)]
            l, k = "Restaurant windows between the two diagonal blocks (no short hall)", "restaurant"
        if k == "side":
            k = side_kind
            if floor > 1:
                l = "Restaurant windows along the diagonal hall" + l[l.index(","):]
        items.append((i, l, ("poly", p), k))
    if floor > 1:
        for i, l, p, k in BALCONIES:
            if i == "balcony_side":
                continue
            items.append((i, l, ("poly", p), k))
    for i, l, a, b, c, d, k in INTERMITTENT:
        items.append((i, l, ("box", (a, b, c, d)), k))
    if floor == 3:
        # the west hall widens over the north-west corner of Atrium B; the cinema box office is there
        items.append(("boxoffice_floor", "West hall extension over the NW corner of Atrium B (cinema box office area)", ("box", (51, 57, 141, 153)), "hall"))
        items.append(("boxoffice", "Cinema box office counter, facing the west hall", ("box", (57, 60, 141, 153)), "kiosk"))
    return items


def inpoly(x, y, p):
    c = False
    j = len(p) - 1
    for i in range(len(p)):
        if (p[i][1] > y) != (p[j][1] > y) and x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]:
            c = not c
        j = i
    return c


def inside(shape, x, y):
    t, v = shape
    return (v[0] <= x < v[1] and v[2] <= y < v[3]) if t == "box" else inpoly(x, y, v)


def check(items, R=0.5):
    """Flood-fills the walkable cells and returns the number of separate walkable areas."""
    walk = set()
    for ix in range(-20, 300):
        for iy in range(-20, 420):
            x, y = ix * R + R / 2, iy * R + R / 2
            if any(k in WALKABLE and inside(s, x, y) for _, _, s, k in items):
                walk.add((ix, iy))
    seen, comps = set(), 0
    for c in walk:
        if c in seen:
            continue
        comps += 1
        stack = [c]
        seen.add(c)
        while stack:
            a = stack.pop()
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                b = (a[0] + dx, a[1] + dy)
                if b in walk and b not in seen:
                    seen.add(b)
                    stack.append(b)
    return comps


LABELS = {"atrium_b": "Atrium B", "atrium_a": "Atrium A", "cross_corridor": "cross-corridor", "parking": "garage side",
          "secret_hall": "secret", "big_store": "big store", "west_2n": "W2 N", "west_2s": "W2 S", "west_n": "W1 N",
          "west_s": "W1 S", "hall_north": "north hall", "ne_block": "NE block", "top_left_block": "top-left block",
          "north_stores": "stores", "north_stores_w": "stores", "north_stores_e": "stores", "walkin_kiosk": "kiosk", 
          "nw_bath": "bath", "ne_bath": "bath", "se_bath": "bath", "b_center_stair": "center stair",
          "a_escalators": "escalators", "n_hall_up": "wide hall", "east_stores": "east stores", "ne_end_store": "store",
          "south_hall": "south hall", "south_shop_1": "shop", "south_shop_2": "shop", "south_shop_3": "shop",
          "east_hall": "east hall", "west_hall_inner": "west hall", "west_hall_outer": "west hall",
          "hall_ew_garage": "garage hall", "cinema_food": "cinema food", "boxoffice": "", "boxoffice_floor": "",  "int_elevator_w2n": "i-elev", "int_elevator_w1n": "i-elev", "int_stairs_w1s": "i-stairs", "balcony_south": "balcony", "balcony_side": "balcony"}
VERTICAL = ("parking", "secret_hall", "east_hall", "west_hall_inner", "west_hall_outer", "west_2n", "west_2s")


def render(floor, items, doors):
    S, W, H = 7, 1200, 1680
    ox, oy = 100, H - 110

    def T(x, y):
        return (ox + x * S, oy - y * S)

    im = Image.new("RGB", (W, H), "white")
    dr = ImageDraw.Draw(im)
    f = ImageFont.load_default(size=15)
    fb = ImageFont.load_default(size=24)
    fs = ImageFont.load_default(size=13)
    for gx in range(0, 151, 3):
        dr.line([T(gx, 0), T(gx, 204)], fill=(236, 236, 236) if gx % 30 else (205, 205, 205))
    for gy in range(0, 204, 3):
        dr.line([T(0, gy), T(150, gy)], fill=(236, 236, 236) if gy % 30 else (205, 205, 205))
    for gx in range(0, 151, 30):
        dr.text((T(gx, 0)[0] - 8, oy + 6), str(gx), fill="black", font=f)
    for gy in range(0, 204, 30):
        dr.text((ox - 40, T(0, gy)[1] - 8), str(gy), fill="black", font=f)

    def rot_text(t, x, y):
        tt = Image.new("RGBA", (160, 24), (0, 0, 0, 0))
        ImageDraw.Draw(tt).text((0, 0), t, fill="black", font=f)
        tt = tt.rotate(90, expand=True)
        im.paste(tt, (int(x - 12), int(y - 60)), tt)

    # polygons first (south area, balconies), then boxes on top
    for i, l, (t, v), k in items:
        if t == "poly":
            dr.polygon([T(*q) for q in v], fill=COLORS[k], outline="black")
    for i, l, (t, v), k in items:
        if t == "box":
            x0, y0 = T(v[0], v[3])
            x1, y1 = T(v[1], v[2])
            dr.rectangle([x0, y0, x1, y1], fill=COLORS[k], outline="black")
    for i, l, (t, v), k in items:
        if t != "box":
            continue
        txt = LABELS.get(i)
        if i in ("east_side_south", "west_side_south"):
            txt = "restaurants" if floor > 1 else "stores"
        if floor == 2 and i == "n_hall_up":
            txt = "narrow hall"
        if floor > 1 and i == "walkin_kiosk":
            txt = "stairs"
        if floor > 1 and i.startswith("south_shop_"):
            txt = "kiosk" if floor == 2 else "machines"
        if txt:
            x, y = T((v[0] + v[1]) / 2, (v[2] + v[3]) / 2)
            if i in VERTICAL:
                rot_text(txt, x, y)
            elif i == "west_side_south" and floor > 1:
                rot_text(txt, x, y)
            else:
                dr.text((x - len(txt) * 4, y - 8), txt, fill="black", font=fb if i.startswith("atrium") else f)
    for i, l, (t, v), k in items:
        if i in ("west_s", "west_2s"):
            xs, ys = [q[0] for q in v], [q[1] for q in v]
            x, y = T((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2 + 8)
            rot_text({"west_s": "W1 S", "west_2s": "W2 S"}[i], x, y)
        if i == "balcony_south":
            px, py = T(76, -1)
            dr.text((px - 20, py - 4), "balcony", fill="black", font=f)
    dr.text(T(66, 28), "entrance lobby" if floor == 1 else "food court", fill="black", font=f)
    dr.text(T(6, 52), "diagonal hall + " + ("stores" if floor == 1 else "restaurants"), fill="black", font=fs)
    if floor == 3:
        dr.text(T(55, 196), "cinema 1", fill="black", font=f)
        dr.text(T(77, 196), "cinema 2", fill="black", font=f)
    for i, l, x, y in doors:
        px, py = T(x, y)
        purple = i in ("side_exit", "balcony_door_side")
        dr.ellipse([px - 9, py - 9, px + 9, py + 9], fill=(150, 60, 200) if purple else (230, 120, 0), outline="black")
    dr.text((ox, 24), "Floor %d (3 m grid, meters, north up)" % floor, fill="black", font=fb)
    sub = ("Orange dot = door/opening, purple = side exit. Thin grid = 3 m, bold = 30 m." if floor == 1 else
           "Orange dot = door/opening, Red-orange = restaurant windows, teal = balconies. Thin grid = 3 m, bold = 30 m.")
    dr.text((ox, 56), sub, fill=(60, 60, 60), font=fs)
    if floor == 1:
        mx, my = T(88, 10)
        dr.text((mx - 50, my + 14), "main entrance", fill="black", font=f)
    im.save(os.path.join(HERE, "floor%d_plan.png" % floor))


def build(floor):
    items = floor_items(floor)
    doors = DOORS_F1 if floor == 1 else DOORS_UP
    if floor == 3:
        doors = doors + [("cinema_entrance_%d" % (n + 1), "Cinema %d entrance" % (n + 1), x, 171) for n, x in enumerate((57, 87))]
    if floor == 2:
        doors = doors + [("north_exit", "Possible exit at the north end of the narrow hall", 51, 201)]
    comps = check(items)
    print("floor %d: walkable areas = %d (should be 1)" % (floor, comps))
    data = {
        "floor": floor,
        "status": "Floor plan, ready for blockout. Meters, x east, y north, origin = south-west corner of the real footprint. 3 m module; halls 6 m, store rows 12 m deep. Off-grid on purpose: the 45-degree south-west diagonal hall, the 5 m shop passage and the south area outline.",
        "grid_m": 3,
        "polygons": [dict(id=i, label=l, points=v[1], kind=k) for i, l, v, k in items if v[0] == "poly"],
        "boxes": [dict(id=i, label=l, x0=v[1][0], x1=v[1][1], y0=v[1][2], y1=v[1][3], kind=k) for i, l, v, k in items if v[0] == "box"],
        "openings": [dict(id=i, label=l, x=x, y=y) for i, l, x, y in doors],
    }
    with open(os.path.join(HERE, "floor%d_plan.json" % floor), "w") as fh:
        json.dump(data, fh, indent=1)
    render(floor, items, doors)


if __name__ == "__main__":
    for n in (1, 2, 3):
        build(n)
