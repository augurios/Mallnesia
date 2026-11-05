import { CELL, NX, FLOOR_H, RAIL_H, HOLE } from "./config.mts";
import { floors } from "./grid.mts";
import { type V3, geo, addTo, latheGeo, boxGeo, prismGeo, tubeGeo } from "./geo.mts";

// The floor 2 bridge over Atrium B (reference photos atrium_third-floor-looking-down and
// atrium_upper-floors-from-ground). The plan holds its 6 m band (x 51 to 78, y 135 to 141). Between the two
// south columns its south edge is an arc cut into the deck (an inward D), with a deep white beam under it
// and angled glass panels on it. Four grey columns, two at each end, carry cork-brown balls at the floor 3
// level, each held in a white C-shaped hood with a ridge along its top (see the hood below); a white beam
// joins each pair just under the floor 3 level and carries the floor 3 extensions north of the bridge.
const DECK = { x0: 51, x1: 78, y0: 135, y1: 141 };
const COL_X = [54, 75]; // the ends of the arc
const COL_Y = [135, 141]; // the south and north edges of the deck
const SAG = 3; // how far the arc reaches into the deck (the middle stays 3 m wide)
const HALF = (COL_X[1] - COL_X[0]) / 2;
const ARC = { cx: (COL_X[0] + COL_X[1]) / 2, r: (HALF * HALF + SAG * SAG) / (2 * SAG) };
const ARC_CY = DECK.y0 + SAG - ARC.r; // circle center, south of the bridge
const DEPTH = 0.7; // the beam under the deck edge
const LIP = 0.6; // its white top, over the stepped cell edge
const BALL_R = 0.85;
const BALL_Y = 2 * FLOOR_H; // the ball is level with the floor 3 floor
const EXT_Y = 142.5; // south edge of the floor 3 extensions the north columns hold (boxoffice_floor, atrium_b_ext_e)

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

  // Hood (reference: atrium_upper-floors-from-ground and atrium_third-floor-looking-down): a thick, wide
  // C in the vertical north-south plane. It wraps the ball from a top arm over it, down its back, to a bottom
  // arm under it that sits on the column, and opens north on the north columns, south on the south ones.
  // A narrower ridge (the "mohawk") runs along its outside, from the front of the top arm down the back.
  const W = 0.75; // half the hood's width, across the C
  const rin = BALL_R + 0.05;
  const rout = BALL_R + 0.35;
  const MOHAWK = { w: 0.18, h: 0.22 };
  for (const cx of COL_X) {
    const out = cx < ARC.cx ? -1 : 1; // toward the hall
    const edge = out < 0 ? DECK.x0 : DECK.x1; // the floor 3 edge
    // The beam joining the pair, just under the floor 3 level, from the hall edge to the side of the hoods.
    // It runs on north to the floor 3 extension, so the extension rests on it.
    const [bx0, bx1] = out < 0 ? [edge, cx - W] : [cx + W, edge];
    addTo(slab, boxGeo(bx0, bx1, 2 * FLOOR_H - 0.7, 2 * FLOOR_H - 0.02, -EXT_Y, -(COL_Y[0] - 0.45)));
    for (const cy of COL_Y) {
      const z = -cy;
      const fwd = cy === COL_Y[1] ? 1 : -1; // the way the C opens, in plan y
      // f: forward (the way the C opens), u: up from the ball's center, xo: across
      const P = (f: number, u: number, xo: number): V3 => [cx + xo, BALL_Y + u, -(cy + fwd * f)];
      const ring = (th: number, r: number, xo: number) => P(r * Math.cos(th), r * Math.sin(th), xo);
      const arc = (t0: number, t1: number, r0: number, r1: number, hw: number, S: number) => {
        for (let k = 0; k < S; k++) {
          const a = ((t0 + ((t1 - t0) * k) / S) * Math.PI) / 180;
          const b = ((t0 + ((t1 - t0) * (k + 1)) / S) * Math.PI) / 180;
          addTo(slab, prismGeo([
            ring(a, r0, -hw), ring(a, r1, -hw), ring(b, r1, -hw), ring(b, r0, -hw),
            ring(a, r0, hw), ring(a, r1, hw), ring(b, r1, hw), ring(b, r0, hw),
          ]));
        }
      };
      const block = (f0: number, f1: number, u0: number, u1: number, hw: number) => {
        const a = P(f0, u0, -hw);
        const b = P(f1, u1, hw);
        addTo(slab, boxGeo(Math.min(a[0], b[0]), Math.max(a[0], b[0]), a[1], b[1], Math.min(a[2], b[2]), Math.max(a[2], b[2])));
      };
      // column, from the ground floor up to the bottom arm of the hood
      const h = BALL_Y - rout;
      addTo(geo("column"), latheGeo(cx, z, [[0.37, 0], [0.37, 0.14], [0.3, 0.17], [0.3, h], [0, h]], 24));
      // ball, level with the floor 3 floor
      const prof: [number, number][] = [];
      for (let k = 0; k <= 12; k++) {
        const a = -Math.PI / 2 + (k / 12) * Math.PI;
        prof.push([BALL_R * Math.cos(a), BALL_Y + BALL_R * Math.sin(a)]);
      }
      addTo(geo("sphere"), latheGeo(cx, z, prof, 20));
      // the C: back half of the ring, plus the top and bottom arms reaching forward
      arc(90, 270, rin, rout, W, 12);
      const reach = BALL_R + 0.3;
      block(0, reach, rin, rout, W);
      block(0, 0.55, -rout, -rin, W);
      // the mohawk, along the outside of the top arm and down the back to the bottom
      block(0, reach, rout, rout + MOHAWK.h, MOHAWK.w);
      arc(90, 270, rout, rout + MOHAWK.h, MOHAWK.w, 12);
      // corbels around the column top, under the bottom arm
      block(0.3, 0.62, -rout - 1.1, -rout, 0.35);
      for (const side of [-1, 1]) {
        const [x0, x1] = side < 0 ? [cx - 0.62, cx - 0.3] : [cx + 0.3, cx + 0.62];
        addTo(slab, boxGeo(x0, x1, BALL_Y - rout - 1.1, BALL_Y - rout, z - 0.35, z + 0.35));
      }
    }
  }
}
