// The watchers (CLAUDE.md, "Threats"): ordinary-looking people who never attack. They stand and stare at the player;
// when the player is not looking at one it moves closer, and the moment the player looks at it directly it freezes,
// like a statue. They never touch the player (they stop a few meters away) and never catch them: the cost is sanity,
// drained while they are in view. They come as sanity drops. No DOM and no Three.js, so scripts/test-watchers.mts
// runs the exact code the game runs.
import type { NavGrid, Pt } from "./nav";

export const WATCH = {
  /** How many watchers the mall holds at a given sanity (the first row whose `above` the sanity exceeds). */
  COUNTS: [
    { above: 0.85, count: 0 },
    { above: 0.6, count: 1 },
    { above: 0.35, count: 2 },
    { above: 0.15, count: 3 },
    { above: -1, count: 4 },
  ],
  /** They appear 18 to 40 m from the player, out of sight, on the player's floor; one new one every 8 to 20 s at most. */
  SPAWN_MIN: 18,
  SPAWN_MAX: 40,
  SPAWN_GAP: [8, 20] as [number, number],
  /** Walking speed when not observed (m/s): a calm walk, never a run. They are never in a hurry. */
  SPEED: 1.1,
  /** They stop this far from the player, and never come closer. */
  STOP_DISTANCE: 2.6,
  /** One further than this is removed (when out of sight). */
  FAR: 70,
  /** Sanity lost per second for each watcher the player can see within SEEN_RANGE meters. */
  DRAIN: 0.008,
  SEEN_RANGE: 25,
  REPATH: 1.5,
  /** Some sit instead, on a food court chair or a bench: this share of new ones, when there is a free seat out of sight. */
  SEATED_CHANCE: 0.4,
  /** A seated one never walks: while nobody looks, it is suddenly on another seat, every HOP seconds (a random time in
   *  the range), usually one nearer the player, but never one closer than HOP_MIN. */
  HOP: [3, 7] as [number, number],
  HOP_MIN: 4,
  /** How far a seated one can turn its head toward the player (radians either way); its body faces where the seat does. */
  HEAD_TURN: 1.4,
};

/** A place to sit: the hips' plan point, the heading the sitter faces, the seat's height above the floor. */
export interface Seat {
  x: number;
  y: number;
  floor: number;
  heading: number;
  height: number;
}

/** Where a sitter's hips go on each sittable piece, in the piece's own frame (it faces +x; +z is the piece's z). */
const SEATS: Record<string, { x: number; z: number; yaw: number; height: number }[]> = {
  // the four chairs of a table set (scripts/kit/pieces.mts, tableSet): at x = +-0.24, z = +-0.6, facing the table
  table_set: [-0.24, 0.24].flatMap((x) => [1, -1].map((side) => ({ x, z: side * (0.6 + 0.08), yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, height: 0.45 }))),
  // three places along the red bench (bench): its cushion top is about 0.5 m up
  bench_red: [-0.55, 0, 0.55].map((z) => ({ x: 0.04, z, yaw: 0, height: 0.5 })),
};

/** The seats among the placed props. `instances` is the props manifest: per piece, flat [x, height, -y, yaw] groups. */
export function seatsFromProps(instances: Record<string, number[]>, floorHeight: number): Seat[] {
  const out: Seat[] = [];
  for (const [piece, places] of Object.entries(SEATS)) {
    const flat = instances[piece];
    if (!flat) continue;
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const [X, h, Z, yaw] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (const p of places) {
        // three.js turns (x, z) about y by yaw: (x cos + z sin, -x sin + z cos); plan y is -z
        const wx = X + p.x * c + p.z * sn;
        const wz = Z - p.x * sn + p.z * c;
        const a = p.yaw + yaw; // the sitter faces local +x turned by both
        out.push({ x: wx, y: -wz, floor: Math.round(h / floorHeight), heading: Math.atan2(Math.sin(a), Math.cos(a)), height: p.height });
      }
    }
  }
  return out;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type WatcherLook = "shopper" | "jacket" | "hoodie" | "guardlike";
const LOOKS: WatcherLook[] = ["shopper", "jacket", "hoodie", "guardlike"];

export interface Watcher {
  id: number;
  x: number;
  y: number;
  floor: number;
  /** Plan heading: always toward the player. */
  facing: number;
  look: WatcherLook;
  /** Height scale, so they are not copies of one another. */
  height: number;
  /** True this frame when the player is looking at it (it stands frozen). */
  frozen: boolean;
  /** True when it is in view and within SEEN_RANGE (it costs sanity). */
  seen: boolean;
  path: Pt[];
  repath: number;
  /** Set when it sits: the seat it is on. A seated one never walks; it changes seats while nobody looks. */
  seat?: Seat;
  /** Seated: seconds left before it changes seats (counts only while unobserved). */
  hop?: number;
  /** How far the head is turned from the body toward the player (radians; 0 for a standing one, which faces the player). */
  headTurn?: number;
  /** Debug/test watchers: kept regardless of sanity (the sanity cull would remove them at once). */
  pinned?: boolean;
}

export interface WatchContext {
  nav: NavGrid;
  px: number;
  py: number;
  floor: number;
  sanity: number;
  /** Whether the player can see a watcher standing at the plan point right now (in view, in line of sight). */
  observed(x: number, y: number): boolean;
}

export const targetCount = (sanity: number): number => (WATCH.COUNTS.find((r) => sanity > r.above) ?? WATCH.COUNTS[WATCH.COUNTS.length - 1]).count;

export class Watchers {
  readonly list: Watcher[] = [];
  enabled = true;
  /** The places to sit (seatsFromProps); none means everyone stands. */
  seats: Seat[] = [];
  private nextId = 1;
  private spawnTimer = 0;
  private rand: () => number;
  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.spawnTimer = 4;
  }

  /** Sanity drain per second from the watchers the player is looking at. */
  get drain(): number {
    return this.list.filter((w) => w.seen).length * WATCH.DRAIN;
  }

  clear() {
    this.list.length = 0;
  }

  /** Puts one on a seat now (debug, tests). */
  sit(seat: Seat, look: WatcherLook = "shopper"): Watcher {
    const w = this.add(seat.x, seat.y, seat.floor, look, seat.heading);
    w.seat = seat;
    w.hop = this.hopTime();
    w.headTurn = 0;
    return w;
  }

  private hopTime() {
    return WATCH.HOP[0] + this.rand() * (WATCH.HOP[1] - WATCH.HOP[0]);
  }

  /** A free seat on the floor, out of sight, between `min` and `max` meters from the player; `nearer` (when given) prefers
   *  ones closer to the player than that distance. */
  freeSeat(ctx: WatchContext, min: number, max: number, nearer?: number): Seat | null {
    const taken = new Set(this.list.map((w) => w.seat).filter(Boolean));
    const ok = this.seats.filter((s) => {
      if (s.floor !== ctx.floor || taken.has(s)) return false;
      const d = Math.hypot(s.x - ctx.px, s.y - ctx.py);
      return d >= min && d <= max && !ctx.observed(s.x, s.y);
    });
    if (!ok.length) return null;
    const closer = nearer === undefined ? [] : ok.filter((s) => Math.hypot(s.x - ctx.px, s.y - ctx.py) < nearer);
    const pool = closer.length && this.rand() < 0.75 ? closer : ok;
    return pool[Math.floor(this.rand() * pool.length)];
  }

  /** Puts one at a spot now (debug, tests). */
  add(x: number, y: number, floor: number, look: WatcherLook = "shopper", facing = 0): Watcher {
    const w: Watcher = { id: this.nextId++, x, y, floor, facing, look, height: 1, frozen: false, seen: false, path: [], repath: 0, pinned: true };
    this.list.push(w);
    return w;
  }

  update(dt: number, ctx: WatchContext) {
    if (!this.enabled) {
      this.list.length = 0;
      return;
    }
    const want = targetCount(ctx.sanity);
    // changing floor takes them away: the mall rearranges itself
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].floor !== ctx.floor) this.list.splice(i, 1);
    // too many (sanity recovered), or too far: the unseen ones go
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      const far = Math.hypot(w.x - ctx.px, w.y - ctx.py) > WATCH.FAR;
      if (!w.pinned && (far || this.list.length > want) && !ctx.observed(w.x, w.y)) this.list.splice(i, 1);
    }
    // a new one, now and then, where the player cannot see
    this.spawnTimer -= dt;
    if (this.list.length < want && this.spawnTimer <= 0) {
      const seat = this.rand() < WATCH.SEATED_CHANCE ? this.freeSeat(ctx, WATCH.SPAWN_MIN, WATCH.SPAWN_MAX) : null;
      if (seat) {
        const w = this.sit(seat, LOOKS[Math.floor(this.rand() * LOOKS.length)]);
        w.pinned = false;
        w.height = 0.94 + this.rand() * 0.14;
      }
      const spot = seat ? null : ctx.nav.randomSpot(ctx.floor, ctx.px, ctx.py, WATCH.SPAWN_MIN, WATCH.SPAWN_MAX, this.rand, (x, y) => !ctx.observed(x, y));
      if (spot) {
        this.list.push({
          id: this.nextId++,
          x: spot[0],
          y: spot[1],
          floor: ctx.floor,
          facing: Math.atan2(ctx.py - spot[1], ctx.px - spot[0]),
          look: LOOKS[Math.floor(this.rand() * LOOKS.length)],
          height: 0.94 + this.rand() * 0.14,
          frozen: false,
          seen: false,
          path: [],
          repath: 0,
        });
      }
      this.spawnTimer = WATCH.SPAWN_GAP[0] + this.rand() * (WATCH.SPAWN_GAP[1] - WATCH.SPAWN_GAP[0]);
    }
    for (const w of this.list) {
      const dist = Math.hypot(ctx.px - w.x, ctx.py - w.y);
      const toPlayer = Math.atan2(ctx.py - w.y, ctx.px - w.x);
      const looked = ctx.observed(w.x, w.y);
      w.frozen = looked;
      w.seen = looked && dist <= WATCH.SEEN_RANGE;
      if (w.seat) {
        // seated: the body faces where the seat does, the head turns toward the player as far as a neck can
        w.facing = w.seat.heading;
        w.headTurn = Math.max(-WATCH.HEAD_TURN, Math.min(WATCH.HEAD_TURN, wrapAngle(toPlayer - w.seat.heading)));
        if (looked) continue; // while watched it stays put; the hop clock runs only while nobody looks
        w.hop = (w.hop ?? 0) - dt;
        if (w.hop > 0) continue;
        w.hop = this.hopTime();
        const next = this.freeSeat(ctx, WATCH.HOP_MIN, WATCH.SPAWN_MAX, dist);
        if (next) {
          w.seat = next;
          w.x = next.x;
          w.y = next.y;
          w.facing = next.heading;
          w.headTurn = Math.max(-WATCH.HEAD_TURN, Math.min(WATCH.HEAD_TURN, wrapAngle(Math.atan2(ctx.py - next.y, ctx.px - next.x) - next.heading)));
        }
        continue;
      }
      w.facing = toPlayer;
      if (looked || dist <= WATCH.STOP_DISTANCE) continue; // frozen while watched; and it never comes closer than this
      w.repath -= dt;
      if (w.repath <= 0 || w.path.length === 0) {
        w.path = ctx.nav.findPath(ctx.floor, w.x, w.y, ctx.px, ctx.py) ?? [];
        w.repath = WATCH.REPATH;
      }
      let move = WATCH.SPEED * dt;
      while (move > 0 && w.path.length) {
        const [tx, ty] = w.path[0];
        const d = Math.hypot(tx - w.x, ty - w.y);
        const room = Math.max(0, Math.hypot(ctx.px - w.x, ctx.py - w.y) - WATCH.STOP_DISTANCE); // stop short of the player
        if (room <= 0) break;
        const step = Math.min(move, d, room);
        if (d > 1e-6) {
          w.x += ((tx - w.x) / d) * step;
          w.y += ((ty - w.y) / d) * step;
        }
        move -= step;
        if (step >= d - 1e-6) w.path.shift();
        else if (step >= room - 1e-6) break;
      }
    }
  }
}

/**
 * Watchers on the security feeds. While the player sits at the monitors the ones around them hold still (the runtime
 * stops updating them), so they do not pile up in the office. Instead the mall puts a couple on the feeds: each one
 * stands in a random camera's view, staring into the lens, and freezes while that feed is on screen. Off screen it
 * either creeps closer to its camera or goes to another one, so coming back to a feed may show it nearer, or gone.
 */
export const FEED = {
  /** At most this many on the feeds (and never more than targetCount at this sanity). */
  MAX: 2,
  /** A new one every 3 to 8 s at most, while there are fewer than wanted. */
  SPAWN_GAP: [3, 8] as [number, number],
  /** Where it stands: this far from the camera (m), within this half-angle of where it looks (radians). */
  NEAR: 6,
  FAR: 20,
  CONE: 0.45,
  /** Off screen this long (s), it moves: to another camera (MOVE_CHANCE), or this much closer to its own. */
  MOVE_GAP: [5, 12] as [number, number],
  MOVE_CHANCE: 0.35,
  STEP: [2, 4] as [number, number],
  /** It never comes closer to the lens than this (m). */
  CLOSEST: 3.5,
};

/** A camera as FeedWatchers needs it: a plan point over open floor, its floor, the plan heading it looks along (degrees). */
export interface FeedCamera {
  x: number;
  y: number;
  floor: number;
  heading: number;
}

export interface FeedContext {
  nav: NavGrid;
  cameras: FeedCamera[];
  /** The camera whose picture is on screen now (after the mall's lies). */
  shown: number;
  sanity: number;
}

export class FeedWatchers {
  readonly list: Watcher[] = [];
  /** The camera each one stands in front of, by watcher id. */
  private cam = new Map<number, number>();
  private away = new Map<number, number>();
  /** Ids from far above the room watchers', so the view keeps them apart. */
  private nextId = 100000;
  private spawnTimer = 1.5;
  private rand: () => number;
  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  /** Sanity drain per second: the ones on the feed on screen. */
  get drain(): number {
    return this.list.filter((w) => w.seen).length * WATCH.DRAIN;
  }

  /** The camera a watcher stands in front of. */
  cameraOf(w: Watcher): number | undefined {
    return this.cam.get(w.id);
  }

  clear() {
    this.list.length = 0;
    this.cam.clear();
    this.away.clear();
    this.spawnTimer = 1.5;
  }

  private between([a, b]: [number, number]) {
    return a + this.rand() * (b - a);
  }

  /** A spot in camera `c`'s view, between `min` and `max` meters from it, that it can see; null if none. */
  private spotFor(ctx: FeedContext, c: number, min: number, max: number): [number, number] | null {
    const cam = ctx.cameras[c];
    const look = (cam.heading * Math.PI) / 180;
    for (let tries = 0; tries < 60; tries++) {
      const a = look + (this.rand() * 2 - 1) * FEED.CONE;
      const d = min + this.rand() * Math.max(0, max - min);
      const x = cam.x + Math.cos(a) * d;
      const y = cam.y + Math.sin(a) * d;
      if (ctx.nav.walkable(cam.floor, x, y) && ctx.nav.sees(cam.floor, cam.x, cam.y, x, y)) return [x, y];
    }
    return null;
  }

  /** A random camera other than the one on screen, with nobody in front of it. */
  private freeCamera(ctx: FeedContext): number | null {
    const used = new Set(this.cam.values());
    const free = ctx.cameras.map((_, i) => i).filter((i) => i !== ctx.shown && !used.has(i));
    return free.length ? free[Math.floor(this.rand() * free.length)] : null;
  }

  private place(w: Watcher, ctx: FeedContext, c: number, at: [number, number]) {
    const cam = ctx.cameras[c];
    this.cam.set(w.id, c);
    w.x = at[0];
    w.y = at[1];
    w.floor = cam.floor;
    w.facing = Math.atan2(cam.y - at[1], cam.x - at[0]); // staring into the lens
    this.away.set(w.id, this.between(FEED.MOVE_GAP));
  }

  update(dt: number, ctx: FeedContext) {
    const want = Math.min(FEED.MAX, targetCount(ctx.sanity));
    // too many (sanity recovered): the ones off screen go
    for (let i = this.list.length - 1; i >= 0 && this.list.length > want; i--) {
      const w = this.list[i];
      if (this.cam.get(w.id) === ctx.shown) continue;
      this.list.splice(i, 1);
      this.cam.delete(w.id);
      this.away.delete(w.id);
    }
    this.spawnTimer -= dt;
    if (this.list.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = this.between(FEED.SPAWN_GAP);
      const c = this.freeCamera(ctx);
      const at = c === null ? null : this.spotFor(ctx, c, FEED.NEAR, FEED.FAR);
      if (c !== null && at) {
        const w: Watcher = { id: this.nextId++, x: 0, y: 0, floor: 0, facing: 0, look: LOOKS[Math.floor(this.rand() * LOOKS.length)], height: 0.94 + this.rand() * 0.14, frozen: false, seen: false, path: [], repath: 0 };
        this.place(w, ctx, c, at);
        this.list.push(w);
      }
    }
    for (const w of this.list) {
      const c = this.cam.get(w.id)!;
      const onScreen = c === ctx.shown;
      w.frozen = onScreen;
      w.seen = onScreen;
      if (onScreen) continue; // while its feed is on screen it does not move at all
      const left = (this.away.get(w.id) ?? 0) - dt;
      this.away.set(w.id, left);
      if (left > 0) continue;
      const cam = ctx.cameras[c];
      const now = Math.hypot(w.x - cam.x, w.y - cam.y);
      const other = this.rand() < FEED.MOVE_CHANCE ? this.freeCamera(ctx) : null;
      const at =
        other !== null
          ? this.spotFor(ctx, other, FEED.NEAR, FEED.FAR)
          : this.spotFor(ctx, c, Math.max(FEED.CLOSEST, now - FEED.STEP[1]), Math.max(FEED.CLOSEST, now - FEED.STEP[0]));
      if (at) this.place(w, ctx, other ?? c, at);
      else this.away.set(w.id, this.between(FEED.MOVE_GAP));
    }
  }
}
