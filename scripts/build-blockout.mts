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

const footprint: [number, number][] = JSON.parse(readFileSync(`${PLANS}/footprint_osm.json`, "utf8")).points;

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
  mat: "walls" | "glass" | "rails";
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

const floors: Floor[] = [1, 2, 3].map((n) => rasterize(JSON.parse(readFileSync(`${PLANS}/floor${n}_plan.json`, "utf8")), n));

const at = (f: Floor, i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? EMPTY : f.cls[j * NX + i]);
const kindAt = (f: Floor, i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? "" : f.kind[j * NX + i]);
const outsideFootprint = (i: number, j: number, di: number, dj: number) =>
  !inPoly((i + 0.5 + di) * CELL, (j + 0.5 + dj) * CELL, footprint);

const stats = { walkable: [0, 0, 0] };

floors.forEach((f, fi) => {
  const floorNo = fi + 1;
  const y0 = fi * FLOOR_H;
  const edges: Edge[] = [];

  for (let j = 0; j < NY; j++) {
    // floors and ceilings, merged along x
    let runStart = -1;
    let runMat = "";
    const flush = (end: number) => {
      if (runStart >= 0) {
        flatRun(runMat, runStart, end, j, y0, true);
        if (runMat !== "floor_atrium") flatRun("ceilings", runStart, end, j, y0 + CEIL_H, false);
      }
      runStart = -1;
    };
    for (let i = 0; i <= NX; i++) {
      const c = i < NX ? f.cls[j * NX + i] : EMPTY;
      let mat = "";
      if (c === WALK) {
        const k = f.kind[j * NX + i];
        mat = k === "void" ? "floor_atrium" : k === "bath" ? "floor_bath" : k === "garage" ? "floor_garage" : "floors";
        stats.walkable[fi]++;
      }
      if (mat !== runMat || mat === "") {
        flush(i);
        if (mat) runStart = i;
        runMat = mat;
      }
    }

    for (let i = 0; i < NX; i++) {
      const c = f.cls[j * NX + i];
      if (c !== WALK && c !== HOLE) continue;
      const k = f.kind[j * NX + i];
      const nearVoid = (k === "void");
      for (const { d, di, dj } of DIRS) {
        const nc = at(f, i + di, j + dj);
        const nk = kindAt(f, i + di, j + dj);
        if (c === WALK) {
          if (nc === WALK) continue;
          const wallH = nearVoid ? FLOOR_H : CEIL_H;
          if (nc === HOLE) edges.push({ dir: d, i, j, mat: "rails", y0, h: RAIL_H });
          else if (k === "garage" && nc === EMPTY) edges.push({ dir: d, i, j, mat: "rails", y0, h: RAIL_H });
          else if (nc === EMPTY && outsideFootprint(i, j, di, dj)) edges.push({ dir: d, i, j, mat: "glass", y0, h: wallH });
          else if (nk === "restaurant") edges.push({ dir: d, i, j, mat: "glass", y0, h: wallH });
          else edges.push({ dir: d, i, j, mat: "walls", y0, h: wallH });
        } else {
          // HOLE cell: walls face into the atrium from solid or outside neighbours, full floor height
          // (the top floor continues up to the truss roof).
          if (nc === HOLE || nc === WALK) continue;
          const h = floorNo === 3 ? ROOF_Y - y0 : FLOOR_H;
          const glass = nc === EMPTY && outsideFootprint(i, j, di, dj);
          edges.push({ dir: d, i, j, mat: glass ? "glass" : "walls", y0, h });
        }
      }
    }
  }
  wallRuns(edges);

  // Roof over the atriums (hole cells of the top floor).
  if (floorNo === 3) {
    for (let j = 0; j < NY; j++) {
      let start = -1;
      for (let i = 0; i <= NX; i++) {
        const hole = i < NX && f.cls[j * NX + i] === HOLE;
        if (hole && start < 0) start = i;
        if (!hole && start >= 0) {
          flatRun("roof", start, i, j, ROOF_Y, false);
          start = -1;
        }
      }
    }
  }
});

// Spawn points used by src/engine/runtime.ts must be walkable cells.
for (const [fi, x, y] of [[0, 80, 28], [1, 48, 100], [2, 48, 100]] as const) {
  const i = Math.floor(x / CELL);
  const j = Math.floor(y / CELL);
  const ok = at(floors[fi], i, j) === WALK;
  console.log(`spawn floor ${fi + 1} (${x}, ${y}): ${kindAt(floors[fi], i, j) || "empty"}${ok ? "" : "  <-- NOT WALKABLE"}`);
  if (!ok) process.exitCode = 1;
}

// Debug: BLOCKOUT_DEBUG=<dir> writes one PPM per floor. White = reachable from the spawn,
// yellow = blocked by collision, red = walkable but unreachable, gray = solid, blue = hole, black = empty.
if (process.env.BLOCKOUT_DEBUG) {
  const spawns = [[80, 28], [48, 100], [48, 100]];
  const colliderGeo = new THREE.BufferGeometry();
  const cp: number[] = [];
  const ci: number[] = [];
  for (const name of ["walls", "glass", "rails"]) {
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

// ---- write GLB ---------------------------------------------------------------------------------

const MATERIALS: Record<string, { color: [number, number, number, number]; rough: number; blend?: boolean }> = {
  floors: { color: [0.42, 0.42, 0.44, 1], rough: 0.9 },
  floor_atrium: { color: [0.46, 0.43, 0.4, 1], rough: 0.9 },
  floor_bath: { color: [0.4, 0.5, 0.45, 1], rough: 0.7 },
  floor_garage: { color: [0.33, 0.33, 0.36, 1], rough: 1 },
  ceilings: { color: [0.3, 0.3, 0.33, 1], rough: 1 },
  roof: { color: [0.22, 0.22, 0.25, 1], rough: 1 },
  walls: { color: [0.55, 0.53, 0.5, 1], rough: 0.95 },
  glass: { color: [0.5, 0.65, 0.8, 0.25], rough: 0.1, blend: true },
  rails: { color: [0.5, 0.65, 0.8, 0.3], rough: 0.1, blend: true },
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
    .setDoubleSided(!!m.blend)
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

mkdirSync("public/models", { recursive: true });
const bytes = await new NodeIO().writeBinary(doc);
writeFileSync(OUT, bytes);
console.log(`wrote ${OUT}: ${(bytes.byteLength / 1024).toFixed(0)} KB, ${triangles} triangles`);
console.log("walkable cells per floor:", stats.walkable.join(", "));
