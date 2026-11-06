// Walk test: loads the built GLB and walks a simulated player through it with the same collision and
// ground code the game runs (src/engine/walk.ts). Run: npm run test:walk   (after npm run blockout)
//
//   1. the three stair sets can be climbed from floor 1 to floor 3 (the sealed set's gate holds);
//   2. nothing lets the player walk off an atrium edge or stair side, or into a solid block;
//   3. every placed prop (a table set) stops the player, from all four sides.
// The second is the check that would have caught chunked meshes losing their collision.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Walk, FLOOR_HEIGHT } from "../src/engine/walk.ts";
import { buildProps, type PropsManifest } from "../src/engine/props.ts";
import { CELL, NX, NY, WALK, HOLE, SOLIDC, OUT } from "./blockout/config.mts";
import { plans, floors, at, kindAt } from "./blockout/grid.mts";
import { paintGrid } from "./blockout/paint.mts";

const SPEED = 3.2;
const DT = 1 / 60;

const buf = readFileSync(OUT);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(ab as ArrayBuffer, "");
const player = new THREE.Vector3();
const walk = new Walk(player);
const manifest = JSON.parse(readFileSync("public/models/props.json", "utf8")) as PropsManifest;
const props = await buildProps(manifest, async (url) => {
  const file = readFileSync(url.replace("./", "public/"));
  return (await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, "")).scene;
});
walk.load(gltf.scene, props.colliders);
if (!walk.ready) throw new Error(`${OUT} has no collision or ground geometry`);
paintGrid(); // the same grid the builder emitted the GLB from

const floorOf = () => Math.min(2, Math.max(0, Math.floor((player.y + 0.6) / FLOOR_HEIGHT)));
const place = (x: number, y: number, h: number) => {
  player.set(x, h, -y); // plan y is north, three.js z is -y
  walk.fallSpeed = 0;
};
const settle = () => {
  for (let k = 0; k < 30; k++) walk.followGround(DT, floorOf());
};

/** Walks toward plan point (x, y) at walking speed. Stops when it arrives, when it stops making progress, or at the time limit. */
function walkTo(x: number, y: number, maxSeconds = 20) {
  let still = 0;
  for (let t = 0; t < maxSeconds; t += DT) {
    const dx = x - player.x;
    const dz = -y - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;
    const px = player.x;
    const pz = player.z;
    const s = Math.min(SPEED * DT, dist);
    player.x += (dx / dist) * s;
    player.z += (dz / dist) * s;
    walk.collide();
    walk.followGround(DT, floorOf());
    still = Math.hypot(player.x - px, player.z - pz) < s * 0.2 ? still + 1 : 0;
    if (still > 40) return false;
  }
  return false;
}

let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `  (${detail})` : ""}`);
};

// ---- 1. stairs -------------------------------------------------------------------------------------
type StairBox = { x0: number; y0: number; y1: number };
const stairs: { id: string; hall: "S" | "N"; vOff: number; sealed: boolean; tops: number }[] = [
  { id: "a_stairs", hall: "S", vOff: 0, sealed: true, tops: 2 },
  { id: "b_stairs", hall: "N", vOff: 0, sealed: true, tops: 2 },
  { id: "b_center_stair", hall: "S", vOff: 1.5, sealed: false, tops: 2 },
];
for (const s of stairs) {
  const box = plans[0].boxes.find((b) => b.id === s.id) as StairBox;
  // Tower frame: u from the hall end (0) toward the atrium, v east from the stair's west edge.
  const pt = (u: number, v: number): [number, number] => [box.x0 + s.vOff + v, s.hall === "S" ? box.y0 + u : box.y1 - u];
  // Hall end, up the west lane to the round landing, across, back along the east lane to the hall end.
  const lap = [pt(5.5, 1.5), pt(6.4, 1.5), pt(6.4, 4.5), pt(1.0, 4.5), pt(-1.5, 4.5)];
  const [sx, sy] = pt(-1.5, 1.5);
  place(sx, sy, 0);
  settle();
  for (let f = 1; f <= s.tops; f++) {
    const results = lap.map(([x, y]) => walkTo(x, y));
    const want = f * FLOOR_HEIGHT;
    check(results.every(Boolean) && Math.abs(player.y - want) < 0.3, `${s.id}: floor ${f} to ${f + 1}`, `ended at y ${player.y.toFixed(2)}, wanted ${want}`);
    if (f < s.tops) {
      // Back to the foot of the west lane for the next lap.
      walkTo(...pt(-1.5, 1.5));
    }
  }
  if (s.sealed && s.id === "a_stairs") {
    // The way up to the future floor 4 is shut: walking up the west lane from floor 3 stops at the gate.
    place(...pt(-1.5, 1.5), 2 * FLOOR_HEIGHT);
    settle();
    walkTo(...pt(5.5, 1.5), 10);
    check(player.y < 2 * FLOOR_HEIGHT + 0.7, `${s.id}: the gate to floor 4 holds`, `reached y ${player.y.toFixed(2)}`);
  }
}

// ---- 2. edges and solids ---------------------------------------------------------------------------
const N4: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const offending: Record<string, string[]> = { "walked off an edge": [], "walked into a solid": [] };
let tried = 0;
let skipped = 0;
for (let fi = 0; fi < 3; fi++) {
  const f = floors[fi];
  const h = fi * FLOOR_HEIGHT;
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      if (at(f, i, j) !== WALK) continue;
      const k = kindAt(f, i, j);
      if (k === "stairzone" || k === "stairzone_o") continue; // an open volume with no floor above the base
      for (const [di, dj] of N4) {
        const nc = at(f, i + di, j + dj);
        if (nc !== HOLE && nc !== SOLIDC) continue;
        if (nc === HOLE && fi === 0) continue; // floor 1 has no holes, only atrium floor
        tried++;
        const cx = (i + 0.5) * CELL;
        const cy = (j + 0.5) * CELL;
        place(cx, cy, h);
        walk.collide();
        settle();
        // Beside a wall the push-out is about 10 cm (14 in a corner). A start that is pushed 20 cm or more, or out of walkable
        // floor, was inside a pier or column stub (a cell half inside one), where a real player can't stand: skip it.
        if (Math.hypot(player.x - cx, player.z + cy) > 0.2 || at(f, Math.floor(player.x / CELL), Math.floor(-player.z / CELL)) !== WALK) {
          skipped++;
          continue;
        }
        // Three meters toward the neighbor: well past any edge the player could be standing at.
        walkTo(cx + di * 3, cy + dj * 3, 4);
        const pi = Math.floor(player.x / CELL);
        const pj = Math.floor(-player.z / CELL);
        const where = `floor ${fi + 1} cell (${cx}, ${cy}) toward ${di},${dj}`;
        if (nc === HOLE && (at(f, pi, pj) === HOLE || player.y < h - 0.6)) offending["walked off an edge"].push(where);
        if (nc === SOLIDC && at(f, pi, pj) === SOLIDC) offending["walked into a solid"].push(where);
      }
    }
}
for (const [what, list] of Object.entries(offending)) {
  check(list.length === 0, `${what}: ${list.length} of ${tried} attempts`, skipped ? `${skipped} starts skipped` : "");
  for (const w of list.slice(0, 8)) console.log(`     ${w}`);
  if (list.length > 8) console.log(`     ... and ${list.length - 8} more`);
}

// ---- 3. props --------------------------------------------------------------------------------------
let blocked = 0;
let propTries = 0;
const loose: string[] = [];
for (const [name, flat] of Object.entries(manifest.instances))
  for (let n = 0; n < flat.length; n += 4) {
    const [px, py, pz] = [flat[n], flat[n + 1], flat[n + 2]];
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + 0.3; // not square to the table: also covers its corners
      const sx = px + Math.cos(a) * 2.2;
      const sz = pz + Math.sin(a) * 2.2;
      // a start that is not clear floor (a wall or pier close to the table) says nothing about the table
      if (at(floors[Math.round(py / 5)], Math.floor(sx / CELL), Math.floor(-sz / CELL)) !== WALK) continue;
      propTries++;
      place(sx, -sz, py);
      settle();
      walkTo(px, -pz, 4);
      const d = Math.hypot(player.x - px, player.z - pz);
      if (d >= 0.9) blocked++;
      else loose.push(`${name} at (${px}, ${-pz}) height ${py} from side ${k}: got to ${d.toFixed(2)} m of its centre`);
    }
  }
check(propTries > 0 && blocked === propTries, `props: ${blocked} of ${propTries} approaches stopped`, `${Object.values(manifest.instances).reduce((t, f) => t + f.length / 4, 0)} instances`);
for (const w of loose.slice(0, 8)) console.log(`     ${w}`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;
