// The girl in white (CLAUDE.md, "Threats"): brief, sparing apparitions. She never chases, never moves, never catches
// the player; she is only seen, and being seen costs sanity. She appears in the open ahead of the player (a corridor,
// a hall) where they will notice her at the edge of sight, stays a couple of seconds, and is gone. Later the same
// system will place her in elevators, mirrors and bathroom corridors (`kind`). No DOM and no Three.js, so
// scripts/test-girl.mts runs the exact code the game runs.
import type { NavGrid } from "./nav";

export const GIRL = {
  /** Seconds until the first apparition, then between apparitions at full sanity (random in the range). */
  FIRST: [100, 160] as [number, number],
  GAP: [150, 320] as [number, number],
  /** Gap divided by (1 + RATE_PER_SHIFT * shift): the mall shows more as sanity falls. */
  RATE_PER_SHIFT: 0.5,
  /** She stands this far from the player (m), within this half angle (degrees) of where they face. */
  MIN_DIST: 7,
  MAX_DIST: 15,
  CONE: 38,
  /** Seconds she stays, fade in and out, and how close the player can come before she is gone. */
  STAY: [1.6, 2.8] as [number, number],
  FADE: 0.35,
  VANISH_NEAR: 4,
  /** Sanity lost the moment she appears, and per second while she is in view. */
  START_DRAIN: 0.035,
  SEEN_DRAIN: 0.02,
};

export type GirlKind = "corridor" | "elevator" | "mirror" | "bathroom";

export interface GirlSpot {
  x: number;
  y: number;
  /** Plan heading she faces (toward the player). */
  facing: number;
}

/** One apparition: counts its own time, fades in and out, and ends early if the player comes too close. */
export class Apparition {
  readonly kind: GirlKind;
  readonly spot: GirlSpot;
  private t = 0;
  private stay: number;
  private cut = false;
  constructor(kind: GirlKind, spot: GirlSpot, stay: number) {
    this.kind = kind;
    this.spot = spot;
    this.stay = stay;
  }
  /** 0 to 1: how much of her is there. */
  get opacity(): number {
    if (this.cut) return Math.max(0, 1 - (this.t - this.cutAt) / 0.12); // gone in a blink when approached
    const fadeIn = Math.min(1, this.t / GIRL.FADE);
    const fadeOut = Math.min(1, Math.max(0, (this.stay + GIRL.FADE - this.t) / GIRL.FADE));
    return Math.min(fadeIn, fadeOut);
  }
  private cutAt = 0;
  get done() {
    return this.t >= this.stay + GIRL.FADE || (this.cut && this.opacity <= 0);
  }
  update(dt: number, distance: number) {
    this.t += dt;
    if (!this.cut && distance < GIRL.VANISH_NEAR) {
      this.cut = true;
      this.cutAt = this.t;
    }
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
  stay(): number {
    return this.between(GIRL.STAY);
  }
}

/**
 * Where she stands: in the open ahead of the player, within sight, on open floor, at the edge of the view rather than
 * dead center (they see her without being asked to look). Null if the player faces a wall.
 */
export function pickGirlSpot(nav: NavGrid, floor: number, px: number, py: number, heading: number, rand: () => number): GirlSpot | null {
  const cone = (GIRL.CONE * Math.PI) / 180;
  for (let tries = 0; tries < 60; tries++) {
    const a = heading + (rand() * 2 - 1) * cone;
    const d = GIRL.MIN_DIST + rand() * (GIRL.MAX_DIST - GIRL.MIN_DIST);
    const x = px + Math.cos(a) * d;
    const y = py + Math.sin(a) * d;
    if (!nav.walkable(floor, x, y) || !nav.sees(floor, px, py, x, y)) continue;
    return { x, y, facing: Math.atan2(py - y, px - x) };
  }
  return null;
}
