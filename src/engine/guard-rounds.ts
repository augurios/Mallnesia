// The guard's rounds and the guard ending (CLAUDE.md, "Opening and the guard" and "Winning"). After the opening scene
// he is gone. Once the player has done some scouting for an exit (exploration, not a timer) he returns: a real, ordinary
// worker walking a loose patrol between fixed checkpoints (food court, atrium, the garage stairwell door, the lobby),
// in an order the mall reshuffles every lap. Finding him is audio first: keys, radio, footsteps and a flashlight far down
// a hall come before sight. The mall interferes at low sanity (cues go quiet or point the wrong way); if the player has
// been lost for minutes the cues get clearer. Meeting him is the win: he walks the player to the nearest exit (by the
// length of the walk, up or down the stairs), while the mall throws everything it has at them to keep them (escort.ts).
// He sees none of it. Fall too far behind for too long, faint or be caught, and the mall takes him: he is back on his
// rounds somewhere else, to be found again. No DOM and no Three.js, so scripts/test-rounds.mts runs the exact code the
// game runs.
import type { NavGrid, Pt, RoutePt } from "./nav";

export const ROUNDS = {
  /** Scouting needed before he returns: 8 m cells walked on, plus notes and the garage. */
  CELL: 8,
  RETURN_SCORE: 60,
  NOTE_SCORE: 12,
  GARAGE_SCORE: 25,
  /** Patrol: walking speed (m/s), pause at each checkpoint (s), and the delay when the mall moves him to another floor (s). */
  SPEED: 1.25,
  PAUSE: [6, 10] as [number, number],
  RELOCATE_DELAY: [25, 45] as [number, number],
  /** He notices the player and the encounter begins within this distance, in line of sight. */
  MEET_DISTANCE: 3.6,
  /** Escort: speed, and he waits when the player is farther than this (meters, counting height, so stairs too). */
  ESCORT_SPEED: 1.45,
  ESCORT_WAIT: 9,
  /** He calls back this often (s) while he waits. */
  CALL_EVERY: 7,
  /** Lost: the player farther than ESCORT_WAIT this long (s) and the mall takes him, as soon as he is out of their sight. */
  LOSE_AFTER: 45,
  /** Once taken (or after a faint or a catch) he is back on his rounds after this long (s), somewhere else. */
  TAKEN_DELAY: [50, 80] as [number, number],
  /** The player must be this close when he reaches the exit. */
  ARRIVE_PLAYER: 7,
  /** Floor to floor (m); keep in sync with walk.ts. */
  FLOOR_H: 5,
  /** Cue timers (seconds between). */
  KEYS: [1.7, 2.6] as [number, number],
  RADIO: [9, 17] as [number, number],
  STEP: 0.56,
  /** Cue audible range (m), and how much farther when the player is lost. */
  RANGE: 34,
  PITY_RANGE: 1.5,
  /** Seconds after he returns, without meeting him, that count as lost: the cues get clearer. */
  LOST_AFTER: 240,
  /** Below this sanity the mall interferes: cues lie (point the wrong way) or go quiet. */
  INTERFERE_BELOW: 0.45,
  MAX_LIE: 0.7,
  QUIET_BELOW: 0.25,
  MAX_QUIET: 0.4,
};

export interface Checkpoint {
  id: string;
  label: string;
  floor: number;
  x: number;
  y: number;
}

/** The places he stops, as plain data: the food court on two floors, the atrium on two, the garage stairwell door's strip, the lobby. */
export const CHECKPOINTS: Checkpoint[] = [
  { id: "comidas", label: "Comidas", floor: 1, x: 60, y: 12 },
  { id: "atrio", label: "Atrio", floor: 1, x: 48, y: 98 },
  { id: "parqueo", label: "Escalera del parqueo", floor: 1, x: 14, y: 90 },
  { id: "entrada", label: "Entrada", floor: 0, x: 72, y: 28 },
  { id: "atrio_pb", label: "Atrio planta baja", floor: 0, x: 60, y: 90 },
  { id: "comidas_3", label: "Comidas tercer piso", floor: 2, x: 70, y: 20 },
];

export interface Exit {
  id: string;
  label: string;
  floor: number;
  x: number;
  y: number;
}

/** The ways out he knows: the main entrance and the side exit on floor 1, and the north exit at the end of floor 2's
 * narrow hall. He takes whichever is the shortest walk from where he meets the player. */
export const EXITS: Exit[] = [
  { id: "main", label: "Entrada principal", floor: 0, x: 74.5, y: 8.8 },
  { id: "side", label: "Salida lateral", floor: 0, x: 31.5, y: 41.5 },
  { id: "north", label: "Salida norte", floor: 1, x: 51, y: 199.5 },
];

/** How much of the mall the player has scouted: new 8 m cells walked on, notes read, the garage visited. */
export class Exploration {
  private cells = new Set<string>();
  private notes = 0;
  private garage = false;
  visit(floor: number, x: number, y: number) {
    this.cells.add(`${floor}:${Math.floor(x / ROUNDS.CELL)}:${Math.floor(y / ROUNDS.CELL)}`);
  }
  noteRead() {
    this.notes++;
  }
  visitedGarage() {
    this.garage = true;
  }
  get score(): number {
    return this.cells.size + this.notes * ROUNDS.NOTE_SCORE + (this.garage ? ROUNDS.GARAGE_SCORE : 0);
  }
  get ready(): boolean {
    return this.score >= ROUNDS.RETURN_SCORE;
  }
  reset() {
    this.cells.clear();
    this.notes = 0;
    this.garage = false;
  }
}

export type CueKind = "keys" | "radio" | "step";

/**
 * How a cue reaches the player at this sanity. Lost for a long time: always true, louder, farther. Low sanity: it may
 * point the wrong way (`lie`) or not come at all (`quiet`).
 */
export function cueEffect(sanity: number, lost: boolean, roll1: number, roll2: number): { gain: number; range: number; lie: boolean; quiet: boolean } {
  if (lost) return { gain: 1.6, range: ROUNDS.RANGE * ROUNDS.PITY_RANGE, lie: false, quiet: false };
  const lieChance = sanity < ROUNDS.INTERFERE_BELOW ? ROUNDS.MAX_LIE * (1 - sanity / ROUNDS.INTERFERE_BELOW) : 0;
  const quietChance = sanity < ROUNDS.QUIET_BELOW ? ROUNDS.MAX_QUIET * (1 - sanity / ROUNDS.QUIET_BELOW) : 0;
  return { gain: 1, range: ROUNDS.RANGE, lie: roll1 < lieChance, quiet: roll2 < quietChance };
}

export type RoundsPhase = "absent" | "patrolling" | "meeting" | "escort" | "done";

export type RoundsEvent =
  | { type: "returned" }
  | { type: "cue"; cue: CueKind }
  | { type: "meet" }
  | { type: "escort_start" }
  | { type: "waiting" }
  | { type: "taken" }
  | { type: "arrived" };

export interface RoundsContext {
  nav: NavGrid;
  px: number;
  py: number;
  floor: number;
  /** The player's height above the ground floor (m); floor x FLOOR_H when not given. */
  pz?: number;
  /** Whether the player can see the plan point (so he never pops into view). */
  seenBy(x: number, y: number, floor: number): boolean;
}

export class GuardRounds {
  phase: RoundsPhase = "absent";
  x = 0;
  y = 0;
  floor = 0;
  /** Height above the ground floor (m): floor x FLOOR_H, except on the stairs. */
  z = 0;
  facing = 0;
  walking = false;
  /** The escort: where he is taking the player, and the walk there. */
  exit: Exit | null = null;
  private escortRoute: RoutePt[] = [];
  private escortLength = 0;
  /** Seconds the player has been too far behind. */
  behind = 0;
  /** Seconds before he can be back on his rounds (after being taken, a faint or a catch). */
  away = 0;
  /** Seconds since he returned and was not yet met. */
  sinceReturn = 0;
  /** Where he is heading (the checkpoint, or the exit). */
  target: Checkpoint | null = null;
  private route: Checkpoint[] = [];
  private path: Pt[] = [];
  private pause = 0;
  private relocate = 0;
  private cueKeys = 0;
  private cueRadio = 0;
  private cueStep = 0;
  private waitCall = 0;
  private rand: () => number;
  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  /** Visible to draw: patrolling (not mid-relocation), meeting or escorting. */
  get present(): boolean {
    return (this.phase === "patrolling" && this.relocate <= 0) || this.phase === "meeting" || this.phase === "escort";
  }

  private between([a, b]: [number, number]) {
    return a + this.rand() * (b - a);
  }

  /** The mall reshuffles the order of the rounds every lap. */
  private shuffled(avoidFirst: string | null): Checkpoint[] {
    const list = [...CHECKPOINTS];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    if (avoidFirst && list[0].id === avoidFirst) [list[0], list[1]] = [list[1], list[0]];
    return list;
  }

  private nextCheckpoint(): Checkpoint {
    if (this.route.length === 0) this.route = this.shuffled(this.target?.id ?? null);
    return this.route.shift()!;
  }

  /** Brings him back: he appears at a checkpoint the player cannot see. Returns false if every one is in sight, or he is
   * still away (try later). */
  start(ctx: RoundsContext): boolean {
    if (this.away > 0) return false;
    const options = this.shuffled(null).filter((c) => !ctx.seenBy(c.x, c.y, c.floor) && (c.floor !== ctx.floor || Math.hypot(c.x - ctx.px, c.y - ctx.py) > 14));
    const at = options[0];
    if (!at) return false;
    this.phase = "patrolling";
    this.x = at.x;
    this.y = at.y;
    this.floor = at.floor;
    this.z = at.floor * ROUNDS.FLOOR_H;
    this.target = at;
    this.pause = this.between(ROUNDS.PAUSE);
    this.sinceReturn = 0;
    this.route = this.shuffled(at.id).filter((c) => c.id !== at.id);
    this.cueKeys = 1;
    this.cueRadio = 3;
    return true;
  }

  /** Ends the patrol and starts the escort (the dialogue is over): to the exit that is the shortest walk from here.
   * Returns the exit, or null if none can be reached (then he stays where he is). */
  beginEscort(nav: NavGrid): Exit | null {
    if (this.phase !== "meeting") return null;
    let best: { exit: Exit; pts: RoutePt[]; length: number } | null = null;
    for (const exit of EXITS) {
      const r = nav.findRoute(this.floor, this.x, this.y, exit.floor, exit.x, exit.y, ROUNDS.FLOOR_H);
      if (r && (!best || r.length < best.length)) best = { exit, ...r };
    }
    if (!best) return null;
    this.phase = "escort";
    this.exit = best.exit;
    this.escortRoute = best.pts;
    this.escortLength = best.length;
    this.waitCall = 0;
    this.behind = 0;
    return best.exit;
  }

  /** How much of the walk to the exit is done, 0 to 1 (0 outside the escort). */
  get progress(): number {
    if (this.phase === "done") return 1;
    if (this.phase !== "escort" || this.escortLength <= 0) return 0;
    return Math.max(0, Math.min(1, 1 - this.remaining / this.escortLength));
  }

  /** Meters of the walk left to the exit. */
  get remaining(): number {
    let len = 0;
    let [x, y, z] = [this.x, this.y, this.z];
    for (const [px, py, pz] of this.escortRoute) {
      len += Math.hypot(px - x, py - y, pz - z);
      [x, y, z] = [px, py, pz];
    }
    return len;
  }

  /** The escort's walk still ahead of him (plan points with heights). */
  get routeAhead(): readonly RoutePt[] {
    return this.escortRoute;
  }

  /** Walks the escort's route (across floors) at `speed`; true once at its end. */
  private walkRoute(dt: number, speed: number): boolean {
    let move = speed * dt;
    this.walking = false;
    while (move > 0 && this.escortRoute.length) {
      const [tx, ty, tz] = this.escortRoute[0];
      const d = Math.hypot(tx - this.x, ty - this.y, tz - this.z);
      const step = Math.min(move, d);
      if (d > 1e-6) {
        const f = step / d;
        if (Math.hypot(tx - this.x, ty - this.y) > 1e-3) this.facing = Math.atan2(ty - this.y, tx - this.x);
        this.x += (tx - this.x) * f;
        this.y += (ty - this.y) * f;
        this.z += (tz - this.z) * f;
        this.walking = true;
      }
      move -= step;
      if (step >= d - 1e-6) this.escortRoute.shift();
    }
    this.floor = Math.max(0, Math.floor((this.z + 0.6) / ROUNDS.FLOOR_H));
    return this.escortRoute.length === 0;
  }

  private walk(dt: number, ctx: RoundsContext, speed: number, goalX: number, goalY: number): boolean {
    if (this.path.length === 0) this.path = ctx.nav.findPath(this.floor, this.x, this.y, goalX, goalY) ?? [];
    let move = speed * dt;
    this.walking = false;
    while (move > 0 && this.path.length) {
      const [tx, ty] = this.path[0];
      const d = Math.hypot(tx - this.x, ty - this.y);
      const step = Math.min(move, d);
      if (d > 1e-6) {
        this.x += ((tx - this.x) / d) * step;
        this.y += ((ty - this.y) / d) * step;
        this.facing = Math.atan2(ty - this.y, tx - this.x);
        this.walking = true;
      }
      move -= step;
      if (step >= d - 1e-6) this.path.shift();
    }
    return Math.hypot(goalX - this.x, goalY - this.y) < 0.8 || (this.path.length === 0 && this.walking === false);
  }

  update(dt: number, ctx: RoundsContext): RoundsEvent[] {
    const events: RoundsEvent[] = [];
    if (this.phase === "absent") this.away = Math.max(0, this.away - dt);
    if (this.phase === "absent" || this.phase === "done") return events;
    if (this.phase === "meeting") {
      this.walking = false;
      this.facing = Math.atan2(ctx.py - this.y, ctx.px - this.x); // he turns to the player
      return events;
    }
    if (this.phase === "patrolling") {
      this.sinceReturn += dt;
      if (this.relocate > 0) {
        // the mall has moved him to another floor: he is somewhere else until the delay ends, and then only where the player cannot see
        this.relocate -= dt;
        if (this.relocate <= 0 && this.target && ctx.seenBy(this.target.x, this.target.y, this.target.floor)) this.relocate = 3;
        else if (this.relocate <= 0 && this.target) {
          this.floor = this.target.floor;
          this.z = this.floor * ROUNDS.FLOOR_H;
          this.x = this.target.x;
          this.y = this.target.y;
          this.path = [];
          this.pause = this.between(ROUNDS.PAUSE);
        }
        return events;
      }
      const t = this.target!;
      if (this.pause > 0) {
        this.walking = false;
        this.pause -= dt;
        if (this.pause <= 0) {
          this.target = this.nextCheckpoint();
          this.path = [];
          if (this.target.floor !== this.floor) this.relocate = this.between(ROUNDS.RELOCATE_DELAY);
        }
      } else {
        const arrived = this.walk(dt, ctx, ROUNDS.SPEED, t.x, t.y);
        if (arrived && Math.hypot(t.x - this.x, t.y - this.y) < 1.2) this.pause = this.between(ROUNDS.PAUSE);
        else if (arrived && this.path.length === 0 && !this.walking) {
          // no way to it: the mall carries him
          this.target = this.nextCheckpoint();
          this.relocate = this.between(ROUNDS.RELOCATE_DELAY);
        }
      }
      // cues: keys when he walks, the radio now and then, a footstep per step
      if (this.walking) {
        this.cueKeys -= dt;
        if (this.cueKeys <= 0) {
          events.push({ type: "cue", cue: "keys" });
          this.cueKeys = this.between(ROUNDS.KEYS);
        }
        this.cueStep -= dt;
        if (this.cueStep <= 0) {
          events.push({ type: "cue", cue: "step" });
          this.cueStep = ROUNDS.STEP;
        }
      }
      this.cueRadio -= dt;
      if (this.cueRadio <= 0) {
        events.push({ type: "cue", cue: "radio" });
        this.cueRadio = this.between(ROUNDS.RADIO);
      }
      // meeting: close, same floor, in line of sight
      if (this.floor === ctx.floor && Math.hypot(this.x - ctx.px, this.y - ctx.py) <= ROUNDS.MEET_DISTANCE && ctx.nav.sees(this.floor, this.x, this.y, ctx.px, ctx.py)) {
        this.phase = "meeting";
        this.walking = false;
        events.push({ type: "meet" });
      }
      return events;
    }
    // escort: he walks to the exit, up or down the stairs, waiting for the player when they fall behind
    const pz = ctx.pz ?? ctx.floor * ROUNDS.FLOOR_H;
    const apart = Math.hypot(this.x - ctx.px, this.y - ctx.py, this.z - pz);
    if (apart > ROUNDS.ESCORT_WAIT) {
      this.walking = false;
      this.behind += dt;
      if (this.behind > ROUNDS.LOSE_AFTER && !ctx.seenBy(this.x, this.y, this.floor)) {
        // the mall takes him: gone the moment the player is not looking, back on his rounds later, somewhere else
        this.reset(this.between(ROUNDS.TAKEN_DELAY));
        events.push({ type: "taken" });
        return events;
      }
      this.waitCall -= dt;
      if (this.waitCall <= 0) {
        events.push({ type: "waiting" });
        this.waitCall = ROUNDS.CALL_EVERY;
      }
      this.facing = Math.atan2(ctx.py - this.y, ctx.px - this.x);
      return events;
    }
    this.behind = 0;
    const at = this.walkRoute(dt, ROUNDS.ESCORT_SPEED);
    if (this.walking) {
      // he is easy to follow by ear: keys and footsteps
      this.cueKeys -= dt;
      if (this.cueKeys <= 0) {
        events.push({ type: "cue", cue: "keys" });
        this.cueKeys = this.between(ROUNDS.KEYS);
      }
      this.cueStep -= dt;
      if (this.cueStep <= 0) {
        events.push({ type: "cue", cue: "step" });
        this.cueStep = ROUNDS.STEP;
      }
    } else this.facing = Math.atan2(ctx.py - this.y, ctx.px - this.x);
    if (at && apart < ROUNDS.ARRIVE_PLAYER) {
      this.phase = "done";
      events.push({ type: "arrived" });
    }
    return events;
  }

  /** Reset (a load, a fail, or the mall taking him): he is gone, for `away` seconds at least. */
  reset(away = 0) {
    this.phase = "absent";
    this.away = away;
    this.exit = null;
    this.escortRoute = [];
    this.behind = 0;
    this.walking = false;
    this.path = [];
    this.relocate = 0;
    this.sinceReturn = 0;
  }
}
