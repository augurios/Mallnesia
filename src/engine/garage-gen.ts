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

export const GARAGE = {
  COLS: 7,
  ROWS: 4,
  CELL: 12,
  HEIGHT: 2.7,
  /** The default seed: the same garage every time unless the debug flag asks for another. */
  SEED: 1995,
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
  /** Ramps that climb into the ceiling, drawn as wedges: the box and the heading they rise toward. */
  ramps: { box: Box; rise: number }[];
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

export function generateGarage(seed: number = GARAGE.SEED): GarageLayout {
  const { COLS, ROWS, CELL, HEIGHT } = GARAGE;
  const rand = rng(seed);
  const cx = (i: number) => (i + 0.5) * CELL;
  const cy = (j: number) => (j + 0.5) * CELL;

  // ---- the maze: a random spanning tree (every cell reachable), then a few extra openings to make loops
  const openE: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const openN: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const wideE: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const wideN: boolean[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const entryRow = Math.floor(rand() * ROWS);
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const stack: [number, number][] = [[0, entryRow]];
  seen[entryRow][0] = true;
  const link = (i: number, j: number, di: number, dj: number) => {
    if (di === 1) openE[j][i] = true;
    else if (di === -1) openE[j][i - 1] = true;
    else if (dj === 1) openN[j][i] = true;
    else openN[j - 1][i] = true;
  };
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([di, dj]) => i + di >= 0 && i + di < COLS && j + dj >= 0 && j + dj < ROWS && !seen[j + dj][i + di]);
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
      if (i < COLS - 1 && !openE[j][i] && rand() < GARAGE.LOOP) openE[j][i] = true;
      if (j < ROWS - 1 && !openN[j][i] && rand() < GARAGE.LOOP) openN[j][i] = true;
      wideE[j][i] = rand() < GARAGE.WIDE;
      wideN[j][i] = rand() < GARAGE.WIDE;
    }

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
  let goalRow = 0;
  for (let j = 0; j < ROWS; j++) if (dist[j][COLS - 1] > dist[goalRow][COLS - 1]) goalRow = j;
  const path: [number, number][] = [];
  for (let c: [number, number] | null = [COLS - 1, goalRow]; c; c = from[c[1]][c[0]]) path.push(c);
  path.reverse();

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
      const open = i > 0 && i < COLS && openE[j][i - 1];
      if (!open) wallX(x, y0, y1);
      else {
        const g = wideE[j][i - 1] ? GARAGE.GAP_WIDE : GARAGE.GAP;
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
  boxes.push({ kind: "door", x0: -0.1, x1: 0.35, y0: stairDoor.y - 0.9, y1: stairDoor.y + 0.9, top: 2.2 });
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
    const isGoal = i === COLS - 1 && j === goalRow;
    const slots: { x: number; y: number; north: boolean }[] = [];
    for (const north of [true, false])
      for (const lx of [-4.5, -1.5, 1.5, 4.5]) {
        const x = cx(i) + lx;
        const y = north ? cy(j) + CELL / 2 - 0.4 - GARAGE.SLOT_L / 2 : cy(j) - CELL / 2 + 0.4 + GARAGE.SLOT_L / 2;
        const rect = { x0: x - GARAGE.SLOT_W / 2, x1: x + GARAGE.SLOT_W / 2, y0: y - GARAGE.SLOT_L / 2, y1: y + GARAGE.SLOT_L / 2 };
        if (clear.some((c) => overlap(rect, c))) continue;
        if (isGoal && rect.x1 > cx(i) + 0.5) continue; // the booth is at the east end
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
      const isGoalCell = i === COLS - 1 && j === goalRow;
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
      if (isGoalCell) {
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
        // a dead end: a ramp that climbs into the ceiling, or a lone "Salida" arrow into the wall
        if (rand() < 0.5) {
          const open = neighbours(i, j)[0];
          const side = open[0] !== i ? (open[0] > i ? "E" : "W") : open[1] > j ? "N" : "S";
          // the ramp rises away from the doorway: from the middle of the cell to the far wall
          const far = side === "E" ? "W" : side === "W" ? "E" : side === "N" ? "S" : "N";
          const x0 = far === "W" ? cx(i) - 5.8 : far === "E" ? cx(i) + 0.5 : cx(i) - 4;
          const x1 = far === "W" ? cx(i) - 0.5 : far === "E" ? cx(i) + 5.8 : cx(i) + 4;
          const y0 = far === "S" ? cy(j) - 5.8 : far === "N" ? cy(j) + 0.5 : cy(j) - 4;
          const y1 = far === "S" ? cy(j) - 0.5 : far === "N" ? cy(j) + 5.8 : cy(j) + 4;
          const box: Box = { kind: "ramp", x0, x1, y0, y1, top: HEIGHT - 0.05 };
          boxes.push(box);
          ramps.push({ box, rise: far === "E" ? 0 : far === "N" ? Math.PI / 2 : far === "W" ? Math.PI : -Math.PI / 2 });
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
  for (const [i, j] of deadEnds) signs.push({ x: cx(i), y: cy(j), facing: 0, kind: "exit", text: "Salida", arrow: Math.PI, wrong: true });

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

/** Whether the player is at the payphone. */
export const atGoal = (layout: GarageLayout, x: number, y: number) => Math.hypot(x - layout.goal.x, y - layout.goal.y) <= layout.goal.r;
