// Watchers test: the stand-still-when-seen, creep-when-not behavior (src/engine/watchers.ts), in made-up rooms and
// on the real mall. Run: npm run test:watchers   (the mall check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { NavGrid, type NavData } from "../src/engine/nav.ts";
import { WATCH, Watchers, targetCount, type WatchContext } from "../src/engine/watchers.ts";

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
function arena(nx: number, ny: number): NavGrid {
  const walk = new Uint8Array(nx * ny);
  const opaque = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const border = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      walk[j * nx + i] = border ? 0 : 1;
      opaque[j * nx + i] = border ? 1 : 0;
    }
  return new NavGrid(nx, ny, 1, [{ walk, opaque }]);
}
const nav = arena(80, 40);
const ctx = (over: Partial<WatchContext> = {}): WatchContext => ({ nav, px: 10.5, py: 20.5, floor: 0, sanity: 0.1, observed: () => false, ...over });

check("counts by sanity: none when calm, more as it falls", targetCount(1) === 0 && targetCount(0.7) === 1 && targetCount(0.5) === 2 && targetCount(0.3) === 3 && targetCount(0.05) === 4);

{
  const w = new Watchers(seeded(1));
  for (let t = 0; t < 30 && w.list.length === 0; t += 0.1) w.update(0.1, ctx());
  check("they appear when sanity is low, out of sight, in range", w.list.length >= 1);
  const spawned = w.list[0];
  const d = Math.hypot(spawned.x - 10.5, spawned.y - 20.5);
  check("at a distance (18 to 40 m), on the floor", d >= WATCH.SPAWN_MIN - 1 && d <= WATCH.SPAWN_MAX + 1 && spawned.floor === 0, `${d.toFixed(1)} m`);
  const calm = new Watchers(seeded(1));
  for (let t = 0; t < 120; t += 0.1) calm.update(0.1, ctx({ sanity: 1 }));
  check("none at full sanity", calm.list.length === 0);
}
{
  // unobserved: it creeps closer, and stops short of the player
  const w = new Watchers(seeded(2));
  w.list.push({ id: 1, x: 40.5, y: 20.5, floor: 0, facing: Math.PI, look: "shopper", height: 1, frozen: false, seen: false, path: [], repath: 0 });
  let minD = Infinity;
  const start = Math.hypot(40.5 - 10.5, 0);
  for (let t = 0; t < 60; t += 1 / 30) {
    w.update(1 / 30, ctx({ sanity: 0.5 })); // 2 wanted: one more will spawn too, that is fine
    minD = Math.min(minD, ...w.list.filter((x) => x.id === 1).map((x) => Math.hypot(x.x - 10.5, x.y - 20.5)));
  }
  const first = w.list.find((x) => x.id === 1)!;
  const end = Math.hypot(first.x - 10.5, first.y - 20.5);
  check("not observed: it comes closer", end < start - 15, `${start.toFixed(1)} -> ${end.toFixed(1)} m`);
  check("and stops short of the player, never touching", minD >= WATCH.STOP_DISTANCE - 0.05 && end <= WATCH.STOP_DISTANCE + 0.3, `${minD.toFixed(2)} m`);
  check("it faces the player", Math.abs(Math.sin(first.facing - Math.atan2(20.5 - first.y, 10.5 - first.x))) < 1e-6);
}
{
  // observed: frozen exactly where it was
  const w = new Watchers(seeded(3));
  w.list.push({ id: 1, x: 30.5, y: 20.5, floor: 0, facing: Math.PI, look: "jacket", height: 1, frozen: false, seen: false, path: [], repath: 0 });
  for (let t = 0; t < 20; t += 1 / 30) w.update(1 / 30, ctx({ sanity: 0.5, observed: (x) => x === 30.5 }));
  const f = w.list.find((x) => x.id === 1)!;
  check("observed: it does not move at all", f.x === 30.5 && f.y === 20.5 && f.frozen);
  check("and costs sanity while in view", f.seen && w.drain >= WATCH.DRAIN - 1e-12, `${w.drain.toFixed(4)}/s`);
  // looked at, then not: it moves again
  for (let t = 0; t < 5; t += 1 / 30) w.update(1 / 30, ctx({ sanity: 0.5 }));
  const g = w.list.find((x) => x.id === 1)!;
  check("the moment the player looks away it moves again", g.x < 30.5 - 2);
}
{
  // the alternating gaze: a player who keeps glancing never lets one reach them faster than the unobserved time allows
  const w = new Watchers(seeded(4));
  w.list.push({ id: 1, x: 50.5, y: 20.5, floor: 0, facing: Math.PI, look: "hoodie", height: 1, frozen: false, seen: false, path: [], repath: 0 });
  let moved = 0;
  let last = 50.5;
  for (let t = 0; t < 20; t += 1 / 30) {
    const watching = Math.floor(t) % 2 === 0; // looks for 1 s, away for 1 s
    w.update(1 / 30, ctx({ sanity: 0.5, observed: (x) => watching && x > 0 }));
    const cur = w.list.find((x) => x.id === 1)!.x;
    if (watching && cur !== last) moved += Math.abs(cur - last);
    last = cur;
  }
  check("while watched it never moves, even when the gaze keeps coming and going", moved < 1e-9);
}
{
  // sanity recovers: the extras go (when unseen), changing floor takes them away
  const w = new Watchers(seeded(5));
  for (let t = 0; t < 120; t += 0.1) w.update(0.1, ctx({ sanity: 0.1 }));
  const many = w.list.length;
  for (let t = 0; t < 5; t += 0.1) w.update(0.1, ctx({ sanity: 1 }));
  check("they leave when sanity recovers", many >= 3 && w.list.length === 0, `${many} -> ${w.list.length}`);
  for (let t = 0; t < 60; t += 0.1) w.update(0.1, ctx({ sanity: 0.1 }));
  const before = w.list.length;
  w.update(0.1, ctx({ sanity: 0.1, floor: 1 }));
  check("a floor change takes them away", before > 0 && w.list.every((x) => x.floor === 1));
  const off = new Watchers(seeded(6));
  off.enabled = false;
  for (let t = 0; t < 60; t += 0.1) off.update(0.1, ctx());
  check("disabled: none", off.list.length === 0);
}

if (existsSync("public/models/nav.json")) {
  const real = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  const w = new Watchers(seeded(9));
  const c: WatchContext = { nav: real, px: 62.5, py: 20.5, floor: 1, sanity: 0.1, observed: () => false };
  for (let t = 0; t < 40; t += 0.1) w.update(0.1, c);
  check("on the real mall they appear", w.list.length >= 1, `${w.list.length}`);
  check("on walkable floor", w.list.every((x) => real.walkable(1, x.x, x.y)));
  const before = w.list.map((x) => Math.hypot(x.x - c.px, x.y - c.py));
  for (let t = 0; t < 120; t += 1 / 30) w.update(1 / 30, c);
  const after = w.list.map((x) => Math.hypot(x.x - c.px, x.y - c.py));
  check("and they close in, never within the stop distance", after.every((d) => d >= WATCH.STOP_DISTANCE - 0.1) && Math.min(...after) < Math.min(...before), `${Math.min(...before).toFixed(0)} -> ${Math.min(...after).toFixed(1)} m`);
  check("still on walkable floor after walking", w.list.every((x) => real.walkable(1, x.x, x.y)));
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
