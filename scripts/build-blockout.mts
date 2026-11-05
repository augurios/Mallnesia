// Builds the blockout GLB of the mall from docs/floorplans/floor{1,2,3}_plan.json.
// Run: npm run blockout   (writes public/models/mall_blockout.glb)
//
// Plan coordinates are meters, x east, y north. In the GLB: x = plan x, z = -plan y, y up.
// Method: rasterize each floor onto a 0.5 m grid, classify cells (walkable / solid / hole),
// then emit floor, ceiling and wall quads along the borders, merging runs of equal edges.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Document, NodeIO } from "@gltf-transform/core";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

const PLANS = "docs/floorplans";
const OUT = "public/models/mall_blockout.glb";

const CELL = 0.5;
const NX = 300; // 150 m
const NY = 420; // 210 m
const FLOOR_H = 5;
const CEIL_H = 3.5;
const ROOF_Y = 20;
const RAIL_H = 1.1;
// Meshes the player collides with (walls, glass, rails, stairs and their steel and columns). Keep in sync with src/engine/runtime.ts.
const COLLIDERS = ["walls", "glass", "rails", "stairs", "elev", "column", "steel", "planter"];

type Box = { id: string; kind: string; x0: number; x1: number; y0: number; y1: number };
type Poly = { id: string; kind: string; points: [number, number][] };
type Plan = { boxes: Box[]; polygons: Poly[] };

const WALKABLE = new Set(["hall", "foodcourt", "balcony", "bath", "secret", "garage", "cinema_lobby", "restaurant_open"]);
const SOLID = new Set([
  "shop", "restaurant", "cinema", "kiosk", "elevator", "escalator", "intermittent", "machines", "stairs",
]);

// Cell classes
const EMPTY = 0;
const WALK = 1;
const SOLIDC = 2;
const HOLE = 3;

function inPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface Floor {
  cls: Uint8Array;
  kind: string[]; // kind per cell, for materials and storefront glass
}

function rasterize(plan: Plan, floor: number): Floor {
  const cls = new Uint8Array(NX * NY);
  const kind = new Array<string>(NX * NY).fill("");
  const paint = (idx: number, k: string) => {
    kind[idx] = k;
    if (k === "void") cls[idx] = floor === 1 ? WALK : HOLE;
    else if (WALKABLE.has(k)) cls[idx] = WALK;
    else if (SOLID.has(k)) cls[idx] = SOLIDC;
    else cls[idx] = EMPTY;
  };
  // Same draw order as build_floorplans.py: polygons first, then boxes on top.
  for (const p of plan.polygons) {
    const xs = p.points.map((q) => q[0]);
    const ys = p.points.map((q) => q[1]);
    const i0 = Math.max(0, Math.floor(Math.min(...xs) / CELL));
    const i1 = Math.min(NX - 1, Math.ceil(Math.max(...xs) / CELL));
    const j0 = Math.max(0, Math.floor(Math.min(...ys) / CELL));
    const j1 = Math.min(NY - 1, Math.ceil(Math.max(...ys) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (inPoly((i + 0.5) * CELL, (j + 0.5) * CELL, p.points)) paint(j * NX + i, p.kind);
  }
  for (const b of plan.boxes) {
    const i0 = Math.round(b.x0 / CELL);
    const i1 = Math.round(b.x1 / CELL);
    const j0 = Math.round(b.y0 / CELL);
    const j1 = Math.round(b.y1 / CELL);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) paint(j * NX + i, b.kind);
  }
  return { cls, kind };
}

// ---- geometry accumulation -------------------------------------------------------------------

class Geo {
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
type V3 = [number, number, number];

const geos: Record<string, Geo> = {};
const geo = (name: string) => (geos[name] ??= new Geo());

// Horizontal quads (floors, ceilings, roof) over a run of cells in x.
function flatRun(name: string, i0: number, i1: number, j: number, y: number, up: boolean) {
  const x0 = i0 * CELL;
  const x1 = i1 * CELL;
  const zNear = -(j * CELL); // plan y = j*CELL
  const zFar = -((j + 1) * CELL);
  if (up) geo(name).quad([x0, y, zNear], [x1, y, zNear], [x1, y, zFar], [x0, y, zFar], [0, 1, 0]);
  else geo(name).quad([x0, y, zFar], [x1, y, zFar], [x1, y, zNear], [x0, y, zNear], [0, -1, 0]);
}

// ---- walls -----------------------------------------------------------------------------------

type Dir = "N" | "S" | "E" | "W";
interface Edge {
  dir: Dir; // side of the cell the wall sits on; the wall faces into the cell
  i: number;
  j: number;
  mat: "walls" | "glass" | "rails" | "elev";
  y0: number;
  h: number;
}

function wallRuns(edges: Edge[]) {
  const groups = new Map<string, Edge[]>();
  for (const e of edges) {
    const line = e.dir === "N" || e.dir === "S" ? e.j : e.i;
    const key = `${e.dir}|${line}|${e.mat}|${e.y0}|${e.h}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  for (const list of groups.values()) {
    const horizontal = list[0].dir === "N" || list[0].dir === "S";
    list.sort((a, b) => (horizontal ? a.i - b.i : a.j - b.j));
    let start = 0;
    for (let k = 1; k <= list.length; k++) {
      const prev = list[k - 1];
      const cur = list[k];
      const contiguous = cur && (horizontal ? cur.i === prev.i + 1 : cur.j === prev.j + 1);
      if (contiguous) continue;
      emitWall(list[start], prev, horizontal);
      start = k;
    }
  }
}

function emitWall(first: Edge, last: Edge, horizontal: boolean) {
  const { dir, mat, y0, h } = first;
  let pA: [number, number]; // plan coords of the two bottom endpoints
  let pB: [number, number];
  let n: V3;
  if (horizontal) {
    const planY = (dir === "N" ? first.j + 1 : first.j) * CELL;
    pA = [first.i * CELL, planY];
    pB = [(last.i + 1) * CELL, planY];
    n = dir === "N" ? [0, 0, 1] : [0, 0, -1]; // N-edge wall faces south (plan -y = three +z)
  } else {
    const planX = (dir === "E" ? first.i + 1 : first.i) * CELL;
    pA = [planX, first.j * CELL];
    pB = [planX, (last.j + 1) * CELL];
    n = dir === "E" ? [-1, 0, 0] : [1, 0, 0];
  }
  // Order endpoints so (B - A) = up x n, which gives counter-clockwise winding seen from n.
  const t: V3 = [n[2], 0, -n[0]]; // up(0,1,0) x n
  const a: V3 = [pA[0], y0, -pA[1]];
  const b: V3 = [pB[0], y0, -pB[1]];
  const dot = (b[0] - a[0]) * t[0] + (b[2] - a[2]) * t[2];
  const [s, e] = dot >= 0 ? [a, b] : [b, a];
  const top = y0 + h;
  geo(mat).quad(s, e, [e[0], top, e[2]], [s[0], top, s[2]], n);
}

// ---- build -----------------------------------------------------------------------------------

const DIRS: { d: Dir; di: number; dj: number }[] = [
  { d: "N", di: 0, dj: 1 },
  { d: "S", di: 0, dj: -1 },
  { d: "E", di: 1, dj: 0 },
  { d: "W", di: -1, dj: 0 },
];

const plans: Plan[] = [1, 2, 3].map((n) => JSON.parse(readFileSync(`${PLANS}/floor${n}_plan.json`, "utf8")));
const floors: Floor[] = plans.map((p, i) => rasterize(p, i + 1));

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
const TOWERS = [
  { id: "a_stairs", hall: "S" },
  { id: "b_stairs", hall: "N" },
].map((t) => ({ ...t, box: plans[0].boxes.find((b) => b.id === t.id)! }));
type Tower = (typeof TOWERS)[number];
const ST = { lane: 3, strip: 1.5, depth: 6, nose: 3, tread: 0.06, slab: 0.35 };
const isZone = (k: string) => k === "stairzone" || k === "stair_landing";
/** Tower frame to a three.js point: u toward the atrium from the hall end, v east, h up. */
const towerPt = (t: Tower, u: number, v: number, h: number): V3 => [t.box.x0 + v, h, -(t.hall === "S" ? t.box.y0 + u : t.box.y1 - u)];
for (const f of floors)
  for (const t of TOWERS)
    for (let j = Math.round(t.box.y0 / CELL); j < Math.round(t.box.y1 / CELL); j++)
      for (let i = Math.round(t.box.x0 / CELL); i < Math.round((t.box.x0 + 2 * ST.lane) / CELL); i++) {
        const yc = (j + 0.5) * CELL;
        const u = t.hall === "S" ? yc - t.box.y0 : t.box.y1 - yc;
        f.cls[j * NX + i] = WALK;
        f.kind[j * NX + i] = u < ST.strip ? "stair_landing" : "stairzone";
      }

const at = (f: Floor, i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? EMPTY : f.cls[j * NX + i]);
const kindAt = (f: Floor, i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? "" : f.kind[j * NX + i]);

/** Empty cells connected to the edge of the grid: the outside of the building. Enclosed gaps are not outside. */
function outsideMask(f: Floor): Uint8Array {
  const out = new Uint8Array(NX * NY);
  const stack: number[] = [];
  for (let i = 0; i < NX; i++) stack.push(i, (NY - 1) * NX + i);
  for (let j = 0; j < NY; j++) stack.push(j * NX, j * NX + NX - 1);
  while (stack.length) {
    const c = stack.pop()!;
    if (out[c] || f.cls[c] !== EMPTY) continue;
    out[c] = 1;
    const i = c % NX;
    if (i > 0) stack.push(c - 1);
    if (i < NX - 1) stack.push(c + 1);
    if (c >= NX) stack.push(c - NX);
    if (c < (NY - 1) * NX) stack.push(c + NX);
  }
  return out;
}

const stats = { walkable: [0, 0, 0] };

// Floor 3: the halls and bridges around the atriums have no dropped ceiling; they open up to the roof truss.
const OPEN_X = [45, 84];
const OPEN_Y = [45, 165];
const isOpenCeiling = (f: Floor, fi: number, i: number, j: number) => {
  if (fi !== 2 || at(f, i, j) !== WALK || kindAt(f, i, j) !== "hall") return false;
  const x = (i + 0.5) * CELL;
  const y = (j + 0.5) * CELL;
  return x >= OPEN_X[0] && x < OPEN_X[1] && y >= OPEN_Y[0] && y < OPEN_Y[1];
};

floors.forEach((f, fi) => {
  const floorNo = fi + 1;
  const y0 = fi * FLOOR_H;
  const edges: Edge[] = [];
  const outside = outsideMask(f);
  const isOutside = (i: number, j: number) => i < 0 || j < 0 || i >= NX || j >= NY || outside[j * NX + i] === 1;

  for (let j = 0; j < NY; j++) {
    // floors and ceilings, merged along x
    let runStart = -1;
    let runMat = "";
    let runOpen = false;
    const flush = (end: number) => {
      if (runStart >= 0) {
        flatRun(runMat, runStart, end, j, y0, true);
        if (runMat !== "floor_atrium" && !runOpen) flatRun("ceilings", runStart, end, j, y0 + CEIL_H, false);
      }
      runStart = -1;
    };
    for (let i = 0; i <= NX; i++) {
      const c = i < NX ? f.cls[j * NX + i] : EMPTY;
      let mat = "";
      if (c === WALK) {
        const k = f.kind[j * NX + i];
        mat = k === "void" ? "floor_atrium" : k === "bath" ? "floor_bath" : k === "garage" ? "floor_garage" : "floors";
        if (k === "stairzone" && fi > 0) mat = ""; // open volume: floor only at the base, where the garden is
        stats.walkable[fi]++;
      }
      const open = mat !== "" && (isOpenCeiling(f, fi, i, j) || (i < NX && f.kind[j * NX + i] === "stairzone"));
      if (mat !== runMat || open !== runOpen || mat === "") {
        flush(i);
        if (mat) runStart = i;
        runMat = mat;
        runOpen = open;
      }
    }

    for (let i = 0; i < NX; i++) {
      const c = f.cls[j * NX + i];
      if (c !== WALK && c !== HOLE) continue;
      const k = f.kind[j * NX + i];
      const nearVoid = (k === "void");
      const open = isOpenCeiling(f, fi, i, j);
      for (const { d, di, dj } of DIRS) {
        const nc = at(f, i + di, j + dj);
        const nk = kindAt(f, i + di, j + dj);
        if (c === WALK) {
          const zone = isZone(k);
          const lintel = () => {
            // lintel where an open-ceiling hall meets a room that keeps its dropped ceiling
            if (open && !isOpenCeiling(f, fi, i + di, j + dj) && nk !== "void")
              edges.push({ dir: d, i, j, mat: "walls", y0: y0 + CEIL_H, h: ROOF_Y - y0 - CEIL_H });
          };
          if (nc === WALK) {
            if (!zone && isZone(nk)) {
              // A hall (or the atrium floor) beside a stair tower. The hall-end landing is a doorway on
              // every floor; along the flights it is glass rail (the base is open, see the garden).
              // From the atrium floor the flights are walked around, not entered (their sides block).
              if (nk === "stair_landing" || k === "void") lintel();
              else {
                edges.push({ dir: d, i, j, mat: "rails", y0, h: RAIL_H });
                // Floor 3: the flights go on up to the sealed floor 4 landing; the open-ceiling hall is walled off above it.
                if (floorNo === 3 && open) edges.push({ dir: d, i, j, mat: "walls", y0: y0 + FLOOR_H, h: ROOF_Y - y0 - FLOOR_H });
              }
            } else lintel();
            continue;
          }
          // A tower is one tall room, no slab between floors; on floor 3 it goes on up to the sealed floor 4 (y 15 to 18.5).
          const towerH = floorNo === 3 ? FLOOR_H + CEIL_H : FLOOR_H;
          const wallH = k === "stairzone" || (k === "stair_landing" && floorNo === 3) ? towerH : nearVoid ? FLOOR_H : open ? ROOF_Y - y0 : CEIL_H;
          if (nc === HOLE) edges.push({ dir: d, i, j, mat: "rails", y0, h: RAIL_H });
          else if (k === "garage" && nc === EMPTY) edges.push({ dir: d, i, j, mat: "rails", y0, h: RAIL_H });
          else if (nc === EMPTY && isOutside(i + di, j + dj)) edges.push({ dir: d, i, j, mat: "glass", y0, h: wallH });
          else if (nk === "restaurant") edges.push({ dir: d, i, j, mat: "glass", y0, h: wallH });
          else edges.push({ dir: d, i, j, mat: nk === "elevator" ? "elev" : "walls", y0, h: wallH });
        } else {
          // HOLE cell: walls face into the atrium from solid or outside neighbours, full floor height
          // (the top floor continues up to the truss roof).
          if (nc === HOLE || nc === WALK) continue;
          const h = floorNo === 3 ? ROOF_Y - y0 : FLOOR_H;
          const glass = nc === EMPTY && isOutside(i + di, j + dj);
          edges.push({ dir: d, i, j, mat: glass ? "glass" : nk === "elevator" ? "elev" : "walls", y0, h });
        }
      }
    }
  }
  wallRuns(edges);

  // Stair towers are open up through the floors. On floor 3 they go on to a sealed floor 4 landing (a slab
  // at y 15 over the hall-end strip) and are capped at 18.5, leaving room for an expansion.
  if (floorNo === 3)
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const k = f.kind[j * NX + i];
        if (k === "stairzone" || k === "stair_landing") flatRun("ceilings", i, i + 1, j, y0 + FLOOR_H + CEIL_H, false);
        if (k === "stair_landing") flatRun("floors", i, i + 1, j, y0 + FLOOR_H, true);
      }

  // Roof over the atriums and the open-ceiling halls (top floor).
  if (floorNo === 3) {
    for (let j = 0; j < NY; j++) {
      let start = -1;
      for (let i = 0; i <= NX; i++) {
        const hole = i < NX && (f.cls[j * NX + i] === HOLE || isOpenCeiling(f, fi, i, j));
        if (hole && start < 0) start = i;
        if (!hole && start >= 0) {
          flatRun("roof", start, i, j, ROOF_Y, false);
          start = -1;
        }
      }
    }
  }
});

// Flights. Ground-floor flights are solid down to the floor (the space under them is closed); the
// upper flights are thin steps hovering over them. Treads are boxes, rails are glass quads.
function addTo(target: Geo, g: Geo) {
  const base = target.pos.length / 3;
  target.pos.push(...g.pos);
  target.nrm.push(...g.nrm);
  for (const k of g.idx) target.idx.push(base + k);
}

/** Convex polygon (x, z points) extruded from y0 up to y1. */
function slabGeo(pts: [number, number][], y0: number, y1: number, sides?: Geo, bottom = true): Geo {
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
function prismGeo(p: V3[]): Geo {
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
function latheGeo(cx: number, cz: number, profile: [number, number][], seg: number): Geo {
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
function sweepGeo(outline: [number, number][], profile: [number, number][]): Geo {
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

/** A faceted rock: the top half of a roughened ellipsoid, flat-shaded like a low-poly boulder. */
function rockGeo(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rnd: () => number): Geo {
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

type Rail = (u0: number, v0: number, h0: number, u1: number, v1: number, h1: number) => void;

/**
 * The garden at the foot of the stairs (see the photos): rounded beds of river-stone gravel with rocks and
 * leafy plants under the flights, behind a glass fence, and a round planter drum under the lower round
 * landing. Leaves are curved tapering ribbons; the gravel is a shader pattern (see materials.ts).
 */
function garden(t: Tower, P: (u: number, v: number, h: number) => V3, rail: Rail) {
  let seed = t.hall === "S" ? 7 : 19;
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
  const rail = (u0: number, v0: number, h0: number, u1: number, v1: number, h1: number) => {
    const a = P(u0, v0, h0);
    const b = P(u1, v1, h1);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const n: V3 = [(b[2] - a[2]) / len, 0, -(b[0] - a[0]) / len];
    rails.quad(a, b, [b[0], b[1] + RAIL_H, b[2]], [a[0], a[1] + RAIL_H, a[2]], n);
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
    for (const v of [v0 + 0.04, v1 - 0.04]) rail(uS, v, hS + rise, uE, v, hE);
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
  for (let fi = 0; fi < 3; fi++) {
    const base = fi * FLOOR_H;
    flight(0, ST.strip, base, ST.depth, base + FLOOR_H / 2, 15);
    round(0, base + FLOOR_H / 2);
    flight(1, ST.depth, base + FLOOR_H / 2, ST.strip, base + FLOOR_H, 15);
  }
  // Only the west lane (the flight going up) is closed; the east lane is where the flight from floor 2 arrives.
  // It stands just on the hall side of the flight's first tread and stringer, and 2 cm in from the lane edges, so no face shares a plane with them (z-fighting).
  box(ST.strip - 0.12, ST.strip, 0.02, ST.lane - 0.02, 2 * FLOOR_H, 2 * FLOOR_H + CEIL_H, geo("steel"));
  garden(t, P, rail);
  // Big grey column through the round landings, at their west corner (photos: stairs_northern-tower).
  const col = P(ST.depth + 0.3, -0.3, 0);
  addTo(geo("column"), latheGeo(col[0], col[2], [[0.37, 0], [0.37, 0.14], [0.3, 0.17], [0.3, 3 * FLOOR_H - 0.2], [0.37, 3 * FLOOR_H - 0.15], [0.37, 3 * FLOOR_H]], 24));
}

// Elevator shafts: dark glass faces (the "elev" material, set where the walls are built) with grey piers
// between and beside the two shafts, as in the photos. The piers stand just in front of the atrium face.
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

// Spawn points used by src/engine/runtime.ts must be walkable cells.
for (const [fi, x, y] of [[0, 72, 28], [1, 48, 100], [2, 48, 100]] as const) {
  const i = Math.floor(x / CELL);
  const j = Math.floor(y / CELL);
  const ok = at(floors[fi], i, j) === WALK;
  console.log(`spawn floor ${fi + 1} (${x}, ${y}): ${kindAt(floors[fi], i, j) || "empty"}${ok ? "" : "  <-- NOT WALKABLE"}`);
  if (!ok) process.exitCode = 1;
}

// Debug: BLOCKOUT_DEBUG=<dir> writes one PPM per floor. White = reachable from the spawn,
// yellow = blocked by collision, red = walkable but unreachable, gray = solid, blue = hole, black = empty.
if (process.env.BLOCKOUT_DEBUG) {
  const spawns = [[72, 28], [48, 100], [48, 100]];
  const colliderGeo = new THREE.BufferGeometry();
  const cp: number[] = [];
  const ci: number[] = [];
  for (const name of COLLIDERS) {
    const g = geos[name];
    if (!g) continue;
    const base = cp.length / 3;
    cp.push(...g.pos);
    for (const k of g.idx) ci.push(base + k);
  }
  colliderGeo.setAttribute("position", new THREE.Float32BufferAttribute(cp, 3));
  colliderGeo.setIndex(ci);
  const bvh = new MeshBVH(colliderGeo);
  const sph = new THREE.Sphere();
  const closest = new THREE.Vector3();
  floors.forEach((f, fi) => {
    const blocked = new Uint8Array(NX * NY);
    for (let c = 0; c < NX * NY; c++) {
      if (f.cls[c] !== WALK) continue;
      const i = c % NX;
      const j = (c - i) / NX;
      sph.center.set((i + 0.5) * CELL, fi * FLOOR_H + 1.0, -(j + 0.5) * CELL);
      sph.radius = 0.35;
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(sph),
        intersectsTriangle: (tri) => {
          tri.closestPointToPoint(sph.center, closest);
          if (closest.distanceTo(sph.center) < 0.35) blocked[c] = 1;
          return blocked[c] === 1;
        },
      });
    }
    const seen = new Uint8Array(NX * NY);
    const stack = [Math.floor(spawns[fi][1] / CELL) * NX + Math.floor(spawns[fi][0] / CELL)];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen[c] || f.cls[c] !== WALK || blocked[c]) continue;
      seen[c] = 1;
      const i = c % NX;
      const j = (c - i) / NX;
      if (i > 0) stack.push(c - 1);
      if (i < NX - 1) stack.push(c + 1);
      if (j > 0) stack.push(c - NX);
      if (j < NY - 1) stack.push(c + NX);
    }
    const px = Buffer.alloc(NX * NY * 3);
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const c = f.cls[j * NX + i];
        const rgb = c === WALK ? (seen[j * NX + i] ? [255, 255, 255] : blocked[j * NX + i] ? [240, 200, 0] : [230, 40, 40]) : c === SOLIDC ? [120, 120, 120] : c === HOLE ? [60, 90, 200] : [0, 0, 0];
        px.set(rgb, ((NY - 1 - j) * NX + i) * 3);
      }
    writeFileSync(`${process.env.BLOCKOUT_DEBUG}/floor${fi + 1}.ppm`, Buffer.concat([Buffer.from(`P6 ${NX} ${NY} 255\n`), px]));
  });
}

// ---- secret-hallway doors ------------------------------------------------------------------------
// Double doors from docs/floorplans/secret_doors.json. Each door is a root node ("door_<id>", extras
// carry its placement) with one pivot node per leaf ("door_<id>_a/_b", extras.sign = which way +angle
// swings it). src/engine/doors.ts animates the pivots. A lintel above the leaves goes into "walls".

const DOOR_T = 0.06; // leaf thickness
const SWING: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }; // (x, z) in three.js coords

interface DoorDef { id: string; floor: number; x: number; y: number; axis: "x" | "y"; width: number; swing: string; leadsTo?: string }
const doorData = JSON.parse(readFileSync(`${PLANS}/secret_doors.json`, "utf8")) as { height: number; doors: DoorDef[] };

/** Box with six quads, wound to face outward. */
function boxGeo(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo {
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
function facedQuad(g: Geo, a: V3, b: V3, c: V3, d: V3, n: V3) {
  const cross = [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ];
  if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0) g.quad(a, b, c, d, n);
  else g.quad(a, d, c, b, n);
}

const doorNodes = doorData.doors.map((d) => {
  const fi = d.floor - 1;
  const half = d.width / 2;
  const [sx, sz] = SWING[d.swing];
  const y0 = fi * FLOOR_H;
  // The door line must sit on walkable cells on both sides, or it is in the wrong place.
  const along = d.axis === "x" ? [1, 0] : [0, 1];
  const across = d.axis === "x" ? [0, 1] : [1, 0];
  for (const off of [-half + CELL / 2, 0, half - CELL / 2])
    for (const side of [-CELL, CELL]) {
      const px = d.x + along[0] * off + across[0] * side;
      const py = d.y + along[1] * off + across[1] * side;
      if (at(floors[fi], Math.floor(px / CELL), Math.floor(py / CELL)) !== WALK)
        console.warn(`door ${d.id}: (${px}, ${py}) is not walkable; check its position`);
    }

  // Lintel: closes the gap between the leaves and the dropped ceiling.
  // Same thickness as the leaves, so their faces are flush and the closed door shows no step or seam.
  const lx = d.axis === "x" ? half : DOOR_T / 2;
  const lz = d.axis === "x" ? DOOR_T / 2 : half;
  const lintel = boxGeo(d.x - lx, d.x + lx, y0 + doorData.height, y0 + CEIL_H, -d.y - lz, -d.y + lz);
  const wg = geo("walls");
  const base = wg.pos.length / 3;
  wg.pos.push(...lintel.pos);
  wg.nrm.push(...lintel.nrm);
  for (const k of lintel.idx) wg.idx.push(base + k);

  return { d, y0, half, sx, sz };
});

// ---- write GLB ---------------------------------------------------------------------------------

/** sRGB hex to the linear factors glTF expects. */
const hex = (h: string, alpha = 1): [number, number, number, number] => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const n = parseInt(h.slice(1), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255), alpha];
};

// Base colors are the surfaces' own colors from docs/art_style_reference.md (muted, as photographed), not
// the night: darkness comes from the lighting. Surface detail (tiles, plaster, panels) is added at run time
// by src/engine/materials.ts, keyed by these material names.
const MATERIALS: Record<string, { color: [number, number, number, number]; rough: number; blend?: boolean; double?: boolean }> = {
  floors: { color: hex("#b4b1a8"), rough: 0.3 }, // glossy off-white porcelain
  floor_atrium: { color: hex("#aaa79e"), rough: 0.3 },
  floor_bath: { color: hex("#7f8a88"), rough: 0.35 },
  floor_garage: { color: hex("#817c77"), rough: 0.95 }, // patched concrete
  ceilings: { color: hex("#9a9890"), rough: 0.9 },
  roof: { color: hex("#797872"), rough: 0.8 }, // painted steel truss
  walls: { color: hex("#a8a59c"), rough: 0.92 }, // near-white plaster, slightly warm
  glass: { color: [0.5, 0.65, 0.8, 0.22], rough: 0.05, blend: true },
  rails: { color: [0.5, 0.65, 0.8, 0.28], rough: 0.05, blend: true },
  stairs: { color: hex("#aca8a3"), rough: 0.7 },
  steel: { color: hex("#1d1d21"), rough: 0.45 },
  fascia: { color: hex("#5b565a"), rough: 0.7 },
  lamp: { color: hex("#c9c9c2"), rough: 0.6 },
  column: { color: hex("#656363"), rough: 0.6 }, // painted mid-grey
  elev: { color: hex("#1b1a1a"), rough: 0.2 }, // black glass shafts
  garden: { color: hex("#3c5b34"), rough: 0.8, double: true }, // leaves are one-sided ribbons
  garden_dark: { color: hex("#223f27"), rough: 0.8, double: true },
  stone: { color: hex("#555759"), rough: 0.9 }, // boulders
  planter: { color: hex("#8d887e"), rough: 0.85 }, // concrete planters
  gravel: { color: hex("#837d72"), rough: 0.9 }, // river-stone beds (pattern added in materials.ts)
};

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("mall_blockout");
let triangles = 0;
for (const [name, g] of Object.entries(geos)) {
  const m = MATERIALS[name];
  const mat = doc
    .createMaterial(name)
    .setBaseColorFactor(m.color)
    .setRoughnessFactor(m.rough)
    .setMetallicFactor(0)
    .setDoubleSided(!!m.blend || !!m.double)
    .setAlphaMode(m.blend ? "BLEND" : "OPAQUE");
  const prim = doc
    .createPrimitive()
    .setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buffer))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nrm)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(g.idx)).setBuffer(buffer));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
  triangles += g.idx.length / 3;
}

// Secret doors: same material as the walls, so a closed door disappears into them.
const doorMat = doc.createMaterial("doors").setBaseColorFactor(MATERIALS.walls.color).setRoughnessFactor(MATERIALS.walls.rough).setMetallicFactor(0);
for (const { d, y0, half, sx, sz } of doorNodes) {
  const root = doc
    .createNode(`door_${d.id}`)
    .setTranslation([d.x, y0, -d.y])
    .setExtras({ door: d.id, floor: d.floor - 1, axis: d.axis, width: d.width, ...(d.leadsTo ? { leadsTo: d.leadsTo } : {}) });
  // Leaf a hinges at the low end of the door line, leaf b at the high end; each reaches the centre.
  const leaves = d.axis === "x"
    ? [{ tag: "a", pivot: [-half, 0, 0], dir: [1, 0] }, { tag: "b", pivot: [half, 0, 0], dir: [-1, 0] }]
    : [{ tag: "a", pivot: [0, 0, half], dir: [0, -1] }, { tag: "b", pivot: [0, 0, -half], dir: [0, 1] }];
  for (const leaf of leaves) {
    // At +90 degrees about y a leaf pointing along (dx, dz) ends up pointing along (dz, -dx).
    const sign = leaf.dir[1] * sx - leaf.dir[0] * sz > 0 ? 1 : -1;
    const len = half; // leaves meet exactly at the centre: no slit
    const [ax0, ax1] = [Math.min(0, leaf.dir[0] * len), Math.max(0, leaf.dir[0] * len)];
    const [az0, az1] = [Math.min(0, leaf.dir[1] * len), Math.max(0, leaf.dir[1] * len)];
    const box = d.axis === "x"
      ? boxGeo(ax0, ax1, 0, doorData.height, -DOOR_T / 2, DOOR_T / 2)
      : boxGeo(-DOOR_T / 2, DOOR_T / 2, 0, doorData.height, az0, az1);
    const prim = doc
      .createPrimitive()
      .setMaterial(doorMat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(box.pos)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(box.nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(box.idx)).setBuffer(buffer));
    const pivot = doc
      .createNode(`door_${d.id}_${leaf.tag}`)
      .setTranslation(leaf.pivot as [number, number, number])
      .setMesh(doc.createMesh(`door_${d.id}_${leaf.tag}`).addPrimitive(prim))
      .setExtras({ leaf: true, sign });
    root.addChild(pivot);
    triangles += box.idx.length / 3;
  }
  scene.addChild(root);
}

mkdirSync("public/models", { recursive: true });
const bytes = await new NodeIO().writeBinary(doc);
writeFileSync(OUT, bytes);
console.log(`wrote ${OUT}: ${(bytes.byteLength / 1024).toFixed(0)} KB, ${triangles} triangles`);
console.log("walkable cells per floor:", stats.walkable.join(", "));
