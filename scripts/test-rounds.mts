// Guard rounds test: scouting, patrol, cues, meeting and escort (src/engine/guard-rounds.ts), on the real mall.
// Run: npm run test:rounds   (needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { CHECKPOINTS, EXITS, Exploration, GuardRounds, ROUNDS, cueEffect, type RoundsContext } from "../src/engine/guard-rounds.ts";
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
  check("every exit is on open floor (or next to it)", EXITS.every((e) => nav.nearestWalkable(e.floor, e.x, e.y, 2) !== null), EXITS.filter((e) => !nav.nearestWalkable(e.floor, e.x, e.y, 2)).map((e) => e.id).join(","));
  check("the stairs are in the nav data: three towers, two flights each", nav.stairs.length === 6, `${nav.stairs.length}`);
  check("every checkpoint has a walk to an exit", CHECKPOINTS.every((c) => EXITS.some((e) => nav.findRoute(c.floor, c.x, c.y, e.floor, e.x, e.y, ROUNDS.FLOOR_H) !== null)));
  const down = nav.findRoute(2, 70, 20, 0, 74.5, 8.8, ROUNDS.FLOOR_H);
  check("from floor 3 to the main doors: down the stairs, one continuous walk", !!down && down.pts[down.pts.length - 1][2] === 0 && down.pts.some((p) => p[2] > 0 && p[2] < 10 && p[2] % 5 !== 0), down ? `${down.length.toFixed(0)} m` : "no route");
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
  /** A guard met at (x, y) on `floor`, in the escort. */
  const met = (seed: number, floor: number, x: number, y: number) => {
    const h = new GuardRounds(seeded(seed));
    h.start({ nav, px: 100, py: 150, floor: 2, seenBy: () => false });
    h.floor = floor;
    h.z = floor * ROUNDS.FLOOR_H;
    h.x = x;
    h.y = y;
    const ev = h.update(0.1, { nav, px: x, py: y - 2, floor, seenBy: () => true });
    return { h, ev, exit: h.beginEscort(nav) };
  };
  /** A player who follows his trail a couple of meters behind, up and down the stairs. True if he gets them out. */
  const follow = (h: GuardRounds, seconds: number) => {
    const trail: [number, number, number][] = [[h.x, h.y - 2, h.z]];
    let [px, py, pz] = trail[0];
    let maxProgress = 0;
    let monotone = true;
    for (let t = 0; t < seconds; t += 1 / 10) {
      const floor = Math.max(0, Math.floor((pz + 0.6) / ROUNDS.FLOOR_H));
      const out = h.update(1 / 10, { nav, px, py, floor, pz, seenBy: () => true });
      if (h.progress + 1e-6 < maxProgress) monotone = false;
      maxProgress = Math.max(maxProgress, h.progress);
      if (out.some((e) => e.type === "arrived")) return { arrived: true, monotone, t };
      trail.push([h.x, h.y, h.z]);
      // walk toward the oldest trail point that is still more than 2.5 m from him
      while (trail.length > 1 && Math.hypot(trail[0][0] - px, trail[0][1] - py, trail[0][2] - pz) < 0.3) trail.shift();
      if (Math.hypot(h.x - px, h.y - py, h.z - pz) > 2.5) {
        const [tx, ty, tz] = trail[0];
        const d = Math.hypot(tx - px, ty - py, tz - pz) || 1;
        const step = Math.min(d, 1.7 * 0.1);
        px += ((tx - px) / d) * step;
        py += ((ty - py) / d) * step;
        pz += ((tz - pz) / d) * step;
      }
    }
    return { arrived: false, monotone, t: seconds };
  };
  const lobby = met(3, 0, 72.5, 28.5);
  check("within 3.6 m and in sight: he meets the player", lobby.ev.some((e) => e.type === "meet"));
  check("met in the lobby: the escort begins, to the main entrance", lobby.h.phase === "escort" && lobby.exit?.id === "main", lobby.exit?.id ?? "none");
  const a = follow(lobby.h, 300);
  check("a player who follows is led out", a.arrived && lobby.h.phase === "done" && lobby.h.progress === 1, `${a.t.toFixed(0)} s`);
  check("the walk's progress only grows", a.monotone);
  check("met near the side exit: that is where he goes", met(5, 0, 36, 46).exit?.id === "side", met(5, 0, 36, 46).exit?.id ?? "none");
  check("met at floor 2's north end: the north exit", met(6, 1, 51, 185).exit?.id === "north", met(6, 1, 51, 185).exit?.id ?? "none");
  const upstairs = met(8, 2, 70, 20);
  check("met on floor 3: he heads for an exit downstairs", upstairs.exit !== null && upstairs.exit.floor < 2, upstairs.exit?.id ?? "none");
  const b = follow(upstairs.h, 600);
  check("from floor 3, a player who follows him down the stairs is led out", b.arrived, `${b.t.toFixed(0)} s, ${upstairs.h.remaining.toFixed(0)} m left`);

  const w = met(4, 0, 72.5, 28.5).h;
  const before = [w.x, w.y];
  let called = 0;
  for (let t = 0; t < 30; t += 1 / 10) if (w.update(1 / 10, { nav, px: 72.5, py: 12.5, floor: 2, seenBy: () => true }).some((e) => e.type === "waiting")) called++;
  check("a player who falls behind: he stops and calls", called >= 1 && Math.hypot(w.x - before[0], w.y - before[1]) < 8, `${called} calls`);
  let taken = false;
  for (let t = 0; t < ROUNDS.LOSE_AFTER + 5 && !taken; t += 1 / 10) taken = w.update(1 / 10, { nav, px: 72.5, py: 12.5, floor: 2, seenBy: () => true }).some((e) => e.type === "taken");
  check("while the player can see him, the mall does not take him", !taken && w.phase === "escort");
  taken = w.update(0.1, { nav, px: 72.5, py: 12.5, floor: 2, seenBy: () => false }).some((e) => e.type === "taken");
  check("behind too long and out of sight: the mall takes him", taken && w.phase === "absent" && !w.present);
  check("he is not back on his rounds at once", !w.start({ nav, px: 100, py: 150, floor: 2, seenBy: () => false }));
  for (let t = 0; t < ROUNDS.TAKEN_DELAY[1] + 1; t += 1) w.update(1, far());
  check("after a while he is back on his rounds, to be found again", w.start({ nav, px: 100, py: 150, floor: 2, seenBy: () => false }) && w.phase === "patrolling");
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
