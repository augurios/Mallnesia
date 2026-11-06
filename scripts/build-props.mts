// Builds the kit piece files and the placement list the game reads.
// Run: npm run props   (writes public/models/kit/<piece>.glb and public/models/props.json)
//
// docs/floorplans/props.json says where pieces go; this checks each instance against the floor grid (it must
// stand on open floor with the aisle the rule asks for, away from secret doors) and bakes the survivors into
// public/models/props.json as flat arrays of [x, y, z, yaw] per piece, with y = the floor's height.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Document, NodeIO } from "@gltf-transform/core";
import { PLANS, CELL, FLOOR_H, WALK } from "./blockout/config.mts";
import { floors, plans, at, kindAt, inPoly } from "./blockout/grid.mts";
import { paintGrid } from "./blockout/paint.mts";
import { isZone } from "./blockout/towers.mts";
import { makeMaterial } from "./blockout/write.mts";
import { boxGeo, type Geo } from "./blockout/geo.mts";
import { PIECES } from "./kit/pieces.mts";

const OUT_DIR = "public/models";
const KIT_DIR = `${OUT_DIR}/kit`;

type Scatter = { piece: string; floors: number[]; area?: string; box?: [number, number, number, number]; spacing: [number, number]; jitter?: number; turn?: number; skip?: number; aisle?: number; seed: number };
type Place = { piece: string; floor: number; x: number; y: number; rot?: number; aisle?: number };
const data = JSON.parse(readFileSync(`${PLANS}/props.json`, "utf8")) as { scatter: Scatter[]; place: Place[] };
const doors = (JSON.parse(readFileSync(`${PLANS}/secret_doors.json`, "utf8")) as { doors: { floor: number; x: number; y: number }[] }).doors;

paintGrid(); // the grid the mall is built from, before anything is placed

// ---- the pieces -------------------------------------------------------------------------------------
mkdirSync(KIT_DIR, { recursive: true });
const pieces = Object.fromEntries(Object.entries(PIECES).map(([name, make]) => [name, make()]));
for (const [name, piece] of Object.entries(pieces)) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const add = (nodeName: string, material: string, g: Geo) => {
    const prim = doc
      .createPrimitive()
      .setMaterial(makeMaterial(doc, material))
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(g.idx)).setBuffer(buffer));
    scene.addChild(doc.createNode(nodeName).setMesh(doc.createMesh(nodeName).addPrimitive(prim)));
  };
  for (const [material, g] of Object.entries(piece.parts)) add(material, material, g);
  const { hx, hz, h } = piece.collider;
  add("collider", "barrier", boxGeo(-hx, hx, 0, h, -hz, hz)); // the runtime keeps it for collision and never draws it
  const bytes = await new NodeIO().writeBinary(doc);
  writeFileSync(`${KIT_DIR}/${name}.glb`, bytes);
  console.log(`kit ${name}: ${(bytes.byteLength / 1024).toFixed(1)} KB`);
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
function tryPlace(name: string, floor: number, x: number, y: number, rotDeg: number, aisle: number) {
  const tally = (counts[`${name} floor ${floor}`] ??= { placed: 0, dropped: {} });
  const drop = (why: string) => {
    tally.dropped[why] = (tally.dropped[why] ?? 0) + 1;
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
      if (at(f, i, j) !== WALK) return drop("not clear floor");
      if (isZone(kindAt(f, i, j))) return drop("near a stair");
    }
  if (doors.some((d) => d.floor === floor && Math.hypot(d.x - x, d.y - y) < 3)) return drop("near a secret door");
  (instances[name] ??= []).push(+x.toFixed(3), (floor - 1) * FLOOR_H, +(-y).toFixed(3), +((rotDeg * Math.PI) / 180).toFixed(4)); // z = -y
  tally.placed++;
}

for (const rule of data.scatter) {
  const next = rng(rule.seed);
  for (const floor of rule.floors) {
    const poly = rule.area ? plans[floor - 1].polygons.find((p) => p.id === rule.area) : undefined;
    if (rule.area && !poly) throw new Error(`props.json: no polygon "${rule.area}" on floor ${floor}`);
    const pts = poly?.points ?? [];
    const [x0, y0, x1, y1] = rule.box ?? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
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
