// Builds the kit piece files and the placement list the game reads.
// Run: npm run props   (writes public/models/kit/<piece>.glb and public/models/props.json)
//
// Each piece file holds the piece (one node per material), its far version (the same materials, nodes named
// "<material>_far", see scripts/kit/lod.mts) and a "collider" node. src/engine/props.ts picks near or far per
// instance by distance; a file without "_far" nodes is drawn near at every distance.
//
// docs/floorplans/props.json says where pieces go; this checks each instance against the floor grid (it must
// stand on open floor with the aisle the rule asks for, away from secret doors) and bakes the survivors into
// public/models/props.json as flat arrays of [x, y, z, yaw] per piece, with y = the floor's height.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { PLANS, CELL, FLOOR_H, WALK, SOLIDC } from "./blockout/config.mts";
import { floors, plans, at, kindAt, inPoly } from "./blockout/grid.mts";
import { paintGrid } from "./blockout/paint.mts";
import { isZone } from "./blockout/towers.mts";
import { makeMaterial } from "./blockout/write.mts";
import { boxGeo, type Geo } from "./blockout/geo.mts";
import { PIECES } from "./kit/pieces.mts";
import { bakeWear, refine } from "./kit/wear.mts";
import { simplified } from "./kit/lod.mts";

const OUT_DIR = "public/models";
const KIT_DIR = `${OUT_DIR}/kit`;
const REFINE = 0.3; // longest edge on a kit piece before the wear bake (meters)
// The far version's error (meters). Keep in step with LOD distances in src/engine/quality.ts: 1 cm is under a
// pixel past about 8 m at 720p.
const FAR_ERROR = 0.01;

type Scatter = { piece: string; floors: number[]; area?: string; box?: [number, number, number, number]; spacing: [number, number]; jitter?: number; turn?: number; skip?: number; aisle?: number; seed: number; wall?: boolean; max?: number; kinds?: string[] };
type Place = { piece: string; floor: number; x: number; y: number; rot?: number; aisle?: number };
const data = JSON.parse(readFileSync(`${PLANS}/props.json`, "utf8")) as { scatter: Scatter[]; place: Place[] };
const doors = (JSON.parse(readFileSync(`${PLANS}/secret_doors.json`, "utf8")) as { doors: { floor: number; x: number; y: number }[] }).doors;

paintGrid(); // the grid the mall is built from, before anything is placed

// ---- the pieces -------------------------------------------------------------------------------------
mkdirSync(KIT_DIR, { recursive: true });
await MeshoptEncoder.ready;
const pieces = Object.fromEntries(Object.entries(PIECES).map(([name, make]) => [name, make()]));
for (const [name, piece] of Object.entries(pieces)) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const materials = new Map<string, ReturnType<typeof makeMaterial>>(); // near and far share one per material
  const add = (nodeName: string, material: string, g: Geo, wear?: number[]) => {
    if (!materials.has(material)) materials.set(material, makeMaterial(doc, material));
    const prim = doc
      .createPrimitive()
      .setMaterial(materials.get(material)!)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(g.idx)).setBuffer(buffer));
    if (wear) prim.setAttribute("_WEAR", doc.createAccessor().setType("VEC3").setArray(new Float32Array(wear)).setBuffer(buffer));
    if (g.uv) {
      const uv = g.uv.slice(0, (g.pos.length / 3) * 2);
      while (uv.length < (g.pos.length / 3) * 2) uv.push(0);
      prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer));
    }
    scene.addChild(doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim)));
  };
  // Long edges split so the baked wear (scripts/kit/wear.mts) has points to sit on, then the wear itself.
  const names = Object.keys(piece.parts);
  const parts = names.map((m) => refine(piece.parts[m], REFINE));
  const wear = bakeWear(parts, piece.wall ? -piece.collider.hx : undefined);
  names.forEach((m, k) => {
    piece.parts[m] = parts[k];
    add(m, m, parts[k], wear[k]);
  });
  let farTris = 0;
  for (const [k, m] of names.entries()) {
    const far = await simplified(parts[k], wear[k], FAR_ERROR);
    if (!far) continue; // the whole part is smaller than the error: the far version leaves it out
    add(`${m}_far`, m, far.g, far.wear);
    farTris += far.g.idx.length / 3;
  }
  const { hx, hz, h } = piece.collider;
  add("collider", "barrier", boxGeo(-hx, hx, 0, h, -hz, hz)); // the runtime keeps it for collision and never draws it
  // Vertices are shared between neighbouring quads (the generators emit four per quad), then meshopt-compressed
  // like the mall: the runtime reads the positions back as plain floats for the colliders.
  await doc.transform(weld());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const bytes = await new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.encoder": MeshoptEncoder }).writeBinary(doc);
  writeFileSync(`${KIT_DIR}/${name}.glb`, bytes);
  const tris = Object.values(piece.parts).reduce((t, g) => t + g.idx.length / 3, 0);
  console.log(`kit ${name}: ${(bytes.byteLength / 1024).toFixed(1)} KB, ${tris} triangles, far ${farTris}`);
}

// ---- placement --------------------------------------------------------------------------------------
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0; // mulberry32
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const instances: Record<string, number[]> = {};
const counts: Record<string, { placed: number; dropped: Record<string, number> }> = {};
const placed: { floor: number; x: number; y: number; radius: number }[] = [];
/** `toWall` is the plan direction of the wall behind a wall piece: cells on or past its back plane are not checked. */
function tryPlace(name: string, floor: number, x: number, y: number, rotDeg: number, aisle: number, toWall?: [number, number]): boolean {
  const tally = (counts[`${name} floor ${floor}`] ??= { placed: 0, dropped: {} });
  const drop = (why: string) => {
    tally.dropped[why] = (tally.dropped[why] ?? 0) + 1;
    return false;
  };
  const piece = pieces[name];
  if (!piece) throw new Error(`props.json: unknown piece "${name}" (known: ${Object.keys(pieces).join(", ")})`);
  const f = floors[floor - 1];
  const r = piece.radius + aisle;
  for (let j = Math.floor((y - r) / CELL); j <= Math.ceil((y + r) / CELL); j++)
    for (let i = Math.floor((x - r) / CELL); i <= Math.ceil((x + r) / CELL); i++) {
      const cx = (i + 0.5) * CELL;
      const cy = (j + 0.5) * CELL;
      if (Math.hypot(cx - x, cy - y) > r) continue;
      if (toWall && (cx - x) * toWall[0] + (cy - y) * toWall[1] > piece.collider.hx - 0.05) continue; // the wall itself
      if (at(f, i, j) !== WALK) return drop("not clear floor");
      if (isZone(kindAt(f, i, j))) return drop("near a stair");
    }
  if (doors.some((d) => d.floor === floor && Math.hypot(d.x - x, d.y - y) < 3)) return drop("near a secret door");
  if (placed.some((o) => o.floor === floor && Math.hypot(o.x - x, o.y - y) < o.radius + piece.radius)) return drop("on another piece");
  placed.push({ floor, x, y, radius: piece.radius });
  (instances[name] ??= []).push(+x.toFixed(3), (floor - 1) * FLOOR_H, +(-y).toFixed(3), +((rotDeg * Math.PI) / 180).toFixed(4)); // z = -y
  tally.placed++;
  return true;
}

const WALLS_NOT_FOR_PIECES = new Set(["elevator", "escalator", "intermittent", "machines", "stairs"]);
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A wall rule: pieces stand against walls, picked from the open floor along them in a seeded random order. */
function placeAlongWalls(rule: Scatter, next: () => number, floor: number, [x0, y0, x1, y1]: [number, number, number, number], poly: { x: number; y: number }[] | undefined) {
  const piece = pieces[rule.piece];
  if (!piece?.wall) throw new Error(`props.json: "${rule.piece}" is not a wall piece`);
  const f = floors[floor - 1];
  const kinds = new Set(rule.kinds ?? ["hall", "foodcourt"]);
  const candidates: { x: number; y: number; w: [number, number] }[] = [];
  for (let j = Math.floor(y0 / CELL); j < Math.ceil(y1 / CELL); j++)
    for (let i = Math.floor(x0 / CELL); i < Math.ceil(x1 / CELL); i++) {
      const cx = (i + 0.5) * CELL;
      const cy = (j + 0.5) * CELL;
      if (at(f, i, j) !== WALK || !kinds.has(kindAt(f, i, j)) || isZone(kindAt(f, i, j))) continue;
      if (poly && !inPoly(cx, cy, poly.map((p) => [p.x, p.y] as [number, number]))) continue;
      for (const [dx, dy] of DIRS) {
        const nk = kindAt(f, i + dx, j + dy);
        if (at(f, i + dx, j + dy) !== SOLIDC || isZone(nk) || WALLS_NOT_FOR_PIECES.has(nk)) continue;
        // the piece's back goes against the wall: the cell edge, minus half its depth
        const edge = dx ? (dx > 0 ? (i + 1) * CELL : i * CELL) : dy > 0 ? (j + 1) * CELL : j * CELL;
        const depth = piece.collider.hx + 0.02;
        candidates.push(dx ? { x: edge - dx * depth, y: cy, w: [dx, 0] } : { x: cx, y: edge - dy * depth, w: [0, dy] });
      }
    }
  for (let k = candidates.length - 1; k > 0; k--) {
    const m = Math.floor(next() * (k + 1)); // seeded shuffle
    [candidates[k], candidates[m]] = [candidates[m], candidates[k]];
  }
  const mine: { x: number; y: number }[] = [];
  const gap = rule.spacing[0];
  for (const c of candidates) {
    if (mine.length >= (rule.max ?? Infinity)) break;
    if (mine.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < gap)) continue;
    const rot = (Math.atan2(-c.w[1], -c.w[0]) * 180) / Math.PI;
    if (tryPlace(rule.piece, floor, c.x, c.y, rot, rule.aisle ?? 0.9, c.w)) mine.push(c);
  }
}

for (const rule of data.scatter) {
  const next = rng(rule.seed);
  for (const floor of rule.floors) {
    const poly = rule.area ? plans[floor - 1].polygons.find((p) => p.id === rule.area) : undefined;
    if (rule.area && !poly) throw new Error(`props.json: no polygon "${rule.area}" on floor ${floor}`);
    const pts = poly?.points ?? [];
    const [x0, y0, x1, y1] = rule.box ?? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    if (rule.wall) {
      placeAlongWalls(rule, next, floor, [x0, y0, x1, y1], poly ? pts.map(([x, y]) => ({ x, y })) : undefined);
      continue;
    }
    for (let gy = y0 + rule.spacing[1] / 2; gy < y1; gy += rule.spacing[1])
      for (let gx = x0 + rule.spacing[0] / 2; gx < x1; gx += rule.spacing[0]) {
        // The random numbers are drawn for every grid spot, placed or not, so editing one rule's area never reshuffles the rest.
        const [skip, jx, jy, turn] = [next(), next(), next(), next()];
        const j = rule.jitter ?? 0;
        const x = gx + (jx * 2 - 1) * j;
        const y = gy + (jy * 2 - 1) * j;
        if (poly && !inPoly(x, y, pts)) continue;
        if (skip < (rule.skip ?? 0)) continue;
        tryPlace(rule.piece, floor, x, y, (turn * 2 - 1) * (rule.turn ?? 0), rule.aisle ?? 0.9);
      }
  }
}
for (const p of data.place) tryPlace(p.piece, p.floor, p.x, p.y, p.rot ?? 0, p.aisle ?? 0.9);

writeFileSync(
  `${OUT_DIR}/props.json`,
  JSON.stringify({ note: "Generated by scripts/build-props.mts from docs/floorplans/props.json. Per piece: flat [x, y, z, yaw] groups; y is the floor's height, z = -plan y.", pieces: Object.fromEntries(Object.keys(pieces).map((n) => [n, `./models/kit/${n}.glb`])), instances }),
);
for (const [what, t] of Object.entries(counts)) {
  const dropped = Object.entries(t.dropped).map(([why, n]) => `${n} ${why}`).join(", ");
  console.log(`${what}: ${t.placed} placed${dropped ? `, dropped: ${dropped}` : ""}`);
}
