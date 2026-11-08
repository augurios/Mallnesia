// Shadow test: runs the game's own navigation and shadow brain (src/engine/nav.ts, shadow.ts) in made-up rooms for
// exact scenarios, and on the real mall's nav data for connectivity. Run: npm run test:shadow   (needs npm run assets)
import { readFileSync } from "node:fs";
import { NavGrid, type NavData } from "../src/engine/nav.ts";
import { Shadow, SHADOW, type PlayerSense, type ShadowEvent } from "../src/engine/shadow.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** An arena of 1 m cells: floor everywhere inside a 1-cell border; `wall(i, j)` marks solid cells (walkable off, sight blocked). */
function arena(nx: number, ny: number, wall: (i: number, j: number) => boolean = () => false): NavGrid {
  const walk = new Uint8Array(nx * ny);
  const opaque = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const border = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      const solid = border || wall(i, j);
      walk[j * nx + i] = solid ? 0 : 1;
      opaque[j * nx + i] = solid ? 1 : 0;
    }
  return new NavGrid(nx, ny, 1, [{ walk, opaque }]);
}
const player = (x: number, y: number, extra: Partial<PlayerSense> = {}): PlayerSense => ({ x, y, floor: 0, speed: 0, flashlightOn: false, hidden: false, ...extra });
const place = (s: Shadow, p: PlayerSense, x: number, y: number) => {
  s.appearAt(p.floor, x, y, Math.atan2(p.y - y, p.x - x), true); // facing the player, to test senses without the view cone in the way
};
const run = (s: Shadow, p: PlayerSense | ((t: number) => PlayerSense), seconds: number, until?: (events: ShadowEvent[]) => boolean) => {
  const all: ShadowEvent[] = [];
  let t = 0;
  for (; t < seconds; t += 1 / 30) {
    const ev = s.update(1 / 30, typeof p === "function" ? p(t) : p);
    all.push(...ev);
    if (until?.(ev)) break;
  }
  return { events: all, time: t };
};

// ---- navigation on made-up rooms -------------------------------------------------------------------
{
  const open = arena(30, 30);
  const path = open.findPath(0, 3.5, 3.5, 25.5, 20.5);
  check("an open room: one straight leg", path !== null && path.length === 1 && path[0][0] === 25.5);
  // A wall across the room with a gap at j=5..6.
  const wall = arena(30, 30, (i, j) => i === 15 && (j < 5 || j > 6));
  const around = wall.findPath(0, 3.5, 20.5, 25.5, 20.5)!;
  check("a wall with a gap: the path goes through the gap", around !== null && around.some(([x, y]) => Math.abs(x - 15.5) < 1.5 && y < 8));
  check("corner cutting leaves only a few waypoints", around.length <= 4, `${around.length}`);
  const closed = arena(30, 30, (i) => i === 15);
  check("a closed wall: no path", closed.findPath(0, 3.5, 3.5, 25.5, 3.5) === null);
  check("sight is blocked by a wall and clear in the open", !closed.sees(0, 3.5, 3.5, 25.5, 3.5) && open.sees(0, 3.5, 3.5, 25.5, 20.5));
  check("a goal inside a wall is moved to the nearest floor", wall.findPath(0, 3.5, 3.5, 15.5, 15.5) !== null);
}

// ---- senses and the hunt ---------------------------------------------------------------------------
const big = arena(60, 30);
{
  const p = player(10.5, 15.5);
  const s = new Shadow(big, seeded(1));
  s.director = false;
  place(s, p, 40.5, 15.5);
  const r = run(s, p, 3);
  check("standing still in the dark, 30 m off: it does not see you", s.awareness === 0 && !r.events.includes("noticed"), `awareness ${s.awareness.toFixed(2)}`);
}
{
  const p = player(10.5, 15.5, { flashlightOn: true });
  const s = new Shadow(big, seeded(2));
  s.director = false;
  place(s, p, 40.5, 15.5);
  const r = run(s, p, 20, (ev) => ev.includes("noticed"));
  check("flashlight on: seen from 30 m", r.events.includes("noticed"), `after ${r.time.toFixed(1)} s`);
  check("it takes a moment (awareness builds, no instant snap)", r.time > 0.5, `${r.time.toFixed(1)} s`);
}
{
  const p = player(10.5, 15.5, { flashlightOn: true, hidden: true });
  const s = new Shadow(big, seeded(3));
  s.director = false;
  place(s, p, 18.5, 15.5);
  const r = run(s, p, 20);
  check("hidden, even with the light on, at 8 m: not noticed", !r.events.includes("noticed"));
}
{
  // Noise goes through walls: a wall with no gap between them, the player runs.
  const walled = arena(60, 30, (i) => i === 25);
  const p = player(20.5, 15.5, { speed: 7 });
  const s = new Shadow(walled, seeded(4));
  s.director = false;
  place(s, p, 30.5, 15.5);
  const r = run(s, p, 10);
  check("a running player is heard through a wall at 10 m", s.awareness > 0 || r.events.includes("noticed"), `awareness ${s.awareness.toFixed(2)}`);
  const quiet = new Shadow(walled, seeded(4));
  quiet.director = false;
  const pq = player(20.5, 15.5, { speed: 3.2 });
  place(quiet, pq, 30.5, 15.5);
  run(quiet, pq, 10);
  check("a walking player is not, at the same spot", quiet.awareness === 0, `awareness ${quiet.awareness.toFixed(2)}`);
}
{
  const p = player(10.5, 15.5);
  const s = new Shadow(big, seeded(5));
  s.director = false;
  place(s, p, 14.5, 15.5);
  const r = run(s, p, 30, (ev) => ev.includes("caught"));
  check("a still player in the dark, 4 m from its eyes, is found, hunted and caught", r.events.includes("noticed") && r.events.includes("caught"), r.events.join(","));
  check("being caught sends it away (it vanishes)", (() => {
    run(s, p, 5);
    return s.state === "absent";
  })());
}
{
  // Escape: a long corridor, the player runs, the shadow hunts at HUNT_SPEED < run speed.
  const hall = arena(200, 8);
  const p0 = player(10.5, 4.5, { speed: 7 });
  const s = new Shadow(hall, seeded(6));
  s.director = false;
  place(s, p0, 4.5, 4.5); // behind the player, who runs away down the corridor
  s.update(1 / 30, player(10.5, 4.5, { speed: 7, flashlightOn: true })); // it spots the player
  const r = run(s, (t) => player(10.5 + 7 * t, 4.5, { speed: 7 }), 40, (ev) => ev.includes("caught") || ev.includes("lost"));
  check("running away beats it (it never catches a runner)", !r.events.includes("caught"), r.events.join(","));
  check("and it loses the trail", r.events.includes("lost"), `after ${r.time.toFixed(1)} s`);
  run(s, player(150.5, 4.5), 40);
  check("a lost hunt ends: it searches, then vanishes", s.state === "absent");
}
{
  // Changing floor: it is taken away, and the director brings it back on the new floor.
  const twoFloors = [0, 1].map(() => {
    const walk = new Uint8Array(60 * 30);
    const opaque = new Uint8Array(60 * 30);
    for (let j = 0; j < 30; j++)
      for (let i = 0; i < 60; i++) {
        const solid = i === 0 || j === 0 || i === 59 || j === 29 || (i === 30 && j !== 15);
        walk[j * 60 + i] = solid ? 0 : 1;
        opaque[j * 60 + i] = solid ? 1 : 0;
      }
    return { walk, opaque };
  });
  const two = new NavGrid(60, 30, 1, twoFloors);
  const s = new Shadow(two, seeded(7));
  s.director = false;
  const p = player(10.5, 15.5);
  place(s, p, 20.5, 15.5);
  s.update(1 / 30, { ...p, floor: 1 });
  run(s, { ...p, floor: 1 }, 3);
  check("the player changes floor: it dissolves", s.state === "absent");
  s.director = true;
  const r = run(s, { ...p, floor: 1 }, 60, (ev) => ev.includes("appeared"));
  check("and returns on the new floor, soon", r.events.includes("appeared") && s.floor === 1, `after ${r.time.toFixed(0)} s`);
}
{
  // The director: first appearance after FIRST_SPAWN, out of sight and far enough.
  const walled = arena(80, 40, (i, j) => i === 40 && j !== 20);
  const p = player(10.5, 10.5);
  const s = new Shadow(walled, seeded(8));
  const r = run(s, p, 80, (ev) => ev.includes("appeared"));
  check("it first appears about when the timer says", r.events.includes("appeared") && Math.abs(r.time - SHADOW.FIRST_SPAWN) < 1, `${r.time.toFixed(1)} s`);
  check("out of the player's sight, and far", !walled.sees(0, p.x, p.y, s.x, s.y) && s.distanceTo(p) >= SHADOW.SPAWN_DISTANCE[0] - 1.5, `${s.distanceTo(p).toFixed(1)} m`);
  check("hunting is exposed for the save rule", !s.hunting);
}
{
  // It wanders only on walkable ground.
  const maze = arena(60, 30, (i, j) => (i % 10 === 5 && j < 25) || (i % 10 === 0 && j > 4));
  const p = player(2.5, 2.5);
  const s = new Shadow(maze, seeded(9));
  s.director = false;
  if (!s.spawn(p, false)) s.spawn(p, true);
  let bad = 0;
  for (let t = 0; t < 60; t += 1 / 30) {
    s.update(1 / 30, p);
    if (s.state !== "absent" && !maze.walkable(0, s.x, s.y)) bad++;
  }
  check("while wandering it never leaves walkable ground", bad === 0, `${bad} frames off`);
}

// ---- the real mall ---------------------------------------------------------------------------------
{
  const data = JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData;
  const nav = NavGrid.fromData(data);
  check("the nav file has three floors", nav.floorCount === 3 && nav.nx === 150 && nav.ny === 210);
  check("the food court is walkable on floor 2, the atrium void is not", nav.walkable(1, 60, 33) && !nav.walkable(1, 64, 100));
  check("the atrium void is floor on the ground floor", nav.walkable(0, 64, 100));
  const path = nav.findPath(1, 60, 33, 48, 150);
  check("a path runs from the food court to the north end of the west hall", path !== null && path.length > 1 && path.length < 60, path ? `${path.length} legs` : "none");
  const ms = (() => {
    const t0 = performance.now();
    for (let n = 0; n < 20; n++) nav.findPath(1, 60, 33, 48, 150);
    return (performance.now() - t0) / 20;
  })();
  check("a long path takes a few milliseconds", ms < 15, `${ms.toFixed(1)} ms`);
  const rand = seeded(10);
  const p = { x: 60, y: 33, floor: 1, speed: 0, flashlightOn: false, hidden: false };
  const s = new Shadow(nav, rand);
  let spawned = 0;
  for (let n = 0; n < 20; n++) if (s.spawn(p)) spawned++;
  check("it can be placed in the food court, out of sight", spawned === 20 && !nav.sees(1, p.x, p.y, s.x, s.y));
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("shadow: all checks passed");
