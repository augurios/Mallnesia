import { CELL } from "./config.mts";
import { type V3, geo } from "./geo.mts";

export type Dir = "N" | "S" | "E" | "W";
export interface Edge {
  dir: Dir; // side of the cell the wall sits on; the wall faces into the cell
  i: number;
  j: number;
  mat: "walls" | "glass" | "rails" | "elev" | "barrier" | "slab"; // barrier: collision only, not drawn; slab: the edge of a floor structure
  y0: number;
  h: number;
}

export function wallRuns(edges: Edge[]) {
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

export function emitWall(first: Edge, last: Edge, horizontal: boolean) {
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
