// Guard scene test: the opening scene's timeline (src/engine/guard-scene.ts) and where he can stand on the real mall.
// Run: npm run test:guard   (the placement check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { GuardScene, GUARD_SCENE, lineTime, placeAhead } from "../src/engine/guard-scene.ts";
import { es } from "../src/strings/es-CR.ts";
import { NavGrid, type NavData } from "../src/engine/nav.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const lines: string[] = [...es.guardOpening];
const DT = 1 / 30;
/** Runs the scene with the guard walking at his speed: he starts `start` m away; `view(t)` tells whether he is in view. */
function play(scene: GuardScene, view: (t: number) => boolean, seconds: number, start = 7) {
  const started: number[] = [];
  let gone: number | null = null;
  let stoppedAt: number | null = null;
  let freedAt: number | null = null;
  let dist = start;
  for (let t = 0; t < seconds && gone === null; t += DT) {
    if (scene.approaching) dist -= GUARD_SCENE.WALK_SPEED * DT;
    const ev = scene.update(DT, dist, view(t));
    if (ev === "line") started.push(t);
    if (ev === "gone") gone = t;
    if (scene.phase === "talking" && stoppedAt === null) stoppedAt = t;
    if (!scene.controlLocked && freedAt === null) freedAt = t;
  }
  return { started, gone, stoppedAt, freedAt, dist };
}

{
  const s = new GuardScene(lines);
  check("the player is locked from the very first frame", s.controlLocked && s.phase === "holding");
}
{
  const s = new GuardScene(lines);
  const r = play(s, () => true, 40);
  const expected = GUARD_SCENE.START_HOLD + (7 - GUARD_SCENE.STOP_DISTANCE) / GUARD_SCENE.WALK_SPEED;
  check("he walks up and stops at talking distance", r.stoppedAt !== null && Math.abs(r.stoppedAt - expected) < 0.2, `stops at ${r.stoppedAt?.toFixed(1)} s, expected ${expected.toFixed(1)}`);
}
{
  const s = new GuardScene(lines);
  const r = play(s, () => true, 60);
  check("says every line, in order, with gaps", r.started.length === 3 && r.started.every((t, i) => i === 0 || t - r.started[i - 1] >= lineTime(lines[i - 1])), `${r.started.map((t) => t.toFixed(1)).join(", ")}`);
  check("no line before he has stopped", r.stoppedAt !== null && r.started[0] > r.stoppedAt);
  check("control returns only after the last line", r.freedAt !== null && r.freedAt > r.started[2] + lineTime(lines[2]), `free at ${r.freedAt?.toFixed(1)} s`);
}
{
  const s = new GuardScene(lines);
  const r = play(s, (t) => t < 20, 120); // the player looks at him through the talk, then away
  check("still there while in view after the last line", r.gone !== null && r.gone >= 20);
  check("he disappears only once out of view after the talk", r.gone !== null && s.done, `gone at ${r.gone?.toFixed(1)} s`);
}
{
  const s = new GuardScene(lines);
  const r = play(s, () => false, 120); // never in view (something blocks it): the talk still happens
  check("looking away does not cut the talk", r.started.length === 3, `lines ${r.started.length}`);
}
{
  const s = new GuardScene(lines);
  const r = play(s, () => true, 300); // stares at him forever
  check("a player who keeps watching him: he stays where he is", r.gone === null && s.phase === "lingering" && !s.controlLocked);
}
{
  const s = new GuardScene(lines);
  play(s, () => true, 1, 7);
  s.stop(); // blocked on the way
  const r = play(s, () => true, 60, 5);
  check("blocked on the way up: he talks from where he is", r.started.length === 3 || s.phase !== "approaching");
}
{
  const s = new GuardScene(lines);
  play(s, () => true, 3);
  check("finish ends it at once and frees the player", s.finish() === "gone" && s.done && !s.controlLocked && s.update(1, 3, true) === null);
}
{
  const bad = es.guardOpening.filter((l) => /\b(lo|la)\b encuentre|\bseñor|\bseñora|\bjoven\b/i.test(l));
  check("the words are genre neutral", bad.length === 0, bad.join(" | "));
}

if (existsSync("public/models/nav.json")) {
  const nav = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  const spot = placeAhead(nav, 0, 72, 28, Math.PI / 2); // the start of floor 1, looking north
  check("the real start has a place for him straight ahead", spot !== null, spot ? `${spot.x.toFixed(1)}, ${spot.y.toFixed(1)}` : "none");
  if (spot) {
    check("on open floor, in sight", nav.walkable(0, spot.x, spot.y) && nav.sees(0, 72, 28, spot.x, spot.y));
    const d = Math.hypot(spot.x - 72, spot.y - 28);
    check("between 4 and 8 m away", d >= 4 && d <= 8, `${d.toFixed(1)} m`);
  }
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
