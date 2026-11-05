import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { CELL, NX, NY, FLOOR_H, COLLIDERS, WALK, SOLIDC, HOLE } from "./config.mts";
import { floors, at, kindAt } from "./grid.mts";
import { geos } from "./geo.mts";

// Spawn points used by src/engine/runtime.ts must be walkable cells.
export function checkSpawns() {
for (const [fi, x, y] of [[0, 72, 28], [1, 48, 100], [2, 48, 100]] as const) {
  const i = Math.floor(x / CELL);
  const j = Math.floor(y / CELL);
  const ok = at(floors[fi], i, j) === WALK;
  console.log(`spawn floor ${fi + 1} (${x}, ${y}): ${kindAt(floors[fi], i, j) || "empty"}${ok ? "" : "  <-- NOT WALKABLE"}`);
  if (!ok) process.exitCode = 1;
}
}

// Debug: BLOCKOUT_DEBUG=<dir> writes one PPM per floor. White = reachable from the spawn,
// yellow = blocked by collision, red = walkable but unreachable, gray = solid, blue = hole, black = empty.
export function debugReachability() {
  if (!process.env.BLOCKOUT_DEBUG) return;
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
