// Girl in white test: the apparition's life, the timer and where she can stand (src/engine/girl.ts), on the real mall.
// Run: npm run test:girl   (the placement check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { Apparition, GIRL, GirlDirector, girlDrain, pickGirlSpot, pickHiddenAhead } from "../src/engine/girl.ts";
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
  const a = new Apparition("corridor", { x: 0, y: 0, facing: 0 }, seeded(1));
  check("starts invisible", a.opacity === 0 && !a.done);
  a.update(GIRL.FADE_IN / 2, 10, true);
  check("not seen while still faded", !a.wasSeen && a.opacity < 0.7, a.opacity.toFixed(2));
  check("first sight is reported once", a.update(1, 10, true) && a.wasSeen && !a.update(0.1, 10, true));
  a.update(30, 3, true);
  check("she stays while the player is close, even long after", !a.leaving && a.opacity === 1);
  check("she never leaves when approached", (a.update(1, 0.5, true), !a.leaving));
  a.update(1, GIRL.LEAVE_DIST + 1, false);
  a.update(0.5, GIRL.LEAVE_DIST + 1, false);
  check("walking away makes her leave", a.leaving && a.opacity < 1 && a.opacity > 0, a.opacity.toFixed(2));
  a.update(GIRL.FADE_OUT + 0.1, GIRL.LEAVE_DIST + 1, false);
  check("and she is gone", a.done && a.opacity === 0);
  const u = new Apparition("corridor", { x: 0, y: 0, facing: 0 }, seeded(1));
  u.update(GIRL.LOST_AFTER - 1, 8, false);
  check("never seen: she stays a while", !u.leaving && !u.wasSeen);
  u.update(2, 8, false);
  check("then the mall gives up on her", u.leaving);
  const c = new Apparition("corridor", { x: 0, y: 0, facing: 0 }, seeded(4));
  c.update(GIRL.CALL_FIRST - 0.1, 8, false);
  check("no call before the first is due", !c.takeCall());
  c.update(0.2, 8, false);
  check("she calls out", c.takeCall() && !c.takeCall());
  c.update(GIRL.CALL_GAP[0] - 0.1, 8, false);
  check("calls are spaced", !c.takeCall());
  c.update(GIRL.CALL_GAP[1], 8, false);
  check("and come again", c.takeCall());
  check("the closer, the more she drains", girlDrain(2) > girlDrain(8) && girlDrain(8) > girlDrain(15) && girlDrain(15) >= GIRL.DRAIN_FAR);
  check("touch distance is closer than the point where the drain peaks", GIRL.TOUCH_DIST < GIRL.NEAR_DIST);
  check("drain bounds", Math.abs(girlDrain(0) - GIRL.DRAIN_NEAR) < 1e-9 && Math.abs(girlDrain(GIRL.LEAVE_DIST) - GIRL.DRAIN_FAR) < 1e-9);
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
    if (!nav.walkable(1, spot.x, spot.y) || !nav.sees(1, px, py, spot.x, spot.y) || d < GIRL.MIN_DIST - 0.01 || d > GIRL.MAX_DIST + 0.01 || off < (GIRL.HIDDEN_FROM * Math.PI) / 180 - 1e-6) ok = false;
    const toPlayer = Math.atan2(py - spot.y, px - spot.x);
    if (Math.abs(Math.sin(toPlayer - spot.facing)) > 1e-6) ok = false;
  }
  check("a spot is found where there is open floor behind or beside", found > 40, `${found}/200`);
  check("every spot is walkable, in sight, in range, out of the view, facing the player", ok);
  let hid = 0;
  let hok = true;
  for (let i = 0; i < 200; i++) {
    const px = 50 + rand() * 40;
    const py = 3 + rand() * 25;
    const heading = rand() * Math.PI * 2;
    const spot = pickHiddenAhead(nav, 1, px, py, heading, rand);
    if (!spot) continue;
    hid++;
    const ang = Math.atan2(spot.y - py, spot.x - px);
    const off = Math.abs(Math.atan2(Math.sin(ang - heading), Math.cos(ang - heading)));
    if (!nav.walkable(1, spot.x, spot.y) || nav.sees(1, px, py, spot.x, spot.y) || off > (GIRL.AHEAD_CONE * Math.PI) / 180 + 1e-6) hok = false;
  }
  check("hidden spots are found ahead", hid > 10, `${hid}/200`);
  check("every hidden spot is walkable, in the cone, and out of sight", hok);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
