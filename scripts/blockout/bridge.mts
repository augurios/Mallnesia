import { CELL, NX, FLOOR_H, RAIL_H, HOLE } from "./config.mts";
import { floors } from "./grid.mts";
import { type V3, Geo, geo, addTo, latheGeo, boxGeo, prismGeo, tubeGeo } from "./geo.mts";

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

  // Hood, after the photos (atrium_upper-floors-from-ground, atrium_third-floor-looking-down): crisp-edged
  // plaster, in the vertical north-south plane, opening north on the north columns and south on the south ones.
  // - the C body: wraps the ball from over the top, down its back, to a bottom arm under it (a curved
  //   cradle on the inside, flat sides);
  // - a flat top plate, wider than the body, reaching forward past the ball with a square end;
  // - the "mohawk": a narrow squared band on the outside, from the front of the top plate down the back;
  // - two cheeks hanging below the bottom arm on either side of the column, cut at a slant at the bottom.
  const W = 0.6; // half the C body's width, across the C
  const RM = BALL_R + 0.2; // the body's mid-line, around the ball
  const T = 0.15; // half its thickness
  const REACH = BALL_R + 0.45; // how far the top plate reaches past the ball's center
  const E = 0.025; // the small bevel on every edge
  const body = roundedRect(-W, W, -T, T, E, E);
  const plate = roundedRect(-W - 0.25, W + 0.25, -T, T + 0.05, E, E);
  const mohawk = roundedRect(-0.22, 0.22, T - 0.02, T + 0.22, E, E);
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
      const D = (f: number, u: number, xo: number): V3 => [xo, u, -fwd * f]; // a direction in the same frame
      // the back half circle, with n the outward side at each point
      const arc = (a0: number, a1: number): Pt[] =>
        Array.from({ length: 25 }, (_, k) => {
          const a = ((a0 + ((a1 - a0) * k) / 24) * Math.PI) / 180;
          return { f: RM * Math.cos(a), u: RM * Math.sin(a), nf: Math.cos(a), nu: Math.sin(a) };
        });
      const up = (f: number): Pt => ({ f, u: RM, nf: 0, nu: 1 });
      addTo(slab, sweepPath([up(0.2), ...arc(90, 270), { f: 0.55, u: -RM, nf: 0, nu: -1 }], body, P, D));
      addTo(slab, sweepPath([up(REACH), up(-0.05)], plate, P, D));
      addTo(slab, sweepPath([up(REACH - 0.05), ...arc(90, 235)], mohawk, P, D));
      // cheeks: on both sides of the column, from the bottom arm down, longer at the back
      const yb = -RM - T; // underside of the bottom arm
      for (const [x0, x1] of [[-W, -0.33], [0.33, W]]) {
        const q = (f: number, u: number, xo: number) => P(f, u, xo);
        const face = (xo: number) => [q(-0.45, yb + 0.01, xo), q(0.5, yb + 0.01, xo), q(0.5, yb - 0.55, xo), q(-0.45, yb - 1.05, xo)];
        addTo(slab, prismGeo([...face(x0), ...face(x1)]));
      }
      // column, from the ground floor up to the bottom arm
      addTo(geo("column"), latheGeo(cx, z, [[0.37, 0], [0.37, 0.14], [0.3, 0.17], [0.3, BALL_Y + yb], [0, BALL_Y + yb]], 24));
      // ball, level with the floor 3 floor
      const prof: [number, number][] = [];
      for (let k = 0; k <= 16; k++) {
        const a = -Math.PI / 2 + (k / 16) * Math.PI;
        prof.push([BALL_R * Math.cos(a), BALL_Y + BALL_R * Math.sin(a)]);
      }
      addTo(geo("sphere"), latheGeo(cx, z, prof, 32));
    }
  }
}

type Pt = { f: number; u: number; nf: number; nu: number };
type Sec = { s: number; t: number; ns: number; nt: number }[];

/** Convex rounded rectangle cross-section (s across, t outward), with its own corner radii at the inner (t0) and outer (t1) side. */
function roundedRect(s0: number, s1: number, t0: number, t1: number, rIn: number, rOut: number): Sec {
  const sec: Sec = [];
  const corners: [number, number, number, number][] = [
    [s1 - rOut, t1 - rOut, rOut, 0],
    [s0 + rOut, t1 - rOut, rOut, 90],
    [s0 + rIn, t0 + rIn, rIn, 180],
    [s1 - rIn, t0 + rIn, rIn, 270],
  ];
  for (const [cs, ct, r, a0] of corners)
    for (let k = 0; k <= 4; k++) {
      const a = ((a0 + (90 * k) / 4) * Math.PI) / 180;
      sec.push({ s: cs + r * Math.cos(a), t: ct + r * Math.sin(a), ns: Math.cos(a), nt: Math.sin(a) });
    }
  return sec;
}

/**
 * Sweeps a cross-section along a path in a vertical plane, smooth-shaded, with flat caps at both ends.
 * P maps (f, u, across) to a point, D the same to a direction.
 */
function sweepPath(path: Pt[], sec: Sec, P: (f: number, u: number, s: number) => V3, D: (f: number, u: number, s: number) => V3): Geo {
  const g = new Geo();
  const v = (p: Pt, q: Sec[number]) => P(p.f + p.nf * q.t, p.u + p.nu * q.t, q.s);
  const n = (p: Pt, q: Sec[number]) => D(p.nf * q.nt, p.nu * q.nt, q.ns);
  for (let i = 0; i + 1 < path.length; i++)
    for (let k = 0; k < sec.length; k++) {
      const a = path[i];
      const b = path[i + 1];
      const q0 = sec[k];
      const q1 = sec[(k + 1) % sec.length];
      g.quadN(v(a, q0), v(b, q0), v(b, q1), v(a, q1), n(a, q0), n(b, q0), n(b, q1), n(a, q1));
    }
  for (const [p, q] of [[path[0], path[1]], [path[path.length - 1], path[path.length - 2]]]) {
    const tf = p.f - q.f;
    const tu = p.u - q.u;
    const len = Math.hypot(tf, tu) || 1;
    const cap = D(tf / len, tu / len, 0); // pointing out of the end
    const c = v(p, { s: 0, t: 0, ns: 0, nt: 0 });
    for (let k = 0; k < sec.length; k++) {
      const a = v(p, sec[k]);
      const b = v(p, sec[(k + 1) % sec.length]);
      g.quadN(c, a, b, b, cap, cap, cap, cap);
    }
  }
  return g;
}
