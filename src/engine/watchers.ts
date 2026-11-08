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
};

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

  /** Puts one at a spot now (debug, tests). */
  add(x: number, y: number, floor: number, look: WatcherLook = "shopper", facing = 0): Watcher {
    const w: Watcher = { id: this.nextId++, x, y, floor, facing, look, height: 1, frozen: false, seen: false, path: [], repath: 0 };
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
      if ((far || this.list.length > want) && !ctx.observed(w.x, w.y)) this.list.splice(i, 1);
    }
    // a new one, now and then, where the player cannot see
    this.spawnTimer -= dt;
    if (this.list.length < want && this.spawnTimer <= 0) {
      const spot = ctx.nav.randomSpot(ctx.floor, ctx.px, ctx.py, WATCH.SPAWN_MIN, WATCH.SPAWN_MAX, this.rand, (x, y) => !ctx.observed(x, y));
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
      w.facing = Math.atan2(ctx.py - w.y, ctx.px - w.x);
      const looked = ctx.observed(w.x, w.y);
      w.frozen = looked;
      w.seen = looked && dist <= WATCH.SEEN_RANGE;
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
