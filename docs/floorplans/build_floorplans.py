"""Builds the floor plans (floor1_plan.png/.json ... floor4_plan.png/.json) next to this script.

Run:  python3 build_floorplans.py      (needs Pillow)

All four floors share one layout. Floor 1 has the entrance lobby at the south end;
floors 2 to 4 replace it with a food court (restaurant windows instead of stores along
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

# floor 1: street doors; floors 2 to 4: balcony doors
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

# balconies on floors 2 to 4: along the south and south-east outer wall of the food court,
# and a small one at the end of the short hall
BALCONIES = [
    ("balcony_south", "Balcony along the south and south-east wall",
     [(57, -3), (72, -4), (85, 0), (97.1, 13.4), (94, 16), (84, 4), (72, 0), (57, 1)], "balcony"),
    ("balcony_side", "Small balcony at the end of the short hall",
     [UV(-13, 72), UV(-5, 72), UV(-5, 66), UV(-13, 66)], "balcony"),
]

COLORS = {"void": "#cfe3ff", "hall": "#f4f4f4", "elevator": "#ff9a9a", "stairs": "#e0c8a0",
          "escalator": "#ffe680", "shop": "#dcdcdc", "bath": "#9be29b", "garage": "#c9c9d8",
          "secret": "#e3c9f0", "kiosk": "#f7d774", "machines": "#f0a8d0", "foodcourt": "#fff0cc", "restaurant": "#f2b8a0", "balcony": "#bfe6dc"}
WALKABLE = {"void", "hall", "bath", "garage", "secret", "foodcourt", "balcony"}


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
            l, k = "Stairs between floors 2, 3 and 4 (replaces the kiosk)", "stairs"
        if floor > 1 and i.startswith("south_shop_"):
            if floor == 2:
                l, k = "Kiosk", "kiosk"
            else:
                l, k = "Candy / toy coin machines", "machines"
        items.append((i, l, ("box", (a, b, c, d)), k))
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
          "hall_ew_garage": "garage hall", "balcony_south": "balcony", "balcony_side": "balcony"}
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
    for n in (1, 2, 3, 4):
        build(n)
