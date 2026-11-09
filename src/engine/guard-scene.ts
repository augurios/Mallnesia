// The guard's opening scene (CLAUDE.md, "Opening and the guard"): when the game starts the player's camera is locked on
// the guard and they cannot move. He walks up to them, tells them the mall is closed and they have to leave, then
// stays where he is; control returns after his last line, and he is gone only once he is out of the camera's view.
// No DOM and no Three.js, so scripts/test-guard.mts runs the exact code the game runs.
//
// The guard is a real, ordinary worker, not a manifestation of the mall. This module only decides when he moves, talks
// and goes; the runtime places and draws him, and the words live in strings/es-CR.ts.
import type { NavGrid } from "./nav";

export const GUARD_SCENE = {
  /** He stands still this long before he starts walking up, seconds. */
  START_HOLD: 1.2,
  /** He stops this far from the player (m). */
  STOP_DISTANCE: 2.4,
  /** The walk up never takes longer than this; then he starts talking wherever he is. */
  APPROACH_MAX: 12,
  /** The first line comes this long after he stops, then each line lasts about SECONDS_PER_CHAR per character, plus a pause. */
  FIRST_PAUSE: 0.5,
  SECONDS_PER_CHAR: 0.055,
  MIN_LINE: 1.8,
  LINE_GAP: 0.7,
  /** After his last line he waits this long; the player is free from then on. */
  END_PAUSE: 1.2,
  /** After his last line: out of view this long and he is gone. */
  GONE_AFTER_OUT_OF_VIEW: 0.4,
  WALK_SPEED: 1.3,
  /** Where he starts: this far ahead of the player (tried in order). */
  DISTANCES: [7, 6, 5, 4, 8],
};

export type GuardPhase = "holding" | "approaching" | "talking" | "farewell" | "lingering" | "gone";

/** How long a line stays up, seconds. */
export const lineTime = (text: string) => Math.max(GUARD_SCENE.MIN_LINE, text.length * GUARD_SCENE.SECONDS_PER_CHAR);

export class GuardScene {
  phase: GuardPhase = "holding";
  /** The line being said now, or null between lines and outside the talk. */
  line: number | null = null;
  /** How many lines have been said (including the one being said). */
  spoken = 0;
  private lines: string[];
  private t = 0; // time in the current phase
  private outOfView = 0; // seconds out of view in a row
  private lineClock = 0;

  constructor(lines: string[]) {
    this.lines = lines;
  }

  get done() {
    return this.phase === "gone";
  }

  /** The player cannot move or look around: from the first frame until he turns to leave. */
  get controlLocked() {
    return this.phase === "holding" || this.phase === "approaching" || this.phase === "talking" || this.phase === "farewell";
  }

  /** He is walking toward the player. */
  get approaching() {
    return this.phase === "approaching";
  }

  private goTo(phase: GuardPhase) {
    this.phase = phase;
    this.t = 0;
  }

  /**
   * Advances the scene. `distance` is how far he is from the player (m); `inView` is whether the player can see him right
   * now (in the camera's frustum with a clear line). Returns "line" when a new line starts and "gone" the moment he disappears.
   */
  update(dt: number, distance: number, inView: boolean): "line" | "gone" | null {
    if (this.phase === "gone") return null;
    const C = GUARD_SCENE;
    this.t += dt;
    this.outOfView = inView ? 0 : this.outOfView + dt;
    if (this.phase === "holding") {
      if (this.t >= C.START_HOLD) this.goTo("approaching");
      return null;
    }
    if (this.phase === "approaching") {
      if (distance <= C.STOP_DISTANCE || this.t >= C.APPROACH_MAX) this.stop();
      return null;
    }
    if (this.phase === "talking") {
      this.lineClock += dt;
      if (this.line === null && this.spoken < this.lines.length && this.lineClock >= 0) {
        this.line = this.spoken++;
        this.lineClock = 0;
        return "line";
      }
      if (this.line !== null && this.lineClock >= lineTime(this.lines[this.line])) {
        this.line = null;
        this.lineClock = -C.LINE_GAP;
        if (this.spoken >= this.lines.length) this.goTo("farewell");
      }
      return null;
    }
    if (this.phase === "farewell") {
      if (this.t >= C.END_PAUSE) {
        this.goTo("lingering");
        this.outOfView = 0;
      }
      return null;
    }
    // lingering: he stays put and goes only once he is out of the player's view
    if (this.outOfView >= C.GONE_AFTER_OUT_OF_VIEW) return this.finish();
    return null;
  }

  /** He stops walking up and starts to talk (the runtime calls this too when something blocks his way). */
  stop() {
    if (this.phase !== "approaching") return;
    this.goTo("talking");
    this.lineClock = -GUARD_SCENE.FIRST_PAUSE;
    this.line = null;
  }

  /** Ends the scene now (the runtime calls this when the player is moved by a fail or a load). */
  finish(): "gone" {
    this.phase = "gone";
    this.line = null;
    return "gone";
  }
}

/**
 * Where the guard stands: ahead of the player, within sight and on open floor, so he is the first thing they see.
 * Tries each distance straight ahead, then a little to either side. Plan coordinates; `heading` is the player's plan
 * heading. Null if there is nowhere (the scene is then skipped).
 */
export function placeAhead(nav: NavGrid, floor: number, x: number, y: number, heading: number): { x: number; y: number } | null {
  for (const d of GUARD_SCENE.DISTANCES)
    for (const off of [0, 0.2, -0.2, 0.4, -0.4]) {
      const px = x + Math.cos(heading + off) * d;
      const py = y + Math.sin(heading + off) * d;
      const spot = nav.nearestWalkable(floor, px, py, 0);
      if (!spot || !nav.walkable(floor, px, py)) continue;
      if (!nav.sees(floor, x, y, px, py)) continue;
      return { x: px, y: py };
    }
  return null;
}
