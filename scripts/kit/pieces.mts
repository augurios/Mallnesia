// Kit pieces: small models repeated through the mall (generated here now, hand-modelled later: a piece is
// just a GLB with one node per material plus a "collider" node, so a hand-made file can replace a
// generated one without changing anything else). Each piece is built around its own origin: x and z centred,
// y = 0 on the floor, and is written to public/models/kit/<name>.glb by scripts/build-props.mts.
//
// Detail standard (docs/art_style_reference.md, "Kit piece detail standard"): the reference props have rounded
// edges, real profiles, ornament (moldings, framed panels, beads), hardware (bolts, hinges, escutcheons) and
// worn surfaces. So nothing here is a plain box: pieces are built from the soft primitives in ./soft.mts, every
// piece carries its hardware and moldings, and scripts/kit/wear.mts bakes where it is worn and dirty.
import { Geo, type V3, addTo, rockGeo } from "../blockout/geo.mts";
import { band, boltHead, cap, cord, loft, oriented, plate, placed, rectPath, roundedLoop, softBox, sweep, tubePath, turned as lathe, warped } from "./soft.mts";

export interface Piece {
  /** Geometry by material name (see scripts/blockout/palette.mts). */
  parts: Record<string, Geo>;
  /** Collision box, centred on the origin: half width in x, half depth in z, and height. It is invisible. */
  collider: { hx: number; hz: number; h: number };
  /** Placement keeps every cell within this radius of the origin walkable, plus the aisle the rule asks for. */
  radius: number;
  /** A piece that stands with its back (local -x) to a wall, front facing +x. The collider's hx is its half depth. */
  wall?: boolean;
}

const part = (piece: Piece, material: string, g: Geo) => addTo((piece.parts[material] ??= new Geo()), g);
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---- the food court chair -----------------------------------------------------------------------------

type Row = [x: number, y: number, halfWidth: number, wrap: number];

// A chair's side profile, front lip of the seat to the top of the back (chair faces +x). The seat is dished
// and the back rises from it in one piece, narrow at the waist and wider at the shoulders. `wrap` is how
// far the sides curl toward the sitter (0 = the seat: its sides curl up a little instead).
const SHELL: Row[] = [
  [0.23, 0.475, 0.2, 0],
  [0.2, 0.455, 0.215, 0],
  [0.1, 0.44, 0.225, 0],
  [0.0, 0.43, 0.225, 0],
  [-0.1, 0.435, 0.22, 0],
  [-0.18, 0.46, 0.2, 0.3],
  [-0.22, 0.52, 0.17, 0.7],
  [-0.245, 0.6, 0.165, 1],
  [-0.265, 0.7, 0.19, 1],
  [-0.28, 0.79, 0.215, 1],
  [-0.285, 0.86, 0.21, 1],
  [-0.275, 0.905, 0.16, 1],
  [-0.26, 0.925, 0.08, 1],
];

/** Catmull-Rom through the rows, `sub` points per span. */
function smooth(rows: Row[], sub: number): Row[] {
  const out: Row[] = [];
  for (let k = 0; k < rows.length - 1; k++) {
    const p = [rows[Math.max(k - 1, 0)], rows[k], rows[k + 1], rows[Math.min(k + 2, rows.length - 1)]];
    for (let q = 0; q < sub; q++) {
      const t = q / sub;
      out.push([0, 1, 2, 3].map((c) => 0.5 * (2 * p[1][c] + (-p[0][c] + p[2][c]) * t + (2 * p[0][c] - 5 * p[1][c] + 4 * p[2][c] - p[3][c]) * t * t + (-p[0][c] + 3 * p[1][c] - 3 * p[2][c] + p[3][c]) * t * t * t)) as Row);
    }
  }
  out.push(rows[rows.length - 1]);
  return out;
}

/** The molded shell of a chair: one curved plate with a real thickness, rolled rim at the sides. */
function shellGeo(): Geo {
  const smoothRows = smooth(SHELL, 2);
  // support rows and columns a centimetre or so in from the rim, as a modeller would add: they keep the rim's
  // baked wear (scripts/kit/wear.mts) on the rim instead of smearing it across the seat
  const lerp = (a: Row, b: Row, t: number) => a.map((v, k) => v + (b[k] - v) * t) as Row;
  const last = smoothRows.length - 1;
  const rows = [smoothRows[0], lerp(smoothRows[0], smoothRows[1], 0.35), ...smoothRows.slice(1, last), lerp(smoothRows[last], smoothRows[last - 1], 0.3), smoothRows[last]];
  const ts = [-1, -0.95, -0.66, -0.33, 0, 0.33, 0.66, 0.95, 1];
  const grid = rows.map(([x, y, w, wrap]) =>
    ts.map((t): V3 => [x + wrap * 0.075 * t * t, y + (1 - wrap) * 0.035 * t * t, t * w]),
  );
  return plate(grid, 0.005, [1, 1, 0]);
}

const SHELL_GEO = shellGeo();

/** A rubber foot cap. */
const foot = (x: number, z: number) => lathe(x, z, [[0, 0], [0.015, 0], [0.0172, 0.006], [0.0135, 0.026], [0, 0.026]], 6);

/** A food-court chair for one person, facing +x: a red molded shell on four grey tube legs joined by rails. */
function chair(into: Piece, yaw: number, tx: number, tz: number) {
  const at = (g: Geo) => placed(g, yaw, tx, 0, tz);
  part(into, "plastic", at(SHELL_GEO));
  for (const s of [-1, 1]) {
    const z = 0.19 * s;
    part(into, "chair_leg", at(tubePath([[0.215, 0.026, z * 1.08], [0.203, 0.22, z * 1.03], [0.19, 0.43, z]], 0.0125, 0.0125, 6, 2))); // front leg
    part(into, "chair_leg", at(tubePath([[-0.2, 0.026, z * 1.1], [-0.19, 0.24, z * 1.03], [-0.17, 0.43, z], [-0.2, 0.5, z * 0.95], [-0.225, 0.58, z * 0.9]], 0.0125, 0.0125, 6, 2))); // rear leg, up to the back
    part(into, "chair_leg", at(tubePath([[0.2, 0.3, z * 1.04], [-0.185, 0.3, z * 1.04]], 0.0095, 0.0095, 5, 1))); // side rail
    part(into, "steel", at(foot(0.215, z * 1.08)));
    part(into, "steel", at(foot(-0.2, z * 1.1)));
    // weld beads where the rail meets the legs
    for (const x of [0.2, -0.185]) part(into, "chair_leg", at(oriented(lathe(0, 0, [[0.0098, -0.006], [0.0135, -0.003], [0.0135, 0.003], [0.0098, 0.006]], 8), [1, 0, 0], [x - Math.sign(x) * 0.012, 0.3, z * 1.04])));
    // mounting tabs under the seat, each held to the shell by a dome-head screw on its outer face
    for (const x of [0.17, -0.15]) {
      part(into, "chair_leg", at(softBox(x - 0.03, x + 0.03, 0.418, 0.432, z - 0.016, z + 0.016, { r: 0.006, e: 0.003, steps: 1, corner: 2 })));
      part(into, "steel", at(oriented(boltHead(0.0045, false), [0, 0, s], [x, 0.425, z + s * 0.016])));
    }
    // the back is screwed to the rear legs where they rise behind it
    part(into, "steel", at(oriented(boltHead(0.005, false), [-1, 0, 0], [-0.226, 0.56, z * 0.91])));
  }
  part(into, "chair_leg", at(tubePath([[0.19, 0.4, -0.19], [0.19, 0.4, 0.19]], 0.009, 0.009, 5, 1))); // brace under the seat front
}

// ---- the table set --------------------------------------------------------------------------------------

/** A rectangular white table with a black edge, a square post and a black cross foot, two chairs on each long side. */
function tableSet(): Piece {
  const piece: Piece = { parts: {}, collider: { hx: 0.75, hz: 0.95, h: 1.3 }, radius: 1.3 };
  part(piece, "steel", softBox(-0.45, 0.45, 0.713, 0.752, -0.35, 0.35, { r: 0.05, e: 0.012, steps: 2, corner: 2 })); // the black edge band
  part(piece, "steel", band(0, 0, 0.45, 0.35, 0.05, cord(-0.001, 0.7325, 0.0035, 4), 2)); // its center ridge (a T-molding)
  part(piece, "laminate", softBox(-0.44, 0.44, 0.75, 0.7565, -0.34, 0.34, { r: 0.04, e: 0.002, steps: 1, corner: 2, flatBottom: true })); // the white top
  // under the top: a mounting plate, its four screws
  part(piece, "steel", softBox(-0.16, 0.16, 0.703, 0.714, -0.16, 0.16, { r: 0.02, e: 0.004, steps: 1, corner: 2 }));
  for (const [x, z] of [[-0.13, -0.13], [-0.13, 0.13], [0.13, -0.13], [0.13, 0.13]]) part(piece, "chair_leg", oriented(boltHead(0.006), [0, -1, 0], [x, 0.703, z]));
  part(piece, "steel", softBox(-0.05, 0.05, 0.07, 0.704, -0.105, 0.105, { r: 0.022, e: 0.01, steps: 2, corner: 2 })); // the post
  part(piece, "steel", band(0, 0, 0.05, 0.105, 0.022, [[0, 0.62], [0.006, 0.625], [0.006, 0.64], [0, 0.645]], 2)); // a collar near the top
  // the post's base flange, bolted down to the cross foot
  part(piece, "steel", softBox(-0.095, 0.095, 0.055, 0.075, -0.15, 0.15, { r: 0.03, e: 0.006, steps: 2, corner: 2 }));
  for (const [x, z] of [[-0.07, -0.12], [-0.07, 0.12], [0.07, -0.12], [0.07, 0.12]]) part(piece, "chair_leg", oriented(boltHead(0.0075), [0, 1, 0], [x, 0.075, z]));
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    // the cross foot: an arm that tapers a little and dips toward its ends
    const arm = softBox(-0.34, 0.34, 0.012, 0.055, -0.03, 0.03, { r: 0.012, e: 0.01, steps: 2, corner: 2 });
    part(piece, "steel", placed(warped(arm, ([x, y, z]) => [x, 0.012 + (y - 0.012) * (1 - 0.35 * Math.abs(x) / 0.34), z * (1 - 0.2 * Math.abs(x) / 0.34)]), a, 0, 0, 0));
    for (const end of [-1, 1]) {
      const ex = end * 0.31 * Math.cos(a);
      const ez = -end * 0.31 * Math.sin(a);
      // a levelling glide under each end: a grey disc on a threaded stem, with its lock nut on top of the arm
      part(piece, "chair_leg", lathe(ex, ez, [[0, 0], [0.024, 0], [0.026, 0.004], [0.02, 0.008], [0.006, 0.009], [0.006, 0.014], [0, 0.014]], 12));
      part(piece, "chair_leg", oriented(boltHead(0.008), [0, 1, 0], [ex, 0.04, ez]));
    }
  }
  for (const side of [-1, 1])
    for (const x of [-0.24, 0.24]) chair(piece, side > 0 ? Math.PI / 2 : -Math.PI / 2, x, side * 0.6);
  return piece;
}

// ---- the red padded bench -------------------------------------------------------------------------------

/** A red padded bench against a wall, like the one by the kiosks: a dark plinth, a puffy cushion and a leaning,
 *  rounded back, every cushion edge finished with a welt (piping) as upholstery is. */
function bench(): Piece {
  const piece: Piece = { parts: {}, collider: { hx: 0.28, hz: 0.92, h: 1.0 }, radius: 1.0, wall: true };
  part(piece, "steel", softBox(-0.235, 0.215, 0.085, 0.385, -0.875, 0.875, { r: 0.035, e: 0.014, steps: 3 })); // the plinth
  part(piece, "steel", softBox(-0.215, 0.185, 0.03, 0.09, -0.85, 0.85, { r: 0.03, e: 0.008, steps: 2 })); // the toe-kick, set back
  part(piece, "steel", band(-0.01, 0, 0.225, 0.875, 0.035, cord(0.001, 0.372, 0.005, 4))); // a bead under the cushion
  for (const x of [-0.17, 0.14]) for (const z of [-0.8, 0.8]) part(piece, "chair_leg", lathe(x, z, [[0, 0], [0.022, 0], [0.024, 0.006], [0.014, 0.01], [0.009, 0.012], [0.009, 0.034], [0, 0.034]], 10)); // levelling feet
  // the seat cushion, its front pulled into shallow wrinkles where the vinyl wraps under
  const seat = softBox(-0.27, 0.27, 0.38, 0.5, -0.905, 0.905, { r: 0.07, e: 0.045, steps: 4, corner: 4, crown: 0.025 });
  part(piece, "vinyl", warped(seat, ([x, y, z]) => {
    const front = Math.max(0, (x - 0.2) / 0.07) * Math.max(0, 1 - Math.abs(y - 0.42) / 0.05);
    return [x - front * 0.003 * (1 + Math.sin(z * 37 + Math.sin(z * 11) * 2)), y, z];
  }));
  part(piece, "vinyl", band(0, 0, 0.27, 0.905, 0.07, cord(-0.0005, 0.4555, 0.0055), 4)); // welt round the top seam
  part(piece, "vinyl", band(0, 0, 0.27, 0.905, 0.07, cord(-0.0005, 0.4245, 0.0055), 4)); // and the bottom seam
  // the back cushion: built upright, then leaned away from the sitter and curled a little at the ends; its welts
  // and the seam between its two panels are built upright too and bent the same way
  const lean = ([x, y, z]: V3): V3 => {
    const t = (y - 0.46) / 0.52;
    return [x - 0.2 - 0.09 * t * t + 0.035 * (z / 0.9) ** 2 * (0.4 + t), y, z];
  };
  part(piece, "vinyl", warped(softBox(-0.105, 0.105, 0.46, 0.98, -0.905, 0.905, { r: 0.08, e: 0.05, steps: 4, corner: 4, crown: 0.02 }), lean));
  const welt = (y0: number, y1: number) => {
    // a welt running round the cushion's face: down both ends and along the top
    const path: V3[] = [];
    for (let k = 0; k <= 8; k++) path.push([0.105, y0 + ((y1 - y0) * k) / 8, -0.83]);
    for (let k = 1; k < 16; k++) path.push([0.105, y1 + 0.004 * Math.sin((Math.PI * k) / 16), -0.83 + (1.66 * k) / 16]);
    for (let k = 8; k >= 0; k--) path.push([0.105, y0 + ((y1 - y0) * k) / 8, 0.83]);
    return path;
  };
  part(piece, "vinyl", warped(tubePath(welt(0.5, 0.93), 0.0055, 0.0055, 6, 1), lean));
  part(piece, "vinyl", warped(tubePath([[0.105, 0.74, -0.82], [0.107, 0.74, 0], [0.105, 0.74, 0.82]], 0.0035, 0.0035, 6, 4), lean)); // the stitched seam between the back's two panels
  part(piece, "steel", tubePath([[-0.17, 0.505, -0.86], [-0.17, 0.505, 0.86]], 0.004, 0.004, 5, 1)); // the crease where seat and back meet
  return piece;
}

// ---- the waste bin --------------------------------------------------------------------------------------

/** A round waste bin: a fluted dark body on a foot ring, a rolled rim, a grey band held by rivets, and a black
 *  liner folded over the edge. */
function bin(): Piece {
  const piece: Piece = { parts: {}, collider: { hx: 0.25, hz: 0.25, h: 1.0 }, radius: 0.3, wall: true };
  const body: [number, number][] = [
    [0, 0.004], [0.185, 0.004], [0.197, 0.012], [0.198, 0.03], [0.214, 0.042], [0.222, 0.06], [0.224, 0.09], [0.224, 0.2], [0.226, 0.38], [0.226, 0.46], [0.226, 0.55], [0.228, 0.75], [0.228, 0.78],
    [0.234, 0.805], [0.238, 0.83], [0.234, 0.855], [0.224, 0.866], [0.212, 0.862], [0.208, 0.84], [0.205, 0.55], [0.2, 0.06], [0, 0.06],
  ];
  // 24 shallow vertical flutes pressed into the outside, between the foot and the rim (built into the rings, so
  // the normals follow them)
  const sides = 96;
  const rings = body.map(([r, y], i): V3[] =>
    Array.from({ length: sides }, (_, k): V3 => {
      const a = (k / sides) * Math.PI * 2;
      const outside = i < 13 && y > 0.09 && y < 0.78;
      const fade = outside ? Math.min(1, (y - 0.09) / 0.03, (0.78 - y) / 0.03) : 0;
      const rr = r * (1 - 0.022 * fade * Math.max(0, Math.cos(a * 24)) ** 2);
      return [Math.cos(a) * rr, y, Math.sin(a) * rr];
    }),
  );
  part(piece, "steel", loft(rings, true, [0, 0.004, 0]));
  part(piece, "chair_leg", lathe(0, 0, [[0.2262, 0.4], [0.2296, 0.408], [0.2304, 0.43], [0.2296, 0.438], [0.2272, 0.445]], 48)); // the band
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + Math.PI / 24;
    part(piece, "chair_leg", oriented(boltHead(0.004, false), [Math.cos(a), 0, Math.sin(a)], [Math.cos(a) * 0.229, 0.4225, Math.sin(a) * 0.229])); // its rivets
  }
  part(piece, "steel", lathe(0, 0, [[0.209, 0.5], [0.21, 0.86], [0.222, 0.905], [0.236, 0.88], [0.245, 0.83]], 24)); // the liner, folded over the rim
  part(piece, "chair_leg", lathe(0, 0, [[0.19, 0], [0.205, 0], [0.207, 0.006], [0.2, 0.012], [0.19, 0.012]], 24)); // a rubber foot ring
  return piece;
}

// ---- the planter ---------------------------------------------------------------------------------------

/** One broad leaf: an oval blade with a pointed tip, a folded midrib, a wavy edge, arching up and over from its stalk. */
function blade(len: number, lift: number, droop: number, phase: number): Geo {
  const rows = 6;
  const cols = 5;
  const grid = Array.from({ length: rows }, (_, i): V3[] => {
    const s = i / (rows - 1);
    const w = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.7)), 0.85) * len * 0.4;
    const x = s * len;
    const arch = lift * x - droop * x * x;
    return Array.from({ length: cols }, (_, c): V3 => {
      const t = (c / (cols - 1)) * 2 - 1;
      const wave = 0.014 * len * Math.sin(s * 13 + phase) * t * t; // ruffled margin
      return [x - Math.abs(t) * w * 0.12 * s, arch - Math.abs(t) * w * 0.28 + wave, t * w];
    });
  });
  return plate(grid, 0.002, [0, 1, 0]);
}

/** A concrete planter with white gravel, stones and a lush broad-leaf plant, set against a wall (as beside the kiosks). */
function planter(): Piece {
  const piece: Piece = { parts: {}, collider: { hx: 0.27, hz: 0.62, h: 1.0 }, radius: 0.75, wall: true };
  part(piece, "planter", softBox(-0.25, 0.25, 0.06, 0.45, -0.61, 0.61, { r: 0.05, e: 0.01, steps: 2 })); // the trough
  // the cornice: a cove under a projecting lip, a fillet and a rounded top edge, run all the way round
  part(piece, "planter", band(0, 0, 0.25, 0.61, 0.05, [[0, 0.43], [0.004, 0.432], [0.011, 0.438], [0.016, 0.446], [0.018, 0.452], [0.026, 0.453], [0.027, 0.458], [0.027, 0.49], [0.024, 0.498], [0.016, 0.502], [0, 0.502]]));
  // the plinth: a step out at the bottom with a chamfer, and a shadow gap under it
  part(piece, "planter", band(0, 0, 0.25, 0.61, 0.05, [[0, 0.075], [0.012, 0.068], [0.014, 0.06], [0.014, 0.03], [0.006, 0.026]]));
  part(piece, "planter", softBox(-0.235, 0.235, 0, 0.03, -0.595, 0.595, { r: 0.04, e: 0.006, steps: 1 }));
  // framed recessed panels on the long faces (one per bay) and the ends
  const frame: [number, number][] = [[-0.012, 0], [-0.009, 0.005], [-0.004, 0.007], [0, 0.005], [0.003, 0]];
  for (const sx of [-1, 1]) for (const z of [-0.3, 0.3]) part(piece, "planter", sweep(rectPath([sx * 0.25, 0.255, z], [0, 1, 0], [0, 0, 1], 0.13, 0.24, 0.02), [sx, 0, 0], frame));
  for (const sz of [-1, 1]) part(piece, "planter", sweep(rectPath([0, 0.255, sz * 0.61], [0, 1, 0], [1, 0, 0], 0.13, 0.17, 0.02), [0, 0, sz], frame));
  part(piece, "gravel", softBox(-0.25, 0.25, 0.45, 0.5, -0.61, 0.61, { r: 0.05, e: 0.014, steps: 3, crown: 0.012 }));
  const rnd = rng(7);
  const stones = (piece.parts.stone ??= new Geo());
  for (let i = 0; i < 16; i++) addTo(stones, rockGeo((rnd() * 2 - 1) * 0.19, 0.5, (rnd() * 2 - 1) * 0.55, 0.03 + rnd() * 0.035, 0.022 + rnd() * 0.02, 0.03 + rnd() * 0.03, rnd));
  const leaves = (piece.parts.garden ??= new Geo());
  const stalks = (piece.parts.garden_dark ??= new Geo());
  for (const z of [-0.4, 0, 0.4]) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      // a clump: tall leaves in the middle, shorter ones leaning farther out, each on its own stalk
      const f = i / (n - 1);
      const a = i * 2.4 + rnd() * 0.5; // golden-angle spread
      const h = 0.46 - f * 0.3 + rnd() * 0.12;
      const lean = 0.04 + f * 0.2 + rnd() * 0.05;
      const base: V3 = [(rnd() - 0.5) * 0.08, 0.5, z + (rnd() - 0.5) * 0.08];
      const tip: V3 = [base[0] + Math.cos(a) * lean, base[1] + h, base[2] + Math.sin(a) * lean];
      const mid: V3 = [base[0] + Math.cos(a) * lean * 0.2, base[1] + h * 0.55, base[2] + Math.sin(a) * lean * 0.2];
      addTo(stalks, tubePath([base, mid, tip], 0.011, 0.006, 5, 2));
      const len = 0.3 + (1 - f) * 0.1 + rnd() * 0.1;
      const b = placed(blade(len, 0.5 + rnd() * 0.6, 1.2 + rnd() * 1.2, rnd() * 6), -a + (rnd() - 0.5) * 0.3, tip[0], tip[1], tip[2]);
      addTo(leaves, b);
    }
  }
  return piece;
}

// ---- the tray-return stand ------------------------------------------------------------------------------

/** One food-court tray: a shallow dish with a rim, nested stacks show their lips. */
function tray(y: number, z: number, spin = 0): Geo {
  const hx = 0.235;
  const hz = 0.17;
  const profile: [number, number][] = [[0.014, 0], [0.004, 0.002], [0, 0.009], [0, 0.023], [0.002, 0.028], [0.007, 0.029], [0.011, 0.025], [0.015, 0.011], [0.02, 0.008]];
  const rings = profile.map(([inset, dy]): V3[] => roundedLoop(0, 0, hx - inset, hz - inset, 0.04 - inset * 0.5, 2).map(([x, zz]): V3 => [x, y + dy, zz]));
  const g = loft(rings, true, [0, y + 0.015, 0]);
  addTo(g, cap(rings[rings.length - 1], [0, 1, 0], [0, y + 0.008, 0]));
  return placed(g, spin, 0, 0, z);
}

/** The food court's tray-return stand: a black cabinet on casters with two framed doors, a molded top, and
 *  stacks of red trays on it. */
function trayStand(): Piece {
  const piece: Piece = { parts: {}, collider: { hx: 0.32, hz: 0.5, h: 1.25 }, radius: 0.7, wall: true };
  part(piece, "steel", softBox(-0.3, 0.3, 0.11, 0.84, -0.47, 0.47, { r: 0.02, e: 0.01, steps: 2 })); // the cabinet
  // the top: an overhanging slab with an ogee edge, sitting on a bead
  part(piece, "steel", band(0, 0, 0.3, 0.47, 0.02, cord(0, 0.842, 0.006, 4)));
  part(piece, "steel", band(0, 0, 0.3, 0.47, 0.02, [[0, 0.848], [0.012, 0.85], [0.02, 0.856], [0.022, 0.864], [0.026, 0.872], [0.03, 0.876], [0.03, 0.881], [0.026, 0.885], [0, 0.885]]));
  part(piece, "steel", cap(roundedLoop(0, 0, 0.3, 0.47, 0.02).map(([x, z]): V3 => [x, 0.885, z]), [0, 1, 0]));
  part(piece, "steel", softBox(-0.27, 0.27, 0.07, 0.115, -0.44, 0.44, { r: 0.03, e: 0.01, steps: 2 })); // the kick plate
  part(piece, "chair_leg", band(0, 0, 0.3, 0.47, 0.02, [[-0.005, 0.105], [0.004, 0.108], [0.004, 0.125], [-0.005, 0.128]])); // a scuff strip round the bottom
  const panel: [number, number][] = [[-0.018, 0], [-0.016, 0.006], [-0.01, 0.009], [-0.004, 0.006], [0.0, 0.004], [0.004, 0]];
  for (const z of [-0.23, 0.23]) {
    // a door: a slab standing proud, a raised field framed by a molding, hinges on the outer edge
    part(piece, "steel", softBox(0.292, 0.306, 0.18, 0.8, z - 0.21, z + 0.21, { r: 0.012, e: 0.005, steps: 2 }));
    part(piece, "steel", softBox(0.3, 0.312, 0.25, 0.73, z - 0.14, z + 0.14, { r: 0.015, e: 0.006, steps: 2 })); // the raised field
    part(piece, "steel", sweep(rectPath([0.306, 0.49, z], [0, 1, 0], [0, 0, 1], 0.27, 0.17, 0.02), [1, 0, 0], panel));
    const hz = z + Math.sign(z) * 0.212;
    for (const y of [0.26, 0.72]) part(piece, "chair_leg", lathe(0.304, hz, [[0, -0.035], [0.006, -0.035], [0.007, -0.03], [0.007, 0.03], [0.006, 0.035], [0, 0.035]].map(([r, dy]): [number, number] => [r, y + dy]), 8)); // a barrel hinge
    const handleZ = Math.sign(z) * 0.05; // the handle sits by the middle seam
    part(piece, "chair_leg", tubePath([[0.308, 0.4, handleZ], [0.34, 0.41, handleZ], [0.34, 0.62, handleZ], [0.308, 0.63, handleZ]], 0.01, 0.01, 6, 3));
    for (const y of [0.4, 0.63]) part(piece, "chair_leg", oriented(lathe(0, 0, [[0, 0], [0.016, 0], [0.016, 0.004], [0.012, 0.007], [0, 0.007]], 10), [1, 0, 0], [0.306, y, handleZ])); // its roses
  }
  // the lock between the doors: an escutcheon plate with a dark keyhole
  part(piece, "chair_leg", oriented(softBox(-0.016, 0.016, 0, 0.004, -0.03, 0.03, { r: 0.012, e: 0.002, steps: 1 }), [1, 0, 0], [0.306, 0.7, 0]));
  part(piece, "steel", oriented(softBox(-0.003, 0.003, 0, 0.0045, -0.009, 0.009, { r: 0.003, e: 0.001, steps: 1 }), [1, 0, 0], [0.306, 0.7, 0]));
  // louvres on both ends
  for (const sz of [-1, 1])
    for (let k = 0; k < 6; k++) {
      const y = 0.6 + k * 0.03;
      part(piece, "steel", softBox(-0.15, 0.15, y, y + 0.012, Math.min(sz * 0.466, sz * 0.482), Math.max(sz * 0.466, sz * 0.482), { r: 0.005, e: 0.004, steps: 1 }));
    }
  // corner guards up the front edges
  for (const z of [-0.47, 0.47]) part(piece, "chair_leg", softBox(0.282, 0.304, 0.12, 0.84, z - 0.008, z + 0.008, { r: 0.006, e: 0.004, steps: 1 }));
  for (const [cx, cz] of [[-0.23, -0.4], [-0.23, 0.4], [0.23, -0.4], [0.23, 0.4]]) {
    const wheel = lathe(0, 0, [[0, -0.011], [0.03, -0.011], [0.034, -0.005], [0.034, 0.005], [0.03, 0.011], [0, 0.011]], 12);
    part(piece, "steel", warped(wheel, ([x, y, z]) => [x + cx, 0.036 - z, y + cz])); // the wheel, turned on its side
    part(piece, "chair_leg", softBox(cx - 0.02, cx + 0.02, 0.05, 0.1, cz - 0.03, cz + 0.03, { r: 0.008, e: 0.006, steps: 2 })); // the fork
    part(piece, "chair_leg", oriented(boltHead(0.007), [0, 0, 1], [cx, 0.036, cz + 0.03])); // the axle nut
  }
  for (const z of [-0.24, 0.24]) for (let k = 0; k < 7; k++) part(piece, "plastic", tray(0.885 + k * 0.013, z, (k % 2) * 0.02));
  return piece;
}

export const PIECES: Record<string, () => Piece> = {
  table_set: tableSet,
  bench_red: bench,
  trash_bin: bin,
  planter_plant: planter,
  tray_stand: trayStand,
};
