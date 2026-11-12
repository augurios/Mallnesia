// The parking garage: a level of its own, generated from a seed (CLAUDE.md, "The parking garage is procedural").
// No DOM and no Three.js, so scripts/test-garage.mts runs the exact code the game runs.
//
// It is built from a small set of chunks on a grid of column bays: bays with painted stalls and parked cars,
// dead ends (a ramp that climbs into the ceiling, or a "Salida" arrow pointing into a wall), the stairwell door the
// player came through, and the attendant's booth with a payphone that is the way out. The cells are joined by a
// maze with a few loops, so the same recurring minivan can be passed again and again. It starts looking normal; the
// level signs along the way then skip (P2, P3, P7, P-12) and the "Salida" arrows point into walls.
// It is a contained, guided sequence: the way from the stairwell door to the booth always exists (checked here), and
// the signs, the van and the payphone's ring lead along it. The seed is fixed by default; a flag randomizes it.
//
// Plan coordinates (meters, x east, y north), the origin at the south-west corner of the first cell.

/**
 * The openings from the mall onto the parking strip (west edge, x 3 to 15; the same two on all three floors, see
 * docs/floorplans/*_plan.json). The strip is dressed as the garage's first column (`stripPart`), so walking into it
 * and then being swapped into the real garage shows no change. Plan coordinates: x east, y north (m); `y` is the
 * centre of the opening and `half` half its width.
 *
 * Each opening has a block of the strip behind it: the garage's column 0 turned half a turn about the vertical axis
 * (the garage's west wall, with its stairwell door, is the strip's east wall, the opening in it; the garage's east
 * is the strip's west). The entry cell sits at the opening, so the block runs from y - 30 to y + 18.
 */
export interface GarageEntrance {
  id: "strip_north" | "strip_south";
  x: number;
  y: number;
  half: number;
}
export const GARAGE_ENTRANCES: readonly GarageEntrance[] = [
  { id: "strip_north", x: 15, y: 162, half: 3 },
  { id: "strip_south", x: 15, y: 114, half: 3 },
];
/** The garage's cell width is also the strip's width (x 3 to 15). */
export const STRIP_WEST = 3;
/** How far past the opening (into the strip) the player must be before the garage takes over. */
export const GARAGE_ENTRANCE_DEPTH = 2.5;
/** Where the player is put back in the mall when they come out: this far inside the opening. */
export const GARAGE_EXIT_INSIDE = 2;
/** The secret door at the south end of the floor-2 strip (y 84, x 12 to 15, floor index 1) opens into the south block. */
export const STRIP_DOOR = { floor: 1, x0: 12, x1: 15, y: 84 };

/**
 * The seed of the garage behind one of the six strip openings (2 openings x 3 floors, `f` the floor index): each door
 * leads to its own garage, the same one every time. The south opening on floor 2 (the one the debug key and the fade use)
 * keeps the base seed.
 */
export const entranceSeed = (base: number, e: GarageEntrance, f: number) => base + (GARAGE_ENTRANCES.findIndex((x) => x.id === e.id) * 3 + f - 4) * 7919;

const entryY = () => (GARAGE.ENTRY_ROW + 0.5) * GARAGE.CELL;
/** The y range of an entrance's block of the strip. */
export const blockRange = (e: GarageEntrance) => ({ y0: e.y + entryY() - GARAGE.ROWS * GARAGE.CELL, y1: e.y + entryY() });

/** Mall plan point to garage plan point, and back (a half turn: headings differ by PI). */
export const stripToGarage = (e: GarageEntrance, x: number, y: number) => ({ x: e.x - x, y: e.y + entryY() - y });
export const garageToStrip = (e: GarageEntrance, gx: number, gy: number) => ({ x: e.x - gx, y: e.y + entryY() - gy });

/** The block of the strip a mall point (x, y) is inside, once it is `depth` m past the opening's wall; else null. */
export function stripBlockAt(x: number, y: number, depth = 0) {
  for (const e of GARAGE_ENTRANCES) {
    const r = blockRange(e);
    if (x < e.x - depth && x > STRIP_WEST && y > r.y0 && y < r.y1) return e;
  }
  return null;
}

/** The doorways in column 0's east wall (garage x = cell), as y ranges: in the mall the strip has a wall there (it is closed). */
export function columnGaps(layout: GarageLayout): { y0: number; y1: number }[] {
  const C = layout.cell;
  const gaps: { y0: number; y1: number }[] = [];
  for (let j = 0; j < layout.rows; j++) {
    if (!layout.openE[j][0]) continue;
    const pieces = layout.boxes
      .filter((b) => b.kind === "wall" && Math.abs((b.x0 + b.x1) / 2 - C) < 0.01 && b.y0 >= j * C - 0.01 && b.y1 <= (j + 1) * C + 0.01)
      .sort((a, b) => a.y0 - b.y0);
    if (pieces.length === 2) gaps.push({ y0: pieces[0].y1, y1: pieces[1].y0 });
  }
  return gaps;
}

/** The walls that fill `columnGaps`, in the same order. */
export const gapWalls = (layout: GarageLayout): Box[] =>
  columnGaps(layout).map((g) => ({ kind: "wall", x0: layout.cell - GARAGE.WALL / 2, x1: layout.cell + GARAGE.WALL / 2, y0: g.y0, y1: g.y1, top: layout.height }));

/**
 * The part of the garage that is dressed into the mall: column 0 only (cars, stalls, columns, tubes, walls, signs), the
 * stairwell door left out and the opening cut out of its west wall (which stands just inside the mall's own wall), as a
 * layout the view can draw. `doorHole` cuts the 3 m gap of the floor-2 secret door out of the far end wall. `closed` walls up the doorways
 * to column 1 (decided by Augusto: the strip is closed, nothing of the outside shows); left open, it is the shape both
 * worlds share, which is what `seamSeen` looks through.
 */
export function stripPart(layout: GarageLayout, doorHole = false, closed = true): GarageLayout {
  const C = layout.cell;
  const inside = (x: number) => x >= 0 && x <= C;
  let boxes = layout.boxes.filter((b) => b.kind !== "door" && b.kind !== "booth" && b.kind !== "phone" && b.x0 >= -0.4 && b.x1 <= C + 0.4);
  // the west wall (the stairwell's) stays, in front of the mall's own wall, with the opening cut out of it
  const half = GARAGE_ENTRANCES[0].half;
  // (a hair wider than the mall's own opening: the cut's end faces would be coplanar with its jambs, and flicker)
  const oy0 = layout.stairDoor.y - half - 0.04;
  const oy1 = layout.stairDoor.y + half + 0.04;
  boxes = boxes.flatMap((b) => {
    if (b.kind !== "wall" || b.x0 > 0 || b.y1 <= oy0 || b.y0 >= oy1) return [b];
    return [...(b.y0 < oy0 ? [{ ...b, y1: oy0 }] : []), ...(b.y1 > oy1 ? [{ ...b, y0: oy1 }] : [])];
  });
  if (doorHole) {
    // the far wall (y = depth) of column 0 loses its first 3 m (garage x 0 to 3 is mall x 12 to 15), and the corner column there
    const cut = STRIP_DOOR.x1 - STRIP_DOOR.x0;
    boxes = boxes.flatMap((b) => ((b.kind === "wall" || b.kind === "column") && b.y0 > layout.depth - 0.5 && b.x0 < cut ? (b.kind === "wall" && b.x1 > cut ? [{ ...b, x0: cut }] : []) : [b]));
  }
  if (closed) boxes = [...boxes, ...gapWalls(layout)];
  return {
    ...layout,
    boxes,
    cars: layout.cars.filter((c) => inside(c.x)),
    lights: layout.lights.filter((l) => inside(l.x)),
    signs: layout.signs.filter((s) => inside(s.x) && s.kind !== "stairs"), // (the "Escalera" sign is for the stairwell door; the opening has none)
    lines: layout.lines.filter((l) => inside(l.x0) && inside(l.x1)),
    ramps: layout.ramps.filter((r) => boxes.includes(r.box)),
    width: C,
  };
}

/** The boxes of `stripPart` as mall plan boxes, for the block behind `e` (collision while the player is still in the mall). */
export function stripBoxes(part: GarageLayout, e: GarageEntrance): Box[] {
  return part.boxes.map((b) => {
    const a = garageToStrip(e, b.x0, b.y0);
    const c = garageToStrip(e, b.x1, b.y1);
    return { ...b, x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), y0: Math.min(a.y, c.y), y1: Math.max(a.y, c.y) };
  });
}

type Point = { x: number; y: number };

/**
 * Points (garage plan, every 0.5 m) along the places the strip and the garage's column 0 can differ: `opening`, the
 * stairwell wall (the opening in the strip) and the floor-2 secret door's gap; `gaps`, each doorway to column 1 (always
 * walled in the strip; in the garage walled or open, see `gapWalls`).
 */
export function stripSeams(layout: GarageLayout, doorHole: boolean): { opening: Point[]; gaps: Point[][] } {
  const along = (x0: number, y0: number, x1: number, y1: number, pts: Point[] = []) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
    for (let k = 0; k <= n; k++) pts.push({ x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n });
    return pts;
  };
  const C = layout.cell;
  const half = GARAGE_ENTRANCES[0].half;
  const opening = along(0, layout.stairDoor.y - half, 0, layout.stairDoor.y + half);
  if (doorHole) along(0.02, layout.depth, STRIP_DOOR.x1 - STRIP_DOOR.x0 - 0.02, layout.depth, opening);
  return { opening, gaps: columnGaps(layout).map((g) => along(C, g.y0 + 0.02, C, g.y1 - 0.02)) };
}

/** Whether the segment (ax, ay)-(bx, by) passes through the box (slab test; touching an edge does not count). */
function segmentHits(b: Box, ax: number, ay: number, bx: number, by: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, d, lo, hi] of [[ax, dx, b.x0 + 0.01, b.x1 - 0.01], [ay, dy, b.y0 + 0.01, b.y1 - 0.01]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (p <= lo || p >= hi) return false;
      continue;
    }
    let a = (lo - p) / d;
    let c = (hi - p) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 >= t1) return false;
  }
  return true;
}

/**
 * Whether any seam point can be on screen: inside the view cone (`fwd` a unit plan vector, `cosHalf` the cosine of the
 * cone's half angle) and not behind a wall or column both worlds share (`occluders`, from `stripPart(layout, door, false)`).
 * A seam within arm's reach always counts. Garage plan coordinates.
 */
export function seamSeen(occluders: Box[], seams: Point[], eye: Point, fwd: Point, cosHalf: number): boolean {
  for (const p of seams) {
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.6) return true;
    if ((dx * fwd.x + dy * fwd.y) / d <= cosHalf) continue;
    if (!occluders.some((b) => segmentHits(b, eye.x, eye.y, p.x, p.y))) return true;
  }
  return false;
}

/** The rows of column 0 that the closed strip joins to the entry cell (its north and south doorways): where the swap back may happen. */
export function stripRows(layout: GarageLayout): Set<number> {
  const rows = new Set([GARAGE.ENTRY_ROW]);
  for (let j = GARAGE.ENTRY_ROW; j < layout.rows - 1 && layout.openN[j][0]; j++) rows.add(j + 1);
  for (let j = GARAGE.ENTRY_ROW - 1; j >= 0 && layout.openN[j][0]; j--) rows.add(j);
  return rows;
}

export const GARAGE = {
  COLS: 7,
  ROWS: 4,
  CELL: 12,
  HEIGHT: 2.7,
  /** The default seed: the same garage every time unless the debug flag asks for another. */
  SEED: 1995,
  /** The row of the entry cell, always: the strip's blocks (see GARAGE_ENTRANCES) line up with the garage's first column. */
  ENTRY_ROW: 1,
  WALL: 0.35,
  COLUMN: 0.6,
  /** Doorway half-width in a cell wall (m), and the wider "open bay" one. */
  GAP: 3,
  GAP_WIDE: 5,
  /** Chance an extra wall is opened to make a loop, and that an opening is wide. */
  LOOP: 0.3,
  WIDE: 0.4,
  /** Parking slots: width, length (m), and the chance a free slot has a car. */
  SLOT_W: 2.4,
  SLOT_L: 4.7,
  CAR_CHANCE: 0.55,
  /** The minivan stands in this many cells along the guided path. */
  VANS: 3,
  /** The booth's goal circle radius (m). */
  GOAL_R: 2.4,
  /** Every garage has at least this many ramps (to other garages). */
  RAMPS_MIN: 2,
  /** A ramp rises this high (m) from its foot to the far wall, above the ceiling (2.7): it goes through a hole in it. */
  RAMP_RISE: 3,
  /** The ceiling's hole over a ramp starts where the ramp is this high (m): the head is about to reach the slab. */
  RAMP_HOLE_FROM: 0.9,
  /** Standing this high (m) on a ramp, the player is above the ceiling, in the dark, and the world swaps to the next garage. */
  RAMP_SWAP: 1.9,
};

export type BoxKind = "wall" | "column" | "car" | "van" | "booth" | "ramp" | "door" | "phone";

/** An axis-aligned block: collision and, in the view, the solid it is drawn as. */
export interface Box {
  kind: BoxKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Top height (m); the bottom is the floor. */
  top: number;
}

export interface Car {
  x: number;
  y: number;
  /** Plan heading the nose points toward (radians), with a little jitter. */
  heading: number;
  van: boolean;
  /** An index into the view's palette. */
  color: number;
  /** Footprint (width across, length along the heading). */
  w: number;
  l: number;
}

export type LightState = "on" | "flicker" | "dead";
export interface Light {
  x: number;
  y: number;
  state: LightState;
}

export interface Sign {
  x: number;
  y: number;
  /** Plan heading the sign faces toward (toward the player walking the path). */
  facing: number;
  /** "level" (P2...), "exit" (Salida with an arrow), "stairs". */
  kind: "level" | "exit" | "stairs";
  text: string;
  /** For "exit": the plan heading the arrow points. `wrong` marks an arrow that points into a wall. */
  arrow?: number;
  wrong?: boolean;
}

/** A painted line on the floor. */
export interface Line {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: "white" | "yellow";
}

export interface GarageLayout {
  seed: number;
  cols: number;
  rows: number;
  cell: number;
  height: number;
  boxes: Box[];
  cars: Car[];
  lights: Light[];
  signs: Sign[];
  lines: Line[];
  /** Where the player appears and which way they face, just inside the stairwell door. */
  spawn: { x: number; y: number; heading: number };
  stairDoor: { x: number; y: number };
  /** The payphone beside the booth: the goal is reached within `r` of (x, y). */
  goal: { x: number; y: number; r: number };
  booth: { x0: number; x1: number; y0: number; y1: number };
  /** Ramps that climb into the ceiling, drawn as wedges: the box and the heading they rise toward. Each leads to another garage (`rampTouch`). */
  ramps: { box: Box; rise: number }[];
  /** A garage the player reaches by a ramp (no booth, no payphone, no ramps of its own): the way out is the first column. */
  arrival: boolean;
  /**
   * Arrival garages only: the ramp that comes up from below into a dead-end cell, a pit in the floor. Its top end is
   * flush with the floor and faces the cell's only doorway. It is the same shape as the ramp it continues (`rise` is the heading it climbs toward).
   */
  landing: { box: Box; rise: number } | null;
  /** A spot on the landing's ramp, and the heading up it (debug starts). */
  arrive: { x: number; y: number; heading: number };
  /** The guided path, as the cells from the entry to the booth. */
  path: [number, number][];
  /** Which cells each edge opens: `openE[j][i]` is the wall east of cell (i, j); `openN[j][i]` the wall north of it. */
  openE: boolean[][];
  openN: boolean[][];
  /** Cells with one way in and no goal: dead ends. */
  deadEnds: [number, number][];
  width: number;
  depth: number;
}

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Level signs along the way: the first looks right, then the numbers go wrong. */
const LEVELS = ["P2", "P2", "P3", "P3", "P7", "P-12", "P2", "P9", "P-3"];

export function generateGarage(seed: number = GARAGE.SEED, opts: { arrival?: boolean } = {}): GarageLayout {
  const arrival = !!opts.arrival;
  const { COLS, ROWS, CELL, HEIGHT } = GARAGE;
  const rand = rng(seed);
  const cx = (i: number) => (i + 0.5) * CELL;
  const cy = (j: number) => (j + 0.5) * CELL;

  // ---- the maze: a random spanning tree (every cell reachable), then a few extra openings to make loops
  const openE: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const openN: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const wideE: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const wideN: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  rand(); // (the entry row used to be drawn here; it is fixed now, and the stream stays as it was)
  const entryRow = GARAGE.ENTRY_ROW;
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const stack: [number, number][] = [[0, entryRow]];
  seen[entryRow][0] = true;
  const link = (i: number, j: number, di: number, dj: number) => {
    if (di === 1) openE[j][i] = true;
    else if (di === -1) openE[j][i - 1] = true;
    else if (dj === 1) openN[j][i] = true;
    else openN[j - 1][i] = true;
  };
  // The entry cell's far wall (east of it) is always solid, and its side walls (north and south) always open: the player
  // comes in facing a wall and turns left or right, which is when the strip becomes the garage (see `seamSeen`).
  const entryBack = (i: number, j: number, di: number, dj: number) => j === entryRow && dj === 0 && ((i === 0 && di === 1) || (i === 1 && di === -1));
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(
      ([di, dj]) => i + di >= 0 && i + di < COLS && j + dj >= 0 && j + dj < ROWS && !seen[j + dj][i + di] && !entryBack(i, j, di, dj),
    );
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [di, dj] = next[Math.floor(rand() * next.length)];
    link(i, j, di, dj);
    seen[j + dj][i + di] = true;
    stack.push([i + di, j + dj]);
  }
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      if (i < COLS - 1 && !openE[j][i] && rand() < GARAGE.LOOP && !entryBack(i, j, 1, 0)) openE[j][i] = true;
      if (j < ROWS - 1 && !openN[j][i] && rand() < GARAGE.LOOP) openN[j][i] = true;
      wideE[j][i] = rand() < GARAGE.WIDE;
      wideN[j][i] = rand() < GARAGE.WIDE;
    }
  if (entryRow > 0) openN[entryRow - 1][0] = true;
  if (entryRow < ROWS - 1) openN[entryRow][0] = true;

  const neighbours = (i: number, j: number): [number, number][] => {
    const out: [number, number][] = [];
    if (i < COLS - 1 && openE[j][i]) out.push([i + 1, j]);
    if (i > 0 && openE[j][i - 1]) out.push([i - 1, j]);
    if (j < ROWS - 1 && openN[j][i]) out.push([i, j + 1]);
    if (j > 0 && openN[j - 1][i]) out.push([i, j - 1]);
    return out;
  };

  // ---- the guided path: from the entry cell to the farthest cell of the last column
  const dist = Array.from({ length: ROWS }, () => Array(COLS).fill(-1));
  const from: ([number, number] | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const bfs = () => {
    for (let j = 0; j < ROWS; j++)
      for (let i = 0; i < COLS; i++) {
        dist[j][i] = -1;
        from[j][i] = null;
      }
    dist[entryRow][0] = 0;
    const queue: [number, number][] = [[0, entryRow]];
    for (let q = 0; q < queue.length; q++) {
      const [i, j] = queue[q];
      for (const [ni, nj] of neighbours(i, j))
        if (dist[nj][ni] < 0) {
          dist[nj][ni] = dist[j][i] + 1;
          from[nj][ni] = [i, j];
          queue.push([ni, nj]);
        }
    }
  };
  bfs();
  let goalCol = COLS - 1;
  let goalRow = 0;
  for (let j = 0; j < ROWS; j++) if (dist[j][COLS - 1] > dist[goalRow][COLS - 1]) goalRow = j;
  let path: [number, number][] = [];
  const trace = () => {
    path = [];
    for (let c: [number, number] | null = [goalCol, goalRow]; c; c = from[c[1]][c[0]]) path.push(c);
    path.reverse();
  };
  trace();

  // Ramps lead to other garages, so every garage gets at least RAMPS_MIN dead ends (a ramp needs a cell with one way in):
  // cells off the guided path are closed off down to one doorway, as long as every cell stays reachable. This uses a
  // stream of its own, so the rest of the layout is what the seed has always given.
  const r2 = rng(seed ^ 0x9e3779b9);
  const reachable = () => {
    const seenC = new Set<string>([`0,${entryRow}`]);
    const q: [number, number][] = [[0, entryRow]];
    for (let k = 0; k < q.length; k++) for (const [ni, nj] of neighbours(q[k][0], q[k][1])) if (!seenC.has(`${ni},${nj}`)) (seenC.add(`${ni},${nj}`), q.push([ni, nj]));
    return seenC.size === COLS * ROWS;
  };
  const closeEdge = (i: number, j: number, ni: number, nj: number, open: boolean) => {
    if (ni === i + 1) openE[j][i] = open;
    else if (ni === i - 1) openE[j][ni] = open;
    else if (nj === j + 1) openN[j][i] = open;
    else openN[nj][i] = open;
  };
  const onPath = new Set(path.map(([i, j]) => `${i},${j}`));
  const isDead = (i: number, j: number) => neighbours(i, j).length === 1 && !onPath.has(`${i},${j}`);
  if (!arrival) {
    const cells: [number, number][] = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) if (!onPath.has(`${i},${j}`)) cells.push([i, j]);
    for (let k = cells.length - 1; k > 0; k--) {
      const m = Math.floor(r2() * (k + 1));
      [cells[k], cells[m]] = [cells[m], cells[k]];
    }
    let dead = cells.filter(([i, j]) => isDead(i, j)).length;
    for (const [i, j] of cells) {
      if (dead >= GARAGE.RAMPS_MIN) break;
      const around = neighbours(i, j);
      if (around.length < 2) continue;
      const closed: [number, number][] = [];
      for (const [ni, nj] of around.map((c) => [r2(), c] as const).sort((p, q) => p[0] - q[0]).map(([, c]) => c)) {
        if (neighbours(i, j).length === 1) break;
        closeEdge(i, j, ni, nj, false);
        if (reachable()) closed.push([ni, nj]);
        else closeEdge(i, j, ni, nj, true);
      }
      if (neighbours(i, j).length === 1) dead++;
      else for (const [ni, nj] of closed) closeEdge(i, j, ni, nj, true); // could not get down to one doorway: leave the cell as it was
    }
  }
  if (arrival) {
    // A garage reached by a ramp: the ramp comes up in the farthest cell that can be made a dead end (one doorway, which the
    // ramp's top faces). The cells of the entry keep their doorways (the strip's), so none of their edges is closed.
    const order: [number, number][] = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) if (dist[j][i] > 0) order.push([i, j]);
    order.sort((a, b) => dist[b[1]][b[0]] - dist[a[1]][a[0]]);
    const touchesEntry = (i: number, j: number) => i === 0 && j === entryRow;
    for (const [i, j] of order) {
      if (neighbours(i, j).length > 1) {
        const closed: [number, number][] = [];
        for (const [ni, nj] of neighbours(i, j).map((c) => [r2(), c] as const).sort((p, q) => p[0] - q[0]).map(([, c]) => c)) {
          if (neighbours(i, j).length === 1) break;
          if (touchesEntry(ni, nj)) continue;
          closeEdge(i, j, ni, nj, false);
          if (reachable()) closed.push([ni, nj]);
          else closeEdge(i, j, ni, nj, true);
        }
        if (neighbours(i, j).length !== 1) {
          for (const [ni, nj] of closed) closeEdge(i, j, ni, nj, true);
          continue;
        }
      }
      goalCol = i;
      goalRow = j;
      break;
    }
    bfs();
    trace();
  }
  let rampsMade = 0;
  const rampCells = new Set<string>();
  let landing: { box: Box; rise: number } | null = null;

  const boxes: Box[] = [];
  const W = GARAGE.WALL;

  // ---- walls: every cell edge is a wall, with a doorway (centred) where the maze opens it
  const wallX = (x: number, y0: number, y1: number) => boxes.push({ kind: "wall", x0: x - W / 2, x1: x + W / 2, y0, y1, top: HEIGHT });
  const wallY = (y: number, x0: number, x1: number) => boxes.push({ kind: "wall", x0, x1, y0: y - W / 2, y1: y + W / 2, top: HEIGHT });
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i <= COLS; i++) {
      const x = i * CELL;
      const y0 = j * CELL;
      const y1 = (j + 1) * CELL;
      const exitDoor = arrival && i === 0 && j === entryRow; // a garage reached by a ramp: the way out is an open doorway
      const open = exitDoor || (i > 0 && i < COLS && openE[j][i - 1]);
      if (!open) wallX(x, y0, y1);
      else {
        const g = exitDoor ? GARAGE.GAP : wideE[j][i - 1] ? GARAGE.GAP_WIDE : GARAGE.GAP;
        wallX(x, y0, cy(j) - g);
        wallX(x, cy(j) + g, y1);
      }
    }
  for (let j = 0; j <= ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const y = j * CELL;
      const x0 = i * CELL;
      const x1 = (i + 1) * CELL;
      const open = j > 0 && j < ROWS && openN[j - 1][i];
      if (!open) wallY(y, x0, x1);
      else {
        const g = wideN[j - 1][i] ? GARAGE.GAP_WIDE : GARAGE.GAP;
        wallY(y, x0, cx(i) - g);
        wallY(y, cx(i) + g, x1);
      }
    }
  // the stairwell door in the west wall of the entry cell: a frame set into the wall, the player's way in (and not out)
  const stairDoor = { x: 0, y: cy(entryRow) };
  if (!arrival) boxes.push({ kind: "door", x0: -0.1, x1: 0.35, y0: stairDoor.y - 0.9, y1: stairDoor.y + 0.9, top: 2.2 });
  // columns at every grid corner
  const C = GARAGE.COLUMN;
  for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++) boxes.push({ kind: "column", x0: i * CELL - C / 2, x1: i * CELL + C / 2, y0: j * CELL - C / 2, y1: j * CELL + C / 2, top: HEIGHT });

  // ---- what each cell holds
  const cars: Car[] = [];
  const lights: Light[] = [];
  const lines: Line[] = [];
  const signs: Sign[] = [];
  const ramps: { box: Box; rise: number }[] = [];
  const deadEnds: [number, number][] = [];
  const booth = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const goal = { x: 0, y: 0, r: GARAGE.GOAL_R };
  /** A ramp's plan rectangle in a cell: from the wall opposite `far` (the foot) to the wall at `far` (the top), 6 m wide. */
  const rampRect = (i: number, j: number, far: "E" | "W" | "N" | "S") => {
    const x0 = far === "W" ? cx(i) - 5.8 : far === "E" ? cx(i) - 5.6 : cx(i) - 3;
    const x1 = far === "W" ? cx(i) + 5.6 : far === "E" ? cx(i) + 5.8 : cx(i) + 3;
    const y0 = far === "S" ? cy(j) - 5.8 : far === "N" ? cy(j) - 5.6 : cy(j) - 3;
    const y1 = far === "S" ? cy(j) + 5.6 : far === "N" ? cy(j) + 5.8 : cy(j) + 3;
    const box: Box = { kind: "ramp", x0, x1, y0, y1, top: GARAGE.RAMP_RISE };
    return { box, rise: far === "E" ? 0 : far === "N" ? Math.PI / 2 : far === "W" ? Math.PI : -Math.PI / 2 };
  };
  /** Nothing else stands on a ramp: parked cars (and their stalls) and the tubes over it go. */
  const clearRamp = (b: Box) => {
    const { x0, x1, y0, y1 } = b;
    const hit = (ax0: number, ax1: number, ay0: number, ay1: number, m: number) => ax0 < x1 + m && ax1 > x0 - m && ay0 < y1 + m && ay1 > y0 - m;
    for (let k = cars.length - 1; k >= 0; k--) if (!cars[k].van && hit(cars[k].x - 0.95, cars[k].x + 0.95, cars[k].y - cars[k].l / 2, cars[k].y + cars[k].l / 2, 0.3)) cars.splice(k, 1);
    for (let k = boxes.length - 1; k >= 0; k--) if (boxes[k].kind === "car" && hit(boxes[k].x0, boxes[k].x1, boxes[k].y0, boxes[k].y1, 0.3)) boxes.splice(k, 1);
    for (let k = lines.length - 1; k >= 0; k--) if (hit(Math.min(lines[k].x0, lines[k].x1), Math.max(lines[k].x0, lines[k].x1), Math.min(lines[k].y0, lines[k].y1), Math.max(lines[k].y0, lines[k].y1), 0.1)) lines.splice(k, 1);
    for (let k = lights.length - 1; k >= 0; k--) if (hit(lights[k].x, lights[k].x, lights[k].y, lights[k].y, 0.6)) lights.splice(k, 1);
  };

  // free-slot test: only the middle of a doorway is kept clear of parked cars, so a car beside it narrows the way but never shuts it
  type Rect = { x0: number; x1: number; y0: number; y1: number };
  const SHRINK = 2.2;
  const corridors = (i: number, j: number): Rect[] => {
    const out: Rect[] = [];
    const h = CELL / 2;
    const half = (wide: boolean) => (wide ? GARAGE.GAP_WIDE : GARAGE.GAP) - SHRINK;
    if (i < COLS - 1 && openE[j][i]) out.push({ x0: cx(i) + h - 3.4, x1: cx(i) + h + 0.5, y0: cy(j) - half(wideE[j][i]), y1: cy(j) + half(wideE[j][i]) });
    if (i > 0 && openE[j][i - 1]) out.push({ x0: cx(i) - h - 0.5, x1: cx(i) - h + 3.4, y0: cy(j) - half(wideE[j][i - 1]), y1: cy(j) + half(wideE[j][i - 1]) });
    if (j < ROWS - 1 && openN[j][i]) out.push({ x0: cx(i) - half(wideN[j][i]), x1: cx(i) + half(wideN[j][i]), y0: cy(j) + h - 3.4, y1: cy(j) + h + 0.5 });
    if (j > 0 && openN[j - 1][i]) out.push({ x0: cx(i) - half(wideN[j - 1][i]), x1: cx(i) + half(wideN[j - 1][i]), y0: cy(j) - h - 0.5, y1: cy(j) - h + 3.4 });
    return out;
  };
  const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  /** The parking slots of a cell: along its north and south walls, nose to the wall, none across a doorway. */
  const slotsOf = (i: number, j: number) => {
    const clear = corridors(i, j);
    const isGoal = !arrival && i === goalCol && j === goalRow;
    const slots: { x: number; y: number; north: boolean }[] = [];
    for (const north of [true, false])
      for (const lx of [-4.5, -1.5, 1.5, 4.5]) {
        const x = cx(i) + lx;
        const y = north ? cy(j) + CELL / 2 - 0.4 - GARAGE.SLOT_L / 2 : cy(j) - CELL / 2 + 0.4 + GARAGE.SLOT_L / 2;
        const rect = { x0: x - GARAGE.SLOT_W / 2, x1: x + GARAGE.SLOT_W / 2, y0: y - GARAGE.SLOT_L / 2, y1: y + GARAGE.SLOT_L / 2 };
        if (clear.some((c) => overlap(rect, c))) continue;
        if (isGoal && rect.x1 > cx(i) + 0.5) continue; // the booth is at the east end
        if (i === 0 && j === GARAGE.ENTRY_ROW && lx === -4.5) continue; // nothing parked in front of the stairwell door (in the strip: the opening)
        slots.push({ x, y, north });
      }
    return slots;
  };

  // the cells the van stands in: spread along the path, each the nearest cell to its mark that has a free slot (never the entry or the booth)
  const vanCells = new Set<string>();
  for (let k = 1; k <= GARAGE.VANS; k++) {
    const mark = Math.round((path.length - 1) * (k / (GARAGE.VANS + 0.6)));
    for (const off of [0, 1, -1, 2, -2, 3, -3]) {
      const idx = mark + off;
      if (idx < 1 || idx > path.length - 2) continue;
      const key = `${path[idx][0]},${path[idx][1]}`;
      if (vanCells.has(key) || slotsOf(path[idx][0], path[idx][1]).length === 0) continue;
      vanCells.add(key);
      break;
    }
  }

  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++) {
      const isGoalCell = i === goalCol && j === goalRow;
      const dead = neighbours(i, j).length === 1 && !isGoalCell && !(i === 0 && j === entryRow);
      if (dead) deadEnds.push([i, j]);
      const slots = slotsOf(i, j);
      for (const s of slots) {
        // two side lines and a back line of the stall
        const x0 = s.x - GARAGE.SLOT_W / 2;
        const x1 = s.x + GARAGE.SLOT_W / 2;
        const yBack = s.north ? s.y + GARAGE.SLOT_L / 2 : s.y - GARAGE.SLOT_L / 2;
        const yFront = s.north ? s.y - GARAGE.SLOT_L / 2 : s.y + GARAGE.SLOT_L / 2;
        lines.push({ x0, y0: yBack, x1: x0, y1: yFront, color: "white" }, { x0: x1, y0: yBack, x1, y1: yFront, color: "white" });
      }
      const wantVan = vanCells.has(`${i},${j}`);
      let vanDone = !wantVan;
      for (const s of slots) {
        const noseHeading = s.north ? Math.PI / 2 : -Math.PI / 2;
        if (!vanDone) {
          vanDone = true;
          cars.push({ x: s.x, y: s.y, heading: noseHeading, van: true, color: 0, w: 1.95, l: 4.7 });
          boxes.push({ kind: "van", x0: s.x - 0.98, x1: s.x + 0.98, y0: s.y - 2.35, y1: s.y + 2.35, top: 1.85 });
          continue;
        }
        if (rand() > GARAGE.CAR_CHANCE) {
          rand(); // keep the stream steady whether or not a car is placed
          continue;
        }
        const color = 1 + Math.floor(rand() * 6);
        const len = 4.2 + rand() * 0.4;
        cars.push({ x: s.x, y: s.y + (s.north ? -0.2 : 0.2) * rand(), heading: noseHeading + (rand() - 0.5) * 0.04, van: false, color, w: 1.8, l: len });
        const c = cars[cars.length - 1];
        boxes.push({ kind: "car", x0: c.x - 0.9, x1: c.x + 0.9, y0: c.y - len / 2, y1: c.y + len / 2, top: 1.45 });
      }
      // lights: a 2 x 2 set of tubes, some flickering, some dead
      for (const [lx, ly] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) {
        const r = rand();
        lights.push({ x: cx(i) + lx, y: cy(j) + ly, state: r < 0.62 ? "on" : r < 0.84 ? "flicker" : "dead" });
      }
      if (isGoalCell && arrival) {
        // the ramp comes up from below in this dead end, its top facing the only doorway; the cell is dark like the ramp it continues
        const open = neighbours(i, j)[0];
        const side = open[0] !== i ? (open[0] > i ? "E" : "W") : open[1] > j ? "N" : "S";
        landing = rampRect(i, j, side);
        clearRamp(landing.box);
        goal.x = cx(i);
        goal.y = cy(j);
      } else if (isGoalCell) {
        // the attendant's booth against the east wall, a lit window facing west, and the payphone beside it
        const bx = COLS * CELL - W / 2;
        booth.x0 = bx - 3.2;
        booth.x1 = bx;
        booth.y0 = cy(j) - 1.6;
        booth.y1 = cy(j) + 1.6;
        boxes.push({ kind: "booth", x0: booth.x0, x1: booth.x1, y0: booth.y0, y1: booth.y1, top: 2.4 });
        boxes.push({ kind: "phone", x0: booth.x0 - 0.4, x1: booth.x0 - 0.05, y0: cy(j) + 2.0, y1: cy(j) + 2.35, top: 1.7 });
        goal.x = booth.x0 - 0.9;
        goal.y = cy(j) + 2.15;
        // the booth's lights are always on
        for (const l of lights.slice(-4)) l.state = "on";
      } else if (dead) {
        // a dead end: a ramp that climbs through the ceiling (the player walks up it), or a lone "Salida" arrow into the wall
        const coin = rand() < 0.5;
        if (!arrival && (coin || rampsMade < GARAGE.RAMPS_MIN)) {
          rampsMade++;
          const open = neighbours(i, j)[0];
          const side = open[0] !== i ? (open[0] > i ? "E" : "W") : open[1] > j ? "N" : "S";
          // the ramp rises away from the doorway: from the doorway wall (foot) to the far wall, 6 m wide
          const far = side === "E" ? "W" : side === "W" ? "E" : side === "N" ? "S" : "N";
          const r = rampRect(i, j, far);
          boxes.push(r.box);
          ramps.push(r);
          rampCells.add(`${i},${j}`);
          clearRamp(r.box);
        }
      }
    }

  // ---- signs along the guided path: normal at first, then wrong
  const p0 = path[0];
  signs.push({ x: 0.9, y: cy(p0[1]) + 1.6, facing: 0, kind: "stairs", text: "Escalera" });
  let levelAt = 0;
  for (let k = 1; k < path.length - 1; k++) {
    const [i, j] = path[k];
    const [pi, pj] = path[k - 1];
    const [ni, nj] = path[k + 1];
    const facing = Math.atan2(j - pj, i - pi); // the way the player is walking
    const ahead = Math.atan2(nj - j, ni - i);
    const t = k / (path.length - 1);
    // a level sign hangs at the cell's centre, facing the walker
    if (k % 2 === 1) signs.push({ x: cx(i), y: cy(j), facing: facing + Math.PI, kind: "level", text: t < 0.2 ? "P2" : LEVELS[Math.min(levelAt++ + 1, LEVELS.length - 1)] });
    // an exit arrow every other cell: right at first, into a wall later
    if (k % 2 === 0) {
      const wrong = t > 0.45 && rand() < 0.75;
      const into = wrong ? ahead + (rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : ahead; // perpendicular: toward a wall beside the way
      signs.push({ x: cx(i) + Math.cos(facing) * 1.2, y: cy(j) + Math.sin(facing) * 1.2, facing: facing + Math.PI, kind: "exit", text: "Salida", arrow: into, wrong });
    }
  }
  // dead ends point the wrong way as well
  for (const [i, j] of deadEnds) if (!rampCells.has(`${i},${j}`)) signs.push({ x: cx(i), y: cy(j), facing: 0, kind: "exit", text: "Salida", arrow: Math.PI, wrong: true });

  return {
    seed,
    cols: COLS,
    rows: ROWS,
    cell: CELL,
    height: HEIGHT,
    boxes,
    cars,
    lights,
    signs,
    lines,
    spawn: { x: 1.8, y: stairDoor.y, heading: 0 },
    stairDoor,
    goal,
    booth,
    ramps,
    arrival,
    landing,
    arrive: landing
      ? { x: (landing.box.x0 + landing.box.x1) / 2 + Math.cos(landing.rise) * 2.5, y: (landing.box.y0 + landing.box.y1) / 2 + Math.sin(landing.rise) * 2.5, heading: landing.rise }
      : { x: cx(COLS - 1), y: cy(goalRow), heading: Math.PI },
    path,
    openE,
    openN,
    deadEnds,
    width: COLS * CELL,
    depth: ROWS * CELL,
  };
}

/** Pushes a circle out of every box it overlaps (a few passes, so a corner settles). Returns the new position. */
export function resolveGarage(boxes: Box[], x: number, y: number, radius: number): [number, number] {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const b of boxes) {
      const nx = Math.max(b.x0, Math.min(x, b.x1));
      const ny = Math.max(b.y0, Math.min(y, b.y1));
      const dx = x - nx;
      const dy = y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= radius * radius) continue;
      moved = true;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        x += (dx / d) * (radius - d);
        y += (dy / d) * (radius - d);
      } else {
        // the centre is inside the box: leave by the nearest face
        const left = x - b.x0;
        const right = b.x1 - x;
        const down = y - b.y0;
        const up = b.y1 - y;
        const m = Math.min(left, right, down, up);
        if (m === left) x = b.x0 - radius;
        else if (m === right) x = b.x1 + radius;
        else if (m === down) y = b.y0 - radius;
        else y = b.y1 + radius;
      }
    }
    if (!moved) break;
  }
  return [x, y];
}

/** How high the floor is at (x, y) (m): 0, or up a ramp (a straight rise from its foot, at the doorway, to the far wall). */
export function rampHeight(layout: GarageLayout, x: number, y: number): number {
  let h = 0;
  const l = layout.landing;
  if (l && x >= l.box.x0 && x <= l.box.x1 && y >= l.box.y0 && y <= l.box.y1) {
    // the ramp from below: its top is the floor, its foot is `top` under it
    const horizontal = Math.abs(Math.cos(l.rise)) > 0.5;
    const len = horizontal ? l.box.x1 - l.box.x0 : l.box.y1 - l.box.y0;
    const along = horizontal ? (Math.cos(l.rise) > 0 ? x - l.box.x0 : l.box.x1 - x) : Math.sin(l.rise) > 0 ? y - l.box.y0 : l.box.y1 - y;
    return (along / len - 1) * l.box.top;
  }
  for (const { box: b, rise } of layout.ramps) {
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    const horizontal = Math.abs(Math.cos(rise)) > 0.5;
    const len = horizontal ? b.x1 - b.x0 : b.y1 - b.y0;
    const along = horizontal ? (Math.cos(rise) > 0 ? x - b.x0 : b.x1 - x) : Math.sin(rise) > 0 ? y - b.y0 : b.y1 - y;
    h = Math.max(h, (along / len) * b.top);
  }
  return h;
}

/** The part of a ramp that goes through the ceiling (plan rectangle): from where it is `RAMP_HOLE_FROM` high to its top end. */
export function rampHole(r: { box: Box; rise: number }): { x0: number; x1: number; y0: number; y1: number } {
  const b = r.box;
  const t0 = GARAGE.RAMP_HOLE_FROM / b.top;
  const horizontal = Math.abs(Math.cos(r.rise)) > 0.5;
  if (horizontal) {
    const len = b.x1 - b.x0;
    return Math.cos(r.rise) > 0 ? { ...b, x0: b.x0 + t0 * len } : { ...b, x1: b.x1 - t0 * len };
  }
  const len = b.y1 - b.y0;
  return Math.sin(r.rise) > 0 ? { ...b, y0: b.y0 + t0 * len } : { ...b, y1: b.y1 - t0 * len };
}

/** Whether the player is at the payphone. */
export const atGoal = (layout: GarageLayout, x: number, y: number) => Math.hypot(x - layout.goal.x, y - layout.goal.y) <= layout.goal.r;

/**
 * What closes the pit of an arrival garage's landing: the walls along its sides and foot (the top end is the way out);
 * once the player has stepped out of it, `shut` also covers the pit itself, so nobody walks back down.
 */
export function pitBoxes(layout: GarageLayout, shut: boolean): Box[] {
  const l = layout.landing;
  if (!l) return [];
  const b = l.box;
  const T = 0.3;
  const out: Box[] = [];
  const add = (x0: number, x1: number, y0: number, y1: number) => out.push({ kind: "wall", x0, x1, y0, y1, top: layout.height });
  if (Math.abs(Math.cos(l.rise)) > 0.5) {
    const east = Math.cos(l.rise) > 0; // the top is at the east
    add(b.x0 - T, b.x1 + T, b.y0 - T, b.y0);
    add(b.x0 - T, b.x1 + T, b.y1, b.y1 + T);
    if (east) add(b.x0 - T, b.x0, b.y0, b.y1);
    else add(b.x1, b.x1 + T, b.y0, b.y1);
  } else {
    const north = Math.sin(l.rise) > 0;
    add(b.x0 - T, b.x0, b.y0 - T, b.y1 + T);
    add(b.x1, b.x1 + T, b.y0 - T, b.y1 + T);
    if (north) add(b.x0, b.x1, b.y0 - T, b.y0);
    else add(b.x0, b.x1, b.y1, b.y1 + T);
  }
  if (shut) out.push({ ...b, kind: "wall", top: layout.height });
  return out;
}

/**
 * An arrival garage's exit doorway opens onto the mall, drawn but not part of this level's collision: a short pen outside
 * the doorway (as wide as it, 2.8 m deep) keeps the player where the mall's hall really is until the world swaps.
 */
export function exitPen(layout: GarageLayout): Box[] {
  if (!layout.arrival) return [];
  const sd = layout.stairDoor.y;
  const G = GARAGE.GAP;
  const add = (x0: number, x1: number, y0: number, y1: number): Box => ({ kind: "wall", x0, x1, y0, y1, top: layout.height });
  return [add(-2.8, 0, sd + G, sd + G + 0.3), add(-2.8, 0, sd - G - 0.3, sd - G), add(-3.1, -2.8, sd - G - 0.3, sd + G + 0.3)];
}
