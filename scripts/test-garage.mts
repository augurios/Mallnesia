// Garage test: the generator (src/engine/garage-gen.ts): the same garage from the same seed, a way from the stairwell
// door to the payphone that a body can really walk, the recurring van, signs that go wrong.
// Run: npm run test:garage
import { GARAGE, atGoal, generateGarage, resolveGarage } from "../src/engine/garage-gen.ts";

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

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
