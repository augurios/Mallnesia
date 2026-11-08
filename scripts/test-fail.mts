// Fail test: the game's own fail timeline (src/engine/fail.ts) and the wake-up spots on the real mall.
// Run: npm run test:fail   (the spot check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { Fail, pickWakeSpot } from "../src/engine/fail.ts";
import { NavGrid, type NavData } from "../src/engine/nav.ts";

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

for (const reason of ["caught", "faint"] as const) {
  const f = new Fail();
  check(`${reason}: starts playing, clear screen`, f.state === "playing" && f.fade === 0 && !f.locked);
  check(`${reason}: triggers`, f.trigger(reason));
  check(`${reason}: a second trigger is ignored`, !f.trigger("faint") && f.reason === reason);
  let moves = 0;
  let maxFade = 0;
  let lockedWhenMoved = false;
  let last = 0;
  let monotonicDown = true;
  let t = 0;
  for (; t < 12 && f.state !== "playing"; t += 1 / 60) {
    const ev = f.update(1 / 60);
    if (ev === "move") {
      moves++;
      lockedWhenMoved = f.fade === 1 && f.locked;
    }
    if (f.state === "falling" && f.fade < last - 1e-9) monotonicDown = false;
    if (f.state === "falling") last = f.fade;
    maxFade = Math.max(maxFade, f.fade);
  }
  check(`${reason}: the player is moved exactly once, while fully black`, moves === 1 && lockedWhenMoved);
  check(`${reason}: goes fully black, smoothly`, maxFade === 1 && monotonicDown);
  check(`${reason}: ends playing with a clear screen`, f.state === "playing" && f.fade === 0, `${t.toFixed(1)} s`);
  check(`${reason}: can fail again`, f.trigger(reason));
}
{
  const f = new Fail();
  f.trigger("caught");
  let wakingFree = false;
  for (let i = 0; i < 600; i++) {
    f.update(1 / 60);
    if (f.state === "waking" && !f.locked) wakingFree = true;
  }
  check("control is back while the picture returns", wakingFree);
  const g = new Fail();
  g.trigger("faint");
  const h = new Fail();
  h.trigger("caught");
  let tg = 0;
  let th = 0;
  while (g.state === "falling") {
    g.update(1 / 60);
    tg += 1 / 60;
  }
  while (h.state === "falling") {
    h.update(1 / 60);
    th += 1 / 60;
  }
  check("fainting goes down slower than being caught", tg > th + 0.5, `${tg.toFixed(1)} vs ${th.toFixed(1)} s`);
}

if (existsSync("public/models/nav.json")) {
  const nav = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  const rand = seeded(5);
  let ok = 0;
  let far = 0;
  const floors = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const fl = i % 3;
    const x = 60 + rand() * 40;
    const y = 20 + rand() * 120;
    const spot = pickWakeSpot(nav, fl, x, y, rand);
    if (!spot) continue;
    ok++;
    floors.add(spot.floor);
    if (nav.walkable(spot.floor, spot.x, spot.y)) far++;
  }
  check("a wake-up spot is nearly always found", ok >= 195, `${ok}/200`);
  check("every spot is on walkable floor", far === ok);
  check("across all three floors", floors.size === 3);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
