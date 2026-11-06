import { readFileSync } from "node:fs";
import { PLANS, CELL, NX, FLOOR_H, CEIL_H, ROOF_Y, RAIL_H, WALK, HOLE } from "./config.mts";
import { plans, floors } from "./grid.mts";
import { Geo, type V3, geo, addTo, slabGeo, prismGeo, latheGeo, sweepGeo, tubeGeo, rockGeo, boxGeo } from "./geo.mts";

// ---- stair towers --------------------------------------------------------------------------------
// The stairs in the two towers are open to the atrium, like the reference photos (stairs_*): 3 m wide
// flights with open treads, glass rails, and round landings that stick out over the atrium. Every floor
// is the same and stacked exactly over the one below, as in the photos. The base is open: a planter
// garden behind a glass fence under the flights, and a round planter under the lower round landing.
// Each tower is described in a
// local frame: u runs from the hall end (0) toward the atrium end (6), v runs east from the box's west
// edge. The south tower (A) has its hall to the south, the north tower (B) to the north, and you enter
// from the hall end on every floor. Per floor: a flight up the west lane to a round landing over the
// atrium (half a floor up), then a flight back down the east lane, arriving at the next floor's hall end.
// The rest of the box (v 6 to 13.5) stays a solid core beside the elevators.
// A third stair, the center one in Atrium B (reference photo stairs_center-curved-from-third-floor), is the
// same design standing free in the atrium against the cross-corridor: the rest of its 9 m box is atrium
// again, its sides are glass, there is no sealed floor 4 set, and its top landing opens to the roof.
type TowerDef = { id: string; hall: "S" | "N"; vOff: number; sealed: boolean; noUp: boolean; seed: number };
const towerData = JSON.parse(readFileSync(`${PLANS}/towers.json`, "utf8")) as { towers: TowerDef[] };
export const TOWERS = towerData.towers.map((t) => ({ ...t, box: plans[0].boxes.find((b) => b.id === t.id)! }));
export type Tower = (typeof TOWERS)[number];
export const ST = { lane: 3, strip: 1.5, depth: 6, nose: 3, tread: 0.06, slab: 0.35 };
export const ZONE_KINDS = new Set(["stairzone", "stair_landing", "stairzone_o", "stair_landing_o"]); // _o: free-standing (open) stair
export const isZone = (k: string) => ZONE_KINDS.has(k);
/** Tower frame to a three.js point: u toward the atrium from the hall end, v east, h up. */
export const towerPt = (t: Tower, u: number, v: number, h: number): V3 => [t.box.x0 + t.vOff + v, h, -(t.hall === "S" ? t.box.y0 + u : t.box.y1 - u)];

export function paintTowers() {
floors.forEach((f, fi) => {
  for (const t of TOWERS) {
    const j0 = Math.round(t.box.y0 / CELL);
    const j1 = Math.round(t.box.y1 / CELL);
    if (!t.sealed)
      for (let j = j0; j < j1; j++)
        for (let i = Math.round(t.box.x0 / CELL); i < Math.round(t.box.x1 / CELL); i++) {
          f.cls[j * NX + i] = fi === 0 ? WALK : HOLE; // atrium again
          f.kind[j * NX + i] = "void";
        }
    for (let j = j0; j < j1; j++)
      for (let i = Math.round((t.box.x0 + t.vOff) / CELL); i < Math.round((t.box.x0 + t.vOff + 2 * ST.lane) / CELL); i++) {
        const yc = (j + 0.5) * CELL;
        const u = t.hall === "S" ? yc - t.box.y0 : t.box.y1 - yc;
        if (u >= ST.depth) continue;
        f.cls[j * NX + i] = WALK;
        f.kind[j * NX + i] = (u < ST.strip ? "stair_landing" : "stairzone") + (t.sealed ? "" : "_o");
        if (t.noUp && fi === 2) {
          // Floor 3 has no flight up: the hall end and the west lane are plain hall (open to the roof),
          // and only the east lane stays a stairwell, open up to the roof, where the flight from floor 2 arrives.
          const west = i < Math.round((t.box.x0 + t.vOff + ST.lane) / CELL);
          f.kind[j * NX + i] = u < ST.strip || west ? "hall" : "stairzone_o";
        }
      }
  }
});
}

export type Rail = (u0: number, v0: number, h0: number, u1: number, v1: number, h1: number) => void;

/**
 * The garden at the foot of the stairs (see the photos): rounded beds of river-stone gravel with rocks and
 * leafy plants under the flights, behind a glass fence, and a round planter drum under the lower round
 * landing. Leaves are curved tapering ribbons; the gravel is a shader pattern (see materials.ts).
 */
export function garden(t: Tower, P: (u: number, v: number, h: number) => V3, rail: Rail) {
  let seed = t.seed;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const rocks = geo("stone");
  const leaves = () => geo(rnd() < 0.35 ? "garden_dark" : "garden");

  /** One leaf: a ribbon that rises, arches over by `lean` and tapers to a point. Never taller than maxH. */
  const leaf = (x: number, y: number, z: number, angle: number, len: number, width: number, lean: number, maxH: number, target: Geo) => {
    const rise = (tt: number) => tt - 0.6 * lean * tt * tt;
    let top = 0;
    for (let k = 1; k <= 20; k++) top = Math.max(top, rise(k / 20));
    const length = Math.min(len, maxH / top);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const segs = 4;
    let prev: [V3, V3] | null = null;
    for (let k = 0; k <= segs; k++) {
      const tt = k / segs;
      const reach = length * lean * tt * (0.5 + 0.5 * tt);
      const c: V3 = [x + dx * reach, y + length * rise(tt), z + dz * reach];
      const w = width * 0.5 * Math.pow(1 - tt, 0.7) * (k === 0 ? 0.6 : 1);
      const pair: [V3, V3] = [[c[0] + dz * w, c[1], c[2] - dx * w], [c[0] - dz * w, c[1], c[2] + dx * w]];
      if (prev) {
        const e1: V3 = [pair[0][0] - prev[0][0], pair[0][1] - prev[0][1], pair[0][2] - prev[0][2]];
        const e2: V3 = [prev[1][0] - prev[0][0], prev[1][1] - prev[0][1], prev[1][2] - prev[0][2]];
        let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const len2 = Math.hypot(...n) || 1;
        n = n[1] < 0 ? [-n[0] / len2, -n[1] / len2, -n[2] / len2] : [n[0] / len2, n[1] / len2, n[2] / len2];
        target.quad(prev[0], prev[1], pair[1], pair[0], n);
      }
      prev = pair;
    }
  };
  /** A clump of long arching leaves (phormium, dracaena...). */
  const tuft = (x: number, y: number, z: number, size: number, maxH: number) => {
    const count = 9 + Math.floor(rnd() * 5);
    for (let i = 0; i < count; i++) leaf(x, y, z, rnd() * 2 * Math.PI, size * between(0.7, 1.3), between(0.07, 0.13), between(0.2, 0.85), maxH, leaves());
  };
  /** Low dense bush: many short leaves. */
  const bush = (x: number, y: number, z: number, size: number, maxH: number) => {
    for (let i = 0; i < 16; i++) leaf(x, y, z, rnd() * 2 * Math.PI, size * between(0.5, 1), between(0.05, 0.09), between(0.3, 0.9), maxH, leaves());
  };
  /** Broad-leaf plant: stalks topped with large oval leaves (alocasia, philodendron...). */
  const broadleaf = (x: number, y: number, z: number, size: number, maxH: number) => {
    const count = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const a = rnd() * 2 * Math.PI;
      const h = Math.min(size * between(0.55, 0.9), maxH);
      const lean = between(0.15, 0.4);
      const tip: V3 = [x + Math.cos(a) * h * lean * 0.5, y + h, z + Math.sin(a) * h * lean * 0.5];
      leaf(x, y, z, a, h * 1.05, 0.03, lean, maxH, geo("garden_dark")); // the stalk
      const bl = size * between(0.35, 0.55); // blade length and width
      const bw = bl * between(0.55, 0.75);
      const tilt = between(-0.2, 0.3);
      const blade = geo("garden");
      const ring: V3[] = Array.from({ length: 9 }, (_, k): V3 => {
        const th = (k / 9) * 2 * Math.PI;
        const lx = 0.5 * bl * (1 + Math.cos(th)) * 0.9; // from the stalk outward
        const ly = 0.5 * bw * Math.sin(th) * (0.6 + 0.4 * Math.sin(th > Math.PI ? 0 : th));
        return [tip[0] + Math.cos(a) * lx - Math.sin(a) * ly, tip[1] + tilt * lx - 0.15 * Math.abs(ly), tip[2] + Math.sin(a) * lx + Math.cos(a) * ly];
      });
      for (let k = 0; k < 9; k++) blade.quad(tip, ring[k], ring[(k + 1) % 9], ring[(k + 1) % 9], [0, 1, 0]);
    }
  };
  const rock = (u: number, v: number, h: number, size: number) => {
    const q = P(u, v, h - 0.04);
    addTo(rocks, rockGeo(q[0], q[1], q[2], size * between(0.9, 1.4), size * between(0.5, 0.8), size, rnd));
  };
  /** Rounded rectangle in the tower frame (u, v), as plan points. */
  const rrect = (u0: number, u1: number, v0: number, v1: number, r: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const [cu, cv, a0] of [[u1 - r, v1 - r, 0], [u0 + r, v1 - r, 0.5], [u0 + r, v0 + r, 1], [u1 - r, v0 + r, 1.5]] as const)
      for (let k = 0; k <= 4; k++) {
        const a = (a0 + k / 8) * Math.PI;
        out.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]);
      }
    return out.map(([u, v]): [number, number] => {
      const q = P(u, v, 0);
      return [q[0], q[2]];
    });
  };
  const bed = (u0: number, u1: number, v0: number, v1: number, h: number, clear: (u: number) => number = () => 9) => {
    // gravel top, planter-concrete sides
    addTo(geo("gravel"), slabGeo(rrect(u0, u1, v0, v1, 0.25), 0, h, geo("planter"), false));
    const free = (u: number) => Math.max(0.25, clear(u));
    const inside = (m: number): [number, number] => [between(u0 + m, u1 - m), between(v0 + m, v1 - m)];
    const area = (u1 - u0) * (v1 - v0);
    for (let i = 0; i < Math.round(area * 0.7); i++) {
      const [u, v] = inside(0.35);
      rock(u, v, h, between(0.12, 0.38));
    }
    for (let i = 0; i < Math.round(area * 0.65); i++) {
      const [u, v] = inside(0.4);
      const q = P(u, v, h);
      tuft(q[0], q[1], q[2], between(1.0, 1.7), free(u));
    }
    for (let i = 0; i < Math.round(area * 0.5); i++) {
      const [u, v] = inside(0.35);
      const q = P(u, v, h);
      broadleaf(q[0], q[1], q[2], between(0.7, 1.2), free(u));
    }
    for (let i = 0; i < Math.round(area * 0.9); i++) {
      const [u, v] = inside(0.3);
      const q = P(u, v, h);
      bush(q[0], q[1], q[2], between(0.3, 0.55), Math.min(0.5, free(u)));
    }
  };
  // Under the flights. The west lane's flight is low near the hall end, so its bed starts further in, and
  // plants stay under the flight above (its underside is 0.5 m below the tread line, over 4.5 m).
  bed(1.8, ST.depth - 0.1, ST.lane + 0.1, 2 * ST.lane - 0.1, 0.3);
  bed(3.5, ST.depth - 0.1, 0.1, ST.lane - 0.1, 0.3, (u) => ((u - ST.strip) * FLOOR_H) / 2 / (ST.depth - ST.strip) - 0.9);
  // Glass fence: across the hall end of the east lane and along the atrium edge of the whole base.
  rail(1.6, ST.lane, 0, 1.6, 2 * ST.lane, 0);
  rail(ST.depth, 0, 0, ST.depth, 2 * ST.lane, 0);
  if (!t.sealed) {
    // Free-standing: the sides are open to the atrium floor too.
    rail(ST.strip + 0.1, 0, 0, ST.depth, 0, 0);
    rail(ST.strip + 0.1, 2 * ST.lane, 0, ST.depth, 2 * ST.lane, 0);
  }

  // D-shaped planter under the lower round landing, following its outline (the landing is two lanes wide:
  // straight sides for 0.5 m past the flights, then a half circle of radius ST.nose). Smooth concrete with a
  // lip and a gravel top, set 0.25 m in from the landing's edge.
  const inset = 0.25;
  const rr = ST.nose - inset; // radius of the planter's curve
  const uS = ST.depth + 0.15; // straight side starts just past the glass fence
  const uT = ST.depth + 0.5; // ...and meets the curve here
  const vA = inset;
  const vB = 2 * ST.nose - inset;
  const vM = ST.nose;
  const dBase: [number, number][] = []; // (u, v), counter-clockwise, south corners rounded
  const rc = 0.2;
  for (let k = 0; k <= 3; k++) dBase.push([uS + rc - rc * Math.cos((k / 3) * (Math.PI / 2)), vA + rc - rc * Math.sin((k / 3) * (Math.PI / 2))]);
  dBase.push([uT, vA]);
  for (let k = 1; k < 16; k++) {
    const th = (k / 16) * Math.PI;
    dBase.push([uT + rr * Math.sin(th), vM - rr * Math.cos(th)]);
  }
  dBase.push([uT, vB]);
  for (let k = 0; k <= 3; k++) dBase.push([uS + rc - rc * Math.sin((k / 3) * (Math.PI / 2)), vB - rc + rc * Math.cos((k / 3) * (Math.PI / 2))]);
  const outlineXZ = dBase.map(([u, v]): [number, number] => {
    const q = P(u, v, 0);
    return [q[0], q[2]];
  });
  addTo(geo("planter"), sweepGeo(outlineXZ, [[0, 0], [0.06, 0.06], [0.06, 0.82], [0.14, 0.86], [0.14, 0.98], [-0.1, 0.98]]));
  // gravel: the same outline pulled in by the lip
  const gravelXZ = outlineXZ.map(([x, z], i) => {
    const prev = outlineXZ[(i + outlineXZ.length - 1) % outlineXZ.length];
    const next = outlineXZ[(i + 1) % outlineXZ.length];
    const cx = outlineXZ.reduce((acc, q) => acc + q[0], 0) / outlineXZ.length;
    const cz = outlineXZ.reduce((acc, q) => acc + q[1], 0) / outlineXZ.length;
    let nx = next[1] - prev[1];
    let nz = -(next[0] - prev[0]);
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    if (nx * (x - cx) + nz * (z - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [x - nx * 0.1, z - nz * 0.1] as [number, number];
  });
  addTo(geo("gravel"), slabGeo(gravelXZ.slice().reverse(), 0.9, 0.97, geo("planter"), false));
  const onPlanter = (margin: number): V3 => {
    for (;;) {
      const u = between(uS + margin, uT + rr - margin * 0.5);
      const v = between(vA + margin, vB - margin);
      if (u <= uT ? true : Math.hypot(u - uT, v - vM) <= rr - margin) {
        const q = P(u, v, 0);
        return [q[0], 0.97, q[2]];
      }
    }
  };
  for (let i = 0; i < 9; i++) {
    const q = onPlanter(0.35);
    tuft(q[0], q[1], q[2], between(0.8, 1.2), 1.0);
  }
  for (let i = 0; i < 7; i++) {
    const q = onPlanter(0.35);
    broadleaf(q[0], q[1], q[2], between(0.6, 0.9), 1.0);
  }
  for (let i = 0; i < 9; i++) {
    const q = onPlanter(0.3);
    bush(q[0], q[1], q[2], between(0.3, 0.5), 0.45);
  }
  for (let i = 0; i < 9; i++) {
    const q = onPlanter(0.35);
    addTo(rocks, rockGeo(q[0], 0.93, q[2], between(0.12, 0.3), between(0.08, 0.18), between(0.1, 0.26), rnd));
  }
}

export function buildTowers() {
for (const t of TOWERS) {
  const stairs = geo("stairs");
  const rails = geo("rails");
  const P = (u: number, v: number, h: number) => towerPt(t, u, v, h);
  const box = (u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, target: Geo = stairs) => {
    const a = P(u0, v0, h0);
    const b = P(u1, v1, h1);
    addTo(target, boxGeo(Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[2], b[2])));
  };
  /** Glass rail between two points of the tower frame; heights are where it stands (it rises RAIL_H above). */
  const middle = P(4, ST.lane, 0); // roughly the middle of the stair: "inside" for rails that do not say
  /**
   * Glass rail between two points of the tower frame; heights are where it stands (it rises RAIL_H above).
   * `side` is the world (x, z) direction of the walking side; the stainless handrail is mounted on that side
   * of the glass, bolted to it (as in the photos: no posts).
   */
  const rail = (u0: number, v0: number, h0: number, u1: number, v1: number, h1: number, side?: [number, number]) => {
    const a = P(u0, v0, h0);
    const b = P(u1, v1, h1);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const n: V3 = [(b[2] - a[2]) / len, 0, -(b[0] - a[0]) / len];
    rails.quad(a, b, [b[0], b[1] + RAIL_H, b[2]], [a[0], a[1] + RAIL_H, a[2]], n);
    let sx = n[0];
    let sz = n[2];
    if (side) [sx, sz] = side;
    else if (n[0] * (middle[0] - (a[0] + b[0]) / 2) + n[2] * (middle[2] - (a[2] + b[2]) / 2) < 0) {
      sx = -sx;
      sz = -sz;
    }
    const hh = RAIL_H - 0.1; // the handrail sits just below the top edge of the glass
    const stand = 0.055; // how far it stands off the glass
    const at = (p: V3, f: number, off: number): V3 => [p[0] + sx * off, p[1] + hh, p[2] + sz * off];
    addTo(geo("chrome"), tubeGeo(at(a, 0, stand), at(b, 0, stand), 0.024, 6));
    const bolts = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k <= bolts; k++) {
      const f = k / bolts;
      const g: V3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      addTo(geo("chrome"), tubeGeo(at(g, f, 0), at(g, f, 0.012), 0.03, 5, true)); // the bolt head on the glass
      addTo(geo("chrome"), tubeGeo(at(g, f, 0.012), at(g, f, stand), 0.011, 4)); // the stand-off to the handrail
    }
  };
  const flight = (lane: number, uS: number, hS: number, uE: number, hE: number, steps: number) => {
    const dir = Math.sign(uE - uS);
    const tread = Math.abs(uE - uS) / steps;
    const rise = (hE - hS) / steps;
    const v0 = lane * ST.lane;
    const v1 = v0 + ST.lane;
    for (let k = 0; k < steps; k++) {
      const ua = uS + dir * k * tread;
      const top = hS + (k + 1) * rise;
      box(ua, ua + dir * tread, v0, v1, top - ST.tread, top);
    }
    // Inset 4 cm so a rail never shares a plane with a wall, a hall rail or the next lane's rail (z-fighting).
    for (const [v, dir] of [[v0 + 0.04, 1], [v1 - 0.04, -1]] as const) rail(uS, v, hS + rise, uE, v, hE, [dir, 0]); // handrail on the lane side
    // Dark steel stringer down the middle of the flight, under the treads (open risers, like the photos).
    const vc = lane === 0 ? v0 + 0.55 : v1 - 0.55; // off to the outer side of the lane, like the photos
    const w = 0.18;
    const top0 = hS + rise;
    const under = ST.tread + 0.42;
    const prism: V3[] = [
      P(uS, vc - w, top0 - ST.tread), P(uE, vc - w, hE - ST.tread), P(uE, vc - w, hE - under), P(uS, vc - w, top0 - under),
      P(uS, vc + w, top0 - ST.tread), P(uE, vc + w, hE - ST.tread), P(uE, vc + w, hE - under), P(uS, vc + w, top0 - under),
    ];
    addTo(geo("steel"), prismGeo(prism));
  };
  /** Round landing sticking out from the atrium end (u = depth) over the lanes starting at v0. */
  const round = (v0: number, h: number) => {
    const w = 2 * ST.nose;
    const vm = v0 + ST.nose;
    const straight = ST.depth + 0.5;
    const poly: [number, number][] = [[ST.depth, v0], [ST.depth, v0 + w]];
    for (let a = 0; a <= 8; a++) {
      const th = (a / 8) * Math.PI;
      poly.push([straight + ST.nose * Math.sin(th), vm + ST.nose * Math.cos(th)]);
    }
    const xz = poly.map(([u, v]): [number, number] => {
      const q = P(u, v, 0);
      return [q[0], q[2]];
    });
    addTo(stairs, slabGeo(xz, h - ST.slab, h, geo("fascia"))); // white top and underside, grey edge band
    for (const lv of [v0 + 2, v0 + 4]) {
      // Recessed ceiling lights (off): two pale discs under the landing.
      const lamp = P(ST.depth + 1.6, lv, 0);
      const disc = Array.from({ length: 8 }, (_, i): [number, number] => [lamp[0] + 0.22 * Math.cos((i / 8) * 2 * Math.PI), lamp[2] + 0.22 * Math.sin((i / 8) * 2 * Math.PI)]);
      addTo(geo("lamp"), slabGeo(disc, h - ST.slab - 0.03, h - ST.slab));
    }
    for (let i = 1; i < poly.length; i++) {
      const [u0, w0] = poly[i];
      const [u1, w1] = poly[(i + 1) % poly.length];
      rail(u0, w0, h, u1, w1, h); // every edge but the first (the one the flights meet)
    }
  };

  // Same on every floor: up the west lane to the round landing, back down the east lane to the hall end.
  // The third set goes from floor 3 up to a future floor 4 (y 15), sealed by a steel gate across its foot on floor 3.
  for (let fi = 0; fi < (t.sealed && !t.noUp ? 3 : 2); fi++) {
    const base = fi * FLOOR_H;
    flight(0, ST.strip, base, ST.depth, base + FLOOR_H / 2, 15);
    round(0, base + FLOOR_H / 2);
    flight(1, ST.depth, base + FLOOR_H / 2, ST.strip, base + FLOOR_H, 15);
  }
  // Only the west lane (the flight going up) is closed; the east lane is where the flight from floor 2 arrives.
  // It stands just on the hall side of the flight's first tread and stringer, and 2 cm in from the lane edges, so no face shares a plane with them (z-fighting).
  if (t.sealed && !t.noUp) box(ST.strip - 0.12, ST.strip, 0.02, ST.lane - 0.02, 2 * FLOOR_H, 2 * FLOOR_H + CEIL_H, geo("steel"));
  else if (!t.noUp) rail(ST.strip, 0, 2 * FLOOR_H, ST.strip, ST.lane, 2 * FLOOR_H); // the top: no flight up from the west lane
  garden(t, P, rail);
  // Big grey column through the round landings, at their west corner (photos: stairs_northern-tower).
  const col = P(ST.depth + 0.3, -0.3, 0);
  addTo(geo("column"), latheGeo(col[0], col[2], [[0.37, 0], [0.37, 0.14], [0.3, 0.17], [0.3, 3 * FLOOR_H - 0.2], [0.37, 3 * FLOOR_H - 0.15], [0.37, 3 * FLOOR_H]], 24));
}
}

// Elevator shafts: dark glass faces (the "elev" material, set where the walls are built) with grey piers
// between and beside the two shafts, as in the photos. The piers stand just in front of the atrium face.
export function buildElevatorPiers() {
for (const id of ["a_elevators", "b_elevators"]) {
  const b = plans[0].boxes.find((q) => q.id === id)!;
  const south = b.y0 > 100 ? true : false; // north tower: the atrium is to the south
  const yFace = south ? b.y0 : b.y1;
  for (const [x0, x1] of [[b.x0, b.x0 + 0.5], [(b.x0 + b.x1) / 2 - 0.35, (b.x0 + b.x1) / 2 + 0.35], [b.x1 - 0.5, b.x1]]) {
    const z0 = south ? -yFace : -yFace - 0.35;
    const z1 = south ? -yFace + 0.35 : -yFace;
    addTo(geo("column"), boxGeo(x0, x1, 0, ROOF_Y - 0.1, Math.min(z0, z1), Math.max(z0, z1)));
  }
}
}
