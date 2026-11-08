// The shadow: the one threat that can catch the player (CLAUDE.md, "Threats" and "Failure"). This is its brain only:
// no DOM, no Three.js, so scripts/test-shadow.mts runs the exact code the game runs. How it looks is shadow-view.ts.
//
// It is the mall's own manifestation, not a creature that lives somewhere: it appears out of sight, wanders near the
// player, and vanishes again. It stays on one floor; when the player changes floor the mall simply moves it.
//
//   absent -> stalking -> investigating -> hunting -> searching -> (vanishes) -> absent
//
// How it finds the player (the player's whole defence is being quiet, hidden and out of sight with the flashlight off):
//   - sight: a clear line, inside its view, within SIGHT_DARK meters, or SIGHT_LIGHT with the flashlight on;
//   - noise: heard through walls within NOISE_WALK / NOISE_RUN meters, by how fast the player moves;
//   - hidden players are seen and heard only from a step away (`HIDDEN_RANGE`): the hiding spots card sets `hidden`.
// Noticing builds `awareness` (0 to 1) rather than flipping at once, so there is a moment to react.
// Every number below is a first guess to tune by playing.

import type { NavGrid, Pt } from "./nav";

export const SHADOW = {
  // speeds, meters per second (the player walks at 3.2 and runs at 7)
  STALK_SPEED: 1.3,
  INVESTIGATE_SPEED: 2.3,
  HUNT_SPEED: 5.2,
  SEARCH_SPEED: 2.2,
  TURN_RATE: 5, // radians per second
  // senses
  SIGHT_DARK: 5,
  SIGHT_LIGHT: 35,
  VIEW_ANGLE: (200 * Math.PI) / 180, // full width of the cone it sees in while not hunting
  NOISE_WALK: 7,
  NOISE_RUN: 14,
  RUN_SPEED_ABOVE: 5, // the player counts as running above this speed
  WALK_SPEED_ABOVE: 0.5, // and as standing still below this one
  HIDDEN_RANGE: 1.5,
  NOTICE_CLOSE: 2.5, // seen this close it knows at once
  AWARE_DECAY: 0.2, // per second with nothing to notice
  SUSPICIOUS_AT: 0.35, // awareness that turns a wander into going to look
  // hunting
  CATCH_DISTANCE: 1.1,
  LOSE_AFTER: 6, // seconds without a sight or a sound before a hunt turns into a search
  SEARCH_TIME: 14,
  REPATH_EVERY: 0.35,
  // its comings and goings
  FIRST_SPAWN: 45, // seconds after the game starts
  SPAWN_GAP: [80, 140] as [number, number],
  AFTER_LOST_GAP: [60, 100] as [number, number],
  AFTER_CAUGHT_GAP: [60, 90] as [number, number],
  AFTER_FLOOR_CHANGE_GAP: [20, 35] as [number, number],
  SPAWN_DISTANCE: [22, 40] as [number, number],
  FORCED_SPAWN_DISTANCE: [12, 18] as [number, number],
  STALK_LIFETIME: 50, // seconds it wanders before the mall takes it back
  FADE_TIME: 1.6, // seconds to appear or to dissolve
} as const;

export type ShadowState = "absent" | "stalking" | "investigating" | "hunting" | "searching";
export type ShadowEvent = "appeared" | "noticed" | "lost" | "vanished" | "caught";

/** What the shadow can sense about the player. Plan coordinates (x east, y north). */
export interface PlayerSense {
  x: number;
  y: number;
  floor: number;
  /** Horizontal speed in meters per second. */
  speed: number;
  flashlightOn: boolean;
  hidden: boolean;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Shadow {
  state: ShadowState = "absent";
  x = 0;
  y = 0;
  floor = 0;
  /** Heading in plan radians (atan2 of dy, dx). */
  facing = 0;
  awareness = 0;
  /** 0 (not there) to 1 (fully there): how much of it shows, for fading in and out. */
  fade = 0;
  /** Set false (debug ?shadow=off) and it never appears on its own. */
  director = true;

  private nav: NavGrid;
  private rand: () => number;
  private path: Pt[] = [];
  private spawnTimer: number = SHADOW.FIRST_SPAWN;
  private repath = 0;
  private lastKnown: Pt = [0, 0];
  private sinceStimulus = 0;
  private stateTime = 0;
  private pause = 0;
  private leaving = false;
  private noPath = 0;

  constructor(nav: NavGrid, rand: () => number = Math.random) {
    this.nav = nav;
    this.rand = rand;
  }

  private between = ([a, b]: readonly [number, number]) => a + this.rand() * (b - a);

  /** True while it hunts: manual saves are refused then (CLAUDE.md, "Save, load, and checkpoints"). */
  get hunting() {
    return this.state === "hunting";
  }

  distanceTo(p: { x: number; y: number }) {
    return Math.hypot(p.x - this.x, p.y - this.y);
  }

  /** True when the player, facing (fx, fy) in plan coordinates, has it in view: a clear line, near enough, in front. */
  visibleTo(p: PlayerSense, fx: number, fy: number, maxDistance = 35, halfAngle = 0.95): boolean {
    if (this.state === "absent" || this.fade < 0.3 || p.floor !== this.floor) return false;
    const d = this.distanceTo(p);
    if (d > maxDistance || !this.nav.sees(this.floor, p.x, p.y, this.x, this.y)) return false;
    if (d < 0.01) return true;
    const dot = ((this.x - p.x) * fx + (this.y - p.y) * fy) / d;
    return dot > Math.cos(halfAngle);
  }

  /** Brings it in near the player, out of sight: the debug key, and what the director does when its timer runs out. */
  spawn(p: PlayerSense, forced = false): boolean {
    const [min, max] = forced ? SHADOW.FORCED_SPAWN_DISTANCE : SHADOW.SPAWN_DISTANCE;
    const spot = this.nav.randomSpot(p.floor, p.x, p.y, min, max, this.rand, (x, y) => !this.nav.sees(p.floor, x, y, p.x, p.y));
    if (!spot) return false;
    this.appearAt(p.floor, spot[0], spot[1]);
    return true;
  }

  /** Puts it at an exact spot (a scripted scene, or a test), stalking. It fades in unless `instant`. */
  appearAt(floor: number, x: number, y: number, facing = this.rand() * Math.PI * 2 - Math.PI, instant = false): void {
    this.x = x;
    this.y = y;
    this.floor = floor;
    this.facing = facing;
    this.awareness = 0;
    this.fade = instant ? 1 : 0;
    this.leaving = false;
    this.enter("stalking");
  }

  /** Makes it come (or come back) `seconds` from now, if the director is on. */
  scheduleSpawn(seconds: number): void {
    this.spawnTimer = seconds;
  }

  /** Takes it away at once, no dissolve (after a load or a restart); the director brings it back after `cooldown` seconds. */
  reset(cooldown: number): void {
    this.state = "absent";
    this.leaving = false;
    this.fade = 0;
    this.awareness = 0;
    this.path = [];
    this.spawnTimer = cooldown;
  }

  /** Starts it dissolving. `cooldown` seconds must pass before the director brings it back. */
  vanish(cooldown: number): void {
    if (this.state === "absent") return;
    this.leaving = true;
    this.spawnTimer = cooldown;
    this.path = [];
  }

  private enter(state: ShadowState) {
    this.state = state;
    this.stateTime = 0;
    this.pause = 0;
    this.repath = 0;
    this.path = [];
    this.noPath = 0;
  }

  update(dt: number, p: PlayerSense): ShadowEvent[] {
    const events: ShadowEvent[] = [];
    if (dt <= 0) return events;

    if (this.state === "absent") {
      if (this.director) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          if (this.spawn(p)) events.push("appeared");
          else this.spawnTimer = 5; // no good spot right now: try again soon
        }
      }
      return events;
    }

    // Fading in and out.
    this.fade = Math.min(1, Math.max(0, this.fade + ((this.leaving ? -1 : 1) * dt) / SHADOW.FADE_TIME));
    if (this.leaving) {
      if (this.fade <= 0) {
        this.state = "absent";
        this.leaving = false;
        this.awareness = 0;
        events.push("vanished");
      }
      return events; // while it dissolves it senses and catches nothing
    }

    // The player went to another floor: the mall takes it away and puts it somewhere else later.
    if (p.floor !== this.floor) {
      if (this.state === "hunting") events.push("lost");
      this.vanish(this.between(SHADOW.AFTER_FLOOR_CHANGE_GAP));
      return events;
    }

    this.stateTime += dt;
    const d = this.distanceTo(p);
    const hunting = this.state === "hunting";

    // --- senses ---
    const los = this.nav.sees(this.floor, this.x, this.y, p.x, p.y);
    let sightRange: number = p.flashlightOn ? SHADOW.SIGHT_LIGHT : SHADOW.SIGHT_DARK;
    if (p.hidden) sightRange = SHADOW.HIDDEN_RANGE;
    const toPlayer = Math.atan2(p.y - this.y, p.x - this.x);
    const inView = hunting || d < SHADOW.NOTICE_CLOSE || Math.abs(wrap(toPlayer - this.facing)) < SHADOW.VIEW_ANGLE / 2;
    const seen = los && inView && d < sightRange;
    let noiseRange: number = p.speed > SHADOW.RUN_SPEED_ABOVE ? SHADOW.NOISE_RUN : p.speed > SHADOW.WALK_SPEED_ABOVE ? SHADOW.NOISE_WALK : 0;
    if (p.hidden) noiseRange = d < SHADOW.HIDDEN_RANGE ? noiseRange : 0;
    const heard = d < noiseRange;

    if (seen || heard) {
      let gain = 0;
      if (seen) gain += 0.6 + 1.8 * (1 - d / sightRange);
      if (heard) gain += 0.5 + 1.0 * (1 - d / noiseRange);
      this.awareness = Math.min(1, this.awareness + gain * dt);
      if (seen && d < SHADOW.NOTICE_CLOSE && !p.hidden) this.awareness = 1;
      this.lastKnown = [p.x, p.y];
      this.sinceStimulus = 0;
    } else {
      this.awareness = Math.max(0, this.awareness - SHADOW.AWARE_DECAY * dt);
      this.sinceStimulus += dt;
    }

    // --- what it does about it ---
    if (this.awareness >= 1 && !hunting) {
      this.enter("hunting");
      this.awareness = 1;
      events.push("noticed");
    } else if (this.awareness >= SHADOW.SUSPICIOUS_AT && (this.state === "stalking" || this.state === "searching")) {
      this.enter("investigating");
    }

    switch (this.state) {
      case "stalking": {
        if (this.stateTime > SHADOW.STALK_LIFETIME) {
          this.vanish(this.between(SHADOW.AFTER_LOST_GAP));
          break;
        }
        if (!this.path.length) this.wanderNear(p, 12, 32, dt);
        this.follow(dt, SHADOW.STALK_SPEED);
        break;
      }
      case "investigating": {
        if (this.awareness < SHADOW.SUSPICIOUS_AT * 0.5) {
          this.enter("stalking");
          break;
        }
        this.repath -= dt;
        if (this.repath <= 0 || !this.path.length) {
          this.repath = 0.8;
          this.goTo(this.lastKnown);
        }
        if (this.follow(dt, SHADOW.INVESTIGATE_SPEED) && this.distanceTo({ x: this.lastKnown[0], y: this.lastKnown[1] }) < 1.5) {
          // Got there and found nothing: look around a moment, then back to wandering.
          this.pause += dt;
          if (this.pause > 3) this.enter("stalking");
        }
        break;
      }
      case "hunting": {
        this.repath -= dt;
        if (this.repath <= 0) {
          this.repath = SHADOW.REPATH_EVERY;
          this.goTo(this.lastKnown);
        }
        this.follow(dt, SHADOW.HUNT_SPEED);
        if (d < SHADOW.CATCH_DISTANCE && !p.hidden && los) {
          events.push("caught");
          this.vanish(this.between(SHADOW.AFTER_CAUGHT_GAP));
        } else if (this.sinceStimulus > SHADOW.LOSE_AFTER) {
          events.push("lost");
          this.awareness = SHADOW.SUSPICIOUS_AT;
          this.enter("searching");
        }
        break;
      }
      case "searching": {
        if (this.stateTime > SHADOW.SEARCH_TIME) {
          this.vanish(this.between(SHADOW.AFTER_LOST_GAP));
          break;
        }
        if (!this.path.length) {
          // Check where the player was last, then poke around within a few meters of it.
          this.pause += dt;
          if (this.pause > 2.5 || this.stateTime < 0.1) {
            this.pause = 0;
            const spot = this.stateTime < 0.1 ? this.lastKnown : this.nav.randomSpot(this.floor, this.lastKnown[0], this.lastKnown[1], 2, 9, this.rand);
            if (spot) this.goTo(spot);
          }
        }
        this.follow(dt, SHADOW.SEARCH_SPEED);
        break;
      }
    }
    return events;
  }

  private goTo(target: Pt) {
    const path = this.nav.findPath(this.floor, this.x, this.y, target[0], target[1]);
    if (path) {
      this.path = path;
      this.noPath = 0;
    } else {
      this.path = [];
      this.noPath++;
    }
  }

  private wanderNear(p: PlayerSense, min: number, max: number, dt: number) {
    this.pause += dt;
    if (this.pause < 1.5) return; // a beat between wanderings
    const spot = this.nav.randomSpot(this.floor, p.x, p.y, min, max, this.rand);
    if (spot) this.goTo(spot);
    this.pause = 0;
  }

  /** Walks the current path at `speed`. Returns true once the path is used up. */
  private follow(dt: number, speed: number): boolean {
    let step = speed * dt;
    while (this.path.length && step > 0) {
      const [tx, ty] = this.path[0];
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);
      const aim = Math.atan2(dy, dx);
      if (dist > 1e-6) this.facing = wrap(this.facing + Math.max(-SHADOW.TURN_RATE * dt, Math.min(SHADOW.TURN_RATE * dt, wrap(aim - this.facing))));
      if (dist <= step) {
        this.x = tx;
        this.y = ty;
        this.path.shift();
        step -= dist;
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        step = 0;
      }
    }
    return this.path.length === 0;
  }
}
