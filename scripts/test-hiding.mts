// Hiding test: runs the game's own hiding module (src/engine/hiding.ts) for exact scenarios, and checks the spots the
// real props give. Run: npm run test:hiding   (the props check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { Hiding, HIDING, headingToYaw, spotsFromProps, yawToHeading, type HidingSpot } from "../src/engine/hiding.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// A table at (10, 20) lying east-west on floor 0.
const spot: HidingSpot = { id: "t", floor: 0, x: 10, y: 20, ax: 1, ay: 0 };
const east = 0; // plan heading east
const west = Math.PI;

// yaw and heading convert both ways
for (const h of [0, 1, -2, 3]) check(`yaw/heading round trip ${h}`, near(Math.atan2(Math.sin(yawToHeading(headingToYaw(h)) - h), Math.cos(yawToHeading(headingToYaw(h)) - h)), 0));
check("yaw 0 looks north", near(yawToHeading(0), Math.PI / 2));

{
  const h = new Hiding([spot]);
  // east end entry is at (11.2, 20); standing there, looking west at the table, is usable
  const a = h.usable(11.6, 20, 0, west);
  check("usable from the east end, looking at the table", a?.end === 1);
  check("usable from the west end", h.usable(8.4, 20, 0, east)?.end === -1);
  check("not usable looking away", h.usable(11.6, 20, 0, east) === null);
  check("not usable from the side", h.usable(10, 21.6, 0, -Math.PI / 2) === null);
  check("not usable from far", h.usable(14, 20, 0, west) === null);
  check("not usable on another floor", h.usable(11.6, 20, 1, west) === null);

  // crawl in
  h.enter(a!, 11.6, 20, headingToYaw(west));
  check("entering: not hidden yet", h.state === "entering" && !h.hidden);
  let pose = h.update(HIDING.ENTER_TIME * 0.6, 0);
  check("hidden past halfway through", h.hidden && pose !== null);
  check("busy: nothing else usable", h.usable(11.6, 20, 0, west) === null);
  pose = h.update(HIDING.ENTER_TIME, 0);
  check("in", h.state === "in" && pose!.crouch === 1);
  check("in, under the table toward the east end", near(pose!.x, 10 + HIDING.INSIDE) && near(pose!.y, 20));
  check("looking out of the east end", near(yawToHeading(pose!.yaw), east, 1e-6));
  check("cannot leave while crawling in", (() => {
    const g = new Hiding([spot]);
    g.enter(g.usable(11.6, 20, 0, west)!, 11.6, 20, 0);
    return !g.leave();
  })());

  // the head turns, within limits
  const lim = (HIDING.LOOK_YAW * Math.PI) / 180;
  const face = pose!.yaw;
  pose = h.update(0.016, face + 0.3);
  check("a small turn is allowed", near(pose!.yaw, face + 0.3));
  pose = h.update(0.016, face + 3);
  check("a big turn stops at the limit", near(pose!.yaw, face + lim));
  pose = h.update(0.016, face - 3);
  check("and the other way", near(pose!.yaw, face - lim));
  check("still hidden while looking around", h.hidden);

  // crawl out
  check("leaves with E", h.leave());
  check("leaving: hidden for the first half only", h.hidden && h.state === "leaving");
  pose = h.update(HIDING.LEAVE_TIME * 0.6, 1);
  check("hidden ends midway out", !h.hidden);
  pose = h.update(HIDING.LEAVE_TIME, 1);
  check("out again", h.state === "out" && !h.active);
  check("ends at the entry point, standing", near(pose!.x, 10 + HIDING.GATE) && near(pose!.y, 20) && pose!.crouch === 0);
  check("then update gives nothing", h.update(0.016, 0) === null);
}

{
  // entering from the player's side with the view pointing the wrong way: the view turns to look out
  const h = new Hiding([spot]);
  h.enter(h.usable(8.4, 20, 0, east)!, 8.4, 20, headingToYaw(east)); // west end, looking east (into the table)
  let pose = h.update(0.016, headingToYaw(east));
  for (let i = 0; i < 100; i++) pose = h.update(0.016, pose!.yaw); // the game feeds the pose's yaw back each frame
  check("view ends looking out of the west end", h.state === "in" && near(Math.cos(yawToHeading(pose!.yaw)), -1, 1e-3), `${yawToHeading(pose!.yaw).toFixed(3)}`);
  h.reset();
  check("reset drops the hide", h.state === "out" && !h.hidden);
}

{
  // spots from props: deterministic, on the right floor, about the chance asked for
  const inst: number[] = [];
  for (let i = 0; i < 400; i++) inst.push(i, i % 2 ? 5 : 0, -i, 0.5);
  const a = spotsFromProps({ table_set: inst, bench_red: inst }, 5);
  const b = spotsFromProps({ table_set: inst, bench_red: inst }, 5);
  check("same spots every time", JSON.stringify(a) === JSON.stringify(b));
  check("only the hideable pieces count", a.every((s) => s.id.startsWith("table_set#")));
  check("about 30 percent of tables", a.length > 90 && a.length < 150, `${a.length} of 400`);
  check("floor from the height", a.every((s) => s.floor === (Number(s.id.split("#")[1]) % 2 ? 1 : 0)));
  check("axis is the piece's heading", a.every((s) => near(s.ax, Math.cos(0.5)) && near(s.ay, Math.sin(0.5))));
  check("plan y is minus z", a.every((s) => near(s.y, Number(s.id.split("#")[1]))));
}

if (existsSync("public/models/props.json")) {
  const manifest = JSON.parse(readFileSync("public/models/props.json", "utf8")) as { instances: Record<string, number[]> };
  const spots = spotsFromProps(manifest.instances, 5);
  const tables = (manifest.instances.table_set?.length ?? 0) / 4;
  console.log(`     ${spots.length} of ${tables} tables are hiding spots; by floor: ${[0, 1, 2].map((f) => spots.filter((s) => s.floor === f).length).join(", ")}`);
  check("the real mall has hiding spots", spots.length >= 5);
  check("on the food court floors", spots.some((s) => s.floor === 1) && spots.some((s) => s.floor === 2));
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
