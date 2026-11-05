import { CELL, NX, NY, FLOOR_H, CEIL_H, ROOF_Y, RAIL_H, EMPTY, WALK, HOLE } from "./config.mts";
import { type Floor, floors, at, kindAt, outsideMask } from "./grid.mts";
import { flatRun } from "./geo.mts";
import { type Dir, type Edge, wallRuns } from "./walls.mts";
import { isZone } from "./towers.mts";
import { inBridgeCut } from "./bridge.mts";

export const OPP: Record<Dir, Dir> = { N: "S", S: "N", E: "W", W: "E" };
export const DIRS: { d: Dir; di: number; dj: number }[] = [
  { d: "N", di: 0, dj: 1 },
  { d: "S", di: 0, dj: -1 },
  { d: "E", di: 1, dj: 0 },
  { d: "W", di: -1, dj: 0 },
];

export const stats = { walkable: [0, 0, 0] };

// Floor 3: the halls and bridges around the atriums have no dropped ceiling; they open up to the roof truss.
export const OPEN_X = [45, 84];
export const OPEN_Y = [45, 165];
export const isOpenCeiling = (f: Floor, fi: number, i: number, j: number) => {
  if (fi !== 2 || at(f, i, j) !== WALK || kindAt(f, i, j) !== "hall") return false;
  const x = (i + 0.5) * CELL;
  const y = (j + 0.5) * CELL;
  return x >= OPEN_X[0] && x < OPEN_X[1] && y >= OPEN_Y[0] && y < OPEN_Y[1];
};

export function buildShell() {
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
        if ((k === "stairzone" || k === "stairzone_o") && fi > 0) mat = ""; // open volume: floor only at the base, where the garden is
        stats.walkable[fi]++;
      }
      const kk = i < NX ? f.kind[j * NX + i] : "";
      const open = mat !== "" && (isOpenCeiling(f, fi, i, j) || kk === "stairzone" || kk === "stairzone_o" || kk === "bridge" || (kk === "stair_landing_o" && fi === 2));
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
          // Slab edge: where a floor that has a ceiling meets an open side (the atrium or a stair), close the
          // 1.5 m of structure between its ceiling and the floor above, so you cannot look between the floors
          // from the stairs. The band faces the open side and is not collidable.
          const noCeiling = k === "void" || k === "bridge" || k === "stairzone" || k === "stairzone_o" || open || (k === "stair_landing_o" && floorNo === 3);
          const openSide = nc === HOLE || (nc === WALK && (nk === "void" || nk === "bridge" || nk === "stairzone" || nk === "stairzone_o"));
          if (floorNo < 3 && !noCeiling && openSide) {
            const above = floors[fi + 1];
            const ak = kindAt(above, i, j);
            if (at(above, i, j) === WALK && ak !== "stairzone" && ak !== "stairzone_o")
              edges.push({ dir: OPP[d], i: i + di, j: j + dj, mat: "slab", y0: y0 + CEIL_H, h: FLOOR_H - CEIL_H });
          }
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
              if (nk === "stair_landing" || nk === "stair_landing_o" || k === "void") lintel();
              else if (floorNo === 3 && k === "hall" && nk === "stairzone_o" && dj !== 0) {
                // Floor 3, no flight up: the hall end is open where the flight from floor 2 arrives.
              } else {
                edges.push({ dir: d, i, j, mat: floorNo > 1 ? "barrier" : "rails", y0, h: RAIL_H });
                // Floor 3: the flights go on up to the sealed floor 4 landing; the open-ceiling hall is walled off above it.
                if (floorNo === 3 && open && nk === "stairzone") edges.push({ dir: d, i, j, mat: "walls", y0: y0 + FLOOR_H, h: ROOF_Y - y0 - FLOOR_H });
              }
            } else lintel();
            continue;
          }
          // A tower is one tall room, no slab between floors; on floor 3 it goes on up to the sealed floor 4 (y 15 to 18.5).
          const towerH = floorNo === 3 ? FLOOR_H + CEIL_H : FLOOR_H;
          const wallH = k === "stairzone_o" && floorNo === 3 ? ROOF_Y - y0 : k === "stairzone" || (k === "stair_landing" && floorNo === 3) ? towerH : nearVoid ? FLOOR_H : open ? ROOF_Y - y0 : CEIL_H;
          // Along a stair's open sides there is no floating pane of glass at floor level (it would hang in the
          // middle of the flights): the stair has its own balustrades, and an invisible barrier keeps people out.
          // The bridge: a deep white beam under the deck edge. Along its curved edge the beam and the glass are
          // built smooth in bridge.mts; the cell edge only gets an invisible barrier.
          const cut = k === "bridge" && nc === HOLE && inBridgeCut(i + di, j + dj);
          if (nc === HOLE && k === "bridge" && !cut) edges.push({ dir: d, i, j, mat: "slab", y0: y0 - 0.7, h: 0.7 });
          if (cut) edges.push({ dir: d, i, j, mat: "barrier", y0, h: RAIL_H });
          else if (nc === HOLE) edges.push({ dir: d, i, j, mat: k === "stairzone" || k === "stairzone_o" ? "barrier" : "rails", y0, h: RAIL_H });
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
        const kind = i < NX ? f.kind[j * NX + i] : "";
        const hole = i < NX && (f.cls[j * NX + i] === HOLE || isOpenCeiling(f, fi, i, j) || kind === "stairzone_o" || kind === "stair_landing_o");
        if (hole && start < 0) start = i;
        if (!hole && start >= 0) {
          flatRun("roof", start, i, j, ROOF_Y, false);
          start = -1;
        }
      }
    }
  }
});
}
