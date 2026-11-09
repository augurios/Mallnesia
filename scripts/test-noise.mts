// Night-noise test: the motions, the timer and the choice of where (src/engine/night-noise.ts), on the real mall.
// Run: npm run test:noise   (the placement check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { NOISE, NoiseDirector, Slide, Tip, pickNoiseSpot } from "../src/engine/night-noise.ts";
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
  const tip = new Tip(1.4);
  const hits: number[] = [];
  let t = 0;
  for (; t < 6 && !tip.settled; t += 1 / 60) {
    const h = tip.update(1 / 60);
    if (h !== null) hits.push(h);
  }
  check("a tip lands and settles lying at its rest angle", tip.settled && Math.abs(tip.angle - 1.4) < 1e-9, `${t.toFixed(2)} s`);
  check("the first hit is the loudest", hits.length >= 1 && hits.every((h, i) => i === 0 || h < hits[0]), hits.map((h) => h.toFixed(1)).join(", "));
  check("it falls in about a second", t > 0.5 && t < 3);
  check("no further hits once settled", tip.update(1 / 60) === null);
  check("it never goes past lying", (() => {
    const q = new Tip(1.4);
    for (let i = 0; i < 600; i++) q.update(1 / 60);
    return q.angle <= 1.4 + 1e-9 && q.angle >= 0;
  })());
}
{
  const s = new Slide(2.4);
  let t = 0;
  for (; t < 10 && !s.stopped; t += 1 / 60) s.update(1 / 60);
  const expected = (2.4 * 2.4) / (2 * NOISE.FRICTION);
  check("a slide stops, after v^2 / 2f meters", s.stopped && Math.abs(s.distance - expected) < 0.02, `${s.distance.toFixed(2)} m, expected ${expected.toFixed(2)}`);
  check("a slide moves 0.5 to 1.5 m for the usual pushes", [NOISE.PUSH[0], NOISE.PUSH[1]].every((v) => (v * v) / (2 * NOISE.FRICTION) > 0.35 && (v * v) / (2 * NOISE.FRICTION) < 1.6));
}
{
  const d = new NoiseDirector(seeded(3));
  let first = 0;
  while (!d.update(1, 0)) first++;
  check("the first event comes within its window", first + 1 >= NOISE.FIRST[0] - 1 && first + 1 <= NOISE.FIRST[1] + 1, `${first + 1} s`);
  const gaps = (shift: number) => {
    const g = new NoiseDirector(seeded(9));
    g.soon(0);
    g.update(1, shift);
    let n = 0;
    let total = 0;
    for (let t = 0; t < 20000; t++) {
      if (g.update(1, shift)) {
        n++;
        total = t;
      }
    }
    return total / n;
  };
  const calm = gaps(0);
  const wrecked = gaps(3);
  check("calm gap is within the range", calm >= NOISE.GAP[0] - 1 && calm <= NOISE.GAP[1] + 1, `${calm.toFixed(0)} s average`);
  check("low sanity makes events more frequent", wrecked < calm * 0.6, `${wrecked.toFixed(0)} vs ${calm.toFixed(0)} s`);
  const off = new NoiseDirector(seeded(1));
  off.enabled = false;
  check("disabled: never", !Array.from({ length: 200 }, () => off.update(1, 0)).some(Boolean));
  const kinds = new Map<string, number>();
  const k = new NoiseDirector(seeded(4));
  for (let i = 0; i < 1000; i++) {
    const kind = k.pick();
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  check("all three kinds come up", kinds.size === 3);
}

if (existsSync("public/models/nav.json") && existsSync("public/models/props.json")) {
  const nav = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  const tables = (JSON.parse(readFileSync("public/models/props.json", "utf8")) as { instances: Record<string, number[]> }).instances.table_set ?? [];
  const rand = seeded(21);
  let found = 0;
  let ok = true;
  let besideTable = 0;
  for (let i = 0; i < 100; i++) {
    const px = 55 + rand() * 20;
    const py = 3 + rand() * 25;
    const blocked = (x: number, y: number) => nav.sees(1, px, py, x, y) === false; // only places behind walls count as hidden
    const spot = pickNoiseSpot(nav, tables, 5, 1, px, py, blocked, rand);
    if (!spot) continue;
    found++;
    const d = Math.hypot(spot.x - px, spot.y - py);
    if (d < NOISE.MIN_DIST || d > NOISE.MAX_DIST || !nav.walkable(1, spot.x, spot.y) || nav.sees(1, px, py, spot.x, spot.y)) ok = false;
    for (let j = 0; j + 3 < tables.length; j += 4) if (Math.round(tables[j + 1] / 5) === 1 && Math.hypot(tables[j] - spot.x, -tables[j + 2] - spot.y) < 1.6) besideTable++;
  }
  check("spots are found when something is hidden", found > 20, `${found}/100`);
  check("every spot is walkable, in range and out of sight", ok);
  check("they are beside tables", besideTable >= found * 0.7, `${besideTable}/${found}`);
  const never = pickNoiseSpot(nav, tables, 5, 1, 65, 15, () => false, rand);
  check("nothing hidden: no event", never === null);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
