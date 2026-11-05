import { readFileSync } from "node:fs";
import { PLANS, CELL, FLOOR_H, CEIL_H, WALK } from "./config.mts";
import { floors, at } from "./grid.mts";
import { geo, boxGeo } from "./geo.mts";

// ---- secret-hallway doors ------------------------------------------------------------------------
// Double doors from docs/floorplans/secret_doors.json. Each door is a root node ("door_<id>", extras
// carry its placement) with one pivot node per leaf ("door_<id>_a/_b", extras.sign = which way +angle
// swings it). src/engine/doors.ts animates the pivots. A lintel above the leaves goes into "walls".

export const DOOR_T = 0.06; // leaf thickness
export const SWING: Record<string, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }; // (x, z) in three.js coords

export interface DoorDef { id: string; floor: number; x: number; y: number; axis: "x" | "y"; width: number; swing: string; leadsTo?: string }
export const doorData = JSON.parse(readFileSync(`${PLANS}/secret_doors.json`, "utf8")) as { height: number; doors: DoorDef[] };


export function buildDoors() {
return doorData.doors.map((d) => {
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
}
