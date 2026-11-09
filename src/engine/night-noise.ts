// Night noises: things in the mall knock over or slide when the player is not looking (CLAUDE.md, vertical slice:
// "physics events that trigger when the player isn't looking"). A chair tips over in the next aisle, a bin falls,
// another chair scrapes across the floor. The player hears it and, if they go to look, finds it lying there.
// No DOM and no Three.js, so scripts/test-noise.mts runs the exact code the game runs.
//
// This is a few hand-written motions, not a physics engine: a tip is a pendulum falling about the base edge with a
// small bounce, a slide is a push slowed by friction. Triggered by a timer that runs faster as sanity drops
// (the mall shifting more), and by a debug key.
import type { NavGrid } from "./nav";

export const NOISE = {
  /** Seconds until the first event, then between events (random in the range), at full sanity. */
  FIRST: [18, 35] as [number, number],
  GAP: [35, 80] as [number, number],
  /** Gap divided by (1 + RATE_PER_SHIFT * the mall's shift level, 0 to 3): lower sanity, more noises. */
  RATE_PER_SHIFT: 0.6,
  /** The event happens this far from the player (meters, straight line), on their floor, out of their sight. */
  MIN_DIST: 6,
  MAX_DIST: 24,
  /** Tipping: angular acceleration scale (rad/s^2), restitution of the bounce, impacts quieter than this do not bounce. */
  TIP_G: 11,
  RESTITUTION: 0.3,
  MIN_BOUNCE: 0.9,
  /** Sliding: friction deceleration (m/s^2) and the push (m/s). */
  FRICTION: 3.2,
  PUSH: [1.6, 3.0] as [number, number],
  /** Loose objects kept in the world at once: the oldest out of sight goes first. */
  MAX_OBJECTS: 8,
};

export type NoiseKind = "chair_tip" | "chair_slide" | "bin_tip";
const WEIGHTS: [NoiseKind, number][] = [
  ["chair_tip", 0.45],
  ["chair_slide", 0.3],
  ["bin_tip", 0.25],
];

/** An upright thing falling over about its base edge. `angle` is 0 upright to `rest` lying. */
export class Tip {
  angle = 0.08;
  velocity = 0.25;
  settled = false;
  bounces = 0;
  readonly rest: number;
  constructor(rest: number) {
    this.rest = rest;
  }

  /** Advances it. Returns the speed (rad/s) when it hits the floor, otherwise null. */
  update(dt: number): number | null {
    if (this.settled) return null;
    this.velocity += NOISE.TIP_G * Math.sin(Math.min(this.angle, Math.PI / 2)) * dt + 0.6 * dt;
    this.angle += this.velocity * dt;
    if (this.angle >= this.rest) {
      this.angle = this.rest;
      const hit = this.velocity;
      if (hit > NOISE.MIN_BOUNCE && this.bounces < 2) {
        this.velocity = -hit * NOISE.RESTITUTION;
        this.bounces++;
      } else {
        this.velocity = 0;
        this.settled = true;
      }
      return hit;
    }
    return null;
  }
}

/** A thing pushed along the floor and slowed by friction. */
export class Slide {
  speed: number;
  distance = 0;
  constructor(speed: number) {
    this.speed = speed;
  }
  get stopped() {
    return this.speed <= 0;
  }
  /** Returns how far it moved this step. */
  update(dt: number): number {
    if (this.speed <= 0) return 0;
    const v1 = Math.max(0, this.speed - NOISE.FRICTION * dt);
    const d = ((this.speed + v1) / 2) * dt;
    this.speed = v1;
    this.distance += d;
    return d;
  }
}

/** The timer that decides when the next event happens. */
export class NoiseDirector {
  enabled = true;
  private timer: number;
  private rand: () => number;
  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.timer = this.between(NOISE.FIRST);
  }
  private between([a, b]: [number, number]) {
    return a + this.rand() * (b - a);
  }
  /** Brings the next event forward (debug key). */
  soon(seconds = 1) {
    this.timer = Math.min(this.timer, seconds);
  }
  /** `shift` is the mall's shift level from sanity (0 calm to 3 worst). Returns true when an event is due. */
  update(dt: number, shift: number): boolean {
    if (!this.enabled) return false;
    this.timer -= dt;
    if (this.timer > 0) return false;
    this.timer = this.between(NOISE.GAP) / (1 + NOISE.RATE_PER_SHIFT * shift);
    return true;
  }
  /** Which kind of event, by weight. */
  pick(): NoiseKind {
    let r = this.rand();
    for (const [kind, w] of WEIGHTS) {
      if (r < w) return kind;
      r -= w;
    }
    return WEIGHTS[0][0];
  }
}

export interface NoiseSpot {
  x: number;
  y: number;
  /** Plan heading the event moves toward (the way it falls or slides). */
  heading: number;
}

/**
 * Where an event happens: beside a table (the food court is where chairs are), on the player's floor, 6 to 24 m away,
 * and not in the player's view (`hidden` says so). Falls back to any open floor in range if there are no tables.
 * `tables` is the flat [x, y(height), -y, yaw] list of the table pieces on all floors; `floorHeight` tells floors apart.
 */
export function pickNoiseSpot(
  nav: NavGrid,
  tables: number[],
  floorHeight: number,
  floor: number,
  px: number,
  py: number,
  hidden: (x: number, y: number) => boolean,
  rand: () => number,
): NoiseSpot | null {
  const near: [number, number][] = [];
  for (let i = 0; i + 3 < tables.length; i += 4) {
    if (Math.round(tables[i + 1] / floorHeight) !== floor) continue;
    const d = Math.hypot(tables[i] - px, -tables[i + 2] - py);
    if (d >= NOISE.MIN_DIST && d <= NOISE.MAX_DIST) near.push([tables[i], -tables[i + 2]]);
  }
  for (let tries = 0; tries < 40; tries++) {
    let x: number;
    let y: number;
    if (near.length && tries < 30) {
      // beside a random table, on the aisle side
      const [tx, ty] = near[Math.floor(rand() * near.length)];
      const a = rand() * Math.PI * 2;
      x = tx + Math.cos(a) * 1.4;
      y = ty + Math.sin(a) * 1.4;
    } else {
      const spot = nav.randomSpot(floor, px, py, NOISE.MIN_DIST, NOISE.MAX_DIST, rand);
      if (!spot) return null;
      [x, y] = spot;
    }
    const d = Math.hypot(x - px, y - py);
    if (d < NOISE.MIN_DIST || d > NOISE.MAX_DIST || !nav.walkable(floor, x, y)) continue;
    if (!hidden(x, y)) continue;
    return { x, y, heading: rand() * Math.PI * 2 };
  }
  return null;
}
