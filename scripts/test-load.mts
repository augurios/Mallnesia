// Loading progress test: the one number behind the loading screen (src/engine/load-progress.ts).
// Run: npm run test:load
import { LoadProgress } from "../src/engine/load-progress.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

{
  const p = new LoadProgress([
    { name: "mall", weight: 6 },
    { name: "props", weight: 2 },
    { name: "warm", weight: 2 },
  ]);
  check("starts at 0, not complete", p.value === 0 && !p.complete);
  p.report("mall", 300, 600);
  check("weighted: half of the heaviest task is 30%", Math.abs(p.value - 0.3) < 1e-9, `${p.value.toFixed(2)}`);
  p.report("mall", 100, 600);
  check("a smaller report never moves a task back", Math.abs(p.value - 0.3) < 1e-9);
  p.report("mall", 600, 600);
  check("a task is never 100% until it is finished", p.value < 0.6 && p.value > 0.55, `${p.value.toFixed(3)}`);
  p.finish("mall");
  check("finishing it counts its whole weight", Math.abs(p.value - 0.6) < 1e-9);
  p.report("props", 0, 0);
  check("an unknown total changes nothing", Math.abs(p.value - 0.6) < 1e-9);
  p.finish("props");
  check("not complete while a task is open, and below 1", !p.complete && p.value < 1 && Math.abs(p.value - 0.8) < 1e-9);
  p.finish("warm");
  check("complete is exactly 1", p.complete && p.value === 1);
  p.report("mall", 1, 10);
  check("reports after the end change nothing", p.value === 1);
  p.finish("nothing");
  check("an unknown task name is ignored", p.value === 1);
}
{
  // a failed optional task is finished, so it does not hold the screen
  const p = new LoadProgress([
    { name: "a", weight: 1 },
    { name: "nav", weight: 1 },
  ]);
  p.finish("a");
  p.finish("nav");
  check("all finished, even a failed one", p.complete && p.value === 1);
  const q = new LoadProgress([{ name: "x", weight: 1 }]);
  let last = 0;
  let monotonic = true;
  for (let i = 0; i <= 100; i++) {
    q.report("x", i % 7 === 0 ? i / 2 : i, 100);
    if (q.value < last) monotonic = false;
    last = q.value;
  }
  check("never decreases under noisy reports", monotonic);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
