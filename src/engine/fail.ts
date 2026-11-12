// Failing and coming back (CLAUDE.md, "Failure"). There is no health: the player fails by being caught by the shadow
// (back to the last checkpoint) or by running out of sanity anywhere (wakes up somewhere else in the mall, nothing
// is lost). Either way the screen goes black, the runtime moves the player while it is black, and the screen comes back.
// No DOM and no Three.js, so scripts/test-fail.mts runs the exact code the game runs.
import type { NavGrid } from "./nav";

/** Why the screen goes black: caught (back to the checkpoint), faint (wakes elsewhere), and the two moves between the mall and the garage. */
export type FailReason = "caught" | "faint" | "to_garage" | "to_mall";
export type FailState = "playing" | "falling" | "dark" | "waking";

export const FAIL = {
  /** Seconds to go to black (the player cannot move), to stay black (the runtime moves them at its start), to come back. */
  FALL_TIME: 0.9,
  DARK_TIME: 1.4,
  WAKE_TIME: 2.6,
  /** Waking up after fainting is shorter than being caught: it is a rescue, not a punishment. */
  FAINT_FALL_TIME: 2.0,
  /** Sanity the player wakes up with after fainting (a restart from a checkpoint is a full 1). */
  FAINT_SANITY: 0.55,
  /** The wake-up spot is this far (meters, straight line) from where the player fainted. */
  WAKE_MIN: 25,
  WAKE_MAX: 120,
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export class Fail {
  state: FailState = "playing";
  reason: FailReason = "caught";
  private t = 0;
  private moved = false;

  /** How black the screen is, 0 to 1. */
  get fade(): number {
    if (this.state === "falling") return smooth(this.t / this.fallTime());
    if (this.state === "dark") return 1;
    if (this.state === "waking") return 1 - smooth(this.t / FAIL.WAKE_TIME);
    return 0;
  }

  /** The player cannot move or act: going down, or black. They have control again as the picture returns. */
  get locked() {
    return this.state === "falling" || this.state === "dark";
  }

  private fallTime() {
    return this.reason === "faint" ? FAIL.FAINT_FALL_TIME : FAIL.FALL_TIME;
  }

  /** Starts a fail. Ignored while one is already under way. */
  trigger(reason: FailReason): boolean {
    if (this.state !== "playing") return false;
    this.reason = reason;
    this.state = "falling";
    this.t = 0;
    this.moved = false;
    return true;
  }

  /** Advances the fail. Returns "move" once, the moment the screen is fully black: the runtime puts the player in their new place. */
  update(dt: number): "move" | null {
    if (this.state === "playing") return null;
    this.t += dt;
    if (this.state === "falling" && this.t >= this.fallTime()) {
      this.state = "dark";
      this.t = 0;
    }
    let event: "move" | null = null;
    if (this.state === "dark") {
      if (!this.moved) {
        this.moved = true;
        event = "move";
      }
      if (this.t >= FAIL.DARK_TIME) {
        this.state = "waking";
        this.t = 0;
      }
    } else if (this.state === "waking" && this.t >= FAIL.WAKE_TIME) {
      this.state = "playing";
      this.t = 0;
    }
    return event;
  }
}

/** Somewhere else in the mall, on any floor, 25 to 120 m from where the player was, on open floor. Null if none was found. */
export function pickWakeSpot(nav: NavGrid, floor: number, x: number, y: number, rand: () => number): { floor: number; x: number; y: number } | null {
  for (let n = 0; n < 40; n++) {
    const f = Math.floor(rand() * nav.floorCount);
    const spot = nav.randomSpot(f, x, y, FAIL.WAKE_MIN, FAIL.WAKE_MAX, rand);
    if (spot) return { floor: f, x: spot[0], y: spot[1] };
  }
  return null;
}
