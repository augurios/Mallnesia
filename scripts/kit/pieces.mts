// Kit pieces: small models repeated through the mall (generated here now, hand-modelled later: a piece is
// just a GLB with one node per material plus a "collider" node, so a hand-made file can replace a
// generated one without changing anything else). Each piece is built around its own origin: x and z centred,
// y = 0 on the floor, and is written to public/models/kit/<name>.glb by scripts/build-props.mts.
import { Geo, type V3, addTo, boxGeo, slabGeo, tubeGeo } from "../blockout/geo.mts";

export interface Piece {
  /** Geometry by material name (see scripts/blockout/palette.mts). */
  parts: Record<string, Geo>;
  /** Collision box, centred on the origin: half width in x, half depth in z, and height. It is invisible. */
  collider: { hx: number; hz: number; h: number };
  /** Placement keeps every cell within this radius of the origin walkable, plus the aisle the rule asks for. */
  radius: number;
}

/** A copy of g turned by `theta` about the y axis (three.js convention) and moved by (tx, tz). */
function turned(g: Geo, theta: number, tx: number, tz: number): Geo {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const out = new Geo();
  for (let i = 0; i < g.pos.length; i += 3) {
    out.pos.push(g.pos[i] * c + g.pos[i + 2] * s + tx, g.pos[i + 1], -g.pos[i] * s + g.pos[i + 2] * c + tz);
    out.nrm.push(g.nrm[i] * c + g.nrm[i + 2] * s, g.nrm[i + 1], -g.nrm[i] * s + g.nrm[i + 2] * c);
  }
  out.idx.push(...g.idx);
  return out;
}

const part = (piece: Piece, material: string, g: Geo) => addTo((piece.parts[material] ??= new Geo()), g);

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
      const row = [0, 1, 2, 3].map(
        (c) => 0.5 * (2 * p[1][c] + (-p[0][c] + p[2][c]) * t + (2 * p[0][c] - 5 * p[1][c] + 4 * p[2][c] - p[3][c]) * t * t + (-p[0][c] + 3 * p[1][c] - 3 * p[2][c] + p[3][c]) * t * t * t),
      ) as Row;
      out.push(row);
    }
  }
  out.push(rows[rows.length - 1]);
  return out;
}

/** The molded shell of a chair: one curved surface (the material is double-sided), centred on the origin. */
function shellGeo(): Geo {
  const rows = smooth(SHELL, 4);
  const cols = 13;
  const pt = (r: number, c: number): V3 => {
    const [x, y, w, wrap] = rows[r];
    const t = (c / (cols - 1)) * 2 - 1;
    return [x + wrap * 0.075 * t * t, y + (1 - wrap) * 0.035 * t * t, t * w];
  };
  const grid = rows.map((_, r) => Array.from({ length: cols }, (_, c) => pt(r, c)));
  // The cross product of the grid's two directions has the same handedness everywhere, so which side it faces
  // is decided once, at the middle of the seat (up is the sitter's side). A per-vertex test flipped normals along the rims.
  const raw = (r: number, c: number): V3 => {
    const a = grid[Math.min(r + 1, rows.length - 1)][c];
    const b = grid[Math.max(r - 1, 0)][c];
    const d = grid[r][Math.min(c + 1, cols - 1)];
    const e = grid[r][Math.max(c - 1, 0)];
    const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const v = [d[0] - e[0], d[1] - e[1], d[2] - e[2]];
    let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    return n;
  };
  const flip = raw(Math.floor(rows.length / 4), (cols - 1) / 2)[1] < 0 ? -1 : 1;
  const nrm = (r: number, c: number): V3 => {
    const n = raw(r, c);
    return [n[0] * flip, n[1] * flip, n[2] * flip];
  };
  const g = new Geo();
  for (let r = 0; r < rows.length - 1; r++)
    for (let c = 0; c < cols - 1; c++)
      g.quadN(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c], nrm(r, c), nrm(r, c + 1), nrm(r + 1, c + 1), nrm(r + 1, c));
  return g;
}

const SHELL_GEO = shellGeo();

/** A food-court chair for one person, facing +x: a red molded shell on four grey tube legs joined by side rails. */
function chair(into: Piece, theta: number, tx: number, tz: number) {
  part(into, "plastic", turned(SHELL_GEO, theta, tx, tz));
  const tube = (pts: V3[], r = 0.012) => {
    for (let k = 0; k < pts.length - 1; k++) part(into, "chair_leg", turned(tubeGeo(pts[k], pts[k + 1], r, 6), theta, tx, tz));
  };
  for (const s of [-1, 1]) {
    const z = 0.19 * s;
    tube([[0.215, 0, z * 1.08], [0.19, 0.43, z]]); // front leg
    tube([[-0.2, 0, z * 1.1], [-0.17, 0.43, z], [-0.225, 0.56, z * 0.9]]); // rear leg, up behind the seat to the back
    tube([[0.2, 0.3, z * 1.04], [-0.185, 0.3, z * 1.04]]); // side rail
  }
}

/** A rounded rectangle (x, z points), for the table top. */
function roundedRect(hx: number, hz: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (const [cx, cz, a0] of [[hx - r, hz - r, 0], [-hx + r, hz - r, 90], [-hx + r, -hz + r, 180], [hx - r, -hz + r, 270]] as const)
    for (let k = 0; k <= 3; k++) {
      const a = ((a0 + k * 30) * Math.PI) / 180;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  return pts;
}

/** A rectangular white table with a black edge and a black post on a cross foot, two chairs on each long side. */
function tableSet(): Piece {
  const piece: Piece = { parts: {}, collider: { hx: 0.75, hz: 0.95, h: 1.3 }, radius: 1.3 };
  part(piece, "steel", slabGeo(roundedRect(0.45, 0.35, 0.05), 0.715, 0.75)); // the black edge
  part(piece, "laminate", slabGeo(roundedRect(0.438, 0.338, 0.04), 0.7505, 0.753));
  part(piece, "steel", boxGeo(-0.045, 0.045, 0.04, 0.715, -0.11, 0.11)); // the post
  for (const a of [Math.PI / 4, -Math.PI / 4]) part(piece, "steel", turned(boxGeo(-0.34, 0.34, 0, 0.045, -0.035, 0.035), a, 0, 0)); // cross foot
  for (const side of [-1, 1])
    for (const x of [-0.24, 0.24]) chair(piece, side > 0 ? Math.PI / 2 : -Math.PI / 2, x, side * 0.6);
  return piece;
}

export const PIECES: Record<string, () => Piece> = {
  table_set: tableSet,
};
