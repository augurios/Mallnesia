// The guard's opening scene (CLAUDE.md, "Opening and the guard"): when the game starts the guard is the first thing
// the player sees. He tells them the mall is closed and they have to leave, then disappears once he is out of the
// camera's view. No DOM and no Three.js, so scripts/test-guard.mts runs the exact code the game runs.
//
// The guard is a real, ordinary worker, not a manifestation of the mall. This module only decides when he talks and
// when he goes; the runtime places and draws him, and the words live in strings/es-CR.ts.
import type { NavGrid } from "./nav";

export const GUARD_SCENE = {
  /** Seconds of looking at him before he speaks. */
  NOTICE_AFTER: 0.5,
  /** The first line comes this long after he is noticed, then each line lasts about SECONDS_PER_CHAR per character, plus a pause. */
  FIRST_PAUSE: 0.6,
  SECONDS_PER_CHAR: 0.055,
  MIN_LINE: 1.8,
  LINE_GAP: 0.7,
  /** If the player is out of his view this long while he talks (after at least one line), he is gone. */
  LOOK_AWAY: 1.5,
  /** After his last line: out of view this long and he is gone. */
  GONE_AFTER_LAST_OUT_OF_VIEW: 0.4,
  /** After his last line, if the player still watches him this long, he turns and walks away (1.3 m/s) until he is out of view. */
  WALK_AWAY_AFTER: 8,
  /** Never stays more than this many seconds after the last line. */
  MAX_LINGER: 24,
  /** If the player never looks at him in this long, the scene is dropped. */
  GIVE_UP: 25,
  WALK_SPEED: 1.3,
  /** Where he stands: this far ahead of the player (tried in order). */
  DISTANCES: [7, 6, 5, 4, 8],
};

export type GuardPhase = "waiting" | "talking" | "lingering" | "walking" | "gone";

/** How long a line stays up, seconds. */
export const lineTime = (text: string) => Math.max(GUARD_SCENE.MIN_LINE, text.length * GUARD_SCENE.SECONDS_PER_CHAR);

export class GuardScene {
  phase: GuardPhase = "waiting";
  /** The line being said now, or null between lines and outside the talk. */
  line: number | null = null;
  /** How many lines have been said (including the one being said). */
  spoken = 0;
  private lines: string[];
  private t = 0; // time in the current phase
  private seen = 0; // seconds in view while waiting
  private outOfView = 0; // seconds out of view in a row
  private lineClock = 0;
  private total = 0; // seconds since the scene was placed

  constructor(lines: string[]) {
    this.lines = lines;
  }

  get done() {
    return this.phase === "gone";
  }

  /**
   * Advances the scene. `inView` is whether the player can see him right now (in the camera's frustum with a clear
   * line). Returns "line" when a new line starts and "gone" the moment he disappears.
   */
  update(dt: number, inView: boolean): "line" | "gone" | null {
    if (this.phase === "gone") return null;
    this.total += dt;
    this.t += dt;
    this.outOfView = inView ? 0 : this.outOfView + dt;
    const C = GUARD_SCENE;
    if (this.phase === "waiting") {
      if (inView) this.seen += dt;
      if (this.seen >= C.NOTICE_AFTER) {
        this.phase = "talking";
        this.t = 0;
        this.lineClock = -C.FIRST_PAUSE;
        this.line = null;
      } else if (this.total > C.GIVE_UP) return this.finish();
      return null;
    }
    if (this.phase === "talking") {
      if (this.spoken > 0 && this.outOfView >= C.LOOK_AWAY) return this.finish();
      this.lineClock += dt;
      if (this.line === null && this.spoken < this.lines.length && this.lineClock >= 0) {
        this.line = this.spoken++;
        this.lineClock = 0;
        return "line";
      }
      if (this.line !== null && this.lineClock >= lineTime(this.lines[this.line])) {
        this.line = null;
        this.lineClock = -C.LINE_GAP;
        if (this.spoken >= this.lines.length) {
          this.phase = "lingering";
          this.t = 0;
        }
      }
      return null;
    }
    // lingering or walking: he has said everything; he goes once the player is not looking
    if (this.outOfView >= C.GONE_AFTER_LAST_OUT_OF_VIEW || this.t > C.MAX_LINGER) return this.finish();
    if (this.phase === "lingering" && this.t >= C.WALK_AWAY_AFTER) this.phase = "walking";
    return null;
  }

  /** He walks away from where he stood (the runtime moves him) until he is out of view, blocked, or the time is up. */
  get walking() {
    return this.phase === "walking";
  }

  /** Ends the scene now (the runtime calls this when a walking guard is blocked, or the player is moved by a fail). */
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
