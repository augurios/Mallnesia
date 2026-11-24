// Guard rounds test: scouting, patrol, cues, meeting and escort (src/engine/guard-rounds.ts), on the real mall.
// Run: npm run test:rounds   (needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { CHECKPOINTS, Exploration, GuardRounds, ROUNDS, cueEffect, type RoundsContext } from "../src/engine/guard-rounds.ts";
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

// scouting
{
  const e = new Exploration();
  check("scouting starts at nothing", e.score === 0 && !e.ready);
  for (let x = 60; x < 60 + 8 * 20; x += 8) e.visit(0, x, 20);
  check("walking on new ground adds up", e.score === 20 && !e.ready);
  for (let x = 60; x < 60 + 8 * 20; x += 8) e.visit(0, x + 1, 21);
  check("the same ground again adds nothing", e.score === 20);
  e.noteRead();
  e.noteRead();
  e.visitedGarage();
  check("notes and the garage count", e.score === 20 + 2 * ROUNDS.NOTE_SCORE + ROUNDS.GARAGE_SCORE);
  for (let x = 0; x < 8 * 30; x += 8) e.visit(1, x, 100);
  check("enough scouting: ready", e.ready);
  e.reset();
  check("reset", e.score === 0);
}
// cues
{
  const calm = cueEffect(1, false, 0.0, 0.0);
  check("calm: true cues, normal loudness", !calm.lie && !calm.quiet && calm.gain === 1 && calm.range === ROUNDS.RANGE);
  const lost = cueEffect(0, true, 0, 0);
  check("lost for minutes: clearer (louder, farther, never lying)", !lost.lie && !lost.quiet && lost.gain > 1 && lost.range > ROUNDS.RANGE);
  let lies = 0;
  let quiets = 0;
  const r = seeded(5);
  for (let i = 0; i < 4000; i++) {
    const c = cueEffect(0.1, false, r(), r());
    if (c.lie) lies++;
    if (c.quiet) quiets++;
  }
  check("at low sanity the mall lies about where he is, and sometimes goes quiet", lies > 1500 && lies < 3200 && quiets > 300, `${lies} lies, ${quiets} quiet of 4000`);
  check("at 0.5 sanity: no interference", !cueEffect(0.5, false, 0, 0).lie && !cueEffect(0.5, false, 0, 0).quiet);
}

if (existsSync("public/models/nav.json")) {
  const nav = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  check("every checkpoint is on open floor", CHECKPOINTS.every((c) => nav.walkable(c.floor, c.x, c.y)), CHECKPOINTS.filter((c) => !nav.walkable(c.floor, c.x, c.y)).map((c) => c.id).join(","));
  check("the exit and the lobby spot are on open floor", nav.walkable(ROUNDS.EXIT.floor, ROUNDS.EXIT.x, ROUNDS.EXIT.y) && nav.walkable(ROUNDS.LOBBY.floor, ROUNDS.LOBBY.x, ROUNDS.LOBBY.y));
  check("there is a way from the lobby to the main doors", nav.findPath(0, ROUNDS.LOBBY.x + 1.5, ROUNDS.LOBBY.y + 1.5, ROUNDS.EXIT.x, ROUNDS.EXIT.y) !== null);
  const sameFloor = CHECKPOINTS.filter((c) => c.floor === 1);
  const linked = sameFloor.every((a) => sameFloor.every((b) => nav.findPath(1, a.x, a.y, b.x, b.y) !== null));
  check("the checkpoints on one floor are connected", linked);

  // patrol: the player stays far away, out of sight
  const far = (): RoundsContext => ({ nav, px: 100, py: 150, floor: 2, seenBy: () => false });
  const g = new GuardRounds(seeded(7));
  check("absent until started", g.phase === "absent" && !g.present && g.update(1, far()).length === 0);
  check("he returns at a checkpoint the player cannot see", g.start({ nav, px: 72, py: 28, floor: 0, seenBy: (x, y, f) => f === 0 && Math.hypot(x - 72, y - 28) < 30 }) && g.phase === "patrolling" && !(g.floor === 0 && Math.hypot(g.x - 72, g.y - 28) < 30));
  let walkable = true;
  const visited = new Set<string>();
  const cues = { keys: 0, radio: 0, step: 0 };
  let cueWhileStill = 0;
  let relocations = 0;
  let lastFloor = g.floor;
  for (let t = 0; t < 1800; t += 1 / 10) {
    const ev = g.update(1 / 10, far());
    if (g.present && !nav.walkable(g.floor, g.x, g.y)) walkable = false;
    if (g.target && Math.hypot(g.target.x - g.x, g.target.y - g.y) < 2) visited.add(g.target.id);
    for (const e of ev) if (e.type === "cue") {
      cues[e.cue]++;
      if ((e.cue === "keys" || e.cue === "step") && !g.walking) cueWhileStill++;
    }
    if (g.floor !== lastFloor) {
      relocations++;
      lastFloor = g.floor;
    }
    if (g.phase !== "patrolling") break;
  }
  check("30 minutes of rounds: always on open floor", walkable);
  check("he visits several checkpoints", visited.size >= 4, `${visited.size}: ${[...visited].join(", ")}`);
  check("the mall carries him to other floors", relocations >= 1, `${relocations}`);
  check("keys, footsteps and radio all sound", cues.keys > 50 && cues.step > 150 && cues.radio > 40, JSON.stringify(cues));
  check("no keys or footsteps while he stands still", cueWhileStill === 0 || cueWhileStill < 5, `${cueWhileStill}`);

  // the order changes between laps
  const orders: string[] = [];
  const g2 = new GuardRounds(seeded(11));
  g2.start({ nav, px: 100, py: 150, floor: 2, seenBy: () => false });
  let lap: string[] = [];
  let lastTarget = g2.target?.id ?? "";
  for (let t = 0; t < 7200 && orders.length < 3; t += 1 / 10) {
    g2.update(1 / 10, far());
    if (g2.target && g2.target.id !== lastTarget) {
      lastTarget = g2.target.id;
      lap.push(lastTarget);
      if (lap.length === CHECKPOINTS.length - 1) {
        orders.push(lap.join(">"));
        lap = [];
      }
    }
  }
  check("the order of the rounds is not the same lap after lap", orders.length >= 2 && new Set(orders).size >= 2, `${orders.length} laps, ${new Set(orders).size} different`);

  // meeting and escort
  const h = new GuardRounds(seeded(3));
  h.start({ nav, px: 100, py: 150, floor: 2, seenBy: () => false });
  h.floor = 0;
  h.x = 72.5;
  h.y = 28.5;
  h.target = CHECKPOINTS[3];
  const near = (): RoundsContext => ({ nav, px: 72.5, py: 26.5, floor: 0, seenBy: () => true });
  const ev = h.update(0.1, near());
  check("within 3.6 m and in sight: he meets the player", h.phase === "meeting" && ev.some((e) => e.type === "meet"));
  h.beginEscort();
  check("the escort begins", h.phase === "escort");
  // the player follows a couple of meters behind
  let px = 72.5;
  let py = 26.5;
  let arrived = false;
  for (let t = 0; t < 400 && !arrived; t += 1 / 10) {
    const ctx: RoundsContext = { nav, px, py, floor: 0, seenBy: () => true };
    const out = h.update(1 / 10, ctx);
    if (out.some((e) => e.type === "arrived")) arrived = true;
    const d = Math.hypot(h.x - px, h.y - py);
    if (d > 2.5) {
      px += ((h.x - px) / d) * 1.6 * 0.1;
      py += ((h.y - py) / d) * 1.6 * 0.1;
    }
  }
  check("a player who follows is led to the main doors", arrived && h.phase === "done");
  const w = new GuardRounds(seeded(4));
  w.start({ nav, px: 100, py: 150, floor: 2, seenBy: () => false });
  w.floor = 0;
  w.x = 72.5;
  w.y = 28.5;
  w.update(0.1, near());
  w.beginEscort();
  const before = [w.x, w.y];
  let called = 0;
  for (let t = 0; t < 30; t += 1 / 10) if (w.update(1 / 10, { nav, px: 72.5, py: 12.5, floor: 0, seenBy: () => true }).some((e) => e.type === "waiting")) called++;
  check("a player who falls behind: he stops and calls", called >= 1 && Math.hypot(w.x - before[0], w.y - before[1]) < 8, `${called} calls`);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
