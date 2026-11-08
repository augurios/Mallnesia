// Guard scene test: the opening scene's timeline (src/engine/guard-scene.ts) and where he can stand on the real mall.
// Run: npm run test:guard   (the placement check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { GuardScene, GUARD_SCENE, lineTime, placeAhead } from "../src/engine/guard-scene.ts";
import { NavGrid, type NavData } from "../src/engine/nav.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const lines = ["Disculpe, ya cerramos.", "El mall cerró hace rato; tiene que salir.", "Yo termino la ronda y vuelvo."];
const DT = 1 / 30;
/** Runs the scene with `view(t)` telling whether he is in view; returns the lines started (with times) and when he left. */
function play(scene: GuardScene, view: (t: number) => boolean, seconds: number) {
  const started: number[] = [];
  let gone: number | null = null;
  let walkedAt: number | null = null;
  for (let t = 0; t < seconds && gone === null; t += DT) {
    const ev = scene.update(DT, view(t));
    if (ev === "line") started.push(t);
    if (ev === "gone") gone = t;
    if (scene.walking && walkedAt === null) walkedAt = t;
  }
  return { started, gone, walkedAt };
}

{
  const s = new GuardScene(lines);
  const r = play(s, () => true, 3);
  check("waits to be seen before speaking", r.started.length === 1 && r.started[0] > GUARD_SCENE.NOTICE_AFTER, `first line at ${r.started[0]?.toFixed(2)} s`);
}
{
  const s = new GuardScene(lines);
  const r = play(s, () => false, 60);
  check("never seen: the scene is dropped, he never speaks", r.started.length === 0 && r.gone !== null && r.gone >= GUARD_SCENE.GIVE_UP - 0.1);
}
{
  const s = new GuardScene(lines);
  const r = play(s, (t) => t < 12, 60); // the player looks at him for 12 s, then away
  check("says every line, in order, with gaps", r.started.length === 3 && r.started.every((t, i) => i === 0 || t - r.started[i - 1] >= lineTime(lines[i - 1])));
  check("disappears once out of view after the last line", r.gone !== null && r.gone < 12 + 3 && s.done, `gone at ${r.gone?.toFixed(1)} s`);
}
{
  const s = new GuardScene(lines);
  const r = play(s, (t) => t < 3 || t > 30, 60); // looks away after one line
  check("looking away mid-talk: he is gone", r.gone !== null && r.gone < 8 && r.started.length >= 1 && r.started.length < 3, `lines ${r.started.length}, gone at ${r.gone?.toFixed(1)} s`);
}
{
  const s = new GuardScene(lines);
  const r = play(s, () => true, 200); // stares at him forever
  check("a player who keeps staring: he walks away, then goes anyway", r.walkedAt !== null && r.gone !== null && r.gone <= 80, `walks at ${r.walkedAt?.toFixed(1)} s, gone at ${r.gone?.toFixed(1)} s`);
}
{
  const s = new GuardScene(lines);
  play(s, () => true, 3);
  check("finish ends it at once", s.finish() === "gone" && s.done && s.update(1, true) === null);
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
