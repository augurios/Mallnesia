// Hiding spots: the player presses E next to one, crawls in, and while hidden the shadow notices them only from a
// step away (shadow.ts, `hidden`). No DOM and no Three.js, so scripts/test-hiding.mts runs the exact code the game runs.
//
// A spot is a piece the player can get under or behind. The first kind is the food court table: the player crouches
// under it from either end, looking out along the table. Spots come from the placed props (the same positions the
// tables are drawn at), so there is no second list to keep in step; `HIDEABLE` says which pieces count and how many.
// More kinds (abandoned cars, counters) add a rule here and their own entry geometry.
//
// Plan coordinates throughout (meters, x east, y north). Headings are plan angles (atan2(y, x)); the camera's yaw is
// converted at the edges (see `yawToHeading`).

export interface HidingSpot {
  id: string;
  /** 0-based floor. */
  floor: number;
  /** Centre of the piece. */
  x: number;
  y: number;
  /** Unit vector along the piece's long axis; the two ends are the two ways in. */
  ax: number;
  ay: number;
}

export interface HideRule {
  /** Chance (0 to 1) that a placed piece of this kind is a hiding spot. */
  chance: number;
  seed: number;
}

/** Which kit pieces can be hidden in, and how common it is. A table's long axis is the piece's local x. */
export const HIDEABLE: Record<string, HideRule> = {
  table_set: { chance: 0.3, seed: 7 },
};

export const HIDING = {
  /** The entry point is this far from the piece's centre along its axis (outside the table's collider). */
  GATE: 1.2,
  /** Where the player ends up, from the centre toward the entry end: under the top, clear of the central post. */
  INSIDE: 0.28,
  /** The player can start hiding from this close to the entry point... */
  REACH: 1.1,
  /** ...when looking roughly toward the table (half angle, degrees). */
  REACH_CONE: 70,
  /** Seconds to crawl in and out. */
  ENTER_TIME: 0.8,
  LEAVE_TIME: 0.6,
  /** How far (degrees) the player can turn the head either side of straight out while hidden. */
  LOOK_YAW: 65,
  /** Pitch limits (radians) while hidden: the table's underside is just above and behind. */
  LOOK_PITCH_UP: 1.0,
  LOOK_PITCH_DOWN: -0.7,
  /** Eye height (meters) when fully hidden. The standing eye height is the runtime's. */
  HIDDEN_EYE: 0.55,
  /** How fast the view turns toward straight out while crawling in (1/s). */
  TURN_RATE: 6,
};

const REACH_COS = Math.cos((HIDING.REACH_CONE * Math.PI) / 180);
const smooth = (t: number) => t * t * (3 - 2 * t);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The camera yaw (three.js, rotation about y) as a plan heading, and back. Forward is (-sin yaw, cos yaw) in plan. */
export const yawToHeading = (yaw: number) => Math.atan2(Math.cos(yaw), -Math.sin(yaw));
export const headingToYaw = (heading: number) => Math.atan2(-Math.cos(heading), Math.sin(heading));

/** A tiny deterministic generator, so the same tables are hideable on every run. */
function hash(seed: number, i: number): number {
  let t = (seed * 0x9e3779b1 + i * 0x85ebca6b) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The hiding spots among the placed props. `instances` is the props manifest: per piece, flat groups of
 * [x, height, -y, yaw] (see props.ts); `floorHeight` turns the height into a floor.
 */
export function spotsFromProps(instances: Record<string, number[]>, floorHeight: number, rules: Record<string, HideRule> = HIDEABLE): HidingSpot[] {
  const out: HidingSpot[] = [];
  for (const [piece, rule] of Object.entries(rules)) {
    const flat = instances[piece];
    if (!flat) continue;
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const k = i / 4;
      if (hash(rule.seed, k) >= rule.chance) continue;
      const yaw = flat[i + 3];
      out.push({ id: `${piece}#${k}`, floor: Math.round(flat[i + 1] / floorHeight), x: flat[i], y: -flat[i + 2], ax: Math.cos(yaw), ay: Math.sin(yaw) });
    }
  }
  return out;
}

/** A spot and which end of it the player would use (+1 or -1 along its axis). */
export interface Entry {
  spot: HidingSpot;
  end: 1 | -1;
}

export type HidingState = "out" | "entering" | "in" | "leaving";

/** Where the player is while a hide is under way: the position, how crouched (0 standing, 1 hidden) and the view yaw. */
export interface HidePose {
  x: number;
  y: number;
  crouch: number;
  yaw: number;
}

export class Hiding {
  state: HidingState = "out";
  spots: HidingSpot[];
  private entry: Entry | null = null;
  private from: [number, number] = [0, 0];
  private t = 0;
  private yaw = 0;

  constructor(spots: HidingSpot[] = []) {
    this.spots = spots;
  }

  /** Something is going on (crawling in, hidden or crawling out): the player does not walk. */
  get active() {
    return this.state !== "out";
  }

  /**
   * The shadow's rule applies: from halfway through crawling in until halfway through crawling out. The spot and end
   * in use are in `entry`.
   */
  get hidden() {
    return this.state === "in" || (this.state === "entering" && this.t > 0.5) || (this.state === "leaving" && this.t < 0.5);
  }

  get current(): Entry | null {
    return this.entry;
  }

  private gate(e: Entry): [number, number] {
    return [e.spot.x + e.end * e.spot.ax * HIDING.GATE, e.spot.y + e.end * e.spot.ay * HIDING.GATE];
  }
  private inside(e: Entry): [number, number] {
    return [e.spot.x + e.end * e.spot.ax * HIDING.INSIDE, e.spot.y + e.end * e.spot.ay * HIDING.INSIDE];
  }
  /** The heading that looks straight out of the spot. */
  private outHeading(e: Entry) {
    return Math.atan2(e.end * e.spot.ay, e.end * e.spot.ax);
  }

  /** The nearest way in the player can use now: close to an entry point, on its floor, looking toward the piece. */
  usable(x: number, y: number, floor: number, heading: number): Entry | null {
    if (this.active) return null;
    const hx = Math.cos(heading);
    const hy = Math.sin(heading);
    let best: Entry | null = null;
    let bestD = Infinity;
    for (const spot of this.spots) {
      if (spot.floor !== floor) continue;
      for (const end of [1, -1] as const) {
        const e: Entry = { spot, end };
        const [gx, gy] = this.gate(e);
        const d = Math.hypot(gx - x, gy - y);
        if (d > HIDING.REACH || d >= bestD) continue;
        const tx = spot.x - x;
        const ty = spot.y - y;
        const tl = Math.hypot(tx, ty);
        if (tl > 1e-6 && (tx * hx + ty * hy) / tl < REACH_COS) continue;
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Starts crawling in from where the player stands, with the view as it is. */
  enter(e: Entry, x: number, y: number, yaw: number) {
    if (this.active) return;
    this.entry = e;
    this.from = [x, y];
    this.state = "entering";
    this.t = 0;
    this.yaw = yaw;
  }

  /** E again: crawl out. Only once fully in. */
  leave(): boolean {
    if (this.state !== "in" || !this.entry) return false;
    this.from = this.inside(this.entry);
    this.state = "leaving";
    this.t = 0;
    return true;
  }

  /** Drops any hide at once (a load, a respawn). */
  reset() {
    this.state = "out";
    this.entry = null;
    this.t = 0;
  }

  /**
   * Advances a hide. `yaw` is the camera yaw the mouse has produced this frame. Returns the pose to apply while a hide
   * is under way (including the frame it ends, standing at the exit point), or null when the player is walking.
   */
  update(dt: number, yaw: number): HidePose | null {
    const e = this.entry;
    if (this.state === "out" || !e) return null;
    const face = headingToYaw(this.outHeading(e));
    if (this.state === "entering") {
      this.t = Math.min(1, this.t + dt / HIDING.ENTER_TIME);
      const to = this.inside(e);
      const k = smooth(this.t);
      // The view turns to look out of the spot as the player crawls in, the shorter way round.
      this.yaw += wrap(face - this.yaw) * (1 - Math.exp(-HIDING.TURN_RATE * dt));
      if (this.t >= 1) {
        this.state = "in";
        this.yaw = face;
      }
      return { x: this.from[0] + (to[0] - this.from[0]) * k, y: this.from[1] + (to[1] - this.from[1]) * k, crouch: k, yaw: this.yaw };
    }
    if (this.state === "in") {
      const lim = (HIDING.LOOK_YAW * Math.PI) / 180;
      const [x, y] = this.inside(e);
      this.yaw = face + Math.max(-lim, Math.min(lim, wrap(yaw - face)));
      return { x, y, crouch: 1, yaw: this.yaw };
    }
    // leaving
    this.t = Math.min(1, this.t + dt / HIDING.LEAVE_TIME);
    const to = this.gate(e);
    const k = smooth(this.t);
    const pose = { x: this.from[0] + (to[0] - this.from[0]) * k, y: this.from[1] + (to[1] - this.from[1]) * k, crouch: 1 - k, yaw };
    if (this.t >= 1) {
      this.state = "out";
      this.entry = null;
    }
    return pose;
  }
}
