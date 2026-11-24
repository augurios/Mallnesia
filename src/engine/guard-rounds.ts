// The guard's rounds and the guard ending (CLAUDE.md, "Opening and the guard" and "Winning"). After the opening scene
// he is gone. Once the player has done some scouting for an exit (exploration, not a timer) he returns: a real, ordinary
// worker walking a loose patrol between fixed checkpoints (food court, atrium, the garage stairwell door, the lobby),
// in an order the mall reshuffles every lap. Finding him is audio first: keys, radio, footsteps and a flashlight far down
// a hall come before sight. The mall interferes at low sanity (cues go quiet or point the wrong way); if the player has
// been lost for minutes the cues get clearer. Meeting him is the win: he escorts the player to the main doors and the mall
// lets them go. No DOM and no Three.js, so scripts/test-rounds.mts runs the exact code the game runs.
import type { NavGrid, Pt } from "./nav";

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
  /** Escort: speed, and he waits when the player is farther than this. */
  ESCORT_SPEED: 1.45,
  ESCORT_WAIT: 9,
  /** The main doors: where the escort ends (floor 0), and the player must be this close when he arrives. */
  EXIT: { floor: 0, x: 74.5, y: 8.8 },
  EXIT_RADIUS: 1.3,
  ARRIVE_PLAYER: 7,
  /** After the meeting on another floor the mall takes them to the lobby, here. */
  LOBBY: { floor: 0, x: 77, y: 16 },
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
  | { type: "arrived" };

export interface RoundsContext {
  nav: NavGrid;
  px: number;
  py: number;
  floor: number;
  /** Whether the player can see the plan point (so he never pops into view). */
  seenBy(x: number, y: number, floor: number): boolean;
}

export class GuardRounds {
  phase: RoundsPhase = "absent";
  x = 0;
  y = 0;
  floor = 0;
  facing = 0;
  walking = false;
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

  /** Brings him back: he appears at a checkpoint the player cannot see. Returns false if every one is in sight (try later). */
  start(ctx: RoundsContext): boolean {
    const options = this.shuffled(null).filter((c) => !ctx.seenBy(c.x, c.y, c.floor) && (c.floor !== ctx.floor || Math.hypot(c.x - ctx.px, c.y - ctx.py) > 14));
    const at = options[0];
    if (!at) return false;
    this.phase = "patrolling";
    this.x = at.x;
    this.y = at.y;
    this.floor = at.floor;
    this.target = at;
    this.pause = this.between(ROUNDS.PAUSE);
    this.sinceReturn = 0;
    this.route = this.shuffled(at.id).filter((c) => c.id !== at.id);
    this.cueKeys = 1;
    this.cueRadio = 3;
    return true;
  }

  /** Ends the patrol and starts the escort (the dialogue is over). */
  beginEscort() {
    if (this.phase !== "meeting") return;
    this.phase = "escort";
    this.path = [];
    this.waitCall = 0;
  }

  /** The mall moves him and the player to the lobby (the meeting was on another floor). */
  placeAtLobby() {
    this.floor = ROUNDS.LOBBY.floor;
    this.x = ROUNDS.LOBBY.x + 1.5;
    this.y = ROUNDS.LOBBY.y + 1.5;
    this.path = [];
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
    // escort: he walks to the main doors, waiting for the player when they fall behind
    const far = this.floor !== ctx.floor || Math.hypot(this.x - ctx.px, this.y - ctx.py) > ROUNDS.ESCORT_WAIT;
    if (far) {
      this.walking = false;
      this.waitCall -= dt;
      if (this.waitCall <= 0) {
        events.push({ type: "waiting" });
        this.waitCall = 7;
      }
      this.facing = Math.atan2(ctx.py - this.y, ctx.px - this.x);
      return events;
    }
    const at = this.walk(dt, ctx, ROUNDS.ESCORT_SPEED, ROUNDS.EXIT.x, ROUNDS.EXIT.y);
    if ((at || Math.hypot(ROUNDS.EXIT.x - this.x, ROUNDS.EXIT.y - this.y) < ROUNDS.EXIT_RADIUS) && Math.hypot(this.x - ctx.px, this.y - ctx.py) < ROUNDS.ARRIVE_PLAYER) {
      this.phase = "done";
      events.push({ type: "arrived" });
    }
    return events;
  }

  /** Reset (a load or a fail): he is gone until the player has scouted enough again. */
  reset() {
    this.phase = "absent";
    this.walking = false;
    this.path = [];
    this.relocate = 0;
    this.sinceReturn = 0;
  }
}
