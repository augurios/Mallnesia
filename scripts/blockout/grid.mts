import { readFileSync } from "node:fs";
import { PLANS, CELL, NX, NY, type Plan, WALKABLE, SOLID, EMPTY, WALK, SOLIDC, HOLE } from "./config.mts";

export function inPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Floor {
  cls: Uint8Array;
  kind: string[]; // kind per cell, for materials and storefront glass
}

export function rasterize(plan: Plan, floor: number): Floor {
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

export const plans: Plan[] = [1, 2, 3].map((n) => JSON.parse(readFileSync(`${PLANS}/floor${n}_plan.json`, "utf8")));
export const floors: Floor[] = plans.map((p, i) => rasterize(p, i + 1));

export const at = (f: Floor, i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? EMPTY : f.cls[j * NX + i]);
export const kindAt = (f: Floor, i: number, j: number) => (i < 0 || j < 0 || i >= NX || j >= NY ? "" : f.kind[j * NX + i]);

/** Empty cells connected to the edge of the grid: the outside of the building. Enclosed gaps are not outside. */
export function outsideMask(f: Floor): Uint8Array {
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
