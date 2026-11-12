// Garage test: the generator (src/engine/garage-gen.ts): the same garage from the same seed, a way from the stairwell
// door to the payphone that a body can really walk, the recurring van, signs that go wrong.
// Run: npm run test:garage
import { GARAGE, GARAGE_ENTRANCES, GARAGE_ENTRANCE_DEPTH, GARAGE_EXIT_INSIDE, STRIP_WEST, atGoal, blockRange, entranceSeed, garageToStrip, generateGarage, pitBoxes, rampHeight, resolveGarage, stripBlockAt, stripBoxes, stripPart, stripToGarage, columnGaps, gapWalls, seamSeen, stripRows, stripSeams } from "../src/engine/garage-gen.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const g = generateGarage();
check("the same seed gives the same garage", JSON.stringify(generateGarage()) === JSON.stringify(g));
check("another seed gives another one", JSON.stringify(generateGarage(7)) !== JSON.stringify(g) && generateGarage(7).path.length > 1);
check("default seed is the fixed one", g.seed === GARAGE.SEED);
console.log(`     ${g.cols}x${g.rows} cells, path of ${g.path.length} cells, ${g.cars.length} cars (${g.cars.filter((c) => c.van).length} vans), ${g.lights.length} lights, ${g.signs.length} signs, ${g.boxes.length} boxes, ${g.deadEnds.length} dead ends, ${g.ramps.length} ramps`);

// the player's body can stand at the spawn and the goal, and walk from one to the other
const R = 0.35;
const free = (x: number, y: number) => {
  if (x < R || y < R || x > g.width - R || y > g.depth - R) return false;
  const [rx, ry] = resolveGarage(g.boxes, x, y, R);
  return Math.abs(rx - x) < 1e-6 && Math.abs(ry - y) < 1e-6;
};
check("the spawn is free", free(g.spawn.x, g.spawn.y));
check("the goal is free", free(g.goal.x, g.goal.y));
check("the spawn is not at the goal", !atGoal(g, g.spawn.x, g.spawn.y));

const STEP = 0.3;
const nx = Math.ceil(g.width / STEP);
const ny = Math.ceil(g.depth / STEP);
const seen = new Uint8Array(nx * ny);
const sx = Math.floor(g.spawn.x / STEP);
const sy = Math.floor(g.spawn.y / STEP);
const stack = [sy * nx + sx];
seen[stack[0]] = 1;
let reached = false;
let cells = 0;
while (stack.length) {
  const k = stack.pop()!;
  cells++;
  const i = k % nx;
  const j = (k - i) / nx;
  if (atGoal(g, (i + 0.5) * STEP, (j + 0.5) * STEP)) reached = true;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const a = i + di;
    const b = j + dj;
    if (a < 0 || b < 0 || a >= nx || b >= ny || seen[b * nx + a]) continue;
    seen[b * nx + a] = 1;
    if (free((a + 0.5) * STEP, (b + 0.5) * STEP)) stack.push(b * nx + a);
  }
}
check("a body can walk from the stairwell door to the payphone", reached, `${cells} free cells reached`);
// and almost all the open floor is connected (no cars walling the player into the first bays)
check("a good share of the garage floor is reachable", cells > nx * ny * 0.35, `${((100 * cells) / (nx * ny)).toFixed(0)}%`);

// the van recurs along the way
const vans = g.cars.filter((c) => c.van);
const cellOf = (x: number, y: number) => `${Math.floor(x / g.cell)},${Math.floor(y / g.cell)}`;
const pathCells = new Set(g.path.map(([i, j]) => `${i},${j}`));
check(`the van stands ${GARAGE.VANS} times`, vans.length === GARAGE.VANS, `${vans.length}`);
check("every van is on the guided path", vans.every((v) => pathCells.has(cellOf(v.x, v.y))));
check("in different cells", new Set(vans.map((v) => cellOf(v.x, v.y))).size === vans.length);
// the signs: starts right, then skips
const levels = g.signs.filter((s) => s.kind === "level").map((s) => s.text);
check("level signs exist and start at P2", levels.length >= 3 && levels[0] === "P2", levels.join(" "));
check("they go wrong: P7 and P-12 appear, out of order", levels.includes("P7") && levels.includes("P-12"));
check("exit arrows that point into walls exist", g.signs.some((s) => s.kind === "exit" && s.wrong));
check("and ones that point the right way early on", g.signs.some((s) => s.kind === "exit" && !s.wrong));
// no object stands on the spawn or goal; lights flicker
check("some lights flicker and some are dead", g.lights.some((l) => l.state === "flicker") && g.lights.some((l) => l.state === "dead") && g.lights.filter((l) => l.state === "on").length > g.lights.length / 2);
check("dead ends exist", g.deadEnds.length >= 1);
check("the booth has a payphone box", g.boxes.some((b) => b.kind === "phone") && g.boxes.some((b) => b.kind === "booth"));
// the collision push
{
  const [x, y] = resolveGarage([{ kind: "wall", x0: 0, x1: 1, y0: 0, y1: 5, top: 2 }], 1.1, 2, 0.35);
  check("a circle is pushed out of a wall", Math.abs(x - 1.35) < 1e-9 && y === 2);
  const [x2, y2] = resolveGarage([{ kind: "wall", x0: 0, x1: 1, y0: 0, y1: 5, top: 2 }], 0.5, 2, 0.35);
  check("a circle inside is pushed out by the nearest face", x2 <= -0.35 + 1e-9 || x2 >= 1.35 - 1e-9 || y2 !== 2, `${x2.toFixed(2)}, ${y2.toFixed(2)}`);
}
// many seeds: every one solvable, so a randomized garage can never be impossible
let unsolvable = 0;
for (let s = 1; s <= 25; s++) {
  const h = generateGarage(s);
  const reachableBody = (() => {
    const fr = (x: number, y: number) => {
      if (x < R || y < R || x > h.width - R || y > h.depth - R) return false;
      const [rx, ry] = resolveGarage(h.boxes, x, y, R);
      return Math.abs(rx - x) < 1e-6 && Math.abs(ry - y) < 1e-6;
    };
    const step = 0.5;
    const w = Math.ceil(h.width / step);
    const d = Math.ceil(h.depth / step);
    const vis = new Uint8Array(w * d);
    const st = [Math.floor(h.spawn.y / step) * w + Math.floor(h.spawn.x / step)];
    vis[st[0]] = 1;
    while (st.length) {
      const k = st.pop()!;
      const i = k % w;
      const j = (k - i) / w;
      if (atGoal(h, (i + 0.5) * step, (j + 0.5) * step)) return true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= w || b >= d || vis[b * w + a]) continue;
        vis[b * w + a] = 1;
        if (fr((a + 0.5) * step, (b + 0.5) * step)) st.push(b * w + a);
      }
    }
    return false;
  })();
  if (!reachableBody) unsolvable++;
}
check("25 other seeds: all solvable", unsolvable === 0, `${unsolvable} not`);

// the strip entrances: any opening, always (the swap needs the player GARAGE_ENTRANCE_DEPTH m inside, in the block)
check("two strip entrances", GARAGE_ENTRANCES.length === 2);
for (const e of GARAGE_ENTRANCES) {
  check(`${e.id}: a player 3 m inside the opening is in its block and deep enough`, stripBlockAt(e.x - 3, e.y, GARAGE_ENTRANCE_DEPTH)?.id === e.id);
  check(`${e.id}: not yet deep enough 1 m inside, nor outside in the hall`, stripBlockAt(e.x - 1, e.y, GARAGE_ENTRANCE_DEPTH) === null && stripBlockAt(e.x + 1, e.y, GARAGE_ENTRANCE_DEPTH) === null);
  check(`${e.id}: the way back out puts the player in the hall, outside the block`, stripBlockAt(e.x + GARAGE_EXIT_INSIDE, e.y) === null);
}
// the strip dressed as the garage's first column
check("the entry row is fixed", g.stairDoor.y === (GARAGE.ENTRY_ROW + 0.5) * GARAGE.CELL && g.path[0][1] === GARAGE.ENTRY_ROW && g.path[0][0] === 0);
const south = GARAGE_ENTRANCES[1];
const north = GARAGE_ENTRANCES[0];
check("the two blocks tile the strip from y 84 to 180", blockRange(south).y0 === 84 && blockRange(south).y1 === blockRange(north).y0 && blockRange(north).y1 === 180);
check("the block is as wide as the strip", GARAGE.CELL === south.x - STRIP_WEST);
for (const e of GARAGE_ENTRANCES) {
  const s0 = garageToStrip(e, g.stairDoor.x, g.stairDoor.y);
  check(`${e.id}: the stairwell door is the opening`, s0.x === e.x && s0.y === e.y);
  const back = stripToGarage(e, 10, e.y - 7);
  const there = garageToStrip(e, back.x, back.y);
  check(`${e.id}: mapping round-trips`, Math.abs(there.x - 10) < 1e-9 && Math.abs(there.y - (e.y - 7)) < 1e-9);
  check(`${e.id}: block lookup`, stripBlockAt(10, e.y)?.id === e.id && stripBlockAt(14, e.y)?.id === e.id && stripBlockAt(14, e.y, 2.5) === null);
}
const part = stripPart(g);
const partDoor = stripPart(g, true);
check("the dressing is column 0 only", part.boxes.every((b) => b.x0 >= -0.4 && b.x1 <= GARAGE.CELL + 0.4) && part.cars.every((c) => c.x <= GARAGE.CELL) && part.lights.length <= 4 * GARAGE.ROWS && part.lights.length >= 2 * GARAGE.ROWS);
check("the dressing leaves out the stairwell door and the booth", part.boxes.every((b) => b.kind !== "door" && b.kind !== "booth" && b.kind !== "phone"));
check("the west wall stays, with the opening cut out of it", part.boxes.some((b) => b.kind === "wall" && b.x0 < 0) && !part.boxes.some((b) => b.kind === "wall" && b.x0 < 0 && b.y1 > g.stairDoor.y - 3 && b.y0 < g.stairDoor.y + 3));
check("the floor-2 door cuts 3 m out of the far wall (and its corner column)", partDoor.boxes.length === part.boxes.length - 1 && partDoor.boxes.some((b) => b.kind === "wall" && b.y0 > g.depth - 0.5 && b.x0 === 3) && !part.boxes.some((b) => b.kind === "wall" && b.y0 > g.depth - 0.5 && b.x0 === 3));
for (const e of GARAGE_ENTRANCES) {
  const boxes = stripBoxes(part, e);
  const r = blockRange(e);
  check(`${e.id}: collision boxes stay inside the block`, boxes.every((b) => b.x0 >= STRIP_WEST - 0.4 && b.x1 <= e.x + 0.4 && b.y0 >= r.y0 - 0.3 && b.y1 <= r.y1 + 0.3));
  // the way in is clear: walking from the middle of the opening to the garage's first stretch, a body is not pushed
  let blocked = 0;
  for (let x = e.x - 0.5; x > e.x - 6; x -= 0.25) {
    const [rx, ry] = resolveGarage(boxes, x, e.y, 0.35);
    if (Math.abs(rx - x) > 1e-6 || Math.abs(ry - e.y) > 1e-6) blocked++;
  }
  check(`${e.id}: nothing parked in front of the opening`, blocked === 0, `${blocked} blocked`);
}

// ---- the closed strip and the swap that nobody sees (Augusto: the strip is closed, the swap comes as the player turns left or right)
{
  const g = generateGarage();
  const E = GARAGE.ENTRY_ROW;
  const C = g.cell;
  check("the entry cell's far wall is solid", !g.openE[E][0]);
  check("the entry cell opens left and right", g.openN[E - 1][0] && g.openN[E][0]);
  check("the strip's rows reach left and right of the entry", stripRows(g).has(E - 1) && stripRows(g).has(E + 1));
  const closed = stripPart(g);
  const open = stripPart(g, false, false);
  const wallAt = (part: typeof closed, y: number) => part.boxes.some((b) => b.kind === "wall" && b.x0 < C && b.x1 > C && b.y0 <= y && b.y1 >= y);
  const gaps = columnGaps(g);
  check("column 0 has doorways to column 1 (only in the garage)", gaps.length > 0 && gaps.every((q) => !wallAt(open, (q.y0 + q.y1) / 2)));
  check("the strip walls every one of them up", gaps.every((q) => wallAt(closed, (q.y0 + q.y1) / 2)));
  check("one doorway wall per doorway", gapWalls(g).length === gaps.length && gapWalls(g).every((w, k) => w.y0 === gaps[k].y0 && w.y1 === gaps[k].y1));
  // the swap waits only for the opening (the doorways are walled in both worlds then): from the entry cell, garage plan
  // (x east into the garage, the opening at x 0). The cone is the game's: 85 degrees vertical while running, 16:9, plus 6.
  const half = Math.atan(Math.tan((85 / 2) * (Math.PI / 180)) * (16 / 9)) + (6 * Math.PI) / 180;
  const cos = Math.cos(half);
  for (const door of [false, true]) {
    const { opening } = stripSeams(g, door);
    const occ = stripPart(g, door, false).boxes.filter((b) => b.kind === "wall" || b.kind === "column");
    const tag = door ? " (floor 2)" : "";
    const mid = { x: C / 2, y: (E + 0.5) * C };
    check(`just inside, facing the far wall: the opening is out of view${tag}`, !seamSeen(occ, opening, { x: 3, y: mid.y }, { x: 1, y: 0 }, cos));
    check(`facing back at the opening: in view${tag}`, seamSeen(occ, opening, mid, { x: -1, y: 0 }, cos));
    // turned left or right: within a couple of steps toward the side doorway the opening is behind the edge of the screen
    for (const [name, dir] of [["left", 1], ["right", -1]] as const) {
      let step = -1;
      for (let t = 0; t <= 6 && step < 0; t += 0.25) if (!seamSeen(occ, opening, { x: mid.x, y: mid.y + dir * t }, { x: 0, y: dir }, cos)) step = t;
      // (floor 2, toward the secret door at the far end: when the column is open all the way, the door is in line and the swap waits)
      if (door && name === "left" && g.openN[E + 1][0]) console.log(`     turned ${name}${tag}: the secret door is in line; swap ${step < 0 ? "waits past the entry cell" : `at ${step} m`}`);
      else check(`turned ${name} in the entry cell: the swap within 2.5 m${tag}`, step >= 0 && step <= 2.5, `at ${step} m`);
    }
  }
  // a doorway opens only unseen: from its own cell, looking at it, it is seen; looking down the strip away from it, not
  const { gaps: gapPts } = stripSeams(g, false);
  const occ = stripPart(g, false, false).boxes.filter((b) => b.kind === "wall" || b.kind === "column");
  gaps.forEach((q, k) => {
    const eye = { x: 3, y: (q.y0 + q.y1) / 2 };
    check(`doorway ${k}: seen when faced`, seamSeen(occ, gapPts[k], eye, { x: 1, y: 0 }, cos));
    check(`doorway ${k}: unseen when facing the strip's west wall`, !seamSeen(occ, gapPts[k], { x: 3, y: eye.y }, { x: -1, y: 0 }, cos));
  });
}

// ---- each opening has its own garage (entranceSeed), and every one of them fits its strip
{
  const seeds = new Map<number, string>();
  for (const e of GARAGE_ENTRANCES)
    for (let f = 0; f < 3; f++) {
      const seed = entranceSeed(GARAGE.SEED, e, f);
      seeds.set(seed, `${e.id}:${f}`);
      const lay = generateGarage(seed);
      const E = GARAGE.ENTRY_ROW;
      const key = `${e.id} floor ${f + 1} (seed ${seed})`;
      check(`${key}: the entry cell has a solid far wall and opens left and right`, !lay.openE[E][0] && lay.openN[E - 1][0] && lay.openN[E][0]);
      check(`${key}: the strip's dressing is closed`, columnGaps(lay).every((q) => stripPart(lay).boxes.some((b) => b.kind === "wall" && b.x0 < lay.cell && b.x1 > lay.cell && b.y0 <= (q.y0 + q.y1) / 2 && b.y1 >= (q.y0 + q.y1) / 2)));
      check(`${key}: the way to the payphone exists`, lay.path.length >= 8 && atGoal(lay, lay.goal.x, lay.goal.y));
    }
  check("six different garages", seeds.size === 6);
  check("the south opening on floor 2 keeps the base seed", entranceSeed(GARAGE.SEED, GARAGE_ENTRANCES[1], 1) === GARAGE.SEED);
}

// ---- ramps: every garage has at least two, walkable from the doorway up through the ceiling; nothing parked on them.
// The garages they lead to have none, no payphone, and an open doorway out.
{
  let bad = "";
  for (let seed = 1; seed <= 60; seed++) {
    const lay = generateGarage(seed * 7919);
    const solid = lay.boxes.filter((b) => b.kind !== "ramp");
    if (lay.ramps.length < GARAGE.RAMPS_MIN) bad += ` ${seed}:few`;
    lay.ramps.forEach((r, k) => {
      const horizontal = Math.abs(Math.cos(r.rise)) > 0.5;
      const dir = horizontal ? Math.sign(Math.cos(r.rise)) : Math.sign(Math.sin(r.rise));
      const len = horizontal ? r.box.x1 - r.box.x0 : r.box.y1 - r.box.y0;
      const mx = (r.box.x0 + r.box.x1) / 2;
      const my = (r.box.y0 + r.box.y1) / 2;
      // walk up along the middle, from just before the foot: not pushed by anything, the floor rises smoothly to the swap height and beyond
      let last = 0;
      for (let t = -1; t <= len * 0.8; t += 0.2) {
        const px = horizontal ? (dir > 0 ? r.box.x0 : r.box.x1) + dir * t : mx;
        const py = horizontal ? my : (dir > 0 ? r.box.y0 : r.box.y1) + dir * t;
        const [rx, ry] = resolveGarage(solid, px, py, 0.35);
        if (Math.hypot(rx - px, ry - py) > 1e-6) { bad += ` ${seed}:ramp${k}blockedAt${t.toFixed(1)}`; break; }
        const h = rampHeight(lay, px, py);
        if (h < last - 1e-9 || h - last > 0.2) bad += ` ${seed}:ramp${k}jump`;
        last = h;
      }
      if (last < GARAGE.RAMP_SWAP) bad += ` ${seed}:ramp${k}tooLow`;
      // nothing parked on it
      if (lay.boxes.some((b) => (b.kind === "car" || b.kind === "van") && b.x0 < r.box.x1 && b.x1 > r.box.x0 && b.y0 < r.box.y1 && b.y1 > r.box.y0)) bad += ` ${seed}:ramp${k}carOnIt`;
    });
    if (rampHeight(lay, lay.spawn.x, lay.spawn.y) !== 0) bad += ` ${seed}:rampAtSpawn`;
    // the arrival garage
    const arr = generateGarage(seed * 104729, { arrival: true });
    if (arr.ramps.length || arr.boxes.some((b) => b.kind === "booth" || b.kind === "phone" || b.kind === "door")) bad += ` ${seed}:arrivalHasRampBoothOrDoor`;
    const L = arr.landing;
    if (!L) bad += ` ${seed}:noLanding`;
    else {
      const arrSolid = [...arr.boxes.filter((b) => b.kind !== "ramp"), ...pitBoxes(arr, false)];
      const horizontal = Math.abs(Math.cos(L.rise)) > 0.5;
      const dir = horizontal ? Math.sign(Math.cos(L.rise)) : Math.sign(Math.sin(L.rise));
      const len = horizontal ? L.box.x1 - L.box.x0 : L.box.y1 - L.box.y0;
      const mx = (L.box.x0 + L.box.x1) / 2;
      const my = (L.box.y0 + L.box.y1) / 2;
      // the ramp from below: the floor is `top` down at the foot and level at the top, and the body walks up it, out of the pit, and on through the doorway
      let last = -GARAGE.RAMP_RISE;
      for (let t = 0.4; t <= len + 3; t += 0.2) {
        const px = horizontal ? (dir > 0 ? L.box.x0 : L.box.x1) + dir * t : mx;
        const py = horizontal ? my : (dir > 0 ? L.box.y0 : L.box.y1) + dir * t;
        const [rx, ry] = resolveGarage(arrSolid, px, py, 0.35);
        if (Math.hypot(rx - px, ry - py) > 1e-6) { bad += ` ${seed}:landingBlockedAt${t.toFixed(1)}`; break; }
        const h = rampHeight(arr, px, py);
        if (h < last - 1e-9 || h - last > 0.2 || h > 1e-9) bad += ` ${seed}:landingHeight`;
        last = h;
      }
      if (rampHeight(arr, mx - dir * (horizontal ? len / 2 - 0.1 : 0), my - dir * (horizontal ? 0 : len / 2 - 0.1)) > -GARAGE.RAMP_RISE * 0.9) bad += ` ${seed}:landingFootNotDeep`;
      // the pit can be shut behind the player, and the walls keep them in it
      const [sx, sy] = resolveGarage(pitBoxes(arr, true), mx, my, 0.35);
      if (Math.hypot(sx - mx, sy - my) < 1) bad += ` ${seed}:pitNotShut`;
      const last2 = arr.path[arr.path.length - 1];
      if (Math.floor(mx / arr.cell) !== last2[0] || Math.floor(my / arr.cell) !== last2[1]) bad += ` ${seed}:landingNotPathEnd`;
      // it lines up over any ramp of any garage, turned by the difference of headings
      for (const r of lay.ramps) {
        const delta = r.rise - L.rise;
        const c0x = (r.box.x0 + r.box.x1) / 2;
        const c0y = (r.box.y0 + r.box.y1) / 2;
        const tx = c0x - (Math.cos(delta) * mx - Math.sin(delta) * my);
        const ty = c0y - (Math.sin(delta) * mx + Math.cos(delta) * my);
        const map = (x: number, y: number) => [Math.cos(delta) * x - Math.sin(delta) * y + tx, Math.sin(delta) * x + Math.cos(delta) * y + ty];
        const [a0, b0] = map(L.box.x0, L.box.y0);
        const [a1, b1] = map(L.box.x1, L.box.y1);
        if (Math.abs(Math.min(a0, a1) - r.box.x0) > 1e-6 || Math.abs(Math.max(a0, a1) - r.box.x1) > 1e-6 || Math.abs(Math.min(b0, b1) - r.box.y0) > 1e-6 || Math.abs(Math.max(b0, b1) - r.box.y1) > 1e-6) bad += ` ${seed}:landingMisaligned`;
      }
    }
    const [ax, ay] = resolveGarage(arr.boxes.filter((b) => b.kind !== "ramp"), arr.arrive.x, arr.arrive.y, 0.35);
    if (arr.landing && Math.hypot(ax - arr.arrive.x, ay - arr.arrive.y) > 1e-6) bad += ` ${seed}:arriveBlocked`;
    if (arr.path.length < 8) bad += ` ${seed}:shortArrivalPath`;
    // the open doorway: a body walks straight out through it, from the first column
    for (let x = 3; x >= -0.5; x -= 0.1) {
      const [rx, ry] = resolveGarage(arr.boxes, x, arr.stairDoor.y, 0.35);
      if (Math.abs(rx - x) > 1e-6 || Math.abs(ry - arr.stairDoor.y) > 1e-6) { bad += ` ${seed}:exitBlockedAt${x.toFixed(1)}`; break; }
    }
  }
  check("60 seeds: >= 2 walkable ramps, none with cars on them; arrival garages have no ramps, booth or door, a clear arrival and an open doorway", bad === "", bad);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
