import { CELL, NX, FLOOR_H, RAIL_H, HOLE } from "./config.mts";
import { floors } from "./grid.mts";
import { type V3, geo, addTo, latheGeo, boxGeo, prismGeo, tubeGeo } from "./geo.mts";

// The floor 2 bridge over Atrium B (reference photos atrium_third-floor-looking-down and
// atrium_upper-floors-from-ground). The plan holds its 6 m band (x 51 to 78, y 135 to 141). Between the two
// south columns its south edge is an arc cut into the deck (an inward D), with a deep white beam under it
// and angled glass panels on it. Four grey columns, two at each end, carry cork-brown balls at the floor 3
// level, each held in a white C-shaped hood with a cap plate reaching back to the floor 3 edge; a white beam
// joins each pair just under the floor 3 level.
const DECK = { x0: 51, x1: 78, y0: 135, y1: 141 };
const COL_X = [54, 75]; // the ends of the arc
const COL_Y = [135, 138.3]; // south corner and 1.2 m in from the north edge, clear of the floor 3 slab above
const SAG = 3; // how far the arc reaches into the deck (the middle stays 3 m wide)
const HALF = (COL_X[1] - COL_X[0]) / 2;
const ARC = { cx: (COL_X[0] + COL_X[1]) / 2, r: (HALF * HALF + SAG * SAG) / (2 * SAG) };
const ARC_CY = DECK.y0 + SAG - ARC.r; // circle center, south of the bridge
const DEPTH = 0.7; // the beam under the deck edge
const LIP = 0.6; // its white top, over the stepped cell edge
const BALL_R = 0.85;
const BALL_Y = 2 * FLOOR_H + 0.9;

/** Whether the cell (i, j) of floor 2 lies in the arc cut out of the bridge. */
export function inBridgeCut(i: number, j: number): boolean {
  const x = (i + 0.5) * CELL;
  const y = (j + 0.5) * CELL;
  if (x <= COL_X[0] || x >= COL_X[1] || y < DECK.y0 || y >= DECK.y1) return false;
  // cells the arc only grazes are cut too, so no square corner sticks out past the beam
  return Math.hypot(x - ARC.cx, y - ARC_CY) < ARC.r + 0.36;
}

export function paintBridge() {
  const f = floors[1];
  for (let j = Math.round(DECK.y0 / CELL); j < Math.round(DECK.y1 / CELL); j++)
    for (let i = Math.round(COL_X[0] / CELL); i < Math.round(COL_X[1] / CELL); i++) {
      if (!inBridgeCut(i, j)) continue;
      f.cls[j * NX + i] = HOLE;
      f.kind[j * NX + i] = "void";
    }
}

export function buildBridge() {
  const y0 = FLOOR_H;
  const top = y0 + 0.03;
  const slab = geo("slab");
  // Arc points (three.js x, z) at a radius from the circle center; t runs 0..1 from west to east.
  const a0 = Math.atan2(DECK.y0 - ARC_CY, COL_X[0] - ARC.cx);
  const a1 = Math.atan2(DECK.y0 - ARC_CY, COL_X[1] - ARC.cx);
  const pt = (t: number, r: number, h: number): V3 => {
    const a = a0 + (a1 - a0) * t;
    return [ARC.cx + r * Math.cos(a), h, -(ARC_CY + r * Math.sin(a))];
  };
  const nOut = (t: number): V3 => {
    const a = a0 + (a1 - a0) * t;
    return [-Math.cos(a), 0, Math.sin(a)]; // toward the circle center: out of the deck
  };
  // Smooth beam: outer face, top lip, inner face, underside.
  const N = 48;
  for (let k = 0; k < N; k++) {
    const t0 = k / N;
    const t1 = (k + 1) / N;
    const [ri, ro] = [ARC.r + LIP, ARC.r];
    const n0 = nOut(t0);
    const n1 = nOut(t1);
    const neg = (n: V3): V3 => [-n[0], 0, -n[2]];
    slab.quadN(pt(t0, ro, y0 - DEPTH), pt(t1, ro, y0 - DEPTH), pt(t1, ro, top), pt(t0, ro, top), n0, n1, n1, n0);
    slab.quadN(pt(t0, ri, y0 - DEPTH), pt(t1, ri, y0 - DEPTH), pt(t1, ri, top), pt(t0, ri, top), neg(n0), neg(n1), neg(n1), neg(n0));
    slab.quadN(pt(t0, ro, top), pt(t1, ro, top), pt(t1, ri, top), pt(t0, ri, top), [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]);
    slab.quadN(pt(t0, ro, y0 - DEPTH), pt(t1, ro, y0 - DEPTH), pt(t1, ri, y0 - DEPTH), pt(t0, ri, y0 - DEPTH), [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0]);
  }
  // Angled glass panels along the arc (the photos show straight panes, not curved glass), handrail on the deck side.
  const P = 10;
  const rr = ARC.r + 0.08;
  for (let k = 0; k < P; k++) {
    const a = pt(k / P, rr, top);
    const b = pt((k + 1) / P, rr, top);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n: V3 = [(b[2] - a[2]) / len, 0, -(b[0] - a[0]) / len];
    geo("rails").quad(a, b, [b[0], b[1] + RAIL_H, b[2]], [a[0], a[1] + RAIL_H, a[2]], n);
    const m = nOut((k + 0.5) / P);
    const off = (p: V3, d: number): V3 => [p[0] - m[0] * d, p[1] + RAIL_H - 0.1, p[2] - m[2] * d];
    addTo(geo("chrome"), tubeGeo(off(a, 0.055), off(b, 0.055), 0.024, 6));
    addTo(geo("chrome"), tubeGeo(off(a, 0), off(a, 0.055), 0.011, 4));
  }

  for (const cx of COL_X) {
    const out = cx < ARC.cx ? -1 : 1; // toward the hall the hood hangs from
    const edge = out < 0 ? DECK.x0 : DECK.x1; // the floor 3 edge
    // The beam joining the pair, just under the floor 3 level, back to the floor 3 edge.
    const [bx0, bx1] = out < 0 ? [edge, cx + 0.45] : [cx - 0.45, edge];
    addTo(slab, boxGeo(bx0, bx1, 2 * FLOOR_H - 0.7, 2 * FLOOR_H - 0.02, -(COL_Y[1] + 0.45), -(COL_Y[0] - 0.45)));
    for (const cy of COL_Y) {
      const z = -cy;
      // column, from the ground floor up into the ball
      const h = BALL_Y - BALL_R + 0.1;
      addTo(geo("column"), latheGeo(cx, z, [[0.37, 0], [0.37, 0.14], [0.3, 0.17], [0.3, h], [0, h]], 24));
      // ball
      const prof: [number, number][] = [];
      for (let k = 0; k <= 12; k++) {
        const a = -Math.PI / 2 + (k / 12) * Math.PI;
        prof.push([BALL_R * Math.cos(a), BALL_Y + BALL_R * Math.sin(a)]);
      }
      addTo(geo("sphere"), latheGeo(cx, z, prof, 20));
      // C-shaped hood: a thick ring segment in the vertical east-west plane, wrapping the ball from below on
      // the hall side, over the top, and a little down the atrium side. phi is the angle from straight up,
      // positive toward the atrium.
      const rin = BALL_R + 0.06;
      const rout = BALL_R + 0.4;
      const w = 0.42;
      const at = (phi: number, r: number, zz: number): V3 => [cx - out * r * Math.sin(phi), BALL_Y + r * Math.cos(phi), zz];
      const S = 12;
      const p0 = (-130 * Math.PI) / 180;
      const p1 = (60 * Math.PI) / 180;
      for (let k = 0; k < S; k++) {
        const f0 = p0 + ((p1 - p0) * k) / S;
        const f1 = p0 + ((p1 - p0) * (k + 1)) / S;
        addTo(slab, prismGeo([
          at(f0, rin, z - w), at(f0, rout, z - w), at(f1, rout, z - w), at(f1, rin, z - w),
          at(f0, rin, z + w), at(f0, rout, z + w), at(f1, rout, z + w), at(f1, rin, z + w),
        ]));
      }
      // cap plate on top of the hood, reaching back to the floor 3 edge
      const capY = BALL_Y + rout - 0.12;
      const [cx0, cx1] = out < 0 ? [edge, cx + 0.6] : [cx - 0.6, edge];
      addTo(slab, boxGeo(cx0, cx1, capY, capY + 0.3, z - 0.55, z + 0.55));
      // collar where the column meets the beam
      addTo(slab, boxGeo(cx - 0.55, cx + 0.55, 2 * FLOOR_H - 0.9, 2 * FLOOR_H - 0.02, z - 0.55, z + 0.55));
    }
  }
}
