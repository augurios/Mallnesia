// Builds the navigation data the shadow walks on: public/models/nav.json. Run: npm run nav (part of `npm run assets`,
// after `npm run props`, because placed kit pieces block cells).
//
// One cell is 1 m. Per floor two bit planes:
//   walk   - a person can stand there: all four 0.5 m grid cells under it are clear floor (so there is at least
//            half a meter of room to every wall), not a stair zone, and no kit piece within reach of it;
//   opaque - it blocks sight: any of its grid cells is a wall block or outside. Voids (the atrium upstairs), glass
//            and low props do not block sight.
// Stairs are not walkable here on purpose: the shadow stays on one floor and the mall moves it between floors. The
// guard does use them: `stairs` lists each flight as a link between two floors (see below).
import { readFileSync, writeFileSync } from "node:fs";
import { NX, NY, CELL, WALK, SOLIDC, EMPTY } from "./blockout/config.mts";
import { floors, at, kindAt } from "./blockout/grid.mts";
import { paintGrid } from "./blockout/paint.mts";
import { isZone, TOWERS, ST, towerPt } from "./blockout/towers.mts";
import { PIECES } from "./kit/pieces.mts";

const NAV_CELL = 1;
const K = NAV_CELL / CELL; // grid cells per nav cell, per axis
const NNX = NX / K;
const NNY = NY / K;
const PROP_MARGIN = 0.3; // meters of room kept around a kit piece's collider (the shadow's body is about 0.4 wide)

paintGrid();

const props = JSON.parse(readFileSync("public/models/props.json", "utf8")) as { instances: Record<string, number[]> };
const colliders = Object.fromEntries(Object.entries(PIECES).map(([name, make]) => [name, make().collider]));

const walk = floors.map(() => new Uint8Array(NNX * NNY));
const opaque = floors.map(() => new Uint8Array(NNX * NNY));
floors.forEach((f, fi) => {
  for (let J = 0; J < NNY; J++)
    for (let I = 0; I < NNX; I++) {
      let clear = true;
      let solid = false;
      for (let dj = 0; dj < K; dj++)
        for (let di = 0; di < K; di++) {
          const i = I * K + di;
          const j = J * K + dj;
          const c = at(f, i, j);
          if (c !== WALK || isZone(kindAt(f, i, j))) clear = false;
          if (c === SOLIDC || c === EMPTY) solid = true;
        }
      walk[fi][J * NNX + I] = clear ? 1 : 0;
      opaque[fi][J * NNX + I] = solid ? 1 : 0;
    }
});

// Kit pieces block the cells their collider reaches. Instances are [x, y, z, yaw] groups; the floor follows from y.
let blocked = 0;
for (const [name, flat] of Object.entries(props.instances)) {
  const { hx, hz } = colliders[name];
  const reach = Math.hypot(hx, hz) + PROP_MARGIN; // generous: the box turned any way
  for (let n = 0; n + 3 < flat.length; n += 4) {
    const x = flat[n];
    const y = -flat[n + 2];
    const fi = Math.round(flat[n + 1] / 5); // FLOOR_H
    for (let J = Math.floor((y - reach) / NAV_CELL); J <= Math.floor((y + reach) / NAV_CELL); J++)
      for (let I = Math.floor((x - reach) / NAV_CELL); I <= Math.floor((x + reach) / NAV_CELL); I++) {
        if (I < 0 || J < 0 || I >= NNX || J >= NNY || !walk[fi]) continue;
        if (Math.hypot((I + 0.5) * NAV_CELL - x, (J + 0.5) * NAV_CELL - y) > reach) continue;
        if (walk[fi][J * NNX + I]) blocked++;
        walk[fi][J * NNX + I] = 0;
      }
  }
}

// Stair links, for the guard (who walks people out, up and down the stairs; the shadow still stays on one floor).
// Each tower carries one flight pair per floor: up the west lane to the round landing, back down the east lane to the
// hall end of the floor above. A link is that walk as plan points with heights above the lower floor, from a hall cell
// just outside the stair on the lower floor to one just outside it on the upper floor.
const FLOOR_H = 5;
const snap = (fi: number, x: number, y: number): [number, number] | null => {
  for (let r = 0; r <= 3; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const I = Math.floor(x / NAV_CELL) + di;
        const J = Math.floor(y / NAV_CELL) + dj;
        if (I >= 0 && J >= 0 && I < NNX && J < NNY && walk[fi]?.[J * NNX + I]) return [(I + 0.5) * NAV_CELL, (J + 0.5) * NAV_CELL];
      }
  return null;
};
const stairs: { id: string; floor: number; pts: [number, number, number][] }[] = [];
for (const t of TOWERS)
  for (let fi = 0; fi + 1 < floors.length; fi++) {
    const lane0 = ST.lane / 2;
    const lane1 = ST.lane * 1.5;
    const turn = ST.depth + 0.8; // on the round landing
    const frame: [number, number, number][] = [
      [-1, lane0, 0],
      [ST.strip, lane0, 0],
      [ST.depth, lane0, FLOOR_H / 2],
      [turn, lane0, FLOOR_H / 2],
      [turn, lane1, FLOOR_H / 2],
      [ST.depth, lane1, FLOOR_H / 2],
      [ST.strip, lane1, FLOOR_H],
      [-1, lane1, FLOOR_H],
    ];
    const pts = frame.map(([u, v, h]): [number, number, number] => {
      const p = towerPt(t, u, v, h);
      return [p[0], -p[2], h];
    });
    const a = snap(fi, pts[0][0], pts[0][1]);
    const b = snap(fi + 1, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (!a || !b) {
      console.warn(`nav: stair ${t.id} floor ${fi + 1}->${fi + 2}: no open floor at its ${a ? "top" : "foot"}; left out`);
      continue;
    }
    pts.unshift([a[0], a[1], 0]);
    pts.push([b[0], b[1], FLOOR_H]);
    stairs.push({ id: `${t.id}_${fi + 1}`, floor: fi, pts: pts.map((p) => p.map((n) => Math.round(n * 100) / 100) as [number, number, number]) });
  }

const pack = (a: Uint8Array) => {
  const out = Buffer.alloc(Math.ceil(a.length / 8));
  for (let i = 0; i < a.length; i++) if (a[i]) out[i >> 3] |= 1 << (i & 7);
  return out.toString("base64");
};
const json = JSON.stringify({
  note: "Generated by scripts/build-nav.mts. Per floor, bit planes (base64, row-major from plan y 0, bit i = cell i): walk and opaque. Cell size in meters in `cell`.",
  cell: NAV_CELL,
  nx: NNX,
  ny: NNY,
  floors: floors.map((_, fi) => ({ walk: pack(walk[fi]), opaque: pack(opaque[fi]) })),
  stairs,
});
writeFileSync("public/models/nav.json", json);
const count = (a: Uint8Array) => a.reduce((s, v) => s + v, 0);
console.log(`nav.json: ${(json.length / 1024).toFixed(1)} KB; walkable cells per floor ${walk.map(count).join(", ")}; ${blocked} blocked by kit pieces; ${stairs.length} stair links`);
