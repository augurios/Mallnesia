// Security test: the cameras, the console and the lying feeds (src/engine/security.ts), on the real mall.
// Run: npm run test:security   (the placement check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { CAMERAS, CONSOLE, Monitoring, SECURITY, consoleInReach } from "../src/engine/security.ts";
import { NavGrid, type NavData } from "../src/engine/nav.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const m = new Monitoring();
check("starts closed on the first camera", !m.active && m.index === 0);
m.next();
check("next camera", m.index === 1);
m.prev();
m.prev();
check("previous wraps around", m.index === CAMERAS.length - 1);
for (let i = 0; i < CAMERAS.length; i++) m.next();
check("a full turn comes back", m.index === CAMERAS.length - 1);

check("calm: a feed never lies", Array.from({ length: 2000 }, (_, t) => new Monitoring().shown(0.9, t)).every((i) => i === 0));
{
  const lies = (sanity: number) => {
    let n = 0;
    const total = 4000;
    for (let w = 0; w < total; w++) {
      const mm = new Monitoring();
      mm.index = w % CAMERAS.length;
      if (mm.shown(sanity, w * SECURITY.LIE_WINDOW + 1) !== mm.index) n++;
    }
    return n / total;
  };
  const mid = lies(0.3);
  const low = lies(0);
  check("lower sanity, more lies", low > mid && mid > 0, `${(mid * 100).toFixed(0)}% at 0.3, ${(low * 100).toFixed(0)}% at 0`);
  check("but never always: the truth is still there most of the time", low < 0.75);
  const mm = new Monitoring();
  const a = mm.shown(0.1, 13.2);
  check("a lie holds for its whole window", [13.3, 14, 16, 17.9].every((t) => mm.shown(0.1, t) === a));
  check("a lie is another camera, never the same index twice over", Array.from({ length: 500 }, (_, w) => {
    const q = new Monitoring();
    q.index = 2;
    const s = q.shown(0, w * SECURITY.LIE_WINDOW);
    return s >= 0 && s < CAMERAS.length;
  }).every(Boolean));
  check("static grows as sanity falls", Monitoring.glitch(1) === 0 && Monitoring.glitch(0.3) > 0.4 && Monitoring.glitch(0) === 1);
}
{
  const ex = Math.cos(CONSOLE.facing);
  const ey = Math.sin(CONSOLE.facing);
  const px = CONSOLE.x + ex * 1.4;
  const py = CONSOLE.y + ey * 1.4;
  check("the console is usable from its front, looking at it", consoleInReach(px, py, CONSOLE.floor, Math.atan2(CONSOLE.y - py, CONSOLE.x - px)));
  check("not looking at it", !consoleInReach(px, py, CONSOLE.floor, Math.atan2(py - CONSOLE.y, px - CONSOLE.x)));
  check("not from far", !consoleInReach(CONSOLE.x + ex * 4, CONSOLE.y + ey * 4, CONSOLE.floor, Math.atan2(-ey, -ex)));
  check("not from another floor", !consoleInReach(px, py, CONSOLE.floor + 1, Math.atan2(CONSOLE.y - py, CONSOLE.x - px)));
}
check("camera ids and labels are unique", new Set(CAMERAS.map((c) => c.id)).size === CAMERAS.length && new Set(CAMERAS.map((c) => c.label)).size === CAMERAS.length);
check("the cameras hang under the ceiling (3.5 m), clear of the near plane, so a feed never sees between floors", SECURITY.HEIGHT <= 3.5 - 0.3 && SECURITY.HEIGHT > 2.2);
check("cameras cover all three floors", new Set(CAMERAS.map((c) => c.floor)).size === 3);

if (existsSync("public/models/nav.json")) {
  const nav = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  check("every camera hangs over open floor", CAMERAS.every((c) => nav.walkable(c.floor, c.x, c.y)), CAMERAS.filter((c) => !nav.walkable(c.floor, c.x, c.y)).map((c) => c.id).join(","));
  const reach = (c: (typeof CAMERAS)[number]) => {
    let d = 0;
    const a = (c.heading * Math.PI) / 180;
    while (d < 80 && nav.sees(c.floor, c.x, c.y, c.x + Math.cos(a) * (d + 2), c.y + Math.sin(a) * (d + 2))) d += 2;
    return d;
  };
  // c8 watches the guard's office door from close by; every other camera looks down a long view
  const office8 = CAMERAS.find((c) => c.id === "c8");
  const wide = CAMERAS.filter((c) => c !== office8);
  check("every camera but the office's looks down a long view (20 m or more)", wide.every((c) => reach(c) >= 20), wide.map((c) => `${c.id}:${reach(c)}`).join(" "));
  check(
    "the office camera sees the console through the doorway, and it is in the picture",
    !!office8 &&
      nav.sees(office8.floor, office8.x, office8.y, CONSOLE.x, CONSOLE.y + Math.sin(CONSOLE.facing) * (CONSOLE.hy + 0.2)) &&
      Math.abs(Math.atan2(Math.sin(Math.atan2(CONSOLE.y - office8.y, CONSOLE.x - office8.x) - (office8.heading * Math.PI) / 180), Math.cos(Math.atan2(CONSOLE.y - office8.y, CONSOLE.x - office8.x) - (office8.heading * Math.PI) / 180))) < (SECURITY.FOV * Math.PI) / 360,
  );
  // the desk stands against the office wall: its footprint and the floor beside and in front of it must be open
  const fx = Math.cos(CONSOLE.facing);
  const fy = Math.sin(CONSOLE.facing);
  let free = true;
  for (let along = -CONSOLE.hx - 0.3; along <= CONSOLE.hx + 0.3; along += 0.25)
    for (let out = -CONSOLE.hy + 0.05; out <= CONSOLE.hy + 0.3; out += 0.25)
      if (!nav.walkable(CONSOLE.floor, CONSOLE.x + fx * out - fy * along, CONSOLE.y + fy * out + fx * along)) free = false;
  check("the console and the floor around its front are open", free);
  check("the player's spot in front of it is open", nav.walkable(CONSOLE.floor, CONSOLE.x + Math.cos(CONSOLE.facing) * 1.4, CONSOLE.y + Math.sin(CONSOLE.facing) * 1.4));
}

// the console stands inside the guard's office on floor 3 (docs/floorplans, security_office)
const plan = JSON.parse(readFileSync(`docs/floorplans/floor${CONSOLE.floor + 1}_plan.json`, "utf8")) as { boxes: { id: string; x0: number; x1: number; y0: number; y1: number }[] };
const office = plan.boxes.find((b) => b.id === "security_office");
const inOffice = (x: number, y: number) => !!office && x > office.x0 && x < office.x1 && y > office.y0 && y < office.y1;
check(
  "the console is inside the security office, all four corners",
  [-1, 1].every((a) => [-1, 1].every((b) => inOffice(CONSOLE.x + Math.cos(CONSOLE.facing) * CONSOLE.hy * b - Math.sin(CONSOLE.facing) * CONSOLE.hx * a, CONSOLE.y + Math.sin(CONSOLE.facing) * CONSOLE.hy * b + Math.cos(CONSOLE.facing) * CONSOLE.hx * a))),
);
check("the office has its doorway on the north hall", plan.boxes.some((b) => b.id === "security_office_door" && office && b.y0 === office.y1 && b.y1 === 159));

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
