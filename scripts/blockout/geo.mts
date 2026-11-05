import { CELL } from "./config.mts";

export class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];
  /** Quad with corners a,b,c,d (three.js coords), counter-clockwise seen from the normal side. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(...p);
      this.nrm.push(...n);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Quad with a normal per corner (smooth shading), wound to face along the average normal. */
  quadN(a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3) {
    const cross = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const facing = [0, 1, 2].reduce((acc, k) => acc + cross[k] * (na[k] + nb[k] + nc[k] + nd[k]), 0) > 0;
    const corners: [V3, V3][] = facing ? [[a, na], [b, nb], [c, nc], [d, nd]] : [[a, na], [d, nd], [c, nc], [b, nb]];
    const base = this.pos.length / 3;
    for (const [p, n] of corners) {
      this.pos.push(...p);
      this.nrm.push(...n);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
export type V3 = [number, number, number];

export const geos: Record<string, Geo> = {};
export const geo = (name: string) => (geos[name] ??= new Geo());

// Horizontal quads (floors, ceilings, roof) over a run of cells in x.
export function flatRun(name: string, i0: number, i1: number, j: number, y: number, up: boolean) {
  const x0 = i0 * CELL;
  const x1 = i1 * CELL;
  const zNear = -(j * CELL); // plan y = j*CELL
  const zFar = -((j + 1) * CELL);
  if (up) geo(name).quad([x0, y, zNear], [x1, y, zNear], [x1, y, zFar], [x0, y, zFar], [0, 1, 0]);
  else geo(name).quad([x0, y, zFar], [x1, y, zFar], [x1, y, zNear], [x0, y, zNear], [0, -1, 0]);
}

export function addTo(target: Geo, g: Geo) {
  const base = target.pos.length / 3;
  target.pos.push(...g.pos);
  target.nrm.push(...g.nrm);
  for (const k of g.idx) target.idx.push(base + k);
}

/** Convex polygon (x, z points) extruded from y0 up to y1. */
export function slabGeo(pts: [number, number][], y0: number, y1: number, sides?: Geo, bottom = true): Geo {
  const g = new Geo();
  const n = pts.length;
  const cx = pts.reduce((a, p) => a + p[0], 0) / n;
  const cz = pts.reduce((a, p) => a + p[1], 0) / n;
  const top = pts.map(([x, z]): V3 => [x, y1, z]);
  const bot = pts.map(([x, z]): V3 => [x, y0, z]);
  for (let i = 1; i < n - 1; i++) {
    facedQuad(g, top[0], top[i], top[i + 1], top[i + 1], [0, 1, 0]);
    if (bottom) facedQuad(g, bot[0], bot[i], bot[i + 1], bot[i + 1], [0, -1, 0]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let nx = pts[j][1] - pts[i][1];
    let nz = -(pts[j][0] - pts[i][0]);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    if (nx * ((pts[i][0] + pts[j][0]) / 2 - cx) + nz * ((pts[i][1] + pts[j][1]) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    facedQuad(sides ?? g, bot[i], bot[j], top[j], top[i], [nx, 0, nz]);
  }
  return g;
}

/** Convex solid from 8 points: [a0 a1 a2 a3] one end face, [b0 b1 b2 b3] the other, a_i joined to b_i. */
export function prismGeo(p: V3[]): Geo {
  const g = new Geo();
  const c = [0, 1, 2].map((k) => p.reduce((acc, q) => acc + q[k], 0) / 8);
  const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];
  for (const f of faces) {
    const [a, b, , d] = f.map((i) => p[i]);
    let n: V3 = [
      (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]),
      (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]),
      (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]),
    ];
    const len = Math.hypot(...n) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const fc = [0, 1, 2].map((k) => f.reduce((acc, i) => acc + p[i][k], 0) / 4);
    if (n[0] * (fc[0] - c[0]) + n[1] * (fc[1] - c[1]) + n[2] * (fc[2] - c[2]) < 0) n = [-n[0], -n[1], -n[2]];
    facedQuad(g, p[f[0]], p[f[1]], p[f[2]], p[f[3]], n);
  }
  return g;
}

/**
 * Surface of revolution around a vertical axis, smooth around the circumference and crisp along the
 * profile. `profile` is (radius, height) points going up the outside and then inward across the top.
 */
export function latheGeo(cx: number, cz: number, profile: [number, number][], seg: number): Geo {
  const g = new Geo();
  for (let i = 0; i + 1 < profile.length; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    const len = Math.hypot(y1 - y0, r1 - r0) || 1;
    const nr = (y1 - y0) / len;
    const ny = -(r1 - r0) / len;
    for (let j = 0; j < seg; j++) {
      const t0 = (j / seg) * 2 * Math.PI;
      const t1 = ((j + 1) / seg) * 2 * Math.PI;
      const pt = (r: number, y: number, t: number): V3 => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
      const nm = (t: number): V3 => [nr * Math.cos(t), ny, nr * Math.sin(t)];
      g.quadN(pt(r0, y0, t0), pt(r0, y0, t1), pt(r1, y1, t1), pt(r1, y1, t0), nm(t0), nm(t1), nm(t1), nm(t0));
    }
  }
  return g;
}

/**
 * Like latheGeo, but around any closed outline instead of a circle. `outline` is (x, z) points; `profile`
 * is (offset, height) with positive offsets growing outward from the outline. Smooth around, crisp along
 * the profile, so it works for a rounded D as well as a circle.
 */
export function sweepGeo(outline: [number, number][], profile: [number, number][]): Geo {
  const g = new Geo();
  const n = outline.length;
  const cx = outline.reduce((a, q) => a + q[0], 0) / n;
  const cz = outline.reduce((a, q) => a + q[1], 0) / n;
  // outward unit normal at each outline point: the two edge normals averaged (smooth around the curve)
  const out: [number, number, number][] = outline.map((q, i) => {
    const a = outline[(i + n - 1) % n];
    const b = outline[(i + 1) % n];
    let nx = b[1] - a[1];
    let nz = -(b[0] - a[0]);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    if (nx * (q[0] - cx) + nz * (q[1] - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    // miter: push further at sharp corners so the offset stays parallel to the edges
    const e = [b[0] - q[0], b[1] - q[1]];
    const el = Math.hypot(e[0], e[1]) || 1;
    const en: [number, number] = [e[1] / el, -e[0] / el];
    const sgn = en[0] * (q[0] - cx) + en[1] * (q[1] - cz) < 0 ? -1 : 1;
    const k = Math.max(0.5, nx * en[0] * sgn + nz * en[1] * sgn);
    return [nx, nz, 1 / k];
  });
  for (let i = 0; i + 1 < profile.length; i++) {
    const [d0, y0] = profile[i];
    const [d1, y1] = profile[i + 1];
    const len = Math.hypot(y1 - y0, d1 - d0) || 1;
    const nr = (y1 - y0) / len;
    const ny = -(d1 - d0) / len;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      const pt = (idx: number, d: number, y: number): V3 => [outline[idx][0] + out[idx][0] * d * out[idx][2], y, outline[idx][1] + out[idx][1] * d * out[idx][2]];
      const nm = (idx: number): V3 => [out[idx][0] * nr, ny, out[idx][1] * nr];
      g.quadN(pt(j, d0, y0), pt(k, d0, y0), pt(k, d1, y1), pt(j, d1, y1), nm(j), nm(k), nm(k), nm(j));
    }
  }
  return g;
}

/** Thin round tube from a to b (smooth around), for handrails and posts. */
export function tubeGeo(a: V3, b: V3, r: number, sides = 6, capEnd = false): Geo {
  const g = new Geo();
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d) || 1;
  const dn: V3 = [d[0] / len, d[1] / len, d[2] / len];
  const ref: V3 = Math.abs(dn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1: V3 = [dn[1] * ref[2] - dn[2] * ref[1], dn[2] * ref[0] - dn[0] * ref[2], dn[0] * ref[1] - dn[1] * ref[0]];
  const l1 = Math.hypot(...e1) || 1;
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: V3 = [dn[1] * e1[2] - dn[2] * e1[1], dn[2] * e1[0] - dn[0] * e1[2], dn[0] * e1[1] - dn[1] * e1[0]];
  const ring = (k: number): V3 => {
    const t = (k / sides) * 2 * Math.PI;
    return [e1[0] * Math.cos(t) + e2[0] * Math.sin(t), e1[1] * Math.cos(t) + e2[1] * Math.sin(t), e1[2] * Math.cos(t) + e2[2] * Math.sin(t)];
  };
  for (let k = 0; k < sides; k++) {
    const n0 = ring(k);
    const n1 = ring(k + 1);
    const at = (p: V3, n: V3): V3 => [p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r];
    g.quadN(at(a, n0), at(a, n1), at(b, n1), at(b, n0), n0, n1, n1, n0);
    if (capEnd) g.quadN(b, at(b, n0), at(b, n1), at(b, n1), dn, dn, dn, dn);
  }
  return g;
}

/** A faceted rock: the top half of a roughened ellipsoid, flat-shaded like a low-poly boulder. */
export function rockGeo(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rnd: () => number): Geo {
  const g = new Geo();
  const seg = 7;
  const rings = 3;
  const jit = () => 0.8 + rnd() * 0.35;
  const pts: V3[][] = [];
  for (let k = 0; k <= rings; k++) {
    const phi = (k / rings) * (Math.PI / 2);
    const row: V3[] = [];
    const count = k === 0 ? 1 : seg;
    for (let j = 0; j < count; j++) {
      const th = (j / seg) * 2 * Math.PI;
      const q = jit();
      row.push([cx + rx * q * Math.sin(phi) * Math.cos(th), cy + ry * q * Math.cos(phi), cz + rz * q * Math.sin(phi) * Math.sin(th)]);
    }
    pts.push(row);
  }
  const out = (a: V3, b: V3, c: V3, d: V3) => {
    const n: V3 = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    const len = Math.hypot(...n) || 1;
    const fc = [(a[0] + b[0] + c[0] + d[0]) / 4 - cx, (a[1] + b[1] + c[1] + d[1]) / 4 - cy, (a[2] + b[2] + c[2] + d[2]) / 4 - cz];
    const sign = n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] < 0 ? -1 : 1;
    facedQuad(g, a, b, c, d, [(sign * n[0]) / len, (sign * n[1]) / len, (sign * n[2]) / len]);
  };
  for (let j = 0; j < seg; j++) out(pts[0][0], pts[1][j], pts[1][(j + 1) % seg], pts[1][(j + 1) % seg]);
  for (let k = 1; k < rings; k++)
    for (let j = 0; j < seg; j++) out(pts[k][j], pts[k][(j + 1) % seg], pts[k + 1][(j + 1) % seg], pts[k + 1][j]);
  return g;
}


/** Box with six quads, wound to face outward. */
export function boxGeo(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo {
  const g = new Geo();
  const faces: [V3, V3, V3, V3, V3][] = [
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]],
  ];
  for (const [a, b, c, d, n] of faces) facedQuad(g, a, b, c, d, n);
  return g;
}

/** A quad wound so its front side faces along n, whichever way the corners were given. */
export function facedQuad(g: Geo, a: V3, b: V3, c: V3, d: V3, n: V3) {
  const cross = [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ];
  if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0) g.quad(a, b, c, d, n);
  else g.quad(a, d, c, b, n);
}
