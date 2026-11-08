// Girl in white test: the apparition's life, the timer and where she can stand (src/engine/girl.ts), on the real mall.
// Run: npm run test:girl   (the placement check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { Apparition, GIRL, GirlDirector, pickGirlSpot } from "../src/engine/girl.ts";
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

{
  const a = new Apparition("corridor", { x: 0, y: 0, facing: 0 }, 2);
  check("starts invisible", a.opacity === 0 && !a.done);
  a.update(GIRL.FADE / 2, 10);
  check("fades in", a.opacity > 0.3 && a.opacity < 0.7, a.opacity.toFixed(2));
  a.update(1.5, 10);
  check("fully there while she stays", a.opacity === 1);
  a.update(0.5, 10);
  check("fades out", a.opacity > 0 && a.opacity < 1 && !a.done, a.opacity.toFixed(2));
  a.update(0.5, 10);
  check("then is done", a.done && a.opacity === 0);
  const b = new Apparition("corridor", { x: 0, y: 0, facing: 0 }, 2);
  b.update(1, 10);
  b.update(0.05, GIRL.VANISH_NEAR - 0.5);
  b.update(0.06, GIRL.VANISH_NEAR - 0.5);
  check("walking up to her makes her vanish at once", b.opacity < 1 && b.opacity > 0, b.opacity.toFixed(2));
  b.update(0.2, GIRL.VANISH_NEAR - 1);
  check("and she is done", b.done && b.opacity === 0);
}
{
  const d = new GirlDirector(seeded(2));
  let first = 0;
  while (!d.update(1, 0, false)) first++;
  check("the first one comes within its window", first + 1 >= GIRL.FIRST[0] - 1 && first + 1 <= GIRL.FIRST[1] + 1, `${first + 1} s`);
  const gap = (shift: number) => {
    const g = new GirlDirector(seeded(8));
    g.soon(0);
    g.update(1, shift, false);
    let n = 0;
    let last = 0;
    for (let t = 0; t < 60000; t++) {
      if (g.update(1, shift, false)) {
        n++;
        last = t;
      }
    }
    return last / n;
  };
  const calm = gap(0);
  const bad = gap(3);
  check("apparitions are sparing: minutes apart", calm >= GIRL.GAP[0] - 1 && calm <= GIRL.GAP[1] + 1, `${calm.toFixed(0)} s`);
  check("more often at low sanity, still not constant", bad < calm * 0.6 && bad > 50, `${bad.toFixed(0)} s`);
  const h = new GirlDirector(seeded(3));
  h.soon(0);
  check("held while busy", !h.update(1, 0, true) && h.update(1, 0, false));
  const s = h.stay();
  check("stays a couple of seconds", s >= GIRL.STAY[0] && s <= GIRL.STAY[1]);
}
if (existsSync("public/models/nav.json")) {
  const nav = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  const rand = seeded(11);
  let found = 0;
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const px = 50 + rand() * 40;
    const py = 3 + rand() * 25;
    const heading = rand() * Math.PI * 2;
    const spot = pickGirlSpot(nav, 1, px, py, heading, rand);
    if (!spot) continue;
    found++;
    const d = Math.hypot(spot.x - px, spot.y - py);
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(spot.y - py, spot.x - px) - heading), Math.cos(Math.atan2(spot.y - py, spot.x - px) - heading)));
    if (!nav.walkable(1, spot.x, spot.y) || !nav.sees(1, px, py, spot.x, spot.y) || d < GIRL.MIN_DIST - 0.01 || d > GIRL.MAX_DIST + 0.01 || off > (GIRL.CONE * Math.PI) / 180 + 1e-6) ok = false;
    const toPlayer = Math.atan2(py - spot.y, px - spot.x);
    if (Math.abs(Math.sin(toPlayer - spot.facing)) > 1e-6) ok = false;
  }
  check("a spot is found where there is open floor ahead", found > 40, `${found}/200`);
  check("every spot is walkable, in sight, in range, in the cone, facing the player", ok);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
