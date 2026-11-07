// Soft primitives for kit pieces: everything here has rounded edges and smooth normals, so a piece built from
// them reads as a made object and not as a stack of boxes (see "Kit piece detail standard" in
// docs/art_style_reference.md). Coordinates are three.js: x, z across the floor, y up, meters.
import { Geo, type V3, addTo } from "../blockout/geo.mts";

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A smooth surface through rings of points (rings[r][c]). Normals come from the neighbours, so adjacent
 * quads share them. Which side faces out is decided once for the whole surface: `outward` is a point the
 * surface should face away from (the middle ring's centre by default).
 */
export function loft(rings: V3[][], closed = true, outward?: V3): Geo {
  const R = rings.length;
  const C = rings[0].length;
  const at = (r: number, c: number) => rings[Math.min(R - 1, Math.max(0, r))][closed ? (c + C) % C : Math.min(C - 1, Math.max(0, c))];
  const raw = (r: number, c: number): V3 => {
    const along = sub(at(r, c + 1), at(r, c - 1));
    const rows = sub(at(r + 1, c), at(r - 1, c));
    const n = cross(along, rows);
    return Math.hypot(...n) < 1e-12 ? [0, 0, 0] : unit(n);
  };
  // Decide the facing from the ring with the best-defined normal.
  const mid = Math.floor(R / 2);
  const centre: V3 = outward ?? ((): V3 => {
    const ring = rings[mid];
    return [ring.reduce((a, p) => a + p[0], 0) / C, ring.reduce((a, p) => a + p[1], 0) / C, ring.reduce((a, p) => a + p[2], 0) / C];
  })();
  let vote = 0;
  for (let c = 0; c < C; c++) {
    const n = raw(mid, c);
    const p = rings[mid][c];
    vote += n[0] * (p[0] - centre[0]) + n[1] * (p[1] - centre[1]) + n[2] * (p[2] - centre[2]);
  }
  const s = vote < 0 ? -1 : 1;
  const nrm = (r: number, c: number): V3 => {
    const n = raw(r, c);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) {
      // a ring collapsed to a point (an apex): use a neighbour's normal
      const m = r === 0 ? raw(1, c) : raw(r - 1, c);
      return [m[0] * s, m[1] * s, m[2] * s];
    }
    return [n[0] * s, n[1] * s, n[2] * s];
  };
  const g = new Geo();
  const cEnd = closed ? C : C - 1;
  for (let r = 0; r < R - 1; r++)
    for (let c = 0; c < cEnd; c++) {
      const c1 = (c + 1) % C;
      g.quadN(rings[r][c], rings[r][c1], rings[r + 1][c1], rings[r + 1][c], nrm(r, c), nrm(r, c1), nrm(r + 1, c1), nrm(r + 1, c));
    }
  return g;
}

/** A flat fan closing a ring, facing `n`. */
export function cap(ring: V3[], n: V3, centre?: V3): Geo {
  const g = new Geo();
  const c: V3 = centre ?? [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length, ring.reduce((a, p) => a + p[2], 0) / ring.length];
  for (let i = 0; i < ring.length; i++) g.quadN(c, ring[i], ring[(i + 1) % ring.length], ring[(i + 1) % ring.length], n, n, n, n);
  return g;
}

/** A rounded rectangle outline in plan (x, z), counter-clockwise from above, `steps` points per corner. */
export function roundedLoop(cx: number, cz: number, hx: number, hz: number, r: number, steps = 3): [number, number][] {
  const rr = Math.max(0.0005, Math.min(r, hx, hz));
  const pts: [number, number][] = [];
  for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]] as const)
    for (let k = 0; k <= steps; k++) {
      const a = ((a0 + (90 * k) / steps) * Math.PI) / 180;
      pts.push([cx + sx * (hx - rr) + Math.cos(a) * rr * 1, cz + sz * (hz - rr) + Math.sin(a) * rr]);
    }
  return pts;
}

export interface SoftBox {
  /** Plan corner radius. */
  r?: number;
  /** Radius of the rounded top and bottom edges. */
  e?: number;
  /** Points around each plan corner. */
  corner?: number;
  /** Steps around each rounded edge. */
  steps?: number;
  /** The top bulges by this much in the middle (cushions). */
  crown?: number;
  /** The bottom edge stays sharp (it sits on something). */
  flatBottom?: boolean;
}

/**
 * A box with rounded vertical corners and rounded top and bottom edges, smooth shaded. With `crown` the top is
 * a shallow dome (a padded cushion).
 */
export function softBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: SoftBox = {}): Geo {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  const e = Math.min(o.e ?? 0.01, (y1 - y0) / 2, hx, hz);
  const r = Math.max(o.r ?? e, e);
  const steps = o.steps ?? 3;
  const corner = o.corner ?? 3;
  const crown = o.crown ?? 0;
  const profile: [number, number][] = []; // (inset, y), from the bottom edge up and over the top
  if (o.flatBottom) profile.push([0, y0]);
  else for (let k = 0; k <= steps; k++) {
    const a = (Math.PI / 2) * (k / steps);
    profile.push([e * (1 - Math.sin(a)), y0 + e * (1 - Math.cos(a))]);
  }
  for (let k = 0; k <= steps; k++) {
    const a = (Math.PI / 2) * (k / steps);
    profile.push([e * (1 - Math.cos(a)), y1 - e + e * Math.sin(a)]);
  }
  const top = profile[profile.length - 1];
  const inner = Math.min(hx, hz) - top[0]; // how far the top surface goes in toward its middle
  const topRings = crown ? 3 : 0;
  const ring = (inset: number, y: number, rise = 0): V3[] =>
    roundedLoop(cx, cz, hx - inset, hz - inset, r - inset, corner).map(([x, z]): V3 => {
      const u = (x - cx) / hx;
      const v = (z - cz) / hz;
      return [x, y + rise * Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v), z];
    });
  const rings = profile.map(([inset, y]) => ring(inset, y));
  const g = loft(rings, true, [cx, (y0 + y1) / 2, cz]);
  let last = rings[rings.length - 1];
  if (topRings) {
    const more: V3[][] = [];
    for (let k = 1; k <= topRings; k++) {
      const t = k / (topRings + 1);
      more.push(ring(top[0] + inner * t * 0.85, top[1], crown * (1 - (1 - t) * (1 - t))));
    }
    addTo(g, loft([last, ...more], true, [cx, (y0 + y1) / 2, cz]));
    last = more[more.length - 1];
  }
  addTo(g, cap(last, [0, 1, 0], [cx, y1 + (crown ? crown : 0) * 0.02, cz]));
  addTo(g, cap(rings[0].slice().reverse(), [0, -1, 0], [cx, y0, cz]));
  return g;
}

/** A smooth lathe around the y axis at (cx, cz): profile points are (radius, y), bottom to top. */
export function turned(cx: number, cz: number, profile: [number, number][], sides = 16): Geo {
  const rings = profile.map(([r, y]) =>
    Array.from({ length: sides }, (_, k): V3 => {
      const a = (k / sides) * Math.PI * 2;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    }),
  );
  return loft(rings, true, [cx, profile[0][1], cz]);
}

/** A tube along a smooth path (Catmull-Rom through `points`), radius optionally tapering from `r0` to `r1`. */
export function tubePath(points: V3[], r0: number, r1 = r0, sides = 8, spans = 6): Geo {
  const pts: V3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = [points[Math.max(i - 1, 0)], points[i], points[i + 1], points[Math.min(i + 2, points.length - 1)]];
    for (let q = 0; q < spans; q++) {
      const t = q / spans;
      pts.push([0, 1, 2].map((c) => 0.5 * (2 * p[1][c] + (-p[0][c] + p[2][c]) * t + (2 * p[0][c] - 5 * p[1][c] + 4 * p[2][c] - p[3][c]) * t * t + (-p[0][c] + 3 * p[1][c] - 3 * p[2][c] + p[3][c]) * t * t * t)) as V3);
    }
  }
  pts.push(points[points.length - 1]);
  let side: V3 = [0, 0, 1];
  const rings: V3[][] = [];
  pts.forEach((p, i) => {
    const t = unit(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    let u = cross(t, side);
    if (Math.hypot(...u) < 1e-6) u = cross(t, [1, 0, 0]);
    u = unit(u);
    side = unit(cross(u, t)); // carried along the path so the rings do not twist
    const v = unit(cross(t, u));
    const r = r0 + (r1 - r0) * (i / (pts.length - 1));
    rings.push(Array.from({ length: sides }, (_, k): V3 => {
      const a = (k / sides) * Math.PI * 2;
      return [p[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, p[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r, p[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r];
    }));
  });
  const g = loft(rings, true, pts[Math.floor(pts.length / 2)]);
  addTo(g, cap(rings[0].slice().reverse(), unit(sub(pts[0], pts[1])), pts[0]));
  addTo(g, cap(rings[rings.length - 1], unit(sub(pts[pts.length - 1], pts[pts.length - 2])), pts[pts.length - 1]));
  return g;
}

/** A copy of g moved and turned: `yaw` about y (three.js convention), then moved by (tx, ty, tz). */
export function placed(g: Geo, yaw: number, tx: number, ty: number, tz: number): Geo {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out = new Geo();
  for (let i = 0; i < g.pos.length; i += 3) {
    out.pos.push(g.pos[i] * c + g.pos[i + 2] * s + tx, g.pos[i + 1] + ty, -g.pos[i] * s + g.pos[i + 2] * c + tz);
    out.nrm.push(g.nrm[i] * c + g.nrm[i + 2] * s, g.nrm[i + 1], -g.nrm[i] * s + g.nrm[i + 2] * c);
  }
  out.idx.push(...g.idx);
  if (g.uv) out.uv = g.uv.slice();
  return out;
}

/** Moves every point by f(point), keeping the normals (for shallow bends and leans). */
export function warped(g: Geo, f: (p: V3) => V3): Geo {
  const out = new Geo();
  for (let i = 0; i < g.pos.length; i += 3) out.pos.push(...f([g.pos[i], g.pos[i + 1], g.pos[i + 2]]));
  out.nrm.push(...g.nrm);
  out.idx.push(...g.idx);
  if (g.uv) out.uv = g.uv.slice();
  return out;
}

/**
 * A thin curved plate through a grid (rows x cols of points), with thickness `t` and its edges closed.
 * For chair shells, tray bodies and leaves. Normals come from the grid; `up` picks the face side.
 */
export function plate(grid: V3[][], t: number, up: V3 = [0, 1, 0]): Geo {
  const R = grid.length;
  const C = grid[0].length;
  const n = (r: number, c: number): V3 => {
    const a = sub(grid[Math.min(r + 1, R - 1)][c], grid[Math.max(r - 1, 0)][c]);
    const b = sub(grid[r][Math.min(c + 1, C - 1)], grid[r][Math.max(c - 1, 0)]);
    return unit(cross(a, b));
  };
  // One sign for the whole plate, decided at its middle (flipping per point leaves dark seams along the rims).
  const m0 = n(Math.floor(R / 2), Math.floor(C / 2));
  const sign = m0[0] * up[0] + m0[1] * up[1] + m0[2] * up[2] < 0 ? -1 : 1;
  const norm = grid.map((row, r) => row.map((_, c): V3 => {
    // where a row collapses to a point (a leaf's tip or base) the grid gives no normal: take the nearest row's
    let m = n(r, c);
    for (let k = 1; Math.hypot(...m) < 0.5 && k < R; k++) m = n(Math.min(R - 1, Math.max(0, r < R / 2 ? r + k : r - k)), c);
    return [m[0] * sign, m[1] * sign, m[2] * sign];
  }));
  const g = new Geo();
  // uv = (along the rows, across the columns), 0..1 (leaves use it for their veins and dry tips)
  const uv = (r: number, c: number): [number, number] => [r / (R - 1), c / (C - 1)];
  const back = grid.map((row, r) => row.map((p, c): V3 => [p[0] - norm[r][c][0] * t, p[1] - norm[r][c][1] * t, p[2] - norm[r][c][2] * t]));
  for (let r = 0; r < R - 1; r++)
    for (let c = 0; c < C - 1; c++) {
      const q: [number, number][] = [uv(r, c), uv(r, c + 1), uv(r + 1, c + 1), uv(r + 1, c)];
      g.quadN(grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c], norm[r][c], norm[r][c + 1], norm[r + 1][c + 1], norm[r + 1][c], q);
      const m = (a: V3): V3 => [-a[0], -a[1], -a[2]];
      g.quadN(back[r][c], back[r][c + 1], back[r + 1][c + 1], back[r + 1][c], m(norm[r][c]), m(norm[r][c + 1]), m(norm[r + 1][c + 1]), m(norm[r + 1][c]), q);
    }
  // the four edges
  const edge = (a: V3, b: V3, a2: V3, b2: V3, ua: [number, number], ub: [number, number]) => {
    const nn = unit(cross(sub(b, a), sub(a2, a)));
    g.quadN(a, b, b2, a2, nn, nn, nn, nn, [ua, ub, ub, ua]);
  };
  for (let c = 0; c < C - 1; c++) {
    edge(grid[0][c], grid[0][c + 1], back[0][c], back[0][c + 1], uv(0, c), uv(0, c + 1));
    edge(grid[R - 1][c], grid[R - 1][c + 1], back[R - 1][c], back[R - 1][c + 1], uv(R - 1, c), uv(R - 1, c + 1));
  }
  for (let r = 0; r < R - 1; r++) {
    edge(grid[r][0], grid[r + 1][0], back[r][0], back[r + 1][0], uv(r, 0), uv(r + 1, 0));
    edge(grid[r][C - 1], grid[r + 1][C - 1], back[r][C - 1], back[r + 1][C - 1], uv(r, C - 1), uv(r + 1, C - 1));
  }
  return g;
}

/**
 * A molding: a profile swept around a closed path lying on a surface. `faceN` is the surface normal there;
 * profile points are (out, up): out across the path (positive away from the path's middle), up off the surface.
 * For door and panel frames, welts and piping around cushions, rims and plinth beads.
 */
export function sweep(path: V3[], faceN: V3, profile: [number, number][]): Geo {
  const n = path.length;
  const mid: V3 = [path.reduce((a, p) => a + p[0], 0) / n, path.reduce((a, p) => a + p[1], 0) / n, path.reduce((a, p) => a + p[2], 0) / n];
  const fn = unit(faceN);
  const rings = path.map((p, i) => {
    const t = sub(path[(i + 1) % n], path[(i - 1 + n) % n]);
    let side = unit(cross(t, fn));
    const away = sub(p, mid);
    if (side[0] * away[0] + side[1] * away[1] + side[2] * away[2] < 0) side = [-side[0], -side[1], -side[2]];
    return profile.map(([o, u]): V3 => [p[0] + side[0] * o + fn[0] * u, p[1] + side[1] * o + fn[1] * u, p[2] + side[2] * o + fn[2] * u]);
  });
  rings.push(rings[0]);
  // faces away from a point just behind the surface, under the path's middle
  return loft(rings, false, [mid[0] - fn[0] * 0.05, mid[1] - fn[1] * 0.05, mid[2] - fn[2] * 0.05]);
}

/** A rounded rectangle path on a plane: centre `c`, in-plane axes `u` and `v` (unit), half sizes, corner radius. */
export function rectPath(c: V3, u: V3, v: V3, hu: number, hv: number, r: number, steps = 3): V3[] {
  return roundedLoop(0, 0, hu, hv, r, steps).map(([a, b]): V3 => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b]);
}

/** A copy of g (built standing on +y at the origin) turned so its +y points along `n`, then moved to `at`. */
export function oriented(g: Geo, n: V3, at: V3): Geo {
  const up = unit(n);
  const t = unit(cross(Math.abs(up[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], up));
  const b = cross(up, t);
  const map = (x: number, y: number, z: number): V3 => [t[0] * x + up[0] * y + b[0] * z, t[1] * x + up[1] * y + b[1] * z, t[2] * x + up[2] * y + b[2] * z];
  const out = new Geo();
  for (let i = 0; i < g.pos.length; i += 3) {
    const p = map(g.pos[i], g.pos[i + 1], g.pos[i + 2]);
    out.pos.push(p[0] + at[0], p[1] + at[1], p[2] + at[2]);
    out.nrm.push(...map(g.nrm[i], g.nrm[i + 1], g.nrm[i + 2]));
  }
  out.idx.push(...g.idx);
  return out;
}

/** Hardware, built along +y for `oriented`: a hex bolt head with a washer, or a round dome-head screw. */
export const boltHead = (size = 0.006, hex = true): Geo => {
  const g = turned(0, 0, [[0, 0], [size * 1.6, 0], [size * 1.6, size * 0.25], [size * 1.05, size * 0.3]], 12);
  addTo(g, turned(0, 0, hex ? [[size, size * 0.3], [size, size * 0.95], [size * 0.8, size * 1.05], [0, size * 1.05]] : [[size, size * 0.3], [size * 0.85, size * 0.7], [size * 0.45, size * 0.95], [0, size]], hex ? 6 : 10));
  return g;
};

/**
 * A profile run all the way round a rounded box (cornices, plinth steps, welts round a cushion, edge beads):
 * profile points are (out, y), `out` measured outward from the box's own outline.
 */
export function band(cx: number, cz: number, hx: number, hz: number, r: number, profile: [number, number][], corner = 3): Geo {
  const rings = profile.map(([o, y]) => roundedLoop(cx, cz, hx + o, hz + o, Math.max(0.001, r + o), corner).map(([x, z]): V3 => [x, y, z]));
  return loft(rings, true, [cx, profile.reduce((a, p) => a + p[1], 0) / profile.length, cz]);
}

/** A round cord's profile for `band` (piping, welts, rolled beads): radius `r` centred at (out, y). */
export function cord(out: number, y: number, r: number, n = 6): [number, number][] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = -Math.PI / 2 + (Math.PI * k) / n; // the outer half, bottom to top: the inner half is buried
    return [out + Math.cos(a) * r, y + Math.sin(a) * r] as [number, number];
  });
}
