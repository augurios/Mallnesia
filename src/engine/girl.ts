// The girl in white (CLAUDE.md, "Threats"): a lost child crying for her parents. She never chases, never moves, never
// catches the player. She appears out of the camera's view (behind, to the side), crying and calling; the player only
// finds her by turning around. Seeing her drains sanity, and the closer they are the more it costs. She stays until the
// player has walked far enough away (or, if never seen, until the mall loses interest). Later the same system will
// place her in elevators, mirrors and bathroom corridors (`kind`). No DOM and no Three.js, so scripts/test-girl.mts
// runs the exact code the game runs.
import type { NavGrid } from "./nav";

export const GIRL = {
  /** Seconds until the first apparition, then between one ending and the next at full sanity (random in the range). */
  FIRST: [100, 160] as [number, number],
  GAP: [150, 320] as [number, number],
  /** Gap divided by (1 + RATE_PER_SHIFT * shift): the mall shows more as sanity falls. */
  RATE_PER_SHIFT: 0.5,
  /** She stands this far from the player (m), at least this many degrees off where they face (out of the view). */
  MIN_DIST: 6,
  MAX_DIST: 12,
  HIDDEN_FROM: 70,
  /** Chance she is put ahead of the player instead, hidden behind something (a wall, a corner): in the cone of their view, but out of sight. */
  AHEAD_CHANCE: 0.5,
  AHEAD_CONE: 40,
  AHEAD_MIN: 5,
  AHEAD_MAX: 12,
  /** The walk to her can be at most this many times the straight distance (plus 4 m), so the player can get around to her. */
  AHEAD_DETOUR: 2.5,
  /** Seconds to fade in (unseen) and to fade out when she goes. */
  FADE_IN: 0.6,
  FADE_OUT: 1.2,
  /** Past this distance (m) she is gone. Never seen after this many seconds, she is gone too. */
  LEAVE_DIST: 20,
  LOST_AFTER: 75,
  /** Sanity lost in the moment she is first seen, and per second while she is in view: FAR at LEAVE_DIST, NEAR at NEAR_DIST. */
  FIRST_SIGHT: 0.03,
  DRAIN_FAR: 0.012,
  DRAIN_NEAR: 0.07,
  NEAR_DIST: 2,
  /** Seeing her from this close (m) takes all the sanity at once. */
  TOUCH_DIST: 1.5,
  /** Seconds between her calls (first one after CALL_FIRST). */
  CALL_FIRST: 2.5,
  CALL_GAP: [7, 11] as [number, number],
};

export type GirlKind = "corridor" | "elevator" | "mirror" | "bathroom";

export interface GirlSpot {
  x: number;
  y: number;
  /** Plan heading she faces (toward the player). */
  facing: number;
}

/** Sanity per second while she is in view at `distance` (m): grows as the player gets closer. */
export function girlDrain(distance: number): number {
  const prox = Math.min(1, Math.max(0, (GIRL.LEAVE_DIST - distance) / (GIRL.LEAVE_DIST - GIRL.NEAR_DIST)));
  return GIRL.DRAIN_FAR + (GIRL.DRAIN_NEAR - GIRL.DRAIN_FAR) * prox * prox;
}

/** One apparition: fades in, cries and calls, and fades out when the player has gone far enough (or never found her). */
export class Apparition {
  readonly kind: GirlKind;
  readonly spot: GirlSpot;
  private t = 0;
  private leaveAt = -1;
  private seen = false;
  private callTimer = GIRL.CALL_FIRST;
  private rand: () => number;
  constructor(kind: GirlKind, spot: GirlSpot, rand: () => number = Math.random) {
    this.kind = kind;
    this.spot = spot;
    this.rand = rand;
  }
  /** 0 to 1: how much of her is there. */
  get opacity(): number {
    const fadeIn = Math.min(1, this.t / GIRL.FADE_IN);
    const fadeOut = this.leaveAt < 0 ? 1 : Math.max(0, 1 - (this.t - this.leaveAt) / GIRL.FADE_OUT);
    return Math.min(fadeIn, fadeOut);
  }
  get leaving() {
    return this.leaveAt >= 0;
  }
  get done() {
    return this.leaveAt >= 0 && this.opacity <= 0;
  }
  /** Has the player ever seen her. */
  get wasSeen() {
    return this.seen;
  }
  /** Advances her. `inView` is whether the player sees her right now. Returns true on the moment she is first seen. */
  update(dt: number, distance: number, inView: boolean): boolean {
    this.t += dt;
    let first = false;
    if (inView && !this.leaving && this.opacity > 0.5 && !this.seen) {
      this.seen = true;
      first = true;
    }
    if (!this.leaving && (distance > GIRL.LEAVE_DIST || (!this.seen && this.t > GIRL.LOST_AFTER))) this.leaveAt = this.t;
    if (!this.leaving) this.callTimer -= dt;
    return first;
  }
  /** True when she is due to call out for her parents (then the next call is set). */
  takeCall(): boolean {
    if (this.leaving || this.callTimer > 0) return false;
    this.callTimer = GIRL.CALL_GAP[0] + this.rand() * (GIRL.CALL_GAP[1] - GIRL.CALL_GAP[0]);
    return true;
  }
}

/** The timer between apparitions. */
export class GirlDirector {
  enabled = true;
  private timer: number;
  private rand: () => number;
  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.timer = this.between(GIRL.FIRST);
  }
  private between([a, b]: [number, number]) {
    return a + this.rand() * (b - a);
  }
  /** Brings the next apparition forward (debug). */
  soon(seconds = 1) {
    this.timer = Math.min(this.timer, seconds);
  }
  /** True when one is due. `busy` holds the timer (an apparition is on, the player is somewhere she cannot appear). */
  update(dt: number, shift: number, busy: boolean): boolean {
    if (!this.enabled || busy) return false;
    this.timer -= dt;
    if (this.timer > 0) return false;
    this.timer = this.between(GIRL.GAP) / (1 + GIRL.RATE_PER_SHIFT * shift);
    return true;
  }
}

/**
 * Where she stands: on open floor in sight of the player (so turning around shows her), but outside the view: at least
 * HIDDEN_FROM degrees off where they face. Null if there is no such place.
 */
export function pickGirlSpot(nav: NavGrid, floor: number, px: number, py: number, heading: number, rand: () => number): GirlSpot | null {
  const min = (GIRL.HIDDEN_FROM * Math.PI) / 180;
  for (let tries = 0; tries < 80; tries++) {
    const off = min + rand() * (Math.PI - min);
    const a = heading + (rand() < 0.5 ? -off : off);
    const d = GIRL.MIN_DIST + rand() * (GIRL.MAX_DIST - GIRL.MIN_DIST);
    const x = px + Math.cos(a) * d;
    const y = py + Math.sin(a) * d;
    if (!nav.walkable(floor, x, y) || !nav.sees(floor, px, py, x, y)) continue;
    return { x, y, facing: Math.atan2(py - y, px - x) };
  }
  return null;
}

/**
 * Where she stands when she is ahead of the player but hidden: in the cone of their view, on open floor with no line of
 * sight (something stands between), and a short walk away so they can get round to see her. Null if there is no such place.
 */
export function pickHiddenAhead(nav: NavGrid, floor: number, px: number, py: number, heading: number, rand: () => number): GirlSpot | null {
  const cone = (GIRL.AHEAD_CONE * Math.PI) / 180;
  for (let tries = 0; tries < 80; tries++) {
    const a = heading + (rand() * 2 - 1) * cone;
    const d = GIRL.AHEAD_MIN + rand() * (GIRL.AHEAD_MAX - GIRL.AHEAD_MIN);
    const x = px + Math.cos(a) * d;
    const y = py + Math.sin(a) * d;
    if (!nav.walkable(floor, x, y) || nav.sees(floor, px, py, x, y)) continue;
    const path = nav.findPath(floor, px, py, x, y);
    if (!path) continue;
    let len = 0;
    let [lx, ly] = [px, py];
    for (const [qx, qy] of path) {
      len += Math.hypot(qx - lx, qy - ly);
      [lx, ly] = [qx, qy];
    }
    if (len > d * GIRL.AHEAD_DETOUR + 4) continue;
    return { x, y, facing: Math.atan2(py - y, px - x) };
  }
  return null;
}

/** Picks her place: hidden ahead (AHEAD_CHANCE of the time, when such a place exists), otherwise out of the view. */
export function chooseGirlSpot(nav: NavGrid, floor: number, px: number, py: number, heading: number, rand: () => number): GirlSpot | null {
  if (rand() < GIRL.AHEAD_CHANCE) {
    const hidden = pickHiddenAhead(nav, floor, px, py, heading, rand);
    if (hidden) return hidden;
  }
  return pickGirlSpot(nav, floor, px, py, heading, rand);
}
