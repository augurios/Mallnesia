// The shadow's map of the mall: where a person can stand, and what blocks sight. No DOM and no Three.js, so
// scripts/test-shadow.mts runs the exact code the game runs. Built by scripts/build-nav.mts (public/models/nav.json),
// 1 m cells, one pair of planes per floor. Plan coordinates throughout (meters, x east, y north).
//
// Stairs are not on the map: the shadow stays on one floor (see shadow.ts). The guard uses them: `stairs` are links
// between floors (one per flight pair, built by scripts/build-nav.mts) and `findRoute` plans a walk across floors.

export interface NavData {
  cell: number;
  nx: number;
  ny: number;
  floors: { walk: string; opaque: string }[];
  stairs?: StairLink[];
}

export type Pt = [number, number];

/** One stair between `floor` and the floor above: plan points with heights (m) above `floor`, from a hall cell at its
 * foot to one at its top. */
export interface StairLink {
  id: string;
  floor: number;
  pts: [number, number, number][];
}

/** A point of a walk across floors: plan x, y, and the height in meters above the ground floor. */
export type RoutePt = [number, number, number];

const pathLength = (x: number, y: number, pts: Pt[]) => {
  let len = 0;
  for (const [px, py] of pts) {
    len += Math.hypot(px - x, py - y);
    x = px;
    y = py;
  }
  return len;
};

const decode = (b64: string, count: number): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
};

const SQRT2 = Math.SQRT2;
const STEP = 0.2; // meters between samples along a line
const BODY = 0.35; // half width kept clear when the shadow cuts a corner

export class NavGrid {
  readonly nx: number;
  readonly ny: number;
  readonly cell: number;
  private walk: Uint8Array[];
  private opaque: Uint8Array[];
  // A* scratch, reused: a stamp per cell says whether the arrays hold this search's values.
  private g: Float32Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private run = 0;
  /** The stairs between floors (empty when the data has none). */
  stairs: StairLink[] = [];

  constructor(nx: number, ny: number, cell: number, floors: { walk: Uint8Array; opaque: Uint8Array }[]) {
    this.nx = nx;
    this.ny = ny;
    this.cell = cell;
    this.walk = floors.map((f) => f.walk);
    this.opaque = floors.map((f) => f.opaque);
    this.g = new Float32Array(nx * ny);
    this.from = new Int32Array(nx * ny);
    this.stamp = new Uint32Array(nx * ny);
    this.closed = new Uint32Array(nx * ny);
  }

  static fromData(data: NavData): NavGrid {
    const n = data.nx * data.ny;
    const nav = new NavGrid(data.nx, data.ny, data.cell, data.floors.map((f) => ({ walk: decode(f.walk, n), opaque: decode(f.opaque, n) })));
    nav.stairs = data.stairs ?? [];
    return nav;
  }

  /**
   * The shortest walk from a point on one floor to a point on another (or the same) floor, taking the stairs: every
   * choice of stair for each floor crossed is tried. `floorHeight` turns floors into heights. Null if there is no way.
   */
  findRoute(f0: number, x0: number, y0: number, f1: number, x1: number, y1: number, floorHeight: number): { pts: RoutePt[]; length: number } | null {
    const step = f1 > f0 ? 1 : -1;
    // the stair choices for each floor crossed, in walking order
    const crossings: { link: StairLink; up: boolean }[][] = [];
    for (let f = f0; f !== f1; f += step) {
      const lower = step > 0 ? f : f - 1;
      crossings.push(this.stairs.filter((s) => s.floor === lower).map((link) => ({ link, up: step > 0 })));
      if (!crossings[crossings.length - 1].length) return null;
    }
    const legs = new Map<string, { pts: Pt[]; length: number } | null>();
    const leg = (f: number, ax: number, ay: number, bx: number, by: number) => {
      const key = `${f}:${ax},${ay}:${bx},${by}`;
      if (!legs.has(key)) {
        const pts = this.findPath(f, ax, ay, bx, by);
        legs.set(key, pts ? { pts, length: pathLength(ax, ay, pts) } : null);
      }
      return legs.get(key)!;
    };
    let best: { pts: RoutePt[]; length: number } | null = null;
    const choose = (k: number, picked: { link: StairLink; up: boolean }[]) => {
      if (k < crossings.length) {
        for (const c of crossings[k]) choose(k + 1, [...picked, c]);
        return;
      }
      const pts: RoutePt[] = [];
      let length = 0;
      let f = f0;
      let x = x0;
      let y = y0;
      for (const { link, up } of picked) {
        const walk = up ? link.pts : [...link.pts].reverse();
        const l = leg(f, x, y, walk[0][0], walk[0][1]);
        if (!l) return;
        length += l.length;
        for (const [px, py] of l.pts) pts.push([px, py, f * floorHeight]);
        for (let i = 1; i < walk.length; i++) {
          const [ax, ay, ah] = walk[i - 1];
          const [bx, by, bh] = walk[i];
          length += Math.hypot(bx - ax, by - ay, bh - ah);
          pts.push([bx, by, link.floor * floorHeight + bh]);
        }
        f += up ? 1 : -1;
        [x, y] = [walk[walk.length - 1][0], walk[walk.length - 1][1]];
        if (best && length >= best.length) return;
      }
      const l = leg(f, x, y, x1, y1);
      if (!l) return;
      length += l.length;
      for (const [px, py] of l.pts) pts.push([px, py, f * floorHeight]);
      if (!best || length < best.length) best = { pts, length };
    };
    choose(0, []);
    return best;
  }

  /** Closes a rectangle (plan meters) on every floor: nobody walks there and sight does not enter (the parking strip, dressed as the garage). */
  blockRect(x0: number, y0: number, x1: number, y1: number) {
    const i0 = Math.max(0, Math.floor(x0 / this.cell));
    const i1 = Math.min(this.nx - 1, Math.ceil(x1 / this.cell) - 1);
    const j0 = Math.max(0, Math.floor(y0 / this.cell));
    const j1 = Math.min(this.ny - 1, Math.ceil(y1 / this.cell) - 1);
    for (let f = 0; f < this.walk.length; f++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          this.walk[f][j * this.nx + i] = 0;
          this.opaque[f][j * this.nx + i] = 1;
        }
  }

  get floorCount() {
    return this.walk.length;
  }

  private idx(x: number, y: number) {
    const i = Math.floor(x / this.cell);
    const j = Math.floor(y / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? -1 : j * this.nx + i;
  }

  walkable(floor: number, x: number, y: number): boolean {
    const k = this.idx(x, y);
    return k >= 0 && this.walk[floor]?.[k] === 1;
  }

  /** The center of the cell holding the point. */
  center(x: number, y: number): Pt {
    return [(Math.floor(x / this.cell) + 0.5) * this.cell, (Math.floor(y / this.cell) + 0.5) * this.cell];
  }

  /** A walkable spot near the point (the point itself if it is one), searching outward in rings up to `maxRing` cells. */
  nearestWalkable(floor: number, x: number, y: number, maxRing = 6): Pt | null {
    if (this.walkable(floor, x, y)) return [x, y];
    const ci = Math.floor(x / this.cell);
    const cj = Math.floor(y / this.cell);
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let r = 1; r <= maxRing; r++) {
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny || this.walk[floor][j * this.nx + i] !== 1) continue;
          const px = (i + 0.5) * this.cell;
          const py = (j + 0.5) * this.cell;
          const d = Math.hypot(px - x, py - y);
          if (d < bestD) {
            bestD = d;
            best = [px, py];
          }
        }
      if (best) return best;
    }
    return null;
  }

  /** True when no wall or solid block stands between the two points (sight). Voids, glass and low props do not block. */
  sees(floor: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const plane = this.opaque[floor];
    if (!plane) return false;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / STEP));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const k = this.idx(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (k < 0 || plane[k] === 1) return false;
    }
    return true;
  }

  /** True when a body can walk the straight line: it and a strip BODY wide either side stay on walkable cells. */
  private clearWalk(floor: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const plane = this.walk[floor];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1e-6) return true;
    const nx = -(y1 - y0) / d;
    const ny = (x1 - x0) / d;
    const n = Math.max(1, Math.ceil(d / STEP));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      for (const o of [0, BODY, -BODY]) {
        const k = this.idx(px + nx * o, py + ny * o);
        if (k < 0 || plane[k] !== 1) return false;
      }
    }
    return true;
  }

  /**
   * A path from one point to another on one floor, as waypoints to walk to in order (the start is not included; the
   * last one is the goal). A goal or start that is not on a walkable cell is moved to the nearest one. Null if there
   * is no way. Corners are cut wherever a body fits.
   */
  findPath(floor: number, x0: number, y0: number, x1: number, y1: number): Pt[] | null {
    if (!this.walk[floor]) return null;
    const start = this.nearestWalkable(floor, x0, y0);
    const goal = this.nearestWalkable(floor, x1, y1);
    if (!start || !goal) return null;
    const goalPoint: Pt = this.walkable(floor, x1, y1) ? [x1, y1] : goal;
    const s = this.idx(start[0], start[1]);
    const t = this.idx(goal[0], goal[1]);
    if (s === t) return [goalPoint];
    const plane = this.walk[floor];
    const run = ++this.run;
    const nx = this.nx;
    const gx = t % nx;
    const gy = Math.floor(t / nx);
    const h = (k: number) => {
      const dx = Math.abs((k % nx) - gx);
      const dy = Math.abs(Math.floor(k / nx) - gy);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy); // octile distance
    };
    // A binary heap of [f, cell] pairs, kept in two arrays.
    const hf: number[] = [];
    const hk: number[] = [];
    const push = (f: number, k: number) => {
      let i = hf.length;
      hf.push(f);
      hk.push(k);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hf[p] <= hf[i]) break;
        [hf[p], hf[i]] = [hf[i], hf[p]];
        [hk[p], hk[i]] = [hk[i], hk[p]];
        i = p;
      }
    };
    const pop = () => {
      const k = hk[0];
      const lf = hf.pop()!;
      const lk = hk.pop()!;
      if (hf.length) {
        hf[0] = lf;
        hk[0] = lk;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < hf.length && hf[l] < hf[m]) m = l;
          if (r < hf.length && hf[r] < hf[m]) m = r;
          if (m === i) break;
          [hf[m], hf[i]] = [hf[i], hf[m]];
          [hk[m], hk[i]] = [hk[i], hk[m]];
          i = m;
        }
      }
      return k;
    };
    this.g[s] = 0;
    this.from[s] = -1;
    this.stamp[s] = run;
    push(h(s), s);
    let found = false;
    while (hf.length) {
      const k = pop();
      if (this.closed[k] === run) continue;
      this.closed[k] = run;
      if (k === t) {
        found = true;
        break;
      }
      const ki = k % nx;
      const kj = Math.floor(k / nx);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ki + di;
          const j = kj + dj;
          if (i < 0 || j < 0 || i >= nx || j >= this.ny) continue;
          const m = j * nx + i;
          if (plane[m] !== 1 || this.closed[m] === run) continue;
          if (di && dj && (plane[kj * nx + i] !== 1 || plane[j * nx + ki] !== 1)) continue; // no cutting a corner
          const cost = this.g[k] + (di && dj ? SQRT2 : 1);
          if (this.stamp[m] !== run || cost < this.g[m]) {
            this.stamp[m] = run;
            this.g[m] = cost;
            this.from[m] = k;
            push(cost + h(m), m);
          }
        }
    }
    if (!found) return null;
    const cells: Pt[] = [];
    for (let k = t; k !== -1; k = this.from[k]) cells.push([((k % nx) + 0.5) * this.cell, (Math.floor(k / nx) + 0.5) * this.cell]);
    cells.reverse(); // start cell first
    cells[0] = [x0, y0] as Pt; // leave from where the body really is
    cells[cells.length - 1] = goalPoint;
    // String pulling: from each point, jump to the farthest one a body can walk straight to.
    const out: Pt[] = [];
    let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !this.clearWalk(floor, cells[a][0], cells[a][1], cells[b][0], cells[b][1])) b--;
      out.push(cells[b]);
      a = b;
    }
    return out;
  }

  /** A random walkable spot on the floor whose straight-line distance from (x, y) is between `min` and `max`. */
  randomSpot(floor: number, x: number, y: number, min: number, max: number, rand: () => number, accept?: (px: number, py: number) => boolean, tries = 200): Pt | null {
    for (let n = 0; n < tries; n++) {
      const a = rand() * Math.PI * 2;
      const d = min + rand() * (max - min);
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      if (!this.walkable(floor, px, py)) continue;
      const c = this.center(px, py);
      if (accept && !accept(c[0], c[1])) continue;
      return c;
    }
    return null;
  }
}
